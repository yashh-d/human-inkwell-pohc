/**
 * Vercel serverless: list `ledger_submissions` for a wallet (wallet-signed list message).
 * Message format in sync with `src/ledgerSupabase.ts` (fetchMyLedgerRows).
 */
const { createClient } = require('@supabase/supabase-js');
const { verifyMessage, getAddress } = require('ethers');
const { getSupabaseCreds } = require('./_supabaseEnv');

const MAX_AGE_MS = 10 * 60 * 1000;

function send(res, code, data) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (code === 204) {
    return res.status(204).end();
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(code).send(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const s = Buffer.concat(chunks).toString('utf8') || '{}';
        resolve(JSON.parse(s));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    return send(res, 204, {});
  }
  if (req.method !== 'POST') {
    return send(res, 405, { error: 'Method not allowed' });
  }
  let body;
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    body = req.body;
  } else {
    try {
      body = await readJson(req);
    } catch {
      return send(res, 400, { error: 'Invalid JSON' });
    }
  }
  const { message, signature, author_address } = body;
  if (!message || !signature || !author_address) {
    return send(res, 400, { error: 'Missing message, signature, or author_address' });
  }
  let recovered;
  try {
    recovered = verifyMessage(message, signature);
  } catch {
    return send(res, 401, { error: 'Invalid signature' });
  }
  if (getAddress(recovered) !== getAddress(author_address)) {
    return send(res, 401, { error: 'Invalid signature for author' });
  }
  if (!String(message).startsWith('Human Inkwell list submissions\n')) {
    return send(res, 400, { error: 'Invalid message' });
  }
  const m = String(message).match(/time:(\d+)/);
  if (!m) {
    return send(res, 400, { error: 'Invalid time in message' });
  }
  const t = parseInt(m[1], 10);
  if (Date.now() - t > MAX_AGE_MS) {
    return send(res, 401, { error: 'Message expired' });
  }

  const { url: supabaseUrl, key: supabaseKey, error: supaErr } = getSupabaseCreds();
  if (supaErr) {
    return send(res, 500, { error: supaErr });
  }

  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  const addr = getAddress(author_address).toLowerCase();
  const { data, error } = await supabase
    .from('ledger_submissions')
    .select(
      'id, chain_id, contract_address, entry_id, author_address, transaction_hash, content_hash, human_signature_hash, world_id_nullifier, is_verified, keystroke_count, typing_speed_scaled, block_number, block_timestamp, gas_used, created_at, public_text'
    )
    .eq('author_address', addr)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error(error);
    return send(res, 500, { error: error.message || 'Query failed' });
  }
  return send(res, 200, { ok: true, rows: data || [] });
};
