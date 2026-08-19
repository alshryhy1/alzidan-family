-- Open this file, Select All, paste in Supabase SQL Editor

-- Host inbox for invitation replies: match host phone on the event, not only recipient_phone.
-- Also treat لقاء عائلي (family_meetup) like اجتماع عائلي (gathering) in RSVP catalog.

create or replace function public.occasion_event_host_phone_v1(p_event_id bigint)
returns text
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_row public.family_events%rowtype;
  v_details jsonb;
  v_phone text;
  v_req text;
  v_phones text[];
begin
  if p_event_id is null then
    return null;
  end if;
  select * into v_row from public.family_events where id = p_event_id limit 1;
  if not found then
    return null;
  end if;

  v_phone := nullif(btrim(coalesce(v_row.contact_phone, '')), '');

  begin
    v_details := case
      when v_row.details is null or btrim(v_row.details) = '' then '{}'::jsonb
      when left(btrim(v_row.details), 1) = '{' then v_row.details::jsonb
      else '{}'::jsonb
    end;
  exception when others then
    v_details := '{}'::jsonb;
  end;

  if v_phone is null then
    v_phone := nullif(btrim(coalesce(
      v_details->>'contact_phone',
      v_details->>'phone',
      v_details->>'submitter_phone',
      ''
    )), '');
  end if;

  if v_phone is null then
    begin
      select array_agg(nullif(btrim(x), '')) filter (where nullif(btrim(x), '') is not null)
        into v_phones
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(v_details->'phones') = 'array' then v_details->'phones'
          else '[]'::jsonb
        end
      ) as t(x);
      if v_phones is not null and cardinality(v_phones) > 0 then
        v_phone := v_phones[1];
      end if;
    exception when others then
      null;
    end;
  end if;

  if v_phone is null then
    v_req := nullif(btrim(coalesce(
      v_details->>'requestId',
      v_details->>'request_id',
      ''
    )), '');
    if v_req is not null then
      begin
        select nullif(btrim(coalesce(ar.phone, '')), '')
          into v_phone
        from public.approval_requests ar
        where ar.request_id = v_req
           or ar.id::text = v_req
        order by ar.created_at desc nulls last
        limit 1;
      exception when others then
        v_phone := null;
      end;
    end if;
  end if;

  return v_phone;
end;
$fn$;

revoke all on function public.occasion_event_host_phone_v1(bigint) from public;
grant execute on function public.occasion_event_host_phone_v1(bigint) to anon, authenticated, service_role;

create or replace function public.occasion_type_matches_catalog_v1(
  p_event_type text,
  p_applies text[]
)
returns boolean
language plpgsql
immutable
set search_path = public
as $fn$
declare
  v text := lower(nullif(btrim(coalesce(p_event_type, '')), ''));
begin
  if coalesce(cardinality(p_applies), 0) = 0 then
    return true;
  end if;
  if v is null then
    return false;
  end if;
  if v = any (p_applies) then
    return true;
  end if;
  if v = 'family_meetup' and 'gathering' = any (p_applies) then
    return true;
  end if;
  if v = 'gathering' and 'family_meetup' = any (p_applies) then
    return true;
  end if;
  return false;
end;
$fn$;

revoke all on function public.occasion_type_matches_catalog_v1(text, text[]) from public;
grant execute on function public.occasion_type_matches_catalog_v1(text, text[]) to anon, authenticated, service_role;

create or replace function public.occasion_ensure_default_recipients_v1(p_occasion_id bigint)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row public.family_events%rowtype;
  v_person text;
  v_person_id uuid;
  v_phone text;
  v_details jsonb;
  v_type text;
  v_inserted int := 0;
  v_role text;
