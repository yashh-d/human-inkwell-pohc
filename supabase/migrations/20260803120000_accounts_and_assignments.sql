-- 20260803120000_accounts_and_assignments.sql
--
-- The "spine": durable accounts (student + professor), the school -> professor ->
-- assignment directory, and server-stored submissions that carry a public SUMMARY
-- (process score + AI score + band) plus a professor-only DETAIL blob.
--
-- WHY: today a proof lives entirely in the /publish URL fragment, so anyone with
-- the link sees the full breakdown. Professors need a dashboard (assignments ->
-- roster -> per-student score) and the detailed view must be gated to professors
-- while students/public see only the summary. That requires the submission to
-- live server-side, keyed to accounts and (optionally) an assignment.
--
-- ACCESS MODEL: these tables are locked down at the RLS layer — NO anon or
-- authenticated policies for reads/writes of submissions. Every read/write goes
-- through the Vercel serverless routes using the service-role key (which bypasses
-- RLS), and those routes decide summary-vs-detail based on the caller's role.
-- The directory (schools/professors/assignments) is the one thing students may
-- browse, and it is exposed only through a read API that selects safe columns.
--
-- IDENTITY:
--   • Professors authenticate on the WEB via Supabase Auth (Google OR email magic
--     link). They are pre-seeded manually as a profiles row (role='professor')
--     keyed by email, with user_id NULL until their first login links it.
--   • Students never log into the web app. The Chrome extension stamps the
--     student's Google email into the proof payload; on publish the server
--     upserts a profiles row (role='student') by that email. The on-chain wallet
--     remains the authorship anchor.

begin;

-- Reuse the shared updated_at bumper if a prior migration already defined it.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Short, unambiguous codes for join_code / share_slug (no 0/O/1/I/L).
create or replace function public.gen_code(len integer default 8)
returns text language plpgsql as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  out text := '';
  i integer;
begin
  for i in 1..len loop
    out := out || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return out;
end;
$$;

-- ---------------------------------------------------------------------------
-- schools
-- ---------------------------------------------------------------------------
create table if not exists public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text,                         -- optional email domain hint (e.g. nyu.edu)
  created_at timestamptz not null default now()
);

create unique index if not exists schools_name_key on public.schools (lower(name));

comment on table public.schools is
  'Institutions students pick from when submitting. Seeded manually alongside professors.';

-- ---------------------------------------------------------------------------
-- profiles — one row per person (student or professor)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),

  -- Linked Supabase Auth user. NULL for a pre-seeded professor until first login,
  -- and NULL for students (they authenticate only inside the extension, not on
  -- the web app; we identify them by email carried in the proof).
  user_id uuid unique references auth.users(id) on delete set null,

  email text not null,                 -- stored lowercased; the durable identity key
  role text not null check (role in ('student', 'professor')),
  name text,
  school_id uuid references public.schools(id) on delete set null,
  wallet_address text,                 -- student on-chain author (lowercase), best-effort

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Email is the identity key; unique per role so a person could in principle be
-- both a student and (later) a professor without collision.
create unique index if not exists profiles_email_role_key
  on public.profiles (lower(email), role);
create index if not exists profiles_role_idx on public.profiles (role);
create index if not exists profiles_school_idx on public.profiles (school_id) where school_id is not null;

comment on table public.profiles is
  'Durable accounts. Professors pre-seeded by email (user_id linked on first login); students upserted by email on publish.';

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- assignments — a professor's bucket students submit to
-- ---------------------------------------------------------------------------
create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  professor_id uuid not null references public.profiles(id) on delete cascade,
  school_id uuid references public.schools(id) on delete set null,
  title text not null,
  join_code text not null unique default public.gen_code(6),   -- students can enter this directly
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists assignments_professor_idx on public.assignments (professor_id);
create index if not exists assignments_school_idx on public.assignments (school_id) where school_id is not null;

comment on table public.assignments is
  'A professor-owned bucket. join_code lets a student attach a submission without browsing the directory.';

drop trigger if exists assignments_touch on public.assignments;
create trigger assignments_touch
  before update on public.assignments
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- submissions — server-stored proof: public SUMMARY + professor-only DETAIL
-- ---------------------------------------------------------------------------
create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  share_slug text not null unique default public.gen_code(10),  -- the /s/<slug> link

  -- Who submitted (email is the durable key; profile link is best-effort).
  student_email text,
  student_id uuid references public.profiles(id) on delete set null,
  student_name text,

  -- Optional attachment to an assignment. NULL = a standalone "paste-anywhere"
  -- link that shows up in no roster but still opens as a report.
  assignment_id uuid references public.assignments(id) on delete set null,

  -- SUMMARY (safe for anyone with the link). 0–100 + traffic-light band.
  authorship_score smallint check (authorship_score between 0 and 100),
  ai_score smallint check (ai_score between 0 and 100),
  integrity_score smallint check (integrity_score between 0 and 100),
  band text check (band in ('green', 'yellow', 'red')),

  -- DETAIL (professors only). The full ExtensionProof + any precomputed evidence
  -- the report needs (keystroke timeline, paste provenance, receipts). Never
  -- returned to the anon key or to students.
  detail jsonb,

  -- Link back to the on-chain attestation (mirror of ledger_submissions identity).
  chain_id integer,
  contract_address text,
  entry_id bigint,
  content_hash text,
  transaction_hash text,

  published_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists submissions_assignment_idx on public.submissions (assignment_id) where assignment_id is not null;
create index if not exists submissions_student_email_idx on public.submissions (lower(student_email));
create index if not exists submissions_slug_idx on public.submissions (share_slug);

comment on table public.submissions is
  'Server-stored proof. summary columns are link-shareable; detail jsonb is professor-only. All access via service-role API routes.';

-- ---------------------------------------------------------------------------
-- RLS — lock everything to the service role. The anon key (shipped in the
-- extension and the browser bundle) gets NOTHING here; every read/write goes
-- through a Vercel serverless route that uses the service-role key and enforces
-- role-based visibility (summary vs detail). This is the FERPA-safe default.
-- ---------------------------------------------------------------------------
alter table public.schools     enable row level security;
alter table public.profiles    enable row level security;
alter table public.assignments enable row level security;
alter table public.submissions enable row level security;

-- No policies are created on purpose: with RLS enabled and no policy, the anon
-- and authenticated roles are denied by default. The service-role key bypasses
-- RLS, so the API routes still work. (Add narrow authenticated policies later if
-- we ever want direct-from-client reads.)

commit;
