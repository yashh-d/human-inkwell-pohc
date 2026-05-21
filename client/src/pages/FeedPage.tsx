import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FEED_CHANNEL_PROFILE } from '../data/dummyFeed';
import { formatRelativeTime } from '../utils/relativeTime';
import {
  explorerTxUrl,
  fetchPublicFeed,
  type LedgerSubmissionRow,
} from '../ledgerSupabase';

const PREVIEW_CHARS = 300;

function addressHue(addr: string): number {
  const s = (addr || '0x').toLowerCase();
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 33 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

function shortAddress(addr: string): string {
  const a = (addr || '').trim();
  if (a.length < 12) return a || '0x…';
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function shortTx(tx: string): string {
  const t = (tx || '').trim();
  if (t.length < 16) return t || '0x…';
  return `${t.slice(0, 8)}…${t.slice(-6)}`;
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

function FeedRow({ r }: { r: LedgerSubmissionRow }) {
  const displayName = shortAddress(r.author_address);
  const handle = `#${r.entry_id}`;
  const publicText = r.public_text ?? '';
  const txUrl = r.transaction_hash ? explorerTxUrl(r.transaction_hash) : undefined;
  const txPreview = r.transaction_hash ? shortTx(r.transaction_hash) : 'no tx';

  return (
    <li className="hi-feed-card">
      <div
        className="hi-feed-card__avatar"
        style={{ '--hi-feed-hue': `${addressHue(r.author_address)}` } as React.CSSProperties}
        aria-hidden
        title={r.author_address}
      />
      <div className="hi-feed-card__main">
        <div className="hi-feed-card__byline">
          <span className="hi-feed-card__display" title={r.author_address}>
            {displayName}
          </span>
          <span className="hi-feed-card__handle" title={`entry #${r.entry_id}`}>
            {handle}
          </span>
          <span className="hi-feed-card__dot" aria-hidden>
            ·
          </span>
          <time
            className="hi-feed-card__time"
            dateTime={r.created_at}
            title={new Date(r.created_at).toLocaleString()}
          >
            {formatRelativeTime(r.created_at)}
          </time>
        </div>

        <p className="hi-feed-card__chips" aria-label="Post category">
          <span className="hi-feed-pill hi-feed-pill--category">VERIFIED</span>
        </p>

        <FeedPostText text={publicText} />

        <p className="hi-feed-card__signature-bar" aria-label="Attestation and transaction reference">
          <span className="hi-feed-card__sig-icon" aria-hidden>
            ✓
          </span>
          <span className="hi-feed-card__sig-text">
            Verified Human: {r.keystroke_count.toLocaleString()} Keystrokes
          </span>
          <span className="hi-feed-card__sig-sep" aria-hidden>
            |
          </span>
          {txUrl ? (
            <a
              href={txUrl}
              className="hi-feed-card__sig-tx"
              target="_blank"
              rel="noopener noreferrer"
              title="View on block explorer"
            >
              {txPreview}
            </a>
          ) : (
            <span className="hi-feed-card__sig-tx hi-feed-card__sig-tx--static">{txPreview}</span>
          )}
        </p>
      </div>
    </li>
  );
}

type LoadState = 'loading' | 'error' | 'loaded';

const FeedPage: React.FC = () => {
  const [rows, setRows] = useState<LedgerSubmissionRow[]>([]);
  const [status, setStatus] = useState<LoadState>('loading');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const p = FEED_CHANNEL_PROFILE;

  const load = useCallback(async () => {
    setStatus('loading');
    setErrorMsg('');
    try {
      const data = await fetchPublicFeed(50);
      const withText = data.filter((r) => (r.public_text ?? '').trim() !== '');
      setRows(withText);
      setStatus('loaded');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Failed to load feed');
      setRows([]);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = useCallback(() => {
    load();
  }, [load]);

  const postCount = status === 'loaded' ? rows.length : 0;

  return (
    <div className="hi-feed">
      <div className="hi-feed__shell">
        <div className="hi-feed__toprow">
          <h1 className="hi-feed__eyebrow">Feed</h1>
          <div className="hi-feed__toprow-actions">
            <button
              type="button"
              className="hi-btn hi-btn--ghost hi-btn--sm hi-feed__refresh-btn"
              onClick={refresh}
              disabled={status === 'loading'}
            >
              {status === 'loading' ? 'Refreshing…' : 'Refresh'}
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
          {postCount} {postCount === 1 ? 'post' : 'posts'}
        </p>

        <ul className="hi-feed__list" aria-label="Public posts">
          {status === 'loading' && (
            <li className="hi-feed-card">
              <p>Loading posts…</p>
            </li>
          )}
          {status === 'error' && (
            <li className="hi-feed-card">
              <p role="alert">
                Could not load feed: {errorMsg}.{' '}
                <button type="button" onClick={refresh}>
                  Retry
                </button>
              </p>
            </li>
          )}
          {status === 'loaded' && rows.length === 0 && (
            <li className="hi-feed-card">
              <p>
                No verified posts yet. Be the first — <Link to="/">write something</Link>.
              </p>
            </li>
          )}
          {status === 'loaded' &&
            rows.map((r) => <FeedRow key={r.id ?? `${r.entry_id}-${r.transaction_hash}`} r={r} />)}
        </ul>
      </div>
    </div>
  );
};

export default FeedPage;