begin
  if p_occasion_id is null then
    return 0;
  end if;
  select * into v_row from public.family_events where id = p_occasion_id limit 1;
  if not found then
    return 0;
  end if;

  v_person := nullif(btrim(coalesce(v_row.person, '')), '');
  v_type := lower(nullif(btrim(coalesce(v_row.type, '')), ''));
  v_phone := public.occasion_event_host_phone_v1(p_occasion_id);

  begin
    v_details := case
      when v_row.details is null or btrim(v_row.details) = '' then '{}'::jsonb
      when left(btrim(v_row.details), 1) = '{' then v_row.details::jsonb
      else '{}'::jsonb
    end;
  exception when others then
    v_details := '{}'::jsonb;
  end;

  begin
    v_person_id := nullif(coalesce(v_details->>'person_id', v_details->>'personId'), '')::uuid;
  exception when others then
    v_person_id := null;
  end;

  if v_person_id is null and v_phone is not null then
    begin
      select mp.person_id into v_person_id
      from public.member_profiles mp
      where mp.person_id is not null
        and public.phones_match_v1(mp.phone, v_phone)
      order by mp.id desc
      limit 1;
    exception when others then
      v_person_id := null;
    end;
  end if;

  if v_type in ('death', 'condolence') then
    v_role := 'bereaved';
  elsif v_type in ('sick', 'operation', 'healing', 'discharge', 'safety') then
    v_role := 'patient';
  elsif v_type in (
    'wedding', 'contract', 'dinner', 'lunch', 'feast', 'gathering',
    'family_meetup', 'general', 'aqiqa', 'graduation', 'promotion', 'retirement'
  ) then
    v_role := 'host';
  else
    v_role := 'honoree';
  end if;

  if v_person is null then
    return 0;
  end if;

  if v_phone is not null
     and (v_row.contact_phone is null or btrim(coalesce(v_row.contact_phone, '')) = '') then
    update public.family_events
    set contact_phone = v_phone
    where id = p_occasion_id;
  end if;

  if not exists (
    select 1 from public.occasion_recipients r
    where r.occasion_id = p_occasion_id
      and r.is_active
      and lower(r.recipient_name) = lower(v_person)
      and r.recipient_role is distinct from 'deceased'
  ) then
    insert into public.occasion_recipients (
      occasion_id, recipient_role, recipient_name, recipient_phone, recipient_person_id
    ) values (
      p_occasion_id, v_role, v_person, v_phone, v_person_id
    );
    v_inserted := 1;
  else
    update public.occasion_recipients r
    set
      recipient_phone = coalesce(r.recipient_phone, v_phone),
      recipient_person_id = coalesce(r.recipient_person_id, v_person_id)
    where r.occasion_id = p_occasion_id
      and r.is_active
      and lower(r.recipient_name) = lower(v_person)
      and r.recipient_role is distinct from 'deceased';
  end if;

  if v_type in ('death', 'condolence') then
    if not exists (
      select 1 from public.occasion_recipients r
      where r.occasion_id = p_occasion_id
        and r.recipient_role = 'deceased'
        and r.is_active
    ) then
      insert into public.occasion_recipients (
        occasion_id, recipient_role, recipient_name, recipient_person_id
      ) values (
        p_occasion_id, 'deceased', v_person, v_person_id
      );
      v_inserted := v_inserted + 1;
    end if;
  end if;

  return v_inserted;
end;
$fn$;

revoke all on function public.occasion_ensure_default_recipients_v1(bigint) from public;
grant execute on function public.occasion_ensure_default_recipients_v1(bigint) to anon, authenticated, service_role;

