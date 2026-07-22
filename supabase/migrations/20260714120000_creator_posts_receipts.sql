-- Human Ink — creator "receipts" on each feed/profile post (spec: receipts, not
-- scores). Descriptive stats about how the piece was made, shown on the Craft
-- Card, the feed, and the profile. Additive; older rows just have nulls.
--
-- We keep the existing grind_score/ai_slop columns in place (still written by the
-- academic/report path) but the creator surfaces read these receipt columns.
alter table public.creator_posts
  add column if not exists active_seconds integer,
  add column if not exists sessions integer,
  add column if not exists keystrokes integer,
  add column if not exists words_typed integer,
  add column if not exists words_published integer,
  add column if not exists kill_ratio numeric,
  add column if not exists wpm integer,
  add column if not exists wpm_series jsonb;

comment on column public.creator_posts.kill_ratio is
  'words_typed / words_published (>=1 means the writer cut). The headline receipt.';
comment on column public.creator_posts.wpm_series is
  'Downsampled typing-cadence series for the Craft Card sparkline.';
