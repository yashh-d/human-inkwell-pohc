import React from 'react';
import { NavLink } from 'react-router-dom';
import PoweredByWorld from './PoweredByWorld';

type BrandHeaderProps = {
  /** Optional extra line under the standard tagline */
  subtitle?: string;
  /** Main app section links (Home, How it works, Private ledger) */
  showAppNav?: boolean;
};

const BrandHeader: React.FC<BrandHeaderProps> = ({ subtitle, showAppNav }) => {
  return (
    <header className="hi-app-header">
      <PoweredByWorld variant="header" showTagline={false} />
      {showAppNav && (
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
            to="/workflow"
            className={({ isActive }) =>
              isActive ? 'hi-app-header__nav-link is-active' : 'hi-app-header__nav-link'
            }
          >
            How it works
          </NavLink>
          <NavLink
            to="/ledger"
            className={({ isActive }) =>
              isActive ? 'hi-app-header__nav-link is-active' : 'hi-app-header__nav-link'
            }
          >
            Private ledger (demo)
          </NavLink>
        </nav>
      )}
      {subtitle && <p className="hi-app-header__subtitle">{subtitle}</p>}
    </header>
  );
};

export default BrandHeader;
