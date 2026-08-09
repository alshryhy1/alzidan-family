-- =============================================================================
-- COPY-ME: معاينة ربط UUID — سلسلة نداء→طعيسان→حمد→محمد (ids 1738-1740 فقط)
-- Preset: maint.link_uuid_nada_tuaisan_hamad_mohammad_dry_run_v1
-- عنوان البطاقة: ربط UUID سلسلة نداء-طعيسان-حمد-محمد (1738-1740) — معاينة
-- قراءة فقط. لا يغيّر name/parent. لا ينشئ/يحذف صفوفًا. ليس Auto Repair.
-- ملاحظة Workspace: SELECT واحد — بلا /* */.
-- =============================================================================

WITH scoped AS (
  SELECT
    c.id,
    c.branch_key,
    c.name,
    c.child_name,
    c.parent,
    c.parent_name,
    c.person_id,
    c.parent_person_id,
    coalesce(nullif(btrim(c.parent), ''), nullif(btrim(c.parent_name), '')) AS parent_key
  FROM public.tree_children c
  WHERE c.id IN (1738, 1739, 1740)
),
fathers_by_id AS (
  SELECT
    s.id AS child_id,
    CASE s.id
      WHEN 1738 THEN 1739
      WHEN 1739 THEN 1740
      ELSE NULL
    END AS proposed_father_id
  FROM scoped s
  WHERE s.id IN (1738, 1739)
),
nada_exact AS (
  SELECT
    f.id,
    f.branch_key,
    f.name,
    f.child_name,
    f.person_id,
    count(*) OVER () AS cand_count,
    count(DISTINCT f.person_id) OVER () AS distinct_pid_count
  FROM scoped child
  JOIN public.tree_children f
    ON f.branch_key = child.branch_key
   AND f.id <> child.id
   AND f.person_id IS NOT NULL
   AND coalesce(nullif(btrim(f.name), ''), nullif(btrim(f.child_name), '')) = child.parent_key
  WHERE child.id = 1740
    AND child.parent_key IS NOT NULL
),
nada_leaf AS (
  SELECT
    f.id,
    f.branch_key,
    f.name,
    f.child_name,
    f.person_id,
    regexp_replace(
      coalesce(nullif(btrim(f.name), ''), nullif(btrim(f.child_name), ''), ''),
      '^.*/',
      ''
    ) AS leaf,
    count(*) OVER () AS cand_count,
    count(DISTINCT f.person_id) OVER () AS distinct_pid_count
  FROM scoped child
  JOIN public.tree_children f
    ON f.branch_key = child.branch_key
   AND f.id <> child.id
   AND f.person_id IS NOT NULL
   AND regexp_replace(
         coalesce(nullif(btrim(f.name), ''), nullif(btrim(f.child_name), ''), ''),
         '^.*/',
         ''
       ) IN (
         child.parent_key,
         replace(child.parent_key, 'نداء', 'ندا'),
         replace(child.parent_key, 'ندا', 'نداء')
       )
  WHERE child.id = 1740
    AND child.parent_key IS NOT NULL
)
SELECT
  'preview_link' AS section,
  s.id AS child_id,
  s.name AS child_name_path,
  s.parent_key AS child_parent_text,
  s.person_id AS child_person_id,
  s.parent_person_id AS child_parent_person_id_now,
  CASE s.id
    WHEN 1738 THEN '1738 → person_id(1739)'
    WHEN 1739 THEN '1739 → person_id(1740)'
    WHEN 1740 THEN '1740 → person_id(نداء الفريد)'
  END AS intended_link,
  f.id AS proposed_father_id,
  coalesce(f.name, f.child_name) AS proposed_father_name,
  f.person_id AS proposed_father_person_id,
  CASE
    WHEN s.id IN (1738, 1739) AND f.person_id IS NOT NULL THEN 'ready'
    WHEN s.id = 1740 AND (
      SELECT coalesce(max(distinct_pid_count), 0) FROM nada_exact
    ) = 1 THEN 'ready_exact_unique'
    WHEN s.id = 1740 AND (
      SELECT coalesce(max(cand_count), 0) FROM nada_exact
    ) = 0 THEN 'stop_no_exact_match_see_candidates'
    WHEN s.id = 1740 THEN 'stop_ambiguous_exact_see_candidates'
    ELSE 'blocked'
  END AS apply_status,
  CASE
    WHEN s.id = 1740 THEN (
      SELECT string_agg(
        n.id::text || ':' || coalesce(n.name, n.child_name, '') || ':' || n.person_id::text,
        ' | '
        ORDER BY n.id
      )
      FROM nada_exact n
    )
    ELSE NULL
  END AS nada_exact_candidates,
  CASE
    WHEN s.id = 1740 THEN (
      SELECT string_agg(
        n.id::text || ':' || coalesce(n.name, n.child_name, '') || ':' || n.person_id::text,
        ' | '
        ORDER BY n.id
      )
      FROM nada_leaf n
    )
    ELSE NULL
  END AS nada_leaf_candidates_info_only
FROM scoped s
LEFT JOIN fathers_by_id m ON m.child_id = s.id
LEFT JOIN public.tree_children f ON f.id = m.proposed_father_id
ORDER BY s.id;
