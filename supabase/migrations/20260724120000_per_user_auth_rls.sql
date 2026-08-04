-- 20260724120000_per_user_auth_rls.sql
--
-- Move the extension's writing_sessions + paste_events from an open, shared-anon-key
-- model to real per-user ownership backed by Supabase Auth (Sign in with Google).
--
-- WHY: previously every policy was `using(true)/with check(true)` for the anon role,
-- and the anon key ships inside the extension. That meant anyone could read EVERY
-- user's sessions and pastes (paste_events.content holds raw clipboard text) and
-- spoof any author. For a university-scale rollout each student's data must be
-- private to them and their stats must be a clean "my rows" query.
--
-- WHAT: add author_id (auth.users FK), then replace the open anon policies with
-- authenticated-only, own-rows-only policies keyed on auth.uid(). The extension now
-- signs in with Google, exchanges the Google ID token for a Supabase session, and
-- sends that per-user JWT on every write — so PostgREST runs as `authenticated` and
-- these policies isolate each user's data.
--
-- SAFE FOR THE WEB APP: /publish and feed writes go through the Vercel serverless
-- functions using the service-role key (which bypasses RLS), and the browser app
-- does not read these two tables directly with the anon key. Dropping the anon
-- policies here only affects direct-from-extension access, which is being upgraded
-- to per-user auth in the same release.
--
-- ROLLOUT ORDER (see RUNBOOK-university-auth.md):
--   1. Configure the Supabase Google provider + authorized client IDs.
--   2. Ship the new extension version (Supabase-session auth).
--   3. Apply this migration. Old anon-only clients stop writing at that point, so
--      run it once the updated extension is the published version.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- writing_sessions
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.writing_sessions
  add column if not exists author_id uuid references auth.users(id) on delete cascade;

create index if not exists writing_sessions_author_id_idx
  on public.writing_sessions (author_id)
  where author_id is not null;

-- The core stats query: one user's history for one doc, ordered in time.
create index if not exists writing_sessions_author_doc_idx
  on public.writing_sessions (author_id, doc_id, started_at);

-- Drop the open anon policies (the breach vector).
drop policy if exists "writing_sessions_select_anon" on public.writing_sessions;
drop policy if exists "writing_sessions_insert_anon" on public.writing_sessions;
drop policy if exists "writing_sessions_update_anon" on public.writing_sessions;

-- Own-rows-only for authenticated users.
drop policy if exists "writing_sessions_select_own" on public.writing_sessions;
create policy "writing_sessions_select_own"
  on public.writing_sessions for select to authenticated
  using (author_id = auth.uid());

drop policy if exists "writing_sessions_insert_own" on public.writing_sessions;
create policy "writing_sessions_insert_own"
  on public.writing_sessions for insert to authenticated
  with check (author_id = auth.uid());

drop policy if exists "writing_sessions_update_own" on public.writing_sessions;
create policy "writing_sessions_update_own"
  on public.writing_sessions for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

drop policy if exists "writing_sessions_delete_own" on public.writing_sessions;
create policy "writing_sessions_delete_own"
  on public.writing_sessions for delete to authenticated
  using (author_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- paste_events
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.paste_events
  add column if not exists author_id uuid references auth.users(id) on delete cascade;

create index if not exists paste_events_author_id_idx
  on public.paste_events (author_id)
  where author_id is not null;

create index if not exists paste_events_author_doc_idx
  on public.paste_events (author_id, doc_id, pasted_at);

drop policy if exists "paste_events_select_anon" on public.paste_events;
drop policy if exists "paste_events_insert_anon" on public.paste_events;

drop policy if exists "paste_events_select_own" on public.paste_events;
create policy "paste_events_select_own"
  on public.paste_events for select to authenticated
  using (author_id = auth.uid());

drop policy if exists "paste_events_insert_own" on public.paste_events;
create policy "paste_events_insert_own"
  on public.paste_events for insert to authenticated
  with check (author_id = auth.uid());

drop policy if exists "paste_events_delete_own" on public.paste_events;
create policy "paste_events_delete_own"
  on public.paste_events for delete to authenticated
  using (author_id = auth.uid());

commit;

-- Existing rows keep author_id = NULL (captured before per-user auth). They are no
-- longer readable by the anon key and are not attributed to any user; the
-- service-role /api/delete-my-data path can still purge them by author_email/doc_id.
