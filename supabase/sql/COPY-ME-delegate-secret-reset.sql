-- Operator path: Admin → SQL Workspace → أوامر الصيانة الجاهزة
-- Preset id: maint.delegate_secret_reset_v1
-- Source of truth file (do not prefer external paste).

-- Keep this file as source of truth. Prefer Workspace over external paste.
-- =============================================================================
-- FIX: Dedicated delegate secret-reset intent (not generic Workflow chrome)
-- Safe to re-run. Operator path: Admin → SQL Workspace → أوامر الصيانة الجاهزة.
-- Source of truth for preset id: maint.delegate_secret_reset_v1
-- =============================================================================

create or replace function public.delegate_secret_reset_norm_branch(p text)
returns text language sql immutable as $$
  select regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g');
$$;

create or replace function public.delegate_secret_reset_norm_phone(p text)
returns text language sql immutable as $$
  select regexp_replace(btrim(coalesce(p, '')), '\s+', '', 'g');
$$;

create or replace function public.delegate_secret_reset_norm_email(p text)
returns text language sql immutable as $$
  select lower(regexp_replace(btrim(coalesce(p, '')), '\s+', '', 'g'));
$$;

create or replace function public.delegate_secret_reset_submit_v1(
  p_branch_key text,
  p_phone text,
  p_email text,
  p_secret_hash text,
  p_request_id text default null,
  p_message text default null,
  p_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch text := public.delegate_secret_reset_norm_branch(p_branch_key);
  v_phone text := public.delegate_secret_reset_norm_phone(p_phone);
  v_email text := public.delegate_secret_reset_norm_email(p_email);
  v_hash text := nullif(btrim(coalesce(p_secret_hash, '')), '');
  v_req_id text := nullif(btrim(coalesce(p_request_id, '')), '');
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
  v_delegate_name text;
  v_has_identity boolean := false;
  v_pending_id text;
  v_now timestamptz := now();
  v_pk bigint;
  v_deep text;
begin
  if v_branch = '' or v_phone = '' or v_hash is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;

  if to_regclass('public.delegates_v2') is not null then
    select d.name into v_delegate_name
    from public.delegates_v2 d
    where public.delegate_secret_reset_norm_branch(d.branch_key) = v_branch
      and public.delegate_secret_reset_norm_phone(d.phone) = v_phone
      and (
        v_email = ''
        or public.delegate_secret_reset_norm_email(d.email) = ''
        or public.delegate_secret_reset_norm_email(d.email) = v_email
      )
      and coalesce(d.is_enabled, true) = true
    order by d.updated_at desc nulls last
    limit 1;
    if found then
      v_has_identity := true;
    end if;
  end if;

  if not v_has_identity then
    select r.name into v_delegate_name
    from public.approval_requests r
    where r.kind in ('tree_delegate', 'events_delegate')
      and r.status = 'approved'
      and public.delegate_secret_reset_norm_branch(r.branch_key) = v_branch
      and public.delegate_secret_reset_norm_phone(r.phone) = v_phone
      and (
        v_email = ''
        or public.delegate_secret_reset_norm_email(r.email) = ''
        or public.delegate_secret_reset_norm_email(r.email) = v_email
      )
    order by r.created_at desc nulls last
    limit 1;
    if found then
      v_has_identity := true;
    end if;
  end if;

  if not v_has_identity then
    return jsonb_build_object('ok', false, 'reason', 'not_a_delegate');
  end if;

  select r.request_id into v_pending_id
  from public.approval_requests r
  where r.kind = 'delegate_secret_reset'
    and r.status = 'pending'
    and public.delegate_secret_reset_norm_branch(r.branch_key) = v_branch
    and public.delegate_secret_reset_norm_phone(r.phone) = v_phone
  order by r.created_at desc nulls last
  limit 1;

  if v_pending_id is not null then
    return jsonb_build_object(
      'ok', false,
      'reason', 'duplicate_pending',
      'request_id', v_pending_id
    );
  end if;

  if v_req_id is null then
    v_req_id := 'SRS-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4))
      || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 5, 4));
  end if;

  if v_name is null then
    v_name := nullif(btrim(coalesce(v_delegate_name, '')), '');
  end if;

  if v_msg is null then
    v_msg := 'طلب إعادة تعيين الرقم السري للمندوب'
      || E'\n' || 'رقم الطلب: ' || v_req_id
      || E'\n' || 'الفرع: ' || v_branch
      || E'\n' || 'الجوال: ' || v_phone
      || E'\n' || 'بانتظار الإدارة';
  end if;

  if position('delegate_secret_reset' in v_msg) = 0 then
    v_msg := v_msg || E'\n__JSON__:' || jsonb_build_object(
      'v', 1,
      'kind', 'delegate_secret_reset',
      'intent', 'secret_reset',
      'at', v_now
    )::text;
  end if;

  v_deep := 'module=requests&request=' || v_req_id;
  begin
    v_deep := public.workflow_deep_link_for_v1(v_req_id);
  exception when others then
    v_deep := 'module=requests&request=' || v_req_id;
  end;

  insert into public.approval_requests (
    request_id, kind, branch_key, name, phone, email, secret_hash,
    message, status, created_at, request_type, wf_state, wf_deep_link, wf_updated_at
  ) values (
    v_req_id,
    'delegate_secret_reset',
    nullif(btrim(p_branch_key), ''),
    v_name,
    nullif(btrim(p_phone), ''),
    nullif(lower(btrim(coalesce(p_email, ''))), ''),
    v_hash,
    v_msg,
    'pending',
    v_now,
    'delegate_secret_reset',
    null,
    v_deep,
    v_now
  )
  returning id into v_pk;

  begin
    if to_regclass('public.workflow_notification_events') is not null then
      insert into public.workflow_notification_events (
        request_id, request_pk, event_key, recipient_hint, channel, payload
      ) values (
        v_req_id, v_pk, 'secret_reset.submitted', 'admin', 'log',
        jsonb_build_object('kind', 'delegate_secret_reset', 'branch_key', v_branch, 'phone', v_phone, 'at', v_now)
      );
    end if;
  exception when others then null;
  end;

  return jsonb_build_object('ok', true, 'request_id', v_req_id, 'id', v_pk, 'name', v_name);
