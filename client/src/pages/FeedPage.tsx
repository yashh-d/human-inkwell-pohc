import React, { useState, useCallback } from 'react';
import {
  DUMMY_FEED_ITEMS,
  FEED_CHANNEL_PROFILE,
  type DummyFeedItem,
} from '../data/dummyFeed';
import { formatRelativeTime } from '../utils/relativeTime';

const PREVIEW_CHARS = 300;

function addressHue(addr: string): number {
  const s = (addr || '0x').toLowerCase();
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 33 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

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

        <p className="hi-feed-card__chips" aria-label="Post category">
          <span className="hi-feed-pill hi-feed-pill--category">{r.formatLabel}</span>
        </p>

        <FeedPostText text={r.publicText} />

        <p className="hi-feed-card__signature-bar" aria-label="Attestation and transaction reference">
          <span className="hi-feed-card__sig-icon" aria-hidden>
            ✓
          </span>
          <span className="hi-feed-card__sig-text">
            Verified Human: {r.keystrokeCount.toLocaleString()} Keystrokes
          </span>
          <span className="hi-feed-card__sig-sep" aria-hidden>
            |
          </span>
          {r.txUrl ? (
            <a
              href={r.txUrl}
              className="hi-feed-card__sig-tx"
              target="_blank"
              rel="noopener noreferrer"
              title="View on block explorer"
            >
              {r.txPreview}
            </a>
          ) : (
            <span className="hi-feed-card__sig-tx hi-feed-card__sig-tx--static">{r.txPreview}</span>
          )}
        </p>
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
            <button type="button" className="hi-btn hi-btn--ghost hi-btn--sm hi-feed__refresh-btn" onClick={refresh}>
              Refresh
            </button>
          </div>
        </div>

        <p className="hi-feed__lede">
          The <strong>human layer</strong> of the open internet. Proof of person, biometric signatures, and a timeline
          that reads like people, not NPC chatbots.
        </p>

        <header className="hi-feed-profile" aria-label="Channel profile">
          <div className="hi-feed-profile__cover" aria-hidden />
          <div className="hi-feed-profile__bar">
            <div className="hi-feed-profile__avatar" aria-hidden>
              <span className="hi-feed-profile__monogram">HI</span>
            </div>
            <button
              type="button"
              className="hi-feed-profile__follow is-disabled"
              disabled
              title="Read-only in this build"
            >
              Follow
            </button>
          </div>
          <div className="hi-feed-profile__body">
            <h2 className="hi-feed-profile__name">
              {p.displayName}{' '}
              <span className="hi-feed-profile__name-badge" title="Verified" aria-label="Verified">
                ✓
              </span>
            </h2>
            <p className="hi-feed-profile__handle">@{p.handle}</p>
            <p className="hi-feed-profile__bio">{p.bio}</p>
            <p className="hi-feed-profile__meta" aria-label="Location, site, and reach">
              <span>📍 {p.location}</span>
              <span className="hi-feed-profile__meta-pipe" aria-hidden>
                {' '}
                |{' '}
              </span>
              <span className="hi-feed-profile__link-fake">{p.websiteLabel}</span>
              <span className="hi-feed-profile__meta-pipe" aria-hidden>
                {' '}
                |{' '}
              </span>
              <span>
                <strong>{p.following.toLocaleString()}</strong> Following
              </span>
              <span className="hi-feed-profile__meta-pipe" aria-hidden>
                {' '}
                |{' '}
              </span>
              <span>
                <strong
                  title={p.followers.toLocaleString('en-US')}
                >
                  {p.followers.toLocaleString('en-US', {
                    notation: 'compact',
                    maximumFractionDigits: 1,
                  })}
                </strong>{' '}
                Followers
              </span>
            </p>
          </div>
        </header>

        <nav className="hi-feed-tabs" aria-label="Profile sections">
          <div className="hi-feed-tabs__inner">
            <span className="hi-feed-tabs__tab is-active" aria-current="page">
              Posts
            </span>
            <span className="hi-feed-tabs__tab is-dim" title="Coming soon">
              Likes
            </span>
            <span className="hi-feed-tabs__tab is-dim" title="Coming soon">
              Media
            </span>
          </div>
        </nav>
        <p className="hi-feed__post-count" aria-live="polite">
          {DUMMY_FEED_ITEMS.length} {DUMMY_FEED_ITEMS.length === 1 ? 'post' : 'posts'}
        </p>

        <ul className="hi-feed__list" key={listKey} aria-label="Public posts">
          {DUMMY_FEED_ITEMS.map((r) => (
            <FeedRow key={r.id} r={r} />
          ))}
        </ul>
      </div>
    </div>
  );
};

export default FeedPage;
