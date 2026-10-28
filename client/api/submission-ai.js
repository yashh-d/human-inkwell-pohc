/**
 * POST /api/submission-ai — score a submission's text with the AI-text detector and
 * store the result on its row. PROFESSOR-AUTHENTICATED.
 *
 * Two uses, one route:
 *  - Retroactive: a professor viewing /s/<slug> pastes the essay the student handed
 *    in (the document-check box) and runs the AI check. Submissions published before
 *    server-side scoring existed — or whose text was purged — get a real model score
 *    this way, since the professor holds the text the system no longer does.
 *  - It is NOT on the student publish path: new submissions are scored server-side
 *    inside /api/submissions (scoreAfterResponse) the moment they're created.
 *
 * Why auth: this writes an AI-probability score — effectively an accusation. Left
 * open, anyone could POST a slug + AI text and brand a real student. So only a
 * signed-in professor may call it (same gate as /api/submission, resolveProfessor).
 *
 * We never trust a client-supplied number: the text is scored server-side against the
 * detector worker, used only in this function's memory, and never stored. We record
 * whether SHA-256(text) matches the attested content_hash (a mismatch is reported,
 * not rejected — Docs / whitespace-normalized captures legitimately differ).
 *
 * Cost guard: scores ONCE per row — a row that already has a model result returns it
 * without touching the GPU.
 *
 * Body: { slug, text }   Auth: Bearer <professor Supabase access token>
 */
const { createHash } = require('crypto');
const { send, readJson, serviceClient, resolveProfessor } = require('./_accounts');
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

  // Gate: only a signed-in professor may write an AI score onto a submission.
  const professor = await resolveProfessor(req, supabase);
  if (!professor) return send(res, 401, { error: 'Professor sign-in required' });

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
    return send(res, 200, { ok: true, ai: prior.ai, hashVerified: prior.hashVerified ?? null, already: true });
  }

  const computed = createHash('sha256').update(text, 'utf8').digest('hex');
  const hashVerified = row.content_hash
    ? computed.toLowerCase() === String(row.content_hash).toLowerCase()
    : null;

  let scored;
  try {
    scored = await scoreText(text, row.content_hash || undefined);
  } catch (e) {
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
    scoredBy: 'professor', // retroactive: text supplied by the professor, not captured
  };

  const { error: upErr } = await supabase
    .from('submissions')
    .update({ ai_score: ai, detail: { ...(row.detail || {}), aiDetection, aiCheck: 'queued' } })
    .eq('id', row.id);
  if (upErr) return send(res, 500, { error: upErr.message || 'Update failed' });

  return send(res, 200, { ok: true, ai, hashVerified });
};

// Sized for one cold start of the scale-to-zero GPU worker (mirrors vercel.json).
handler.config = { maxDuration: 60 };

module.exports = handler;
