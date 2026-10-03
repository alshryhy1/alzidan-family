-- COPY-ME: Preset id: maint.family_admin_app_v1
-- App family admin: role_key family_admin on existing member_role_grants.
-- No admin_token in the app. Writes require trusted device + grant.
-- Daily: person name/gender/deceased, phones, phone/membership requests, device unbind.
-- Wives, mothers, SQL workspace, import stay on the web. Safe to re-run.

create or replace function public.family_admin_session_v1(p_phone text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_digits text;
  v_mp public.member_profiles%rowtype;
  v_grant public.member_role_grants%rowtype;
begin
  v_digits := nullif(right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 9), '');
  if v_digits is null or char_length(v_digits) < 9 then
    return jsonb_build_object('ok', true, 'enabled', false, 'reason', 'bad_phone');
  end if;
  if to_regclass('public.member_profiles') is null or to_regclass('public.member_role_grants') is null then
    return jsonb_build_object('ok', true, 'enabled', false, 'reason', 'no_grants');
  end if;

  select mp.*
    into v_mp
  from public.member_profiles mp
  where coalesce(nullif(btrim(coalesce(mp.status, '')), ''), 'active') = 'active'
    and right(regexp_replace(coalesce(mp.phone, ''), '[^0-9]', '', 'g'), 9) = v_digits
  order by mp.updated_at desc nulls last, mp.id desc
  limit 1;
  if not found then
    return jsonb_build_object('ok', true, 'enabled', false, 'reason', 'not_member');
  end if;

  select g.*
    into v_grant
  from public.member_role_grants g
  where g.role_key = 'family_admin'
    and g.status = 'active'
    and (
      (coalesce(v_mp.tree_child_id, 0) > 0 and g.tree_child_id = v_mp.tree_child_id)
      or (v_mp.person_id is not null and g.person_id is not distinct from v_mp.person_id)
    )
  order by g.updated_at desc nulls last, g.id desc
  limit 1;
  if not found then
    return jsonb_build_object('ok', true, 'enabled', false, 'reason', 'no_grant');
  end if;

  return jsonb_build_object(
    'ok', true,
    'enabled', true,
    'role_key', 'family_admin',
    'tree_child_id', v_grant.tree_child_id,
    'person_id', v_grant.person_id
  );
end;
$fn$;

