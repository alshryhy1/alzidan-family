-- Site support payments (Paymob Intention + Webhook). No secrets in DB.
-- Open this file → Select All → Copy → paste in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.site_support_payments (
  id uuid primary key default gen_random_uuid(),
  amount_halalas integer not null check (amount_halalas > 0),
  currency text not null default 'SAR',
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'failed')),
  paymob_intention_id text,
  paymob_client_secret text,
  paymob_status text,
  special_reference text unique,
  idempotency_key text unique,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz
);

create index if not exists idx_site_support_payments_intention
  on public.site_support_payments (paymob_intention_id);

create index if not exists idx_site_support_payments_status
  on public.site_support_payments (status);

create table if not exists public.site_support_paymob_events (
  id bigserial primary key,
  event_id text not null unique,
  intention_id text,
  status text,
  amount_halalas integer,
  currency text,
  raw jsonb,
  created_at timestamptz not null default now()
);

alter table public.site_support_payments enable row level security;
alter table public.site_support_paymob_events enable row level security;

-- Public: no direct table access. Edge Functions use service role.
drop policy if exists site_support_payments_no_public on public.site_support_payments;
create policy site_support_payments_no_public
  on public.site_support_payments
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists site_support_paymob_events_no_public on public.site_support_paymob_events;
create policy site_support_paymob_events_no_public
  on public.site_support_paymob_events
  for all
  to anon, authenticated
  using (false)
  with check (false);

grant select, insert, update on public.site_support_payments to service_role;
grant select, insert on public.site_support_paymob_events to service_role;
grant usage, select on sequence public.site_support_paymob_events_id_seq to service_role;
