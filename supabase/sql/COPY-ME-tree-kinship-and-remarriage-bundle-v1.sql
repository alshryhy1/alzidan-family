-- COPY-ME: الصق مرة واحدة في Supabase → SQL Editor ثم Run
-- Preset id: maint.tree_kinship_and_remarriage_bundle_v1
--
-- حزمة نهائية عامة (آمنة للتكرار):
--   1) الزواج بعد الطلاق (حارس التكرار للنشيطات فقط + RPC الحفظ)
--   2) نسب الأم: أخ من أمك / خالك / ابن خالك / ابن خالتك لأي أم من العائلة
--   3) ربط جماعي: أبناء كل زوج بزوجته المسجّلة من العائلة
--
-- بعد التنفيذ: Hard Refresh لصفحة الإدارة والشجرة العامة.

-- ============================================================
-- 1) الزواج بعد الطلاق
-- ============================================================

-- Allow remarriage after divorce — spouse duplicate guard (active marriages only)
-- Apply in Supabase SQL editor if inserts fail with:
-- «هذه الزوجة مسجلة مسبقًا مع زوج آخر...» even after marking prior marriage as divorced.

create or replace function public.tree_spouses_wife_identity_key_v1(p_text text)
returns text
language sql
immutable
as $$
  select nullif(
    btrim(
      regexp_replace(
        regexp_replace(coalesce(p_text, ''), '\m(بن|ابن|بنت)\M', ' ', 'g'),
        '\s+',
        ' ',
        'g'
      )
    ),
    ''
  );
$$;

create or replace function public.tree_spouses_wife_identity_matches_v1(
  p_a_name text,
  p_a_lineage text,
  p_b_name text,
  p_b_lineage text
) returns boolean
language plpgsql
immutable
as $$
declare
  fa text[];
  fb text[];
  ka text;
  kb text;
  pa text[];
  pb text[];
  x text;
  y text;
begin
  fa := array_remove(array[p_a_lineage, p_a_name], null);
  fb := array_remove(array[p_b_lineage, p_b_name], null);
  if coalesce(array_length(fa, 1), 0) = 0 or coalesce(array_length(fb, 1), 0) = 0 then
    return false;
  end if;

  foreach x in array fa loop
    ka := public.tree_spouses_wife_identity_key_v1(x);
    if ka is null then
      continue;
    end if;
    pa := regexp_split_to_array(ka, '\s+');
    foreach y in array fb loop
      kb := public.tree_spouses_wife_identity_key_v1(y);
      if kb is null then
        continue;
      end if;
      if ka = kb then
        return true;
      end if;
      pb := regexp_split_to_array(kb, '\s+');
      if coalesce(array_length(pa, 1), 0) >= 3
         and coalesce(array_length(pb, 1), 0) >= 3
         and array_to_string(pa[1:3], ' ') = array_to_string(pb[1:3], ' ') then
        return true;
      end if;
      if coalesce(array_length(pa, 1), 0) >= 3
         and coalesce(array_length(pb, 1), 0) = 2
         and array_to_string(pa[1:2], ' ') = array_to_string(pb, ' ') then
        return true;
      end if;
      if coalesce(array_length(pb, 1), 0) >= 3
         and coalesce(array_length(pa, 1), 0) = 2
         and array_to_string(pb[1:2], ' ') = array_to_string(pa, ' ') then
        return true;
      end if;
    end loop;
  end loop;

  return false;
end;
$$;

create or replace function public.tree_spouses_guard_duplicate_wife_v1()
returns trigger
language plpgsql
as $$
declare
  v_other public.tree_spouses%rowtype;
begin
  if lower(btrim(coalesce(new.status, 'active'))) not in ('', 'active') then
    return new;
  end if;

  for v_other in
    select s.*
    from public.tree_spouses s
    where s.id is distinct from new.id
      and s.husband_id is distinct from new.husband_id
      and lower(btrim(coalesce(s.status, 'active'))) in ('', 'active')
  loop
    if public.tree_spouses_wife_identity_matches_v1(
      new.wife_name,
      new.wife_lineage,
      v_other.wife_name,
      v_other.wife_lineage
    ) then
      raise exception using
        message = 'هذه الزوجة مسجلة نشطة مع زوج آخر. افتح الزوج السابق → تعديل الزوجة → غيّر الحالة إلى «مطلقة»، ثم أعد الإضافة.';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists tree_spouses_duplicate_wife_guard on public.tree_spouses;
drop trigger if exists tree_spouses_guard_duplicate_wife on public.tree_spouses;

create trigger tree_spouses_guard_duplicate_wife
  before insert or update of wife_name, wife_lineage, status, husband_id
  on public.tree_spouses
  for each row
  execute function public.tree_spouses_guard_duplicate_wife_v1();

