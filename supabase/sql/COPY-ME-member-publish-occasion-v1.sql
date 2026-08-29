-- Member direct publish of occasions (no delegate approval).
-- Open this file, Select All, paste in Supabase SQL Editor. Safe to re-run.
--
-- Registered phone (member_profiles or enabled delegates_v2 via public_app_login_by_phone_v1)
-- can insert/update/delete their own family_events row.
-- Admin keeps absolute control: admin_family_event_save_v1 / admin_family_event_delete_v1.

alter table public.family_events
  add column if not exists source_phone text;

comment on column public.family_events.source_phone is
  'Normalized owner phone for member-published rows. Admin may still edit/delete any row.';

create index if not exists family_events_source_phone_idx
  on public.family_events (source_phone)
  where source_phone is not null and btrim(source_phone) <> '';

create or replace function public.member_phone_registered_v1(p_phone text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_login jsonb;
  v_phone text;
begin
  if to_regprocedure('public.public_app_login_by_phone_v1(text)') is null then
    return null;
  end if;
  v_login := public.public_app_login_by_phone_v1(p_phone);
  if coalesce(v_login->>'ok', '') <> 'true' then
    return null;
  end if;
  v_phone := nullif(btrim(coalesce(v_login->>'phone', '')), '');
  if v_phone is null and to_regprocedure('public.push_tokens_norm_phone(text)') is not null then
    v_phone := nullif(public.push_tokens_norm_phone(p_phone), '');
  end if;
  return v_phone;
end;
$fn$;

create or replace function public.family_event_owner_phone_v1(p_row public.family_events)
returns text
language plpgsql
stable
as $fn$
declare
  v_from_col text;
  v_from_json text;
  v_details jsonb := '{}'::jsonb;
begin
  v_from_col := nullif(btrim(coalesce(p_row.source_phone, '')), '');
  if v_from_col is not null then
    return v_from_col;
  end if;
  begin
    if p_row.details is not null and left(btrim(p_row.details), 1) = '{' then
      v_details := p_row.details::jsonb;
      v_from_json := nullif(btrim(coalesce(
        v_details->>'submitter_phone',
        v_details->>'source_phone',
        ''
      )), '');
    end if;
  exception when others then
    v_from_json := null;
  end;
  return v_from_json;
end;
$fn$;

create or replace function public.member_owns_family_event_v1(p_phone text, p_id bigint)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_phone text;
  v_row public.family_events%rowtype;
  v_owner text;
begin
  v_phone := public.member_phone_registered_v1(p_phone);
  if v_phone is null or p_id is null then
    return false;
  end if;
  select * into v_row from public.family_events e where e.id = p_id;
  if not found then
    return false;
  end if;
  v_owner := public.family_event_owner_phone_v1(v_row);
  if v_owner is null then
    return false;
  end if;
  if to_regprocedure('public.push_tokens_norm_phone(text)') is not null then
    return public.push_tokens_norm_phone(v_owner) = public.push_tokens_norm_phone(v_phone);
  end if;
  return btrim(v_owner) = btrim(v_phone);
end;
$fn$;

create or replace function public.family_event_schedule_defaults_v1(
  p_type text,
  p_event_date date,
  p_created timestamptz
)
returns jsonb
language plpgsql
stable
as $fn$
declare
  v_type text := lower(btrim(coalesce(p_type, '')));
  v_created timestamptz := coalesce(p_created, now());
  v_show timestamptz;
  v_end timestamptz;
  v_before int := 3;
begin
  if v_type in ('death', 'condolence') then
    v_show := date_trunc('day', coalesce(p_event_date, (v_created at time zone 'Asia/Riyadh'))::timestamp)
      at time zone 'Asia/Riyadh';
    v_end := v_show + interval '3 days' - interval '1 second';
  elsif p_event_date is not null and v_type not in ('sick', 'operation', 'discharge') then
    v_show := ((p_event_date - v_before)::timestamp at time zone 'Asia/Riyadh');
    v_end := (((p_event_date + 1)::timestamp at time zone 'Asia/Riyadh') - interval '1 second');
  else
    v_show := v_created;
    v_end := v_created + interval '7 days';
  end if;
  return jsonb_build_object(
    'show_before_days', v_before,
    'show_at', v_show,
    'end_at', v_end
  );
end;
$fn$;

create or replace function public.member_publish_occasion_v1(
  p_phone text,
  p_row jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_phone text;
  v_id bigint;
  v_event_date date;
  v_created timestamptz;
  v_sched jsonb;
  v_details jsonb := '{}'::jsonb;
  v_details_text text;
begin
  v_phone := public.member_phone_registered_v1(p_phone);
  if v_phone is null then
    return jsonb_build_object('ok', false, 'error', 'not_registered');
  end if;
  if p_row is null or jsonb_typeof(p_row) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'bad_row');
  end if;
  if nullif(btrim(coalesce(p_row->>'branch_key', '')), '') is null
     or nullif(btrim(coalesce(p_row->>'type', '')), '') is null
     or nullif(btrim(coalesce(p_row->>'person', '')), '') is null then
    return jsonb_build_object('ok', false, 'error', 'missing_fields');
  end if;

  begin
    if jsonb_typeof(p_row->'details') = 'object' then
      v_details := p_row->'details';
    elsif p_row->>'details' is not null and left(btrim(p_row->>'details'), 1) = '{' then
      v_details := (p_row->>'details')::jsonb;
    end if;
  exception when others then
    v_details := '{}'::jsonb;
  end;

  v_details := v_details || jsonb_build_object(
    'submitter_phone', v_phone,
    'source_phone', v_phone,
    'source', 'member'
  );

  begin
    v_event_date := nullif(btrim(coalesce(p_row->>'event_date', '')), '')::date;
  exception when others then
    v_event_date := null;
  end;

  v_created := coalesce(nullif(btrim(coalesce(p_row->>'created_at', '')), '')::timestamptz, now());
  v_sched := public.family_event_schedule_defaults_v1(p_row->>'type', v_event_date, v_created);
  v_details_text := v_details::text;

  insert into public.family_events (
    branch_key, type, person, date_label, event_date, details,
    hospital_name, hospital_dept, contact_method, contact_phone,
    visit_date_from, visit_date_to, visit_time_from, visit_time_to,
    created_at, show_before_days, show_at, end_at, manual_hidden, source_phone
  ) values (
    nullif(btrim(p_row->>'branch_key'), ''),
    nullif(btrim(p_row->>'type'), ''),
    nullif(btrim(p_row->>'person'), ''),
    nullif(btrim(coalesce(p_row->>'date_label', p_row->>'event_date')), ''),
    v_event_date,
    v_details_text,
    nullif(btrim(p_row->>'hospital_name'), ''),
    nullif(btrim(p_row->>'hospital_dept'), ''),
    nullif(btrim(p_row->>'contact_method'), ''),
    nullif(btrim(coalesce(p_row->>'contact_phone', '')), ''),
    nullif(btrim(coalesce(p_row->>'visit_date_from', '')), '')::date,
    nullif(btrim(coalesce(p_row->>'visit_date_to', '')), '')::date,
    nullif(btrim(p_row->>'visit_time_from'), ''),
    nullif(btrim(p_row->>'visit_time_to'), ''),
    v_created,
    coalesce((v_sched->>'show_before_days')::int, 3),
    (v_sched->>'show_at')::timestamptz,
    (v_sched->>'end_at')::timestamptz,
    false,
    v_phone
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$fn$;

create or replace function public.member_update_occasion_v1(
  p_phone text,
  p_id bigint,
  p_row jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_phone text;
  v_event_date date;
  v_sched jsonb;
  v_details jsonb := '{}'::jsonb;
  v_existing public.family_events%rowtype;
begin
  if not public.member_owns_family_event_v1(p_phone, p_id) then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;
  v_phone := public.member_phone_registered_v1(p_phone);
  if p_row is null or jsonb_typeof(p_row) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'bad_row');
  end if;
  if nullif(btrim(coalesce(p_row->>'branch_key', '')), '') is null
     or nullif(btrim(coalesce(p_row->>'type', '')), '') is null
     or nullif(btrim(coalesce(p_row->>'person', '')), '') is null then
    return jsonb_build_object('ok', false, 'error', 'missing_fields');
  end if;

  select * into v_existing from public.family_events e where e.id = p_id;

  begin
    if jsonb_typeof(p_row->'details') = 'object' then
      v_details := p_row->'details';
    elsif p_row->>'details' is not null and left(btrim(p_row->>'details'), 1) = '{' then
      v_details := (p_row->>'details')::jsonb;
    elsif v_existing.details is not null and left(btrim(v_existing.details), 1) = '{' then
      v_details := v_existing.details::jsonb;
    end if;
  exception when others then
    v_details := '{}'::jsonb;
  end;

  v_details := v_details || jsonb_build_object(
    'submitter_phone', v_phone,
    'source_phone', v_phone,
    'source', 'member'
  );

  begin
    v_event_date := nullif(btrim(coalesce(p_row->>'event_date', '')), '')::date;
  exception when others then
    v_event_date := v_existing.event_date;
  end;

  v_sched := public.family_event_schedule_defaults_v1(
    p_row->>'type',
    v_event_date,
    coalesce(v_existing.created_at, now())
  );

  update public.family_events e
  set
    branch_key = nullif(btrim(p_row->>'branch_key'), ''),
    type = nullif(btrim(p_row->>'type'), ''),
    person = nullif(btrim(p_row->>'person'), ''),
    date_label = nullif(btrim(coalesce(p_row->>'date_label', p_row->>'event_date')), ''),
    event_date = v_event_date,
    details = v_details::text,
    hospital_name = nullif(btrim(p_row->>'hospital_name'), ''),
    hospital_dept = nullif(btrim(p_row->>'hospital_dept'), ''),
    contact_method = nullif(btrim(p_row->>'contact_method'), ''),
    contact_phone = nullif(btrim(coalesce(p_row->>'contact_phone', '')), ''),
    show_before_days = coalesce((v_sched->>'show_before_days')::int, e.show_before_days, 3),
    show_at = (v_sched->>'show_at')::timestamptz,
    end_at = (v_sched->>'end_at')::timestamptz,
    source_phone = v_phone
  where e.id = p_id;

  return jsonb_build_object('ok', true, 'id', p_id);
end;
$fn$;

create or replace function public.member_delete_occasion_v1(
  p_phone text,
  p_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not public.member_owns_family_event_v1(p_phone, p_id) then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;
  delete from public.family_events e where e.id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id);
end;
$fn$;

revoke all on function public.member_phone_registered_v1(text) from public;
revoke all on function public.member_owns_family_event_v1(text, bigint) from public;
revoke all on function public.member_publish_occasion_v1(text, jsonb) from public;
revoke all on function public.member_update_occasion_v1(text, bigint, jsonb) from public;
revoke all on function public.member_delete_occasion_v1(text, bigint) from public;

grant execute on function public.member_phone_registered_v1(text) to anon, authenticated;
grant execute on function public.member_owns_family_event_v1(text, bigint) to anon, authenticated;
grant execute on function public.member_publish_occasion_v1(text, jsonb) to anon, authenticated;
grant execute on function public.member_update_occasion_v1(text, bigint, jsonb) to anon, authenticated;
grant execute on function public.member_delete_occasion_v1(text, bigint) to anon, authenticated;
