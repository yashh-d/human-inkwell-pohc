import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useWallets } from '@privy-io/react-auth';
import { ethers } from 'ethers';
import { truncateHex } from '../ledgerDemo';
import {
  fetchMyLedgerRows,
  explorerTxUrl,
  type LedgerSubmissionRow,
} from '../ledgerSupabase';
import {
  listDraftsRemote,
  deleteDraftRemote,
  hydrateLocalFromRemote,
  type RemoteDraftRow,
} from '../utils/drafts';
import { formatRelativeTime } from '../utils/relativeTime';

type FetchStatus = 'idle' | 'loading' | 'loaded' | 'error' | 'no-wallet';

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

const MyContentPage: React.FC = () => {
  const { wallets } = useWallets();
  const navigate = useNavigate();
  const [rows, setRows] = useState<LedgerSubmissionRow[]>([]);
  const [drafts, setDrafts] = useState<RemoteDraftRow[]>([]);
  const [status, setStatus] = useState<FetchStatus>('idle');
  const [errMsg, setErrMsg] = useState<string>('');
  const didFetchRef = useRef<boolean>(false);
  const [retryToken, setRetryToken] = useState<number>(0);
  const [deletingDraftId, setDeletingDraftId] = useState<string | null>(null);

  useEffect(() => {
    if (didFetchRef.current) return;

    if (!wallets) return;

    if (wallets.length === 0) {
      setStatus('no-wallet');
      return;
    }

    didFetchRef.current = true;
    let cancelled = false;
    setStatus('loading');
    setErrMsg('');

    (async () => {
      try {
        const wallet = wallets.find((w) => w.walletClientType === 'privy') || wallets[0];
        const ethProvider = await wallet.getEthereumProvider();
        const provider = new ethers.BrowserProvider(ethProvider as any);
        const signer = await provider.getSigner();
        // Fetch published (onchain) ledger rows and unposted drafts in parallel.
        const [fetchedRows, fetchedDrafts] = await Promise.all([
          fetchMyLedgerRows(signer),
          listDraftsRemote(signer).catch((e) => {
            // Drafts are a non-critical secondary list; surface a warning but
            // don't fail the whole page if the drafts table isn't migrated yet.
            console.warn('Drafts list failed:', e);
            return [] as RemoteDraftRow[];
          }),
        ]);
        if (cancelled) return;
        setRows(fetchedRows);
        setDrafts(fetchedDrafts);
        setStatus('loaded');
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setErrMsg(msg);
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [wallets, retryToken]);

  const retry = useCallback(() => {
    didFetchRef.current = false;
    setRetryToken((n) => n + 1);
  }, []);

  const handleResumeDraft = useCallback(
    (draft: RemoteDraftRow) => {
      // Mirror the remote row into localStorage so HomePage's existing
      // restore-from-localStorage flow takes over once /write mounts.
      hydrateLocalFromRemote(draft);
      navigate('/write');
    },
    [navigate]
  );

  const handleDeleteDraft = useCallback(
    async (draft: RemoteDraftRow) => {
      if (!wallets || wallets.length === 0) return;
      if (!window.confirm('Delete this draft? This cannot be undone.')) return;
      setDeletingDraftId(draft.id);
      try {
        const wallet = wallets.find((w) => w.walletClientType === 'privy') || wallets[0];
        const ethProvider = await wallet.getEthereumProvider();
        const provider = new ethers.BrowserProvider(ethProvider as any);
        const signer = await provider.getSigner();
        await deleteDraftRemote(signer, draft.draft_key);
        setDrafts((prev) => prev.filter((d) => d.id !== draft.id));
      } catch (e) {
        console.warn('Delete draft failed:', e);
        window.alert(`Could not delete draft: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setDeletingDraftId(null);
      }
    },
    [wallets]
  );

  const showTable = status === 'loaded' && rows.length > 0;
  const showCards = status === 'loaded' && rows.length > 0;
  const showLoading = status === 'idle' || status === 'loading';
  const showDrafts = status === 'loaded' && drafts.length > 0;

  return (
    <div className="hi-my-content">
      <header className="hi-my-content__header">
        <h1 className="hi-my-content__title">My content</h1>
        <p className="hi-my-content__lede">
          A single place to see writing you’ve attested onchain, whether it started as an <strong>X</strong> post, a{' '}
          <strong>LinkedIn</strong> update, a <strong>blog</strong> or <strong>Substack</strong> draft, a long{' '}
          <strong>article</strong>, or <strong>notes</strong> and <strong>newsletter</strong> copy.
        </p>
      </header>

      {status === 'no-wallet' && (
        <p>
          Connect a wallet to see your attested content. <Link to="/">Verify and write your first piece</Link>.
        </p>
      )}

      {status === 'error' && (
        <p role="alert">
          Could not load your content: {errMsg}. <button onClick={retry}>Retry</button>
        </p>
      )}

      {/* ─── Drafts (unposted, in Supabase content_drafts) ──────────────── */}
      {showDrafts && (
        <section className="hi-my-content__section hi-my-content__section--drafts">
          <h2 className="hi-my-content__section-title">
            Drafts <span className="hi-my-content__section-count">({drafts.length})</span>
          </h2>
          <p className="hi-my-content__section-sub">
            Saved automatically as you write. Resume to keep typing in the protected workspace; posting onchain moves the
            piece into Published below.
          </p>
          <div className="hi-my-content__table-wrap">
            <div className="hi-table-wrap" role="region" aria-label="Drafts (table)">
              <table className="hi-table hi-table--my-content">
                <thead>
                  <tr>
                    <th scope="col" className="hi-table__col-type">
                      Status
                    </th>
                    <th scope="col">Preview</th>
                    <th scope="col" className="hi-table__col-ks">
                      Keystrokes
                    </th>
                    <th scope="col" className="hi-table__col-when">
                      Saved
                    </th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {drafts.map((d) => {
                    const previewFull = d.content || '[empty draft]';
                    const previewShort = truncatePreview(previewFull);
                    const ks = Array.isArray(d.keystroke_events) ? d.keystroke_events.length : 0;
                    const when = formatRelativeTime(d.updated_at);
                    return (
                      <tr key={d.id}>
                        <td>
                          <span
                            className="hi-content-format-pill hi-content-format-pill--draft"
                            title="Unposted draft, stored in Supabase"
                          >
                            DRAFT
                          </span>
                        </td>
                        <td className="hi-table__preview hi-table__preview--long">{previewShort}</td>
                        <td className="hi-table__ks" title="Keystroke events captured so far">
                          {ks.toLocaleString()}
                        </td>
                        <td className="hi-table__col-when hi-table__when" title={d.updated_at}>
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

          {/* Mobile/narrow viewport cards for drafts */}
          <ul className="hi-my-content__feed" aria-label="Drafts (cards)">
            {drafts.map((d) => {
              const previewFull = d.content || '[empty draft]';
              const ks = Array.isArray(d.keystroke_events) ? d.keystroke_events.length : 0;
              const when = formatRelativeTime(d.updated_at);
              return (
                <li key={d.id} className="hi-my-content__card">
                  <div className="hi-my-content__card-top">
                    <span className="hi-content-format-pill hi-content-format-pill--draft">DRAFT</span>
                    <time className="hi-my-content__time" title={d.updated_at}>
                      Saved {when}
                    </time>
                  </div>
                  <p className="hi-my-content__preview-text">{previewFull}</p>
                  <p className="hi-my-content__keystroke-line">{ks.toLocaleString()} keystrokes</p>
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
        </section>
      )}

      {/* ─── Published (onchain ledger_submissions) ─────────────────────── */}
      <section className="hi-my-content__section hi-my-content__section--published">
        <h2 className="hi-my-content__section-title">
          Published
          {status === 'loaded' && <span className="hi-my-content__section-count"> ({rows.length})</span>}
        </h2>

        {status === 'loaded' && rows.length === 0 && (
          <p>
            No attested content yet. <Link to="/">Write your first piece</Link>.
          </p>
        )}

        {status !== 'no-wallet' && status !== 'loaded' && (
          <div className="hi-my-content__table-wrap">
            <div className="hi-table-wrap" role="region" aria-label="Attested content (table)">
              <table className="hi-table hi-table--my-content">
                <thead>
                  <tr>
                    <th scope="col" className="hi-table__col-type">
                      Status
                    </th>
                    <th scope="col">Preview</th>
                    <th scope="col" className="hi-table__col-ks">
                      Keystrokes
                    </th>
                    <th scope="col">Content hash</th>
                    <th scope="col">Signature hash</th>
                    <th scope="col">Onchain</th>
                    <th scope="col" className="hi-table__col-when">
                      When
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td colSpan={7} className="hi-table__preview">
                      {showLoading ? 'Loading your content…' : '—'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {(showLoading || status === 'error') && (
          <ul className="hi-my-content__feed" aria-label="Attested content (cards)">
            <li className="hi-my-content__card">
              <p className="hi-my-content__preview-text">{showLoading ? 'Loading your content…' : '—'}</p>
            </li>
          </ul>
        )}

        {showTable && (
          <div className="hi-my-content__table-wrap">
            <div className="hi-table-wrap" role="region" aria-label="Attested content (table)">
              <table className="hi-table hi-table--my-content">
                <thead>
                  <tr>
                    <th scope="col" className="hi-table__col-type">
                      Status
                    </th>
                    <th scope="col">Preview</th>
                    <th scope="col" className="hi-table__col-ks">
                      Keystrokes
                    </th>
                    <th scope="col">Content hash</th>
                    <th scope="col">Signature hash</th>
                    <th scope="col">Onchain</th>
                    <th scope="col" className="hi-table__col-when">
                      When
                    </th>
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
        )}

        {showCards && (
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
        )}
      </section>
    </div>
  );
};

export default MyContentPage;
