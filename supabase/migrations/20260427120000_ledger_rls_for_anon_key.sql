-- Allow the Supabase anon key (REACT_APP_SUPABASE_ANON_KEY) to read/write
-- `ledger_submissions` from Vercel serverless + optional client use.
-- RLS was enabled with no policies = deny-all; anon could not insert/select before this.
-- Writes are still application-guarded (on-chain verify / wallet signature in API routes).
-- Revisit with stricter policies or service_role if you need to block direct PostgREST access.

create policy "ledger_submissions_select_anon"
  on public.ledger_submissions
  for select
  to anon
  using (true);

create policy "ledger_submissions_insert_anon"
  on public.ledger_submissions
  for insert
  to anon
  with check (true);
