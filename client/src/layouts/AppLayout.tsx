import React from 'react';
import { Outlet } from 'react-router-dom';
import AmbientNav from '../components/AmbientNav';
import SiteNav from '../components/SiteNav';

// The app shell for the in-product surfaces (creator, feed, profile, write,
// workflow, publish). SiteNav already carries the brand ("Human Ink · powered by
// world") and nav, so we deliberately DON'T repeat a brand block or a
// powered-by-world footer here — those live only on the standalone marketing
// pages (/, /about, /education), which render their own.
const AppLayout: React.FC = () => (
  <>
    <SiteNav />
    <main className="hi-app-main hi-app-main--ambient">
      <Outlet />
    </main>
    <AmbientNav />
  </>
);

export default AppLayout;
