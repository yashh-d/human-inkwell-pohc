import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePrivy } from '@privy-io/react-auth';
import { useViewerAddress } from '../hooks/useViewerAddress';
import { fetchCreatorProfile, CreatorFeedPost, CreatorProfileResult } from '../creatorSupabase';
import { EXPLORER_BASE } from '../lib/chain';

/**
 * /me — a creator's profile: their full body of published work.
 *
 * Shows every piece the signed-in creator has published (recorded on each
 * creator publish), with an "On HI Feed" badge on the ones that are public.
 * Creator-only surface; students have a different flow entirely.
 */
export default function CreatorMePage() {
  const identity = useViewerAddress();
  const { user } = usePrivy();
  const [data, setData] = useState<CreatorProfileResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const address = identity.status === 'ready' ? identity.address : '';
  const email = (user?.email?.address as string) || ((user as any)?.google?.email as string) || '';
  const username = email ? email.split('@')[0] : '';

  useEffect(() => {
    if (!address) return;
    let alive = true;
    setData(null); setError(null);
    fetchCreatorProfile(address)
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Could not load your work.'); });
    return () => { alive = false; };
  }, [address]);

  const displayName = data?.profile?.display_name || username || 'Your work';
  const onFeed = useMemo(() => (data?.posts || []).filter((p) => p.is_public).length, [data]);

  if (identity.status !== 'ready') {
    return (
      <div style={S.wrap}>
        <h1 style={S.h1}>Your work</h1>
        <p style={S.muted}>Sign in to see everything you’ve published on Human Ink.</p>
        {identity.status === 'needs-auth'
          ? <button style={S.newBtn} onClick={() => identity.authenticate()}>Sign in</button>
          : <Link to="/creator" style={S.newBtn}>Write a piece</Link>}
        <div style={S.foot}><Link to="/" style={S.link}>&larr; Back to Human Ink</Link></div>
      </div>
    );
  }

  return (
    <div style={S.wrap}>
      <div style={S.header}>
        <span style={S.avatar}>{(displayName[0] || 'W').toUpperCase()}</span>
        <div style={{ minWidth: 0 }}>
          <h1 style={S.name}>{displayName}</h1>
          <div style={S.sub}>
            {email && <span>{email}</span>}
            {email && <span style={S.dot}>·</span>}
            <span style={S.mono}>{address.slice(0, 6)}…{address.slice(-4)}</span>
          </div>
        </div>
        <Link to="/creator" style={S.newBtn}>Write a piece</Link>
      </div>

      {data && (
        <div style={S.stats}>
          <div style={S.stat}><div style={S.statN}>{data.posts.length}</div><div style={S.statL}>pieces</div></div>
          <div style={S.stat}><div style={S.statN}>{onFeed}</div><div style={S.statL}>on HI Feed</div></div>
          <div style={S.stat}><div style={S.statN}>{data.posts.reduce((a, p) => a + (p.word_count || 0), 0).toLocaleString()}</div><div style={S.statL}>words</div></div>
        </div>
      )}

      {error && <p style={S.error}>{error}</p>}
      {!data && !error && <p style={S.muted}>Loading your work…</p>}
      {data && data.posts.length === 0 && (
        <div style={S.empty}>
          <p style={S.muted}>You haven’t published anything yet.</p>
          <Link to="/creator" style={S.link}>Write your first piece &rarr;</Link>
        </div>
      )}

      <div style={S.list}>
        {data?.posts.map((p) => <WorkCard key={`${p.chain_id}-${p.entry_id}`} post={p} />)}
      </div>

      <div style={S.foot}>
        <Link to="/feed" style={S.link}>HI Feed &rarr;</Link>
        <Link to="/" style={S.link}>&larr; Human Ink</Link>
      </div>
    </div>
  );
}

