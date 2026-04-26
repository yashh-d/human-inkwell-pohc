import { useEffect, useState } from 'react';
import { MiniKit } from '@worldcoin/minikit-js';

interface MiniKitUser {
  walletAddress?: string;
  verificationStatus?: {
    isOrbVerified: boolean;
    isDocumentVerified: boolean;
    isSecureDocumentVerified: boolean;
  };
}

interface UseMiniKitReturn {
  /** True when the app is running inside the World App webview */
  isInWorldApp: boolean;
  /** User info from World App (only available inside World App) */
  miniKitUser: MiniKitUser | null;
  /** Whether MiniKit.install() has been attempted */
  isReady: boolean;
}

/**
 * Safely read user data from window.WorldApp (v1.x API).
 * MiniKit v1.x does NOT have MiniKit.user — the data is on the raw
 * window.WorldApp object that the World App webview injects.
 */
function readWorldAppUser(): MiniKitUser | null {
  try {
    const wa = (window as any).WorldApp;
    if (!wa) return null;
    return {
      walletAddress: wa.wallet_address ?? undefined,
      verificationStatus: wa.verification_status
        ? {
            isOrbVerified: Boolean(wa.verification_status.is_orb_verified),
            isDocumentVerified: Boolean(wa.verification_status.is_document_verified),
            isSecureDocumentVerified: Boolean(wa.verification_status.is_secure_document_verified),
          }
        : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Detects whether the app is running inside the World App.
 *
 * Uses MiniKit.install() + MiniKit.isInstalled() from @worldcoin/minikit-js v1.x.
 * MiniKit.isInstalled() only returns true when the page is loaded inside the
 * World App webview that injects `window.WorldApp`.
 */
export function useMiniKit(): UseMiniKitReturn {
  const [isInWorldApp, setIsInWorldApp] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [miniKitUser, setMiniKitUser] = useState<MiniKitUser | null>(null);

  useEffect(() => {
    try {
      // MiniKit.install() reads window.WorldApp and sets window.MiniKit
      const result = MiniKit.install();
      console.log('[MiniKit] install() result:', result);

      const installed = MiniKit.isInstalled();
      setIsInWorldApp(installed);

      if (installed) {
        // v1.x: user data is on window.WorldApp, NOT MiniKit.user
        const user = readWorldAppUser();
        setMiniKitUser(user);
        console.log('[MiniKit] Running inside World App, user:', user);
      } else {
        console.log('[MiniKit] Running in standard browser');
      }
    } catch (err) {
      console.warn('[MiniKit] install() failed, falling back to browser mode:', err);
      setIsInWorldApp(false);
    } finally {
      setIsReady(true);
    }
  }, []);

  return { isInWorldApp, miniKitUser, isReady };
}
