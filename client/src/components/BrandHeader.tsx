import React from 'react';
import { NavLink } from 'react-router-dom';
import PoweredByWorld from './PoweredByWorld';

type BrandHeaderProps = {
  /** Optional extra line under the standard tagline */
  subtitle?: string;
  /** Main app section links */
  showAppNav?: boolean;
};

const BrandHeader: React.FC<BrandHeaderProps> = ({ subtitle, showAppNav }) => {
  return (
    <header className="hi-app-header">
      {showAppNav && (
        <div className="hi-app-header__bar">
          <nav className="hi-app-header__nav" aria-label="App sections">
            <NavLink
              to="/"
              className={({ isActive }) =>
                isActive ? 'hi-app-header__nav-link is-active' : 'hi-app-header__nav-link'
              }
              end
            >
              Home
            </NavLink>
            <NavLink
              to="/feed"
              className={({ isActive }) =>
                isActive ? 'hi-app-header__nav-link is-active' : 'hi-app-header__nav-link'
              }
            >
              Feed
            </NavLink>
            <NavLink
              to="/workflow"
              className={({ isActive }) =>
                isActive ? 'hi-app-header__nav-link is-active' : 'hi-app-header__nav-link'
              }
            >
              How it works
            </NavLink>
            <NavLink
              to="/my-content"
              className={({ isActive }) =>
                isActive ? 'hi-app-header__nav-link is-active' : 'hi-app-header__nav-link'
              }
              title="My content — your attested writing (all formats)"
              aria-label="My content"
            >
              <span className="hi-app-header__nav-long">My content</span>
              <span className="hi-app-header__nav-short">Mine</span>
            </NavLink>
          </nav>
        </div>
      )}
      <div className="hi-app-header__body">
        <PoweredByWorld variant="header" showTagline={false} />
        {subtitle && <p className="hi-app-header__subtitle">{subtitle}</p>}
      </div>
    </header>
  );
};

export default BrandHeader;
