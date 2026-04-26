import { useCallback, useState } from 'react';
import { ISuccessResult, IErrorState } from '@worldcoin/idkit';
import {
  MiniKit,
  VerificationLevel as MiniKitVerificationLevel,
  type MiniAppVerifyActionSuccessPayload,
} from '@worldcoin/minikit-js';

interface UseWorldIDReturn {
  isVerified: boolean;
  worldIdProof: ISuccessResult | null;
  error: IErrorState | null;
  isLoading: boolean;
  /** Trigger verification — only meaningful for MiniKit path; IDKit uses widget open(). */
  verifyWorldID: () => void;
  resetVerification: () => void;
  /** IDKit widget success callback */
  handleVerify: (proof: ISuccessResult) => Promise<void>;
  /** IDKit widget error callback */
  handleError: (error: IErrorState) => void;
  /** Trigger MiniKit native verify inside World App */
  verifyViaMiniKit: () => Promise<void>;
}

/**
 * Unified World ID hook that works with both:
 *  - IDKit widget (standard browser)
 *  - MiniKit.commandsAsync.verify() (inside World App)
 *
 * Consumers should check `isInWorldApp` (from useMiniKit) to decide which
 * trigger to call:
 *   - Browser  → render <IDKitWidget> which calls handleVerify/handleError
 *   - WorldApp → call verifyViaMiniKit() directly from a button
 */
export const useWorldID = (): UseWorldIDReturn => {
  const [isVerified, setIsVerified] = useState(false);
  const [worldIdProof, setWorldIdProof] = useState<ISuccessResult | null>(null);
  const [error, setError] = useState<IErrorState | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // ─── IDKit widget callbacks (browser path, unchanged) ───────────────

  const handleVerify = useCallback(async (proof: ISuccessResult) => {
    setIsLoading(true);
    try {
      console.log('[WorldID/IDKit] Verification successful:', proof);
      console.log('  Merkle Root:', proof.merkle_root);
      console.log('  Nullifier Hash:', proof.nullifier_hash);
      console.log('  Verification Level:', proof.verification_level);

      setWorldIdProof(proof);
      setIsVerified(true);
      setError(null);
    } catch (err) {
      console.error('[WorldID/IDKit] Error in handleVerify:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleError = useCallback((error: IErrorState) => {
    console.error('[WorldID/IDKit] Verification error:', error);
    setError(error);
    setIsVerified(false);
    setWorldIdProof(null);
    setIsLoading(false);
  }, []);

  const verifyWorldID = useCallback(() => {
    setIsLoading(true);
    setError(null);
    console.log('[WorldID] Initiating verification…');
  }, []);

  // ─── MiniKit native verify (World App path) ────────────────────────

  const verifyViaMiniKit = useCallback(async () => {
    if (!MiniKit.isInstalled()) {
      console.error('[WorldID/MiniKit] MiniKit is not installed — cannot verify');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const action = process.env.REACT_APP_WORLD_ACTION || 'human-content-verification';
      const levelEnv = process.env.REACT_APP_WORLD_VERIFICATION_LEVEL || 'device';
      const verificationLevel =
        levelEnv === 'orb'
          ? MiniKitVerificationLevel.Orb
          : MiniKitVerificationLevel.Device;

      console.log('[WorldID/MiniKit] Requesting verification…', { action, verificationLevel });

      const { commandPayload, finalPayload } = await MiniKit.commandsAsync.verify({
        action,
        verification_level: verificationLevel,
      });

      console.log('[WorldID/MiniKit] commandPayload:', commandPayload);
      console.log('[WorldID/MiniKit] finalPayload:', finalPayload);

      if (finalPayload.status === 'success') {
        const successPayload = finalPayload as MiniAppVerifyActionSuccessPayload;

        // Normalise into the same ISuccessResult shape used by IDKit
        const proof: ISuccessResult = {
          merkle_root: successPayload.merkle_root,
          nullifier_hash: successPayload.nullifier_hash,
          proof: successPayload.proof,
          verification_level: successPayload.verification_level as any,
        };

        console.log('[WorldID/MiniKit] Verification success, normalised proof:', proof);
        setWorldIdProof(proof);
        setIsVerified(true);
        setError(null);
      } else {
        // Error path
        const errorPayload = finalPayload as { status: 'error'; error_code: string };
        console.error('[WorldID/MiniKit] Verification failed:', errorPayload.error_code);
        setError({
          code: errorPayload.error_code,
          message: `MiniKit verification failed: ${errorPayload.error_code}`,
        } as IErrorState);
        setIsVerified(false);
        setWorldIdProof(null);
      }
    } catch (err) {
      console.error('[WorldID/MiniKit] Unexpected error:', err);
      setError({
        code: 'UNEXPECTED_ERROR',
        message: err instanceof Error ? err.message : 'Unexpected MiniKit error',
      } as unknown as IErrorState);
      setIsVerified(false);
      setWorldIdProof(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // ─── Reset ──────────────────────────────────────────────────────────

  const resetVerification = useCallback(() => {
    setIsVerified(false);
    setWorldIdProof(null);
    setError(null);
    setIsLoading(false);
    console.log('[WorldID] Verification reset');
  }, []);

  return {
    isVerified,
    worldIdProof,
    error,
    isLoading,
    verifyWorldID,
    resetVerification,
    handleVerify,
    handleError,
    verifyViaMiniKit,
  };
};
