import React, { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  DUMMY_FEED_ITEMS,
  FEED_CHANNEL_PROFILE,
  type DummyFeedItem,
  type FeedVoice,
} from '../data/dummyFeed';
import { formatRelativeTime } from '../utils/relativeTime';

const PREVIEW_CHARS = 300;

function addressHue(addr: string): number {
  const s = (addr || '0x').toLowerCase();
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 33 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

function typingSpeedCps(typingSpeedScaled: number): string {
  const cps = typingSpeedScaled / 1000;
  return cps < 10 ? cps.toFixed(2) : cps.toFixed(1);
}

const voiceClass = (v: FeedVoice) => {
  if (v === 'professional') return 'hi-feed-voice--pro';
  if (v === 'academic') return 'hi-feed-voice--academic';
  return 'hi-feed-voice--personal';
};

const voiceLabel: Record<FeedVoice, string> = {
  professional: 'Pro',
  academic: 'Academic',
  personal: 'Personal',
};

function FeedPostText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const needsClamp = text.length > PREVIEW_CHARS;
  const display = !needsClamp || expanded ? text : `${text.slice(0, PREVIEW_CHARS)}…`;

  return (
    <div className="hi-feed-card__tweet-wrap">
      <p className="hi-feed-card__tweet">{display}</p>
      {needsClamp && (
        <button type="button" className="hi-feed-card__expand" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

function FeedRow({ r }: { r: DummyFeedItem }) {
  return (
    <li className="hi-feed-card">
      <div
        className="hi-feed-card__avatar"
        style={{ '--hi-feed-hue': `${addressHue(r.author)}` } as React.CSSProperties}
        aria-hidden
        title={r.author}
      />
      <div className="hi-feed-card__main">
        <div className="hi-feed-card__byline">
          <span className="hi-feed-card__display" title={r.displayName}>
            {r.displayName}
          </span>
          <span className="hi-feed-card__handle" title={r.author}>
            @{r.handle}
          </span>
          <span className="hi-feed-card__dot" aria-hidden>
            ·
          </span>
          <time className="hi-feed-card__time" dateTime={r.timeLabel} title={new Date(r.timeLabel).toLocaleString()}>
            {formatRelativeTime(r.timeLabel)}
          </time>
        </div>

        <p className="hi-feed-card__chips" aria-label="Format and style">
          <span className={`hi-feed-voice-pill ${voiceClass(r.voice)}`}>{voiceLabel[r.voice]}</span>
          <span className="hi-feed-card__format">{r.formatLabel}</span>
        </p>

        <FeedPostText text={r.publicText} />

        <p className="hi-feed-card__meta-note" title="Demo metrics">
          Demo · {r.keystrokeCount} keystrokes · {typingSpeedCps(r.typingSpeedScaled)} chars/s · entry #{r.entryId}
        </p>

        <div className="hi-feed-card__lower">
          <div className="hi-feed-card__badges" aria-label="Attestation (demo)">
            <span className="hi-feed-badge hi-feed-badge--world">World ID (demo)</span>
            {r.hasNullifier ? (
              <span className="hi-feed-badge hi-feed-badge--nullifier" title="Simulated for UI">
                Human proof
              </span>
            ) : null}
          </div>
          <div className="hi-feed-card__tx">
            <span className="hi-feed-card__link hi-feed-card__link--static" title="Not a real transaction; mock feed">
              Tx {r.txPreview} (simulated)
            </span>
          </div>
        </div>
      </div>
    </li>
  );
}

const FeedPage: React.FC = () => {
  const [listKey, setListKey] = useState(0);
  const p = FEED_CHANNEL_PROFILE;

  const refresh = useCallback(() => {
    setListKey((k) => k + 1);
  }, []);

  return (
    <div className="hi-feed">
      <div className="hi-feed__shell">
        <div className="hi-feed__toprow">
          <h1 className="hi-feed__eyebrow">Feed</h1>
          <div className="hi-feed__toprow-actions">
            <span className="hi-feed__demo-pill" aria-label="Demo content">
              Demo
            </span>
            <button type="button" className="hi-btn hi-btn--ghost hi-btn--sm hi-feed__refresh-btn" onClick={refresh}>
              Refresh
            </button>
          </div>
        </div>

        <p className="hi-feed__lede">
          Simulated <strong>World ID–verified</strong> posts: professional, academic, and personal—styled like a timeline, not
          a database table.
        </p>

        <header className="hi-feed-profile" aria-label="Channel profile (demo)">
          <div className="hi-feed-profile__cover" aria-hidden />
          <div className="hi-feed-profile__bar">
            <div className="hi-feed-profile__avatar" aria-hidden>
              <span className="hi-feed-profile__monogram">HI</span>
            </div>
            <button
              type="button"
              className="hi-feed-profile__follow is-disabled"
              disabled
              title="This is a read-only design preview"
            >
              Follow
            </button>
          </div>
          <div className="hi-feed-profile__body">
            <h2 className="hi-feed-profile__name">
              {p.displayName} <span className="hi-feed-profile__name-badge" title="Demo channel" aria-label="Demo">✓</span>
            </h2>
            <p className="hi-feed-profile__handle">@{p.handle}</p>
            <p className="hi-feed-profile__bio">{p.bio}</p>
            <p className="hi-feed-profile__meta" aria-label="Channel details (demo)">
              <span>📍 {p.location}</span>
              <span className="hi-feed-profile__meta-sep" aria-hidden>
                ·
              </span>
              <span className="hi-feed-profile__link-fake" title="Demo; not a real link">
                {p.websiteLabel}
              </span>
              <span className="hi-feed-profile__meta-sep" aria-hidden>
                ·
              </span>
              <span>Joined {p.joined}</span>
            </p>
            <div className="hi-feed-profile__stats" role="list" aria-label="Follow stats (illustrative)">
              <span role="listitem">
                <strong>{p.following.toLocaleString()}</strong> <span>Following</span>
              </span>
              <span role="listitem">
                <strong>{p.followers.toLocaleString()}</strong> <span>Followers</span>
              </span>
            </div>
          </div>
        </header>

        <nav className="hi-feed-tabs" aria-label="Profile sections (illustrative)">
          <div className="hi-feed-tabs__inner">
            <span className="hi-feed-tabs__tab is-active" aria-current="page">
              Posts
            </span>
            <span className="hi-feed-tabs__tab is-dim" title="Not in the demo">
              Likes
            </span>
            <span className="hi-feed-tabs__tab is-dim" title="Not in the demo">
              Media
            </span>
          </div>
        </nav>
        <p className="hi-feed__post-count" aria-live="polite">
          {DUMMY_FEED_ITEMS.length} demo {DUMMY_FEED_ITEMS.length === 1 ? 'post' : 'posts'}
        </p>

        <ul className="hi-feed__list" key={listKey} aria-label="Simulated human posts (demo)">
          {DUMMY_FEED_ITEMS.map((r) => (
            <FeedRow key={r.id} r={r} />
          ))}
        </ul>
      </div>

      <p className="hi-feed__footer-hint">
        For real on-chain submissions, use <Link to="/">Home</Link> — this page is a design preview only.
      </p>
    </div>
  );
};

export default FeedPage;
