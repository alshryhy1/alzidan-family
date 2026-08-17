-- COPY-ME: run in Supabase SQL Editor / SQL Workspace
-- Preset id: maint.tree_children_gender_persist_v1
--
-- GEN-01 / Person Visibility: الوجود ≠ الظهور.
-- Daughters stay in tree_children (graph). Gender is persisted so the
-- current public tree/search experience can hide them. This is NOT a
-- Visibility Engine rule of (gender = male -> discoverable).
--
-- Safe to re-run (ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE).
-- No DELETE of عقيله or any other row.

alter table public.tree_children add column if not exists gender text;

create or replace function public.tree_child_normalize_gender(p_gender text)
returns text
language sql
immutable
as $$
  select case
    when g in ('daughter', 'female', 'f', 'أنثى', 'انثى', 'ابنة', 'بنت') then 'daughter'
    when g in ('son', 'male', 'm', 'ذكر', 'ابن') then 'son'
    else null
  end
  from (select lower(btrim(coalesce(p_gender, ''))) as g) s;
$$;

grant execute on function public.tree_child_normalize_gender(text) to anon, authenticated;

-- Targeted backfill: عقيله under خزيم only (leaf + ancestor path). Not a global name wipe.
update public.tree_children c
set gender = 'daughter'
where c.gender is distinct from 'daughter'
  and nullif(btrim(regexp_replace(coalesce(c.child_name, c.name, ''), '^.*/', '')), '')
      in ('عقيله', 'عقيلة')
  and (
    coalesce(c.parent_name, c.parent, '') like '%خزيم%'
    or coalesce(c.child_name, c.name, '') like '%خزيم%'
  );

