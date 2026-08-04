-- 20260803150000_professor_username_accounts.sql
--
-- Professor accounts are self-identified, NOT keyed off whatever email a
-- professor happens to log in with. Each professor owns a stable `username`
-- (their durable login handle) + a password (held in Supabase Auth). Their real
-- email is optional: it can be linked later purely for one-click "easy login"
-- (magic link / Google), and it never becomes the identity.
--
-- How this maps onto the existing `profiles` table:
--   • username        — the durable, human-chosen login handle (unique among
--                        professors). This is the identity, not email.
--   • email (existing) — now holds the account's Supabase Auth login address.
--                        For a username account that is a SYNTHETIC internal
--                        address (<username>@prof.humanink.app); when the
--                        professor links a real email it is recorded here too.
--                        Kept NOT NULL by the original schema, so we always
--                        write the synthetic address on create.
--   • user_id (existing) — the linked Supabase Auth user. Now the PRIMARY way we
--                        resolve a professor (see api/_accounts.js), so identity
--                        no longer depends on email matching.

begin;

alter table public.profiles
  add column if not exists username text;

-- The professor's OPTIONAL real email, shown in the UI and used only to offer
-- "easy login" later. Separate from `email`, which for a username account holds
-- the synthetic internal login address (<username>@prof.humanink.app) and is
-- never surfaced. NULL until the professor chooses to link one.
alter table public.profiles
  add column if not exists linked_email text;

-- Unique per professor (case-insensitive). Students have no username, so the
-- partial index only constrains professor rows.
create unique index if not exists profiles_professor_username_key
  on public.profiles (lower(username))
  where role = 'professor' and username is not null;

comment on column public.profiles.username is
  'Durable professor login handle. Identity is (user_id / username), never the email — email is optional and linkable later.';
comment on column public.profiles.linked_email is
  'Optional real email a professor links for one-click login. Distinct from the synthetic Supabase Auth login address in `email`.';

commit;
