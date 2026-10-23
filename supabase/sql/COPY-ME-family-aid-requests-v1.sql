-- COPY-ME: Preset id: maint.family_aid_requests_v1
-- طلبات مساعدة خاصة (أرملة / مطلقة / أخرى).
-- الإرسال من التطبيق للجوال المسجّل فقط.
-- النشر العام بلا اسم؛ التحويل عبر صندوق/إدارة العائلة.
-- Safe to re-run.

create table if not exists public.family_aid_requests (
  id bigint generated always as identity primary key,
  member_phone text not null,
  tree_child_id bigint null,
  branch_key text null,
  situation text not null,
  need_text text not null,
  hide_name boolean not null default true,
  contact_phone text null,
  status text not null default 'pending',
  public_title text null,
  public_body text null,
  publish_contact_note text null,
  admin_note text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz null,
  closed_at timestamptz null,
  constraint family_aid_requests_situation_chk
    check (situation in ('widow', 'divorced', 'other')),
  constraint family_aid_requests_status_chk
    check (status in ('pending', 'published', 'closed', 'declined'))
);

create index if not exists family_aid_requests_status_idx
  on public.family_aid_requests (status, created_at desc);

create index if not exists family_aid_requests_phone_idx
  on public.family_aid_requests (member_phone, created_at desc);

alter table public.family_aid_requests enable row level security;

drop policy if exists family_aid_requests_deny_all on public.family_aid_requests;
-- No direct anon access; all reads/writes go through security definer RPCs.

create or replace function public.family_aid_normalize_situation_v1(p text)
returns text
language sql
immutable
as $fn$
  select case
    when g in ('widow', 'أرملة', 'ارملة', 'أرمل') then 'widow'
    when g in ('divorced', 'مطلقة', 'مطلقه', 'مطلق') then 'divorced'
    when g in ('other', 'أخرى', 'اخرى', 'غير') then 'other'
    else null
  end
  from (select lower(btrim(coalesce(p, ''))) as g) s;
$fn$;

grant execute on function public.family_aid_normalize_situation_v1(text) to anon, authenticated;

create or replace function public.family_aid_situation_label_v1(p text)
returns text
language sql
immutable
as $fn$
  select case public.family_aid_normalize_situation_v1(p)
    when 'widow' then 'أرملة'
    when 'divorced' then 'مطلقة'
    when 'other' then 'أخرى'
    else 'مساعدة'
  end;
$fn$;

grant execute on function public.family_aid_situation_label_v1(text) to anon, authenticated;

