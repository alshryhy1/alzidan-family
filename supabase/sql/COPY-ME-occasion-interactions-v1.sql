-- Occasion Interaction engine v1
-- Private family interactions on occasions (NOT public comments).
-- Apply once via Admin SQL workspace / Supabase SQL editor.
--
-- Flow: occasion → recipients (people) → catalog by family/type → member interaction → recipient inbox only.

create table if not exists public.occasion_interaction_types (
  id bigserial primary key,
  key text not null unique,
  family text not null,
  applies_to_types text[] not null default '{}',
  track text null,
  label text not null,
  full_text text not null,
  allows_message boolean not null default false,
  sort_order int not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.occasion_interaction_types is
  'Catalog of occasion interaction templates; expandable without code deploys.';
comment on column public.occasion_interaction_types.track is
  'Optional lane: deceased | bereaved (death), before | after (hajj), etc.';

create table if not exists public.occasion_recipients (
  id bigserial primary key,
  occasion_id bigint not null references public.family_events(id) on delete cascade,
  recipient_role text not null default 'honoree',
  recipient_name text not null,
  recipient_person_id uuid null,
  recipient_phone text null,
  recipient_member_id bigint null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists occasion_recipients_occasion_idx
  on public.occasion_recipients (occasion_id);
create index if not exists occasion_recipients_phone_idx
  on public.occasion_recipients (recipient_phone)
  where recipient_phone is not null;
create index if not exists occasion_recipients_person_idx
  on public.occasion_recipients (recipient_person_id)
  where recipient_person_id is not null;

create table if not exists public.occasion_interactions (
  id bigserial primary key,
  occasion_id bigint not null references public.family_events(id) on delete cascade,
  interaction_type_key text not null references public.occasion_interaction_types(key),
  sender_phone text not null,
  sender_name text null,
  sender_member_id bigint null,
  recipient_id bigint null references public.occasion_recipients(id) on delete set null,
  message text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One interaction per sender per occasion (can change type/message via upsert).
create unique index if not exists occasion_interactions_sender_once_idx
  on public.occasion_interactions (occasion_id, sender_phone);

create index if not exists occasion_interactions_recipient_idx
  on public.occasion_interactions (recipient_id);
create index if not exists occasion_interactions_occasion_idx
  on public.occasion_interactions (occasion_id);

-- RLS: catalog readable; interactions/recipients NEVER publicly readable.
alter table public.occasion_interaction_types enable row level security;
alter table public.occasion_recipients enable row level security;
alter table public.occasion_interactions enable row level security;

drop policy if exists occasion_interaction_types_public_select on public.occasion_interaction_types;
create policy occasion_interaction_types_public_select
  on public.occasion_interaction_types
  for select to anon, authenticated
  using (is_active = true);

grant select on table public.occasion_interaction_types to anon, authenticated;
revoke insert, update, delete, truncate on table public.occasion_interaction_types from anon, authenticated;

revoke all on table public.occasion_recipients from anon, authenticated;
revoke all on table public.occasion_interactions from anon, authenticated;

-- ---------- helpers ----------
create or replace function public.normalize_phone_digits_v1(p text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '');
$$;

create or replace function public.phones_match_v1(a text, b text)
returns boolean
language plpgsql
immutable
as $$
declare
  da text := public.normalize_phone_digits_v1(a);
  db text := public.normalize_phone_digits_v1(b);
begin
  if da is null or db is null then
    return false;
  end if;
  if da = db then
    return true;
  end if;
  -- KSA local vs 966
  if right(da, 9) = right(db, 9) and length(da) >= 9 and length(db) >= 9 then
    return true;
  end if;
  return false;
end;
$$;

-- ---------- ensure default recipients from family_events.person ----------
create or replace function public.occasion_ensure_default_recipients_v1(p_occasion_id bigint)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.family_events%rowtype;
  v_person text;
  v_person_id uuid;
  v_details jsonb;
  v_family text;
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

  -- Map type → default role
  if v_type in ('death', 'condolence') then
    v_role := 'bereaved';
  elsif v_type in ('sick', 'operation', 'healing', 'discharge', 'safety') then
    v_role := 'patient';
  elsif v_type in ('wedding', 'contract', 'dinner', 'lunch', 'feast', 'gathering', 'family_meetup', 'general', 'aqiqa', 'graduation', 'promotion', 'retirement') then
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
  ) then
    insert into public.occasion_recipients (
      occasion_id, recipient_role, recipient_name, recipient_person_id
    ) values (
      p_occasion_id, v_role, v_person, v_person_id
    );
    v_inserted := 1;
  end if;

  -- Death: also a symbolic deceased lane recipient (no phone; for track=deceased storage)
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
$$;

revoke all on function public.occasion_ensure_default_recipients_v1(bigint) from public;
grant execute on function public.occasion_ensure_default_recipients_v1(bigint) to anon, authenticated, service_role;

-- ---------- list catalog for an occasion/type ----------
create or replace function public.occasion_interaction_catalog_v1(
  p_event_type text,
  p_family text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text := lower(nullif(btrim(coalesce(p_event_type, '')), ''));
  v_family text := lower(nullif(btrim(coalesce(p_family, '')), ''));
begin
  return coalesce((
    select jsonb_agg(to_jsonb(t) order by t.sort_order, t.id)
    from public.occasion_interaction_types t
    where t.is_active
      and (
        (v_type is not null and v_type = any (t.applies_to_types))
        or (v_family is not null and t.family = v_family and cardinality(t.applies_to_types) = 0)
      )
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.occasion_interaction_catalog_v1(text, text) from public;
grant execute on function public.occasion_interaction_catalog_v1(text, text) to anon, authenticated, service_role;

-- ---------- submit / upsert interaction ----------
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
as $$
declare
  v_phone text := nullif(btrim(coalesce(p_sender_phone, '')), '');
  v_key text := nullif(btrim(coalesce(p_interaction_type_key, '')), '');
  v_type public.occasion_interaction_types%rowtype;
  v_event public.family_events%rowtype;
  v_recipient_id bigint;
  v_member_id bigint;
  v_sender_name text := nullif(btrim(coalesce(p_sender_name, '')), '');
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

  if cardinality(v_type.applies_to_types) > 0
     and not (lower(coalesce(v_event.type, '')) = any (v_type.applies_to_types)) then
    return jsonb_build_object('ok', false, 'error', 'type_mismatch');
  end if;

  perform public.occasion_ensure_default_recipients_v1(p_occasion_id);

  -- Resolve recipient
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

  if v_sender_name is null and v_member_id is not null then
    select nullif(btrim(coalesce(mp.display_name, '')), '') into v_sender_name
    from public.member_profiles mp where mp.id = v_member_id;
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
    'recipient_id', v_recipient_id
  );
end;
$$;

revoke all on function public.occasion_interaction_submit_v1(bigint, text, text, text, text, bigint) from public;
grant execute on function public.occasion_interaction_submit_v1(bigint, text, text, text, text, bigint) to anon, authenticated, service_role;

-- ---------- recipient inbox (private) ----------
create or replace function public.occasion_inbox_for_phone_v1(p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
              'sender_name', coalesce(nullif(m.sender_name, ''), 'فرد من العائلة'),
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
          )
        group by e.id, r.id
      ) q
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.occasion_inbox_for_phone_v1(text) from public;
grant execute on function public.occasion_inbox_for_phone_v1(text) to anon, authenticated, service_role;

-- Public must not learn totals: only sender's own interaction status (optional UX).
create or replace function public.occasion_my_interaction_v1(
  p_occasion_id bigint,
  p_sender_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text := nullif(btrim(coalesce(p_sender_phone, '')), '');
  v_row public.occasion_interactions%rowtype;
begin
  if p_occasion_id is null or v_phone is null then
    return jsonb_build_object('ok', true, 'interaction', null);
  end if;
  select * into v_row
  from public.occasion_interactions
  where occasion_id = p_occasion_id
    and public.phones_match_v1(sender_phone, v_phone)
  limit 1;
  if not found then
    return jsonb_build_object('ok', true, 'interaction', null);
  end if;
  return jsonb_build_object(
    'ok', true,
    'interaction', jsonb_build_object(
      'id', v_row.id,
      'interaction_type_key', v_row.interaction_type_key,
      'message', v_row.message,
      'updated_at', v_row.updated_at
    )
  );
end;
$$;

revoke all on function public.occasion_my_interaction_v1(bigint, text) from public;
grant execute on function public.occasion_my_interaction_v1(bigint, text) to anon, authenticated, service_role;

-- ---------- seed catalog (idempotent by key) ----------
insert into public.occasion_interaction_types as t
  (key, family, applies_to_types, track, label, full_text, allows_message, sort_order)
values
  -- Achievement / promotion / graduation notices
  ('bless_success', 'news', array['promotion_notice','graduation_notice','success','achievement','appointment','retirement_notice','certification','family_news','promotion','graduation','retirement'], null, 'بارك الله لك', 'بارك الله لك', false, 10),
  ('you_deserve', 'news', array['promotion_notice','graduation_notice','success','achievement','appointment','retirement_notice','certification','promotion','graduation','retirement'], null, 'تستاهل، ومنها للأعلى', 'تستاهل، ومنها للأعلى', false, 20),
  ('family_pride', 'news', array['promotion_notice','graduation_notice','success','achievement','appointment','certification','promotion','graduation'], null, 'فخر لنا', 'فخر لنا ولعائلتك', false, 30),
  ('pray_tawfiq', 'news', array['promotion_notice','graduation_notice','success','achievement','appointment','retirement_notice','certification','family_news','promotion','graduation','retirement'], null, 'وفقك الله', 'وفقك الله وزادك نجاحًا', false, 40),
  ('ask_tawfiq', 'news', array['promotion_notice','graduation_notice','success','achievement','appointment','certification','promotion','graduation'], null, 'أسأل الله لك التوفيق', 'أسأل الله لك التوفيق', false, 50),
  ('msg_success', 'news', array['promotion_notice','graduation_notice','success','achievement','appointment','retirement_notice','certification','family_news','promotion','graduation','retirement'], null, 'رسالة خاصة', 'رسالة خاصة', true, 90),

  -- Marriage notice
  ('m_barak_lakuma', 'news', array['marriage'], null, 'بارك الله لكما', 'بارك الله لكما', false, 10),
  ('m_barak_alaykuma', 'news', array['marriage'], null, 'بارك الله عليكما', 'بارك الله عليكما', false, 20),
  ('m_jamaa', 'news', array['marriage'], null, 'جمع الله بينكما في خير', 'جمع الله بينكما في خير', false, 30),
  ('m_saadah', 'news', array['marriage'], null, 'أسأل الله لكما السعادة', 'أسأل الله لكما السعادة', false, 40),
  ('m_mubarak', 'news', array['marriage'], null, 'جعله الله زواجًا مباركًا', 'جعله الله زواجًا مباركًا', false, 50),
  ('msg_marriage', 'news', array['marriage'], null, 'رسالة خاصة', 'رسالة خاصة', true, 90),

  -- Birth
  ('b_barak', 'news', array['birth'], null, 'بارك الله لكم فيه', 'بارك الله لكم فيه', false, 10),
  ('b_saliheen', 'news', array['birth'], null, 'جعله الله من الصالحين', 'جعله الله من الصالحين', false, 20),
  ('b_nabat', 'news', array['birth'], null, 'أنبته الله نباتًا حسنًا', 'أنبته الله نباتًا حسنًا', false, 30),
  ('b_qurrah', 'news', array['birth'], null, 'جعله الله قرة عين لكم', 'جعله الله قرة عين لكم', false, 40),
  ('b_birr', 'news', array['birth'], null, 'رزقكم الله بره وصلاحه', 'رزقكم الله بره وصلاحه', false, 50),
  ('msg_birth', 'news', array['birth'], null, 'رسالة خاصة', 'رسالة خاصة', true, 90),

  -- New house
  ('h_barak', 'news', array['new_house'], null, 'بارك الله لك فيه', 'بارك الله لك فيه', false, 10),
  ('h_khair', 'news', array['new_house'], null, 'جعله الله منزل خير وبركة', 'جعله الله منزل خير وبركة', false, 20),
  ('h_taaah', 'news', array['new_house'], null, 'أسأل الله أن يجعله عامرًا بالطاعة', 'أسأل الله أن يجعله عامرًا بالطاعة', false, 30),
  ('h_hanna', 'news', array['new_house'], null, 'الله يهنيكم فيه', 'الله يهنيكم فيه', false, 40),
  ('msg_house', 'news', array['new_house'], null, 'رسالة', 'رسالة خاصة', true, 90),

  -- Health
  ('heal_ask', 'health', array['sick','operation','healing','discharge','safety'], null, 'أسأل الله أن يشفيه', 'أسأل الله العظيم رب العرش العظيم أن يشفيك', false, 10),
  ('heal_shifa', 'health', array['sick','operation','healing','discharge','safety'], null, 'شفاه الله وعافاه', 'شفاه الله وعافاه', false, 20),
  ('heal_tahoor', 'health', array['sick','operation','discharge','safety'], null, 'لا بأس، طهور إن شاء الله', 'لا بأس عليه، طهور إن شاء الله', false, 30),
  ('heal_duat', 'health', array['sick','operation','healing','discharge','safety'], null, 'دعوت له', 'دعوت له بالشفاء والعافية', false, 40),
  ('heal_tamam', 'health', array['sick','operation','healing','discharge','safety'], null, 'تمام العافية', 'أسأل الله له تمام العافية', false, 50),
  ('msg_health', 'health', array['sick','operation','healing','discharge','safety'], null, 'رسالة خاصة', 'رسالة خاصة', true, 90),

  -- Death: deceased track
  ('d_rahimahullah', 'death', array['death','condolence'], 'deceased', 'رحمه الله', 'رحمه الله', false, 10),
  ('d_ghafar', 'death', array['death','condolence'], 'deceased', 'غفر الله له', 'غفر الله له', false, 20),
  ('d_jannah', 'death', array['death','condolence'], 'deceased', 'أسكنه فسيح جناته', 'أسأل الله أن يسكنه فسيح جناته', false, 30),
  ('d_raf', 'death', array['death','condolence'], 'deceased', 'اللهم ارفع درجته', 'اللهم ارفع درجته في المهديين', false, 40),

  -- Death: bereaved track
  ('k_azza', 'death', array['death','condolence'], 'bereaved', 'أحسن الله عزاءكم', 'أحسن الله عزاءكم', false, 50),
  ('k_jabar', 'death', array['death','condolence'], 'bereaved', 'جبر الله مصابكم', 'جبر الله مصابكم', false, 60),
  ('k_ajr', 'death', array['death','condolence'], 'bereaved', 'أعظم الله أجركم', 'أعظم الله أجركم', false, 70),
  ('k_sabr', 'death', array['death','condolence'], 'bereaved', 'صبركم الله', 'صبركم الله وربط على قلوبكم', false, 80),
  ('msg_condolence', 'death', array['death','condolence'], 'bereaved', 'رسالة مواساة', 'رسالة مواساة', true, 90),

  -- Wedding / contract occasions
  ('w_barak_lakuma', 'occasion', array['wedding','contract'], null, 'بارك الله لكما', 'بارك الله لكما', false, 10),
  ('w_barak_alaykuma', 'occasion', array['wedding','contract'], null, 'بارك الله عليكما', 'بارك الله عليكما', false, 20),
  ('w_jamaa', 'occasion', array['wedding','contract'], null, 'جمع الله بينكما في خير', 'جمع الله بينكما في خير', false, 30),
  ('w_mubarak', 'occasion', array['wedding','contract'], null, 'جعله الله زواجًا مباركًا', 'جعله الله زواجًا مباركًا', false, 40),
  ('msg_wedding', 'occasion', array['wedding','contract'], null, 'رسالة خاصة', 'رسالة خاصة', true, 90),

  -- Aqiqa
  ('a_barak', 'occasion', array['aqiqa'], null, 'بارك الله لكم فيه', 'بارك الله لكم فيه', false, 10),
  ('a_salih', 'occasion', array['aqiqa'], null, 'جعله الله من الصالحين', 'جعله الله من الصالحين', false, 20),
  ('msg_aqiqa', 'occasion', array['aqiqa'], null, 'رسالة خاصة', 'رسالة خاصة', true, 90),

  -- Invitations / gatherings (actions)
  ('inv_yes', 'occasion', array['feast','gathering','family_meetup','dinner','lunch','general'], null, 'بإذن الله حاضر', 'بإذن الله سأحضر', false, 10),
  ('inv_no', 'occasion', array['feast','gathering','family_meetup','dinner','lunch','general'], null, 'أعتذر عن الحضور', 'أعتذر عن الحضور', false, 20),
  ('inv_maybe', 'occasion', array['feast','gathering','family_meetup','dinner','lunch','general'], null, 'سأحاول الحضور', 'سأحاول الحضور إن شاء الله', false, 30),
  ('inv_details', 'occasion', array['feast','gathering','family_meetup','dinner','lunch','general'], null, 'أحتاج تفاصيل', 'أحتاج تفاصيل إضافية', true, 40),
  ('inv_contact', 'occasion', array['feast','gathering','family_meetup','dinner','lunch','general'], null, 'سأتواصل معك', 'سأتواصل معك', false, 50)
on conflict (key) do update set
  family = excluded.family,
  applies_to_types = excluded.applies_to_types,
  track = excluded.track,
  label = excluded.label,
  full_text = excluded.full_text,
  allows_message = excluded.allows_message,
  sort_order = excluded.sort_order,
  is_active = true;

-- Link/update a recipient so inbox can resolve by phone or person_id (admin).
create or replace function public.admin_occasion_recipient_upsert_v1(
  p_token text,
  p_occasion_id bigint,
  p_recipient_name text,
  p_recipient_role text default 'honoree',
  p_recipient_phone text default null,
  p_recipient_person_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
  v_name text := nullif(btrim(coalesce(p_recipient_name, '')), '');
  v_role text := coalesce(nullif(btrim(coalesce(p_recipient_role, '')), ''), 'honoree');
begin
  if not public.admin_token_ok_v1(p_token) then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;
  if p_occasion_id is null or v_name is null then
    return jsonb_build_object('ok', false, 'error', 'missing_fields');
  end if;

  perform public.occasion_ensure_default_recipients_v1(p_occasion_id);

  select r.id into v_id
  from public.occasion_recipients r
  where r.occasion_id = p_occasion_id
    and r.is_active
    and lower(r.recipient_name) = lower(v_name)
    and r.recipient_role = v_role
  limit 1;

  if v_id is null then
    insert into public.occasion_recipients (
      occasion_id, recipient_role, recipient_name, recipient_phone, recipient_person_id
    ) values (
      p_occasion_id, v_role, v_name, nullif(btrim(coalesce(p_recipient_phone, '')), ''), p_recipient_person_id
    ) returning id into v_id;
  else
    update public.occasion_recipients r
    set recipient_phone = coalesce(nullif(btrim(coalesce(p_recipient_phone, '')), ''), r.recipient_phone),
        recipient_person_id = coalesce(p_recipient_person_id, r.recipient_person_id)
    where r.id = v_id;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke all on function public.admin_occasion_recipient_upsert_v1(text, bigint, text, text, text, uuid) from public;
grant execute on function public.admin_occasion_recipient_upsert_v1(text, bigint, text, text, text, uuid) to anon, authenticated, service_role;

