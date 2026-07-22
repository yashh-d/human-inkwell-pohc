import React from 'react';
import { Link } from 'react-router-dom';
import InkCanvas from '../components/InkCanvas';
import SiteNav from '../components/SiteNav';
import './LandingPage.css';
import './AboutPage.css';
import './EducationPage.css';

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

/** How a proof comes together in the classroom, end to end. */
const CLASSROOM: { num: string; title: string; body: string }[] = [
  {
    num: '01',
    title: 'Students write in Google Docs',
    body: 'With the Human Ink Chrome extension installed, the writing is captured where students already work. Keystroke timing, pastes and the full edit history are recorded on their device — no new tool to learn.',
  },
  {
    num: '02',
    title: 'Drive keeps the whole trail',
    body: 'Every draft and the complete Google Docs revision history is preserved through Drive, so the finished essay carries the real process behind it, not just the final text.',
  },
  {
    num: '03',
    title: 'You get proof, not a guess',
    body: 'Each submission arrives with a proof of human authorship: bound to one real person with World ID, sealed cryptographically, and defensible if integrity is ever questioned.',
  },
];

/** What the Google Docs + Drive integration surfaces for a professor. */
const DOC_FEATURES: { key: string; title: string; body: string; icon: React.ReactNode }[] = [
  {
    key: 'ai',
    title: 'AI detection',
    body: 'AI-generated and pasted passages are flagged and kept separate from what the student actually typed.',
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
    body: 'Every paste is recorded, so the words a student typed are provably their own.',
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
    body: "The student's full Google Docs edit timeline is captured as proof of the process.",
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

/** The case for a professor to adopt it. */
const WHY: { title: string; body: string }[] = [
  {
    title: 'Evidence, not accusation',
    body: 'AI detectors guess, and they get it wrong — flagging honest students. Human Ink shows positive proof of the writing process instead of a probability score.',
  },
  {
    title: 'No new workflow',
    body: 'Your students already write in Google Docs. Nothing to migrate, nothing new to teach, no assignments to restructure.',
  },
  {
    title: 'Fair to every student',
    body: 'Proof of effort protects the students who did the work — especially non-native writers most often wrongly flagged by detectors.',
  },
  {
    title: 'Defensible integrity cases',
    body: 'A signed, timestamped, onchain record of authorship stands up when an academic-integrity question actually arises.',
  },
];

/** How the design maps to FERPA's data-minimization expectations. */
const FERPA: string[] = [
  'No student PII leaves the classroom — writing is processed on the student’s own device, and only anonymous cryptographic hashes are ever published.',
  'Works inside your Google Workspace — capture happens in the Docs and Drive your institution already administers, not a new third-party data silo.',
  'Nothing links a proof back to private drafts — the onchain record proves authorship without exposing the student’s content or identity.',
  'Students keep their words — Human Ink verifies how a piece was written, and never stores what was written.',
];

const EducationPage: React.FC = () => {
  return (
    <>
      <SiteNav current="education" />
      <div className="lp education">
      <InkCanvas />

      {/* Intro */}
      <section className="about-intro">
        <Eyebrow>For educators</Eyebrow>
        <h1 className="about-intro__title">
          Proof your students <span className="lp-accent">wrote it</span> themselves.
        </h1>
        <p className="about-intro__lede">
          AI can write a flawless essay in seconds, and detectors can’t reliably tell the
          difference. Human Ink takes the opposite approach: it captures the real act of
          writing in Google&nbsp;Docs — keystrokes, edits, drafts and time — and turns it into
          verifiable proof of human authorship, without accusing anyone.
        </p>
        <div className="edu-intro__cta">
          <a
            href={CHROME_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="lp-btn lp-btn--primary lp-btn--lg"
          >
            <ChromeMark />
            Add to Chrome
          </a>
          <Link to="/about" className="lp-btn lp-btn--ghost lp-btn--lg">
            How it works
          </Link>
        </div>
      </section>

      {/* In the classroom — end to end */}
      <section className="about-pipeline lp-band lp-band--ink">
        <div className="about-pipeline__head">
          <Eyebrow>In the classroom</Eyebrow>
          <h2 className="lp-section-title lp-section-title--left">
            From the first keystroke to a proof you can trust.
          </h2>
        </div>
        <div className="lp-steps">
          {CLASSROOM.map((step) => (
            <div className="lp-step" key={step.num}>
              <span className="lp-step__num">{step.num}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </div>
          ))}
        </div>
        <div className="about-works">
          <span className="about-works__label">Built on the tools your class already uses</span>
          <div className="about-works__logos">
            <span className="lp-works__chip">
              <img src={GOOGLE_DOCS} alt="Google Docs" />
            </span>
            <span className="lp-works__chip">
              <img src={GOOGLE_DRIVE} alt="Google Drive" />
            </span>
            <a
              href={CHROME_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="lp-btn lp-btn--ghost lp-btn--sm about-works__cta"
            >
              <ChromeMark />
              Add to Chrome
            </a>
          </div>
        </div>
      </section>

      {/* Google Docs + Drive capabilities */}
      <section className="edu-features lp-band lp-band--cyan">
        <div className="edu-features__head">
          <Eyebrow>From Google Docs &amp; Drive</Eyebrow>
          <h2 className="lp-section-title lp-section-title--left">
            The signal you can’t get from a finished PDF.
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

      {/* FERPA / privacy */}
      <section className="edu-ferpa lp-band lp-band--panel">
        <div className="edu-ferpa__head">
          <Eyebrow>Privacy &amp; FERPA</Eyebrow>
          <h2 className="lp-section-title lp-section-title--left">
            Built to respect student records.
          </h2>
          <p className="edu-ferpa__sub">
            Human Ink is designed around FERPA’s core principle — data minimization. Everything
            is computed on the student’s device; only anonymous fingerprints and coarse metrics
            are ever published.
          </p>
        </div>
        <ul className="about-list edu-ferpa__list">
          {FERPA.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      {/* Why professors adopt it */}
      <section className="edu-why lp-band lp-band--mist">
        <div className="edu-why__head">
          <Eyebrow>Why professors choose it</Eyebrow>
          <h2 className="lp-section-title lp-section-title--left">
            Academic integrity, without the false alarms.
          </h2>
        </div>
        <div className="edu-why__grid">
          {WHY.map((w) => (
            <div className="edu-why__card" key={w.title}>
              <h3>{w.title}</h3>
              <p>{w.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Closing band */}
      <section className="lp-final">
        <Eyebrow>Bring it to your class</Eyebrow>
        <h2 className="lp-final__title">Grade the work, not the guess.</h2>
        <div className="lp-final__cta">
          <a
            href={CHROME_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="lp-btn lp-btn--invert lp-btn--lg"
          >
            <ChromeMark />
            Add to Chrome
          </a>
          <Link to="/about" className="lp-btn lp-btn--ghost-dark lp-btn--lg">
            Learn how it works
          </Link>
        </div>
        <PoweredByWorld className="lp-world--final" tone="dark" />
      </section>

      {/* Footer */}
      <footer className="lp-footer">
        <Link to="/" aria-label="Humanink home">
          <img src={HUMANINK_LOGO} alt="Humanink" className="lp-footer__logo" />
        </Link>
        <PoweredByWorld />
      </footer>
      </div>
    </>
  );
};

export default EducationPage;
