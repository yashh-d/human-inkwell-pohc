-- Optional plaintext for the public feed. Integrity: server checks SHA-256(UTF-8) === content_hash.
alter table public.ledger_submissions
  add column if not exists public_text text;

comment on column public.ledger_submissions.public_text is
  'Optional. Shown on public feed when set; must match onchain content hash (verified by API).';
