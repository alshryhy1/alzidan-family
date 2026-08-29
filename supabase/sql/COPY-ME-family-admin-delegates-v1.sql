-- COPY-ME: Preset id: maint.family_admin_delegates_v1
-- Family admin in the app: accept/reject delegate requests + change delegate
-- roles / enable like the web panel. No admin_token. Trusted device + family_admin.
-- Member phone bind stays as-is. Tree cards, events, wives, SQL stay on the web.
-- Safe to re-run.

create or replace function public.family_admin_request_is_daily_v1(
  p_kind text,
  p_message text,
  p_request_type text
)
returns boolean
language sql
immutable
as $fn$
  select
    btrim(coalesce(p_kind, '')) in (
      'member_registration',
      'member_phone_register',
      'tree_delegate',
      'events_delegate',
      'delegate_secret_reset'
    )
    or position('MEMBER_PHONE_REGISTER_V1' in coalesce(p_message, '')) > 0
    or btrim(coalesce(p_request_type, '')) = 'delegate_secret_reset';
$fn$;

create or replace function public.family_admin_request_is_member_v1(
  p_kind text,
  p_message text
)
returns boolean
language sql
immutable
as $fn$
  select
    btrim(coalesce(p_kind, '')) in ('member_registration', 'member_phone_register')
    or position('MEMBER_PHONE_REGISTER_V1' in coalesce(p_message, '')) > 0;
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
          nullif(btrim(coalesce(to_jsonb(ar)->>'request_type', '')), '') as request_type,
          nullif(btrim(coalesce(ar.name, '')), '') as name,
          nullif(btrim(coalesce(ar.phone, '')), '') as phone,
          nullif(btrim(coalesce(ar.branch_key, '')), '') as branch_key,
          ar.created_at,
          ar.status
        from public.approval_requests ar
        where coalesce(nullif(btrim(ar.status), ''), 'pending') = 'pending'
          and public.family_admin_request_is_daily_v1(
            ar.kind,
            ar.message,
            to_jsonb(ar)->>'request_type'
          )
        order by ar.created_at desc nulls last
        limit 120
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
  v_req public.approval_requests%rowtype;
  v_n int := 0;
begin
  v_gate := public.family_admin_require_v1(p_phone);
  if coalesce((v_gate->>'ok')::boolean, false) is not true then
    return v_gate;
  end if;
  if p_request_id is null or p_request_id < 1 then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;
  select * into v_req from public.approval_requests where id = p_request_id for update;
  if not found or coalesce(nullif(btrim(v_req.status), ''), 'pending') is distinct from 'pending' then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if not public.family_admin_request_is_daily_v1(
    v_req.kind,
    v_req.message,
    to_jsonb(v_req)->>'request_type'
  ) then
    return jsonb_build_object('ok', false, 'error', 'wrong_kind');
  end if;

  if btrim(coalesce(v_req.kind, '')) = 'delegate_secret_reset'
     or coalesce(to_jsonb(v_req)->>'request_type', '') = 'delegate_secret_reset' then
    update public.approval_requests
    set
      status = 'rejected',
      request_type = 'delegate_secret_reset',
      wf_state = 'rejected',
      wf_updated_at = now()
    where id = v_req.id;
  else
    update public.approval_requests
    set status = 'rejected'
    where id = v_req.id
      and coalesce(nullif(btrim(status), ''), 'pending') = 'pending';
  end if;
  get diagnostics v_n = row_count;
  if v_n < 1 then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'id', p_request_id, 'kind', v_req.kind);
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
  if not public.family_admin_request_is_member_v1(v_req.kind, v_req.message) then
    return jsonb_build_object('ok', false, 'error', 'wrong_kind');
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

