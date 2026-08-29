-- COPY-ME: Preset id: maint.women_manager_search_match_v1
-- Patch after women_pending_family_v1: find names like نوف even if gender is empty,
-- and match a typed full name to a slash path in the tree.
-- Safe to re-run. No block comments.

create or replace function public.women_manager_search_members_v1(
  p_phone text,
  p_query text,
  p_branch_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_session jsonb;
  v_q text;
  v_q_fold text;
  v_branch text;
  v_tree jsonb := '[]'::jsonb;
  v_pending jsonb := '[]'::jsonb;
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
  v_q_fold := public.women_member_name_fold_v1(v_q);

  begin
  select coalesce(jsonb_agg(to_jsonb(r) order by r.display_name), '[]'::jsonb)
    into v_tree
  from (
    select
      c.id,
      (
        select p.id from public.member_profiles p
        where p.tree_child_id = c.id
           or (c.person_id is not null and p.person_id is not distinct from c.person_id)
        order by p.updated_at desc nulls last, p.id desc
        limit 1
      ) as member_id,
      c.person_id,
      c.branch_key,
      public.women_member_leaf_name_v1(coalesce(c.child_name, to_jsonb(c)->>'name', '')) as display_name,
      nullif(btrim(coalesce(c.child_name, to_jsonb(c)->>'name', '')), '') as path,
      mp.phone,
      mp.status,
      'tree'::text as kind
    from public.tree_children c
    left join lateral (
      select p.phone, p.status
      from public.member_profiles p
      where p.tree_child_id = c.id
         or (c.person_id is not null and p.person_id is not distinct from c.person_id)
      order by p.updated_at desc nulls last, p.id desc
      limit 1
    ) mp on true
    where lower(btrim(coalesce(c.gender, ''))) not in ('son', 'male', 'm', 'ذكر', 'ابن', 'ولد')
      and (v_branch is null or c.branch_key = v_branch)
      and (
        position(v_q in coalesce(c.child_name, to_jsonb(c)->>'name', '')) > 0
        or coalesce(c.child_name, to_jsonb(c)->>'name', '') ilike '%' || v_q || '%'
        or public.women_member_leaf_name_v1(coalesce(c.child_name, to_jsonb(c)->>'name', '')) ilike '%' || v_q || '%'
        or (
          v_q_fold is not null
          and position(
            v_q_fold in coalesce(public.women_member_name_fold_v1(
              public.women_member_leaf_name_v1(coalesce(c.child_name, to_jsonb(c)->>'name', ''))
            ), '')
          ) > 0
        )
      )
    order by c.id desc
    limit 25
  ) r;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.display_name), '[]'::jsonb)
    into v_pending
  from (
    select
      0::bigint as id,
      mp.id as member_id,
      mp.person_id,
      mp.branch_key,
      mp.display_name,
      null::text as path,
      mp.phone,
      mp.status,
      'pending'::text as kind
    from public.member_profiles mp
    where coalesce(mp.tree_child_id, 0) = 0
      and coalesce(nullif(btrim(coalesce(mp.status, '')), ''), '') = 'pending_family'
      and (
        position(v_q in coalesce(mp.display_name, '')) > 0
        or coalesce(mp.display_name, '') ilike '%' || v_q || '%'
        or (
          v_q_fold is not null
          and position(
            v_q_fold in public.women_member_name_fold_v1(replace(coalesce(mp.display_name, ''), chr(47), ' '))
          ) > 0
        )
      )
    order by mp.id desc
    limit 25
  ) r;

  return jsonb_build_object(
    'ok', true,
    'rows', coalesce(v_tree, '[]'::jsonb) || coalesce(v_pending, '[]'::jsonb)
  );
  exception
    when query_canceled then
      return jsonb_build_object('ok', false, 'error', 'timeout', 'rows', '[]'::jsonb);
    when others then
      return jsonb_build_object('ok', false, 'error', 'timeout', 'rows', '[]'::jsonb);
  end;
end;
$fn$;

