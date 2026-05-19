-- Add title + content_type to support long-form vs short-form distinction.
-- Short-form: no title allowed. Long-form: optional title.
-- Existing rows default to 'short' (the historical behavior — no titles).

alter table public.ledger_submissions
  add column if not exists title text,
  add column if not exists content_type text not null default 'short'
    check (content_type in ('short', 'long'));

-- Enforce: short-form rows cannot carry a title.
alter table public.ledger_submissions
  drop constraint if exists ledger_submissions_title_only_for_long;
alter table public.ledger_submissions
  add constraint ledger_submissions_title_only_for_long
  check (content_type = 'long' or title is null);

-- Optional length guardrail on title.
alter table public.ledger_submissions
  drop constraint if exists ledger_submissions_title_length;
alter table public.ledger_submissions
  add constraint ledger_submissions_title_length
  check (title is null or char_length(title) between 1 and 200);

comment on column public.ledger_submissions.title is
  'Optional title. Only allowed when content_type = ''long''. Max 200 chars.';
comment on column public.ledger_submissions.content_type is
  'Either ''short'' (tweet-like, no title) or ''long'' (article-like, optional title).';
