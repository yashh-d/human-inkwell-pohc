/**
 * POST /api/submissions — create a server-stored submission when a student
 * publishes. Stores a public SUMMARY (process/AI/integrity scores + band) and a
 * professor-only DETAIL blob (the full proof + evidence), plus the on-chain refs.
 * Returns the share_slug so the student gets a link, and echoes the summary.
 *
 * Identity: the student's Google email is carried in the proof (stamped by the
 * extension). We upsert a role='student' profile by that email so the same
 * person accumulates a durable account without ever logging into the web app.
 *
 * Access: writes with the service-role key (these tables deny the anon role).
 */
const { send, readJson, lc, serviceClient } = require('./_accounts');
const { waitUntil } = require('@vercel/functions');
const { createHash } = require('crypto');
const { scoreText } = require('./_detector');

const MAX_TEXT_CHARS = 200_000; // matches the detector proxy / worker cap

/**
 * Runs AFTER the response has been sent (via waitUntil), so the student never waits
 * and closing the tab cannot lose the result — the earlier browser-side fire-and-
 * forget did exactly that. The text lives only in this function's memory for one
 * request: it is never written to the row, and the stored proof carries none.
 * Records whether SHA-256(text) matched the attested content_hash (a mismatch is
 * recorded, not rejected — Docs / whitespace-normalized captures can differ).
 */
async function scoreAfterResponse(supabase, slug, text, contentHash) {
  try {
    const computed = createHash('sha256').update(text, 'utf8').digest('hex');
    const hashVerified = contentHash ? computed.toLowerCase() === String(contentHash).toLowerCase() : null;
    const scored = await scoreText(text, contentHash || undefined);
    const ai = Math.max(0, Math.min(100, Math.round(scored.ai * 100)));
    const aiDetection = {
      ai, human: 100 - ai, source: 'model', at: new Date().toISOString(), hashVerified, backend: scored.backend,
    };
    const { data: cur } = await supabase.from('submissions').select('detail').eq('share_slug', slug).maybeSingle();
    const { error } = await supabase
      .from('submissions')
      .update({ ai_score: ai, detail: { ...((cur && cur.detail) || {}), aiDetection } })
      .eq('share_slug', slug);
    if (error) console.error('post-submit AI check: update failed:', error.message);
  } catch (e) {
    // Never log the text. The row keeps aiCheck='queued'; the report shows it as incomplete.
    console.error('post-submit AI check failed:', e && e.message);
  }
}

const clampScore = (n) => {
  if (n == null || Number.isNaN(Number(n))) return null;
  return Math.max(0, Math.min(100, Math.round(Number(n))));
};

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });

  let body;
  try {
    body = await readJson(req);
  } catch {
    return send(res, 400, { error: 'Invalid JSON' });
  }

  const {
    proof,
    // Raw text, top-level on purpose: NOT part of `proof` (which is what gets
    // stored). Used once to score the submission after responding, then dropped.
    text,
    summary = {},
    student_email,
    student_name,
    chain_id,
    contract_address,
    entry_id,
    content_hash,
    transaction_hash,
  } = body || {};

  if (!proof || typeof proof !== 'object') {
    return send(res, 400, { error: 'Missing proof' });
  }

  const authorship_score = clampScore(summary.authorship_score);
  const ai_score = clampScore(summary.ai_score);
  const integrity_score = clampScore(summary.integrity_score);
  const band = ['green', 'yellow', 'red'].includes(summary.band) ? summary.band : null;

  const email = lc(student_email || proof.email);

  const { supabase, error: clientErr } = serviceClient();
  if (clientErr) return send(res, 500, { error: clientErr });

  // Upsert a durable student profile keyed by email (best-effort — a missing
  // email still yields a standalone submission).
  let studentId = null;
  if (email) {
    const wallet = proof.author_address ? lc(proof.author_address) : null;
    const { data: existing } = await supabase
      .from('profiles')
      .select('id')
      .eq('role', 'student')
      .eq('email', email)
      .maybeSingle();
    if (existing) {
      studentId = existing.id;
      if (student_name || wallet) {
        await supabase
          .from('profiles')
          .update({ name: student_name || undefined, wallet_address: wallet || undefined })
          .eq('id', existing.id);
      }
    } else {
      const { data: created, error: insErr } = await supabase
        .from('profiles')
        .insert({ role: 'student', email, name: student_name || null, wallet_address: wallet })
        .select('id')
        .single();
      if (!insErr && created) studentId = created.id;
    }
  }

  const row = {
    student_email: email || null,
    student_id: studentId,
    student_name: student_name || null,
    authorship_score,
    ai_score,
    integrity_score,
    band,
    detail: proof,
    chain_id: chain_id != null ? Number(chain_id) : null,
    contract_address: contract_address ? lc(contract_address) : null,
    entry_id: entry_id != null ? Number(entry_id) : null,
    content_hash: content_hash || proof.contentHash || null,
    transaction_hash: transaction_hash ? lc(transaction_hash) : null,
  };

  const { data, error } = await supabase
    .from('submissions')
    .insert(row)
    .select('share_slug, authorship_score, ai_score, integrity_score, band')
    .single();

  if (error) {
    console.error('submissions insert', error);
    return send(res, 500, { error: error.message || 'Insert failed' });
  }

  // Score on the server after the response goes out — see scoreAfterResponse.
  if (typeof text === 'string' && text.trim() && text.length <= MAX_TEXT_CHARS) {
    waitUntil(scoreAfterResponse(supabase, data.share_slug, text, row.content_hash));
  }

  return send(res, 200, {
    ok: true,
    share_slug: data.share_slug,
    summary: {
      authorship_score: data.authorship_score,
      ai_score: data.ai_score,
      integrity_score: data.integrity_score,
      band: data.band,
    },
  });
};
