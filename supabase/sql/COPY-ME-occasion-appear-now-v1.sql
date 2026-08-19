-- Open this file, Select All, paste in Supabase SQL Editor

-- Make the published لقاء عائلي (EVAPP-MT0LKSNK-TCRR) appear now in the app.
-- Riyadh show window + type gathering (the app already lists that type).

do $fn$
declare
  v_ar public.approval_requests%rowtype;
  v_evt jsonb := '{}'::jsonb;
  v_details jsonb := '{}'::jsonb;
  v_event_date date;
  v_raw text;
begin
  select * into v_ar
  from public.approval_requests
  where request_id = 'EVAPP-MT0LKSNK-TCRR'
  order by created_at desc
  limit 1;
  if not found then
    return;
  end if;

  if exists (
    select 1 from public.family_events e
    where coalesce(e.details, '') like '%EVAPP-MT0LKSNK-TCRR%'
  ) then
    return;
  end if;

  v_raw := nullif(btrim(split_part(coalesce(v_ar.message, ''), '__JSON__:', 2)), '');
  if v_raw is not null then
    begin
      v_evt := coalesce(v_raw::jsonb -> 'event', '{}'::jsonb);
    exception when others then
      v_evt := '{}'::jsonb;
    end;
  end if;

  begin
    if jsonb_typeof(v_evt->'details') = 'object' then
      v_details := v_evt->'details';
    elsif jsonb_typeof(v_evt->'details') = 'string' and left(btrim(v_evt->>'details'), 1) = '{' then
      v_details := (v_evt->>'details')::jsonb;
    end if;
  exception when others then
    v_details := '{}'::jsonb;
  end;

  begin
    v_event_date := coalesce(nullif(btrim(v_evt->>'event_date'), '')::date, (now() at time zone 'Asia/Riyadh')::date);
  exception when others then
    v_event_date := (now() at time zone 'Asia/Riyadh')::date;
  end;

  v_details := v_details || jsonb_build_object(
    'v', coalesce(v_details->>'v', '1')::int,
    'kind', coalesce(v_details->>'kind', 'happy_notice'),
    'requestId', v_ar.request_id,
    'display_type', 'family_meetup',
    'occasion_key', 'family_meetup',
    'submitter_phone', nullif(btrim(v_ar.phone), ''),
    'text', coalesce(nullif(v_details->>'text', ''), 'فنجال وأم')
  );

  insert into public.family_events (
    branch_key, type, person, date_label, event_date, details, contact_phone,
    created_at, show_before_days, show_at, end_at, manual_hidden
  ) values (
    coalesce(nullif(btrim(v_ar.branch_key), ''), nullif(btrim(v_evt->>'branch_key'), ''), 'مزيد'),
    'gathering',
    coalesce(nullif(btrim(v_evt->>'person'), ''), nullif(btrim(v_ar.name), ''), 'حسن'),
    coalesce(nullif(btrim(v_evt->>'date_label'), ''), to_char(v_event_date, 'YYYY-MM-DD')),
    v_event_date,
    v_details::text,
    coalesce(nullif(btrim(v_evt->>'contact_phone'), ''), nullif(btrim(v_ar.phone), '')),
    coalesce(v_ar.created_at, now()),
    3,
    ((v_event_date - 3)::timestamp at time zone 'Asia/Riyadh'),
    (((v_event_date + 1)::timestamp at time zone 'Asia/Riyadh') - interval '1 second'),
    false
  );
end;
$fn$;

update public.family_events e
set
  type = case when lower(coalesce(e.type, '')) = 'family_meetup' then 'gathering' else e.type end,
  contact_phone = coalesce(nullif(btrim(e.contact_phone), ''), ar.phone),
  event_date = coalesce(e.event_date, (now() at time zone 'Asia/Riyadh')::date),
  show_before_days = coalesce(e.show_before_days, 3),
  show_at = (
    (coalesce(e.event_date, (now() at time zone 'Asia/Riyadh')::date) - coalesce(e.show_before_days, 3))::timestamp
    at time zone 'Asia/Riyadh'
  ),
  end_at = (
    ((coalesce(e.event_date, (now() at time zone 'Asia/Riyadh')::date) + 1)::timestamp at time zone 'Asia/Riyadh')
    - interval '1 second'
  ),
  manual_hidden = coalesce(e.manual_hidden, false),
  details = (
    case
      when e.details is not null and left(btrim(e.details), 1) = '{' then e.details::jsonb
      else '{}'::jsonb
    end || jsonb_build_object(
      'display_type', 'family_meetup',
      'occasion_key', 'family_meetup',
      'requestId', ar.request_id,
      'submitter_phone', coalesce(
        nullif(
          case
            when e.details is not null and left(btrim(e.details), 1) = '{' then e.details::jsonb->>'submitter_phone'
            else null
          end,
          ''
        ),
        nullif(btrim(ar.phone), '')
      )
    )
  )::text
from public.approval_requests ar
where ar.request_id = 'EVAPP-MT0LKSNK-TCRR'
  and coalesce(e.details, '') like '%EVAPP-MT0LKSNK-TCRR%';

update public.family_events e
set
  type = 'gathering',
  details = (
    case
      when e.details is not null and left(btrim(e.details), 1) = '{' then e.details::jsonb
      else '{}'::jsonb
    end || jsonb_build_object('display_type', 'family_meetup', 'occasion_key', 'family_meetup')
  )::text,
  show_before_days = coalesce(e.show_before_days, 3),
  show_at = (
    (coalesce(e.event_date, (now() at time zone 'Asia/Riyadh')::date) - coalesce(e.show_before_days, 3))::timestamp
    at time zone 'Asia/Riyadh'
  ),
  end_at = (
    ((coalesce(e.event_date, (now() at time zone 'Asia/Riyadh')::date) + 1)::timestamp at time zone 'Asia/Riyadh')
    - interval '1 second'
  )
where lower(coalesce(e.type, '')) = 'family_meetup';
