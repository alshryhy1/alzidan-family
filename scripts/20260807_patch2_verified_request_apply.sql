-- Patch 2 — Verified Request Apply helpers (ADR-006)
-- Migration Version: 2
-- Status: apply manually after dry-run. Safe: creates/replaces helper functions only.
--
-- Depends on / includes: tree_resolve_parent_person_id_v1 (Patch 1)
-- Client (request-actions.js) enforces: apply+verify BEFORE status=approved.
--
-- Dry-run (ambiguous parents still unresolved):
-- SELECT c.branch_key, coalesce(c.parent_name, c.parent) AS parent_key,
--        count(DISTINCT p.person_id) AS n
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
    return null;
  end if;

  if v_count > 1 then
    raise exception using
      errcode = 'P0001',
      message = 'TREE-001: ambiguous parent name match; require parent_person_id',
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
  'Patch 1/2 canonical parent resolve: unique person_id only; TREE-001 on ambiguity.';

-- Verify a child edge exists and is linked (REQ-001/REQ-002 support for operators).
create or replace function public.tree_verify_child_link_v1(
  p_branch_key text,
  p_parent_name text,
  p_child_name text,
  p_parent_person_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.tree_children%rowtype;
  v_branch_root text;
  v_is_root boolean;
begin
  if nullif(btrim(coalesce(p_branch_key,'')), '') is null
     or nullif(btrim(coalesce(p_parent_name,'')), '') is null
     or nullif(btrim(coalesce(p_child_name,'')), '') is null then
    return jsonb_build_object('ok', false, 'code', 'REQ-002', 'reason', 'missing_args');
  end if;

  v_branch_root := p_branch_key || ' بن مطلق بن زيدان';
  v_is_root := (p_parent_name = p_branch_key or p_parent_name = v_branch_root);

  select * into v_row
  from public.tree_children c
  where c.branch_key = p_branch_key
    and c.parent_name = p_parent_name
    and coalesce(c.child_name, c.name) = p_child_name
  order by c.id desc
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'REQ-001', 'reason', 'row_missing');
  end if;

  if p_parent_person_id is not null then
    if v_row.parent_person_id is distinct from p_parent_person_id then
      return jsonb_build_object(
        'ok', false,
        'code', 'REQ-002',
        'reason', 'parent_person_id_mismatch',
        'id', v_row.id,
        'person_id', v_row.person_id
      );
    end if;
  elsif not v_is_root and v_row.parent_person_id is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'REQ-002',
      'reason', 'parent_person_id_null',
      'id', v_row.id,
      'person_id', v_row.person_id
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'person_id', v_row.person_id,
    'parent_person_id', v_row.parent_person_id
  );
end;
$$;

comment on function public.tree_verify_child_link_v1(text, text, text, uuid) is
  'Patch 2: verify child edge exists and parent_person_id link (root exception).';

revoke all on function public.tree_verify_child_link_v1(text, text, text, uuid) from public;
grant execute on function public.tree_verify_child_link_v1(text, text, text, uuid) to authenticated, anon;

-- Operator note: repair short-path Mazen orphans (نداء/مازن, مازن/محمد) is a DATA repair —
-- prefer re-apply of the original tree_card with full Node Path via Admin «إعادة تطبيق».
-- Do not auto-delete short paths here.
