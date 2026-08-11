-- Operator path: Admin → SQL Workspace → أوامر الصيانة الجاهزة
-- Preset id: maint.delegates_v2_update_email_v1
-- Source of truth file (do not prefer external paste).
-- =============================================================================
-- COPY-ME: delegate self-service update of notify email on delegates_v2
-- Auth: branch + phone + secret_hash (email is NOT a login key).
-- Safe to re-run. Also mirrors email onto approved approval_requests rows
-- so legacy notify fallback stays consistent.
-- =============================================================================

create or replace function public.delegates_v2_update_email_v1(
  p_branch_key text,
  p_phone text,
  p_secret_hash text,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch text;
  v_phone text;
  v_hash text := nullif(btrim(coalesce(p_secret_hash, '')), '');
  v_email text;
  v_row public.delegates_v2%rowtype;
  v_legacy_n integer := 0;
begin
  if to_regclass('public.delegates_v2') is null then
    return jsonb_build_object('ok', false, 'reason', 'no_v2_schema');
  end if;

  v_branch := public.delegates_v2_norm_branch(p_branch_key);
  v_phone := public.delegates_v2_norm_phone(p_phone);
  v_email := public.delegates_v2_norm_email(p_email);

  if v_branch = '' or v_phone = '' or v_hash is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;

  if v_email = ''
     or position('@' in v_email) = 0
     or position('.' in v_email) = 0
     or char_length(v_email) < 6 then
    return jsonb_build_object('ok', false, 'reason', 'bad_email');
  end if;

  -- Match by branch + phone + secret only (current email may be empty/wrong).
  select d.*
  into v_row
  from public.delegates_v2 d
  where public.delegates_v2_norm_branch(d.branch_key) = v_branch
    and public.delegates_v2_norm_phone(d.phone) = v_phone
    and nullif(btrim(coalesce(d.secret_hash, '')), '') is not null
    and d.secret_hash = v_hash
  order by d.updated_at desc nulls last, d.created_at desc nulls last
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if coalesce(v_row.is_enabled, false) is not true then
    return jsonb_build_object('ok', false, 'reason', 'disabled', 'delegate_id', v_row.id);
  end if;

  update public.delegates_v2 d
  set email = v_email,
      updated_at = now()
  where d.id = v_row.id;

  -- Mirror onto approved legacy rows for the same branch+phone identity.
  update public.approval_requests r
  set email = v_email
  where r.kind in ('tree_delegate', 'events_delegate')
    and r.status = 'approved'
    and public.delegates_v2_norm_branch(r.branch_key) = v_branch
    and public.delegates_v2_norm_phone(r.phone) = v_phone;

  get diagnostics v_legacy_n = row_count;

  return jsonb_build_object(
    'ok', true,
    'delegate_id', v_row.id,
    'branch_key', v_branch,
    'phone', v_phone,
    'email', v_email,
    'legacy_updated', v_legacy_n
  );
end;
$$;

revoke all on function public.delegates_v2_update_email_v1(text, text, text, text) from public;
grant execute on function public.delegates_v2_update_email_v1(text, text, text, text) to anon, authenticated;
