import { useEffect, useState } from 'react';
import { MiniKit } from '@worldcoin/minikit-js';
import { isMiniKitBridgeAvailable } from '../utils/miniKitRuntime';

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
 * Uses MiniKit.install() then checks for `window.MiniKit` (same as MiniKit.isInstalled()
 * but without the SDK logging console.error on every call outside World App).
 */
export function useMiniKit(): UseMiniKitReturn {
  const [isInWorldApp, setIsInWorldApp] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [miniKitUser, setMiniKitUser] = useState<MiniKitUser | null>(null);

  useEffect(() => {
    try {
      // MiniKit.install() initialises the SDK and reads window.WorldApp
      MiniKit.install(process.env.REACT_APP_WORLD_APP_ID);

      const installed = isMiniKitBridgeAvailable();
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
        if (process.env.NODE_ENV === 'development') {
          console.debug('[MiniKit] Running inside World App');
        }
      } else if (process.env.NODE_ENV === 'development') {
        console.debug('[MiniKit] Running in standard browser (World App bridge not present)');
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
