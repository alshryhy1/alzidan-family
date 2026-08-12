-- COPY-ME / maint.public_my_requests_by_phone_v1
-- Homepage «طلباتي» for a member logged in by phone.
-- Why: anon cannot SELECT approval_requests (RLS → []).
-- Matches last 9 digits so 05xxxxxxxx / 9665xxxxxxxx / 5xxxxxxxx all work.
-- Does not return message. Safe to re-run.

create or replace function public.public_my_requests_by_phone_v1(p_phone text)
returns table(
  request_id text,
  kind text,
  status text,
  created_at timestamptz,
  reject_reason text
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_tail text;
begin
  v_tail := right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 9);
  if v_tail is null or length(v_tail) < 9 then
    return;
  end if;

  return query
  select
    r.request_id::text,
    btrim(coalesce(r.kind, ''))::text as kind,
    lower(btrim(coalesce(r.status, '')))::text as status,
    r.created_at,
    coalesce(
      nullif(
        btrim(
          substring(
            regexp_replace(coalesce(r.message, ''), E'\\s*__JSON__[\\s\\S]*$', '', 'n')
            from E'(?m)^(?:سبب الرفض|السبب|سبب)\\s*:\\s*(.+)$'
          )
        ),
        ''
      ),
      ''
    )::text as reject_reason
  from public.approval_requests r
  where r.kind in (
      'event_card',
      'family_event',
      'event_request',
      'tree_card',
      'tree_edit',
      'memory_card'
    )
    and r.status in ('pending', 'approved', 'rejected', 'submitted')
    and right(regexp_replace(coalesce(r.phone, ''), '[^0-9]', '', 'g'), 9) = v_tail
  order by r.created_at desc
  limit 20;
end;
$fn$;

revoke all on function public.public_my_requests_by_phone_v1(text) from public;
grant execute on function public.public_my_requests_by_phone_v1(text) to anon, authenticated;

select
  (to_regprocedure('public.public_my_requests_by_phone_v1(text)') is not null)
    as has_public_my_requests_by_phone_v1;
