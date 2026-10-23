-- COPY-ME: الصق مرة واحدة في Supabase → SQL Editor ثم Run
-- Preset: tree_spouses.wife_phone_v1
--
-- يضيف عمود رقم جوال الزوجة في tree_spouses ويحدّث RPC الحفظ
-- admin_tree_spouse_upsert_v1 ليقبل wife_phone من لوحة الإدارة.

alter table public.tree_spouses
  add column if not exists wife_phone text;

comment on column public.tree_spouses.wife_phone is
  'Wife mobile in E.164 (optional). Used by family-management add/edit wife sheet.';

create index if not exists tree_spouses_wife_phone_idx
  on public.tree_spouses (wife_phone)
  where nullif(btrim(wife_phone), '') is not null;

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
  v_phone text;
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

  v_phone := nullif(btrim(coalesce(p_row->>'wife_phone', '')), '');

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
      wife_phone = v_phone,
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
      wife_phone,
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
      v_phone,
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
