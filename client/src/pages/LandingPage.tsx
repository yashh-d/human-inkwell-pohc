import React from 'react';
import { Link } from 'react-router-dom';
import InkCanvas from '../components/InkCanvas';
import SiteNav from '../components/SiteNav';
import './LandingPage.css';

const HUMANINK_LOGO = '/brand/humanink3.png';
const WORLD_ICON = '/brand/world-icon.png';
const GOOGLE_DOCS = '/brand/google-docs.png';
const GOOGLE_DRIVE = '/brand/google-drive.png';
/**
 * Live Chrome Web Store listing. Set REACT_APP_CHROME_STORE_URL in Vercel to
 * point the "Add to Chrome" CTAs at the real listing without a code change.
 */
const CHROME_STORE_URL =
  process.env.REACT_APP_CHROME_STORE_URL || 'https://chromewebstore.google.com/';

/** Small World "powered by" lockup. `tone` switches to light text on dark bands. */
const PoweredByWorld: React.FC<{ className?: string; tone?: 'light' | 'dark' }> = ({
  className = '',
  tone = 'light',
}) => (
  <a
    href="https://world.org"
    target="_blank"
    rel="noopener noreferrer"
    className={`lp-world lp-world--${tone} ${className}`.trim()}
    aria-label="Powered by World. Visit world.org"
  >
    <span className="lp-world__label">powered by</span>
    <img src={WORLD_ICON} alt="" className="lp-world__icon" width={20} height={20} />
    <span className="lp-world__word">world</span>
  </a>
);

const Eyebrow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="lp-eyebrow">
    <span className="lp-eyebrow__tick" aria-hidden="true" />
    {children}
  </span>
);

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

/** Capabilities the Google Docs integration adds, sourced from the doc itself. */
const DOC_FEATURES: { key: string; title: string; body: string; icon: React.ReactNode }[] = [
  {
    key: 'ai',
    title: 'AI detection',
    body: 'AI-generated and pasted passages are flagged and kept separate from what you actually typed.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l1.7 4.1L18 8.8l-4.3 1.7L12 15l-1.7-4.5L6 8.8l4.3-1.7z" />
        <path d="M18.5 14.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
      </svg>
    ),
  },
  {
    key: 'paste',
    title: 'Copy and paste',
    body: 'Every paste is recorded, so the words you typed are provably your own.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="7" y="4" width="10" height="16" rx="2" />
        <path d="M9 4h6v2.5H9z" />
      </svg>
    ),
  },
  {
    key: 'revisions',
    title: 'Revision history',
    body: 'Your full Google Docs edit timeline is captured as proof of the process.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3.5 12a8.5 8.5 0 1 0 2.7-6.2" />
        <path d="M3 4.5V9h4.5" />
        <path d="M12 8v4.2l3 1.8" />
      </svg>
    ),
  },
  {
    key: 'drafts',
    title: 'Drafts',
    body: 'Each draft is preserved, showing the real work behind the finished piece.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l8.5 4.5L12 12 3.5 7.5z" />
        <path d="M3.5 12.5L12 17l8.5-4.5" />
      </svg>
    ),
  },
];

