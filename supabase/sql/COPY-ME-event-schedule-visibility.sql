-- =============================================================================
-- COPY-ME: event schedule visibility + banner time window
-- Preset id: maint.event_schedule_visibility_v1
-- Safe to re-run (IF NOT EXISTS / CREATE OR REPLACE).
--
-- What this does:
--   1) family_events: show_before_days, show_at, end_at, manual_hidden
--   2) banner_messages: show_start, show_end, is_permanent
--   3) Update admin publish/save RPCs to persist schedule fields (optional columns)
--
-- Visibility is computed on read by the app (no cron required).
-- Soft-hide only — never deletes rows for expiry.
-- =============================================================================

-- 1) family_events schedule columns
alter table public.family_events
  add column if not exists show_before_days int;

alter table public.family_events
  add column if not exists show_at timestamptz;

alter table public.family_events
  add column if not exists end_at timestamptz;

alter table public.family_events
  add column if not exists manual_hidden boolean default false;

comment on column public.family_events.show_before_days is
  'Days before event_date when public visibility starts (default 3). Overridden by show_at.';
comment on column public.family_events.show_at is
  'Optional absolute timestamp when the event becomes publicly visible.';
comment on column public.family_events.end_at is
  'Optional absolute timestamp when public visibility ends (soft-hide).';
comment on column public.family_events.manual_hidden is
  'Admin/delegate early soft-hide; row kept in DB.';

-- Backfill defaults for dated happy rows missing schedule (do not mass-touch delegates)
update public.family_events e
set show_before_days = coalesce(e.show_before_days, 3)
where e.show_before_days is null
  and e.event_date is not null
  and lower(coalesce(e.type, '')) not in ('death', 'sick', 'operation', 'discharge');

-- 2) banner_messages time window
alter table public.banner_messages
  add column if not exists show_start timestamptz;

alter table public.banner_messages
  add column if not exists show_end timestamptz;

alter table public.banner_messages
  add column if not exists is_permanent boolean default false;

comment on column public.banner_messages.show_start is
  'When the banner becomes visible (null = use created_at legacy window).';
comment on column public.banner_messages.show_end is
  'When the banner soft-hides (null + is_permanent=true = permanent).';
comment on column public.banner_messages.is_permanent is
  'If true, ignore show_end and keep visible until is_active=false.';

-- Seed show_start from created_at where missing (preserve current behaviour)
update public.banner_messages b
set show_start = coalesce(b.show_start, b.created_at)
where b.show_start is null;

update public.banner_messages b
set show_end = coalesce(
  b.show_end,
  b.created_at + make_interval(days => greatest(1, least(coalesce(b.show_days, 7), 7)))
)
where b.show_end is null
  and coalesce(b.is_permanent, false) = false
  and b.created_at is not null;

