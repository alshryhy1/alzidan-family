-- COPY-ME: Preset id: maint.member_add_person_v1
-- Open this file, Select All, paste in Supabase SQL Editor. Safe to re-run.
--
-- Registered family phone adds a son/newborn under THEIR tree only
-- (themselves or a descendant). Not under cousins or any other person.

create or replace function public.member_add_person_v1(
  p_phone text,
  p_parent_id bigint,
  p_given text,
  p_gender text default 'son',
  p_birth_date text default null,
  p_birth_date_h text default null,
  p_birth_order text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_phone text;
  v_digits text;
  v_owner public.tree_children%rowtype;
  v_parent public.tree_children%rowtype;
  v_exist public.tree_children%rowtype;
  v_mp public.member_profiles%rowtype;
  v_given text;
  v_gender text;
  v_owner_path text;
  v_parent_path text;
  v_child_path text;
  v_birth date;
  v_birth_h text;
  v_order int;
  v_year int;
  v_leaf text;
  v_person uuid;
  v_id bigint;
  v_daughter boolean := false;
begin
  if to_regprocedure('public.member_phone_registered_v1(text)') is null then
    return jsonb_build_object('ok', false, 'error', 'sql_missing');
  end if;

  v_phone := public.member_phone_registered_v1(p_phone);
  if v_phone is null then
    return jsonb_build_object('ok', false, 'error', 'not_registered');
  end if;

  v_given := nullif(btrim(coalesce(p_given, '')), '');
  if v_given is not null then
    v_given := nullif(btrim(split_part(v_given, ' ', 1)), '');
  end if;
  if v_given is null or p_parent_id is null or p_parent_id < 1 then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;
  if position(' ' in v_given) > 0 then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;
  if lower(v_given) in ('بن', 'ابن', 'بنت', 'ال', 'آل') then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;

  v_gender := lower(btrim(coalesce(p_gender, 'son')));
  if v_gender in ('daughter', 'female', 'f', 'أنثى', 'انثى', 'ابنة', 'بنت') then
    v_gender := 'daughter';
  else
    v_gender := 'son';
  end if;

  begin
    v_birth := nullif(btrim(coalesce(p_birth_date, '')), '')::date;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'bad_date');
  end;
  v_birth_h := nullif(btrim(coalesce(p_birth_date_h, '')), '');
  if v_birth_h is not null and v_birth_h !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_date');
  end if;
  begin
    if nullif(btrim(coalesce(p_birth_order, '')), '') is null then
      v_order := null;
    else
      v_order := btrim(p_birth_order)::int;
    end if;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'bad_order');
  end;
  if v_order is not null and v_order < 1 then
    return jsonb_build_object('ok', false, 'error', 'bad_order');
  end if;
  v_year := case when v_birth_h is not null then left(v_birth_h, 4)::int else null end;

  v_digits := nullif(right(regexp_replace(coalesce(v_phone, ''), '[^0-9]', '', 'g'), 9), '');
  if to_regclass('public.member_profiles') is not null and v_digits is not null then
    select mp.*
      into v_mp
    from public.member_profiles mp
    where right(regexp_replace(coalesce(mp.phone, ''), '[^0-9]', '', 'g'), 9) = v_digits
      and coalesce(nullif(btrim(coalesce(mp.status, '')), ''), 'active') is distinct from 'pending_family'
    order by mp.updated_at desc nulls last, mp.id desc
    limit 1;
  end if;

  if coalesce(v_mp.tree_child_id, 0) > 0 then
    select * into v_owner from public.tree_children where id = v_mp.tree_child_id limit 1;
  elsif v_mp.person_id is not null then
    select * into v_owner from public.tree_children where person_id = v_mp.person_id order by id limit 1;
  end if;
  if not found or v_owner.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_placed');
  end if;

  select * into v_parent from public.tree_children where id = p_parent_id limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'person_not_found');
  end if;

  v_owner_path := nullif(btrim(coalesce(v_owner.child_name, to_jsonb(v_owner)->>'name', '')), '');
  v_parent_path := nullif(btrim(coalesce(v_parent.child_name, to_jsonb(v_parent)->>'name', '')), '');
  if v_owner_path is null or v_parent_path is null then
    return jsonb_build_object('ok', false, 'error', 'person_not_found');
  end if;

  if v_parent.id is distinct from v_owner.id
     and v_parent_path is distinct from v_owner_path
     and v_parent_path not like v_owner_path || '/%' then
    return jsonb_build_object('ok', false, 'error', 'not_own_tree');
  end if;

  if to_regprocedure('public.member_role_is_daughter_gender_v1(text)') is not null then
    v_daughter := public.member_role_is_daughter_gender_v1(v_parent.gender);
  else
    v_daughter := lower(btrim(coalesce(v_parent.gender, ''))) in (
      'daughter', 'female', 'f', 'أنثى', 'انثى', 'ابنة', 'بنت'
    );
  end if;
  if v_daughter then
    return jsonb_build_object('ok', false, 'error', 'not_father');
  end if;

  v_child_path := v_parent_path || chr(47) || v_given;
  v_leaf := lower(btrim(split_part(reverse(split_part(reverse(v_parent_path), '/', 1)), ' ', 1)));
  if lower(v_given) = v_leaf then
    return jsonb_build_object('ok', false, 'error', 'same_as_father');
  end if;

  select d.* into v_exist
  from public.tree_children d
  where d.branch_key is not distinct from v_parent.branch_key
    and lower(btrim(split_part(
      reverse(split_part(reverse(coalesce(d.child_name, to_jsonb(d)->>'name', '')), '/', 1)),
      ' ',
      1
    ))) = lower(v_given)
    and (
      (v_parent.person_id is not null and d.parent_person_id is not distinct from v_parent.person_id)
      or coalesce(d.parent_name, to_jsonb(d)->>'parent', '') = v_parent_path
    )
  order by d.id
  limit 1;
  if found then
    return jsonb_build_object('ok', false, 'error', 'name_conflict', 'tree_child_id', v_exist.id);
  end if;

  v_person := gen_random_uuid();
  begin
    insert into public.tree_children (
      branch_key, parent_name, parent, child_name, name,
      person_id, parent_person_id, gender,
      birth_date_g, birth_date_h, birth_year, birth_order, created_at
    ) values (
      v_parent.branch_key, v_parent_path, v_parent_path, v_child_path, v_child_path,
      v_person, v_parent.person_id, v_gender,
      v_birth, v_birth_h, v_year, v_order, now()
    )
    returning id into v_id;
  exception when others then
    begin
      insert into public.tree_children (
        branch_key, parent_name, child_name, person_id, parent_person_id, gender, created_at
      ) values (
        v_parent.branch_key, v_parent_path, v_child_path, v_person, v_parent.person_id, v_gender, now()
      )
      returning id into v_id;
    exception when others then
      return jsonb_build_object('ok', false, 'error', 'insert_failed');
    end;
  end;

  return jsonb_build_object(
    'ok', true,
    'tree_child_id', v_id,
    'person_id', v_person,
    'parent_id', v_parent.id,
    'existing', false
  );
end;
$fn$;

drop function if exists public.member_add_person_v1(text, bigint, text, text, text);

revoke all on function public.member_add_person_v1(text, bigint, text, text, text, text, text) from public;
grant execute on function public.member_add_person_v1(text, bigint, text, text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';

select to_regprocedure('public.member_add_person_v1(text, bigint, text, text, text, text, text)') is not null
  as has_member_add_person_v1;
