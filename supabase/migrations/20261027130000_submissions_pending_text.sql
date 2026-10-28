-- Retain the student's text until it has a MODEL AI score, then purge it.
--
-- Before this, text was dropped at storage (privacy). But scoring runs against a
-- scale-to-zero GPU that can cold-start or be briefly down; if that failed, the text
-- was already gone and the submission could never be scored (lost: VJN6JCUGNS). Rule
-- now: never delete a student's work before it is scored.
--
-- pending_text holds the raw essay ONLY until a model result lands, at which point
-- every scoring path sets it back to NULL (see client/api/_scoreSubmission.js). It is
-- service-role only (submissions has RLS enabled with no anon/authenticated policies)
-- and is NEVER returned in any API payload. Normal assignment/FERPA deletion still
-- removes the whole row, so retention is bounded by the existing lifecycle.
alter table public.submissions add column if not exists pending_text text;

-- Fast lookup for the safety-net sweep: rows still holding text to score.
create index if not exists submissions_pending_text_idx
  on public.submissions (published_at)
  where pending_text is not null;