-- 3) admin_publish_event_card_v1 — persist schedule columns when present
create or replace function public.admin_publish_event_card_v1(
  p_token text,
  p_request_id text,
  p_row jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id text;
  v_details text;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  v_request_id := nullif(btrim(coalesce(p_request_id, '')), '');
  if v_request_id is null or p_row is null or jsonb_typeof(p_row) <> 'object' then
    return false;
  end if;

  if exists (
    select 1
    from public.family_events e
    where coalesce(e.details, '') like '%' || v_request_id || '%'
  ) then
    return true;
  end if;

  v_details := nullif(p_row->>'details', '');

  insert into public.family_events (
    branch_key,
    type,
    person,
    date_label,
    event_date,
    details,
    hospital_name,
    hospital_dept,
    contact_method,
    contact_phone,
    visit_date_from,
    visit_date_to,
    visit_time_from,
    visit_time_to,
    created_at,
    show_before_days,
    show_at,
    end_at,
    manual_hidden
  )
  values (
    nullif(p_row->>'branch_key', ''),
    nullif(p_row->>'type', ''),
    nullif(p_row->>'person', ''),
    nullif(p_row->>'date_label', ''),
    nullif(p_row->>'event_date', '')::date,
    v_details,
    nullif(p_row->>'hospital_name', ''),
    nullif(p_row->>'hospital_dept', ''),
    nullif(p_row->>'contact_method', ''),
    nullif(p_row->>'contact_phone', ''),
    nullif(p_row->>'visit_date_from', '')::date,
    nullif(p_row->>'visit_date_to', '')::date,
    nullif(p_row->>'visit_time_from', ''),
    nullif(p_row->>'visit_time_to', ''),
    coalesce(nullif(p_row->>'created_at', '')::timestamptz, now()),
    coalesce(
      nullif(p_row->>'show_before_days', '')::int,
      3
    ),
    nullif(p_row->>'show_at', '')::timestamptz,
    nullif(p_row->>'end_at', '')::timestamptz,
    coalesce((p_row->>'manual_hidden')::boolean, false)
  );

  return true;
end;
$$;

revoke all on function public.admin_publish_event_card_v1(text, text, jsonb) from public;
grant execute on function public.admin_publish_event_card_v1(text, text, jsonb) to anon, authenticated;

-- 4) admin_family_event_insert/save — keep schedule fields
create or replace function public.admin_family_event_insert_v1(
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
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  if p_row is null or jsonb_typeof(p_row) <> 'object' then
    return jsonb_build_object('ok', false);
  end if;

  if nullif(btrim(coalesce(p_row->>'branch_key', '')), '') is null
     or nullif(btrim(coalesce(p_row->>'type', '')), '') is null
     or nullif(btrim(coalesce(p_row->>'person', '')), '') is null then
    return jsonb_build_object('ok', false);
  end if;

  insert into public.family_events (
    branch_key,
    type,
    person,
    date_label,
    event_date,
    details,
    hospital_name,
    hospital_dept,
    contact_method,
    contact_phone,
    visit_date_from,
    visit_date_to,
    visit_time_from,
    visit_time_to,
    created_at,
    show_before_days,
    show_at,
    end_at,
    manual_hidden
  )
  values (
    nullif(btrim(p_row->>'branch_key'), ''),
    nullif(btrim(p_row->>'type'), ''),
    nullif(btrim(p_row->>'person'), ''),
    nullif(btrim(p_row->>'date_label'), ''),
    nullif(btrim(p_row->>'event_date'), '')::date,
    nullif(p_row->>'details', ''),
    nullif(btrim(p_row->>'hospital_name'), ''),
    nullif(btrim(p_row->>'hospital_dept'), ''),
    nullif(btrim(p_row->>'contact_method'), ''),
    nullif(btrim(p_row->>'contact_phone'), ''),
    nullif(btrim(p_row->>'visit_date_from'), '')::date,
    nullif(btrim(p_row->>'visit_date_to'), '')::date,
    nullif(btrim(p_row->>'visit_time_from'), ''),
    nullif(btrim(p_row->>'visit_time_to'), ''),
    coalesce(nullif(btrim(p_row->>'created_at'), '')::timestamptz, now()),
    coalesce(nullif(btrim(p_row->>'show_before_days'), '')::int, 3),
    nullif(btrim(p_row->>'show_at'), '')::timestamptz,
    nullif(btrim(p_row->>'end_at'), '')::timestamptz,
    coalesce((p_row->>'manual_hidden')::boolean, false)
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.admin_family_event_save_v1(
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
  v_updated boolean := false;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  if p_row is null or jsonb_typeof(p_row) <> 'object' then
    return jsonb_build_object('ok', false);
  end if;

  v_id := nullif(btrim(coalesce(p_row->>'id', '')), '')::bigint;
  if v_id is null then
    return jsonb_build_object('ok', false);
  end if;

  if nullif(btrim(coalesce(p_row->>'branch_key', '')), '') is null
     or nullif(btrim(coalesce(p_row->>'type', '')), '') is null
     or nullif(btrim(coalesce(p_row->>'person', '')), '') is null then
    return jsonb_build_object('ok', false, 'id', v_id);
  end if;

  update public.family_events e
  set
    branch_key = nullif(btrim(p_row->>'branch_key'), ''),
    type = nullif(btrim(p_row->>'type'), ''),
    person = nullif(btrim(p_row->>'person'), ''),
    date_label = nullif(btrim(p_row->>'date_label'), ''),
    event_date = nullif(btrim(p_row->>'event_date'), '')::date,
    details = nullif(p_row->>'details', ''),
    hospital_name = nullif(btrim(p_row->>'hospital_name'), ''),
    hospital_dept = nullif(btrim(p_row->>'hospital_dept'), ''),
    contact_method = nullif(btrim(p_row->>'contact_method'), ''),
    contact_phone = nullif(btrim(p_row->>'contact_phone'), ''),
    visit_date_from = nullif(btrim(p_row->>'visit_date_from'), '')::date,
    visit_date_to = nullif(btrim(p_row->>'visit_date_to'), '')::date,
    visit_time_from = nullif(btrim(p_row->>'visit_time_from'), ''),
    visit_time_to = nullif(btrim(p_row->>'visit_time_to'), ''),
    show_before_days = coalesce(
      nullif(btrim(p_row->>'show_before_days'), '')::int,
      e.show_before_days,
      3
    ),
    show_at = coalesce(
      nullif(btrim(p_row->>'show_at'), '')::timestamptz,
      e.show_at
    ),
    end_at = coalesce(
      nullif(btrim(p_row->>'end_at'), '')::timestamptz,
      e.end_at
    ),
    manual_hidden = coalesce(
      (p_row->>'manual_hidden')::boolean,
      e.manual_hidden,
      false
    )
  where e.id = v_id;

  v_updated := found;
  return jsonb_build_object('ok', v_updated, 'id', v_id);
end;
$$;

grant execute on function public.admin_family_event_insert_v1(text, jsonb) to anon, authenticated;
grant execute on function public.admin_family_event_save_v1(text, jsonb) to anon, authenticated;

-- 5) banner update RPC — accept show_start / show_end / is_permanent
create or replace function public.admin_banner_message_update_v1(
  p_token text,
  p_id bigint,
  p_branch_key text,
  p_message text,
  p_show_days int,
  p_is_active boolean,
  p_created_at timestamptz default null,
  p_show_start timestamptz default null,
  p_show_end timestamptz default null,
  p_is_permanent boolean default null
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

  update public.banner_messages b
  set
    branch_key = nullif(trim(coalesce(p_branch_key, '')), ''),
    message = nullif(trim(coalesce(p_message, '')), ''),
    show_days = greatest(1, least(coalesce(p_show_days, b.show_days, 7), 7)),
    is_active = coalesce(p_is_active, b.is_active, true),
    created_at = coalesce(p_created_at, b.created_at),
    show_start = coalesce(p_show_start, p_created_at, b.show_start, b.created_at),
    show_end = case
      when coalesce(p_is_permanent, b.is_permanent, false) then null
      else coalesce(p_show_end, b.show_end)
    end,
    is_permanent = coalesce(p_is_permanent, b.is_permanent, false)
  where b.id = p_id;

  return found;
end;
$$;

grant execute on function public.admin_banner_message_update_v1(
  text, bigint, text, text, int, boolean, timestamptz, timestamptz, timestamptz, boolean
) to anon, authenticated;

-- Optional: keep older 7-arg signature working via overload wrapper
create or replace function public.admin_banner_message_update_v1(
  p_token text,
  p_id bigint,
  p_branch_key text,
  p_message text,
  p_show_days int,
  p_is_active boolean,
  p_created_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.admin_banner_message_update_v1(
    p_token,
    p_id,
    p_branch_key,
    p_message,
    p_show_days,
    p_is_active,
    p_created_at,
    p_created_at,
    null,
    null
  );
end;
$$;

grant execute on function public.admin_banner_message_update_v1(
  text, bigint, text, text, int, boolean, timestamptz
) to anon, authenticated;

-- 5) Delegate insert path — persist schedule so approve ≠ immediate public show
create or replace function public.family_events_insert_v1(
  p_branch_key text,
  p_phone text,
  p_email text,
  p_secret_hash text,
  p_row jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.events_delegate_allowed_v1(p_branch_key, p_phone, p_email, p_secret_hash) then
    return false;
  end if;

  insert into public.family_events (
    branch_key,
    type,
    person,
    date_label,
    event_date,
    details,
    hospital_name,
    hospital_dept,
    contact_method,
    contact_phone,
    visit_date_from,
    visit_date_to,
    visit_time_from,
    visit_time_to,
    created_at,
    show_before_days,
    show_at,
    end_at,
    manual_hidden
  )
  values (
    p_branch_key,
    nullif(p_row->>'type', ''),
    nullif(p_row->>'person', ''),
    nullif(p_row->>'date_label', ''),
    nullif(p_row->>'event_date', '')::date,
    nullif(p_row->>'details', ''),
    nullif(p_row->>'hospital_name', ''),
    nullif(p_row->>'hospital_dept', ''),
    nullif(p_row->>'contact_method', ''),
    nullif(p_row->>'contact_phone', ''),
    nullif(p_row->>'visit_date_from', '')::date,
    nullif(p_row->>'visit_date_to', '')::date,
    nullif(p_row->>'visit_time_from', ''),
    nullif(p_row->>'visit_time_to', ''),
    coalesce(nullif(p_row->>'created_at', '')::timestamptz, now()),
    coalesce(nullif(p_row->>'show_before_days', '')::int, 3),
    nullif(p_row->>'show_at', '')::timestamptz,
    nullif(p_row->>'end_at', '')::timestamptz,
    coalesce((p_row->>'manual_hidden')::boolean, false)
  );

  -- Internal audit only — edge notify MUST skip events_audit kinds.
  perform public.events_audit_log_v1(
    p_branch_key,
    p_phone,
    p_email,
    p_secret_hash,
    jsonb_build_object(
      'v', 1,
      'kind', 'events_audit',
      'op', 'insert',
      'branch_key', p_branch_key,
      'type', coalesce(p_row->>'type', ''),
      'person', coalesce(p_row->>'person', ''),
      'event_date', coalesce(p_row->>'event_date', ''),
      'at', now()::timestamptz
    )
  );

  return true;
end;
$$;

grant execute on function public.family_events_insert_v1(text, text, text, text, jsonb) to anon, authenticated;

-- Smoke select (workspace-friendly final statement)
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'family_events'
      and column_name in ('show_before_days', 'show_at', 'end_at', 'manual_hidden')) as family_event_schedule_cols,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'banner_messages'
      and column_name in ('show_start', 'show_end', 'is_permanent')) as banner_schedule_cols;
