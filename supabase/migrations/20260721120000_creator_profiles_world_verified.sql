-- Optional "verified human" badge for creators.
--
-- Per the frictionless creator flow (2026-07-21): creators sign up with Privy
-- alone (no World ID wall). World ID becomes an OPT-IN badge they can add later
-- from their profile. This column records whether they've claimed it.
alter table public.creator_profiles
  add column if not exists world_verified boolean not null default false;
