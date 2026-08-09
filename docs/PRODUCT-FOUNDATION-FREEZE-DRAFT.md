# مسودة تجميد بوابة 2 — Product Foundation (دستور حي)

**الحالة:** ✅ **نُفِّذت** — بوابة 2 🟢 مجمّدة رسميًا  
**تاريخ التجميد:** 2026-08-09  
**عبارة التجميد:** «ابدا»  
**الختم الحي:** [`PRODUCT-FOUNDATION-FREEZE.md`](./PRODUCT-FOUNDATION-FREEZE.md)

> هذه المسودة أُرشفت بعد التنفيذ. المرجع التشغيلي = ملف الختم أعلاه.

---

## الوثائق الأربع + المبدأ الدستوري

| # | الوثيقة | دورها عند التجميد |
|---|---------|-------------------|
| 1 | [`PRODUCT-LANGUAGE.md`](./PRODUCT-LANGUAGE.md) | لغة المنتج · Human First · محظورات |
| 2 | [`WORKFLOW-SPECIFICATION-v1.md`](./WORKFLOW-SPECIFICATION-v1.md) | حالات · انتقالات · Audit |
| 3 | [`REQUEST-CATALOG.md`](./REQUEST-CATALOG.md) | فهرس النوايا الوحيد |
| 4 | [`PLATFORM-PRINCIPLES.md`](./PLATFORM-PRINCIPLES.md) | المبادئ · قاعدة الطبقة · SSOT · Single Write Rule |
| + | **Truth Before Speed** (قاعدة ج داخل المبادئ) | الصحة قبل سرعة الاعتماد · كل الفحوصات قبل طفرة الشجرة |
| + | **Validation Engine** | جزء من المجموعة الدستورية — يتحقق ولا ينفّذ |

---

## تعريف الإغلاق 🟢 لبوابة 2

- [x] بوابة 1 🟢 مؤكَّدة من صاحب المنتج («اغلاق ١» 2026-08-09)
- [x] الوثائق الأربع معلَّمة مجمّدة
- [x] Truth Before Speed مذكور صراحة في الختم
- [x] Single Write · قاعدة الطبقة · Validation Engine ضمن المجموعة المجمّدة
- [x] الخارطة تمنع القفز إلى كود RX/DW قبل اعتماد رحلة القرار ثم تصميم RX
- [x] commit واحد · بدون push إلا بطلب صريح

---

## بعد 🟢 بوابة 2 مباشرة

```
اعتمدوا رحلة القرار   ← عبارة المنتج التالية
        ↓
Request Experience (تصميم أولًا)
        ↓
Validation Engine
        ↓
Workflow Engine (إغلاق عند مرحلته)
        ↓
Delegate Workspace (كود) — UX معتمد مسبقًا بلا تنفيذ مبكر
```
