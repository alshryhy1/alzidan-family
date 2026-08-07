-- Integrity Engine foundation (ADR-004) — feeds future Health Center
-- Migration Version: 4 (with repair)
-- Safe: views + report RPCs only; no mass data mutation.
-- Depends on: admin_token_ok_v1; optionally tree_repair_parent_candidates_v1 (repair SQL).
--
-- Lists / counts:
--   - children missing / broken parent_person_id
--   - ambiguous leaf-name clusters
--   - spouses without valid husband
--   - approved tree_card without tree effect (best-effort; needs approval_requests access)

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------

create or replace view public.v_integrity_children_bad_parent as
select
  c.id,
  c.branch_key,
  coalesce(c.child_name, c.name) as child_path,
  coalesce(c.parent_name, c.parent) as parent_key,
  c.person_id,
  c.parent_person_id,
  case
    when c.parent_person_id is null then 'TREE-003'
    when not exists (
      select 1 from public.tree_children p where p.person_id = c.parent_person_id
    ) then 'TREE-003-broken'
    else null
  end as code,
  case
    when c.parent_person_id is null then 'missing_parent_person_id'
    else 'broken_parent_person_id'
  end as issue
from public.tree_children c
where c.parent_person_id is null
   or not exists (
     select 1 from public.tree_children p where p.person_id = c.parent_person_id
   );

comment on view public.v_integrity_children_bad_parent is
  'Integrity: children with null or unresolved parent_person_id (TREE-003).';

create or replace view public.v_integrity_ambiguous_leaf_clusters as
select
  c.branch_key,
  regexp_replace(coalesce(c.child_name, c.name), '^.*/', '') as leaf_name,
  count(*)::int as n_rows,
  count(distinct c.person_id)::int as n_distinct_person_id
from public.tree_children c
group by 1, 2
having count(*) > 1;

comment on view public.v_integrity_ambiguous_leaf_clusters is
  'Integrity: same short leaf name appears more than once in a branch (name-link risk).';

create or replace view public.v_integrity_spouses_without_husband as
select
  s.id as spouse_id,
  s.husband_id,
  s.husband_person_id,
  s.wife_name,
  s.branch_key,
  'SPOUSE-001'::text as code
from public.tree_spouses s
left join public.tree_children c on c.id = s.husband_id
where c.id is null;

comment on view public.v_integrity_spouses_without_husband is
  'Integrity: spouses whose husband_id has no tree_children row.';

-- ---------------------------------------------------------------------------
-- Admin report RPC (token-gated) — Health Center precursor
-- ---------------------------------------------------------------------------