create or replace function public.family_admin_request_approve_v1(p_phone text, p_request_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_gate jsonb;
  v_req public.approval_requests%rowtype;
  v_kind text;
  v_sibling text;
  v_wants_dual boolean := false;
  v_base text;
  v_branch text;
  v_phone_n text;
  v_hash text;
  v_email text;
  v_legacy_n int := 0;
  v_v2_n int := 0;
  v_delegate_id uuid;
  v_act jsonb;
begin
  v_gate := public.family_admin_require_v1(p_phone);
  if coalesce((v_gate->>'ok')::boolean, false) is not true then
    return v_gate;
  end if;
  if p_request_id is null or p_request_id < 1 then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;
  select * into v_req from public.approval_requests where id = p_request_id for update;
  if not found or coalesce(nullif(btrim(v_req.status), ''), 'pending') is distinct from 'pending' then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if not public.family_admin_request_is_daily_v1(
    v_req.kind,
    v_req.message,
    to_jsonb(v_req)->>'request_type'
  ) then
    return jsonb_build_object('ok', false, 'error', 'wrong_kind');
  end if;
  if public.family_admin_request_is_member_v1(v_req.kind, v_req.message) then
    return jsonb_build_object('ok', false, 'error', 'bind_required');
  end if;

  v_kind := btrim(coalesce(v_req.kind, ''));

  if v_kind = 'delegate_secret_reset'
     or coalesce(to_jsonb(v_req)->>'request_type', '') = 'delegate_secret_reset' then
    v_hash := nullif(btrim(coalesce(v_req.secret_hash, '')), '');
    if v_hash is null then
      return jsonb_build_object('ok', false, 'error', 'missing_secret_hash');
    end if;
    if to_regprocedure('public.delegate_secret_reset_norm_branch(text)') is not null then
      v_branch := public.delegate_secret_reset_norm_branch(v_req.branch_key);
      v_phone_n := public.delegate_secret_reset_norm_phone(v_req.phone);
      v_email := public.delegate_secret_reset_norm_email(v_req.email);
    else
      v_branch := regexp_replace(btrim(coalesce(v_req.branch_key, '')), '\s+', ' ', 'g');
      v_phone_n := regexp_replace(btrim(coalesce(v_req.phone, '')), '\s+', '', 'g');
      v_email := lower(regexp_replace(btrim(coalesce(v_req.email, '')), '\s+', '', 'g'));
    end if;

    update public.approval_requests r
    set secret_hash = v_hash
    where r.kind in ('tree_delegate', 'events_delegate')
      and r.status = 'approved'
      and regexp_replace(btrim(coalesce(r.branch_key, '')), '\s+', ' ', 'g') = v_branch
      and regexp_replace(btrim(coalesce(r.phone, '')), '\s+', '', 'g') = v_phone_n
      and (
        v_email = ''
        or lower(regexp_replace(btrim(coalesce(r.email, '')), '\s+', '', 'g')) = ''
        or lower(regexp_replace(btrim(coalesce(r.email, '')), '\s+', '', 'g')) = v_email
      );
    get diagnostics v_legacy_n = row_count;

    if to_regclass('public.delegates_v2') is not null then
      update public.delegates_v2 d
      set secret_hash = v_hash, updated_at = now()
      where regexp_replace(btrim(coalesce(d.branch_key, '')), '\s+', ' ', 'g') = v_branch
        and regexp_replace(btrim(coalesce(d.phone, '')), '\s+', '', 'g') = v_phone_n
        and (
          v_email = ''
          or lower(regexp_replace(btrim(coalesce(d.email, '')), '\s+', '', 'g')) = ''
          or lower(regexp_replace(btrim(coalesce(d.email, '')), '\s+', '', 'g')) = v_email
        );
      get diagnostics v_v2_n = row_count;
    end if;

    if v_legacy_n = 0 and v_v2_n = 0 then
      return jsonb_build_object('ok', false, 'error', 'no_delegate_target');
    end if;

    update public.approval_requests
    set
      status = 'approved',
      secret_hash = v_hash,
      request_type = 'delegate_secret_reset',
      wf_state = 'done',
      wf_updated_at = now()
    where id = v_req.id;

    return jsonb_build_object('ok', true, 'id', v_req.id, 'kind', v_kind, 'secret_reset', true);
  end if;

  if v_kind not in ('tree_delegate', 'events_delegate') then
    return jsonb_build_object('ok', false, 'error', 'wrong_kind');
  end if;

  v_sibling := case when v_kind = 'tree_delegate' then 'events_delegate' else 'tree_delegate' end;
  v_wants_dual :=
    (
      position('"tree_delegate"' in coalesce(v_req.message, '')) > 0
      and position('"events_delegate"' in coalesce(v_req.message, '')) > 0
    )
    or coalesce(v_req.request_id, '') ~* '-(TREE|EVENTS)$';
  v_base := regexp_replace(coalesce(v_req.request_id, ''), '-(TREE|EVENTS)$', '', 'i');
  v_branch := regexp_replace(btrim(coalesce(v_req.branch_key, '')), '\s+', ' ', 'g');
  v_phone_n := regexp_replace(btrim(coalesce(v_req.phone, '')), '\s+', '', 'g');

  update public.approval_requests set status = 'approved' where id = v_req.id;

  if v_wants_dual and v_base <> '' and v_branch <> '' and v_phone_n <> '' then
    update public.approval_requests r
    set status = 'approved'
    where r.id is distinct from v_req.id
      and r.kind = v_sibling
      and coalesce(nullif(btrim(r.status), ''), 'pending') = 'pending'
      and regexp_replace(btrim(coalesce(r.branch_key, '')), '\s+', ' ', 'g') = v_branch
      and regexp_replace(btrim(coalesce(r.phone, '')), '\s+', '', 'g') = v_phone_n
      and (
        regexp_replace(coalesce(r.request_id, ''), '-(TREE|EVENTS)$', '', 'i') = v_base
        or r.request_id = v_base || case when v_sibling = 'tree_delegate' then '-TREE' else '-EVENTS' end
      );
  end if;

  if to_regprocedure('public.delegates_v2_activate_from_request_pk_v1(bigint)') is not null then
    v_act := public.delegates_v2_activate_from_request_pk_v1(v_req.id);
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', v_req.id,
    'kind', v_kind,
    'role_key', coalesce(v_act->>'role_key', ''),
    'activate', coalesce(v_act, '{}'::jsonb)
  );
