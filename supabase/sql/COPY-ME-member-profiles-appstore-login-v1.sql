-- Open this file, Select All, paste in Supabase SQL Editor.
-- App Store 2.0.1 logs in by SELECT on member_profiles. Trusted-device RLS
-- left only admin/delegate access, so the store says «غير مسجل».
-- Restores SELECT of active phones. Writes stay staff-only. Safe to re-run.

drop policy if exists member_profiles_appstore_login_select on public.member_profiles;

create policy member_profiles_appstore_login_select
  on public.member_profiles
  for select
  to anon, authenticated
  using (
    phone is not null
    and btrim(phone) <> ''
    and coalesce(nullif(btrim(status), ''), 'active') = 'active'
  );

grant select on table public.member_profiles to anon, authenticated;
