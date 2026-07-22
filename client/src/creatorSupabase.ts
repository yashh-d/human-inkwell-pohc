/**
 * Client for the creator feed API (api/creator-post.js, api/creator-feed.js).
 * Thin fetch wrappers — the server does the anchoring-to-on-chain and the writes.
 */

function apiPath(path: string): string {
  const base = (process.env.REACT_APP_API_BASE || '').replace(/\/$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return base ? `${base}${p}` : p;
}

export type CreatorPostInput = {
  chain_id: number;
  contract_address: string;
  entry_id: number;
  transaction_hash: string;
  content_hash: string;
  author_address: string;
  title?: string;
  excerpt?: string;
  content?: string;
  grind_score?: number;
  ai_slop?: number;
  human_pct?: number;
  tier?: string;
  word_count?: number;
  revisions?: number;
  edit_days?: number;
  minutes?: number;
  active_seconds?: number;
  sessions?: number;
  keystrokes?: number;
  words_typed?: number;
  words_published?: number;
  kill_ratio?: number;
  wpm?: number;
  wpm_series?: number[];
  is_public?: boolean;
  handle?: string;
  display_name?: string;
  bio?: string;
  links?: Record<string, string>;
};

export type CreatorFeedProfile = {
  handle?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  links?: Record<string, string> | null;
  world_verified?: boolean | null;
};

export type CreatorFeedPost = {
  entry_id: number;
  chain_id: number;
  contract_address: string;
  transaction_hash: string;
  content_hash: string;
  author_address: string;
  title?: string | null;
  excerpt?: string | null;
  content?: string | null;
  grind_score?: number | null;
  ai_slop?: number | null;
  human_pct?: number | null;
  tier?: string | null;
  word_count?: number | null;
  revisions?: number | null;
  edit_days?: number | null;
  minutes?: number | null;
  active_seconds?: number | null;
  sessions?: number | null;
  keystrokes?: number | null;
  words_typed?: number | null;
  words_published?: number | null;
  kill_ratio?: number | null;
  wpm?: number | null;
  wpm_series?: number[] | null;
  is_public?: boolean | null;
  published_at: string;
  creator_profiles?: CreatorFeedProfile | null;
};

export type CreatorProfileResult = {
  profile: (CreatorFeedProfile & { wallet_address?: string; bio?: string | null }) | null;
  posts: CreatorFeedPost[];
};

/** Publish an already-on-chain proof to the public creator feed. */
export async function publishCreatorPost(input: CreatorPostInput): Promise<{ ok: boolean; error?: string; deduped?: boolean }> {
  try {
    const res = await fetch(apiPath('/api/creator-post'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: json.error || `Feed publish failed (${res.status})` };
    return { ok: true, deduped: !!json.deduped };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
  }
}

/** Read the public creator feed, newest first. */
export async function fetchCreatorFeed(opts: { limit?: number; author?: string } = {}): Promise<CreatorFeedPost[]> {
  const params = new URLSearchParams();
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.author) params.set('author', opts.author.toLowerCase());
  const qs = params.toString();
  const res = await fetch(apiPath(`/api/creator-feed${qs ? `?${qs}` : ''}`));
  if (!res.ok) throw new Error(`Feed read failed (${res.status})`);
  const json = await res.json().catch(() => ({ posts: [] }));
  return Array.isArray(json.posts) ? json.posts : [];
}

/** Update the signed-in creator's editable profile (username / handle). */
export async function updateCreatorProfile(input: {
  author_address: string; display_name?: string; handle?: string; bio?: string; world_verified?: boolean;
}): Promise<{ ok: boolean; error?: string; handleTaken?: boolean }> {
  try {
    const res = await fetch(apiPath('/api/creator-profile-update'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: json.error || `Update failed (${res.status})` };
    return { ok: true, handleTaken: !!json.handleTaken };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
  }
}

/** Fetch a single public feed post (with full content) by its on-chain entry id. */
export async function fetchCreatorPost(entryId: number | string): Promise<CreatorFeedPost | null> {
  const res = await fetch(apiPath(`/api/creator-feed?entry=${encodeURIComponent(String(entryId))}`));
  if (!res.ok) throw new Error(`Post read failed (${res.status})`);
  const json = await res.json().catch(() => ({ posts: [] }));
  return Array.isArray(json.posts) && json.posts[0] ? json.posts[0] : null;
}

/** A creator's full body of work (public HI Feed posts + their other publishes). */
export async function fetchCreatorProfile(author: string): Promise<CreatorProfileResult> {
  const res = await fetch(apiPath(`/api/creator-profile?author=${encodeURIComponent(author.toLowerCase())}`));
  if (!res.ok) throw new Error(`Profile read failed (${res.status})`);
  const json = await res.json().catch(() => ({ profile: null, posts: [] }));
  return { profile: json.profile || null, posts: Array.isArray(json.posts) ? json.posts : [] };
}

/**
 * The PUBLIC social profile at /c/<handle>: the creator's identity + only their
 * public (HI Feed) pieces. Returns null when the handle isn't claimed.
 */
export async function fetchCreatorProfileByHandle(handle: string): Promise<CreatorProfileResult | null> {
  const clean = handle.trim().replace(/^@/, '');
  const res = await fetch(apiPath(`/api/creator-profile?handle=${encodeURIComponent(clean)}`));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Profile read failed (${res.status})`);
  const json = await res.json().catch(() => ({ profile: null, posts: [] }));
  if (!json.profile) return null;
  return { profile: json.profile, posts: Array.isArray(json.posts) ? json.posts : [] };
}
