import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ethers, type Signer } from 'ethers';
import type { BlockchainResponse } from './blockchain';

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
const EXPLORER = (process.env.REACT_APP_BLOCKCHAIN_EXPLORER_URL || 'https://worldchain-sepolia.explorer.alchemy.com').replace(
  /\/$/,
  ''
);

function getSupabase(): { client: SupabaseClient; url: string; anon: string } | null {
  const url = process.env.REACT_APP_SUPABASE_URL;
  const anon = process.env.REACT_APP_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  return { client: createClient(url, anon), url, anon };
}

/** Build exactly the same string as `supabase/functions/add-ledger-submission/index.ts` */
function buildLedgerIndexMessage(p: {
  chain_id: number;
  contract_address: string;
  entry_id: number;
  author_address: string;
  transaction_hash: string;
  content_hash: string;
  human_signature_hash: string;
  is_verified: boolean;
  world_id_nullifier?: string | null;
}): string {
  const nullifier = p.world_id_nullifier ?? '';
  return [
    'Human Inkwell ledger index',
    `chain:${p.chain_id}`,
    `entry:${p.entry_id}`,
    `contract:${p.contract_address.toLowerCase()}`,
    `author:${p.author_address.toLowerCase()}`,
    `contentHash:${p.content_hash}`,
    `humanSigHash:${p.human_signature_hash}`,
    `tx:${p.transaction_hash.toLowerCase()}`,
    `isVerified:${p.is_verified ? '1' : '0'}`,
    `nullifier:${nullifier}`,
  ].join('\n');
}

/**
 * After a successful on-chain submit, index the row in Supabase (wallet-signed).
 * No-op if Supabase env is missing, or if entry/tx is missing.
 */
export async function syncLedgerToSupabase(
  signer: Signer,
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
  const s = getSupabase();
  if (!s) {
    console.warn('ledgerSupabase: REACT_APP_SUPABASE_URL or REACT_APP_SUPABASE_ANON_KEY not set, skipping');
    return;
  }
  if (!result.success || !result.transactionHash) return;
  if (result.entryId == null) {
    console.warn('ledgerSupabase: no entryId, cannot index row');
    return;
  }

  const author_address = (await signer.getAddress()).toLowerCase();
  const is_verified = data.isVerified;
  const world_id_nullifier = data.worldIdNullifier || null;
  const typing_speed_scaled = Math.floor(data.typingSpeed * 1000);

  const message = buildLedgerIndexMessage({
    chain_id: CHAIN_ID,
    contract_address: ethers.getAddress(CONTRACT_ADDRESS).toLowerCase(),
    entry_id: result.entryId,
    author_address,
    transaction_hash: result.transactionHash.toLowerCase(),
    content_hash: data.contentHash,
    human_signature_hash: data.humanSignatureHash,
    is_verified,
    world_id_nullifier,
  });
  const signature = await signer.signMessage(message);

  const { error } = await s.client.functions.invoke('add-ledger-submission', {
    body: {
      message,
      signature,
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
    },
  });
  if (error) {
    console.error('ledgerSupabase: add-ledger-submission failed', error);
  }
}

export function explorerTxUrl(tx: string): string {
  return `${EXPLORER}/tx/${tx.toLowerCase()}`;
}

/**
 * List rows for the connected wallet only (wallet must sign a short list message).
 */
export async function fetchMyLedgerRows(signer: Signer): Promise<LedgerSubmissionRow[]> {
  const s = getSupabase();
  if (!s) throw new Error('Supabase is not configured (set REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY).');
  const author = (await signer.getAddress()).toLowerCase();
  const t = Date.now();
  const message = `Human Inkwell list submissions\nauthor:${author}\ntime:${t}\n`;
  const signature = await signer.signMessage(message);
  const { data, error } = await s.client.functions.invoke<{
    ok: boolean;
    rows?: LedgerSubmissionRow[];
  }>('get-my-ledger', { body: { message, signature, author_address: author } });
  if (error) throw new Error(error.message);
  if (!data?.ok || !data.rows) return [];
  return data.rows;
}
