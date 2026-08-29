-- COPY-ME: Preset id: maint.pulse_online_count_v1
-- Read-only «متواجدون الآن» for the home-screen widget. Does not insert a session.
-- Safe to re-run after pulse_presence_v1.

create or replace function public.pulse_online_count_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_online int := 0;
begin
  if to_regclass('public.pulse_presence') is null then
    return jsonb_build_object('ok', true, 'online', 0);
  end if;
  select count(*)::int into v_online
  from public.pulse_presence
  where last_seen > now() - interval '3 minutes';
  return jsonb_build_object('ok', true, 'online', coalesce(v_online, 0));
end;
$$;

revoke all on function public.pulse_online_count_v1() from public;
grant execute on function public.pulse_online_count_v1() to anon, authenticated;

notify pgrst, 'reload schema';
select to_regprocedure('public.pulse_online_count_v1()') is not null as has_online_count;
