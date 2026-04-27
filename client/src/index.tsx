import React from 'react';
import ReactDOM from 'react-dom/client';
import { PrivyProvider } from '@privy-io/react-auth';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
const customWorldChainSepolia = {
  id: 4801,
  name: 'World Chain Sepolia',
  network: 'worldchain-sepolia',
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: { http: ['https://worldchain-sepolia.g.alchemy.com/v2/aNN20MJY-ezG6QnhrHDZW'] },
    public: { http: ['https://worldchain-sepolia.g.alchemy.com/v2/aNN20MJY-ezG6QnhrHDZW'] },
  },
  blockExplorers: {
    default: { name: 'Worldscan', url: 'https://sepolia.worldscan.org' },
  },
} as any;

root.render(
  <React.StrictMode>
    <PrivyProvider
      appId={process.env.REACT_APP_PRIVY_APP_ID || process.env.REACT_APP_PRIVY_ID || ''}
      config={{
        defaultChain: customWorldChainSepolia,
        supportedChains: [customWorldChainSepolia],
        loginMethods: ['email', 'google'],
        embeddedWallets: {
          ethereum: {
            createOnLogin: 'users-without-wallets',
          },
        },
        externalWallets: {
          coinbaseWallet: {
            // @ts-ignore - privy types mismatch
            options: 'eoaOnly', // 4801 (World Chain Sepolia) is not supported by Smart Wallet yet
          },
        },
        appearance: {
          theme: 'light',
          accentColor: '#121212',
          logo: 'https://worldcoin.org/logo.png', // Temporary placeholder for logo
        },
      }}
    >
      <App />
    </PrivyProvider>
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
