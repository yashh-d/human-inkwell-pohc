import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchCreatorProfileByHandle, CreatorFeedPost, CreatorProfileResult } from '../creatorSupabase';
import { EXPLORER_BASE } from '../lib/chain';
import { fmtDuration } from '../lib/receipts';
import WritingHeatmap from '../components/WritingHeatmap';

/**
 * /c/:handle — a creator's PUBLIC social profile.
 *
 * The shareable face of a creator account: who they are, a Verified Human badge
 * (opt-in), their writing-activity heatmap, and every public piece with its
 * receipts and on-chain link. Anyone can visit — no sign-in, no onboarding wall.
 * The private owner view lives at /me.
 */
export default function CreatorProfilePage() {
  const { handle = '' } = useParams();
  const [data, setData] = useState<CreatorProfileResult | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!handle) return;
    let alive = true;
    setData(undefined); setError(null);
    fetchCreatorProfileByHandle(handle)
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Could not load this profile.'); });
    return () => { alive = false; };
  }, [handle]);

  const displayName = data?.profile?.display_name || (data?.profile?.handle ? `@${data.profile.handle}` : `@${handle}`);
  const totalWords = useMemo(() => (data?.posts || []).reduce((a, p) => a + (p.words_published || p.word_count || 0), 0), [data]);

  if (error) return <div style={S.wrap}><p style={S.error}>{error}</p><Foot /></div>;
  if (data === undefined) return <div style={S.wrap}><p style={S.muted}>Loading profile…</p></div>;
  if (data === null) {
    return (
      <div style={S.wrap}>
        <h1 style={S.h1}>@{handle}</h1>
        <p style={S.muted}>No creator has claimed this handle yet.</p>
        <Foot />
      </div>
    );
  }

  const verified = !!data.profile?.world_verified;
  const links = data.profile?.links || null;

  return (
    <div style={S.wrap}>
      <div style={S.header}>
        <span style={S.avatar}>{(displayName.replace('@', '')[0] || 'W').toUpperCase()}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 style={S.name}>
            {displayName}
            {verified && <span style={S.verified} title="Verified human with World ID">Verified human ✓</span>}
          </h1>
          {data.profile?.handle && <div style={S.handle}>@{data.profile.handle}</div>}
          {data.profile?.bio && <p style={S.bio}>{data.profile.bio}</p>}
          {links && (
            <div style={S.links}>
              {Object.entries(links).map(([k, v]) => (
                <a key={k} href={v} target="_blank" rel="noreferrer" style={S.linkChip}>{k}</a>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={S.stats}>
        <div style={S.stat}><div style={S.statN}>{data.posts.length}</div><div style={S.statL}>published</div></div>
        <div style={S.stat}><div style={S.statN}>{totalWords.toLocaleString()}</div><div style={S.statL}>words</div></div>
        <div style={S.stat}><div style={S.statN}>{verified ? 'Yes' : '—'}</div><div style={S.statL}>proof of human</div></div>
      </div>

      {data.posts.length > 0 && <WritingHeatmap posts={data.posts} />}

      {data.posts.length === 0 && <p style={S.muted}>No public pieces yet.</p>}

      <div style={S.list}>
        {data.posts.map((p) => <PublicWorkCard key={`${p.chain_id}-${p.entry_id}`} post={p} />)}
      </div>

      <Foot />
    </div>
  );
}

function PublicWorkCard({ post }: { post: CreatorFeedPost }) {
  const active = post.active_seconds != null ? fmtDuration(post.active_seconds) : null;
  const kill = post.kill_ratio != null && post.words_published ? `${Number(post.kill_ratio).toFixed(2)}×` : null;
  const words = post.words_published ?? post.word_count;
  const txUrl = post.transaction_hash ? `${EXPLORER_BASE}/tx/${post.transaction_hash}` : EXPLORER_BASE;
  const when = post.published_at ? new Date(post.published_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';

  return (
    <article style={S.card}>
      <div style={S.cardTop}>
        <div style={{ minWidth: 0 }}>
          <div style={S.cardMeta}>{when}</div>
          {post.title && <h3 style={S.title}><Link to={`/feed/${post.entry_id}`} style={S.titleLink}>{post.title}</Link></h3>}
          {post.excerpt && <p style={S.excerpt}>{post.excerpt}</p>}
        </div>
        {active && (
          <div style={S.scoreBox}>
            <div style={S.scoreNum}>{active}</div>
            <div style={S.scoreLabel}>active writing</div>
          </div>
        )}
      </div>
      <div style={S.stats2}>
        {kill && <span>{kill} words cut</span>}
        {words != null && <span>{Number(words).toLocaleString()} words</span>}
        {!!post.keystrokes && <span>{post.keystrokes.toLocaleString()} keystrokes</span>}
        {!!post.revisions && <span>{post.revisions} revisions</span>}
      </div>
      <div style={S.cardFoot}>
        <a style={S.verify} href={txUrl} target="_blank" rel="noreferrer">Verified on-chain &rarr;</a>
        <Link to={`/feed/${post.entry_id}`} style={S.read}>Read &rarr;</Link>
      </div>
    </article>
  );
}

function Foot() {
  return (
    <div style={S.foot}>
      <Link to="/feed" style={S.link}>HI Feed &rarr;</Link>
      <Link to="/creator" style={S.link}>Prove your own writing &rarr;</Link>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 'min(680px, 94vw)', margin: '32px auto', padding: '0 20px', color: 'var(--hi-text, #0a0a0a)' },
  h1: { fontSize: 20, fontWeight: 700, margin: '0 0 6px' },
  header: { display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap', marginBottom: 16 },
  avatar: { width: 56, height: 56, borderRadius: '50%', background: 'linear-gradient(135deg, #00b4d8, #0096b4)', color: '#fff', fontWeight: 800, fontSize: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  name: { fontSize: 22, fontWeight: 750, margin: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  verified: { fontSize: 10.5, fontWeight: 700, color: '#047857', background: 'rgba(4,120,87,0.1)', borderRadius: 999, padding: '3px 9px', whiteSpace: 'nowrap' },
  handle: { fontSize: 13, color: 'var(--hi-text-muted, #64748b)', marginTop: 2, fontFamily: 'ui-monospace, Menlo, monospace' },
  bio: { fontSize: 14, color: 'var(--hi-text-dim, #334155)', margin: '8px 0 0', lineHeight: 1.55 },
  links: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 },
  linkChip: { fontSize: 12, fontWeight: 600, color: '#0096b4', textDecoration: 'none', background: 'var(--hi-cyan-soft, rgba(0,180,216,0.12))', borderRadius: 999, padding: '3px 10px' },

  stats: { display: 'flex', gap: 10, margin: '4px 0 18px' },
  stat: { flex: 1, border: '1px solid var(--hi-border, #e6e9ee)', borderRadius: 12, padding: '12px 8px', textAlign: 'center', background: 'var(--hi-surface, #fff)' },
  statN: { fontSize: 22, fontWeight: 800, color: 'var(--hi-cyan, #00b4d8)', fontVariantNumeric: 'tabular-nums' },
  statL: { fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--hi-text-muted, #64748b)', marginTop: 2 },

  list: { display: 'flex', flexDirection: 'column', gap: 12 },
  card: { border: '1px solid var(--hi-border, #e6e9ee)', borderRadius: 12, padding: 18, background: 'var(--hi-surface, #fff)' },
  cardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  cardMeta: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--hi-text-muted, #64748b)', flexWrap: 'wrap' },
  title: { fontSize: 16.5, fontWeight: 700, margin: '8px 0 4px', lineHeight: 1.3 },
  titleLink: { color: 'inherit', textDecoration: 'none' },
  excerpt: { fontSize: 13, color: 'var(--hi-text-dim, #334155)', margin: '4px 0 0', lineHeight: 1.5 },
  scoreBox: { textAlign: 'center', flexShrink: 0 },
  scoreNum: { fontSize: 17, fontWeight: 800, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums', color: 'var(--hi-cyan-ink, #075985)', whiteSpace: 'nowrap' },
  scoreLabel: { fontSize: 8.5, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--hi-text-muted, #64748b)', marginTop: 1 },
  stats2: { display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: 'var(--hi-text-muted, #64748b)', margin: '12px 0 0', fontWeight: 600 },
  cardFoot: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--hi-border, #e6e9ee)' },
  verify: { color: '#0096b4', fontSize: 12.5, fontWeight: 700, textDecoration: 'none' },
  read: { color: '#0096b4', fontSize: 12.5, fontWeight: 700, textDecoration: 'none' },

  muted: { fontSize: 13, color: 'var(--hi-text-muted, #64748b)', margin: '10px 0', lineHeight: 1.5 },
  error: { fontSize: 13, color: '#b91c1c', margin: '10px 0' },
  link: { color: '#0096b4', fontSize: 13, textDecoration: 'none', fontWeight: 600 },
  foot: { marginTop: 22, paddingTop: 14, borderTop: '1px solid var(--hi-border, #e6e9ee)', display: 'flex', gap: 18, flexWrap: 'wrap' },
};
