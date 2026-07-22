-- Human Ink: captured paste events, WITH the pasted text, so a professor can tell
-- legitimate quotes from AI output a student pasted and lightly reworded.
--
-- IMPORTANT — this DOES store content the user pasted in (capped per row). It does
-- NOT store the user's own typed text (that stays a hash in writing_sessions).
-- Pasted content is sensitive (clipboard data, possibly PII / copyrighted / student
-- data → FERPA). Treat accordingly: consent, retention limits, restricted reads.

create table if not exists public.paste_events (
  id uuid primary key default gen_random_uuid(),

  session_id text not null,             -- links to writing_sessions.session_id
  doc_id text not null,                 -- Google Doc id
  author_email text,                    -- best-effort, from the signed-in account
  doc_title text,

  pasted_at timestamptz not null default now(),
  char_count integer not null default 0 check (char_count >= 0),
  is_large boolean not null default false,   -- >= the extension's large-paste threshold
  truncated boolean not null default false,  -- content was longer than the per-row cap
  content text,                              -- the pasted text (capped client-side)

  created_at timestamptz not null default now()
);

create index if not exists paste_events_doc_idx on public.paste_events (doc_id);
create index if not exists paste_events_session_idx on public.paste_events (session_id);
create index if not exists paste_events_doc_time_idx on public.paste_events (doc_id, pasted_at);

comment on table public.paste_events is
  'Pasted-text captures for quote-vs-AI analysis. Stores pasted CONTENT (capped); never the user''s typed text. Sensitive — gate reads, set retention.';

alter table public.paste_events enable row level security;

drop policy if exists "paste_events_select_anon" on public.paste_events;
create policy "paste_events_select_anon"
  on public.paste_events for select to anon using (true);

drop policy if exists "paste_events_insert_anon" on public.paste_events;
create policy "paste_events_insert_anon"
  on public.paste_events for insert to anon with check (true);
