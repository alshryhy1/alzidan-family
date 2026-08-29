-- COPY-ME: Preset id: maint.member_trusted_device_auto_v1
-- First login by any member/delegate phone auto-binds this device. No OTP. No admin code.
-- One active trusted device per phone. Other device is rejected until admin revokes or approves transfer.
-- pending_family still cannot login. Does not add Face ID. Safe to re-run.
-- Run after maint.member_trusted_device_v1 (tables and helpers).

create or replace function public.member_device_login_v1(
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
  v_kind text;
  v_row public.member_trusted_devices%rowtype;
  v_session jsonb;
  v_tid bigint;
begin
  if v_key is null or p_device_public_id is null or v_hash is null then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;

  v_kind := public.member_device_eligible_kind_v1(p_phone);
  if v_kind = 'pending_family' then
    return jsonb_build_object('ok', false, 'error', 'pending_family');
  end if;
  if v_kind is distinct from 'ok' then
    return jsonb_build_object('ok', false, 'error', coalesce(v_kind, 'not_found'));
  end if;

  select d.*
    into v_row
  from public.member_trusted_devices d
  where d.phone_key = v_key
    and d.status = 'active'
  limit 1;

  if not found then
    insert into public.member_trusted_devices (
      phone_key, device_public_id, secret_hash, label, status, bound_at, last_seen_at
    ) values (
      v_key,
      p_device_public_id,
      v_hash,
      nullif(btrim(coalesce(p_label, '')), ''),
      'active',
      now(),
      now()
    );
    v_session := public.member_device_session_json_v1(p_phone);
    return v_session || jsonb_build_object(
      'device_public_id', p_device_public_id,
      'bound', true
    );
  end if;

  if v_row.secret_hash = v_hash then
    update public.member_trusted_devices
      set last_seen_at = now(),
          device_public_id = p_device_public_id,
          label = coalesce(nullif(btrim(coalesce(p_label, '')), ''), label)
    where id = v_row.id;
    v_session := public.member_device_session_json_v1(p_phone);
    return v_session || jsonb_build_object(
      'device_public_id', p_device_public_id,
      'bound', false
    );
  end if;

  delete from public.member_device_transfers t
  where t.phone_key = v_key
    and t.to_device_public_id = p_device_public_id
    and t.status in ('pending_code', 'pending_admin');

  insert into public.member_device_transfers (
    phone_key,
    from_device_public_id,
    to_device_public_id,
    to_secret_hash,
    to_label,
    status
  ) values (
    v_key,
    v_row.device_public_id,
    p_device_public_id,
    v_hash,
    nullif(btrim(coalesce(p_label, '')), ''),
    'pending_admin'
  )
  returning id into v_tid;

  return jsonb_build_object(
    'ok', false,
    'error', 'other_device',
    'transfer_id', v_tid
  );
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
begin
  return jsonb_build_object('ok', false, 'error', 'login_required');
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
  update public.member_device_transfers
    set status = 'rejected', decided_at = now()
  where phone_key = v_key
    and status in ('pending_admin', 'pending_code');
  return jsonb_build_object('ok', true, 'revoked', v_n);
end;
$fn$;

revoke all on function public.member_device_login_v1(text, uuid, text, text) from public;
grant execute on function public.member_device_login_v1(text, uuid, text, text) to anon, authenticated;
grant execute on function public.member_device_bind_start_v1(text, uuid, text) to anon, authenticated;
grant execute on function public.admin_device_revoke_phone_v1(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
select to_regprocedure('public.member_device_login_v1(text, uuid, text, text)') is not null as has_login;
