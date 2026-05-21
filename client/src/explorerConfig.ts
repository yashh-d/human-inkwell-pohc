/**
 * Block-explorer base URL. Honors REACT_APP_BLOCKCHAIN_EXPLORER_URL as-is so
 * mainnet builds (https://worldscan.org) and testnet builds can point wherever
 * they're configured. Falls back to mainnet Worldscan when unset.
 */
const DEFAULT_EXPLORER = 'https://worldscan.org';

function stripSlashes(s: string): string {
  return s.replace(/\/$/, '');
}

export function getBlockExplorerBaseUrl(): string {
  const raw = stripSlashes((process.env.REACT_APP_BLOCKCHAIN_EXPLORER_URL || '').trim());
  return raw || DEFAULT_EXPLORER;
}
