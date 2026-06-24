-- Human Ink: per-document writing memory. One row per writing session (per page
-- load), keyed by a client-generated session_id so the extension can UPSERT the
-- same row as the session grows. Aggregate by doc_id for a document's full history
-- across days/sessions.
--
-- METRICS ONLY — no raw keystrokes, no document text (same rule as
-- ledger_submissions). We store counts, timing, ratios, and the anonymous proof
-- hashes; never the content itself.

create table if not exists public.writing_sessions (
  id uuid primary key default gen_random_uuid(),

  session_id text not null unique,      -- client-generated per page-load; UPSERT key
  doc_id text not null,                 -- Google Doc id (from /document/d/<id>/)
  author_email text,                    -- best-effort, from the signed-in Google account
  doc_title text,
  url text,

  started_at timestamptz not null,
  ended_at timestamptz not null default now(),
  duration_ms bigint not null default 0 check (duration_ms >= 0),

  keystroke_count integer not null default 0 check (keystroke_count >= 0),
  typed_chars integer not null default 0 check (typed_chars >= 0),
  backspace_count integer not null default 0 check (backspace_count >= 0),
  paste_count integer not null default 0 check (paste_count >= 0),
  pasted_chars integer not null default 0 check (pasted_chars >= 0),
  big_pastes integer not null default 0 check (big_pastes >= 0),
  largest_paste integer not null default 0 check (largest_paste >= 0),
  human_typed_ratio numeric not null default 1,

  content_hash text,
  human_signature_hash text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists writing_sessions_doc_idx
  on public.writing_sessions (doc_id);
create index if not exists writing_sessions_doc_started_idx
  on public.writing_sessions (doc_id, started_at);
create index if not exists writing_sessions_author_idx
  on public.writing_sessions (author_email)
  where author_email is not null;

comment on table public.writing_sessions is
  'Per-document writing memory: one upsertable row per session, metrics only (no raw text/keystrokes). Aggregate by doc_id.';

-- Keep updated_at fresh on every upsert.
create or replace function public.touch_writing_sessions_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists writing_sessions_touch on public.writing_sessions;
create trigger writing_sessions_touch
  before update on public.writing_sessions
  for each row execute function public.touch_writing_sessions_updated_at();

-- RLS: anon insert/select/update for the extension's direct PostgREST writes
-- (same prototype posture as ledger_submissions; metrics-only, no PII beyond an
-- optional email). Tighten later with auth or a service-role API route.
alter table public.writing_sessions enable row level security;

drop policy if exists "writing_sessions_select_anon" on public.writing_sessions;
create policy "writing_sessions_select_anon"
  on public.writing_sessions for select to anon using (true);

drop policy if exists "writing_sessions_insert_anon" on public.writing_sessions;
create policy "writing_sessions_insert_anon"
  on public.writing_sessions for insert to anon with check (true);

drop policy if exists "writing_sessions_update_anon" on public.writing_sessions;
create policy "writing_sessions_update_anon"
  on public.writing_sessions for update to anon using (true) with check (true);
