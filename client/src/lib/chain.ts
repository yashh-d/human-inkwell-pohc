/**
 * chain.ts — the deployed contract + block-explorer constants, in one place so
 * both the publish flow and the bare embeddable badge can read them without the
 * badge having to pull in the whole wallet/publish stack. Falls back to the
 * known World Chain Sepolia deployment.
 */
export const CONTRACT_ADDRESS = process.env.REACT_APP_CONTRACT_ADDRESS || '0x08A70Fed4d80893fC03Bd3E1D8cfb36E58a9E95d';
export const EXPLORER_BASE = (process.env.REACT_APP_BLOCKCHAIN_EXPLORER_URL || 'https://sepolia.worldscan.org').replace(/\/+$/, '');
