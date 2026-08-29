-- COPY-ME: Preset id: maint.member_trusted_device_admin_unbind_v1
-- Admin can delete a phone's device bind: new phone, or a wrong number entered.
-- Delete removes the row so the same device can bind the correct number.
-- Run after maint.member_trusted_device_lock_v1. Safe to re-run.

create or replace function public.admin_device_list_v1(p_token text)
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
        'id', d.id,
        'phone_key', d.phone_key,
        'label', d.label,
        'status', d.status,
        'bound_at', d.bound_at,
        'last_seen_at', d.last_seen_at
      ) order by coalesce(d.last_seen_at, d.bound_at) desc)
      from public.member_trusted_devices d
      where d.status = 'active'
    ), '[]'::jsonb)
  );
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

  delete from public.member_device_transfers t
  where t.phone_key = v_key;

  delete from public.member_trusted_devices d
  where d.phone_key = v_key;
  get diagnostics v_n = row_count;

  return jsonb_build_object('ok', true, 'revoked', v_n);
end;
$fn$;

revoke all on function public.admin_device_list_v1(text) from public;
grant execute on function public.admin_device_list_v1(text) to anon, authenticated;
grant execute on function public.admin_device_revoke_phone_v1(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
select to_regprocedure('public.admin_device_list_v1(text)') is not null as has_list;
