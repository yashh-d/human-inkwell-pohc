/**
 * In-app and MetaMask "block explorer" links use Alchemy’s hosted Blockscout for
 * World Chain Sepolia. If an env var still points at Worldscan, we prefer Alchemy.
 */
const ALCHEMY_WORLD_CHAIN_SEPOLIA_EXPLORER = 'https://worldchain-sepolia.explorer.alchemy.com';

function stripSlashes(s: string): string {
  return s.replace(/\/$/, '');
}

export function getBlockExplorerBaseUrl(): string {
  const raw = stripSlashes((process.env.REACT_APP_BLOCKCHAIN_EXPLORER_URL || '').trim());
  if (!raw) return ALCHEMY_WORLD_CHAIN_SEPOLIA_EXPLORER;
  if (/worldscan\.org/i.test(raw)) return ALCHEMY_WORLD_CHAIN_SEPOLIA_EXPLORER;
  return raw;
}
