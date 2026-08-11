-- COPY-ME: push_send_dedupe (event_key + token)
-- Run in Supabase SQL editor (wbskjfdqpugnwvrykqcn) if you want durable
-- cross-instance dedupe for alzidan-push-notify.
-- Safe/additive. Edge function also keeps an in-memory fallback.

create table if not exists public.push_send_dedupe (
  event_key text not null,
  token text not null,
  created_at timestamptz not null default now(),
  primary key (event_key, token)
);

comment on table public.push_send_dedupe is
  'Prevents duplicate Expo push for the same event_key + device token.';

create index if not exists push_send_dedupe_created_at_idx
  on public.push_send_dedupe (created_at);

alter table public.push_send_dedupe enable row level security;

-- Service role (edge function) bypasses RLS. No anon policies needed.
revoke all on table public.push_send_dedupe from anon, authenticated;

-- Optional cleanup helper (keep ~7 days):
-- delete from public.push_send_dedupe where created_at < now() - interval '7 days';
