-- COPY-ME: Preset id: maint.pulse_register_phone_v1
-- Save sender phone on request/occasion if not registered.
-- Pulse ticker: male members only. Mother / daughter / wife never appear.

create table if not exists public.pulse_notices (
  id bigserial primary key,
  kind text not null,
  name text not null,
  person_id text,
  tree_child_id bigint,
  created_at timestamptz not null default now()
);

create index if not exists pulse_notices_created_at_idx
  on public.pulse_notices (created_at desc);

comment on table public.pulse_notices is
  'Pulse ticker rows (phone / son / rename). No phone numbers stored.';

alter table public.pulse_notices enable row level security;
revoke all on table public.pulse_notices from public, anon, authenticated;

-- Pulse news is male members only. Mother / daughter / wife never appear.
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

create or replace function public.pulse_notice_subject_male_v1(
  p_person_id text,
  p_tree_child_id bigint,
  p_name text default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_child public.tree_children%rowtype;
  v_pid text := nullif(btrim(coalesce(p_person_id, '')), '');
begin
  if public.pulse_name_is_female_v1(p_name) then
    return false;
  end if;
  if p_tree_child_id is not null then
    select * into v_child from public.tree_children where id = p_tree_child_id limit 1;
  end if;
  if v_child.id is null and v_pid is not null then
    select * into v_child
    from public.tree_children c
    where c.person_id is not null and c.person_id::text = v_pid
    order by c.id desc
    limit 1;
  end if;
  if v_child.id is null then
    return false;
  end if;
  if to_regprocedure('public.pulse_person_hidden_v1(text)') is not null
     and public.pulse_person_hidden_v1(v_child.gender) then
    return false;
  end if;
  if not public.pulse_person_is_male_v1(v_child.gender) then
    return false;
  end if;
  if to_regclass('public.tree_spouses') is not null then
    if exists (
      select 1 from public.tree_spouses s
      where (
        (to_jsonb(s)->>'wife_person_id') = v_child.person_id::text
        or (to_jsonb(s)->>'wife_tree_child_id') = v_child.id::text
      )
    ) then
      return false;
    end if;
  end if;
  if to_regclass('public.tree_mother_links') is not null then
    if exists (
      select 1 from public.tree_mother_links m
      where (to_jsonb(m)->>'mother_person_id') = v_child.person_id::text
         or (to_jsonb(m)->>'mother_id') = v_child.id::text
    ) then
      return false;
    end if;
  end if;
  return true;
end;
$fn$;

create or replace function public.pulse_notice_write_v1(
  p_kind text,
  p_name text,
  p_person_id text default null,
  p_tree_child_id bigint default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_kind text := nullif(btrim(coalesce(p_kind, '')), '');
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_id bigint;
begin
  if v_kind is null or v_name is null then
    return null;
  end if;
  if v_kind in ('phone', 'son', 'rename')
     and not public.pulse_notice_subject_male_v1(p_person_id, p_tree_child_id, v_name) then
    return null;
  end if;
  if exists (
    select 1 from public.pulse_notices n
    where n.kind = v_kind
      and n.name = v_name
      and n.created_at >= now() - interval '3 hours'
  ) then
    select n.id into v_id
    from public.pulse_notices n
    where n.kind = v_kind and n.name = v_name
      and n.created_at >= now() - interval '3 hours'
    order by n.id desc
    limit 1;
    return v_id;
  end if;
  insert into public.pulse_notices (kind, name, person_id, tree_child_id)
  values (v_kind, v_name, nullif(btrim(coalesce(p_person_id, '')), ''), p_tree_child_id)
  returning id into v_id;
  return v_id;
end;
$fn$;

-- Register a sender phone even if the tree person is not resolved yet.
create or replace function public.register_sender_phone_v1(
  p_phone text,
  p_name text default null,
  p_branch text default null,
  p_tree_child_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_phone text;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_branch text := nullif(btrim(coalesce(p_branch, '')), '');
  v_child public.tree_children%rowtype;
  v_mp public.member_profiles%rowtype;
  v_had_phone boolean := false;
  v_nasab text;
  v_id bigint;
begin
  if to_regprocedure('public.member_phone_stored_v1(text)') is not null then
    v_phone := public.member_phone_stored_v1(p_phone);
  else
    v_phone := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
    if v_phone like '966%' and char_length(v_phone) >= 12 then
      v_phone := '0' || substr(v_phone, 4);
    elsif char_length(v_phone) = 9 and substr(v_phone, 1, 1) = '5' then
      v_phone := '0' || v_phone;
    end if;
    v_phone := nullif(v_phone, '');
  end if;
  if v_phone is null or char_length(regexp_replace(v_phone, '\D', '', 'g')) < 9 then
    return jsonb_build_object('ok', false, 'error', 'bad_phone');
  end if;

  if p_tree_child_id is not null then
    select * into v_child from public.tree_children where id = p_tree_child_id limit 1;
  end if;

  if v_child.id is not null then
    v_nasab := public.pulse_nasab_v1(coalesce(v_child.child_name, to_jsonb(v_child)->>'name', v_name));
  else
    v_nasab := coalesce(
      case when to_regprocedure('public.pulse_nasab_v1(text)') is not null
        then public.pulse_nasab_v1(v_name) else v_name end,
      v_name
    );
  end if;
  v_nasab := nullif(btrim(coalesce(v_nasab, '')), '');

  if to_regclass('public.member_profiles') is null then
    perform public.pulse_notice_write_v1('phone', coalesce(v_nasab, 'عضو'), null, v_child.id);
    return jsonb_build_object('ok', true, 'action', 'notice_only');
  end if;

  select mp.* into v_mp
  from public.member_profiles mp
  where right(regexp_replace(coalesce(mp.phone, ''), '\D', '', 'g'), 9)
      = right(regexp_replace(v_phone, '\D', '', 'g'), 9)
    and char_length(right(regexp_replace(v_phone, '\D', '', 'g'), 9)) = 9
  order by mp.id desc
  limit 1;
  if found then
    v_had_phone := nullif(btrim(coalesce(v_mp.phone, '')), '') is not null;
    update public.member_profiles set
      phone = v_phone,
      branch_key = coalesce(v_branch, branch_key),
      tree_child_id = coalesce(v_child.id, tree_child_id),
      person_id = coalesce(v_child.person_id, person_id),
      display_name = coalesce(v_nasab, display_name),
      status = coalesce(nullif(btrim(coalesce(status, '')), ''), 'active'),
      updated_at = now()
    where id = v_mp.id;
    if not v_had_phone then
      perform public.pulse_notice_write_v1('phone', coalesce(v_nasab, 'عضو'), v_child.person_id::text, v_child.id);
    end if;
    return jsonb_build_object('ok', true, 'action', 'updated', 'member_id', v_mp.id, 'new_phone', not v_had_phone);
  end if;

  begin
    insert into public.member_profiles (
      phone, branch_key, tree_child_id, person_id, display_name, status, created_at, updated_at
    ) values (
      v_phone,
      coalesce(v_branch, v_child.branch_key),
      v_child.id,
      v_child.person_id,
      v_nasab,
      'active',
      now(),
      now()
    )
    returning id into v_id;
  exception when others then
    begin
      insert into public.member_profiles (phone, branch_key, display_name, status, created_at, updated_at)
      values (v_phone, v_branch, v_nasab, 'active', now(), now())
      returning id into v_id;
    exception when others then
      perform public.pulse_notice_write_v1('phone', coalesce(v_nasab, 'عضو'), null, v_child.id);
      return jsonb_build_object('ok', false, 'error', 'profile_insert_failed', 'notice', true);
    end;
  end;

  perform public.pulse_notice_write_v1('phone', coalesce(v_nasab, 'عضو'), v_child.person_id::text, v_child.id);
  return jsonb_build_object('ok', true, 'action', 'inserted', 'member_id', v_id);
end;
$fn$;

create or replace function public.trg_approval_request_register_phone()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if nullif(btrim(coalesce(NEW.phone, '')), '') is null then
    return NEW;
  end if;
  if btrim(coalesce(NEW.kind, '')) in ('member_registration', 'member_phone_register')
     or position('MEMBER_PHONE_REGISTER_V1' in coalesce(NEW.message, '')) > 0 then
    return NEW;
  end if;
  begin
    perform public.register_sender_phone_v1(
      NEW.phone,
      coalesce(NEW.name, ''),
      NEW.branch_key,
      null
    );
  exception when others then
    null;
  end;
  begin
    if to_regprocedure('public.bind_approval_request_sender_phone_v1(bigint)') is not null then
      perform public.bind_approval_request_sender_phone_v1(NEW.id);
    end if;
  exception when others then
    null;
  end;
  return NEW;
end;
$fn$;

drop trigger if exists trg_approval_request_register_phone on public.approval_requests;
drop trigger if exists trg_approval_request_bind_sender_phone on public.approval_requests;
create trigger trg_approval_request_register_phone
after insert or update of phone, status, message, kind, branch_key, name
on public.approval_requests
for each row
execute function public.trg_approval_request_register_phone();

create or replace function public.trg_tree_child_pulse_son()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_name text;
begin
  v_name := public.pulse_nasab_v1(coalesce(NEW.child_name, to_jsonb(NEW)->>'name'));
  if nullif(btrim(coalesce(v_name, '')), '') is null then
    return NEW;
  end if;
  perform public.pulse_notice_write_v1('son', v_name, NEW.person_id::text, NEW.id);
  return NEW;
end;
$fn$;

drop trigger if exists trg_tree_child_pulse_son on public.tree_children;
create trigger trg_tree_child_pulse_son
after insert on public.tree_children
for each row
execute function public.trg_tree_child_pulse_son();

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
  if to_regclass('public.pulse_notices') is not null then
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
revoke all on function public.register_sender_phone_v1(text, text, text, bigint) from public;
grant execute on function public.register_sender_phone_v1(text, text, text, bigint) to anon, authenticated;
grant execute on function public.pulse_notice_write_v1(text, text, text, bigint) to authenticated;

-- Backfill: every request/occasion phone that is not yet a member login.
do $bf$
declare
  r record;
begin
  for r in
    select id, phone, name, branch_key, message, kind
    from public.approval_requests
    where nullif(btrim(coalesce(phone, '')), '') is not null
      and coalesce(kind, '') not in ('member_registration', 'member_phone_register')
      and position('MEMBER_PHONE_REGISTER_V1' in coalesce(message, '')) = 0
    order by id desc
    limit 400
  loop
    begin
      perform public.register_sender_phone_v1(r.phone, r.name, r.branch_key, null);
    exception when others then
      null;
    end;
  end loop;

  delete from public.pulse_notices n
  where n.kind in ('phone', 'son', 'rename')
    and not public.pulse_notice_subject_male_v1(n.person_id, n.tree_child_id, n.name);

  if to_regclass('public.tree_children') is not null then
    insert into public.pulse_notices (kind, name, person_id, tree_child_id, created_at)
    select
      'son',
      public.pulse_nasab_v1(coalesce(c.child_name, to_jsonb(c)->>'name')),
      c.person_id::text,
      c.id,
      c.created_at
    from public.tree_children c
    where c.created_at >= now() - interval '3 hours'
      and public.pulse_notice_subject_male_v1(c.person_id::text, c.id, public.pulse_nasab_v1(coalesce(c.child_name, to_jsonb(c)->>'name')))
      and nullif(public.pulse_nasab_v1(coalesce(c.child_name, to_jsonb(c)->>'name')), '') is not null
      and not exists (
        select 1 from public.pulse_notices n
        where n.kind = 'son'
          and n.tree_child_id = c.id
          and n.created_at >= now() - interval '3 hours'
      );
  end if;
end;
$bf$;
