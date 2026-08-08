-- Open this file, Select All, paste in Supabase SQL Editor
-- Delegates v2 — Enforce permissions (Phase 2 slice 2)
-- Prerequisite: 20260808_delegates_v2_foundation.sql (or COPY-ME-delegates-v2.sql)
-- Safe to re-run. Ref: docs/DELEGATES-V2-PHASE2.md
-- =============================================================================
-- Enforces on tree/events delegate RPCs:
--   is_enabled + branch + role operation keys (tree.read/write, events.read/write)
-- Legacy approval_requests path remains only when no delegates_v2 row exists.
-- Also strengthens audit payload for role changes (previous → new).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Identity helpers (match foundation / fix-delegate conventions)
-- -----------------------------------------------------------------------------
create or replace function public.delegates_v2_norm_branch(p text)
returns text
language sql
immutable
as $$
  select regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g');
$$;

create or replace function public.delegates_v2_norm_phone(p text)
returns text
language sql
immutable
as $$
  select regexp_replace(coalesce(p, ''), '\D', '', 'g');
$$;

create or replace function public.delegates_v2_norm_email(p text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(btrim(coalesce(p, '')), '\s+', '', 'g'));
$$;

-- Resolve delegates_v2 row for credentials + branch (security definer)
create or replace function public.delegates_v2_find_v1(
  p_branch_key text,
  p_phone text,
  p_email text,
  p_secret_hash text
)
returns public.delegates_v2
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.delegates_v2%rowtype;
  v_branch text := public.delegates_v2_norm_branch(p_branch_key);
  v_phone text := public.delegates_v2_norm_phone(p_phone);
  v_email text := public.delegates_v2_norm_email(p_email);
  v_hash text := nullif(trim(coalesce(p_secret_hash, '')), '');
begin
  if to_regclass('public.delegates_v2') is null then
    return null;
  end if;
  if v_branch is null or v_branch = '' or v_phone is null or v_phone = '' or v_hash is null then
    return null;
  end if;

  select d.*
  into v_row
  from public.delegates_v2 d
  where public.delegates_v2_norm_branch(d.branch_key) = v_branch
    and public.delegates_v2_norm_phone(d.phone) = v_phone
    and (
      v_email = ''
      or public.delegates_v2_norm_email(d.email) = ''
      or public.delegates_v2_norm_email(d.email) = v_email
    )
    and nullif(trim(coalesce(d.secret_hash, '')), '') is not null
    and d.secret_hash = v_hash
  order by d.updated_at desc nulls last, d.created_at desc nulls last
  limit 1;

  return v_row;
end;
$$;

