-- Occasion interactions: link recipient phone from family_events for ALL types
-- (same delivery path as Mazeed promotion — inbox matches phone or person_id)

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
  v_phones text[];
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

  begin
    v_person_id := nullif(coalesce(v_details->>'person_id', v_details->>'personId'), '')::uuid;
  exception when others then
    v_person_id := null;
  end;

  if v_phone is null then
    v_phone := nullif(btrim(coalesce(
      v_details->>'contact_phone',
      v_details->>'phone',
      v_details->>'submitter_phone',
      ''
    )), '');
  end if;

  -- Death details often store phones array
  if v_phone is null then
    begin
      select array_agg(nullif(btrim(x), '') ) filter (where nullif(btrim(x), '') is not null)
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

  -- Resolve person_id from member_profiles by phone when missing
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

-- Backfill recipients for all published occasions (phone + person_id when available)
do $fn$
declare
  r record;
begin
  for r in
    select e.id
    from public.family_events e
    order by e.id
  loop
    perform public.occasion_ensure_default_recipients_v1(r.id);
  end loop;
end;
$fn$;

-- Extra: fill phone from contact_phone when still empty (non-deceased)
update public.occasion_recipients r
set recipient_phone = nullif(btrim(e.contact_phone), '')
from public.family_events e
where e.id = r.occasion_id
  and r.is_active
  and r.recipient_role is distinct from 'deceased'
  and r.recipient_phone is null
  and nullif(btrim(coalesce(e.contact_phone, '')), '') is not null;
