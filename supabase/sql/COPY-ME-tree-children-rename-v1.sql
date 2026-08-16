-- COPY-ME: run in Supabase SQL Editor / SQL Workspace
-- Preset id: maint.tree_children_rename_v1
--
-- Enables branch delegates to apply name_correction.
-- tree_children_update_v1 does NOT rewrite name/child_name/parent paths.
-- Mirrors admin_tree_child_upsert_v1 rename + descendant path rewrite.
--
-- Safe to re-run (CREATE OR REPLACE only — no data DELETE).

create or replace function public.tree_children_rename_v1(
  p_branch_key text,
  p_person_id uuid,
  p_name_new text,
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
  v_name_new text := nullif(btrim(coalesce(p_name_new, '')), '');
  v_id bigint;
  v_old_child text;
  v_old_parent text;
  v_new_child text;
  v_clash boolean := false;
begin
  if p_person_id is null or v_branch is null or v_name_new is null then
    return false;
  end if;
  -- Leaf only — no slash / multi-segment names.
  if position('/' in v_name_new) > 0 or position(' ' in v_name_new) > 0 then
    raise exception 'name_correction_leaf_invalid';
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

  if v_old_parent is null or btrim(v_old_parent) = '' then
    v_new_child := v_name_new;
  else
    v_new_child := v_old_parent || '/' || v_name_new;
  end if;

  if v_new_child = v_old_child then
    return true;
  end if;

  select exists (
    select 1
    from public.tree_children c
    where c.branch_key = v_branch
      and c.id <> v_id
      and coalesce(c.parent_name, c.parent) = coalesce(v_old_parent, '')
      and nullif(btrim(regexp_replace(coalesce(c.child_name, c.name, ''), '^.*/', '')), '') = v_name_new
  ) into v_clash;
  if v_clash then
    raise exception 'child_already_exists';
  end if;

  update public.tree_children c
  set
    child_name = v_new_child,
    name = v_new_child
  where c.id = v_id
    and c.branch_key = v_branch;

  if not found then
    return false;
  end if;

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

  perform public.tree_audit_log_v1(
    v_branch,
    p_phone,
    p_email,
    p_secret_hash,
    jsonb_build_object(
      'v', 1,
      'kind', 'tree_audit',
      'op', 'rename',
      'branch_key', v_branch,
      'person_id', p_person_id,
      'old_child_name', v_old_child,
      'new_child_name', v_new_child,
      'name_new', v_name_new,
      'at', now()::timestamptz
    )
  );

  return true;
end;
$$;

revoke all on function public.tree_children_rename_v1(text, uuid, text, text, text, text) from public;
grant execute on function public.tree_children_rename_v1(text, uuid, text, text, text, text) to anon, authenticated;

select
  (select to_regprocedure(
    'public.tree_children_rename_v1(text,uuid,text,text,text,text)'
  ) is not null) as rename_rpc_ready;
