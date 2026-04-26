import { useCallback, useState } from 'react';
import { ISuccessResult, IErrorState } from '@worldcoin/idkit';

interface UseWorldIDReturn {
  isVerified: boolean;
  worldIdProof: ISuccessResult | null;
  error: IErrorState | null;
  isLoading: boolean;
  verifyWorldID: () => void;
  resetVerification: () => void;
  handleVerify: (proof: ISuccessResult) => Promise<void>;
  handleError: (error: IErrorState) => void;
}

export const useWorldID = (): UseWorldIDReturn => {
  const [isVerified, setIsVerified] = useState(false);
  const [worldIdProof, setWorldIdProof] = useState<ISuccessResult | null>(null);
  const [error, setError] = useState<IErrorState | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleVerify = useCallback(async (proof: ISuccessResult) => {
    setIsLoading(true);
    try {
      console.log('World ID verification successful:', proof);
      console.log('Merkle Root:', proof.merkle_root);
      console.log('Nullifier Hash:', proof.nullifier_hash);
      console.log('Verification Level:', proof.verification_level);
      
      // Store the proof locally for now
      // In production, you would verify this proof with your backend
      setWorldIdProof(proof);
      setIsVerified(true);
      setError(null);
    } catch (err) {
      console.error('Verification failed:', err);
      // Don't manually create error objects - let the IDKit handle errors
      // Instead, just log the error and let handleError be called by IDKit
      console.error('Error in handleVerify:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleError = useCallback((error: IErrorState) => {
    console.error('World ID verification failed:', error);
    setError(error);
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