create or replace function public.occasion_interaction_catalog_v1(
  p_event_type text,
  p_family text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_type text := lower(nullif(btrim(coalesce(p_event_type, '')), ''));
  v_family text := lower(nullif(btrim(coalesce(p_family, '')), ''));
begin
  return coalesce((
    select jsonb_agg(to_jsonb(t) order by t.sort_order, t.id)
    from public.occasion_interaction_types t
    where t.is_active
      and (
        (v_type is not null and public.occasion_type_matches_catalog_v1(v_type, t.applies_to_types))
        or (v_family is not null and t.family = v_family and cardinality(t.applies_to_types) = 0)
      )
  ), '[]'::jsonb);
end;
$fn$;

revoke all on function public.occasion_interaction_catalog_v1(text, text) from public;
grant execute on function public.occasion_interaction_catalog_v1(text, text) to anon, authenticated, service_role;

create or replace function public.occasion_interaction_submit_v1(
  p_occasion_id bigint,
  p_interaction_type_key text,
  p_sender_phone text,
  p_sender_name text default null,
  p_message text default null,
  p_recipient_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_phone text := nullif(btrim(coalesce(p_sender_phone, '')), '');
  v_key text := nullif(btrim(coalesce(p_interaction_type_key, '')), '');
  v_type public.occasion_interaction_types%rowtype;
  v_event public.family_events%rowtype;
  v_recipient_id bigint;
  v_member_id bigint;
  v_sender_name text := nullif(btrim(coalesce(p_sender_name, '')), '');
  v_resolved text;
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
  v_id bigint;
begin
  if p_occasion_id is null or v_phone is null or v_key is null then
    return jsonb_build_object('ok', false, 'error', 'missing_fields');
  end if;

  select * into v_event from public.family_events where id = p_occasion_id limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'occasion_not_found');
  end if;

  select * into v_type from public.occasion_interaction_types
  where key = v_key and is_active limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_interaction_type');
  end if;

  if not public.occasion_type_matches_catalog_v1(v_event.type, v_type.applies_to_types) then
    return jsonb_build_object('ok', false, 'error', 'type_mismatch');
  end if;

  perform public.occasion_ensure_default_recipients_v1(p_occasion_id);

  v_recipient_id := p_recipient_id;
  if v_recipient_id is null then
    if v_type.track = 'deceased' then
      select r.id into v_recipient_id
      from public.occasion_recipients r
      where r.occasion_id = p_occasion_id and r.recipient_role = 'deceased' and r.is_active
      order by r.id limit 1;
    else
      select r.id into v_recipient_id
      from public.occasion_recipients r
      where r.occasion_id = p_occasion_id
        and r.is_active
        and r.recipient_role is distinct from 'deceased'
      order by r.id
      limit 1;
    end if;
  end if;

  select mp.id into v_member_id
  from public.member_profiles mp
  where mp.status = 'active'
    and public.phones_match_v1(mp.phone, v_phone)
  order by mp.updated_at desc nulls last
  limit 1;

  v_resolved := public.member_name_with_father_from_phone_v1(v_phone);
  if v_resolved is not null and position(' ' in v_resolved) > 0 then
    v_sender_name := v_resolved;
  elsif v_sender_name is null or position(' ' in v_sender_name) = 0 then
    v_sender_name := coalesce(v_resolved, v_sender_name);
  end if;

  if v_type.allows_message is not true then
    v_message := null;
  elsif v_message is not null and char_length(v_message) > 500 then
    v_message := left(v_message, 500);
  end if;

  insert into public.occasion_interactions as oi (
    occasion_id, interaction_type_key, sender_phone, sender_name,
    sender_member_id, recipient_id, message, created_at, updated_at
  ) values (
    p_occasion_id, v_key, v_phone, v_sender_name,
    v_member_id, v_recipient_id, v_message, now(), now()
  )
  on conflict (occasion_id, sender_phone)
  do update set
    interaction_type_key = excluded.interaction_type_key,
    sender_name = coalesce(excluded.sender_name, oi.sender_name),
    sender_member_id = coalesce(excluded.sender_member_id, oi.sender_member_id),
    recipient_id = coalesce(excluded.recipient_id, oi.recipient_id),
    message = excluded.message,
    updated_at = now()
  returning id into v_id;

  return jsonb_build_object(
    'ok', true,
    'id', v_id,
    'recipient_id', v_recipient_id,
    'sender_name', v_sender_name
  );
end;
$fn$;

revoke all on function public.occasion_interaction_submit_v1(bigint, text, text, text, text, bigint) from public;
grant execute on function public.occasion_interaction_submit_v1(bigint, text, text, text, text, bigint) to anon, authenticated, service_role;

create or replace function public.occasion_inbox_for_phone_v1(p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_member_person uuid;
begin
  if v_phone is null then
    return jsonb_build_object('ok', false, 'error', 'missing_phone', 'items', '[]'::jsonb);
  end if;

  select mp.person_id into v_member_person
  from public.member_profiles mp
  where mp.status = 'active' and public.phones_match_v1(mp.phone, v_phone)
  order by mp.updated_at desc nulls last
  limit 1;

  return jsonb_build_object(
    'ok', true,
    'items', coalesce((
      select jsonb_agg(x order by (x->>'latest_at') desc)
      from (
        select jsonb_build_object(
          'occasion_id', e.id,
          'occasion_type', e.type,
          'occasion_person', e.person,
          'branch_key', e.branch_key,
          'recipient_id', r.id,
          'recipient_role', r.recipient_role,
          'recipient_name', r.recipient_name,
          'total', count(i.*)::int,
          'by_type', coalesce((
            select jsonb_object_agg(sub.interaction_type_key, sub.cnt)
            from (
              select i2.interaction_type_key, count(*)::int as cnt
              from public.occasion_interactions i2
              where i2.recipient_id = r.id
              group by i2.interaction_type_key
            ) sub
          ), '{}'::jsonb),
          'latest_at', max(i.updated_at),
          'messages', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', m.id,
              'sender_name', coalesce(
                nullif(public.member_name_with_father_from_phone_v1(m.sender_phone), ''),
                nullif(public.short_name_with_father_v1(m.sender_name), ''),
                nullif(m.sender_name, ''),
                'فرد من العائلة'
              ),
              'interaction_type_key', m.interaction_type_key,
              'label', t.label,
              'full_text', t.full_text,
              'message', m.message,
              'created_at', m.created_at
            ) order by m.created_at desc)
            from public.occasion_interactions m
            left join public.occasion_interaction_types t on t.key = m.interaction_type_key
            where m.recipient_id = r.id
            limit 50
          ), '[]'::jsonb)
        ) as x
        from public.occasion_recipients r
        join public.family_events e on e.id = r.occasion_id
        join public.occasion_interactions i on i.recipient_id = r.id
        where r.is_active
          and r.recipient_role is distinct from 'deceased'
          and (
            (r.recipient_phone is not null and public.phones_match_v1(r.recipient_phone, v_phone))
            or (v_member_person is not null and r.recipient_person_id = v_member_person)
            or (
              public.occasion_event_host_phone_v1(e.id) is not null
              and public.phones_match_v1(public.occasion_event_host_phone_v1(e.id), v_phone)
            )
          )
        group by e.id, r.id
      ) q
    ), '[]'::jsonb)
  );
