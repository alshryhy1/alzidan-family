# Patch Integrity Deploy — نشر محرك السلامة فقط (قراءة / تقرير)

**التاريخ:** 2026-08-07  
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

## Step B — نشر Integrity Engine فقط (بدون Repair apply)

انسخ كامل ملف:

`supabase/sql/20260807_integrity_engine_v1.sql`

→ SQL Editor → **Run**.

هذا الملف **آمن**: views + دوال تقرير فقط، بلا تعديل بيانات.

تحقق:

```sql
SELECT proname FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('admin_integrity_report_v1', 'admin_integrity_list_v1')
ORDER BY 1;
-- expect 2

SELECT to_regclass('public.v_integrity_children_bad_parent');
```

---

## Step C — تقرير فقط (لا apply)

```sql
-- استبدل YOUR_ADMIN_TOKEN برمز دخول الإدارة
SELECT public.admin_integrity_report_v1('YOUR_ADMIN_TOKEN');
```

أو من لوحة الإدارة → **مركز صحة البيانات** → «تحديث التقرير».

---

## ممنوع في هذه المرحلة

- `tree_repair_parent_person_id_apply_v1(false)` أو أي UPDATE/DELETE جماعي
- إعادة تشغيل `PATCH-TREE004-UNLINK-SQL.md`
- أي حذف لـ `577–583` / `321` / `1730`

أي إصلاح لاحق = **Dry-run / تقرير أولًا** ثم موافقة صريحة قبل الكتابة.
