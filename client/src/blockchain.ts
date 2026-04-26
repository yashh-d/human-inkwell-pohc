import { ethers } from 'ethers';
import contractABI from './HumanContentLedger.json';

// Contract configuration
const CONTRACT_ADDRESS = process.env.REACT_APP_CONTRACT_ADDRESS || '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const RPC_URL = process.env.REACT_APP_RPC_URL || 'http://127.0.0.1:8545';
const EXPECTED_CHAIN_ID = Number(process.env.REACT_APP_CHAIN_ID || 31337);
const NETWORK_NAME = process.env.REACT_APP_NETWORK_NAME || 'Localhost 8545';
const BLOCK_EXPLORER = process.env.REACT_APP_BLOCKCHAIN_EXPLORER_URL || 'https://sepolia.worldscan.org';

// Contract ABI
const CONTRACT_ABI = contractABI.abi;

export interface BlockchainSubmissionData {
  contentHash: string;
  humanSignatureHash: string;
  keystrokeCount: number;
  typingSpeed: number;
  worldIdNullifier?: string;
}

export interface BlockchainResponse {
  success: boolean;
  transactionHash?: string;
  entryId?: number;
  error?: string;
  gasUsed?: string;
  /** If set, open this in a real browser (mini in-app browsers may block the explorer). */
  explorerAddressUrl?: string;
  walletAddress?: string;
}

class BlockchainService {
  private provider: ethers.JsonRpcProvider;
  private contract: ethers.Contract;

