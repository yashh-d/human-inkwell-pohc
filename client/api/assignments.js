/**
 * /api/assignments — professor-owned assignment buckets. Requires a professor
 * bearer token.
 *   GET               → list the caller's assignments (+ submission counts)
 *   POST {title}      → create an assignment (join_code auto-generated)
 *   GET ?id=<id>      → the roster: the assignment + its submissions (summary rows)
 */
const { send, readJson, serviceClient, resolveProfessor } = require('./_accounts');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});

  const { supabase, error: clientErr } = serviceClient();
  if (clientErr) return send(res, 500, { error: clientErr });

  const prof = await resolveProfessor(req, supabase);
  if (!prof) return send(res, 401, { error: 'Not a professor account' });

  // --- Create ---
  if (req.method === 'POST') {
    let body;
    try {
      body = await readJson(req);
    } catch {
      return send(res, 400, { error: 'Invalid JSON' });
    }
    const title = (body.title || '').trim();
    if (!title) return send(res, 400, { error: 'Missing title' });

    const { data, error } = await supabase
      .from('assignments')
      .insert({ professor_id: prof.id, school_id: prof.school_id || null, title })
      .select('id, title, join_code, created_at')
      .single();
    if (error) {
      console.error('assignments insert', error);
      return send(res, 500, { error: error.message || 'Create failed' });
    }
    return send(res, 200, { ok: true, assignment: { ...data, submission_count: 0 } });
  }

  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const id = (url.searchParams.get('id') || '').trim();

  // --- Roster for one assignment ---
  if (id) {
    const { data: asg } = await supabase
      .from('assignments')
      .select('id, title, join_code, created_at, professor_id')
      .eq('id', id)
      .maybeSingle();
    if (!asg || asg.professor_id !== prof.id) return send(res, 404, { error: 'Assignment not found' });

    const { data: subs, error: subErr } = await supabase
      .from('submissions')
      .select('share_slug, student_email, student_name, authorship_score, ai_score, integrity_score, band, published_at')
      .eq('assignment_id', id)
      .order('published_at', { ascending: false });
    if (subErr) return send(res, 500, { error: subErr.message || 'Roster fetch failed' });

    return send(res, 200, {
      assignment: { id: asg.id, title: asg.title, join_code: asg.join_code, created_at: asg.created_at },
      submissions: subs || [],
    });
  }

  // --- List the professor's assignments (+ counts) ---
  const { data: list, error } = await supabase
    .from('assignments')
    .select('id, title, join_code, created_at')
    .eq('professor_id', prof.id)
    .order('created_at', { ascending: false });
  if (error) return send(res, 500, { error: error.message || 'List failed' });

  const ids = (list || []).map((a) => a.id);
  const counts = {};
  if (ids.length) {
    const { data: subs } = await supabase
      .from('submissions')
      .select('assignment_id')
      .in('assignment_id', ids);
    for (const s of subs || []) counts[s.assignment_id] = (counts[s.assignment_id] || 0) + 1;
  }

  return send(res, 200, {
    assignments: (list || []).map((a) => ({ ...a, submission_count: counts[a.id] || 0 })),
  });
};
