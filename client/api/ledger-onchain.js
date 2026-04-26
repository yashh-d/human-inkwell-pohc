/**
 * Vercel serverless: insert into `ledger_submissions` after verifying the row
 * against `getContentEntry` and the `ContentStored` log in the given tx (no
 * client wallet signature).
 */
const { createClient } = require('@supabase/supabase-js');
const { JsonRpcProvider, Contract, getAddress } = require('ethers');
const humanContentArtifact = require('../src/HumanContentLedger.json');

const ABI = humanContentArtifact.abi;

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

function norm(s) {
  if (s == null) return '';
  return String(s);
}

function addrLo(a) {
  return getAddress(String(a)).toLowerCase();
}

function contentStoredInReceipt(contract, bodyContract, receipt, expectedEntryId) {
  for (const log of receipt.logs) {
    if (addrLo(log.address) !== addrLo(bodyContract)) continue;
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === 'ContentStored') {
        const eid = Number(parsed.args[0] ?? parsed.args?.entryId);
        if (eid === Number(expectedEntryId)) return true;
      }
    } catch {
      /* not our log */
    }
  }
  return false;
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
  } = body;

  if (
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

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return send(res, 500, { error: 'Server missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' });
  }

  const expectedChain = Number(process.env.REACT_APP_CHAIN_ID || 4801);
  if (Number(chain_id) !== expectedChain) {
    return send(res, 400, { error: 'chain_id does not match server config' });
  }

  const rpc =
    (process.env.REACT_APP_RPC_URL && String(process.env.REACT_APP_RPC_URL).trim()) ||
    'https://worldchain-sepolia.g.alchemy.com/public';
  const defaultContract = process.env.REACT_APP_CONTRACT_ADDRESS
    ? String(process.env.REACT_APP_CONTRACT_ADDRESS).trim()
    : null;

  let bodyContract;
  try {
    bodyContract = getAddress(String(contract_address).trim());
  } catch {
    return send(res, 400, { error: 'Invalid contract_address' });
  }

  if (defaultContract) {
    try {
      if (getAddress(defaultContract) !== bodyContract) {
        return send(res, 400, { error: 'contract_address does not match server' });
      }
    } catch {
      return send(res, 500, { error: 'REACT_APP_CONTRACT_ADDRESS invalid' });
    }
  }

  const provider = new JsonRpcProvider(rpc);
  let network;
  try {
    network = await provider.getNetwork();
  } catch (e) {
    console.error('ledger-onchain: RPC getNetwork', e);
    return send(res, 500, { error: 'Failed to read chain from RPC' });
  }
  if (Number(network.chainId) !== Number(chain_id)) {
    return send(res, 500, { error: 'RPC chainId mismatch' });
  }

  const contract = new Contract(bodyContract, ABI, provider);

  let onChain;
  try {
    onChain = await contract.getContentEntry(BigInt(entry_id));
  } catch (e) {
    console.error('ledger-onchain: getContentEntry', e);
    return send(res, 502, { error: 'Contract read failed' });
  }

  const entry = onChain;
  const ch = norm(entry.contentHash ?? entry[0]);
  const hsh = norm(entry.humanSignatureHash ?? entry[1]);
  const wNull = norm(entry.worldIdNullifier ?? entry[2]);
  const author = getAddress(entry.author ?? entry[3]);
  const ks = Number(entry.keystrokeCount ?? entry[5]);
  const typScaled = Number(entry.typingSpeed ?? entry[6]);
  const isVer = Boolean(entry.isVerified ?? entry[7]);

  if (ch !== String(content_hash).trim()) {
    return send(res, 401, { error: 'content_hash does not match chain' });
  }
  if (hsh !== String(human_signature_hash).trim()) {
    return send(res, 401, { error: 'human_signature_hash does not match chain' });
  }
  if (getAddress(author_address) !== author) {
    return send(res, 401, { error: 'author_address does not match chain' });
  }
  if (ks !== Number(keystroke_count)) {
    return send(res, 401, { error: 'keystroke_count does not match chain' });
  }
  if (typScaled !== Number(typing_speed_scaled)) {
    return send(res, 401, { error: 'typing_speed_scaled does not match chain' });
  }
  if (isVer !== Boolean(is_verified)) {
    return send(res, 401, { error: 'is_verified does not match chain' });
  }
  const nBody = world_id_nullifier == null || world_id_nullifier === '' ? '' : String(world_id_nullifier);
  if (wNull !== nBody) {
    return send(res, 401, { error: 'world_id_nullifier does not match chain' });
  }

  const txH = String(transaction_hash).toLowerCase().match(/^0x[0-9a-fA-F]{64}$/)
    ? String(transaction_hash).toLowerCase()
    : `0x${String(transaction_hash).toLowerCase().replace(/^0x/, '')}`;

  let receipt;
  try {
    receipt = await provider.getTransactionReceipt(txH);
  } catch (e) {
    console.error('ledger-onchain: getTransactionReceipt', e);
    return send(res, 502, { error: 'Could not load transaction receipt' });
  }
  if (!receipt) {
    return send(res, 400, { error: 'Transaction not found' });
  }
  if (receipt.status !== 1) {
    return send(res, 400, { error: 'Transaction reverted' });
  }
  if (addrLo(receipt.to) !== addrLo(bodyContract)) {
    return send(res, 401, { error: 'transaction is not to the expected contract' });
  }
  if (!contentStoredInReceipt(contract, bodyContract, receipt, entry_id)) {
    return send(res, 401, { error: 'No ContentStored for this entry in transaction logs' });
  }
  if (addrLo(receipt.from) !== getAddress(author_address).toLowerCase()) {
    return send(res, 401, { error: 'transaction from does not match author' });
  }

  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  const row = {
    chain_id: Number(chain_id),
    contract_address: String(contract_address).toLowerCase(),
    entry_id: Number(entry_id),
    author_address: String(author_address).toLowerCase(),
    transaction_hash: txH,
    content_hash: String(content_hash).trim(),
    human_signature_hash: String(human_signature_hash).trim(),
    world_id_nullifier: world_id_nullifier || null,
    is_verified: Boolean(is_verified),
    keystroke_count: Number(keystroke_count),
    typing_speed_scaled: Number(typing_speed_scaled),
    block_number: block_number != null ? Number(block_number) : Number(receipt.blockNumber),
    block_timestamp: block_timestamp || null,
    gas_used:
      gas_used != null && gas_used !== undefined
        ? String(gas_used)
        : receipt.gasUsed != null
          ? String(receipt.gasUsed)
          : null,
  };

  const { error } = await supabase.from('ledger_submissions').insert(row);
  if (error) {
    if (error.code === '23505' || /duplicate|unique/i.test(String(error.message))) {
      return send(res, 200, { ok: true, deduped: true, verified: 'onchain' });
    }
    console.error(error);
    return send(res, 500, { error: error.message || 'Insert failed' });
  }
  return send(res, 200, { ok: true, verified: 'onchain' });
};
