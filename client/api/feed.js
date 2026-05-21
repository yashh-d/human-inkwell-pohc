/**
 * Public read: World-ID–verified ledger rows (is_verified = true), newest first.
 * No secrets in response; uses same Supabase creds as other /api/* routes.
 */
const { createClient } = require('@supabase/supabase-js');
const { getSupabaseCreds } = require('./_supabaseEnv');

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

function sendJson(res, code, data) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(code).send(JSON.stringify(data));
}

function parseLimit(raw) {
  const n = parseInt(String(raw || ''), 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.status(204).end();
  }
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  const limit = parseLimit(req.query?.limit);

  const { url: supabaseUrl, key: supabaseKey, error: supaErr } = getSupabaseCreds();
  if (supaErr) {
    return sendJson(res, 500, { error: supaErr, rows: [] });
  }

  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  const { data, error } = await supabase
    .from('ledger_submissions')
    .select(
      'id, chain_id, contract_address, entry_id, author_address, transaction_hash, content_hash, human_signature_hash, world_id_nullifier, is_verified, keystroke_count, typing_speed_scaled, block_number, block_timestamp, gas_used, created_at, public_text'
    )
    .eq('is_verified', true)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error(error);
    return sendJson(res, 500, { error: error.message || 'Query failed', rows: [] });
  }
  return sendJson(res, 200, { ok: true, rows: data || [] });
};
