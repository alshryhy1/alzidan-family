# Media Pipeline Map — خريطة الوسائط (خط أساس)

**الحالة:** As-Is من الكود ✅ · فحص Supabase الحي ⏳ مطلوب قبل أي Migration  
**التاريخ:** 2026-08-15  
**الغرض:** خط أساس قبل Composition لقاء الشخص · قبل أي Media Architecture To-Be  
**ممنوع من هذه الوثيقة وحدها:** إصلاح Storage · Migration · Person Photo · Composition بصورة

---

## مبدآن ملزمان

1. **الوجود ≠ الظهور**  
2. **الوسيط ≠ هوية الشخص**  
   `family_memory_media` مربوطة بذكرى (وقد تُربط بشخص في سياق الذكرى) ≠ صورة بروفايل / avatar للشخص.

---

## تحفظات تدقيقية (لا تُتجاوز)

| # | لا نثبت من GitHub وحده | ما يثبته الكود الآن |
|---|------------------------|---------------------|
| 1 | «`event-media` هو الـbucket الوحيد في مشروع Supabase» | **`event-media` هو الـbucket الذي يستخدمه كود الويب والموبايل** للذكريات/المناسبات/البطاقات؛ قد توجد buckets أخرى أُنشئت من Dashboard |
| 2 | «سياسات anon SELECT+INSERT على كامل الـbucket كحكم أمني نهائي» | التطبيق يرفع ويقرأ عبر **anon + Public URL**؛ نص إنشاء السياسات موجود في `admin.js` كـSQL جاهز — **تأكيد RLS الحي من Supabase مطلوب** |
| 3 | — | **قبول المندوب على `approval_requests` لا يستدعي `memory_admin_set_status_v1`** → عنصر الذاكرة قد يبقى `pending` — تُبقى **P0/P1 مستقلة** |

---

## الحكم المعماري المحسوم (منتج)

| قرار | الحالة |
|------|--------|
| صورة محمد الكبيرة في Composition تنفيذي | ✕ الآن |
| Avatar / معرض صور خاص بالشخص | ✕ الآن |
| Person Photo في v1 | مؤجّل حتى بعد فحص Supabase الحي + To-Be Media Architecture |
| Migration / إصلاح وسائط من هذه الخريطة وحدها | ✕ ممنوع |

---

## ما يثبته الكود (As-Is)

```text
File
 ↓
event-media   ← bucket المستخدم في الكود (ليس بالضرورة الوحيد في المشروع)
 ↓
Public URL    ← /storage/v1/object/public/event-media/...
 ↓
DB            ← media_url أو details JSON
 ↓
status / visibility
 ↓
UI
```

يخلط ما يجب فصله لاحقًا:

```text
وجود الملف
≠ حق الوصول إليه
≠ ظهوره في الواجهة
≠ ارتباطه بهوية الشخص
```

### القنوات في الكود

| القناة | أين يُحفظ الرابط | صورة شخص؟ |
|--------|------------------|-----------|
| ذكريات | `family_memory_media.media_url` | لا — وسائط ذكرى |
| مناسبات | `family_events.details` JSON | لا |
| بطاقات خاصة | `special_cards.image_url` | بطاقة ≠ شجرة |
| لقاء الشخص / الشجرة | لا مسار رفع في الكود | لا |

### فجوات مفتوحة (من الكود — ليست كلها مثبتة حيًا)

| ID | الفجوة | أولوية |
|----|--------|--------|
| MED-01 | مسار Public بالكامل في التطبيق | معماري |
| MED-02 | pending قد يكون قابلًا بالرابط قبل الاعتماد (إن كان الـbucket عامًا حيًا) | أمني — يُؤكد حيًا |
| MED-03 | **مندوب يقبل memory_card بلا نشر `family_memory_items`** | **P0/P1 مستقلة** |
| MED-04 | موبايل مناسبة: JSON مسطّح قد يسقط الوسائط عند النشر | دين وظيفي مستقل |
| MED-05 | لا حذف Storage ظاهر في الكود عند reject/archive | orphan مرشّح — يُحصى حيًا |
| MED-06 | لا Person Photo path في الكود | منتج |

---

## ترتيب العمل المعتمد

