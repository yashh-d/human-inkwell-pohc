/**
 * Vercel serverless: insert into `ledger_submissions` (Supabase, service role).
 * - `verify_on_chain: true` — no wallet signature; server checks tx + contract state (default for the app).
 * - Legacy: `message` + `signature` (same as buildExpectedMessage in ledgerSupabase.ts).
 */
const { createClient } = require('@supabase/supabase-js');
const { verifyMessage, getAddress, JsonRpcProvider, Contract } = require('ethers');
const { getSupabaseCreds } = require('./_supabaseEnv');
const { parsePublicText } = require('./_contentHash');

const LEDGER_READ_ABI = [
  'function getContentEntry(uint256 _entryId) view returns (tuple(string contentHash, string humanSignatureHash, string worldIdNullifier, address author, uint256 timestamp, uint256 keystrokeCount, uint256 typingSpeed, bool isVerified))',
  'function getEntryIdByContentHash(string _contentHash) view returns (uint256)',
];

function buildExpectedMessage(p) {
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

function send(res, code, data) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (code === 204) {
    return res.status(204).end();
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(code).send(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const s = Buffer.concat(chunks).toString('utf8') || '{}';
        resolve(JSON.parse(s));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

async function insertRow(supabase, row) {
  const { error } = await supabase.from('ledger_submissions').insert(row);
  if (error) {
    if (error.code === '23505' || /duplicate|unique/i.test(String(error.message))) {
      return { ok: true, deduped: true };
    }
    return { error: error.message || 'Insert failed' };
  }
  return { ok: true };
}

/**
 * @returns {{ row: object } | { code: number, error: string }}
 */
async function buildRowFromChainVerification(body) {
  const {
    chain_id,
    contract_address,
    entry_id,
    author_address,
    transaction_hash,
    content_hash,
    human_signature_hash,
    is_verified,
    keystroke_count,
    typing_speed_scaled,
    world_id_nullifier,
    block_number,
    block_timestamp,
    gas_used,
    public_text,
  } = body;

  if (
    chain_id == null ||
    !contract_address ||
    entry_id == null ||
    !author_address ||
    !transaction_hash ||
    !content_hash ||
    !human_signature_hash ||
    keystroke_count == null ||
    typing_speed_scaled == null
  ) {
    return { code: 400, error: 'Missing required fields for chain verification' };
  }

  const expectedChain = Number(process.env.REACT_APP_CHAIN_ID || 4801);
  if (Number(chain_id) !== expectedChain) {
    return { code: 400, error: 'chain_id mismatch' };
  }

  const envContract = process.env.REACT_APP_CONTRACT_ADDRESS;
  if (!envContract) {
    return { code: 500, error: 'Server missing REACT_APP_CONTRACT_ADDRESS' };
  }
  let caddr;
  try {
    caddr = getAddress(String(contract_address));
  } catch {
    return { code: 400, error: 'Invalid contract_address' };
  }
  if (getAddress(envContract) !== caddr) {
    return { code: 400, error: 'contract_address does not match server config' };
  }

  const rpc = process.env.REACT_APP_RPC_URL || process.env.RPC_URL || 'https://worldchain-sepolia.g.alchemy.com/public';
  const provider = new JsonRpcProvider(rpc);
  const contract = new Contract(caddr, LEDGER_READ_ABI, provider);

  const txHash = String(transaction_hash).trim();
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) {
    return { code: 400, error: 'Transaction receipt not found' };
  }
  if (receipt.status !== 1) {
    return { code: 400, error: 'Transaction reverted' };
  }
  if (!receipt.to) {
    return { code: 400, error: 'Invalid transaction (no to)' };
  }
  if (getAddress(receipt.to) !== caddr) {
    return { code: 400, error: 'Transaction is not to the configured contract' };
  }

  const tx = await provider.getTransaction(txHash);
  if (!tx) {
    return { code: 400, error: 'Transaction not found' };
  }
  let fromAddr;
  try {
    fromAddr = getAddress(author_address);
  } catch {
    return { code: 400, error: 'Invalid author_address' };
  }
  if (getAddress(tx.from) !== fromAddr) {
    return { code: 401, error: 'Transaction sender does not match author' };
  }

  const ch = String(content_hash).trim();
  let idByHash;
  try {
    idByHash = await contract.getEntryIdByContentHash(ch);
  } catch (e) {
    return { code: 400, error: `getEntryIdByContentHash failed: ${e && e.message ? e.message : 'revert'}` };
  }
  if (Number(idByHash) !== Number(entry_id)) {
    return { code: 400, error: 'content_hash does not map to entry_id on-chain' };
  }

  let entry;
  try {
    entry = await contract.getContentEntry(BigInt(entry_id));
  } catch (e) {
    return { code: 400, error: `getContentEntry failed: ${e && e.message ? e.message : 'revert'}` };
  }

  if (entry.contentHash !== ch) {
    return { code: 400, error: 'On-chain contentHash mismatch' };
  }
  if (entry.humanSignatureHash !== String(human_signature_hash).trim()) {
    return { code: 400, error: 'On-chain humanSignatureHash mismatch' };
  }
  if (getAddress(entry.author) !== fromAddr) {
    return { code: 400, error: 'On-chain author mismatch' };
  }
  if (Boolean(entry.isVerified) !== Boolean(is_verified)) {
    return { code: 400, error: 'is_verified mismatch' };
  }
  if (Number(entry.keystrokeCount) !== Number(keystroke_count)) {
    return { code: 400, error: 'keystroke_count mismatch' };
  }
  if (Number(entry.typingSpeed) !== Number(typing_speed_scaled)) {
    return { code: 400, error: 'typing_speed_scaled mismatch' };
  }
  const wOn = entry.worldIdNullifier == null || entry.worldIdNullifier === '' ? '' : String(entry.worldIdNullifier);
  const wIn =
    world_id_nullifier == null || world_id_nullifier === '' ? '' : String(world_id_nullifier);
  if (wOn !== wIn) {
    return { code: 400, error: 'worldIdNullifier mismatch' };
  }

  const bn = block_number != null ? Number(block_number) : Number(receipt.blockNumber);
  const gu =
    gas_used != null && gas_used !== ''
      ? String(gas_used)
      : receipt.gasUsed != null
        ? receipt.gasUsed.toString()
        : null;

  let publicTextForRow = null;
  if (public_text != null && String(public_text).trim() !== '') {
    const pt = parsePublicText(
      public_text,
      String(ch)
        .trim()
        .toLowerCase()
        .replace(/^0x/, '')
    );
    if (pt.error) {
      return { code: 400, error: pt.error };
    }
    publicTextForRow = pt.public_text;
  }

  const row = {
    chain_id: Number(chain_id),
    contract_address: caddr.toLowerCase(),
    entry_id: Number(entry_id),
    author_address: fromAddr.toLowerCase(),
    transaction_hash: txHash.toLowerCase().startsWith('0x') ? txHash.toLowerCase() : `0x${txHash}`.toLowerCase(),
    content_hash: ch,
    human_signature_hash: String(human_signature_hash).trim(),
    world_id_nullifier: wIn || null,
    is_verified: Boolean(is_verified),
    keystroke_count: Number(keystroke_count),
    typing_speed_scaled: Number(typing_speed_scaled),
    block_number: Number.isFinite(bn) ? bn : null,
    block_timestamp: block_timestamp || null,
    gas_used: gu,
    public_text: publicTextForRow,
  };
  return { row };
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    return send(res, 204, {});
  }
  if (req.method !== 'POST') {
    return send(res, 405, { error: 'Method not allowed' });
  }
  let body;
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    body = req.body;
  } else {
    try {
      body = await readJson(req);
    } catch {
      return send(res, 400, { error: 'Invalid JSON' });
    }
  }

  if (body.verify_on_chain) {
    const v = await buildRowFromChainVerification(body);
    if (v.error) {
      return send(res, v.code, { error: v.error });
    }
    const { url: supabaseUrl, key: supabaseKey, error: supaErr } = getSupabaseCreds();
    if (supaErr) {
      return send(res, 500, { error: supaErr });
    }
    const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
    const ins = await insertRow(supabase, v.row);
    if (ins.error) {
      console.error(ins.error);
      return send(res, 500, { error: ins.error });
    }
    if (ins.deduped) {
      return send(res, 200, { ok: true, deduped: true, verified: 'chain' });
    }
    return send(res, 200, { ok: true, verified: 'chain' });
  }

  const {
    message,
    signature,
    chain_id,
    contract_address,
    entry_id,
    author_address,
    transaction_hash,
    content_hash,
    human_signature_hash,
    is_verified,
    keystroke_count,
    typing_speed_scaled,
    world_id_nullifier,
    block_number,
    block_timestamp,
    gas_used,
    public_text,
  } = body;

  if (
    !message ||
    !signature ||
    chain_id == null ||
    !contract_address ||
    entry_id == null ||
    !author_address ||
    !transaction_hash ||
    !content_hash ||
    !human_signature_hash
  ) {
    return send(res, 400, { error: 'Missing required fields' });
  }

  const expected = buildExpectedMessage({
    chain_id: Number(chain_id),
    contract_address: String(contract_address).trim(),
    entry_id: Number(entry_id),
    author_address: String(author_address).trim(),
    transaction_hash: String(transaction_hash).trim(),
    content_hash: String(content_hash).trim(),
    human_signature_hash: String(human_signature_hash).trim(),
    is_verified: Boolean(is_verified),
    world_id_nullifier: world_id_nullifier || null,
  });

  if (message !== expected) {
    return send(res, 401, { error: 'Message mismatch' });
  }

  let recovered;
  try {
    recovered = verifyMessage(message, signature);
  } catch {
    return send(res, 401, { error: 'Invalid signature' });
  }
  if (getAddress(recovered) !== getAddress(author_address)) {
    return send(res, 401, { error: 'Invalid signature for author' });
  }

  const { url: supabaseUrl, key: supabaseKey, error: supaErr } = getSupabaseCreds();
  if (supaErr) {
    return send(res, 500, { error: supaErr });
  }

  let publicTextForSign = null;
  if (public_text != null && String(public_text).trim() !== '') {
    const pt = parsePublicText(
      public_text,
      String(content_hash)
        .trim()
        .toLowerCase()
        .replace(/^0x/, '')
    );
    if (pt.error) {
      return send(res, 400, { error: pt.error });
    }
    publicTextForSign = pt.public_text;
  }

  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  const row = {
    chain_id: Number(chain_id),
    contract_address: String(contract_address).toLowerCase(),
    entry_id: Number(entry_id),
    author_address: String(author_address).toLowerCase(),
    transaction_hash: String(transaction_hash).toLowerCase(),
    content_hash: String(content_hash).trim(),
    human_signature_hash: String(human_signature_hash).trim(),
    world_id_nullifier: world_id_nullifier || null,
    is_verified: Boolean(is_verified),
    keystroke_count: Number(keystroke_count),
    typing_speed_scaled: Number(typing_speed_scaled),
    block_number: block_number != null ? Number(block_number) : null,
    block_timestamp: block_timestamp || null,
    gas_used: gas_used || null,
    public_text: publicTextForSign,
  };

  const ins = await insertRow(supabase, row);
  if (ins.error) {
    console.error(ins.error);
    return send(res, 500, { error: ins.error });
  }
  if (ins.deduped) {
    return send(res, 200, { ok: true, deduped: true });
  }
  return send(res, 200, { ok: true });
};
