import React from 'react';
import ReactDOM from 'react-dom/client';
import { PrivyProvider } from '@privy-io/react-auth';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <React.StrictMode>
    <PrivyProvider
      appId={process.env.REACT_APP_PRIVY_APP_ID || process.env.REACT_APP_PRIVY_ID || ''}
      config={{
        loginMethods: ['email', 'wallet', 'google'],
        appearance: {
          theme: 'light',
          accentColor: '#121212',
          logo: 'https://worldcoin.org/logo.png', // Temporary placeholder for logo
        },
        // We will natively use default Privy wallet rules to let it infer creation based on email/social login
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
