import { useEffect, useMemo, useState } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useMiniKit } from './useMiniKit';

export type ViewerSource = 'minikit' | 'privy' | 'none';

export type ViewerIdentityState =
  | { status: 'loading'; address: null; source: 'none' }
  | { status: 'ready'; address: string; source: 'minikit' | 'privy' }
  | { status: 'no-wallet'; address: null; source: 'none' };

/**
 * Resolve the wallet address that should anchor "this user's content".
 *
 *   • Inside World App  → MiniKit.user.walletAddress (Safe; same address that
 *                         signs the sendTransaction submission).
 *   • In browser        → Privy embedded wallet (the one we hand to ethers as
 *                         the signer for storeContent).
 *
 * Returns 'loading' while Privy / MiniKit are still hydrating so callers can
 * avoid flashing an empty state on first render.
 */
export function useViewerAddress(): ViewerIdentityState {
  const { isInWorldApp, miniKitUser, isReady: miniKitReady } = useMiniKit();
  const { ready: privyReady, authenticated } = usePrivy();
  const { wallets } = useWallets();
  const [minikitAddrLate, setMinikitAddrLate] = useState<string | null>(null);

  // MiniKit.user may populate after install() finishes; poll once if missing.
  useEffect(() => {
    if (!miniKitReady || !isInWorldApp) return;
    if (miniKitUser?.walletAddress) return;
    let cancelled = false;
    let tries = 0;
    const id = window.setInterval(() => {
      tries += 1;
      const addr = (window as any)?.MiniKit?.user?.walletAddress;
      if (addr && !cancelled) {
        setMinikitAddrLate(String(addr));
        window.clearInterval(id);
      } else if (tries > 20) {
        window.clearInterval(id);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [miniKitReady, isInWorldApp, miniKitUser?.walletAddress]);

  return useMemo<ViewerIdentityState>(() => {
    // Still booting either runtime → loading
    if (!miniKitReady) {
      return { status: 'loading', address: null, source: 'none' };
    }

    if (isInWorldApp) {
      const addr = miniKitUser?.walletAddress || minikitAddrLate;
      if (addr) {
        return { status: 'ready', address: addr.toLowerCase(), source: 'minikit' };
      }
      // World App but address not populated yet → still loading
      return { status: 'loading', address: null, source: 'none' };
    }

    // Browser path → Privy
    if (!privyReady) {
      return { status: 'loading', address: null, source: 'none' };
    }
    if (!authenticated || !wallets || wallets.length === 0) {
      return { status: 'no-wallet', address: null, source: 'none' };
    }
    const privyWallet = wallets.find((w) => w.walletClientType === 'privy') || wallets[0];
    if (!privyWallet?.address) {
      return { status: 'no-wallet', address: null, source: 'none' };
    }
    return { status: 'ready', address: privyWallet.address.toLowerCase(), source: 'privy' };
  }, [miniKitReady, isInWorldApp, miniKitUser?.walletAddress, minikitAddrLate, privyReady, authenticated, wallets]);
}
