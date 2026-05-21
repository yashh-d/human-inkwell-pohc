import React from 'react';
import { MY_CONTENT_DEMO_ROWS, demoTxUrl, truncateHex } from '../ledgerDemo';

const MyContentPage: React.FC = () => {
  const rows = MY_CONTENT_DEMO_ROWS;

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
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <span className="hi-content-format-pill" title="Where this writing came from (demo)">
                      {r.contentFormat}
                    </span>
                  </td>
                  <td className="hi-table__preview hi-table__preview--long">{r.contentPreview}</td>
                  <td
                    className="hi-table__ks"
                    title="Keys recorded in the attested typing session (device-local signal summarized as a hash onchain)"
                  >
                    {r.keystrokeCount.toLocaleString()}
                  </td>
                  <td>
                    <code className="hi-table__mono">{truncateHex(r.contentHash)}</code>
                  </td>
                  <td>
                    <code className="hi-table__mono">{truncateHex(r.humanSignatureHash)}</code>
                  </td>
                  <td>
                    <a href={demoTxUrl(r.transactionHash)} target="_blank" rel="noopener noreferrer">
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
            <a className="hi-my-content__tx" href={demoTxUrl(r.transactionHash)} target="_blank" rel="noopener noreferrer">
              Open transaction
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default MyContentPage;
