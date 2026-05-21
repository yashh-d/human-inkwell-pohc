import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useWallets } from '@privy-io/react-auth';
import { ethers } from 'ethers';
import { truncateHex } from '../ledgerDemo';
import {
  fetchMyLedgerRows,
  explorerTxUrl,
  type LedgerSubmissionRow,
} from '../ledgerSupabase';

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
  const [rows, setRows] = useState<LedgerSubmissionRow[]>([]);
  const [status, setStatus] = useState<FetchStatus>('idle');
  const [errMsg, setErrMsg] = useState<string>('');
  const didFetchRef = useRef<boolean>(false);
  const [retryToken, setRetryToken] = useState<number>(0);

  useEffect(() => {
    // Wait until Privy has initialized wallets (the array starts empty and then populates).
    // We only want to act once we have a definitive answer.
    if (didFetchRef.current) return;

    if (!wallets) return;

    if (wallets.length === 0) {
      // Privy may briefly report no wallets while connecting; don't lock to 'no-wallet'
      // permanently on first paint — only set it if we still have none after a tick.
      // Keeping it simple: set 'no-wallet' immediately; the effect re-runs on `wallets` change.
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
        const fetched = await fetchMyLedgerRows(signer);
        if (cancelled) return;
        setRows(fetched);
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

  const showTable = status === 'loaded' && rows.length > 0;
  const showCards = status === 'loaded' && rows.length > 0;
  const showLoading = status === 'idle' || status === 'loading';

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
                    Format
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
                    Format
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
                  const pill = r.is_verified ? 'VERIFIED' : 'PENDING';
                  const when = formatWhen(r.created_at);
                  const key = r.id ?? `${r.transaction_hash}-${r.entry_id}`;
                  return (
                    <tr key={key}>
                      <td>
                        <span className="hi-content-format-pill" title="Verification status of this attestation">
                          {pill}
                        </span>
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
            const pill = r.is_verified ? 'VERIFIED' : 'PENDING';
            const when = formatWhen(r.created_at);
            const key = r.id ?? `${r.transaction_hash}-${r.entry_id}`;
            return (
              <li key={key} className="hi-my-content__card">
                <div className="hi-my-content__card-top">
                  <span className="hi-content-format-pill">{pill}</span>
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
    </div>
  );
};

export default MyContentPage;
