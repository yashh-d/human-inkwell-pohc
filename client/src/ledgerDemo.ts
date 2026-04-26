import { explorerTxUrl } from './ledgerSupabase';

/** One row in the “My content” view (demo): writing from any format, attested onchain as hashes. */
export type MyContentDemoRow = {
  id: string;
  /** e.g. X post, LinkedIn, Blog, Article */
  contentFormat: string;
  /** Short sample of what was written — in production only hashes are stored. */
  contentPreview: string;
  /** Total keys captured in the attested session (typical range scales with length and edits). */
  keystrokeCount: number;
  contentHash: string;
  humanSignatureHash: string;
  transactionHash: string;
  indexedAtLabel: string;
};

/** @deprecated use MyContentDemoRow */
export type LedgerDemoRow = MyContentDemoRow;

/**
 * Sample rows: posts, articles, and long-form, all in one scannable “my library” (demo data).
 */
export const MY_CONTENT_DEMO_ROWS: MyContentDemoRow[] = [
  {
    id: '1',
    contentFormat: 'X post',
    contentPreview:
      'L2s made fees cheap; they did not fix who wrote what. I want threads with World ID + a typed attestation to World Chain. No paste; no “assistant draft.” If it is not onchain as a human, it is just another inference. HumanInk.',
    contentHash: '0x8a3f1c2d4e5b6098a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4',
    humanSignatureHash: '0x1b2c3d4e5f678901a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7a8b9',
    transactionHash: '0x10672aa169292e2cba453540b85390be6f9cdb843acd69ca466c3399ebc59eff',
    indexedAtLabel: 'Apr 26, 2026, 2:16 PM',
    keystrokeCount: 412,
  },
  {
    id: '2',
    contentFormat: 'LinkedIn',
    contentPreview:
      'Shipping: policy and incident memos with World ID, plus keystroke-bound signatures before anything hits a model. Onchain: hashes, nullifier, and ledger receipt. We use this where AI in the stack is a given, but the named author has to be real. #L2 #WorldID #attestation',
    contentHash: '0x2c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4',
    humanSignatureHash: '0x2c3d4e5f60718293a4b5c6d7e8f901b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8',
    transactionHash: '0x20672aa169292e2cba453540b85390be6f9cdb843acd69ca466c3399ebc59f00',
    indexedAtLabel: 'Apr 25, 2026, 4:40 PM',
    keystrokeCount: 1248,
  },
  {
    id: '3',
    contentFormat: 'Blog post',
    contentPreview:
      'Why “human-in-the-loop” is not a moat if the loop is ChatGPT. Part 1: we anchor a draft to a wallet and a typing signature on World Chain before a second model, editor, or RAG pass. Scarcity is not compute; it is signed, human-origin bytes.',
    contentHash: '0x3d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e',
    humanSignatureHash: '0x3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f802c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a',
    transactionHash: '0x30672aa169292e2cba453540b85390be6f9cdb843acd69ca466c3399ebc59f01',
    indexedAtLabel: 'Apr 24, 2026, 9:00 AM',
    keystrokeCount: 892,
  },
  {
    id: '4',
    contentFormat: 'Article',
    contentPreview:
      'Abstract. We study verifiable document authorship on a Layer 2. The client hashes long-form text and a biometric feature vector, then posts commitments to a smart contract on World Chain. Calldata, latency, and costs versus publishing raw text. We assume adversarial generative text and replay; we do not log keystrokes, only proof-shaped outputs.',
    contentHash: '0x4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7',
    humanSignatureHash: '0x4e5f6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9',
    transactionHash: '0x40672aa169292e2cba453540b85390be6f9cdb843acd69ca466c3399ebc59f02',
    indexedAtLabel: 'Apr 20, 2026, 3:22 PM',
    keystrokeCount: 1103,
  },
  {
    id: '5',
    contentFormat: 'Newsletter / notes',
    contentPreview:
      'This week: (1) RWA and stablecoin runbooks, still need a named author when AI generates first drafts. (2) L2 + proof-of-person as the anti-spam primitive for airdrop and governance. (3) Our stack: type locally, attestation tx on World Chain, feed row shows verified human, not an API key. Not investment or legal advice.',
    contentHash: '0x5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c',
    humanSignatureHash: '0x5f6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f90a',
    transactionHash: '0x50672aa169292e2cba453540b85390be6f9cdb843acd69ca466c3399ebc59f03',
    indexedAtLabel: 'Apr 15, 2026, 11:05 AM',
    keystrokeCount: 1421,
  },
  {
    id: '6',
    contentFormat: 'Academic report (draft)',
    contentPreview:
      'Section 3.2: Mixture-of-Experts vs dense Transformers. We define MoE gating, expert sparsity, and compare FLOP-active cost to full attention + FFN blocks. “Mixture of models” in deployment is ensembling; in-network MoE is routing. Appendix: rubric for when sparse routing may fail under domain shift. Not legal advice; methods section cites Switch/GLaM lineages.',
    contentHash: '0x6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b',
    humanSignatureHash: '0x6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1',
    transactionHash: '0x60672aa169292e2cba453540b85390be6f9cdb843acd69ca466c3399ebc59f04',
    indexedAtLabel: 'Apr 8, 2026, 6:50 PM',
    keystrokeCount: 2384,
  },
  {
    id: '7',
    contentFormat: 'White paper',
    contentPreview:
      'Restaking and shared security: operator economics, LST vault flows, and bounded slashing for new AVS launches. We lay out fee splits, withdrawal timing, and how curated operator sets can onboard without a token sale. LST-agnostic, governance-minimized; references to Eigen-style and liquid-staking literature, not a prospectus.',
    contentHash: '0x7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c',
    humanSignatureHash: '0x7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3c4d5e6f7a8b9c0d',
    transactionHash: '0x70672aa169292e2cba453540b85390be6f9cdb843acd69ca466c3399ebc59f05',
    indexedAtLabel: 'Mar 30, 2026, 1:12 PM',
    keystrokeCount: 1756,
  },
];

/** @deprecated use MY_CONTENT_DEMO_ROWS */
export const LEDGER_DEMO_ROWS = MY_CONTENT_DEMO_ROWS;

export function demoTxUrl(tx: string): string {
  return explorerTxUrl(tx);
}

export function truncateHex(hex: string, head = 10, tail = 6): string {
  if (hex.length <= head + tail + 1) return hex;
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}
