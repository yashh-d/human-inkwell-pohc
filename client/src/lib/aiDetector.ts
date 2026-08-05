/**
 * aiDetector.ts — the seam between Human Ink and a *real* AI-text detector.
 *
 * The UI only ever sees the shape computeAiScore() already returns
 * ({ ai, human, verdict, color }), so nothing downstream cares whether the
 * number came from a model or the built-in heuristic. The backend model is an
 * implementation detail chosen server-side by one env var (DETECTOR_BACKEND) —
 * it is never named in the client. That keeps the frontend honest (it shows a
 * neutral "open model" label that is true for whichever backend is live) and
 * makes swapping backends a config change, not a code change.
 *
 * Failure is never fatal: if the detector endpoint is missing, slow, or errors,
 * we fall back to computeAiScore() so the page always renders a result.
 */
import { computeAiScore, ProofMetrics } from './authorship';

export type AiResult = ReturnType<typeof computeAiScore> & {
  /** Where the number came from — for the UI's honesty label + debugging. */
  source: 'model' | 'fallback' | 'simulated';
};

// Same bands as computeAiScore so a model result and a heuristic result are
// visually/semantically interchangeable. Green must be genuinely low AI; red is
// reserved for clearly high (a false red is a wrongful accusation).
export function bandFromAi(ai: number): { verdict: string; color: string } {
  const verdict = ai < 30 ? 'Likely human' : ai <= 70 ? 'Mixed signals' : 'Likely AI-assisted';
  const color = ai < 30 ? '#6ee7b7' : ai <= 70 ? '#fbbf24' : '#f87171';
  return { verdict, color };
}

/** Turn a raw 0..1 model score into the same shape computeAiScore() returns. */
function fromModelScore(score01: number, metrics: ProofMetrics): AiResult {
  const ai = Math.max(1, Math.min(99, Math.round(score01 * 100)));
  const human = 100 - ai;
  const humanRatio = typeof metrics.humanTypedRatio === 'number' ? metrics.humanTypedRatio : 1;
  return { ai, human, ...bandFromAi(ai), pastedRatio: Math.max(0, Math.min(1, 1 - humanRatio)), source: 'model' };
}

const ENDPOINT = process.env.REACT_APP_AI_DETECT_URL || '/api/ai-detect';
// Must exceed the proxy's own timeout (30s) so a slow-but-succeeding score is not
// aborted here first; otherwise we'd silently downgrade to the heuristic under load.
const TIMEOUT_MS = 32000;

/**
 * Report where a score came from so degradation is VISIBLE. Without this, a detector
 * that is down/overloaded silently serves heuristic numbers and the page looks
 * healthy — the worst failure mode during beta/stress testing. Best-effort only:
 * a console signal always, plus an optional beacon if REACT_APP_AI_DETECT_TELEMETRY
 * is set. Never throws, never blocks the render.
 */
function reportOutcome(source: AiResult['source'], latencyMs: number, reason?: string): void {
  try {
    if (source !== 'model') {
      // eslint-disable-next-line no-console
      console.warn(`[aiDetector] served '${source}' score (not model)`, reason ?? '');
    }
    const url = process.env.REACT_APP_AI_DETECT_TELEMETRY;
    if (url && typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon(url, JSON.stringify({ source, latencyMs, reason, ts: Date.now() }));
    }
  } catch { /* telemetry must never break scoring */ }
}

/**
 * Score text with the real detector, falling back to the metrics heuristic.
 *
 * - No text available (Docs / old payload) → the simulated metrics score.
 * - Endpoint error/timeout                 → computeAiScore(), source 'fallback'.
 * - Success                                → the model's 0..1 score, source 'model'.
 *
 * contentHash is forwarded so the server can verify SHA-256(text) === contentHash
 * (the detector provably scores the same text that was hashed + attested) and use
 * it as a cache key so identical text is never re-scored.
 */
export async function detectAi(
  args: { text?: string; contentHash?: string; metrics: ProofMetrics },
): Promise<AiResult> {
  const { text, contentHash, metrics } = args;
  if (!text || text.trim().length === 0) {
    reportOutcome('simulated', 0, 'no text to score');
    return { ...computeAiScore(metrics), source: 'simulated' };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, contentHash }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`detector ${res.status}`);
    const data = await res.json();
    const score = typeof data.ai === 'number' ? data.ai : Number(data.score);
    if (!Number.isFinite(score)) throw new Error('detector returned no score');
    reportOutcome('model', Date.now() - started);
    return fromModelScore(score, metrics);
  } catch (e) {
    // Any failure → never break the page; degrade to the heuristic (but log it).
    reportOutcome('fallback', Date.now() - started, e instanceof Error ? e.message : String(e));
    return { ...computeAiScore(metrics), source: 'fallback' };
  } finally {
    clearTimeout(timer);
  }
}
