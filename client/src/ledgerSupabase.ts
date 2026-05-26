/**
 * Thin client for the on-chain ledger's off-chain index in Supabase.
 *
 * Feed and My Content readers are intentionally absent — those surfaces are
 * being rebuilt and will get their own helpers when re-introduced.
 *
 * What lives here:
 *   • explorerTxUrl(tx)                         — build a Worldscan tx URL.
 *   • pushLedgerIndexAfterOnChainSuccess(...)   — POST the indexed row to
 *                                                 Supabase via /api/ledger-onchain
 *                                                 after a successful storeContent.
 */
import { ethers } from 'ethers';
import type { BlockchainResponse } from './blockchain';
import { getBlockExplorerBaseUrl } from './explorerConfig';

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

export function explorerTxUrl(tx: string): string {
  return `${EXPLORER}/tx/${tx.toLowerCase()}`;
}

/**
 * Index the submission in Supabase with no MetaMask `signMessage`.
 * The server replays the row against the contract and receipt
 * (`api/ledger-onchain.js`).
 */
export async function pushLedgerIndexAfterOnChainSuccess(
  result: BlockchainResponse,
  data: {
    contentHash: string;
    humanSignatureHash: string;
    keystrokeCount: number;
    typingSpeed: number;
    isVerified: boolean;
    worldIdNullifier?: string;
    authorAddress: string;
    /** If set, stored alongside the hashes for future surfaces. */
    publicText?: string;
  }
): Promise<void> {
  if (!result.success || !result.transactionHash) return;
  if (result.entryId == null) {
    console.warn('ledgerSupabase: no entryId, cannot index row');
    return;
  }

  const typing_speed_scaled = Math.floor(data.typingSpeed * 1000);
  const author_address = data.authorAddress.toLowerCase();

  const payload: Record<string, unknown> = {
    chain_id: CHAIN_ID,
    contract_address: ethers.getAddress(CONTRACT_ADDRESS).toLowerCase(),
    entry_id: result.entryId,
    author_address,
    transaction_hash: result.transactionHash.toLowerCase(),
    content_hash: data.contentHash,
    human_signature_hash: data.humanSignatureHash,
    world_id_nullifier: data.worldIdNullifier || null,
    is_verified: data.isVerified,
    keystroke_count: data.keystrokeCount,
    typing_speed_scaled,
    block_number: result.blockNumber ?? null,
    block_timestamp: result.blockTimestampIso ?? null,
    gas_used: result.gasUsed ?? null,
  };
  if (data.publicText != null && String(data.publicText).trim() !== '') {
    payload.public_text = data.publicText;
  }

  const res = await fetch(apiPath('/api/ledger-onchain'), {
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
