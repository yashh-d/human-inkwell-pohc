# Human Inkwell (POHC) — Full Documentation

This document describes the **Human Inkwell** mini-app: keystroke-capture, optional **World ID** verification, and on-chain storage via the **HumanContentLedger** contract on **World Chain Sepolia** (or local Hardhat).

---

## Table of contents

1. [What this app does](#what-this-app-does)
2. [Architecture](#architecture)
3. [Repository layout](#repository-layout)
4. [Privacy: what is and is not on-chain](#privacy-what-is-and-is-not-on-chain)
5. [Biometric pipeline](#biometric-pipeline)
6. [World ID](#world-id)
7. [Blockchain: contract & network](#blockchain--contract--network)
8. [Client configuration (`.env.local`)](#client-configuration-envlocal)
9. [Run locally](#run-locally)
10. [Deploying the contract (Hardhat)](#deploying-the-contract-hardhat)
11. [Submit to blockchain: flow & requirements](#submit-to-blockchain--flow--requirements)
12. [Gas on World Chain (OP Stack)](#gas-on-world-chain-op-stack)
13. [Troubleshooting](#troubleshooting)
14. [References](#references)

---

## What this app does

- Captures **keydown / keyup** events in a textarea to build a **keystroke timing profile** (no audio, no keylogging to a server in this design—the processing is local in the browser).
- Derives a **feature vector** of timing statistics (hold, flight, down–down latencies) plus **typing speed** and **backspace count**.
- Computes:
  - **`contentHash`**: SHA-256 of the **UTF-8** plain text.
  - **`humanSignatureHash`**: SHA-256 of the **binary** `Float64Array` of the feature vector.
- Optionally verifies the user with **World ID** (e.g. device level).
- Lets the user **submit** `storeContent` to the **HumanContentLedger** contract, binding author address, hashes, and metrics on an L2.

**Plain text is never sent to the chain**—only hashes and numeric fields required by the contract.

---

## Architecture

```text
┌──────────────────┐     ┌──────────────┐     ┌─────────────────────────┐
│ React client     │     │ World ID     │     │ Injected wallet         │
│ (keystroke +     │────▶│ (IdKit)      │     │ (e.g. MetaMask)         │
│  hash pipeline)  │     └──────────────┘     └──────────┬──────────────┘
└────────┬─────────┘                                   │
         │                                              │
         │  eth_sendTransaction / reads                 │
         ▼                                              ▼
┌──────────────────────────────────────────────────────────────┐
│  World Chain Sepolia (chain ID 4801) — HumanContentLedger    │
│  (OP Stack: L2 execution + L1 data fee for calldata)          │
└──────────────────────────────────────────────────────────────┘
```

- **Reads** can use a public RPC (e.g. `REACT_APP_RPC_URL` with a public Alchemy host).
- **Sends** go through the user’s wallet RPC; the app’s balance checks use `eth_getBalance` via the same injected provider so they align with what MetaMask will use.

---

## Repository layout

| Path | Role |
|------|------|
| `client/` | Create React App + TypeScript. Keystroke hooks, World ID UI, `blockchain.ts` service, ABI. |
| `client/src/blockchain.ts` | Wallet connect, network switch, `storeContent` with gas / fee handling. |
| `client/src/utils/crypto.ts` | `hashContent` (SHA-256 of text). |
| `client/src/hooks/useBiometricProcessor.ts` | Feature vector + `generateHumanSignatureHash` (SHA-256 of `Float64Array` bytes). |
| `blockchain/` | Hardhat, `HumanContentLedger.sol`, tests, deploy scripts. |
| `blockchain/contracts/HumanContentLedger.sol` | On-chain storage contract. |

---

## Privacy: what is and is not on-chain

| Data | On-chain? |
|------|------------|
| The exact string you typed | **No** — only `contentHash` (hex string). |
| Raw keystroke timing arrays in full | **No** — only a hash of a **fixed 17-number** feature vector. |
| World ID nullifier (if you use `storeVerifiedContent` in the future) | Can be, depending on which function you use. Current client path uses `storeContent` (no nullifier in contract for that call). |
| `author` address, `timestamp`, `keystrokeCount`, `typingSpeed` (scaled) | **Yes** — in `ContentEntry`. |

**You cannot recover the original essay from the blockchain** without brute-forcing SHA-256 or the biometric hash space.

---

## Biometric pipeline

1. **Session metrics** (see UI “Detailed Biometric Analysis”):
   - **Hold times (dwell)**: per-key down→up.
   - **Flight times**: key *release* to next *press*.
   - **Down–down**: consecutive *press* to *press* (digraph-style).
2. **Per-dimension stats**: mean, standard deviation, median, min, max for hold, flight, and down–down.
3. **Feature vector (17 values)** (order matters for hashing):
   - `[hold×5, flight×5, down–down×5, typingSpeed, backspaceCount]`
4. **`humanSignatureHash`**: `SHA-256( Float64Array(featureVector) as ArrayBuffer )` as lowercase hex.
5. **`contentHash`**: `SHA-256( UTF-8 text )` as lowercase hex.

Duplicate **content** or **signature** strings are rejected by the contract (see `validHashes` in Solidity).

---

## World ID

Configured via environment variables in `client/.env.local`:

- `REACT_APP_WORLD_APP_ID` — App ID from the [World Developer Portal](https://developer.worldcoin.org).
- `REACT_APP_WORLD_ACTION` — Action / signal id for the proof.
- `REACT_APP_WORLD_VERIFICATION_LEVEL` — e.g. `device` (no Orb) or `orb`.
- `REACT_APP_WORLD_ENABLE_STAGING` — staging flag for IdKit.

**Submitting to the blockchain** in this app does *not* require World ID to succeed for `storeContent` (on-chain), but the product can still encourage verification in the UI.

---

## Blockchain: contract & network

- **Network (current setup):** **World Chain Sepolia**, **chain ID `4801`**, hex `0x12C1` (or `0x12c1`).
- **Block explorer (testnet):** e.g. `https://sepolia.worldscan.org` (set `REACT_APP_BLOCKCHAIN_EXPLORER_URL`).

### `HumanContentLedger` (high level)

- **`storeContent(contentHash, humanSignatureHash, keystrokeCount, typingSpeedScaled)`**  
  - `typingSpeed` on-chain is stored as **characters per second × 1000** (integer-style scaling from the app).
- **`storeVerifiedContent(..., worldIdNullifier, ...)`** for optional verified flows (nullifier must be unique, etc.).

- **Uniqueness:** one entry per **content hash** and one per **human signature hash**; optional uniqueness for World ID nullifier in the verified path.
- **Events:** `ContentStored` (indexed `entryId`, `author`, and string hashes in `data`).

> **Note:** A deployment address is not fixed for all time—set `REACT_APP_CONTRACT_ADDRESS` to your own deployment when you redeploy.

---

## Client configuration (`.env.local`)

Create `client/.env.local` (not committed) with at least:

```bash
# World ID
REACT_APP_WORLD_APP_ID=app_...
REACT_APP_WORLD_ACTION=verify_human_content
REACT_APP_WORLD_VERIFICATION_LEVEL=device
REACT_APP_WORLD_ENABLE_STAGING=false

# World Chain Sepolia
REACT_APP_CONTRACT_ADDRESS=0x...        # your HumanContentLedger
REACT_APP_CHAIN_ID=4801
REACT_APP_NETWORK_NAME=World Chain Sepolia
REACT_APP_RPC_URL=https://worldchain-sepolia.g.alchemy.com/public
REACT_APP_BLOCKCHAIN_EXPLORER_URL=https://sepolia.worldscan.org
```

After any change, **restart** `npm start` and do a **hard refresh** in the browser so `REACT_APP_*` is picked up (Create React App bakes them at build time).

---

## Run locally

**Frontend (from the `client` directory):**

```bash
cd client
npm install
npm start
```

**Smart contracts (from `blockchain/`):**

```bash
cd blockchain
npm install
npx hardhat compile
npx hardhat test
```

Use `npx hardhat node` for a local chain (chainId `31337` in this project) and point the client to `REACT_APP_CHAIN_ID=31337` and the deployed local address if testing locally.

---

## Deploying the contract (Hardhat)

- Network **`worldchainSepolia`** in `blockchain/hardhat.config.js` (chainId **4801**).
- Set `blockchain/.env` with something like:
  - `WORLDCHAIN_SEPOLIA_PRIVATE_KEY`
  - `WORLDCHAIN_SEPOLIA_URL` (often an Alchemy **with key** URL for deploy scripts; the **public** URL in the app is for reads in the browser.)

Use the project’s deploy scripts under `blockchain/scripts/` (e.g. `deploy-ledger-ethers.js`) and then copy the deployed address into `client/.env.local` as `REACT_APP_CONTRACT_ADDRESS`.

OP Stack **deploys** can be gas-heavy; the repo may use a **>1×** gas limit buffer on deploy scripts. Follow any comments in the deploy script you run.

---

## Submit to blockchain: flow & requirements

1. **Generate Local Signature** — build hashes; ensure **new** text so hashes are not already used on that contract.
2. **Connect wallet** on **World Chain Sepolia (4801)** in MetaMask (or the injected wallet).
3. **Fund** the **same** account with **native test ETH on 4801** (not only L1 Sepolia; bridge or faucet that credits **chain 4801**).
4. **Submit to Blockchain** — the app will call `storeContent` and wait for a receipt, then read `ContentStored` for the entry id.

**Explorers in embedded browsers** (e.g. some in-app webviews) may not open; copy the **Worldscan** URL from the status area into Safari/Chrome if needed.

---

## Gas on World Chain (OP Stack)

- Fees include **L2 execution** and an **L1 data fee** (calldata to Ethereum). That is why “simple” L2 `gas × price` math in your head can look smaller than what MetaMask reserves as **max**.
- The client uses **estimates**, **EIP-1559 fee fields** when available, and conservative checks so failed preflights and misleading “always zero balance” copy are reduced—**always trust your wallet** on the final **have / want** numbers.

---

## Troubleshooting

| Symptom | What to check |
|--------|----------------|
| `REACT_APP_*` not applied | Restart dev server, hard-refresh. CRA reads env at compile time. |
| `INSUFFICIENT_FUNDS` / no MetaMask popup | Same **chain** in MetaMask (**4801**), enough **ETH on 4801**, and not a duplicate `contentHash` / `humanSignatureHash`. |
| `Content already exists` / signature reuse | You must **change the text** (new content) and run **Generate Local Signature** again. |
| Explorer / link doesn’t open in-app | Open the copied URL in a normal **desktop/mobile browser** outside the in-app view. |
| `Bad data` / no bytecode at address | Wrong network or **wrong** `REACT_APP_CONTRACT_ADDRESS` for that network. |
| World ID / Radix console noise | A11y warnings from IdKit/Radix are common in dev; not necessarily wallet failures. |

---

## References

- [World Chain / World ID docs](https://docs.world.org) — app IDs, network details, and best practices.
- [Worldscan (Sepolia)](https://sepolia.worldscan.org) — testnet blocks and transactions.
- OP Stack: **L1 data fee** + L2 execution in transaction cost (see Optimism/OP docs for the mental model).

---

*This file is maintained for the Human Inkwell (POHC) subproject. Contract addresses and app IDs in your deployment may differ; always use your own `.env` and on-chain verification of deployments.*
