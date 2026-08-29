-- COPY-ME: Preset id: maint.delegate_app_inbox_v1
-- Approved branch delegate inbox in the native app.
-- Identity: trusted device + enabled delegates_v2 row. No website secret.
-- Scope: that branch only. Not family_admin. Not women_manager.
-- Daily: list pending branch requests; approve/reject; bind phone requests
-- to a person in the same branch. Tree editor and events publisher stay on web.
-- Safe to re-run.

create or replace function public.delegate_app_phone_key_v1(p_phone text)
returns text
language plpgsql
immutable
as $fn$
begin
  return nullif(right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 9), '');
end;
$fn$;

create or replace function public.delegate_app_branch_key_v1(p_branch text)
returns text
language plpgsql
immutable
as $fn$
begin
  return nullif(btrim(coalesce(p_branch, '')), '');
end;
$fn$;

create or replace function public.delegate_app_kind_lane_v1(p_kind text, p_message text)
returns text
language plpgsql
immutable
as $fn$
declare
  v_kind text := btrim(coalesce(p_kind, ''));
  v_msg text := coalesce(p_message, '');
begin
  if v_kind in (
    'tree_delegate', 'events_delegate', 'delegate_secret_reset',
    'special_card', 'events_audit', 'tree_audit'
  ) then
    return 'none';
  end if;
  if v_kind in ('member_registration', 'member_phone_register')
     or position('MEMBER_PHONE_REGISTER_V1' in v_msg) > 0 then
    return 'phone';
  end if;
  if v_kind in (
    'event_card', 'family_event', 'event_request',
    'occasion', 'patient', 'health', 'event_death'
  ) then
    return 'events';
  end if;
  if v_kind in (
    'tree_card', 'tree_edit', 'memory_card',
    'add_person', 'memory', 'tree_founder'
  ) then
    return 'tree';
  end if;
  return 'none';
end;
$fn$;

create or replace function public.delegate_app_can_read_lane_v1(p_role text, p_lane text)
returns boolean
language plpgsql
immutable
as $fn$
declare
  v_role text := btrim(coalesce(p_role, ''));
  v_lane text := btrim(coalesce(p_lane, ''));
begin
  if v_lane is null or v_lane = '' or v_lane = 'none' then
    return false;
  end if;
  if v_role = 'full_delegate' then
    return true;
  end if;
  if v_role = 'branch_editor' then
    return v_lane in ('tree', 'phone');
  end if;
  if v_role = 'events_editor' then
    return v_lane = 'events';
  end if;
  return false;
end;
$fn$;

create or replace function public.delegate_app_can_write_lane_v1(p_role text, p_lane text)
returns boolean
language plpgsql
immutable
as $fn$
begin
  return public.delegate_app_can_read_lane_v1(p_role, p_lane);
end;
$fn$;

