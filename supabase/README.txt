Human Inkwell — database (Supabase Postgres only)

1) Run migrations in order in Supabase Dashboard → SQL (or: supabase db push):
   - supabase/migrations/20260426120000_create_ledger_submissions.sql
   - supabase/migrations/20260427120000_ledger_rls_for_anon_key.sql  (RLS policies for anon key)

2) The app does NOT use Supabase Edge Functions. In-repo Vercel API routes in client/api/:
   - GET  /api/debug-supabase  — which env names resolve + test query to ledger_submissions (no secrets)
   - POST /api/ledger-onchain  — insert after on-chain verify (preferred)
   - POST /api/ledger          — insert (wallet-signed, legacy)
   - POST /api/my-ledger       — list for one wallet (wallet-signed)

3) Vercel → Project → Environment variables:
   REACT_APP_SUPABASE_URL=https://xxxx.supabase.co
   REACT_APP_SUPABASE_ANON_KEY=eyJ...  (Settings → API → anon public; used by /api/*)

4) Local: from client/ run `vercel dev` so /api/* routes are served with env loaded.
   Plain `npm start` (CRA) does not run those routes; optional: REACT_APP_API_BASE=https://<preview>.vercel.app

5) CORS: API sets Access-Control-Allow-Origin: *; tighten in production if needed.
