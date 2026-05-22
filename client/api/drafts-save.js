/**
 * Vercel serverless: upsert a draft into `hi_content_drafts` for the calling wallet.
 *
 * Auth: wallet-signed message of the form
 *   Human Inkwell save draft\nauthor:<lower-hex>\ntime:<ms>\n
 * The signature is verified against `author_address`; the row written is keyed by
 * (author_address, draft_key). Drafts are scoped to the signing wallet — the message
 * doesn't commit to the body so signing once per autosave tick doesn't require a
 * fresh wallet prompt per keystroke (Privy embedded wallets sign silently).
 */
const { createClient } = require('@supabase/supabase-js');
const { verifyMessage, getAddress } = require('ethers');
const { getSupabaseCreds } = require('./_supabaseEnv');

const MAX_AGE_MS = 10 * 60 * 1000;
const MAX_CONTENT_LEN = 200_000;
const MAX_KEYSTROKES = 200_000;
const MAX_PAUSES = 5_000;

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

  const {
    message,
    signature,
    author_address,
    draft_key,
    title,
    content,
    content_type,
    keystroke_events,
    pause_windows,
    session_started_at,
  } = body;

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
  if (!String(message).startsWith('Human Inkwell save draft\n')) {
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

  if (typeof content !== 'string' || content.length > MAX_CONTENT_LEN) {
    return send(res, 400, { error: 'Invalid content' });
  }
  if (content_type !== 'short' && content_type !== 'long') {
    return send(res, 400, { error: 'Invalid content_type' });
  }
  if (!Array.isArray(keystroke_events) || keystroke_events.length > MAX_KEYSTROKES) {
    return send(res, 400, { error: 'Invalid keystroke_events' });
  }
  if (!Array.isArray(pause_windows) || pause_windows.length > MAX_PAUSES) {
    return send(res, 400, { error: 'Invalid pause_windows' });
  }

  const { url: supabaseUrl, key: supabaseKey, error: supaErr } = getSupabaseCreds();
  if (supaErr) {
    return send(res, 500, { error: supaErr });
  }

  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  const addr = getAddress(author_address).toLowerCase();
  const key = (draft_key && String(draft_key).trim()) || 'default';

  const row = {
    author_address: addr,
    draft_key: key,
    title: typeof title === 'string' ? title.slice(0, 500) : '',
    content,
    content_type,
    keystroke_events,
    pause_windows,
    session_started_at: Number(session_started_at) || 0,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('hi_content_drafts')
    .upsert(row, { onConflict: 'author_address,draft_key' })
    .select('id, updated_at')
    .single();

  if (error) {
    console.error(error);
    return send(res, 500, { error: error.message || 'Upsert failed' });
  }
  return send(res, 200, { ok: true, id: data?.id, updated_at: data?.updated_at });
};
