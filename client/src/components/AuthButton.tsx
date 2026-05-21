import React from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useMiniKit } from '../hooks/useMiniKit';

const AuthButton: React.FC = () => {
  const { ready, authenticated, user, logout, login } = usePrivy();
  const { isInWorldApp, isReady: miniKitReady } = useMiniKit();

  if (miniKitReady && isInWorldApp) {
    return null;
  }

  const handleLogin = () => {
    login();
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