create or replace function public.family_admin_require_v1(p_phone text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_session jsonb;
begin
  v_session := public.family_admin_session_v1(p_phone);
  if coalesce((v_session->>'enabled')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;
  if to_regprocedure('public.member_device_allows_phone_v1(text)') is not null
     and public.member_device_allows_phone_v1(p_phone) is not true then
    return jsonb_build_object('ok', false, 'error', 'device_required');
  end if;
  return v_session;
end;
$fn$;

create or replace function public.admin_family_admin_get_v1(p_token text, p_tree_child_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_grant public.member_role_grants%rowtype;
  v_status text := 'inactive';
  v_child public.tree_children%rowtype;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;
  if p_tree_child_id is null or p_tree_child_id < 1 then
    return jsonb_build_object('ok', false, 'error', 'person_not_found');
  end if;
  select * into v_child from public.tree_children c where c.id = p_tree_child_id limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'person_not_found');
  end if;
  select g.* into v_grant
  from public.member_role_grants g
  where g.tree_child_id = p_tree_child_id and g.role_key = 'family_admin'
  limit 1;
  if found then
    v_status := v_grant.status;
  end if;
  return jsonb_build_object(
    'ok', true,
    'role_key', 'family_admin',
    'status', v_status,
    'tree_child_id', p_tree_child_id,
    'person_id', coalesce(v_grant.person_id, v_child.person_id),
    'assigned_at', v_grant.assigned_at,
    'assigned_by', v_grant.assigned_by
  );
end;
$fn$;

create or replace function public.admin_family_admin_set_v1(
  p_token text,
  p_tree_child_id bigint,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_prev text := 'inactive';
  v_child public.tree_children%rowtype;
  v_now timestamptz := now();
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;
  if v_action not in ('assign', 'suspend') then
    return jsonb_build_object('ok', false, 'error', 'bad_action');
  end if;
  if p_tree_child_id is null or p_tree_child_id < 1 then
    return jsonb_build_object('ok', false, 'error', 'person_not_found');
  end if;
  select * into v_child from public.tree_children c where c.id = p_tree_child_id limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'person_not_found');
  end if;
  select g.status into v_prev
  from public.member_role_grants g
  where g.tree_child_id = p_tree_child_id and g.role_key = 'family_admin'
  limit 1;
  v_prev := coalesce(v_prev, 'inactive');

  if v_action = 'assign' then
    insert into public.member_role_grants (
      role_key, tree_child_id, person_id, status, assigned_at, assigned_by, updated_at
    ) values (
      'family_admin', p_tree_child_id, v_child.person_id, 'active', v_now, 'admin', v_now
    )
    on conflict (tree_child_id, role_key) do update
    set
      status = 'active',
      person_id = coalesce(excluded.person_id, public.member_role_grants.person_id),
      assigned_at = v_now,
      assigned_by = 'admin',
      updated_at = v_now;
  else
    if v_prev = 'inactive' then
      return jsonb_build_object('ok', true, 'status', 'inactive', 'action', 'noop');
    end if;
    update public.member_role_grants
    set status = 'suspended', assigned_by = 'admin', updated_at = v_now
    where tree_child_id = p_tree_child_id and role_key = 'family_admin';
  end if;

  return public.admin_family_admin_get_v1(p_token, p_tree_child_id)
    || jsonb_build_object('ok', true, 'action', v_action);
end;
$fn$;

create or replace function public.admin_family_admin_set_by_phone_v1(
  p_token text,
  p_phone text,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_digits text;
  v_id bigint;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;
  v_digits := nullif(right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 9), '');
  if v_digits is null then
    return jsonb_build_object('ok', false, 'error', 'bad_phone');
  end if;
  select mp.tree_child_id into v_id
  from public.member_profiles mp
  where coalesce(mp.tree_child_id, 0) > 0
    and right(regexp_replace(coalesce(mp.phone, ''), '[^0-9]', '', 'g'), 9) = v_digits
  order by mp.updated_at desc nulls last, mp.id desc
  limit 1;
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'no_tree_person');
  end if;
  return public.admin_family_admin_set_v1(p_token, v_id, p_action);
end;
$fn$;

create or replace function public.family_admin_search_people_v1(
  p_phone text,
  p_query text,
  p_branch_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_gate jsonb;
  v_q text;
  v_branch text;
begin
  v_gate := public.family_admin_require_v1(p_phone);
  if coalesce((v_gate->>'ok')::boolean, false) is not true then
    return v_gate || jsonb_build_object('rows', '[]'::jsonb);
  end if;
  v_q := nullif(btrim(coalesce(p_query, '')), '');
  v_branch := nullif(btrim(coalesce(p_branch_key, '')), '');
  if v_q is not null then
    v_q := replace(replace(v_q, '%', ''), '_', '');
  end if;
  if v_q is null or char_length(v_q) < 2 then
    return jsonb_build_object('ok', true, 'need_query', true, 'rows', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'ok', true,
    'rows', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.display_name)
      from (
        select
          c.id,
          c.person_id,
          c.branch_key,
          nullif(btrim(regexp_replace(coalesce(c.child_name, to_jsonb(c)->>'name', ''), '^.*/', '')), '') as display_name,
          nullif(btrim(coalesce(c.child_name, to_jsonb(c)->>'name', '')), '') as path,
          c.gender,
          coalesce(c.is_deceased, false) as is_deceased,
          mp.phone,
          mp.status
        from public.tree_children c
        left join lateral (
          select p.phone, p.status
          from public.member_profiles p
          where p.tree_child_id = c.id
             or (c.person_id is not null and p.person_id is not distinct from c.person_id)
          order by p.updated_at desc nulls last, p.id desc
          limit 1
        ) mp on true
        where (v_branch is null or c.branch_key = v_branch)
          and (
            position(v_q in coalesce(c.child_name, to_jsonb(c)->>'name', '')) > 0
            or coalesce(c.child_name, to_jsonb(c)->>'name', '') ilike '%' || v_q || '%'
          )
        order by c.id desc
        limit 40
      ) r
    ), '[]'::jsonb)
  );
end;
$fn$;

