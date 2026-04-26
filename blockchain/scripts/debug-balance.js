const hre = require("hardhat");

async function main() {
  const [s] = await hre.ethers.getSigners();
  const net = await hre.ethers.provider.getNetwork();
  const b = await hre.ethers.provider.getBalance(s.address);
  console.log("network", net.chainId, net.name);
  console.log("signer", s.address);
  console.log("balance", b.toString());
}

main().catch(console.error);
