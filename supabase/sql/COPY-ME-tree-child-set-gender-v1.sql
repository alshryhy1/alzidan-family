-- COPY-ME: run in Supabase SQL Editor / SQL Workspace
-- Preset id: maint.tree_child_set_gender_v1
--
-- The first gender SQL hid عقيله (backfill). New daughters still appeared
-- because the insert path did not reliably stamp gender.
-- This adds a small dedicated UPDATE RPC and marks the most recent
-- null-gender child added in the last 12 hours as daughter (the leak just created).
--
-- Does not delete anyone. Safe to re-run.

create or replace function public.admin_tree_child_set_gender_v1(
  p_token text,
  p_branch_key text,
  p_child_name text,
  p_gender text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_gender text;
  v_branch text;
  v_child text;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;
  v_gender := public.tree_child_normalize_gender(p_gender);
  v_branch := nullif(btrim(coalesce(p_branch_key, '')), '');
  v_child := nullif(btrim(coalesce(p_child_name, '')), '');
  if v_gender is null or v_branch is null or v_child is null then
    return false;
  end if;
  update public.tree_children c
  set gender = v_gender
  where c.branch_key = v_branch
    and (coalesce(c.child_name, c.name) = v_child or c.name = v_child);
  return found;
end;
$fn$;

grant execute on function public.admin_tree_child_set_gender_v1(text, text, text, text) to anon, authenticated;

create or replace function public.tree_children_set_gender_v1(
  p_branch_key text,
  p_child_name text,
  p_gender text,
  p_phone text,
  p_email text,
  p_secret_hash text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_gender text;
  v_branch text;
  v_child text;
begin
  v_branch := nullif(btrim(coalesce(p_branch_key, '')), '');
  v_child := nullif(btrim(coalesce(p_child_name, '')), '');
  v_gender := public.tree_child_normalize_gender(p_gender);
  if v_branch is null or v_child is null or v_gender is null then
    return false;
  end if;
  if not public.tree_delegate_allowed_v1(v_branch, p_phone, p_email, p_secret_hash) then
    return false;
  end if;
  update public.tree_children c
  set gender = v_gender
  where c.branch_key = v_branch
    and (coalesce(c.child_name, c.name) = v_child or c.name = v_child);
  return found;
end;
$fn$;

grant execute on function public.tree_children_set_gender_v1(text, text, text, text, text, text) to anon, authenticated;

-- Incident: hide the daughter added after the first gender SQL if it is the
-- latest tree_children row from the last 12 hours with gender still null.
update public.tree_children c
set gender = 'daughter'
where c.gender is null
  and c.id = (
    select c2.id
    from public.tree_children c2
    where c2.gender is null
      and c2.created_at >= now() - interval '12 hours'
    order by c2.created_at desc, c2.id desc
    limit 1
  );

notify pgrst, 'reload schema';

select
  c.id,
  c.branch_key,
  c.parent_name,
  c.child_name,
  c.gender,
  c.created_at
from public.tree_children c
where c.created_at >= now() - interval '12 hours'
order by c.created_at desc, c.id desc
limit 20;
