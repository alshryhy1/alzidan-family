-- Preset id: maint.admin_list_requests_all_kinds_v1
-- لوحة الإدارة تعرض كل صفوف approval_requests (بما فيها تسجيل الجوال).
-- لا يستبدل admin_list_requests حتى لا ينكسر فحص الجلسة.
-- Safe to re-run.

create or replace function public.admin_list_requests_all_v1(
  p_token text,
  p_status text default null,
  p_kind text default null,
  p_limit integer default 50
)
returns setof public.approval_requests
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_status text := lower(nullif(btrim(coalesce(p_status, '')), ''));
  v_kind text := nullif(btrim(coalesce(p_kind, '')), '');
  v_limit int := greatest(1, least(coalesce(p_limit, 50), 1000));
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  return query
  select r.*
  from public.approval_requests r
  where (
      v_status is null
      or lower(btrim(coalesce(r.status, ''))) = v_status
    )
    and (
      v_kind is null
      or btrim(coalesce(r.kind, '')) = v_kind
      or (
        v_kind in ('member_registration', 'member_phone_register')
        and btrim(coalesce(r.kind, '')) in ('member_registration', 'member_phone_register')
      )
    )
  order by r.created_at desc nulls last
  limit v_limit;
end;
$fn$;

revoke all on function public.admin_list_requests_all_v1(text, text, text, integer) from public;
grant execute on function public.admin_list_requests_all_v1(text, text, text, integer) to anon, authenticated;

select
  to_regprocedure('public.admin_list_requests_all_v1(text, text, text, integer)') is not null
    as has_admin_list_requests_all_v1;
