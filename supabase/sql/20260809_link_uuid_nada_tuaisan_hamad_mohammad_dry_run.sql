-- =============================================================================
-- COPY-ME: معاينة ربط UUID — سلسلة نداء→طعيسان→حمد→محمد (ids 1738-1740 فقط)
-- Preset: maint.link_uuid_nada_tuaisan_hamad_mohammad_dry_run_v1
-- عنوان البطاقة: ربط UUID سلسلة نداء-طعيسان-حمد-محمد (1738-1740) — معاينة
-- قراءة فقط. لا يغيّر name أو parent. لا ينشئ أو يحذف.
-- أمر SELECT واحد — بدون تعليقات كتلية — مناسب لـ execute_v1.
-- =============================================================================

SELECT
  c.id AS child_id,
  coalesce(c.name, c.child_name) AS child_name_path,
  coalesce(nullif(btrim(c.parent), ''), nullif(btrim(c.parent_name), '')) AS child_parent_text,
  c.person_id AS child_person_id,
  c.parent_person_id AS child_parent_person_id_now,
  CASE c.id
    WHEN 1738 THEN '1738 → person_id(1739)'
    WHEN 1739 THEN '1739 → person_id(1740)'
    WHEN 1740 THEN '1740 → person_id(نداء الفريد)'
  END AS intended_link,
  CASE c.id
    WHEN 1738 THEN 1739::bigint
    WHEN 1739 THEN 1740::bigint
    WHEN 1740 THEN (
      SELECT min(f.id)
      FROM public.tree_children f
      WHERE f.branch_key = c.branch_key
        AND f.id <> c.id
        AND f.person_id IS NOT NULL
        AND coalesce(nullif(btrim(f.name), ''), nullif(btrim(f.child_name), ''))
          = coalesce(nullif(btrim(c.parent), ''), nullif(btrim(c.parent_name), ''))
      HAVING count(DISTINCT f.person_id) = 1
    )
  END AS proposed_father_id,
  CASE c.id
    WHEN 1738 THEN (
      SELECT coalesce(f.name, f.child_name)
      FROM public.tree_children f
      WHERE f.id = 1739
    )
    WHEN 1739 THEN (
      SELECT coalesce(f.name, f.child_name)
      FROM public.tree_children f
      WHERE f.id = 1740
    )
    WHEN 1740 THEN (
      SELECT min(coalesce(f.name, f.child_name))
      FROM public.tree_children f
      WHERE f.branch_key = c.branch_key
        AND f.id <> c.id
        AND f.person_id IS NOT NULL
        AND coalesce(nullif(btrim(f.name), ''), nullif(btrim(f.child_name), ''))
          = coalesce(nullif(btrim(c.parent), ''), nullif(btrim(c.parent_name), ''))
      HAVING count(DISTINCT f.person_id) = 1
    )
  END AS proposed_father_name,
  CASE c.id
    WHEN 1738 THEN (
      SELECT f.person_id FROM public.tree_children f WHERE f.id = 1739
    )
    WHEN 1739 THEN (
      SELECT f.person_id FROM public.tree_children f WHERE f.id = 1740
    )
    WHEN 1740 THEN (
      SELECT min(f.person_id::text)::uuid
      FROM public.tree_children f
      WHERE f.branch_key = c.branch_key
        AND f.id <> c.id
        AND f.person_id IS NOT NULL
        AND coalesce(nullif(btrim(f.name), ''), nullif(btrim(f.child_name), ''))
          = coalesce(nullif(btrim(c.parent), ''), nullif(btrim(c.parent_name), ''))
      HAVING count(DISTINCT f.person_id) = 1
    )
  END AS proposed_father_person_id,
  CASE
    WHEN c.id = 1738
      AND (SELECT person_id FROM public.tree_children WHERE id = 1739) IS NOT NULL
      THEN 'ready'
    WHEN c.id = 1739
      AND (SELECT person_id FROM public.tree_children WHERE id = 1740) IS NOT NULL
      THEN 'ready'
    WHEN c.id = 1740 AND (
      SELECT count(DISTINCT f.person_id)
      FROM public.tree_children f
      WHERE f.branch_key = c.branch_key
        AND f.id <> c.id
        AND f.person_id IS NOT NULL
        AND coalesce(nullif(btrim(f.name), ''), nullif(btrim(f.child_name), ''))
          = coalesce(nullif(btrim(c.parent), ''), nullif(btrim(c.parent_name), ''))
    ) = 1 THEN 'ready_exact_unique'
    WHEN c.id = 1740 AND (
      SELECT count(*)
      FROM public.tree_children f
      WHERE f.branch_key = c.branch_key
        AND f.id <> c.id
        AND f.person_id IS NOT NULL
        AND coalesce(nullif(btrim(f.name), ''), nullif(btrim(f.child_name), ''))
          = coalesce(nullif(btrim(c.parent), ''), nullif(btrim(c.parent_name), ''))
    ) = 0 THEN 'stop_no_exact_match'
    WHEN c.id = 1740 THEN 'stop_ambiguous_exact'
    ELSE 'blocked'
  END AS apply_status,
  CASE
    WHEN c.id = 1740 THEN (
      SELECT string_agg(
        f.id::text || ':' || coalesce(f.name, f.child_name, '') || ':' || f.person_id::text,
        ' | '
        ORDER BY f.id
      )
      FROM public.tree_children f
      WHERE f.branch_key = c.branch_key
        AND f.id <> c.id
        AND f.person_id IS NOT NULL
        AND coalesce(nullif(btrim(f.name), ''), nullif(btrim(f.child_name), ''))
          = coalesce(nullif(btrim(c.parent), ''), nullif(btrim(c.parent_name), ''))
    )
    ELSE NULL
  END AS nada_exact_candidates
FROM public.tree_children c
WHERE c.id IN (1738, 1739, 1740)
ORDER BY c.id;
