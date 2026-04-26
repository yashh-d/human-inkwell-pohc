import { getBlockExplorerBaseUrl } from './explorerConfig';

const CONTRACT_ADDRESS =
  process.env.REACT_APP_CONTRACT_ADDRESS || '0x5FbDB2315678afecb367f032d93F642f64180aa3';

/** Block explorer URL for the Human Content Ledger contract (read-only link for docs / workflow page). */
export function getLedgerContractExplorerUrl(): string {
  return `${getBlockExplorerBaseUrl()}/address/${CONTRACT_ADDRESS}`;
}

export function getLedgerContractAddress(): string {
  return CONTRACT_ADDRESS;
}
