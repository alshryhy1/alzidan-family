-- COPY-ME: Preset id: maint.tree_external_offspring_v1
-- Option A: mother (family tree person) → child outside family scope.
-- NOT tree_children. NOT tree_mother_links. NOT tree_spouses.
-- Does not enter branches, search, counts, or birth order.
-- Safe to re-run.

create table if not exists public.tree_external_offspring (
  id bigint generated always as identity primary key,
  offspring_id uuid not null default gen_random_uuid(),
  mother_tree_child_id bigint not null references public.tree_children(id) on delete cascade,
  mother_person_id uuid,
  child_name text not null,
  gender text,
  father_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists tree_external_offspring_offspring_id_uidx
  on public.tree_external_offspring (offspring_id);

create index if not exists tree_external_offspring_mother_idx
  on public.tree_external_offspring (mother_tree_child_id);

comment on table public.tree_external_offspring is
  'Mother in the family tree → child outside family membership. Never a tree node.';
comment on column public.tree_external_offspring.offspring_id is
  'Stable identity. Do not key uniqueness by name+mother alone.';
comment on column public.tree_external_offspring.father_name is
  'Optional external father as text. Not a Zidan tree node.';

alter table public.tree_external_offspring enable row level security;
revoke all on table public.tree_external_offspring from public, anon, authenticated;

create or replace function public.admin_tree_external_offspring_list_v1(
  p_token text,
  p_mother_tree_child_id bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;
  if p_mother_tree_child_id is null or p_mother_tree_child_id < 1 then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(r) order by r.id)
    from (
      select
        e.id,
        e.offspring_id,
        e.mother_tree_child_id,
        e.mother_person_id,
        e.child_name,
        e.gender,
        e.father_name
      from public.tree_external_offspring e
      where e.mother_tree_child_id = p_mother_tree_child_id
    ) r
  ), '[]'::jsonb);
end;
$fn$;

create or replace function public.admin_tree_external_offspring_save_v1(
  p_token text,
  p_row jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id bigint;
  v_mother_id bigint;
  v_name text;
  v_gender text;
  v_father text;
  v_mother public.tree_children%rowtype;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;
  if p_row is null or jsonb_typeof(p_row) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'bad_row');
  end if;

  v_id := nullif(btrim(coalesce(p_row->>'id', '')), '')::bigint;
  v_mother_id := nullif(btrim(coalesce(p_row->>'mother_tree_child_id', '')), '')::bigint;
  v_name := nullif(btrim(coalesce(p_row->>'child_name', '')), '');
  v_gender := lower(btrim(coalesce(p_row->>'gender', '')));
  if v_gender not in ('son', 'daughter') then
    v_gender := null;
  end if;
  v_father := nullif(btrim(coalesce(p_row->>'father_name', '')), '');

  if v_mother_id is null or v_name is null then
    return jsonb_build_object('ok', false, 'error', 'missing_mother_or_name');
  end if;

  select * into v_mother from public.tree_children where id = v_mother_id limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'mother_not_found');
  end if;

  if v_id is not null then
    update public.tree_external_offspring e
    set
      child_name = v_name,
      gender = v_gender,
      father_name = v_father,
      mother_person_id = coalesce(v_mother.person_id, e.mother_person_id),
      updated_at = now()
    where e.id = v_id
      and e.mother_tree_child_id = v_mother_id;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    return jsonb_build_object('ok', true, 'id', v_id, 'action', 'updated');
  end if;

  insert into public.tree_external_offspring (
    mother_tree_child_id, mother_person_id, child_name, gender, father_name
  ) values (
    v_mother_id, v_mother.person_id, v_name, v_gender, v_father
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'action', 'inserted');
end;
$fn$;

create or replace function public.admin_tree_external_offspring_delete_v1(
  p_token text,
  p_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;
  if p_id is null or p_id < 1 then
    return jsonb_build_object('ok', false);
  end if;
  delete from public.tree_external_offspring where id = p_id;
  return jsonb_build_object('ok', found, 'id', p_id);
end;
$fn$;

-- Mother's own login only. Never used by public tree/search/counts.
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

revoke all on function public.admin_tree_external_offspring_list_v1(text, bigint) from public;
revoke all on function public.admin_tree_external_offspring_save_v1(text, jsonb) from public;
revoke all on function public.admin_tree_external_offspring_delete_v1(text, bigint) from public;
revoke all on function public.tree_external_offspring_for_self_v1(text) from public;

grant execute on function public.admin_tree_external_offspring_list_v1(text, bigint) to anon, authenticated;
grant execute on function public.admin_tree_external_offspring_save_v1(text, jsonb) to anon, authenticated;
grant execute on function public.admin_tree_external_offspring_delete_v1(text, bigint) to anon, authenticated;
grant execute on function public.tree_external_offspring_for_self_v1(text) to anon, authenticated;

notify pgrst, 'reload schema';

select
  to_regclass('public.tree_external_offspring') is not null as has_table,
  to_regprocedure('public.admin_tree_external_offspring_save_v1(text, jsonb)') is not null as has_save;
