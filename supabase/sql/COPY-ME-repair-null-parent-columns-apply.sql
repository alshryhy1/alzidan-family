-- =============================================================================
-- COPY-ME: APPLY — ملء parent / child_name الفارغ (كتابة)
-- Preset: maint.repair_null_parent_columns_apply_v1
-- سياسة: شغّل فقط بعد نجاح dry-run وموافقة صريحة. ليس Auto Repair.
-- Safe to re-run. لا يحذف صفوفًا.
-- ملاحظة Workspace: بلا تعليقات كتلية /* */ — أوامر صريحة فقط.
-- =============================================================================

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

SELECT count(*) AS still_null_parent
FROM public.tree_children
WHERE nullif(btrim(coalesce(parent, '')), '') IS NULL;
