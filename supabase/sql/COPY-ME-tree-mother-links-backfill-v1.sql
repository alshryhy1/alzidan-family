-- COPY-ME: run once in Supabase SQL Editor
-- Preset id: maint.tree_mother_links_backfill_v1
--
-- Links sons to a family-member wife ONLY when that husband has exactly
-- one active wife. Does not assume motherhood when there are two wives.
-- Safe to re-run (upsert on child_id).

insert into public.tree_mother_links (
  child_id,
  spouse_id,
  mother_name,
  mother_is_family_member,
  mother_branch_key,
  mother_family_name,
  mother_lineage,
  confidence,
  updated_at
)
select
  c.id as child_id,
  s.id as spouse_id,
  s.wife_name,
  s.wife_is_family_member,
  s.wife_branch_key,
  s.wife_family_name,
  s.wife_lineage,
  'confirmed',
  now()
from public.tree_spouses s
join public.tree_children h on h.id = s.husband_id
join public.tree_children c
  on c.branch_key = h.branch_key
 and (
   coalesce(c.parent_name, c.parent) = coalesce(h.child_name, h.name)
   or coalesce(c.parent_name, c.parent) = public.tree_path_leaf_v1(coalesce(h.child_name, h.name))
 )
where coalesce(s.wife_is_family_member, false) = true
  and lower(btrim(coalesce(s.status, 'active'))) in ('', 'active')
  and not public.tree_child_is_daughter_v1(c.gender)
  and (
    select count(*)
    from public.tree_spouses s2
    where s2.husband_id = s.husband_id
      and lower(btrim(coalesce(s2.status, 'active'))) in ('', 'active')
  ) = 1
on conflict (child_id) do update set
  spouse_id = excluded.spouse_id,
  mother_name = excluded.mother_name,
  mother_is_family_member = excluded.mother_is_family_member,
  mother_branch_key = excluded.mother_branch_key,
  mother_family_name = excluded.mother_family_name,
  mother_lineage = excluded.mother_lineage,
  confidence = excluded.confidence,
  updated_at = excluded.updated_at;

select count(*) as mother_links_total from public.tree_mother_links;
