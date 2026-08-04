/**
 * Shared helpers for the accounts / assignments / submissions API surface.
 *
 * These tables (schools, profiles, assignments, submissions) have RLS enabled
 * with NO anon/authenticated policies, so every route here talks to Supabase
 * with the service-role key. Role-based visibility (student summary vs professor
 * detail) is enforced in application code, not RLS.
 */
const { createClient } = require('@supabase/supabase-js');
const { getServiceRoleCreds } = require('./_supabaseEnv');

function send(res, code, data) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  if (code === 204) return res.status(204).end();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(code).send(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      return resolve(req.body);
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const lc = (s) => (s == null ? '' : String(s).trim().toLowerCase());

/** Service-role Supabase client (bypasses RLS). Returns { supabase } or { error }. */
function serviceClient() {
  const { url, key, error } = getServiceRoleCreds();
  if (error) return { error };
  return { supabase: createClient(url, key, { auth: { persistSession: false } }) };
}

function bearer(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || '';
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/**
 * Resolve the caller from their Supabase access token (sent by the professor's
 * signed-in web session). Returns the linked professor profile, or null for
 * anonymous / non-professor callers.
 *
 * Identity is the auth user, NOT the email: we match the professor row by
 * `user_id` first. Username/password accounts are seeded with user_id already
 * set, so this is the normal path. We only fall back to matching by email for
 * legacy pre-seeded rows that have no user_id yet — and when we do, we link the
 * user_id so future lookups are email-independent.
 */
async function resolveProfessor(req, supabase) {
  const token = bearer(req);
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user?.id) return null;
  const uid = data.user.id;
  const email = lc(data.user.email);

  // Primary: resolve by the auth user id (decoupled from email).
  const { data: byId } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'professor')
    .eq('user_id', uid)
    .maybeSingle();
  if (byId) return byId;

  // Fallback: a legacy row pre-seeded by email with no user_id yet. Link it.
  if (!email) return null;
  const { data: byEmail } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'professor')
    .eq('email', email)
    .is('user_id', null)
    .maybeSingle();
  if (!byEmail) return null;

  await supabase.from('profiles').update({ user_id: uid }).eq('id', byEmail.id);
  byEmail.user_id = uid;
  return byEmail;
}

module.exports = { send, readJson, lc, serviceClient, bearer, resolveProfessor };