-- Admin RPC: bypass legacy duplicate triggers + end prior active marriages on remarriage.
create or replace function public.admin_tree_spouse_upsert_v1(
  p_token text,
  p_spouse_id bigint,
  p_row jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
  v_husband_id bigint;
  v_other record;
  v_status text;
  v_family boolean;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;
  if to_regclass('public.tree_spouses') is null then
    raise exception 'tree_spouses table missing';
  end if;

  v_husband_id := nullif(p_row->>'husband_id', '')::bigint;
  if v_husband_id is null then
    raise exception 'missing husband_id';
  end if;

  v_status := lower(btrim(coalesce(p_row->>'status', 'active')));
  if v_status not in ('', 'active', 'divorced', 'مطلقة') then
    v_status := 'active';
  end if;
  if v_status in ('', 'active') then
    v_status := 'active';
  else
    v_status := 'divorced';
  end if;

  if p_row ? 'wife_is_family_member' then
    if jsonb_typeof(p_row->'wife_is_family_member') = 'boolean' then
      v_family := (p_row->>'wife_is_family_member')::boolean;
    elsif lower(btrim(coalesce(p_row->>'wife_is_family_member', ''))) in ('true', 't', '1', 'yes', 'نعم') then
      v_family := true;
    elsif lower(btrim(coalesce(p_row->>'wife_is_family_member', ''))) in ('false', 'f', '0', 'no', 'لا') then
      v_family := false;
    else
      v_family := null;
    end if;
  else
    v_family := null;
  end if;

  for v_other in
    select s.*
    from public.tree_spouses s
    where s.id is distinct from coalesce(p_spouse_id, 0)
      and s.husband_id is distinct from v_husband_id
      and lower(btrim(coalesce(s.status, 'active'))) in ('', 'active')
  loop
    if public.tree_spouses_wife_identity_matches_v1(
      p_row->>'wife_name',
      p_row->>'wife_lineage',
      v_other.wife_name,
      v_other.wife_lineage
    ) then
      update public.tree_spouses
      set status = 'divorced', updated_at = now()
      where id = v_other.id;
    end if;
  end loop;

  alter table public.tree_spouses disable trigger user;

  if p_spouse_id is not null and p_spouse_id > 0 then
    update public.tree_spouses s
    set
      husband_id = v_husband_id,
      husband_person_id = nullif(p_row->>'husband_person_id', '')::uuid,
      wife_name = nullif(btrim(coalesce(p_row->>'wife_name', '')), ''),
      wife_is_family_member = v_family,
      wife_branch_key = nullif(btrim(coalesce(p_row->>'wife_branch_key', '')), ''),
      wife_family_name = nullif(btrim(coalesce(p_row->>'wife_family_name', '')), ''),
      wife_lineage = nullif(btrim(coalesce(p_row->>'wife_lineage', '')), ''),
      marriage_order = nullif(p_row->>'marriage_order', '')::int,
      status = v_status,
      confidence = nullif(btrim(coalesce(p_row->>'confidence', 'confirmed')), ''),
      data_source = nullif(btrim(coalesce(p_row->>'data_source', 'admin')), ''),
      updated_at = coalesce(nullif(p_row->>'updated_at', '')::timestamptz, now())
    where s.id = p_spouse_id
    returning s.id into v_id;
  else
    insert into public.tree_spouses (
      husband_id,
      husband_person_id,
      wife_name,
      wife_is_family_member,
      wife_branch_key,
      wife_family_name,
      wife_lineage,
      marriage_order,
      status,
      confidence,
      data_source,
      updated_at
    ) values (
      v_husband_id,
      nullif(p_row->>'husband_person_id', '')::uuid,
      nullif(btrim(coalesce(p_row->>'wife_name', '')), ''),
      v_family,
      nullif(btrim(coalesce(p_row->>'wife_branch_key', '')), ''),
      nullif(btrim(coalesce(p_row->>'wife_family_name', '')), ''),
      nullif(btrim(coalesce(p_row->>'wife_lineage', '')), ''),
      nullif(p_row->>'marriage_order', '')::int,
      v_status,
      nullif(btrim(coalesce(p_row->>'confidence', 'confirmed')), ''),
      nullif(btrim(coalesce(p_row->>'data_source', 'admin')), ''),
      coalesce(nullif(p_row->>'updated_at', '')::timestamptz, now())
    )
    returning id into v_id;
  end if;

  alter table public.tree_spouses enable trigger user;

  if v_id is null then
    raise exception 'spouse upsert failed';
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
exception
  when others then
    begin
      alter table public.tree_spouses enable trigger user;
    exception
      when others then null;
    end;
    raise;
end;
$$;

revoke all on function public.admin_tree_spouse_upsert_v1(text, bigint, jsonb) from public;
grant execute on function public.admin_tree_spouse_upsert_v1(text, bigint, jsonb) to anon, authenticated;

-- ============================================================
-- 2) نسب الأم الكامل
-- ============================================================

