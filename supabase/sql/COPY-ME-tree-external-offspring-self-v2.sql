-- COPY-ME: Preset id: maint.tree_external_offspring_self_v2
-- Self-path read: mother = login tree_child_id or same person_id UUID.
-- No name matching. Safe to re-run. Does not touch tree_children.

create or replace function public.tree_external_offspring_for_self_v1(p_phone text)
returns table(
  id bigint,
  offspring_id uuid,
  child_name text,
  gender text,
  father_name text
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_digits text;
  v_mother_id bigint;
  v_person_id uuid;
begin
  v_digits := nullif(right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 9), '');
  if v_digits is null or char_length(v_digits) < 9 then
    return;
  end if;
  select mp.tree_child_id
    into v_mother_id
  from public.member_profiles mp
  where coalesce(mp.status, 'active') = 'active'
    and right(regexp_replace(coalesce(mp.phone, ''), '[^0-9]', '', 'g'), 9) = v_digits
    and coalesce(mp.tree_child_id, 0) > 0
  order by mp.updated_at desc nulls last, mp.id desc
  limit 1;
  if v_mother_id is null then
    return;
  end if;

  select c.person_id
    into v_person_id
  from public.tree_children c
  where c.id = v_mother_id
  limit 1;

  return query
  select e.id, e.offspring_id, e.child_name, e.gender, e.father_name
  from public.tree_external_offspring e
  where e.mother_tree_child_id = v_mother_id
     or (v_person_id is not null and e.mother_person_id is not distinct from v_person_id)
  order by e.id;
end;
$fn$;

grant execute on function public.tree_external_offspring_for_self_v1(text) to anon, authenticated;
notify pgrst, 'reload schema';

select to_regprocedure('public.tree_external_offspring_for_self_v1(text)') is not null as has_self_rpc;