function WorkCard({ post }: { post: CreatorFeedPost }) {
  const score = post.grind_score ?? 0;
  const color = score >= 60 ? '#047857' : score >= 30 ? '#b45309' : '#b91c1c';
  const txUrl = post.transaction_hash ? `${EXPLORER_BASE}/tx/${post.transaction_hash}` : EXPLORER_BASE;
  const when = post.published_at ? new Date(post.published_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';

  return (
    <article style={S.card}>
      <div style={S.cardTop}>
        <div style={{ minWidth: 0 }}>
          <div style={S.cardMeta}>
            {when}
            {post.is_public
              ? <span style={S.badgeFeed}>On HI Feed</span>
              : <span style={S.badgePrivate}>Profile only</span>}
          </div>
          {post.title && <h3 style={S.title}>{post.title}</h3>}
          {post.excerpt && <p style={S.excerpt}>{post.excerpt}</p>}
        </div>
        <div style={S.scoreBox}>
          <div style={{ ...S.scoreNum, color }}>{score}</div>
          <div style={S.scoreLabel}>Grind Score</div>
        </div>
      </div>
      <div style={S.stats2}>
        {post.human_pct != null && <span>{post.human_pct}% human</span>}
        {!!post.word_count && <span>{post.word_count.toLocaleString()} words</span>}
        {!!post.revisions && <span>{post.revisions} revisions</span>}
      </div>
      <div style={S.cardFoot}>
        <a style={S.verify} href={txUrl} target="_blank" rel="noreferrer">Verified on-chain &rarr;</a>
        {typeof post.entry_id === 'number' && <span style={S.entry}>#{post.entry_id}</span>}
      </div>
    </article>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 'min(680px, 94vw)', margin: '32px auto', padding: '0 20px', color: 'var(--hi-text, #0a0a0a)' },
  h1: { fontSize: 20, fontWeight: 700, margin: '0 0 6px' },
  header: { display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 16 },
  avatar: { width: 48, height: 48, borderRadius: '50%', background: 'linear-gradient(135deg, #00b4d8, #0096b4)', color: '#fff', fontWeight: 800, fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  name: { fontSize: 20, fontWeight: 750, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  sub: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--hi-text-muted, #64748b)', marginTop: 2, flexWrap: 'wrap' },
  dot: { opacity: 0.5 },
  mono: { fontFamily: 'ui-monospace, Menlo, monospace' },
  newBtn: { color: '#fff', background: 'var(--hi-cyan, #00b4d8)', fontSize: 13, fontWeight: 650, textDecoration: 'none', padding: '9px 14px', borderRadius: 8, whiteSpace: 'nowrap', border: 'none', cursor: 'pointer', marginLeft: 'auto' },
  muted: { fontSize: 13, color: 'var(--hi-text-muted, #64748b)', margin: '10px 0', lineHeight: 1.5 },
  error: { fontSize: 13, color: '#b91c1c', margin: '10px 0' },
  link: { color: '#0096b4', fontSize: 13, textDecoration: 'none', fontWeight: 600 },

  stats: { display: 'flex', gap: 10, margin: '4px 0 18px' },
  stat: { flex: 1, border: '1px solid var(--hi-border, #e6e9ee)', borderRadius: 12, padding: '12px 8px', textAlign: 'center', background: 'var(--hi-surface, #fff)' },
  statN: { fontSize: 22, fontWeight: 800, color: 'var(--hi-cyan, #00b4d8)', fontVariantNumeric: 'tabular-nums' },
  statL: { fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--hi-text-muted, #64748b)', marginTop: 2 },

  empty: { textAlign: 'center', padding: '30px 0', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' },
  list: { display: 'flex', flexDirection: 'column', gap: 12 },
  card: { border: '1px solid var(--hi-border, #e6e9ee)', borderRadius: 12, padding: 18, background: 'var(--hi-surface, #fff)' },
  cardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  cardMeta: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--hi-text-muted, #64748b)', flexWrap: 'wrap' },
  badgeFeed: { fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: '#0096b4', background: 'var(--hi-cyan-soft, rgba(0,180,216,0.12))', borderRadius: 999, padding: '2px 7px' },
  badgePrivate: { fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--hi-text-muted, #64748b)', background: 'var(--hi-surface-muted, #f4f6f9)', borderRadius: 999, padding: '2px 7px' },
  title: { fontSize: 16.5, fontWeight: 700, margin: '8px 0 4px', lineHeight: 1.3 },
  excerpt: { fontSize: 13, color: 'var(--hi-text-dim, #334155)', margin: '4px 0 0', lineHeight: 1.5 },
  scoreBox: { textAlign: 'center', flexShrink: 0 },
  scoreNum: { fontSize: 26, fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums' },
  scoreLabel: { fontSize: 8.5, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--hi-text-muted, #64748b)', marginTop: 1 },
  stats2: { display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: 'var(--hi-text-muted, #64748b)', margin: '12px 0 0', fontWeight: 600 },
  cardFoot: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--hi-border, #e6e9ee)' },
  verify: { color: '#0096b4', fontSize: 12.5, fontWeight: 700, textDecoration: 'none' },
  entry: { fontSize: 11, color: 'var(--hi-text-faint, #94a3b8)', fontFamily: 'ui-monospace, Menlo, monospace' },
  foot: { marginTop: 22, paddingTop: 14, borderTop: '1px solid var(--hi-border, #e6e9ee)', display: 'flex', gap: 18, flexWrap: 'wrap' },
};
