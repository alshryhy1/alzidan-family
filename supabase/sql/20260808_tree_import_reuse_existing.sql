-- =============================================================================
-- tree_card import: reuse existing father/ancestors — insert missing children only
-- Migration Version: 5 (import reuse)
-- Status: apply manually via COPY-ME file (Select All → Supabase SQL Editor).
-- Safe: create or replace function only. No data deletes.
--
-- Behavior:
--   1) Resolve parent by parent_person_id, else unique child_name/path in branch.
--   2) Ambiguous parent name → raise TREE-001 (Arabic detail).
--   3) If child already exists (exact edge, person_id, or unique leaf under parent)
--      → UPDATE that row (reuse) — never INSERT a duplicate father/ancestor.
--   4) Only INSERT when the child edge truly does not exist.
-- =============================================================================

create or replace function public.admin_tree_children_import_v1(
  p_token text,
  p_rows jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_branch text;
  v_parent text;
  v_child text;
  v_child_leaf text;
  v_id bigint;
  v_person_id uuid;
  v_parent_person_id uuid;
  v_parent_count int;
  v_deceased boolean;
  v_death_date_g date;
  v_death_date_h text;
  v_inserted bigint := 0;
  v_updated bigint := 0;
  v_skipped bigint := 0;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;
  if to_regclass('public.tree_children') is null then
    raise exception 'tree_children table missing';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    return jsonb_build_object('inserted', 0, 'updated', 0, 'skipped', 0);
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_branch := nullif(btrim(coalesce(v_row->>'branch_key', '')), '');
    v_parent := nullif(btrim(coalesce(v_row->>'parent_name', '')), '');
    v_child := nullif(btrim(coalesce(v_row->>'child_name', '')), '');
    if v_branch is null or v_parent is null or v_child is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_deceased := case
      when v_row ? 'is_deceased' then (v_row->>'is_deceased')::boolean
      when v_row ? 'deceased' then (v_row->>'deceased')::boolean
      else false
    end;
    v_death_date_g := nullif(v_row->>'death_date_g', '')::date;
    v_death_date_h := nullif(v_row->>'death_date_h', '');
    v_person_id := nullif(v_row->>'person_id', '')::uuid;
    v_parent_person_id := nullif(v_row->>'parent_person_id', '')::uuid;

    -- Leaf of child path (…/حبيب/محمد → محمد)
    v_child_leaf := nullif(
      btrim(substring(v_child from '([^/]+)$')),
      ''
    );
    if v_child_leaf is null then
      v_child_leaf := v_child;
    end if;

    -- Resolve parent_person_id uniquely; never min()/limit(1) on multi-match.
    if v_parent_person_id is null then
      select count(distinct c.person_id)
        into v_parent_count
      from public.tree_children c
      where c.branch_key = v_branch
        and coalesce(c.child_name, c.name) = v_parent
        and c.person_id is not null;

      if v_parent_count is null then
        v_parent_count := 0;
      end if;

      if v_parent_count > 1 then
        raise exception using
          errcode = 'P0001',
          message = format(
            'TREE-001: الأب «%s» يطابق أكثر من شخص في الفرع «%s» — لن يُضاف الابن تحت أب غامض',
            v_parent,
            v_branch
          ),
          detail = format('branch=%s parent_name=%s matches=%s', v_branch, v_parent, v_parent_count);
      end if;

      if v_parent_count = 1 then
        select c.person_id
          into v_parent_person_id
        from public.tree_children c
        where c.branch_key = v_branch
          and coalesce(c.child_name, c.name) = v_parent
          and c.person_id is not null
        limit 1;
      end if;
    end if;

    v_id := null;

    -- 1) Exact edge match (branch + parent_name + child_name)
    select c.id
      into v_id
    from public.tree_children c
    where c.branch_key = v_branch
      and c.parent_name = v_parent
      and coalesce(c.child_name, c.name) = v_child
    order by c.id desc
    limit 1;

    -- 2) Same person_id already in branch → reuse (do not duplicate)
    if v_id is null and v_person_id is not null then
      select c.id
        into v_id
      from public.tree_children c
      where c.branch_key = v_branch
        and c.person_id = v_person_id
      order by c.id desc
      limit 1;
    end if;

    -- 3) Unique child leaf under the same parent_person_id → reuse existing son/father row
    if v_id is null and v_parent_person_id is not null and v_child_leaf is not null then
      select min(c.id)
        into v_id
      from public.tree_children c
      where c.branch_key = v_branch
        and c.parent_person_id = v_parent_person_id
        and (
          coalesce(c.child_name, c.name) = v_child
          or coalesce(c.child_name, c.name) = v_child_leaf
          or coalesce(c.child_name, c.name) like '%/' || v_child_leaf
        )
      having count(*) = 1;
    end if;

    -- 4) Unique child path/leaf in branch when parent path matches (no parent uuid yet)
    if v_id is null and v_child_leaf is not null then
      select min(c.id)
        into v_id
      from public.tree_children c
      where c.branch_key = v_branch
        and (
          coalesce(c.child_name, c.name) = v_child
          or coalesce(c.child_name, c.name) = v_child_leaf
          or coalesce(c.child_name, c.name) like '%/' || v_child_leaf
        )
        and (
          coalesce(c.parent_name, c.parent, '') = v_parent
          or coalesce(c.parent_name, c.parent, '') like '%/' || regexp_replace(v_parent, '^.*/', '')
          or v_parent like '%/' || regexp_replace(coalesce(c.parent_name, c.parent, ''), '^.*/', '')
        )
      having count(*) = 1;
    end if;

    if v_id is not null then
      update public.tree_children c
      set
        person_id = coalesce(c.person_id, v_person_id, gen_random_uuid()),
        parent_person_id = coalesce(v_parent_person_id, c.parent_person_id),
        parent_name = coalesce(nullif(c.parent_name, ''), v_parent),
        parent = coalesce(nullif(c.parent, ''), v_parent),
        name = coalesce(nullif(c.name, ''), v_child),
        child_name = coalesce(nullif(c.child_name, ''), v_child),
        birth_date_g = coalesce(nullif(v_row->>'birth_date_g', '')::date, c.birth_date_g),
        birth_date_h = coalesce(nullif(v_row->>'birth_date_h', ''), c.birth_date_h),
        birth_year = coalesce(nullif(v_row->>'birth_year', '')::int, c.birth_year),
        birth_order = coalesce(nullif(v_row->>'birth_order', '')::int, c.birth_order),
        death_date_g = coalesce(v_death_date_g, c.death_date_g),
        death_date_h = coalesce(v_death_date_h, c.death_date_h),
        city = coalesce(nullif(v_row->>'city', ''), c.city),
        area = coalesce(nullif(v_row->>'area', ''), c.area),
        is_deceased = coalesce(v_deceased, c.is_deceased, false),
        deceased = coalesce(v_deceased, c.deceased, false)
      where c.id = v_id;
      v_updated := v_updated + 1;
    else
      insert into public.tree_children (
        branch_key, parent_name, parent, name, child_name,
        person_id, parent_person_id,
        birth_date_g, birth_date_h, birth_year, birth_order,
        death_date_g, death_date_h, city, area,
        is_deceased, deceased, created_at
      ) values (
        v_branch, v_parent, v_parent, v_child, v_child,
        coalesce(v_person_id, gen_random_uuid()), v_parent_person_id,
        nullif(v_row->>'birth_date_g', '')::date,
        nullif(v_row->>'birth_date_h', ''),
        nullif(v_row->>'birth_year', '')::int,
        nullif(v_row->>'birth_order', '')::int,
        v_death_date_g, v_death_date_h,
        nullif(v_row->>'city', ''),
        nullif(v_row->>'area', ''),
        coalesce(v_deceased, false),
        coalesce(v_deceased, false),
        coalesce(nullif(v_row->>'created_at', '')::timestamptz, now())
      );
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'inserted', v_inserted,
    'updated', v_updated,
    'skipped', v_skipped
  );
end;
$$;

comment on function public.admin_tree_children_import_v1(text, jsonb) is
  'Import tree edges: reuse existing father/child by person_id/path/unique leaf; TREE-001 on ambiguous parent; insert missing only.';

grant execute on function public.admin_tree_children_import_v1(text, jsonb) to anon, authenticated;
