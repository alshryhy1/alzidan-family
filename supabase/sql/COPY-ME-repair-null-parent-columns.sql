-- =============================================================================
-- COPY-ME: إصلاح عمود parent / child_name الفارغ (قراءة ثم تطبيق يدوي)
-- Ref: مركز صحة البيانات → سلامة الشجرة (parent = NULL)
-- سياسة: لا تشغيل تلقائي من Health Center (R-7). Dry-run أولًا ثم APPLY بعد موافقة.
-- Safe to re-run. لا يحذف صفوفًا.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0) Dry-run — صفوف parent فارغ (يشمل حسين/عبدالعزيز/منصور/مبارك/زيد إن وُجدت)
-- ---------------------------------------------------------------------------
SELECT
  id,
  branch_key,
  parent,
  parent_name,
  child_name,
  name,
  -- أب مستخرج من المسار (إزالة آخر مقطع)
  CASE
    WHEN position('/' in coalesce(name, child_name, '')) > 0
      THEN regexp_replace(coalesce(name, child_name), '/[^/]+$', '')
    ELSE NULL
  END AS extracted_parent,
  parent_person_id
FROM public.tree_children
WHERE nullif(btrim(coalesce(parent, '')), '') IS NULL
ORDER BY branch_key, id
LIMIT 200;

-- ---------------------------------------------------------------------------
-- 1) Dry-run — parent_name/parent لا يطابق المستخرج من name
-- ---------------------------------------------------------------------------
SELECT
  id,
  branch_key,
  parent,
  parent_name,
  name,
  CASE
    WHEN position('/' in coalesce(name, child_name, '')) > 0
      THEN regexp_replace(coalesce(name, child_name), '/[^/]+$', '')
    ELSE NULL
  END AS extracted_parent
FROM public.tree_children
WHERE position('/' in coalesce(name, child_name, '')) > 0
  AND (
    nullif(btrim(coalesce(parent, '')), '') IS NULL
    OR btrim(parent) IS DISTINCT FROM
       regexp_replace(coalesce(name, child_name), '/[^/]+$', '')
  )
ORDER BY id
LIMIT 200;

-- ---------------------------------------------------------------------------
-- 2) APPLY — املأ parent من parent_name أو من المسار؛ child_name من name
--    (شغّل فقط بعد مراجعة dry-run والموافقة الصريحة)
-- ---------------------------------------------------------------------------
/*
UPDATE public.tree_children c
SET
  parent = coalesce(
    nullif(btrim(c.parent), ''),
    nullif(btrim(c.parent_name), ''),
    CASE
      WHEN position('/' in coalesce(c.name, c.child_name, '')) > 0
        THEN regexp_replace(coalesce(c.name, c.child_name), '/[^/]+$', '')
      ELSE NULL
    END
  ),
  parent_name = coalesce(
    nullif(btrim(c.parent_name), ''),
    nullif(btrim(c.parent), ''),
    CASE
      WHEN position('/' in coalesce(c.name, c.child_name, '')) > 0
        THEN regexp_replace(coalesce(c.name, c.child_name), '/[^/]+$', '')
      ELSE c.parent_name
    END
  ),
  child_name = coalesce(nullif(btrim(c.child_name), ''), nullif(btrim(c.name), '')),
  name = coalesce(nullif(btrim(c.name), ''), nullif(btrim(c.child_name), ''))
WHERE nullif(btrim(coalesce(c.parent, '')), '') IS NULL
   OR nullif(btrim(coalesce(c.child_name, '')), '') IS NULL;

-- تحقق بعد التطبيق:
SELECT count(*) AS still_null_parent
FROM public.tree_children
WHERE nullif(btrim(coalesce(parent, '')), '') IS NULL;
*/
