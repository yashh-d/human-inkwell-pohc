/**
 * Vercel serverless: publish a piece to the public Human Ink creator feed.
 *
 * The post carries the on-chain identity (chain/contract/entry/tx + content hash)
 * and the client-computed score summary. Each feed card links to the transaction,
 * which anyone can verify on-chain — that link IS the proof, so we don't re-verify
 * against a Supabase mirror here (that coupling made the feed fail whenever the
 * off-chain indexing lagged). Basic shape validation + dedupe only.
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
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

const clampScore = (v) => (v == null || v === '' ? null : Math.max(0, Math.min(100, Math.round(Number(v)))));
const clampInt = (v) => Math.max(0, Math.round(Number(v) || 0));
const trimStr = (v, max) => (v == null ? null : String(v).slice(0, max));

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });

  let body;
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) body = req.body;
  else {
    try { body = await readJson(req); } catch { return send(res, 400, { error: 'Invalid JSON' }); }
  }

  const {
    chain_id, contract_address, entry_id, transaction_hash, content_hash, author_address,
    title, excerpt, grind_score, ai_slop, human_pct, tier,
    word_count, revisions, edit_days, minutes, is_public,
    handle, display_name, bio, links,
  } = body;

  if (chain_id == null || !contract_address || entry_id == null || !content_hash || !author_address || !transaction_hash) {
    return send(res, 400, { error: 'Missing required fields' });
  }

  let contractLo, authorLo;
  try {
    contractLo = getAddress(String(contract_address).trim()).toLowerCase();
    authorLo = getAddress(String(author_address).trim()).toLowerCase();
  } catch {
    return send(res, 400, { error: 'Invalid address' });
  }

  const { url, key, error: supaErr } = getSupabaseCreds();
  if (supaErr) return send(res, 500, { error: supaErr });
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // Best-effort profile upsert (handle/name/bio/socials), keyed by wallet.
  if (handle || display_name || bio || links) {
    const profile = {
      wallet_address: authorLo,
      handle: trimStr(handle, 40) || null,
      display_name: trimStr(display_name, 80),
      bio: trimStr(bio, 400),
      links: links && typeof links === 'object' ? links : {},
    };
    const { error: profErr } = await supabase
      .from('creator_profiles')
      .upsert(profile, { onConflict: 'wallet_address' });
    if (profErr && !/duplicate|unique/i.test(String(profErr.message))) {
      // A handle clash (unique) shouldn't block the post; log and continue.
      console.warn('creator-post: profile upsert', profErr.message);
    }
  }

  const row = {
    chain_id: Number(chain_id),
    contract_address: contractLo,
    entry_id: Number(entry_id),
    transaction_hash: String(transaction_hash).toLowerCase(),
    content_hash: String(content_hash).trim(),
    author_address: authorLo,
    title: trimStr(title, 200),
    excerpt: trimStr(excerpt, 600),
    grind_score: clampScore(grind_score),
    ai_slop: clampScore(ai_slop),
    human_pct: clampScore(human_pct),
    tier: trimStr(tier, 40),
    word_count: clampInt(word_count),
    revisions: clampInt(revisions),
    edit_days: clampInt(edit_days),
    minutes: clampInt(minutes),
    is_public: is_public === false ? false : true,
  };

  const { error } = await supabase.from('creator_posts').insert(row);
  if (error) {
    if (error.code === '23505' || /duplicate|unique/i.test(String(error.message))) {
      return send(res, 200, { ok: true, deduped: true });
    }
    console.error('creator-post: insert', error);
    return send(res, 500, { error: error.message || 'Insert failed' });
  }
  return send(res, 200, { ok: true });
};
