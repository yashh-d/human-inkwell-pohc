import React, { useEffect, useMemo, useState } from 'react';
import { useWallets } from '@privy-io/react-auth';
import { ethers } from 'ethers';
import {
  fetchMyLedgerRows,
  explorerTxUrl,
  type LedgerSubmissionRow,
} from '../ledgerSupabase';
import { truncateHex } from '../ledgerDemo';

type ViewRow = {
  id: string;
  contentFormat: string;
  contentPreview: string;
  title: string | null;
  keystrokeCount: number;
  contentHash: string;
  humanSignatureHash: string;
  transactionHash: string;
  indexedAtLabel: string;
};

function rowToView(r: LedgerSubmissionRow): ViewRow {
  const isLong = r.content_type === 'long';
  const preview = r.public_text
    ? r.public_text.length > 280
      ? `${r.public_text.slice(0, 280).trim()}…`
      : r.public_text
    : isLong
      ? 'Long-form entry · text not published to feed'
      : 'Short entry · text not published to feed';
  return {
    id: r.id ?? `${r.chain_id}-${r.entry_id}`,
    contentFormat: isLong ? 'Long-form' : 'Short post',
    contentPreview: preview,
    title: r.title ?? null,
    keystrokeCount: r.keystroke_count,
    contentHash: r.content_hash,
    humanSignatureHash: r.human_signature_hash,
    transactionHash: r.transaction_hash,
    indexedAtLabel: new Date(r.created_at).toLocaleString(),
  };
}

const MyContentPage: React.FC = () => {
  const { wallets } = useWallets();
  const [rows, setRows] = useState<ViewRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const activeWallet = useMemo(() => {
    if (!wallets || wallets.length === 0) return null;
    return wallets.find((w) => w.walletClientType === 'privy') || wallets[0];
  }, [wallets]);

  useEffect(() => {
    let cancelled = false;
    if (!activeWallet) {
      setRows(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const ethereumProvider = await activeWallet.getEthereumProvider();
        const provider = new ethers.BrowserProvider(ethereumProvider as any);
        const signer = await provider.getSigner();
        const data = await fetchMyLedgerRows(signer);
        if (cancelled) return;
        setRows(data.map(rowToView));
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load your content');
        setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeWallet]);

  return (
    <div className="hi-my-content">
      <header className="hi-my-content__header">
        <h1 className="hi-my-content__title">My content</h1>
        <p className="hi-my-content__lede">
          A single place to see writing you’ve attested onchain — short posts and long-form, all signed by your wallet.
        </p>
      </header>

      {!activeWallet && (
        <p className="hi-my-content__lede" style={{ marginTop: 16 }}>
          Connect your wallet to load your attested content.
        </p>
      )}
      {activeWallet && loading && (
        <p className="hi-my-content__lede" style={{ marginTop: 16 }}>
          Loading your content…
        </p>
      )}
      {activeWallet && !loading && error && (
        <p className="hi-my-content__lede" style={{ marginTop: 16, color: 'crimson' }}>
          {error}
        </p>
      )}
      {activeWallet && !loading && !error && rows && rows.length === 0 && (
        <p className="hi-my-content__lede" style={{ marginTop: 16 }}>
          No attestations yet. Publish a piece from the home page and it will appear here.
        </p>
      )}

      {rows && rows.length > 0 && (
        <>
          <div className="hi-my-content__table-wrap">
            <div className="hi-table-wrap" role="region" aria-label="Attested content (table)">
              <table className="hi-table hi-table--my-content">
                <thead>
                  <tr>
                    <th scope="col" className="hi-table__col-type">
                      Format
                    </th>
                    <th scope="col">Title / Preview</th>
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
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <span className="hi-content-format-pill">{r.contentFormat}</span>
                      </td>
                      <td className="hi-table__preview hi-table__preview--long">
                        {r.title && (
                          <strong style={{ display: 'block', marginBottom: 4 }}>{r.title}</strong>
                        )}
                        {r.contentPreview}
                      </td>
                      <td className="hi-table__ks">{r.keystrokeCount.toLocaleString()}</td>
                      <td>
                        <code className="hi-table__mono">{truncateHex(r.contentHash)}</code>
                      </td>
                      <td>
                        <code className="hi-table__mono">{truncateHex(r.humanSignatureHash)}</code>
                      </td>
                      <td>
                        <a href={explorerTxUrl(r.transactionHash)} target="_blank" rel="noopener noreferrer">
                          View tx
                        </a>
                      </td>
                      <td className="hi-table__col-when hi-table__when">{r.indexedAtLabel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <ul className="hi-my-content__feed" aria-label="Attested content (cards)">
            {rows.map((r) => (
              <li key={r.id} className="hi-my-content__card">
                <div className="hi-my-content__card-top">
                  <span className="hi-content-format-pill">{r.contentFormat}</span>
                  <time className="hi-my-content__time">{r.indexedAtLabel}</time>
                </div>
                {r.title && (
                  <h3 style={{ margin: '4px 0 6px', fontSize: '1rem' }}>{r.title}</h3>
                )}
                <p className="hi-my-content__preview-text">{r.contentPreview}</p>
                <p className="hi-my-content__keystroke-line" aria-label="Session keystroke count">
                  {r.keystrokeCount.toLocaleString()} keystrokes
                </p>
                <div className="hi-my-content__hashes" aria-label="Hash fingerprints">
                  <div>
                    <span className="hi-my-content__k">Content</span>
                    <code className="hi-my-content__hash">{truncateHex(r.contentHash, 8, 4)}</code>
                  </div>
                  <div>
                    <span className="hi-my-content__k">Signature</span>
                    <code className="hi-my-content__hash">{truncateHex(r.humanSignatureHash, 8, 4)}</code>
                  </div>
                </div>
                <a
                  className="hi-my-content__tx"
                  href={explorerTxUrl(r.transactionHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open transaction
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
};

export default MyContentPage;
