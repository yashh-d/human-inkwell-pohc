/**
 * Vercel serverless: wallet-signed insert into `ledger_submissions` (Supabase, service role).
 * Keep the message format in sync with `src/ledgerSupabase.ts` (buildLedgerIndexMessage).
 */
const { createClient } = require('@supabase/supabase-js');
const { verifyMessage, getAddress } = require('ethers');

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

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return send(res, 500, { error: 'Server missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' });
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
  };

  const { error } = await supabase.from('ledger_submissions').insert(row);
  if (error) {
    if (error.code === '23505' || /duplicate|unique/i.test(String(error.message))) {
      return send(res, 200, { ok: true, deduped: true });
    }
    console.error(error);
    return send(res, 500, { error: error.message || 'Insert failed' });
  }
  return send(res, 200, { ok: true });
};
