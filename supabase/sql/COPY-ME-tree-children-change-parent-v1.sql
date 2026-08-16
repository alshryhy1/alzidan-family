-- COPY-ME: run in Supabase SQL Editor / SQL Workspace
-- Preset id: maint.tree_children_change_parent_v1
--
-- Enables branch delegates to apply parent_change corrections.
-- tree_children_update_v1 does NOT write parent_person_id / path fields.
-- This RPC mirrors admin_tree_child_upsert_v1 parent-move + descendant path rewrite.
--
-- Safe to re-run (CREATE OR REPLACE only — no data DELETE).

create or replace function public.tree_children_change_parent_v1(
  p_branch_key text,
  p_person_id uuid,
  p_new_parent_person_id uuid,
  p_phone text,
  p_email text,
  p_secret_hash text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch text := nullif(btrim(coalesce(p_branch_key, '')), '');
  v_id bigint;
  v_old_child text;
  v_old_parent text;
  v_leaf text;
  v_new_parent_path text;
  v_new_child text;
  v_parent_exists boolean := false;
  v_clash boolean := false;
begin
  if p_person_id is null or p_new_parent_person_id is null or v_branch is null then
    return false;
  end if;
  if p_person_id = p_new_parent_person_id then
    raise exception 'parent_change_self';
  end if;
  if not public.tree_delegate_allowed_v1(v_branch, p_phone, p_email, p_secret_hash) then
    return false;
  end if;

  select
    c.id,
    coalesce(c.child_name, c.name),
    coalesce(c.parent_name, c.parent)
  into v_id, v_old_child, v_old_parent
  from public.tree_children c
  where c.branch_key = v_branch
    and c.person_id = p_person_id
  order by c.id desc
  limit 1;

  if v_id is null or v_old_child is null then
    return false;
  end if;

  select coalesce(c.child_name, c.name)
  into v_new_parent_path
  from public.tree_children c
  where c.branch_key = v_branch
    and c.person_id = p_new_parent_person_id
  order by c.id desc
  limit 1;

  if v_new_parent_path is null or btrim(v_new_parent_path) = '' then
    raise exception 'new_parent_not_found';
  end if;
  v_parent_exists := true;

  -- Cycle: new parent is this person or under this person's path.
  if v_new_parent_path = v_old_child
     or v_new_parent_path like v_old_child || '/%' then
    raise exception 'parent_change_cycle';
  end if;

  v_leaf := nullif(btrim(regexp_replace(v_old_child, '^.*/', '')), '');
  if v_leaf is null then
    raise exception 'parent_change_leaf_missing';
  end if;

  v_new_child := v_new_parent_path || '/' || v_leaf;

  -- Sibling leaf clash under the new parent (other person_id).
  select exists (
    select 1
    from public.tree_children c
    where c.branch_key = v_branch
      and c.id <> v_id
      and coalesce(c.parent_name, c.parent) = v_new_parent_path
      and nullif(btrim(regexp_replace(coalesce(c.child_name, c.name, ''), '^.*/', '')), '') = v_leaf
  ) into v_clash;
  if v_clash then
    raise exception 'child_already_exists';
  end if;

  update public.tree_children c
  set
    parent_name = v_new_parent_path,
    parent = v_new_parent_path,
    child_name = v_new_child,
    name = v_new_child,
    parent_person_id = p_new_parent_person_id
  where c.id = v_id
    and c.branch_key = v_branch;

  if not found then
    return false;
  end if;

  -- Rewrite descendant paths when the moved person's path changed (same as admin upsert).
  if v_old_child is distinct from v_new_child then
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
    where c.branch_key = v_branch
      and c.id <> v_id
      and (
        coalesce(c.parent_name, c.parent, '') = v_old_child
        or coalesce(c.parent_name, c.parent, '') like v_old_child || '/%'
        or coalesce(c.child_name, c.name, '') like v_old_child || '/%'
      );
  end if;

  perform public.tree_audit_log_v1(
    v_branch,
    p_phone,
    p_email,
    p_secret_hash,
    jsonb_build_object(
      'v', 1,
      'kind', 'tree_audit',
      'op', 'change_parent',
      'branch_key', v_branch,
      'person_id', p_person_id,
      'old_parent_name', v_old_parent,
      'old_child_name', v_old_child,
      'new_parent_person_id', p_new_parent_person_id,
      'new_parent_name', v_new_parent_path,
      'new_child_name', v_new_child,
      'parent_exists', v_parent_exists,
      'at', now()::timestamptz
    )
  );

  return true;
end;
$$;

revoke all on function public.tree_children_change_parent_v1(text, uuid, uuid, text, text, text) from public;
grant execute on function public.tree_children_change_parent_v1(text, uuid, uuid, text, text, text) to anon, authenticated;

-- Probe (read-only)
select
  (select to_regprocedure(
    'public.tree_children_change_parent_v1(text,uuid,uuid,text,text,text)'
  ) is not null) as change_parent_rpc_ready;
