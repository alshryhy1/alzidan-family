-- Preset id: maint.women_add_direct_lineage_v1
-- Run from Admin SQL Workspace (sequential v2). Do not paste in Supabase SQL Editor.
-- If father + grandfather + family match one man in the tree: add daughter now.
-- If the lineage is wrong or ambiguous: pending_family for original admin to edit and save.

create or replace function public.women_lineage_tokens_v1(p text)
returns text[]
language plpgsql
stable
as $tok$
declare
  v_raw text[];
  v_out text[] := '{}';
  v_one text;
  v_fold text;
begin
  v_raw := regexp_split_to_array(nullif(btrim(coalesce(p, '')), ''), E'\\s+');
  if v_raw is null then
    return '{}';
  end if;
  foreach v_one in array v_raw loop
    v_one := nullif(btrim(v_one), '');
    if v_one is null then
      continue;
    end if;
    if to_regprocedure('public.women_member_name_fold_v1(text)') is not null then
      v_fold := public.women_member_name_fold_v1(v_one);
    else
      v_fold := lower(v_one);
    end if;
    if v_fold in ('بن', 'ابن', 'بنت', 'ال', 'آل') then
      continue;
    end if;
    v_out := array_append(v_out, v_one);
  end loop;
  return v_out;
end;
$tok$;

create or replace function public.women_path_has_folded_token_v1(p_path text, p_token text)
returns boolean
language plpgsql
stable
as $has$
declare
  v_path text;
  v_tok text;
  v_seg text;
begin
  if to_regprocedure('public.women_member_name_fold_v1(text)') is null then
    return false;
  end if;
  v_tok := public.women_member_name_fold_v1(p_token);
  v_path := public.women_member_name_fold_v1(replace(coalesce(p_path, ''), chr(47), ' '));
  if v_tok is null or v_path is null then
    return false;
  end if;
  if v_path = v_tok or v_path like v_tok || ' %' or v_path like '% ' || v_tok or v_path like '% ' || v_tok || ' %' then
    return true;
  end if;
  foreach v_seg in array regexp_split_to_array(coalesce(p_path, ''), chr(47)) loop
    if public.women_member_name_fold_v1(v_seg) is not distinct from v_tok then
      return true;
    end if;
  end loop;
  return false;
end;
$has$;

create or replace function public.women_insert_daughter_under_v1(
  p_father_id bigint,
  p_given text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $ins$
declare
  v_father public.tree_children%rowtype;
  v_given text;
  v_parent_path text;
  v_child_path text;
  v_exist public.tree_children%rowtype;
  v_id bigint;
  v_person uuid;
begin
  v_given := nullif(btrim(coalesce(p_given, '')), '');
  if v_given is not null then
    v_given := nullif(btrim(split_part(v_given, ' ', 1)), '');
  end if;
  if p_father_id is null or p_father_id < 1 or v_given is null then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;

  select * into v_father from public.tree_children where id = p_father_id limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'person_not_found');
  end if;
  if public.member_role_is_daughter_gender_v1(v_father.gender) then
    return jsonb_build_object('ok', false, 'error', 'not_father');
  end if;

  v_parent_path := nullif(btrim(coalesce(v_father.child_name, to_jsonb(v_father)->>'name', '')), '');
  if v_parent_path is null then
    return jsonb_build_object('ok', false, 'error', 'person_not_found');
  end if;
  v_child_path := v_parent_path || chr(47) || v_given;

  select d.* into v_exist
  from public.tree_children d
  where d.branch_key is not distinct from v_father.branch_key
    and public.women_member_name_fold_v1(
      public.women_member_leaf_name_v1(coalesce(d.child_name, to_jsonb(d)->>'name', ''))
    ) is not distinct from public.women_member_name_fold_v1(v_given)
    and (
      (v_father.person_id is not null and d.parent_person_id is not distinct from v_father.person_id)
      or coalesce(d.parent_name, to_jsonb(d)->>'parent', '') = v_parent_path
    )
  order by d.id
  limit 1;
  if found then
    if public.member_role_is_daughter_gender_v1(v_exist.gender)
       or coalesce(nullif(btrim(coalesce(v_exist.gender, '')), ''), '') = '' then
      if coalesce(nullif(btrim(coalesce(v_exist.gender, '')), ''), '') = '' then
        update public.tree_children set gender = 'daughter' where id = v_exist.id;
      end if;
      return jsonb_build_object(
        'ok', true,
        'tree_child_id', v_exist.id,
        'person_id', v_exist.person_id,
        'existing', true
      );
    end if;
    return jsonb_build_object('ok', false, 'error', 'name_conflict');
  end if;

  v_person := gen_random_uuid();
  begin
    insert into public.tree_children (
      branch_key, parent_name, parent, child_name, name,
      person_id, parent_person_id, gender, created_at
    ) values (
      v_father.branch_key, v_parent_path, v_parent_path, v_child_path, v_child_path,
      v_person, v_father.person_id, 'daughter', now()
    )
    returning id into v_id;
  exception when others then
    insert into public.tree_children (
      branch_key, parent_name, child_name, person_id, parent_person_id, gender, created_at
    ) values (
      v_father.branch_key, v_parent_path, v_child_path, v_person, v_father.person_id, 'daughter', now()
    )
    returning id into v_id;
  end;

  return jsonb_build_object(
    'ok', true,
    'tree_child_id', v_id,
    'person_id', v_person,
    'existing', false
  );
