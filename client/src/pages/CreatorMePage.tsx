import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePrivy } from '@privy-io/react-auth';
import { useViewerAddress } from '../hooks/useViewerAddress';
import { fetchCreatorProfile, updateCreatorProfile, CreatorFeedPost, CreatorProfileResult } from '../creatorSupabase';
import { EXPLORER_BASE } from '../lib/chain';
import { fmtDuration } from '../lib/receipts';
import WritingHeatmap from '../components/WritingHeatmap';
import EmbedProof from '../components/EmbedProof';
import CreatorSignIn from '../components/CreatorSignIn';
import ClaimHandle from '../components/ClaimHandle';
import VerifiedHumanOptIn from '../components/VerifiedHumanOptIn';

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
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

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

  const startEdit = () => { setNameInput(data?.profile?.display_name || username || ''); setSaveMsg(''); setEditing(true); };
  const saveName = async () => {
    if (!address || !nameInput.trim()) return;
    setSaving(true); setSaveMsg('');
    const name = nameInput.trim();
    const res = await updateCreatorProfile({ author_address: address, display_name: name, handle: name });
    setSaving(false);
    if (res.ok) {
      setData((d) => (d ? { ...d, profile: { ...(d.profile || {}), display_name: name } as any } : d));
      setEditing(false);
      if (res.handleTaken) setSaveMsg('Saved — that handle was taken, so only your display name changed.');
    } else { setSaveMsg(res.error || 'Could not save.'); }
  };

  if (identity.status !== 'ready') {
    return (
      <div style={S.wrap}>
        <CreatorSignIn />
        <div style={S.foot}>
          <Link to="/creator" style={S.link}>Just want to try writing? &rarr;</Link>
          <Link to="/" style={S.link}>&larr; Back to Human Ink</Link>
        </div>
      </div>
    );
  }

  // Step 2: signed in but no handle yet → claim it (creates the public profile).
  const hasHandle = !!data?.profile?.handle;
  if (data && !hasHandle) {
    return (
      <div style={S.wrap}>
        <ClaimHandle
          address={address}
          suggested={username}
          onDone={(handle) => setData((d) => (d ? { ...d, profile: { ...(d.profile || {}), handle, display_name: d.profile?.display_name || handle } as any } : d))}
        />
        <div style={S.foot}><Link to="/" style={S.link}>&larr; Back to Human Ink</Link></div>
      </div>
    );
  }

  return (
    <div style={S.wrap}>
      <div style={S.header}>
        <span style={S.avatar}>{(displayName[0] || 'W').toUpperCase()}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          {editing ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                style={S.input} value={nameInput} maxLength={80} placeholder="Username" autoFocus
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setEditing(false); }}
              />
              <button style={S.newBtn} disabled={saving || !nameInput.trim()} onClick={saveName}>{saving ? 'Saving…' : 'Save'}</button>
              <button style={S.ghostBtn} onClick={() => setEditing(false)}>Cancel</button>
            </div>
          ) : (
            <h1 style={S.name}>
              {displayName}
              <button style={S.editBtn} onClick={startEdit} title="Edit username">Edit</button>
            </h1>
          )}
          <div style={S.sub}>
            {email && <span>{email}</span>}
            {email && <span style={S.dot}>·</span>}
            <span style={S.mono}>{address.slice(0, 6)}…{address.slice(-4)}</span>
          </div>
          {saveMsg && <p style={{ ...S.muted, margin: '4px 0 0' }}>{saveMsg}</p>}
        </div>
        {!editing && <Link to="/creator" style={S.newBtn}>Write a piece</Link>}
      </div>

      {data && (
        <div style={S.stats}>
          <div style={S.stat}><div style={S.statN}>{data.posts.length}</div><div style={S.statL}>pieces</div></div>
          <div style={S.stat}><div style={S.statN}>{onFeed}</div><div style={S.statL}>on HI Feed</div></div>
          <div style={S.stat}><div style={S.statN}>{data.posts.reduce((a, p) => a + (p.word_count || 0), 0).toLocaleString()}</div><div style={S.statL}>words</div></div>
        </div>
      )}

      {data?.profile?.handle && <ProfileShareCard handle={data.profile.handle} />}

      {data && address && (
        <VerifiedHumanOptIn
          address={address}
          verified={!!data.profile?.world_verified}
          onVerified={() => setData((d) => (d ? { ...d, profile: { ...(d.profile || {}), world_verified: true } as any } : d))}
        />
      )}

      {data && data.posts.length > 0 && <WritingHeatmap posts={data.posts} />}

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

function ProfileShareCard({ handle }: { handle: string }) {
  const [copied, setCopied] = useState(false);
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://humanink.xyz';
  const url = `${origin}/c/${handle}`;
  const pretty = url.replace(/^https?:\/\//, '');
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* no-op */ }
  };
  return (
    <div style={S.share}>
      <div style={{ minWidth: 0 }}>
        <div style={S.shareLabel}>Your public profile</div>
        <div style={S.shareUrl}>{pretty}</div>
      </div>
      <div style={S.shareBtns}>
        <button style={S.ghostSm} onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
        <a style={S.newBtn} href={`/c/${handle}`} target="_blank" rel="noreferrer">View</a>
      </div>
    </div>
  );
}

