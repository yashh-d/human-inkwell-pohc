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
const { send, readJson, serviceClient, resolveProfessor } = require('./_accounts');
const { scoreAndStore, MAX_TEXT_CHARS } = require('./_scoreSubmission');

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
    .select('id, ai_score, content_hash, detail, pending_text')
    .eq('share_slug', slug)
    .maybeSingle();
  if (readErr) return send(res, 500, { error: readErr.message || 'Lookup failed' });
  if (!row) return send(res, 404, { error: 'Submission not found' });

  // scoreAndStore handles the model result, the hash check, clearing any retained
  // pending_text, and the idempotent "already scored" case in one place.
  let result;
  try {
    result = await scoreAndStore(supabase, row, text);
  } catch (e) {
    console.error('submission-ai detector failed:', e && e.message);
    return send(res, 503, { error: 'Detector unavailable, retry', retry: true });
  }
  return send(res, 200, { ok: true, ai: result.ai ?? null, hashVerified: result.hashVerified ?? null, already: !!result.already });
};

// Sized for one cold start of the scale-to-zero GPU worker (mirrors vercel.json).
handler.config = { maxDuration: 60 };

module.exports = handler;
