# تجميد بوابة 2 — Product Foundation (دستور حي)

**الحالة:** 🟢 **مجمّد رسميًا**  
**تاريخ التجميد:** 2026-08-09  
**عبارة التجميد (صاحب المنتج):** «ابدا»  
**السابق:** بوابة 1 Delegates v2 🟢 («اغلاق ١» 2026-08-09)  
**المسودة المنفَّذة:** [`PRODUCT-FOUNDATION-FREEZE-DRAFT.md`](./PRODUCT-FOUNDATION-FREEZE-DRAFT.md)

---

## الختم الدستوري

**تجميد بوابة 2 (Product Foundation):** 🟢 مجمّد رسميًا — 2026-08-09  
**عبارة التجميد:** «ابدا»  
**Truth Before Speed:** دستوري ساري — لا اعتماد يتخطى فحوصات الصحة  
**Single Write Rule:** دستوري ساري — لا كتابة شجرة من UI خارج Workflow + Validation  
**Tree Engine sole writer:** إضافة دستورية 2026-08-09 — لا كتابة مباشرة في `tree_children` إلا عبر Tree Engine  
**قاعدة الطبقة (أ):** دستوري ساري — لا شاشة/ميزة بلا طبقة واضحة  
**Validation Engine:** جزء من الدستور الحي (مرحلة كانونية مستقلة — يتحقق ولا ينفّذ)  
**السابق:** بوابة 1 Delegates v2 🟢 (قبول حي)

---

## ما جُمِّد (الدستور الحي)

| # | الوثيقة | الدور |
|---|---------|--------|
| 1 | [`PRODUCT-LANGUAGE.md`](./PRODUCT-LANGUAGE.md) | لغة المنتج · Human First · محظورات |
| 2 | [`WORKFLOW-SPECIFICATION-v1.md`](./WORKFLOW-SPECIFICATION-v1.md) | حالات · انتقالات · Audit |
| 3 | [`REQUEST-CATALOG.md`](./REQUEST-CATALOG.md) | فهرس النوايا الوحيد |
| 4 | [`PLATFORM-PRINCIPLES.md`](./PLATFORM-PRINCIPLES.md) | المبادئ · قاعدة الطبقة · SSOT · Single Write · Truth Before Speed · **Tree Engine الكاتب الوحيد** |
| + | [`VALIDATION-ENGINE.md`](./VALIDATION-ENGINE.md) | مرجع المرحلة المستقلة — التحقق قبل الشجرة (ضمن المجموعة الدستورية) |

يمنع أي تطوير يخالف هذا الدستور إلا بقرار معماري صريح.

---

## إضافة دستورية بعد التجميد — Tree Engine sole writer (2026-08-09)

**الحالة:** إضافة دستورية بتوجيه صاحب المنتج بعد تجميد بوابة 2 («ابدا»).  
**لا تُلغى التجميد** — تُسجَّل كـ **addendum** على الدستور الحي.

> لا يجوز لأي جزء من النظام أن يكتب مباشرة في `tree_children`.  
> أي تعديل: Validation → Workflow → Tree Engine فقط.  
> Tree Engine = المسؤول الوحيد عن الكتابة.

**الملكية حسب نوع المشكلة:** بيانات legacy → Integrity + SQL Workspace · منع التكرار → Validation + Workflow + Tree Engine · منع خطأ المستخدم → Request Experience · المراقبة → Health Center.

**صدق التنفيذ:** الفرض الكامل **ليس** مكتملًا بعد — مسارات مندوب/إدارة/استيراد ما زالت دينًا تحت Tree Engine. التفاصيل الحيّة: [`PLATFORM-PRINCIPLES.md`](./PLATFORM-PRINCIPLES.md) § Tree Engine · [`PATCH-1-WRITE-PATHS.md`](./PATCH-1-WRITE-PATHS.md).

---

## بعد التجميد — الخطوة التالية

```
بوابة 2 🟢 (هذا الختم)
        ↓
رحلة القرار ✅ معتمدة («ابدا» 2026-08-09)
        ↓
Request Experience (تصميم) — [`REQUEST-EXPERIENCE-UX-v1.md`](./REQUEST-EXPERIENCE-UX-v1.md)
        ↓
Validation Engine → Workflow Engine → Delegate Workspace (كود) → …
```

**رحلة القرار:** ✅ [`REQUEST-DECISION-JOURNEY-v1.md`](./REQUEST-DECISION-JOURNEY-v1.md) — معتمدة («ابدا» 2026-08-09)  
**التالي للمراجعة:** تصميم Request Experience — [`REQUEST-EXPERIENCE-UX-v1.md`](./REQUEST-EXPERIENCE-UX-v1.md)

> **ممنوع الآن:** كود إنتاج RX قبل اعتماد مواصفة التصميم · كود Delegate Workspace · توسيع Workflow provisional · تجميل legacy مندوب · نوايا مرشّحة بلا صف فهرس.
