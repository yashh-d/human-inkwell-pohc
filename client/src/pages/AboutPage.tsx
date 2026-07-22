import React from 'react';
import { Link } from 'react-router-dom';
import InkCanvas from '../components/InkCanvas';
import SiteNav from '../components/SiteNav';
import './LandingPage.css';
import './AboutPage.css';

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

/** The three pieces that make up an end-to-end proof. */
const PIPELINE: { num: string; title: string; body: string }[] = [
  {
    num: '01',
    title: 'Capture',
    body: 'The Chrome extension measures the rhythm of your writing — key-level timing, pastes, and your full edit history — directly in Google Docs and across the web. All of it stays on your device.',
  },
  {
    num: '02',
    title: 'Verify & sign',
    body: 'World ID binds the session to one real person, not a bot or a model. The app turns your text and typing rhythm into two SHA-256 hashes and signs them with your wallet.',
  },
  {
    num: '03',
    title: 'Record',
    body: 'The signed attestation is written to the Human Content Ledger onchain — a permanent, public record that this piece was typed by a verified human, yours to prove forever.',
  },
];

/** What does and does not leave your device. */
const STORED = [
  'A SHA-256 hash of your text (the content hash)',
  'A SHA-256 hash of your typing biometrics (the human signature hash)',
  'Coarse session metrics: words per minute, backspaces, paste count, edit timeline',
  'Your World ID proof of personhood',
];
const NEVER = [
  'The words you actually wrote — only the hash leaves your browser',
  'Raw keystrokes or a recording of what you typed',
  'Anything that links the proof back to your private drafts',
];

/** Plain-language definitions for the terms used across the product. */
const GLOSSARY: { term: string; def: string }[] = [
  {
    term: 'Keystroke biometrics',
    def: 'The behavioural fingerprint of how you type — hold times, the gaps between keys, and your typing speed. As personal as handwriting, and hard to fake.',
  },
  {
    term: 'Content hash',
    def: 'A SHA-256 fingerprint of your text. It proves what was written without ever revealing the words themselves.',
  },
  {
    term: 'Human signature hash',
    def: 'A SHA-256 fingerprint of your typing rhythm. It proves how the piece was written — by a person, keystroke by keystroke.',
  },
  {
    term: 'World ID',
    def: "World's proof of personhood. It binds a proof to one real human, so an attestation can't be minted by a bot or a model.",
  },
  {
    term: 'Human Content Ledger',
    def: 'The onchain smart contract that stores each signed attestation. A permanent, public record of human authorship.',
  },
];

const AboutPage: React.FC = () => {
  return (
    <>
      <SiteNav current="about" />
      <div className="lp about">
      <InkCanvas />

      {/* Intro */}
      <section className="about-intro">
        <Eyebrow>About Human Ink</Eyebrow>
        <h1 className="about-intro__title">
          Proof that a <span className="lp-accent">human</span> wrote it.
        </h1>
        <p className="about-intro__lede">
          Anyone can generate a thousand words in a second. The hard part is no longer
          producing text — it's proving a person actually wrote it. Human Ink turns the way
          you type into a signature only you can produce, verifies you're a real human with
          World&nbsp;ID, and writes a permanent record onchain.
        </p>
      </section>

      {/* The problem */}
      <section className="about-prose lp-band lp-band--mist">
        <Eyebrow>Why it matters</Eyebrow>
        <h2 className="lp-section-title lp-section-title--left">
          Human writing needs a watermark of its own.
        </h2>
        <div className="about-prose__cols">
          <p>
            As generated text becomes indistinguishable from the real thing, the value of a
            human voice depends on being able to prove it. Editors, schools, hiring teams and
            readers all face the same question: was this written by a person, or produced by a
            machine?
          </p>
          <p>
            Human Ink answers it without surveillance. Instead of guessing whether text
            "looks AI", it captures positive evidence of the act of writing — the timing of
            your keystrokes, the edits you made, the pace you worked at — and seals it
            cryptographically. The proof travels with the work; your words stay with you.
          </p>
        </div>
      </section>

      {/* How it works — end to end */}
      <section className="about-pipeline lp-band lp-band--ink">
        <div className="about-pipeline__head">
          <Eyebrow>How it works</Eyebrow>
          <h2 className="lp-section-title lp-section-title--left">
            From keystrokes to a permanent record.
          </h2>
        </div>
        <div className="lp-steps">
          {PIPELINE.map((step) => (
            <div className="lp-step" key={step.num}>
              <span className="lp-step__num">{step.num}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </div>
          ))}
        </div>
        <div className="about-works">
          <span className="about-works__label">Capture works where you write</span>
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

      {/* Privacy */}
      <section className="about-privacy lp-band lp-band--cyan">
        <div className="about-privacy__head">
          <Eyebrow>Your privacy</Eyebrow>
          <h2 className="lp-section-title lp-section-title--left">
            Proof, without handing over your words.
          </h2>
          <p className="about-privacy__sub">
            Everything is computed on your device. Only fingerprints and coarse metrics are
            ever published — never the text itself.
          </p>
        </div>
        <div className="about-privacy__grid">
          <div className="about-card about-card--keep">
            <span className="about-card__tag about-card__tag--keep">Written onchain</span>
            <ul className="about-list">
              {STORED.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div className="about-card about-card--never">
            <span className="about-card__tag about-card__tag--never">Never leaves your device</span>
            <ul className="about-list about-list--never">
              {NEVER.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Glossary */}
      <section className="about-glossary">
        <div className="about-glossary__head">
          <Eyebrow>In plain terms</Eyebrow>
          <h2 className="lp-section-title lp-section-title--left">The words we use.</h2>
        </div>
        <dl className="about-defs">
          {GLOSSARY.map((entry) => (
            <div className="about-def" key={entry.term}>
              <dt>{entry.term}</dt>
              <dd>{entry.def}</dd>
            </div>
          ))}
        </dl>
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
        <Link to="/" aria-label="Humanink home">
          <img src={HUMANINK_LOGO} alt="Humanink" className="lp-footer__logo" />
        </Link>
        <PoweredByWorld />
      </footer>
      </div>
    </>
  );
};

export default AboutPage;
