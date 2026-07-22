import React from 'react';
import { Link } from 'react-router-dom';
import '../pages/LandingPage.css';
import './SiteNav.css';

const WORLD_ICON = '/brand/world-icon.png';

/**
 * Live Chrome Web Store listing. Set REACT_APP_CHROME_STORE_URL in Vercel to
 * point the "Add to Chrome" CTAs at the real listing without a code change.
 */
const CHROME_STORE_URL =
  process.env.REACT_APP_CHROME_STORE_URL || 'https://chromewebstore.google.com/';

/** Refined, monochrome Chrome glyph (inherits currentColor). */
const ChromeMark: React.FC = () => (
  <svg
    viewBox="0 0 24 24"
    className="lp-chrome-mark"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9.25" />
    <circle cx="12" cy="12" r="3.4" />
    <path d="M12 2.75 V8.6" strokeLinecap="round" />
    <path d="M4.05 16.6 L9.1 13.7" strokeLinecap="round" />
    <path d="M19.95 16.6 L14.9 13.7" strokeLinecap="round" />
  </svg>
);

export type SiteNavCurrent = 'about' | 'creator' | 'education' | 'me';

/**
 * The shared top nav — Human Ink · powered by world · About · Creator ·
 * Education · Add to Chrome · Start writing. Rendered identically on every page
 * and pinned to the top as the page scrolls. Self-contained: it re-declares the
 * --lp-* tokens (via SiteNav.css) and pulls in the lp-* classes from
 * LandingPage.css, so it works anywhere — inside a `.lp` page or the app shell.
 */
const SiteNav: React.FC<{ current?: SiteNavCurrent }> = ({ current }) => (
  <div className="site-nav">
  <header className="lp-nav">
    <div className="lp-nav__brand">
      <Link to="/" className="lp-nav__wordmark" aria-label="Human Ink home">Human Ink</Link>
      <span className="lp-nav__brand-sep" aria-hidden />
      <a
        href="https://world.org"
        target="_blank"
        rel="noopener noreferrer"
        className="lp-world lp-world--light lp-nav__world"
        aria-label="Powered by World. Visit world.org"
      >
        <span className="lp-world__label">powered by</span>
        <img src={WORLD_ICON} alt="" className="lp-world__icon" width={20} height={20} />
        <span className="lp-world__word">world</span>
      </a>
    </div>
    <div className="lp-nav__right">
      <Link to="/about" className="lp-nav__link" aria-current={current === 'about' ? 'page' : undefined}>
        About
      </Link>
      <Link to="/creator" className="lp-nav__link" aria-current={current === 'creator' ? 'page' : undefined}>
        Creator
      </Link>
      <Link to="/education" className="lp-nav__link" aria-current={current === 'education' ? 'page' : undefined}>
        Education
      </Link>
      <Link to="/me" className="lp-nav__link" aria-current={current === 'me' ? 'page' : undefined}>
        My profile
      </Link>
      <a
        href={CHROME_STORE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="lp-btn lp-btn--ghost lp-btn--sm"
      >
        <ChromeMark />
        Add to Chrome
      </a>
      <Link to="/write" className="lp-btn lp-btn--primary lp-btn--sm">
        Start writing
      </Link>
    </div>
  </header>
  </div>
);

export default SiteNav;
