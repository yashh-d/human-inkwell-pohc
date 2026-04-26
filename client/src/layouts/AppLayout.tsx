import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import BrandHeader from '../components/BrandHeader';
import PoweredByWorld from '../components/PoweredByWorld';

const LEDGER_PATH = '/ledger';
const WORKFLOW_PATH = '/workflow';

const SUBTITLE: Record<string, string> = {
  '/': 'Onchain proof that a verified human wrote this content, with biometric typing signatures and World ID attestation on World Chain.',
  [LEDGER_PATH]:
    'Example of a wallet-bound index: a link to the onchain transaction, your content and signature hashes, and a short content preview (session-only; in production, only hashes and the tx are stored).',
  [WORKFLOW_PATH]:
    'End-to-end: World ID, local keystroke capture, hashing, and onchain attestation—plus what stays offchain and out of the contract as plaintext.',
};

const AppLayout: React.FC = () => {
  const { pathname } = useLocation();
  const subtitle = SUBTITLE[pathname] ?? SUBTITLE['/'];

  return (
    <>
      <BrandHeader subtitle={subtitle} showAppNav />
      <main className="hi-app-main">
        <Outlet />
      </main>
      <footer className="hi-app-footer">
        <PoweredByWorld variant="footer" />
      </footer>
    </>
  );
};

export default AppLayout;
