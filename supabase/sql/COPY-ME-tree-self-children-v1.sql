-- COPY-ME: Preset id: maint.tree_self_children_v1
-- مسار الذات فقط: أبناء/بنات الحساب بعد الدخول. الفروع والبحث العام لا يتغيّران.
-- المصاهرة: husband_id = هذا الشخص، أو الزوجة هي الحساب (مسار أو اسمها+أبوها).
-- الأخت تُستثنى فقط إذا مسار الزوجة يطابق صف شقيق، لا لأن النسب يذكر الأب.
-- SECURITY DEFINER. آمن لإعادة التشغيل.

create or replace function public.tree_self_children_v1(p_phone text)
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
  v_leaf text;
  v_parent_leaf text;
  v_husband_id bigint;
  v_husband_path text;
  v_husband_branch text;
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
    c.branch_key
  into v_path, v_parent, v_branch
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
  v_leaf := public.tree_path_leaf_v1(v_path);
  v_parent_leaf := public.tree_path_leaf_v1(v_parent);

  select s.husband_id
    into v_husband_id
  from public.tree_spouses s
  where s.husband_id = v_id
    and not exists (
      select 1
      from public.tree_children sib
      where sib.id is distinct from v_id
        and (v_branch is null or sib.branch_key is not distinct from v_branch)
        and v_parent is not null
        and coalesce(sib.parent_name, to_jsonb(sib)->>'parent') is not distinct from v_parent
        and public.tree_arabic_norm_v1(replace(coalesce(s.wife_lineage, ''), '/', ' '))
          = public.tree_arabic_norm_v1(replace(coalesce(sib.child_name, sib.name, ''), '/', ' '))
    )
  order by
    case when lower(btrim(coalesce(s.status, 'active'))) in ('', 'active') then 0 else 1 end,
    s.id
  limit 1;

  if v_husband_id is null then
    select s.husband_id
      into v_husband_id
    from public.tree_spouses s
    where coalesce(s.wife_is_family_member, false) = true
      and (
        public.tree_arabic_norm_v1(replace(coalesce(s.wife_lineage, ''), '/', ' '))
          = public.tree_arabic_norm_v1(replace(coalesce(v_path, ''), '/', ' '))
        or (
          v_leaf is not null
          and v_parent_leaf is not null
          and public.tree_nasab_nth_v1(public.tree_wife_nasab_text_v1(s.wife_name, s.wife_lineage), 1)
            = v_leaf
          and public.tree_nasab_nth_v1(public.tree_wife_nasab_text_v1(s.wife_name, s.wife_lineage), 2)
            = v_parent_leaf
        )
      )
      and s.husband_id is distinct from v_id
      and not exists (
        select 1
        from public.tree_children h
        where h.id = s.husband_id
          and v_parent is not null
          and public.tree_arabic_norm_v1(coalesce(h.parent_name, to_jsonb(h)->>'parent', ''))
            = public.tree_arabic_norm_v1(v_parent)
      )
    order by
      case when lower(btrim(coalesce(s.status, 'active'))) in ('', 'active') then 0 else 1 end,
      s.id
    limit 1;
  end if;

  if v_husband_id is not null then
    if v_husband_id = v_id then
      v_husband_path := v_path;
      v_husband_branch := v_branch;
    else
      select coalesce(h.child_name, h.name), h.branch_key
        into v_husband_path, v_husband_branch
      from public.tree_children h
      where h.id = v_husband_id
      limit 1;
    end if;
  end if;

  return query
  with matching_spouses as (
    select s.id
    from public.tree_spouses s
    where
      (
        s.husband_id = v_id
        or (
          coalesce(s.wife_is_family_member, false) = true
          and (
            public.tree_arabic_norm_v1(replace(coalesce(s.wife_lineage, ''), '/', ' '))
              = public.tree_arabic_norm_v1(replace(coalesce(v_path, ''), '/', ' '))
            or (
              v_leaf is not null
              and v_parent_leaf is not null
              and public.tree_nasab_nth_v1(public.tree_wife_nasab_text_v1(s.wife_name, s.wife_lineage), 1)
                = v_leaf
              and public.tree_nasab_nth_v1(public.tree_wife_nasab_text_v1(s.wife_name, s.wife_lineage), 2)
                = v_parent_leaf
            )
          )
        )
      )
      and not exists (
        select 1
        from public.tree_children sib
        where sib.id is distinct from v_id
          and (v_branch is null or sib.branch_key is not distinct from v_branch)
          and v_parent is not null
          and coalesce(sib.parent_name, to_jsonb(sib)->>'parent') is not distinct from v_parent
          and public.tree_arabic_norm_v1(replace(coalesce(s.wife_lineage, ''), '/', ' '))
            = public.tree_arabic_norm_v1(replace(coalesce(sib.child_name, sib.name, ''), '/', ' '))
      )
  ),
  from_links as (
    select distinct
      c.id,
      coalesce(c.child_name, c.name) as path,
      c.gender,
      nullif(to_jsonb(c)->>'birth_order', '')::integer as birth_order
    from public.tree_mother_links l
    join public.tree_children c on c.id = l.child_id
    where lower(btrim(coalesce(l.confidence, 'confirmed'))) in ('', 'confirmed')
      and (
        l.spouse_id in (select ms.id from matching_spouses ms)
        or public.tree_arabic_norm_v1(replace(coalesce(l.mother_lineage, ''), '/', ' '))
             = public.tree_arabic_norm_v1(replace(coalesce(v_path, ''), '/', ' '))
      )
  ),
  from_parent as (
    select
      c.id,
      coalesce(c.child_name, c.name) as path,
      c.gender,
      nullif(to_jsonb(c)->>'birth_order', '')::integer as birth_order
    from public.tree_children c
    where v_husband_path is not null
      and c.id is distinct from v_id
      and c.id is distinct from v_husband_id
      and (v_husband_branch is null or c.branch_key is not distinct from v_husband_branch)
      and (
        coalesce(c.parent_name, to_jsonb(c)->>'parent') = v_husband_path
        or public.tree_arabic_norm_v1(coalesce(c.parent_name, to_jsonb(c)->>'parent', ''))
           = public.tree_arabic_norm_v1(v_husband_path)
      )
  ),
  united as (
    select * from from_links
    union
    select * from from_parent
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

grant execute on function public.tree_self_children_v1(text) to anon, authenticated;
notify pgrst, 'reload schema';

select
  (to_regprocedure('public.tree_self_children_v1(text)') is not null) as has_self_children_rpc;