-- COPY-ME: run in Supabase SQL Editor / SQL Workspace
-- Preset id: maint.tree_maternal_kinship_v3
--
-- General maternal kinship for ANY family-member mother:
--   أخ من أمك / خالك / ابن خالك / ابن خالتك
-- Matches mother identity across different spouse rows (different husbands).
-- Safe to re-run.

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

create or replace function public.tree_mother_spouses_share_identity_v1(
  p_lineage_a text,
  p_name_a text,
  p_lineage_b text,
  p_name_b text
)
returns boolean
language sql
immutable
as $$
  select
    (
      coalesce(nullif(btrim(p_lineage_a), ''), nullif(btrim(p_name_a), '')) is not null
      and coalesce(nullif(btrim(p_lineage_b), ''), nullif(btrim(p_name_b), '')) is not null
    )
    and (
      (
        nullif(btrim(p_lineage_a), '') is not null
        and nullif(btrim(p_lineage_b), '') is not null
        and public.tree_arabic_norm_v1(p_lineage_a) = public.tree_arabic_norm_v1(p_lineage_b)
      )
      or (
        nullif(btrim(p_name_a), '') is not null
        and nullif(btrim(p_name_b), '') is not null
        and public.tree_arabic_norm_v1(p_name_a) = public.tree_arabic_norm_v1(p_name_b)
      )
      or (
        public.tree_nasab_nth_v1(coalesce(p_name_a, p_lineage_a, ''), 1) is not null
        and public.tree_nasab_nth_v1(coalesce(p_name_a, p_lineage_a, ''), 1)
          = public.tree_nasab_nth_v1(coalesce(p_name_b, p_lineage_b, ''), 1)
      )
      or (
        public.tree_nasab_nth_v1(coalesce(p_name_a, p_lineage_a, ''), 1) is not null
        and public.tree_nasab_nth_v1(coalesce(p_name_a, p_lineage_a, ''), 2) is not null
        and public.tree_nasab_nth_v1(coalesce(p_name_b, p_lineage_b, ''), 1) is not null
        and public.tree_nasab_nth_v1(coalesce(p_name_b, p_lineage_b, ''), 2) is not null
        and public.tree_nasab_nth_v1(coalesce(p_name_a, p_lineage_a, ''), 1)
          = public.tree_nasab_nth_v1(coalesce(p_name_b, p_lineage_b, ''), 1)
        and public.tree_nasab_nth_v1(coalesce(p_name_a, p_lineage_a, ''), 2)
          = public.tree_nasab_nth_v1(coalesce(p_name_b, p_lineage_b, ''), 2)
      )
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

  return query
  with matching_spouses as (
    select s.id
    from public.tree_spouses s
    where coalesce(s.wife_is_family_member, false) = true
      and lower(btrim(coalesce(s.status, 'active'))) in ('', 'active')
      and (
        s.id = v_spouse_id
        or public.tree_mother_spouses_share_identity_v1(
          v_lineage,
          v_wife_name,
          s.wife_lineage,
          s.wife_name
        )
      )
  ),
  maternal_brothers as (
    select distinct l.child_id as id
    from public.tree_mother_links l
    join matching_spouses ms on ms.id = l.spouse_id
    join public.tree_children c on c.id = l.child_id
    where lower(btrim(coalesce(l.confidence, 'confirmed'))) in ('', 'confirmed')
      and not public.tree_child_is_daughter_v1(c.gender)
      and l.child_id <> p_viewer_id
  ),
  khals as (
    select c.id, coalesce(c.child_name, c.name) as path, c.branch_key
    from public.tree_children c
    where v_gf_path is not null
      and coalesce(c.parent_name, c.parent) = v_gf_path
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
    where v_gf_path is not null
      and coalesce(c.parent_name, c.parent) = v_gf_path
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
  select mb.id, 'أخ من أمك'::text
  from maternal_brothers mb
  union all
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
grant execute on function public.tree_mother_spouses_share_identity_v1(text, text, text, text) to anon, authenticated;
grant execute on function public.tree_maternal_kinship_for_viewer_v1(bigint) to anon, authenticated;

notify pgrst, 'reload schema';

select
  (select to_regprocedure('public.tree_maternal_kinship_for_viewer_v1(bigint)') is not null)
    as has_maternal_rpc;

-- ============================================================
-- 3) ربط جماعي للأبناء الموجودين
-- ============================================================

-- COPY-ME: run once in Supabase SQL Editor
-- Preset id: maint.tree_mother_links_backfill_v1
--
-- Backfill tree_mother_links for ALL active family-member wives:
-- links every son of the husband to the mother's spouse row.
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
