/**
 * The single place a submission's text is scored by the model and the result stored —
 * and the ONLY place the retained text (submissions.pending_text) is purged.
 *
 * Contract: pending_text is kept on the row until scoreAndStore succeeds. If the
 * detector throws (cold start / down), we propagate the error and LEAVE pending_text
 * in place, so a later trigger (a professor opening the report, the submit-time call,
 * or the sweep) can retry from the retained text. A student's work is never discarded
 * before it has a score.
 */
const { createHash } = require('crypto');
const { scoreText } = require('./_detector');

const MAX_TEXT_CHARS = 200_000;
const pct = (x) => Math.max(0, Math.min(100, Math.round(x * 100)));

/**
 * Score `text` for `row` ({ id, content_hash, detail, pending_text }) and store the
 * model result, then clear pending_text. Idempotent: a row that already has a model
 * result is left as-is (and its text cleared) without touching the GPU.
 * Throws on detector/update failure WITHOUT clearing pending_text (so it can retry).
 */
async function scoreAndStore(supabase, row, text) {
  const t = typeof text === 'string' ? text : '';
  if (!t.trim()) return { skipped: 'no-text' };
  if (t.length > MAX_TEXT_CHARS) return { skipped: 'too-large' };

  const prior = row.detail && row.detail.aiDetection;
  if (prior && prior.source === 'model' && typeof prior.ai === 'number') {
    if (row.pending_text != null) {
      await supabase.from('submissions').update({ pending_text: null }).eq('id', row.id);
    }
    return { ai: prior.ai, hashVerified: prior.hashVerified ?? null, already: true };
  }

  const contentHash = row.content_hash || undefined;
  const computed = createHash('sha256').update(t, 'utf8').digest('hex');
  const hashVerified = contentHash ? computed.toLowerCase() === String(contentHash).toLowerCase() : null;

  // Throws on failure -> caller leaves pending_text for a retry.
  const scored = await scoreText(t, contentHash);
  const ai = pct(scored.ai);
  const aiDetection = {
    ai, human: 100 - ai, source: 'model', at: new Date().toISOString(), hashVerified, backend: scored.backend,
  };

  const { error } = await supabase
    .from('submissions')
    .update({ ai_score: ai, detail: { ...(row.detail || {}), aiDetection, aiCheck: 'queued' }, pending_text: null })
    .eq('id', row.id);
  if (error) throw new Error(error.message || 'update failed');
  return { ai, hashVerified };
}

/** Self-healing retry: read a row by slug and score from its retained pending_text. */
async function scorePendingBySlug(supabase, slug) {
  const { data: row, error } = await supabase
    .from('submissions')
    .select('id, content_hash, detail, pending_text')
    .eq('share_slug', slug)
    .maybeSingle();
  if (error || !row) return { skipped: 'not-found' };
  if (!row.pending_text) return { skipped: 'nothing-pending' };
  return scoreAndStore(supabase, row, row.pending_text);
}

module.exports = { scoreAndStore, scorePendingBySlug, MAX_TEXT_CHARS };
