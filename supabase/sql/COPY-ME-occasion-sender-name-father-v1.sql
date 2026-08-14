-- Patch: sender display = اسم + أب (not first name only)
-- Run in Supabase SQL editor once.

create or replace function public.short_name_with_father_v1(p_full text)
returns text
language plpgsql
immutable
set search_path = public
as $fn$
declare
  v text := nullif(btrim(regexp_replace(coalesce(p_full, ''), '\s+', ' ', 'g')), '');
  segs text[];
  leaf text;
  parent text;
  toks text[] := array[]::text[];
  w text;
  leaf_toks text[];
  parent_toks text[];
begin
  if v is null then
    return null;
  end if;

  if position('/' in v) > 0 then
    segs := array_remove(string_to_array(v, '/'), '');
    if coalesce(cardinality(segs), 0) >= 2 then
      leaf := nullif(btrim(segs[cardinality(segs)]), '');
      parent := nullif(btrim(segs[cardinality(segs) - 1]), '');
      leaf_toks := array[]::text[];
      parent_toks := array[]::text[];
      foreach w in array regexp_split_to_array(coalesce(leaf, ''), '\s+') loop
        if w <> '' and w not in ('بن', 'ابن', 'بنت') then
          leaf_toks := array_append(leaf_toks, w);
        end if;
      end loop;
      foreach w in array regexp_split_to_array(coalesce(parent, ''), '\s+') loop
        if w <> '' and w not in ('بن', 'ابن', 'بنت') then
          parent_toks := array_append(parent_toks, w);
        end if;
      end loop;
      if coalesce(cardinality(leaf_toks), 0) >= 1 and coalesce(cardinality(parent_toks), 0) >= 1 then
        return leaf_toks[1] || ' ' || parent_toks[1];
      end if;
    elsif coalesce(cardinality(segs), 0) = 1 then
      v := nullif(btrim(segs[1]), '');
    end if;
  end if;

  foreach w in array regexp_split_to_array(coalesce(v, ''), '\s+') loop
    if w <> '' and w not in ('بن', 'ابن', 'بنت') then
      toks := array_append(toks, w);
    end if;
  end loop;

  if coalesce(cardinality(toks), 0) >= 2 then
    return toks[1] || ' ' || toks[2];
  end if;
  if coalesce(cardinality(toks), 0) = 1 then
    return toks[1];
  end if;
  return null;
end;
$fn$;

create or replace function public.member_name_with_father_from_phone_v1(p_phone text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_mp public.member_profiles%rowtype;
  v_child text;
  v_parent text;
  v_out text;
  v_child_first text;
  v_parent_first text;
begin
  if v_phone is null then
    return null;
  end if;

  select * into v_mp
  from public.member_profiles mp
  where mp.status = 'active'
    and public.phones_match_v1(mp.phone, v_phone)
  order by mp.updated_at desc nulls last
  limit 1;

  if not found then
    return null;
  end if;

  -- 1) من بطاقة الشجرة: اسم الابن + اسم الأب
  if v_mp.tree_child_id is not null then
    select nullif(btrim(coalesce(c.child_name, c.name, '')), ''),
           nullif(btrim(coalesce(c.parent_name, c.parent, '')), '')
      into v_child, v_parent
    from public.tree_children c
    where c.id = v_mp.tree_child_id
    limit 1;

    if v_child is not null and position('/' in v_child) > 0 then
      v_out := public.short_name_with_father_v1(v_child);
      if v_out is not null and position(' ' in v_out) > 0 then
        return v_out;
      end if;
    end if;

    v_child_first := public.short_name_with_father_v1(v_child);
    -- short on single name returns one token
    if v_child_first is not null and position(' ' in v_child_first) > 0 then
      return v_child_first;
    end if;
    v_parent_first := public.short_name_with_father_v1(v_parent);
    if v_child_first is not null and v_parent_first is not null then
      -- take first token of each
      return split_part(v_child_first, ' ', 1) || ' ' || split_part(v_parent_first, ' ', 1);
    end if;
  end if;

  -- 2) من الاسم المعروض: حسن بن خميس بن دليميك → حسن خميس
  v_out := public.short_name_with_father_v1(v_mp.display_name);
  if v_out is not null then
    return v_out;
  end if;

  return nullif(btrim(coalesce(v_mp.display_name, '')), '');
end;
$fn$;

revoke all on function public.short_name_with_father_v1(text) from public;
grant execute on function public.short_name_with_father_v1(text) to anon, authenticated, service_role;
revoke all on function public.member_name_with_father_from_phone_v1(text) from public;
grant execute on function public.member_name_with_father_from_phone_v1(text) to anon, authenticated, service_role;

-- Submit: always prefer اسم+أب from tree/profile
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

  if cardinality(v_type.applies_to_types) > 0
     and not (lower(coalesce(v_event.type, '')) = any (v_type.applies_to_types)) then
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

-- Inbox: always show اسم+أب for sender (resolve from phone if stored name is short)
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
          )
        group by e.id, r.id
      ) q
    ), '[]'::jsonb)
  );
end;
$fn$;

revoke all on function public.occasion_inbox_for_phone_v1(text) from public;
grant execute on function public.occasion_inbox_for_phone_v1(text) to anon, authenticated, service_role;

-- Backfill stored names
update public.occasion_interactions i
set sender_name = coalesce(
  public.member_name_with_father_from_phone_v1(i.sender_phone),
  public.short_name_with_father_v1(i.sender_name),
  i.sender_name
),
updated_at = now()
where i.sender_phone is not null;
