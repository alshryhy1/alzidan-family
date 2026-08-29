-- COPY-ME: Preset id: maint.women_manager_mothers_v1
-- Women manager: mother -> child already in tree_children via tree_mother_links.
-- Does not insert tree_children. Does not write tree_spouses. Does not use tree_external_offspring.
-- Safe to re-run.

create or replace function public.women_manager_mother_spouse_ids_v1(p_mother_id bigint)
returns table(spouse_id bigint)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_mother public.tree_children%rowtype;
  v_path text;
  v_leaf text;
  v_fold_path text;
  v_fold_leaf text;
begin
  if p_mother_id is null or p_mother_id < 1 then
    return;
  end if;
  if to_regclass('public.tree_spouses') is null
     or to_regprocedure('public.women_member_name_fold_v1(text)') is null then
    return;
  end if;

  select * into v_mother from public.tree_children where id = p_mother_id limit 1;
  if not found then
    return;
  end if;
  if not public.member_role_is_daughter_gender_v1(v_mother.gender) then
    return;
  end if;

  v_path := nullif(btrim(coalesce(v_mother.child_name, to_jsonb(v_mother)->>'name', '')), '');
  if to_regprocedure('public.women_member_leaf_name_v1(text)') is not null then
    v_leaf := public.women_member_leaf_name_v1(v_path);
  else
    v_leaf := nullif(btrim(reverse(split_part(reverse(coalesce(v_path, '')), chr(47), 1))), '');
  end if;
  v_fold_path := public.women_member_name_fold_v1(replace(coalesce(v_path, ''), chr(47), ' '));
  v_fold_leaf := public.women_member_name_fold_v1(v_leaf);

  return query
  select s.id
  from public.tree_spouses s
  where coalesce(s.wife_is_family_member, false) = true
    and (
      (
        v_mother.person_id is not null
        and nullif(to_jsonb(s)->>'wife_person_id', '') is not distinct from v_mother.person_id::text
      )
      or (
        v_fold_path is not null
        and public.women_member_name_fold_v1(replace(coalesce(s.wife_lineage, ''), chr(47), ' '))
          is not distinct from v_fold_path
      )
      or (
        v_fold_leaf is not null
        and public.women_member_name_fold_v1(
          case
            when to_regprocedure('public.women_member_leaf_name_v1(text)') is not null
              then public.women_member_leaf_name_v1(coalesce(s.wife_name, s.wife_lineage))
            else reverse(split_part(reverse(coalesce(s.wife_name, s.wife_lineage, '')), chr(47), 1))
          end
        ) is not distinct from v_fold_leaf
        and (
          nullif(btrim(coalesce(s.wife_branch_key, '')), '') is null
          or s.wife_branch_key is not distinct from v_mother.branch_key
        )
      )
    )
  order by
    case when lower(btrim(coalesce(s.status, 'active'))) in ('', 'active') then 0 else 1 end,
    s.id;
end;
$fn$;

create or replace function public.women_manager_mother_children_v1(
  p_phone text,
  p_mother_tree_child_id bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_session jsonb;
  v_mother public.tree_children%rowtype;
  v_spouses int := 0;
begin
  if to_regprocedure('public.women_manager_session_v1(text)') is null
     or to_regclass('public.tree_mother_links') is null
     or to_regprocedure('public.women_member_leaf_name_v1(text)') is null then
    return jsonb_build_object('ok', false, 'error', 'sql_missing');
  end if;

  v_session := public.women_manager_session_v1(p_phone);
  if coalesce((v_session->>'enabled')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;

  if p_mother_tree_child_id is null or p_mother_tree_child_id < 1 then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;

  select * into v_mother from public.tree_children where id = p_mother_tree_child_id limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'person_not_found');
  end if;
  if not public.member_role_is_daughter_gender_v1(v_mother.gender) then
    return jsonb_build_object('ok', false, 'error', 'not_daughter');
  end if;

  select count(*)::int into v_spouses
  from public.women_manager_mother_spouse_ids_v1(v_mother.id);

  return jsonb_build_object(
    'ok', true,
    'mother_id', v_mother.id,
    'spouses', v_spouses,
    'no_spouse', v_spouses < 1,
    'rows', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.display_name)
      from (
        select
          c.id,
          c.person_id,
          c.branch_key,
          public.women_member_leaf_name_v1(coalesce(c.child_name, to_jsonb(c)->>'name', '')) as display_name,
          nullif(btrim(coalesce(c.child_name, to_jsonb(c)->>'name', '')), '') as path,
          l.spouse_id
        from public.tree_mother_links l
        join public.tree_children c on c.id = l.child_id
        where l.spouse_id in (
          select s.spouse_id from public.women_manager_mother_spouse_ids_v1(v_mother.id) s
        )
        order by c.id desc
        limit 80
      ) r
    ), '[]'::jsonb)
  );