create or replace function public.women_manager_add_member_v1(
  p_phone text,
  p_full_name text,
  p_member_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_session jsonb;
  v_name text;
  v_fold text;
  v_member_phone text;
  v_digits text;
  v_existing public.member_profiles%rowtype;
  v_n int := 0;
  v_child_id bigint;
  v_keep_id bigint;
  v_leaf_tok text;
begin
  if to_regprocedure('public.women_manager_session_v1(text)') is null
     or to_regclass('public.member_profiles') is null then
    return jsonb_build_object('ok', false, 'error', 'sql_missing');
  end if;

  v_session := public.women_manager_session_v1(p_phone);
  if coalesce((v_session->>'enabled')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;

  v_name := nullif(btrim(coalesce(p_full_name, '')), '');
  if v_name is null or char_length(v_name) < 2 then
    return jsonb_build_object('ok', false, 'error', 'bad_name');
  end if;
  v_fold := public.women_member_name_fold_v1(v_name);
  v_leaf_tok := nullif(btrim(reverse(split_part(reverse(coalesce(v_fold, '')), ' ', 1))), '');

  v_member_phone := nullif(btrim(coalesce(p_member_phone, '')), '');
  if v_member_phone is not null then
    v_digits := right(regexp_replace(v_member_phone, '[^0-9]', '', 'g'), 9);
    if char_length(coalesce(v_digits, '')) < 9 then
      return jsonb_build_object('ok', false, 'error', 'bad_phone');
    end if;
  end if;

  if v_digits is not null then
    select mp.* into v_existing
    from public.member_profiles mp
    where char_length(right(regexp_replace(coalesce(mp.phone, ''), '[^0-9]', '', 'g'), 9)) = 9
      and right(regexp_replace(coalesce(mp.phone, ''), '[^0-9]', '', 'g'), 9) = v_digits
    order by (coalesce(mp.tree_child_id, 0) > 0) desc, mp.id
    limit 1;
    if found then
      if coalesce(v_existing.tree_child_id, 0) > 0 then
        return jsonb_build_object(
          'ok', false,
          'error', 'phone_conflict',
          'tree_child_id', v_existing.tree_child_id
        );
      end if;
      if coalesce(v_existing.status, '') = 'pending_family' then
        update public.member_profiles
        set
          display_name = coalesce(nullif(btrim(coalesce(display_name, '')), ''), v_name),
          phone = v_member_phone,
          status = 'pending_family',
          updated_at = now()
        where id = v_existing.id;
        return jsonb_build_object(
          'ok', true,
          'action', 'existing_pending',
          'member_id', v_existing.id,
          'kind', 'pending'
        );
      end if;
      return jsonb_build_object('ok', false, 'error', 'phone_conflict');
    end if;
  end if;

  select mp.* into v_existing
  from public.member_profiles mp
  where coalesce(mp.tree_child_id, 0) = 0
    and coalesce(mp.status, '') = 'pending_family'
    and public.women_member_name_fold_v1(mp.display_name) is not distinct from v_fold
  order by mp.id
  limit 1;
  if found then
    if v_member_phone is not null then
      update public.member_profiles
      set phone = v_member_phone, updated_at = now()
      where id = v_existing.id
        and nullif(btrim(coalesce(phone, '')), '') is null;
    end if;
    return jsonb_build_object(
      'ok', true,
      'action', 'existing_pending',
      'member_id', v_existing.id,
      'kind', 'pending'
    );
  end if;

  begin
    insert into public.member_profiles (
      phone, branch_key, tree_child_id, person_id, display_name, status, created_at, updated_at
    ) values (
      v_member_phone, null, null, null, v_name, 'pending_family', now(), now()
    )
    returning id into v_keep_id;
  exception
    when not_null_violation then
      begin
        insert into public.member_profiles (
          phone, branch_key, display_name, status, created_at, updated_at
        ) values (
          coalesce(v_member_phone, ''), null, v_name, 'pending_family', now(), now()
        )
        returning id into v_keep_id;
      exception when others then
        return jsonb_build_object('ok', false, 'error', 'save_failed');
      end;
    when unique_violation then
      select mp.* into v_existing
      from public.member_profiles mp
      where coalesce(mp.tree_child_id, 0) = 0
        and public.women_member_name_fold_v1(mp.display_name) is not distinct from v_fold
      order by mp.id
      limit 1;
      if found then
        return jsonb_build_object(
          'ok', true,
          'action', 'existing_pending',
          'member_id', v_existing.id,
          'kind', 'pending'
        );
      end if;
      return jsonb_build_object('ok', false, 'error', 'save_failed');
    when others then
      begin
        insert into public.member_profiles (phone, display_name, status, created_at, updated_at)
        values (coalesce(v_member_phone, ''), v_name, 'pending_family', now(), now())
        returning id into v_keep_id;
      exception when others then
        return jsonb_build_object('ok', false, 'error', 'save_failed');
      end;
  end;

  if v_keep_id is null then
    return jsonb_build_object('ok', false, 'error', 'save_failed');
  end if;

  begin
    if to_regprocedure('public.admin_audit_write_v1(text,text,text,text,text,text,jsonb)') is not null then
      perform public.admin_audit_write_v1(
        'women_manager',
        v_session->>'tree_child_id',
        'women_manager.member_add_pending',
        'member_profile',
        v_keep_id::text,
        null,
        jsonb_build_object('display_name', v_name, 'has_phone', v_member_phone is not null)
      );
    end if;
  exception when others then
    null;
  end;

  return jsonb_build_object(
    'ok', true,
    'action', 'created_pending',
    'member_id', v_keep_id,
    'kind', 'pending'
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'error', 'save_failed');
end;
$fn$;

revoke all on function public.women_manager_search_members_v1(text, text, text) from public;
revoke all on function public.women_manager_add_member_v1(text, text, text) from public;
grant execute on function public.women_manager_search_members_v1(text, text, text) to anon, authenticated;
grant execute on function public.women_manager_add_member_v1(text, text, text) to anon, authenticated;
notify pgrst, 'reload schema';
select to_regprocedure('public.women_manager_add_member_v1(text, text, text)') is not null as has_add;
