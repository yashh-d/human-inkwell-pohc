import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchCreatorPost, CreatorFeedPost } from '../creatorSupabase';
import { EXPLORER_BASE } from '../lib/chain';
import { fmtDuration } from '../lib/receipts';
import EmbedProof from '../components/EmbedProof';

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

  const active = post.active_seconds != null ? fmtDuration(post.active_seconds) : null;
  const kill = post.kill_ratio != null && post.words_published ? `${Number(post.kill_ratio).toFixed(2)}×` : null;
  const words = post.words_published ?? post.word_count;
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
        {active && (
          <div style={S.scoreBox}>
            <div style={S.scoreNum}>{active}</div>
            <div style={S.scoreLabel}>active writing</div>
          </div>
        )}
      </div>

      {post.title && <h1 style={S.title}>{post.title}</h1>}

      <div style={S.stats}>
        {kill && <span>{kill} words cut</span>}
        {words != null && <span>{Number(words).toLocaleString()} words</span>}
        {!!post.keystrokes && <span>{post.keystrokes.toLocaleString()} keystrokes</span>}
        {!!post.revisions && <span>{post.revisions} revisions</span>}
      </div>

      {post.content
        ? <div style={S.content}>{post.content}</div>
        : <p style={S.muted}>The full text isn’t available for this piece.</p>}

      {typeof post.entry_id === 'number' && (
        <div style={S.embed}>
          <div style={S.embedHead}>Embed this proof</div>
          <p style={S.embedSub}>Drop a self-verifying “human-written” card into your newsletter or site.</p>
          <EmbedProof entryId={post.entry_id} />
        </div>
      )}

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
  scoreNum: { fontSize: 18, fontWeight: 800, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums', color: 'var(--hi-cyan-ink, #075985)', whiteSpace: 'nowrap' },
  scoreLabel: { fontSize: 8.5, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--hi-text-muted, #64748b)', marginTop: 1 },
  title: { fontSize: 26, fontWeight: 800, lineHeight: 1.2, margin: '16px 0 10px' },
  stats: { display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: 'var(--hi-text-muted, #64748b)', margin: '0 0 18px', fontWeight: 600 },
  content: { fontSize: 16.5, lineHeight: 1.7, whiteSpace: 'pre-wrap', color: 'var(--hi-text, #0a0a0a)', fontFamily: 'Georgia, "Times New Roman", serif' },
  embed: { marginTop: 28, paddingTop: 20, borderTop: '1px solid var(--hi-border, #e6e9ee)' },
  embedHead: { fontSize: 14, fontWeight: 700, color: 'var(--hi-text, #0a0a0a)' },
  embedSub: { fontSize: 12.5, color: 'var(--hi-text-muted, #64748b)', margin: '4px 0 0', lineHeight: 1.5 },
  muted: { fontSize: 13, color: 'var(--hi-text-muted, #64748b)', margin: '10px 0', lineHeight: 1.5 },
  error: { fontSize: 13, color: '#b91c1c', margin: '10px 0' },
  link: { color: '#0096b4', fontSize: 13, textDecoration: 'none', fontWeight: 600 },
  verify: { color: '#0096b4', fontSize: 13, textDecoration: 'none', fontWeight: 700 },
  foot: { marginTop: 28, paddingTop: 16, borderTop: '1px solid var(--hi-border, #e6e9ee)', display: 'flex', gap: 20, flexWrap: 'wrap' },
};
