import { explorerTxUrl } from './ledgerSupabase';

export type LedgerDemoRow = {
  id: string;
  /** Short sample of what was typed — in production only hashes are stored. */
  contentPreview: string;
  contentHash: string;
  humanSignatureHash: string;
  transactionHash: string;
  indexedAtLabel: string;
};

/**
 * Sample rows for UI demo: explorer link, content hash, signature hash, and a plain-text preview (not onchain).
 */
export const LEDGER_DEMO_ROWS: LedgerDemoRow[] = [
  {
    id: 'a',
    contentPreview: 'Hello — Humanink test attestation, typed in the browser.',
    contentHash: '0x8a3f1c2d4e5b6098a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4',
    humanSignatureHash: '0x1b2c3d4e5f678901a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7a8b9',
    transactionHash: '0x10672aa169292e2cba453540b85390be6f9cdb843acd69ca466c3399ebc59eff',
    indexedAtLabel: 'Just now (demo)',
  },
  {
    id: 'b',
    contentPreview: 'Keystroke timing and World ID, without sending raw biometrics onchain.',
    contentHash: '0x2c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4',
    humanSignatureHash: '0x2c3d4e5f60718293a4b5c6d7e8f901b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8',
    transactionHash: '0x20672aa169292e2cba453540b85390be6f9cdb843acd69ca466c3399ebc59f00',
    indexedAtLabel: 'Demo',
  },
  {
    id: 'c',
    contentPreview: 'Onchain: hashes only. Offchain: full text stays with you until you share it.',
    contentHash: '0x3d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e',
    humanSignatureHash: '0x3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f802c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a',
    transactionHash: '0x30672aa169292e2cba453540b85390be6f9cdb843acd69ca466c3399ebc59f01',
    indexedAtLabel: 'Demo',
  },
];

export function demoTxUrl(tx: string): string {
  return explorerTxUrl(tx);
}

export function truncateHex(hex: string, head = 10, tail = 6): string {
  if (hex.length <= head + tail + 1) return hex;
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}
