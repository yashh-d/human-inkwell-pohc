/**
 * VerifiedHumanOptIn — the OPTIONAL "Verified human" badge for a creator.
 *
 * Creators sign up with Privy alone; proof-of-personhood is never a gate. This
 * lets them add a World ID ✓ to their profile whenever they want. On a successful
 * verification we persist world_verified on their profile so it shows on /c/<handle>.
 */
import { useEffect, useState } from 'react';
import { useWorldID } from '../hooks/useWorldID';
import { useMiniKit } from '../hooks/useMiniKit';
import WorldIDWidget from './WorldIDWidget';
import { updateCreatorProfile } from '../creatorSupabase';

export default function VerifiedHumanOptIn({
  address,
  verified,
  onVerified,
}: { address: string; verified: boolean; onVerified: () => void }) {
  const { isInWorldApp } = useMiniKit();
  const world = useWorldID();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  // Persist the badge once World ID confirms personhood.
  useEffect(() => {
    if (!world.isVerified || saved || !address) return;
    setSaved(true);
    updateCreatorProfile({ author_address: address, world_verified: true })
      .then((r) => { if (r.ok) onVerified(); })
      .catch(() => { /* stays unverified; they can retry */ });
  }, [world.isVerified, saved, address, onVerified]);

  if (verified) {
    return (
      <div style={S.row}>
        <span style={S.badge}>Verified human ✓</span>
        <span style={S.note}>World ID proof of personhood is on your public profile.</span>
      </div>
    );
  }

  return (
    <div style={S.wrap}>
      <div style={S.row}>
        <div>
          <div style={S.title}>Add a “Verified human” badge <span style={S.opt}>optional</span></div>
          <div style={S.note}>Prove you’re a real person with World ID. Shows a ✓ on your public profile.</div>
        </div>
        {!open && <button style={S.btn} onClick={() => setOpen(true)}>Add badge</button>}
      </div>
      {open && (
        <div style={S.widget}>
          <WorldIDWidget
            isVerified={world.isVerified}
            worldIdProof={world.worldIdProof}
            error={world.error}
            isLoading={world.isLoading}
            onVerify={world.handleVerify}
            onError={world.handleError}
            onVerifyMiniKit={world.verifyViaMiniKit}
            isInWorldApp={isInWorldApp}
          />
        </div>
      )}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { border: '1px solid var(--hi-border, #e6e9ee)', borderRadius: 12, padding: '14px 16px', background: 'var(--hi-surface, #fff)', margin: '0 0 18px' },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  title: { fontSize: 13.5, fontWeight: 700, color: 'var(--hi-text, #0a0a0a)' },
  opt: { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--hi-text-muted, #64748b)', marginLeft: 6 },
  note: { fontSize: 12, color: 'var(--hi-text-muted, #64748b)', marginTop: 2, lineHeight: 1.5 },
  btn: { flexShrink: 0, color: '#fff', background: 'var(--hi-cyan, #00b4d8)', fontSize: 13, fontWeight: 650, border: 'none', borderRadius: 8, padding: '9px 14px', cursor: 'pointer' },
  widget: { marginTop: 12 },
  badge: { fontSize: 12, fontWeight: 700, color: '#047857', background: 'rgba(4,120,87,0.1)', borderRadius: 999, padding: '4px 11px' },
};
