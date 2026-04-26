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
  /** User info from MiniKit state (only available inside World App) */
  miniKitUser: MiniKitUser | null;
  /** Whether MiniKit.install() has been attempted */
  isReady: boolean;
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
      // MiniKit.install() initialises the SDK and reads window.WorldApp
      MiniKit.install(process.env.REACT_APP_WORLD_APP_ID);

      const installed = MiniKit.isInstalled();
      setIsInWorldApp(installed);

      if (installed) {
        // Read user state populated by MiniKit at init
        const user = (MiniKit as any).user;
        if (user) {
          setMiniKitUser({
            walletAddress: user.walletAddress,
            verificationStatus: user.verificationStatus
              ? {
                  isOrbVerified: user.verificationStatus.isOrbVerified ?? false,
                  isDocumentVerified: user.verificationStatus.isDocumentVerified ?? false,
                  isSecureDocumentVerified: user.verificationStatus.isSecureDocumentVerified ?? false,
                }
              : undefined,
          });
        }
        console.log('[MiniKit] Running inside World App');
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
