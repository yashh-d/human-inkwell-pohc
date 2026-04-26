const crypto = require('crypto');

const MAX_PUBLIC_TEXT = 20_000;

/**
 * SHA-256 of UTF-8 string, lowercase hex (same as browser hashContent in src/utils/crypto.ts).
 */
function sha256HexUtf8(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

/**
 * @param {string | null | undefined} raw
 * @param {string} contentHashLowerHex - no 0x
 * @returns {{ public_text: string | null } | { error: string }}
 */
function parsePublicText(raw, contentHashLowerHex) {
  if (raw == null || String(raw).trim() === '') {
    return { public_text: null };
  }
  const t = String(raw);
  if (t.length > MAX_PUBLIC_TEXT) {
    return { error: `public_text exceeds ${MAX_PUBLIC_TEXT} characters` };
  }
  const want = String(contentHashLowerHex)
    .trim()
    .toLowerCase()
    .replace(/^0x/, '');
  const got = sha256HexUtf8(t);
  if (got !== want) {
    return { error: 'public_text does not match content_hash' };
  }
  return { public_text: t };
}

module.exports = { sha256HexUtf8, parsePublicText, MAX_PUBLIC_TEXT };
