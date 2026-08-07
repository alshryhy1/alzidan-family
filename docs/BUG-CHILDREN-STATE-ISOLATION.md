# BUG — Children State Isolation / Approve parent_person_id-only (TREE-004)

**التاريخ:** 2026-08-07  
**الحالة:** إصلاح مسار الكتابة + عزل حالة الواجهة ✅ · Unlink dry-run جاهز (`PATCH-TREE004-UNLINK-REPORT.md`) · Apply يحتاج `SUPABASE_SERVICE_ROLE_KEY`  
**الرمز:** `TREE-004`  
**المرجع:** [`ENGINEERING-ROADMAP.md`](./ENGINEERING-ROADMAP.md) · ADR-001/002/006

---

## 1) التشخيص (من المستخدم — معتمد)

1. اختيار الأب **علي صالح الأحم** ثم التبديل إلى **علي صالح ناصر صالح** ثم إضافة أبناء للثاني.
2. النتيجة: نفس الأبناء يظهرون/يُربطون **بكلا الأبويين**.
3. السبب الجذري **ليس** عرض الشجرة فقط، بل:
   - **عزل حالة الواجهة:** قائمة أبناء مؤقتة / نموذج إضافة لا تُصفَّر عند تغيير الأب.
   - **مسار اعتماد إضافة ابن:** إعادة حل الأب بالاسم (`parent_name` / ورقة اسم / `endsWith(/علي)` / `limit(1)`) بدل الالتزام بـ `parent_person_id` المختار من الواجهة.

حتى مع `person_id`، إعادة استخدام مصفوفة أبناء أب سابق يكرر الخلل.

---

## 2) إصلاح الكود

| طبقة | التغيير |
|------|---------|
| `family-person-core.js` | `childrenForSelectedParent` (مفتاح أب دقيق) · `bindParentWriteContext` · `attachBoundParentToRow` · `isolateChildrenMapArrays` |
| `family-management-panel.js` | عند تغيير الأب: إغلاق ورقة الإضافة + `resetSession` للأبناء |
| `family-add-sheet.js` | ربط `boundPersonId` عند الفتح؛ رفض الحفظ إذا تغيّر الأب (TREE-004) |
| `request-actions.js` | `enrichOneTreeCardRow` يطلب `parent_person_id` فقط ويتحقق أنه يطابق شخصًا واحدًا؛ أزيل `countDistinctParentMatches` بالاسم |
| `admin-family-mgmt.js` / `delegate.js` | رفض حفظ ابن بلا `parent_person_id` للأب غير الجذر |

**قاعدة الاعتماد:** إن نقص `parent_person_id` أو لم يطابق شخصًا واحدًا حيًّا → **فشل العملية بالكامل** وصفر أبناء جدد.

---

## 3) بيانات الإنتاج (مسح 2026-08-07)

| الأب | المسار | `person_id` |
|------|--------|-------------|
| علي صالح الأحم (قصير) | `…/صالح/علي` | `5299acff-5413-4503-9aec-57fde0ef5c26` (صف 1626، أُنشئ 2026-08-06) |
| علي صالح ناصر صالح | `…/صالح/ناصر/صالح/علي` | `8634e81c-fc8a-486d-865f-6b495b81dc23` (صف 634) |

**أبناء مباشرون متطابقو الاسم (توائم):** رضاء · نايف · وليد · عبدالمجيد  
- تحت الأحم: ids `577,580,582,583` (2026-06-19) — `parent_person_id` يشير إلى UUID ميت `9a3b4a7a-…`  
- تحت ناصر: ids `1417,1420,1422,1423` (2026-06-21) — مربوطون صح بـ ناصر  

لا توجد صفوف `parent_name=الأحم` + `parent_person_id=ناصر` (لا ربط UUID متقاطع).

### سياسة الإصلاح

1. **آمن / غير غامض:** إعادة ربط `parent_person_id` الميت لأبناء الأحم → `5299acff-…` (هوية الأحم الحالية).  
2. **حذف علاقة تحت الأحم والإبقاء تحت ناصر:** فقط لأبناء **مضافين خطأ** يُحدَّدون صراحة بـ `--delete-ids` أو من حمولة طلب اعتماد — **لا** حذف تلقائي لكل أبناء الأحم.

```bash
npm run repair:ali-dual           # dry-run
npm run repair:ali-dual -- --snapshot
# يحتاج SUPABASE_SERVICE_ROLE_KEY:
npm run repair:ali-dual -- --apply
npm run repair:ali-dual -- --apply --delete-ids=577,580
```

---

## 4) اختبار

```bash
npm run verify:children-isolation
```

سيناريو الانحدار: اختر أب A → بدّل إلى B → قائمة أبناء B فارغة/خاصة به → الحفظ يستخدم UUID الأب B فقط.

---

## 5) Rollback

- Git: إرجاع كوميت TREE-004.  
- بيانات: `backups/patch-tree004-ali-20260807/` + Patch 0.
