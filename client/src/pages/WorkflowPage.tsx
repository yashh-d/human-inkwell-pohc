import React from 'react';
import { Link } from 'react-router-dom';
import { getLedgerContractAddress, getLedgerContractExplorerUrl } from '../ledgerContractLink';

const WorkflowPage: React.FC = () => {
  const contractUrl = getLedgerContractExplorerUrl();
  const contractAddress = getLedgerContractAddress();

  return (
    <article className="hi-workflow-page">
      <header className="hi-workflow-page__header">
        <h1 className="hi-workflow-page__title">How it works</h1>
        <p className="hi-workflow-page__intro">
          Human Inkwell ties together <strong>World ID</strong> (proof of personhood), <strong>local keystroke
          biometrics</strong> (turned into a compact hash, not raw data), and an <strong>onchain attestation</strong> on
          World Chain. The steps below are the same flow you follow on the{' '}
          <Link to="/">home</Link> page—this page goes deeper on intent, privacy, and what is stored where.
        </p>
      </header>

      <section className="hi-workflow-page__section" aria-labelledby="wf-workflow-heading">
        <h2 id="wf-workflow-heading" className="hi-workflow-page__h2">
          Workflow
        </h2>
        <p className="hi-workflow-page__lede">
          You complete these in order. Nothing is sent to a traditional app server: verification and hashing run in your
          browser; only your wallet broadcast reaches the network when you choose to submit.
        </p>

        <ol className="hi-workflow-page__steps">
          <li className="hi-workflow-page__step">
            <div className="hi-workflow-page__step-mark" aria-hidden>
              1
            </div>
            <div className="hi-workflow-page__step-body">
              <h3 className="hi-workflow-page__step-title">World ID: verify the human behind your writing</h3>
              <p>
                Use the World ID widget to prove you are a real, unique person—tied to the <strong>content</strong> you
                will author in the next steps. The proof is cryptographic; it lets your on-chain and session attestations
                refer to a human author of this <strong>writing</strong>, not a bot, without giving this app your name or
                email in the clear.
              </p>
            </div>
          </li>
          <li className="hi-workflow-page__step">
            <div className="hi-workflow-page__step-mark" aria-hidden>
              2
            </div>
            <div className="hi-workflow-page__step-body">
              <h3 className="hi-workflow-page__step-title">Capture: type in the field so keystroke timing is recorded</h3>
              <p>
                After you <strong>start a creative session</strong>, the app records timing events (press and release
                times) in the browser. Copy, paste, and most bulk insertion paths are disabled so the pattern reflects
                live typing, not pasted content. If you switch away from the tab or window, that can be noted for
                context—only as metadata for your session, not for upload as raw biometrics.
              </p>
            </div>
          </li>
          <li className="hi-workflow-page__step">
            <div className="hi-workflow-page__step-mark" aria-hidden>
              3
            </div>
            <div className="hi-workflow-page__step-body">
              <h3 className="hi-workflow-page__step-title">Hash locally: human signature and content hashes in your browser</h3>
              <p>
                When you <strong>generate a local signature</strong>, the app derives statistics from your timing (e.g. hold
                times, flight times) and forms a <strong>feature vector</strong>. That vector is the basis for a{' '}
                <strong>human signature hash</strong>—a fixed-size fingerprint, not a replay of your keystrokes. In parallel, your
                text is hashed (e.g. with SHA-256) to a <strong>content hash</strong>. Both are computed on-device; raw
                keystroke arrays are not &ldquo;uploaded&rdquo; to this flow as telemetry.
              </p>
            </div>
          </li>
          <li className="hi-workflow-page__step">
            <div className="hi-workflow-page__step-mark" aria-hidden>
              4
            </div>
            <div className="hi-workflow-page__step-body">
              <h3 className="hi-workflow-page__step-title">Submit onchain: Human Content Ledger transaction</h3>
              <p>
                If you connect your wallet and choose to <strong>submit to the blockchain</strong>, you send a transaction to
                the <strong>Human Content Ledger</strong> contract. Your wallet pays network fees. The transaction is designed
                to commit references that tie together proof-of-personhood context, the content hash, the human
                signature hash, and any contract-defined fields—not your full text.
              </p>
            </div>
          </li>
          <li className="hi-workflow-page__step">
            <div className="hi-workflow-page__step-mark" aria-hidden>
              5
            </div>
            <div className="hi-workflow-page__step-body">
              <h3 className="hi-workflow-page__step-title">Permanence: attestation and hashes onchain, not your plaintext</h3>
              <p>
                Once included in a block, the attestation is <strong>immutable</strong> in the sense usual for onchain
                data: the ledger entry does not &ldquo;update&rdquo; to replace your hashes with your original text. The
                plaintext of what you wrote remains offchain unless you share it yourself. Demo UIs (like the {' '}
                <strong>My content</strong> page) may show a short <strong>preview in your session</strong> only; production
                systems typically
                index only hashes, transaction pointers, and metadata you explicitly define.
              </p>
            </div>
          </li>
        </ol>
      </section>

      <section className="hi-workflow-page__section" aria-labelledby="wf-privacy-heading">
        <h2 id="wf-privacy-heading" className="hi-workflow-page__h2">
          Privacy and security
        </h2>
        <p className="hi-workflow-page__lede">
          The design goal is: <strong>verifiable humanness and content binding</strong> with <strong>minimal disclosure</strong>.
        </p>

        <ul className="hi-workflow-page__privacy">
          <li className="hi-workflow-page__privacy-item">
            <h3 className="hi-workflow-page__privacy-title">World ID and identity</h3>
            <p>
              World ID is built to let you <strong>prove you&rsquo;re human</strong> without shipping traditional identity
              fields in plain text to every app. What you see in the app is an attestation flow, not a login form for your
              legal name or email.
            </p>
          </li>
          <li className="hi-workflow-page__privacy-item">
            <h3 className="hi-workflow-page__privacy-title">Biometrics: derived features, not raw keylogs</h3>
            <p>
              <strong>Feature vectors and hashes</strong> are computed locally from timing statistics before any optional
              chain submission. This app&rsquo;s onchain design is for <strong>hashes and signals</strong>, not a
              high-fidelity keylog. Treat any demo data as non-production; operators still owe users clear policies and
              consent for any off-device processing if they add it later.
            </p>
          </li>
          <li className="hi-workflow-page__privacy-item">
            <h3 className="hi-workflow-page__privacy-title">What actually goes onchain in this app</h3>
            <p>
              <strong>Only hashes (and the fields the contract defines)</strong> are intended to land onchain—<strong>not
              your full text</strong>. Your UTF-8 content is hashed in the browser; the chain stores a commitment
              appropriate to the contract&rsquo;s design, not your article or message body.
            </p>
          </li>
          <li className="hi-workflow-page__privacy-item">
            <h3 className="hi-workflow-page__privacy-title">Contract interface</h3>
            <p>
              The precise storage layout, events, and accessors are defined by the Human Content Ledger smart contract. Use
              the canonical deployment you target in your build:
            </p>
            <p className="hi-workflow-page__contract">
              <a href={contractUrl} target="_blank" rel="noopener noreferrer" className="hi-workflow-page__contract-link">
                View the Human Content Ledger on the block explorer
              </a>
              <code className="hi-workflow-page__contract-addr" title="Configured contract address">
                {contractAddress}
              </code>
            </p>
          </li>
        </ul>
      </section>
    </article>
  );
};

export default WorkflowPage;
