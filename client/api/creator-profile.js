/**
 * Vercel serverless: a creator's own body of work for the /me profile.
 *
 * GET ?author=<wallet> → { profile, posts } where posts is ALL of the creator's
 * pieces (both on the public HI Feed and not), newest first. This is the private
 * /me view — the caller is the owner.
 *
 * GET ?handle=<slug> → the PUBLIC social profile for /c/<handle>: resolves the
 * handle to its wallet, then returns { profile, posts } with only is_public
 * pieces (never surfaces someone's profile-only drafts to visitors).
 *
 * Distinct from /api/creator-feed, which returns is_public rows across all creators.
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

  const cleanHandle = (h) => String(h).trim().replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 40);
  const author = req.query && req.query.author ? String(req.query.author).toLowerCase() : '';
  const handle = req.query && req.query.handle ? cleanHandle(req.query.handle) : '';
  if (!author && !handle) return send(res, 400, { error: 'author or handle required' });

  const { url, key, error: supaErr } = getSupabaseCreds();
  if (supaErr) return send(res, 500, { error: supaErr });
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // select('*') so this keeps working whether or not the world_verified column
  // (migration 20260721120000) has been applied yet — a missing column just comes
  // back undefined rather than 400-ing the whole profile read.
  const PROFILE_COLS = '*';

  // Public handle view: resolve handle → wallet first, then show only public posts.
  const isPublicView = !author && !!handle;
  let profile = null;
  let walletAddress = author;

  if (isPublicView) {
    const { data: profRows, error: profErr } = await supabase
      .from('creator_profiles')
      .select(PROFILE_COLS)
      .eq('handle', handle)
      .limit(1);
    if (profErr) { console.error('creator-profile: handle', profErr); return send(res, 500, { error: profErr.message || 'Profile read failed' }); }
    profile = profRows && profRows[0] ? profRows[0] : null;
    if (!profile) return send(res, 404, { error: 'No such profile' });
    walletAddress = String(profile.wallet_address).toLowerCase();
  }

  let postsQuery = supabase
    .from('creator_posts')
    .select('entry_id, chain_id, contract_address, transaction_hash, content_hash, author_address, title, excerpt, content, grind_score, ai_slop, human_pct, tier, word_count, revisions, edit_days, minutes, active_seconds, sessions, keystrokes, words_typed, words_published, kill_ratio, wpm, wpm_series, is_public, published_at')
    .eq('author_address', walletAddress)
    .order('published_at', { ascending: false })
    .limit(200);
  if (isPublicView) postsQuery = postsQuery.eq('is_public', true);

  const pending = [postsQuery];
  if (!isPublicView) {
    pending.push(
      supabase.from('creator_profiles').select(PROFILE_COLS).eq('wallet_address', walletAddress).limit(1),
    );
  }
  const [postsRes, profRes] = await Promise.all(pending);

  if (postsRes.error) {
    console.error('creator-profile: posts', postsRes.error);
    return send(res, 500, { error: postsRes.error.message || 'Profile read failed' });
  }
  if (!isPublicView) {
    profile = profRes && !profRes.error && profRes.data && profRes.data[0] ? profRes.data[0] : null;
  }
  return send(res, 200, { profile, posts: postsRes.data || [] });
};