create or replace function public.delegate_app_session_v1(p_phone text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_digits text;
  v_row public.delegates_v2%rowtype;
  v_role text;
  v_branch text;
begin
  v_digits := public.delegate_app_phone_key_v1(p_phone);
  if v_digits is null or char_length(v_digits) < 9 then
    return jsonb_build_object('ok', true, 'enabled', false, 'reason', 'bad_phone');
  end if;
  if to_regclass('public.delegates_v2') is null then
    return jsonb_build_object('ok', true, 'enabled', false, 'reason', 'no_table');
  end if;

  select d.*
    into v_row
  from public.delegates_v2 d
  where coalesce(d.is_enabled, false) is true
    and public.delegate_app_phone_key_v1(d.phone) = v_digits
    and btrim(coalesce(d.role_key, '')) in ('branch_editor', 'events_editor', 'full_delegate')
  order by d.updated_at desc nulls last, d.created_at desc nulls last
  limit 1;
  if not found then
    return jsonb_build_object('ok', true, 'enabled', false, 'reason', 'no_delegate');
  end if;

  v_role := btrim(coalesce(v_row.role_key, ''));
  v_branch := public.delegate_app_branch_key_v1(v_row.branch_key);
  if v_branch is null then
    return jsonb_build_object('ok', true, 'enabled', false, 'reason', 'no_branch');
  end if;

  return jsonb_build_object(
    'ok', true,
    'enabled', true,
    'branch_key', v_branch,
    'role_key', v_role,
    'name', nullif(btrim(coalesce(v_row.name, '')), ''),
    'can_tree', public.delegate_app_can_write_lane_v1(v_role, 'tree'),
    'can_events', public.delegate_app_can_write_lane_v1(v_role, 'events'),
    'can_phone', public.delegate_app_can_write_lane_v1(v_role, 'phone')
  );
end;
$fn$;

create or replace function public.delegate_app_require_v1(p_phone text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_session jsonb;
begin
  v_session := public.delegate_app_session_v1(p_phone);
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

create or replace function public.delegate_app_requests_list_v1(p_phone text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_gate jsonb;
  v_branch text;
  v_role text;
begin
  v_gate := public.delegate_app_require_v1(p_phone);
  if coalesce((v_gate->>'ok')::boolean, false) is not true then
    return v_gate || jsonb_build_object('rows', '[]'::jsonb);
  end if;
  if to_regclass('public.approval_requests') is null then
    return jsonb_build_object('ok', false, 'error', 'sql_missing', 'rows', '[]'::jsonb);
  end if;
  v_branch := v_gate->>'branch_key';
  v_role := v_gate->>'role_key';
  return jsonb_build_object(
    'ok', true,
    'branch_key', v_branch,
    'role_key', v_role,
    'can_tree', coalesce((v_gate->>'can_tree')::boolean, false),
    'can_events', coalesce((v_gate->>'can_events')::boolean, false),
    'can_phone', coalesce((v_gate->>'can_phone')::boolean, false),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.created_at desc)
      from (
        select
          ar.id,
          ar.request_id,
          ar.kind,
          public.delegate_app_kind_lane_v1(ar.kind, ar.message) as lane,
          nullif(btrim(coalesce(ar.name, '')), '') as name,
          nullif(btrim(coalesce(ar.phone, '')), '') as phone,
          nullif(btrim(coalesce(ar.branch_key, '')), '') as branch_key,
          ar.created_at,
          ar.status,
          nullif(btrim(left(
            regexp_replace(
              split_part(coalesce(ar.message, ''), '__JSON__', 1),
              E'[\\n\\r]+',
              ' · ',
              'g'
            ),
            280
          )), '') as detail
        from public.approval_requests ar
        where coalesce(nullif(btrim(ar.status), ''), 'pending') = 'pending'
          and public.delegate_app_branch_key_v1(ar.branch_key) = v_branch
          and public.delegate_app_can_read_lane_v1(
            v_role,
            public.delegate_app_kind_lane_v1(ar.kind, ar.message)
          )
        order by ar.created_at desc nulls last
        limit 80
      ) r
    ), '[]'::jsonb)
  );
end;
$fn$;

