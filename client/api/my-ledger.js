/**
 * Vercel serverless: list `ledger_submissions` for one wallet.
 *
 * Two transports — same Supabase query, same response shape:
 *
 *   GET  /api/my-ledger?author=0x…              (unsigned; data is public on-chain)
 *   POST /api/my-ledger { message, signature, author_address }  (legacy)
 *
 * The GET path exists because users inside the World App have no Privy
 * embedded wallet — they mint via MiniKit and can't ethers.signMessage().
 * Their author_address is the public MiniKit wallet, and every submission is
 * already discoverable on Worldscan, so there's no privacy benefit to gating
 * the read-only view by signature.
 */
const { createClient } = require('@supabase/supabase-js');
const { verifyMessage, getAddress, isAddress } = require('ethers');
const { getSupabaseCreds } = require('./_supabaseEnv');

const MAX_AGE_MS = 10 * 60 * 1000;
const SELECT_COLS =
  'id, chain_id, contract_address, entry_id, author_address, transaction_hash, content_hash, human_signature_hash, world_id_nullifier, is_verified, keystroke_count, typing_speed_scaled, block_number, block_timestamp, gas_used, created_at, public_text';

function send(res, code, data) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (code === 204) return res.status(204).end();
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

async function queryRowsForAuthor(addr) {
  const { url: supabaseUrl, key: supabaseKey, error: supaErr } = getSupabaseCreds();
  if (supaErr) return { error: supaErr };
  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  const { data, error } = await supabase
    .from('ledger_submissions')
    .select(SELECT_COLS)
    .eq('author_address', addr)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return { error: error.message || 'Query failed' };
  return { rows: data || [] };
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});

  // ─── GET: unsigned author lookup ───────────────────────────────────────
  if (req.method === 'GET') {
    const author = String(req.query?.author || '').trim();
    if (!author || !isAddress(author)) {
      return send(res, 400, { error: 'Missing or invalid ?author=0x… query' });
    }
    const addr = getAddress(author).toLowerCase();
    const result = await queryRowsForAuthor(addr);
    if (result.error) {
      console.error(result.error);
      return send(res, 500, { error: result.error });
    }
    return send(res, 200, { ok: true, rows: result.rows });
  }

  // ─── POST: legacy signed read (kept for back-compat) ───────────────────
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
  const addr = getAddress(author_address).toLowerCase();
  const result = await queryRowsForAuthor(addr);
  if (result.error) {
    console.error(result.error);
    return send(res, 500, { error: result.error });
  }
  return send(res, 200, { ok: true, rows: result.rows });
};
