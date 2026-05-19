/**
 * Resolve Supabase URL + keys for Vercel serverless.
 *
 * Two flavors:
 *   - getSupabaseCreds()        → anon key, RLS-respecting. Use for public reads (feed).
 *   - getSupabaseAdminCreds()   → service role key, bypasses RLS. Use for writes and
 *                                 wallet-signed private reads (my-ledger, ledger-onchain).
 *
 * The service role key MUST be set in Vercel as SUPABASE_SERVICE_ROLE_KEY. It is
 * server-side only and never reaches the browser bundle.
 */
function getSupabaseUrl() {
  return (
    process.env.REACT_APP_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    ''
  ).trim();
}

function getAnonKey() {
  return (
    process.env.REACT_APP_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    ''
  ).trim();
}

function getServiceRoleKey() {
  return (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
}

/** Anon creds: subject to RLS. Returns `error` string if env is missing. */
function getSupabaseCreds() {
  const url = getSupabaseUrl();
  const key = getAnonKey();
  const error =
    !url || !key
      ? 'Server missing Supabase anon config: set REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY in Vercel, then redeploy.'
      : null;
  return { url, key, error };
}

/** Admin creds: bypass RLS. Use ONLY in server routes that already authenticate the
 *  request (onchain verification, wallet signature, etc.). */
function getSupabaseAdminCreds() {
  const url = getSupabaseUrl();
  const key = getServiceRoleKey();
  const error =
    !url || !key
      ? 'Server missing Supabase admin config: set SUPABASE_SERVICE_ROLE_KEY in Vercel (Settings → API → service_role), then redeploy.'
      : null;
  return { url, key, error };
}

/** For /api/debug-supabase — which env names are set, never secret values. */
function getSupabaseDebugMeta() {
  const urlKey = ['REACT_APP_SUPABASE_URL', 'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'].find(
    (k) => (process.env[k] || '').trim()
  );
  const anonKey = ['REACT_APP_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY'].find(
    (k) => (process.env[k] || '').trim()
  );
  const url = getSupabaseUrl();
  let host = null;
  if (url) {
    try {
      host = new URL(url).host;
    } catch {
      host = 'invalid_url';
    }
  }
  return {
    hasUrl: !!url,
    hasAnonKey: !!getAnonKey(),
    hasServiceRoleKey: !!getServiceRoleKey(),
    urlEnvSet: urlKey || null,
    anonEnvSet: anonKey || null,
    serviceRoleEnvSet: getServiceRoleKey() ? 'SUPABASE_SERVICE_ROLE_KEY' : null,
    supabaseHost: host,
  };
}

module.exports = {
  getSupabaseCreds,
  getSupabaseAdminCreds,
  getSupabaseDebugMeta,
};
