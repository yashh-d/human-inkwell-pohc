-- Human Inkwell: cross-device draft storage. Keyed by wallet address so the same
-- in-progress piece can be resumed from another browser before it's posted onchain.
-- Once a draft is published, the corresponding row in ledger_submissions is the source
-- of truth and the draft row is deleted by the API.

create table if not exists public.content_drafts (
  id uuid primary key default gen_random_uuid(),

  author_address text not null,
  draft_key text not null default 'default',

  title text not null default '',
  content text not null default '',
  content_type text not null default 'short'
    check (content_type in ('short', 'long')),

  keystroke_events jsonb not null default '[]'::jsonb,
  pause_windows jsonb not null default '[]'::jsonb,
  session_started_at bigint not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (author_address, draft_key)
);

create index if not exists content_drafts_author_idx
  on public.content_drafts (author_address);
create index if not exists content_drafts_updated_idx
  on public.content_drafts (updated_at desc);

comment on table public.content_drafts is
  'In-progress writing keyed by wallet. Wallet-signed reads/writes via /api/drafts-*.';

alter table public.content_drafts enable row level security;

-- Mirrors the policy approach used by ledger_submissions: the anon key is used by
-- our Vercel serverless routes which gate access with a wallet-signed message.
create policy "content_drafts_select_anon"
  on public.content_drafts
  for select
  to anon
  using (true);

create policy "content_drafts_insert_anon"
  on public.content_drafts
  for insert
  to anon
  with check (true);

create policy "content_drafts_update_anon"
  on public.content_drafts
  for update
  to anon
  using (true)
  with check (true);

create policy "content_drafts_delete_anon"
  on public.content_drafts
  for delete
  to anon
  using (true);
