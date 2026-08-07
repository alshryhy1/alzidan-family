# Patch Integrity Deploy — نشر محرك السلامة فقط (قراءة / تقرير)

**التاريخ:** 2026-08-08 (Integrity v2)  
**النطاق:** views + `admin_integrity_report_v1` / `admin_integrity_list_v1`  
**السياسة:** **قراءة فقط** — لا حذف، لا فك ربط، لا `tree_repair_*_apply`  
**الطريقة:** Supabase → SQL Editor → Run

---

## مكتمل مسبقًا — لا تُعد التشغيل

| البند | الحالة |
|--------|--------|
| حذف `577–583` (علي الأحم المكرر) · الإبقاء على `1417–1423` | ✅ مكتمل يدويًا — **ممنوع إعادة الحذف** |
| حذف العقد المختصرة `321` (صالح) و`1730` (صالح/عيد) · الإبقاء على `491` و`492` | ✅ مكتمل يدويًا — **ممنوع إعادة الحذف** |

أي SQL unlink/delete لتلك المعرفات **مرجعي فقط** ولا يُشغَّل مجددًا.

---

## Step A — تحقق أن الإصلاح اليدوي ما زال قائمًا (قراءة)

```sql
-- expect 0
SELECT id FROM public.tree_children WHERE id IN (577,578,579,580,581,582,583,321,1730);

-- expect 7 (ناصر)
SELECT id FROM public.tree_children WHERE id IN (1417,1418,1419,1420,1421,1422,1423) ORDER BY id;

-- expect 2 (النسخ الصحيحة للمختصرات)
SELECT id, child_name FROM public.tree_children WHERE id IN (491, 492) ORDER BY id;
```

---

## Step B — نشر Integrity Engine v2 فقط (بدون Repair apply)

انسخ كامل ملف:

`supabase/sql/20260808_integrity_engine_v2.sql`

(أو النسخة المحدَّثة من `20260807_integrity_engine_v1.sql` — نفس محتوى v2)

→ SQL Editor → **Run**.

هذا الملف **آمن**: views + دوال تقرير فقط، بلا تعديل بيانات.  
يُصنّف TREE-003 إلى سليم / تحذير / خطأ ويستثني أبناء جذر الفرع من الأخطاء.

تحقق:

```sql
SELECT proname FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('admin_integrity_report_v1', 'admin_integrity_list_v1')
ORDER BY 1;
-- expect 2

SELECT to_regclass('public.v_integrity_children_bad_parent');
SELECT to_regclass('public.v_integrity_children_parent_v2');

-- expect 0 rows for these branch-root children
SELECT id FROM public.v_integrity_children_bad_parent WHERE id IN (491, 670, 1068);
```

---

## Step C — تقرير فقط (لا apply)

```sql
-- استبدل YOUR_ADMIN_TOKEN برمز دخول الإدارة
SELECT public.admin_integrity_report_v1('YOUR_ADMIN_TOKEN');
```

أو من لوحة الإدارة → **مركز صحة البيانات** → «تحديث التقرير».

تحقق محلي بدون نشر:

```bash
npm run verify:integrity-v2
npm run integrity:scan
```

---

## ممنوع في هذه المرحلة

- `tree_repair_parent_person_id_apply_v1(false)` أو أي UPDATE/DELETE جماعي
- إعادة تشغيل `PATCH-TREE004-UNLINK-SQL.md`
- أي حذف لـ `577–583` / `321` / `1730`
- حذف صفوف مثل `491`/`670`/`1068` لإخفاء إنذار كاذب — المنطق يُصلح لا البيانات

أي إصلاح لاحق = **Dry-run / تقرير أولًا** ثم موافقة صريحة قبل الكتابة.
