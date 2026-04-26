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
    
    // We return the transaction hash immediately. The frontend can waitForTransaction on exactly this hash.
    return res.status(200).json({ 
      success: true, 
      transactionHash: tx.hash 
    });
    
  } catch (error: any) {
    console.error('Relayer error:', error);
    return res.status(500).json({ 
      error: 'Relay failed', 
      details: error.message 
    });
  }
}
