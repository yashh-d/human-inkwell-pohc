/**
 * Vercel serverless: update a creator's profile (their editable username/handle).
 *
 * POST { author_address, display_name?, handle?, bio? } → upserts creator_profiles
 * for that wallet. Keyed by wallet_address; the client sends its own authenticated
 * address (same trust model as the rest of the app's anon-key writes). A handle
 * clash (unique) doesn't fail the whole save — we keep the display name and report
 * handleTaken so the UI can nudge for a different one.
 */
const { createClient } = require('@supabase/supabase-js');
const { getAddress } = require('ethers');
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
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const trimStr = (v, max) => (v == null ? null : String(v).slice(0, max));
const cleanHandle = (h) => (h == null ? null : String(h).trim().replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 40) || null);

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });

  let body;
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) body = req.body;
  else { try { body = await readJson(req); } catch { return send(res, 400, { error: 'Invalid JSON' }); } }

  const { author_address, display_name, handle, bio } = body;
  if (!author_address) return send(res, 400, { error: 'author_address required' });
  let authorLo;
  try { authorLo = getAddress(String(author_address).trim()).toLowerCase(); }
  catch { return send(res, 400, { error: 'Invalid address' }); }

  const { url, key, error: supaErr } = getSupabaseCreds();
  if (supaErr) return send(res, 500, { error: supaErr });
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const row = { wallet_address: authorLo };
  if (display_name !== undefined) row.display_name = trimStr(display_name, 80);
  if (handle !== undefined) row.handle = cleanHandle(handle);
  if (bio !== undefined) row.bio = trimStr(bio, 400);

  let { error } = await supabase.from('creator_profiles').upsert(row, { onConflict: 'wallet_address' });
  if (error && (error.code === '23505' || /duplicate|unique/i.test(String(error.message)))) {
    // Handle already taken by someone else — save everything except the handle.
    const { handle: _drop, ...rest } = row;
    const retry = await supabase.from('creator_profiles').upsert(rest, { onConflict: 'wallet_address' });
    if (retry.error) { console.error('creator-profile-update retry', retry.error); return send(res, 500, { error: retry.error.message }); }
    return send(res, 200, { ok: true, handleTaken: true });
  }
  if (error) { console.error('creator-profile-update', error); return send(res, 500, { error: error.message || 'Update failed' }); }
  return send(res, 200, { ok: true });
};
