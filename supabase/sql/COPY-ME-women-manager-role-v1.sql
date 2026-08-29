-- COPY-ME: Preset id: maint.women_manager_role_v1
-- Independent women_manager grant. Not gender-alone. Not admin_token in the app.
-- Does not alter tree_children rows or tree structure.
-- Safe to re-run.

create table if not exists public.member_role_grants (
  id bigint generated always as identity primary key,
  role_key text not null,
  tree_child_id bigint not null references public.tree_children(id) on delete cascade,
  person_id uuid,
  status text not null default 'active',
  assigned_at timestamptz not null default now(),
  assigned_by text,
  updated_at timestamptz not null default now(),
  constraint member_role_grants_status_chk check (status in ('active', 'suspended')),
  constraint member_role_grants_role_child_uidx unique (tree_child_id, role_key)
);

create index if not exists member_role_grants_person_idx
  on public.member_role_grants (person_id)
  where person_id is not null;

create index if not exists member_role_grants_role_status_idx
  on public.member_role_grants (role_key, status);

comment on table public.member_role_grants is
  'Independent member roles (e.g. women_manager). Not a women tree. Not gender.';

alter table public.member_role_grants enable row level security;
revoke all on table public.member_role_grants from public, anon, authenticated;

create or replace function public.member_role_is_daughter_gender_v1(p_gender text)
returns boolean
language sql
immutable
as $fn$
  select lower(btrim(coalesce(p_gender, ''))) in (
    'daughter', 'female', 'f', 'أنثى', 'انثى', 'ابنة', 'بنت'
  );
$fn$;

create or replace function public.women_manager_eligibility_v1(p_tree_child_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_child public.tree_children%rowtype;
  v_mp public.member_profiles%rowtype;
  v_digits text;
begin
  if p_tree_child_id is null or p_tree_child_id < 1 then
    return jsonb_build_object('ok', false, 'error', 'person_not_found');
  end if;

  select * into v_child from public.tree_children c where c.id = p_tree_child_id limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'person_not_found');
  end if;

  if not public.member_role_is_daughter_gender_v1(v_child.gender) then
    return jsonb_build_object(
      'ok', false,
      'error', 'not_daughter',
      'person_id', v_child.person_id,
      'tree_child_id', v_child.id
    );
  end if;

  select mp.*
    into v_mp
  from public.member_profiles mp
  where coalesce(mp.tree_child_id, 0) = v_child.id
     or (v_child.person_id is not null and mp.person_id is not distinct from v_child.person_id)
  order by
    case when coalesce(mp.tree_child_id, 0) = v_child.id then 0 else 1 end,
    mp.updated_at desc nulls last,
    mp.id desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error', 'no_phone',
      'person_id', v_child.person_id,
      'tree_child_id', v_child.id
    );
  end if;

  v_digits := nullif(right(regexp_replace(coalesce(v_mp.phone, ''), '[^0-9]', '', 'g'), 9), '');
  if v_digits is null or char_length(v_digits) < 9 then
    return jsonb_build_object(
      'ok', false,
      'error', 'no_phone',
      'person_id', v_child.person_id,
      'tree_child_id', v_child.id
    );
  end if;

  if coalesce(nullif(btrim(coalesce(v_mp.status, '')), ''), 'active') is distinct from 'active' then
    return jsonb_build_object(
      'ok', false,
      'error', 'account_inactive',
      'person_id', v_child.person_id,
      'tree_child_id', v_child.id,
      'member_status', v_mp.status
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'person_id', v_child.person_id,
    'tree_child_id', v_child.id,
    'phone', v_mp.phone,
    'member_status', coalesce(v_mp.status, 'active')
  );
end;
$fn$;

