-- COPY-ME: Preset id: maint.family_admin_bind_accept_v1
-- قبول طلب الجوال في التطبيق: ربط الرقم بالشخص ثم إنهاء الطلب.
-- لا يعتمد على صلاحية استدعاء bind_sender من anon.
-- Safe to re-run.

create or replace function public.family_admin_set_phone_v1(
  p_phone text,
  p_tree_child_id bigint,
  p_member_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_gate jsonb;
  v_child public.tree_children%rowtype;
  v_bind jsonb;
  v_member_phone text;
  v_digits text;
  v_keep_id bigint;
  v_leaf text;
  v_other_pid text;
  v_other_child bigint;
  v_bound boolean := false;
begin
  v_gate := public.family_admin_require_v1(p_phone);
  if coalesce((v_gate->>'ok')::boolean, false) is not true then
    return v_gate;
  end if;
  if p_tree_child_id is null or p_tree_child_id < 1 then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;
  v_member_phone := nullif(btrim(coalesce(p_member_phone, '')), '');
  if v_member_phone is null then
    return jsonb_build_object('ok', false, 'error', 'bad_phone');
  end if;
  if to_regprocedure('public.member_phone_stored_v1(text)') is not null then
    v_member_phone := coalesce(public.member_phone_stored_v1(v_member_phone), v_member_phone);
  end if;
  select * into v_child from public.tree_children where id = p_tree_child_id limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'person_not_found');
  end if;

  v_digits := right(regexp_replace(v_member_phone, '[^0-9]', '', 'g'), 9);
  if char_length(coalesce(v_digits, '')) < 9 then
    return jsonb_build_object('ok', false, 'error', 'bad_phone');
  end if;
  v_leaf := nullif(btrim(regexp_replace(coalesce(v_child.child_name, to_jsonb(v_child)->>'name', ''), '^.*/', '')), '');

  select mp.tree_child_id
    into v_other_child
  from public.member_profiles mp
  where char_length(v_digits) = 9
    and right(regexp_replace(coalesce(mp.phone, ''), '[^0-9]', '', 'g'), 9) = v_digits
    and coalesce(mp.tree_child_id, 0) > 0
  order by mp.id
  limit 1;
  if v_other_child is not null and v_other_child = v_child.id then
    update public.member_profiles
    set status = 'active', updated_at = now()
    where tree_child_id = v_child.id
       or (v_child.person_id is not null and person_id is not distinct from v_child.person_id);
    return jsonb_build_object('ok', true, 'tree_child_id', v_child.id, 'action', 'already_bound');
  end if;

  begin
    if to_regprocedure('public.bind_sender_phone_to_person_v1(text, text, bigint)') is not null then
      v_bind := public.bind_sender_phone_to_person_v1(
        v_member_phone,
        coalesce(v_child.person_id::text, ''),
        v_child.id
      );
      if coalesce((v_bind->>'ok')::boolean, false) then
        v_bound := true;
      elsif coalesce(v_bind->>'error', '') = 'phone_conflict' then
        return jsonb_build_object('ok', false, 'error', 'phone_conflict', 'detail', v_bind);
      end if;
    end if;
  exception when others then
    v_bind := jsonb_build_object('error', SQLERRM);
  end;

  if not v_bound then
    begin
      select nullif(btrim(coalesce(mp.person_id::text, '')), '')
        into v_other_pid
      from public.member_profiles mp
      where char_length(v_digits) = 9
        and right(regexp_replace(coalesce(mp.phone, ''), '[^0-9]', '', 'g'), 9) = v_digits
      order by mp.id
      limit 1;
      if v_other_pid is not null
         and v_child.person_id is not null
         and v_other_pid is distinct from v_child.person_id::text then
        return jsonb_build_object('ok', false, 'error', 'phone_conflict');
      end if;
      select mp.id into v_keep_id
      from public.member_profiles mp
      where mp.tree_child_id = v_child.id
         or (v_child.person_id is not null and mp.person_id is not distinct from v_child.person_id)
         or (
           char_length(v_digits) = 9
           and right(regexp_replace(coalesce(mp.phone, ''), '[^0-9]', '', 'g'), 9) = v_digits
         )
      order by (mp.tree_child_id is not distinct from v_child.id) desc, mp.id desc
      limit 1;
      begin
        if v_keep_id is not null then
          update public.member_profiles
          set
            phone = v_member_phone,
            branch_key = coalesce(nullif(btrim(coalesce(v_child.branch_key, '')), ''), branch_key),
            tree_child_id = v_child.id,
            person_id = v_child.person_id,
            display_name = coalesce(nullif(btrim(coalesce(display_name, '')), ''), v_leaf),
            status = 'active',
            updated_at = now()
          where id = v_keep_id;
        else
          insert into public.member_profiles (
            phone, branch_key, tree_child_id, person_id, display_name, status, created_at, updated_at
          ) values (
            v_member_phone, v_child.branch_key, v_child.id, v_child.person_id, v_leaf, 'active', now(), now()
          );
        end if;
      exception when unique_violation then
        update public.member_profiles
        set
          branch_key = coalesce(nullif(btrim(coalesce(v_child.branch_key, '')), ''), branch_key),
          tree_child_id = v_child.id,
          person_id = v_child.person_id,
          display_name = coalesce(nullif(btrim(coalesce(display_name, '')), ''), v_leaf),
          status = 'active',
          updated_at = now()
        where char_length(v_digits) = 9
          and right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 9) = v_digits;
      end;
      v_bound := true;
    exception when others then
      return jsonb_build_object(
        'ok', false,
        'error', 'bind_failed',
        'detail', SQLERRM
      );
    end;
  end if;

  update public.member_profiles
  set status = 'active', updated_at = now()
  where tree_child_id = v_child.id
     or (v_child.person_id is not null and person_id is not distinct from v_child.person_id);

  return jsonb_build_object('ok', true, 'tree_child_id', v_child.id);
