-- Human Ink — store the written content on a creator's feed post so the HI Feed
-- can show a preview and a full read view. A creator publishes to the feed to
-- SHARE the piece, so storing the body here is intended (unlike the metrics-only
-- ledger tables). Capped in the API. Existing rows just have null content.
alter table public.creator_posts
  add column if not exists content text;

comment on column public.creator_posts.content is
  'The written piece (creator-shared, for the feed read view). API-capped; absent for older rows.';