-- Core auth+permission check for an operation_key
-- Returns jsonb:
--   { ok: true, source: 'v2', delegate_id, role_key, operation_key }
--   { ok: false, source: 'v2', reason: 'disabled'|'no_permission'|'bad_secret'|'not_found', ... }
--   { ok: null, source: 'none', reason: 'no_v2_row' }  → caller may fall back to legacy
create or replace function public.delegate_v2_check_op_v1(
  p_branch_key text,
  p_phone text,
  p_email text,
  p_secret_hash text,
  p_operation_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_op text := nullif(trim(coalesce(p_operation_key, '')), '');
  v_branch text := public.delegates_v2_norm_branch(p_branch_key);
  v_phone text := public.delegates_v2_norm_phone(p_phone);
  v_email text := public.delegates_v2_norm_email(p_email);
  v_hash text := nullif(trim(coalesce(p_secret_hash, '')), '');
  v_row public.delegates_v2%rowtype;
  v_allowed boolean;
begin
  if to_regclass('public.delegates_v2') is null
     or to_regclass('public.delegate_role_permissions') is null then
    return jsonb_build_object('ok', null, 'source', 'none', 'reason', 'no_v2_schema');
  end if;

  if v_op is null or v_branch = '' or v_phone = '' or v_hash is null then
    return jsonb_build_object('ok', false, 'source', 'v2', 'reason', 'bad_input', 'operation_key', v_op);
  end if;

  -- Any row for this identity+branch (ignore secret first) to distinguish disabled / wrong secret
  select d.*
  into v_row
  from public.delegates_v2 d
  where public.delegates_v2_norm_branch(d.branch_key) = v_branch
    and public.delegates_v2_norm_phone(d.phone) = v_phone
    and (
      v_email = ''
      or public.delegates_v2_norm_email(d.email) = ''
      or public.delegates_v2_norm_email(d.email) = v_email
    )
  order by d.updated_at desc nulls last, d.created_at desc nulls last
  limit 1;

  if not found then
    return jsonb_build_object('ok', null, 'source', 'none', 'reason', 'no_v2_row', 'operation_key', v_op);
  end if;

  if coalesce(v_row.is_enabled, false) is not true then
    return jsonb_build_object(
      'ok', false,
      'source', 'v2',
      'reason', 'disabled',
      'delegate_id', v_row.id,
      'role_key', v_row.role_key,
      'operation_key', v_op,
      'branch_key', v_row.branch_key
    );
  end if;

  if nullif(trim(coalesce(v_row.secret_hash, '')), '') is null
     or v_row.secret_hash <> v_hash then
    return jsonb_build_object(
      'ok', false,
      'source', 'v2',
      'reason', 'bad_secret',
      'delegate_id', v_row.id,
      'role_key', v_row.role_key,
      'operation_key', v_op
    );
  end if;

  select coalesce(p.allowed, false)
  into v_allowed
  from public.delegate_role_permissions p
  where p.role_key = v_row.role_key
    and p.operation_key = v_op
  limit 1;

  if coalesce(v_allowed, false) is not true then
    return jsonb_build_object(
      'ok', false,
      'source', 'v2',
      'reason', 'no_permission',
      'delegate_id', v_row.id,
      'role_key', v_row.role_key,
      'operation_key', v_op,
      'branch_key', v_row.branch_key
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'source', 'v2',
    'delegate_id', v_row.id,
    'role_key', v_row.role_key,
    'operation_key', v_op,
    'branch_key', v_row.branch_key
  );
end;
$$;

-- Boolean wrapper used by write/read RPCs
create or replace function public.delegate_v2_has_op_v1(
  p_branch_key text,
  p_phone text,
  p_email text,
  p_secret_hash text,
  p_operation_key text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((public.delegate_v2_check_op_v1(
    p_branch_key, p_phone, p_email, p_secret_hash, p_operation_key
  )->>'ok')::boolean, false);
$$;

-- -----------------------------------------------------------------------------
-- Legacy helpers (kept for fallback when no delegates_v2 row)
-- -----------------------------------------------------------------------------
create or replace function public.tree_delegate_allowed_legacy_v1(
  p_branch_key text,
  p_phone text,
  p_email text,
  p_secret_hash text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.approval_requests r
    where r.kind = 'tree_delegate'
      and public.delegates_v2_norm_branch(r.branch_key)
        = public.delegates_v2_norm_branch(p_branch_key)
      and public.delegates_v2_norm_phone(r.phone)
        = public.delegates_v2_norm_phone(p_phone)
      and (
        nullif(btrim(coalesce(p_email, '')), '') is null
        or public.delegates_v2_norm_email(r.email)
           = public.delegates_v2_norm_email(p_email)
      )
      and r.status = 'approved'
      and nullif(trim(coalesce(r.secret_hash, '')), '') is not null
      and nullif(trim(coalesce(p_secret_hash, '')), '') is not null
      and r.secret_hash = p_secret_hash
    limit 1
  );
$$;

create or replace function public.events_delegate_allowed_legacy_v1(
  p_branch_key text,
  p_phone text,
  p_email text,
  p_secret_hash text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.approval_requests r
    where r.kind in ('events_delegate', 'tree_delegate')
      and public.delegates_v2_norm_branch(r.branch_key)
        = public.delegates_v2_norm_branch(p_branch_key)
      and public.delegates_v2_norm_phone(r.phone)
        = public.delegates_v2_norm_phone(p_phone)
      and (
        nullif(btrim(coalesce(p_email, '')), '') is null
        or public.delegates_v2_norm_email(r.email)
           = public.delegates_v2_norm_email(p_email)
      )
      and r.status = 'approved'
      and nullif(trim(coalesce(r.secret_hash, '')), '') is not null
      and nullif(trim(coalesce(p_secret_hash, '')), '') is not null
      and r.secret_hash = p_secret_hash
    limit 1
  );
$$;

-- -----------------------------------------------------------------------------
-- tree_delegate_allowed_v1 — enforce tree.write when v2 profile exists
-- -----------------------------------------------------------------------------
create or replace function public.tree_delegate_allowed_v1(
  p_branch_key text,
  p_phone text,
  p_email text,
  p_secret_hash text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_check jsonb;
  v_ok text;
begin
  v_check := public.delegate_v2_check_op_v1(
    p_branch_key, p_phone, p_email, p_secret_hash, 'tree.write'
  );
  v_ok := v_check->>'ok';

  if v_ok = 'true' then
    return true;
  end if;
  if v_ok = 'false' then
    return false;
  end if;

  -- no_v2_row / no_v2_schema → legacy
  return public.tree_delegate_allowed_legacy_v1(
    p_branch_key, p_phone, p_email, p_secret_hash
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- events_delegate_allowed_v1 — enforce events.write when v2 profile exists
-- -----------------------------------------------------------------------------
create or replace function public.events_delegate_allowed_v1(
  p_branch_key text,
  p_phone text,
  p_email text,
  p_secret_hash text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_check jsonb;
  v_ok text;
begin
  v_check := public.delegate_v2_check_op_v1(
    p_branch_key, p_phone, p_email, p_secret_hash, 'events.write'
  );
  v_ok := v_check->>'ok';

  if v_ok = 'true' then
    return true;
  end if;
  if v_ok = 'false' then
    return false;
  end if;

  return public.events_delegate_allowed_legacy_v1(
    p_branch_key, p_phone, p_email, p_secret_hash
  );
end;
$$;

-- Read helpers (list/view paths that previously reused write allowed)
create or replace function public.tree_delegate_can_read_v1(
  p_branch_key text,
  p_phone text,
  p_email text,
  p_secret_hash text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_check jsonb;
  v_ok text;
begin
  v_check := public.delegate_v2_check_op_v1(
    p_branch_key, p_phone, p_email, p_secret_hash, 'tree.read'
  );
  v_ok := v_check->>'ok';
  if v_ok = 'true' then return true; end if;
  if v_ok = 'false' then return false; end if;
  return public.tree_delegate_allowed_legacy_v1(
    p_branch_key, p_phone, p_email, p_secret_hash
  );
end;
$$;

create or replace function public.events_delegate_can_read_v1(
  p_branch_key text,
  p_phone text,
  p_email text,
  p_secret_hash text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_check jsonb;
  v_ok text;
begin
  v_check := public.delegate_v2_check_op_v1(
    p_branch_key, p_phone, p_email, p_secret_hash, 'events.read'
  );
  v_ok := v_check->>'ok';
  if v_ok = 'true' then return true; end if;
  if v_ok = 'false' then return false; end if;
  return public.events_delegate_allowed_legacy_v1(
    p_branch_key, p_phone, p_email, p_secret_hash
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- check_tree_delegate_access — richer reason codes for portal Arabic errors
-- -----------------------------------------------------------------------------
create or replace function public.check_tree_delegate_access(
  p_branch_key text,
  p_phone text,
  p_email text,
  p_secret_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_check jsonb;
  v_ok text;
  r record;
  v_read jsonb;
  v_write jsonb;
begin
  -- Prefer v2 profile when present
  v_check := public.delegate_v2_check_op_v1(
    p_branch_key, p_phone, p_email, p_secret_hash, 'tree.read'
  );
  v_ok := v_check->>'ok';

  if v_ok = 'true' then
    v_write := public.delegate_v2_check_op_v1(
      p_branch_key, p_phone, p_email, p_secret_hash, 'tree.write'
    );
    select
      nullif(btrim(coalesce(d.tree_request_id, d.events_request_id, '')), '') as request_id,
      nullif(btrim(coalesce(d.phone, '')), '') as phone,
      nullif(btrim(coalesce(d.email, '')), '') as email
    into r
    from public.delegates_v2 d
    where d.id::text = nullif(btrim(coalesce(v_check->>'delegate_id', '')), '')
    limit 1;
    return jsonb_build_object(
      'allowed', true,
      'status', 'approved',
      'source', 'v2',
      'reason', null,
      'delegate_id', v_check->>'delegate_id',
      'role_key', v_check->>'role_key',
      'branch_key', coalesce(v_check->>'branch_key', p_branch_key),
      'request_id', coalesce(r.request_id, v_check->>'delegate_id'),
      'phone', coalesce(r.phone, p_phone),
      'email', coalesce(r.email, p_email),
      'operations', jsonb_build_object(
        'tree.read', true,
        'tree.write', coalesce((v_write->>'ok')::boolean, false)
      )
    );
  end if;

  if v_ok = 'false' then
    return jsonb_build_object(
      'allowed', false,
      'status', case
        when v_check->>'reason' = 'disabled' then 'disabled'
        when v_check->>'reason' = 'bad_secret' then 'approved'
        else coalesce(v_check->>'reason', 'denied')
      end,
      'source', 'v2',
      'reason', v_check->>'reason',
      'operation_key', v_check->>'operation_key',
      'role_key', v_check->>'role_key',
      'delegate_id', v_check->>'delegate_id',
      'request_id', null
    );
  end if;

  -- Legacy path
  select request_id, status, branch_key, phone, email, secret_hash
  into r
  from public.approval_requests
  where kind = 'tree_delegate'
    and public.delegates_v2_norm_branch(branch_key)
      = public.delegates_v2_norm_branch(p_branch_key)
    and public.delegates_v2_norm_phone(phone)
      = public.delegates_v2_norm_phone(p_phone)
  order by created_at desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'allowed', false,
      'status', 'not_found',
      'source', 'legacy',
      'reason', 'not_found'
    );
  end if;

  if r.status <> 'approved' then
    return jsonb_build_object(
      'allowed', false,
      'status', r.status,
      'source', 'legacy',
      'reason', r.status,
      'request_id', r.request_id
    );
  end if;

  if coalesce(r.secret_hash, '') <> coalesce(p_secret_hash, '') then
    return jsonb_build_object(
      'allowed', false,
      'status', 'approved',
      'source', 'legacy',
      'reason', 'bad_secret',
      'request_id', r.request_id
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'status', 'approved',
    'source', 'legacy',
    'reason', null,
    'request_id', r.request_id,
    'branch_key', r.branch_key,
    'phone', r.phone,
    'email', r.email,
    'operations', jsonb_build_object('tree.read', true, 'tree.write', true)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- check_events_delegate_access — richer reason codes
-- -----------------------------------------------------------------------------
create or replace function public.check_events_delegate_access(
  p_branch_key text,
  p_phone text,
  p_email text,
  p_secret_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_check jsonb;
  v_ok text;
  v_row record;
  v_allowed boolean := false;
  v_write jsonb;
  v_req_id text;
begin
  v_check := public.delegate_v2_check_op_v1(
    p_branch_key, p_phone, p_email, p_secret_hash, 'events.read'
  );
  v_ok := v_check->>'ok';

  if v_ok = 'true' then
    v_write := public.delegate_v2_check_op_v1(
      p_branch_key, p_phone, p_email, p_secret_hash, 'events.write'
    );
    select nullif(btrim(coalesce(d.events_request_id, d.tree_request_id, '')), '')
      into v_req_id
    from public.delegates_v2 d
    where d.id::text = nullif(btrim(coalesce(v_check->>'delegate_id', '')), '')
    limit 1;
    return jsonb_build_object(
      'allowed', true,
      'status', 'approved',
      'source', 'v2',
      'reason', null,
      'delegate_id', v_check->>'delegate_id',
      'role_key', v_check->>'role_key',
      'request_id', coalesce(v_req_id, v_check->>'delegate_id'),
      'operations', jsonb_build_object(
        'events.read', true,
        'events.write', coalesce((v_write->>'ok')::boolean, false)
      )
    );
  end if;

  if v_ok = 'false' then
    return jsonb_build_object(
      'allowed', false,
      'status', case
        when v_check->>'reason' = 'disabled' then 'disabled'
        when v_check->>'reason' = 'bad_secret' then 'approved'
        else coalesce(v_check->>'reason', 'denied')
      end,
      'source', 'v2',
      'reason', v_check->>'reason',
      'operation_key', v_check->>'operation_key',
      'role_key', v_check->>'role_key',
      'delegate_id', v_check->>'delegate_id',
      'request_id', null
    );
  end if;

  select r.request_id, r.status
  into v_row
  from public.approval_requests r
  where r.kind in ('events_delegate', 'tree_delegate')
    and public.delegates_v2_norm_branch(r.branch_key)
      = public.delegates_v2_norm_branch(p_branch_key)
    and public.delegates_v2_norm_phone(r.phone)
      = public.delegates_v2_norm_phone(p_phone)
    and (
      nullif(btrim(coalesce(p_email, '')), '') is null
      or public.delegates_v2_norm_email(r.email)
         = public.delegates_v2_norm_email(p_email)
    )
  order by r.created_at desc
  limit 1;

  if v_row.request_id is null then
    return jsonb_build_object(
      'allowed', false,
      'status', null,
      'source', 'legacy',
      'reason', 'not_found',
      'request_id', null
    );
  end if;

  if v_row.status = 'approved' then
    select public.events_delegate_allowed_legacy_v1(
      p_branch_key, p_phone, p_email, p_secret_hash
    ) into v_allowed;
  end if;

  return jsonb_build_object(
    'allowed', coalesce(v_allowed, false),
    'status', v_row.status,
    'source', 'legacy',
    'reason', case
      when coalesce(v_allowed, false) then null
      when v_row.status = 'approved' then 'bad_secret'
      else v_row.status
    end,
    'request_id', v_row.request_id
  );
end;
$$;

-- Portal helper: list allowed operation keys for current session
create or replace function public.delegate_session_permissions_v1(
  p_branch_key text,
  p_phone text,
  p_email text,
  p_secret_hash text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.delegates_v2%rowtype;
  v_ops jsonb := '{}'::jsonb;
  v_op record;
  v_tree_legacy boolean;
  v_events_legacy boolean;
begin
  v_row := public.delegates_v2_find_v1(p_branch_key, p_phone, p_email, p_secret_hash);

  if v_row.id is not null then
    if coalesce(v_row.is_enabled, false) is not true then
      return jsonb_build_object(
        'ok', false,
        'source', 'v2',
        'reason', 'disabled',
        'delegate_id', v_row.id,
        'role_key', v_row.role_key,
        'operations', '{}'::jsonb
      );
    end if;

    for v_op in
      select p.operation_key, p.allowed
      from public.delegate_role_permissions p
      where p.role_key = v_row.role_key
        and p.allowed = true
    loop
      v_ops := v_ops || jsonb_build_object(v_op.operation_key, true);
    end loop;

    return jsonb_build_object(
      'ok', true,
      'source', 'v2',
      'reason', null,
      'delegate_id', v_row.id,
      'role_key', v_row.role_key,
      'branch_key', v_row.branch_key,
      'operations', v_ops
    );
  end if;

  v_tree_legacy := public.tree_delegate_allowed_legacy_v1(
    p_branch_key, p_phone, p_email, p_secret_hash
  );
  v_events_legacy := public.events_delegate_allowed_legacy_v1(
    p_branch_key, p_phone, p_email, p_secret_hash
  );

  if not v_tree_legacy and not v_events_legacy then
    return jsonb_build_object(
      'ok', false,
      'source', 'legacy',
      'reason', 'not_found',
      'operations', '{}'::jsonb
    );
  end if;

  if v_tree_legacy then
    v_ops := v_ops || jsonb_build_object('tree.read', true, 'tree.write', true);
  end if;
  if v_events_legacy then
    v_ops := v_ops || jsonb_build_object('events.read', true, 'events.write', true);
  end if;

  return jsonb_build_object(
    'ok', true,
    'source', 'legacy',
    'reason', null,
    'operations', v_ops
  );
end;
$$;

-- List event requests: require events.read (or legacy)
create or replace function public.delegate_list_event_requests_v1(
  p_branch_key text,
  p_phone text,
  p_email text,
  p_secret_hash text
)
returns setof public.approval_requests
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.events_delegate_can_read_v1(
    p_branch_key, p_phone, p_email, p_secret_hash
  ) then
    return;
  end if;

  return query
    select r.*
    from public.approval_requests r
    where r.status = 'pending'
      and r.kind in ('event_card', 'family_event', 'event_request')
      and public.delegates_v2_norm_branch(r.branch_key)
        = public.delegates_v2_norm_branch(p_branch_key)
    order by r.created_at desc
    limit 100;
end;
$$;

-- Approve/reject incoming event requests: require events.write
create or replace function public.delegate_set_approval_request_status_v1(
  p_branch_key text,
  p_request_id bigint,
  p_status text,
  p_phone text default null,
  p_email text default null,
  p_secret_hash text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.approval_requests%rowtype;
  v_status text;
begin
  if p_phone is not null or p_email is not null or p_secret_hash is not null then
    if not public.events_delegate_allowed_v1(
      p_branch_key, p_phone, p_email, p_secret_hash
    ) then
      return false;
    end if;
  end if;

  v_status := case
    when lower(btrim(coalesce(p_status, ''))) = 'approved' then 'approved'
    when lower(btrim(coalesce(p_status, ''))) = 'rejected' then 'rejected'
    else null
  end;
  if v_status is null then
    return false;
  end if;

  select * into v_row
  from public.approval_requests r
  where r.id = p_request_id
    and r.status = 'pending'
    and r.kind in ('event_card', 'family_event', 'event_request')
    and public.delegates_v2_norm_branch(r.branch_key)
      = public.delegates_v2_norm_branch(p_branch_key)
  limit 1;

  if v_row.id is null then
    return false;
  end if;

  update public.approval_requests
  set status = v_status
  where id = p_request_id;

  return found;
end;
$$;

-- -----------------------------------------------------------------------------
-- Strengthen role-change audit (previous role → new role)
-- -----------------------------------------------------------------------------
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
  v_prev text;
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

  select role_key, branch_key into v_prev, v_branch
  from public.delegates_v2
  where id = p_id
  for update;

  if not found then
    raise exception 'delegate not found';
  end if;

  update public.delegates_v2
  set role_key = v_role, updated_at = now()
  where id = p_id;

  perform public.admin_audit_write_v1(
    'admin', null, 'delegate.role_set', 'delegates_v2', p_id::text, v_branch,
    jsonb_build_object(
      'role_key', v_role,
      'previous_role_key', v_prev,
      'at', now()
    )
  );

  return jsonb_build_object(
    'ok', true,
    'id', p_id,
    'role_key', v_role,
    'previous_role_key', v_prev
  );
end;
$$;

-- Grants
grant execute on function public.delegates_v2_norm_branch(text) to anon, authenticated;
grant execute on function public.delegates_v2_norm_phone(text) to anon, authenticated;
grant execute on function public.delegates_v2_norm_email(text) to anon, authenticated;
grant execute on function public.delegates_v2_find_v1(text, text, text, text) to anon, authenticated;
grant execute on function public.delegate_v2_check_op_v1(text, text, text, text, text) to anon, authenticated;
grant execute on function public.delegate_v2_has_op_v1(text, text, text, text, text) to anon, authenticated;
grant execute on function public.tree_delegate_allowed_legacy_v1(text, text, text, text) to anon, authenticated;
grant execute on function public.events_delegate_allowed_legacy_v1(text, text, text, text) to anon, authenticated;
grant execute on function public.tree_delegate_allowed_v1(text, text, text, text) to anon, authenticated;
grant execute on function public.events_delegate_allowed_v1(text, text, text, text) to anon, authenticated;
grant execute on function public.tree_delegate_can_read_v1(text, text, text, text) to anon, authenticated;
grant execute on function public.events_delegate_can_read_v1(text, text, text, text) to anon, authenticated;
grant execute on function public.check_tree_delegate_access(text, text, text, text) to anon, authenticated;
grant execute on function public.check_events_delegate_access(text, text, text, text) to anon, authenticated;
grant execute on function public.delegate_session_permissions_v1(text, text, text, text) to anon, authenticated;
grant execute on function public.delegate_list_event_requests_v1(text, text, text, text) to anon, authenticated;
grant execute on function public.delegate_set_approval_request_status_v1(text, bigint, text, text, text, text) to anon, authenticated;
grant execute on function public.admin_delegates_v2_set_role_v1(text, uuid, text) to anon, authenticated;
