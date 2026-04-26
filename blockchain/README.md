# Human Content Ledger Smart Contract

A Solidity smart contract for storing human-verified content with biometric keystroke signatures, designed to work with the Human Inkwell biometric capture system.

## 🏗️ Contract Overview

The `HumanContentLedger` contract allows users to store content with cryptographic proof of human authorship through:
- **Biometric Keystroke Signatures**: SHA-256 hashes of typing patterns
- **Content Hashes**: SHA-256 hashes of typed content
- **World ID Integration**: Optional zero-knowledge proof of humanness
- **Duplicate Prevention**: Prevents reuse of content and biometric signatures

## 🔧 Features

- ✅ **Store human-verified content** with biometric signatures
- ✅ **World ID integration** for proof-of-personhood
- ✅ **Duplicate protection** for content and signatures
- ✅ **Gas-optimized** storage and retrieval
- ✅ **Event logging** for transparency
- ✅ **Comprehensive testing** suite

## 📋 Contract Functions

### Storage Functions

- `storeContent()` - Store content without World ID verification
- `storeVerifiedContent()` - Store content with World ID verification

### Retrieval Functions

- `getContentEntry()` - Get entry by ID
- `getEntryIdByContentHash()` - Find entry by content hash
- `getEntryIdBySignatureHash()` - Find entry by signature hash
- `getEntriesByAuthor()` - Get all entries by author
- `getTotalEntries()` - Get total number of entries

### Validation Functions

- `contentExists()` - Check if content hash exists
- `signatureExists()` - Check if signature hash exists

## 🚀 Getting Started

### Prerequisites

```bash
npm install --save-dev hardhat @nomicfoundation/hardhat-toolbox
```

### Installation

```bash
# Install dependencies
npm install

# Compile contracts
npx hardhat compile

# Run tests
npx hardhat test
```

### Deployment

#### Local Network
```bash
npx hardhat run scripts/deploy.js --network hardhat
```

#### Testnet (Sepolia)
```bash
# Set up environment variables
export SEPOLIA_URL="https://sepolia.infura.io/v3/YOUR_INFURA_KEY"
export PRIVATE_KEY="your_private_key"

# Deploy
npx hardhat run scripts/deploy.js --network sepolia
```

#### Mainnet (Polygon)
```bash
# Set up environment variables
export POLYGON_URL="https://polygon-mainnet.infura.io/v3/YOUR_INFURA_KEY"
export PRIVATE_KEY="your_private_key"

# Deploy
npx hardhat run scripts/deploy.js --network polygon
```

## 🧪 Testing

### Run Full Test Suite
```bash
npx hardhat test
```

### Interactive Testing
```bash
npx hardhat run scripts/interact.js
```

### Test Results
```
✔ Should set the right owner
✔ Should start with zero entries
✔ Should store content without World ID
✔ Should store verified content with World ID
✔ Should prevent duplicate content
✔ Should prevent duplicate human signatures
✔ Should retrieve content by hash
✔ Should retrieve content by signature hash
✔ Should get entries by author
✔ Should check content existence
✔ Should emit ContentStored event
✔ Should emit ContentStored and WorldIdVerified events for verified content

12 passing (270ms)
```

## 📊 Gas Usage

| Function | Gas Cost |
|----------|----------|
| `storeContent` | ~401,119 |
| `storeVerifiedContent` | ~536,164 |
| Contract Deployment | ~2,091,065 |

## 🔐 Security Features

- **Duplicate Prevention**: Content and signature hashes can only be used once
- **Access Control**: Owner-only functions for emergency scenarios
- **Input Validation**: Comprehensive checks for all parameters
- **Event Logging**: All storage operations emit events for transparency

## 📡 Frontend Integration

After deployment, update your frontend `.env.local` file:

```bash
REACT_APP_CONTRACT_ADDRESS=0x_YOUR_CONTRACT_ADDRESS
REACT_APP_CHAIN_ID=chain_id_number
```

## 📖 Usage Examples

### Store Content (JavaScript)
```javascript
const tx = await humanContentLedger.storeContent(
  "0x1234567890abcdef...", // Content hash
  "0xabcdef1234567890...", // Human signature hash
  42,                      // Keystroke count
  1500                     // Typing speed (chars/sec * 1000)
);
```

### Store Verified Content (JavaScript)
```javascript
const tx = await humanContentLedger.storeVerifiedContent(
  "0x1234567890abcdef...", // Content hash
  "0xabcdef1234567890...", // Human signature hash
  "0xcccccccccccccccc...", // World ID nullifier
  42,                      // Keystroke count
  1500                     // Typing speed (chars/sec * 1000)
);
```

### Retrieve Content (JavaScript)
```javascript
const entry = await humanContentLedger.getContentEntry(1);
console.log(entry.contentHash);
console.log(entry.humanSignatureHash);
console.log(entry.author);
console.log(entry.isVerified);
```

## 🌐 Network Configuration

| Network | Chain ID | Status |
|---------|----------|--------|
| Hardhat | 31337 | ✅ Ready |
| Sepolia | 11155111 | ✅ Ready |
| Polygon | 137 | ✅ Ready |
| Mumbai | 80001 | ✅ Ready |

## 📝 License

MIT License

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 🔗 Links

- [Human Inkwell Frontend](../client/)
- [Hardhat Documentation](https://hardhat.org/docs)
- [World ID Documentation](https://docs.worldcoin.org/)
- [Solidity Documentation](https://docs.soliditylang.org/)

## 📞 Support

For questions or issues, please open an issue on the repository or contact the development team.

---

**Built with ❤️ for secure, human-verified content storage**
