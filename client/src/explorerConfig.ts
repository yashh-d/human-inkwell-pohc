/**
 * In-app and MetaMask "block explorer" links go to Worldscan for World Chain Sepolia
 * (the canonical tx view). Override with REACT_APP_BLOCKCHAIN_EXPLORER_URL.
 */
const WORLDSCAN_WORLD_CHAIN_SEPOLIA_EXPLORER = 'https://sepolia.worldscan.org';

function stripSlashes(s: string): string {
  return s.replace(/\/$/, '');
}

export function getBlockExplorerBaseUrl(): string {
  const raw = stripSlashes((process.env.REACT_APP_BLOCKCHAIN_EXPLORER_URL || '').trim());
  return raw || WORLDSCAN_WORLD_CHAIN_SEPOLIA_EXPLORER;
}
