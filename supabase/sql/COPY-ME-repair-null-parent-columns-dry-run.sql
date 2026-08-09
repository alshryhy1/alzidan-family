-- =============================================================================
-- COPY-ME: Dry-run — صفوف parent / child_name الفارغ (قراءة فقط)
-- Preset: maint.repair_null_parent_columns_dry_run_v1
-- سياسة: لا تشغيل تلقائي من Health Center (R-7). راجع الصفوف ثم شغّل APPLY منفصلًا.
-- ملاحظة Workspace: أمر SELECT واحد فقط — بلا /* */ (تصنيف المنفّذ يعلّق عليها).
-- =============================================================================

SELECT
  id,
  branch_key,
  parent,
  parent_name,
  child_name,
  name,
  coalesce(
    nullif(btrim(parent_name), ''),
    CASE
      WHEN position('/' in coalesce(name, child_name, '')) > 0
        THEN regexp_replace(coalesce(name, child_name), '/[^/]+$', '')
      ELSE NULL
    END
  ) AS proposed_parent,
  parent_person_id
FROM public.tree_children
WHERE nullif(btrim(coalesce(parent, '')), '') IS NULL
   OR nullif(btrim(coalesce(child_name, '')), '') IS NULL
ORDER BY branch_key, id
LIMIT 200;
