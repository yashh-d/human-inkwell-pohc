import { ethers, type Signer } from 'ethers';
import type { BlockchainResponse } from './blockchain';
import { getBlockExplorerBaseUrl } from './explorerConfig';

/**
 * On Vercel, the browser calls same-origin `POST /api/ledger` and `POST /api/my-ledger`
 * (see `api/ledger.js`, `api/my-ledger.js`). For local `npm start`, those routes
 * do not run — use `vercel dev` in `client/`, or point `REACT_APP_API_BASE` at a deployed app.
 */
export async function getInjectedSigner(): Promise<Signer> {
  if (!window.ethereum) {
    throw new Error('No wallet. Install MetaMask.');
  }
  const provider = new ethers.BrowserProvider(window.ethereum);
  return provider.getSigner();
}

export type LedgerSubmissionRow = {
  chain_id: number;
  contract_address: string;
  entry_id: number;
  author_address: string;
  transaction_hash: string;
  content_hash: string;
  human_signature_hash: string;
  world_id_nullifier: string | null;
  is_verified: boolean;
  keystroke_count: number;
  typing_speed_scaled: number;
  block_number: number | null;
  block_timestamp: string | null;
  gas_used: string | null;
  created_at: string;
};

const CONTRACT_ADDRESS =
  process.env.REACT_APP_CONTRACT_ADDRESS || '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const CHAIN_ID = Number(process.env.REACT_APP_CHAIN_ID || 4801);
const EXPLORER = getBlockExplorerBaseUrl();

function apiPath(path: string): string {
  const base = (process.env.REACT_APP_API_BASE || '').replace(/\/$/, '');
  if (base) {
    return `${base}${path.startsWith('/') ? path : `/${path}`}`;
  }
  return path.startsWith('/') ? path : `/${path}`;
}

/**
 * After an on-chain success, the server verifies the transaction + `getContentEntry` via RPC
 * and inserts into Supabase — no second MetaMask `signMessage` (see `api/ledger.js` `verify_on_chain`).
 */
export async function syncLedgerToSupabase(
  result: BlockchainResponse,
  data: {
    contentHash: string;
    humanSignatureHash: string;
    keystrokeCount: number;
    typingSpeed: number;
    isVerified: boolean;
    worldIdNullifier?: string;
  }
): Promise<void> {
  if (!result.success || !result.transactionHash) return;
  if (result.entryId == null) {
    console.warn('ledgerSupabase: no entryId, cannot index row');
    return;
  }
  const author = (result.walletAddress || '').trim();
  if (!author) {
    console.warn('ledgerSupabase: no walletAddress on chain result, cannot index row');
    return;
  }
  const author_address = author.toLowerCase();
  const is_verified = data.isVerified;
  const world_id_nullifier = data.worldIdNullifier || null;
  const typing_speed_scaled = Math.floor(data.typingSpeed * 1000);

  const payload = {
    verify_on_chain: true,
    chain_id: CHAIN_ID,
    contract_address: ethers.getAddress(CONTRACT_ADDRESS).toLowerCase(),
    entry_id: result.entryId,
    author_address,
    transaction_hash: result.transactionHash.toLowerCase(),
    content_hash: data.contentHash,
    human_signature_hash: data.humanSignatureHash,
    world_id_nullifier,
    is_verified,
    keystroke_count: data.keystrokeCount,
    typing_speed_scaled,
    block_number: result.blockNumber ?? null,
    block_timestamp: result.blockTimestampIso ?? null,
    gas_used: result.gasUsed ?? null,
  };

  const res = await fetch(apiPath('/api/ledger'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    let msg = body;
    try {
      const j = JSON.parse(body) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      /* not json */
    }
    throw new Error(msg || res.statusText);
  }
}

export function explorerTxUrl(tx: string): string {
  return `${EXPLORER}/tx/${tx.toLowerCase()}`;
}

export async function fetchMyLedgerRows(signer: Signer): Promise<LedgerSubmissionRow[]> {
  const author = (await signer.getAddress()).toLowerCase();
  const t = Date.now();
  const message = `Human Inkwell list submissions\nauthor:${author}\ntime:${t}\n`;
  const signature = await signer.signMessage(message);
  const res = await fetch(apiPath('/api/my-ledger'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, signature, author_address: author }),
  });
  if (!res.ok) {
    const body = await res.text();
    let msg = body;
    try {
      const j = JSON.parse(body) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      /* not json */
    }
    throw new Error(msg || res.statusText);
  }
  const data = (await res.json()) as { ok: boolean; rows?: LedgerSubmissionRow[] };
  if (!data?.ok || !data.rows) return [];
  return data.rows;
}
