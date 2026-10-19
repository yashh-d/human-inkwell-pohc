/**
 * POST /api/submission-ai — run the AI-text detector for a just-created submission
 * and store the result on its row. Called by the student's browser right after
 * /api/submissions succeeds, fire-and-forget: the student never waits on it and never
 * sees the number — it is a professor-side artifact.
 *
 * Why the SERVER scores: the stored submission deliberately carries no text (privacy),
 * so this is the one moment the text exists (in the student's tab). We take it here,
 * score it against the same worker the proxy uses, write ai_score + detail.aiDetection,
 * and discard it. We never trust a client-supplied score — a student could otherwise
 * POST their own number.
 *
 * Integrity: we record whether SHA-256(text) matches the row's content_hash (the
 * hash attested on-chain). A mismatch is recorded, not rejected — Docs and
 * whitespace-normalized captures can legitimately differ (same policy as the proxy).
 *
 * Cost guard: scores ONCE per submission. A row that already has a real model result
 * returns it without touching the GPU, so this unauthenticated route can't be used to
 * run up GPU time (same no-login posture as /api/submission-attach).
 *
 * Body: { slug, text }
 */
const { createHash } = require('crypto');
const { send, readJson, serviceClient } = require('./_accounts');
const { scoreText } = require('./_detector');

const MAX_TEXT_CHARS = 200_000; // matches the proxy / worker cap
const pct = (ai01) => Math.max(0, Math.min(100, Math.round(ai01 * 100)));

const handler = async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });

  let body;
  try {
    body = await readJson(req);
  } catch {
    return send(res, 400, { error: 'Invalid JSON' });
  }

  const slug = String((body && body.slug) || '').trim();
  const text = body && typeof body.text === 'string' ? body.text : '';
  if (!slug) return send(res, 400, { error: 'Missing slug' });
  if (!text.trim()) return send(res, 400, { error: 'Missing text' });
  if (text.length > MAX_TEXT_CHARS) return send(res, 413, { error: 'Text too large' });

  const { supabase, error: clientErr } = serviceClient();
  if (clientErr) return send(res, 500, { error: clientErr });

  const { data: row, error: readErr } = await supabase
    .from('submissions')
    .select('id, ai_score, content_hash, detail')
    .eq('share_slug', slug)
    .maybeSingle();
  if (readErr) return send(res, 500, { error: readErr.message || 'Lookup failed' });
  if (!row) return send(res, 404, { error: 'Submission not found' });

  // Already scored by the model → return it; never re-spend GPU on the same row.
  const prior = row.detail && row.detail.aiDetection;
  if (prior && prior.source === 'model' && typeof prior.ai === 'number') {
    return send(res, 200, { ok: true, ai: prior.ai, already: true });
  }

  const computed = createHash('sha256').update(text, 'utf8').digest('hex');
  const hashVerified = row.content_hash
    ? computed.toLowerCase() === String(row.content_hash).toLowerCase()
    : null;

  let scored;
  try {
    scored = await scoreText(text, row.content_hash || undefined);
  } catch (e) {
    // 503 so the browser knows to retry (a cold-start timeout lands here).
    console.error('submission-ai detector failed:', e && e.message);
    return send(res, 503, { error: 'Detector unavailable, retry', retry: true });
  }

  const ai = pct(scored.ai);
  const aiDetection = {
    ai,
    human: 100 - ai,
    source: 'model',
    at: new Date().toISOString(),
    hashVerified,
    backend: scored.backend,
  };

  const { error: upErr } = await supabase
    .from('submissions')
    .update({ ai_score: ai, detail: { ...(row.detail || {}), aiDetection } })
    .eq('id', row.id);
  if (upErr) return send(res, 500, { error: upErr.message || 'Update failed' });

  return send(res, 200, { ok: true, ai, hashVerified });
};

// Sized for one cold start of the scale-to-zero GPU worker. The authoritative
// setting is the `functions` entry in vercel.json; this mirrors it for the module.
handler.config = { maxDuration: 60 };

module.exports = handler;