end;
$fn$;

create or replace function public.family_admin_delegates_list_v1(p_phone text)
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
    return v_gate || jsonb_build_object('rows', '[]'::jsonb, 'roles', '[]'::jsonb);
  end if;
  if to_regclass('public.delegates_v2') is null then
    return jsonb_build_object('ok', false, 'error', 'sql_missing', 'rows', '[]'::jsonb, 'roles', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'ok', true,
    'rows', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.is_enabled desc, x.branch_key, x.name)
      from (
        select
          d.id,
          d.branch_key,
          d.name,
          d.phone,
          d.email,
          d.role_key,
          coalesce(r.title_ar, d.role_key) as role_title_ar,
          coalesce(d.is_enabled, false) as is_enabled
        from public.delegates_v2 d
        left join public.delegate_roles r on r.role_key = d.role_key
        order by d.is_enabled desc, d.branch_key asc nulls last, d.name asc nulls last
        limit 500
      ) x
    ), '[]'::jsonb),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object('role_key', r.role_key, 'title_ar', r.title_ar) order by r.sort_order, r.role_key)
      from public.delegate_roles r
    ), jsonb_build_array(
      jsonb_build_object('role_key', 'viewer', 'title_ar', 'عرض فقط'),
      jsonb_build_object('role_key', 'branch_editor', 'title_ar', 'محرر فرع'),
      jsonb_build_object('role_key', 'events_editor', 'title_ar', 'محرر مناسبات'),
      jsonb_build_object('role_key', 'full_delegate', 'title_ar', 'مندوب كامل'),
      jsonb_build_object('role_key', 'approver_l1', 'title_ar', 'معتمد مرحلة 1')
    ))
  );
end;
$fn$;

