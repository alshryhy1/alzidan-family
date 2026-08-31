-- COPY-ME: Preset id: maint.member_trusted_device_v1
-- Phase 1: server trusted device. Phone is identity after first bind, not a login key.
-- One active device per account. Logout revokes server trust.
-- Closes public_app_login_by_phone_v1 and direct member_profiles reads without admin/delegate proof.
-- Does not add Face ID. Safe to re-run.

create table if not exists public.member_trusted_devices (
  id bigint generated always as identity primary key,
  phone_key text not null,
  device_public_id uuid not null,
  secret_hash text not null,
  label text,
  status text not null default 'active',
  bound_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  constraint member_trusted_devices_status_chk
    check (status in ('active', 'revoked', 'pending_transfer'))
);

drop index if exists public.member_trusted_devices_public_id_uidx;
create unique index if not exists member_trusted_devices_public_id_uidx
  on public.member_trusted_devices (device_public_id)
  where status = 'active';

create unique index if not exists member_trusted_devices_one_active_uidx
  on public.member_trusted_devices (phone_key)
  where status = 'active';

create index if not exists member_trusted_devices_phone_status_idx
  on public.member_trusted_devices (phone_key, status);

create table if not exists public.member_device_challenges (
  id bigint generated always as identity primary key,
  phone_key text not null,
  purpose text not null,
  code_hash text not null,
  code_reveal text,
  device_public_id uuid,
  label text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint member_device_challenges_purpose_chk
    check (purpose in ('bind', 'transfer'))
);

create index if not exists member_device_challenges_open_idx
  on public.member_device_challenges (phone_key, purpose, expires_at)
  where consumed_at is null;

create table if not exists public.member_device_transfers (
  id bigint generated always as identity primary key,
  phone_key text not null,
  from_device_public_id uuid,
  to_device_public_id uuid not null,
  to_secret_hash text not null,
  to_label text,
  challenge_id bigint,
  status text not null default 'pending_code',
  ownership_proved_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint member_device_transfers_status_chk
    check (status in ('pending_code', 'pending_admin', 'approved', 'rejected'))
);

create index if not exists member_device_transfers_open_idx
  on public.member_device_transfers (phone_key, status, created_at desc);

alter table public.member_trusted_devices enable row level security;
alter table public.member_device_challenges enable row level security;
alter table public.member_device_transfers enable row level security;

revoke all on table public.member_trusted_devices from public, anon, authenticated;
revoke all on table public.member_device_challenges from public, anon, authenticated;
revoke all on table public.member_device_transfers from public, anon, authenticated;

create or replace function public.member_device_phone_key_v1(p_phone text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_phone text;
begin
  if to_regprocedure('public.push_tokens_norm_phone(text)') is not null then
    v_phone := nullif(public.push_tokens_norm_phone(p_phone), '');
  else
    v_phone := nullif(right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 9), '');
  end if;
  if v_phone is null or char_length(v_phone) < 9 then
    return null;
  end if;
  return v_phone;
end;
$fn$;

create or replace function public.member_device_secret_hash_v1(p_secret text)
returns text
language sql
immutable
as $fn$
  select case
    when char_length(btrim(coalesce(p_secret, ''))) < 32 then null
    else encode(sha256(convert_to(btrim(p_secret), 'UTF8')), 'hex')
  end;
$fn$;

create or replace function public.member_device_header_get_v1(p_name text)
returns text
language plpgsql
stable
as $fn$
declare
  v_raw text;
  v_json jsonb;
  v_key text := lower(btrim(coalesce(p_name, '')));
begin
  if v_key = '' then
    return null;
  end if;
  begin
    v_raw := current_setting('request.headers', true);
  exception when others then
    return null;
  end;
  if v_raw is null or btrim(v_raw) = '' then
    return null;
  end if;
  begin
    v_json := v_raw::jsonb;
  exception when others then
    return null;
  end;
  return nullif(btrim(coalesce(v_json ->> v_key, '')), '');
end;
$fn$;

create or replace function public.admin_token_from_request_ok_v1()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_token text;
begin
  v_token := coalesce(
    public.member_device_header_get_v1('x-alzidan-admin-token'),
    public.member_device_header_get_v1('x-admin-token')
  );
  if v_token is null then
    return false;
  end if;
  if to_regprocedure('public.admin_token_ok_v1(text)') is null then
    return false;
  end if;
  return public.admin_token_ok_v1(v_token);
