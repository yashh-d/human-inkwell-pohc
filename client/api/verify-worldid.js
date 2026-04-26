/**
 * Forwards IDKit result to World Developer Portal for /v4/verify.
 */
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
  const { rp_id, idkitResponse } = req.body || {};
  if (!rp_id || !idkitResponse) {
    return res.status(400).json({ error: 'Missing rp_id or idkitResponse' });
  }
  try {
    const r = await fetch(
      `https://developer.world.org/api/v4/verify/${encodeURIComponent(rp_id)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(idkitResponse),
      }
    );
    if (!r.ok) {
      const t = await r.text();
      return res.status(400).json({ error: t || 'Verify request failed' });
    }
    return res.status(200).json({ success: true });
  } catch (e) {
    return res.status(500).json({
      error: e instanceof Error ? e.message : String(e),
    });
  }
};
