-- COPY-ME: run in Supabase SQL Editor / SQL Workspace
-- Preset id: maint.delegate_set_status_tree_inbox_v1
--
-- Fixes: «تعذر رفض الطلب» for tree_edit / tree_card / memory while the same
-- requests appear in «طلبات فرعي».
--
-- Root cause: list uses tree/events can_read, but status change required
-- tree_delegate_allowed_v1 (tree.write only). Events-read or tree-read
-- delegates saw buttons but RPC returned false.
--
-- Also aligns branch match with delegates_v2_norm_branch (same as list v2).
-- Safe to re-run.

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

  v_kind := coalesce(v_row.kind, '');

  if p_phone is not null or p_email is not null or p_secret_hash is not null then
    if v_kind in ('event_card', 'family_event', 'event_request') then
      -- Inbox act: write OR read (same people who can list the card).
      v_auth_ok :=
        public.events_delegate_allowed_v1(p_branch_key, p_phone, p_email, p_secret_hash)
        or public.events_delegate_can_read_v1(p_branch_key, p_phone, p_email, p_secret_hash);
    elsif v_kind in ('tree_card', 'tree_edit', 'memory_card') then
      -- Same people who can list the card (tree OR events read), plus tree write.
      -- Tree mutation still requires tree_* write RPCs separately.
      v_auth_ok :=
        public.tree_delegate_allowed_v1(p_branch_key, p_phone, p_email, p_secret_hash)
        or public.tree_delegate_can_read_v1(p_branch_key, p_phone, p_email, p_secret_hash)
        or public.events_delegate_can_read_v1(p_branch_key, p_phone, p_email, p_secret_hash);
    else
      return false;
    end if;

    if not v_auth_ok then
      return false;
    end if;
  end if;

  v_reviewer := null;
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
    'public.delegate_set_approval_request_status_v1(text,bigint,text,text,text,text)'
  ) is not null) as set_status_ready,
  (
    select pg_get_functiondef(
      'public.delegate_set_approval_request_status_v1(text,bigint,text,text,text,text)'::regprocedure
    ) like '%tree_delegate_can_read_v1%'
  ) as inbox_allows_tree_read;
