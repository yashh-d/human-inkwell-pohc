/**
 * Vercel serverless: signs World ID 4.0 proof requests.
 * Set RP_SIGNING_KEY in Vercel (from Developer Portal — never REACT_APP_* or client).
 */
const { signRequest } = require('@worldcoin/idkit-core/signing');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const key = process.env.RP_SIGNING_KEY;
  if (!key) {
    return res.status(500).json({
      error: 'Server misconfiguration: RP_SIGNING_KEY is not set. Add it in Vercel → Environment Variables.',
    });
  }
  try {
    const { action } = req.body || {};
    if (!action) {
      return res.status(400).json({ error: 'Missing action in body' });
    }
    const { sig, nonce, createdAt, expiresAt } = signRequest({
      signingKeyHex: key,
      action,
    });
    return res.status(200).json({
      sig,
      nonce,
      created_at: createdAt,
      expires_at: expiresAt,
    });
  } catch (e) {
    return res.status(500).json({
      error: e instanceof Error ? e.message : String(e),
    });
  }
};
