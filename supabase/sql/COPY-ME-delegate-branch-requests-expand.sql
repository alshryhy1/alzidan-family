-- COPY-ME: Expand branch-delegate request queue beyond events + keep history.
-- Preset id: maint.delegate_branch_requests_expand_v2
-- (v1 may be archived as «منفذ» while live body was still pending-only —
--  the old probe only checked to_regprocedure IS NOT NULL.)
-- Run manually in Supabase SQL Editor / SQL Workspace. Do NOT auto-execute from the app.
--
-- Goal (Request Lifecycle v2):
--   Branch delegate can list + approve/reject branch requests for:
--     event_card / family_event / event_request
--     tree_card  (إضافة فرد)
--     tree_edit  (تصحيح)
--     memory_card (ذكرى — إن وُجدت في approval_requests)
--   Explicitly EXCLUDED (central admin only):
--     special_card (البطاقة / طلب بطاقة)
--     tree_delegate / events_delegate / delegate_secret_reset / …
--     events_audit / tree_audit (internal audit rows — never in inbox)
--
-- CRITICAL: list returns pending + approved + rejected so handled items
-- do NOT disappear from «طلبات فرعي».
--
-- Enriched payload (jsonb array): approval_requests fields + schedule/publish
-- fields joined from family_events when published (show_at, show_before_days,
-- event_date, end_at, manual_hidden, published, event_id) + reviewed_by when
-- stamped on the message.
-- Visibility state is computed on read by the client (no cron).
--
-- Auth:
--   List: tree OR events can_read (same gate as portal login read path)
--   Status change:
--     event kinds  → events_delegate_allowed_v1
--     tree/memory  → tree_delegate_allowed_v1
--   On status change: append internal review stamp with delegate display name.

drop function if exists public.delegate_list_event_requests_v1(text, text, text, text);

