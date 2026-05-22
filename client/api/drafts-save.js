/**
 * Upsert a draft into `hi_content_drafts` keyed by (author_address, draft_key).
 *
 *   POST /api/drafts-save {
 *     author_address, draft_key?, title?, content, content_type?,
 *     keystroke_events, pause_windows, session_started_at
 *   }
 *
 * No signature required — see drafts-list.js for the security rationale.
 */
const { createClient } = require('@supabase/supabase-js');
const { getAddress, isAddress } = require('ethers');
const { getSupabaseCreds } = require('./_supabaseEnv');

function send(res, code, data) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
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

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });

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
    author_address,
    draft_key,
    title,
    content,
    content_type,
    keystroke_events,
    pause_windows,
    session_started_at,
  } = body || {};

  if (!author_address || !isAddress(String(author_address))) {
    return send(res, 400, { error: 'Missing or invalid author_address' });
  }
  if (typeof content !== 'string') {
    return send(res, 400, { error: 'content must be a string' });
  }
  if (!Array.isArray(keystroke_events) || !Array.isArray(pause_windows)) {
    return send(res, 400, { error: 'keystroke_events and pause_windows must be arrays' });
  }
  const ct = content_type === 'long' ? 'long' : 'short';
  const key = (draft_key && String(draft_key).trim()) || 'default';

  const { url: supabaseUrl, key: supabaseKey, error: supaErr } = getSupabaseCreds();
  if (supaErr) return send(res, 500, { error: supaErr });

  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  const addr = getAddress(String(author_address)).toLowerCase();

  const row = {
    author_address: addr,
    draft_key: key,
    title: typeof title === 'string' ? title : '',
    content,
    content_type: ct,
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
    console.error('[drafts-save]', error);
    return send(res, 500, { error: error.message || 'Upsert failed' });
  }
  return send(res, 200, { ok: true, id: data?.id, updated_at: data?.updated_at });
};
