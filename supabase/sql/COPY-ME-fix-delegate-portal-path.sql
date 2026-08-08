-- Operator path: Admin → SQL Workspace → أوامر الصيانة الجاهزة
-- Preset id: maint.fix_delegate_portal_path_v1
-- Source of truth file (do not prefer external paste).

-- =============================================================================
-- FIX: Delegate portal path after approve (Gate 1)
-- Safe to re-run.
--
-- Root cause:
--   1) Admin «قبول» updates approval_requests (Legacy) only — does NOT upsert
--      delegates_v2, so login (which prefers v2) is out of sync.
--   2) check_*_delegate_access v2 success omitted request_id; portal JS treated
--      that as verification failure → «تعذر التحقق من بيانات الدخول حاليًا».
--
-- This script:
--   A) Upserts/activates delegates_v2 from an approved tree/events request
--   B) Trigger: any Legacy status→approved for those kinds activates v2
--   C) Fixes check_tree/events_delegate_access to return request_id on v2
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A) Activate / upsert delegates_v2 from one approval_requests row (by pk id)
-- -----------------------------------------------------------------------------
create or replace function public.delegates_v2_activate_from_request_pk_v1(
  p_request_pk bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.approval_requests%rowtype;
  v_tree public.approval_requests%rowtype;
  v_events public.approval_requests%rowtype;
  v_branch text;
  v_phone text;
  v_email text;
  v_id uuid;
  v_role text;
  v_enabled boolean;
  v_hash text;
  v_name text;
begin
  if to_regclass('public.delegates_v2') is null then
    return jsonb_build_object('ok', false, 'reason', 'no_v2_schema');
  end if;

  if p_request_pk is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;

  select * into v_req
  from public.approval_requests
  where id = p_request_pk
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_req.kind is null
     or v_req.kind not in ('tree_delegate', 'events_delegate') then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'not_delegate_kind');
  end if;

  v_branch := public.delegates_v2_norm_branch(v_req.branch_key);
  v_phone := public.delegates_v2_norm_phone(v_req.phone);
  v_email := public.delegates_v2_norm_email(v_req.email);

  if v_branch = '' or v_phone = '' then
    return jsonb_build_object('ok', false, 'reason', 'missing_identity');
  end if;

  -- Latest tree + events rows for same identity (role inference)
  select * into v_tree
  from public.approval_requests r
  where r.kind = 'tree_delegate'
    and public.delegates_v2_norm_branch(r.branch_key) = v_branch
    and public.delegates_v2_norm_phone(r.phone) = v_phone
    and (
      v_email = ''
      or public.delegates_v2_norm_email(r.email) = ''
      or public.delegates_v2_norm_email(r.email) = v_email
    )
  order by r.created_at desc nulls last
  limit 1;

  select * into v_events
  from public.approval_requests r
  where r.kind = 'events_delegate'
    and public.delegates_v2_norm_branch(r.branch_key) = v_branch
    and public.delegates_v2_norm_phone(r.phone) = v_phone
    and (
      v_email = ''
      or public.delegates_v2_norm_email(r.email) = ''
      or public.delegates_v2_norm_email(r.email) = v_email
    )
  order by r.created_at desc nulls last
  limit 1;

  v_role := public.delegates_v2_infer_role(v_tree.status, v_events.status);
  v_enabled := (
    coalesce(v_tree.status, '') = 'approved'
    or coalesce(v_events.status, '') = 'approved'
  );
  v_hash := nullif(btrim(coalesce(
    case
      when v_req.kind = 'tree_delegate' then v_req.secret_hash
      else coalesce(v_events.secret_hash, v_tree.secret_hash, v_req.secret_hash)
    end,
    ''
  )), '');
  if v_hash is null then
    v_hash := nullif(btrim(coalesce(v_tree.secret_hash, v_events.secret_hash, '')), '');
  end if;
  v_name := nullif(btrim(coalesce(v_req.name, v_tree.name, v_events.name, '')), '');

  select d.id into v_id
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

  if v_id is null then
    insert into public.delegates_v2 (
      branch_key, name, phone, email, secret_hash, role_key, is_enabled,
      tree_request_id, events_request_id, updated_at
    ) values (
      nullif(btrim(v_req.branch_key), ''),
      v_name,
      nullif(btrim(v_req.phone), ''),
      nullif(lower(btrim(coalesce(v_req.email, ''))), ''),
      v_hash,
      v_role,
      v_enabled,
      nullif(btrim(coalesce(v_tree.request_id, '')), ''),
      nullif(btrim(coalesce(v_events.request_id, '')), ''),
      now()
    )
    returning id into v_id;
  else
    update public.delegates_v2 d
    set
      name = coalesce(v_name, d.name),
      secret_hash = coalesce(v_hash, d.secret_hash),
      role_key = v_role,
      is_enabled = v_enabled,
      tree_request_id = coalesce(
        nullif(btrim(coalesce(v_tree.request_id, '')), ''),
        d.tree_request_id
      ),
      events_request_id = coalesce(
        nullif(btrim(coalesce(v_events.request_id, '')), ''),
        d.events_request_id
      ),
      updated_at = now()
    where d.id = v_id;
  end if;

  perform public.admin_audit_write_v1(
    'system',
    'approve_activate',
    'delegate.activate_from_request',
    'delegates_v2',
    v_id::text,
    nullif(btrim(v_req.branch_key), ''),
    jsonb_build_object(
      'request_pk', p_request_pk,
      'request_id', v_req.request_id,
      'kind', v_req.kind,
      'status', v_req.status,
      'role_key', v_role,
      'is_enabled', v_enabled,
      'at', now()
    )
  );

  return jsonb_build_object(
    'ok', true,
    'delegate_id', v_id,
    'role_key', v_role,
    'is_enabled', v_enabled,
    'has_secret', v_hash is not null
  );
