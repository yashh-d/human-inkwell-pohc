/**
 * /badge — the embeddable "verified human writing" stamp.
 *
 * A bare, self-contained card meant to live inside an <iframe> on a creator's
 * Substack, newsletter or site. It reads its numbers from the query string and
 * links out to the on-chain attestation — the transaction is the source of
 * truth, the stamp is the verifiable wrapper. Neutral product styling to match
 * /publish: no emojis, no gamification. No app chrome, no wallet, no network.
 */
import { useMemo } from 'react';
import { EXPLORER_BASE } from '../lib/chain';

function useParams() {
  return useMemo(() => new URLSearchParams(window.location.search), []);
}

function bandColor(score: number): string {
  return score >= 60 ? '#047857' : score >= 30 ? '#b45309' : '#b91c1c';
}

export default function CreatorBadge() {
  const q = useParams();
  const score = Math.max(0, Math.min(100, parseInt(q.get('g') || '0', 10) || 0));
  const title = q.get('ti') || '';
  const tx = q.get('tx') || '';
  const entry = q.get('id') || '';
  const color = bandColor(score);
  const verifyUrl = tx ? `${EXPLORER_BASE}/tx/${tx}` : EXPLORER_BASE;

  return (
    <a href={verifyUrl} target="_blank" rel="noreferrer" style={{ ...styles.card, textDecoration: 'none' }}>
      <div style={styles.left}>
        <div style={styles.brand}>Human Ink</div>
        <div style={styles.line}>Proof of human writing</div>
        {title && <div style={styles.title}>{title}</div>}
        <div style={styles.sub}>
          <span>Verified on-chain{entry ? ` · #${entry}` : ''}</span>
          <span style={styles.verify}>Verify &rarr;</span>
        </div>
      </div>
      <div style={styles.right}>
        <div style={{ ...styles.score, color }}>{score}</div>
        <div style={styles.scoreLabel}>Grind Score</div>
        <div style={styles.barWrap}><div style={{ ...styles.barFill, width: `${score}%`, background: color }} /></div>
      </div>
    </a>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
    boxSizing: 'border-box', width: 'fit-content', maxWidth: '100%', minWidth: 300,
    padding: '14px 18px', margin: 4, borderRadius: 12, border: '1px solid #e6e9ee',
    background: '#ffffff', color: '#0a0a0a',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    boxShadow: '0 1px 3px rgba(15,23,42,0.08)', cursor: 'pointer',
  },
  left: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 },
  brand: { fontSize: 14, fontWeight: 800, letterSpacing: 0.2 },
  line: { fontSize: 11, color: '#64748b' },
  title: { fontSize: 12.5, fontWeight: 600, marginTop: 4, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  sub: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: '#64748b', marginTop: 6, flexWrap: 'wrap' },
  verify: { color: '#0096b4', fontWeight: 700 },
  right: { textAlign: 'center', flexShrink: 0 },
  score: { fontSize: 34, fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums' },
  scoreLabel: { fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.6, color: '#64748b', marginTop: 2 },
  barWrap: { height: 5, width: 72, borderRadius: 999, background: '#eef1f5', overflow: 'hidden', marginTop: 6 },
  barFill: { height: '100%', borderRadius: 999 },
};
