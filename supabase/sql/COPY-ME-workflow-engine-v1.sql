-- Open this file, Select All, paste in Supabase SQL Editor
-- =============================================================================
-- Workflow Engine v1 — Foundation slice
-- Safe to re-run. Admin-token gated transitions. Delegate hooks stubbed.
-- Ref: docs/WORKFLOW-SPECIFICATION-v1.md · docs/PLATFORM-PRINCIPLES.md · ADR-010
--
-- Design choice: ADAPT approval_requests (add wf_* columns) — do NOT create a
-- parallel request store. Legacy status (pending/approved/rejected) stays for
-- existing UI/RPCs; wf_state is SSOT for Workflow Engine lifecycle.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Extend approval_requests (adapt, don't fork)
-- -----------------------------------------------------------------------------
alter table public.approval_requests
  add column if not exists wf_state text;

alter table public.approval_requests
  add column if not exists wf_owner_delegate_id uuid;

alter table public.approval_requests
  add column if not exists wf_deep_link text;

alter table public.approval_requests
  add column if not exists wf_updated_at timestamptz;

alter table public.approval_requests
  add column if not exists request_type text;

comment on column public.approval_requests.wf_state is
  'Workflow Engine SSOT state: submitted|assigned|in_review|needs_changes|approved|applied|done|rejected';
comment on column public.approval_requests.wf_owner_delegate_id is
  'Current operational owner (delegates_v2.id); null until assigned';
comment on column public.approval_requests.wf_deep_link is
  'Engine-generated deep link fragment for this request';
comment on column public.approval_requests.request_type is
  'Catalog request type when distinct from legacy kind; falls back to kind';

create index if not exists approval_requests_wf_state_idx
  on public.approval_requests (wf_state);

create index if not exists approval_requests_wf_owner_idx
  on public.approval_requests (wf_owner_delegate_id);

create index if not exists approval_requests_request_id_idx
  on public.approval_requests (request_id);

-- -----------------------------------------------------------------------------
-- 2) Transition log + notification emit points (log-only v1)
-- -----------------------------------------------------------------------------
create table if not exists public.workflow_transition_log (
  id bigserial primary key,
  request_pk bigint,
  request_id text not null,
  from_state text,
  to_state text,
  actor_type text not null default 'system',
  actor_ref text,
  reason text,
  ok boolean not null default true,
  fail_code text,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists workflow_transition_log_request_idx
  on public.workflow_transition_log (request_id, created_at desc);
create index if not exists workflow_transition_log_created_idx
  on public.workflow_transition_log (created_at desc);

create table if not exists public.workflow_notification_events (
  id bigserial primary key,
  request_id text not null,
  transition_id bigint references public.workflow_transition_log (id) on delete set null,
  event_key text not null,
  recipient_hint text,
  channel text not null default 'log',
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists workflow_notification_events_request_idx
  on public.workflow_notification_events (request_id, created_at desc);
create index if not exists workflow_notification_events_created_idx
  on public.workflow_notification_events (created_at desc);

alter table public.workflow_transition_log enable row level security;
alter table public.workflow_notification_events enable row level security;
revoke all on table public.workflow_transition_log from anon, authenticated;
revoke all on table public.workflow_notification_events from anon, authenticated;

-- Ensure audit helper exists (also from Delegates / SQL Workspace)
create table if not exists public.admin_audit_log (
  id bigserial primary key,
  actor_type text not null default 'admin',
  actor_ref text,
  action_key text not null,
  entity_type text not null,
  entity_id text,
  branch_key text,
  payload jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.admin_audit_write_v1(
  p_actor_type text,
  p_actor_ref text,
  p_action_key text,
  p_entity_type text,
  p_entity_id text,
  p_branch_key text,
  p_payload jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  insert into public.admin_audit_log (
    actor_type, actor_ref, action_key, entity_type, entity_id, branch_key, payload
  ) values (
    coalesce(nullif(trim(p_actor_type), ''), 'admin'),
    nullif(trim(p_actor_ref), ''),
    nullif(trim(p_action_key), ''),
    coalesce(nullif(trim(p_entity_type), ''), 'unknown'),
    nullif(trim(p_entity_id), ''),
    nullif(trim(p_branch_key), ''),
    p_payload
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3) Pure helpers (states · transitions · legacy bridge · deep link)
-- -----------------------------------------------------------------------------
create or replace function public.workflow_is_valid_state_v1(p_state text)
returns boolean
language sql
immutable
as $$
  select nullif(btrim(coalesce(p_state, '')), '') in (
    'submitted', 'assigned', 'in_review', 'needs_changes',
    'approved', 'applied', 'done', 'rejected'
  );
$$;

create or replace function public.workflow_transition_allowed_v1(
  p_from text,
  p_to text
)
returns boolean
language sql
immutable
as $$
  select case
    when p_from is null and p_to = 'submitted' then true
    when p_from = 'submitted' and p_to = 'assigned' then true
    when p_from = 'assigned' and p_to = 'in_review' then true
    when p_from = 'in_review' and p_to = 'needs_changes' then true
    when p_from = 'needs_changes' and p_to = 'in_review' then true
    when p_from = 'in_review' and p_to = 'approved' then true
    when p_from = 'approved' and p_to = 'applied' then true
    when p_from = 'applied' and p_to = 'done' then true
    when p_from = 'in_review' and p_to = 'rejected' then true
    else false
  end;
$$;

-- Map workflow state → legacy approval_requests.status (compat bridge)
create or replace function public.workflow_legacy_status_for_state_v1(p_state text)
returns text
language sql
immutable
as $$
  select case nullif(btrim(coalesce(p_state, '')), '')
    when 'submitted' then 'pending'
    when 'assigned' then 'pending'
    when 'in_review' then 'pending'
    when 'needs_changes' then 'pending'
    when 'approved' then 'approved'
    when 'applied' then 'approved'
    when 'done' then 'approved'
    when 'rejected' then 'rejected'
    else 'pending'
  end;
$$;

-- Infer initial wf_state from legacy status (backfill)
create or replace function public.workflow_infer_state_from_legacy_v1(p_status text)
returns text
language sql
immutable
as $$
  select case lower(nullif(btrim(coalesce(p_status, '')), ''))
    when 'pending' then 'submitted'
    when 'approved' then 'approved'
    when 'rejected' then 'rejected'
    else 'submitted'
  end;
$$;

create or replace function public.workflow_deep_link_for_v1(p_request_id text)
returns text
language sql
immutable
as $$
  select 'module=requests&request=' ||
    replace(replace(coalesce(nullif(btrim(p_request_id), ''), ''), '#', ''), '&', '');
$$;

create or replace function public.workflow_notify_on_transition_v1(
  p_from text,
  p_to text
)
returns boolean
language sql
immutable
as $$
  select case
    when p_from = 'submitted' and p_to = 'assigned' then true
    when p_from = 'in_review' and p_to = 'needs_changes' then true
    when p_from = 'needs_changes' and p_to = 'in_review' then true
    when p_from = 'in_review' and p_to = 'approved' then true
    when p_from = 'approved' and p_to = 'applied' then true
    when p_from = 'in_review' and p_to = 'rejected' then true
    else false
  end;
$$;

create or replace function public.workflow_recipient_hint_v1(
  p_from text,
  p_to text
)
returns text
language sql
immutable
as $$
  select case
    when p_from = 'submitted' and p_to = 'assigned' then 'delegate_owner'
    when p_from = 'in_review' and p_to = 'needs_changes' then 'submitter'
    when p_from = 'needs_changes' and p_to = 'in_review' then 'delegate_owner'
    when p_from = 'in_review' and p_to = 'approved' then 'submitter'
    when p_from = 'approved' and p_to = 'applied' then 'submitter'
    when p_from = 'in_review' and p_to = 'rejected' then 'submitter'
    else null
  end;
$$;

-- Resolve row by public request_id OR numeric pk (deep-link friendly)
create or replace function public.workflow_resolve_request_pk_v1(p_ref text)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ref text := nullif(btrim(coalesce(p_ref, '')), '');
  v_pk bigint;
begin
  if v_ref is null then
    return null;
  end if;

  select r.id into v_pk
  from public.approval_requests r
  where r.request_id = v_ref
  order by r.created_at desc nulls last, r.id desc
  limit 1;

  if v_pk is not null then
    return v_pk;
  end if;

  if v_ref ~ '^\d+$' then
    select r.id into v_pk
    from public.approval_requests r
    where r.id = v_ref::bigint
    limit 1;
    return v_pk;
  end if;

  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4) Internal: write transition + optional notification + audit
-- -----------------------------------------------------------------------------
create or replace function public.workflow_log_transition_v1(
  p_request_pk bigint,
  p_request_id text,
  p_from text,
  p_to text,
  p_actor_type text,
  p_actor_ref text,
  p_reason text,
  p_ok boolean,
  p_fail_code text,
  p_payload jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tid bigint;
  v_event_key text;
begin
  insert into public.workflow_transition_log (
    request_pk, request_id, from_state, to_state,
    actor_type, actor_ref, reason, ok, fail_code, payload
  ) values (
    p_request_pk,
    coalesce(nullif(btrim(p_request_id), ''), 'unknown'),
    p_from,
    p_to,
    coalesce(nullif(btrim(p_actor_type), ''), 'system'),
    nullif(btrim(p_actor_ref), ''),
    nullif(btrim(p_reason), ''),
    coalesce(p_ok, false),
    nullif(btrim(p_fail_code), ''),
    p_payload
  )
  returning id into v_tid;

  if coalesce(p_ok, false)
     and public.workflow_notify_on_transition_v1(p_from, p_to) then
    v_event_key := coalesce(p_from, 'null') || '->' || coalesce(p_to, 'null');
    insert into public.workflow_notification_events (
      request_id, transition_id, event_key, recipient_hint, channel, payload
    ) values (
      coalesce(nullif(btrim(p_request_id), ''), 'unknown'),
      v_tid,
      v_event_key,
      public.workflow_recipient_hint_v1(p_from, p_to),
      'log',
      jsonb_build_object(
        'from', p_from,
        'to', p_to,
        'v', 1
      )
    );
  end if;

  perform public.admin_audit_write_v1(
    coalesce(nullif(btrim(p_actor_type), ''), 'system'),
    nullif(btrim(p_actor_ref), ''),
    case when coalesce(p_ok, false) then 'workflow.transition' else 'workflow.transition_denied' end,
    'approval_request',
    coalesce(nullif(btrim(p_request_id), ''), p_request_pk::text),
    null,
    jsonb_build_object(
      'from', p_from,
      'to', p_to,
      'ok', coalesce(p_ok, false),
      'fail_code', p_fail_code,
      'reason', p_reason,
      'transition_id', v_tid,
      'extra', p_payload
    )
  );

  return v_tid;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5) Admin RPCs
-- -----------------------------------------------------------------------------
create or replace function public.admin_workflow_get_v1(
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
  v_transitions jsonb;
  v_notifs jsonb;
  v_state text;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  v_pk := public.workflow_resolve_request_pk_v1(p_request_ref);
  if v_pk is null then
    return jsonb_build_object('ok', false, 'code', 'WF-001', 'reason', 'request_not_found');
  end if;

  select * into v_row from public.approval_requests where id = v_pk;
  v_state := coalesce(
    nullif(btrim(v_row.wf_state), ''),
    public.workflow_infer_state_from_legacy_v1(v_row.status)
  );

  select coalesce(jsonb_agg(x.obj order by x.id desc), '[]'::jsonb)
    into v_transitions
  from (
    select t.id,
      jsonb_build_object(
        'id', t.id,
        'from_state', t.from_state,
        'to_state', t.to_state,
        'actor_type', t.actor_type,
        'actor_ref', t.actor_ref,
        'reason', t.reason,
        'ok', t.ok,
        'fail_code', t.fail_code,
        'created_at', t.created_at
      ) as obj
    from public.workflow_transition_log t
    where t.request_id = v_row.request_id
       or t.request_pk = v_pk
    order by t.id desc
    limit 40
  ) x;

  select coalesce(jsonb_agg(n.obj order by n.id desc), '[]'::jsonb)
    into v_notifs
  from (
    select e.id,
      jsonb_build_object(
        'id', e.id,
        'event_key', e.event_key,
        'recipient_hint', e.recipient_hint,
        'channel', e.channel,
        'created_at', e.created_at
      ) as obj
    from public.workflow_notification_events e
    where e.request_id = v_row.request_id
    order by e.id desc
    limit 20
  ) n;

  return jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'request_id', v_row.request_id,
    'kind', v_row.kind,
    'request_type', coalesce(nullif(btrim(v_row.request_type), ''), v_row.kind),
    'branch_key', v_row.branch_key,
    'legacy_status', v_row.status,
    'wf_state', v_state,
    'wf_owner_delegate_id', v_row.wf_owner_delegate_id,
    'wf_deep_link', coalesce(
      nullif(btrim(v_row.wf_deep_link), ''),
      public.workflow_deep_link_for_v1(v_row.request_id)
    ),
    'wf_updated_at', v_row.wf_updated_at,
    'name', v_row.name,
    'transitions', v_transitions,
    'notifications', v_notifs
  );
end;
$$;

create or replace function public.admin_workflow_transition_v1(
  p_token text,
  p_request_ref text,
  p_to_state text,
  p_reason text default null,
  p_owner_delegate_id uuid default null
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
  v_to text := nullif(btrim(coalesce(p_to_state, '')), '');
  v_tid bigint;
  v_need_reason boolean;
  v_deep text;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  if not public.workflow_is_valid_state_v1(v_to) then
    return jsonb_build_object('ok', false, 'code', 'WF-002', 'reason', 'invalid_state');
  end if;

  v_pk := public.workflow_resolve_request_pk_v1(p_request_ref);
  if v_pk is null then
    return jsonb_build_object('ok', false, 'code', 'WF-001', 'reason', 'request_not_found');
  end if;

  select * into v_row from public.approval_requests where id = v_pk for update;

  v_from := coalesce(
    nullif(btrim(v_row.wf_state), ''),
    public.workflow_infer_state_from_legacy_v1(v_row.status)
  );

  if not public.workflow_transition_allowed_v1(v_from, v_to) then
    v_tid := public.workflow_log_transition_v1(
      v_pk, v_row.request_id, v_from, v_to,
      'admin', 'admin_token', p_reason, false, 'WF-003',
      jsonb_build_object('note', 'transition_not_allowed')
    );
    return jsonb_build_object(
      'ok', false,
      'code', 'WF-003',
      'reason', 'transition_not_allowed',
      'from', v_from,
      'to', v_to,
      'transition_id', v_tid
    );
  end if;

  v_need_reason := (v_to in ('needs_changes', 'rejected'));
  if v_need_reason and nullif(btrim(coalesce(p_reason, '')), '') is null then
    v_tid := public.workflow_log_transition_v1(
      v_pk, v_row.request_id, v_from, v_to,
      'admin', 'admin_token', null, false, 'WF-004',
      jsonb_build_object('note', 'reason_required')
    );
    return jsonb_build_object(
      'ok', false,
      'code', 'WF-004',
      'reason', 'reason_required',
      'from', v_from,
      'to', v_to,
      'transition_id', v_tid
    );
  end if;

  if v_to = 'assigned' and p_owner_delegate_id is null and v_row.wf_owner_delegate_id is null then
    v_tid := public.workflow_log_transition_v1(
      v_pk, v_row.request_id, v_from, v_to,
      'admin', 'admin_token', p_reason, false, 'WF-005',
      jsonb_build_object('note', 'owner_required_for_assign')
    );
    return jsonb_build_object(
      'ok', false,
      'code', 'WF-005',
      'reason', 'owner_required_for_assign',
      'from', v_from,
      'to', v_to,
      'transition_id', v_tid
    );
  end if;

  v_deep := public.workflow_deep_link_for_v1(v_row.request_id);

  update public.approval_requests
  set
    wf_state = v_to,
    wf_owner_delegate_id = case
      when p_owner_delegate_id is not null then p_owner_delegate_id
      else wf_owner_delegate_id
    end,
    wf_deep_link = coalesce(nullif(btrim(wf_deep_link), ''), v_deep),
    wf_updated_at = now(),
    request_type = coalesce(nullif(btrim(request_type), ''), kind),
    status = public.workflow_legacy_status_for_state_v1(v_to)
  where id = v_pk;

  v_tid := public.workflow_log_transition_v1(
    v_pk, v_row.request_id, v_from, v_to,
    'admin', 'admin_token', p_reason, true, null,
    jsonb_build_object(
      'owner_delegate_id', coalesce(p_owner_delegate_id, v_row.wf_owner_delegate_id),
      'deep_link', v_deep
    )
  );

  return jsonb_build_object(
    'ok', true,
    'request_id', v_row.request_id,
    'from', v_from,
    'to', v_to,
    'legacy_status', public.workflow_legacy_status_for_state_v1(v_to),
    'wf_deep_link', v_deep,
    'transition_id', v_tid
  );
end;
$$;

-- Assign by branch: pick an enabled delegates_v2 row for the request branch
create or replace function public.admin_workflow_assign_v1(
  p_token text,
  p_request_ref text,
  p_delegate_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pk bigint;
  v_row public.approval_requests%rowtype;
  v_delegate_id uuid := p_delegate_id;
  v_branch text;
  v_exists boolean;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  v_pk := public.workflow_resolve_request_pk_v1(p_request_ref);
  if v_pk is null then
    return jsonb_build_object('ok', false, 'code', 'WF-001', 'reason', 'request_not_found');
  end if;

  select * into v_row from public.approval_requests where id = v_pk for update;
  v_branch := nullif(btrim(coalesce(v_row.branch_key, '')), '');

  if v_delegate_id is null then
    if to_regclass('public.delegates_v2') is null then
      return jsonb_build_object('ok', false, 'code', 'WF-006', 'reason', 'delegates_v2_missing');
    end if;
    if v_branch is null then
      return jsonb_build_object('ok', false, 'code', 'WF-007', 'reason', 'branch_required');
    end if;

    select d.id into v_delegate_id
    from public.delegates_v2 d
    where d.is_enabled = true
      and regexp_replace(btrim(coalesce(d.branch_key, '')), '\s+', ' ', 'g')
        = regexp_replace(btrim(v_branch), '\s+', ' ', 'g')
    order by d.updated_at desc nulls last, d.created_at desc
    limit 1;

    if v_delegate_id is null then
      return jsonb_build_object('ok', false, 'code', 'WF-008', 'reason', 'no_enabled_delegate_for_branch');
    end if;
  else
    if to_regclass('public.delegates_v2') is not null then
      select exists(
        select 1 from public.delegates_v2 d
        where d.id = v_delegate_id and d.is_enabled = true
      ) into v_exists;
      if not coalesce(v_exists, false) then
        return jsonb_build_object('ok', false, 'code', 'WF-009', 'reason', 'delegate_not_enabled');
      end if;
    end if;
  end if;

  return public.admin_workflow_transition_v1(
    p_token,
    coalesce(v_row.request_id, v_pk::text),
    'assigned',
    null,
    v_delegate_id
  );
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
  where nullif(btrim(coalesce(r.wf_state, '')), '') is null;

  get diagnostics v_n = row_count;

  perform public.admin_audit_write_v1(
    'admin', 'admin_token', 'workflow.backfill', 'approval_request', null, null,
    jsonb_build_object('updated', v_n)
  );

  return jsonb_build_object('ok', true, 'updated', v_n);
end;
$$;

-- List allowed next states for a request (admin UI helper)
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
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  v_pk := public.workflow_resolve_request_pk_v1(p_request_ref);
  if v_pk is null then
    return jsonb_build_object('ok', false, 'code', 'WF-001', 'next', '[]'::jsonb);
  end if;

  select * into v_row from public.approval_requests where id = v_pk;
  v_from := coalesce(
    nullif(btrim(v_row.wf_state), ''),
    public.workflow_infer_state_from_legacy_v1(v_row.status)
  );

  select coalesce(array_agg(s order by s), array[]::text[])
    into v_next
  from unnest(array[
    'submitted', 'assigned', 'in_review', 'needs_changes',
    'approved', 'applied', 'done', 'rejected'
  ]) as s
  where public.workflow_transition_allowed_v1(v_from, s);

  return jsonb_build_object(
    'ok', true,
    'request_id', v_row.request_id,
    'wf_state', v_from,
    'next', to_jsonb(v_next)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 6) Delegate stub (ready for later workspace — not production path yet)
-- -----------------------------------------------------------------------------
create or replace function public.delegate_workflow_transition_v1(
  p_branch_key text,
  p_phone text,
  p_email text,
  p_secret_hash text,
  p_request_ref text,
  p_to_state text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Stub: Delegate Workspace will call this after ownership + Delegates v2 checks.
  perform public.workflow_log_transition_v1(
    public.workflow_resolve_request_pk_v1(p_request_ref),
    nullif(btrim(coalesce(p_request_ref, '')), ''),
    null,
    nullif(btrim(coalesce(p_to_state, '')), ''),
    'delegate',
    coalesce(nullif(btrim(p_phone), ''), nullif(btrim(p_email), ''), 'delegate'),
    p_reason,
    false,
    'WF-DELEGATE-NOT-READY',
    jsonb_build_object(
      'branch_key', p_branch_key,
      'note', 'delegate transition stub — use admin_workflow_transition_v1 in v1'
    )
  );

  return jsonb_build_object(
    'ok', false,
    'code', 'WF-DELEGATE-NOT-READY',
    'reason', 'delegate_workflow_stub'
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke all on function public.workflow_resolve_request_pk_v1(text) from public;
revoke all on function public.workflow_log_transition_v1(bigint, text, text, text, text, text, text, boolean, text, jsonb) from public;
revoke all on function public.admin_workflow_get_v1(text, text) from public;
revoke all on function public.admin_workflow_transition_v1(text, text, text, text, uuid) from public;
revoke all on function public.admin_workflow_assign_v1(text, text, uuid) from public;
revoke all on function public.admin_workflow_backfill_v1(text) from public;
revoke all on function public.admin_workflow_next_states_v1(text, text) from public;
revoke all on function public.delegate_workflow_transition_v1(text, text, text, text, text, text, text) from public;

grant execute on function public.workflow_is_valid_state_v1(text) to anon, authenticated;
grant execute on function public.workflow_transition_allowed_v1(text, text) to anon, authenticated;
grant execute on function public.workflow_legacy_status_for_state_v1(text) to anon, authenticated;
grant execute on function public.workflow_infer_state_from_legacy_v1(text) to anon, authenticated;
grant execute on function public.workflow_deep_link_for_v1(text) to anon, authenticated;

grant execute on function public.admin_workflow_get_v1(text, text) to anon, authenticated;
grant execute on function public.admin_workflow_transition_v1(text, text, text, text, uuid) to anon, authenticated;
grant execute on function public.admin_workflow_assign_v1(text, text, uuid) to anon, authenticated;
grant execute on function public.admin_workflow_backfill_v1(text) to anon, authenticated;
grant execute on function public.admin_workflow_next_states_v1(text, text) to anon, authenticated;
grant execute on function public.delegate_workflow_transition_v1(text, text, text, text, text, text, text) to anon, authenticated;

comment on function public.admin_workflow_transition_v1(text, text, text, text, uuid) is
  'Workflow Engine v1: admin-token gated state transition with audit + notification log';
comment on function public.delegate_workflow_transition_v1(text, text, text, text, text, text, text) is
  'Stub for Delegate Workspace — returns WF-DELEGATE-NOT-READY until wired';
