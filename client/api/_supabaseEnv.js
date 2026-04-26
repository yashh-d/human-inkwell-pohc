/**
 * Resolve Supabase URL + key for Vercel serverless.
 * Prefer REACT_APP_*; fall back to common names if the dashboard still uses older keys.
 */
function getSupabaseUrl() {
  return (
    process.env.REACT_APP_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    ''
  ).trim();
}

function getSupabaseKey() {
  return (
    process.env.REACT_APP_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    // Legacy: some projects only set the service role; it bypasses RLS (still valid for this API)
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ''
  ).trim();
}

function getSupabaseCreds() {
  const url = getSupabaseUrl();
  const key = getSupabaseKey();
  const error =
    !url || !key
      ? 'Server missing Supabase: set REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY (or SUPABASE_URL + SUPABASE_ANON_KEY / service role in Vercel, then redeploy).'
      : null;
  return { url, key, error };
}

/** For /api/debug-supabase — which env names are set, never secret values. */
function getSupabaseDebugMeta() {
  const urlKey = ['REACT_APP_SUPABASE_URL', 'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'].find(
    (k) => (process.env[k] || '').trim()
  );
  const keyKey = [
    'REACT_APP_SUPABASE_ANON_KEY',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ].find((k) => (process.env[k] || '').trim());
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
    hasKey: !!getSupabaseKey(),
    urlEnvSet: urlKey || null,
    keyEnvSet: keyKey || null,
    supabaseHost: host,
  };
}

module.exports = { getSupabaseCreds, getSupabaseDebugMeta };
