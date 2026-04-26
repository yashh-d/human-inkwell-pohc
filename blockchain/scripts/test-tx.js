require("dotenv").config();
const { JsonRpcProvider, Wallet } = require("ethers");

async function main() {
  const url = process.env.WORLDCHAIN_SEPOLIA_URL;
  const p = new JsonRpcProvider(
    url,
    { chainId: 4801, name: "World Chain Sepolia" }
  );
  const w = new Wallet(process.env.WORLDCHAIN_SEPOLIA_PRIVATE_KEY, p);
  const bal = await p.getBalance(w.address);
  console.log("Balance wei:", bal.toString());
  const tx = await w.sendTransaction({
    to: w.address,
    value: 0n,
    gasLimit: 21000n,
    maxFeePerGas: 2n * 10n ** 9n,
    maxPriorityFeePerGas: 1n * 10n ** 9n,
  });
  console.log("Self-tx hash:", tx.hash);
  await tx.wait();
  console.log("Self-tx confirmed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
