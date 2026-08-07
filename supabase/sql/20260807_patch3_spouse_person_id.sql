-- Patch 3 — Spouses via person_id (ADR-001/002)
-- Migration Version: 3
-- Status: apply manually after dry-run. Safe: nullable column + helper + backfill.
--
-- Dry-run (spouses whose husband_id has no tree_children row):
-- SELECT s.id, s.husband_id, s.wife_name
-- FROM tree_spouses s
-- LEFT JOIN tree_children c ON c.id = s.husband_id
-- WHERE c.id IS NULL;
--
-- Dry-run (ambiguous leaf names that would break name-only husband resolve):
-- SELECT branch_key, coalesce(child_name, name) AS path, count(*) AS n
-- FROM tree_children
-- GROUP BY 1, 2 HAVING count(*) > 1 LIMIT 20;

alter table public.tree_spouses
  add column if not exists husband_person_id uuid;

comment on column public.tree_spouses.husband_person_id is
  'Patch 3: stable husband person_id (UUID). husband_id (bigint row id) kept for compatibility.';

update public.tree_spouses s
set husband_person_id = c.person_id
from public.tree_children c
where s.husband_id = c.id
  and s.husband_person_id is null
  and c.person_id is not null;

create index if not exists tree_spouses_husband_person_id_idx
  on public.tree_spouses (husband_person_id)
  where husband_person_id is not null;

create or replace function public.tree_verify_spouse_husband_v1(
  p_husband_id bigint,
  p_husband_person_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.tree_children%rowtype;
begin
  if p_husband_id is null then
    return jsonb_build_object('ok', false, 'code', 'SPOUSE-001', 'reason', 'missing_husband_id');
  end if;

  select * into v_row
  from public.tree_children c
  where c.id = p_husband_id
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'SPOUSE-001', 'reason', 'husband_row_missing', 'husband_id', p_husband_id);
  end if;

  if p_husband_person_id is not null then
    if v_row.person_id is distinct from p_husband_person_id then
      return jsonb_build_object(
        'ok', false,
        'code', 'SPOUSE-001',
        'reason', 'husband_person_id_mismatch',
        'husband_id', v_row.id,
        'person_id', v_row.person_id,
        'expected_person_id', p_husband_person_id
      );
    end if;
  elsif v_row.person_id is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'SPOUSE-001',
      'reason', 'husband_person_id_null',
      'husband_id', v_row.id
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'husband_id', v_row.id,
    'person_id', v_row.person_id,
    'branch_key', v_row.branch_key,
    'child_name', coalesce(v_row.child_name, v_row.name)
  );
end;
$$;

comment on function public.tree_verify_spouse_husband_v1(bigint, uuid) is
  'Patch 3: verify spouse husband_id exists and optionally matches person_id (SPOUSE-001).';

revoke all on function public.tree_verify_spouse_husband_v1(bigint, uuid) from public;
grant execute on function public.tree_verify_spouse_husband_v1(bigint, uuid) to authenticated, anon;
