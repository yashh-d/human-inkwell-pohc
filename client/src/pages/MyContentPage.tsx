import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { truncateHex } from '../ledgerDemo';
import {
  explorerTxUrl,
  fetchLedgerRowsByAuthor,
  type LedgerSubmissionRow,
} from '../ledgerSupabase';
import {
  listDraftsRemote,
  deleteDraftRemote,
  hydrateLocalFromRemote,
  loadDraft,
  clearDraft,
  type RemoteDraftRow,
  type DraftPayload,
} from '../utils/drafts';
import { formatRelativeTime } from '../utils/relativeTime';
import { useViewerAddress } from '../hooks/useViewerAddress';

type PublishedStatus = 'loading' | 'loaded' | 'error';
type DraftStatus = 'idle' | 'loading' | 'loaded' | 'error' | 'unavailable';

/**
 * Unified draft row shape used by the table + cards.
 * Local drafts (localStorage) and remote drafts (Supabase) are normalized
 * to this so the renderer doesn't need branches per source.
 */
type DraftRow = {
  /** Stable id; 'local-default' for the localStorage draft. */
  id: string;
  source: 'local' | 'remote';
  content: string;
  keystrokeCount: number;
  updatedAt: string; // ISO
  /** Set only when source === 'remote' */
  remote?: RemoteDraftRow;
};

function localDraftToRow(d: DraftPayload): DraftRow {
  return {
    id: 'local-default',
    source: 'local',
    content: d.content,
    keystrokeCount: Array.isArray(d.keystrokeEvents) ? d.keystrokeEvents.length : 0,
    updatedAt: d.savedAt,
  };
}

function remoteDraftToRow(d: RemoteDraftRow): DraftRow {
  return {
    id: d.id,
    source: 'remote',
    content: d.content || '',
    keystrokeCount: Array.isArray(d.keystroke_events) ? d.keystroke_events.length : 0,
    updatedAt: d.updated_at,
    remote: d,
  };
}