function WorkCard({ post }: { post: CreatorFeedPost }) {
  const [showEmbed, setShowEmbed] = useState(false);
  const active = post.active_seconds != null ? fmtDuration(post.active_seconds) : null;
  const kill = post.kill_ratio != null && post.words_published ? `${Number(post.kill_ratio).toFixed(2)}×` : null;
  const words = post.words_published ?? post.word_count;
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {post.is_public && typeof post.entry_id === 'number' && (
            <button style={S.embedBtn} onClick={() => setShowEmbed((v) => !v)}>{showEmbed ? 'Hide embed' : 'Embed'}</button>
          )}
          {typeof post.entry_id === 'number' && <span style={S.entry}>#{post.entry_id}</span>}
        </div>
      </div>
      {showEmbed && post.is_public && <EmbedProof entryId={post.entry_id} />}
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
  newBtn: { color: '#fff', background: 'var(--hi-cyan, #00b4d8)', fontSize: 13, fontWeight: 650, textDecoration: 'none', padding: '9px 14px', borderRadius: 8, whiteSpace: 'nowrap', border: 'none', cursor: 'pointer' },
  editBtn: { marginLeft: 10, fontSize: 12, fontWeight: 600, color: '#0096b4', background: 'none', border: 'none', cursor: 'pointer', padding: 0, verticalAlign: 'middle' },
  ghostBtn: { fontSize: 13, fontWeight: 600, color: 'var(--hi-text-muted, #64748b)', background: 'none', border: 'none', cursor: 'pointer', padding: '9px 6px' },
  input: { flex: '1 1 160px', minWidth: 0, padding: '9px 12px', borderRadius: 8, border: '1px solid var(--hi-border, #e6e9ee)', background: 'var(--hi-surface, #fff)', color: 'inherit', fontSize: 16, fontWeight: 700, fontFamily: 'inherit', outline: 'none' },
  muted: { fontSize: 13, color: 'var(--hi-text-muted, #64748b)', margin: '10px 0', lineHeight: 1.5 },
  error: { fontSize: 13, color: '#b91c1c', margin: '10px 0' },
  link: { color: '#0096b4', fontSize: 13, textDecoration: 'none', fontWeight: 600 },

  stats: { display: 'flex', gap: 10, margin: '4px 0 18px' },
  stat: { flex: 1, border: '1px solid var(--hi-border, #e6e9ee)', borderRadius: 12, padding: '12px 8px', textAlign: 'center', background: 'var(--hi-surface, #fff)' },
  statN: { fontSize: 22, fontWeight: 800, color: 'var(--hi-cyan, #00b4d8)', fontVariantNumeric: 'tabular-nums' },
  statL: { fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--hi-text-muted, #64748b)', marginTop: 2 },

  share: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', border: '1px solid var(--hi-border, #e6e9ee)', borderRadius: 12, padding: '12px 16px', background: 'var(--hi-cyan-soft, rgba(0,180,216,0.06))', margin: '0 0 12px' },
  shareLabel: { fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--hi-text-muted, #64748b)' },
  shareUrl: { fontSize: 14, fontWeight: 700, color: 'var(--hi-cyan-ink, #075985)', fontFamily: 'ui-monospace, Menlo, monospace', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis' },
  shareBtns: { display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 },
  ghostSm: { fontSize: 12.5, fontWeight: 600, color: '#0096b4', background: 'var(--hi-surface, #fff)', border: '1px solid var(--hi-border, #e6e9ee)', borderRadius: 8, padding: '8px 12px', cursor: 'pointer' },

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
  scoreNum: { fontSize: 17, fontWeight: 800, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums', color: 'var(--hi-cyan-ink, #075985)', whiteSpace: 'nowrap' },
  scoreLabel: { fontSize: 8.5, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--hi-text-muted, #64748b)', marginTop: 1 },
  stats2: { display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: 'var(--hi-text-muted, #64748b)', margin: '12px 0 0', fontWeight: 600 },
  cardFoot: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--hi-border, #e6e9ee)' },
  verify: { color: '#0096b4', fontSize: 12.5, fontWeight: 700, textDecoration: 'none' },
  embedBtn: { fontSize: 12.5, fontWeight: 650, color: '#0096b4', background: 'none', border: 'none', cursor: 'pointer', padding: 0 },
  entry: { fontSize: 11, color: 'var(--hi-text-faint, #94a3b8)', fontFamily: 'ui-monospace, Menlo, monospace' },
  foot: { marginTop: 22, paddingTop: 14, borderTop: '1px solid var(--hi-border, #e6e9ee)', display: 'flex', gap: 18, flexWrap: 'wrap' },
};
