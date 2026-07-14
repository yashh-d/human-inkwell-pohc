-- Human Ink — creator profiles need to read ALL of a creator's posts, including
-- ones not featured on the public HI Feed (is_public = false). Every creator
-- publish is recorded in creator_posts as the writer's body of work; is_public
-- only controls whether it also appears on the public feed.
--
-- These rows are all summaries of ON-CHAIN, public writing proofs (content hash,
-- score, title the creator authored for sharing), so opening anon reads to every
-- row is acceptable — the /feed query still filters is_public = true itself, and
-- the /me profile query filters by author_address. Revisit with wallet-scoped
-- reads if a truly-private draft state is introduced.

drop policy if exists "creator_posts_select_public" on public.creator_posts;
drop policy if exists "creator_posts_select_anon" on public.creator_posts;
create policy "creator_posts_select_anon"
  on public.creator_posts for select to anon using (true);
