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
  grind_score?: number;
  ai_slop?: number;
  human_pct?: number;
  tier?: string;
  word_count?: number;
  revisions?: number;
  edit_days?: number;
  minutes?: number;
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
  grind_score?: number | null;
  ai_slop?: number | null;
  human_pct?: number | null;
  tier?: string | null;
  word_count?: number | null;
  revisions?: number | null;
  edit_days?: number | null;
  minutes?: number | null;
  published_at: string;
  creator_profiles?: CreatorFeedProfile | null;
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
