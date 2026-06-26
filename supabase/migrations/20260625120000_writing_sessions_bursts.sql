-- Bursts + active time: give Supabase the full server-side look that the local
-- per-doc rollup already keeps. active_ms is real writing time (burst spans,
-- excluding idle); the *_edits counts summarize the edit timeline; timeline is the
-- compact burst/paste sequence (metadata only: { type, chars, origin } — no text).

alter table public.writing_sessions
  add column if not exists active_ms  bigint  not null default 0 check (active_ms >= 0),
  add column if not exists edit_count  integer not null default 0 check (edit_count >= 0),
  add column if not exists typed_edits integer not null default 0 check (typed_edits >= 0),
  add column if not exists paste_edits integer not null default 0 check (paste_edits >= 0),
  add column if not exists timeline    jsonb;