create or replace function public.member_aid_request_submit_v1(
  p_phone text,
  p_situation text,
  p_need_text text,
  p_hide_name boolean default true,
  p_contact_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_phone text;
  v_digits text;
  v_situation text;
  v_need text;
  v_contact text;
  v_mp public.member_profiles%rowtype;
  v_id bigint;
begin
  if to_regprocedure('public.member_phone_registered_v1(text)') is null then
    return jsonb_build_object('ok', false, 'error', 'sql_missing');
  end if;

  v_phone := public.member_phone_registered_v1(p_phone);
  if v_phone is null then
    return jsonb_build_object('ok', false, 'error', 'not_registered');
  end if;

  v_situation := public.family_aid_normalize_situation_v1(p_situation);
  if v_situation is null then
    return jsonb_build_object('ok', false, 'error', 'bad_situation');
  end if;

  v_need := nullif(btrim(coalesce(p_need_text, '')), '');
  if v_need is null or char_length(v_need) < 8 then
    return jsonb_build_object('ok', false, 'error', 'need_too_short');
  end if;
  if char_length(v_need) > 800 then
    v_need := left(v_need, 800);
  end if;

  v_contact := nullif(btrim(coalesce(p_contact_phone, '')), '');
  if v_contact is null then
    v_contact := v_phone;
  end if;

  v_digits := nullif(right(regexp_replace(coalesce(v_phone, ''), '[^0-9]', '', 'g'), 9), '');
  if to_regclass('public.member_profiles') is not null and v_digits is not null then
    select mp.* into v_mp
    from public.member_profiles mp
    where right(regexp_replace(coalesce(mp.phone, ''), '[^0-9]', '', 'g'), 9) = v_digits
      and coalesce(nullif(btrim(coalesce(mp.status, '')), ''), 'active') is distinct from 'pending_family'
    order by mp.updated_at desc nulls last, mp.id desc
    limit 1;
  end if;

  insert into public.family_aid_requests (
    member_phone,
    tree_child_id,
    branch_key,
    situation,
    need_text,
    hide_name,
    contact_phone,
    status
  ) values (
    v_phone,
    nullif(v_mp.tree_child_id, 0),
    nullif(btrim(coalesce(v_mp.branch_key, '')), ''),
    v_situation,
    v_need,
    coalesce(p_hide_name, true),
    v_contact,
    'pending'
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'status', 'pending');
exception when others then
  return jsonb_build_object('ok', false, 'error', 'insert_failed', 'detail', left(sqlerrm, 160));
end;
$fn$;

revoke all on function public.member_aid_request_submit_v1(text, text, text, boolean, text) from public;
grant execute on function public.member_aid_request_submit_v1(text, text, text, boolean, text) to anon, authenticated;

create or replace function public.member_aid_requests_mine_v1(p_phone text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_phone text;
  v_digits text;
begin
  if to_regprocedure('public.member_phone_registered_v1(text)') is null then
    return jsonb_build_object('ok', false, 'error', 'sql_missing', 'rows', '[]'::jsonb);
  end if;
  v_phone := public.member_phone_registered_v1(p_phone);
  if v_phone is null then
    return jsonb_build_object('ok', false, 'error', 'not_registered', 'rows', '[]'::jsonb);
  end if;
  v_digits := nullif(right(regexp_replace(coalesce(v_phone, ''), '[^0-9]', '', 'g'), 9), '');

  return jsonb_build_object(
    'ok', true,
    'rows', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc)
      from (
        select
          r.id,
          r.situation,
          public.family_aid_situation_label_v1(r.situation) as situation_label,
          r.need_text,
          r.hide_name,
          r.status,
          r.public_title,
          r.public_body,
          r.publish_contact_note,
          r.created_at,
          r.updated_at,
          r.published_at,
          r.closed_at
        from public.family_aid_requests r
        where right(regexp_replace(coalesce(r.member_phone, ''), '[^0-9]', '', 'g'), 9) = v_digits
        order by r.created_at desc
        limit 50
      ) x
    ), '[]'::jsonb)
  );
end;
$fn$;

revoke all on function public.member_aid_requests_mine_v1(text) from public;
grant execute on function public.member_aid_requests_mine_v1(text) to anon, authenticated;

create or replace function public.public_aid_requests_published_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  return jsonb_build_object(
    'ok', true,
    'rows', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.published_at desc nulls last, x.id desc)
      from (
        select
          r.id,
          r.situation,
          public.family_aid_situation_label_v1(r.situation) as situation_label,
          coalesce(nullif(btrim(r.public_title), ''), 'طلب مساعدة معتمد') as title,
          coalesce(nullif(btrim(r.public_body), ''), r.need_text) as body,
          coalesce(
            nullif(btrim(r.publish_contact_note), ''),
            'للتقديم: تواصل مع إدارة العائلة. التحويل عبر صندوق العائلة — وليس باسم المستفيدة.'
          ) as contact_note,
          case when coalesce(r.hide_name, true) then null else null end as display_name,
          nullif(btrim(coalesce(r.branch_key, '')), '') as branch_key,
          r.published_at,
          r.created_at
        from public.family_aid_requests r
        where r.status = 'published'
        order by r.published_at desc nulls last, r.id desc
        limit 100
      ) x
    ), '[]'::jsonb)
  );
end;
$fn$;

revoke all on function public.public_aid_requests_published_v1() from public;
grant execute on function public.public_aid_requests_published_v1() to anon, authenticated;

