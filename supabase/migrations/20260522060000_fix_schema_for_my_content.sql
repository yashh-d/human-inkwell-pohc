-- Live-fix migration (run this in Supabase Dashboard → SQL Editor).
--
-- Two issues we discovered probing the deployed Supabase:
--   1. ledger_submissions is missing public_text — the earlier
--      `20260428120000_ledger_public_text.sql` migration was never applied
--      to the live project, so every SELECT that included public_text 500'd.
--   2. The shared Supabase project already had a `content_drafts` table from
--      a different app (with columns like platform / hook_score / voice_profile).
--      Our `20260520120000_create_content_drafts.sql` used `if not exists` so
--      it noop'd against that pre-existing table. We rename our own table to
--      `hi_content_drafts` to avoid the collision.
--
-- Safe to run more than once — every statement uses `if not exists` or
-- `if exists` / `add column if not exists`.

-- ─── 1. ledger_submissions.public_text ─────────────────────────────────
alter table public.ledger_submissions
  add column if not exists public_text text;

-- (Optional) For convenience: index for "has text" lookups in the feed.
-- The feed already filters on is_verified; this is just a hint.

-- ─── 2. hi_content_drafts (renamed from content_drafts) ────────────────
create table if not exists public.hi_content_drafts (
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

create index if not exists hi_content_drafts_author_idx
  on public.hi_content_drafts (author_address);
create index if not exists hi_content_drafts_updated_idx
  on public.hi_content_drafts (updated_at desc);

comment on table public.hi_content_drafts is
  'Human Inkwell in-progress writing keyed by wallet. Wallet-signed reads/writes via /api/drafts-*. Renamed from content_drafts to avoid collision with another app sharing this Supabase project.';

alter table public.hi_content_drafts enable row level security;

drop policy if exists "hi_content_drafts_select_anon" on public.hi_content_drafts;
create policy "hi_content_drafts_select_anon"
  on public.hi_content_drafts
  for select
  to anon
  using (true);

drop policy if exists "hi_content_drafts_insert_anon" on public.hi_content_drafts;
create policy "hi_content_drafts_insert_anon"
  on public.hi_content_drafts
  for insert
  to anon
  with check (true);

drop policy if exists "hi_content_drafts_update_anon" on public.hi_content_drafts;
create policy "hi_content_drafts_update_anon"
  on public.hi_content_drafts
  for update
  to anon
  using (true)
  with check (true);

drop policy if exists "hi_content_drafts_delete_anon" on public.hi_content_drafts;
create policy "hi_content_drafts_delete_anon"
  on public.hi_content_drafts
  for delete
  to anon
  using (true);