create or replace function public.family_admin_delegates_set_role_v1(
  p_phone text,
  p_id text,
  p_role_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_gate jsonb;
  v_id uuid;
  v_role text;
  v_branch text;
  v_prev text;
begin
  v_gate := public.family_admin_require_v1(p_phone);
  if coalesce((v_gate->>'ok')::boolean, false) is not true then
    return v_gate;
  end if;
  begin
    v_id := nullif(btrim(coalesce(p_id, '')), '')::uuid;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end;
  v_role := nullif(btrim(coalesce(p_role_key, '')), '');
  if v_id is null or v_role is null then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;
  if to_regclass('public.delegates_v2') is null then
    return jsonb_build_object('ok', false, 'error', 'sql_missing');
  end if;
  if to_regclass('public.delegate_roles') is not null
     and not exists (select 1 from public.delegate_roles where role_key = v_role) then
    return jsonb_build_object('ok', false, 'error', 'unknown_role');
  end if;

  select role_key, branch_key into v_prev, v_branch
  from public.delegates_v2
  where id = v_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  update public.delegates_v2
  set role_key = v_role, updated_at = now()
  where id = v_id;

  begin
    perform public.admin_audit_write_v1(
      'family_admin', null, 'delegate.role_set', 'delegates_v2', v_id::text, v_branch,
      jsonb_build_object('role_key', v_role, 'previous_role_key', v_prev, 'at', now())
    );
  exception when others then null;
  end;

  return jsonb_build_object(
    'ok', true,
    'id', v_id,
    'role_key', v_role,
    'previous_role_key', v_prev
  );
end;
$fn$;

create or replace function public.family_admin_delegates_set_enabled_v1(
  p_phone text,
  p_id text,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_gate jsonb;
  v_id uuid;
  v_row public.delegates_v2%rowtype;
  v_status text;
  v_branch text;
  v_phone_n text;
  v_email text;
begin
  v_gate := public.family_admin_require_v1(p_phone);
  if coalesce((v_gate->>'ok')::boolean, false) is not true then
    return v_gate;
  end if;
  begin
    v_id := nullif(btrim(coalesce(p_id, '')), '')::uuid;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end;
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;
  if to_regclass('public.delegates_v2') is null then
    return jsonb_build_object('ok', false, 'error', 'sql_missing');
  end if;

  select * into v_row from public.delegates_v2 where id = v_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  v_status := case when coalesce(p_enabled, false) then 'approved' else 'rejected' end;
  v_branch := regexp_replace(btrim(coalesce(v_row.branch_key, '')), '\s+', ' ', 'g');
  v_phone_n := regexp_replace(btrim(coalesce(v_row.phone, '')), '\s+', '', 'g');
  v_email := lower(regexp_replace(btrim(coalesce(v_row.email, '')), '\s+', '', 'g'));

  if to_regclass('public.approval_requests') is not null then
    if nullif(btrim(coalesce(v_row.tree_request_id, '')), '') is not null then
      update public.approval_requests
      set status = v_status
      where request_id = v_row.tree_request_id
        and kind = 'tree_delegate';
    end if;
    if nullif(btrim(coalesce(v_row.events_request_id, '')), '') is not null then
      update public.approval_requests
      set status = v_status
      where request_id = v_row.events_request_id
        and kind = 'events_delegate';
    end if;
    if nullif(v_branch, '') is not null and nullif(v_phone_n, '') is not null then
      update public.approval_requests r
      set status = v_status
      where r.kind in ('tree_delegate', 'events_delegate')
        and regexp_replace(btrim(coalesce(r.branch_key, '')), '\s+', ' ', 'g') = v_branch
        and regexp_replace(btrim(coalesce(r.phone, '')), '\s+', '', 'g') = v_phone_n
        and (
          v_email = ''
          or lower(regexp_replace(btrim(coalesce(r.email, '')), '\s+', '', 'g')) = ''
          or lower(regexp_replace(btrim(coalesce(r.email, '')), '\s+', '', 'g')) = v_email
        );
    end if;
  end if;

  update public.delegates_v2
  set is_enabled = coalesce(p_enabled, false),
      updated_at = now()
  where id = v_id;

  begin
    perform public.admin_audit_write_v1(
      'family_admin', null,
      case when coalesce(p_enabled, false) then 'delegate.enable' else 'delegate.disable' end,
      'delegates_v2', v_id::text, v_row.branch_key,
      jsonb_build_object(
        'enabled', coalesce(p_enabled, false),
        'role_key', v_row.role_key,
        'phone', v_row.phone,
        'email', v_row.email,
        'at', now()
      )
    );
  exception when others then null;
  end;

  return jsonb_build_object(
    'ok', true,
    'id', v_id,
    'is_enabled', coalesce(p_enabled, false)
  );
end;
$fn$;

revoke all on function public.family_admin_request_is_daily_v1(text, text, text) from public;
revoke all on function public.family_admin_request_is_member_v1(text, text) from public;
revoke all on function public.family_admin_requests_list_v1(text) from public;
revoke all on function public.family_admin_request_reject_v1(text, bigint) from public;
revoke all on function public.family_admin_request_bind_v1(text, bigint, bigint) from public;
revoke all on function public.family_admin_request_approve_v1(text, bigint) from public;
revoke all on function public.family_admin_delegates_list_v1(text) from public;
revoke all on function public.family_admin_delegates_set_role_v1(text, text, text) from public;
revoke all on function public.family_admin_delegates_set_enabled_v1(text, text, boolean) from public;

grant execute on function public.family_admin_request_is_daily_v1(text, text, text) to anon, authenticated;
grant execute on function public.family_admin_request_is_member_v1(text, text) to anon, authenticated;
grant execute on function public.family_admin_requests_list_v1(text) to anon, authenticated;
grant execute on function public.family_admin_request_reject_v1(text, bigint) to anon, authenticated;
grant execute on function public.family_admin_request_bind_v1(text, bigint, bigint) to anon, authenticated;
grant execute on function public.family_admin_request_approve_v1(text, bigint) to anon, authenticated;
grant execute on function public.family_admin_delegates_list_v1(text) to anon, authenticated;
grant execute on function public.family_admin_delegates_set_role_v1(text, text, text) to anon, authenticated;
grant execute on function public.family_admin_delegates_set_enabled_v1(text, text, boolean) to anon, authenticated;

notify pgrst, 'reload schema';
select
  to_regprocedure('public.family_admin_request_approve_v1(text, bigint)') is not null as has_approve,
  to_regprocedure('public.family_admin_delegates_list_v1(text)') is not null as has_delegates_list,
  to_regprocedure('public.family_admin_delegates_set_role_v1(text, text, text)') is not null as has_set_role;
