-- Open this file, Select All, paste in Supabase SQL Editor.
-- One table: are the two phones saved for LOGIN, or only old requests?

select
  'عضوية دخول' as kind,
  phone,
  status,
  display_name as name,
  branch_key,
  tree_child_id::text as person_row
from public.member_profiles
where right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 9)
  in ('505721022', '537108773')

union all

select
  'جهاز موثوق',
  phone_key,
  status,
  label,
  null,
  id::text
from public.member_trusted_devices
where phone_key in ('505721022', '537108773')
   or right(regexp_replace(coalesce(phone_key, ''), '[^0-9]', '', 'g'), 9)
        in ('505721022', '537108773')

union all

select
  'طلب فقط — لا يدخل',
  phone,
  status,
  name,
  branch_key,
  request_id
from public.approval_requests
where right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 9)
  in ('505721022', '537108773')
order by 1, 2;
