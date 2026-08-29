-- COPY-ME: Preset id: maint.pulse_family_board_v1
-- Pulse ticker: member phone / new son / renamed person (3 hours).
-- New delegate only (1 day). If none: client shows short duas — not the full roster.
-- No phones in the payload. Male members only — mother / daughter / wife never appear.

create or replace function public.pulse_nasab_v1(p_path text)
returns text
language plpgsql
immutable
as $fn$
declare
  v_parts text[];
  v_n int;
  v_out text := '';
  i int;
  v_prev text := '';
  v_cur text;
begin
  if nullif(btrim(coalesce(p_path, '')), '') is null then
    return '';
  end if;
  v_parts := regexp_split_to_array(btrim(p_path), '/');
  v_n := coalesce(array_length(v_parts, 1), 0);
  if v_n < 1 then
    return btrim(p_path);
  end if;
  for i in reverse greatest(1, v_n - 2)..v_n loop
    v_cur := btrim(regexp_replace(coalesce(v_parts[i], ''), '\s*(رحمه الله|\(رحمه الله\))\s*', '', 'g'));
    if v_cur = '' or v_cur = v_prev then
      continue;
    end if;
    if v_out = '' then
      v_out := v_cur;
    else
      v_out := v_out || ' بن ' || v_cur;
    end if;
    v_prev := v_cur;
  end loop;
  return v_out;
end;
$fn$;

create or replace function public.pulse_person_hidden_v1(p_gender text)
returns boolean
language sql
immutable
as $fn$
  select lower(btrim(coalesce(p_gender, ''))) in (
    'daughter', 'female', 'f', 'أنثى', 'انثى', 'ابنة', 'بنت',
    'wife', 'mother', 'زوجة', 'أم', 'ام', 'والدة'
  );
$fn$;

create or replace function public.pulse_person_is_male_v1(p_gender text)
returns boolean
language sql
immutable
as $fn$
  select lower(btrim(coalesce(p_gender, ''))) in (
    'son', 'male', 'm', 'ذكر', 'ابن', 'ولد'
  );
$fn$;

create or replace function public.pulse_name_is_female_v1(p_name text)
returns boolean
language sql
immutable
as $fn$
  select
    coalesce(p_name, '') ~ '(^|[[:space:]/])(بنت|ابنة|ابنت|زوجة|الام|الأم|والدة)([[:space:]/]|$)'
    or lower(btrim(coalesce(p_name, ''))) in ('wife', 'mother', 'daughter');
$fn$;

create or replace function public.pulse_family_board_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_notices jsonb := '[]'::jsonb;
  v_delegates jsonb := '[]'::jsonb;
  v_since timestamptz := now() - interval '3 hours';
  v_delegate_since timestamptz := now() - interval '1 day';
