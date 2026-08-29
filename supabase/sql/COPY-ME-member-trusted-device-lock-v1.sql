-- COPY-ME: Preset id: maint.member_trusted_device_lock_v1
-- First phone on a device locks that device to that phone.
-- Same device cannot login a spouse or any other number. Logout ends the session only.
-- Phone still has one active device. Device change still needs admin revoke or transfer.
-- pending_family still cannot login. No Face ID. Safe to re-run.
-- Run after maint.member_trusted_device_auto_v1. Do not re-run the phase-1 card after this.

drop index if exists public.member_trusted_devices_public_id_uidx;
create unique index if not exists member_trusted_devices_public_id_uidx
  on public.member_trusted_devices (device_public_id);

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
  v_by_device public.member_trusted_devices%rowtype;
  v_by_phone public.member_trusted_devices%rowtype;
  v_session jsonb;
  v_tid bigint;
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
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
    into v_by_device
  from public.member_trusted_devices d
  where d.device_public_id = p_device_public_id
  order by d.bound_at desc
  limit 1;

  if found and v_by_device.phone_key is distinct from v_key then
    return jsonb_build_object('ok', false, 'error', 'device_other_account');
  end if;

  select d.*
    into v_by_phone
  from public.member_trusted_devices d
  where d.phone_key = v_key
    and d.status = 'active'
  limit 1;

  if found then
    if v_by_phone.secret_hash = v_hash
       or v_by_phone.device_public_id = p_device_public_id then
      update public.member_trusted_devices
        set last_seen_at = now(),
            secret_hash = v_hash,
            device_public_id = p_device_public_id,
            label = coalesce(v_label, label)
      where id = v_by_phone.id;
      v_session := public.member_device_session_json_v1(p_phone);
      return v_session || jsonb_build_object('device_public_id', p_device_public_id);
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
      v_by_phone.device_public_id,
      p_device_public_id,
      v_hash,
      v_label,
      'pending_admin'
    )
    returning id into v_tid;

    return jsonb_build_object('ok', false, 'error', 'other_device', 'transfer_id', v_tid);
  end if;

  if v_by_device.phone_key is not null and v_by_device.phone_key = v_key then
    update public.member_trusted_devices
      set status = 'active',
          revoked_at = null,
          secret_hash = v_hash,
          label = coalesce(v_label, label),
          last_seen_at = now(),
          bound_at = coalesce(bound_at, now())
    where id = v_by_device.id;
    v_session := public.member_device_session_json_v1(p_phone);
    return v_session || jsonb_build_object('device_public_id', p_device_public_id);
  end if;

  insert into public.member_trusted_devices (
    phone_key, device_public_id, secret_hash, label, status, bound_at, last_seen_at
  ) values (
    v_key, p_device_public_id, v_hash, v_label, 'active', now(), now()
  );
  v_session := public.member_device_session_json_v1(p_phone);
  return v_session || jsonb_build_object('device_public_id', p_device_public_id, 'bound', true);
end;
$fn$;

grant execute on function public.member_device_login_v1(text, uuid, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
select to_regprocedure('public.member_device_login_v1(text, uuid, text, text)') is not null as has_login;