create or replace function public.delegate_app_request_set_v1(
  p_phone text,
  p_request_id bigint,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_gate jsonb;
  v_req public.approval_requests%rowtype;
  v_status text;
  v_lane text;
  v_branch text;
  v_role text;
  v_reviewer text;
  v_stamp text;
  v_msg text;
  v_n int := 0;
begin
  v_gate := public.delegate_app_require_v1(p_phone);
  if coalesce((v_gate->>'ok')::boolean, false) is not true then
    return v_gate;
  end if;
  v_status := case
    when lower(btrim(coalesce(p_status, ''))) = 'approved' then 'approved'
    when lower(btrim(coalesce(p_status, ''))) = 'rejected' then 'rejected'
    else null
  end;
  if v_status is null or p_request_id is null or p_request_id < 1 then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;

  select * into v_req from public.approval_requests where id = p_request_id limit 1;
  if not found or coalesce(nullif(btrim(v_req.status), ''), 'pending') is distinct from 'pending' then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  v_branch := v_gate->>'branch_key';
  v_role := v_gate->>'role_key';
  if public.delegate_app_branch_key_v1(v_req.branch_key) is distinct from v_branch then
    return jsonb_build_object('ok', false, 'error', 'wrong_branch');
  end if;
  v_lane := public.delegate_app_kind_lane_v1(v_req.kind, v_req.message);
  if v_lane = 'phone' then
    return jsonb_build_object('ok', false, 'error', 'bind_required');
  end if;
  if not public.delegate_app_can_write_lane_v1(v_role, v_lane) then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;

  v_reviewer := nullif(btrim(coalesce(v_gate->>'name', '')), '');
  if v_reviewer is not null then
    v_stamp := E'\n---\nتمت مراجعة الطلب بواسطة المندوب: ' || v_reviewer || '.';
  else
    v_stamp := E'\n---\nتمت مراجعة الطلب بواسطة مندوب الفرع.';
  end if;
  v_msg := coalesce(v_req.message, '');
  if position('تمت مراجعة الطلب بواسطة' in v_msg) = 0 then
    v_msg := v_msg || v_stamp;
  end if;

  update public.approval_requests
  set status = v_status, message = v_msg
  where id = v_req.id
    and coalesce(nullif(btrim(status), ''), 'pending') = 'pending';
  get diagnostics v_n = row_count;
  if v_n < 1 then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'id', v_req.id, 'status', v_status);
end;
$fn$;