const PREVIEW_TABLE_LIMIT = 280;

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function truncatePreview(text: string, limit = PREVIEW_TABLE_LIMIT): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1).trimEnd()}…`;
}

function shortAddress(addr: string | null): string {
  if (!addr) return '';
  const a = addr.trim();
  if (a.length < 12) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

const MyContentPage: React.FC = () => {
  const viewer = useViewerAddress();
  const navigate = useNavigate();

  const [rows, setRows] = useState<LedgerSubmissionRow[]>([]);
  const [publishedStatus, setPublishedStatus] = useState<PublishedStatus>('loading');
  const [publishedError, setPublishedError] = useState<string>('');

  const [remoteDrafts, setRemoteDrafts] = useState<RemoteDraftRow[]>([]);
  const [localDraft, setLocalDraft] = useState<DraftPayload | null>(null);
  const [draftStatus, setDraftStatus] = useState<DraftStatus>('idle');
  const [draftError, setDraftError] = useState<string>('');
  const [deletingDraftId, setDeletingDraftId] = useState<string | null>(null);

  const [retryToken, setRetryToken] = useState<number>(0);
  const lastFetchedAddrRef = useRef<string | null>(null);

  // ─── Load published rows whenever the viewer address resolves ──────────
  useEffect(() => {
    if (viewer.status !== 'ready') return;
    const key = `${viewer.address}|${retryToken}`;
    if (lastFetchedAddrRef.current === key) return;
    lastFetchedAddrRef.current = key;

    let cancelled = false;
    setPublishedStatus('loading');
    setPublishedError('');
    (async () => {
      try {
        const fetched = await fetchLedgerRowsByAuthor(viewer.address);
        if (cancelled) return;
        setRows(fetched);
        setPublishedStatus('loaded');
      } catch (err) {
        if (cancelled) return;
        setPublishedError(err instanceof Error ? err.message : String(err));
        setRows([]);
        setPublishedStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [viewer.status, viewer.address, retryToken]);

  // ─── Local draft (localStorage) — always check, regardless of source ────
  // World App users have no Privy wallet, so remote drafts don't work for
  // them. But the writing surface still autosaves locally, and that draft
  // should be visible & resumable here too.
  useEffect(() => {
    setLocalDraft(loadDraft());
  }, [retryToken]);

  // ─── Remote drafts (Supabase) — same address-based path for everyone ───
  useEffect(() => {
    if (viewer.status !== 'ready') return;

    let cancelled = false;
    setDraftStatus('loading');
    setDraftError('');
    (async () => {
      try {
        const fetched = await listDraftsRemote(viewer.address);
        if (cancelled) return;
        setRemoteDrafts(fetched);
        setDraftStatus('loaded');
      } catch (err) {
        if (cancelled) return;
        setDraftError(err instanceof Error ? err.message : String(err));
        setRemoteDrafts([]);
        setDraftStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [viewer.status, viewer.address, retryToken]);

  // ─── Merge: local draft + remote drafts, newest first, dedup by content ─
  const drafts = useMemo<DraftRow[]>(() => {
    const rows: DraftRow[] = [];
    if (localDraft && localDraft.content.trim()) {
      rows.push(localDraftToRow(localDraft));
    }
    for (const r of remoteDrafts) {
      // Skip a remote row if it's identical to the local draft we just pushed
      // (avoids "two copies of the same draft" in the table).
      if (
        localDraft &&
        (r.content || '').trim() === (localDraft.content || '').trim() &&
        (r.content || '').trim().length > 0
      ) {
        continue;
      }
      rows.push(remoteDraftToRow(r));
    }
    return rows;
  }, [localDraft, remoteDrafts]);

  const retry = useCallback(() => {
    lastFetchedAddrRef.current = null;
    setRetryToken((n) => n + 1);
  }, []);

  const handleResumeDraft = useCallback(
    (draft: DraftRow) => {
      // Local drafts are already in localStorage — HomePage's restore path
      // (loadDraft inside the writing-overlay open effect) will pick it up
      // when /write mounts. Remote drafts need a one-time hydration first.
      if (draft.source === 'remote' && draft.remote) {
        hydrateLocalFromRemote(draft.remote);
      }
      navigate('/write');
    },
    [navigate]
  );

  const handleDeleteDraft = useCallback(
    async (draft: DraftRow) => {
      if (!window.confirm('Delete this draft? This cannot be undone.')) return;
      setDeletingDraftId(draft.id);
      try {
        if (draft.source === 'local') {
          clearDraft();
          setLocalDraft(null);
        } else if (draft.source === 'remote' && draft.remote) {
          if (viewer.status !== 'ready') {
            throw new Error('No wallet available to authorize this delete.');
          }
          await deleteDraftRemote(viewer.address, draft.remote.draft_key);
          setRemoteDrafts((prev) => prev.filter((d) => d.id !== draft.id));
        }
      } catch (e) {
        console.warn('Delete draft failed:', e);
        window.alert(`Could not delete draft: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setDeletingDraftId(null);
      }
    },
    [viewer]
  );

  // ─── Render helpers ────────────────────────────────────────────────────
  const sourceLabel = useMemo(() => {
    if (viewer.source === 'minikit') return 'World App';
    if (viewer.source === 'privy') return 'Wallet';
    return '';
  }, [viewer.source]);

  // Show the section whenever there is a draft (local or remote), or while
  // we're actively loading remote drafts, or when remote drafts errored —
  // so the user always sees state, not silence.
  const showDraftSection =
    drafts.length > 0 || draftStatus === 'loading' || draftStatus === 'error';

  return (
    <div className="hi-my-content">
      <header className="hi-my-content__header">
        <h1 className="hi-my-content__title">My content</h1>
        <p className="hi-my-content__lede">
          A single place to see writing you’ve attested onchain, whether it started as an <strong>X</strong> post, a{' '}
          <strong>LinkedIn</strong> update, a <strong>blog</strong> or <strong>Substack</strong> draft, a long{' '}
          <strong>article</strong>, or <strong>notes</strong> and <strong>newsletter</strong> copy.
        </p>

        {/* Identity chip — make it obvious which wallet's content the page is showing */}
        {viewer.status === 'ready' && (
          <div className="hi-my-content__identity" aria-label="Viewing as">
            <span className="hi-my-content__identity-dot" aria-hidden />
            <span className="hi-my-content__identity-label">{sourceLabel}</span>
            <code
              className="hi-my-content__identity-addr"
              title={viewer.address}
            >
              {shortAddress(viewer.address)}
            </code>
            <button
              type="button"
              className="hi-btn hi-btn--link hi-btn--sm"
              onClick={() => {
                navigator.clipboard?.writeText(viewer.address);
              }}
              title="Copy full address"
            >
              Copy
            </button>
          </div>
        )}
      </header>

      {/* ─── Identity gates ──────────────────────────────────────────────── */}
      {viewer.status === 'loading' && (
        <p className="hi-my-content__inline-note">Loading your account…</p>
      )}

      {viewer.status === 'no-wallet' && (
        <div className="hi-my-content__empty">
          <h2 className="hi-my-content__empty-title">Connect to see your content</h2>
          <p className="hi-my-content__empty-body">
            Sign in to load the posts you’ve attested onchain. <Link to="/">Verify and write your first piece</Link>.
          </p>
        </div>
      )}

      {viewer.status === 'needs-auth' && (
        <div className="hi-my-content__empty">
          <h2 className="hi-my-content__empty-title">View your content</h2>
          <p className="hi-my-content__empty-body">
            Tap below to confirm your World App wallet — we use it only to look up posts you’ve attested onchain.
            Nothing is stored beyond what’s already public on Worldscan.
          </p>
          <button
            type="button"
            className="hi-btn hi-btn--primary"
            style={{ marginTop: '1rem' }}
            onClick={() => {
              void viewer.authenticate();
            }}
            disabled={viewer.isAuthenticating}
          >
            {viewer.isAuthenticating ? 'Confirming…' : 'View my content'}
          </button>
          {viewer.authError && (
            <p className="hi-my-content__inline-note" style={{ marginTop: '0.75rem' }} role="alert">
              {viewer.authError}
            </p>
          )}
        </div>
      )}

      {/* ─── Drafts — local always, remote when a Privy signer exists ─── */}
      {showDraftSection && (
        <section className="hi-my-content__section hi-my-content__section--drafts">
          <h2 className="hi-my-content__section-title">
            Drafts{' '}
            {drafts.length > 0 && (
              <span className="hi-my-content__section-count">({drafts.length})</span>
            )}
          </h2>
          <p className="hi-my-content__section-sub">
            Saved automatically as you write. Resume to keep typing in the protected workspace; posting onchain moves
            the piece into Published below.
          </p>

          {draftStatus === 'loading' && drafts.length === 0 && (
            <p className="hi-my-content__inline-note">Loading drafts…</p>
          )}

          {draftStatus === 'error' && (
            <p className="hi-my-content__inline-note" role="alert">
              Could not load remote drafts: {draftError}.{' '}
              <button type="button" className="hi-btn hi-btn--link" onClick={retry}>
                Retry
              </button>
            </p>
          )}

          {drafts.length > 0 && (
            <>
              <div className="hi-my-content__table-wrap">
                <div className="hi-table-wrap" role="region" aria-label="Drafts (table)">
                  <table className="hi-table hi-table--my-content">
                    <thead>
                      <tr>
                        <th scope="col" className="hi-table__col-type">Status</th>
                        <th scope="col">Preview</th>
                        <th scope="col" className="hi-table__col-ks">Keystrokes</th>
                        <th scope="col" className="hi-table__col-when">Saved</th>
                        <th scope="col">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {drafts.map((d) => {
                        const previewFull = d.content || '[empty draft]';
                        const previewShort = truncatePreview(previewFull);
                        const when = formatRelativeTime(d.updatedAt);
                        return (
                          <tr key={d.id}>
                            <td>
                              <span
                                className="hi-content-format-pill hi-content-format-pill--draft"
                                title={
                                  d.source === 'local'
                                    ? 'Unposted draft, saved on this device'
                                    : 'Unposted draft, stored in your account'
                                }
                              >
                                DRAFT
                              </span>
                              {d.source === 'local' && (
                                <span
                                  className="hi-content-format-pill"
                                  style={{ marginLeft: 6 }}
                                  title="Saved on this device only — not yet synced to your account"
                                >
                                  THIS DEVICE
                                </span>
                              )}
                            </td>
                            <td className="hi-table__preview hi-table__preview--long">{previewShort}</td>
                            <td className="hi-table__ks" title="Keystroke events captured so far">
                              {d.keystrokeCount.toLocaleString()}
                            </td>
                            <td className="hi-table__col-when hi-table__when" title={d.updatedAt}>
                              {when}
                            </td>
                            <td>
                              <button
                                type="button"
                                className="hi-btn hi-btn--link"
                                onClick={() => handleResumeDraft(d)}
                              >
                                Resume
                              </button>
                              <button
                                type="button"
                                className="hi-btn hi-btn--link"
                                onClick={() => handleDeleteDraft(d)}
                                disabled={deletingDraftId === d.id}
                                style={{ marginLeft: 8 }}
                              >
                                {deletingDraftId === d.id ? 'Deleting…' : 'Delete'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <ul className="hi-my-content__feed" aria-label="Drafts (cards)">
                {drafts.map((d) => {
                  const previewFull = d.content || '[empty draft]';
                  const when = formatRelativeTime(d.updatedAt);
                  return (
                    <li key={d.id} className="hi-my-content__card">
                      <div className="hi-my-content__card-top">
                        <span className="hi-content-format-pill hi-content-format-pill--draft">DRAFT</span>
                        {d.source === 'local' && (
                          <span className="hi-content-format-pill" style={{ marginLeft: 6 }}>
                            THIS DEVICE
                          </span>
                        )}
                        <time className="hi-my-content__time" title={d.updatedAt}>
                          Saved {when}
                        </time>
                      </div>
                      <p className="hi-my-content__preview-text">{previewFull}</p>
                      <p className="hi-my-content__keystroke-line">
                        {d.keystrokeCount.toLocaleString()} keystrokes
                      </p>
                      <div className="hi-my-content__hashes" aria-label="Draft actions">
                        <button type="button" className="hi-btn hi-btn--link" onClick={() => handleResumeDraft(d)}>
                          Resume writing
                        </button>
                        <button
                          type="button"
                          className="hi-btn hi-btn--link"
                          onClick={() => handleDeleteDraft(d)}
                          disabled={deletingDraftId === d.id}
                        >
                          {deletingDraftId === d.id ? 'Deleting…' : 'Delete'}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>
      )}

      {/* ─── Published (onchain ledger_submissions) ─────────────────────── */}
      {viewer.status === 'ready' && (
        <section className="hi-my-content__section hi-my-content__section--published">
          <header className="hi-my-content__section-headrow">
            <h2 className="hi-my-content__section-title">
              Published
              {publishedStatus === 'loaded' && (
                <span className="hi-my-content__section-count"> ({rows.length})</span>
              )}
            </h2>
            <button
              type="button"
              className="hi-btn hi-btn--ghost hi-btn--sm"
              onClick={retry}
              disabled={publishedStatus === 'loading'}
            >
              {publishedStatus === 'loading' ? 'Refreshing…' : 'Refresh'}
            </button>
          </header>

          {publishedStatus === 'loading' && (
            <p className="hi-my-content__inline-note">Loading your published content…</p>
          )}

          {publishedStatus === 'error' && (
            <p className="hi-my-content__inline-note" role="alert">
              Could not load your content: {publishedError}.{' '}
              <button type="button" className="hi-btn hi-btn--link" onClick={retry}>
                Retry
              </button>
            </p>
          )}

          {publishedStatus === 'loaded' && rows.length === 0 && (
            <div className="hi-my-content__empty hi-my-content__empty--inline">
              <p className="hi-my-content__empty-body">
                No attested content yet for this wallet. <Link to="/">Write your first piece</Link>.
              </p>
            </div>
          )}

          {publishedStatus === 'loaded' && rows.length > 0 && (
            <>
              <div className="hi-my-content__table-wrap">
                <div className="hi-table-wrap" role="region" aria-label="Attested content (table)">
                  <table className="hi-table hi-table--my-content">
                    <thead>
                      <tr>
                        <th scope="col" className="hi-table__col-type">Status</th>
                        <th scope="col">Preview</th>
                        <th scope="col" className="hi-table__col-ks">Keystrokes</th>
                        <th scope="col">Content hash</th>
                        <th scope="col">Signature hash</th>
                        <th scope="col">Onchain</th>
                        <th scope="col" className="hi-table__col-when">When</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const previewFull = r.public_text ?? '[private — only hashes onchain]';
                        const previewShort = truncatePreview(previewFull);
                        const verifiedTag = r.is_verified ? 'World-ID verified' : 'Pending verification';
                        const when = formatWhen(r.created_at);
                        const key = r.id ?? `${r.transaction_hash}-${r.entry_id}`;
                        return (
                          <tr key={key}>
                            <td>
                              <span
                                className="hi-content-format-pill hi-content-format-pill--published"
                                title={verifiedTag}
                              >
                                PUBLISHED
                              </span>
                              {r.is_verified && (
                                <span
                                  className="hi-content-format-pill hi-content-format-pill--verified"
                                  style={{ marginLeft: 6 }}
                                  title="This piece carries a World ID nullifier checked by our API"
                                >
                                  VERIFIED
                                </span>
                              )}
                            </td>
                            <td className="hi-table__preview hi-table__preview--long">{previewShort}</td>
                            <td
                              className="hi-table__ks"
                              title="Keys recorded in the attested typing session (device-local signal summarized as a hash onchain)"
                            >
                              {r.keystroke_count.toLocaleString()}
                            </td>
                            <td>
                              <code className="hi-table__mono">{truncateHex(r.content_hash)}</code>
                            </td>
                            <td>
                              <code className="hi-table__mono">{truncateHex(r.human_signature_hash)}</code>
                            </td>
                            <td>
                              <a href={explorerTxUrl(r.transaction_hash)} target="_blank" rel="noopener noreferrer">
                                View tx
                              </a>
                            </td>
                            <td className="hi-table__col-when hi-table__when">{when}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <ul className="hi-my-content__feed" aria-label="Attested content (cards)">
                {rows.map((r) => {
                  const previewFull = r.public_text ?? '[private — only hashes onchain]';
                  const when = formatWhen(r.created_at);
                  const key = r.id ?? `${r.transaction_hash}-${r.entry_id}`;
                  return (
                    <li key={key} className="hi-my-content__card">
                      <div className="hi-my-content__card-top">
                        <span className="hi-content-format-pill hi-content-format-pill--published">PUBLISHED</span>
                        {r.is_verified && (
                          <span
                            className="hi-content-format-pill hi-content-format-pill--verified"
                            style={{ marginLeft: 6 }}
                          >
                            VERIFIED
                          </span>
                        )}
                        <time className="hi-my-content__time">{when}</time>
                      </div>
                      <p className="hi-my-content__preview-text">{previewFull}</p>
                      <p className="hi-my-content__keystroke-line" aria-label="Session keystroke count">
                        {r.keystroke_count.toLocaleString()} keystrokes
                      </p>
                      <div className="hi-my-content__hashes" aria-label="Hash fingerprints">
                        <div>
                          <span className="hi-my-content__k">Content</span>
                          <code className="hi-my-content__hash">{truncateHex(r.content_hash, 8, 4)}</code>
                        </div>
                        <div>
                          <span className="hi-my-content__k">Signature</span>
                          <code className="hi-my-content__hash">{truncateHex(r.human_signature_hash, 8, 4)}</code>
                        </div>
                      </div>
                      <a
                        className="hi-my-content__tx"
                        href={explorerTxUrl(r.transaction_hash)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open transaction
                      </a>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>
      )}
    </div>
  );
};

export default MyContentPage;
