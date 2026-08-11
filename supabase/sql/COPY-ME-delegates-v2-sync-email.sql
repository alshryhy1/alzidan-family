-- =============================================================================
-- COPY-ME: sync email onto delegates_v2 on approve/update (optional)
-- email column already exists — no ADD COLUMN needed.
-- Safe to re-run. Enables private branch-delegate email notify.
-- Also honors dual-intent message (tree+events) → full_delegate when no sibling row.
-- =============================================================================

create or replace function public.delegates_v2_activate_from_request_pk_v1(
  p_request_pk bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.approval_requests%rowtype;
  v_tree public.approval_requests%rowtype;
  v_events public.approval_requests%rowtype;
  v_branch text;
  v_phone text;
  v_email text;
  v_id uuid;
  v_role text;
  v_enabled boolean;
  v_hash text;
  v_name text;
  v_email_store text;
  v_msg_json jsonb;
  v_roles jsonb;
  v_tree_status text;
  v_events_status text;
  v_tree_rid text;
  v_events_rid text;
  v_dual_from_message boolean := false;
  v_marker int;
  v_json_text text;
begin
  if to_regclass('public.delegates_v2') is null then
    return jsonb_build_object('ok', false, 'reason', 'no_v2_schema');
  end if;

  if p_request_pk is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;

  select * into v_req
  from public.approval_requests
  where id = p_request_pk
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_req.kind is null
     or v_req.kind not in ('tree_delegate', 'events_delegate') then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'not_delegate_kind');
  end if;

  v_branch := public.delegates_v2_norm_branch(v_req.branch_key);
  v_phone := public.delegates_v2_norm_phone(v_req.phone);
  v_email := public.delegates_v2_norm_email(v_req.email);

  if v_branch = '' or v_phone = '' then
    return jsonb_build_object('ok', false, 'reason', 'missing_identity');
  end if;

  -- Latest tree + events rows for same identity (role inference)
  select * into v_tree
  from public.approval_requests r
  where r.kind = 'tree_delegate'
    and public.delegates_v2_norm_branch(r.branch_key) = v_branch
    and public.delegates_v2_norm_phone(r.phone) = v_phone
    and (
      v_email = ''
      or public.delegates_v2_norm_email(r.email) = ''
      or public.delegates_v2_norm_email(r.email) = v_email
    )
  order by r.created_at desc nulls last
  limit 1;

  select * into v_events
  from public.approval_requests r
  where r.kind = 'events_delegate'
    and public.delegates_v2_norm_branch(r.branch_key) = v_branch
    and public.delegates_v2_norm_phone(r.phone) = v_phone
    and (
      v_email = ''
      or public.delegates_v2_norm_email(r.email) = ''
      or public.delegates_v2_norm_email(r.email) = v_email
    )
  order by r.created_at desc nulls last
  limit 1;

  v_tree_status := coalesce(v_tree.status, '');
  v_events_status := coalesce(v_events.status, '');
  v_tree_rid := nullif(btrim(coalesce(v_tree.request_id, '')), '');
  v_events_rid := nullif(btrim(coalesce(v_events.request_id, '')), '');

  -- Dual-intent fallback: one approved row whose message lists both roles,
  -- and the missing kind has no sibling approval_requests row.
  v_msg_json := null;
  v_roles := null;
  begin
    v_marker := position('__JSON__:' in coalesce(v_req.message, ''));
    if v_marker > 0 then
      v_json_text := btrim(substring(v_req.message from v_marker + length('__JSON__:')));
      if v_json_text <> '' then
        v_msg_json := v_json_text::jsonb;
      end if;
    end if;
  exception when others then
    v_msg_json := null;
  end;

  if coalesce(v_req.status, '') = 'approved' and v_msg_json is not null then
    v_roles := coalesce(v_msg_json->'delegate_roles', '[]'::jsonb);
    if jsonb_typeof(v_roles) = 'array'
       and v_roles @> '["tree_delegate"]'::jsonb
       and v_roles @> '["events_delegate"]'::jsonb then
      v_dual_from_message := true;
      if v_tree_rid is null then
        v_tree_status := 'approved';
        v_tree_rid := nullif(btrim(coalesce(v_req.request_id, '')), '');
      elsif v_tree_status <> 'approved' and v_req.kind = 'tree_delegate' then
        v_tree_status := 'approved';
        v_tree_rid := nullif(btrim(coalesce(v_req.request_id, '')), '');
      end if;
      if v_events_rid is null then
        v_events_status := 'approved';
        v_events_rid := nullif(btrim(coalesce(v_req.request_id, '')), '');
      elsif v_events_status <> 'approved' and v_req.kind = 'events_delegate' then
        v_events_status := 'approved';
        v_events_rid := nullif(btrim(coalesce(v_req.request_id, '')), '');
      end if;
    end if;
  end if;

  v_role := public.delegates_v2_infer_role(v_tree_status, v_events_status);
  v_enabled := (
    v_tree_status = 'approved'
    or v_events_status = 'approved'
  );
  v_hash := nullif(btrim(coalesce(
    case
      when v_req.kind = 'tree_delegate' then v_req.secret_hash
      else coalesce(v_events.secret_hash, v_tree.secret_hash, v_req.secret_hash)
    end,
    ''
  )), '');
  if v_hash is null then
    v_hash := nullif(btrim(coalesce(v_tree.secret_hash, v_events.secret_hash, '')), '');
  end if;
  v_name := nullif(btrim(coalesce(v_req.name, v_tree.name, v_events.name, '')), '');
  v_email_store := nullif(lower(btrim(coalesce(
    nullif(btrim(coalesce(v_req.email, '')), ''),
    nullif(btrim(coalesce(v_tree.email, '')), ''),
    nullif(btrim(coalesce(v_events.email, '')), ''),
    ''
  ))), '');

  select d.id into v_id
  from public.delegates_v2 d
  where public.delegates_v2_norm_branch(d.branch_key) = v_branch
    and public.delegates_v2_norm_phone(d.phone) = v_phone
    and (
      v_email = ''
      or public.delegates_v2_norm_email(d.email) = ''
      or public.delegates_v2_norm_email(d.email) = v_email
    )
  order by d.updated_at desc nulls last, d.created_at desc nulls last
  limit 1;

  if v_id is null then
    insert into public.delegates_v2 (
      branch_key, name, phone, email, secret_hash, role_key, is_enabled,
      tree_request_id, events_request_id, updated_at
    ) values (
      nullif(btrim(v_req.branch_key), ''),
      v_name,
      nullif(btrim(v_req.phone), ''),
      v_email_store,
      v_hash,
      v_role,
      v_enabled,
      v_tree_rid,
      v_events_rid,
      now()
    )
    returning id into v_id;
  else
    update public.delegates_v2 d
    set
      name = coalesce(v_name, d.name),
      email = coalesce(v_email_store, d.email),
      secret_hash = coalesce(v_hash, d.secret_hash),
      role_key = v_role,
      is_enabled = v_enabled,
      tree_request_id = coalesce(v_tree_rid, d.tree_request_id),
      events_request_id = coalesce(v_events_rid, d.events_request_id),
      updated_at = now()
    where d.id = v_id;
  end if;

  perform public.admin_audit_write_v1(
    'system',
    'approve_activate',
    'delegate.activate_from_request',
    'delegates_v2',
    v_id::text,
    nullif(btrim(v_req.branch_key), ''),
    jsonb_build_object(
      'request_pk', p_request_pk,
      'request_id', v_req.request_id,
      'kind', v_req.kind,
      'status', v_req.status,
      'role_key', v_role,
      'is_enabled', v_enabled,
      'email', v_email_store,
      'dual_from_message', v_dual_from_message,
      'at', now()
    )
  );

  return jsonb_build_object(
    'ok', true,
    'delegate_id', v_id,
    'role_key', v_role,
    'is_enabled', v_enabled,
    'has_secret', v_hash is not null,
    'dual_from_message', v_dual_from_message,
    'tree_request_id', v_tree_rid,
    'events_request_id', v_events_rid
  );
end;
$$;

create or replace function public.delegates_v2_approval_requests_sync_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if to_regclass('public.delegates_v2') is null then
    return new;
  end if;

  if new.kind is null
     or new.kind not in ('tree_delegate', 'events_delegate') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status in ('approved', 'rejected') then
      perform public.delegates_v2_activate_from_request_pk_v1(new.id);
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.status is distinct from old.status
       and new.status in ('approved', 'rejected') then
      perform public.delegates_v2_activate_from_request_pk_v1(new.id);
    elsif new.status = 'approved'
      and (
        new.secret_hash is distinct from old.secret_hash
        or new.phone is distinct from old.phone
        or new.branch_key is distinct from old.branch_key
        or new.email is distinct from old.email
      ) then
      perform public.delegates_v2_activate_from_request_pk_v1(new.id);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_delegates_v2_approval_requests_sync
  on public.approval_requests;

create trigger trg_delegates_v2_approval_requests_sync
after insert or update of status, secret_hash, phone, branch_key, email
on public.approval_requests
for each row
execute function public.delegates_v2_approval_requests_sync_trg();
