-- COPY-ME: Preset id: maint.member_set_person_profile_v1
-- Open this file, Select All, paste in Supabase SQL Editor / SQL Workspace. Safe to re-run.
--
-- يضمن أعمدة الحالة/الشهادة ثم دالة حفظ الملف من الجوال.
-- العضو يعدّل على نفسه أو ابنه: مدينة · حي · موظف/متقاعد/عاطل · وين موظف · الدرجة العلمية.

alter table public.tree_children
  add column if not exists work_status text;

alter table public.tree_children
  add column if not exists workplace text;

alter table public.tree_children
  add column if not exists education_degree text;

create or replace function public.tree_child_normalize_work_status(p_status text)
returns text
language sql
immutable
as $ws$
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
  ) s
$ws$;

grant execute on function public.tree_child_normalize_work_status(text) to anon, authenticated;

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

create or replace function public.member_set_person_profile_v1(
  p_phone text,
  p_target_id bigint,
  p_city text default null,
  p_area text default null,
  p_work_status text default null,
  p_workplace text default null,
  p_education_degree text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_phone text;
  v_digits text;
  v_owner public.tree_children%rowtype;
  v_target public.tree_children%rowtype;
  v_mp public.member_profiles%rowtype;
  v_owner_path text;
  v_old_parent text;
  v_allowed boolean := false;
  v_city text;
  v_area text;
  v_work text;
  v_workplace text;
  v_degree text;
  v_touch_city boolean := false;
  v_touch_area boolean := false;
  v_touch_work boolean := false;
  v_touch_workplace boolean := false;
  v_touch_degree boolean := false;
begin
  if to_regprocedure('public.member_phone_registered_v1(text)') is null then
    return jsonb_build_object('ok', false, 'error', 'sql_missing');
  end if;

  v_phone := public.member_phone_registered_v1(p_phone);
  if v_phone is null then
    return jsonb_build_object('ok', false, 'error', 'not_registered');
  end if;

  if p_target_id is null or p_target_id < 1 then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;

  v_touch_city := p_city is not null;
  v_touch_area := p_area is not null;
  v_touch_work := p_work_status is not null;
  v_touch_workplace := p_workplace is not null;
  v_touch_degree := p_education_degree is not null;

  if not (v_touch_city or v_touch_area or v_touch_work or v_touch_workplace or v_touch_degree) then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;

  v_city := nullif(btrim(coalesce(p_city, '')), '');
  v_area := nullif(btrim(coalesce(p_area, '')), '');
  v_workplace := public.tree_child_normalize_workplace(p_workplace);

  if v_touch_work then
    if nullif(btrim(coalesce(p_work_status, '')), '') is null then
      v_work := null;
    else
      v_work := public.tree_child_normalize_work_status(p_work_status);
      if v_work is null then
        return jsonb_build_object('ok', false, 'error', 'work_status_invalid');
      end if;
    end if;
  end if;

  if v_touch_degree then
    if nullif(btrim(coalesce(p_education_degree, '')), '') is null then
      v_degree := null;
    else
      v_degree := public.tree_child_normalize_education_degree(p_education_degree);
      if v_degree is null then
        return jsonb_build_object('ok', false, 'error', 'education_degree_invalid');
      end if;
    end if;
  end if;

  v_digits := nullif(right(regexp_replace(coalesce(v_phone, ''), '[^0-9]', '', 'g'), 9), '');
  if to_regclass('public.member_profiles') is not null and v_digits is not null then
    select mp.*
      into v_mp
    from public.member_profiles mp
    where right(regexp_replace(coalesce(mp.phone, ''), '[^0-9]', '', 'g'), 9) = v_digits
      and coalesce(nullif(btrim(coalesce(mp.status, '')), ''), 'active') is distinct from 'pending_family'
    order by mp.updated_at desc nulls last, mp.id desc
    limit 1;
  end if;

  if coalesce(v_mp.tree_child_id, 0) > 0 then
    select * into v_owner from public.tree_children where id = v_mp.tree_child_id limit 1;
  elsif v_mp.person_id is not null then
    select * into v_owner from public.tree_children where person_id = v_mp.person_id order by id limit 1;
  end if;
  if not found or v_owner.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_placed');
  end if;

  select * into v_target from public.tree_children where id = p_target_id limit 1;
  if not found or v_target.id is null then
    return jsonb_build_object('ok', false, 'error', 'person_not_found');
  end if;

  v_owner_path := nullif(btrim(coalesce(v_owner.child_name, v_owner.name, '')), '');
  v_old_parent := nullif(btrim(coalesce(v_target.parent_name, v_target.parent, '')), '');
  v_allowed := v_target.id = v_owner.id
    or (
      v_target.branch_key is not distinct from v_owner.branch_key
      and (
        (v_owner.person_id is not null and v_target.parent_person_id is not distinct from v_owner.person_id)
        or (v_owner_path is not null and v_old_parent is not distinct from v_owner_path)
      )
    );
  if not v_allowed then
    return jsonb_build_object('ok', false, 'error', 'not_own_child');
  end if;

  update public.tree_children c
  set
    city = case when v_touch_city then v_city else c.city end,
    area = case when v_touch_area then v_area else c.area end,
    work_status = case when v_touch_work then v_work else c.work_status end,
    workplace = case when v_touch_workplace then v_workplace else c.workplace end,
    education_degree = case when v_touch_degree then v_degree else c.education_degree end
  where c.id = v_target.id;

  return jsonb_build_object('ok', true, 'tree_child_id', v_target.id);
exception when others then
  return jsonb_build_object(
    'ok', false,
    'error', 'update_failed',
    'detail', left(sqlerrm, 180)
  );
end;
$fn$;

revoke all on function public.member_set_person_profile_v1(text, bigint, text, text, text, text, text) from public;
grant execute on function public.member_set_person_profile_v1(text, bigint, text, text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';

select
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tree_children' and column_name = 'work_status'
  ) as has_work_status,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tree_children' and column_name = 'workplace'
  ) as has_workplace,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tree_children' and column_name = 'education_degree'
  ) as has_education_degree,
  (to_regprocedure('public.tree_child_normalize_work_status(text)') is not null) as has_norm_work,
  (to_regprocedure('public.tree_child_normalize_education_degree(text)') is not null) as has_norm_edu,
  (to_regprocedure('public.member_set_person_profile_v1(text, bigint, text, text, text, text, text)') is not null) as has_member_set_person_profile_v1;
