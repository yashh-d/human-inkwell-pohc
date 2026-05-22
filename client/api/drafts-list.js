/**
 * List drafts for one wallet from `hi_content_drafts`.
 *
 *   GET  /api/drafts-list?author=0x…   ← MiniKit-friendly (no ECDSA needed)
 *   POST /api/drafts-list { author_address }   ← back-compat
 *
 * No signature required. The wallet address is a public on-chain identifier
 * and drafts are user-owned ephemeral text — anyone with the Supabase anon
 * key (already shipped in the bundle) could enumerate by address anyway. The
 * earlier "signed message" gating added no real security and broke MiniKit
 * Safe wallets, which sign via EIP-1271 rather than ECDSA personal_sign.
 */
const { createClient } = require('@supabase/supabase-js');
const { getAddress, isAddress } = require('ethers');
const { getSupabaseCreds } = require('./_supabaseEnv');

const SELECT_COLS =
  'id, author_address, draft_key, title, content, content_type, keystroke_events, pause_windows, session_started_at, created_at, updated_at';

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

async function listFor(addr) {
  const { url: supabaseUrl, key: supabaseKey, error: supaErr } = getSupabaseCreds();
  if (supaErr) return { error: supaErr };
  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  const { data, error } = await supabase
    .from('hi_content_drafts')
    .select(SELECT_COLS)
    .eq('author_address', addr)
    .order('updated_at', { ascending: false })
    .limit(50);
  if (error) {
    // Likely missing table — run supabase/migrations/20260522060000_fix_schema_for_my_content.sql.
    return { error: error.message || 'Query failed' };
  }
  return { rows: data || [] };
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});

  let authorRaw;
  if (req.method === 'GET') {
    authorRaw = String(req.query?.author || '').trim();
  } else if (req.method === 'POST') {
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
    authorRaw = String(body?.author_address || '').trim();
  } else {
    return send(res, 405, { error: 'Method not allowed' });
  }

  if (!authorRaw || !isAddress(authorRaw)) {
    return send(res, 400, { error: 'Missing or invalid author address' });
  }
  const addr = getAddress(authorRaw).toLowerCase();

  const result = await listFor(addr);
  if (result.error) {
    console.error('[drafts-list]', result.error);
    return send(res, 500, { error: result.error });
  }
  return send(res, 200, { ok: true, rows: result.rows });
};
