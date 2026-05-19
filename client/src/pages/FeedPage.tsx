import React, { useCallback, useEffect, useState } from 'react';
import { FEED_CHANNEL_PROFILE } from '../data/dummyFeed';
import { formatRelativeTime } from '../utils/relativeTime';
import { fetchPublicFeed, explorerTxUrl, type LedgerSubmissionRow } from '../ledgerSupabase';
import { truncateHex } from '../ledgerDemo';

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

function shortHandle(addr: string): string {
  const a = (addr || '').toLowerCase();
  if (a.length < 10) return a || 'anon';
  return `${a.slice(2, 6)}…${a.slice(-4)}`;
}

function FeedRow({ r }: { r: LedgerSubmissionRow }) {
  const isLong = r.content_type === 'long';
  const formatLabel = isLong ? 'Long-form' : 'Short post';
  const displayBody = r.public_text || '(text not published — only hashes onchain)';
  const txUrl = r.transaction_hash ? explorerTxUrl(r.transaction_hash) : undefined;
  const txPreview = r.transaction_hash ? truncateHex(r.transaction_hash, 10, 6) : 'no tx';
  const handle = shortHandle(r.author_address);

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
            {handle}
          </span>
          <span className="hi-feed-card__handle" title={r.author_address}>
            @{handle}
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
          <span className="hi-feed-pill hi-feed-pill--category">{formatLabel}</span>
        </p>

        {isLong && r.title && (
          <h3 style={{ margin: '4px 0 8px', fontSize: '1.1rem', lineHeight: 1.3 }}>{r.title}</h3>
        )}

        <FeedPostText text={displayBody} />

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

const FeedPage: React.FC = () => {
  const [rows, setRows] = useState<LedgerSubmissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [listKey, setListKey] = useState(0);
  const p = FEED_CHANNEL_PROFILE;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPublicFeed(50);
      setRows(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load feed');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = useCallback(() => {
    setListKey((k) => k + 1);
    load();
  }, [load]);

  const postCount = rows.length;

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
              disabled={loading}
            >
              {loading ? 'Refreshing…' : 'Refresh'}
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
                {' '}|{' '}
              </span>
              <span className="hi-feed-profile__link-fake">{p.websiteLabel}</span>
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
          {loading ? 'Loading…' : `${postCount} ${postCount === 1 ? 'post' : 'posts'}`}
        </p>

        {error && (
          <p style={{ color: 'crimson', padding: '0 16px' }} role="alert">
            {error}
          </p>
        )}

        {!loading && !error && rows.length === 0 && (
          <p style={{ padding: '24px 16px', opacity: 0.7 }}>
            No public posts yet. When users opt in to share their attestations, they’ll appear here.
          </p>
        )}

        <ul className="hi-feed__list" key={listKey} aria-label="Public posts">
          {rows.map((r) => (
            <FeedRow key={r.id ?? `${r.chain_id}-${r.entry_id}`} r={r} />
          ))}
        </ul>
      </div>
    </div>
  );
};

export default FeedPage;
