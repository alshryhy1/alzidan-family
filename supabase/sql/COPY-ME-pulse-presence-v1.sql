-- Pulse presence: anonymous foreground sessions for «متواجد الآن».
-- Open this file, Select All, paste in Supabase SQL Editor.
-- No name, no phone, no GPS. Count only. Safe to re-run.

create table if not exists public.pulse_presence (
  session_id uuid primary key,
  last_seen timestamptz not null default now()
);

comment on table public.pulse_presence is
  'Anonymous in-app presence for Pulse. session_id is a device-local random uuid; never bind to phone.';

create index if not exists pulse_presence_last_seen_idx
  on public.pulse_presence (last_seen desc);

alter table public.pulse_presence enable row level security;

revoke all on table public.pulse_presence from public, anon, authenticated;

create or replace function public.pulse_heartbeat_v1(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_online int := 0;
begin
  if p_session_id is null then
    return jsonb_build_object('ok', false, 'online', 0);
  end if;

  insert into public.pulse_presence (session_id, last_seen)
  values (p_session_id, now())
  on conflict (session_id) do update
    set last_seen = now();

  delete from public.pulse_presence
  where last_seen < now() - interval '15 minutes';

  select count(*)::int into v_online
  from public.pulse_presence
  where last_seen > now() - interval '3 minutes';

  return jsonb_build_object('ok', true, 'online', v_online);
end;
$$;

revoke all on function public.pulse_heartbeat_v1(uuid) from public;
grant execute on function public.pulse_heartbeat_v1(uuid) to anon, authenticated;

-- Read-only count for the home-screen widget. Does not insert a session.
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
