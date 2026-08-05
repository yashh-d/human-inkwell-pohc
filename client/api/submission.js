/**
 * GET /api/submission?slug=<share_slug> — fetch one submission for the /s/<slug>
 * report page.
 *
 * Visibility:
 *   • Anyone with the link gets the SUMMARY (process/AI/integrity scores + band).
 *   • A signed-in PROFESSOR (valid Supabase bearer token resolving to a
 *     role='professor' profile) additionally gets the DETAIL blob (full proof)
 *     and the submitter's identity. Per the product decision, ANY logged-in
 *     professor may see detail — not only the assigned one.
 *
 * Students never see the detail — even for their own submission.
 */
const { send, lc, serviceClient, resolveProfessor } = require('./_accounts');

/** Pull the Google Docs document id out of the captured proof URL (…/d/<id>/…). */
function docIdFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const slug = (url.searchParams.get('slug') || '').trim();
  if (!slug) return send(res, 400, { error: 'Missing slug' });

  const { supabase, error: clientErr } = serviceClient();
  if (clientErr) return send(res, 500, { error: clientErr });

  const { data: sub, error } = await supabase
    .from('submissions')
    .select(
      'id, share_slug, authorship_score, ai_score, integrity_score, band, ' +
        'assignment_id, published_at, chain_id, contract_address, entry_id, ' +
        'content_hash, transaction_hash, student_email, student_name, detail',
    )
    .eq('share_slug', slug)
    .maybeSingle();

  if (error) {
    console.error('submission fetch', error);
    return send(res, 500, { error: error.message || 'Fetch failed' });
  }
  if (!sub) return send(res, 404, { error: 'Not found' });

  const professor = await resolveProfessor(req, supabase);

  // Always-safe summary payload.
  const payload = {
    slug: sub.share_slug,
    summary: {
      authorship_score: sub.authorship_score,
      ai_score: sub.ai_score,
      integrity_score: sub.integrity_score,
      band: sub.band,
    },
    published_at: sub.published_at,
    onchain: {
      chain_id: sub.chain_id,
      contract_address: sub.contract_address,
      entry_id: sub.entry_id,
      content_hash: sub.content_hash,
      transaction_hash: sub.transaction_hash,
    },
    viewer: professor ? 'professor' : 'public',
  };

  if (professor) {
    // Professor-only: the full proof (drives the detailed report) + who submitted.
    payload.detail = sub.detail || null;
    payload.student = { email: sub.student_email, name: sub.student_name };

    if (sub.assignment_id) {
      const { data: asg } = await supabase
        .from('assignments')
        .select('id, title, join_code')
        .eq('id', sub.assignment_id)
        .maybeSingle();
      payload.assignment = asg || null;
    }

    // Professor-only: the actual text behind each amber "pasted in" cliff/bar in
    // the revision charts. Stored in paste_events (external + cited pastes only —
    // internal cut-and-move within the doc is never persisted). Joined by the doc
    // and the submitter's email, both carried in the proof; scoped to this student
    // so one professor never sees another student's pasted content.
    const proof = sub.detail || {};
    const docId = docIdFromUrl(proof.url);
    const email = sub.student_email || lc(proof.email) || null;
    if (docId || email) {
      let q = supabase
        .from('paste_events')
        .select('char_count, content, origin, pasted_at, is_large, truncated')
        .order('pasted_at', { ascending: true });
      if (docId) q = q.eq('doc_id', docId);
      if (email) q = q.ilike('author_email', email); // case-insensitive exact match
      const { data: pastes, error: pErr } = await q;
      if (pErr) console.error('paste_events fetch', pErr);
      payload.pasteEvents = (pastes || []).map((p) => ({
        charCount: p.char_count,
        content: p.content,
        origin: p.origin,
        pastedAt: p.pasted_at ? new Date(p.pasted_at).getTime() : null,
        isLarge: !!p.is_large,
        truncated: !!p.truncated,
      }));
    }
  }

  return send(res, 200, payload);
};
