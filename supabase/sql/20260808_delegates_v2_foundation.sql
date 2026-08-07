-- =============================================================================
-- Delegates v2 — Foundation (Phase 2 slice 1)
-- Run once in Supabase SQL Editor (service_role / owner). Safe to re-run.
-- Ref: docs/DELEGATES-V2-PHASE2.md · ENGINEERING-ROADMAP §17 Phase 2
-- =============================================================================

-- Roles catalog
create table if not exists public.delegate_roles (
  role_key text primary key,
  title_ar text not null,
  description_ar text,
  sort_order integer not null default 100,
  created_at timestamptz not null default now()
);

insert into public.delegate_roles (role_key, title_ar, description_ar, sort_order)
values
  ('viewer', 'عرض فقط', 'قراءة ضمن الفرع بلا كتابة', 10),
  ('branch_editor', 'محرر فرع', 'تعديل الشجرة ضمن الفرع المعيَّن', 20),
  ('events_editor', 'محرر مناسبات', 'إدارة مناسبات الفرع', 30),
  ('full_delegate', 'مندوب كامل', 'شجرة + مناسبات ضمن الفرع', 40),
  ('approver_l1', 'معتمد مرحلة 1', 'اعتماد أولي متعدد المراحل (هيكل لاحق)', 50)
on conflict (role_key) do update
set title_ar = excluded.title_ar,
    description_ar = excluded.description_ar,
    sort_order = excluded.sort_order;

-- Operation-type permissions per role
create table if not exists public.delegate_role_permissions (
  role_key text not null references public.delegate_roles (role_key) on delete cascade,
  operation_key text not null,
  allowed boolean not null default true,
  primary key (role_key, operation_key)
);

insert into public.delegate_role_permissions (role_key, operation_key, allowed)
values
  ('viewer', 'tree.read', true),
  ('viewer', 'events.read', true),
  ('branch_editor', 'tree.read', true),
  ('branch_editor', 'tree.write', true),
  ('branch_editor', 'events.read', true),
  ('events_editor', 'events.read', true),
  ('events_editor', 'events.write', true),
  ('events_editor', 'tree.read', true),
  ('full_delegate', 'tree.read', true),
  ('full_delegate', 'tree.write', true),
  ('full_delegate', 'events.read', true),
  ('full_delegate', 'events.write', true),
  ('approver_l1', 'tree.read', true),
  ('approver_l1', 'events.read', true),
  ('approver_l1', 'request.approve_stage1', true)
on conflict (role_key, operation_key) do update
set allowed = excluded.allowed;

