-- COPY-ME: Delegate branch inbox v2b — auth mirrors login (check_*_delegate_access)
-- Preset id: maint.delegate_list_branch_requests_v2b
-- Fixes: auth=false while portal login succeeds (phone/email find mismatch).
-- Safe to re-run.

-- Backfill empty delegates_v2.name from approved delegate requests (same branch+phone).
update public.delegates_v2 d
set
  name = s.req_name,
  updated_at = now()
from (
  select
    public.delegates_v2_norm_branch(r.branch_key) as bkey,
    public.delegates_v2_norm_phone(r.phone) as pkey,
    nullif(btrim(coalesce(r.name, '')), '') as req_name
  from public.approval_requests r
  where r.kind in ('tree_delegate', 'events_delegate')
    and r.status = 'approved'
    and nullif(btrim(coalesce(r.name, '')), '') is not null
) s
where public.delegates_v2_norm_branch(d.branch_key) = s.bkey
  and public.delegates_v2_norm_phone(d.phone) = s.pkey
  and nullif(btrim(coalesce(d.name, '')), '') is null
  and s.req_name is not null;

create or replace function public.delegate_list_branch_requests_v2(
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
  v_branch text := public.delegates_v2_norm_branch(p_branch_key);
  v_hash text := nullif(btrim(coalesce(p_secret_hash, '')), '');
  v_email text := public.delegates_v2_norm_email(p_email);
  v_phone_raw text := nullif(btrim(coalesce(p_phone, '')), '');
  v_digits text := public.delegates_v2_norm_phone(p_phone);
  v_auth boolean := false;
  v_name text := null;
  v_rows jsonb := '[]'::jsonb;
  v_count int := 0;
  v_try_phone text;
  v_check jsonb;
  v_del public.delegates_v2%rowtype;
  v_phones text[];
  i int;
begin
  if v_branch is null or v_branch = '' or v_hash is null then
    return jsonb_build_object(
      'ok', true, 'auth', false, 'count', 0, 'delegate_name', null, 'rows', '[]'::jsonb,
      'reason', 'missing_credentials'
    );
  end if;

  -- Same phone variants the portal login tries (E.164 / local / 966).
  v_phones := array[]::text[];
  if v_phone_raw is not null then
    v_phones := array_append(v_phones, v_phone_raw);
  end if;
  if v_digits is not null and v_digits <> '' then
    v_phones := array_append(v_phones, v_digits);
    if length(v_digits) = 9 and left(v_digits, 1) = '5' then
      v_phones := v_phones || array['0' || v_digits, '966' || v_digits, '+966' || v_digits];
    elsif length(v_digits) = 10 and left(v_digits, 2) = '05' then
      v_phones := v_phones || array[substr(v_digits, 2), '966' || substr(v_digits, 2), '+966' || substr(v_digits, 2)];
    elsif length(v_digits) = 12 and left(v_digits, 3) = '966' then
      v_phones := v_phones || array['0' || substr(v_digits, 4), substr(v_digits, 4), '+' || v_digits];
    elsif length(v_digits) = 13 and left(v_digits, 4) = '9665' then
      v_phones := v_phones || array['0' || substr(v_digits, 4), substr(v_digits, 4)];
    end if;
  end if;

  -- Dedupe while preserving order
  select coalesce(array_agg(x order by ord), array[]::text[])
    into v_phones
  from (
    select x, min(ord) as ord
    from unnest(v_phones) with ordinality as u(x, ord)
    where nullif(btrim(x), '') is not null
    group by x
  ) s;

  for i in 1 .. coalesce(array_length(v_phones, 1), 0) loop
    v_try_phone := v_phones[i];

    -- Mirror portal login: check_tree_delegate_access / check_events_delegate_access
    begin
      v_check := public.check_tree_delegate_access(
        p_branch_key, v_try_phone, coalesce(p_email, ''), v_hash
      );
      if coalesce((v_check->>'allowed')::boolean, false) is true then
        v_auth := true;
        exit;
      end if;
    exception when others then
      null;
    end;

    begin
      v_check := public.check_events_delegate_access(
        p_branch_key, v_try_phone, coalesce(p_email, ''), v_hash
      );
      if coalesce((v_check->>'allowed')::boolean, false) is true then
        v_auth := true;
        exit;
      end if;
    exception when others then
      null;
    end;

    -- Soft find (ignore email mismatch): phone+branch+hash
    begin
      select d.*
        into v_del
      from public.delegates_v2 d
      where public.delegates_v2_norm_branch(d.branch_key) = v_branch
        and public.delegates_v2_norm_phone(d.phone) = public.delegates_v2_norm_phone(v_try_phone)
        and nullif(btrim(coalesce(d.secret_hash, '')), '') is not null
        and d.secret_hash = v_hash
        and coalesce(d.is_enabled, false) is true
      order by d.updated_at desc nulls last
      limit 1;
      if found then
        v_auth := true;
        v_name := nullif(btrim(coalesce(v_del.name, '')), '');
        exit;
      end if;
    exception when others then
      null;
    end;
  end loop;

  if not v_auth then
    return jsonb_build_object(
      'ok', true, 'auth', false, 'count', 0, 'delegate_name', null, 'rows', '[]'::jsonb,
      'reason', 'not_allowed',
      'hint', 'login_ok_but_list_auth_failed_try_relogin'
    );
  end if;

  -- Resolve display name aggressively (secret → phone → branch request).
  if v_name is null then
    begin
      select nullif(btrim(coalesce(d.name, '')), '')
        into v_name
      from public.delegates_v2 d
      where public.delegates_v2_norm_branch(d.branch_key) = v_branch
        and d.secret_hash = v_hash
        and coalesce(d.is_enabled, false) is true
      order by d.updated_at desc nulls last
      limit 1;
    exception when others then
      v_name := null;
    end;
  end if;

  if v_name is null then
    begin
      select nullif(btrim(coalesce(d.name, '')), '')
        into v_name
      from public.delegates_v2 d
      where public.delegates_v2_norm_branch(d.branch_key) = v_branch
        and public.delegates_v2_norm_phone(d.phone) = any (
          select public.delegates_v2_norm_phone(x) from unnest(v_phones) as x
        )
        and coalesce(d.is_enabled, false) is true
      order by d.updated_at desc nulls last
      limit 1;
    exception when others then
      v_name := null;
    end;
  end if;

  if v_name is null then
    begin
      select nullif(btrim(coalesce(r.name, '')), '')
        into v_name
      from public.approval_requests r
      where r.kind in ('tree_delegate', 'events_delegate')
        and r.status = 'approved'
        and public.delegates_v2_norm_branch(r.branch_key) = v_branch
        and (
          v_digits = ''
          or public.delegates_v2_norm_phone(r.phone) = v_digits
          or public.delegates_v2_norm_phone(r.phone) = any (
            select public.delegates_v2_norm_phone(x) from unnest(v_phones) as x
          )
        )
      order by r.created_at desc nulls last
      limit 1;
    exception when others then
      v_name := null;
    end;
  end if;

  -- Last resort: latest approved delegate request for this branch (any phone).
  if v_name is null then
    begin
      select nullif(btrim(coalesce(r.name, '')), '')
        into v_name
      from public.approval_requests r
      where r.kind in ('tree_delegate', 'events_delegate')
        and r.status = 'approved'
        and public.delegates_v2_norm_branch(r.branch_key) = v_branch
        and nullif(btrim(coalesce(r.name, '')), '') is not null
      order by r.created_at desc nulls last
      limit 1;
    exception when others then
      v_name := null;
    end;
  end if;

  -- Persist name onto delegates_v2 when missing so next login shows it.
  if v_name is not null then
    begin
      update public.delegates_v2 d
      set name = v_name, updated_at = now()
      where public.delegates_v2_norm_branch(d.branch_key) = v_branch
        and d.secret_hash = v_hash
        and coalesce(d.is_enabled, false) is true
        and nullif(btrim(coalesce(d.name, '')), '') is null;
    exception when others then
      null;
    end;
  end if;

  select coalesce(jsonb_agg(row_payload order by sort_status, created_at desc), '[]'::jsonb)
    into v_rows
  from (
    select
      to_jsonb(r) as row_payload,
      case lower(coalesce(r.status, ''))
        when 'pending' then 0
        when 'approved' then 1
        when 'rejected' then 2
        else 3
      end as sort_status,
      r.created_at
    from public.approval_requests r
    where r.status in ('pending', 'approved', 'rejected')
      and r.kind in (
        'event_card', 'family_event', 'event_request',
        'tree_card', 'tree_edit', 'memory_card'
      )
      and public.delegates_v2_norm_branch(r.branch_key) = v_branch
    order by sort_status, r.created_at desc
    limit 200
  ) q;

  v_count := coalesce(jsonb_array_length(v_rows), 0);

  return jsonb_build_object(
    'ok', true,
    'auth', true,
    'count', v_count,
    'delegate_name', v_name,
    'rows', coalesce(v_rows, '[]'::jsonb),
    'branch', v_branch
  );
end;
$$;

revoke all on function public.delegate_list_branch_requests_v2(text, text, text, text) from public;
grant execute on function public.delegate_list_branch_requests_v2(text, text, text, text) to anon, authenticated;

-- Keep legacy name in sync
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
  v_wrap jsonb;
begin
  v_wrap := public.delegate_list_branch_requests_v2(
    p_branch_key, p_phone, p_email, p_secret_hash
  );
  return coalesce(v_wrap->'rows', '[]'::jsonb);
end;
$$;

grant execute on function public.delegate_list_event_requests_v1(text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';

select
  (select to_regprocedure('public.delegate_list_branch_requests_v2(text,text,text,text)') is not null)
    as has_list_v2,
  (select pg_get_functiondef('public.delegate_list_branch_requests_v2(text,text,text,text)'::regprocedure)
     like '%check_tree_delegate_access%') as auth_mirrors_login;
