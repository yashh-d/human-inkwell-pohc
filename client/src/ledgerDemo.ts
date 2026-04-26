import { explorerTxUrl } from './ledgerSupabase';

/** One row in the “My content” view (demo): writing from any format, attested on-chain as hashes. */
export type MyContentDemoRow = {
  id: string;
  /** e.g. X post, LinkedIn, Blog, Article */
  contentFormat: string;
  /** Short sample of what was written — in production only hashes are stored. */
  contentPreview: string;
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
    contentPreview: 'Hot take: proof-of-person + typing biometrics = actually useful for “this thread was a human, not a bot.” Human Inkwell 🧵',
    contentHash: '0x8a3f1c2d4e5b6098a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4',
    humanSignatureHash: '0x1b2c3d4e5f678901a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7a8b9',
    transactionHash: '0x10672aa169292e2cba453540b85390be6f9cdb843acd69ca466c3399ebc59eff',
    indexedAtLabel: 'Just now (demo)',
  },
  {
    id: '2',
    contentFormat: 'LinkedIn',
    contentPreview: 'Pleased to share: we are experimenting with on-chain attestations for original writing. Keystroke dynamics and World ID, without pasting your draft on-chain. #HumanInkwell #WorldChain',
    contentHash: '0x2c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4',
    humanSignatureHash: '0x2c3d4e5f60718293a4b5c6d7e8f901b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8',
    transactionHash: '0x20672aa169292e2cba453540b85390be6f9cdb843acd69ca466c3399ebc59f00',
    indexedAtLabel: '2h ago (demo)',
  },
  {
    id: '3',
    contentFormat: 'Blog post',
    contentPreview: 'Draft: Why “human-in-the-loop” is not enough if you can’t tell human loops from model loops. Part 1: hashes and nullifiers, no doomscroll.',
    contentHash: '0x3d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e',
    humanSignatureHash: '0x3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f802c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a',
    transactionHash: '0x30672aa169292e2cba453540b85390be6f9cdb843acd69ca466c3399ebc59f01',
    indexedAtLabel: 'Yesterday (demo)',
  },
  {
    id: '4',
    contentFormat: 'Article',
    contentPreview: 'Abstract. We report on a browser-local pipeline that binds long-form text to a biometric feature vector, then to a public ledger entry. Plaintext is never put on chain; only content and signature hashes.',
    contentHash: '0x4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7',
    humanSignatureHash: '0x4e5f6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9',
    transactionHash: '0x40672aa169292e2cba453540b85390be6f9cdb843acd69ca466c3399ebc59f02',
    indexedAtLabel: 'Demo',
  },
  {
    id: '5',
    contentFormat: 'Newsletter / notes',
    contentPreview: 'Bullet list: (1) hash content (2) hash biometrics (3) submit. Same flow whether you are posting a 280-char hot take or a 5k word essay—only the attestation size changes, not the trust model.',
    contentHash: '0x5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c',
    humanSignatureHash: '0x5f6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f90a',
    transactionHash: '0x50672aa169292e2cba453540b85390be6f9cdb843acd69ca466c3399ebc59f03',
    indexedAtLabel: 'Demo',
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
