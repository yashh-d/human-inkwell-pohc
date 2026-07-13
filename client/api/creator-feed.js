/**
 * Vercel serverless: read the public Human Ink creator feed.
 *
 * Returns recent opted-in creator_posts (RLS already limits anon reads to
 * is_public = true), newest first, each joined to its creator_profile. GET with
 * optional ?limit= (default 30, max 100) and ?author= (lowercased wallet) to
 * scope to one creator.
 */
const { createClient } = require('@supabase/supabase-js');
const { getSupabaseCreds } = require('./_supabaseEnv');

function send(res, code, data) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (code === 204) return res.status(204).end();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(code).send(JSON.stringify(data));
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });

  const { url, key, error: supaErr } = getSupabaseCreds();
  if (supaErr) return send(res, 500, { error: supaErr });
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const q = req.query || {};
  const limit = Math.max(1, Math.min(100, Number(q.limit) || 30));
  const author = q.author ? String(q.author).toLowerCase() : null;

  let query = supabase
    .from('creator_posts')
    .select('entry_id, chain_id, contract_address, transaction_hash, content_hash, author_address, title, excerpt, grind_score, ai_slop, human_pct, tier, word_count, revisions, edit_days, minutes, published_at, creator_profiles(handle, display_name, avatar_url, links)')
    .eq('is_public', true)
    .order('published_at', { ascending: false })
    .limit(limit);
  if (author) query = query.eq('author_address', author);

  const { data, error } = await query;
  if (error) {
    // The embedded join needs a FK PostgREST can see; fall back to a flat select.
    const flat = supabase
      .from('creator_posts')
      .select('entry_id, chain_id, contract_address, transaction_hash, content_hash, author_address, title, excerpt, grind_score, ai_slop, human_pct, tier, word_count, revisions, edit_days, minutes, published_at')
      .eq('is_public', true)
      .order('published_at', { ascending: false })
      .limit(limit);
    const { data: flatData, error: flatErr } = author ? await flat.eq('author_address', author) : await flat;
    if (flatErr) {
      console.error('creator-feed:', error, flatErr);
      return send(res, 500, { error: flatErr.message || 'Feed read failed' });
    }
    return send(res, 200, { posts: flatData || [] });
  }
  return send(res, 200, { posts: data || [] });
};
