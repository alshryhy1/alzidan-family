-- Patch 1 — Canonical Person Identity (ADR-001 / ADR-002)
-- Migration Version: 1
-- Status: SHIPPED AS SCRIPT — apply manually after dry-run. Do not mass-mutate production blindly.
--
-- Goal: when parent_person_id is missing and parent name matches multiple distinct person_id values,
-- raise TREE-001 instead of leaving ambiguous linkage or relying on min().
-- When exactly one distinct person_id matches, set it (unchanged safe behavior).

-- Helper comment for operators:
--   Dry-run: count rows where parent_person_id is null and parent name is ambiguous.
--
-- SELECT c.branch_key, coalesce(c.parent_name, c.parent) AS parent_key, count(DISTINCT p.person_id) AS n
-- FROM tree_children c
-- JOIN tree_children p
--   ON p.branch_key = c.branch_key
--  AND coalesce(p.child_name, p.name) = coalesce(c.parent_name, c.parent)
-- WHERE c.parent_person_id IS NULL
-- GROUP BY 1, 2
-- HAVING count(DISTINCT p.person_id) > 1;

create or replace function public.tree_resolve_parent_person_id_v1(
  p_branch_key text,
  p_parent_name text,
  p_parent_person_id uuid
) returns uuid
language plpgsql
stable
as $$
declare
  v_pid uuid;
  v_count int;
begin
  if p_parent_person_id is not null then
    return p_parent_person_id;
  end if;
  if nullif(btrim(coalesce(p_branch_key, '')), '') is null then
    return null;
  end if;
  if nullif(btrim(coalesce(p_parent_name, '')), '') is null then
    return null;
  end if;

  select count(distinct c.person_id)
    into v_count
  from public.tree_children c
  where c.branch_key = p_branch_key
    and coalesce(c.child_name, c.name) = p_parent_name
    and c.person_id is not null;

  if v_count is null or v_count = 0 then
    return null; -- possible branch root / not yet linked — TREE-003 handled by Integrity Engine
  end if;

  if v_count > 1 then
    raise exception using
      errcode = 'P0001',
      message = 'TREE-001: ambiguous parent name match; require parent_person_id';
      detail = format('branch=%s parent_name=%s matches=%s', p_branch_key, p_parent_name, v_count);
  end if;

  select c.person_id
    into v_pid
  from public.tree_children c
  where c.branch_key = p_branch_key
    and coalesce(c.child_name, c.name) = p_parent_name
    and c.person_id is not null
  limit 1;

  return v_pid;
end;
$$;

comment on function public.tree_resolve_parent_person_id_v1(text, text, uuid) is
  'Patch 1 canonical parent resolve: unique person_id only; TREE-001 on ambiguity.';

-- NOTE: Re-wiring admin_tree_child_upsert_v1 / tree_children_insert_v1 / admin_tree_children_import_v1
-- to call tree_resolve_parent_person_id_v1 must be done in Supabase SQL editor after verifying
-- live function bodies (they are embedded historically in assets/js/admin.js).
-- Prefer client always sending parent_person_id (already done in Patch 1 JS).