create or replace function public.family_admin_update_person_v1(
  p_phone text,
  p_tree_child_id bigint,
  p_display_name text,
  p_gender text,
  p_is_deceased boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_gate jsonb;
  v_child public.tree_children%rowtype;
  v_leaf text;
  v_path text;
  v_new_path text;
  v_gender text;
begin
  v_gate := public.family_admin_require_v1(p_phone);
  if coalesce((v_gate->>'ok')::boolean, false) is not true then
    return v_gate;
  end if;
  if p_tree_child_id is null or p_tree_child_id < 1 then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;
  select * into v_child from public.tree_children where id = p_tree_child_id limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'person_not_found');
  end if;

  v_path := coalesce(v_child.child_name, to_jsonb(v_child)->>'name', '');
  v_leaf := nullif(btrim(coalesce(p_display_name, '')), '');
  if v_leaf is not null then
    v_leaf := regexp_replace(v_leaf, '[/\\]', ' ', 'g');
    if v_path like '%/%' then
      v_new_path := regexp_replace(v_path, '[^/]+$', v_leaf);
    else
      v_new_path := v_leaf;
    end if;
  else
    v_new_path := v_path;
  end if;

  if to_regprocedure('public.tree_child_normalize_gender(text)') is not null then
    v_gender := public.tree_child_normalize_gender(p_gender);
  else
    v_gender := case
      when lower(btrim(coalesce(p_gender, ''))) in ('daughter', 'female', 'f', 'أنثى', 'انثى', 'ابنة', 'بنت') then 'daughter'
      when lower(btrim(coalesce(p_gender, ''))) in ('son', 'male', 'm', 'ذكر', 'ابن', 'ولد') then 'son'
      else null
    end;
  end if;

  update public.tree_children c
  set
    child_name = coalesce(nullif(btrim(v_new_path), ''), c.child_name),
    name = coalesce(nullif(btrim(v_new_path), ''), c.name),
    gender = coalesce(v_gender, c.gender),
    is_deceased = coalesce(p_is_deceased, c.is_deceased, false)
  where c.id = p_tree_child_id;

  return jsonb_build_object('ok', true, 'id', p_tree_child_id);
end;
$fn$;

create or replace function public.family_admin_set_phone_v1(
  p_phone text,
  p_tree_child_id bigint,
  p_member_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_gate jsonb;
  v_child public.tree_children%rowtype;
  v_bind jsonb;
  v_member_phone text;
  v_digits text;
  v_keep_id bigint;
  v_leaf text;
  v_other_pid text;
begin
  v_gate := public.family_admin_require_v1(p_phone);
  if coalesce((v_gate->>'ok')::boolean, false) is not true then
    return v_gate;
  end if;
  if p_tree_child_id is null or p_tree_child_id < 1 then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;
  v_member_phone := nullif(btrim(coalesce(p_member_phone, '')), '');
  if v_member_phone is null then
    return jsonb_build_object('ok', false, 'error', 'bad_phone');
  end if;
  select * into v_child from public.tree_children where id = p_tree_child_id limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'person_not_found');
  end if;

  if to_regprocedure('public.bind_sender_phone_to_person_v1(text, text, bigint)') is not null then
    v_bind := public.bind_sender_phone_to_person_v1(
      v_member_phone,
      coalesce(v_child.person_id::text, ''),
      v_child.id
    );
    if coalesce((v_bind->>'ok')::boolean, false) is not true then
      return jsonb_build_object('ok', false, 'error', coalesce(v_bind->>'error', 'bind_failed'), 'detail', v_bind);
    end if;
  else
    v_digits := right(regexp_replace(v_member_phone, '[^0-9]', '', 'g'), 9);
    if char_length(coalesce(v_digits, '')) < 9 then
      return jsonb_build_object('ok', false, 'error', 'bad_phone');
    end if;
    v_leaf := nullif(btrim(regexp_replace(coalesce(v_child.child_name, to_jsonb(v_child)->>'name', ''), '^.*/', '')), '');
    select nullif(btrim(coalesce(mp.person_id::text, '')), '')
      into v_other_pid
    from public.member_profiles mp
    where char_length(v_digits) = 9
      and right(regexp_replace(coalesce(mp.phone, ''), '[^0-9]', '', 'g'), 9) = v_digits
    order by mp.id
    limit 1;
    if v_other_pid is not null
       and v_child.person_id is not null
       and v_other_pid is distinct from v_child.person_id::text then
      return jsonb_build_object('ok', false, 'error', 'phone_conflict');
    end if;
    select mp.id into v_keep_id
    from public.member_profiles mp
    where mp.tree_child_id = v_child.id
       or (v_child.person_id is not null and mp.person_id is not distinct from v_child.person_id)
       or (
         char_length(v_digits) = 9
         and right(regexp_replace(coalesce(mp.phone, ''), '[^0-9]', '', 'g'), 9) = v_digits
       )
    order by (mp.tree_child_id is not distinct from v_child.id) desc, mp.id desc
    limit 1;
    if v_keep_id is not null then
      update public.member_profiles
      set
        phone = v_member_phone,
        branch_key = coalesce(nullif(btrim(coalesce(v_child.branch_key, '')), ''), branch_key),
        tree_child_id = v_child.id,
        person_id = v_child.person_id,
        display_name = coalesce(nullif(btrim(coalesce(display_name, '')), ''), v_leaf),
        status = 'active',
        updated_at = now()
      where id = v_keep_id;
    else
      insert into public.member_profiles (
        phone, branch_key, tree_child_id, person_id, display_name, status, created_at, updated_at
      ) values (
        v_member_phone, v_child.branch_key, v_child.id, v_child.person_id, v_leaf, 'active', now(), now()
      );
    end if;
  end if;

  update public.member_profiles
  set status = 'active', updated_at = now()
  where tree_child_id = v_child.id
     or (v_child.person_id is not null and person_id is not distinct from v_child.person_id);

  return jsonb_build_object('ok', true, 'tree_child_id', v_child.id);
