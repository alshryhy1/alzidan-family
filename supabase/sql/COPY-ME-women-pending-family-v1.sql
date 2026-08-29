-- COPY-ME: Preset id: maint.women_pending_family_v1
-- Women manager: add female member by full name (optional phone) without tree_children.
-- Original admin places the row onto an existing daughter. Login only after placement.
-- Safe to re-run.

create or replace function public.women_member_name_fold_v1(p text)
returns text
language sql
immutable
as $fn$
  select nullif(btrim(regexp_replace(
    replace(replace(replace(replace(replace(replace(replace(replace(
      regexp_replace(coalesce(p, ''), '[\u064B-\u065F\u0670\u0640]', '', 'g'),
      'أ', 'ا'), 'إ', 'ا'), 'آ', 'ا'), 'ٱ', 'ا'),
      'ى', 'ي'), 'ة', 'ه'), 'ؤ', 'و'), 'ئ', 'ي')
  , '\s+', ' ', 'g')), '');
$fn$;

create or replace function public.women_member_leaf_name_v1(p text)
returns text
language sql
immutable
as $fn$
  select nullif(btrim(reverse(split_part(reverse(coalesce(p, '')), chr(47), 1))), '');
$fn$;

create or replace function public.public_app_login_by_phone_v1(p_phone text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_phone text;
  v_member public.member_profiles%rowtype;
  v_delegate public.delegates_v2%rowtype;
  v_has_member boolean := false;
  v_has_delegate boolean := false;
  v_role text := 'none';
  v_member_complete boolean := false;
begin
  if to_regprocedure('public.push_tokens_norm_phone(text)') is not null then
    v_phone := nullif(public.push_tokens_norm_phone(p_phone), '');
  else
    v_phone := nullif(right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 9), '');
  end if;
  if v_phone is null or char_length(v_phone) < 9 then
    return jsonb_build_object('ok', false, 'error', 'bad_phone');
  end if;

  if to_regclass('public.member_profiles') is not null then
    select m.*
      into v_member
    from public.member_profiles m
    where right(regexp_replace(coalesce(m.phone, ''), '[^0-9]', '', 'g'), 9)
        = right(regexp_replace(v_phone, '[^0-9]', '', 'g'), 9)
      and char_length(right(regexp_replace(coalesce(m.phone, ''), '[^0-9]', '', 'g'), 9)) = 9
    order by m.updated_at desc nulls last, m.id desc
    limit 1;
    v_has_member := found;
    v_member_complete := v_has_member
      and coalesce(v_member.tree_child_id, 0) > 0
      and coalesce(nullif(btrim(coalesce(v_member.status, '')), ''), 'active') is distinct from 'pending_family';
    if v_has_member and not v_member_complete then
      v_has_member := false;
    end if;
  end if;

  if to_regclass('public.delegates_v2') is not null then
    select d.*
      into v_delegate
    from public.delegates_v2 d
    where coalesce(d.is_enabled, true) = true
      and right(regexp_replace(coalesce(d.phone, ''), '[^0-9]', '', 'g'), 9)
        = right(regexp_replace(v_phone, '[^0-9]', '', 'g'), 9)
    order by d.updated_at desc nulls last, d.created_at desc nulls last
    limit 1;
    v_has_delegate := found;
  end if;

  if not v_has_member and not v_has_delegate then
    return jsonb_build_object('ok', false, 'error', 'not_found', 'phone', v_phone);
  end if;

  if v_has_member and v_has_delegate then
    v_role := 'both';
  elsif v_has_delegate then
    v_role := 'delegate';
  else
    v_role := 'member';
  end if;

  return jsonb_build_object(
    'ok', true,
    'role', v_role,
    'phone', v_phone,
    'member_id', case when v_has_member then v_member.id else null end,
    'tree_child_id', case when v_has_member then v_member.tree_child_id else null end,
    'person_id', case when v_has_member then v_member.person_id else null end,
    'branch_key', coalesce(
      nullif(btrim(coalesce(case when v_has_member then v_member.branch_key else null end, '')), ''),
      nullif(btrim(coalesce(case when v_has_delegate then v_delegate.branch_key else null end, '')), '')
    ),
    'display_name', coalesce(
      nullif(btrim(coalesce(case when v_has_member then v_member.display_name else null end, '')), ''),
      nullif(btrim(coalesce(case when v_has_delegate then v_delegate.name else null end, '')), ''),
      'مندوب الفرع'
    ),
    'delegate_id', case when v_has_delegate then v_delegate.id else null end,
    'delegate_role_key', case when v_has_delegate then v_delegate.role_key else null end,
    'is_delegate', v_has_delegate,
    'is_member', v_has_member
  );
