import { useCallback, useState } from 'react';
import type { AppWorldProof, WorldIdUiError } from '../worldid/types';

interface UseWorldIDReturn {
  isVerified: boolean;
  worldIdProof: AppWorldProof | null;
  error: WorldIdUiError | null;
  isLoading: boolean;
  verifyWorldID: () => void;
  resetVerification: () => void;
  handleVerify: (proof: AppWorldProof) => Promise<void>;
  handleError: (error: WorldIdUiError) => void;
}

export const useWorldID = (): UseWorldIDReturn => {
  const [isVerified, setIsVerified] = useState(false);
  const [worldIdProof, setWorldIdProof] = useState<AppWorldProof | null>(null);
  const [error, setError] = useState<WorldIdUiError | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleVerify = useCallback(async (proof: AppWorldProof) => {
    setIsLoading(true);
    try {
      console.log('World ID verification successful:', proof);
      setWorldIdProof(proof);
      setIsVerified(true);
      setError(null);
    } catch (err) {
      console.error('Verification failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleError = useCallback((next: WorldIdUiError) => {
    console.error('World ID verification failed:', next);
    if (!next.message) {
      setError(null);
    } else {
      setError(next);
    }
    setIsVerified(false);
    setWorldIdProof(null);
    setIsLoading(false);
  }, []);

  const verifyWorldID = useCallback(() => {
    setIsLoading(true);
    setError(null);
    console.log('Initiating World ID verification...');
  }, []);

  const resetVerification = useCallback(() => {
    setIsVerified(false);
    setWorldIdProof(null);
    setError(null);
    setIsLoading(false);
    console.log('World ID verification reset');
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
  };
};
