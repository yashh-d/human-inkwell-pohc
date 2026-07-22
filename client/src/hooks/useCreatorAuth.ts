import { useCallback, useState } from 'react';
import { useLoginWithOAuth } from '@privy-io/react-auth';
import { useViewerAddress } from './useViewerAddress';
import { useMiniKit } from './useMiniKit';

/**
 * useCreatorAuth — one-tap creator sign-in.
 *
 * The whole point of the creator flow: no seed phrases, no World ID wall. In a
 * normal browser that means Privy Google login (which silently mints an embedded
 * wallet — see index.tsx). Inside World App we use the MiniKit walletAuth the
 * viewer hook already exposes. Either way the caller just gets `address` once
 * `ready`, and calls `signIn()` to start.
 */
export function useCreatorAuth() {
  const identity = useViewerAddress();
  const { isInWorldApp } = useMiniKit();
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  const { initOAuth } = useLoginWithOAuth({
    onError: (err) => {
      setSigningIn(false);
      setError(typeof err === 'string' ? err : 'Google sign-in failed.');
    },
  });

  const address = identity.status === 'ready' ? identity.address : '';
  const ready = identity.status === 'ready';

  const signIn = useCallback(async () => {
    setError(null);
    if (isInWorldApp) {
      // World App: one-tap walletAuth (already wired in useViewerAddress).
      try { await identity.authenticate(); } catch { setError('Could not sign in with World App.'); }
      return;
    }
    setSigningIn(true);
    try { await initOAuth({ provider: 'google' }); }
    catch { setSigningIn(false); setError('Google sign-in failed.'); }
  }, [isInWorldApp, identity, initOAuth]);

  return {
    address,
    ready,
    loading: identity.status === 'loading',
    signIn,
    signingIn,
    isInWorldApp,
    error: error || identity.authError || null,
  };
}
