-- =============================================================================
-- COPY-ME: fix admin_delegates_v2_set_enabled_v1 (تفعيل/تعطيل لا يُلغى)
-- Preset id: maint.delegates_v2_set_enabled_fix_v1
-- Safe to re-run. Schema only — no row mutations in this file.
--
-- Root cause:
--   set_enabled updated only the linked request_id, then the approval_requests
--   trigger called delegates_v2_activate_from_request_pk_v1 which picks the
--   LATEST request by created_at. If a newer row stayed rejected, is_enabled
--   was overwritten back to false — «تفعيل» يبدو أنه يرفض.
--
-- Fix:
--   1) Mirror approved/rejected to ALL identity-matching delegate requests
--   2) Re-apply is_enabled AFTER triggers so admin intent always wins
-- =============================================================================

create or replace function public.admin_delegates_v2_set_enabled_v1(
  p_token text,
  p_id uuid,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.delegates_v2%rowtype;
  v_status text;
  v_branch text;
  v_phone text;
  v_email text;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;
  if p_id is null then
    raise exception 'id required';
  end if;

  select * into v_row from public.delegates_v2 where id = p_id for update;
  if not found then
    raise exception 'delegate not found';
  end if;

  v_status := case when coalesce(p_enabled, false) then 'approved' else 'rejected' end;
  v_branch := regexp_replace(btrim(coalesce(v_row.branch_key, '')), '\s+', ' ', 'g');
  v_phone := regexp_replace(btrim(coalesce(v_row.phone, '')), '\s+', '', 'g');
  v_email := lower(regexp_replace(btrim(coalesce(v_row.email, '')), '\s+', '', 'g'));

  -- Linked request ids (when present)
  if nullif(btrim(coalesce(v_row.tree_request_id, '')), '') is not null then
    update public.approval_requests
    set status = v_status
    where request_id = v_row.tree_request_id
      and kind = 'tree_delegate';
  end if;

  if nullif(btrim(coalesce(v_row.events_request_id, '')), '') is not null then
    update public.approval_requests
    set status = v_status
    where request_id = v_row.events_request_id
      and kind = 'events_delegate';
  end if;

  -- ALL identity matches (so a newer rejected sibling cannot undo enable)
  if nullif(v_branch, '') is not null and nullif(v_phone, '') is not null then
    update public.approval_requests r
    set status = v_status
    where r.kind in ('tree_delegate', 'events_delegate')
      and regexp_replace(btrim(coalesce(r.branch_key, '')), '\s+', ' ', 'g') = v_branch
      and regexp_replace(btrim(coalesce(r.phone, '')), '\s+', '', 'g') = v_phone
      and (
        v_email = ''
        or lower(regexp_replace(btrim(coalesce(r.email, '')), '\s+', '', 'g')) = ''
        or lower(regexp_replace(btrim(coalesce(r.email, '')), '\s+', '', 'g')) = v_email
      );
  end if;

  -- Admin intent wins after approval sync triggers
  update public.delegates_v2
  set is_enabled = coalesce(p_enabled, false),
      updated_at = now()
  where id = p_id;

  perform public.admin_audit_write_v1(
    'admin', null,
    case when coalesce(p_enabled, false) then 'delegate.enable' else 'delegate.disable' end,
    'delegates_v2', p_id::text, v_row.branch_key,
    jsonb_build_object(
      'enabled', coalesce(p_enabled, false),
      'role_key', v_row.role_key,
      'phone', v_row.phone,
      'email', v_row.email,
      'at', now()
    )
  );

  return jsonb_build_object(
    'ok', true,
    'id', p_id,
    'is_enabled', coalesce(p_enabled, false)
  );
end;
$$;

grant execute on function public.admin_delegates_v2_set_enabled_v1(text, uuid, boolean)
  to anon, authenticated;