end;
$fn$;

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
    if v_leaf_tok is not null then
      select count(*)::int, min(c.id)
        into v_n, v_child_id
      from public.tree_children c
      where lower(btrim(coalesce(c.gender, ''))) not in ('son', 'male', 'm', 'ذكر', 'ابن', 'ولد')
        and public.women_member_name_fold_v1(
          public.women_member_leaf_name_v1(coalesce(c.child_name, to_jsonb(c)->>'name', ''))
        ) is not distinct from v_leaf_tok
        and not exists (
          select 1
          from unnest(string_to_array(v_fold, ' ')) t(tok)
          where nullif(btrim(tok), '') is not null
            and position(
              tok in public.women_member_name_fold_v1(
                replace(coalesce(c.child_name, to_jsonb(c)->>'name', ''), chr(47), ' ')
              )
            ) = 0
        );
      if v_n = 1 then
        return jsonb_build_object(
          'ok', true,
          'action', 'existing_tree',
          'tree_child_id', v_child_id,
          'kind', 'tree'
        );
      end if;
      if v_n > 1 then
        return jsonb_build_object('ok', false, 'error', 'ambiguous_name');
      end if;
    end if;
  exception
    when query_canceled then
      v_n := 0;
    when others then
      v_n := 0;
  end;

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
end;
$fn$;

create or replace function public.women_manager_set_pending_phone_v1(
  p_phone text,
  p_member_id bigint,
  p_member_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_session jsonb;
  v_row public.member_profiles%rowtype;
  v_member_phone text;
  v_digits text;
  v_other public.member_profiles%rowtype;
begin
  v_session := public.women_manager_session_v1(p_phone);
  if coalesce((v_session->>'enabled')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;

  if p_member_id is null or p_member_id < 1 then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;

  select * into v_row from public.member_profiles where id = p_member_id;
  if not found
     or coalesce(v_row.tree_child_id, 0) > 0
     or coalesce(v_row.status, '') is distinct from 'pending_family' then
    return jsonb_build_object('ok', false, 'error', 'not_pending');
  end if;

  v_member_phone := nullif(btrim(coalesce(p_member_phone, '')), '');
  if v_member_phone is null then
    update public.member_profiles set phone = null, updated_at = now() where id = v_row.id;
    return jsonb_build_object('ok', true, 'member_id', v_row.id, 'status', 'pending_family');
  end if;

  v_digits := right(regexp_replace(v_member_phone, '[^0-9]', '', 'g'), 9);
  if char_length(coalesce(v_digits, '')) < 9 then
    return jsonb_build_object('ok', false, 'error', 'bad_phone');
  end if;

  select * into v_other
  from public.member_profiles mp
  where mp.id <> v_row.id
    and char_length(right(regexp_replace(coalesce(mp.phone, ''), '[^0-9]', '', 'g'), 9)) = 9
    and right(regexp_replace(coalesce(mp.phone, ''), '[^0-9]', '', 'g'), 9) = v_digits
  limit 1;
  if found then
    return jsonb_build_object('ok', false, 'error', 'phone_conflict');
  end if;

  update public.member_profiles
  set phone = v_member_phone, status = 'pending_family', updated_at = now()
  where id = v_row.id;

  return jsonb_build_object('ok', true, 'member_id', v_row.id, 'status', 'pending_family');
end;
$fn$;

create or replace function public.admin_women_pending_list_v1(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;
  return jsonb_build_object(
    'ok', true,
    'rows', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.updated_at desc)
      from (
        select
          mp.id,
          mp.display_name,
          mp.phone,
          mp.status,
          mp.created_at,
          mp.updated_at
        from public.member_profiles mp
        where coalesce(mp.tree_child_id, 0) = 0
          and coalesce(mp.status, '') = 'pending_family'
        order by mp.updated_at desc nulls last
        limit 200
      ) r
    ), '[]'::jsonb)
  );
end;
$fn$;

create or replace function public.admin_women_pending_search_v1(p_token text, p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_q text;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;
  v_q := replace(replace(nullif(btrim(coalesce(p_query, '')), ''), '%', ''), '_', '');
  if v_q is null or char_length(v_q) < 2 then
    return jsonb_build_object('ok', true, 'rows', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'ok', true,
    'rows', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.path)
      from (
        select
          c.id,
          nullif(btrim(coalesce(c.child_name, to_jsonb(c)->>'name', '')), '') as path,
          public.women_member_leaf_name_v1(coalesce(c.child_name, to_jsonb(c)->>'name', '')) as display_name,
          c.branch_key,
          c.gender
        from public.tree_children c
        where public.member_role_is_daughter_gender_v1(c.gender)
          and (
            position(v_q in coalesce(c.child_name, to_jsonb(c)->>'name', '')) > 0
            or coalesce(c.child_name, to_jsonb(c)->>'name', '') ilike '%' || v_q || '%'
          )
        order by c.id desc
        limit 40
      ) r
    ), '[]'::jsonb)
  );
