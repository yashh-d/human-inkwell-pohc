/**
 * PATCH /api/professor-account — let a signed-in professor edit their own
 * account details. Identity comes from the bearer token (resolveProfessor), so a
 * professor can only ever change their own row.
 *
 * Body (any subset):
 *   { name?: string, linked_email?: string|null }
 *
 * • name         — display name (what students/roster show).
 * • linked_email — an OPTIONAL real email for records / future easy login. This
 *                  is NOT the login identity and does NOT change the username or
 *                  the synthetic Supabase Auth address. Pass null/"" to clear.
 *
 * Password changes happen client-side via Supabase Auth (updateUser), not here.
 */
const { send, readJson, serviceClient, resolveProfessor, lc } = require('./_accounts');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method !== 'PATCH') return send(res, 405, { error: 'Method not allowed' });

  const { supabase, error: clientErr } = serviceClient();
  if (clientErr) return send(res, 500, { error: clientErr });

  const prof = await resolveProfessor(req, supabase);
  if (!prof) return send(res, 401, { error: 'Not a professor account' });

  let body;
  try {
    body = await readJson(req);
  } catch {
    return send(res, 400, { error: 'Invalid JSON' });
  }

  const patch = {};

  if (typeof body.name === 'string') {
    const name = body.name.trim();
    if (!name) return send(res, 400, { error: 'Name cannot be empty' });
    patch.name = name;
  }

  if ('linked_email' in body) {
    const raw = body.linked_email;
    if (raw == null || String(raw).trim() === '') {
      patch.linked_email = null;
    } else {
      const email = lc(raw);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return send(res, 400, { error: 'That does not look like a valid email.' });
      }
      patch.linked_email = email;
    }
  }

  if (Object.keys(patch).length === 0) {
    return send(res, 400, { error: 'Nothing to update' });
  }

  const { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', prof.id)
    .select('id, username, name, linked_email, role, school_id')
    .single();
  if (error) {
    console.error('professor-account update', error);
    return send(res, 500, { error: error.message || 'Update failed' });
  }

  return send(res, 200, { ok: true, profile: data });
};
