require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      evmVersion: "cancun"
    }
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    sepolia: {
      url: process.env.SEPOLIA_URL || "https://rpc.sepolia.org",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 11155111,
      gasPrice: 20000000000, // 20 gwei
    },
    worldchainSepolia: {
      url:
        process.env.WORLDCHAIN_SEPOLIA_URL ||
        "https://worldchain-sepolia.g.alchemy.com/public",
      accounts: process.env.WORLDCHAIN_SEPOLIA_PRIVATE_KEY
        ? [process.env.WORLDCHAIN_SEPOLIA_PRIVATE_KEY]
        : [],
      chainId: 4801,
    },
    worldchain: {
      url:
        process.env.WORLDCHAIN_URL ||
        "https://worldchain-mainnet.g.alchemy.com/public",
      accounts: process.env.WORLDCHAIN_PRIVATE_KEY
        ? [process.env.WORLDCHAIN_PRIVATE_KEY]
        : [],
      chainId: 480,
    },
    mumbai: {
      url: process.env.MUMBAI_URL || "https://rpc-mumbai.maticvigil.com",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 80001,
      gasPrice: 20000000000, // 20 gwei
    },
    polygon: {
      url: process.env.POLYGON_URL || "https://polygon-rpc.com",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 137,
      gasPrice: 30000000000, // 30 gwei
    },
  },
  etherscan: {
    apiKey: {
      sepolia: process.env.ETHERSCAN_API_KEY || "",
      polygon: process.env.POLYGONSCAN_API_KEY || "",
      polygonMumbai: process.env.POLYGONSCAN_API_KEY || "",
    },
  },
};
