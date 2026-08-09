-- =============================================================================
-- COPY-ME: APPLY ربط UUID — سلسلة نداء→طعيسان→حمد→محمد (ids 1738-1740 فقط)
-- Preset: maint.link_uuid_nada_tuaisan_hamad_mohammad_apply_v1
-- عنوان البطاقة: ربط UUID سلسلة نداء-طعيسان-حمد-محمد (1738-1740) — APPLY
-- يكتب parent_person_id فقط. لا يغيّر name أو parent. لا ينشئ أو يحذف.
-- 1738→1739 و 1739→1740 إن وُجد person_id للأب.
-- 1740→نداء فقط عند تطابق نصي فريد لـ parent مع name أو child_name في نفس الفرع.
-- أمر UPDATE واحد — بدون تعليقات كتلية — مناسب لـ execute_v1.
-- بعد النجاح أعد المعاينة للتحقق.
-- =============================================================================

UPDATE public.tree_children c
SET parent_person_id = t.father_person_id
FROM (
  SELECT
    1738::bigint AS child_id,
    f.person_id AS father_person_id
  FROM public.tree_children f
  WHERE f.id = 1739
    AND f.person_id IS NOT NULL
  UNION ALL
  SELECT
    1739::bigint,
    f.person_id
  FROM public.tree_children f
  WHERE f.id = 1740
    AND f.person_id IS NOT NULL
  UNION ALL
  SELECT
    child.id,
    min(f.person_id::text)::uuid
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
) t
WHERE c.id = t.child_id
  AND c.id IN (1738, 1739, 1740)
  AND c.parent_person_id IS DISTINCT FROM t.father_person_id;