create or replace function public.tree_children_insert_v1(
  p_branch_key text,
  p_parent_name text,
  p_child_name text,
  p_phone text,
  p_email text,
  p_secret_hash text,
  p_row jsonb
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
  v_person_id uuid;
  v_parent_person_id uuid;
  v_child_base text;
  v_deceased boolean;
  v_birth_order int;
  v_gender text;
begin
  if not public.tree_delegate_allowed_v1(p_branch_key, p_phone, p_email, p_secret_hash) then
    return false;
  end if;
  v_deceased := case
    when p_row ? 'is_deceased' then (p_row->>'is_deceased')::boolean
    when p_row ? 'deceased' then (p_row->>'deceased')::boolean
    else null
  end;
  v_gender := public.tree_child_normalize_gender(p_row->>'gender');
  v_birth_order := nullif(p_row->>'birth_order', '')::int;
  v_person_id := nullif(p_row->>'person_id', '')::uuid;
  v_parent_person_id := nullif(p_row->>'parent_person_id', '')::uuid;
  v_child_base := nullif(btrim(regexp_replace(coalesce(p_child_name, ''), '^.*/', '')), '');
  if v_birth_order is not null and v_birth_order < 1 then
    raise exception 'birth_order_invalid';
  end if;
  if v_parent_person_id is null then
    select min(c.person_id::text)::uuid into v_parent_person_id
    from public.tree_children c
    where c.branch_key = p_branch_key
      and coalesce(c.child_name, c.name) = p_parent_name
    having count(distinct c.person_id) = 1;
  end if;
  select c.id into v_id
  from public.tree_children c
  where c.branch_key = p_branch_key
    and (
      (v_person_id is not null and c.person_id = v_person_id)
      or (
        v_person_id is null
        and (c.parent_name = p_parent_name or c.parent = p_parent_name)
        and (c.name = p_child_name or c.child_name = p_child_name)
      )
    )
  order by c.id desc
  limit 1;
  if exists (
    select 1
    from public.tree_children c
    where c.branch_key = p_branch_key
      and (
        (v_parent_person_id is not null and c.parent_person_id = v_parent_person_id)
        or (v_parent_person_id is null and coalesce(c.parent_name, c.parent) = p_parent_name)
      )
      and btrim(regexp_replace(coalesce(c.child_name, c.name, ''), '^.*/', '')) = v_child_base
      and (v_id is null or c.id <> v_id)
      and (v_person_id is null or c.person_id is distinct from v_person_id)
  ) then
    raise exception 'child_already_exists';
  end if;
  if v_birth_order is not null and exists (
    select 1
    from public.tree_children c
    where c.branch_key = p_branch_key
      and c.parent_name = p_parent_name
      and c.birth_order = v_birth_order
      and (v_id is null or c.id <> v_id)
  ) then
    raise exception 'birth_order_conflict';
  end if;
  if v_id is not null then
    update public.tree_children c set
      person_id = coalesce(c.person_id, v_person_id, gen_random_uuid()),
      parent_person_id = coalesce(v_parent_person_id, c.parent_person_id),
      birth_date_g = nullif(p_row->>'birth_date_g', '')::date,
      birth_date_h = nullif(p_row->>'birth_date_h', ''),
      birth_year = nullif(p_row->>'birth_year', '')::int,
      birth_order = v_birth_order,
      city = nullif(p_row->>'city', ''),
      area = nullif(p_row->>'area', ''),
      is_deceased = coalesce(v_deceased, c.is_deceased),
      deceased = coalesce(v_deceased, c.deceased),
      gender = coalesce(v_gender, c.gender)
    where c.id = v_id;
    perform public.tree_audit_log_v1(
      p_branch_key, p_phone, p_email, p_secret_hash,
      jsonb_build_object(
        'v', 1, 'kind', 'tree_audit', 'op', 'upsert_update',
        'branch_key', p_branch_key,
        'parent_name', p_parent_name,
        'child_name', p_child_name,
        'row', coalesce(p_row, '{}'::jsonb),
        'at', now()::timestamptz
      )
    );
    return true;
  end if;
  insert into public.tree_children (
    branch_key, parent_name, parent, name, child_name,
    person_id, parent_person_id,
    birth_date_g, birth_date_h, birth_year, birth_order,
    city, area, is_deceased, deceased, gender, created_at
  ) values (
    p_branch_key, p_parent_name, p_parent_name, p_child_name, p_child_name,
    coalesce(v_person_id, gen_random_uuid()), v_parent_person_id,
    nullif(p_row->>'birth_date_g', '')::date,
    nullif(p_row->>'birth_date_h', ''),
    nullif(p_row->>'birth_year', '')::int,
    v_birth_order,
    nullif(p_row->>'city', ''),
    nullif(p_row->>'area', ''),
    coalesce(v_deceased, false),
    coalesce(v_deceased, false),
    v_gender,
    coalesce(nullif(p_row->>'created_at', '')::timestamptz, now())
  );
  perform public.tree_audit_log_v1(
    p_branch_key, p_phone, p_email, p_secret_hash,
    jsonb_build_object(
      'v', 1, 'kind', 'tree_audit', 'op', 'insert',
      'branch_key', p_branch_key,
      'parent_name', p_parent_name,
      'child_name', p_child_name,
      'row', coalesce(p_row, '{}'::jsonb),
      'at', now()::timestamptz
    )
  );
  return true;
end;
$$;

grant execute on function public.tree_children_insert_v1(text, text, text, text, text, text, jsonb) to anon, authenticated;

create or replace function public.tree_children_update_v1(
  p_branch_key text,
  p_parent_name text,
  p_child_name text,
  p_phone text,
  p_email text,
  p_secret_hash text,
  p_patch jsonb
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deceased boolean;
  v_birth_order int;
  v_id bigint;
  v_gender text;
begin
  if not public.tree_delegate_allowed_v1(p_branch_key, p_phone, p_email, p_secret_hash) then
    return false;
  end if;
  v_deceased := case
    when p_patch ? 'is_deceased' then (p_patch->>'is_deceased')::boolean
    when p_patch ? 'deceased' then (p_patch->>'deceased')::boolean
    else null
  end;
  v_gender := case
    when p_patch ? 'gender' then public.tree_child_normalize_gender(p_patch->>'gender')
    else null
  end;
  v_birth_order := case
    when p_patch ? 'birth_order' then nullif(p_patch->>'birth_order', '')::int
    else null
  end;
  if v_birth_order is not null and v_birth_order < 1 then
    raise exception 'birth_order_invalid';
  end if;
  select c.id into v_id
  from public.tree_children c
  where c.branch_key = p_branch_key
    and (
      (nullif(p_patch->>'person_id', '') is not null and c.person_id = nullif(p_patch->>'person_id', '')::uuid)
      or (
        nullif(p_patch->>'person_id', '') is null
        and (c.parent_name = p_parent_name or c.parent = p_parent_name)
        and (c.name = p_child_name or c.child_name = p_child_name)
      )
    )
  order by c.id desc
  limit 1;
  if v_id is null then
    return false;
  end if;
  if p_patch ? 'birth_order' and v_birth_order is not null and exists (
    select 1
    from public.tree_children c
    where c.branch_key = p_branch_key
      and c.parent_name = p_parent_name
      and c.birth_order = v_birth_order
      and c.id <> v_id
  ) then
    raise exception 'birth_order_conflict';
  end if;
  update public.tree_children c set
    birth_date_g = case when p_patch ? 'birth_date_g' then nullif(p_patch->>'birth_date_g', '')::date else c.birth_date_g end,
    birth_date_h = case when p_patch ? 'birth_date_h' then nullif(p_patch->>'birth_date_h', '') else c.birth_date_h end,
    birth_year = case when p_patch ? 'birth_year' then nullif(p_patch->>'birth_year', '')::int else c.birth_year end,
    birth_order = case when p_patch ? 'birth_order' then v_birth_order else c.birth_order end,
    city = case when p_patch ? 'city' then nullif(p_patch->>'city', '') else c.city end,
    area = case when p_patch ? 'area' then nullif(p_patch->>'area', '') else c.area end,
    is_deceased = coalesce(v_deceased, c.is_deceased),
    deceased = coalesce(v_deceased, c.deceased),
    gender = coalesce(v_gender, c.gender)
  where c.branch_key = p_branch_key and c.id = v_id;
  if found then
    perform public.tree_audit_log_v1(
      p_branch_key, p_phone, p_email, p_secret_hash,
      jsonb_build_object(
        'v', 1, 'kind', 'tree_audit', 'op', 'update',
        'branch_key', p_branch_key,
        'parent_name', p_parent_name,
        'child_name', p_child_name,
        'patch', coalesce(p_patch, '{}'::jsonb),
        'at', now()::timestamptz
      )
    );
  end if;
  return found;
end;
$$;

grant execute on function public.tree_children_update_v1(text, text, text, text, text, text, jsonb) to anon, authenticated;

create or replace function public.admin_tree_child_upsert_v1(p_token text, p_row jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
  v_branch text;
  v_parent text;
  v_child text;
  v_old_parent text;
  v_old_child text;
  v_person_id uuid;
  v_parent_person_id uuid;
  v_deceased boolean;
  v_gender text;
  v_saved_id bigint;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;
  if to_regclass('public.tree_children') is null then
    raise exception 'tree_children table missing';
  end if;
  v_id := nullif(p_row->>'id', '')::bigint;
  v_branch := nullif(btrim(coalesce(p_row->>'branch_key', '')), '');
  v_parent := nullif(btrim(coalesce(p_row->>'parent_name', '')), '');
  v_child := nullif(btrim(coalesce(p_row->>'child_name', '')), '');
  v_person_id := nullif(p_row->>'person_id', '')::uuid;
  v_parent_person_id := nullif(p_row->>'parent_person_id', '')::uuid;
  v_deceased := case
    when p_row ? 'is_deceased' then (p_row->>'is_deceased')::boolean
    when p_row ? 'deceased' then (p_row->>'deceased')::boolean
    else false
  end;
  v_gender := public.tree_child_normalize_gender(p_row->>'gender');
  if v_branch is null or v_parent is null or v_child is null then
    raise exception 'missing tree row fields';
  end if;
  if v_parent_person_id is null then
    select min(c.person_id::text)::uuid into v_parent_person_id
    from public.tree_children c
    where c.branch_key = v_branch
      and coalesce(c.child_name, c.name) = v_parent
    having count(distinct c.person_id) = 1;
  end if;
  if v_id is not null then
    select coalesce(c.parent_name, c.parent), coalesce(c.child_name, c.name), c.person_id
    into v_old_parent, v_old_child, v_person_id
    from public.tree_children c
    where c.id = v_id and c.branch_key = v_branch
    limit 1;
    if v_old_child is null then
      raise exception 'tree row not found';
    end if;
    update public.tree_children c set
      parent_name = v_parent,
      parent = v_parent,
      child_name = v_child,
      name = v_child,
      person_id = coalesce(c.person_id, v_person_id, gen_random_uuid()),
      parent_person_id = coalesce(v_parent_person_id, c.parent_person_id),
      birth_date_g = nullif(p_row->>'birth_date_g', '')::date,
      birth_date_h = nullif(p_row->>'birth_date_h', ''),
      birth_year = nullif(p_row->>'birth_year', '')::int,
      birth_order = nullif(p_row->>'birth_order', '')::int,
      death_date_g = nullif(p_row->>'death_date_g', '')::date,
      death_date_h = nullif(p_row->>'death_date_h', ''),
      city = nullif(p_row->>'city', ''),
      area = nullif(p_row->>'area', ''),
      is_deceased = coalesce(v_deceased, false),
      deceased = coalesce(v_deceased, false),
      gender = coalesce(v_gender, c.gender)
    where c.id = v_id
    returning c.id into v_saved_id;
    if v_old_child <> v_child then
      update public.tree_children c set
        parent_name = case
          when coalesce(c.parent_name, c.parent, '') = v_old_child then v_child
          when coalesce(c.parent_name, c.parent, '') like v_old_child || '/%' then v_child || substr(coalesce(c.parent_name, c.parent), length(v_old_child) + 1)
          else c.parent_name
        end,
        parent = case
          when coalesce(c.parent, c.parent_name, '') = v_old_child then v_child
          when coalesce(c.parent, c.parent_name, '') like v_old_child || '/%' then v_child || substr(coalesce(c.parent, c.parent_name), length(v_old_child) + 1)
          else c.parent
        end,
        child_name = case
          when coalesce(c.child_name, c.name, '') like v_old_child || '/%' then v_child || substr(coalesce(c.child_name, c.name), length(v_old_child) + 1)
          else c.child_name
        end,
        name = case
          when coalesce(c.name, c.child_name, '') like v_old_child || '/%' then v_child || substr(coalesce(c.name, c.child_name), length(v_old_child) + 1)
          else c.name
        end
      where c.branch_key = v_branch
        and c.id <> v_id
        and (
          coalesce(c.parent_name, c.parent, '') = v_old_child
          or coalesce(c.parent_name, c.parent, '') like v_old_child || '/%'
          or coalesce(c.child_name, c.name, '') like v_old_child || '/%'
        );
    end if;
  else
    insert into public.tree_children (
      branch_key, parent_name, parent, child_name, name, person_id, parent_person_id,
      birth_date_g, birth_date_h, birth_year, birth_order, death_date_g, death_date_h,
      city, area, is_deceased, deceased, gender, created_at
    ) values (
      v_branch, v_parent, v_parent, v_child, v_child,
      coalesce(v_person_id, gen_random_uuid()), v_parent_person_id,
      nullif(p_row->>'birth_date_g', '')::date,
      nullif(p_row->>'birth_date_h', ''),
      nullif(p_row->>'birth_year', '')::int,
      nullif(p_row->>'birth_order', '')::int,
      nullif(p_row->>'death_date_g', '')::date,
      nullif(p_row->>'death_date_h', ''),
      nullif(p_row->>'city', ''),
      nullif(p_row->>'area', ''),
      coalesce(v_deceased, false),
      coalesce(v_deceased, false),
      v_gender,
      now()
    ) returning id into v_saved_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_saved_id);
end;
$$;

grant execute on function public.admin_tree_child_upsert_v1(text, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';

select
  (select to_regclass('public.tree_children') is not null) as has_tree_children,
  (
    select count(*) > 0
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tree_children'
      and column_name = 'gender'
  ) as has_gender_column,
  (
    select to_regprocedure('public.tree_child_normalize_gender(text)') is not null
  ) as has_gender_norm,
  (
    select count(*)
    from public.tree_children c
    where c.gender = 'daughter'
      and nullif(btrim(regexp_replace(coalesce(c.child_name, c.name, ''), '^.*/', '')), '')
          in ('عقيله', 'عقيلة')
      and (
        coalesce(c.parent_name, c.parent, '') like '%خزيم%'
        or coalesce(c.child_name, c.name, '') like '%خزيم%'
      )
  ) as aqeelah_khuzaym_daughter_rows;
