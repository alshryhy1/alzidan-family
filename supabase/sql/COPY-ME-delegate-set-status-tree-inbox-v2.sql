-- COPY-ME: run in Supabase SQL Editor / SQL Workspace
-- Preset id: maint.delegate_set_status_tree_inbox_v2
--
-- v1 allowed tree/events can_read | write, but those helpers do NOT try
-- phone variants. List/login use check_*_delegate_access + phone variants
-- + soft secret_hash find — so list succeeds while reject/accept still false.
--
-- v2: reuse the SAME actor gate as delegate_list_branch_requests_v2.
-- Safe to re-run.

create or replace function public.delegate_inbox_actor_ok_v1(
  p_branch_key text,
  p_phone text,
  p_email text,
  p_secret_hash text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_branch text := public.delegates_v2_norm_branch(p_branch_key);
  v_hash text := nullif(btrim(coalesce(p_secret_hash, '')), '');
  v_phone_raw text := nullif(btrim(coalesce(p_phone, '')), '');
  v_digits text := public.delegates_v2_norm_phone(p_phone);
  v_phones text[];
  v_try_phone text;
  v_check jsonb;
  i int;
begin
  if v_branch is null or v_branch = '' or v_hash is null then
    return false;
  end if;

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
    elsif length(v_digits) >= 12 and left(v_digits, 3) = '966' then
      v_phones := v_phones || array['0' || substr(v_digits, 4), substr(v_digits, 4), '+' || v_digits];
    end if;
  end if;

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

    begin
      v_check := public.check_tree_delegate_access(
        p_branch_key, v_try_phone, coalesce(p_email, ''), v_hash
      );
      if coalesce((v_check->>'allowed')::boolean, false) is true then
        return true;
      end if;
    exception when others then
      null;
    end;

    begin
      v_check := public.check_events_delegate_access(
        p_branch_key, v_try_phone, coalesce(p_email, ''), v_hash
      );
      if coalesce((v_check->>'allowed')::boolean, false) is true then
        return true;
      end if;
    exception when others then
      null;
    end;

    begin
      if exists (
        select 1
        from public.delegates_v2 d
        where public.delegates_v2_norm_branch(d.branch_key) = v_branch
          and public.delegates_v2_norm_phone(d.phone)
            = public.delegates_v2_norm_phone(v_try_phone)
          and nullif(btrim(coalesce(d.secret_hash, '')), '') is not null
          and d.secret_hash = v_hash
          and coalesce(d.is_enabled, false) is true
      ) then
        return true;
      end if;
    exception when others then
      null;
    end;
  end loop;

  -- Last resort: enabled row for branch+secret only (same session that listed inbox).
  begin
    if exists (
      select 1
      from public.delegates_v2 d
      where public.delegates_v2_norm_branch(d.branch_key) = v_branch
        and d.secret_hash = v_hash
        and coalesce(d.is_enabled, false) is true
    ) then
      return true;
    end if;
  exception when others then
    null;
  end;

  return false;
end;
$$;

revoke all on function public.delegate_inbox_actor_ok_v1(text, text, text, text) from public;
grant execute on function public.delegate_inbox_actor_ok_v1(text, text, text, text) to anon, authenticated;

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
  v_stamp text;
  v_msg text;
  v_reviewer text;
  v_branch text := public.delegates_v2_norm_branch(p_branch_key);
begin
  v_status := case
    when lower(btrim(coalesce(p_status, ''))) = 'approved' then 'approved'
    when lower(btrim(coalesce(p_status, ''))) = 'rejected' then 'rejected'
    else null
  end;
  if v_status is null or p_request_id is null or v_branch is null or v_branch = '' then
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
    and public.delegates_v2_norm_branch(r.branch_key) = v_branch
  limit 1;

  if v_row.id is null then
    return false;
  end if;

  if p_phone is not null or p_email is not null or p_secret_hash is not null then
    if not public.delegate_inbox_actor_ok_v1(
      p_branch_key, p_phone, p_email, p_secret_hash
    ) then
      return false;
    end if;
  end if;

  v_reviewer := null;
  begin
    select nullif(btrim(coalesce(d.name, '')), '')
      into v_reviewer
    from public.delegates_v2 d
    where public.delegates_v2_norm_branch(d.branch_key) = v_branch
      and d.secret_hash = nullif(btrim(coalesce(p_secret_hash, '')), '')
      and coalesce(d.is_enabled, false) is true
    order by d.updated_at desc nulls last
    limit 1;
  exception when others then
    v_reviewer := null;
  end;

  if v_reviewer is null then
    begin
      select nullif(btrim(coalesce(d.name, '')), '')
        into v_reviewer
      from public.delegates_v2 d
      where public.delegates_v2_norm_branch(d.branch_key) = v_branch
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
  end if;

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
  where id = p_request_id
    and status = 'pending';

  return found;
end;
$$;

revoke all on function public.delegate_set_approval_request_status_v1(text, bigint, text, text, text, text) from public;
grant execute on function public.delegate_set_approval_request_status_v1(text, bigint, text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';

select
  (select to_regprocedure(
    'public.delegate_inbox_actor_ok_v1(text,text,text,text)'
  ) is not null) as actor_ok_ready,
  (
    select pg_get_functiondef(
      'public.delegate_set_approval_request_status_v1(text,bigint,text,text,text,text)'::regprocedure
    ) like '%delegate_inbox_actor_ok_v1%'
  ) as set_status_uses_list_auth;
