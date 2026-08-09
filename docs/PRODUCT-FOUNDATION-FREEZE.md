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
| 4 | [`PLATFORM-PRINCIPLES.md`](./PLATFORM-PRINCIPLES.md) | المبادئ · قاعدة الطبقة · SSOT · Single Write · Truth Before Speed |
| + | [`VALIDATION-ENGINE.md`](./VALIDATION-ENGINE.md) | مرجع المرحلة المستقلة — التحقق قبل الشجرة (ضمن المجموعة الدستورية) |

يمنع أي تطوير يخالف هذا الدستور إلا بقرار معماري صريح.

---

## بعد التجميد — الخطوة التالية

```
بوابة 2 🟢 (هذا الختم)
        ↓
اعتمدوا رحلة القرار   ← عبارة المنتج المطلوبة
        ↓
Request Experience (تصميم أولًا) — بلا كود شاشات حتى الاعتماد
        ↓
Validation Engine → Workflow Engine → Delegate Workspace (كود) → …
```

**عبارة المنتج التالية:** «اعتمدوا رحلة القرار»  
المسودة: [`REQUEST-DECISION-JOURNEY-v1.md`](./REQUEST-DECISION-JOURNEY-v1.md)

> **ممنوع الآن:** كود Request Experience · كود Delegate Workspace · توسيع Workflow provisional · أي شاشة منفردة قبل اعتماد رحلة القرار.
