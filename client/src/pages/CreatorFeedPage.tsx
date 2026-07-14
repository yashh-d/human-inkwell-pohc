import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchCreatorFeed, CreatorFeedPost } from '../creatorSupabase';
import { EXPLORER_BASE } from '../lib/chain';

/**
 * /feed — the public Human Ink creator feed.
 *
 * A stream of opted-in creator posts (from creator_posts in Supabase). Every
 * card carries the writer's Process Score and a link to the on-chain
 * attestation. Neutral product styling to match /publish — no emojis, no
 * gamification.
 */
export default function CreatorFeedPage() {
  const [posts, setPosts] = useState<CreatorFeedPost[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchCreatorFeed({ limit: 50 })
      .then((p) => { if (alive) setPosts(p); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Could not load the feed.'); });
    return () => { alive = false; };
  }, []);

  return (
    <div style={S.wrap}>
      <div style={S.head}>
        <div>
          <h1 style={S.h1}>HI Feed</h1>
          <p style={S.muted}>The public feed of human-written work — every piece has proof, verified on-chain.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Link to="/me" style={S.link}>My work</Link>
          <Link to="/creator" style={S.newBtn}>Write a piece</Link>
        </div>
      </div>

      {error && <p style={S.error}>{error}</p>}
      {!posts && !error && <p style={S.muted}>Loading…</p>}
      {posts && posts.length === 0 && (
        <div style={S.empty}>
          <p style={S.muted}>No posts on the feed yet. Publish a piece and opt in to be the first.</p>
          <Link to="/creator" style={S.link}>Write a piece &rarr;</Link>
        </div>
      )}

      <div style={S.list}>
        {posts?.map((p) => <FeedCard key={`${p.chain_id}-${p.entry_id}`} post={p} />)}
      </div>

      <div style={S.foot}><Link to="/" style={S.link}>&larr; Back to Human Ink</Link></div>
    </div>
  );
}

function FeedCard({ post }: { post: CreatorFeedPost }) {
  const score = post.grind_score ?? 0;
  const color = score >= 60 ? '#047857' : score >= 30 ? '#b45309' : '#b91c1c';
  const prof = post.creator_profiles || null;
  const author = prof?.display_name || (prof?.handle ? `@${prof.handle}` : shortAddr(post.author_address));
  const txUrl = post.transaction_hash ? `${EXPLORER_BASE}/tx/${post.transaction_hash}` : EXPLORER_BASE;
  const when = post.published_at ? new Date(post.published_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';

  return (
    <article style={S.card}>
      <div style={S.cardTop}>
        <div style={{ minWidth: 0 }}>
          <div style={S.authorName}>{author}</div>
          <div style={S.meta}>{when}</div>
        </div>
        <div style={S.scoreBox}>
          <div style={{ ...S.scoreNum, color }}>{score}</div>
          <div style={S.scoreLabel}>Grind Score</div>
        </div>
      </div>

      {post.title && <h3 style={S.title}>{post.title}</h3>}
      {post.excerpt && <p style={S.excerpt}>{post.excerpt}</p>}

      <div style={S.stats}>
        {post.human_pct != null && <span>{post.human_pct}% human</span>}
        {!!post.word_count && <span>{post.word_count.toLocaleString()} words</span>}
        {!!post.revisions && <span>{post.revisions} revisions</span>}
        {!!post.edit_days && <span>{post.edit_days === 1 ? '1 day' : `${post.edit_days} days`}</span>}
      </div>

      <div style={S.cardFoot}>
        <a style={S.verify} href={txUrl} target="_blank" rel="noreferrer">Verified on-chain &rarr;</a>
        {typeof post.entry_id === 'number' && <span style={S.entry}>#{post.entry_id}</span>}
      </div>
    </article>
  );
}

function shortAddr(a?: string): string {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : 'anonymous';
}

const S: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 'min(680px, 94vw)', margin: '32px auto', padding: '0 20px', color: 'var(--hi-text, #0a0a0a)' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 18 },
  h1: { fontSize: 20, fontWeight: 700, margin: 0 },
  muted: { fontSize: 13, color: 'var(--hi-text-muted, #64748b)', margin: '6px 0', lineHeight: 1.5 },
  error: { fontSize: 13, color: '#b91c1c', margin: '10px 0' },
  link: { color: '#0096b4', fontSize: 13, textDecoration: 'none', fontWeight: 600 },
  newBtn: { color: '#fff', background: 'var(--hi-cyan, #00b4d8)', fontSize: 13, fontWeight: 650, textDecoration: 'none', padding: '9px 14px', borderRadius: 8, whiteSpace: 'nowrap' },
  empty: { textAlign: 'center', padding: '40px 0', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' },
  list: { display: 'flex', flexDirection: 'column', gap: 12 },

  card: { border: '1px solid var(--hi-border, #e6e9ee)', borderRadius: 12, padding: 18, background: 'var(--hi-surface, #fff)' },
  cardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  authorName: { fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  meta: { fontSize: 11, color: 'var(--hi-text-muted, #64748b)', marginTop: 2 },
  scoreBox: { textAlign: 'center', flexShrink: 0 },
  scoreNum: { fontSize: 28, fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums' },
  scoreLabel: { fontSize: 8.5, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--hi-text-muted, #64748b)', marginTop: 1 },
  title: { fontSize: 17, fontWeight: 700, margin: '14px 0 4px', lineHeight: 1.3 },
  excerpt: { fontSize: 13.5, color: 'var(--hi-text-dim, #334155)', margin: '4px 0 0', lineHeight: 1.55 },
  stats: { display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: 'var(--hi-text-muted, #64748b)', margin: '14px 0 0', fontWeight: 600 },
  cardFoot: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--hi-border, #e6e9ee)' },
  verify: { color: '#0096b4', fontSize: 12.5, fontWeight: 700, textDecoration: 'none' },
  entry: { fontSize: 11, color: 'var(--hi-text-faint, #94a3b8)', fontFamily: 'ui-monospace, Menlo, monospace' },
  foot: { marginTop: 22, paddingTop: 14, borderTop: '1px solid var(--hi-border, #e6e9ee)' },
};
