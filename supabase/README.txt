Human Inkwell — Supabase setup
================================

1) supabase/migrations/20260426120000_create_ledger_submissions.sql
   → Run in Supabase Dashboard → SQL (or: supabase db push)

2) Deploy Edge Functions (need Supabase CLI + login):
   supabase functions deploy add-ledger-submission
   supabase functions deploy get-my-ledger

3) Vercel / .env.local (client):
   REACT_APP_SUPABASE_URL
   REACT_APP_SUPABASE_ANON_KEY  (anon key; never put service role in the client)

Service role is only injected server-side in Edge Functions (automatic).

4) CORS: functions allow * for browser invoke; lock down in production if needed.
