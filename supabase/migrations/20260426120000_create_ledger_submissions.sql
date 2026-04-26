-- Human Inkwell: off-chain index of onchain entries (no raw text / raw biometrics).
-- All hex addresses and tx hashes stored lowercase in application code.

create table if not exists public.ledger_submissions (
  id uuid primary key default gen_random_uuid(),

  chain_id integer not null,
  contract_address text not null,
  entry_id bigint not null
    check (entry_id > 0),
  author_address text not null,
  transaction_hash text not null,

  content_hash text not null,
  human_signature_hash text not null,
  world_id_nullifier text,
  is_verified boolean not null default false,

  keystroke_count integer not null check (keystroke_count >= 0),
  typing_speed_scaled integer not null check (typing_speed_scaled >= 0),

  block_number bigint,
  block_timestamp timestamptz,
  gas_used text,

  created_at timestamptz not null default now(),

  unique (chain_id, contract_address, entry_id),
  unique (chain_id, transaction_hash)
);

create index if not exists ledger_submissions_author_idx
  on public.ledger_submissions (author_address);
create index if not exists ledger_submissions_nullifier_idx
  on public.ledger_submissions (world_id_nullifier)
  where world_id_nullifier is not null;
create index if not exists ledger_submissions_created_idx
  on public.ledger_submissions (created_at desc);

comment on table public.ledger_submissions is
  'Wallet-signed writes via Edge Function only; reads via get-my-ledger Edge only.';

alter table public.ledger_submissions enable row level security;
drop policy if exists "Allow public read" on public.ledger_submissions;