end;
$fn$;

create or replace function public.women_manager_search_tree_people_v1(
  p_phone text,
  p_query text
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
begin
  v_session := public.women_manager_session_v1(p_phone);
  if coalesce((v_session->>'enabled')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'error', 'not_allowed', 'rows', '[]'::jsonb);
  end if;

  v_q := replace(replace(nullif(btrim(coalesce(p_query, '')), ''), '%', ''), '_', '');
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
          public.women_member_leaf_name_v1(coalesce(c.child_name, to_jsonb(c)->>'name', '')) as display_name,
          nullif(btrim(coalesce(c.child_name, to_jsonb(c)->>'name', '')), '') as path
        from public.tree_children c
        where
          position(v_q in coalesce(c.child_name, to_jsonb(c)->>'name', '')) > 0
          or coalesce(c.child_name, to_jsonb(c)->>'name', '') ilike '%' || v_q || '%'
        order by c.id desc
        limit 25
      ) r
    ), '[]'::jsonb)
  );
end;
$fn$;

create or replace function public.women_manager_link_mother_v1(
  p_phone text,
  p_mother_tree_child_id bigint,
  p_child_tree_child_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_session jsonb;
  v_mother public.tree_children%rowtype;
  v_child public.tree_children%rowtype;
  v_father_id bigint;
  v_spouse public.tree_spouses%rowtype;
  v_existing public.tree_mother_links%rowtype;
  v_n int := 0;
begin
  if to_regprocedure('public.women_manager_session_v1(text)') is null
     or to_regclass('public.tree_mother_links') is null
     or to_regclass('public.tree_spouses') is null then
    return jsonb_build_object('ok', false, 'error', 'sql_missing');
  end if;

  v_session := public.women_manager_session_v1(p_phone);
  if coalesce((v_session->>'enabled')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;

  if p_mother_tree_child_id is null or p_mother_tree_child_id < 1
     or p_child_tree_child_id is null or p_child_tree_child_id < 1 then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;
  if p_mother_tree_child_id = p_child_tree_child_id then
    return jsonb_build_object('ok', false, 'error', 'self_link');
  end if;

  select * into v_mother from public.tree_children where id = p_mother_tree_child_id limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'person_not_found');
  end if;
  if not public.member_role_is_daughter_gender_v1(v_mother.gender) then
    return jsonb_build_object('ok', false, 'error', 'not_daughter');
  end if;

  select * into v_child from public.tree_children where id = p_child_tree_child_id limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'child_not_found');
  end if;

  select count(*)::int into v_n
  from public.women_manager_mother_spouse_ids_v1(v_mother.id);
  if v_n < 1 then
    return jsonb_build_object('ok', false, 'error', 'no_spouse');
  end if;

  select f.id
    into v_father_id
  from public.tree_children f
  where (
      v_child.parent_person_id is not null
      and f.person_id is not distinct from v_child.parent_person_id
    )
    or coalesce(f.child_name, to_jsonb(f)->>'name', '')
         is not distinct from coalesce(v_child.parent_name, to_jsonb(v_child)->>'parent', '')
  order by
    case
      when v_child.parent_person_id is not null
       and f.person_id is not distinct from v_child.parent_person_id then 0
      else 1
    end,
    f.id
  limit 1;

  select s.*
    into v_spouse
  from public.tree_spouses s
  where s.id in (select x.spouse_id from public.women_manager_mother_spouse_ids_v1(v_mother.id) x)
    and (
      (v_father_id is not null and s.husband_id is not distinct from v_father_id)
      or (v_father_id is null and v_n = 1)
    )
  order by
    case when lower(btrim(coalesce(s.status, 'active'))) in ('', 'active') then 0 else 1 end,
    s.id
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_spouse');
  end if;

  select * into v_existing from public.tree_mother_links where child_id = v_child.id limit 1;
  if found then
    if v_existing.spouse_id is not distinct from v_spouse.id then
      return jsonb_build_object('ok', true, 'action', 'existing', 'child_id', v_child.id);
    end if;
    if exists (
      select 1 from public.women_manager_mother_spouse_ids_v1(v_mother.id) x
      where x.spouse_id = v_existing.spouse_id
    ) then
      return jsonb_build_object('ok', true, 'action', 'existing', 'child_id', v_child.id);
    end if;
    return jsonb_build_object('ok', false, 'error', 'already_linked');
  end if;

  insert into public.tree_mother_links (
    child_id, spouse_id, mother_name, mother_is_family_member,
    mother_branch_key, mother_family_name, mother_lineage, confidence, updated_at
  ) values (
    v_child.id,
    v_spouse.id,
    coalesce(v_spouse.wife_name, public.women_member_leaf_name_v1(coalesce(v_mother.child_name, to_jsonb(v_mother)->>'name', ''))),
    true,
    coalesce(v_spouse.wife_branch_key, v_mother.branch_key),
    v_spouse.wife_family_name,
    coalesce(v_spouse.wife_lineage, v_mother.child_name),
    'confirmed',
    now()
  );

  begin
    if to_regprocedure('public.admin_audit_write_v1(text,text,text,text,text,text,jsonb)') is not null then
      perform public.admin_audit_write_v1(
        'women_manager',
        v_session->>'tree_child_id',
        'women_manager.mother_link',
        'tree_mother_link',
        v_child.id::text,
        v_child.branch_key,
        jsonb_build_object(
          'mother_id', v_mother.id,
          'child_id', v_child.id,
          'spouse_id', v_spouse.id
        )
      );
    end if;
  exception when others then
    null;
  end;

  return jsonb_build_object('ok', true, 'action', 'linked', 'child_id', v_child.id, 'spouse_id', v_spouse.id);
