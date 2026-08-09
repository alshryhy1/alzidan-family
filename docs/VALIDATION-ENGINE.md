# Validation Engine — محرك التحقق

**الحالة:** مخطّط (مرحلة كانونية رسمية) — ⚪ تنفيذ · **مرجع دستوري ضمن تجميد بوابة 2 🟢**  
**التاريخ:** 2026-08-08 · **ختم الدستور الحي:** 2026-08-09 («ابدا») — [`PRODUCT-FOUNDATION-FREEZE.md`](./PRODUCT-FOUNDATION-FREEZE.md)  
**النوع:** مرحلة مستقلة — **ليست** ملاحظة داخل Workflow · **ليست** مجرد دوال مساعدة  
**المراجع:** [`PLATFORM-PRINCIPLES.md`](./PLATFORM-PRINCIPLES.md) · [`ENGINEERING-ROADMAP.md`](./ENGINEERING-ROADMAP.md) · [`REQUEST-CATALOG.md`](./REQUEST-CATALOG.md) · [`WORKFLOW-SPECIFICATION-v1.md`](./WORKFLOW-SPECIFICATION-v1.md)

---

## الموقع في السلّم

```
Delegates v2 → Product Foundation → Request Experience
        → Validation Engine ← هذه المرحلة
        → Workflow Engine → Delegate Workspace → Admin UX
        → Family Engine Alignment → iOS Experience Rebuild
```

يُنفَّذ **بعد** Request Experience و**قبل** إغلاق/توسيع Workflow Engine الإنتاجي.

---

## الهدف

قبل أن يصل الطلب إلى المندوب أو تُمسّ الشجرة: اكتشاف الأخطاء والتعارضات، وحماية جودة بيانات الشجرة.

**Truth Before Speed:** الصحة أهم من سرعة الاعتماد — كل الفحوصات اللازمة قبل أي طفرة على الشجرة.

---

## المسؤولية (يتحقق — لا ينفّذ)

| مسؤولية | المعنى |
|---------|--------|
| هوية | `person_id` لا الاعتماد على الاسم وحده |
| تكرار | منع التكرارات الواضحة |
| تعارض منطقي | اكتشاف تعارضات الحقائق |
| سلامة الهيكل | حماية بنية الشجرة |
| اكتمال | اكتمال الحقول حسب نوع الطلب من الفهرس |
| أسباب واضحة | رفض / طلب تصحيح بأسباب يفهمها المندوب |

لا يكتب على الشجرة. لا يستبدل Workflow (الحالات · التعيين · السجل). لا يستبدل Delegate Workspace (التنفيذ البشري).

---

## مبدأ المنتج

الزائر والمندوب والإدارة **لا يبنون الشجرة** — يقدّمون حقائق.  
النظام يتحقق (هذه الطبقة) ويربط ويقرّر قابلية التطبيق؛ الكتابة عبر Workflow + Validation فقط (**Single Write Rule**).

---

## علاقة بأساس Workflow الحالي

أساس Workflow Engine v1 الموجود على `main` = **مؤقت / provisional**.  
لا يُوسَّع كمسار إنتاج حتى تُنشأ هذه المرحلة وتتم المواءمة.  
إغلاق Workflow (سلامة + إزالة مسار اعتماد قديم + إعلان استقرار) يحدث **عند الوصول لمرحلته في السلّم** — ليس بوابة قبل Request Experience.

---

## خارج النطاق (عمدًا)

- شاشات Request Experience / Delegate Workspace  
- آلة حالات Workflow  
- كتابة Family Engine  
- واجهة إدارة كاملة للتحقق (قد تُعرض النتائج لاحقًا عبر Admin UX)
