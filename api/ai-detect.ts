import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'crypto';

/**
 * POST /api/ai-detect  { text, contentHash? }  ->  { ai: 0..1, hashVerified, backend }
 *
 * Thin, provider-agnostic proxy in front of the AI-text detector. It forwards the
 * text to the inference worker (DETECTOR_URL) and returns a single 0..1 score
 * (0 = human, 1 = AI). The frontend maps that onto the same shape computeAiScore()
 * produces, so the backend model is invisible to the client — swapping it is a
 * change to DETECTOR_URL / the worker's own DETECTOR_BACKEND, nothing here.
 *
 * Integrity: if contentHash is supplied we verify SHA-256(text) === contentHash,
 * so the detector provably scores the same text that was hashed + attested
 * on-chain. A mismatch is reported (hashVerified:false) but not rejected — Docs
 * and whitespace-normalized captures can legitimately differ.
 *
 * Config (Vercel env):
 *   DETECTOR_URL     e.g. https://detector.internal/detect   (the Python worker)
 *   DETECTOR_TOKEN   bearer token the worker checks (optional but recommended)
 *
 * The worker chooses the actual model. NOTE: the Pangram OSS checkpoint is
 * CC-BY-NC-SA (non-commercial) — fine for dev/research, but do not point a
 * production/commercial DETECTOR_URL at it without a license/grant from Pangram.
 * Binoculars (BSD-3) or your own trained model are the commercial-clean backends.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text, contentHash } = (req.body || {}) as { text?: string; contentHash?: string };
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return res.status(400).json({ error: 'Provide non-empty text.' });
  }

  const detectorUrl = (process.env.DETECTOR_URL || '').replace(/\/+$/, '');
  if (!detectorUrl) {
    // No detector wired up — tell the client to fall back to the heuristic.
    return res.status(503).json({ error: 'Detector not configured (DETECTOR_URL).' });
  }

  // Integrity check — same text that contentHash attests?
  let hashVerified: boolean | null = null;
  if (contentHash) {
    const computed = createHash('sha256').update(text, 'utf8').digest('hex');
    hashVerified = computed.toLowerCase() === String(contentHash).toLowerCase();
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.DETECTOR_TOKEN) headers.Authorization = `Bearer ${process.env.DETECTOR_TOKEN}`;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    const r = await fetch(`${detectorUrl}/detect`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text }),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));

    if (!r.ok) {
      const detail = (await r.text().catch(() => '')).slice(0, 200);
      return res.status(502).json({ error: `detector HTTP ${r.status}`, detail });
    }
    const data = await r.json();
    // Accept {ai} or {score}; clamp to [0,1].
    const raw = typeof data.ai === 'number' ? data.ai : Number(data.score);
    if (!Number.isFinite(raw)) return res.status(502).json({ error: 'detector returned no score' });
    const ai = Math.max(0, Math.min(1, raw));

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ai, hashVerified, backend: data.backend ?? null });
  } catch (e) {
    console.error('ai-detect failed:', e);
    return res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
