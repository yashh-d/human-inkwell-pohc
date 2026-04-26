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
          to="/feed"
          className={({ isActive }) => `hi-ambient__item${isActive ? ' is-active' : ''}`}
          title="Feed"
        >
          <span className="hi-ambient__icon" aria-hidden>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 6.5h16M4 12h10M4 17.5h16" />
              <path d="M18 9l2.5 3L18 15" />
            </svg>
          </span>
          <span className="hi-ambient__label">Feed</span>
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
          to="/my-content"
          className={({ isActive }) => `hi-ambient__item${isActive ? ' is-active' : ''}`}
          title="My content"
        >
          <span className="hi-ambient__icon" aria-hidden>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-3-3.87M4 21v-2a4 4 0 0 1 3-3.87" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </span>
          <span className="hi-ambient__label hi-ambient__label--long">My content</span>
          <span className="hi-ambient__label hi-ambient__label--short">You</span>
        </NavLink>
      </div>
    </nav>
  );
};

export default AmbientNav;