end;
$fn$;

create or replace function public.family_admin_requests_list_v1(p_phone text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_gate jsonb;
begin
  v_gate := public.family_admin_require_v1(p_phone);
  if coalesce((v_gate->>'ok')::boolean, false) is not true then
    return v_gate || jsonb_build_object('rows', '[]'::jsonb);
  end if;
  if to_regclass('public.approval_requests') is null then
    return jsonb_build_object('ok', false, 'error', 'sql_missing', 'rows', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'ok', true,
    'rows', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.created_at desc)
      from (
        select
          ar.id,
          ar.request_id,
          ar.kind,
          nullif(btrim(coalesce(ar.name, '')), '') as name,
          nullif(btrim(coalesce(ar.phone, '')), '') as phone,
          nullif(btrim(coalesce(ar.branch_key, '')), '') as branch_key,
          ar.created_at,
          ar.status
        from public.approval_requests ar
        where coalesce(nullif(btrim(ar.status), ''), 'pending') = 'pending'
          and (
            btrim(coalesce(ar.kind, '')) in ('member_registration', 'member_phone_register')
            or position('MEMBER_PHONE_REGISTER_V1' in coalesce(ar.message, '')) > 0
          )
        order by ar.created_at desc nulls last
        limit 80
      ) r
    ), '[]'::jsonb)
  );
end;
$fn$;

create or replace function public.family_admin_request_reject_v1(p_phone text, p_request_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_gate jsonb;
  v_n int := 0;
begin
  v_gate := public.family_admin_require_v1(p_phone);
  if coalesce((v_gate->>'ok')::boolean, false) is not true then
    return v_gate;
  end if;
  if p_request_id is null or p_request_id < 1 then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;
  update public.approval_requests
  set status = 'rejected'
  where id = p_request_id
    and coalesce(nullif(btrim(status), ''), 'pending') = 'pending';
  get diagnostics v_n = row_count;
  if v_n < 1 then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'id', p_request_id);
end;
$fn$;

create or replace function public.family_admin_request_bind_v1(
  p_phone text,
  p_request_id bigint,
  p_tree_child_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_gate jsonb;
  v_req public.approval_requests%rowtype;
  v_set jsonb;
begin
  v_gate := public.family_admin_require_v1(p_phone);
  if coalesce((v_gate->>'ok')::boolean, false) is not true then
    return v_gate;
  end if;
  if p_request_id is null or p_request_id < 1 or p_tree_child_id is null or p_tree_child_id < 1 then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;
  select * into v_req from public.approval_requests where id = p_request_id limit 1;
  if not found or coalesce(nullif(btrim(v_req.status), ''), 'pending') is distinct from 'pending' then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if nullif(btrim(coalesce(v_req.phone, '')), '') is not null then
    v_set := public.family_admin_set_phone_v1(p_phone, p_tree_child_id, v_req.phone);
    if coalesce((v_set->>'ok')::boolean, false) is not true then
      return v_set;
    end if;
  end if;
  update public.approval_requests set status = 'approved' where id = v_req.id;
  return jsonb_build_object('ok', true, 'id', v_req.id, 'tree_child_id', p_tree_child_id);
end;
$fn$;

create or replace function public.family_admin_devices_list_v1(p_phone text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_gate jsonb;
begin
  v_gate := public.family_admin_require_v1(p_phone);
  if coalesce((v_gate->>'ok')::boolean, false) is not true then
    return v_gate || jsonb_build_object('items', '[]'::jsonb);
  end if;
  if right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 9) is distinct from '551840058' then
    return jsonb_build_object('ok', true, 'items', '[]'::jsonb);
  end if;
  if to_regclass('public.member_trusted_devices') is null then
    return jsonb_build_object('ok', false, 'error', 'sql_missing', 'items', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'ok', true,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id,
        'phone_key', d.phone_key,
        'label', d.label,
        'status', d.status,
        'bound_at', d.bound_at,
        'last_seen_at', d.last_seen_at
      ) order by coalesce(d.last_seen_at, d.bound_at) desc)
      from public.member_trusted_devices d
      where d.status = 'active'
    ), '[]'::jsonb)
  );