create or replace function public.delegate_app_search_people_v1(
  p_phone text,
  p_query text
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
  v_gate := public.delegate_app_require_v1(p_phone);
  if coalesce((v_gate->>'ok')::boolean, false) is not true then
    return v_gate || jsonb_build_object('rows', '[]'::jsonb);
  end if;
  if coalesce((v_gate->>'can_phone')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'error', 'not_allowed', 'rows', '[]'::jsonb);
  end if;
  v_branch := v_gate->>'branch_key';
  v_q := replace(replace(nullif(btrim(coalesce(p_query, '')), ''), '%', ''), '_', '');
  if v_q is null or char_length(v_q) < 2 then
    return jsonb_build_object('ok', true, 'need_query', true, 'rows', '[]'::jsonb);
  end if;
  if to_regclass('public.tree_children') is null then
    return jsonb_build_object('ok', false, 'error', 'sql_missing', 'rows', '[]'::jsonb);
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
        where public.delegate_app_branch_key_v1(c.branch_key) = v_branch
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

create or replace function public.delegate_app_request_bind_v1(
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
  v_child public.tree_children%rowtype;
  v_lane text;
  v_branch text;
  v_member_phone text;
  v_bind jsonb;
  v_digits text;
  v_keep_id bigint;
  v_leaf text;
  v_other_pid text;
  v_reviewer text;
  v_stamp text;
  v_msg text;
begin
  v_gate := public.delegate_app_require_v1(p_phone);
  if coalesce((v_gate->>'ok')::boolean, false) is not true then
    return v_gate;
  end if;
  if coalesce((v_gate->>'can_phone')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;
  if p_request_id is null or p_request_id < 1 or p_tree_child_id is null or p_tree_child_id < 1 then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;

  select * into v_req from public.approval_requests where id = p_request_id limit 1;
  if not found or coalesce(nullif(btrim(v_req.status), ''), 'pending') is distinct from 'pending' then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  v_branch := v_gate->>'branch_key';
  v_lane := public.delegate_app_kind_lane_v1(v_req.kind, v_req.message);
  if v_lane is distinct from 'phone' then
    return jsonb_build_object('ok', false, 'error', 'not_phone');
  end if;
  if public.delegate_app_branch_key_v1(v_req.branch_key) is distinct from v_branch then
    return jsonb_build_object('ok', false, 'error', 'wrong_branch');
  end if;

  select * into v_child from public.tree_children where id = p_tree_child_id limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'person_not_found');
  end if;
  if public.delegate_app_branch_key_v1(v_child.branch_key) is distinct from v_branch then
    return jsonb_build_object('ok', false, 'error', 'wrong_branch');
  end if;

  v_member_phone := nullif(btrim(coalesce(v_req.phone, '')), '');
  if v_member_phone is null then
    return jsonb_build_object('ok', false, 'error', 'bad_phone');
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
    v_digits := public.delegate_app_phone_key_v1(v_member_phone);
    if v_digits is null then
      return jsonb_build_object('ok', false, 'error', 'bad_phone');
    end if;
    v_leaf := nullif(btrim(regexp_replace(coalesce(v_child.child_name, to_jsonb(v_child)->>'name', ''), '^.*/', '')), '');
    select nullif(btrim(coalesce(mp.person_id::text, '')), '')
      into v_other_pid
    from public.member_profiles mp
    where public.delegate_app_phone_key_v1(mp.phone) = v_digits
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
       or public.delegate_app_phone_key_v1(mp.phone) = v_digits
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

  v_reviewer := nullif(btrim(coalesce(v_gate->>'name', '')), '');
  if v_reviewer is not null then
    v_stamp := E'\n---\nتمت مراجعة الطلب بواسطة المندوب: ' || v_reviewer || '.';
  else
    v_stamp := E'\n---\nتمت مراجعة الطلب بواسطة مندوب الفرع.';
  end if;
  v_msg := coalesce(v_req.message, '');
  if position('تمت مراجعة الطلب بواسطة' in v_msg) = 0 then
    v_msg := v_msg || v_stamp;
  end if;

  update public.approval_requests
  set status = 'approved', message = v_msg
  where id = v_req.id
    and coalesce(nullif(btrim(status), ''), 'pending') = 'pending';

  return jsonb_build_object('ok', true, 'id', v_req.id, 'tree_child_id', v_child.id);
end;
$fn$;

revoke all on function public.delegate_app_phone_key_v1(text) from public;
revoke all on function public.delegate_app_branch_key_v1(text) from public;
revoke all on function public.delegate_app_kind_lane_v1(text, text) from public;
revoke all on function public.delegate_app_can_read_lane_v1(text, text) from public;
revoke all on function public.delegate_app_can_write_lane_v1(text, text) from public;
revoke all on function public.delegate_app_session_v1(text) from public;
revoke all on function public.delegate_app_require_v1(text) from public;
revoke all on function public.delegate_app_requests_list_v1(text) from public;
revoke all on function public.delegate_app_request_set_v1(text, bigint, text) from public;
revoke all on function public.delegate_app_search_people_v1(text, text) from public;
revoke all on function public.delegate_app_request_bind_v1(text, bigint, bigint) from public;

grant execute on function public.delegate_app_session_v1(text) to anon, authenticated;
grant execute on function public.delegate_app_requests_list_v1(text) to anon, authenticated;
grant execute on function public.delegate_app_request_set_v1(text, bigint, text) to anon, authenticated;
grant execute on function public.delegate_app_search_people_v1(text, text) to anon, authenticated;
grant execute on function public.delegate_app_request_bind_v1(text, bigint, bigint) to anon, authenticated;

notify pgrst, 'reload schema';
select
  to_regprocedure('public.delegate_app_session_v1(text)') is not null as has_session,
  to_regprocedure('public.delegate_app_requests_list_v1(text)') is not null as has_list,
  to_regprocedure('public.delegate_app_request_set_v1(text, bigint, text)') is not null as has_set,
  to_regprocedure('public.delegate_app_request_bind_v1(text, bigint, bigint)') is not null as has_bind;