end;
$$;

create or replace function public.admin_delegate_secret_reset_approve_v1(
  p_token text,
  p_id text,
  p_secret_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pk bigint;
  v_req public.approval_requests%rowtype;
  v_hash text;
  v_branch text;
  v_phone text;
  v_email text;
  v_legacy_n int := 0;
  v_v2_n int := 0;
  v_delegate_id uuid;
  v_notify_channel text := 'admin_copy_only';
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  begin
    v_pk := trim(coalesce(p_id, ''))::bigint;
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'bad_id');
  end;

  select * into v_req from public.approval_requests where id = v_pk for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_req.kind is distinct from 'delegate_secret_reset' then
    return jsonb_build_object('ok', false, 'reason', 'wrong_kind');
  end if;
  if v_req.status = 'approved' then
    return jsonb_build_object('ok', true, 'already', true, 'request_id', v_req.request_id, 'notify_channel', v_notify_channel);
  end if;
  if v_req.status is distinct from 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'not_pending', 'status', v_req.status);
  end if;

  v_hash := nullif(btrim(coalesce(p_secret_hash, v_req.secret_hash, '')), '');
  if v_hash is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_secret_hash');
  end if;

  v_branch := public.delegate_secret_reset_norm_branch(v_req.branch_key);
  v_phone := public.delegate_secret_reset_norm_phone(v_req.phone);
  v_email := public.delegate_secret_reset_norm_email(v_req.email);

  update public.approval_requests r
  set secret_hash = v_hash
  where r.kind in ('tree_delegate', 'events_delegate')
    and r.status = 'approved'
    and public.delegate_secret_reset_norm_branch(r.branch_key) = v_branch
    and public.delegate_secret_reset_norm_phone(r.phone) = v_phone
    and (
      v_email = ''
      or public.delegate_secret_reset_norm_email(r.email) = ''
      or public.delegate_secret_reset_norm_email(r.email) = v_email
    );
  get diagnostics v_legacy_n = row_count;

  if to_regclass('public.delegates_v2') is not null then
    update public.delegates_v2 d
    set secret_hash = v_hash, updated_at = now()
    where public.delegate_secret_reset_norm_branch(d.branch_key) = v_branch
      and public.delegate_secret_reset_norm_phone(d.phone) = v_phone
      and (
        v_email = ''
        or public.delegate_secret_reset_norm_email(d.email) = ''
        or public.delegate_secret_reset_norm_email(d.email) = v_email
      );
    get diagnostics v_v2_n = row_count;

    select d.id into v_delegate_id
    from public.delegates_v2 d
    where public.delegate_secret_reset_norm_branch(d.branch_key) = v_branch
      and public.delegate_secret_reset_norm_phone(d.phone) = v_phone
    order by d.updated_at desc nulls last
    limit 1;
  end if;

  if v_legacy_n = 0 and v_v2_n = 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_delegate_target');
  end if;

  update public.approval_requests
  set
    status = 'approved',
    secret_hash = v_hash,
    request_type = 'delegate_secret_reset',
    wf_state = 'done',
    wf_updated_at = now()
  where id = v_pk;

  begin
    perform public.admin_audit_write_v1(
      'admin', 'admin_token', 'delegate.secret_reset_approve', 'approval_request',
      v_req.request_id, nullif(btrim(v_req.branch_key), ''),
      jsonb_build_object('request_pk', v_pk, 'legacy_updated', v_legacy_n, 'v2_updated', v_v2_n, 'delegate_id', v_delegate_id, 'at', now())
    );
  exception when others then null;
  end;

  begin
    if to_regclass('public.workflow_notification_events') is not null then
      insert into public.workflow_notification_events (
        request_id, request_pk, event_key, recipient_hint, channel, payload
      ) values (
        v_req.request_id, v_pk, 'secret_reset.approved', 'submitter', 'log',
        jsonb_build_object('kind', 'delegate_secret_reset', 'legacy_updated', v_legacy_n, 'v2_updated', v_v2_n, 'note', 'no_guaranteed_push_channel', 'at', now())
      );
      v_notify_channel := 'log';
    end if;
  exception when others then
    v_notify_channel := 'admin_copy_only';
  end;

  return jsonb_build_object(
    'ok', true,
    'request_id', v_req.request_id,
    'legacy_updated', v_legacy_n,
    'v2_updated', v_v2_n,
    'delegate_id', v_delegate_id,
    'notify_channel', v_notify_channel,
    'notify_limitation', 'لا قناة إشعار مضمونة للمندوب — انسخ الرقم السري مرة واحدة وأبلغه يدويًا إن لزم.'
  );
