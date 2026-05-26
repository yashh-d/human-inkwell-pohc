import React from 'react';
import { NavLink } from 'react-router-dom';

const AmbientNav: React.FC = () => {
  return (
    <nav className="hi-ambient" aria-label="App sections">
      <div className="hi-ambient__inner">
        <NavLink
          to="/"
          className={({ isActive }) => `hi-ambient__item${isActive ? ' is-active' : ''}`}
          end
          title="Home"
        >
          <span className="hi-ambient__icon" aria-hidden>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 10.5L12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5z" />
            </svg>
          </span>
          <span className="hi-ambient__label">Home</span>
        </NavLink>
        <NavLink
          to="/write"
          className={({ isActive }) => `hi-ambient__item${isActive ? ' is-active' : ''}`}
          title="Writing"
        >
          <span className="hi-ambient__icon" aria-hidden>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 20h4l10.5-10.5a1.5 1.5 0 0 0 0-2.12L18.1 5.2a1.5 1.5 0 0 0-2.12 0L4 19.5" />
            </svg>
          </span>
          <span className="hi-ambient__label">Write</span>
        </NavLink>
        <NavLink
          to="/workflow"
          className={({ isActive }) => `hi-ambient__item${isActive ? ' is-active' : ''}`}
          title="How it works"
        >
          <span className="hi-ambient__icon" aria-hidden>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v4l2.5 2.5" />
            </svg>
          </span>
          <span className="hi-ambient__label">How</span>
        </NavLink>
      </div>
    </nav>
  );
};

export default AmbientNav;
