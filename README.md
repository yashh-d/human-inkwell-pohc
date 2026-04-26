# Human Inkwell (POHC)

Keystroke biometrics, optional [World ID](https://world.org/world-id), and onchain storage on **World Chain Sepolia** via `HumanContentLedger`.

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
2. **Root Directory — pick one (do not mix with `cd client` in custom commands):**
   - **Option A (recommended, smaller uploads):** set **Root Directory** to **`client`**. Then **clear** any custom **Install** / **Build** commands in Project Settings that use `cd client` — the app root is already `client/`, so `cd client` will fail. The repo’s [`client/vercel.json`](./client/vercel.json) sets `installCommand: npm install`, `buildCommand: CI= npm run build`, and `outputDirectory: build`.
   - **Option B (deploy from monorepo root):** leave **Root Directory** empty. Use the repo root [`vercel.json`](./vercel.json) (`cd client && npm install`, output `client/build`). Ignore `.vercelignore` still applies.
3. **Framework preset:** “Create React App” (Vercel should auto-detect from `client/package.json`). `CI= npm run build` avoids failing the build on ESLint warnings.
4. **Environment variables:** in Vercel → Project → Settings → Environment Variables, add every `REACT_APP_*` from [`client/.env.local.example`](./client/.env.local.example) (your real `REACT_APP_WORLD_APP_ID`, `REACT_APP_CONTRACT_ADDRESS`, etc.). **You must also add `RELAYER_PRIVATE_KEY`**, which should be the private key of the wallet you are funding to act as the backend gas paymaster for your users. **Without** `REACT_APP_WORLD_APP_ID`, World ID cannot work on the live site.
5. **World App error “couldn’t find the request”:** in the [World Developer Portal](https://developer.worldcoin.org), open your app and set **App URL / allowed domains** to your real Vercel URL (for example `https://<your-slug>.vercel.app` or a custom domain). The **action** in Vercel must match the action you registered for that app. See [HUMAN-INKWELL.md § Vercel + World](HUMAN-INKWELL.md#vercel-world-app-and-idkit-production).
6. **Deploy.** Re-deploy when you change env (CRA bakes `REACT_APP_*` at build time).

**CLI (optional, from `client` only so uploads stay small):**

```bash
cd client
npx vercel --prod
```

If the build logs show `sh: line 1: cd: client: No such file or directory`, you set **Root Directory = `client`** but Vercel still had an **Install** command of `cd client && npm install`. Remove that (use **Option A** or **B** above).

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