end;
$$;

create or replace function public.admin_delegate_secret_reset_reject_v1(
  p_token text,
  p_id text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pk bigint;
  v_req public.approval_requests%rowtype;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  begin
    v_pk := trim(coalesce(p_id, ''))::bigint;
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'bad_id');
  end;

  select * into v_req from public.approval_requests where id = v_pk for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_req.kind is distinct from 'delegate_secret_reset' then
    return jsonb_build_object('ok', false, 'reason', 'wrong_kind');
  end if;
  if v_req.status = 'rejected' then
    return jsonb_build_object('ok', true, 'already', true, 'request_id', v_req.request_id);
  end if;

  update public.approval_requests
  set
    status = 'rejected',
    request_type = 'delegate_secret_reset',
    wf_state = 'rejected',
    wf_updated_at = now(),
    message = case
      when nullif(btrim(coalesce(p_reason, '')), '') is null then message
      else coalesce(message, '') || E'\nسبب الرفض: ' || btrim(p_reason)
    end
  where id = v_pk;

  begin
    perform public.admin_audit_write_v1(
      'admin', 'admin_token', 'delegate.secret_reset_reject', 'approval_request',
      v_req.request_id, nullif(btrim(v_req.branch_key), ''),
      jsonb_build_object('request_pk', v_pk, 'reason', nullif(btrim(coalesce(p_reason, '')), ''), 'at', now())
    );
  exception when others then null;
  end;

  begin
    if to_regclass('public.workflow_notification_events') is not null then
      insert into public.workflow_notification_events (
        request_id, request_pk, event_key, recipient_hint, channel, payload
      ) values (
        v_req.request_id, v_pk, 'secret_reset.rejected', 'submitter', 'log',
        jsonb_build_object('kind', 'delegate_secret_reset', 'at', now())
      );
    end if;
  exception when others then null;
  end;

  return jsonb_build_object('ok', true, 'request_id', v_req.request_id);
