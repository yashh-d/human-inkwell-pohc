/**
 * POST /api/submission-attach — attach a just-published submission to an
 * assignment, either by assignment_id (picked from the directory) or by
 * join_code (typed in). No login required: the student isn't a web account, and
 * attaching only routes an existing submission into a roster.
 *
 * Body: { slug, assignment_id? , join_code? }
 */
const { send, readJson, serviceClient } = require('./_accounts');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });

  let body;
  try {
    body = await readJson(req);
  } catch {
    return send(res, 400, { error: 'Invalid JSON' });
  }

  const slug = (body.slug || '').trim();
  const assignmentId = (body.assignment_id || '').trim();
  const joinCode = (body.join_code || '').trim().toUpperCase();
  if (!slug) return send(res, 400, { error: 'Missing slug' });
  if (!assignmentId && !joinCode) return send(res, 400, { error: 'Provide an assignment or a join code' });

  const { supabase, error: clientErr } = serviceClient();
  if (clientErr) return send(res, 500, { error: clientErr });

  let q = supabase.from('assignments').select('id, title');
  q = assignmentId ? q.eq('id', assignmentId) : q.eq('join_code', joinCode);
  const { data: asg } = await q.maybeSingle();
  if (!asg) return send(res, 404, { error: 'Assignment not found' });

  const { data: updated, error } = await supabase
    .from('submissions')
    .update({ assignment_id: asg.id })
    .eq('share_slug', slug)
    .select('share_slug')
    .maybeSingle();
  if (error) return send(res, 500, { error: error.message || 'Attach failed' });
  if (!updated) return send(res, 404, { error: 'Submission not found' });

  return send(res, 200, { ok: true, assignment: { id: asg.id, title: asg.title } });
};
