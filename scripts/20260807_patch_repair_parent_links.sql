-- Patch Repair — parent_person_id integrity (ADR-001 / ADR-002 / ADR-007)
-- Migration Version: 4
-- Status: dry-run first, then apply. Only unambiguous parent matches.
--
-- Safe apply covers:
--   A) broken parent_person_id (UUID not in tree_children.person_id) with exact
--      unique parent_name match in same branch
--   B) null parent_person_id with exact unique parent_name match
--   C) null parent_person_id with unique match after alef-maksura normalize (ى→ي)
--      — documented spelling repair only; does NOT rewrite display names
--
-- Deferred (not auto-applied):
--   - branch roots / anchors (no parent row)
--   - ambiguous parent names (TREE-001)
--   - short-path approval orphans needing re-apply (REQ-001) — admin button / Patch 2
--   - approved-without-tree when approval_requests inaccessible
--
-- Backup reminder: keep backups/patch-0-20260807/ and take a fresh snapshot before apply.

-- ---------------------------------------------------------------------------
-- 0) Arabic path normalize (ى→ي, hamza variants) — identity helper for Repair only
-- ---------------------------------------------------------------------------
create or replace function public.tree_norm_arabic_path_v1(p text)
returns text
language sql
immutable
as $$
  select nullif(
    btrim(
      replace(replace(replace(replace(coalesce(p, ''), 'ى', 'ي'), 'أ', 'ا'), 'إ', 'ا'), 'آ', 'ا')
    ),
    ''
  );
$$;

comment on function public.tree_norm_arabic_path_v1(text) is
  'Repair helper: normalize Arabic path for unambiguous parent match (ى→ي). Not for write-path name linking.';

-- ---------------------------------------------------------------------------
-- 1) Dry-run: candidates that WOULD be repaired
-- ---------------------------------------------------------------------------
-- SELECT * FROM public.tree_repair_parent_candidates_v1();

create or replace function public.tree_repair_parent_candidates_v1()
returns table (
  child_id bigint,
  branch_key text,
  child_path text,
  parent_key text,
  old_parent_person_id uuid,
  new_parent_person_id uuid,
  match_mode text,
  issue text
)
language sql
stable
security invoker
as $$
  with parents as (
    select
      c.branch_key,
      coalesce(c.child_name, c.name) as path,
      public.tree_norm_arabic_path_v1(coalesce(c.child_name, c.name)) as path_norm,
      c.person_id
    from public.tree_children c
    where c.person_id is not null
  ),
  exact_unique as (
    select branch_key, path, min(person_id::text)::uuid as person_id
    from parents
    group by branch_key, path
    having count(distinct person_id) = 1
  ),
  norm_unique as (
    select branch_key, path_norm, min(person_id::text)::uuid as person_id
    from parents
    where path_norm is not null
    group by branch_key, path_norm
    having count(distinct person_id) = 1
  ),
  children as (
    select
      c.id,
      c.branch_key,
      coalesce(c.child_name, c.name) as child_path,
      coalesce(c.parent_name, c.parent) as parent_key,
      c.parent_person_id,
      case
        when c.parent_person_id is not null
         and not exists (
           select 1 from public.tree_children p where p.person_id = c.parent_person_id
         ) then 'broken_parent_person_id'
        when c.parent_person_id is null then 'missing_parent_person_id'
        else null
      end as issue
    from public.tree_children c
  )
  select
    ch.id,
    ch.branch_key,
    ch.child_path,
    ch.parent_key,
    ch.parent_person_id,
    coalesce(ex.person_id, nu.person_id) as new_parent_person_id,
    case
      when ex.person_id is not null then 'exact_parent_name'
      when nu.person_id is not null then 'norm_alef_maksura'
      else null
    end as match_mode,
    ch.issue
  from children ch
  left join exact_unique ex
    on ex.branch_key = ch.branch_key
   and ex.path = ch.parent_key
  left join norm_unique nu
    on nu.branch_key = ch.branch_key
   and nu.path_norm = public.tree_norm_arabic_path_v1(ch.parent_key)
   and ex.person_id is null
  where ch.issue is not null
    and coalesce(ex.person_id, nu.person_id) is not null
    and coalesce(ex.person_id, nu.person_id) is distinct from ch.parent_person_id;
$$;

comment on function public.tree_repair_parent_candidates_v1() is
  'Patch Repair dry-run: unambiguous parent_person_id fixes (exact or ى→ي).';

-- ---------------------------------------------------------------------------
-- 2) Apply: update only candidates from dry-run (idempotent)
-- ---------------------------------------------------------------------------
-- SELECT public.tree_repair_parent_person_id_apply_v1(true);  -- dry-run counts
-- SELECT public.tree_repair_parent_person_id_apply_v1(false); -- mutate

create or replace function public.tree_repair_parent_person_id_apply_v1(p_dry_run boolean default true)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_count int := 0;
  v_ids bigint[];
begin
  select coalesce(array_agg(child_id order by child_id), '{}'::bigint[])
    into v_ids
  from public.tree_repair_parent_candidates_v1();

  v_count := coalesce(array_length(v_ids, 1), 0);

  if p_dry_run or v_count = 0 then
    return jsonb_build_object(
      'dry_run', coalesce(p_dry_run, true),
      'would_repair', v_count,
      'repaired', 0,
      'child_ids', to_jsonb(v_ids),
      'code', 'REPAIR-001'
    );
  end if;

  update public.tree_children c
  set parent_person_id = cand.new_parent_person_id
  from public.tree_repair_parent_candidates_v1() cand
  where c.id = cand.child_id
    and c.parent_person_id is distinct from cand.new_parent_person_id;

  get diagnostics v_count = row_count;

  return jsonb_build_object(
    'dry_run', false,
    'would_repair', coalesce(array_length(v_ids, 1), 0),
    'repaired', v_count,
    'child_ids', to_jsonb(v_ids),
    'code', 'REPAIR-001'
  );
end;
$$;

comment on function public.tree_repair_parent_person_id_apply_v1(boolean) is
  'Patch Repair apply: set parent_person_id only for unambiguous candidates. p_dry_run=true by default.';

revoke all on function public.tree_repair_parent_candidates_v1() from public;
revoke all on function public.tree_repair_parent_person_id_apply_v1(boolean) from public;
grant execute on function public.tree_norm_arabic_path_v1(text) to anon, authenticated;
grant execute on function public.tree_repair_parent_candidates_v1() to authenticated;
grant execute on function public.tree_repair_parent_person_id_apply_v1(boolean) to authenticated;

-- Operator one-shot (SQL editor / supabase db query --linked):
--   select * from public.tree_repair_parent_candidates_v1();
--   select public.tree_repair_parent_person_id_apply_v1(true);
--   select public.tree_repair_parent_person_id_apply_v1(false);
--   select public.tree_repair_parent_person_id_apply_v1(true); -- expect would_repair=0
