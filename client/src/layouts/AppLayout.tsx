import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import AmbientNav from '../components/AmbientNav';
import BrandHeader from '../components/BrandHeader';
import PoweredByWorld from '../components/PoweredByWorld';
import SiteNav from '../components/SiteNav';

const WORKFLOW_PATH = '/workflow';
const WRITE_PATH = '/write';

const HOME_SUBTITLE =
  'Claim your digital authorship. HumanInk uses your typing signature and World ID to put permanent proof of human writing onchain.';

const SUBTITLE: Record<string, string> = {
  '/': HOME_SUBTITLE,
  [WRITE_PATH]: HOME_SUBTITLE,
  [WORKFLOW_PATH]: '',
};

// Routes that render their own in-page heading and don't want the brand block
// (logo + powered-by-world + hero subtitle) doubled below SiteNav — the header
// already carries the brand. Creator surfaces + profile included.
const HIDE_BRAND_HEADER = new Set<string>(['/publish', '/creator', '/feed', '/me']);
// Dynamic creator routes (/feed/:entryId, /c/:handle) hide it too.
const HIDE_BRAND_PREFIXES = ['/feed/', '/c/'];

const AppLayout: React.FC = () => {
  const { pathname } = useLocation();
  const subtitle = SUBTITLE[pathname] ?? SUBTITLE['/'];
  const hideBrand =
    HIDE_BRAND_HEADER.has(pathname) || HIDE_BRAND_PREFIXES.some((p) => pathname.startsWith(p));

  return (
    <>
      <SiteNav />
      {!hideBrand && <BrandHeader subtitle={subtitle} />}
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
