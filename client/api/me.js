/**
 * GET /api/me — bootstrap the professor dashboard. Resolves the caller from
 * their Supabase bearer token; returns the linked professor profile (linking
 * user_id on first login) or 401 if the caller isn't a seeded professor.
 */
const { send, serviceClient, resolveProfessor } = require('./_accounts');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });

  const { supabase, error: clientErr } = serviceClient();
  if (clientErr) return send(res, 500, { error: clientErr });

  const prof = await resolveProfessor(req, supabase);
  if (!prof) return send(res, 401, { error: 'Not a professor account' });

  let school = null;
  if (prof.school_id) {
    const { data } = await supabase
      .from('schools')
      .select('id, name')
      .eq('id', prof.school_id)
      .maybeSingle();
    school = data || null;
  }

  return send(res, 200, {
    // Note: prof.email is the internal synthetic login address — never surface
    // it. The UI shows username + the optional linked (real) email.
    profile: {
      id: prof.id,
      username: prof.username || null,
      name: prof.name,
      linked_email: prof.linked_email || null,
      role: prof.role,
      school_id: prof.school_id,
    },
    school,
  });
};
