/**
 * GET /api/debug-supabase — check Vercel env + live query to `ledger_submissions`.
 * Does not return secrets; only host + which env var names were used.
 */
const { createClient } = require('@supabase/supabase-js');
const { getSupabaseCreds, getSupabaseDebugMeta } = require('./_supabaseEnv');

function send(res, code, data) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(code).send(JSON.stringify(data, null, 2));
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return send(res, 405, { ok: false, error: 'Use GET or POST' });
  }

  const meta = getSupabaseDebugMeta();
  const { url, key, error: credsError } = getSupabaseCreds();

  const out = {
    ok: false,
    step: 'env',
    env: meta,
    message: credsError || (meta.hasUrl && meta.hasKey ? 'url+key present' : 'incomplete creds'),
  };

  if (credsError || !url || !key) {
    return send(res, 200, out);
  }

  out.step = 'client_create';
  let supabase;
  try {
    supabase = createClient(url, key, { auth: { persistSession: false } });
  } catch (e) {
    return send(res, 200, {
      ...out,
      ok: false,
      step: 'client_create',
      createError: e instanceof Error ? e.message : String(e),
    });
  }

  out.step = 'query';
  const t0 = Date.now();
  const { count, error } = await supabase
    .from('ledger_submissions')
    .select('entry_id', { count: 'exact', head: true });
  const ms = Date.now() - t0;

  if (error) {
    return send(res, 200, {
      ...out,
      ok: false,
      step: 'query',
      supabase: {
        connected: true,
        queryOk: false,
        error: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        latencyMs: ms,
      },
    });
  }

  return send(res, 200, {
    ok: true,
    step: 'ok',
    env: meta,
    supabase: {
      connected: true,
      queryOk: true,
      table: 'ledger_submissions',
      rowCount: count ?? 0,
      note: 'SELECT count (head only, no row bytes)',
      latencyMs: ms,
    },
  });
};
