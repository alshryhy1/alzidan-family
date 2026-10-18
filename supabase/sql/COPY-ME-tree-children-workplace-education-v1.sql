-- COPY-ME: run in Supabase SQL Editor / SQL Workspace
-- Preset id: maint.tree_children_workplace_education_v1
--
-- جهة العمل + الدرجة العلمية على فرد الشجرة.
-- أعمدة: workplace (نص حر) · education_degree (متوسط/ثانوي/دبلوم/بكالوريوس/ماجستير/دكتوراه)
-- + تطبيع + ختم من الإدارة بالـ id + إحصاء الشهادات للأحياء حسب الفرع.
-- Safe to re-run.
-- ملاحظة: وسوم مسماة مثل ed و fn حتى لا ينكسر التقسيم في مساحة SQL.

alter table public.tree_children
  add column if not exists workplace text;

alter table public.tree_children
  add column if not exists education_degree text;

create or replace function public.tree_child_normalize_education_degree(p_degree text)
returns text
language sql
immutable
as $ed$
  select case
    when g in (
      'intermediate', 'middle', 'middle_school',
      'متوسط', 'متوسطة', 'المتوسط', 'المتوسطة'
    ) then 'intermediate'
    when g in (
      'secondary', 'high_school', 'highschool', 'hs',
      'ثانوي', 'ثانوية', 'الثانوية', 'الثانوي'
    ) then 'secondary'
    when g in (
      'diploma', 'dip',
      'دبلوم', 'الدبلوم'
    ) then 'diploma'
    when g in (
      'bachelor', 'bachelors', 'ba', 'bsc', 'bs',
      'بكالوريوس', 'بكالوريس', 'بكالوريوس.', 'جامعي', 'جامعة'
    ) then 'bachelor'
    when g in (
      'master', 'masters', 'msc', 'ma', 'ms',
      'ماجستير', 'الماجستير'
    ) then 'master'
    when g in (
      'doctorate', 'doctoral', 'phd', 'ph.d', 'ph.d.', 'dr',
      'دكتوراه', 'الدكتوراه'
    ) then 'doctorate'
    else null
  end
  from (
    select lower(btrim(coalesce(p_degree, ''))) as g
  ) s
$ed$;

grant execute on function public.tree_child_normalize_education_degree(text) to anon, authenticated;

create or replace function public.tree_child_normalize_workplace(p_workplace text)
returns text
language sql
immutable
as $ed$
  select nullif(btrim(coalesce(p_workplace, '')), '')
$ed$;

grant execute on function public.tree_child_normalize_workplace(text) to anon, authenticated;

create or replace function public.admin_tree_child_set_workplace_by_id_v1(
  p_token text,
  p_id bigint,
  p_workplace text
) returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;
  if p_id is null or p_id < 1 then
    return false;
  end if;

  update public.tree_children c
  set workplace = public.tree_child_normalize_workplace(p_workplace)
  where c.id = p_id;

  return found;
end;
$fn$;

revoke all on function public.admin_tree_child_set_workplace_by_id_v1(text, bigint, text) from public;
grant execute on function public.admin_tree_child_set_workplace_by_id_v1(text, bigint, text) to anon, authenticated;

create or replace function public.admin_tree_child_set_education_degree_by_id_v1(
  p_token text,
  p_id bigint,
  p_education_degree text
) returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_degree text;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;
  if p_id is null or p_id < 1 then
    return false;
  end if;

  v_degree := public.tree_child_normalize_education_degree(p_education_degree);
  if nullif(btrim(coalesce(p_education_degree, '')), '') is not null and v_degree is null then
    raise exception 'education_degree_invalid';
  end if;

  update public.tree_children c
  set education_degree = v_degree
  where c.id = p_id;

  return found;
end;
$fn$;

revoke all on function public.admin_tree_child_set_education_degree_by_id_v1(text, bigint, text) from public;
grant execute on function public.admin_tree_child_set_education_degree_by_id_v1(text, bigint, text) to anon, authenticated;

create or replace function public.tree_education_degree_stats_v1(p_branch_key text default null)
returns table(
  branch_key text,
  education_degree text,
  living_count bigint
)
language sql
stable
security definer
set search_path = public
as $ed$
  with living as (
    select
      coalesce(nullif(btrim(c.branch_key), ''), '—') as branch_key,
      coalesce(
        public.tree_child_normalize_education_degree(c.education_degree),
        'unset'
      ) as education_degree
    from public.tree_children c
    where coalesce(c.is_deceased, false) is not true
      and coalesce(c.deceased, false) is not true
      and (
        nullif(btrim(coalesce(p_branch_key, '')), '') is null
        or c.branch_key = btrim(p_branch_key)
      )
  )
  select
    l.branch_key,
    l.education_degree,
    count(*)::bigint as living_count
  from living l
  group by l.branch_key, l.education_degree
  order by l.branch_key, l.education_degree
$ed$;

grant execute on function public.tree_education_degree_stats_v1(text) to anon, authenticated;

notify pgrst, 'reload schema';

select
  (to_regclass('public.tree_children') is not null) as has_tree_children,
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tree_children'
      and column_name = 'workplace'
  ) as has_workplace_column,
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tree_children'
      and column_name = 'education_degree'
  ) as has_education_degree_column,
  (to_regprocedure('public.tree_child_normalize_education_degree(text)') is not null) as has_normalize,
  (to_regprocedure('public.admin_tree_child_set_workplace_by_id_v1(text,bigint,text)') is not null) as has_admin_set_workplace,
  (to_regprocedure('public.admin_tree_child_set_education_degree_by_id_v1(text,bigint,text)') is not null) as has_admin_set_education,
  (to_regprocedure('public.tree_education_degree_stats_v1(text)') is not null) as has_stats;
