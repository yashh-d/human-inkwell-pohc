import React from 'react';
import { Link } from 'react-router-dom';
import './LandingPage.css';
import './CreatorWelcome.css';

const Eyebrow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="lp-eyebrow">
    <span className="lp-eyebrow__tick" aria-hidden="true" />
    {children}
  </span>
);

/** Who this is for, and what proving human effort does for them. */
const AUDIENCES: { title: string; body: string }[] = [
  {
    title: 'Content creators',
    body: 'Show the hours behind a post and stand apart from the flood of AI-generated content.',
  },
  {
    title: 'Journalists',
    body: 'Back your reporting with a record of the real writing process, not just the byline.',
  },
  {
    title: 'Authors',
    body: 'Prove the manuscript is yours — every draft, edit and revision, written by a human.',
  },
];

/**
 * The context screen for /creator. Rather than dropping straight onto the tracked
 * editor, a creator first lands on this short subsection: a one-line reason it
 * matters, then who it's for. It borrows the home page's palette and type (lp-*
 * tokens) but is deliberately its own, calmer section — not a landing clone.
 * "Start writing" reveals the editor.
 */
export default function CreatorWelcome({ onStart }: { onStart: () => void }) {
  return (
    <div className="creator-intro">
      <div className="creator-intro__inner">
        <Eyebrow>For creators</Eyebrow>
        <h1 className="creator-intro__lead">
          As AI writing floods the web, proof that a real person did the work is
          becoming the most valuable thing you can attach to what you publish.
        </h1>
        <p className="creator-intro__body">
          Human&nbsp;Ink gives content creators, journalists and authors a way to see their
          own effort: the keystrokes, edits, pastes and hours behind a piece. It becomes
          a proof of human writing they can publish onchain and share with their audience.
        </p>

        <div className="creator-intro__audiences">
          {AUDIENCES.map((a) => (
            <div className="creator-audience" key={a.title}>
              <h3 className="creator-audience__title">{a.title}</h3>
              <p className="creator-audience__body">{a.body}</p>
            </div>
          ))}
        </div>

        <div className="creator-intro__cta">
          <button type="button" className="lp-btn lp-btn--primary lp-btn--lg" onClick={onStart}>
            Start writing
          </button>
          <Link to="/feed" className="lp-btn lp-btn--ghost lp-btn--lg">
            See the HI Feed
          </Link>
        </div>

        <div className="creator-intro__links">
          <Link to="/me" className="creator-intro__link">My work</Link>
          <Link to="/" className="creator-intro__link">← Back to Human Ink</Link>
        </div>
      </div>
    </div>
  );
}