end;
$$;

create or replace function public.admin_workflow_next_states_v1(
  p_token text,
  p_request_ref text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pk bigint;
  v_row public.approval_requests%rowtype;
  v_from text;
  v_next text[];
  v_type text;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  v_pk := public.workflow_resolve_request_pk_v1(p_request_ref);
  if v_pk is null then
    return jsonb_build_object('ok', false, 'code', 'WF-001', 'next', '[]'::jsonb);
  end if;

  select * into v_row from public.approval_requests where id = v_pk;
  v_type := coalesce(nullif(btrim(v_row.request_type), ''), v_row.kind);

  if v_type = 'delegate_secret_reset' or v_row.kind = 'delegate_secret_reset' then
    return jsonb_build_object(
      'ok', true,
      'dedicated_ui', true,
      'intent', 'delegate_secret_reset',
      'label_ar', 'طلب إعادة تعيين الرقم السري',
      'wf_state', coalesce(nullif(btrim(v_row.wf_state), ''), v_row.status),
      'next', '[]'::jsonb,
      'hint_ar', 'استخدم بطاقة إعادة التعيين في جدول الطلبات (اعتماد / رفض) — ليست مسار الشجرة أو المناسبات.'
    );
  end if;

  v_from := coalesce(
    nullif(btrim(v_row.wf_state), ''),
    public.workflow_infer_state_from_legacy_v1(v_row.status)
  );

  v_next := case v_from
    when 'submitted' then array['assigned']
    when 'assigned' then array['in_review']
    when 'in_review' then array['needs_changes', 'approved', 'rejected']
    when 'needs_changes' then array['in_review']
    when 'approved' then array['applied']
    when 'applied' then array['done']
    else array[]::text[]
  end;

  return jsonb_build_object('ok', true, 'wf_state', v_from, 'next', to_jsonb(v_next));
end;
$$;

create or replace function public.admin_workflow_backfill_v1(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int := 0;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  update public.approval_requests r
  set
    wf_state = public.workflow_infer_state_from_legacy_v1(r.status),
    wf_deep_link = coalesce(
      nullif(btrim(r.wf_deep_link), ''),
      public.workflow_deep_link_for_v1(r.request_id)
    ),
    request_type = coalesce(nullif(btrim(r.request_type), ''), r.kind),
    wf_updated_at = coalesce(r.wf_updated_at, now())
  where nullif(btrim(coalesce(r.wf_state, '')), '') is null
    and coalesce(r.kind, '') is distinct from 'delegate_secret_reset'
    and coalesce(r.request_type, '') is distinct from 'delegate_secret_reset';

  get diagnostics v_n = row_count;

  update public.approval_requests r
  set
    request_type = 'delegate_secret_reset',
    wf_deep_link = coalesce(
      nullif(btrim(r.wf_deep_link), ''),
      public.workflow_deep_link_for_v1(r.request_id)
    )
  where r.kind = 'delegate_secret_reset'
    and (
      nullif(btrim(coalesce(r.request_type, '')), '') is null
      or r.request_type is distinct from 'delegate_secret_reset'
    );

  begin
    perform public.admin_audit_write_v1(
      'admin', 'admin_token', 'workflow.backfill', 'approval_request', null, null,
      jsonb_build_object('updated', v_n, 'skipped_kind', 'delegate_secret_reset')
    );
  exception when others then null;
  end;

  return jsonb_build_object('ok', true, 'updated', v_n);
end;
$$;

grant execute on function public.delegate_secret_reset_submit_v1(text, text, text, text, text, text, text)
  to anon, authenticated;
grant execute on function public.admin_delegate_secret_reset_approve_v1(text, text, text)
  to anon, authenticated;
grant execute on function public.admin_delegate_secret_reset_reject_v1(text, text, text)
  to anon, authenticated;
grant execute on function public.admin_workflow_next_states_v1(text, text)
  to anon, authenticated;
grant execute on function public.admin_workflow_backfill_v1(text)
  to anon, authenticated;
