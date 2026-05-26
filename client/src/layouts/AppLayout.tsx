import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import AmbientNav from '../components/AmbientNav';
import BrandHeader from '../components/BrandHeader';
import PoweredByWorld from '../components/PoweredByWorld';

const WORKFLOW_PATH = '/workflow';
const WRITE_PATH = '/write';

const HOME_SUBTITLE =
  'Claim your digital authorship. HumanInk uses your typing signature and World ID to put permanent proof of human writing onchain.';

const SUBTITLE: Record<string, string> = {
  '/': HOME_SUBTITLE,
  [WRITE_PATH]: HOME_SUBTITLE,
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
