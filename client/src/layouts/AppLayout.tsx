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
  'Claim your digital authorship. HumanInk uses your typing signature and World ID to put permanent proof of human writing onchain.';

const SUBTITLE: Record<string, string> = {
  '/': HOME_SUBTITLE,
  [WRITE_PATH]: HOME_SUBTITLE,
  [FEED_PATH]: '',
  [MY_CONTENT_PATH]:
    'Your attested writing in one place: X-style posts, LinkedIn, blogs, articles, and more.',
  [WORKFLOW_PATH]: '',
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
