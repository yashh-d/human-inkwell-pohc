# Human Inkwell (POHC)

Keystroke biometrics, optional [World ID](https://world.org/world-id), and on-chain storage on **World Chain Sepolia** via `HumanContentLedger`.

- **Full docs:** [HUMAN-INKWELL.md](./HUMAN-INKWELL.md)
- **Frontend:** `client/` (Create React App)
- **Contracts:** `blockchain/` (Hardhat)

**GitHub (live):** [github.com/yashh-d/human-inkwell-pohc](https://github.com/yashh-d/human-inkwell-pohc)

## GitHub (clone or contribute)

```bash
git clone https://github.com/yashh-d/human-inkwell-pohc.git
cd human-inkwell-pohc
```

## Vercel

1. [Import the GitHub repo](https://vercel.com/new) in Vercel and pick **this** repository.
2. **Root Directory:** set to **`client`** (important — the Create React App lives there; the repo also contains `blockchain/` and a large optional `contract-deployer/` folder you must not deploy as the app).
3. **Framework preset:** “Create React App” (Vercel should auto-detect from `client/package.json`). If the build fails on warnings, the included `client/vercel.json` sets `CI= npm run build` so production builds do not treat ESLint warnings as errors.
4. **Environment variables:** in Vercel → Project → Settings → Environment Variables, add every `REACT_APP_*` from [`client/.env.local.example`](./client/.env.local.example) (your real `REACT_APP_WORLD_APP_ID`, `REACT_APP_CONTRACT_ADDRESS`, etc.).
5. **Deploy.** Re-deploy when you change env or merge to `main`.

**CLI (optional, from `client` only so uploads stay small):**

```bash
cd client
npx vercel --prod
```

A repo-root deploy without setting Root Directory to `client` is **not** recommended here (Vercel would need to pack the full tree; keep `client` as the app root).

## Local

```bash
cd client
cp .env.local.example .env.local
# edit .env.local, then:
npm install
npm start
```

## License

Use and modify for your project; add a license file if you open-source publicly.