begin
  -- Prefer the notices table when present (male-gated at write).
  if to_regclass('public.pulse_notices') is not null
     and to_regprocedure('public.pulse_notice_subject_male_v1(text,bigint,text)') is not null then
    v_notices := coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', n.kind,
        'name', n.name,
        'at', n.created_at
      ) order by
        case n.kind when 'phone' then 0 when 'son' then 1 when 'rename' then 2 else 9 end,
        n.created_at desc)
      from public.pulse_notices n
      where n.created_at >= v_since
        and n.kind in ('phone', 'son', 'rename')
        and nullif(btrim(n.name), '') is not null
        and public.pulse_notice_subject_male_v1(n.person_id, n.tree_child_id, n.name)
    ), '[]'::jsonb);
  else
  -- New member phone (login now possible). Never return the number. Males only.
  if to_regclass('public.member_profiles') is not null
     and to_regclass('public.tree_children') is not null then
    v_notices := v_notices || coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', 'phone',
        'name', public.pulse_nasab_v1(coalesce(c.child_name, to_jsonb(c)->>'name', mp.display_name)),
        'at', coalesce(mp.updated_at, mp.created_at)
      ) order by coalesce(mp.updated_at, mp.created_at) desc)
      from public.member_profiles mp
      join public.tree_children c on c.id = mp.tree_child_id
      where nullif(btrim(coalesce(mp.phone, '')), '') is not null
        and coalesce(mp.status, 'active') = 'active'
        and public.pulse_person_is_male_v1(c.gender)
        and not public.pulse_person_hidden_v1(c.gender)
        and not public.pulse_name_is_female_v1(
          public.pulse_nasab_v1(coalesce(c.child_name, to_jsonb(c)->>'name', mp.display_name))
        )
        and coalesce(mp.updated_at, mp.created_at) >= v_since
        and nullif(public.pulse_nasab_v1(coalesce(c.child_name, to_jsonb(c)->>'name', mp.display_name)), '') is not null
    ), '[]'::jsonb);
  end if;

  -- New son on the tree. Fail-closed: proven male only.
  if to_regclass('public.tree_children') is not null then
    v_notices := v_notices || coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', 'son',
        'name', public.pulse_nasab_v1(coalesce(c.child_name, to_jsonb(c)->>'name')),
        'at', c.created_at
      ) order by c.created_at desc)
      from public.tree_children c
      where c.created_at >= v_since
        and public.pulse_person_is_male_v1(c.gender)
        and not public.pulse_person_hidden_v1(c.gender)
        and not public.pulse_name_is_female_v1(
          public.pulse_nasab_v1(coalesce(c.child_name, to_jsonb(c)->>'name'))
        )
        and nullif(public.pulse_nasab_v1(coalesce(c.child_name, to_jsonb(c)->>'name')), '') is not null
    ), '[]'::jsonb);
  end if;

  -- Approved name correction.
  if to_regclass('public.approval_requests') is not null then
    v_notices := v_notices || coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', 'rename',
        'name', public.pulse_nasab_v1(coalesce(r.name, '')),
        'at', coalesce(
          nullif(to_jsonb(r)->>'wf_updated_at', '')::timestamptz,
          nullif(to_jsonb(r)->>'updated_at', '')::timestamptz,
          r.created_at
        )
      ) order by r.created_at desc)
      from public.approval_requests r
      where r.kind in ('tree_edit', 'tree_card')
        and r.status = 'approved'
        and position('MEMBER_PHONE_REGISTER_V1' in coalesce(r.message, '')) = 0
        and coalesce(r.kind, '') not in ('member_phone_register', 'member_registration')
        and (
          coalesce(r.message, '') ilike '%name_correction%'
          or coalesce(r.message, '') ilike '%تصحيح الاسم%'
          or coalesce(r.message, '') ilike '%تصحيح اسم%'
        )
        and coalesce(
          nullif(to_jsonb(r)->>'wf_updated_at', '')::timestamptz,
          nullif(to_jsonb(r)->>'updated_at', '')::timestamptz,
          r.created_at
        ) >= v_since
        and nullif(public.pulse_nasab_v1(coalesce(r.name, '')), '') is not null
        and not public.pulse_name_is_female_v1(public.pulse_nasab_v1(coalesce(r.name, '')))
    ), '[]'::jsonb);
  end if;
  end if;

  if to_regclass('public.delegates_v2') is not null then
    v_delegates := coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', public.pulse_nasab_v1(d.name),
        'branch_key', d.branch_key,
        'at', d.created_at
      ) order by d.created_at desc)
      from public.delegates_v2 d
      where coalesce(d.is_enabled, true) = true
        and d.created_at >= v_delegate_since
        and nullif(btrim(coalesce(d.name, '')), '') is not null
        and nullif(public.pulse_nasab_v1(d.name), '') is not null
    ), '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'ok', true,
    'notices', coalesce(v_notices, '[]'::jsonb),
    'delegates', coalesce(v_delegates, '[]'::jsonb)
  );
end;
$fn$;

revoke all on function public.pulse_family_board_v1() from public;
grant execute on function public.pulse_family_board_v1() to anon, authenticated;
grant execute on function public.pulse_nasab_v1(text) to anon, authenticated;
