-- Extends admin_delete_request_v1 so deleting an event_card request
-- also removes the published family_events row (public ticker / المناسبات).
-- Resolves p_id as approval_requests.id (digits-only) OR request_id (EVN-*).
-- Never strip digits from EVN-* (e.g. EVN-A6HR-PLQ8 must not become id=68).
-- No silent exception swallow — real errors surface to the admin UI.

create or replace function public.admin_delete_request_v1(
  p_token text,
  p_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_raw text := nullif(btrim(coalesce(p_id, '')), '');
  v_id bigint := null;
  v_kind text := null;
  v_request_id text := null;
begin
  if not public.admin_token_ok_v1(p_token) then
    return false;
  end if;

  if v_raw is null then
    return false;
  end if;

  -- Pure digits = approval_requests.id.
  if v_raw ~ '^[0-9]+$' then
    v_id := v_raw::bigint;
    select r.kind, r.request_id
      into v_kind, v_request_id
    from public.approval_requests r
    where r.id = v_id
    limit 1;
  else
    -- EVN-* / OCC-* / any non-pure-numeric token → request_id lookup.
    select r.id, r.kind, r.request_id
      into v_id, v_kind, v_request_id
    from public.approval_requests r
    where r.request_id = v_raw
    limit 1;
  end if;

  if v_id is null then
    return false;
  end if;

  if v_kind in ('event_card', 'family_event', 'event_request')
     and nullif(btrim(coalesce(v_request_id, '')), '') is not null then
    delete from public.family_events e
    where coalesce(e.details, '') like '%' || v_request_id || '%';
  end if;

  delete from public.approval_requests where id = v_id;
  return found;
end;
$$;

revoke all on function public.admin_delete_request_v1(text, text) from public;
grant execute on function public.admin_delete_request_v1(text, text) to anon, authenticated;