end;
$fn$;

create or replace function public.family_admin_request_bind_v1(
  p_phone text,
  p_request_id bigint,
  p_tree_child_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_gate jsonb;
  v_req public.approval_requests%rowtype;
  v_set jsonb;
begin
  v_gate := public.family_admin_require_v1(p_phone);
  if coalesce((v_gate->>'ok')::boolean, false) is not true then
    return v_gate;
  end if;
  if p_request_id is null or p_request_id < 1 or p_tree_child_id is null or p_tree_child_id < 1 then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;
  select * into v_req from public.approval_requests where id = p_request_id limit 1;
  if not found or coalesce(nullif(btrim(v_req.status), ''), 'pending') is distinct from 'pending' then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if to_regprocedure('public.family_admin_request_is_member_v1(text, text)') is not null
     and not public.family_admin_request_is_member_v1(v_req.kind, v_req.message) then
    return jsonb_build_object('ok', false, 'error', 'wrong_kind');
  end if;
  if nullif(btrim(coalesce(v_req.phone, '')), '') is not null then
    begin
      v_set := public.family_admin_set_phone_v1(p_phone, p_tree_child_id, v_req.phone);
    exception when others then
      return jsonb_build_object('ok', false, 'error', 'bind_failed', 'detail', SQLERRM);
    end;
    if coalesce((v_set->>'ok')::boolean, false) is not true then
      return v_set;
    end if;
  end if;
  update public.approval_requests set status = 'approved' where id = v_req.id;
  return jsonb_build_object('ok', true, 'id', v_req.id, 'tree_child_id', p_tree_child_id);
end;
$fn$;

notify pgrst, 'reload schema';
select
  to_regprocedure('public.family_admin_set_phone_v1(text, bigint, text)') is not null as has_set_phone,
  to_regprocedure('public.family_admin_request_bind_v1(text, bigint, bigint)') is not null as has_bind;
