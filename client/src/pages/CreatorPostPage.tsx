import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchCreatorPost, CreatorFeedPost } from '../creatorSupabase';
import { EXPLORER_BASE } from '../lib/chain';

/**
 * /feed/:entryId — the full read view for a single HI Feed piece.
 *
 * Shows the whole written content (the feed card only previews it), plus the
 * author, Grind Score, and the on-chain verification link.
 */
export default function CreatorPostPage() {
  const { entryId } = useParams();
  const [post, setPost] = useState<CreatorFeedPost | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!entryId) return;
    let alive = true;
    setPost(undefined); setError(null);
    fetchCreatorPost(entryId)
      .then((p) => { if (alive) setPost(p); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Could not load this piece.'); });
    return () => { alive = false; };
  }, [entryId]);

  if (error) return <Shell><p style={S.error}>{error}</p></Shell>;
  if (post === undefined) return <Shell><p style={S.muted}>Loading…</p></Shell>;
  if (post === null) return <Shell><p style={S.muted}>This piece isn’t on the HI Feed.</p></Shell>;

  const score = post.grind_score ?? 0;
  const color = score >= 60 ? '#047857' : score >= 30 ? '#b45309' : '#b91c1c';
  const prof = post.creator_profiles || null;
  const author = prof?.display_name || (prof?.handle ? `@${prof.handle}` : shortAddr(post.author_address));
  const txUrl = post.transaction_hash ? `${EXPLORER_BASE}/tx/${post.transaction_hash}` : EXPLORER_BASE;
  const when = post.published_at ? new Date(post.published_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : '';

  return (
    <Shell>
      <div style={S.head}>
        <div style={{ minWidth: 0 }}>
          <div style={S.author}>{author}</div>
          <div style={S.meta}>{when}</div>
        </div>
        <div style={S.scoreBox}>
          <div style={{ ...S.scoreNum, color }}>{score}</div>
          <div style={S.scoreLabel}>Grind Score</div>
        </div>
      </div>

      {post.title && <h1 style={S.title}>{post.title}</h1>}

      <div style={S.stats}>
        {post.human_pct != null && <span>{post.human_pct}% human</span>}
        {!!post.word_count && <span>{post.word_count.toLocaleString()} words</span>}
        {!!post.revisions && <span>{post.revisions} revisions</span>}
        {!!post.edit_days && <span>{post.edit_days === 1 ? '1 day' : `${post.edit_days} days`}</span>}
      </div>

      {post.content
        ? <div style={S.content}>{post.content}</div>
        : <p style={S.muted}>The full text isn’t available for this piece.</p>}

      <div style={S.foot}>
        <a style={S.verify} href={txUrl} target="_blank" rel="noreferrer">Verified on-chain &rarr;</a>
        <Link to="/feed" style={S.link}>&larr; HI Feed</Link>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div style={S.wrap}>{children}</div>;
}

function shortAddr(a?: string): string {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : 'anonymous';
}

const S: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 'min(680px, 94vw)', margin: '32px auto', padding: '0 20px', color: 'var(--hi-text, #0a0a0a)' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  author: { fontSize: 14, fontWeight: 700 },
  meta: { fontSize: 12, color: 'var(--hi-text-muted, #64748b)', marginTop: 2 },
  scoreBox: { textAlign: 'center', flexShrink: 0 },
  scoreNum: { fontSize: 28, fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums' },
  scoreLabel: { fontSize: 8.5, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--hi-text-muted, #64748b)', marginTop: 1 },
  title: { fontSize: 26, fontWeight: 800, lineHeight: 1.2, margin: '16px 0 10px' },
  stats: { display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: 'var(--hi-text-muted, #64748b)', margin: '0 0 18px', fontWeight: 600 },
  content: { fontSize: 16.5, lineHeight: 1.7, whiteSpace: 'pre-wrap', color: 'var(--hi-text, #0a0a0a)', fontFamily: 'Georgia, "Times New Roman", serif' },
  muted: { fontSize: 13, color: 'var(--hi-text-muted, #64748b)', margin: '10px 0', lineHeight: 1.5 },
  error: { fontSize: 13, color: '#b91c1c', margin: '10px 0' },
  link: { color: '#0096b4', fontSize: 13, textDecoration: 'none', fontWeight: 600 },
  verify: { color: '#0096b4', fontSize: 13, textDecoration: 'none', fontWeight: 700 },
  foot: { marginTop: 28, paddingTop: 16, borderTop: '1px solid var(--hi-border, #e6e9ee)', display: 'flex', gap: 20, flexWrap: 'wrap' },
};
