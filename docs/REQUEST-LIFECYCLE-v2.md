# دورة حياة الطلب v2 — Request Lifecycle v2

**التاريخ:** 2026-08-12  
**النطاق:** `alzidan-family` (مندوب + إدارة + طلباتي على الويب). تطبيق Layali للجوال خارج هذا المسار.

---

## 1) نموذج الدورة (فصلان)

| المحور | القيم | المصدر |
|--------|--------|--------|
| **حالة الطلب** | `pending` · `approved` · `rejected` | `approval_requests.status` |
| **الظهور العام** | `scheduled` · `visible` · `ended` (+ `hidden` يدوي) | يُحسب عند القراءة من `show_at` / `show_before_days` / `event_date` / `end_at` / `manual_hidden` |

```
طلب جديد → بانتظار الإجراء
         → قبول → تم القبول → (مجدول → وقت الظهور → ظاهر) أو (بدون جدولة → منشور الآن)
         → رفض → تم الرفض (يبقى في القائمة)
```

**قبول ≠ نشر فوري.** عند قبول مناسبة مؤرّخة تُكتب حقول الجدولة (افتراضيًا 3 أيام قبل `event_date`) إلى `family_events`. الظهور العام يُحسب لاحقًا بدون cron.

---

## 2) واجهة المندوب («طلبات فرعي»)

تبويبات الحالة مع العدادات:

**كل الطلبات | بانتظار الإجراء | تم القبول | تم الرفض**

- أزرار قبول/رفض تظهر فقط لـ `pending`.
- المقبول يبقى تحت «تم القبول» مع تسمية فرعية:
  - `مقبول — مجدول للظهور في [تاريخ عربي]`
  - `مقبول — منشور / ظاهر الآن`
  - `مقبول — منتهٍ` عند انتهاء النافذة
- المرفوض يبقى تحت «تم الرفض» مع سبب آمن إن وُجد.
- لا يختفي العنصر بعد القبول.

---

## 3) الإدارة و«طلباتي»

- فلتر الإدارة: بانتظار الإجراء / تم القبول / تم الرفض / كل الطلبات — قائمة «تم القبول» تعرض المقبولين (ليست pending فقط).
- نشر الإدارة يكتب حقول الجدولة عبر `admin_publish_event_card_v1`.
- «طلباتي» للمقدّم تُحدّث الحالة من القاعدة وتُبقي السجل بعد القبول/الرفض (تُحذف فقط عند حذف صف الطلب).

---

## 4) SQL / RPC — ماذا تشغّل في مساحة SQL

بالترتيب المقترح (من بطاقات الصيانة أو Supabase SQL Editor):

1. **`maint.event_schedule_visibility_v1`**  
   ملف: `supabase/sql/COPY-ME-event-schedule-visibility.sql`  
   أعمدة الجدولة + تحديث مسارات الإدراج/النشر.

2. **`maint.delegate_branch_requests_expand_v2`**  
   ملف: `supabase/sql/COPY-ME-delegate-branch-requests-expand.sql`  
   - القائمة تُرجع `pending + approved + rejected` عبر بوابة **can_read**  
   - الحمولة `jsonb` مع: حقول الطلب + `show_at` / `show_before_days` / `event_date` / `end_at` / `manual_hidden` / `published` / `event_id` + `reviewed_by`  
   - **مهم:** بطاقة v1 قد تُؤرشف كـ«منفّذ» بينما الجسم ما زال `pending` فقط — وجود اسم الدالة ≠ lifecycle v2.

تحقق سريع (قراءة فقط): بطاقة **`maint.event_schedule_visibility_probe_v1`**  
يجب أن يكون العمود **`list_body_is_lifecycle_v2 = true`** (وليس مجرد وجود الدالة).

> ملاحظة: بطاقات الصيانة تعتمد SQL مضمّنًا (لا تعتمد على جلب `*.sql` من الاستضافة لأن المجلد قد لا يُنشر).

---

## 5) ملفات تغيّرت (أبرزها)

| مسار | دور |
|------|-----|
| `supabase/sql/COPY-ME-delegate-branch-requests-expand.sql` | قائمة مندوب غنية + تاريخ الحالات |
| `supabase/sql/COPY-ME-event-schedule-visibility.sql` | أعمدة/RPC الجدولة |
| `assets/js/modules/events/event-visibility.js` | حساب الظهور + تسميات المراجع/المقدّم |
| `assets/js/delegate.js` | تبويبات + تسميات + قبول مع جدولة |
| `assets/js/modules/requests.js` / `request-actions.js` | وضوح الإدارة + جدولة عند النشر |
| `assets/js/modules/admin-sql-presets.js` (+ workspace) | أوامر صيانة مضمّنة |
| `assets/css/delegate.css` / `admin.css` | ألوان حالات الظهور |
| `scripts/verify-event-schedule-visibility.js` | تحقق محلي |

لا مساس جماعي بـ `delegates_v2` ولا بـ `tree_children` خارج مسارات القبول المعتمدة.

---

## 6) تحقق يدوي

1. شغّل أمري SQL أعلاه في Workspace.  
2. قدّم مناسبة بتاريخ بعد أكثر من 3 أيام.  
3. من المندوب: قبول → يختفي من «بانتظار» ويظهر تحت «تم القبول» كتسمية **مجدول…**.  
4. رفض طلب آخر → يبقى تحت «تم الرفض».  
5. لاختبار «منشور»: عدّل `show_at` في الصف إلى وقت ماضٍ (أو مناسبة داخل نافذة 3 أيام) → التسمية تصبح **منشور / ظاهر الآن**.  
6. من الرئيسية: «طلباتي» ما زالت تعرض الطلب بعد القرار.  
7. تأكد أن إشعار الحالة يذهب للمقدّم وليس للمراجع، وبدون JSON خام.

تحقق آلي:

```bash
node scripts/verify-event-schedule-visibility.js
```
