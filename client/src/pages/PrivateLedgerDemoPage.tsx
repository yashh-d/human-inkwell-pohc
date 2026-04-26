import React from 'react';
import { LEDGER_DEMO_ROWS, demoTxUrl, truncateHex } from '../ledgerDemo';

const PrivateLedgerDemoPage: React.FC = () => {
  return (
    <div className="hi-ledger">
      <h2 className="hi-ledger__title">Private ledger (demo)</h2>
      <p className="hi-muted hi-ledger__lede">
        Example of how a wallet-bound index could look: a link to the onchain transaction, your content and
        signature <strong>hashes</strong>, and a short content preview. In production, only hashes and the tx are
        stored; the preview is for your session only.
      </p>
      <div className="hi-table-wrap">
        <table className="hi-table">
          <thead>
            <tr>
              <th>Content (preview)</th>
              <th>Content hash</th>
              <th>Signature hash</th>
              <th>Transaction</th>
              <th>Indexed</th>
            </tr>
          </thead>
          <tbody>
            {LEDGER_DEMO_ROWS.map((r) => (
              <tr key={r.id}>
                <td className="hi-table__preview">{r.contentPreview}</td>
                <td>
                  <code className="hi-table__mono">{truncateHex(r.contentHash)}</code>
                </td>
                <td>
                  <code className="hi-table__mono">{truncateHex(r.humanSignatureHash)}</code>
                </td>
                <td>
                  <a href={demoTxUrl(r.transactionHash)} target="_blank" rel="noopener noreferrer">
                    View on explorer
                  </a>
                </td>
                <td className="hi-table__when">{r.indexedAtLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default PrivateLedgerDemoPage;
