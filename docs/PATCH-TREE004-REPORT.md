# Patch TREE-004 — Children State Isolation + Approve parent_person_id-only

**التاريخ:** 2026-08-07  
**الحالة:** كود ✅ · اختبار ✅ · إصلاح بيانات: dry-run جاهز · apply معلّق على `SUPABASE_SERVICE_ROLE_KEY`  
**Bug:** [`BUG-CHILDREN-STATE-ISOLATION.md`](./BUG-CHILDREN-STATE-ISOLATION.md)

---

## 1) الهدف

1. منع إعادة استخدام قائمة أبناء أب سابق عند تبديل الأب في إدارة العائلة.  
2. مسار اعتماد/تطبيق إضافة ابن يعتمد **`parent_person_id` فقط** — بلا إعادة حل بالاسم.  
3. إصلاح آمن لـ `parent_person_id` الميت تحت علي صالح الأحم؛ توثيق توائم ناصر دون حذف أعمى.

---

## 2) ما شُحن

| ملف | دور |
|-----|-----|
| `assets/js/modules/family-management/*` | عزل حالة الأبناء + ربط نموذج الإضافة |
| `assets/js/modules/request-actions.js` | بوابة اعتماد: UUID أب فريد أو فشل |
| `assets/js/admin-family-mgmt.js` / `delegate.js` | رفض الكتابة بلا `parent_person_id` |
| `assets/js/modules/canonical-person.js` | رمز/رسالة `TREE-004` |
| `scripts/test-children-state-isolation.js` | انحدار |
| `scripts/repair-ali-dual-children.mjs` | dry-run / relink / حذف صريح |

---

## 3) نتائج المسح (علي)

| | الأحم `…/صالح/علي` | ناصر `…/ناصر/صالح/علي` |
|--|-------------------|------------------------|
| أبناء مباشرون | رضاء نايف وليد عبدالمجيد (577…) | نفس الأسماء (1417…) |
| `parent_person_id` | ميت `9a3b4a7a-…` | صحيح `8634e81c-…` |

**Apply الآمن المقترح:** تحديث الصفوف 577/580/582/583 إلى `parent_person_id = 5299acff-…`.  
**لم يُحذف** تلقائيًا أي ابن تحت الأحم (سياسة المستخدم: ليس كل أبنائه؛ التوائم تحتاج تحديد صريح).

---

## 4) أوامر

```bash
npm run verify:children-isolation
npm run repair:ali-dual -- --snapshot
# SUPABASE_SERVICE_ROLE_KEY=… npm run repair:ali-dual -- --apply
```

---

## 5) Compatibility

| سطح | أثر |
|-----|-----|
| Admin قبول tree_card | ✅ يفشل بلا `father_person_id` / `parent_person_id` |
| إدارة العائلة Admin/Delegate | ✅ عزل جلسة الأب |
| عرض الويب/الموبايل | قراءة فقط — يظهر بعد إصلاح الروابط |

---

## 6b) Unlink (2026-08-07 — توضيح المستخدم)

المستخدم طلب **حذف الروابط الخاطئة فقط** تحت علي صالح الأحم (توائم ناصر)، وليس relink.
انظر [`PATCH-TREE004-UNLINK-REPORT.md`](./PATCH-TREE004-UNLINK-REPORT.md) و `npm run repair:ali-unlink`.

## 6) الخطوة التالية

1. تطبيق relink الآمن بمفتاح service_role.  
2. إن وُجد طلب اعتماد يحدد الأبناء المضافين خطأ: `--delete-ids` تحت الأحم فقط.  
3. ضمان إرسال `father_person_id` من نماذج الإضافة العامة/الموبايل مع كل طلب جديد.
