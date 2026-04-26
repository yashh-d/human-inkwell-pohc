Human Inkwell — database (Supabase Postgres only)

1) supabase/migrations/20260426120000_create_ledger_submissions.sql
   → Run in Supabase Dashboard → SQL (or: supabase db push)

2) The app does NOT use Supabase Edge Functions. In-repo Vercel API routes in client/api/:
   - POST /api/ledger      — insert (wallet-signed)
   - POST /api/my-ledger   — list for one wallet (wallet-signed)

3) Vercel → Project → Environment variables (for serverless only, not REACT_APP_):
   SUPABASE_URL=https://xxxx.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=eyJ...  (from Settings → API → service_role — never in client bundle)

4) Local: from client/ run `vercel dev` so /api/ledger and /api/my-ledger are served with env loaded.
   Plain `npm start` (CRA) does not run those routes; optional: REACT_APP_API_BASE=https://<preview>.vercel.app

5) CORS: API sets Access-Control-Allow-Origin: *; tighten in production if needed.
