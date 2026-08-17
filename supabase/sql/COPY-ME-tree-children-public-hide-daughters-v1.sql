-- COPY-ME: run in Supabase SQL Editor / SQL Workspace
-- Preset id: maint.tree_children_public_hide_daughters_v1
--
-- الوجود ≠ الظهور. البنات يبقين في tree_children.
-- الموقع العام الحي ما زال يحمّل app.js قديمًا يقرأ كل الصفوف
-- (سياسة SELECT كانت using (true))، لذلك ختم الجنس وحده لا يخفي.
-- هذا يقيّد SELECT العام ويختم آخر صف بلا جنس (الإضافة بعد الحذف).
-- الإدارة/المندوب يقرآن البنات عبر دوال SECURITY DEFINER.
-- لا يحذف أحدًا. آمن لإعادة التشغيل.

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


-- Latest re-add after deleting the previous name: newest null-gender
-- child in the last 12 hours is the daughter that leaked again.
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

drop policy if exists "tree_children_select_all" on public.tree_children;
drop policy if exists tree_children_select_all on public.tree_children;
drop policy if exists "tree_children_select_public" on public.tree_children;
drop policy if exists tree_children_select_public on public.tree_children;

create policy "tree_children_select_public"
on public.tree_children
for select
to anon, authenticated
using (
  lower(btrim(coalesce(gender, ''))) not in (
    'daughter', 'female', 'f', 'أنثى', 'انثى', 'ابنة', 'بنت'
  )
);

revoke insert, update, delete on table public.tree_children from anon, authenticated;
grant select on table public.tree_children to anon, authenticated;

create or replace function public.admin_tree_children_list_v1(
  p_token text,
  p_branch_key text
)
returns setof public.tree_children
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_branch text;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;
  v_branch := nullif(btrim(coalesce(p_branch_key, '')), '');
  if v_branch is null then
    return;
  end if;
  return query
    select c.*
    from public.tree_children c
    where c.branch_key = v_branch
    order by c.id
    limit 5000;
end;
$fn$;

grant execute on function public.admin_tree_children_list_v1(text, text) to anon, authenticated;

create or replace function public.tree_children_list_v1(
  p_branch_key text,
  p_phone text,
  p_email text,
  p_secret_hash text
)
returns setof public.tree_children
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_branch text;
begin
  v_branch := nullif(btrim(coalesce(p_branch_key, '')), '');
  if v_branch is null then
    return;
  end if;
  if not public.tree_delegate_allowed_v1(v_branch, p_phone, p_email, p_secret_hash) then
    raise exception 'not allowed';
  end if;
  return query
    select c.*
    from public.tree_children c
    where c.branch_key = v_branch
    order by c.id
    limit 5000;
end;
$fn$;

grant execute on function public.tree_children_list_v1(text, text, text, text) to anon, authenticated;

create or replace function public.admin_tree_child_set_gender_by_id_v1(
  p_token text,
  p_id bigint,
  p_gender text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_gender text;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;
  v_gender := public.tree_child_normalize_gender(p_gender);
  if v_gender is null or p_id is null or p_id < 1 then
    return false;
  end if;
  update public.tree_children c
  set gender = v_gender
  where c.id = p_id;
  return found;
end;
$fn$;

grant execute on function public.admin_tree_child_set_gender_by_id_v1(text, bigint, text) to anon, authenticated;

notify pgrst, 'reload schema';

select
  (
    select pol.polname
    from pg_policy pol
    join pg_class rel on rel.oid = pol.polrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'tree_children'
      and pol.polcmd = 'r'
    order by pol.polname
    limit 1
  ) as select_policy,
  (
    select to_regprocedure('public.admin_tree_children_list_v1(text,text)') is not null
  ) as has_admin_list,
  (
    select count(*)
    from public.tree_children c
    where c.gender = 'daughter'
  ) as daughter_rows;

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
