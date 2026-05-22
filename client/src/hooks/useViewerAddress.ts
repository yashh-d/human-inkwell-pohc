import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { MiniKit } from '@worldcoin/minikit-js';
import { useMiniKit } from './useMiniKit';
import {
  getRememberedMiniKitWallet,
  rememberMiniKitWallet,
} from '../utils/miniKitWallet';

export type ViewerSource = 'minikit' | 'privy' | 'none';

export type ViewerIdentityState =
  | {
      status: 'loading';
      address: null;
      source: 'none';
      authenticate: () => Promise<void>;
      authError: string | null;
    }
  | {
      status: 'ready';
      address: string;
      source: 'minikit' | 'privy';
      authenticate: () => Promise<void>;
      authError: string | null;
    }
  | {
      status: 'no-wallet';
      address: null;
      source: 'none';
      authenticate: () => Promise<void>;
      authError: string | null;
    }
  | {
      /** World App, but the wallet address isn't known yet — user can tap to walletAuth. */
      status: 'needs-auth';
      address: null;
      source: 'minikit';
      authenticate: () => Promise<void>;
      authError: string | null;
      isAuthenticating: boolean;
    };

const MINIKIT_ADDR_TIMEOUT_MS = 1500;

/**
 * Resolve the wallet address that should anchor "this user's content".
 *
 *   • Inside World App  → MiniKit.user.walletAddress, or a remembered address
 *                         from a prior successful tx / walletAuth. If neither,
 *                         expose 'needs-auth' so the UI can prompt for a
 *                         one-tap walletAuth.
 *   • In browser        → Privy embedded wallet (the signer for storeContent).
 */
export function useViewerAddress(): ViewerIdentityState {
  const { isInWorldApp, miniKitUser, isReady: miniKitReady } = useMiniKit();
  const { ready: privyReady, authenticated } = usePrivy();
  const { wallets } = useWallets();

  const [minikitAddr, setMinikitAddr] = useState<string | null>(() =>
    getRememberedMiniKitWallet()
  );
  const [pollDone, setPollDone] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState<boolean>(false);
  const pollStartedRef = useRef<boolean>(false);

  // Adopt whatever MiniKit reports as soon as it's available, persist it for
  // future cold loads.
  useEffect(() => {
    if (!isInWorldApp) return;
    const addr = miniKitUser?.walletAddress;
    if (addr) {
      setMinikitAddr(addr.toLowerCase());
      rememberMiniKitWallet(addr);
    }
  }, [isInWorldApp, miniKitUser?.walletAddress]);

  // After install, MiniKit.user may populate a moment later. Poll briefly and
  // stop — if we still don't have an address we'll surface 'needs-auth'.
  useEffect(() => {
    if (!miniKitReady || !isInWorldApp) return;
    if (minikitAddr) return;
    if (pollStartedRef.current) return;
    pollStartedRef.current = true;

    let cancelled = false;
    const t0 = Date.now();
    const id = window.setInterval(() => {
      const addr = (window as any)?.MiniKit?.user?.walletAddress;
      if (addr && !cancelled) {
        setMinikitAddr(String(addr).toLowerCase());
        rememberMiniKitWallet(String(addr));
        window.clearInterval(id);
        setPollDone(true);
      } else if (Date.now() - t0 >= MINIKIT_ADDR_TIMEOUT_MS) {
        window.clearInterval(id);
        if (!cancelled) setPollDone(true);
      }
    }, 150);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [miniKitReady, isInWorldApp, minikitAddr]);

  const authenticate = useCallback(async () => {
    if (!isInWorldApp) {
      setAuthError('walletAuth is only available inside World App.');
      return;
    }
    setAuthError(null);
    setIsAuthenticating(true);
    try {
      const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
      const { finalPayload } = await MiniKit.commandsAsync.walletAuth({
        nonce,
        statement: 'Sign in to view your Human Inkwell content.',
        expirationTime: new Date(Date.now() + 5 * 60 * 1000),
      });
      if (finalPayload?.status === 'success' && (finalPayload as any).address) {
        const addr = String((finalPayload as any).address).toLowerCase();
        setMinikitAddr(addr);
        rememberMiniKitWallet(addr);
      } else {
        const errPayload = finalPayload as any;
        setAuthError(errPayload?.details || errPayload?.error_code || 'walletAuth was cancelled.');
      }
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsAuthenticating(false);
    }
  }, [isInWorldApp]);

  return useMemo<ViewerIdentityState>(() => {
    const base = { authenticate, authError };

    if (!miniKitReady) {
      return { status: 'loading', address: null, source: 'none', ...base };
    }

    if (isInWorldApp) {
      if (minikitAddr) {
        return {
          status: 'ready',
          address: minikitAddr.toLowerCase(),
          source: 'minikit',
          ...base,
        };
      }
      if (!pollDone) {
        return { status: 'loading', address: null, source: 'none', ...base };
      }
      return {
        status: 'needs-auth',
        address: null,
        source: 'minikit',
        isAuthenticating,
        ...base,
      };
    }

    // Browser → Privy
    if (!privyReady) {
      return { status: 'loading', address: null, source: 'none', ...base };
    }
    if (!authenticated || !wallets || wallets.length === 0) {
      return { status: 'no-wallet', address: null, source: 'none', ...base };
    }
    const privyWallet = wallets.find((w) => w.walletClientType === 'privy') || wallets[0];
    if (!privyWallet?.address) {
      return { status: 'no-wallet', address: null, source: 'none', ...base };
    }
    return {
      status: 'ready',
      address: privyWallet.address.toLowerCase(),
      source: 'privy',
      ...base,
    };
  }, [
    miniKitReady,
    isInWorldApp,
    minikitAddr,
    pollDone,
    privyReady,
    authenticated,
    wallets,
    authenticate,
    authError,
    isAuthenticating,
  ]);
}
