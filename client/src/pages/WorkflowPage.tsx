import React from 'react';
import { getLedgerContractAddress, getLedgerContractExplorerUrl } from '../ledgerContractLink';

const WorkflowPage: React.FC = () => {
  const contractUrl = getLedgerContractExplorerUrl();
  const contractAddress = getLedgerContractAddress();

  return (
    <article className="hi-workflow-page">
      <header className="hi-workflow-page__header">
        <h1 className="hi-workflow-page__title">How it works</h1>
        <p className="hi-workflow-page__intro">
          HumanInk is the infrastructure for a post-AI internet. We tie together World ID, local keystroke biometrics,
          and onchain finality to ensure your voice remains yours in an era of automated noise.
        </p>
      </header>

      <section className="hi-workflow-page__section" aria-labelledby="wf-as-you-write-heading">
        <h2 id="wf-as-you-write-heading" className="hi-workflow-page__h2">
          As you write
        </h2>
        <p className="hi-workflow-page__lede">
          As you write, two cryptographic hashes are generated in your browser. One captures your content. The other
          captures your unique human signature, built from typing biometrics like hold times, flight speed, and rhythm,
          along with session signals like tab switches and more. Raw timing data never leaves your device. What lands
          onchain is the attestation around those hashes. IPFS-backed storage and a social layer are on the roadmap
          below.
        </p>
      </section>

      <section className="hi-workflow-page__section" aria-labelledby="wf-architecture-heading">
        <h2 id="wf-architecture-heading" className="hi-workflow-page__h2">
          System Architecture
        </h2>
        <p className="hi-workflow-page__lede">
          To maintain a credible onchain record while protecting your biometric data, we use a hybrid stack:
        </p>
        <div className="hi-workflow-page__use-cases">
          <div className="hi-workflow-page__use-case">
            <h3 className="hi-workflow-page__use-case-title">Local Device</h3>
            <p>
              Raw keystrokes and timing data stay in your browser. We never see your raw keys or per-key rhythm.
            </p>
          </div>
          <div className="hi-workflow-page__use-case">
            <h3 className="hi-workflow-page__use-case-title">World Chain</h3>
            <p>
              The biometric hash and content hash serve as the cryptographic fingerprint of your effort.
            </p>
          </div>
          <div className="hi-workflow-page__use-case">
            <h3 className="hi-workflow-page__use-case-title">Database &amp; IPFS</h3>
            <p>
              The plaintext content you choose to publish so your audience can read it.
            </p>
          </div>
          <div className="hi-workflow-page__use-case">
            <h3 className="hi-workflow-page__use-case-title">World ID</h3>
            <p>
              The proof of personhood that links the session to a unique human without exposing your identity.
            </p>
          </div>
        </div>
      </section>

      <section className="hi-workflow-page__section" aria-labelledby="wf-use-cases-heading">
        <h2 id="wf-use-cases-heading" className="hi-workflow-page__h2">
          The Strategic Use Cases
        </h2>
        <div className="hi-workflow-page__use-cases">
          <div className="hi-workflow-page__use-case">
            <h3 className="hi-workflow-page__use-case-title">For Professionals</h3>
            <p>
              In a world of deepfakes, professional authority depends on trust. Use HumanInk to sign memos and strategy
              papers so partners know they are reading your direct thoughts, not a model-generated summary.
            </p>
          </div>
          <div className="hi-workflow-page__use-case">
            <h3 className="hi-workflow-page__use-case-title">For Academics</h3>
            <p>
              Maintain the integrity of original research. By providing a verifiable paper trail of the writing
              process, researchers protect their IP from being misattributed to AI and satisfy the growing demand for
              &ldquo;Human Proof&rdquo; in journals.
            </p>
          </div>
          <div className="hi-workflow-page__use-case">
            <h3 className="hi-workflow-page__use-case-title">For Creators</h3>
            <p>
              Stop competing with bots. Build a trusted audience by giving them a cryptographic guarantee that you
              actually typed your content. Our upcoming Social Feed on the World Mini App will be a zero-slop
              environment where humanity is the barrier to entry.
            </p>
          </div>
        </div>
      </section>

      <section className="hi-workflow-page__section" aria-labelledby="wf-roadmap-heading">
        <h2 id="wf-roadmap-heading" className="hi-workflow-page__h2">
          Roadmap: Building the Human Layer
        </h2>
        <ol className="hi-workflow-page__roadmap">
          <li>
            <h3 className="hi-workflow-page__roadmap-title">Infrastructure &amp; Storage</h3>
            <p>
              We are improving our smart contract infrastructure to handle global scale while integrating IPFS and
              Attestation NFTs. This moves your work from a simple &ldquo;post&rdquo; to a verifiable digital asset with
              on-chain ownership.
            </p>
          </li>
          <li>
            <h3 className="hi-workflow-page__roadmap-title">High-Stakes Verification</h3>
            <p>
              For academic and legal use cases, we are introducing optional camera-based liveness checks. This creates the
              &ldquo;Gold Standard&rdquo; of authenticity by combining keystroke biometrics with facial verification.
            </p>
          </li>
          <li>
            <h3 className="hi-workflow-page__roadmap-title">Native Social Integration</h3>
            <p>
              The future of HumanInk is a Live Social Feed within the World Mini App. We are building one-click post
              integrations so audiences and professionals can verify a &ldquo;Human-Generated&rdquo; link instantly, cutting
              through the AI slop of the open web.
            </p>
          </li>
        </ol>
      </section>

      <section className="hi-workflow-page__section" aria-labelledby="wf-privacy-heading">
        <h2 id="wf-privacy-heading" className="hi-workflow-page__h2">
          Privacy and security
        </h2>
        <p className="hi-workflow-page__lede">
          <strong>Intellectual property, security, and a credible onchain record</strong> of human-generated work.
          IPFS, Attestation NFTs, and the contract surface evolve with the stack; see the roadmap for direction.
        </p>

        <ul className="hi-workflow-page__privacy">
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
