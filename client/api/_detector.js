/**
 * Server-side call to the AI-text detector worker (DETECTOR_URL / DETECTOR_TOKEN —
 * the same env the /api/ai-detect proxy uses). Lives here so the submission flow can
 * score text ON THE SERVER: the number the professor sees is computed by us from the
 * text, never supplied by the client. The text is held in memory for this one request
 * and never written anywhere.
 *
 * Returns { ai: 0..1, backend } or throws. The timeout is sized for a cold start of the
 * scale-to-zero GPU worker (~30s); the caller retries from the browser on failure.
 */
const DETECTOR_TIMEOUT_MS = 55_000;

async function scoreText(text, contentHash) {
  const url = (process.env.DETECTOR_URL || '').replace(/\/+$/, '');
  if (!url) {
    const e = new Error('Detector not configured (DETECTOR_URL)');
    e.code = 'NOT_CONFIGURED';
    throw e;
  }
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.DETECTOR_TOKEN) headers.Authorization = `Bearer ${process.env.DETECTOR_TOKEN}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DETECTOR_TIMEOUT_MS);
  try {
    const r = await fetch(`${url}/detect`, {
      method: 'POST',
      headers,
      // contentHash lets the worker cache by document (identical text scored once).
      body: JSON.stringify({ text, contentHash }),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      const e = new Error(`detector HTTP ${r.status}`);
      e.status = r.status;
      throw e;
    }
    const data = await r.json();
    const raw = typeof data.ai === 'number' ? data.ai : Number(data.score);
    if (!Number.isFinite(raw)) throw new Error('detector returned no score');
    return { ai: Math.max(0, Math.min(1, raw)), backend: data.backend ?? null };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { scoreText, DETECTOR_TIMEOUT_MS };
