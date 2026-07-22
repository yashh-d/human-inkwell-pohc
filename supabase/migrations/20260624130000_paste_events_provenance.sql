-- F1: paste provenance. Tag each paste as an internal move (the writer's own text,
-- cut/copied within the doc), a cited source (quoted), or external (came from
-- outside — the real signal). Only external pastes count against authorship.

alter table public.paste_events
  add column if not exists origin text not null default 'external'
    check (origin in ('internal_move', 'cited_source', 'external')),
  add column if not exists origin_confidence real,
  add column if not exists payload_sha256 text;

create index if not exists paste_events_origin_idx on public.paste_events (doc_id, origin);
