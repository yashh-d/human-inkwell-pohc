require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { JsonRpcProvider, Wallet, ContractFactory } = require("ethers");

async function main() {
  const url = process.env.WORLDCHAIN_SEPOLIA_URL;
  const key = process.env.WORLDCHAIN_SEPOLIA_PRIVATE_KEY;
  const artifact = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "../artifacts/contracts/MockWorldID.sol/MockWorldID.json"),
      "utf8"
    )
  );
  const p = new JsonRpcProvider(url, { chainId: 4801, name: "W" });
  const w = new Wallet(key, p);
  const f = new ContractFactory(artifact.abi, artifact.bytecode, w);
  const t = await f.getDeployTransaction();
  const g = await p.estimateGas(t);
  const gasLimit = (g * 12n) / 10n;
  const c = await f.deploy({
    gasLimit,
    maxFeePerGas: 2n * 10n ** 9n,
    maxPriorityFeePerGas: 1n * 10n ** 9n,
  });
  await c.waitForDeployment();
  console.log("MockWorldID at", await c.getAddress());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
