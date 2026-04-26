import { ethers, type TransactionReceipt } from 'ethers';
import { MiniKit, type MiniAppSendTransactionSuccessPayload } from '@worldcoin/minikit-js';
import contractABI from './HumanContentLedger.json';
import { getBlockExplorerBaseUrl } from './explorerConfig';

// Contract configuration
const CONTRACT_ADDRESS = process.env.REACT_APP_CONTRACT_ADDRESS || '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const RPC_URL = process.env.REACT_APP_RPC_URL || 'http://127.0.0.1:8545';
const EXPECTED_CHAIN_ID = Number(process.env.REACT_APP_CHAIN_ID || 31337);
const NETWORK_NAME = process.env.REACT_APP_NETWORK_NAME || 'Localhost 8545';
/** Alchemy Blockscout (World Chain Sepolia); worldscan.org in env is normalized away. */
const BLOCK_EXPLORER = getBlockExplorerBaseUrl();

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
  blockNumber?: number;
  /** From mined block, ISO string, when a receipt was available. */
  blockTimestampIso?: string;
  /** Block explorer URL for the *transaction* (set on success). */
  explorerTxUrl?: string;
  /** Block explorer URL for the *contract* (set on success). */
  explorerContractUrl?: string;
  /** If set, open this in a real browser (mini in-app browsers may block the explorer). */
  explorerAddressUrl?: string;
  walletAddress?: string;
  /** Non-fatal: e.g. we have a tx hash but could not read receipt in time. */
  statusNote?: string;
  /**
   * When set, the UI should show a short `error` only and skip the large explorer /
   * gas help block (funds were likely fine; the chain or wallet was just slow).
   */
  quietUi?: boolean;
}

export type SubmitContentOptions = {
  onProgress?: (message: string) => void;
  privySigner?: ethers.Signer;
  privyAddress?: string;
};

class BlockchainService {
  private provider: ethers.JsonRpcProvider;
  private contract: ethers.Contract;

