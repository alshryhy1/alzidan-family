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