create or replace function public.delegate_list_event_requests_v1(
  p_branch_key text,
  p_phone text,
  p_email text,
  p_secret_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_out jsonb := '[]'::jsonb;
begin
  -- Read gate (not write/allowed): login uses can_read; list must match.
  if not (
    public.tree_delegate_can_read_v1(p_branch_key, p_phone, p_email, p_secret_hash)
    or public.events_delegate_can_read_v1(p_branch_key, p_phone, p_email, p_secret_hash)
  ) then
    return v_out;
  end if;

  select coalesce(jsonb_agg(row_payload order by sort_status, created_at desc), '[]'::jsonb)
  into v_out
  from (
    select
      (
        to_jsonb(r)
        || jsonb_build_object(
          'show_at', e.show_at,
          'show_before_days', e.show_before_days,
          'event_date', e.event_date,
          'end_at', e.end_at,
          'manual_hidden', e.manual_hidden,
          'published', (e.id is not null),
          'event_id', e.id,
          'date_label', e.date_label,
          'event_type', e.type,
          'reviewed_by', nullif(
            btrim(
              coalesce(
                (regexp_match(
                  coalesce(r.message, ''),
                  'تمت مراجعة الطلب بواسطة المندوب:\s*([^\n\r]+)'
                ))[1],
                (regexp_match(
                  coalesce(r.message, ''),
                  'تمت مراجعة الطلب بواسطة\s*([^\n\r.]+)'
                ))[1],
                ''
              )
            ),
            ''
          )
        )
      ) as row_payload,
      case lower(coalesce(r.status, ''))
        when 'pending' then 0
        when 'approved' then 1
        when 'rejected' then 2
        else 3
      end as sort_status,
      r.created_at
    from public.approval_requests r
    left join lateral (
      select fe.*
      from public.family_events fe
      where nullif(btrim(coalesce(r.request_id, '')), '') is not null
        and (
          coalesce(fe.details, '') like '%' || r.request_id || '%'
        )
        and regexp_replace(btrim(coalesce(fe.branch_key, '')), '\s+', ' ', 'g')
          = regexp_replace(btrim(coalesce(r.branch_key, '')), '\s+', ' ', 'g')
      order by fe.id desc
      limit 1
    ) e on true
    where r.status in ('pending', 'approved', 'rejected')
      and r.kind in (
        'event_card',
        'family_event',
        'event_request',
        'tree_card',
        'tree_edit',
        'memory_card'
      )
      -- special_card + audit kinds intentionally excluded
      and regexp_replace(btrim(coalesce(r.branch_key, '')), '\s+', ' ', 'g')
        = regexp_replace(btrim(coalesce(p_branch_key, '')), '\s+', ' ', 'g')
    order by sort_status, r.created_at desc
    limit 200
  ) q;

  return coalesce(v_out, '[]'::jsonb);
end;
$$;

drop function if exists public.delegate_set_approval_request_status_v1(text, bigint, text);
drop function if exists public.delegate_set_approval_request_status_v1(text, bigint, text, text, text, text);

create or replace function public.delegate_set_approval_request_status_v1(
  p_branch_key text,
  p_request_id bigint,
  p_status text,
  p_phone text default null,
  p_email text default null,
  p_secret_hash text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.approval_requests%rowtype;
  v_status text;
  v_kind text;
  v_auth_ok boolean := false;
  v_stamp text;
  v_msg text;
  v_reviewer text;
begin
  v_status := case
    when lower(btrim(coalesce(p_status, ''))) = 'approved' then 'approved'
    when lower(btrim(coalesce(p_status, ''))) = 'rejected' then 'rejected'
    else null
  end;
  if v_status is null then
    return false;
  end if;

  select * into v_row
  from public.approval_requests r
  where r.id = p_request_id
    and r.status = 'pending'
    and r.kind in (
      'event_card',
      'family_event',
      'event_request',
      'tree_card',
      'tree_edit',
      'memory_card'
    )
    and regexp_replace(btrim(coalesce(r.branch_key, '')), '\s+', ' ', 'g')
      = regexp_replace(btrim(coalesce(p_branch_key, '')), '\s+', ' ', 'g')
  limit 1;

  if v_row.id is null then
    return false;
  end if;

  v_kind := coalesce(v_row.kind, '');

  if p_phone is not null or p_email is not null or p_secret_hash is not null then
    if v_kind in ('event_card', 'family_event', 'event_request') then
      v_auth_ok := public.events_delegate_allowed_v1(
        p_branch_key, p_phone, p_email, p_secret_hash
      );
    elsif v_kind in ('tree_card', 'tree_edit', 'memory_card') then
      v_auth_ok := public.tree_delegate_allowed_v1(
        p_branch_key, p_phone, p_email, p_secret_hash
      );
    else
      return false;
    end if;

    if not v_auth_ok then
      return false;
    end if;
  end if;

  -- Prefer display name from delegates_v2 (security definer path).
  v_reviewer := null;
  begin
    select nullif(btrim(coalesce(d.name, '')), '')
      into v_reviewer
    from public.delegates_v2 d
    where public.delegates_v2_norm_branch(d.branch_key)
        = public.delegates_v2_norm_branch(p_branch_key)
      and (
        nullif(btrim(coalesce(p_phone, '')), '') is null
        or public.delegates_v2_norm_phone(d.phone)
           = public.delegates_v2_norm_phone(p_phone)
      )
      and coalesce(d.is_enabled, false) is true
    order by d.updated_at desc nulls last
    limit 1;
  exception when others then
    v_reviewer := null;
  end;

  if v_reviewer is not null then
    v_stamp := E'\n---\nتمت مراجعة الطلب بواسطة المندوب: ' || v_reviewer || '.';
  elsif nullif(btrim(coalesce(p_phone, '')), '') is not null
     or nullif(btrim(coalesce(p_email, '')), '') is not null then
    v_stamp := E'\n---\nتمت مراجعة الطلب بواسطة مندوب الفرع.';
  else
    v_stamp := E'\n---\nتمت مراجعة الطلب بواسطة أحد المراجعين المعتمدين.';
  end if;

  v_msg := coalesce(v_row.message, '');
  if position('تمت مراجعة الطلب بواسطة' in v_msg) = 0 then
    v_msg := v_msg || v_stamp;
  end if;

  update public.approval_requests
  set
    status = v_status,
    message = v_msg
  where id = p_request_id;

  return found;
end;
$$;

grant execute on function public.delegate_list_event_requests_v1(text, text, text, text) to anon, authenticated;
grant execute on function public.delegate_set_approval_request_status_v1(text, bigint, text, text, text, text) to anon, authenticated;

-- Smoke: prove BODY is lifecycle v2 (not merely that the name exists).
select
  (select to_regprocedure('public.delegate_list_event_requests_v1(text,text,text,text)') is not null) as has_list,
  (select to_regprocedure('public.delegate_set_approval_request_status_v1(text,bigint,text,text,text,text)') is not null) as has_set,
  (
    select coalesce(pg_get_functiondef('public.delegate_list_event_requests_v1(text,text,text,text)'::regprocedure), '')
      like '%pending%'
     and coalesce(pg_get_functiondef('public.delegate_list_event_requests_v1(text,text,text,text)'::regprocedure), '')
      like '%approved%'
     and coalesce(pg_get_functiondef('public.delegate_list_event_requests_v1(text,text,text,text)'::regprocedure), '')
      like '%rejected%'
     and coalesce(pg_get_functiondef('public.delegate_list_event_requests_v1(text,text,text,text)'::regprocedure), '')
      like '%show_at%'
     and coalesce(pg_get_functiondef('public.delegate_list_event_requests_v1(text,text,text,text)'::regprocedure), '')
      like '%jsonb_agg%'
  ) as list_body_is_lifecycle_v2,
  (
    select pg_typeof(public.delegate_list_event_requests_v1('__probe__', '', '', ''))::text
  ) as list_return_type;
