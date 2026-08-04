/**
 * GET /api/directory — the public browse tree students use to submit:
 * schools → professors → assignments (ids + titles only). No scores, no
 * join_codes, no emails are exposed here. This is the only place the anon
 * surface can see professors/assignments, and it is read-only + minimal.
 */
const { send, serviceClient } = require('./_accounts');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });

  const { supabase, error: clientErr } = serviceClient();
  if (clientErr) return send(res, 500, { error: clientErr });

  const [{ data: schools }, { data: profs }, { data: asgs }] = await Promise.all([
    supabase.from('schools').select('id, name').order('name'),
    supabase.from('profiles').select('id, name, school_id').eq('role', 'professor'),
    supabase.from('assignments').select('id, title, professor_id').order('created_at', { ascending: false }),
  ]);

  const asgByProf = {};
  for (const a of asgs || []) {
    (asgByProf[a.professor_id] ||= []).push({ id: a.id, title: a.title });
  }
  const profsBySchool = {};
  for (const p of profs || []) {
    const key = p.school_id || 'unaffiliated';
    (profsBySchool[key] ||= []).push({
      id: p.id,
      name: p.name || 'Professor',
      assignments: asgByProf[p.id] || [],
    });
  }

  const tree = (schools || []).map((s) => ({
    id: s.id,
    name: s.name,
    professors: profsBySchool[s.id] || [],
  }));
  if (profsBySchool.unaffiliated) {
    tree.push({ id: null, name: 'Other', professors: profsBySchool.unaffiliated });
  }

  return send(res, 200, { schools: tree });
};