create or replace function public.admin_integrity_report_v1(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_missing int;
  v_broken int;
  v_ambiguous_clusters int;
  v_spouses_bad int;
  v_approved_total int := null;
  v_approved_add_son_orphans int := null;
  v_repair_candidates int := 0;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  select count(*) into v_missing
  from public.tree_children c
  where c.parent_person_id is null;

  select count(*) into v_broken
  from public.tree_children c
  where c.parent_person_id is not null
    and not exists (
      select 1 from public.tree_children p where p.person_id = c.parent_person_id
    );

  select count(*) into v_ambiguous_clusters
  from public.v_integrity_ambiguous_leaf_clusters;

  select count(*) into v_spouses_bad
  from public.v_integrity_spouses_without_husband;

  begin
    select count(*) into v_approved_total
    from public.approval_requests r
    where r.status = 'approved';
  exception when others then
    v_approved_total := null;
  end;

  -- REQ-001 heuristic: approved tree-ish kinds without a matching child path.
  begin
    select count(*) into v_approved_add_son_orphans
    from public.approval_requests r
    where r.status = 'approved'
      and coalesce(r.kind, '') in ('tree_card', 'add_son', 'add-son', 'tree_add_son')
      and not exists (
        select 1
        from public.tree_children c
        where c.branch_key is not distinct from r.branch_key
          and (
            coalesce(c.child_name, c.name) = nullif(btrim(coalesce(r.name, '')), '')
            or coalesce(c.child_name, c.name) like '%/' || nullif(btrim(coalesce(r.name, '')), '')
          )
      );
  exception when others then
    v_approved_add_son_orphans := null;
  end;

  begin
    select count(*) into v_repair_candidates
    from public.tree_repair_parent_candidates_v1();
  exception when undefined_function then
    v_repair_candidates := 0;
  when others then
    v_repair_candidates := 0;
  end;

  return jsonb_build_object(
    'ok', true,
    'schema', 'integrity_report_v1',
    'counts', jsonb_build_object(
      'missing_parent_person_id', v_missing,
      'broken_parent_person_id', v_broken,
      'children_bad_parent_total', v_missing + v_broken,
      'ambiguous_leaf_clusters', v_ambiguous_clusters,
      'spouses_without_husband', v_spouses_bad,
      'approved_requests_total', v_approved_total,
      'approved_add_son_orphans_heuristic', v_approved_add_son_orphans,
      'repair_candidates_unambiguous', v_repair_candidates
    ),
    'samples', jsonb_build_object(
      'bad_parent', (
        select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
        from (
          select id, branch_key, child_path, parent_key, code, issue
          from public.v_integrity_children_bad_parent
          order by id
          limit 25
        ) t
      ),
      'ambiguous_leaf_top', (
        select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
        from (
          select branch_key, leaf_name, n_rows, n_distinct_person_id
          from public.v_integrity_ambiguous_leaf_clusters
          order by n_rows desc
          limit 15
        ) t
      ),
      'spouses_bad', (
        select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
        from (
          select spouse_id, husband_id, wife_name, branch_key, code
          from public.v_integrity_spouses_without_husband
          limit 15
        ) t
      )
    ),
    'codes', jsonb_build_array('TREE-003', 'TREE-001', 'SPOUSE-001', 'REQ-001')
  );
end;
$$;

comment on function public.admin_integrity_report_v1(text) is
  'Health Center precursor: integrity counts + samples (admin token).';

revoke all on function public.admin_integrity_report_v1(text) from public;
grant execute on function public.admin_integrity_report_v1(text) to anon, authenticated;

create or replace function public.admin_integrity_list_v1(
  p_token text,
  p_issue text default 'bad_parent',
  p_limit int default 100
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lim int := greatest(1, least(coalesce(p_limit, 100), 500));
  v_issue text := lower(nullif(btrim(coalesce(p_issue, '')), ''));
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  if v_issue is null or v_issue in ('bad_parent', 'children', 'tree-003') then
    return jsonb_build_object(
      'issue', 'bad_parent',
      'rows', (
        select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
        from (
          select * from public.v_integrity_children_bad_parent
          order by id
          limit v_lim
        ) t
      )
    );
  end if;

  if v_issue in ('ambiguous', 'ambiguous_leaf', 'tree-001') then
    return jsonb_build_object(
      'issue', 'ambiguous_leaf',
      'rows', (
        select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
        from (
          select * from public.v_integrity_ambiguous_leaf_clusters
          order by n_rows desc
          limit v_lim
        ) t
      )
    );
  end if;

  if v_issue in ('spouse', 'spouses', 'spouse-001') then
    return jsonb_build_object(
      'issue', 'spouses_without_husband',
      'rows', (
        select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
        from (
          select * from public.v_integrity_spouses_without_husband
          limit v_lim
        ) t
      )
    );
  end if;

  if v_issue in ('repair', 'repair_candidates') then
    return jsonb_build_object(
      'issue', 'repair_candidates',
      'rows', (
        select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
        from (
          select * from public.tree_repair_parent_candidates_v1()
          order by child_id
          limit v_lim
        ) t
      )
    );
  end if;

  return jsonb_build_object('ok', false, 'error', 'unknown_issue', 'issue', v_issue);
end;
$$;

comment on function public.admin_integrity_list_v1(text, text, int) is
  'Health Center precursor: list integrity rows by issue class.';

revoke all on function public.admin_integrity_list_v1(text, text, int) from public;
grant execute on function public.admin_integrity_list_v1(text, text, int) to anon, authenticated;
