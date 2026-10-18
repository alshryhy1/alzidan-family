-- COPY-ME: run in Supabase SQL Editor / SQL Workspace
-- Preset id: maint.tree_children_work_status_v1
--
-- الحالة الوظيفية على فرد الشجرة: موظف / متقاعد / عاطل.
-- عمود tree_children.work_status + تطبيع + ختم من الإدارة بالـ id.
-- إحصاء الأحياء حسب الحالة (فرع أو كل العائلة).
-- Safe to re-run.

alter table public.tree_children
  add column if not exists work_status text;

create or replace function public.tree_child_normalize_work_status(p_status text)
returns text
language sql
immutable
as $$
  select case
    when g in (
      'employed', 'employee', 'working', 'job',
      'موظف', 'موظفين', 'يعمل', 'على رأس العمل'
    ) then 'employed'
    when g in (
      'retired', 'retiree', 'pension',
      'متقاعد', 'متقاعدين', 'تقاعد'
    ) then 'retired'
    when g in (
      'unemployed', 'jobless', 'without_work',
      'عاطل', 'عاطلين', 'بدون عمل', 'بدون_عمل'
    ) then 'unemployed'
    else null
  end
  from (
    select lower(btrim(coalesce(p_status, ''))) as g
  ) s;
$$;

grant execute on function public.tree_child_normalize_work_status(text) to anon, authenticated;

create or replace function public.admin_tree_child_set_work_status_by_id_v1(
  p_token text,
  p_id bigint,
  p_work_status text
) returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_status text;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;
  if p_id is null or p_id < 1 then
    return false;
  end if;

  v_status := public.tree_child_normalize_work_status(p_work_status);
  -- نص فارغ أو غير معروف → مسح الحالة (اختياري)
  if nullif(btrim(coalesce(p_work_status, '')), '') is not null and v_status is null then
    raise exception 'work_status_invalid';
  end if;

  update public.tree_children c
  set work_status = v_status
  where c.id = p_id;

  return found;
end;
$fn$;

revoke all on function public.admin_tree_child_set_work_status_by_id_v1(text, bigint, text) from public;
grant execute on function public.admin_tree_child_set_work_status_by_id_v1(text, bigint, text) to anon, authenticated;

-- إحصاء الأحياء الذكور الظاهرين للعامة: موظف / متقاعد / عاطل / غير محدد
create or replace function public.tree_work_status_stats_v1(p_branch_key text default null)
returns table(
  branch_key text,
  work_status text,
  living_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with living as (
    select
      coalesce(nullif(btrim(c.branch_key), ''), '—') as branch_key,
      coalesce(
        public.tree_child_normalize_work_status(c.work_status),
        'unset'
      ) as work_status
    from public.tree_children c
    where coalesce(c.is_deceased, false) is not true
      and coalesce(c.deceased, false) is not true
      and (
        nullif(btrim(coalesce(p_branch_key, '')), '') is null
        or c.branch_key = btrim(p_branch_key)
      )
      and lower(btrim(coalesce(c.gender, ''))) not in (
        'daughter', 'female', 'f', 'أنثى', 'انثى', 'ابنة', 'بنت'
      )
  )
  select
    l.branch_key,
    l.work_status,
    count(*)::bigint as living_count
  from living l
  group by l.branch_key, l.work_status
  order by l.branch_key, l.work_status;
$$;

grant execute on function public.tree_work_status_stats_v1(text) to anon, authenticated;

notify pgrst, 'reload schema';

select
  (to_regclass('public.tree_children') is not null) as has_tree_children,
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tree_children'
      and column_name = 'work_status'
  ) as has_work_status_column,
  (to_regprocedure('public.tree_child_normalize_work_status(text)') is not null) as has_normalize,
  (to_regprocedure('public.admin_tree_child_set_work_status_by_id_v1(text,bigint,text)') is not null) as has_admin_set,
  (to_regprocedure('public.tree_work_status_stats_v1(text)') is not null) as has_stats;
