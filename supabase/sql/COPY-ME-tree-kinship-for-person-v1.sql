-- Identity: person_id / full path / parent path. Same first name is never a join key.

-- Proven male relatives for ANY person (security definer; daughters stay hidden):
--   أخ من أمك / حفيدك / حفيدك من ابنتك / ابن أخيك / ابن أختك / عمك / ابن عمك / ابنك
-- Also: tree_member_viewer_v1(phone) loads the member's own tree row (including
-- daughters) so a registered daughter gets عمك / ابن أخيك from her father path.
-- Safe to re-run. Small CREATE OR REPLACE.

drop function if exists public.tree_member_viewer_v1(text);

create or replace function public.tree_member_viewer_v1(p_phone text)
returns table(
  id bigint,
  child_name text,
  parent_name text,
  branch_key text,
  gender text,
  display_name text,
  photo_url text
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_digits text;
  v_child_id bigint;
  v_display text;
  v_branch text;
begin
  v_digits := nullif(right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 9), '');
  if v_digits is null or char_length(v_digits) < 9 then
    return;
  end if;

  select mp.tree_child_id, mp.display_name, mp.branch_key
    into v_child_id, v_display, v_branch
  from public.member_profiles mp
  where coalesce(mp.status, 'active') = 'active'
    and right(regexp_replace(coalesce(mp.phone, ''), '[^0-9]', '', 'g'), 9) = v_digits
  order by mp.updated_at desc nulls last, mp.id desc
  limit 1;

  if v_child_id is null then
    return;
  end if;

  return query
  select
    c.id,
    coalesce(c.child_name, c.name),
    coalesce(c.parent_name, c.parent),
    coalesce(c.branch_key, v_branch),
    c.gender,
    coalesce(
      nullif(btrim(v_display), ''),
      nullif(btrim(regexp_replace(coalesce(c.child_name, c.name, ''), '^.*/', '')), '')
    ),
    c.photo_url
  from public.tree_children c
  where c.id = v_child_id
  limit 1;
end;
$fn$;

create or replace function public.tree_wife_nasab_text_v1(p_name text, p_lineage text)
returns text
language sql
immutable
as $$
  select coalesce(
    case
      when coalesce(cardinality(public.tree_nasab_tokens_v1(p_lineage)), 0)
         >= coalesce(cardinality(public.tree_nasab_tokens_v1(p_name)), 0)
      then nullif(btrim(coalesce(p_lineage, '')), '')
      else nullif(btrim(coalesce(p_name, '')), '')
    end,
    nullif(btrim(coalesce(p_name, '')), ''),
    nullif(btrim(coalesce(p_lineage, '')), '')
  );
$$;

grant execute on function public.tree_wife_nasab_text_v1(text, text) to anon, authenticated;

create or replace function public.tree_kinship_for_person_v1(p_person_id bigint)
returns table(person_id bigint, label text)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_path text;
  v_parent text;
  v_branch text;
  v_gf_path text;
  v_father_leaf text;
  v_spouse_id bigint;
  v_lineage text;
  v_wife_name text;