create or replace function public.admin_aid_requests_list_v1(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  if to_regprocedure('public.admin_token_ok_v1(text)') is null
     or not public.admin_token_ok_v1(p_token) then
    return jsonb_build_object('ok', false, 'error', 'not_allowed', 'rows', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'ok', true,
    'rows', coalesce((
      select jsonb_agg(to_jsonb(x) order by
        case x.status when 'pending' then 0 when 'published' then 1 else 2 end,
        x.created_at desc)
      from (
        select
          r.id,
          r.member_phone,
          r.contact_phone,
          r.tree_child_id,
          r.branch_key,
          r.situation,
          public.family_aid_situation_label_v1(r.situation) as situation_label,
          r.need_text,
          r.hide_name,
          r.status,
          r.public_title,
          r.public_body,
          r.publish_contact_note,
          r.admin_note,
          r.created_at,
          r.updated_at,
          r.published_at,
          r.closed_at,
          coalesce(
            nullif(btrim(c.child_name), ''),
            nullif(btrim(to_jsonb(c)->>'name'), ''),
            nullif(btrim(mp.display_name), ''),
            '—'
          ) as member_name
        from public.family_aid_requests r
        left join public.tree_children c on c.id = r.tree_child_id
        left join lateral (
          select m.display_name
          from public.member_profiles m
          where right(regexp_replace(coalesce(m.phone, ''), '[^0-9]', '', 'g'), 9)
              = right(regexp_replace(coalesce(r.member_phone, ''), '[^0-9]', '', 'g'), 9)
          order by m.updated_at desc nulls last
          limit 1
        ) mp on true
        order by r.created_at desc
        limit 300
      ) x
    ), '[]'::jsonb)
  );
end;
$fn$;

revoke all on function public.admin_aid_requests_list_v1(text) from public;
grant execute on function public.admin_aid_requests_list_v1(text) to anon, authenticated;

create or replace function public.admin_aid_request_set_status_v1(
  p_token text,
  p_id bigint,
  p_status text,
  p_admin_note text default null,
  p_public_title text default null,
  p_public_body text default null,
  p_publish_contact_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_status text;
  v_row public.family_aid_requests%rowtype;
begin
  if to_regprocedure('public.admin_token_ok_v1(text)') is null
     or not public.admin_token_ok_v1(p_token) then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;

  if p_id is null or p_id < 1 then
    return jsonb_build_object('ok', false, 'error', 'bad_id');
  end if;

  v_status := lower(btrim(coalesce(p_status, '')));
  if v_status not in ('pending', 'published', 'closed', 'declined') then
    return jsonb_build_object('ok', false, 'error', 'bad_status');
  end if;

  select * into v_row from public.family_aid_requests where id = p_id limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  update public.family_aid_requests r
  set
    status = v_status,
    admin_note = case
      when p_admin_note is null then r.admin_note
      else nullif(btrim(p_admin_note), '')
    end,
    public_title = case
      when v_status = 'published' then coalesce(
        nullif(btrim(coalesce(p_public_title, '')), ''),
        nullif(btrim(r.public_title), ''),
        'طلب مساعدة معتمد'
      )
      else r.public_title
    end,
    public_body = case
      when v_status = 'published' then coalesce(
        nullif(btrim(coalesce(p_public_body, '')), ''),
        nullif(btrim(r.public_body), ''),
        r.need_text
      )
      else r.public_body
    end,
    publish_contact_note = case
      when v_status = 'published' then coalesce(
        nullif(btrim(coalesce(p_publish_contact_note, '')), ''),
        nullif(btrim(r.publish_contact_note), ''),
        'للتقديم: تواصل مع إدارة العائلة. التحويل عبر صندوق العائلة — وليس باسم المستفيدة.'
      )
      else r.publish_contact_note
    end,
    published_at = case
      when v_status = 'published' then coalesce(r.published_at, now())
      else r.published_at
    end,
    closed_at = case
      when v_status in ('closed', 'declined') then now()
      else r.closed_at
    end,
    updated_at = now()
  where r.id = p_id;

  return jsonb_build_object('ok', true, 'id', p_id, 'status', v_status);
exception when others then
  return jsonb_build_object('ok', false, 'error', 'update_failed', 'detail', left(sqlerrm, 160));
end;
$fn$;

revoke all on function public.admin_aid_request_set_status_v1(text, bigint, text, text, text, text, text) from public;
grant execute on function public.admin_aid_request_set_status_v1(text, bigint, text, text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';

select
  (to_regclass('public.family_aid_requests') is not null) as has_table,
  (to_regprocedure('public.member_aid_request_submit_v1(text,text,text,boolean,text)') is not null) as has_submit,
  (to_regprocedure('public.public_aid_requests_published_v1()') is not null) as has_public,
  (to_regprocedure('public.admin_aid_requests_list_v1(text)') is not null) as has_admin_list;
