import React, { useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useViewerAddress } from '../hooks/useViewerAddress';
import { fetchCreatorProfile } from '../creatorSupabase';
import { forgetMiniKitWallet } from '../utils/miniKitWallet';

/**
 * The signed-in creator's identity + sign-out control for the top-right of
 * SiteNav. Renders nothing until an identity resolves, so signed-out marketing
 * visitors see the plain nav. Name preference: profile display_name → handle →
 * Google/email username → short wallet address.
 *
 * Sign out clears both auth sources (Privy session + any remembered World App
 * wallet) and returns home so the app fully resets.
 */
const CreatorNavAuth: React.FC = () => {
  const { authenticated, user, logout } = usePrivy();
  const identity = useViewerAddress();
  const address = identity.status === 'ready' ? identity.address : '';

  const email =
    (user?.email?.address as string) || ((user as any)?.google?.email as string) || '';
  const emailName = email ? email.split('@')[0] : '';
  const shortAddr = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '';

  const [profileName, setProfileName] = useState('');

  useEffect(() => {
    if (!address) {
      setProfileName('');
      return;
    }
    let alive = true;
    fetchCreatorProfile(address)
      .then((res) => {
        if (!alive) return;
        setProfileName(res?.profile?.display_name || res?.profile?.handle || '');
      })
      .catch(() => alive && setProfileName(''));
    return () => {
      alive = false;
    };
  }, [address]);

  // Nothing to show until there's a real signed-in identity.
  const signedIn = authenticated || identity.status === 'ready';
  if (!signedIn) return null;

  const name = profileName || emailName || shortAddr || 'Signed in';

  const signOut = async () => {
    try {
      await logout();
    } catch {
      /* not a Privy session (e.g. World App) — fall through */
    }
    forgetMiniKitWallet();
    window.location.assign('/');
  };

  return (
    <span style={wrap}>
      <span style={chip} title={email || address}>
        <span style={dot} aria-hidden />
        {name}
      </span>
      <button style={signBtn} onClick={signOut}>
        Sign out
      </button>
    </span>
  );
};

const wrap: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 8 };
const chip: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 7, maxWidth: 180,
  fontSize: 13, fontWeight: 600, color: '#0b0d0e',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
const dot: React.CSSProperties = {
  width: 7, height: 7, borderRadius: 999, background: '#00b4d8', flex: '0 0 auto',
};
const signBtn: React.CSSProperties = {
  padding: '7px 12px', borderRadius: 9, border: '1px solid rgba(11,13,14,0.14)',
  background: '#fff', color: '#0b0d0e', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  fontFamily: "'Space Grotesk','Inter',system-ui,sans-serif", whiteSpace: 'nowrap',
};

export default CreatorNavAuth;
