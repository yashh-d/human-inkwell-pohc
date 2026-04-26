/**
 * Deploy HumanContentLedger to World Chain Sepolia using plain ethers.
 * Workaround: Hardhat + this RPC sometimes returns sub-1-gwei getFeeData() and
 * deploy() then fails with confusing "insufficient funds... have 0" errors.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { JsonRpcProvider, Wallet, ContractFactory } = require("ethers");

async function main() {
  const url = process.env.WORLDCHAIN_SEPOLIA_URL;
  const key = process.env.WORLDCHAIN_SEPOLIA_PRIVATE_KEY;
  if (!url || !key) {
    throw new Error("Set WORLDCHAIN_SEPOLIA_URL and WORLDCHAIN_SEPOLIA_PRIVATE_KEY in .env");
  }

  const artifactPath = path.join(
    __dirname,
    "../artifacts/contracts/HumanContentLedger.sol/HumanContentLedger.json"
  );
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  // Pin chain so the signed chainId always matches 4801 (avoids L2 "have 0" / fee issues)
  const provider = new JsonRpcProvider(
    url,
    { chainId: 4801, name: "World Chain Sepolia" }
  );
  const wallet = new Wallet(key, provider);
  const bal = await provider.getBalance(wallet.address);
  console.log("Deployer:", wallet.address);
  console.log("Balance wei:", bal.toString());

  const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet);
  // L2 only — keep these modest; the total you pay is L2 gas * fee + L1 data fee
  // (latter can be large for a big `CREATE`). Overpaying in maxFee*gas can push
  // "max cost" over your balance in prechecks on some nodes.
  const maxPriority = 1_000_000_000n; // 1 gwei
  const maxFee = 2n * 1_000_000_000n; // 2 gwei (typical L2; safe precheck on ~0.1 ETH balance)
  const deployTx = await factory.getDeployTransaction();
  const estGas = await provider.estimateGas(deployTx);
  // Large `HumanContentLedger` on OP Stack: add buffer for L2 execution; L1 data
  // is charged separately in addition to (maxFee*gas) prechecks on some nodes.
  const gasLimit = (estGas * 2n) / 1n; // 2x over estimate

  console.log(
    "Using gasLimit",
    gasLimit.toString(),
    "maxFeePerGas",
    maxFee.toString(),
    "maxPriorityFeePerGas",
    maxPriority.toString()
  );

  const contract = await factory.deploy({
    gasLimit,
    maxFeePerGas: maxFee,
    maxPriorityFeePerGas: maxPriority,
  });
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log("HumanContentLedger deployed to:", address);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
