-- COPY-ME: Preset id: maint.tree_admin_full_names_v1
-- شجرة الإدارة (والمندوب): أسماء الإناث تظهر. SETOF كان يعيد RLS فيخفي البنات حتى عن الإدارة.
-- أنثى مسجّلة: الشجرة كاملة. ذكر مسجّل: فروع رجال فقط. الزائر: رجال فقط. لا يغيّر سياسة الإخفاء العامة.

drop function if exists public.tree_member_lineage_children_v1(text);

create function public.tree_member_lineage_children_v1(p_phone text)
returns table(
  id bigint,
  branch_key text,
  parent_name text,
  name text,
  child_name text,
  birth_order integer,
  birth_date_g text,
  birth_date_h text,
  birth_year integer,
  death_date_g text,
  death_date_h text,
  city text,
  area text,
  is_deceased boolean,
  deceased boolean,
  gender text,
  photo_url text
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_digits text;
  v_id bigint;
  v_gender text;
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

  select c.gender
    into v_gender
  from public.tree_children c
  where c.id = v_id
  limit 1;

  if not (
    lower(btrim(coalesce(v_gender, ''))) in (
      'daughter', 'female', 'f', 'أنثى', 'انثى', 'ابنة', 'بنت'
    )
  ) then
    return;
  end if;

  return query
    select
      c.id,
      c.branch_key,
      coalesce(c.parent_name, to_jsonb(c)->>'parent'),
      coalesce(c.name, c.child_name),
      c.child_name,
      nullif(to_jsonb(c)->>'birth_order', '')::integer,
      nullif(btrim(coalesce(to_jsonb(c)->>'birth_date_g', '')), ''),
      nullif(btrim(coalesce(to_jsonb(c)->>'birth_date_h', '')), ''),
      nullif(to_jsonb(c)->>'birth_year', '')::integer,
      nullif(btrim(coalesce(to_jsonb(c)->>'death_date_g', '')), ''),
      nullif(btrim(coalesce(to_jsonb(c)->>'death_date_h', '')), ''),
      c.city,
      c.area,
      c.is_deceased,
      nullif(to_jsonb(c)->>'deceased', '')::boolean,
      c.gender,
      nullif(btrim(coalesce(to_jsonb(c)->>'photo_url', '')), '')
    from public.tree_children c
    order by c.id
    limit 20000;
end;
$fn$;

grant execute on function public.tree_member_lineage_children_v1(text) to anon, authenticated;

-- شجرة الإدارة: SETOF tree_children كان يعيد تطبيق RLS فيخفي البنات حتى عن الإدارة.
drop function if exists public.admin_tree_children_list_v1(text, text);

create function public.admin_tree_children_list_v1(p_token text, p_branch_key text)
returns table(
  id bigint,
  person_id text,
  parent_person_id text,
  parent_name text,
  parent text,
  child_name text,
  name text,
  branch_key text,
  gender text,
  photo_url text,
  birth_date_g text,
  birth_date_h text,
  birth_year integer,
  birth_order integer,
  death_date_g text,
  death_date_h text,
  city text,
  area text,
  is_deceased boolean,
  deceased boolean
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_branch text;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;
  v_branch := nullif(btrim(coalesce(p_branch_key, '')), '');
  if v_branch is null then
    return;
  end if;
  return query
    select
      c.id,
      nullif(btrim(coalesce(to_jsonb(c)->>'person_id', '')), ''),
      nullif(btrim(coalesce(to_jsonb(c)->>'parent_person_id', '')), ''),
      coalesce(c.parent_name, to_jsonb(c)->>'parent'),
      coalesce(c.parent_name, to_jsonb(c)->>'parent'),
      c.child_name,
      coalesce(c.name, c.child_name),
      c.branch_key,
      c.gender,
      nullif(btrim(coalesce(to_jsonb(c)->>'photo_url', '')), ''),
      nullif(btrim(coalesce(to_jsonb(c)->>'birth_date_g', '')), ''),
      nullif(btrim(coalesce(to_jsonb(c)->>'birth_date_h', '')), ''),
      nullif(to_jsonb(c)->>'birth_year', '')::integer,
      nullif(to_jsonb(c)->>'birth_order', '')::integer,
      nullif(btrim(coalesce(to_jsonb(c)->>'death_date_g', '')), ''),
      nullif(btrim(coalesce(to_jsonb(c)->>'death_date_h', '')), ''),
      c.city,
      c.area,
      c.is_deceased,
      nullif(to_jsonb(c)->>'deceased', '')::boolean
    from public.tree_children c
    where c.branch_key = v_branch
    order by c.id
    limit 5000;
end;
$fn$;

grant execute on function public.admin_tree_children_list_v1(text, text) to anon, authenticated;

drop function if exists public.tree_children_list_v1(text, text, text, text);

create function public.tree_children_list_v1(
  p_branch_key text,
  p_phone text,
  p_email text,
  p_secret_hash text
)
returns table(
  id bigint,
  person_id text,
  parent_person_id text,
  parent_name text,
  parent text,
  child_name text,
  name text,
  branch_key text,
  gender text,
  photo_url text,
  birth_date_g text,
  birth_date_h text,
  birth_year integer,
  birth_order integer,
  death_date_g text,
  death_date_h text,
  city text,
  area text,
  is_deceased boolean,
  deceased boolean
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_branch text;
begin
  v_branch := nullif(btrim(coalesce(p_branch_key, '')), '');
  if v_branch is null then
    return;
  end if;
  if not public.tree_delegate_allowed_v1(v_branch, p_phone, p_email, p_secret_hash) then
    raise exception 'not allowed';
  end if;
  return query
    select
      c.id,
      nullif(btrim(coalesce(to_jsonb(c)->>'person_id', '')), ''),
      nullif(btrim(coalesce(to_jsonb(c)->>'parent_person_id', '')), ''),
      coalesce(c.parent_name, to_jsonb(c)->>'parent'),
      coalesce(c.parent_name, to_jsonb(c)->>'parent'),
      c.child_name,
      coalesce(c.name, c.child_name),
      c.branch_key,
      c.gender,
      nullif(btrim(coalesce(to_jsonb(c)->>'photo_url', '')), ''),
      nullif(btrim(coalesce(to_jsonb(c)->>'birth_date_g', '')), ''),
      nullif(btrim(coalesce(to_jsonb(c)->>'birth_date_h', '')), ''),
      nullif(to_jsonb(c)->>'birth_year', '')::integer,
      nullif(to_jsonb(c)->>'birth_order', '')::integer,
      nullif(btrim(coalesce(to_jsonb(c)->>'death_date_g', '')), ''),
      nullif(btrim(coalesce(to_jsonb(c)->>'death_date_h', '')), ''),
      c.city,
      c.area,
      c.is_deceased,
      nullif(to_jsonb(c)->>'deceased', '')::boolean
    from public.tree_children c
    where c.branch_key = v_branch
    order by c.id
    limit 5000;
end;
$fn$;

grant execute on function public.tree_children_list_v1(text, text, text, text) to anon, authenticated;
notify pgrst, 'reload schema';

select
  (to_regprocedure('public.tree_member_lineage_children_v1(text)') is not null)
    as has_member_lineage_children_rpc,
  (to_regprocedure('public.admin_tree_children_list_v1(text,text)') is not null)
    as has_admin_tree_children_list_rpc,
  (to_regprocedure('public.tree_children_list_v1(text,text,text,text)') is not null)
    as has_delegate_tree_children_list_rpc;