end;
$fn$;

create or replace function public.family_admin_device_unbind_v1(p_phone text, p_target_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_gate jsonb;
  v_key text;
  v_n int := 0;
begin
  v_gate := public.family_admin_require_v1(p_phone);
  if coalesce((v_gate->>'ok')::boolean, false) is not true then
    return v_gate;
  end if;
  if right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 9) is distinct from '551840058' then
    return jsonb_build_object('ok', false, 'error', 'unbind_admin_only');
  end if;
  if to_regprocedure('public.member_device_phone_key_v1(text)') is not null then
    v_key := public.member_device_phone_key_v1(p_target_phone);
  else
    v_key := nullif(right(regexp_replace(coalesce(p_target_phone, ''), '[^0-9]', '', 'g'), 9), '');
  end if;
  if v_key is null then
    return jsonb_build_object('ok', false, 'error', 'bad_phone');
  end if;
  if to_regclass('public.member_device_transfers') is not null then
    delete from public.member_device_transfers t where t.phone_key = v_key;
  end if;
  delete from public.member_trusted_devices d where d.phone_key = v_key;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'revoked', v_n);
end;
$fn$;

revoke all on function public.family_admin_session_v1(text) from public;
revoke all on function public.family_admin_require_v1(text) from public;
revoke all on function public.admin_family_admin_get_v1(text, bigint) from public;
revoke all on function public.admin_family_admin_set_v1(text, bigint, text) from public;
revoke all on function public.admin_family_admin_set_by_phone_v1(text, text, text) from public;
revoke all on function public.family_admin_search_people_v1(text, text, text) from public;
revoke all on function public.family_admin_update_person_v1(text, bigint, text, text, boolean) from public;
revoke all on function public.family_admin_set_phone_v1(text, bigint, text) from public;
revoke all on function public.family_admin_requests_list_v1(text) from public;
revoke all on function public.family_admin_request_reject_v1(text, bigint) from public;
revoke all on function public.family_admin_request_bind_v1(text, bigint, bigint) from public;
revoke all on function public.family_admin_devices_list_v1(text) from public;
revoke all on function public.family_admin_device_unbind_v1(text, text) from public;

grant execute on function public.family_admin_session_v1(text) to anon, authenticated;
grant execute on function public.admin_family_admin_get_v1(text, bigint) to anon, authenticated;
grant execute on function public.admin_family_admin_set_v1(text, bigint, text) to anon, authenticated;
grant execute on function public.admin_family_admin_set_by_phone_v1(text, text, text) to anon, authenticated;
grant execute on function public.family_admin_search_people_v1(text, text, text) to anon, authenticated;
grant execute on function public.family_admin_update_person_v1(text, bigint, text, text, boolean) to anon, authenticated;
grant execute on function public.family_admin_set_phone_v1(text, bigint, text) to anon, authenticated;
grant execute on function public.family_admin_requests_list_v1(text) to anon, authenticated;
grant execute on function public.family_admin_request_reject_v1(text, bigint) to anon, authenticated;
grant execute on function public.family_admin_request_bind_v1(text, bigint, bigint) to anon, authenticated;
grant execute on function public.family_admin_devices_list_v1(text) to anon, authenticated;
grant execute on function public.family_admin_device_unbind_v1(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
select
  to_regprocedure('public.family_admin_session_v1(text)') is not null as has_session,
  to_regprocedure('public.admin_family_admin_set_by_phone_v1(text, text, text)') is not null as has_grant_by_phone,
  to_regprocedure('public.family_admin_search_people_v1(text, text, text)') is not null as has_search;
