-- COPY-ME / maint.public_my_request_statuses_v1
-- Homepage «طلباتي» live status sync for submitters.
-- Why: anon cannot SELECT approval_requests (RLS → [] / errors), so localStorage
-- stays stuck on submitted/pending after accept/reject.
-- NOTE: approval_requests has NO reject_reason column — reason lives in message.

create or replace function public.public_my_request_statuses_v1(p_ids text[])
returns table(request_id text, status text, reject_reason text)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_ids text[];
begin
  select coalesce(array_agg(distinct upper(btrim(x))), array[]::text[])
    into v_ids
  from unnest(coalesce(p_ids, array[]::text[])) as t(x)
  where nullif(btrim(x), '') is not null;

  if v_ids is null or cardinality(v_ids) = 0 then
    return;
  end if;

  return query
  select
    r.request_id::text,
    lower(btrim(coalesce(r.status, '')))::text as status,
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
  where upper(btrim(coalesce(r.request_id, ''))) = any (v_ids)
  limit 50;
end;
$fn$;

revoke all on function public.public_my_request_statuses_v1(text[]) from public;
grant execute on function public.public_my_request_statuses_v1(text[]) to anon, authenticated;

-- Probe (read-only): function present?
select
  (to_regprocedure('public.public_my_request_statuses_v1(text[])') is not null)
    as has_public_my_request_statuses_v1;
