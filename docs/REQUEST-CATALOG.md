# Request Catalog — فهرس نوايا المستخدم

**الحالة:** دستور المنصة / دستور حي  
**تجميد بوابة 2 (Product Foundation):** 🟢 مجمّد رسميًا — 2026-08-09  
**عبارة التجميد:** «ابدا»  
**Truth Before Speed:** دستوري ساري — لا اعتماد يتخطى فحوصات الصحة  
**السابق:** بوابة 1 Delegates v2 🟢 (قبول حي)  
**التاريخ:** 2026-08-08 · **تاريخ التجميد:** 2026-08-09  
**المراجع:** [`PRODUCT-LANGUAGE.md`](./PRODUCT-LANGUAGE.md) · [`WORKFLOW-SPECIFICATION-v1.md`](./WORKFLOW-SPECIFICATION-v1.md) · [`PLATFORM-PRINCIPLES.md`](./PLATFORM-PRINCIPLES.md) · [`ENGINEERING-ROADMAP.md`](./ENGINEERING-ROADMAP.md) · الختم: [`PRODUCT-FOUNDATION-FREEZE.md`](./PRODUCT-FOUNDATION-FREEZE.md)

هذا هو **المرجع الوحيد** لإضافة عملية جديدة يعتمدها المستخدم.

أي نية جديدة = صف هنا أولًا → ثم صف في جدول الثلاث لغات → ثم نوع في مواصفة السير إن لزم → ثم كود.

لا تُضاف شاشة/زر «عملية» دون صف في هذا الفهرس.

---

## 1) فهرس النوايا (Intent Catalog)

| نية المستخدم (عرض) | النوع الداخلي (تقني) | الخدمة |
|--------------------|----------------------|--------|
| أضف فردًا | `tree_card` | Family Engine |
| صحح بيانات | `tree_edit` | Family Engine |
| أعلن وفاة | `event_death` | Family Engine |
| أعلن زواج | `event_marriage` | Family Engine |
| شارك ذكرى | `memory_card` | Memory Service |
| اطلب بطاقة | `special_card` | Cards |
| أعد تعيين الرقم السري للمندوب | `delegate_secret_reset` | Delegates v2 (شاشة إدارة مخصصة — ليس كروم الشجرة/المناسبات) |

- عمود **نية المستخدم** = ما يظهر في Request Experience ولغة المنتج.
- عمود **النوع الداخلي** = ما يخزّنه Workflow / السجلات (`request_type` أو ما يعادله).
- عمود **الخدمة** = من ينفّذ أثر البيانات بعد الاعتماد عبر المحرك — **ليست** نقطة كتابة مباشرة من الواجهة.

---

## 2) قواعد إضافة عملية جديدة

1. أضف صفًا في الجدول أعلاه (نية · نوع · خدمة).
2. حدّث [`PRODUCT-LANGUAGE.md`](./PRODUCT-LANGUAGE.md) (الثلاث لغات + محظورات إن لزم).
3. إن كان النوع جديدًا على آلة الحالات: سجّله في [`WORKFLOW-SPECIFICATION-v1.md`](./WORKFLOW-SPECIFICATION-v1.md) كـ Request Type — **نفس عُقد المحرك**، بلا آلة موازية.
4. الصلاحية عبر **Delegates v2** إن لزم مندوب.
5. التطبيق على البيانات عبر الخدمة المذكورة فقط بعد انتقال المحرك (`approved` → `applied`).

خرق الترتيب أعلاه = رفض تصميم قبل التنفيذ.

---

## 3) ملاحظات

- النوايا أعلاه هي النواة المعتمدة لـ Product Foundation و**نطاق RX v1** — [`REQUEST-EXPERIENCE-UX-v1.md`](./REQUEST-EXPERIENCE-UX-v1.md).
- توسعات مرشّحة (إعلان مولود · إضافة زوجة · أضف أبناء كنية مستقلة) = **⬛ مؤجّلة** — تُضاف بنفس الجدول لا بمسارات جانبية · **لا شاشة RX حتى صف هنا** — انظر [`REQUEST-DECISION-JOURNEY-v1.md`](./REQUEST-DECISION-JOURNEY-v1.md) §3.2 / §8.2.
- تسمية العرض للمندوب/الإدارة قد تختلف قليلًا وفق [`PRODUCT-LANGUAGE.md`](./PRODUCT-LANGUAGE.md) مع الإبقاء على نفس `النوع الداخلي`.

---

## 4) نية تشغيلية: إعادة تعيين الرقم السري

- **العرض للإدارة:** طلب إعادة تعيين الرقم السري · المندوب · الفرع · بانتظار الإدارة  
- **أزرار:** اعتماد وإصدار رقم سري جديد · رفض  
- **لا** تُعرض انتقالات Workflow العامة (مُعيَّن / مناسبات / شجرة).  
- SQL عبر **SQL Workspace → أوامر الصيانة الجاهزة** (`maint.delegate_secret_reset_v1`).