  constructor() {
    this.provider = new ethers.JsonRpcProvider(RPC_URL);
    this.contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, this.provider);
  }

  async connectWallet(): Promise<{ signer: ethers.Signer; address: string }> {
    if (!window.ethereum) {
      alert('⚠️ No Web3 wallet found! Please copy this page URL and open it strictly inside Chrome/Brave (with MetaMask enabled) or inside the MetaMask Mobile App browser.');
      throw new Error('PREFLIGHT_NO_WALLET');
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

  /**
   * After wallet_switchEthereumChain / addEthereumChain, MetaMask’s internal
   * EIP-1559 fee + “available for max fee” state can lag for a few hundred ms.
   * Without this, the first send often throws have=0 / insufficient funds and
   * the second click works.
   */
  private async settleAfterNetworkChange(): Promise<void> {
    await new Promise((r) => setTimeout(r, 400));
    await this.warmupInjectedProvider();
  }

  /**
   * Force a few reads on the *injected* provider so fee oracles and balance
   * used for the pre-signing “max cost” check are not stale (common in webviews).
   */
  private async warmupInjectedProvider(): Promise<void> {
    if (!window.ethereum) return;
    const p = new ethers.BrowserProvider(window.ethereum);
    for (let i = 0; i < 3; i++) {
      try {
        await p.getBlockNumber();
        await p.getFeeData();
        await p.getFeeData();
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 120 * (i + 1)));
      }
    }
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
      await this.settleAfterNetworkChange();
    } catch (err: any) {
      // 4902 = chain not added in MetaMask.
      if (err?.code === 4902) {
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
                blockExplorerUrls: [BLOCK_EXPLORER],
              },
            ],
          });
        }
        await this.waitForTargetChain(provider);
        await this.settleAfterNetworkChange();
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

  private  async assertMetaMaskOnExpectedChain(signer?: ethers.Signer): Promise<boolean> {
    if (!window.ethereum && !signer) return true;

    try {
      const provider = signer ? signer.provider as any : window.ethereum;
      const chainIdHex = await provider.request({ method: 'eth_chainId' });
      if (parseInt(chainIdHex, 16) === EXPECTED_CHAIN_ID) {
        return true;
      }
    } catch {
      // Ignored for environments without standard eth_chainId
    }
    throw new Error(
        `Your wallet is on the wrong network (chainId ${EXPECTED_CHAIN_ID} / ${NETWORK_NAME}). ` +
          `Select ${NETWORK_NAME} (${EXPECTED_CHAIN_ID}) in MetaMask, then try again. ` +
          `A wrong network often shows 0 balance for gas even if your funded address is correct.`
      );
  }

  /**
   * Ask the wallet to (re)add the chain config. If the wallet's current RPC for
   * this chain is broken, this is the only way to nudge it toward a known-good
   * RPC URL. MetaMask may either silently update or prompt the user — both are
   * acceptable outcomes; we just want a healthy RPC for the next attempt.
   */
  private async tryRefreshWalletRpc(): Promise<boolean> {
    if (!window.ethereum) return false;
    if (EXPECTED_CHAIN_ID !== 4801) return false;
    const targetHex = '0x' + EXPECTED_CHAIN_ID.toString(16);
    try {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: targetHex,
            chainName: NETWORK_NAME || 'World Chain Sepolia',
            rpcUrls: [
              RPC_URL || 'https://worldchain-sepolia.g.alchemy.com/public',
              'https://worldchain-sepolia.g.alchemy.com/public',
            ],
            nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
            blockExplorerUrls: [BLOCK_EXPLORER],
          },
        ],
      });
      return true;
    } catch {
      return false;
    }
  }

  /** Compare wallet-reported balance to a known-good RPC's balance. */
  private async detectWalletRpcMismatch(address: string): Promise<{
    walletBal: bigint;
    trustedBal: bigint;
    mismatch: boolean;
  }> {
    let walletBal = BigInt(0);
    let trustedBal = BigInt(0);
    try {
      walletBal = await this.getWalletNativeBalanceFromInjected(address);
    } catch {}
    try {
      trustedBal = await this.provider.getBalance(address); // public Alchemy RPC
    } catch {}
    return {
      walletBal,
      trustedBal,
      mismatch: trustedBal > BigInt(0) && walletBal === BigInt(0),
    };
  }

  /** e.g. "insufficient funds for gas * price + value: have 0 want 1203000000000" */
  private entryIdFromContentStoredLogs(receipt: TransactionReceipt): number | undefined {
    for (const log of receipt.logs) {
      try {
        const parsed = this.contract.interface.parseLog(log);
        if (parsed?.name === 'ContentStored') {
          return Number(parsed.args.entryId);
        }
      } catch {
        // not our event
      }
    }
    return undefined;
  }

  private async buildSuccessFromReceipt(
    txHash: string,
    receipt: TransactionReceipt,
    walletAtSubmit: string | undefined
  ): Promise<BlockchainResponse> {
    const baseExplorer = BLOCK_EXPLORER.replace(/\/$/, '');
    const entryId = this.entryIdFromContentStoredLogs(receipt);
    const blockNumber = Number(receipt.blockNumber);
    let blockTimestampIso: string | undefined;
    if (Number.isFinite(blockNumber)) {
      try {
        const block = await this.provider.getBlock(blockNumber);
        if (block) {
          blockTimestampIso = new Date(Number(block.timestamp) * 1000).toISOString();
        }
      } catch {
        /* ignore */
      }
    }
    return {
      success: true,
      transactionHash: txHash,
      entryId,
      gasUsed: receipt.gasUsed.toString(),
      blockNumber: Number.isFinite(blockNumber) ? blockNumber : undefined,
      blockTimestampIso,
      explorerTxUrl: `${baseExplorer}/tx/${txHash}`,
      explorerContractUrl: `${baseExplorer}/address/${CONTRACT_ADDRESS}`,
      explorerAddressUrl: walletAtSubmit
        ? `${baseExplorer}/address/${walletAtSubmit}`
        : undefined,
      walletAddress: walletAtSubmit,
    };
  }

  /**
   * After a wallet/ethers error, ask the *trusted* RPC whether the content was
   * actually stored. Wallet RPCs (and ethers) sometimes throw spuriously *after*
   * a successful broadcast — but the chain has the truth.
   */
  /**
   * After a wallet error, poll the public RPC until the new entry is indexed
   * (or timeout). This catches “user saw an error but the tx actually landed”.
   */
  private async waitForContentIndexed(
    data: BlockchainSubmissionData,
    fromAddress: string | undefined,
    maxMs: number,
    onProgress?: (message: string) => void
  ): Promise<{ entryId: number; txHash?: string } | null> {
    const t0 = Date.now();
    let lastUi = 0;
    while (Date.now() - t0 < maxMs) {
      try {
        const found = await this.findStoredContent(data.contentHash, fromAddress);
        if (found) return found;
      } catch {
        /* one poll failed, keep trying */
      }
      const elapsed = Date.now() - t0;
      if (elapsed - lastUi > 10_000) {
        lastUi = elapsed;
        onProgress?.(
          `⏳ Still polling the public RPC for your content… (~${Math.round(elapsed / 1000)}s)`
        );
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    return null;
  }

  private successFromIndexedFind(
    onChain: { entryId: number; txHash?: string },
    walletAtSubmit: string | undefined,
    submittedTxHash: string | null
  ): BlockchainResponse {
    const baseExplorer = BLOCK_EXPLORER.replace(/\/$/, '');
    const txHash = onChain.txHash || submittedTxHash || '';
    return {
      success: true,
      transactionHash: txHash || undefined,
      entryId: onChain.entryId,
      explorerTxUrl: txHash ? `${baseExplorer}/tx/${txHash}` : undefined,
      explorerContractUrl: `${baseExplorer}/address/${CONTRACT_ADDRESS}`,
      explorerAddressUrl: walletAtSubmit
        ? `${baseExplorer}/address/${walletAtSubmit}`
        : undefined,
      walletAddress: walletAtSubmit,
      statusNote: txHash
        ? undefined
        : 'Confirmed onchain; transaction hash is still being indexed. Open the explorer in an external browser if the link is blank.',
    };
  }

  private async findStoredContent(
    contentHash: string,
    fromAddress: string | undefined
  ): Promise<{ entryId: number; txHash?: string } | null> {
    try {
      const ledger = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, this.provider);
      const idBig = await (ledger as any).getEntryIdByContentHash(contentHash);
      const entryId = Number(idBig);
      if (!entryId || entryId <= 0) return null;

      let txHash: string | undefined;
      try {
        const eventFragment = ledger.interface.getEvent('ContentStored');
        if (eventFragment) {
          const topic0 = ethers.id(eventFragment.format('sighash'));
          const entryIdTopic = ethers.zeroPadValue(ethers.toBeHex(BigInt(entryId)), 32);
          const authorTopic = fromAddress
            ? ethers.zeroPadValue(fromAddress.toLowerCase(), 32)
            : null;
          const head = await this.provider.getBlockNumber();
          const fromBlock = Math.max(0, head - 50_000);
          const filter = {
            address: CONTRACT_ADDRESS,
            fromBlock,
            toBlock: 'latest' as const,
            topics: [topic0, entryIdTopic, authorTopic],
          };
          const logs = await this.provider.getLogs(filter as any);
          if (logs.length > 0) {
            txHash = logs[logs.length - 1].transactionHash;
          }
        }
      } catch (err) {
        console.warn('blockchain: log lookup for entryId failed', err);
      }
      return { entryId, txHash };
    } catch (err) {
      console.warn('blockchain: findStoredContent failed', err);
      return null;
    }
  }

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

  async submitContent(
    data: BlockchainSubmissionData,
    options?: SubmitContentOptions
  ): Promise<BlockchainResponse> {
    const onProgress = options?.onProgress;
    let walletAtSubmit: string | undefined;
    let submittedTxHash: string | null = null;
    try {
      let signer: ethers.Signer | undefined;
      const useMiniKit = MiniKit.isInstalled();

      if (!useMiniKit) {
        if (options?.privySigner && options?.privyAddress) {
          signer = options.privySigner;
          walletAtSubmit = options.privyAddress;
        } else {
          // Fallback legacy behavior
          const connected = await this.connectWallet();
          signer = connected.signer;
          walletAtSubmit = connected.address;
        }
      } else {
        console.log('📱 Using MiniKit native transaction bridge...');
        walletAtSubmit = MiniKit.user?.walletAddress || undefined;
      }

      console.log('📝 Preparing contract interaction...');
      console.log('Contract Address:', CONTRACT_ADDRESS);
      console.log('User Address:', walletAtSubmit);
      console.log('Submission Data:', data);

      // Check if content already exists (can be done with read-only provider)
      const contentExists = await (this.contract as any).contentExists(data.contentHash);
      if (contentExists) {
        throw new Error('Content with this hash already exists on the blockchain');
      }

      // Check if human signature already exists
      const entryId = await (this.contract as any).getEntryIdBySignatureHash(data.humanSignatureHash);
      if (entryId > 0) {
        throw new Error('This biometric signature has already been used');
      }

      console.log('⛓️ Submitting to blockchain...');
      onProgress?.('⏳ Generating transaction...');

      const typingScaled = Math.floor(data.typingSpeed * 1000);
      let contractWithSigner: ethers.Contract | undefined;

      if (!useMiniKit && signer) {
        contractWithSigner = this.contract.connect(signer) as ethers.Contract;
        
        // Assert network is correct (skip for Privy, Privy natively manages the chain internally)
        if (!options?.privySigner) {
          console.log('[Blockchain] Running legacy MetaMask network assertion...');
          await this.assertMetaMaskOnExpectedChain(signer);
        }
      }

      let tx: any;
      
      if (useMiniKit) {
        // --- 📱 MINIKIT PATH ---
        onProgress?.('⏳ Please confirm the transaction in World App...');
        
        try {
          const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
            transaction: [{
              address: CONTRACT_ADDRESS,
              abi: CONTRACT_ABI as any,
              functionName: 'storeContent',
              args: [
                data.contentHash,
                data.humanSignatureHash,
                String(data.keystrokeCount),
                String(typingScaled)
              ]
            }]
          });

          if (finalPayload.status === 'error') {
            const errPayload = finalPayload as any;
            throw new Error(`MiniKit transaction failed: ${errPayload.error_code || 'Unknown error'} — Details: ${JSON.stringify(errPayload)}`);
          }

          const successPayload = finalPayload as MiniAppSendTransactionSuccessPayload;
          submittedTxHash = successPayload.transaction_id;
          console.log('📋 MiniKit Transaction submitted:', submittedTxHash);
          
          onProgress?.('⏳ Transaction sent via World App — waiting for block confirmation…');
          
          throw new Error('MINIKIT_AWAIT_RECEIPT');
        } catch (mkErr: any) {
          if (mkErr.message === 'MINIKIT_AWAIT_RECEIPT') throw mkErr;
          throw new Error(`MiniKit Error: ${mkErr.message || mkErr}`);
        }
        
      } else {
        // --- 💻 BROWSER WALLET PATH (Gasless) ---
        onProgress?.('⏳ Please sign the free intent with your wallet...');
        
        try {
          console.log('[Blockchain] Fetching on-chain nonce for author:', walletAtSubmit);
          // Read nonce via this.contract (REACT_APP_RPC_URL). Privy embedded / Coinbase Smart Wallet
          // providers often do not support World Chain (4801); routing eth_call through them fails
          // with CALL_EXCEPTION / missing revert data even though the ledger is fine on public RPC.
          let nonce: bigint;
          try {
            nonce = await (this.contract as any).nonces(walletAtSubmit);
          } catch (nonceErr: any) {
            const inner =
              nonceErr instanceof Error ? nonceErr.message : String(nonceErr ?? '');
            throw new Error(
              `Could not read EIP-712 nonce from the ledger at ${CONTRACT_ADDRESS}. ` +
                `That almost always means REACT_APP_CONTRACT_ADDRESS points at a different contract than ` +
                `this app’s HumanContentLedger (e.g. an older deploy without a working nonces(address) getter). ` +
                `Redeploy from blockchain/contracts/HumanContentLedger.sol, update the env address, fund the relayer, then retry. ` +
                `Underlying RPC error: ${inner}`
            );
          }
          console.log('[Blockchain] Nonce fetched successfully:', nonce);

          const domain = {
            name: "HumanContentLedger",
            version: "1",
            chainId: EXPECTED_CHAIN_ID,
            verifyingContract: CONTRACT_ADDRESS
          };

          const types = {
            StoreContent: [
              { name: 'contentHash', type: 'string' },
              { name: 'humanSignatureHash', type: 'string' },
              { name: 'keystrokeCount', type: 'uint256' },
              { name: 'typingSpeed', type: 'uint256' },
              { name: 'nonce', type: 'uint256' }
            ]
          };

          const value = {
            contentHash: data.contentHash,
            humanSignatureHash: data.humanSignatureHash,
            keystrokeCount: data.keystrokeCount,
            typingSpeed: typingScaled,
            nonce: nonce
          };

          console.log('[Blockchain] Invoking Privy signature overlay (signTypedData)...');
          const signature = await signer!.signTypedData(domain, types, value);
          console.log('[Blockchain] Signature generated successfully!', signature);

          onProgress?.('⏳ Signature gathered! Relaying to World Chain...');
          console.log('[Blockchain] Initiating fetch request to Vercel Relayer...');

          const response = await fetch('/api/relay', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contentHash: data.contentHash,
              humanSignatureHash: data.humanSignatureHash,
              keystrokeCount: data.keystrokeCount,
              typingSpeed: typingScaled,
              author: walletAtSubmit,
              signature: signature
            })
          });

          const relayData = await response.json();
          if (!response.ok) {
            throw new Error(relayData.error || relayData.details || 'Failed to relay transaction');
          }

          submittedTxHash = relayData.transactionHash;
          console.log('📋 Relayed Transaction submitted:', submittedTxHash);
          onProgress?.('⏳ Transaction relayed — waiting for block confirmation…');

          // We wait for the relayed transaction to be mined
          const receipt = await this.provider.waitForTransaction(submittedTxHash!);
          if (!receipt) throw new Error("Transaction disappeared");
          
          console.log('✅ Transaction confirmed:', receipt);
          return await this.buildSuccessFromReceipt(submittedTxHash!, receipt, walletAtSubmit);

        } catch (sendErr: any) {
          const possibleHash = sendErr?.transactionHash || null;
          if (possibleHash) submittedTxHash = String(possibleHash);
          throw sendErr;
        }
      }
      
    } catch (error: any) {
      console.error('🔥 [CRITICAL BLOCKCHAIN ERROR THROWN IN SUBMIT] 🔥:', error);
      if (error?.message === 'PREFLIGHT_NO_WALLET') {
        throw new Error('MetaMask or similar wallet not found in this specific browser. Please use a browser with a Web3 extension.');
      }

      await new Promise((r) => setTimeout(r, 400));
      onProgress?.('⏳ Confirming on World Chain (checking the ledger)…');
      // STEP 1 — Contract may already show the new row even if the wallet errored.
      try {
        const onChain = await this.findStoredContent(data.contentHash, walletAtSubmit);
        if (onChain) {
          console.log('✅ Recovered: content is onchain despite wallet error', onChain);
          return this.successFromIndexedFind(onChain, walletAtSubmit, submittedTxHash);
        }
      } catch (recoverErr) {
        console.warn('blockchain: post-error contentExists check failed', recoverErr);
      }

      // STEP 2 — We have a hash but receipt / wait() failed: resolve via public RPC.
      // NOTE: For MiniKit, submittedTxHash is actually an ERC-4337 UserOpHash, not a standard tx hash!
      // This will cause provider.waitForTransaction to hang for 3 minutes.
      // Skip this for MiniKit and fall right into the smart contract background polling (STEP 3).
      const isMiniKitFallback = MiniKit.isInstalled();
      if (submittedTxHash && !isMiniKitFallback) {
        try {
          const fallbackReceipt = await this.provider.waitForTransaction(
            submittedTxHash,
            1,
            180_000
          );
          if (fallbackReceipt) {
            if (fallbackReceipt.status === 0) {
              return {
                success: false,
                error: `Transaction ${submittedTxHash} was mined but reverted onchain.`,
                walletAddress: walletAtSubmit,
                explorerAddressUrl: walletAtSubmit
                  ? `${BLOCK_EXPLORER.replace(/\/$/, '')}/address/${walletAtSubmit}`
                  : undefined,
                explorerTxUrl: `${BLOCK_EXPLORER.replace(/\/$/, '')}/tx/${submittedTxHash}`,
              };
            }
            console.log('✅ Recovered via public RPC after wallet wait() failed', submittedTxHash);
            return await this.buildSuccessFromReceipt(submittedTxHash, fallbackReceipt, walletAtSubmit);
          }
        } catch (recoverErr) {
          console.warn('blockchain: public-RPC receipt recovery failed', recoverErr);
        }
        return {
          success: true,
          transactionHash: submittedTxHash,
          statusNote: `Transaction sent. The explorer will show it shortly if the wallet’s confirmation step was slow.`,
          explorerTxUrl: `${BLOCK_EXPLORER.replace(/\/$/, '')}/tx/${submittedTxHash}`,
          explorerContractUrl: `${BLOCK_EXPLORER.replace(/\/$/, '')}/address/${CONTRACT_ADDRESS}`,
          walletAddress: walletAtSubmit,
          explorerAddressUrl: walletAtSubmit
            ? `${BLOCK_EXPLORER.replace(/\/$/, '')}/address/${walletAtSubmit}`
            : undefined,
        };
      }

      // STEP 3 — Entry often appears a few seconds after a misleading wallet error; wait before any UI error.
      try {
        onProgress?.(
          isMiniKitFallback 
            ? '⏳ Waiting for your transaction to be packaged and mined automatically (up to ~60s)…'
            : '⏳ Polling the chain in the background (no new MetaMask request) — up to ~90s for your entry…'
        );
        const longPolled = await this.waitForContentIndexed(data, walletAtSubmit, 90_000, onProgress);
        if (longPolled) {
          console.log('✅ Recovered via background polling', longPolled);
          return this.successFromIndexedFind(longPolled, walletAtSubmit, isMiniKitFallback ? null : submittedTxHash);
        }
      } catch (pollErr) {
        console.warn('blockchain: extended chain poll failed', pollErr);
      }

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

      // eth_call to nonces(address) reverted (selector 0x7ecebe00). Common cause: REACT_APP_CONTRACT_ADDRESS
      // points at an older / different bytecode than this app’s HumanContentLedger (on-chain ≠ repo artifact).
      const revertCallData: string =
        (typeof (error as any)?.transaction?.data === 'string' && (error as any).transaction.data) ||
        (typeof (error as any)?.info?.error?.transaction?.data === 'string' &&
          (error as any).info.error.transaction.data) ||
        '';
      if (
        error?.code === 'CALL_EXCEPTION' &&
        revertCallData.startsWith('0x7ecebe00') &&
        !String(raw).includes('Could not read EIP-712 nonce')
      ) {
        message =
          `The ledger at ${CONTRACT_ADDRESS} rejected the EIP-712 nonce read (nonces). ` +
          `That usually means REACT_APP_CONTRACT_ADDRESS is not the HumanContentLedger from this repo (wrong or stale deploy). ` +
          `Redeploy from blockchain/contracts/HumanContentLedger.sol, set the new address in env (client + relayer), fund RELAYER_PRIVATE_KEY on chain ${EXPECTED_CHAIN_ID}, redeploy the site, then retry.`;
      }

      const haveWant = this.parseHaveWantFromMetamaskError(error);
      const isInsufficient =
        error?.code === 'INSUFFICIENT_FUNDS' ||
        (lower.includes('insufficient funds') && (haveWant !== null || lower.includes('have 0')));

      let trustedBal: bigint = BigInt(0);
      if (walletAtSubmit) {
        try {
          trustedBal = await this.provider.getBalance(walletAtSubmit);
        } catch {
          trustedBal = BigInt(0);
        }
      }
      let showExplorer = true;
      if (isInsufficient) {
        const url = walletAtSubmit
          ? `${BLOCK_EXPLORER.replace(/\/$/, '')}/address/${walletAtSubmit}`
          : '';
        const hw = haveWant ?? this.parseHaveWantFromMetamaskError(error);
        const cmp = walletAtSubmit
          ? await this.detectWalletRpcMismatch(walletAtSubmit)
          : { walletBal: BigInt(0), trustedBal, mismatch: false };
        const isWalletRpcMismatch = cmp.mismatch && (!hw || hw.have === BigInt(0));

        if (isWalletRpcMismatch) {
          await this.tryRefreshWalletRpc();
          message =
            `The wallet and the public network disagree on your ${NETWORK_NAME} balance. ` +
            `In MetaMask, set the RPC to https://worldchain-sepolia.g.alchemy.com/public, save, then try Submit again. ` +
            (url ? `Explorer: ${url}` : '');
        } else if (trustedBal === BigInt(0)) {
          message =
            `This wallet has 0 ETH for gas on ${NETWORK_NAME} (chain ${EXPECTED_CHAIN_ID}). ` +
            `Fund the address, then try again. ` +
            (url ? `Address: ${url}.` : '');
        } else if (hw && hw.have > BigInt(0) && hw.want > hw.have) {
          // Real shortfall: wallet and chain agree the account cannot cover the max fee
          message =
            `This transaction needs a bit more ETH for gas (World Chain L2 includes L1 data). ` +
            `You have about ${ethers.formatEther(hw.have)} ETH; try funding this address, then submit again. ` +
            (url ? ` ${url}` : '');
        } else {
          // Likely a stale wallet / UI error after we already waited onchain; public balance still > 0
          message =
            "We could not show a final confirmation, but the chain still shows a balance. If you don't see a completed transaction, tap Submit to Blockchain again after a few seconds, or check My content to see if the entry is already there.";
          showExplorer = false;
        }
      } else if (String(raw).toLowerCase().includes('rejected') || String(raw).toLowerCase().includes('denied') || String(raw).toLowerCase().includes('user rejected')) {
        message = 'Transaction was not signed in the wallet. Tap Submit to Blockchain when you are ready to approve it.';
        showExplorer = false;
      }

      if (!isInsufficient) {
        console.error('❌ Blockchain submission failed:', error);
      } else {
        console.warn('blockchain: submission not confirmed after extended onchain check', { raw, trustedBal: trustedBal.toString() });
      }

      const explorerAddressUrl =
        showExplorer && walletAtSubmit
          ? `${BLOCK_EXPLORER.replace(/\/$/, '')}/address/${walletAtSubmit}`
          : undefined;
      return {
        success: false,
        error: message,
        walletAddress: showExplorer ? walletAtSubmit : undefined,
        explorerAddressUrl,
        quietUi: !showExplorer,
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