end;
$fn$;

revoke all on function public.occasion_inbox_for_phone_v1(text) from public;
grant execute on function public.occasion_inbox_for_phone_v1(text) to anon, authenticated, service_role;

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
  v_id bigint;
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
    select e.id into v_id
    from public.family_events e
    where coalesce(e.details, '') like '%' || v_request_id || '%'
    order by e.id desc
    limit 1;
    if v_id is not null then
      perform public.occasion_ensure_default_recipients_v1(v_id);
    end if;
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
    case
      when btrim(coalesce(p_row->>'event_date', '')) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        and substring(btrim(p_row->>'event_date') from 1 for 4)::int between 1800 and 2100
      then btrim(p_row->>'event_date')::date
      else null
    end,
    v_details,
    nullif(p_row->>'hospital_name', ''),
    nullif(p_row->>'hospital_dept', ''),
    nullif(p_row->>'contact_method', ''),
    nullif(p_row->>'contact_phone', ''),
    case
      when btrim(coalesce(p_row->>'visit_date_from', '')) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      then btrim(p_row->>'visit_date_from')::date
      else null
    end,
    case
      when btrim(coalesce(p_row->>'visit_date_to', '')) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      then btrim(p_row->>'visit_date_to')::date
      else null
    end,
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
  )
  returning id into v_id;

  if v_id is not null then
    perform public.occasion_ensure_default_recipients_v1(v_id);
  end if;

  return true;
end;
$$;

revoke all on function public.admin_publish_event_card_v1(text, text, jsonb) from public;
grant execute on function public.admin_publish_event_card_v1(text, text, jsonb) to anon, authenticated;

update public.occasion_interaction_types t
set applies_to_types = (
  select array_agg(distinct x order by x)
  from unnest(coalesce(t.applies_to_types, '{}'::text[]) || array['family_meetup']::text[]) as x
)
where t.key in ('inv_yes', 'inv_no', 'inv_maybe', 'inv_details', 'inv_contact')
  and not ('family_meetup' = any (coalesce(t.applies_to_types, '{}'::text[])));

update public.family_events e
set contact_phone = ar.phone
from public.approval_requests ar
where nullif(btrim(coalesce(e.contact_phone, '')), '') is null
  and nullif(btrim(coalesce(ar.phone, '')), '') is not null
  and coalesce(e.details, '') like '%' || ar.request_id || '%'
  and lower(coalesce(e.type, '')) in (
    'gathering', 'family_meetup', 'feast', 'dinner', 'lunch', 'general',
    'wedding', 'contract', 'aqiqa', 'graduation', 'promotion', 'retirement'
  );

do $fn$
declare
  r record;
begin
  for r in
    select e.id
    from public.family_events e
    where lower(coalesce(e.type, '')) in (
      'gathering', 'family_meetup', 'feast', 'dinner', 'lunch', 'general',
      'wedding', 'contract', 'aqiqa', 'graduation', 'promotion', 'retirement'
    )
    order by e.id
  loop
    perform public.occasion_ensure_default_recipients_v1(r.id);
  end loop;
end;
$fn$;
