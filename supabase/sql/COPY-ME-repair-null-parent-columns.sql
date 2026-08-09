-- =============================================================================
-- COPY-ME (مُجزّأ): إصلاح parent / child_name الفارغ — يدوي مرحلي
-- السبب الجذري لفشل الملف الموحّد السابق:
--   تعليق كتلي /* UPDATE … */ كان يُعامل كأمر ثالث فيصل إلى
--   admin_sql_classify_v1 ويتسبب في statement timeout → رسالة عامة في الواجهة.
-- المسار الصحيح الآن (preset منفصلان):
--   1) COPY-ME-repair-null-parent-columns-dry-run.sql  — قراءة فقط
--   2) COPY-ME-repair-null-parent-columns-apply.sql    — كتابة بعد موافقة
-- لا Auto Repair. لا تشغيل من مركز الصحة (R-7).
-- =============================================================================

-- Dry-run (أمر واحد) — نفس محتوى بطاقة dry-run:
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
