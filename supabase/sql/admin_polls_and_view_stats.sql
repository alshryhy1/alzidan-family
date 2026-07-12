-- إدارة التصويت العام + إحصاءات مشاهدات الذاكرة والتطبيق
-- نفّذ هذا الملف مرة واحدة في Supabase SQL Editor

-- ── 1) دوال إدارة التصويت ─────────────────────────────────────────────

drop function if exists public.admin_poll_save_v1(text, jsonb);
drop function if exists public.admin_poll_delete_v1(text, bigint);

create or replace function public.admin_poll_save_v1(
  p_token text,
  p_row jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
  v_question text;
  v_description text;
  v_is_active boolean;
  v_ends_at timestamptz;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  if p_row is null or jsonb_typeof(p_row) <> 'object' then
    return jsonb_build_object('ok', false);
  end if;

  v_question := nullif(btrim(coalesce(p_row->>'question', '')), '');
  if v_question is null then
    return jsonb_build_object('ok', false, 'error', 'missing_question');
  end if;

  v_description := nullif(btrim(coalesce(p_row->>'description', '')), '');
  v_is_active := coalesce((p_row->>'is_active')::boolean, false);
  v_ends_at := nullif(btrim(coalesce(p_row->>'ends_at', '')), '')::timestamptz;
  v_id := nullif(btrim(coalesce(p_row->>'id', '')), '')::bigint;

  if v_is_active then
    update public.family_polls
    set is_active = false
    where is_active = true
      and (v_id is null or id <> v_id);
  end if;

  if v_id is null then
    insert into public.family_polls (question, description, is_active, ends_at, created_at)
    values (v_question, v_description, v_is_active, v_ends_at, now())
    returning id into v_id;
  else
    update public.family_polls p
    set
      question = v_question,
      description = v_description,
      is_active = v_is_active,
      ends_at = v_ends_at
    where p.id = v_id;

    if not found then
      return jsonb_build_object('ok', false, 'id', v_id);
    end if;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.admin_poll_delete_v1(
  p_token text,
  p_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  if p_id is null or p_id <= 0 then
    return false;
  end if;

  delete from public.family_poll_votes v where v.poll_id = p_id;
  delete from public.family_polls p where p.id = p_id;
  return found;
end;
$$;

revoke all on function public.admin_poll_save_v1(text, jsonb) from public;
revoke all on function public.admin_poll_delete_v1(text, bigint) from public;

grant execute on function public.admin_poll_save_v1(text, jsonb) to anon, authenticated;
grant execute on function public.admin_poll_delete_v1(text, bigint) to anon, authenticated;

-- ── 2) تحسين ملخص الزيارات (موقع / ذاكرة / تطبيق) ─────────────────────

create or replace function public.site_view_path_kind_v1(p_path text)
returns text
language sql
immutable
as $$
  select case
    when nullif(btrim(coalesce(p_path, '')), '') is null then 'site'
    when btrim(p_path) like 'app/%' then 'app'
    when btrim(p_path) like 'memory/%' then 'memory'
    when btrim(p_path) ilike '%/memory/%' then 'memory'
    else 'site'
  end;
$$;

create or replace function public.site_view_summary_v1(p_days int default 30)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with all_rows as (
  select day, path, count, public.site_view_path_kind_v1(path) as kind
  from public.site_view_counts
),
window_rows as (
  select day, path, count, kind
  from all_rows
  where day >= (current_date - greatest(coalesce(p_days, 30), 1) + 1)
),
by_day as (
  select day, sum(count) as total
  from window_rows
  group by day
  order by day desc
),
by_path as (
  select path, sum(count) as total
  from window_rows
  group by path
  order by total desc, path asc
  limit 20
)
select jsonb_build_object(
  'total', coalesce((select sum(count) from all_rows), 0),
  'today', coalesce((select sum(count) from all_rows where day = current_date), 0),
  'last_7', coalesce((select sum(count) from all_rows where day >= current_date - 6), 0),
  'site_total', coalesce((select sum(count) from all_rows where kind = 'site'), 0),
  'site_today', coalesce((select sum(count) from all_rows where kind = 'site' and day = current_date), 0),
  'site_last_7', coalesce((select sum(count) from all_rows where kind = 'site' and day >= current_date - 6), 0),
  'memory_total', coalesce((select sum(count) from all_rows where kind = 'memory'), 0),
  'memory_today', coalesce((select sum(count) from all_rows where kind = 'memory' and day = current_date), 0),
  'memory_last_7', coalesce((select sum(count) from all_rows where kind = 'memory' and day >= current_date - 6), 0),
  'app_total', coalesce((select sum(count) from all_rows where kind = 'app'), 0),
  'app_today', coalesce((select sum(count) from all_rows where kind = 'app' and day = current_date), 0),
  'app_last_7', coalesce((select sum(count) from all_rows where kind = 'app' and day >= current_date - 6), 0),
  'days', coalesce((select jsonb_agg(jsonb_build_object('day', day::text, 'total', total)) from by_day), '[]'::jsonb),
  'paths', coalesce((select jsonb_agg(jsonb_build_object('path', path, 'total', total)) from by_path), '[]'::jsonb)
);
$$;

grant execute on function public.site_view_path_kind_v1(text) to anon, authenticated;
grant execute on function public.site_view_summary_v1(int) to anon, authenticated;
