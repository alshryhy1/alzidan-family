# Patch TREE-004 Unlink — SQL للتنفيذ اليدوي في Supabase SQL Editor

> ⛔ **مرجع تاريخي فقط — لا تُشغّل.**  
> الحذف اكتمل يدويًا (`577–583` محذوفة · `1417–1423` باقية). انظر [`PATCH-DATA-CLEANUP-DONE.md`](./PATCH-DATA-CLEANUP-DONE.md).

**التاريخ:** 2026-08-07  
**النطاق:** حذف صفوف `tree_children` الخاطئة فقط تحت علي صالح الأحم  
**الطريقة:** ~~انسخ كل خطوة والصقها في Supabase SQL Editor~~ — **موقوف**  
**لا** يُستخدم `SUPABASE_SERVICE_ROLE_KEY` من الوكيل.

الخلفية والتفاصيل: [`PATCH-TREE004-UNLINK-REPORT.md`](./PATCH-TREE004-UNLINK-REPORT.md)

---

## الآباء (مرجع)

| الأب | المسار | `person_id` |
|------|--------|-------------|
| علي صالح الأحم | `لاحم بن مطلق بن زيدان/صالح/علي` | `5299acff-5413-4503-9aec-57fde0ef5c26` |
| علي صالح ناصر صالح | `لاحم بن مطلق بن زيدان/صالح/ناصر/صالح/علي` | `8634e81c-fc8a-486d-865f-6b495b81dc23` |

**للحذف فقط:** `577, 578, 579, 580, 581, 582, 583`  
**لا يُمس:** صفوف ناصر `1417–1423`

ترتيب التشغيل الموصى به: **A → B → C → D** (لا تشغّل C قبل التأكد من A و B).

---

## Step A — Dry-run: الصفوف المراد حذفها

المتوقع: **7 صفوف** بالأسماء والمسارات أدناه.

```sql
-- Step A: dry-run — wrong copies under علي صالح الأحم (expect exactly 7 rows)
SELECT
  id,
  child_name,
  parent_name,
  person_id,
  parent_person_id
FROM public.tree_children
WHERE id IN (577, 578, 579, 580, 581, 582, 583)
ORDER BY id;
```

| id | المتوقع (مختصر) |
|---:|------------------|
| 577 | …/صالح/علي/رضاء |
| 578 | …/صالح/علي/رضاء/يزيد |
| 579 | …/صالح/علي/رضاء/زياد |
| 580 | …/صالح/علي/نايف |
| 581 | …/صالح/علي/نايف/وليد |
| 582 | …/صالح/علي/وليد |
| 583 | …/صالح/علي/عبدالمجيد |

تحقق إضافي أن المسارات تحت مسار الأحم وليس ناصر:

```sql
-- Step A (extra): paths must start with …/صالح/علي/ and NOT …/ناصر/…
SELECT id, child_name, parent_name
FROM public.tree_children
WHERE id IN (577, 578, 579, 580, 581, 582, 583)
  AND child_name LIKE 'لاحم بن مطلق بن زيدان/صالح/علي/%'
  AND child_name NOT LIKE 'لاحم بن مطلق بن زيدان/صالح/ناصر/%'
ORDER BY id;
-- expect 7 rows
```

**أوقف هنا إذا العدد ≠ 7 أو الأسماء لا تطابق.**

---

## Step B — التحقق أن أبناء ناصر ما زالوا موجودين (قبل الحذف)

المتوقع: **7 صفوف** (`1417–1423`).

```sql
-- Step B: verify ناصر kids still exist (expect exactly 7 rows)
SELECT
  id,
  child_name,
  parent_name,
  person_id,
  parent_person_id
FROM public.tree_children
WHERE id IN (1417, 1418, 1419, 1420, 1421, 1422, 1423)
ORDER BY id;
```

تحقق أن الأب المباشر لناصر ما زال `8634e81c-…` للأبناء المباشرين:

```sql
-- Step B (extra): direct kids under علي صالح ناصر
SELECT id, child_name, parent_person_id
FROM public.tree_children
WHERE id IN (1417, 1420, 1422, 1423)
  AND parent_person_id = '8634e81c-fc8a-486d-865f-6b495b81dc23'::uuid
ORDER BY id;
-- expect 4 rows: رضاء، نايف، وليد، عبدالمجيد
```

**أوقف هنا إذا العدد ≠ 7 في الاستعلام الأول.**

---

## Step C — الحذف (مع RETURNING)

يشغّل مرة واحدة فقط بعد نجاح A و B.

```sql
-- Step C: DELETE wrong copies only — do NOT include 1417–1423
DELETE FROM public.tree_children
WHERE id IN (577, 578, 579, 580, 581, 582, 583)
RETURNING
  id,
  child_name,
  parent_name,
  person_id,
  parent_person_id;
```

المتوقع من `RETURNING`: **7 صفوف** بنفس معرفات Step A.

---

## Step D — التحقق بعد الحذف

```sql
-- Step D1: deleted ids must be gone (expect 0 rows)
SELECT id, child_name, parent_name
FROM public.tree_children
WHERE id IN (577, 578, 579, 580, 581, 582, 583);
```

```sql
-- Step D2: ناصر rows still intact (expect 7 rows)
SELECT id, child_name, parent_name, parent_person_id
FROM public.tree_children
WHERE id IN (1417, 1418, 1419, 1420, 1421, 1422, 1423)
ORDER BY id;
```

```sql
-- Step D3: no remaining direct children under مسار الأحم …/صالح/علي
SELECT id, child_name, parent_name, parent_person_id
FROM public.tree_children
WHERE parent_name = 'لاحم بن مطلق بن زيدان/صالح/علي'
ORDER BY id;
-- expect 0 rows for the twin-duplicate names (رضاء/نايف/وليد/عبدالمجيد)
```

```sql
-- Step D4: ناصر direct children still present under live UUID
SELECT id, child_name
FROM public.tree_children
WHERE parent_person_id = '8634e81c-fc8a-486d-865f-6b495b81dc23'::uuid
ORDER BY id;
-- expect at least: 1417 رضاء, 1420 نايف, 1422 وليد, 1423 عبدالمجيد
```

---

## معايير النجاح

| فحص | النتيجة المتوقعة |
|------|-------------------|
| Step A | 7 صفوف = `577–583` |
| Step B | 7 صفوف = `1417–1423` |
| Step C `RETURNING` | 7 صفوف محذوفة |
| Step D1 | 0 صفوف |
| Step D2 | 7 صفوف ناصر باقية |
| Step D3 | لا أبناء مباشرين مكرّرين تحت مسار الأحم لتلك الأسماء |

---

## ملاحظات أمان

- احذف **فقط** `id IN (577…583)`. لا توسّع الشرط بمسار نصي وحده.
- **لا** تلمس صفوف ناصر `1417–1423`.
- **لا** تعِد ربط `parent_person_id` الميت `9a3b4a7a-…` إلى UUID الأحم الحي — ذلك يفاقم الخلل.
- نسخة احتياطية سابقة: `backups/patch-tree004-ali-unlink-20260807/`
