/**
 * Vercel serverless: a creator's own body of work for the /me profile.
 *
 * GET ?author=<wallet> → { profile, posts } where posts is ALL of the creator's
 * pieces (both on the public HI Feed and not), newest first. Distinct from
 * /api/creator-feed, which returns only is_public rows across all creators.
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

  const author = req.query && req.query.author ? String(req.query.author).toLowerCase() : '';
  if (!author) return send(res, 400, { error: 'author required' });

  const { url, key, error: supaErr } = getSupabaseCreds();
  if (supaErr) return send(res, 500, { error: supaErr });
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const [postsRes, profRes] = await Promise.all([
    supabase
      .from('creator_posts')
      .select('entry_id, chain_id, contract_address, transaction_hash, content_hash, author_address, title, excerpt, content, grind_score, ai_slop, human_pct, tier, word_count, revisions, edit_days, minutes, is_public, published_at')
      .eq('author_address', author)
      .order('published_at', { ascending: false })
      .limit(200),
    supabase
      .from('creator_profiles')
      .select('wallet_address, handle, display_name, bio, avatar_url, links')
      .eq('wallet_address', author)
      .limit(1),
  ]);

  if (postsRes.error) {
    console.error('creator-profile: posts', postsRes.error);
    return send(res, 500, { error: postsRes.error.message || 'Profile read failed' });
  }
  const profile = !profRes.error && profRes.data && profRes.data[0] ? profRes.data[0] : null;
  return send(res, 200, { profile, posts: postsRes.data || [] });
};
