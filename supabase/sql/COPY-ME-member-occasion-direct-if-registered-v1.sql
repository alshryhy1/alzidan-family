-- COPY-ME: Preset id: maint.member_occasion_direct_if_registered_v1
-- Registered family phone (member_profiles / enabled delegate) publishes
-- an occasion immediately. Unregistered phones still go through approval.
-- Does not require a trusted device for this path.
-- Open this file, Select All, paste in Supabase SQL Editor. Safe to re-run.

create or replace function public.member_phone_registered_v1(p_phone text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_digits text;
  v_phone text;
begin
  -- member_device_allows_phone_v1 is not required: a registered family phone may publish.
  v_digits := nullif(right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 9), '');
  if v_digits is null or char_length(v_digits) < 9 then
    return null;
  end if;

  if to_regclass('public.member_profiles') is not null then
    select mp.phone
      into v_phone
    from public.member_profiles mp
    where right(regexp_replace(coalesce(mp.phone, ''), '[^0-9]', '', 'g'), 9) = v_digits
      and coalesce(nullif(btrim(coalesce(mp.status, '')), ''), 'active') is distinct from 'pending_family'
    order by mp.updated_at desc nulls last, mp.id desc
    limit 1;
    if v_phone is not null then
      return v_phone;
    end if;
  end if;

  if to_regclass('public.delegates_v2') is not null then
    select d.phone
      into v_phone
    from public.delegates_v2 d
    where coalesce(d.is_enabled, true) = true
      and right(regexp_replace(coalesce(d.phone, ''), '[^0-9]', '', 'g'), 9) = v_digits
    limit 1;
    if v_phone is not null then
      return v_phone;
    end if;
  end if;

  return null;
end;
$fn$;

grant execute on function public.member_phone_registered_v1(text) to anon, authenticated;

do $strip$
declare
  r record;
  v_def text;
  v_new text;
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'member_publish_occasion_v1',
        'member_update_occasion_v1',
        'member_delete_occasion_v1'
      )
  loop
    v_def := pg_get_functiondef(r.oid);
    v_new := regexp_replace(
      v_def,
      E'\\s*if not public\\.member_device_allows_phone_v1\\([^)]+\\) then\\s*raise exception ''device_required''[^;]*;\\s*end if;',
      E'\n  -- member_device_allows_phone_v1 not required for registered-phone publish.\n',
      'gi'
    );
    v_new := replace(v_new, 'CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION');
    if v_new is distinct from v_def then
      execute v_new;
    end if;
  end loop;
end;
$strip$;

notify pgrst, 'reload schema';
select to_regprocedure('public.member_phone_registered_v1(text)') is not null as has_registered_lookup;