-- Canonical delegate profiles (v2)
create table if not exists public.delegates_v2 (
  id uuid primary key default gen_random_uuid(),
  branch_key text not null,
  name text,
  phone text,
  email text,
  secret_hash text,
  role_key text not null default 'branch_editor'
    references public.delegate_roles (role_key),
  is_enabled boolean not null default true,
  tree_request_id text,
  events_request_id text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists delegates_v2_identity_uidx
  on public.delegates_v2 (
    regexp_replace(btrim(coalesce(branch_key, '')), '\s+', ' ', 'g'),
    regexp_replace(btrim(coalesce(phone, '')), '\s+', '', 'g'),
    lower(regexp_replace(btrim(coalesce(email, '')), '\s+', '', 'g'))
  );

create index if not exists delegates_v2_branch_idx on public.delegates_v2 (branch_key);
create index if not exists delegates_v2_enabled_idx on public.delegates_v2 (is_enabled);

-- Multi-stage approval scaffolding (structure only in this slice)
create table if not exists public.delegate_approval_stages (
  id bigserial primary key,
  subject_kind text not null,
  subject_id text not null,
  stage_key text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  actor_delegate_id uuid references public.delegates_v2 (id) on delete set null,
  actor_admin text,
  note text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create index if not exists delegate_approval_stages_subject_idx
  on public.delegate_approval_stages (subject_kind, subject_id);

-- Full audit trail (admin + system actions on delegates / related)
create table if not exists public.admin_audit_log (
  id bigserial primary key,
  actor_type text not null default 'admin',
  actor_ref text,
  action_key text not null,
  entity_type text not null,
  entity_id text,
  branch_key text,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_created_idx
  on public.admin_audit_log (created_at desc);
create index if not exists admin_audit_log_action_idx
  on public.admin_audit_log (action_key);
create index if not exists admin_audit_log_entity_idx
  on public.admin_audit_log (entity_type, entity_id);

-- RLS: deny direct anon; all access via security-definer RPCs
alter table public.delegate_roles enable row level security;
alter table public.delegate_role_permissions enable row level security;
alter table public.delegates_v2 enable row level security;
alter table public.delegate_approval_stages enable row level security;
alter table public.admin_audit_log enable row level security;

revoke all on table public.delegate_roles from anon, authenticated;
revoke all on table public.delegate_role_permissions from anon, authenticated;
revoke all on table public.delegates_v2 from anon, authenticated;
revoke all on table public.delegate_approval_stages from anon, authenticated;
revoke all on table public.admin_audit_log from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
create or replace function public.admin_audit_write_v1(
  p_actor_type text,
  p_actor_ref text,
  p_action_key text,
  p_entity_type text,
  p_entity_id text,
  p_branch_key text,
  p_payload jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  insert into public.admin_audit_log (
    actor_type, actor_ref, action_key, entity_type, entity_id, branch_key, payload
  ) values (
    coalesce(nullif(trim(p_actor_type), ''), 'admin'),
    nullif(trim(p_actor_ref), ''),
    nullif(trim(p_action_key), ''),
    coalesce(nullif(trim(p_entity_type), ''), 'unknown'),
    nullif(trim(p_entity_id), ''),
    nullif(trim(p_branch_key), ''),
    p_payload
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- Infer role from legacy tree/events approval rows
create or replace function public.delegates_v2_infer_role(
  p_tree_status text,
  p_events_status text
)
returns text
language sql
immutable
as $$
  select case
    when coalesce(p_tree_status, '') = 'approved'
         and coalesce(p_events_status, '') = 'approved' then 'full_delegate'
    when coalesce(p_events_status, '') = 'approved'
         and coalesce(p_tree_status, '') <> 'approved' then 'events_editor'
    when coalesce(p_tree_status, '') = 'approved' then 'branch_editor'
    else 'viewer'
  end;
$$;

-- -----------------------------------------------------------------------------
-- Sync from legacy approval_requests (tree_delegate / events_delegate)
-- -----------------------------------------------------------------------------
create or replace function public.admin_delegates_v2_sync_from_requests_v1(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_upserted integer := 0;
  v_row record;
  v_id uuid;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  for v_row in
    with latest as (
      select distinct on (
        regexp_replace(btrim(coalesce(r.branch_key, '')), '\s+', ' ', 'g'),
        regexp_replace(btrim(coalesce(r.phone, '')), '\s+', '', 'g'),
        lower(regexp_replace(btrim(coalesce(r.email, '')), '\s+', '', 'g')),
        r.kind
      )
        r.request_id,
        r.kind,
        r.branch_key,
        r.name,
        r.phone,
        r.email,
        r.secret_hash,
        r.status,
        r.created_at
      from public.approval_requests r
      where r.kind in ('tree_delegate', 'events_delegate')
      order by
        regexp_replace(btrim(coalesce(r.branch_key, '')), '\s+', ' ', 'g'),
        regexp_replace(btrim(coalesce(r.phone, '')), '\s+', '', 'g'),
        lower(regexp_replace(btrim(coalesce(r.email, '')), '\s+', '', 'g')),
        r.kind,
        r.created_at desc nulls last
    ),
    tree_rows as (
      select * from latest where kind = 'tree_delegate'
    ),
    event_rows as (
      select * from latest where kind = 'events_delegate'
    ),
    keys as (
      select
        regexp_replace(btrim(coalesce(branch_key, '')), '\s+', ' ', 'g') as nb,
        regexp_replace(btrim(coalesce(phone, '')), '\s+', '', 'g') as np,
        lower(regexp_replace(btrim(coalesce(email, '')), '\s+', '', 'g')) as ne
      from latest
      group by 1, 2, 3
    )
    select
      k.nb as branch_norm,
      k.np as phone_norm,
      k.ne as email_norm,
      coalesce(t.branch_key, e.branch_key) as branch_key,
      coalesce(t.name, e.name) as name,
      coalesce(t.phone, e.phone) as phone,
      coalesce(t.email, e.email) as email,
      coalesce(t.secret_hash, e.secret_hash) as secret_hash,
      t.request_id as tree_request_id,
      e.request_id as events_request_id,
      t.status as tree_status,
      e.status as events_status
    from keys k
    left join tree_rows t
      on regexp_replace(btrim(coalesce(t.branch_key, '')), '\s+', ' ', 'g') = k.nb
     and regexp_replace(btrim(coalesce(t.phone, '')), '\s+', '', 'g') = k.np
     and lower(regexp_replace(btrim(coalesce(t.email, '')), '\s+', '', 'g')) = k.ne
    left join event_rows e
      on regexp_replace(btrim(coalesce(e.branch_key, '')), '\s+', ' ', 'g') = k.nb
     and regexp_replace(btrim(coalesce(e.phone, '')), '\s+', '', 'g') = k.np
     and lower(regexp_replace(btrim(coalesce(e.email, '')), '\s+', '', 'g')) = k.ne
    where nullif(k.nb, '') is not null
  loop
    select d.id into v_id
    from public.delegates_v2 d
    where
      regexp_replace(btrim(coalesce(d.branch_key, '')), '\s+', ' ', 'g') = v_row.branch_norm
      and regexp_replace(btrim(coalesce(d.phone, '')), '\s+', '', 'g') = v_row.phone_norm
      and lower(regexp_replace(btrim(coalesce(d.email, '')), '\s+', '', 'g')) = v_row.email_norm
    limit 1;

    if v_id is null then
      insert into public.delegates_v2 (
        branch_key, name, phone, email, secret_hash, role_key, is_enabled,
        tree_request_id, events_request_id, updated_at
      ) values (
        nullif(btrim(v_row.branch_key), ''),
        nullif(btrim(v_row.name), ''),
        nullif(btrim(v_row.phone), ''),
        nullif(lower(btrim(v_row.email)), ''),
        nullif(btrim(v_row.secret_hash), ''),
        public.delegates_v2_infer_role(v_row.tree_status, v_row.events_status),
        (coalesce(v_row.tree_status, '') = 'approved'
          or coalesce(v_row.events_status, '') = 'approved'),
        nullif(btrim(v_row.tree_request_id), ''),
        nullif(btrim(v_row.events_request_id), ''),
        now()
      );
    else
      update public.delegates_v2 d
      set
        name = coalesce(nullif(btrim(v_row.name), ''), d.name),
        secret_hash = coalesce(nullif(btrim(v_row.secret_hash), ''), d.secret_hash),
        role_key = public.delegates_v2_infer_role(v_row.tree_status, v_row.events_status),
        is_enabled = (
          coalesce(v_row.tree_status, '') = 'approved'
          or coalesce(v_row.events_status, '') = 'approved'
        ),
        tree_request_id = coalesce(nullif(btrim(v_row.tree_request_id), ''), d.tree_request_id),
        events_request_id = coalesce(nullif(btrim(v_row.events_request_id), ''), d.events_request_id),
        updated_at = now()
      where d.id = v_id;
    end if;

    v_upserted := v_upserted + 1;
  end loop;

  perform public.admin_audit_write_v1(
    'admin', null, 'delegates.sync_from_requests', 'delegates_v2', null, null,
    jsonb_build_object('upserted', v_upserted, 'at', now())
  );

  return jsonb_build_object('ok', true, 'upserted', v_upserted);
end;
$$;

-- -----------------------------------------------------------------------------
-- List delegates (+ role title)
-- -----------------------------------------------------------------------------
drop function if exists public.admin_delegates_v2_list_v1(text);
drop function if exists public.admin_delegates_v2_list_v1(text, integer);

create or replace function public.admin_delegates_v2_list_v1(
  p_token text,
  p_limit integer default 500
)
returns table (
  id uuid,
  branch_key text,
  name text,
  phone text,
  email text,
  role_key text,
  role_title_ar text,
  is_enabled boolean,
  tree_request_id text,
  events_request_id text,
  notes text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 500), 1000));

  return query
  select
    d.id,
    d.branch_key,
    d.name,
    d.phone,
    d.email,
    d.role_key,
    r.title_ar as role_title_ar,
    d.is_enabled,
    d.tree_request_id,
    d.events_request_id,
    d.notes,
    d.created_at,
    d.updated_at
  from public.delegates_v2 d
  left join public.delegate_roles r on r.role_key = d.role_key
  order by d.is_enabled desc, d.branch_key asc nulls last, d.name asc nulls last
  limit v_limit;
end;
$$;

-- -----------------------------------------------------------------------------
-- Enable / disable (+ mirror legacy approval_requests status)
-- -----------------------------------------------------------------------------
create or replace function public.admin_delegates_v2_set_enabled_v1(
  p_token text,
  p_id uuid,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.delegates_v2%rowtype;
  v_status text;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;
  if p_id is null then
    raise exception 'id required';
  end if;

  select * into v_row from public.delegates_v2 where id = p_id for update;
  if not found then
    raise exception 'delegate not found';
  end if;

  update public.delegates_v2
  set is_enabled = coalesce(p_enabled, false),
      updated_at = now()
  where id = p_id;

  v_status := case when coalesce(p_enabled, false) then 'approved' else 'rejected' end;

  -- Mirror to legacy rows so tree_delegate_allowed_v1 / events_* keep working
  if nullif(btrim(coalesce(v_row.tree_request_id, '')), '') is not null then
    update public.approval_requests
    set status = v_status
    where request_id = v_row.tree_request_id
      and kind = 'tree_delegate';
  else
    update public.approval_requests r
    set status = v_status
    where r.kind = 'tree_delegate'
      and regexp_replace(btrim(coalesce(r.branch_key, '')), '\s+', ' ', 'g')
        = regexp_replace(btrim(coalesce(v_row.branch_key, '')), '\s+', ' ', 'g')
      and regexp_replace(btrim(coalesce(r.phone, '')), '\s+', '', 'g')
        = regexp_replace(btrim(coalesce(v_row.phone, '')), '\s+', '', 'g')
      and lower(regexp_replace(btrim(coalesce(r.email, '')), '\s+', '', 'g'))
        = lower(regexp_replace(btrim(coalesce(v_row.email, '')), '\s+', '', 'g'));
  end if;

  if nullif(btrim(coalesce(v_row.events_request_id, '')), '') is not null then
    update public.approval_requests
    set status = v_status
    where request_id = v_row.events_request_id
      and kind = 'events_delegate';
  else
    update public.approval_requests r
    set status = v_status
    where r.kind = 'events_delegate'
      and regexp_replace(btrim(coalesce(r.branch_key, '')), '\s+', ' ', 'g')
        = regexp_replace(btrim(coalesce(v_row.branch_key, '')), '\s+', ' ', 'g')
      and regexp_replace(btrim(coalesce(r.phone, '')), '\s+', '', 'g')
        = regexp_replace(btrim(coalesce(v_row.phone, '')), '\s+', '', 'g')
      and lower(regexp_replace(btrim(coalesce(r.email, '')), '\s+', '', 'g'))
        = lower(regexp_replace(btrim(coalesce(v_row.email, '')), '\s+', '', 'g'));
  end if;

  perform public.admin_audit_write_v1(
    'admin', null,
    case when coalesce(p_enabled, false) then 'delegate.enable' else 'delegate.disable' end,
    'delegates_v2', p_id::text, v_row.branch_key,
    jsonb_build_object(
      'enabled', coalesce(p_enabled, false),
      'role_key', v_row.role_key,
      'phone', v_row.phone,
      'email', v_row.email,
      'at', now()
    )
  );

  return jsonb_build_object(
    'ok', true,
    'id', p_id,
    'is_enabled', coalesce(p_enabled, false)
  );
end;
$$;

-- Set role (branch-scoped role catalog)
create or replace function public.admin_delegates_v2_set_role_v1(
  p_token text,
  p_id uuid,
  p_role_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_branch text;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;
  v_role := nullif(trim(coalesce(p_role_key, '')), '');
  if p_id is null or v_role is null then
    raise exception 'id and role required';
  end if;
  if not exists (select 1 from public.delegate_roles where role_key = v_role) then
    raise exception 'unknown role';
  end if;

  update public.delegates_v2
  set role_key = v_role, updated_at = now()
  where id = p_id
  returning branch_key into v_branch;

  if not found then
    raise exception 'delegate not found';
  end if;

  perform public.admin_audit_write_v1(
    'admin', null, 'delegate.role_set', 'delegates_v2', p_id::text, v_branch,
    jsonb_build_object('role_key', v_role, 'at', now())
  );

  return jsonb_build_object('ok', true, 'id', p_id, 'role_key', v_role);
end;
$$;

-- List roles
create or replace function public.admin_delegate_roles_list_v1(p_token text)
returns setof public.delegate_roles
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;
  return query
  select * from public.delegate_roles
  order by sort_order asc, role_key asc;
end;
$$;

-- Recent audit rows for delegates module
drop function if exists public.admin_audit_log_list_v1(text);
drop function if exists public.admin_audit_log_list_v1(text, integer);
drop function if exists public.admin_audit_log_list_v1(text, text, integer);

create or replace function public.admin_audit_log_list_v1(
  p_token text,
  p_entity_type text default null,
  p_limit integer default 100
)
returns setof public.admin_audit_log
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer;
  v_entity text;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;
  v_limit := greatest(1, least(coalesce(p_limit, 100), 500));
  v_entity := nullif(trim(coalesce(p_entity_type, '')), '');

  return query
  select a.*
  from public.admin_audit_log a
  where v_entity is null or a.entity_type = v_entity
  order by a.created_at desc
  limit v_limit;
end;
$$;

-- Grants
grant execute on function public.admin_audit_write_v1(text, text, text, text, text, text, jsonb)
  to anon, authenticated;
grant execute on function public.admin_delegates_v2_sync_from_requests_v1(text)
  to anon, authenticated;
grant execute on function public.admin_delegates_v2_list_v1(text, integer)
  to anon, authenticated;
grant execute on function public.admin_delegates_v2_set_enabled_v1(text, uuid, boolean)
  to anon, authenticated;
grant execute on function public.admin_delegates_v2_set_role_v1(text, uuid, text)
  to anon, authenticated;
grant execute on function public.admin_delegate_roles_list_v1(text)
  to anon, authenticated;
grant execute on function public.admin_audit_log_list_v1(text, text, integer)
  to anon, authenticated;
