-- COPY-ME: run in Supabase SQL Editor / SQL Workspace
-- Preset id: maint.admin_family_event_delete_unlink_request_v1
--
-- Admin delete of a family_events row must also remove the linked
-- approval_requests (event_card / family_event / event_request) so the item
-- disappears from homepage AND delegate «طلبات فرعي» (not left as «منشور»).
-- Also replaces family_events_delete_v1 so delegate panel delete unlinks the same way.
--
-- Safe to re-run (CREATE OR REPLACE only — no data DELETE).

create or replace function public.admin_family_event_delete_v1(
  p_token text,
  p_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_details text;
  v_request_id text := null;
  v_deleted boolean := false;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  if p_id is null or p_id <= 0 then
    return false;
  end if;

  select e.details
    into v_details
  from public.family_events e
  where e.id = p_id
  limit 1;

  if not found then
    return false;
  end if;

  -- Extract requestId / request_id from details JSON when present.
  begin
    if nullif(btrim(coalesce(v_details, '')), '') is not null then
      v_request_id := nullif(btrim(coalesce(
        (v_details::jsonb)->>'requestId',
        (v_details::jsonb)->>'request_id',
        ((v_details::jsonb)->'event')->>'requestId',
        ((v_details::jsonb)->'event')->>'request_id',
        ''
      )), '');
    end if;
  exception
    when others then
      v_request_id := null;
  end;

  -- Fallback: requestId embedded as text in details.
  if v_request_id is null and nullif(btrim(coalesce(v_details, '')), '') is not null then
    v_request_id := nullif(
      btrim(
        coalesce(
          (regexp_match(v_details, '("requestId"|"request_id")\s*:\s*"([^"]+)"'))[2],
          (regexp_match(v_details, '(EVN-[A-Z0-9]+-[A-Z0-9]+)'))[1],
          ''
        )
      ),
      ''
    );
  end if;

  delete from public.family_events e where e.id = p_id;
  v_deleted := found;

  if not v_deleted then
    return false;
  end if;

  -- Remove linked approval request so delegate inbox/history stops showing it
  -- as an active published/approved event card.
  if v_request_id is not null then
    delete from public.approval_requests r
    where r.request_id = v_request_id
      and r.kind in ('event_card', 'family_event', 'event_request');
  end if;

  return true;
end;
$$;

revoke all on function public.admin_family_event_delete_v1(text, bigint) from public;
grant execute on function public.admin_family_event_delete_v1(text, bigint) to anon, authenticated;

comment on function public.admin_family_event_delete_v1(text, bigint) is
  'Admin hard-delete family_events by id and unlink matching event approval_requests.';

-- Harden admin_delete_request_v1: unpublish family_events then delete request.
-- No silent exception swallow — real errors surface (Arabic-mapped in UI).
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


-- =============================================================================
-- Delegate delete: family_events_delete_v1 also unlinks approval_requests
-- so «طلبات فرعي» لا تبقى بعد حذف المناسبة من لوحة المندوب.
-- Branch-scoped delete by id (was previously unscoped).
-- =============================================================================

create or replace function public.family_events_delete_v1(
  p_branch_key text,
  p_phone text,
  p_email text,
  p_secret_hash text,
  p_pk_col text,
  p_pk_value text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted boolean := false;
  v_details text := null;
  v_request_id text := null;
  v_branch text := regexp_replace(btrim(coalesce(p_branch_key, '')), '\s+', ' ', 'g');
begin
  if not public.events_delegate_allowed_v1(p_branch_key, p_phone, p_email, p_secret_hash) then
    return false;
  end if;

  if nullif(btrim(coalesce(p_pk_col, '')), '') is null
     or nullif(btrim(coalesce(p_pk_value, '')), '') is null then
    return false;
  end if;

  if p_pk_col = 'id' then
    select e.details into v_details
    from public.family_events e
    where e.id = p_pk_value::bigint
      and regexp_replace(btrim(coalesce(e.branch_key, '')), '\s+', ' ', 'g') = v_branch
    limit 1;
  else
    select e.details into v_details
    from public.family_events e
    where e.created_at = p_pk_value::timestamptz
      and regexp_replace(btrim(coalesce(e.branch_key, '')), '\s+', ' ', 'g') = v_branch
    limit 1;
  end if;

  begin
    if nullif(btrim(coalesce(v_details, '')), '') is not null then
      v_request_id := nullif(btrim(coalesce(
        (v_details::jsonb)->>'requestId',
        (v_details::jsonb)->>'request_id',
        ((v_details::jsonb)->'event')->>'requestId',
        ((v_details::jsonb)->'event')->>'request_id',
        ''
      )), '');
    end if;
  exception
    when others then
      v_request_id := null;
  end;

  if v_request_id is null and nullif(btrim(coalesce(v_details, '')), '') is not null then
    v_request_id := nullif(
      btrim(
        coalesce(
          (regexp_match(v_details, '("requestId"|"request_id")\s*:\s*"([^"]+)"'))[2],
          (regexp_match(v_details, '(EVN-[A-Z0-9]+-[A-Z0-9]+)'))[1],
          ''
        )
      ),
      ''
    );
  end if;

  if p_pk_col = 'id' then
    delete from public.family_events e
    where e.id = p_pk_value::bigint
      and regexp_replace(btrim(coalesce(e.branch_key, '')), '\s+', ' ', 'g') = v_branch;
    v_deleted := found;
  else
    delete from public.family_events e
    where e.created_at = p_pk_value::timestamptz
      and regexp_replace(btrim(coalesce(e.branch_key, '')), '\s+', ' ', 'g') = v_branch;
    v_deleted := found;
  end if;

  if not v_deleted then
    return false;
  end if;

  if v_request_id is not null then
    delete from public.approval_requests r
    where r.request_id = v_request_id
      and r.kind in ('event_card', 'family_event', 'event_request')
      and regexp_replace(btrim(coalesce(r.branch_key, '')), '\s+', ' ', 'g') = v_branch;
  end if;

  perform public.events_audit_log_v1(
    p_branch_key,
    p_phone,
    p_email,
    p_secret_hash,
    jsonb_build_object(
      'v', 1,
      'kind', 'events_audit',
      'op', 'delete',
      'branch_key', p_branch_key,
      'pk_col', p_pk_col,
      'pk_value', p_pk_value,
      'request_id', v_request_id,
      'at', now()::timestamptz
    )
  );

  return true;
end;
$$;

grant execute on function public.family_events_delete_v1(text, text, text, text, text, text) to anon, authenticated;

comment on function public.family_events_delete_v1(text, text, text, text, text, text) is
  'Delegate hard-delete family_events (branch-scoped) and unlink matching event approval_requests.';

select
  (select to_regprocedure('public.admin_family_event_delete_v1(text,bigint)') is not null)
    as has_family_event_delete,
  (select pg_get_functiondef('public.admin_family_event_delete_v1(text,bigint)'::regprocedure)
     like '%approval_requests%') as delete_unlinks_requests,
  (select to_regprocedure('public.family_events_delete_v1(text,text,text,text,text,text)') is not null)
    as has_delegate_family_event_delete,
  (select pg_get_functiondef('public.family_events_delete_v1(text,text,text,text,text,text)'::regprocedure)
     like '%approval_requests%') as delegate_delete_unlinks_requests,
  (select to_regprocedure('public.admin_delete_request_v1(text,text)') is not null)
    as has_delete_request;
