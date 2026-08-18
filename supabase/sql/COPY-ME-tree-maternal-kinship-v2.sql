-- COPY-ME: run in Supabase SQL Editor / SQL Workspace
-- Preset id: maint.tree_maternal_kinship_v2
--
-- General maternal kinship for ANY family-member mother:
--   خالك / ابن خالك / ابن خالتك
-- Reads confirmed tree_mother_links + wife nasab (text or slash path).
-- Unifies ة/ه and أ/ا. Does not bind to one name. Safe to re-run.

create or replace function public.tree_arabic_norm_v1(p text)
returns text
language sql
immutable
as $$
  select lower(btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(coalesce(p, ''), '[\u064B-\u065F\u0670]', '', 'g'),
            'ـ', '', 'g'),
          '[أإآ]', 'ا', 'g'),
        'ة', 'ه', 'g'),
      'ى', 'ي', 'g')
  ));
$$;

create or replace function public.tree_nasab_tokens_v1(p text)
returns text[]
language sql
immutable
as $$
  select coalesce(
    array_remove(
      string_to_array(
        btrim(
          regexp_replace(
            public.tree_arabic_norm_v1(p),
            '(^|[[:space:]])(بنت|بن|ابن)([[:space:]]|$)',
            ' ',
            'g'
          )
        ),
        ' '
      ),
      ''
    ),
    '{}'::text[]
  );
$$;

create or replace function public.tree_nasab_nth_v1(p text, p_n integer)
returns text
language sql
immutable
as $$
  select nullif((public.tree_nasab_tokens_v1(p))[greatest(p_n, 1)], '');
$$;

create or replace function public.tree_path_leaf_v1(p text)
returns text
language sql
immutable
as $$
  select public.tree_arabic_norm_v1(nullif(btrim(regexp_replace(coalesce(p, ''), '^.*/', '')), ''));
$$;

create or replace function public.tree_child_is_daughter_v1(p_gender text)
returns boolean
language sql
immutable
as $$
  select lower(btrim(coalesce(p_gender, ''))) in (
    'daughter', 'female', 'f', 'أنثى', 'انثى', 'ابنة', 'بنت'
  );
$$;

create or replace function public.tree_maternal_kinship_for_viewer_v1(p_viewer_id bigint)
returns table(person_id bigint, label text)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_spouse_id bigint;
  v_lineage text;
  v_wife_name text;
  v_branch text;
  v_leaf text;
  v_father_leaf text;
  v_mother_id bigint;
  v_mother_path text;
  v_gf_path text;
  v_match_count int;