end;
$fn$;

create or replace function public.delegate_from_request_ok_v1()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_phone text;
  v_email text;
  v_hash text;
  v_branch text;
begin
  v_phone := public.member_device_header_get_v1('x-alzidan-delegate-phone');
  v_email := public.member_device_header_get_v1('x-alzidan-delegate-email');
  v_hash := public.member_device_header_get_v1('x-alzidan-delegate-secret-hash');
  v_branch := public.member_device_header_get_v1('x-alzidan-delegate-branch');
  if v_hash is null or (v_phone is null and v_email is null) then
    return false;
  end if;
  if to_regprocedure('public.delegates_v2_find_v1(text, text, text, text)') is null then
    return false;
  end if;
  return public.delegates_v2_find_v1(v_branch, v_phone, v_email, v_hash) is not null;
end;
$fn$;

create or replace function public.member_device_eligible_kind_v1(p_phone text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_key text := public.member_device_phone_key_v1(p_phone);
  v_member public.member_profiles%rowtype;
  v_has_member boolean := false;
  v_has_delegate boolean := false;
  v_complete boolean := false;
begin
  if v_key is null then
    return 'bad_phone';
  end if;

  if to_regclass('public.member_profiles') is not null then
    select m.*
      into v_member
    from public.member_profiles m
    where public.member_device_phone_key_v1(m.phone) = v_key
    order by m.updated_at desc nulls last, m.id desc
    limit 1;
    v_has_member := found;
    if v_has_member
       and coalesce(nullif(btrim(coalesce(v_member.status, '')), ''), 'active') = 'pending_family' then
      return 'pending_family';
    end if;
    v_complete := v_has_member
      and coalesce(v_member.tree_child_id, 0) > 0
      and coalesce(nullif(btrim(coalesce(v_member.status, '')), ''), 'active') is distinct from 'pending_family';
    if v_has_member and not v_complete then
      v_has_member := false;
    end if;
  end if;

  if to_regclass('public.delegates_v2') is not null then
    select true
      into v_has_delegate
    from public.delegates_v2 d
    where coalesce(d.is_enabled, true) = true
      and public.member_device_phone_key_v1(d.phone) = v_key
    limit 1;
    v_has_delegate := coalesce(v_has_delegate, false);
  end if;

  if not v_has_member and not v_has_delegate then
    return 'not_found';
  end if;
  return 'ok';
end;
$fn$;

create or replace function public.member_device_session_json_v1(p_phone text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_key text := public.member_device_phone_key_v1(p_phone);
  v_member public.member_profiles%rowtype;
  v_delegate public.delegates_v2%rowtype;
  v_has_member boolean := false;
  v_has_delegate boolean := false;
  v_role text := 'none';
  v_complete boolean := false;
begin
  if v_key is null then
    return jsonb_build_object('ok', false, 'error', 'bad_phone');
  end if;
  if public.member_device_eligible_kind_v1(p_phone) is distinct from 'ok' then
    return jsonb_build_object('ok', false, 'error', public.member_device_eligible_kind_v1(p_phone));
  end if;

  if to_regclass('public.member_profiles') is not null then
    select m.*
      into v_member
    from public.member_profiles m
    where public.member_device_phone_key_v1(m.phone) = v_key
    order by m.updated_at desc nulls last, m.id desc
    limit 1;
    v_has_member := found;
    v_complete := v_has_member
      and coalesce(v_member.tree_child_id, 0) > 0
      and coalesce(nullif(btrim(coalesce(v_member.status, '')), ''), 'active') is distinct from 'pending_family';
    if v_has_member and not v_complete then
      v_has_member := false;
    end if;
  end if;

  if to_regclass('public.delegates_v2') is not null then
    select d.*
      into v_delegate
    from public.delegates_v2 d
    where coalesce(d.is_enabled, true) = true
      and public.member_device_phone_key_v1(d.phone) = v_key
    order by d.updated_at desc nulls last, d.created_at desc nulls last
    limit 1;
    v_has_delegate := found;
  end if;

  if not v_has_member and not v_has_delegate then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_has_member and v_has_delegate then
    v_role := 'both';
  elsif v_has_delegate then
    v_role := 'delegate';
  else
    v_role := 'member';
  end if;

  return jsonb_build_object(
    'ok', true,
    'role', v_role,
    'phone', coalesce(v_member.phone, v_delegate.phone, v_key),
    'member_id', case when v_has_member then v_member.id else null end,
    'tree_child_id', case when v_has_member then v_member.tree_child_id else null end,
    'person_id', case when v_has_member then v_member.person_id else null end,
    'branch_key', coalesce(
      nullif(btrim(coalesce(case when v_has_member then v_member.branch_key else null end, '')), ''),
      nullif(btrim(coalesce(case when v_has_delegate then v_delegate.branch_key else null end, '')), '')
    ),
    'display_name', coalesce(
      nullif(btrim(coalesce(case when v_has_member then v_member.display_name else null end, '')), ''),
      nullif(btrim(coalesce(case when v_has_delegate then v_delegate.name else null end, '')), ''),
      'مندوب الفرع'
    ),
    'delegate_id', case when v_has_delegate then v_delegate.id else null end,
    'is_delegate', v_has_delegate,
    'is_member', v_has_member
  );
end;
$fn$;

create or replace function public.member_device_allows_phone_v1(p_phone text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_key text := public.member_device_phone_key_v1(p_phone);
  v_secret text := public.member_device_header_get_v1('x-device-secret');
  v_header_phone text := public.member_device_header_get_v1('x-member-phone');
  v_hash text;
  v_ok boolean := false;
begin
  if v_key is null or v_secret is null then
    return false;
  end if;
  if public.member_device_eligible_kind_v1(p_phone) is distinct from 'ok' then
    return false;
  end if;
  if v_header_phone is not null
     and public.member_device_phone_key_v1(v_header_phone) is distinct from v_key then
    return false;
  end if;
  v_hash := public.member_device_secret_hash_v1(v_secret);
  if v_hash is null then
    return false;
  end if;
  select true
    into v_ok
  from public.member_trusted_devices d
  where d.phone_key = v_key
    and d.status = 'active'
    and d.secret_hash = v_hash
  limit 1;
  return coalesce(v_ok, false);
end;
$fn$;

create or replace function public.member_device_new_code_v1()
returns text
language plpgsql
volatile
as $fn$
declare
  v_hex text := replace(gen_random_uuid()::text, '-', '');
begin
  return lpad((mod(('x' || substr(v_hex, 1, 8))::bit(32)::bigint, 1000000))::text, 6, '0');
end;
$fn$;

create or replace function public.member_device_issue_challenge_v1(
  p_phone_key text,
  p_purpose text,
  p_device_public_id uuid,
  p_label text
)
returns bigint
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_code text;
  v_id bigint;
begin
  update public.member_device_challenges
    set consumed_at = now()
  where phone_key = p_phone_key
    and purpose = p_purpose
    and consumed_at is null;

  v_code := public.member_device_new_code_v1();
  insert into public.member_device_challenges (
    phone_key, purpose, code_hash, code_reveal, device_public_id, label, expires_at
  ) values (
    p_phone_key,
    p_purpose,
    encode(sha256(convert_to(v_code || ':' || p_phone_key || ':' || p_purpose, 'UTF8')), 'hex'),
    v_code,
    p_device_public_id,
    nullif(btrim(coalesce(p_label, '')), ''),
    now() + interval '20 minutes'
  )
  returning id into v_id;
  return v_id;
end;
$fn$;

create or replace function public.member_device_bind_start_v1(
  p_phone text,
  p_device_public_id uuid,
  p_label text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_key text := public.member_device_phone_key_v1(p_phone);
  v_kind text;
  v_active uuid;
  v_challenge bigint;
begin
  if v_key is null or p_device_public_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  v_kind := public.member_device_eligible_kind_v1(p_phone);
  if v_kind = 'pending_family' then
    return jsonb_build_object('ok', false, 'error', 'pending_family');
  end if;
  if v_kind is distinct from 'ok' then
    return jsonb_build_object('ok', false, 'error', coalesce(v_kind, 'not_found'));
  end if;

  select d.device_public_id
    into v_active
  from public.member_trusted_devices d
  where d.phone_key = v_key
    and d.status = 'active'
  limit 1;

  if v_active is not null and v_active = p_device_public_id then
    return jsonb_build_object('ok', false, 'error', 'resume_instead');
  end if;
  if v_active is not null then
    return jsonb_build_object('ok', true, 'need', 'transfer');
  end if;

  v_challenge := public.member_device_issue_challenge_v1(
    v_key, 'bind', p_device_public_id, p_label
  );
  return jsonb_build_object('ok', true, 'need', 'bind', 'challenge_id', v_challenge);
end;
$fn$;

create or replace function public.member_device_bind_confirm_v1(
  p_phone text,
  p_code text,
  p_device_public_id uuid,
  p_device_secret text,
  p_label text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_key text := public.member_device_phone_key_v1(p_phone);
  v_hash text := public.member_device_secret_hash_v1(p_device_secret);
  v_code text := btrim(coalesce(p_code, ''));
  v_ch public.member_device_challenges%rowtype;
  v_session jsonb;
begin
  if v_key is null or p_device_public_id is null or v_hash is null or char_length(v_code) <> 6 then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  if public.member_device_eligible_kind_v1(p_phone) is distinct from 'ok' then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;
  if exists (
    select 1 from public.member_trusted_devices d
    where d.phone_key = v_key and d.status = 'active'
  ) then
    return jsonb_build_object('ok', false, 'error', 'other_device');
  end if;

  select c.*
    into v_ch
  from public.member_device_challenges c
  where c.phone_key = v_key
    and c.purpose = 'bind'
    and c.consumed_at is null
    and c.expires_at > now()
    and c.code_hash = encode(sha256(convert_to(v_code || ':' || v_key || ':bind', 'UTF8')), 'hex')
  order by c.id desc
  limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'bad_code');
  end if;

  update public.member_device_challenges
    set consumed_at = now(), code_reveal = null
  where id = v_ch.id;

  insert into public.member_trusted_devices (
    phone_key, device_public_id, secret_hash, label, status, bound_at, last_seen_at
  ) values (
    v_key, p_device_public_id, v_hash, nullif(btrim(coalesce(p_label, '')), ''), 'active', now(), now()
  );

  v_session := public.member_device_session_json_v1(p_phone);
  return v_session || jsonb_build_object('device_public_id', p_device_public_id);
end;
$fn$;

create or replace function public.member_device_resume_v1(
  p_phone text,
  p_device_secret text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_key text := public.member_device_phone_key_v1(p_phone);
  v_hash text := public.member_device_secret_hash_v1(p_device_secret);
  v_row public.member_trusted_devices%rowtype;
  v_session jsonb;
begin
  if v_key is null or v_hash is null then
    return jsonb_build_object('ok', false, 'error', 'device_required');
  end if;
  if public.member_device_eligible_kind_v1(p_phone) is distinct from 'ok' then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;

  select d.*
    into v_row
  from public.member_trusted_devices d
  where d.phone_key = v_key
    and d.status = 'active'
    and d.secret_hash = v_hash
  limit 1;
  if not found then
    if exists (
      select 1 from public.member_trusted_devices d
      where d.phone_key = v_key and d.status = 'active'
    ) then
      return jsonb_build_object('ok', false, 'error', 'other_device');
    end if;
    return jsonb_build_object('ok', false, 'error', 'device_required');
  end if;

  update public.member_trusted_devices
    set last_seen_at = now()
  where id = v_row.id;

  v_session := public.member_device_session_json_v1(p_phone);
  return v_session || jsonb_build_object('device_public_id', v_row.device_public_id);
end;
$fn$;

create or replace function public.member_device_revoke_v1(
  p_phone text,
  p_device_secret text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_key text := public.member_device_phone_key_v1(p_phone);
  v_hash text := public.member_device_secret_hash_v1(p_device_secret);
  v_n int := 0;
begin
  if v_key is null or v_hash is null then
    return jsonb_build_object('ok', false, 'error', 'device_required');
  end if;
  update public.member_trusted_devices
    set status = 'revoked', revoked_at = now()
  where phone_key = v_key
    and status = 'active'
    and secret_hash = v_hash;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'revoked', v_n > 0);
end;
$fn$;

create or replace function public.member_device_transfer_start_v1(
  p_phone text,
  p_device_public_id uuid,
  p_device_secret text,
  p_label text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_key text := public.member_device_phone_key_v1(p_phone);
  v_hash text := public.member_device_secret_hash_v1(p_device_secret);
  v_from uuid;
  v_challenge bigint;
  v_tid bigint;
begin
  if v_key is null or p_device_public_id is null or v_hash is null then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  if public.member_device_eligible_kind_v1(p_phone) is distinct from 'ok' then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;

  select d.device_public_id
    into v_from
  from public.member_trusted_devices d
  where d.phone_key = v_key and d.status = 'active'
  limit 1;
  if v_from is null then
    return jsonb_build_object('ok', false, 'error', 'bind_instead');
  end if;
  if v_from = p_device_public_id then
    return jsonb_build_object('ok', false, 'error', 'resume_instead');
  end if;

  v_challenge := public.member_device_issue_challenge_v1(
    v_key, 'transfer', p_device_public_id, p_label
  );
  insert into public.member_device_transfers (
    phone_key, from_device_public_id, to_device_public_id, to_secret_hash, to_label, challenge_id, status
  ) values (
    v_key, v_from, p_device_public_id, v_hash, nullif(btrim(coalesce(p_label, '')), ''), v_challenge, 'pending_code'
  )
  returning id into v_tid;
  return jsonb_build_object('ok', true, 'need', 'code', 'transfer_id', v_tid);
end;
$fn$;

create or replace function public.member_device_transfer_confirm_v1(
  p_phone text,
  p_code text,
  p_device_public_id uuid,
  p_device_secret text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_key text := public.member_device_phone_key_v1(p_phone);
  v_hash text := public.member_device_secret_hash_v1(p_device_secret);
  v_code text := btrim(coalesce(p_code, ''));
  v_ch public.member_device_challenges%rowtype;
  v_tr public.member_device_transfers%rowtype;
begin
  if v_key is null or p_device_public_id is null or v_hash is null or char_length(v_code) <> 6 then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;

  select c.*
    into v_ch
  from public.member_device_challenges c
  where c.phone_key = v_key
    and c.purpose = 'transfer'
    and c.consumed_at is null
    and c.expires_at > now()
    and c.code_hash = encode(sha256(convert_to(v_code || ':' || v_key || ':transfer', 'UTF8')), 'hex')
  order by c.id desc
  limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'bad_code');
  end if;

  select t.*
    into v_tr
  from public.member_device_transfers t
  where t.phone_key = v_key
    and t.to_device_public_id = p_device_public_id
    and t.to_secret_hash = v_hash
    and t.status = 'pending_code'
  order by t.id desc
  limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_transfer');
  end if;

  update public.member_device_challenges
    set consumed_at = now(), code_reveal = null
  where id = v_ch.id;

  update public.member_device_transfers
    set status = 'pending_admin', ownership_proved_at = now()
  where id = v_tr.id;

  return jsonb_build_object('ok', true, 'need', 'admin', 'transfer_id', v_tr.id);
end;
$fn$;

create or replace function public.public_app_login_by_phone_v1(p_phone text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  return jsonb_build_object('ok', false, 'error', 'device_required');
end;
$fn$;

create or replace function public.member_phone_registered_v1(p_phone text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_session jsonb;
begin
  if not public.member_device_allows_phone_v1(p_phone) then
    return null;
  end if;
  v_session := public.member_device_session_json_v1(p_phone);
  if coalesce((v_session ->> 'ok')::boolean, false) then
    return v_session ->> 'phone';
  end if;
  return null;
end;
$fn$;

create or replace function public.admin_device_challenges_list_v1(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  if not public.admin_token_ok_v1(p_token) then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;
  return jsonb_build_object(
    'ok', true,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'phone_key', c.phone_key,
        'purpose', c.purpose,
        'code', c.code_reveal,
        'label', c.label,
        'expires_at', c.expires_at,
        'created_at', c.created_at
      ) order by c.created_at desc)
      from public.member_device_challenges c
      where c.consumed_at is null
        and c.expires_at > now()
        and c.code_reveal is not null
    ), '[]'::jsonb)
  );
end;
$fn$;

create or replace function public.admin_device_transfers_list_v1(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  if not public.admin_token_ok_v1(p_token) then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;
  return jsonb_build_object(
    'ok', true,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'phone_key', t.phone_key,
        'from_device_public_id', t.from_device_public_id,
        'to_device_public_id', t.to_device_public_id,
        'to_label', t.to_label,
        'status', t.status,
        'ownership_proved_at', t.ownership_proved_at,
        'created_at', t.created_at
      ) order by t.created_at desc)
      from public.member_device_transfers t
      where t.status in ('pending_admin', 'pending_code')
    ), '[]'::jsonb)
  );
end;
$fn$;

create or replace function public.admin_device_transfer_approve_v1(p_token text, p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_tr public.member_device_transfers%rowtype;
begin
  if not public.admin_token_ok_v1(p_token) then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;
  select t.* into v_tr from public.member_device_transfers t where t.id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_tr.status is distinct from 'pending_admin' then
    return jsonb_build_object('ok', false, 'error', 'not_ready');
  end if;

  update public.member_trusted_devices
    set status = 'revoked', revoked_at = now()
  where phone_key = v_tr.phone_key
    and status = 'active';

  insert into public.member_trusted_devices (
    phone_key, device_public_id, secret_hash, label, status, bound_at, last_seen_at
  ) values (
    v_tr.phone_key, v_tr.to_device_public_id, v_tr.to_secret_hash, v_tr.to_label, 'active', now(), now()
  );

  update public.member_device_transfers
    set status = 'approved', decided_at = now()
  where id = v_tr.id;

  return jsonb_build_object('ok', true);
end;
$fn$;

create or replace function public.admin_device_transfer_reject_v1(p_token text, p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_tr public.member_device_transfers%rowtype;
begin
  if not public.admin_token_ok_v1(p_token) then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;
  select t.* into v_tr from public.member_device_transfers t where t.id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_tr.status not in ('pending_admin', 'pending_code') then
    return jsonb_build_object('ok', false, 'error', 'not_open');
  end if;
  update public.member_device_transfers
    set status = 'rejected', decided_at = now()
  where id = v_tr.id;
  return jsonb_build_object('ok', true);
end;
$fn$;

create or replace function public.admin_device_revoke_phone_v1(p_token text, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_key text := public.member_device_phone_key_v1(p_phone);
  v_n int := 0;
begin
  if not public.admin_token_ok_v1(p_token) then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;
  if v_key is null then
    return jsonb_build_object('ok', false, 'error', 'bad_phone');
  end if;
  update public.member_trusted_devices
    set status = 'revoked', revoked_at = now()
  where phone_key = v_key
    and status in ('active', 'pending_transfer');
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'revoked', v_n);
end;
$fn$;

revoke all on function public.member_device_phone_key_v1(text) from public;
revoke all on function public.member_device_secret_hash_v1(text) from public;
revoke all on function public.member_device_header_get_v1(text) from public;
revoke all on function public.admin_token_from_request_ok_v1() from public;
revoke all on function public.delegate_from_request_ok_v1() from public;
revoke all on function public.member_device_eligible_kind_v1(text) from public;
revoke all on function public.member_device_session_json_v1(text) from public;
revoke all on function public.member_device_allows_phone_v1(text) from public;
revoke all on function public.member_device_new_code_v1() from public;
revoke all on function public.member_device_issue_challenge_v1(text, text, uuid, text) from public;

grant execute on function public.admin_token_from_request_ok_v1() to anon, authenticated;
grant execute on function public.delegate_from_request_ok_v1() to anon, authenticated;
grant execute on function public.member_device_allows_phone_v1(text) to anon, authenticated;
grant execute on function public.member_device_bind_start_v1(text, uuid, text) to anon, authenticated;
grant execute on function public.member_device_bind_confirm_v1(text, text, uuid, text, text) to anon, authenticated;
grant execute on function public.member_device_resume_v1(text, text) to anon, authenticated;
grant execute on function public.member_device_revoke_v1(text, text) to anon, authenticated;
grant execute on function public.member_device_transfer_start_v1(text, uuid, text, text) to anon, authenticated;
grant execute on function public.member_device_transfer_confirm_v1(text, text, uuid, text) to anon, authenticated;
grant execute on function public.public_app_login_by_phone_v1(text) to anon, authenticated;
grant execute on function public.member_phone_registered_v1(text) to anon, authenticated;
grant execute on function public.admin_device_challenges_list_v1(text) to anon, authenticated;
grant execute on function public.admin_device_transfers_list_v1(text) to anon, authenticated;
grant execute on function public.admin_device_transfer_approve_v1(text, bigint) to anon, authenticated;
grant execute on function public.admin_device_transfer_reject_v1(text, bigint) to anon, authenticated;
grant execute on function public.admin_device_revoke_phone_v1(text, text) to anon, authenticated;

do $rls$
declare
  pol record;
begin
  if to_regclass('public.member_profiles') is not null then
  alter table public.member_profiles enable row level security;
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'member_profiles'
  loop
    execute format('drop policy if exists %I on public.member_profiles', pol.policyname);
  end loop;
  execute $p$
    create policy member_profiles_staff_token_all
      on public.member_profiles
      for all
      to anon, authenticated
      using (
        public.admin_token_from_request_ok_v1()
        or public.delegate_from_request_ok_v1()
      )
      with check (
        public.admin_token_from_request_ok_v1()
        or public.delegate_from_request_ok_v1()
      )
  $p$;
  execute $p$
    create policy member_profiles_appstore_login_select
      on public.member_profiles
      for select
      to anon, authenticated
      using (
        phone is not null
        and btrim(phone) <> ''
        and coalesce(nullif(btrim(status), ''), 'active') = 'active'
      )
  $p$;
  grant select, insert, update, delete on table public.member_profiles to anon, authenticated;
  end if;
end;
$rls$;

do $patch$
declare
  r record;
  v_def text;
  v_new text;
  v_arg text;
  v_guard text;
begin
  for r in
    select p.oid, p.proname, p.proargnames
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
    where n.nspname = 'public'
      and l.lanname = 'plpgsql'
      and p.prosecdef
      and p.proname = any (array[
        'tree_member_viewer_v1',
        'tree_member_set_photo_v1',
        'tree_self_children_v1',
        'tree_self_siblings_v1',
        'tree_member_lineage_children_v1',
        'tree_external_offspring_for_self_v1',
        'tree_maternal_kinship_for_viewer_v1',
        'women_manager_session_v1',
        'women_manager_phone_requests_v1',
        'women_manager_search_members_v1',
        'women_manager_add_member_v1',
        'women_manager_bind_phone_v1',
        'women_manager_set_member_phone_v1',
        'women_manager_set_pending_phone_v1',
        'women_manager_mother_children_v1',
        'women_manager_search_tree_people_v1',
        'women_manager_link_mother_v1',
        'women_manager_unlink_mother_v1',
        'occasion_inbox_for_phone_v1',
        'occasion_interaction_submit_v1',
        'occasion_my_interaction_v1',
        'public_my_requests_by_phone_v1',
        'member_publish_occasion_v1',
        'member_update_occasion_v1',
        'member_delete_occasion_v1',
        'register_push_token_v1'
      ])
  loop
    v_def := pg_get_functiondef(r.oid);
    if position('member_device_allows_phone_v1' in v_def) > 0 then
      continue;
    end if;
    v_arg := null;
    if r.proargnames is not null then
      if 'p_phone' = any (r.proargnames) then
        v_arg := 'p_phone';
      elsif 'p_sender_phone' = any (r.proargnames) then
        v_arg := 'p_sender_phone';
      end if;
    end if;
    if v_arg is null then
      continue;
    end if;
    if r.proname = 'register_push_token_v1' then
      v_guard := format($g$
  if coalesce(nullif(btrim(%1$I), ''), '') <> '' and not public.member_device_allows_phone_v1(%1$I) then
    raise exception 'device_required' using errcode = '42501';
  end if;
$g$, v_arg);
    else
      v_guard := format($g$
  if not public.member_device_allows_phone_v1(%1$I) then
    raise exception 'device_required' using errcode = '42501';
  end if;
$g$, v_arg);
    end if;
    v_def := replace(v_def, 'CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION');
    v_new := regexp_replace(v_def, E'(?i)\\nBEGIN\\n', E'\nBEGIN\n' || v_guard, '');
    if v_new is not distinct from v_def then
      continue;
    end if;
    begin
      execute v_new;
    exception when others then
      raise notice 'trusted-device patch skip %: %', r.proname, sqlerrm;
    end;
  end loop;
end;
$patch$;

notify pgrst, 'reload schema';
select to_regprocedure('public.member_device_resume_v1(text, text)') is not null as has_resume;