end;
$fn$;

create or replace function public.women_manager_unlink_mother_v1(
  p_phone text,
  p_mother_tree_child_id bigint,
  p_child_tree_child_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_session jsonb;
  v_deleted int := 0;
begin
  v_session := public.women_manager_session_v1(p_phone);
  if coalesce((v_session->>'enabled')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;
  if p_mother_tree_child_id is null or p_mother_tree_child_id < 1
     or p_child_tree_child_id is null or p_child_tree_child_id < 1 then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;

  delete from public.tree_mother_links l
  where l.child_id = p_child_tree_child_id
    and l.spouse_id in (
      select x.spouse_id from public.women_manager_mother_spouse_ids_v1(p_mother_tree_child_id) x
    );
  get diagnostics v_deleted = row_count;
  if v_deleted < 1 then
    return jsonb_build_object('ok', false, 'error', 'not_linked');
  end if;
  return jsonb_build_object('ok', true, 'child_id', p_child_tree_child_id);
end;
$fn$;

revoke all on function public.women_manager_mother_spouse_ids_v1(bigint) from public;
revoke all on function public.women_manager_mother_children_v1(text, bigint) from public;
revoke all on function public.women_manager_search_tree_people_v1(text, text) from public;
revoke all on function public.women_manager_link_mother_v1(text, bigint, bigint) from public;
revoke all on function public.women_manager_unlink_mother_v1(text, bigint, bigint) from public;

grant execute on function public.women_manager_mother_children_v1(text, bigint) to anon, authenticated;
grant execute on function public.women_manager_search_tree_people_v1(text, text) to anon, authenticated;
grant execute on function public.women_manager_link_mother_v1(text, bigint, bigint) to anon, authenticated;
grant execute on function public.women_manager_unlink_mother_v1(text, bigint, bigint) to anon, authenticated;

notify pgrst, 'reload schema';

select
  to_regprocedure('public.women_manager_link_mother_v1(text, bigint, bigint)') is not null as has_link,
  to_regprocedure('public.women_manager_mother_children_v1(text, bigint)') is not null as has_list;
