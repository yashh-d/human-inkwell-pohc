import { ethers } from 'ethers';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// ABI with only the necessary EIP-712 functions
const CONTRACT_ABI = [
  'function storeContentGasless(string _contentHash, string _humanSignatureHash, uint256 _keystrokeCount, uint256 _typingSpeed, address _author, uint8 v, bytes32 r, bytes32 s) external'
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { 
      contentHash, 
      humanSignatureHash, 
      keystrokeCount, 
      typingSpeed, 
      author, 
      signature 
    } = req.body;

    if (!contentHash || !humanSignatureHash || !author || !signature) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const { REACT_APP_CONTRACT_ADDRESS, REACT_APP_RPC_URL, RELAYER_PRIVATE_KEY } = process.env;

    if (!RELAYER_PRIVATE_KEY) {
      console.error('CRITICAL: RELAYER_PRIVATE_KEY is missing in environment variables.');
      return res.status(500).json({ error: 'Relayer configuration error.' });
    }
    
    if (!REACT_APP_CONTRACT_ADDRESS || !REACT_APP_RPC_URL) {
      return res.status(500).json({ error: 'Blockchain configuration missing.' });
    }

    const provider = new ethers.JsonRpcProvider(REACT_APP_RPC_URL);
    const wallet = new ethers.Wallet(RELAYER_PRIVATE_KEY, provider);
    const contract = new ethers.Contract(REACT_APP_CONTRACT_ADDRESS, CONTRACT_ABI, wallet);

    // Extract signature components
    const sig = ethers.Signature.from(signature);

    console.log(`Relaying gasless transaction for author: ${author}`);
    console.log(`Content Hash: ${contentHash}`);

    // Call the smart contract using the Relayer's wallet (paying gas)
    const tx = await contract.storeContentGasless(
      contentHash,
      humanSignatureHash,
      keystrokeCount,
      typingSpeed,
      author,
      sig.v,
      sig.r,
      sig.s
    );

    console.log(`Relay Tx Hash: ${tx.hash}`);
    return res.status(200).json({ success: true, transactionHash: tx.hash });
    
  } catch (error: any) {
    console.error('🔥 Relayer Critical Failure!');
    console.error('Error Name:', error.name);
    console.error('Error Code:', error.code);
    console.error('Error Message:', error.message);
    if (error.info) console.error('RPC Info:', JSON.stringify(error.info, null, 2));
    if (error.transaction) console.error('Failed Tx:', error.transaction);

    let specificFix = 'Unknown Error';
    if (error.message?.includes('insufficient funds') || error.code === 'INSUFFICIENT_FUNDS') {
      specificFix = 'CRITICAL: The Vercel RELAYER_PRIVATE_KEY wallet has ZERO ETH on World Chain Sepolia. Please fund the relayer.';
    } else if (error.message?.includes('Invalid EIP-712 signature')) {
      specificFix = 'The EIP-712 signature verification failed. Did the smart contract get redeployed without updating REACT_APP_CONTRACT_ADDRESS?';
    }

    return res.status(500).json({ 
      error: 'Relay failed', 
      details: error.message,
      troubleshooting: specificFix,
      code: error.code
    });
  }
}