begin
  if p_person_id is null or p_person_id < 1 then
    return;
  end if;

  select
    coalesce(c.child_name, c.name),
    coalesce(c.parent_name, c.parent),
    c.branch_key
  into v_path, v_parent, v_branch
  from public.tree_children c
  where c.id = p_person_id
  limit 1;

  if v_path is null then
    return;
  end if;

  v_path := nullif(btrim(v_path), '');
  v_parent := nullif(btrim(coalesce(v_parent, '')), '');
  if v_parent is null and v_path is not null and position('/' in v_path) > 0 then
    v_parent := regexp_replace(v_path, '/[^/]+$', '');
  elsif v_parent is not null and v_path is not null and position('/' in v_path) = 0 then
    v_path := v_parent || '/' || public.tree_path_leaf_v1(v_path);
  end if;
  v_gf_path := case
    when v_parent is not null and position('/' in v_parent) > 0
      then regexp_replace(v_parent, '/[^/]+$', '')
    else null
  end;
  v_father_leaf := public.tree_path_leaf_v1(v_parent);

  select
    l.spouse_id,
    nullif(btrim(coalesce(s.wife_lineage, l.mother_lineage, '')), ''),
    nullif(btrim(coalesce(s.wife_name, l.mother_name, '')), '')
  into v_spouse_id, v_lineage, v_wife_name
  from public.tree_mother_links l
  left join public.tree_spouses s on s.id = l.spouse_id
  where l.child_id = p_person_id
    and lower(btrim(coalesce(l.confidence, 'confirmed'))) in ('', 'confirmed')
  order by l.child_id
  limit 1;

  return query
  with matching_mother_spouses as (
    select s.id
    from public.tree_spouses s
    where v_spouse_id is not null
      and coalesce(s.wife_is_family_member, false) = true
      and (
        s.id = v_spouse_id
        or public.tree_mother_spouses_share_identity_v1(
          v_lineage, v_wife_name, s.wife_lineage, s.wife_name
        )
      )
  ),
  maternal_brothers as (
    select distinct l.child_id as id
    from public.tree_mother_links l
    join matching_mother_spouses ms on ms.id = l.spouse_id
    join public.tree_children c on c.id = l.child_id
    join public.tree_children me on me.id = p_person_id
    where lower(btrim(coalesce(l.confidence, 'confirmed'))) in ('', 'confirmed')
      and not public.tree_child_is_daughter_v1(c.gender)
      and l.child_id <> p_person_id
      and public.tree_arabic_norm_v1(coalesce(c.parent_name, c.parent, ''))
        is distinct from public.tree_arabic_norm_v1(coalesce(me.parent_name, me.parent, ''))
  ),
  sons as (
    select c.id, coalesce(c.child_name, c.name) as path, c.branch_key
    from public.tree_children c
    where public.tree_arabic_norm_v1(coalesce(c.parent_name, c.parent, ''))
        = public.tree_arabic_norm_v1(v_path)
      and not public.tree_child_is_daughter_v1(c.gender)
  ),
  grandsons_sons as (
    select g.id
    from public.tree_children g
    join sons s on coalesce(g.parent_name, g.parent) = s.path and g.branch_key = s.branch_key
    where not public.tree_child_is_daughter_v1(g.gender)
  ),
  daughters as (
    select c.id, coalesce(c.child_name, c.name) as path, c.branch_key,
           public.tree_path_leaf_v1(coalesce(c.child_name, c.name)) as leaf
    from public.tree_children c
    where public.tree_arabic_norm_v1(coalesce(c.parent_name, c.parent, ''))
        = public.tree_arabic_norm_v1(v_path)
      and public.tree_child_is_daughter_v1(c.gender)
  ),
  daughter_spouses as (
    select distinct s.id as spouse_id
    from daughters d
    join public.tree_spouses s
      on coalesce(s.wife_is_family_member, false) = true
     and (
       public.tree_arabic_norm_v1(coalesce(s.wife_lineage, '')) = public.tree_arabic_norm_v1(d.path)
       or (
         public.tree_nasab_nth_v1(public.tree_wife_nasab_text_v1(s.wife_name, s.wife_lineage), 1) = d.leaf
         and public.tree_nasab_nth_v1(public.tree_wife_nasab_text_v1(s.wife_name, s.wife_lineage), 2) is not null
         and public.tree_nasab_nth_v1(public.tree_wife_nasab_text_v1(s.wife_name, s.wife_lineage), 2)
           = public.tree_path_leaf_v1(v_path)
       )
     )
  ),
  grandsons_daughters as (
    select distinct c.id
    from public.tree_mother_links l
    join daughter_spouses ds on ds.spouse_id = l.spouse_id
    join public.tree_children c on c.id = l.child_id
    where lower(btrim(coalesce(l.confidence, 'confirmed'))) in ('', 'confirmed')
      and not public.tree_child_is_daughter_v1(c.gender)
  ),
  brothers as (
    select c.id, coalesce(c.child_name, c.name) as path, c.branch_key
    from public.tree_children c
    where v_parent is not null
      and public.tree_arabic_norm_v1(coalesce(c.parent_name, c.parent, ''))
        = public.tree_arabic_norm_v1(v_parent)
      and (v_branch is null or c.branch_key = v_branch)
      and c.id <> p_person_id
      and not public.tree_child_is_daughter_v1(c.gender)
  ),
  nephews_brothers as (
    select n.id
    from public.tree_children n
    join brothers b on coalesce(n.parent_name, n.parent) = b.path and n.branch_key = b.branch_key
    where not public.tree_child_is_daughter_v1(n.gender)
  ),
  sisters as (
    select c.id, coalesce(c.child_name, c.name) as path, c.branch_key,
           public.tree_path_leaf_v1(coalesce(c.child_name, c.name)) as leaf
    from public.tree_children c
    where v_parent is not null
      and public.tree_arabic_norm_v1(coalesce(c.parent_name, c.parent, ''))
        = public.tree_arabic_norm_v1(v_parent)
      and (v_branch is null or c.branch_key = v_branch)
      and c.id <> p_person_id
      and public.tree_child_is_daughter_v1(c.gender)
  ),
  sister_spouses as (
    select distinct s.id as spouse_id
    from sisters sis
    join public.tree_spouses s
      on coalesce(s.wife_is_family_member, false) = true
     and (
       public.tree_arabic_norm_v1(coalesce(s.wife_lineage, '')) = public.tree_arabic_norm_v1(sis.path)
       or (
         public.tree_nasab_nth_v1(public.tree_wife_nasab_text_v1(s.wife_name, s.wife_lineage), 1) = sis.leaf
         and v_father_leaf is not null
         and public.tree_nasab_nth_v1(public.tree_wife_nasab_text_v1(s.wife_name, s.wife_lineage), 2) = v_father_leaf
       )
       or (
         public.tree_nasab_nth_v1(public.tree_wife_nasab_text_v1(s.wife_name, s.wife_lineage), 1) = sis.leaf
         and public.tree_arabic_norm_v1(regexp_replace(coalesce(s.wife_lineage, ''), '/[^/]+$', ''))
           = public.tree_arabic_norm_v1(v_parent)
       )
     )
    union
    select s.id
    from public.tree_spouses s
    where coalesce(s.wife_is_family_member, false) = true
      and v_parent is not null
      and position('/' in coalesce(s.wife_lineage, '')) > 0
      and public.tree_arabic_norm_v1(regexp_replace(s.wife_lineage, '/[^/]+$', ''))
        = public.tree_arabic_norm_v1(v_parent)
      and public.tree_arabic_norm_v1(s.wife_lineage)
        is distinct from public.tree_arabic_norm_v1(v_path)
  ),
  nephews_sisters as (
    select distinct c.id
    from public.tree_mother_links l
    join sister_spouses ss on ss.spouse_id = l.spouse_id
    join public.tree_children c on c.id = l.child_id
    where lower(btrim(coalesce(l.confidence, 'confirmed'))) in ('', 'confirmed')
      and not public.tree_child_is_daughter_v1(c.gender)
      and c.id <> p_person_id
  )
  select mb.id, 'أخ من أمك'::text from maternal_brothers mb
  union all
  select gs.id, 'حفيدك'::text from grandsons_sons gs
  union all
  select gd.id, 'حفيدك من ابنتك'::text from grandsons_daughters gd
  union all
  select nb.id, 'ابن أخيك'::text from nephews_brothers nb
  union all
  select ns.id, 'ابن أختك'::text from nephews_sisters ns
  union all
  select u.id, 'عمك'::text from (
    select c.id
    from public.tree_children c
    where v_gf_path is not null
      and public.tree_arabic_norm_v1(coalesce(c.parent_name, c.parent, ''))
        = public.tree_arabic_norm_v1(v_gf_path)
      and (v_branch is null or c.branch_key = v_branch)
      and public.tree_arabic_norm_v1(coalesce(c.child_name, c.name, ''))
            is distinct from public.tree_arabic_norm_v1(v_parent)
      and not public.tree_child_is_daughter_v1(c.gender)
  ) u
  union all
  select us.id, 'ابن عمك'::text from (
    select n.id
    from public.tree_children n
    join public.tree_children u
      on coalesce(n.parent_name, n.parent) = coalesce(u.child_name, u.name)
     and n.branch_key = u.branch_key
    where v_gf_path is not null
      and public.tree_arabic_norm_v1(coalesce(u.parent_name, u.parent, ''))
        = public.tree_arabic_norm_v1(v_gf_path)
      and (v_branch is null or u.branch_key = v_branch)
      and public.tree_arabic_norm_v1(coalesce(u.child_name, u.name, ''))
            is distinct from public.tree_arabic_norm_v1(v_parent)
      and not public.tree_child_is_daughter_v1(u.gender)
      and not public.tree_child_is_daughter_v1(n.gender)
  ) us
  union all
  select os.id, 'ابنك'::text from (
    select distinct c.id
    from public.tree_spouses s
    join public.tree_mother_links l on l.spouse_id = s.id
    join public.tree_children c on c.id = l.child_id
    where coalesce(s.wife_is_family_member, false) = true
      and lower(btrim(coalesce(l.confidence, 'confirmed'))) in ('', 'confirmed')
      and not public.tree_child_is_daughter_v1(c.gender)
      and (
        public.tree_arabic_norm_v1(coalesce(s.wife_lineage, '')) = public.tree_arabic_norm_v1(v_path)
        or (
          public.tree_nasab_nth_v1(public.tree_wife_nasab_text_v1(s.wife_name, s.wife_lineage), 1) = public.tree_path_leaf_v1(v_path)
          and public.tree_nasab_nth_v1(public.tree_wife_nasab_text_v1(s.wife_name, s.wife_lineage), 2)
            = public.tree_path_leaf_v1(v_parent)
        )
      )
  ) os;
end;
$fn$;

grant execute on function public.tree_member_viewer_v1(text) to anon, authenticated;
grant execute on function public.tree_kinship_for_person_v1(bigint) to anon, authenticated;
notify pgrst, 'reload schema';
select
  (to_regprocedure('public.tree_kinship_for_person_v1(bigint)') is not null) as has_kinship_rpc,
  (to_regprocedure('public.tree_member_viewer_v1(text)') is not null) as has_member_viewer_rpc;