end;
$fn$;

create or replace function public.admin_women_pending_place_v1(
  p_token text,
  p_member_id bigint,
  p_tree_child_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row public.member_profiles%rowtype;
  v_child public.tree_children%rowtype;
  v_bind jsonb;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;
  if p_member_id is null or p_member_id < 1 or p_tree_child_id is null or p_tree_child_id < 1 then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;

  select * into v_row from public.member_profiles where id = p_member_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if coalesce(v_row.tree_child_id, 0) > 0 then
    return jsonb_build_object('ok', false, 'error', 'already_placed');
  end if;
  if coalesce(v_row.status, '') is distinct from 'pending_family' then
    return jsonb_build_object('ok', false, 'error', 'not_pending');
  end if;

  select * into v_child from public.tree_children where id = p_tree_child_id limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'person_not_found');
  end if;
  if not public.member_role_is_daughter_gender_v1(v_child.gender) then
    return jsonb_build_object('ok', false, 'error', 'not_daughter');
  end if;

  if nullif(btrim(coalesce(v_row.phone, '')), '') is not null
     and to_regprocedure('public.bind_sender_phone_to_person_v1(text, text, bigint)') is not null then
    v_bind := public.bind_sender_phone_to_person_v1(
      v_row.phone,
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
  end if;

  update public.member_profiles
  set
    tree_child_id = v_child.id,
    person_id = v_child.person_id,
    branch_key = v_child.branch_key,
    status = 'active',
    display_name = coalesce(
      nullif(btrim(coalesce(display_name, '')), ''),
      public.women_member_leaf_name_v1(coalesce(v_child.child_name, to_jsonb(v_child)->>'name', ''))
    ),
    updated_at = now()
  where id = v_row.id;

  update public.member_profiles
  set status = 'active', updated_at = now()
  where tree_child_id = v_child.id
     or (v_child.person_id is not null and person_id is not distinct from v_child.person_id);

  begin
    if to_regprocedure('public.admin_audit_write_v1(text,text,text,text,text,text,jsonb)') is not null then
      perform public.admin_audit_write_v1(
        'admin',
        'admin',
        'women_manager.pending_place',
        'member_profile',
        v_row.id::text,
        v_child.branch_key,
        jsonb_build_object('tree_child_id', v_child.id, 'person_id', v_child.person_id)
      );
    end if;
  exception when others then
    null;
  end;

  return jsonb_build_object(
    'ok', true,
    'member_id', v_row.id,
    'tree_child_id', v_child.id,
    'person_id', v_child.person_id
  );
end;
$fn$;

revoke all on function public.women_member_name_fold_v1(text) from public;
revoke all on function public.women_member_leaf_name_v1(text) from public;
revoke all on function public.women_manager_add_member_v1(text, text, text) from public;
revoke all on function public.women_manager_set_pending_phone_v1(text, bigint, text) from public;
revoke all on function public.admin_women_pending_list_v1(text) from public;
revoke all on function public.admin_women_pending_search_v1(text, text) from public;
revoke all on function public.admin_women_pending_place_v1(text, bigint, bigint) from public;
revoke all on function public.public_app_login_by_phone_v1(text) from public;
revoke all on function public.women_manager_search_members_v1(text, text, text) from public;

grant execute on function public.public_app_login_by_phone_v1(text) to anon, authenticated;
grant execute on function public.women_manager_search_members_v1(text, text, text) to anon, authenticated;
grant execute on function public.women_manager_add_member_v1(text, text, text) to anon, authenticated;
grant execute on function public.women_manager_set_pending_phone_v1(text, bigint, text) to anon, authenticated;
grant execute on function public.admin_women_pending_list_v1(text) to anon, authenticated;
grant execute on function public.admin_women_pending_search_v1(text, text) to anon, authenticated;
grant execute on function public.admin_women_pending_place_v1(text, bigint, bigint) to anon, authenticated;

notify pgrst, 'reload schema';

select
  to_regprocedure('public.women_manager_add_member_v1(text, text, text)') is not null as has_add,
  to_regprocedure('public.admin_women_pending_place_v1(text, bigint, bigint)') is not null as has_place;
