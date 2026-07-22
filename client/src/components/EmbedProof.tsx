/**
 * EmbedProof — the copy-paste <iframe> for a verified-human piece.
 *
 * Renders a live preview of the /badge Craft Card (in a real iframe, exactly as a
 * reader would see it embedded) plus the snippet a creator drops into their
 * Substack / newsletter / site. The card fetches its receipts by on-chain entry
 * id, so the proof can't be forged in the embed code.
 *
 * Only makes sense for pieces on the public HI Feed — /badge reads the public
 * feed API. Gate the caller on is_public.
 */
import { useMemo, useState } from 'react';

export default function EmbedProof({ entryId, height = 190 }: { entryId: number | string; height?: number }) {
  const [copied, setCopied] = useState(false);

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://humanink.xyz';
  const src = `${origin}/badge?id=${encodeURIComponent(String(entryId))}`;
  const snippet = useMemo(
    () => `<iframe src="${src}" width="360" height="${height}" style="border:0;overflow:hidden" title="Verified human-written — Human Ink" loading="lazy"></iframe>`,
    [src, height],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div style={S.wrap}>
      <div style={S.previewFrame}>
        <iframe
          src={src}
          title="Verified human-written — Human Ink"
          style={{ width: '100%', height, border: 0, display: 'block', background: 'transparent' }}
          loading="lazy"
        />
      </div>

      <div style={S.snippetRow}>
        <code style={S.code}>{snippet}</code>
        <button style={S.copyBtn} onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <p style={S.hint}>Paste this where you publish. The card verifies itself on-chain — nothing to keep in sync.</p>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 },
  previewFrame: { borderRadius: 12, background: 'var(--hi-surface-muted, #f4f6f9)', padding: 10, border: '1px solid var(--hi-border, #e6e9ee)' },
  snippetRow: { display: 'flex', gap: 8, alignItems: 'stretch' },
  code: { flex: 1, minWidth: 0, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11.5, lineHeight: 1.4, color: 'var(--hi-text-dim, #334155)', background: 'var(--hi-surface-muted, #f4f6f9)', border: '1px solid var(--hi-border, #e6e9ee)', borderRadius: 8, padding: '8px 10px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' },
  copyBtn: { flexShrink: 0, alignSelf: 'flex-start', color: '#fff', background: 'var(--hi-cyan, #00b4d8)', fontSize: 12.5, fontWeight: 650, border: 'none', borderRadius: 8, padding: '8px 14px', cursor: 'pointer' },
  hint: { fontSize: 11.5, color: 'var(--hi-text-muted, #64748b)', margin: 0, lineHeight: 1.5 },
};
