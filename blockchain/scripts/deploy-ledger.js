const hre = require("hardhat");

async function main() {
  console.log("Deploying HumanContentLedger to", hre.network.name);

  const [deployer] = await hre.ethers.getSigners();
  const bal = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Deployer:", deployer.address);
  console.log("Balance wei:", bal.toString());

  const fee = await hre.ethers.provider.getFeeData();
  console.log("Fee data maxFeePerGas:", fee.maxFeePerGas?.toString());

  // OP Stack: bind factory to signer; explicit EIP-1559 fields avoid some RPC quirks
  const HumanContentLedger = await hre.ethers.getContractFactory(
    "HumanContentLedger",
    deployer
  );
  const deployOpts = {
    maxFeePerGas: fee.maxFeePerGas
      ? (fee.maxFeePerGas * 12n) / 10n
      : 10n * 10n ** 9n, // 10 gwei fallback
    maxPriorityFeePerGas: fee.maxPriorityFeePerGas
      ? (fee.maxPriorityFeePerGas * 12n) / 10n
      : 1n * 10n ** 9n, // 1 gwei
  };
  const ledger = await HumanContentLedger.deploy(deployOpts);
  await ledger.waitForDeployment();

  const address = await ledger.getAddress();
  console.log("HumanContentLedger deployed to:", address);
  console.log("Update REACT_APP_CONTRACT_ADDRESS in client/.env.local to:", address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