begin
  if p_viewer_id is null or p_viewer_id < 1 then
    return;
  end if;

  select
    l.spouse_id,
    nullif(btrim(coalesce(s.wife_lineage, l.mother_lineage, '')), ''),
    nullif(btrim(coalesce(s.wife_name, l.mother_name, '')), ''),
    nullif(btrim(coalesce(s.wife_branch_key, l.mother_branch_key, '')), '')
  into v_spouse_id, v_lineage, v_wife_name, v_branch
  from public.tree_mother_links l
  left join public.tree_spouses s on s.id = l.spouse_id
  where l.child_id = p_viewer_id
    and lower(btrim(coalesce(l.confidence, 'confirmed'))) in ('', 'confirmed')
    and coalesce(s.wife_is_family_member, l.mother_is_family_member, false) = true
    and lower(btrim(coalesce(s.status, 'active'))) in ('', 'active')
  order by l.child_id
  limit 1;

  if v_spouse_id is null then
    return;
  end if;

  v_leaf := public.tree_nasab_nth_v1(coalesce(v_wife_name, v_lineage, ''), 1);
  v_father_leaf := public.tree_nasab_nth_v1(coalesce(v_wife_name, v_lineage, ''), 2);

  if v_lineage is not null and position('/' in v_lineage) > 0 then
    select count(*) into v_match_count
    from public.tree_children c
    where (v_branch is null or c.branch_key = v_branch)
      and (
        public.tree_arabic_norm_v1(coalesce(c.child_name, c.name, ''))
          = public.tree_arabic_norm_v1(v_lineage)
        or public.tree_arabic_norm_v1(coalesce(c.name, ''))
          = public.tree_arabic_norm_v1(v_lineage)
      );
    if v_match_count = 1 then
      select c.id, coalesce(c.child_name, c.name), coalesce(c.parent_name, c.parent)
      into v_mother_id, v_mother_path, v_gf_path
      from public.tree_children c
      where (v_branch is null or c.branch_key = v_branch)
        and (
          public.tree_arabic_norm_v1(coalesce(c.child_name, c.name, ''))
            = public.tree_arabic_norm_v1(v_lineage)
          or public.tree_arabic_norm_v1(coalesce(c.name, ''))
            = public.tree_arabic_norm_v1(v_lineage)
        )
      limit 1;
    elsif v_match_count = 0 then
      v_mother_path := v_lineage;
      v_gf_path := regexp_replace(v_lineage, '/[^/]+$', '');
    end if;
  end if;

  if v_gf_path is null and v_leaf is not null then
    select count(*) into v_match_count
    from public.tree_children c
    where (v_branch is null or c.branch_key = v_branch)
      and public.tree_path_leaf_v1(coalesce(c.child_name, c.name)) = v_leaf
      and (
        v_father_leaf is null
        or public.tree_path_leaf_v1(coalesce(c.parent_name, c.parent)) = v_father_leaf
        or (
          select count(*)
          from public.tree_children c2
          where (v_branch is null or c2.branch_key = v_branch)
            and public.tree_path_leaf_v1(coalesce(c2.child_name, c2.name)) = v_leaf
        ) = 1
      );

    if v_match_count = 1 then
      select c.id, coalesce(c.child_name, c.name), coalesce(c.parent_name, c.parent), c.branch_key
      into v_mother_id, v_mother_path, v_gf_path, v_branch
      from public.tree_children c
      where (v_branch is null or c.branch_key = v_branch)
        and public.tree_path_leaf_v1(coalesce(c.child_name, c.name)) = v_leaf
        and (
          v_father_leaf is null
          or public.tree_path_leaf_v1(coalesce(c.parent_name, c.parent)) = v_father_leaf
          or (
            select count(*)
            from public.tree_children c2
            where (v_branch is null or c2.branch_key = v_branch)
              and public.tree_path_leaf_v1(coalesce(c2.child_name, c2.name)) = v_leaf
          ) = 1
        )
      limit 1;
    end if;
  end if;

  v_gf_path := nullif(btrim(coalesce(v_gf_path, '')), '');
  if v_gf_path is null then
    return;
  end if;

  return query
  with khals as (
    select c.id, coalesce(c.child_name, c.name) as path, c.branch_key
    from public.tree_children c
    where coalesce(c.parent_name, c.parent) = v_gf_path
      and (v_branch is null or c.branch_key = v_branch)
      and not public.tree_child_is_daughter_v1(c.gender)
      and (v_mother_id is null or c.id <> v_mother_id)
      and (
        v_mother_path is null
        or public.tree_arabic_norm_v1(coalesce(c.child_name, c.name, ''))
             <> public.tree_arabic_norm_v1(v_mother_path)
      )
  ),
  ibn_khal as (
    select s.id
    from public.tree_children s
    join khals k
      on coalesce(s.parent_name, s.parent) = k.path
     and s.branch_key = k.branch_key
    where not public.tree_child_is_daughter_v1(s.gender)
  ),
  sisters as (
    select c.id, coalesce(c.child_name, c.name) as path, c.branch_key,
           public.tree_path_leaf_v1(coalesce(c.child_name, c.name)) as leaf
    from public.tree_children c
    where coalesce(c.parent_name, c.parent) = v_gf_path
      and (v_branch is null or c.branch_key = v_branch)
      and public.tree_child_is_daughter_v1(c.gender)
      and (v_mother_id is null or c.id <> v_mother_id)
      and (
        v_mother_path is null
        or public.tree_arabic_norm_v1(coalesce(c.child_name, c.name, ''))
             <> public.tree_arabic_norm_v1(v_mother_path)
      )
  ),
  sister_spouses as (
    select distinct s.id as spouse_id
    from sisters sis
    join public.tree_spouses s
      on coalesce(s.wife_is_family_member, false) = true
     and lower(btrim(coalesce(s.status, 'active'))) in ('', 'active')
     and (
       public.tree_arabic_norm_v1(coalesce(s.wife_lineage, '')) = public.tree_arabic_norm_v1(sis.path)
       or public.tree_nasab_nth_v1(coalesce(s.wife_name, s.wife_lineage, ''), 1) = sis.leaf
     )
     and (
       select count(*)
       from public.tree_spouses s2
       where coalesce(s2.wife_is_family_member, false) = true
         and lower(btrim(coalesce(s2.status, 'active'))) in ('', 'active')
         and (
           public.tree_arabic_norm_v1(coalesce(s2.wife_lineage, '')) = public.tree_arabic_norm_v1(sis.path)
           or public.tree_nasab_nth_v1(coalesce(s2.wife_name, s2.wife_lineage, ''), 1) = sis.leaf
         )
     ) = 1
  ),
  ibn_khala as (
    select c.id
    from public.tree_mother_links l
    join sister_spouses ss on ss.spouse_id = l.spouse_id
    join public.tree_children c on c.id = l.child_id
    where lower(btrim(coalesce(l.confidence, 'confirmed'))) in ('', 'confirmed')
      and not public.tree_child_is_daughter_v1(c.gender)
      and c.id <> p_viewer_id
  )
  select k.id, 'خالك'::text
  from khals k
  union all
  select i.id, 'ابن خالك'::text
  from ibn_khal i
  union all
  select x.id, 'ابن خالتك'::text
  from ibn_khala x;
end;
$fn$;

grant execute on function public.tree_arabic_norm_v1(text) to anon, authenticated;
grant execute on function public.tree_nasab_tokens_v1(text) to anon, authenticated;
grant execute on function public.tree_nasab_nth_v1(text, integer) to anon, authenticated;
grant execute on function public.tree_path_leaf_v1(text) to anon, authenticated;
grant execute on function public.tree_child_is_daughter_v1(text) to anon, authenticated;
grant execute on function public.tree_maternal_kinship_for_viewer_v1(bigint) to anon, authenticated;

notify pgrst, 'reload schema';

select
  (select to_regprocedure('public.tree_maternal_kinship_for_viewer_v1(bigint)') is not null)
    as has_maternal_rpc;
