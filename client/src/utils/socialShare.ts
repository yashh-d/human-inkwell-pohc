/**
 * Build post + onchain attestation for copying or other surfaces.
 */
export function buildAttestationShareBody(
  content: string,
  transactionHash: string,
  explorerTxUrl?: string | null
): string {
  const txLine = explorerTxUrl?.trim()
    ? `Onchain: ${explorerTxUrl.trim()}`
    : `Onchain tx: ${transactionHash}`;
  const body = (content || '').trim();
  return body ? `${body}\n\n${txLine}` : txLine;
}

/** Keep X intent under a safe length; tx line is always kept. */
export const X_INTENT_MAX_CHARS = 280;

export function buildAttestationShareForX(
  content: string,
  transactionHash: string,
  explorerTxUrl?: string | null
): { text: string; truncated: boolean } {
  const txLine = explorerTxUrl?.trim()
    ? `Onchain: ${explorerTxUrl.trim()}`
    : `Onchain: ${transactionHash}`;
  const sep = '\n\n';
  const maxContent = X_INTENT_MAX_CHARS - txLine.length - sep.length;
  if (maxContent < 20) {
    return { text: txLine, truncated: !!(content && content.trim()) };
  }
  const c = (content || '').trim();
  if (c.length <= maxContent) {
    return { text: `${c}${sep}${txLine}`, truncated: false };
  }
  return {
    text: `${c.slice(0, Math.max(0, maxContent - 1))}…${sep}${txLine}`,
    truncated: true,
  };
}

export function xIntentUrl(text: string): string {
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
}

export const LINKEDIN_FEED_URL = 'https://www.linkedin.com/feed/';
