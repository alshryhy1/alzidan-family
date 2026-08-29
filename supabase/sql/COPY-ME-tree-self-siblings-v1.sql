-- COPY-ME: Preset id: maint.tree_self_siblings_v1
-- مسار الذات فقط: أخوات الحساب بعد الدخول. الفروع والبحث العام لا يتغيّران.
-- البوابة: جوال عضو مربوط بصف شجرة. SECURITY DEFINER يقرأ البنات المخفيات.
-- آمن لإعادة التشغيل. CREATE OR REPLACE فقط.

create or replace function public.tree_self_siblings_v1(p_phone text)
returns table(
  id bigint,
  leaf_name text,
  gender text,
  birth_order integer
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_digits text;
  v_id bigint;
  v_path text;
  v_parent text;
  v_branch text;
  v_father_pid text;
begin
  v_digits := nullif(right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 9), '');
  if v_digits is null or char_length(v_digits) < 9 then
    return;
  end if;

  select mp.tree_child_id
    into v_id
  from public.member_profiles mp
  where coalesce(mp.status, 'active') = 'active'
    and right(regexp_replace(coalesce(mp.phone, ''), '[^0-9]', '', 'g'), 9) = v_digits
    and coalesce(mp.tree_child_id, 0) > 0
  order by mp.updated_at desc nulls last, mp.id desc
  limit 1;

  if v_id is null then
    return;
  end if;

  select
    coalesce(c.child_name, c.name),
    coalesce(c.parent_name, to_jsonb(c)->>'parent'),
    c.branch_key,
    nullif(btrim(coalesce(to_jsonb(c)->>'parent_person_id', '')), '')
  into v_path, v_parent, v_branch, v_father_pid
  from public.tree_children c
  where c.id = v_id
  limit 1;

  if v_path is null then
    return;
  end if;

  v_path := nullif(btrim(v_path), '');
  v_parent := nullif(btrim(coalesce(v_parent, '')), '');
  if v_parent is null and v_path is not null and position('/' in v_path) > 0 then
    v_parent := regexp_replace(v_path, '/[^/]+$', '');
  end if;

  return query
  with from_father as (
    select
      c.id,
      coalesce(c.child_name, c.name) as path,
      c.gender,
      nullif(to_jsonb(c)->>'birth_order', '')::integer as birth_order
    from public.tree_children c
    where c.id is distinct from v_id
      and (v_branch is null or c.branch_key is not distinct from v_branch)
      and (
        (
          v_father_pid is not null
          and nullif(btrim(coalesce(to_jsonb(c)->>'parent_person_id', '')), '') = v_father_pid
        )
        or (
          v_parent is not null
          and (
            coalesce(c.parent_name, to_jsonb(c)->>'parent') = v_parent
            or public.tree_arabic_norm_v1(coalesce(c.parent_name, to_jsonb(c)->>'parent', ''))
               = public.tree_arabic_norm_v1(v_parent)
          )
        )
      )
  ),
  from_mother as (
    select
      c.id,
      coalesce(c.child_name, c.name) as path,
      c.gender,
      nullif(to_jsonb(c)->>'birth_order', '')::integer as birth_order
    from public.tree_mother_links mine
    join public.tree_mother_links sib
      on sib.spouse_id = mine.spouse_id
    join public.tree_children c on c.id = sib.child_id
    where mine.child_id = v_id
      and mine.spouse_id is not null
      and lower(btrim(coalesce(mine.confidence, 'confirmed'))) in ('', 'confirmed')
      and lower(btrim(coalesce(sib.confidence, 'confirmed'))) in ('', 'confirmed')
      and c.id is distinct from v_id
  ),
  united as (
    select * from from_father
    union
    select * from from_mother
  )
  select
    u.id,
    nullif(btrim(regexp_replace(coalesce(u.path, ''), '^.*/', '')), ''),
    u.gender,
    u.birth_order
  from united u
  where u.id is distinct from v_id
  order by u.birth_order nulls last, u.id
  limit 80;
end;
$fn$;

grant execute on function public.tree_self_siblings_v1(text) to anon, authenticated;
notify pgrst, 'reload schema';

select
  (to_regprocedure('public.tree_self_siblings_v1(text)') is not null) as has_self_siblings_rpc;
