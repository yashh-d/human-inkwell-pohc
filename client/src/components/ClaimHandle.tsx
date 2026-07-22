/**
 * ClaimHandle — step 2 of creating a creator account.
 *
 * Pick a @handle. That single choice IS the public profile: it becomes the URL
 * at /c/<handle> and the display name. Reuses updateCreatorProfile, which reports
 * handleTaken without failing so we can nudge for another.
 */
import { useMemo, useState } from 'react';
import { updateCreatorProfile } from '../creatorSupabase';

const normalize = (v: string) => v.replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 40);

export default function ClaimHandle({
  address,
  suggested = '',
  onDone,
}: { address: string; suggested?: string; onDone: (handle: string) => void }) {
  const [value, setValue] = useState(() => normalize(suggested));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const handle = useMemo(() => normalize(value), [value]);
  const valid = handle.length >= 3;

  const claim = async () => {
    if (!valid || !address) return;
    setSaving(true); setMsg('');
    const res = await updateCreatorProfile({ author_address: address, handle, display_name: handle });
    setSaving(false);
    if (!res.ok) { setMsg(res.error || 'Could not save. Try again.'); return; }
    if (res.handleTaken) { setMsg('That handle is taken — try another.'); return; }
    onDone(handle);
  };

  return (
    <div style={S.card}>
      <div style={S.step}>Step 2 of 2</div>
      <h2 style={S.h}>Claim your handle</h2>
      <p style={S.sub}>This is your public profile — people will find your work at <b>humanink.xyz/c/{handle || 'yourname'}</b></p>
      <div style={S.row}>
        <span style={S.at}>@</span>
        <input
          style={S.input} value={handle} maxLength={40} autoFocus placeholder="yourname"
          onChange={(e) => setValue(normalize(e.target.value))}
          onKeyDown={(e) => { if (e.key === 'Enter') claim(); }}
        />
      </div>
      <button style={S.btn} onClick={claim} disabled={!valid || saving}>
        {saving ? 'Claiming…' : 'Claim and finish'}
      </button>
      {!valid && handle.length > 0 && <p style={S.hint}>At least 3 characters — letters, numbers, underscores.</p>}
      {msg && <p style={S.err}>{msg}</p>}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  card: { border: '1px solid var(--hi-border, #e6e9ee)', borderRadius: 14, padding: '24px 22px', background: 'var(--hi-surface, #fff)', maxWidth: 420, margin: '8px auto', textAlign: 'center' },
  step: { fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--hi-cyan-ink, #075985)' },
  h: { fontSize: 20, fontWeight: 750, margin: '8px 0 6px', color: 'var(--hi-text, #0a0a0a)' },
  sub: { fontSize: 13, color: 'var(--hi-text-muted, #64748b)', margin: '0 0 16px', lineHeight: 1.55 },
  row: { display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--hi-border, #e6e9ee)', borderRadius: 10, padding: '2px 12px', background: 'var(--hi-surface, #fff)', margin: '0 0 12px' },
  at: { fontSize: 18, fontWeight: 700, color: 'var(--hi-text-muted, #64748b)' },
  input: { flex: 1, minWidth: 0, padding: '11px 4px', border: 'none', outline: 'none', background: 'transparent', color: 'inherit', fontSize: 17, fontWeight: 700, fontFamily: 'inherit' },
  btn: { width: '100%', color: '#fff', background: 'var(--hi-cyan, #00b4d8)', fontSize: 15, fontWeight: 700, border: 'none', borderRadius: 10, padding: '12px 16px', cursor: 'pointer' },
  hint: { fontSize: 11.5, color: 'var(--hi-text-muted, #64748b)', margin: '10px 0 0' },
  err: { fontSize: 12.5, color: '#b91c1c', margin: '10px 0 0' },
};