const LandingPage: React.FC = () => {
  return (
    <>
      <SiteNav />
      <div className="lp">
      <InkCanvas />

      {/* Hero */}
      <section className="lp-hero">
        <div className="lp-hero__copy">
          <Eyebrow>Proof of human authorship</Eyebrow>
          <h1 className="lp-hero__title">
            Prove a <span className="lp-accent">human</span> wrote it.
          </h1>
          <p className="lp-hero__sub">
            Your typing rhythm becomes a signature only you can produce, bound to your
            World&nbsp;ID and written onchain. Permanent, private, provably yours.
          </p>
          <div className="lp-hero__cta">
            <Link to="/write" className="lp-btn lp-btn--primary lp-btn--lg">
              Start writing
            </Link>
            <a
              href={CHROME_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="lp-btn lp-btn--ghost lp-btn--lg"
            >
              <ChromeMark />
              Add to Chrome
            </a>
          </div>
          <PoweredByWorld className="lp-world--hero" />
        </div>

        <div className="lp-hero__art">
          <figure className="lp-proof">
            <span className="lp-proof__label">Certificate of authorship</span>
            <div className="lp-proof__sign" role="img" aria-label="Signed, Humanink">
              <span className="lp-proof__word">Humanink</span>
              <svg className="lp-proof__flourish" viewBox="0 0 320 24" aria-hidden="true">
                <path pathLength={1} d="M14,15 C92,4 214,22 306,8" />
              </svg>
            </div>
            <div className="lp-proof__rule" />
            <figcaption className="lp-proof__meta">
              <span className="lp-proof__seal">
                <img src={WORLD_ICON} alt="" width={26} height={26} />
              </span>
              <span className="lp-proof__by">
                <strong>Verified human</strong>
                <code>0x9f2c…a18b · onchain</code>
              </span>
            </figcaption>
          </figure>
        </div>
      </section>

      {/* How it works */}
      <section className="lp-how lp-band lp-band--ink">
        <div className="lp-how__head">
          <Eyebrow>How it works</Eyebrow>
          <h2 className="lp-section-title">Three steps to permanent proof.</h2>
        </div>
        <div className="lp-steps">
          <div className="lp-step">
            <span className="lp-step__num">01</span>
            <h3>Type</h3>
            <p>Key-level timing is measured on your device. Your words never leave as raw text.</p>
          </div>
          <div className="lp-step">
            <span className="lp-step__num">02</span>
            <h3>Verify</h3>
            <p>World ID binds the session to one real person, not a bot or an anonymous model.</p>
          </div>
          <div className="lp-step">
            <span className="lp-step__num">03</span>
            <h3>Onchain</h3>
            <p>A permanent attestation is written to the Human Content Ledger. Yours to prove, forever.</p>
          </div>
        </div>
      </section>

      {/* Chrome extension */}
      <section className="lp-chrome-section lp-band lp-band--cyan">
        <div className="lp-chrome-section__copy">
          <Eyebrow>Chrome extension</Eyebrow>
          <h2 className="lp-section-title lp-section-title--left">Prove it anywhere you write.</h2>
          <p className="lp-chrome-section__sub">
            Bring proof of human authorship to Google&nbsp;Docs, Gmail, and the open web,
            without leaving the page.
          </p>
          <a
            href={CHROME_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="lp-btn lp-btn--primary lp-btn--lg"
          >
            <ChromeMark />
            Add to Chrome
          </a>
          <div className="lp-works">
            <span className="lp-works__label">Works where you write</span>
            <div className="lp-works__logos">
              <span className="lp-works__chip">
                <img src={GOOGLE_DOCS} alt="Google Docs" />
              </span>
              <span className="lp-works__chip">
                <img src={GOOGLE_DRIVE} alt="Google Drive" />
              </span>
            </div>
          </div>
        </div>
        <div className="lp-chrome-section__art" aria-hidden="true">
          <div className="lp-ext-card">
            <div className="lp-ext-card__head">
              <ChromeMark />
              <span className="lp-ext-card__name">Humanink</span>
              <span className="lp-ext-card__pin">Pinned</span>
            </div>
            <div className="lp-ext-card__body">
              <span className="lp-ext-card__status">
                <i className="lp-ext-card__dot" />
                Verified human
              </span>
              <div className="lp-ext-card__line" />
              <div className="lp-ext-card__line lp-ext-card__line--short" />
            </div>
          </div>
        </div>
      </section>

      {/* Capabilities from Google Docs */}
      <section className="lp-features lp-band lp-band--panel">
        <div className="lp-features__head">
          <Eyebrow>From your Google Docs</Eyebrow>
          <h2 className="lp-section-title lp-section-title--left">
            More signal, straight from the source.
          </h2>
        </div>
        <div className="lp-feature-grid">
          {DOC_FEATURES.map((f) => (
            <div className="lp-feature" key={f.key}>
              <span className="lp-feature__icon">{f.icon}</span>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Closing band */}
      <section className="lp-final">
        <Eyebrow>Start now</Eyebrow>
        <h2 className="lp-final__title">Claim your authorship.</h2>
        <div className="lp-final__cta">
          <Link to="/write" className="lp-btn lp-btn--invert lp-btn--lg">
            Start writing
          </Link>
          <a
            href={CHROME_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="lp-btn lp-btn--ghost-dark lp-btn--lg"
          >
            <ChromeMark />
            Add to Chrome
          </a>
        </div>
        <PoweredByWorld className="lp-world--final" tone="dark" />
      </section>

      {/* Footer */}
      <footer className="lp-footer">
        <img src={HUMANINK_LOGO} alt="Humanink" className="lp-footer__logo" />
        <Link to="/about" className="lp-nav__link">
          About
        </Link>
        <PoweredByWorld />
      </footer>
      </div>
    </>
  );
};

export default LandingPage;
