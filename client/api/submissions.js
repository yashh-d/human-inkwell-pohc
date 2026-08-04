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
