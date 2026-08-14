-- Occasion Interaction engine v1
-- Private family interactions on occasions (NOT public comments).
-- Apply once via Admin SQL workspace / Supabase SQL editor.
--
-- Flow: occasion → recipients (people) → catalog by family/type → member interaction → recipient inbox only.

create table if not exists public.occasion_interaction_types (
  id bigserial primary key,
  key text not null unique,
  family text not null,
  applies_to_types text[] not null default '{}',
  track text null,
  label text not null,
  full_text text not null,
  allows_message boolean not null default false,
  sort_order int not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.occasion_interaction_types is
  'Catalog of occasion interaction templates; expandable without code deploys.';
comment on column public.occasion_interaction_types.track is
  'Optional lane: deceased | bereaved (death), before | after (hajj), etc.';

create table if not exists public.occasion_recipients (
  id bigserial primary key,
  occasion_id bigint not null references public.family_events(id) on delete cascade,
  recipient_role text not null default 'honoree',
  recipient_name text not null,
  recipient_person_id uuid null,
  recipient_phone text null,
  recipient_member_id bigint null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists occasion_recipients_occasion_idx
  on public.occasion_recipients (occasion_id);
create index if not exists occasion_recipients_phone_idx
  on public.occasion_recipients (recipient_phone)
  where recipient_phone is not null;
create index if not exists occasion_recipients_person_idx
  on public.occasion_recipients (recipient_person_id)
  where recipient_person_id is not null;

create table if not exists public.occasion_interactions (
  id bigserial primary key,
  occasion_id bigint not null references public.family_events(id) on delete cascade,
  interaction_type_key text not null references public.occasion_interaction_types(key),
  sender_phone text not null,
  sender_name text null,
  sender_member_id bigint null,
  recipient_id bigint null references public.occasion_recipients(id) on delete set null,
  message text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One interaction per sender per occasion (can change type/message via upsert).
create unique index if not exists occasion_interactions_sender_once_idx
  on public.occasion_interactions (occasion_id, sender_phone);

create index if not exists occasion_interactions_recipient_idx
  on public.occasion_interactions (recipient_id);
create index if not exists occasion_interactions_occasion_idx
  on public.occasion_interactions (occasion_id);

-- RLS: catalog readable; interactions/recipients NEVER publicly readable.
alter table public.occasion_interaction_types enable row level security;
alter table public.occasion_recipients enable row level security;
alter table public.occasion_interactions enable row level security;

drop policy if exists occasion_interaction_types_public_select on public.occasion_interaction_types;
create policy occasion_interaction_types_public_select
  on public.occasion_interaction_types
  for select to anon, authenticated
  using (is_active = true);

grant select on table public.occasion_interaction_types to anon, authenticated;
revoke insert, update, delete, truncate on table public.occasion_interaction_types from anon, authenticated;

revoke all on table public.occasion_recipients from anon, authenticated;
revoke all on table public.occasion_interactions from anon, authenticated;

-- ---------- helpers ----------
