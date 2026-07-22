/**
 * /badge?id=<entryId> — the embeddable Craft Card.
 *
 * A bare, self-contained provenance card meant to live inside an <iframe> on a
 * creator's Substack / newsletter / site. It fetches the piece's RECEIPTS from
 * the feed API by on-chain entry id (so the numbers can't be forged in the URL)
 * and links to the on-chain attestation. Receipts, not scores. No app chrome.
 */
import { useEffect, useMemo, useState } from 'react';
import { fetchCreatorPost, CreatorFeedPost } from '../creatorSupabase';
import { EXPLORER_BASE } from '../lib/chain';
import { fmtDuration } from '../lib/receipts';

function useParams() {
  return useMemo(() => new URLSearchParams(window.location.search), []);
}

export default function CreatorBadge() {
  const q = useParams();
  const id = q.get('id') || '';
  const [post, setPost] = useState<CreatorFeedPost | null | undefined>(undefined);

  useEffect(() => {
    if (!id) { setPost(null); return; }
    let alive = true;
    fetchCreatorPost(id).then((p) => { if (alive) setPost(p); }).catch(() => { if (alive) setPost(null); });
    return () => { alive = false; };
  }, [id]);

  if (post === undefined) return <div style={styles.card}><span style={styles.brand}>Human Ink</span></div>;
  if (post === null) return <div style={styles.card}><span style={styles.brand}>Human Ink</span><span style={styles.line}>Card unavailable</span></div>;

  const txUrl = post.transaction_hash ? `${EXPLORER_BASE}/tx/${post.transaction_hash}` : EXPLORER_BASE;
  const kill = post.kill_ratio != null && post.words_published ? `${Number(post.kill_ratio).toFixed(2)}×` : null;
  const active = post.active_seconds != null ? fmtDuration(post.active_seconds) : null;
  const words = post.words_published != null ? post.words_published : post.word_count;

  const stats: Array<[string, string]> = [];
  if (active) stats.push([active, 'active writing']);
  if (kill) stats.push([kill, 'words cut']);
  if (words != null) stats.push([Number(words).toLocaleString(), 'words']);
  if (post.revisions) stats.push([String(post.revisions), 'revisions']);

  return (
    <a href={txUrl} target="_blank" rel="noreferrer" style={{ ...styles.card, textDecoration: 'none' }}>
      <div style={styles.head}>
        <span style={styles.brand}>Human Ink</span>
        <span style={styles.verify}>✓ Human-written · verified on-chain</span>
      </div>
      {post.title && <div style={styles.title}>{post.title}</div>}
      <div style={styles.stats}>
        {stats.map(([v, l], i) => (
          <div key={i} style={styles.stat}><span style={styles.num}>{v}</span><span style={styles.lbl}>{l}</span></div>
        ))}
      </div>
      <div style={styles.foot}>
        <span style={styles.line}>Proof of human writing</span>
        <span style={styles.verifyLink}>Verify &rarr;</span>
      </div>
    </a>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    display: 'flex', flexDirection: 'column', gap: 10, boxSizing: 'border-box',
    width: 'fit-content', maxWidth: '100%', minWidth: 320, padding: '16px 18px', margin: 4,
    borderRadius: 14, border: '1px solid #e6e9ee', background: '#ffffff', color: '#0a0a0a',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    boxShadow: '0 1px 3px rgba(15,23,42,0.08)', cursor: 'pointer',
  },
  head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
  brand: { fontSize: 14, fontWeight: 800, letterSpacing: 0.2 },
  verify: { fontSize: 10.5, fontWeight: 700, color: '#047857' },
  title: { fontSize: 14, fontWeight: 700, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  stats: { display: 'flex', gap: 20, flexWrap: 'wrap' },
  stat: { display: 'flex', flexDirection: 'column' },
  num: { fontSize: 20, fontWeight: 800, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums', color: '#075985' },
  lbl: { fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 0.5, color: '#64748b', marginTop: 1 },
  foot: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderTop: '1px solid #eef1f5', paddingTop: 8 },
  line: { fontSize: 11, color: '#64748b' },
  verifyLink: { fontSize: 11.5, fontWeight: 700, color: '#0096b4' },
};
