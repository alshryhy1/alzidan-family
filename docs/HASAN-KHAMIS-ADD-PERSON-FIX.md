# إصلاح تجاوز حسن تحت خميس — مسار أضف فردًا

**التاريخ:** 2026-08-09  
**النطاق:** الرئيسية → قدّم طلبًا → أضف فردًا للعائلة فقط (لا مناسبات)

## مسار الكود الحقيقي

| العنصر | الاسم |
|--------|--------|
| ملف الصفحة | `pages/index.html` (`#request-experience` → `[data-rx-root]`) |
| زر الإرسال | `[data-rx-submit]` |
| event handler | مستمع `click` → `submitAddPerson()` في `assets/js/modules/request-experience.js` |
| دالة إنشاء الطلب | `AlzidanHomeRequestCreate.create` في `assets/js/modules/home-request-create.js` |
| مكان INSERT | `insertApprovalRequest` → `client.from("approval_requests").insert(row)` |
| دوال المنع | `findExistingChildUnderParent` (بوابة RX) ثم `AlzidanDupIdentityGuard.evaluate` (`ADD_PERSON_EXISTS`) قبل أي insert |

## سبب تجاوز حسن/خميس

عند الضغط على «شخص آخر بنفس الاسم» يُضبط `different_person_same_name` / `acknowledgeReview`.

إذا كانت قائمة `siblings` فارغة أو ناقصة بينما `people` ما زالت تحتوي **حسن** تحت نفس `parent_person_id` للأب خميس (`f7e1a75e-…` / المسار `…/دليميك/خميس`)، كان الحارس يعيد **`allow`** بدل **`block`** — فيُنشأ طلب (`تم الإرسال`).

عامل مساعد: `parent_path` من الواجهة يأتي بمسافات حول `/` فلا يطابق `parent_name` في DB حرفيًا؛ الاعتماد على `siblings` فقط كان هشًا.

## التعديل

1. `dup-identity-guard.js` — مسح `people` أيضًا لإثبات نفس الابن تحت نفس الأب؛ لا يتجاوزه «شخص آخر بنفس الاسم».
2. `home-request-create.js` — جلب الإخوة بـ `parent_person_id` مباشرة + تطبيع مسار الأب.
3. `request-experience.js` — تفضيل `parent_path = parent.id` (بدون مسافات)، قفل `busy` مبكرًا، تعزيز دمج أبناء المسار.
4. `pages/index.html` — cache-bust `?v=20260809hasan1`.

## التحقق

```bash
npm run verify:dup-identity   # 21/21
npm run verify:hasan-khamis   # live siblings لخميس + block قبل insert + double-submit
```

## ما لم يُغيَّر

- لا مناسبات / مرض / وفاة / ذكرى
- لا migrations / لا تعديل بيانات الشجرة / لا Build / لا push
