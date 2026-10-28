-- Close the anon read on writing_sessions.
--
-- The 20260724 per-user-auth migration dropped "writing_sessions_select_anon" — but
-- the policy actually live in production was created in the dashboard under a
-- DIFFERENT name, "anon read writing_sessions", so that drop was a silent no-op and
-- the hole survived. The public extension anon key could read EVERY row (789 on
-- 2026-10-27), including author_email, doc_title and the Google Doc url — student
-- PII (FERPA). Lesson: the dashboard, not the migrations, has been the source of
-- truth for RLS on this project; always verify live policy names via pg_policies.
--
-- Nothing depends on the anon read: the extension sends the user's own bearer token
-- (served by writing_sessions_select_own) and the professor view uses the service
-- role. Both names are dropped so this is correct whichever one a given DB carries.
--
-- Probe (read-only): a `content-range` row count with the anon key means still open.
--   curl -s -I -H "apikey: <anon>" -H "Prefer: count=exact" -H "Range: 0-0" \
--     "https://<ref>.supabase.co/rest/v1/writing_sessions?select=session_id"

drop policy if exists "anon read writing_sessions" on public.writing_sessions;
drop policy if exists "writing_sessions_select_anon" on public.writing_sessions;
