# مسودة تجميد بوابة 2 — Product Foundation (دستور حي)

**الحالة:** 📝 مسودة جاهزة للتنفيذ — بوابة 1 🟢 («اغلاق ١» 2026-08-09) · **بوابة 2 ما زالت غير مجمّدة** حتى أمر صريح  
**أُعدّت:** 2026-08-09  
**الزناد:** قل للوكيل **«جمّدوا بوابة ٢»** (أو «تجميد بوابة 2») — لا تجميد تلقائي بعد إغلاق بوابة 1  
**الغرض:** commit واحد يجمّد الدستور الحي + Truth Before Speed ثم يفتح السلّم لـ Request Experience (تصميم أولًا)

> **ممنوع الآن:** تنفيذ هذا التجميد بلا أمر صريح · فتح كود Request Experience · فتح كود Delegate Workspace.

---

## الوثائق الأربع + المبدأ الدستوري

| # | الوثيقة | دورها عند التجميد |
|---|---------|-------------------|
| 1 | [`PRODUCT-LANGUAGE.md`](./PRODUCT-LANGUAGE.md) | لغة المنتج · Human First · محظورات |
| 2 | [`WORKFLOW-SPECIFICATION-v1.md`](./WORKFLOW-SPECIFICATION-v1.md) | حالات · انتقالات · Audit |
| 3 | [`REQUEST-CATALOG.md`](./REQUEST-CATALOG.md) | فهرس النوايا الوحيد |
| 4 | [`PLATFORM-PRINCIPLES.md`](./PLATFORM-PRINCIPLES.md) | المبادئ · قاعدة الطبقة · SSOT · Single Write Rule |
| + | **Truth Before Speed** (قاعدة ج داخل المبادئ) | الصحة قبل سرعة الاعتماد · كل الفحوصات قبل طفرة الشجرة |

---

## قائمة تعديل الملفات (عند الزناد فقط)

نفّذ بالترتيب في **commit واحد** بعنوان مقترح:

`docs: freeze Product Foundation (Gate 2) after Delegates v2 acceptance`

1. **هذه المسودة** → انقلها/حدّثها إلى حالة **🟢 مجمّد** مع تاريخ التجميد، أو احذفها بعد دمج المحتوى في الوثائق الأربع إن رُغب — المفضل: أبقِ ملف ختم قصير `PRODUCT-FOUNDATION-FREEZE.md` بحالة 🟢.
2. في كل من الوثائق الأربع: غيّر سطر **تجميد بوابة 2** من 🟡 إلى **🟢 مجمّد رسميًا** + تاريخ.
3. [`ENGINEERING-ROADMAP.md`](./ENGINEERING-ROADMAP.md): بوابة 2 → 🟢 · PF-0 → 🟢 · حدّث «الخطوة التالية» إلى **Request Experience (تصميم أولًا)**.
4. [`DELEGATES-V2-PHASE2.md`](./DELEGATES-V2-PHASE2.md) + [`DELEGATES-V2-ACCEPTANCE.md`](./DELEGATES-V2-ACCEPTANCE.md): بوابة 1 → 🟢 مع إشارة أن القبول الحي نجح (بعد إبلاغ صاحب المنتج).
5. **لا** تلمس كود المنتج في نفس الـ commit.

### نص الختم المقترح (يُلصق أعلى كل وثيقة دستور)

```text
**تجميد بوابة 2 (Product Foundation):** 🟢 مجمّد رسميًا — YYYY-MM-DD
**Truth Before Speed:** دستوري ساري — لا اعتماد يتخطى فحوصات الصحة
**السابق:** بوابة 1 Delegates v2 🟢 (قبول حي)
```

---

## تعريف الإغلاق 🟢 لبوابة 2

- [x] بوابة 1 🟢 مؤكَّدة من صاحب المنتج («اغلاق ١» 2026-08-09)
- [ ] الوثائق الأربع معلَّمة مجمّدة
- [ ] Truth Before Speed مذكور صراحة في الختم
- [ ] الخارطة تمنع القفز إلى كود RX/DW قبل التصميم المعتمد لـ RX
- [ ] commit واحد · بدون push إلا بطلب صريح

---

## بعد 🟢 بوابة 2 مباشرة

```
Request Experience (تصميم أولًا)
        ↓
Validation Engine
        ↓
Workflow Engine (إغلاق عند مرحلته)
        ↓
Delegate Workspace (كود) — UX معتمد مسبقًا بلا تنفيذ مبكر
```
