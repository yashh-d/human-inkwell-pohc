import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import AmbientNav from '../components/AmbientNav';
import BrandHeader from '../components/BrandHeader';
import PoweredByWorld from '../components/PoweredByWorld';

const MY_CONTENT_PATH = '/my-content';
const WORKFLOW_PATH = '/workflow';
const FEED_PATH = '/feed';
const WRITE_PATH = '/write';

const HOME_SUBTITLE =
  'Onchain proof that a verified human wrote this content, with biometric typing signatures and World ID attestation on World Chain.';

const SUBTITLE: Record<string, string> = {
  '/': HOME_SUBTITLE,
  [WRITE_PATH]: HOME_SUBTITLE,
  [FEED_PATH]:
    'Demo feed: a channel-style header plus a mixed timeline (professional, academic, personal). Real posts ship from Home to chain.',
  [MY_CONTENT_PATH]:
    'Your attested writing in one place: X-style posts, LinkedIn, blogs, articles, and more. Demo index: format, preview, hashes, and onchain link.',
  [WORKFLOW_PATH]:
    'End-to-end: World ID, local keystroke capture, hashing, and onchain attestation—plus what stays offchain and out of the contract as plaintext.',
};

const AppLayout: React.FC = () => {
  const { pathname } = useLocation();
  const subtitle = SUBTITLE[pathname] ?? SUBTITLE['/'];

  return (
    <>
      <BrandHeader subtitle={subtitle} />
      <main className="hi-app-main hi-app-main--ambient">
        <Outlet />
      </main>
      <footer className="hi-app-footer hi-app-footer--ambient">
        <PoweredByWorld variant="footer" />
      </footer>
      <AmbientNav />
    </>
  );
};

export default AppLayout;
