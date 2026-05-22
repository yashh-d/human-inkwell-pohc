/**
 * Delete one draft row from `hi_content_drafts`.
 *
 *   POST /api/drafts-delete { author_address, draft_key? }
 *
 * No signature required — see drafts-list.js for rationale.
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

  const { author_address, draft_key } = body || {};
  if (!author_address || !isAddress(String(author_address))) {
    return send(res, 400, { error: 'Missing or invalid author_address' });
  }
  const key = (draft_key && String(draft_key).trim()) || 'default';

  const { url: supabaseUrl, key: supabaseKey, error: supaErr } = getSupabaseCreds();
  if (supaErr) return send(res, 500, { error: supaErr });

  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  const addr = getAddress(String(author_address)).toLowerCase();

  const { error } = await supabase
    .from('hi_content_drafts')
    .delete()
    .eq('author_address', addr)
    .eq('draft_key', key);

  if (error) {
    console.error('[drafts-delete]', error);
    return send(res, 500, { error: error.message || 'Delete failed' });
  }
  return send(res, 200, { ok: true });
};
