-- COPY-ME: Preset id: maint.family_admin_notify_phone_v1
-- إشعار تطبيق طلبات الإدارة يصل لمندوب الإدارة 0551840058.
-- تقرأه دالة alzidan-push-notify من email_settings.admin_notify_phone.
-- Safe to re-run.

create table if not exists public.email_settings (
  key text primary key,
  value text
);

do $$
begin
  if exists (
    select 1 from public.email_settings where btrim(coalesce(key, '')) = 'admin_notify_phone'
  ) then
    update public.email_settings
    set value = '0551840058'
    where btrim(coalesce(key, '')) = 'admin_notify_phone';
  else
    insert into public.email_settings (key, value)
    values ('admin_notify_phone', '0551840058');
  end if;
end
$$;

select key, value
from public.email_settings
where btrim(coalesce(key, '')) = 'admin_notify_phone';