| # | الخطوة | الحالة |
|---|--------|--------|
| 1 | تثبيت خريطة As-Is من الكود | ✅ هذه الوثيقة |
| 2 | فحص Supabase الحي: buckets / policies / objects | 🟡 جزئي — [`LIVE-SUPABASE-AUDIT-2026-08-15.md`](./LIVE-SUPABASE-AUDIT-2026-08-15.md) · كتالوج buckets + RLS نص كامل + MED-03 صف حي ما زالت مفتوحة |
| 3 | فحص orphan files بعد reject/archive/delete | ⏳ بعد 2 |
| 4 | فحص مسار مناسبة الموبايل → النشر (JSON) | ⏳ مستقل |
| 5 | تصميم Media Architecture To-Be | ⏳ بعد 2–4 |
| 6 | قرار: هل Person Photo في v1؟ | ⏳ بعد 5 |
| 7 | Composition لقاء الشخص (بلا افتراض صورة) | ⏳ بعد مصفوفة الرؤية + 6 |

---

## فحص Supabase الحي — قائمة تحقق

يُنفَّذ من **Dashboard / SQL Workspace / service role** — لا من anon وحدها كحكم نهائي:

- [ ] `select * from storage.buckets;` — كل الـbuckets وأعلام `public`
- [ ] سياسات `storage.objects` لـ `event-media` وأي bucket آخر
- [ ] عيّنة prefixes: `memory-pending/` · طلبات مناسبات · `special-card-pending/` · `admin_` · `delegate_`
- [ ] عدد objects وحجم تقريبي
- [ ] مقارنة: URLs في `family_memory_media` / `family_events.details` / `special_cards` ↔ وجود الملف
- [ ] orphan: ملفات بلا صف DB أو صفوف مرفوضة/مؤرشفة بلا حذف ملف
- [ ] هل يوجد bucket غير مذكور في GitHub؟

**محاولة وكيل (2026-08-15) بـanon فقط — أدلة جزئية وليست حكمًا نهائيًا:**

| فحص | نتيجة |
|-----|--------|
| `GET /storage/v1/bucket` | `[]` — الـanon **لا يرى كتالوج الـbuckets** (لا يثبت عدم وجود buckets أخرى) |
| `GET /storage/v1/bucket/event-media` | `Bucket not found` للـmeta عبر anon |
| `POST …/object/list/event-media` | **200** — سرد يعمل؛ توجد مجلدات `memory-pending/MEM-…` وملفات `admin_…` في الجذر |
| `family_memory_items` عبر REST+anon | `approved=1` ظاهر · `pending/rejected/archived=0` للـanon (قد يكون RLS يخفي غير المعتمد) |

**فصل العمليات (ملزم):** نجاح `LIST` ≠ إثبات `DOWNLOAD` / `UPLOAD` / `UPDATE` / `DELETE` / صلاحية Public URL / نص RLS. كل عملية تُفحص مستقلة في الخطوة 2.

**الخلاصة:** وجود كائنات تحت اسم `event-media` مؤكد جزئيًا عبر LIST من anon. **قائمة كل الـbuckets + نص السياسات + DOWNLOAD/UPLOAD/UPDATE/DELETE + الأحجام + orphans** ما زالت تحتاج Dashboard / SQL Workspace / service role — الخطوة 2 غير مكتملة.

---

## قرار v1 (محسوم حتى إشعار آخر)

> **لا صورة شخص في v1** حتى يكتمل فحص الوسائط الحي ويُحسم Media Architecture To-Be.  
> Composition محمد (صورة كبيرة) = **Concept بصري فقط** · **ممنوع تحويله إلى كود** في هذه المرحلة.  
> **لا نصلح قبل أن نعرف:** لا تغيير bucket · لا RLS جديد · لا نقل ملفات · لا `person_media` · لا تحويل إلى private الآن.

---

## مراجع كود سريعة

ويب: `memory/submit.js` · `event-submit.js` · `modules/events/event-media.js` · `modules/admin-memory-queue.js` · `admin.js` (نص SQL للـbucket)  
موبايل: `services/memorySubmit.ts` · `services/memory.ts` · `services/supabase.ts` · `screens/EventsScreen.tsx`
