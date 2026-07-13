-- Human Ink — Creator edition data layer (the public creator feed).
--
-- Two tables, both anchored to the existing on-chain index (`ledger_submissions`):
--   • creator_profiles — a creator's public identity (handle, name, bio, socials).
--   • creator_posts    — one opted-in published piece on the public feed, carrying
--                        the Grind Score / AI-slop summary that is computed
--                        client-side and therefore isn't on-chain or in
--                        ledger_submissions.
--
-- METRICS + OPT-IN CONTENT ONLY. A post never stores the writer's typed text; the
-- optional `excerpt` is a short, creator-authored preview (the full public body,
-- if any, still lives in ledger_submissions.public_text, hash-verified). Same rule
-- as the rest of the schema: counts and summaries, not raw keystrokes.
--
-- Trust: a post is only meaningful next to a verified on-chain attestation, so the
-- write API (api/creator-post.js) requires a matching, already-verified
-- ledger_submissions row (chain_id, contract_address, entry_id, content_hash)
-- before inserting. The row here is the display/summary layer over that proof.

-- Shared updated_at bumper (idempotent; reused by both tables below).
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- creator_profiles
-- ---------------------------------------------------------------------------
create table if not exists public.creator_profiles (
  id uuid primary key default gen_random_uuid(),

  wallet_address text not null unique,   -- on-chain author (lowercase); links posts
  handle text unique,                    -- URL slug for /c/<handle> (nullable until claimed)
  display_name text,
  bio text,
  avatar_url text,
  links jsonb not null default '{}'::jsonb,   -- { substack, twitter, site, ... }

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists creator_profiles_handle_idx
  on public.creator_profiles (handle)
  where handle is not null;

comment on table public.creator_profiles is
  'Public creator identity for the Human Ink feed. Keyed by on-chain wallet_address.';

drop trigger if exists creator_profiles_touch on public.creator_profiles;
create trigger creator_profiles_touch
  before update on public.creator_profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- creator_posts
-- ---------------------------------------------------------------------------
create table if not exists public.creator_posts (
  id uuid primary key default gen_random_uuid(),

  -- Link to the on-chain attestation (mirror of ledger_submissions' identity).
  chain_id integer not null,
  contract_address text not null,
  entry_id bigint not null check (entry_id > 0),
  transaction_hash text not null,
  content_hash text not null,
  author_address text not null,          -- lowercase; = creator_profiles.wallet_address

  -- Display.
  title text,
  excerpt text,                          -- optional creator-authored preview

  -- Score summary (computed client-side; 0–100). Persisted so the feed + badge
  -- can show them without recomputing from the full proof.
  grind_score smallint check (grind_score between 0 and 100),
  ai_slop smallint check (ai_slop between 0 and 100),
  human_pct smallint check (human_pct between 0 and 100),
  tier text,

  -- Vanity counters shown on the card.
  word_count integer not null default 0 check (word_count >= 0),
  revisions integer not null default 0 check (revisions >= 0),
  edit_days integer not null default 0 check (edit_days >= 0),
  minutes integer not null default 0 check (minutes >= 0),

  is_public boolean not null default true,   -- opt-in; the feed only shows true
  published_at timestamptz not null default now(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (chain_id, contract_address, entry_id)   -- one post per on-chain entry
);

create index if not exists creator_posts_feed_idx
  on public.creator_posts (published_at desc)
  where is_public;
create index if not exists creator_posts_author_idx
  on public.creator_posts (author_address);

comment on table public.creator_posts is
  'Opted-in creator feed items. Summary/display layer over a verified ledger_submissions attestation; never stores typed text.';

drop trigger if exists creator_posts_touch on public.creator_posts;
create trigger creator_posts_touch
  before update on public.creator_posts
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — same anon-key model as ledger_submissions / paste_events. Writes are
-- application-guarded in the API (requires a verified on-chain row). Feed reads
-- are restricted to PUBLIC posts so opted-out rows aren't exposed via PostgREST.
-- ---------------------------------------------------------------------------
alter table public.creator_profiles enable row level security;
alter table public.creator_posts enable row level security;

drop policy if exists "creator_profiles_select_anon" on public.creator_profiles;
create policy "creator_profiles_select_anon"
  on public.creator_profiles for select to anon using (true);

drop policy if exists "creator_profiles_insert_anon" on public.creator_profiles;
create policy "creator_profiles_insert_anon"
  on public.creator_profiles for insert to anon with check (true);

drop policy if exists "creator_profiles_update_anon" on public.creator_profiles;
create policy "creator_profiles_update_anon"
  on public.creator_profiles for update to anon using (true) with check (true);

drop policy if exists "creator_posts_select_public" on public.creator_posts;
create policy "creator_posts_select_public"
  on public.creator_posts for select to anon using (is_public = true);

drop policy if exists "creator_posts_insert_anon" on public.creator_posts;
create policy "creator_posts_insert_anon"
  on public.creator_posts for insert to anon with check (true);