end;
$$;

-- Admin-token wrapper (callable from requests UI after قبول)
create or replace function public.admin_delegates_v2_activate_from_request_v1(
  p_token text,
  p_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pk bigint;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;
  begin
    v_pk := trim(coalesce(p_id, ''))::bigint;
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'bad_id');
  end;
  return public.delegates_v2_activate_from_request_pk_v1(v_pk);
end;
$$;

-- -----------------------------------------------------------------------------
-- B) Trigger: Legacy approve/reject of delegate kinds keeps delegates_v2 in sync
-- -----------------------------------------------------------------------------
create or replace function public.delegates_v2_approval_requests_sync_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if to_regclass('public.delegates_v2') is null then
    return new;
  end if;

  if new.kind is null
     or new.kind not in ('tree_delegate', 'events_delegate') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status in ('approved', 'rejected') then
      perform public.delegates_v2_activate_from_request_pk_v1(new.id);
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.status is distinct from old.status
       and new.status in ('approved', 'rejected') then
      perform public.delegates_v2_activate_from_request_pk_v1(new.id);
    elsif new.status = 'approved'
      and (
        new.secret_hash is distinct from old.secret_hash
        or new.phone is distinct from old.phone
        or new.branch_key is distinct from old.branch_key
      ) then
      perform public.delegates_v2_activate_from_request_pk_v1(new.id);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_delegates_v2_approval_requests_sync
  on public.approval_requests;

create trigger trg_delegates_v2_approval_requests_sync
after insert or update of status, secret_hash, phone, branch_key
on public.approval_requests
for each row
execute function public.delegates_v2_approval_requests_sync_trg();

-- Backfill: activate any already-approved delegate requests missing/outdated v2
do $$
declare
  r record;
begin
  if to_regclass('public.delegates_v2') is null then
    return;
  end if;
  for r in
    select id
    from public.approval_requests
    where kind in ('tree_delegate', 'events_delegate')
      and status = 'approved'
    order by created_at desc nulls last
    limit 2000
  loop
    perform public.delegates_v2_activate_from_request_pk_v1(r.id);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- C) check_tree_delegate_access — include request_id on v2 success (login key)
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
  v_write jsonb;
  v_req_id text;
  v_phone text;
  v_email text;
begin
  v_check := public.delegate_v2_check_op_v1(
    p_branch_key, p_phone, p_email, p_secret_hash, 'tree.read'
  );
  v_ok := v_check->>'ok';

  if v_ok = 'true' then
    v_write := public.delegate_v2_check_op_v1(
      p_branch_key, p_phone, p_email, p_secret_hash, 'tree.write'
    );
    select
      nullif(btrim(coalesce(d.tree_request_id, d.events_request_id, '')), ''),
      nullif(btrim(coalesce(d.phone, '')), ''),
      nullif(btrim(coalesce(d.email, '')), '')
      into v_req_id, v_phone, v_email
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
      'request_id', coalesce(v_req_id, v_check->>'delegate_id'),
      'phone', coalesce(v_phone, p_phone),
      'email', coalesce(v_email, p_email),
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

  -- Legacy path (only when no delegates_v2 row for identity)
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
    -- events-only approved delegates: allow portal login via events.read
    v_check := public.delegate_v2_check_op_v1(
      p_branch_key, p_phone, p_email, p_secret_hash, 'events.read'
    );
    if (v_check->>'ok') = 'true' then
      select
        nullif(btrim(coalesce(d.events_request_id, d.tree_request_id, '')), ''),
        nullif(btrim(coalesce(d.phone, '')), ''),
        nullif(btrim(coalesce(d.email, '')), '')
      into v_req_id, v_phone, v_email
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
        'request_id', coalesce(v_req_id, v_check->>'delegate_id'),
        'phone', coalesce(v_phone, p_phone),
        'email', coalesce(v_email, p_email),
        'operations', jsonb_build_object('tree.read', false, 'tree.write', false, 'events.read', true)
      );
    end if;

    select ar.request_id, ar.status, ar.branch_key, ar.phone, ar.email, ar.secret_hash
    into r
    from public.approval_requests ar
    where ar.kind = 'events_delegate'
      and public.delegates_v2_norm_branch(ar.branch_key)
        = public.delegates_v2_norm_branch(p_branch_key)
      and public.delegates_v2_norm_phone(ar.phone)
        = public.delegates_v2_norm_phone(p_phone)
    order by ar.created_at desc
    limit 1;

    if not found then
      return jsonb_build_object(
        'allowed', false,
        'status', 'not_found',
        'source', 'legacy',
        'reason', 'not_found'
      );
    end if;
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
-- check_events_delegate_access — include request_id on v2 success
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

  select r.request_id, r.status, r.secret_hash
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

grant execute on function public.delegates_v2_activate_from_request_pk_v1(bigint)
  to anon, authenticated;
grant execute on function public.admin_delegates_v2_activate_from_request_v1(text, text)
  to anon, authenticated;
grant execute on function public.check_tree_delegate_access(text, text, text, text)
  to anon, authenticated;
grant execute on function public.check_events_delegate_access(text, text, text, text)
  to anon, authenticated;
