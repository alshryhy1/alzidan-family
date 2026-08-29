-- COPY-ME: Preset id: maint.women_manager_members_v1
-- Women manager: search daughters, set phone, activate membership.
-- No admin_token. No tree_children name/parent/branch writes.
-- Safe to re-run.

create or replace function public.women_manager_search_members_v1(
  p_phone text,
  p_query text,
  p_branch_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_session jsonb;
  v_q text;
  v_branch text;
begin
  if to_regprocedure('public.women_manager_session_v1(text)') is null then
    return jsonb_build_object('ok', false, 'error', 'sql_missing', 'rows', '[]'::jsonb);
  end if;

  v_session := public.women_manager_session_v1(p_phone);
  if coalesce((v_session->>'enabled')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'error', 'not_allowed', 'rows', '[]'::jsonb);
  end if;

  v_q := nullif(btrim(coalesce(p_query, '')), '');
  v_branch := nullif(btrim(coalesce(p_branch_key, '')), '');
  if v_q is not null then
    v_q := replace(replace(v_q, '%', ''), '_', '');
  end if;

  if v_q is null or char_length(v_q) < 2 then
    return jsonb_build_object('ok', true, 'need_query', true, 'rows', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'ok', true,
    'rows', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.display_name)
      from (
        select
          c.id,
          c.person_id,
          c.branch_key,
          nullif(
            btrim(regexp_replace(coalesce(c.child_name, to_jsonb(c)->>'name', ''), '^.*/', '')),
            ''
          ) as display_name,
          nullif(btrim(coalesce(c.child_name, to_jsonb(c)->>'name', '')), '') as path,
          mp.phone,
          mp.status
        from public.tree_children c
        left join lateral (
          select p.phone, p.status
          from public.member_profiles p
          where p.tree_child_id = c.id
             or (c.person_id is not null and p.person_id is not distinct from c.person_id)
          order by p.updated_at desc nulls last, p.id desc
          limit 1
        ) mp on true
        where public.member_role_is_daughter_gender_v1(c.gender)
          and (v_branch is null or c.branch_key = v_branch)
          and (
            position(v_q in coalesce(c.child_name, to_jsonb(c)->>'name', '')) > 0
            or coalesce(c.child_name, to_jsonb(c)->>'name', '') ilike '%' || v_q || '%'
          )
        order by c.id desc
        limit 25
      ) r
    ), '[]'::jsonb)
  );
end;
$fn$;

create or replace function public.women_manager_set_member_phone_v1(
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
  v_session jsonb;
  v_child public.tree_children%rowtype;
  v_bind jsonb;
  v_member_phone text;
  v_digits text;
  v_keep_id bigint;
  v_leaf text;
  v_other_pid text;
begin
  if to_regprocedure('public.women_manager_session_v1(text)') is null
     or to_regclass('public.member_profiles') is null then
    return jsonb_build_object('ok', false, 'error', 'sql_missing');
  end if;

  v_session := public.women_manager_session_v1(p_phone);
  if coalesce((v_session->>'enabled')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;

  if p_tree_child_id is null or p_tree_child_id < 1 then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;

  v_member_phone := nullif(btrim(coalesce(p_member_phone, '')), '');
  if v_member_phone is null then
    return jsonb_build_object('ok', false, 'error', 'bad_phone');
  end if;

  select * into v_child from public.tree_children where id = p_tree_child_id limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'person_not_found');
  end if;

  if not public.member_role_is_daughter_gender_v1(v_child.gender) then
    return jsonb_build_object('ok', false, 'error', 'not_daughter');
  end if;

  if to_regprocedure('public.bind_sender_phone_to_person_v1(text, text, bigint)') is not null then
    v_bind := public.bind_sender_phone_to_person_v1(
      v_member_phone,
      coalesce(v_child.person_id::text, ''),
      v_child.id
    );
    if coalesce((v_bind->>'ok')::boolean, false) is not true then
      return jsonb_build_object(
        'ok', false,
        'error', coalesce(v_bind->>'error', 'bind_failed'),
        'detail', v_bind
      );
    end if;
  else
    v_digits := right(regexp_replace(v_member_phone, '[^0-9]', '', 'g'), 9);
    if char_length(coalesce(v_digits, '')) < 9 then
      return jsonb_build_object('ok', false, 'error', 'bad_phone');
    end if;
    v_leaf := nullif(
      btrim(regexp_replace(coalesce(v_child.child_name, to_jsonb(v_child)->>'name', ''), '^.*/', '')),
      ''
    );

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
      return jsonb_build_object('ok', false, 'error', 'phone_conflict', 'other_person_id', v_other_pid);
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
    v_bind := jsonb_build_object('ok', true, 'action', 'upserted');
  end if;

  update public.member_profiles
  set status = 'active', updated_at = now()
  where tree_child_id = v_child.id
     or (v_child.person_id is not null and person_id is not distinct from v_child.person_id);

  begin
    if to_regprocedure('public.admin_audit_write_v1(text,text,text,text,text,text,jsonb)') is not null then
      perform public.admin_audit_write_v1(
        'women_manager',
        v_session->>'tree_child_id',
        'women_manager.member_phone',
        'member_profile',
        v_child.id::text,
        v_child.branch_key,
        jsonb_build_object(
          'tree_child_id', v_child.id,
          'person_id', v_child.person_id
        )
      );
    end if;
  exception when others then
    null;
  end;

  return jsonb_build_object(
    'ok', true,
    'tree_child_id', v_child.id,
    'person_id', v_child.person_id,
    'bind', v_bind
  );
end;
$fn$;

revoke all on function public.women_manager_search_members_v1(text, text, text) from public;
revoke all on function public.women_manager_set_member_phone_v1(text, bigint, text) from public;

grant execute on function public.women_manager_search_members_v1(text, text, text) to anon, authenticated;
grant execute on function public.women_manager_set_member_phone_v1(text, bigint, text) to anon, authenticated;

notify pgrst, 'reload schema';

select
  to_regprocedure('public.women_manager_search_members_v1(text, text, text)') is not null as has_search,
  to_regprocedure('public.women_manager_set_member_phone_v1(text, bigint, text)') is not null as has_set_phone;
