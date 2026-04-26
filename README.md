# Human Inkwell (POHC)

Keystroke biometrics, optional [World ID](https://world.org/world-id), and on-chain storage on **World Chain Sepolia** via `HumanContentLedger`.

- **Full docs:** [HUMAN-INKWELL.md](./HUMAN-INKWELL.md)
- **Frontend:** `client/` (Create React App)
- **Contracts:** `blockchain/` (Hardhat)

## GitHub

```bash
cd human-inkwell-pohc
git init
git add -A
git commit -m "Initial commit: Human Inkwell"
gh repo create human-inkwell-pohc --private --source=. --push
# or: create an empty repo on GitHub, then:
# git remote add origin https://github.com/<you>/<repo>.git
# git push -u origin main
```

## Vercel

1. [Import the GitHub repo](https://vercel.com/new) in Vercel.
2. **Root Directory:** leave as repo root (this `vercel.json` builds `client/`).
3. **Environment variables:** add every key from `client/.env.local.example` (use your real `REACT_APP_WORLD_APP_ID` and `REACT_APP_CONTRACT_ADDRESS`).
4. Deploy. The build runs `cd client && CI= npm run build` so ESLint warnings do not fail the production build.

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
