/**
 * Vercel serverless: list `hi_content_drafts` rows for the calling wallet.
 *
 * Auth: wallet-signed message of the form
 *   Human Inkwell list drafts\nauthor:<lower-hex>\ntime:<ms>\n
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
  if (!String(message).startsWith('Human Inkwell list drafts\n')) {
    return send(res, 400, { error: 'Invalid message prefix' });
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
    .from('hi_content_drafts')
    .select(
      'id, author_address, draft_key, title, content, content_type, keystroke_events, pause_windows, session_started_at, created_at, updated_at'
    )
    .eq('author_address', addr)
    .order('updated_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error(error);
    return send(res, 500, { error: error.message || 'Query failed' });
  }
  return send(res, 200, { ok: true, rows: data || [] });
};
