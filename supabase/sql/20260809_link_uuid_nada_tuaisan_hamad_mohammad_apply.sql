-- =============================================================================
-- COPY-ME: APPLY ربط UUID — سلسلة نداء→طعيسان→حمد→محمد (ids 1738-1740 فقط)
-- Preset: maint.link_uuid_nada_tuaisan_hamad_mohammad_apply_v1
-- عنوان البطاقة: ربط UUID سلسلة نداء-طعيسان-حمد-محمد (1738-1740) — APPLY
-- اكتب فقط parent_person_id. لا يغيّر name/parent. لا ينشئ/يحذف.
-- 1738→1739 و 1739→1740 دائمًا (إن وُجد person_id الأب).
-- 1740→نداء فقط عند تطابق نصي فريد لـ parent مع name/child_name في نفس الفرع.
-- إن لم يُحل نداء بفرادة: لا يُحدَّث 1740 — أعد المعاينة لعرض المرشحين.
-- أمر واحد (CTE) — بلا /* */ — مناسب لـ execute_v1 / workspace_run_v2.
-- =============================================================================

WITH link_fixed AS (
  SELECT * FROM (VALUES
    (1738::bigint, 1739::bigint),
    (1739::bigint, 1740::bigint)
  ) AS v(child_id, father_id)
),
link_nada AS (
  SELECT
    child.id AS child_id,
    min(f.person_id::text)::uuid AS father_person_id
  FROM public.tree_children child
  JOIN public.tree_children f
    ON f.branch_key = child.branch_key
   AND f.id <> child.id
   AND f.person_id IS NOT NULL
   AND coalesce(nullif(btrim(f.name), ''), nullif(btrim(f.child_name), ''))
     = coalesce(nullif(btrim(child.parent), ''), nullif(btrim(child.parent_name), ''))
  WHERE child.id = 1740
    AND coalesce(nullif(btrim(child.parent), ''), nullif(btrim(child.parent_name), '')) IS NOT NULL
  GROUP BY child.id
  HAVING count(DISTINCT f.person_id) = 1
),
targets AS (
  SELECT
    lf.child_id,
    f.person_id AS father_person_id
  FROM link_fixed lf
  JOIN public.tree_children f ON f.id = lf.father_id
  WHERE f.person_id IS NOT NULL
  UNION ALL
  SELECT child_id, father_person_id FROM link_nada
),
updated AS (
  UPDATE public.tree_children c
  SET parent_person_id = t.father_person_id
  FROM targets t
  WHERE c.id = t.child_id
    AND c.parent_person_id IS DISTINCT FROM t.father_person_id
  RETURNING c.id
)
SELECT
  c.id,
  c.name,
  c.parent,
  c.person_id,
  c.parent_person_id,
  f.id AS father_id,
  coalesce(f.name, f.child_name) AS father_name,
  CASE c.id
    WHEN 1738 THEN (c.parent_person_id = (SELECT person_id FROM public.tree_children WHERE id = 1739))
    WHEN 1739 THEN (c.parent_person_id = (SELECT person_id FROM public.tree_children WHERE id = 1740))
    WHEN 1740 THEN (c.parent_person_id IS NOT NULL)
  END AS link_ok,
  (SELECT count(*) FROM updated) AS rows_touched
FROM public.tree_children c
LEFT JOIN public.tree_children f ON f.person_id = c.parent_person_id
WHERE c.id IN (1738, 1739, 1740)
ORDER BY c.id;