  constructor() {
    this.provider = new ethers.JsonRpcProvider(RPC_URL);
    this.contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, this.provider);
  }

  async connectWallet(): Promise<{ signer: ethers.Signer; address: string }> {
    if (!window.ethereum) {
      throw new Error('MetaMask or similar wallet not found. Please install a web3 wallet.');
    }

    const provider = new ethers.BrowserProvider(window.ethereum);

    // Only prompt for permissions if no account is already authorized.
    // Calling eth_requestAccounts when a previous prompt is still open throws
    // "Request of type 'wallet_requestPermissions' already pending".
    let accounts: string[] = [];
    try {
      accounts = (await window.ethereum.request({ method: 'eth_accounts' })) || [];
    } catch {
      accounts = [];
    }

    if (accounts.length === 0) {
      try {
        await window.ethereum.request({ method: 'eth_requestAccounts' });
      } catch (err: any) {
        if (err?.code === -32002) {
          throw new Error(
            'A MetaMask connection request is already pending. Open the MetaMask extension and approve (or reject) the prompt, then try again.'
          );
        }
        if (err?.code === 4001) {
          throw new Error('Wallet connection was rejected in MetaMask.');
        }
        throw new Error(
          err?.message || err?.data?.message || 'Failed to connect wallet'
        );
      }
    }

    const signer = await provider.getSigner();
    const address = await signer.getAddress();

    await this.ensureCorrectNetwork(provider);

    return { signer, address };
  }

  private async waitForTargetChain(
    provider: ethers.BrowserProvider,
    maxAttempts = 25
  ): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      const n = await provider.getNetwork();
      if (Number(n.chainId) === EXPECTED_CHAIN_ID) return;
      await new Promise((r) => setTimeout(r, 200));
    }
    const n = await provider.getNetwork();
    throw new Error(
      `Wallet did not switch to chain ${EXPECTED_CHAIN_ID} (${NETWORK_NAME}). ` +
        `It is still on ${Number(n.chainId)}. Switch manually in MetaMask and try again.`
    );
  }

  private async ensureCorrectNetwork(provider: ethers.BrowserProvider): Promise<void> {
    const network = await provider.getNetwork();
    const currentChainId = Number(network.chainId);
    if (currentChainId === EXPECTED_CHAIN_ID) return;

    const targetHex = '0x' + EXPECTED_CHAIN_ID.toString(16);

    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: targetHex }],
      });
      await this.waitForTargetChain(provider);
    } catch (err: any) {
      // 4902 = chain not added in MetaMask.
      if (err?.code === 4902) {
        const blockExplorer = process.env.REACT_APP_BLOCKCHAIN_EXPLORER_URL;
        if (EXPECTED_CHAIN_ID === 31337) {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: targetHex,
                chainName: NETWORK_NAME,
                rpcUrls: [RPC_URL],
                nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
              },
            ],
          });
        } else {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: targetHex,
                chainName: NETWORK_NAME,
                rpcUrls: [RPC_URL],
                nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
                blockExplorerUrls: blockExplorer ? [blockExplorer] : ['https://sepolia.worldscan.org'],
              },
            ],
          });
        }
        await this.waitForTargetChain(provider);
        return;
      }
      if (err?.code === 4001) {
        throw new Error('Network switch was rejected in MetaMask.');
      }
      throw new Error(
        `Wrong network in wallet. Expected chain ${EXPECTED_CHAIN_ID} (${NETWORK_NAME}) but wallet is on chain ${currentChainId}. Please switch networks in MetaMask and try again.`
      );
    }
  }

  /**
   * Same balance MetaMask will use to sign — avoids mismatches with the read-only RPC
   * used elsewhere when the in-app / injected provider behaves differently.
   */
  private async getWalletNativeBalanceFromInjected(address: string): Promise<bigint> {
    if (!window.ethereum) return BigInt(0);
    const hex = (await window.ethereum.request({
      method: 'eth_getBalance',
      params: [address, 'latest'],
    })) as string;
    return BigInt(hex);
  }

  private async assertMetaMaskOnExpectedChain(): Promise<void> {
    if (!window.ethereum) return;
    const hex = (await window.ethereum.request({ method: 'eth_chainId' })) as string;
    const asNum = parseInt(hex, 16);
    if (asNum !== EXPECTED_CHAIN_ID) {
      throw new Error(
        `Your wallet is on the wrong network (chainId ${asNum} / ${hex}). ` +
          `Select ${NETWORK_NAME} (${EXPECTED_CHAIN_ID}) in MetaMask, then try again. ` +
          `A wrong network often shows 0 balance for gas even if your funded address is correct.`
      );
    }
  }

  /** e.g. "insufficient funds for gas * price + value: have 0 want 1203000000000" */
  private parseHaveWantFromMetamaskError(err: any): { have: bigint; want: bigint } | null {
    const s = [
      err && typeof err === 'object' && (err as Error).message,
      (err as any)?.info?.error?.message,
      (err as any)?.error?.message,
    ]
      .filter(Boolean)
      .join(' ');
    const m = s.match(/have\s+(\d+)\s+want\s+(\d+)/i);
    if (!m) return null;
    return { have: BigInt(m[1]), want: BigInt(m[2]) };
  }

  async submitContent(data: BlockchainSubmissionData): Promise<BlockchainResponse> {
    let walletAtSubmit: string | undefined;
    try {
      console.log('🔗 Connecting to wallet...');
      const { signer, address } = await this.connectWallet();
      walletAtSubmit = address;
      
      console.log('📝 Preparing contract interaction...');
      console.log('Contract Address:', CONTRACT_ADDRESS);
      console.log('User Address:', address);
      console.log('Submission Data:', data);

      // Create contract instance with signer
      const contractWithSigner = this.contract.connect(signer);

      // Sanity check: confirm contract bytecode actually exists on the wallet's network.
      // If MetaMask is on the wrong chain, the address will have no code and any read
      // would return "0x" with a confusing BAD_DATA error from ethers.
      const code = await signer.provider!.getCode(CONTRACT_ADDRESS);
      if (!code || code === '0x') {
        throw new Error(
          `No contract found at ${CONTRACT_ADDRESS} on your wallet's current network. ` +
            `Make sure MetaMask is on ${NETWORK_NAME} (chain ${EXPECTED_CHAIN_ID}) and REACT_APP_CONTRACT_ADDRESS matches your deployment.`
        );
      }

      const balInjected = await this.getWalletNativeBalanceFromInjected(address);
      const balEthers = await signer.provider!.getBalance(address);
      // Use the *larger* read: MetaMask and the read RPC can disagree; taking the
      // minimum falsely showed 0 in some World App / in-app browser cases.
      const bal = balInjected > balEthers ? balInjected : balEthers;
      if (bal === BigInt(0)) {
        throw new Error(
          `This wallet has 0 ETH for gas on ${NETWORK_NAME} (chain ${EXPECTED_CHAIN_ID}). ` +
            `Address ${address}. Fund this address on World Chain Sepolia (bridge Sepolia ETH), then retry.`
        );
      }

      // Check if content already exists
      const contentExists = await (contractWithSigner as any).contentExists(data.contentHash);
      if (contentExists) {
        throw new Error('Content with this hash already exists on the blockchain');
      }

      // Check if human signature already exists
      const entryId = await (contractWithSigner as any).getEntryIdBySignatureHash(data.humanSignatureHash);
      if (entryId > 0) {
        throw new Error('This biometric signature has already been used');
      }

      console.log('⛓️ Submitting to blockchain...');

      const typingScaled = Math.floor(data.typingSpeed * 1000);
      const store = (contractWithSigner as any).getFunction
        ? (contractWithSigner as any).getFunction('storeContent')
        : null;

      let gasLimit: bigint;
      try {
        if (store) {
          const est = await store.estimateGas(
            data.contentHash,
            data.humanSignatureHash,
            data.keystrokeCount,
            typingScaled
          );
          // 1.2x execution; cap at ~2.5x estimate so MetaMask’s “max cost” (gas*fee) is not over-reserved
          // vs a 1.2M default that can spuriously exceed balance on small L2 balances.
          const boosted = (est * BigInt(12)) / BigInt(10);
          const withFloor = est + BigInt(200_000);
          let g = boosted > withFloor ? boosted : withFloor;
          const cap = (est * BigInt(25)) / BigInt(10);
          if (g > cap) g = cap;
          if (g > BigInt(2_000_000)) g = BigInt(2_000_000);
          gasLimit = g;
        } else {
          gasLimit = BigInt(800_000);
        }
      } catch {
        gasLimit = BigInt(900_000);
      }

      const feeData = await signer.provider!.getFeeData();
      const unitPrice =
        feeData.maxFeePerGas ?? feeData.gasPrice ?? BigInt(0);
      if (unitPrice > BigInt(0) && gasLimit) {
        // L2-only upper bound, then large slack: OP-Stack (World Chain) also charges an L1 data fee.
        const l2 = (gasLimit * unitPrice * BigInt(15)) / BigInt(10);
        const opL1DataSlack = EXPECTED_CHAIN_ID === 4801 ? BigInt(5) : BigInt(1);
        const roughMaxWei = l2 * opL1DataSlack;
        if (bal < roughMaxWei) {
          throw new Error(
            `Balance too low for the max possible fee (including World Chain L1 data cost) — need at least ~${ethers.formatEther(roughMaxWei)} ETH, have ${ethers.formatEther(bal)} on ${NETWORK_NAME}. Add more gas ETH on chain ${EXPECTED_CHAIN_ID}, or wait and retry when fees drop.`
          );
        }
      }

      await this.assertMetaMaskOnExpectedChain();
      const bal2Inj = await this.getWalletNativeBalanceFromInjected(address);
      const bal2Rpc = await signer.provider!.getBalance(address);
      const bal2 = bal2Inj > bal2Rpc ? bal2Inj : bal2Rpc;
      if (bal2 < bal) {
        console.warn('blockchain: balance dropped before send', { bal, bal2 });
      }
      if (bal2 === BigInt(0)) {
        throw new Error(
          `This wallet now reports 0 balance on ${NETWORK_NAME} — confirm the correct network in MetaMask (chain ${EXPECTED_CHAIN_ID}) and the same address ${address}.`
        );
      }

      const gasOverrides: Record<string, string | bigint> = { gasLimit };
      if (feeData.maxFeePerGas) {
        gasOverrides.maxFeePerGas = feeData.maxFeePerGas;
        if (feeData.maxPriorityFeePerGas) {
          gasOverrides.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
        }
      } else if (feeData.gasPrice) {
        gasOverrides.gasPrice = feeData.gasPrice;
      }

      const tx = await (contractWithSigner as any).storeContent(
        data.contentHash,
        data.humanSignatureHash,
        data.keystrokeCount,
        typingScaled,
        gasOverrides
      );

      console.log('📋 Transaction submitted:', tx.hash);
      console.log('⏳ Waiting for confirmation...');

      const receipt = await tx.wait();
      console.log('✅ Transaction confirmed:', receipt);

      // Parse the ContentStored event to get the entry ID
      const logs = receipt.logs;
      let entryId_result: number | undefined;
      
      for (const log of logs) {
        try {
          const parsedLog = contractWithSigner.interface.parseLog(log);
          if (parsedLog?.name === 'ContentStored') {
            entryId_result = Number(parsedLog.args.entryId);
            break;
          }
        } catch (e) {
          // Skip logs that can't be parsed
        }
      }

      return {
        success: true,
        transactionHash: tx.hash,
        entryId: entryId_result,
        gasUsed: receipt.gasUsed.toString()
      };
      
    } catch (error: any) {
      console.error('❌ Blockchain submission failed:', error);
      const raw =
        (error instanceof Error && error.message) ||
        error?.shortMessage ||
        error?.reason ||
        error?.data?.message ||
        error?.error?.message ||
        error?.message ||
        (typeof error === 'string' ? error : null) ||
        'Unknown blockchain error';
      const lower = String(raw).toLowerCase();
      let message = raw;
      if (
        lower.includes('insufficient funds') &&
        (error?.code === 'INSUFFICIENT_FUNDS' || error?.info?.error?.code === -32603)
      ) {
        const who = walletAtSubmit ? ` Wallet: ${walletAtSubmit}.` : '';
        const url = walletAtSubmit
          ? `${BLOCK_EXPLORER.replace(/\/$/, '')}/address/${walletAtSubmit}`
          : '';
        const hw = this.parseHaveWantFromMetamaskError(error);
        if (hw) {
          const hEth = ethers.formatEther(hw.have);
          const wEth = ethers.formatEther(hw.want);
          const sameHaveZero = hw.have === BigInt(0);
          const detail =
            sameHaveZero
              ? 'Your wallet is reporting 0 available for this chain’s max fee. '
              : `Your wallet is reporting ${hEth} ETH on this chain but the transaction needs at least ${wEth} ETH reserved for the max possible fee. `;
          const opNote =
            EXPECTED_CHAIN_ID === 4801
              ? 'World Chain is an OP-Stack L2: calldata is charged to L1, so the max fee is higher than on normal L1-only gas math. '
              : '';
          message = `${detail}${opNote}Confirm MetaMask is on ${NETWORK_NAME} (chain ${EXPECTED_CHAIN_ID}) — a wrong network often shows 0 balance. ${who}` +
            ` If you use a World App in-app browser, try Safari/Chrome with MetaMask, or add more test ETH. ` +
            (url
              ? `Address on explorer: ${url}. Open in a normal browser if the link is blocked. `
              : '') +
            `If you just changed .env.local, restart npm start and hard-refresh.`;
        } else {
          message = `${raw}. ${who}` + (url ? ` Explorer: ${url}.` : '') +
            ` On World Chain, gas includes an L1 data component — ensure enough ETH for gas on ${NETWORK_NAME} (4801) and the correct network in MetaMask.`;
        }
      }
      const explorerAddressUrl = walletAtSubmit
        ? `${BLOCK_EXPLORER.replace(/\/$/, '')}/address/${walletAtSubmit}`
        : undefined;
      return {
        success: false,
        error: message,
        walletAddress: walletAtSubmit,
        explorerAddressUrl,
      };
    }
  }

  async getContentEntry(entryId: number): Promise<any> {
    try {
      const entry = await (this.contract as any).getContentEntry(entryId);
      return {
        contentHash: entry.contentHash,
        humanSignatureHash: entry.humanSignatureHash,
        worldIdNullifier: entry.worldIdNullifier,
        author: entry.author,
        timestamp: Number(entry.timestamp),
        keystrokeCount: Number(entry.keystrokeCount),
        typingSpeed: Number(entry.typingSpeed) / 1000, // Convert back from scaled integer
        isVerified: entry.isVerified
      };
    } catch (error) {
      console.error('Error fetching content entry:', error);
      throw error;
    }
  }

  async getTotalEntries(): Promise<number> {
    try {
      const count = await (this.contract as any).getTotalEntries();
      return Number(count);
    } catch (error) {
      console.error('Error fetching total entries:', error);
      throw error;
    }
  }

  async checkContentExists(contentHash: string): Promise<boolean> {
    try {
      return await (this.contract as any).contentExists(contentHash);
    } catch (error) {
      console.error('Error checking content existence:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const blockchainService = new BlockchainService();

// Extend Window interface for TypeScript
declare global {
  interface Window {
    ethereum?: any;
  }
} 