end;
$ins$;

create or replace function public.admin_women_pending_add_under_parent_v1(
  p_token text,
  p_member_id bigint,
  p_parent_id bigint,
  p_full_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $adm$
declare
  v_row public.member_profiles%rowtype;
  v_name text;
  v_given text;
  v_ins jsonb;
  v_child_id bigint;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;
  if p_member_id is null or p_member_id < 1 or p_parent_id is null or p_parent_id < 1 then
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

  v_name := nullif(btrim(coalesce(p_full_name, v_row.display_name, '')), '');
  if v_name is not null then
    update public.member_profiles
    set display_name = v_name, updated_at = now()
    where id = v_row.id;
    v_row.display_name := v_name;
  end if;

  v_given := nullif(btrim(split_part(coalesce(v_row.display_name, ''), ' ', 1)), '');
  v_ins := public.women_insert_daughter_under_v1(p_parent_id, v_given);
  if coalesce((v_ins->>'ok')::boolean, false) is not true then
    return v_ins;
  end if;
  v_child_id := nullif(v_ins->>'tree_child_id', '')::bigint;
  return public.admin_women_pending_place_v1(p_token, p_member_id, v_child_id);
end;
$adm$;

create or replace function public.women_manager_add_member_v1(
  p_phone text,
  p_full_name text,
  p_member_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $add$
declare
  v_session jsonb;
  v_name text;
  v_fold text;
  v_member_phone text;
  v_digits text;
  v_existing public.member_profiles%rowtype;
  v_keep_id bigint;
  v_err text;
  v_state text;
  v_parts text[];
  v_given text;
  v_father text;
  v_gf text;
  v_family text;
  v_mid text;
  v_father_row public.tree_children%rowtype;
  v_hit public.tree_children%rowtype;
  v_hits int := 0;
  v_ok_family boolean;
  v_ok_mid boolean;
  v_path text;
  v_ins jsonb;
  v_child_id bigint;
  v_person uuid;
  v_branch text;
  i int;
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

  if to_regprocedure('public.women_member_name_fold_v1(text)') is not null then
    v_fold := public.women_member_name_fold_v1(v_name);
  else
    v_fold := lower(btrim(v_name));
  end if;

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
        return jsonb_build_object('ok', false, 'error', 'phone_conflict', 'tree_child_id', v_existing.tree_child_id);
      end if;
    end if;
  end if;

  v_parts := public.women_lineage_tokens_v1(v_name);
  if coalesce(array_length(v_parts, 1), 0) >= 4 then
    v_given := v_parts[1];
    v_father := v_parts[2];
    v_gf := v_parts[3];
    v_family := v_parts[array_length(v_parts, 1)];
    v_father_row := null;
    v_hits := 0;
    for v_hit in
      select c.*
      from public.tree_children c
      where (
          coalesce(c.child_name, to_jsonb(c)->>'name', '') = v_father
          or coalesce(c.child_name, to_jsonb(c)->>'name', '') like '%/' || v_father
        )
        and (
          coalesce(c.parent_name, to_jsonb(c)->>'parent', '') = v_gf
          or coalesce(c.parent_name, to_jsonb(c)->>'parent', '') like '%/' || v_gf
        )
        and coalesce(public.member_role_is_daughter_gender_v1(c.gender), false) is not true
    loop
      v_path := coalesce(v_hit.child_name, to_jsonb(v_hit)->>'name', '');
      v_ok_family :=
        public.women_member_name_fold_v1(coalesce(v_hit.branch_key, ''))
          is not distinct from public.women_member_name_fold_v1(v_family)
        or public.women_member_name_fold_v1(split_part(v_path, chr(47), 1))
          is not distinct from public.women_member_name_fold_v1(v_family)
        or public.women_path_has_folded_token_v1(v_path, v_family);
      if not v_ok_family then
        continue;
      end if;
      v_ok_mid := true;
      if array_length(v_parts, 1) > 4 then
        for i in 4 .. array_length(v_parts, 1) - 1 loop
          v_mid := v_parts[i];
          if not public.women_path_has_folded_token_v1(v_path, v_mid)
             and not public.women_path_has_folded_token_v1(
               coalesce(v_hit.parent_name, to_jsonb(v_hit)->>'parent', ''),
               v_mid
             ) then
            v_ok_mid := false;
            exit;
          end if;
        end loop;
      end if;
      if not v_ok_mid then
        continue;
      end if;
      v_hits := v_hits + 1;
      v_father_row := v_hit;
      if v_hits > 1 then
        exit;
      end if;
    end loop;

    if v_hits = 1 and v_father_row.id is not null then
      v_ins := public.women_insert_daughter_under_v1(v_father_row.id, v_given);
      if coalesce((v_ins->>'ok')::boolean, false) is true then
        v_child_id := nullif(v_ins->>'tree_child_id', '')::bigint;
        select c.person_id, c.branch_key
          into v_person, v_branch
        from public.tree_children c
        where c.id = v_child_id
        limit 1;

        select mp.* into v_existing
        from public.member_profiles mp
        where coalesce(mp.tree_child_id, 0) = 0
          and coalesce(mp.status, '') = 'pending_family'
          and lower(btrim(coalesce(mp.display_name, ''))) is not distinct from lower(btrim(v_name))
        order by mp.id
        limit 1;

        if v_existing.id is not null then
          v_keep_id := v_existing.id;
        else
          begin
            insert into public.member_profiles (
              phone, display_name, status, tree_child_id, person_id, branch_key, created_at, updated_at
            ) values (
              v_member_phone, v_name, 'active', v_child_id, v_person, v_branch, now(), now()
            )
            returning id into v_keep_id;
          exception when others then
            insert into public.member_profiles (display_name, status)
            values (v_name, 'pending_family')
            returning id into v_keep_id;
          end;
        end if;

        update public.member_profiles
        set
          tree_child_id = v_child_id,
          person_id = v_person,
          branch_key = v_branch,
          status = 'active',
          display_name = coalesce(nullif(btrim(coalesce(display_name, '')), ''), v_name),
          phone = coalesce(v_member_phone, phone),
          updated_at = now()
        where id = v_keep_id;

        return jsonb_build_object(
          'ok', true,
          'action', 'placed',
          'member_id', v_keep_id,
          'tree_child_id', v_child_id,
          'kind', 'tree'
        );
      end if;
    end if;
  end if;

  begin
    select mp.* into v_existing
    from public.member_profiles mp
    where coalesce(mp.tree_child_id, 0) = 0
      and coalesce(mp.status, '') = 'pending_family'
      and lower(btrim(coalesce(mp.display_name, ''))) is not distinct from lower(btrim(v_name))
    order by mp.id
    limit 1;
  exception when others then
    v_existing := null;
  end;
  if v_existing.id is not null then
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
      'kind', 'pending',
      'reason', 'lineage_mismatch'
    );
  end if;

  begin
    insert into public.member_profiles (phone, display_name, status, created_at, updated_at)
    values (v_member_phone, v_name, 'pending_family', now(), now())
    returning id into v_keep_id;
  exception when others then
    v_err := SQLERRM;
    v_state := SQLSTATE;
    begin
      insert into public.member_profiles (display_name, status)
      values (v_name, 'pending_family')
      returning id into v_keep_id;
    exception when others then
      v_err := SQLERRM;
      v_state := SQLSTATE;
      begin
        insert into public.member_profiles (display_name)
        values (v_name)
        returning id into v_keep_id;
        begin
          update public.member_profiles
          set status = 'pending_family', updated_at = now()
          where id = v_keep_id;
        exception when others then
          null;
        end;
      exception when others then
        return jsonb_build_object(
          'ok', false,
          'error', 'save_failed',
          'sqlstate', SQLSTATE,
          'detail', left(SQLERRM, 180)
        );
      end;
    end;
  end;

  if v_keep_id is null then
    return jsonb_build_object('ok', false, 'error', 'save_failed', 'sqlstate', v_state, 'detail', left(coalesce(v_err, ''), 180));
  end if;

  begin
    update public.member_profiles
    set status = 'pending_family',
        display_name = coalesce(nullif(btrim(coalesce(display_name, '')), ''), v_name),
        updated_at = now()
    where id = v_keep_id;
  exception when others then
    null;
  end;

  return jsonb_build_object(
    'ok', true,
    'action', 'created_pending',
    'member_id', v_keep_id,
    'kind', 'pending',
    'reason', 'lineage_mismatch'
  );
exception
  when others then
    return jsonb_build_object(
      'ok', false,
      'error', 'save_failed',
      'sqlstate', SQLSTATE,
      'detail', left(SQLERRM, 180)
    );
end;
$add$;

revoke all on function public.women_lineage_tokens_v1(text) from public;
revoke all on function public.women_path_has_folded_token_v1(text, text) from public;
revoke all on function public.women_insert_daughter_under_v1(bigint, text) from public;
revoke all on function public.admin_women_pending_add_under_parent_v1(text, bigint, bigint, text) from public;
revoke all on function public.women_manager_add_member_v1(text, text, text) from public;

grant execute on function public.women_manager_add_member_v1(text, text, text) to anon, authenticated;
grant execute on function public.admin_women_pending_add_under_parent_v1(text, bigint, bigint, text) to anon, authenticated;

notify pgrst, 'reload schema';
select
  to_regprocedure('public.women_manager_add_member_v1(text, text, text)') is not null as has_add,
  to_regprocedure('public.admin_women_pending_add_under_parent_v1(text, bigint, bigint, text)') is not null as has_admin_add;
