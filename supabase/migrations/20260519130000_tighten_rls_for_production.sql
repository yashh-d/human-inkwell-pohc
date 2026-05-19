-- Production hardening for ledger_submissions:
--   1) Tighten RLS — anon can only read rows intended for the public feed;
--      no anon inserts (all writes go through service-role API routes).
--   2) Enforce lowercase invariants at the DB layer for wallet/contract/tx hex.
--   3) Add a partial index that matches the feed query shape.
--
-- After applying, your Vercel env MUST include SUPABASE_SERVICE_ROLE_KEY for
-- the write/private-read API routes (ledger-onchain, ledger, my-ledger).

-- 1) Drop the wide-open anon policies
drop policy if exists "ledger_submissions_select_anon" on public.ledger_submissions;
drop policy if exists "ledger_submissions_insert_anon" on public.ledger_submissions;

-- 2) Anon can only read rows intended for the public feed
create policy "ledger_submissions_public_feed_read"
  on public.ledger_submissions
  for select
  to anon
  using (is_verified = true and public_text is not null);

-- Service role bypasses RLS automatically; no explicit policies needed for it.

-- 3) Lowercase invariants for hex address / hash columns. Existing rows assumed
--    already lowercase (app code normalizes); rejecting non-conformant data going
--    forward catches direct-DB-write bugs.
alter table public.ledger_submissions
  drop constraint if exists ls_author_lower,
  drop constraint if exists ls_contract_lower,
  drop constraint if exists ls_tx_lower;

alter table public.ledger_submissions
  add constraint ls_author_lower
    check (author_address = lower(author_address)),
  add constraint ls_contract_lower
    check (contract_address = lower(contract_address)),
  add constraint ls_tx_lower
    check (transaction_hash = lower(transaction_hash));

-- 4) Feed-shape partial index: matches `is_verified = true and public_text is not null
--    order by created_at desc limit N` exactly.
create index if not exists ledger_submissions_feed_idx
  on public.ledger_submissions (created_at desc)
  where is_verified = true and public_text is not null;