create or replace function public.admin_women_manager_get_v1(
  p_token text,
  p_tree_child_id bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_elig jsonb;
  v_grant public.member_role_grants%rowtype;
  v_status text := 'inactive';
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  v_elig := public.women_manager_eligibility_v1(p_tree_child_id);

  select g.*
    into v_grant
  from public.member_role_grants g
  where g.tree_child_id = p_tree_child_id
    and g.role_key = 'women_manager'
  limit 1;

  if found then
    v_status := v_grant.status;
  end if;

  return jsonb_build_object(
    'ok', true,
    'role_key', 'women_manager',
    'status', v_status,
    'eligible', coalesce((v_elig->>'ok')::boolean, false),
    'eligibility_error', v_elig->>'error',
    'tree_child_id', p_tree_child_id,
    'person_id', coalesce(v_grant.person_id, nullif(v_elig->>'person_id', '')::uuid),
    'assigned_at', v_grant.assigned_at,
    'assigned_by', v_grant.assigned_by,
    'updated_at', v_grant.updated_at
  );
end;
$fn$;

create or replace function public.admin_women_manager_set_v1(
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
  v_elig jsonb;
  v_grant public.member_role_grants%rowtype;
  v_prev text := 'inactive';
  v_person_id uuid;
  v_now timestamptz := now();
  v_actor text := 'admin';
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  if v_action not in ('assign', 'suspend') then
    return jsonb_build_object('ok', false, 'error', 'bad_action');
  end if;

  v_elig := public.women_manager_eligibility_v1(p_tree_child_id);

  select g.*
    into v_grant
  from public.member_role_grants g
  where g.tree_child_id = p_tree_child_id
    and g.role_key = 'women_manager'
  limit 1;
  if found then
    v_prev := v_grant.status;
  end if;

  if v_action = 'assign' then
    if coalesce((v_elig->>'ok')::boolean, false) is not true then
      return jsonb_build_object(
        'ok', false,
        'error', coalesce(v_elig->>'error', 'not_eligible'),
        'status', v_prev
      );
    end if;
    v_person_id := nullif(v_elig->>'person_id', '')::uuid;
    insert into public.member_role_grants (
      role_key, tree_child_id, person_id, status, assigned_at, assigned_by, updated_at
    ) values (
      'women_manager', p_tree_child_id, v_person_id, 'active', v_now, v_actor, v_now
    )
    on conflict (tree_child_id, role_key) do update
    set
      status = 'active',
      person_id = coalesce(excluded.person_id, public.member_role_grants.person_id),
      assigned_at = v_now,
      assigned_by = v_actor,
      updated_at = v_now;
  else
    if v_prev = 'inactive' then
      return jsonb_build_object('ok', true, 'status', 'inactive', 'action', 'noop');
    end if;
    update public.member_role_grants
    set status = 'suspended', assigned_by = v_actor, updated_at = v_now
    where tree_child_id = p_tree_child_id
      and role_key = 'women_manager';
  end if;

  begin
    if to_regprocedure('public.admin_audit_write_v1(text,text,text,text,text,text,jsonb)') is not null then
      perform public.admin_audit_write_v1(
        'admin',
        v_actor,
        case when v_action = 'assign' then 'women_manager.assign' else 'women_manager.suspend' end,
        'member_role_grant',
        p_tree_child_id::text,
        null,
        jsonb_build_object(
          'role_key', 'women_manager',
          'action', v_action,
          'previous_status', v_prev,
          'tree_child_id', p_tree_child_id,
          'person_id', v_person_id
        )
      );
    end if;
  exception when others then
    null;
  end;

  return public.admin_women_manager_get_v1(p_token, p_tree_child_id)
    || jsonb_build_object('ok', true, 'action', v_action);
end;
$fn$;

-- App session: phone only. No admin_token.
create or replace function public.women_manager_session_v1(p_phone text)
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
  v_gender text;
begin
  v_digits := nullif(right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 9), '');
  if v_digits is null or char_length(v_digits) < 9 then
    return jsonb_build_object('ok', true, 'enabled', false, 'reason', 'bad_phone');
  end if;

  if to_regclass('public.member_profiles') is null then
    return jsonb_build_object('ok', true, 'enabled', false, 'reason', 'no_profiles');
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

  if to_regclass('public.member_role_grants') is null then
    return jsonb_build_object('ok', true, 'enabled', false, 'reason', 'no_grants');
  end if;

  select g.*
    into v_grant
  from public.member_role_grants g
  where g.role_key = 'women_manager'
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

  select c.gender into v_gender from public.tree_children c where c.id = v_grant.tree_child_id limit 1;
  if not public.member_role_is_daughter_gender_v1(v_gender) then
    return jsonb_build_object('ok', true, 'enabled', false, 'reason', 'not_daughter');
  end if;

  return jsonb_build_object(
    'ok', true,
    'enabled', true,
    'role_key', 'women_manager',
    'tree_child_id', v_grant.tree_child_id,
    'person_id', v_grant.person_id
  );
end;
$fn$;

revoke all on function public.member_role_is_daughter_gender_v1(text) from public, anon, authenticated;
revoke all on function public.women_manager_eligibility_v1(bigint) from public, anon, authenticated;
revoke all on function public.admin_women_manager_get_v1(text, bigint) from public;
revoke all on function public.admin_women_manager_set_v1(text, bigint, text) from public;
revoke all on function public.women_manager_session_v1(text) from public;

grant execute on function public.admin_women_manager_get_v1(text, bigint) to anon, authenticated;
grant execute on function public.admin_women_manager_set_v1(text, bigint, text) to anon, authenticated;
grant execute on function public.women_manager_session_v1(text) to anon, authenticated;

notify pgrst, 'reload schema';

select
  to_regclass('public.member_role_grants') is not null as has_grants_table,
  to_regprocedure('public.admin_women_manager_set_v1(text, bigint, text)') is not null as has_admin_set,
  to_regprocedure('public.women_manager_session_v1(text)') is not null as has_session;
