-- Open this file, Select All, paste in Supabase SQL Editor.
-- Clears membership phone + trusted device + pending register for
-- 0505721022 and 0537108773. Does not delete tree people or photos.

update public.member_profiles
set phone = null, updated_at = now()
where right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 9)
  in ('505721022', '537108773');

update public.member_trusted_devices
set status = 'revoked', revoked_at = now()
where status in ('active', 'pending_transfer')
  and (
    phone_key in ('505721022', '537108773')
    or right(regexp_replace(coalesce(phone_key, ''), '[^0-9]', '', 'g'), 9)
      in ('505721022', '537108773')
  );

update public.member_device_transfers
set status = 'rejected', decided_at = now()
where status in ('pending_admin', 'pending_code')
  and (
    phone_key in ('505721022', '537108773')
    or right(regexp_replace(coalesce(phone_key, ''), '[^0-9]', '', 'g'), 9)
      in ('505721022', '537108773')
  );

update public.approval_requests
set status = 'rejected'
where status = 'pending'
  and kind in ('member_phone_register', 'member_registration')
  and right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 9)
    in ('505721022', '537108773');
