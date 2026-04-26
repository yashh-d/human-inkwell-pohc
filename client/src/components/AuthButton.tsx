import React from 'react';
import { usePrivy, useLoginWithSiwe } from '@privy-io/react-auth';
import { MiniKit } from '@worldcoin/minikit-js';
import { useMiniKit } from '../hooks/useMiniKit';

const AuthButton: React.FC = () => {
  const { ready, authenticated, user, logout, login } = usePrivy();
  const { generateSiweNonce, loginWithSiwe } = useLoginWithSiwe();
  const { isInWorldApp } = useMiniKit();

  const handleLogin = async () => {
    if (isInWorldApp) {
      try {
        // Get nonce from Privy
        const privyNonce = await generateSiweNonce();
        
        // Request signature from World wallet
        const { finalPayload } = await MiniKit.commandsAsync.walletAuth({
          nonce: privyNonce,
        });
        
        if (finalPayload.status === 'error') {
          console.error('WalletAuth Error', finalPayload);
          return;
        }

        // Log in with Privy using the returned World App Signature
        await loginWithSiwe({
          message: finalPayload.message,
          signature: finalPayload.signature,
        });
      } catch (err) {
        console.error("SIWE MiniKit execution error", err);
      }
    } else {
      // Standard Privy login overlay for Desktop/Browser users
      login();
    }
  };

  if (!ready) {
    return <button className="hi-btn hi-btn--secondary" disabled>...</button>;
  }

  if (authenticated && user) {
    const defaultWallet = user.wallet?.address;
    const email = user.email?.address;
    const identifier = defaultWallet 
      ? `${defaultWallet.slice(0, 6)}...${defaultWallet.slice(-4)}` 
      : email || 'Disconnect';
      
    return (
      <button 
        className="hi-btn hi-btn--secondary" 
        onClick={logout}
        style={{ fontSize: '0.85rem', padding: '0.5rem 1rem' }}
      >
        {identifier}
      </button>
    );
  }

  return (
    <button 
      className="hi-btn hi-btn--primary" 
      onClick={handleLogin}
      style={{ fontSize: '0.85rem', padding: '0.5rem 1rem' }}
    >
      Sign In
    </button>
  );
};

export default AuthButton;
