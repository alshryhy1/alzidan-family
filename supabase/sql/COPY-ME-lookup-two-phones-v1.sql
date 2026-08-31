-- Open this file, Select All, paste in Supabase SQL Editor.
-- Lookup last-9 for 0505721022 and 0537108773 in membership, devices, delegates, requests.

select
  'member_profiles' as src,
  id,
  phone,
  status,
  tree_child_id,
  person_id,
  display_name,
  branch_key,
  updated_at
from public.member_profiles
where right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 9)
  in ('505721022', '537108773')
order by id;

select
  'member_trusted_devices' as src,
  id,
  phone_key,
  status,
  label,
  bound_at,
  last_seen_at,
  revoked_at
from public.member_trusted_devices
where phone_key in ('505721022', '537108773')
   or right(regexp_replace(coalesce(phone_key, ''), '[^0-9]', '', 'g'), 9)
        in ('505721022', '537108773')
order by id;

select
  'delegates_v2' as src,
  id,
  phone,
  name,
  branch_key,
  is_enabled,
  role_key
from public.delegates_v2
where right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 9)
  in ('505721022', '537108773')
order by id;

select
  'approval_requests' as src,
  id,
  request_id,
  kind,
  status,
  name,
  phone,
  branch_key,
  created_at
from public.approval_requests
where right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 9)
  in ('505721022', '537108773')
order by created_at desc
limit 40;
