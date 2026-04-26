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
          <Link to="/">home</Link> page. This page goes deeper on intent, privacy, and what is stored where.
        </p>
      </header>

      <section className="hi-workflow-page__section" aria-labelledby="wf-as-you-write-heading">
        <h2 id="wf-as-you-write-heading" className="hi-workflow-page__h2">
          As you write
        </h2>
        <p className="hi-workflow-page__lede">
          As you write, two cryptographic hashes are generated in your browser. One captures your content. The other
          captures your unique human signature, built from typing biometrics like hold times and rhythm, along with
          session signals like paste attempts and tab switches. Camera-based liveness is coming next. What lands onchain
          today is the attestation around those hashes; we are in parallel working toward IPFS-backed storage and clearer
          IP handling (see <em>Privacy and security</em>).
        </p>
        <p className="hi-workflow-page__analytics-note">
          This app uses Vercel Analytics to measure which pages and flows get use. It is aggregate, privacy-friendly
          traffic: not your text, not your keystrokes, and not your keys.
        </p>
      </section>

      <section className="hi-workflow-page__section" aria-labelledby="wf-workflow-heading">
        <h2 id="wf-workflow-heading" className="hi-workflow-page__h2">
          Workflow
        </h2>
        <p className="hi-workflow-page__lede">
          You complete these in order: World ID, capture, and hashing, then an optional onchain commit when you connect
          a wallet and submit. The transaction you approve is what actually writes to the ledger.
        </p>

        <ol className="hi-workflow-page__steps">
          <li className="hi-workflow-page__step">
            <div className="hi-workflow-page__step-mark" aria-hidden>
              1
            </div>
            <div className="hi-workflow-page__step-body">
              <h3 className="hi-workflow-page__step-title">World ID: verify the human behind your writing</h3>
              <p>
                Use the World ID widget to prove you are a real, unique person, tied to the <strong>content</strong> you
                will author in the next steps. The proof is cryptographic; it lets onchain and session context refer to a
                human author of this <strong>writing</strong>, not a bot.
              </p>
            </div>
          </li>
          <li className="hi-workflow-page__step">
            <div className="hi-workflow-page__step-mark" aria-hidden>
              2
            </div>
            <div className="hi-workflow-page__step-body">
              <h3 className="hi-workflow-page__step-title">Capture: typing, timing, and page activity</h3>
              <p>
                When you <strong>start a session</strong>, we read <strong>per-key</strong> timing (keydown / keyup →
                hold, flight, down-to-down) and the <strong>text</strong> in the field, and we count how many times the
                page becomes <strong>hidden</strong> during capture (tab or window change, lock screen) as a simple session
                count. Paste and bulk-insert paths are disabled so the biometric signal matches real typing. That data
                feeds the feature vector and content hash used for your attestation, not a replayable keylog in the
                product flow.
              </p>
            </div>
          </li>
          <li className="hi-workflow-page__step">
            <div className="hi-workflow-page__step-mark" aria-hidden>
              3
            </div>
            <div className="hi-workflow-page__step-body">
              <h3 className="hi-workflow-page__step-title">Hash locally: human signature and content hashes</h3>
              <p>
                When you <strong>generate a local signature</strong>, the app derives statistics from your timing (e.g. hold
                times, flight times) and forms a <strong>feature vector</strong>. That vector is the basis for a{' '}
                <strong>human signature hash</strong>, a fixed-size fingerprint, not a replay of your keystrokes. In
                parallel, your text is hashed (e.g. with SHA-256) to a <strong>content hash</strong>. Those two hashes are
                what the rest of the pipeline and contract commit to.
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
                signature hash, and any contract-defined fields, not your full text.
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
                Once included in a block, the attestation is <strong>immutable</strong> the way onchain data usually is: the
                entry commits to hashes, not a replacement for your long-form work. The contract and any linked systems
                are the source of what is in the ledger; richer handling of the work itself, including for IP, is in the
                product direction described under <em>Privacy and security</em>.
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
          <strong>Intellectual property, security, and a credible onchain record</strong> of human-generated work. We
          are implementing IPFS as part of how we treat and route content, with IP kept protected and secure as the stack
          matures.
        </p>

        <ul className="hi-workflow-page__privacy">
          <li className="hi-workflow-page__privacy-item">
            <h3 className="hi-workflow-page__privacy-title">IPFS, IP, and the ledger</h3>
            <p>
              We are in the process of implementing <strong>IPFS</strong> and tightening how commitments to your work sit
              alongside the Human Content Ledger. The aim is to keep <strong>intellectual property</strong> handled in a
              way that fits decentralized storage and onchain attestation, with security in mind as we ship.
            </p>
          </li>
          <li className="hi-workflow-page__privacy-item">
            <h3 className="hi-workflow-page__privacy-title">World ID and human verification</h3>
            <p>
              <strong>World ID</strong> is how we bind proof of personhood to the hash pipeline, so a verification path
              can point to a real human author, not a bot, in line with the contract&rsquo;s design.
            </p>
          </li>
          <li className="hi-workflow-page__privacy-item">
            <h3 className="hi-workflow-page__privacy-title">Biometric signal in the product</h3>
            <p>
              Typing timing is summarized into a <strong>feature vector</strong> and a{' '}
              <strong>human signature hash</strong>, not a high-fidelity, replayable keylog. That is what the onchain and
              feed layers are designed around.
            </p>
          </li>
          <li className="hi-workflow-page__privacy-item">
            <h3 className="hi-workflow-page__privacy-title">Onchain in this app</h3>
            <p>
              The Human Content Ledger records what the <strong>contract</strong> defines, including content and human
              signature hashes in the current shape of the app. The explorer and ABI are the ground truth for the exact
              fields.
            </p>
          </li>
          <li className="hi-workflow-page__privacy-item">
            <h3 className="hi-workflow-page__privacy-title">Roadmap</h3>
            <p>
              Alongside <strong>IPFS</strong>, we are adding more features, improving smart contract infrastructure,
              building out the <strong>social feed</strong> and <strong>one-click post</strong> integrations, including
              onchain verification of a <strong>human-generated content</strong> link, so <strong>audiences</strong>,{' '}
              <strong>academics</strong>, and <strong>professionals</strong> can see that a piece was associated with a{' '}
              <strong>verified human</strong>, not just anonymous text.
            </p>
          </li>
          <li className="hi-workflow-page__privacy-item">
            <h3 className="hi-workflow-page__privacy-title">Contract interface</h3>
            <p>
              Storage layout, events, and accessors are defined by the Human Content Ledger. Deployment in your
              build:
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
