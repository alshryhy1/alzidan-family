-- Open this file, Select All, paste in Supabase SQL Editor
-- Read-only: two women named وضحاء. Does not UPDATE/DELETE.

select
  c.id as tree_child_id,
  c.person_id,
  c.parent_person_id,
  coalesce(c.parent_name, c.parent) as parent_path,
  coalesce(c.child_name, c.name) as person_path,
  c.gender,
  c.branch_key
from public.tree_children c
where coalesce(c.child_name, c.name, '') ilike '%وضحاء%'
order by coalesce(c.parent_name, c.parent, ''), c.id;
