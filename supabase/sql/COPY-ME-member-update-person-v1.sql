-- COPY-ME: Preset id: maint.member_update_person_v1
-- Open this file, Select All, paste in Supabase SQL Editor. Safe to re-run.
--
-- Registered phone edits a name or birth date on tree_children only:
-- themselves, or a direct child. Same leaf rules and path rewrite as admin rename.

create or replace function public.member_update_person_v1(
  p_phone text,
  p_target_id bigint,
  p_given text,
  p_birth_date text default null,
  p_birth_date_h text default null
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
  v_target public.tree_children%rowtype;
  v_mp public.member_profiles%rowtype;
  v_given text;
  v_old_child text;
  v_old_parent text;
  v_old_leaf text;
  v_new_child text;
  v_owner_path text;
  v_parent_leaf text;
  v_birth date;
  v_birth_h text;
  v_year int;
  v_allowed boolean := false;
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
  if v_given is null or p_target_id is null or p_target_id < 1 then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;
  if position(' ' in v_given) > 0 or position('/' in v_given) > 0 then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;
  if lower(v_given) in ('بن', 'ابن', 'بنت', 'ال', 'آل') then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
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

  select * into v_target from public.tree_children where id = p_target_id limit 1;
  if not found or v_target.id is null then
    return jsonb_build_object('ok', false, 'error', 'person_not_found');
  end if;

  v_owner_path := nullif(btrim(coalesce(v_owner.child_name, v_owner.name, '')), '');
  v_old_parent := nullif(btrim(coalesce(v_target.parent_name, v_target.parent, '')), '');
  v_allowed := v_target.id = v_owner.id
    or (
      v_target.branch_key is not distinct from v_owner.branch_key
      and (
        (v_owner.person_id is not null and v_target.parent_person_id is not distinct from v_owner.person_id)
        or (v_owner_path is not null and v_old_parent is not distinct from v_owner_path)
      )
    );
  if not v_allowed then
    return jsonb_build_object('ok', false, 'error', 'not_own_child');
  end if;

  v_old_child := nullif(btrim(coalesce(v_target.child_name, v_target.name, '')), '');
  if v_old_child is null then
    return jsonb_build_object('ok', false, 'error', 'person_not_found');
  end if;
  v_old_leaf := nullif(btrim(regexp_replace(v_old_child, '^.*/', '')), '');
  v_parent_leaf := case
    when v_old_parent is null then null
    else nullif(btrim(regexp_replace(v_old_parent, '^.*/', '')), '')
  end;
  if v_parent_leaf is not null and lower(v_given) = lower(v_parent_leaf) then
    return jsonb_build_object('ok', false, 'error', 'same_as_father');
  end if;

  if lower(v_given) is distinct from lower(coalesce(v_old_leaf, '')) then
    if v_old_parent is null then
      v_new_child := v_given;
    else
      v_new_child := v_old_parent || '/' || v_given;
    end if;

    if exists (
      select 1
      from public.tree_children c
      where c.id <> v_target.id
        and c.branch_key is not distinct from v_target.branch_key
        and coalesce(c.parent_name, c.parent, '') is not distinct from coalesce(v_old_parent, '')
        and lower(btrim(regexp_replace(coalesce(c.child_name, c.name, ''), '^.*/', ''))) = lower(v_given)
    ) then
      return jsonb_build_object('ok', false, 'error', 'name_conflict');
    end if;

    update public.tree_children c
    set child_name = v_new_child,
        name = v_new_child
    where c.id = v_target.id;

    update public.tree_children c
    set
      parent_name = case
        when coalesce(c.parent_name, c.parent, '') = v_old_child then v_new_child
        when coalesce(c.parent_name, c.parent, '') like v_old_child || '/%'
          then v_new_child || substr(coalesce(c.parent_name, c.parent), length(v_old_child) + 1)
        else c.parent_name
      end,
      parent = case
        when coalesce(c.parent, c.parent_name, '') = v_old_child then v_new_child
        when coalesce(c.parent, c.parent_name, '') like v_old_child || '/%'
          then v_new_child || substr(coalesce(c.parent, c.parent_name), length(v_old_child) + 1)
        else c.parent
      end,
      child_name = case
        when coalesce(c.child_name, c.name, '') like v_old_child || '/%'
          then v_new_child || substr(coalesce(c.child_name, c.name), length(v_old_child) + 1)
        else c.child_name
      end,
      name = case
        when coalesce(c.name, c.child_name, '') like v_old_child || '/%'
          then v_new_child || substr(coalesce(c.name, c.child_name), length(v_old_child) + 1)
        else c.name
      end
    where c.branch_key is not distinct from v_target.branch_key
      and c.id <> v_target.id
      and (
        coalesce(c.parent_name, c.parent, '') = v_old_child
        or coalesce(c.parent_name, c.parent, '') like v_old_child || '/%'
        or coalesce(c.child_name, c.name, '') like v_old_child || '/%'
      );

    if to_regclass('public.member_profiles') is not null then
      begin
        update public.member_profiles
        set display_name = v_given,
            updated_at = now()
        where tree_child_id = v_target.id;
      exception when others then
        null;
      end;
    end if;
  end if;

  update public.tree_children c
  set birth_date_g = case when p_birth_date is null then c.birth_date_g else v_birth end,
      birth_date_h = case when p_birth_date_h is null then c.birth_date_h else v_birth_h end,
      birth_year = case when p_birth_date_h is null then c.birth_year else v_year end
  where c.id = v_target.id;

  return jsonb_build_object('ok', true, 'tree_child_id', v_target.id);
exception when others then
  return jsonb_build_object('ok', false, 'error', 'update_failed');
end;
$fn$;

revoke all on function public.member_update_person_v1(text, bigint, text, text, text) from public;
grant execute on function public.member_update_person_v1(text, bigint, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';

select to_regprocedure('public.member_update_person_v1(text, bigint, text, text, text)') is not null
  as has_member_update_person_v1;
