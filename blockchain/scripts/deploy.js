const { ethers } = require("hardhat");

async function main() {
  console.log("🚀 Starting deployment to", network.name);
  
  // Get the deployer account
  const [deployer] = await ethers.getSigners();
  console.log("📝 Deploying contracts with account:", deployer.address);
  
  // Get account balance
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("💰 Account balance:", ethers.formatEther(balance), "ETH");
  
  // World ID contract addresses for different networks
  const WORLD_ID_CONTRACTS = {
    sepolia: "0x469449f251692e0779667583026b5a1e99512157", // World ID Router on Sepolia (official)
    mumbai: "0x11cA3127182f7583EfC416a8771BD4d11Fae4334", // World ID Router on Mumbai
    localhost: "0x0000000000000000000000000000000000000000", // Will deploy mock
  };
  
  // World ID App configuration
  const APP_ID = process.env.WORLD_ID_APP_ID || "app_staging_12345";
  const ACTION = process.env.WORLD_ID_ACTION || "human-content-proof";
  
  let worldIdAddress;
  
  // Deploy Mock World ID for localhost, use real contracts for testnets
  if (network.name === "localhost" || network.name === "hardhat") {
    console.log("🔧 Deploying Mock World ID for local testing...");
    const MockWorldID = await ethers.getContractFactory("MockWorldID");
    const mockWorldID = await MockWorldID.deploy();
    await mockWorldID.waitForDeployment();
    worldIdAddress = await mockWorldID.getAddress();
    console.log("✅ Mock World ID deployed to:", worldIdAddress);
  } else {
    // Use existing World ID contracts on testnets
    worldIdAddress = WORLD_ID_CONTRACTS[network.name];
    if (!worldIdAddress) {
      console.error("❌ No World ID contract found for network:", network.name);
      console.log("Available networks:", Object.keys(WORLD_ID_CONTRACTS));
      process.exit(1);
    }
    console.log("🌍 Using existing World ID contract at:", worldIdAddress);
  }
  
  // Deploy the main contract
  console.log("🔧 Deploying ProofOfHumanContentSimple...");
  const ProofOfHumanContent = await ethers.getContractFactory("ProofOfHumanContentSimple");
  const proofOfHumanContent = await ProofOfHumanContent.deploy(
    worldIdAddress,
    APP_ID,
    ACTION
  );
  
  await proofOfHumanContent.waitForDeployment();
  const contractAddress = await proofOfHumanContent.getAddress();
  
  console.log("✅ ProofOfHumanContentSimple deployed to:", contractAddress);
  
  // Get contract info
  const contractInfo = await proofOfHumanContent.getContractInfo();
  console.log("📋 Contract Configuration:");
  console.log("   - World ID Address:", contractInfo.worldIdAddress);
  console.log("   - Group ID:", contractInfo.currentActionId.toString());
  console.log("   - Owner:", await proofOfHumanContent.owner());
  console.log("   - Network:", network.name);
  console.log("   - Chain ID:", network.config.chainId);
  
  // Save deployment info
  const deploymentInfo = {
    network: network.name,
    chainId: network.config.chainId,
    contractAddress: contractAddress,
    worldIdAddress: worldIdAddress,
    appId: APP_ID,
    action: ACTION,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    blockNumber: await ethers.provider.getBlockNumber(),
  };
  
  console.log("\n🎯 Deployment Summary:");
  console.log("===============================");
  console.log("Network:", deploymentInfo.network);
  console.log("Contract Address:", deploymentInfo.contractAddress);
  console.log("World ID Address:", deploymentInfo.worldIdAddress);
  console.log("App ID:", deploymentInfo.appId);
  console.log("Action:", deploymentInfo.action);
  console.log("Deployer:", deploymentInfo.deployer);
  console.log("Block Number:", deploymentInfo.blockNumber);
  console.log("===============================");
  
  // Instructions for next steps
  console.log("\n🔧 Next Steps:");
  console.log("1. Update your React app .env.local with:");
  console.log(`   REACT_APP_CONTRACT_ADDRESS=${contractAddress}`);
  console.log(`   REACT_APP_WORLD_ID_CONTRACT_ADDRESS=${worldIdAddress}`);
  console.log(`   REACT_APP_WORLD_ID_APP_ID=${APP_ID}`);
  console.log(`   REACT_APP_WORLD_ID_ACTION=${ACTION}`);
  console.log(`   REACT_APP_CHAIN_ID=${network.config.chainId}`);
  console.log(`   REACT_APP_NETWORK_NAME=${network.name}`);
  
  if (network.name !== "localhost" && network.name !== "hardhat") {
    console.log("\n2. Set up World ID App:");
    console.log("   - Go to https://developer.worldcoin.org");
    console.log("   - Create a new app or use existing");
    console.log("   - Set App ID to:", APP_ID);
    console.log("   - Set Action to:", ACTION);
    console.log("   - Add your domain to allowed origins");
    
    console.log("\n3. Get testnet ETH:");
    console.log("   - Sepolia: https://sepoliafaucet.com/");
    console.log("   - Mumbai: https://faucet.polygon.technology/");
    
    console.log("\n4. Explorer Links:");
    if (network.name === "sepolia") {
      console.log(`   - Contract: https://sepolia.etherscan.io/address/${contractAddress}`);
    } else if (network.name === "mumbai") {
      console.log(`   - Contract: https://mumbai.polygonscan.com/address/${contractAddress}`);
    }
  }
  
  return deploymentInfo;
}

// Execute deployment
main()
  .then((deploymentInfo) => {
    console.log("\n🎉 Deployment completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });
