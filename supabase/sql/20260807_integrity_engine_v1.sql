-- Integrity Engine v2 — TREE-003 false-positive fix (ADR-004)
-- Migration Version: 5
-- Safe: views + report RPCs only; no data DELETE/UPDATE.
--
-- TREE-003 split:
--   🟢 healthy: parent is branch Root OR exists in tree_parents
--   🟡 warning: null/broken UUID but father findable by name/path
--   🔴 error: broken parent_person_id AND parent absent from children+parents indexes

-- ---------------------------------------------------------------------------
-- Classification view (all non-ok rows: warning + error)
-- ---------------------------------------------------------------------------

create or replace view public.v_integrity_children_parent_v2 as
with path_index as (
  select
    c.branch_key,
    coalesce(c.child_name, c.name) as path
  from public.tree_children c
  where coalesce(c.child_name, c.name) is not null
  union
  select
    tp.branch_key,
    tp.name as path
  from public.tree_parents tp
  where tp.name is not null
),
person_index as (
  select c.person_id
  from public.tree_children c
  where c.person_id is not null
),
classified as (
  select
    c.id,
    c.branch_key,
    coalesce(c.child_name, c.name) as child_path,
    coalesce(c.parent_name, c.parent) as parent_key,
    c.person_id,
    c.parent_person_id,
    (
      coalesce(c.parent_name, c.parent, '') = c.branch_key
      or coalesce(c.parent_name, c.parent, '') = (c.branch_key || ' بن مطلق بن زيدان')
    ) as is_branch_root,
    exists (
      select 1
      from public.tree_parents tp
      where tp.branch_key is not distinct from c.branch_key
        and tp.name = coalesce(c.parent_name, c.parent)
    ) as in_tree_parents,
    exists (
      select 1
      from path_index pi
      where pi.branch_key is not distinct from c.branch_key
        and pi.path = coalesce(c.parent_name, c.parent)
    ) as parent_path_found,
    (
      c.parent_person_id is not null
      and exists (
        select 1 from person_index p where p.person_id = c.parent_person_id
      )
    ) as parent_uuid_ok
  from public.tree_children c
)
select
  id,
  branch_key,
  child_path,
  parent_key,
  person_id,
  parent_person_id,
  case
    when is_branch_root or in_tree_parents then 'healthy'
    when parent_person_id is not null and parent_uuid_ok then 'ok'
    when parent_person_id is not null
         and not parent_uuid_ok
         and not parent_path_found
         and not in_tree_parents
         and not is_branch_root then 'error'
    when parent_person_id is null
         or (parent_person_id is not null and not parent_uuid_ok) then 'warning'
    else 'ok'
  end as severity,
  case
    when is_branch_root then 'root_parent'
    when in_tree_parents then 'in_tree_parents'
    when parent_person_id is not null
         and not parent_uuid_ok
         and not parent_path_found
         and not in_tree_parents
         and not is_branch_root then 'broken_parent_uuid'
    when parent_person_id is null
         or (parent_person_id is not null and not parent_uuid_ok) then 'missing_uuid'
    else null
  end as reason,
  case
    when is_branch_root then 'أصل الفرع (Root Parent)'
    when in_tree_parents then 'موجود في tree_parents'
    when parent_person_id is not null
         and not parent_uuid_ok
         and not parent_path_found
         and not in_tree_parents
         and not is_branch_root then 'أب UUID مكسور'
    when parent_person_id is null
         or (parent_person_id is not null and not parent_uuid_ok) then 'يحتاج ربط UUID فقط'
    else null
  end as reason_ar,
  case
    when is_branch_root or in_tree_parents then null
    when parent_person_id is not null
         and not parent_uuid_ok
         and not parent_path_found
         and not in_tree_parents
         and not is_branch_root then 'TREE-003'
    when parent_person_id is null
         or (parent_person_id is not null and not parent_uuid_ok) then 'TREE-003-warn'
    else null
  end as code,
  case
    when is_branch_root or in_tree_parents then null
    when parent_person_id is not null
         and not parent_uuid_ok
         and not parent_path_found
         and not in_tree_parents
         and not is_branch_root then 'broken_parent_person_id'
    when parent_person_id is null then 'missing_parent_person_id'
    when parent_person_id is not null and not parent_uuid_ok then 'needs_uuid_relink'
    else null
  end as issue
from classified;

comment on view public.v_integrity_children_parent_v2 is
  'Integrity v2: TREE-003 classification (healthy/warning/error) using tree_children + tree_parents.';

-- Real 🔴 errors only (false-positive roots excluded)
create or replace view public.v_integrity_children_bad_parent as
select
  id,
  branch_key,
  child_path,
  parent_key,
  person_id,
  parent_person_id,
  code,
  issue,
  severity,
  reason,
  reason_ar
from public.v_integrity_children_parent_v2
where severity = 'error';

comment on view public.v_integrity_children_bad_parent is
  'Integrity v2: real TREE-003 errors only (broken UUID + parent absent from children/parents).';

create or replace view public.v_integrity_children_parent_warnings as
select
  id,
  branch_key,
  child_path,
  parent_key,
  person_id,
  parent_person_id,
  code,
  issue,
  severity,
  reason,
  reason_ar
from public.v_integrity_children_parent_v2
where severity = 'warning';

comment on view public.v_integrity_children_parent_warnings is
  'Integrity v2: TREE-003 warnings (needs UUID link only).';

-- Keep other views if missing (idempotent redefine of ambiguous/spouses from v1)
create or replace view public.v_integrity_ambiguous_leaf_clusters as
select
  c.branch_key,
  regexp_replace(coalesce(c.child_name, c.name), '^.*/', '') as leaf_name,
  count(*)::int as n_rows,
  count(distinct c.person_id)::int as n_distinct_person_id
from public.tree_children c
group by 1, 2
having count(*) > 1;

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

-- ---------------------------------------------------------------------------
-- Admin report RPC (token-gated) — Health Center
-- ---------------------------------------------------------------------------

create or replace function public.admin_integrity_report_v1(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_healthy int;
  v_warnings int;
  v_errors int;
  v_ambiguous_clusters int;
  v_spouses_bad int;
  v_approved_total int := null;
  v_approved_add_son_orphans int := null;
  v_repair_candidates int := 0;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  select count(*) into v_healthy
  from public.v_integrity_children_parent_v2
  where severity = 'healthy';

  select count(*) into v_warnings
  from public.v_integrity_children_parent_warnings;

  select count(*) into v_errors
  from public.v_integrity_children_bad_parent;

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
    'schema', 'integrity_report_v2',
    'counts', jsonb_build_object(
      'healthy_root_or_tree_parent', v_healthy,
      'warning_needs_uuid_link', v_warnings,
      'error_broken_parent_uuid', v_errors,
      'missing_parent_person_id', v_warnings,
      'broken_parent_person_id', v_errors,
      'children_bad_parent_total', v_errors,
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
          select id, branch_key, child_path, parent_key, code, issue, severity, reason, reason_ar
          from (
            select * from public.v_integrity_children_bad_parent
            union all
            select * from public.v_integrity_children_parent_warnings
          ) u
          order by case when severity = 'error' then 0 else 1 end, id
          limit 25
        ) t
      ),
      'errors', (
        select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
        from (
          select id, branch_key, child_path, parent_key, code, issue, severity, reason, reason_ar
          from public.v_integrity_children_bad_parent
          order by id
          limit 25
        ) t
      ),
      'warnings', (
        select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
        from (
          select id, branch_key, child_path, parent_key, code, issue, severity, reason, reason_ar
          from public.v_integrity_children_parent_warnings
          order by id
          limit 25
        ) t
      )
    ),
    'codes', jsonb_build_array('TREE-003', 'TREE-003-warn', 'TREE-001', 'SPOUSE-001', 'REQ-001')
  );
end;
$$;

comment on function public.admin_integrity_report_v1(text) is
  'Health Center: integrity v2 counts + samples (admin token). Real TREE-003 errors exclude branch roots.';

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

  if v_issue is null or v_issue in ('bad_parent', 'children', 'tree-003', 'errors') then
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

  if v_issue in ('warnings', 'warning', 'tree-003-warn') then
    return jsonb_build_object(
      'issue', 'warnings',
      'rows', (
        select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
        from (
          select * from public.v_integrity_children_parent_warnings
          order by id
          limit v_lim
        ) t
      )
    );
  end if;

  if v_issue in ('all_parent', 'parent_v2') then
    return jsonb_build_object(
      'issue', 'parent_v2',
      'rows', (
        select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
        from (
          select * from public.v_integrity_children_parent_v2
          where severity in ('warning', 'error', 'healthy')
          order by case severity when 'error' then 0 when 'warning' then 1 else 2 end, id
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
  'Health Center: list integrity rows by issue class (v2).';

revoke all on function public.admin_integrity_list_v1(text, text, int) from public;
grant execute on function public.admin_integrity_list_v1(text, text, int) to anon, authenticated;
