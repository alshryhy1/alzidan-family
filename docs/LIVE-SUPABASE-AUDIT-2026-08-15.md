# LIVE Supabase Audit — Storage & Media Proofs

**التاريخ:** 2026-08-15  
**الحالة:** ✅ **LIVE Media Audit مُغلق من نتائج Workspace** (مع ملاحظة حجم اختيارية)  
**النوع:** فحص حي + إثبات كود · بلا Migration · بلا إصلاح  
**المشروع:** `wbskjfdqpugnwvrykqcn`  
**التالي:** [`PERSON-VISIBILITY-SPEC-v1.md`](./PERSON-VISIBILITY-SPEC-v1.md) — مواصفة فقط

---

## إغلاق Workspace (نتائج صاحب المنتج)

| البند | الحكم |
|--------|--------|
| Buckets | **واحد فقط:** `event-media` · `public = true` ✅ |
| `event_media_public_read` `{public}` SELECT | ✅ قراءة عامة لكل كائنات الـbucket |
| `Memory pending public read` `{anon,authenticated}` | ✅ `memory-pending/*` عام قبل الاعتماد — **قطعي** |
| `event_media_public_insert` `{public}` INSERT | ✅ رفع عام |
| Memory pending public upload | ✅ |
| UPDATE / DELETE policies ظاهرة لـpublic | ❌ غير موجودة في النتيجة |
| Signed URLs في المسار | ❌ |
| `memory-pending` خاص قبل الاعتماد | **❌ قطعًا** |
| MED-03 | Code-proven / Live case unavailable (`approval_requests` فارغ) |
| MED-04 | كود مثبت · P1 |
| Orphans | **11 مرشّحًا** — لا حذف |
| Public pending = **P0** قبل أي Media خاص | ✅ |
| استخدام `event-media` للوسائط الخاصة مستقبلًا | **لا** — مطلوب نموذج Private لاحقًا · **لا ننشئه الآن** |

### حجم Objects (اختياري)

- إن وُجدت نتيجة SQL `count(*)` / `bytes_sum` من Workspace → ألصقها هنا للإغلاق الرقمي النهائي.  
- تقدير LIST API (anon، تقريبي فقط): **~131 ملف · ~310 MB** — **لا يغني عن SQL**.

**لا SQL إضافي في مرحلة الوسائط بعد إغلاقكم.**

---

## حكم صاحب المنتج على نتائج anon (مثبّت)

1. **`event-media` عام فعليًا = P0 قبل أي Media خاص**  
   Public URL يجلب الملفات بما فيها `memory-pending` → إخفاء صف الذاكرة في DB **لا يحمي الملف**.

2. **12 مجلد `memory-pending`** تحتاج تصنيفًا لاحقًا (مرتبط؟ مرفوض؟ orphan؟ هل يجب أن تُجلب؟) — بلا افتراض أن كلها مشكلة.

3. **11 مرشّحًا للـorphan وفق الربط الذي فُحص** — **ليست** Orphans مؤكدة. ممنوع الحذف قبل المطابقة الكاملة (كل حالات DB + كل المسارات).

4. **MED-03:** Code-proven ≠ Live-reproduced. فراغ `approval_requests` للـanon ≠ انتفاء المشكلة.

5. **MED-04:** مثبت من الكود → يبقى P1 · لا إصلاح قبل فهم مسار النشر الكامل.

**بعد إغلاق A/B/C من Workspace فقط:** LIVE Media Audit ✅ → ثم Person Visibility Specification (وثيقة) → ثم Composition.

**لا مبرر لفتح:** Person Photo · Avatar · Media Migration · DW · UI implementation.

---

## ملخص تنفيذي

| # | البند | الحالة |
|---|--------|--------|
| 1 | Buckets الفعلية | **جزئي:** كائنات تحت اسم `event-media` مؤكدة · كتالوج كل الـbuckets **غير مرئي** للـanon |
| 2 | RLS لكل عملية | **جزئي:** LIST+DOWNLOAD عبر public مؤكدان · UPLOAD/UPDATE/DELETE **لم تُختبر حيًا** (ممنوع كتابة تجريبية) · نص السياسات الكامل يحتاج SQL/Dashboard |
| 3 | عينة objects | ✅ جُمعت |
| 4 | pending | ✅ 12 مجلدًا تحت `memory-pending/` |
| 5 | orphans | ✅ **مرشّحون:** 11 ملف pending غير موجودين في `family_memory_media` الظاهر للـanon |
| 6 | MED-03 | ✅ **مثبت من الكود** · ❌ لا إثبات صف حي عبر anon (`approval_requests` فارغ للـanon) |
| 7 | MED-04 | ✅ **مثبت من الكود** · عيّنات مناسبات منشورة تحتوي `imageUrl` (مسار ويب/envelope) لا تنفي فجوة الموبايل |

**الخلاصة:** الفحص الحي بـanon **أغلق جزءًا مهمًا** (وجود bucket مستخدم · DOWNLOAD عام · pending · orphan candidates) و**لم يغلق** كتالوج buckets الكامل ولا نصوص RLS ولا إثبات صف MED-03 حي.  
**لا كود / لا SQL تعديلي / لا DW / لا Composition→تنفيذ.**

---

## 1) Buckets الفعلية

| فحص | نتيجة | حكم |
|-----|--------|-----|
| `GET /storage/v1/bucket` (anon) | `[]` HTTP 200 | anon **لا يرى الكتالوج** |
| `GET /storage/v1/bucket/event-media` | `NoSuchBucket` | meta غير متاح للـanon |
| `POST …/object/list/event-media` | HTTP 200 · كائنات ومجلدات | **bucket بالاسم `event-media` مستخدم وحي** |
| Buckets أخرى؟ | غير قابلة للإثبات من anon | **مفتوح** — يلزم Dashboard / `select * from storage.buckets` |

**لا نثبت:** «event-media هو الوحيد في المشروع».  
**نثبت:** الكود والتطبيق الحي يستخدمان `event-media` وفيه كائنات فعلية.

### جذر `event-media` (عينة)

**مجلدات (25):**  
`memory-pending` · `special-card-pending` · `special-cards` · `EVN-*` (12) · `EVAPP-*` (11)

**ملفات جذر:** عشرات `admin_*` + عدة `delegate_*`

---

## 2) العمليات — كل واحدة مستقلة

| العملية | إثبات حي (anon) | ملاحظة |
|---------|-----------------|--------|
| **LIST** | ✅ 200 على prefixes متعددة | لا يكفي وحده لباقي العمليات |
| **DOWNLOAD** | ✅ Public URL HTTP 200 لـ`admin_…` و`memory-pending/…` و`EVN/…` و`EVAPP/…` و`special-cards/…` | من يعرف الرابط يستطيع الجلب |
| **UPLOAD** | ⏳ غير مختبر حيًا في هذه الجولة | الكود يرفع بـanon؛ نص سياسة INSERT في `admin.js` — **غير مؤكد كنص RLS حي** |
| **UPDATE** | ⏳ غير مختبر | لا مسار كود واضح للتحديث |
| **DELETE** | ⏳ غير مختبر · ممنوع تجريبيًا هنا | لا `.remove` في مسارات الوسائط المفحوصة سابقًا |
| **PUBLIC URL** | ✅ يعمل للتنزيل | المسار الحالي يعتمد عليه |
| **RLS نص كامل** | ❌ | يلزم `pg_policies` / Dashboard |

---

## 3) عينة objects / مسارات

| مسار | ملاحظة |
|------|--------|
| `admin_*.png/.mov/.jpeg` | كثيرة في الجذر · قابلة للتحميل |
| `delegate_*.png/.mov` | في الجذر · قابلة للتحميل |
| `memory-pending/MEM-…/*` | 12 مجلد طلب |
| `special-card-pending/CRD-MY6U-EOWS/` | ملف صورة |
| `special-cards/person.jpeg` | موجود · قابل للتحميل |
| `EVN-XTQA-ILCR/image-….jpeg` | يطابق مناسبة منشورة فيها `imageUrl` |
| `EVAPP-*/image|video-…` | مجلدات طلبات مناسبة |

---

## 4) الملفات المعلّقة `pending`

تحت `memory-pending/`:

`MEM-MRHKZN0G-KS7O` · `MEM-MRHLG60Z-HFVY` · `MEM-MRHLJMGO-1JZA` · `MEM-MRHLKZPQ-LAX5` · `MEM-MRHLZ7Y1-AHSQ` · `MEM-MRHMCWFO-S8UV` · `MEM-MRHMGW58-PNWZ` · `MEM-MRHN6Y28-8TZ9` · `MEM-MRI7L39J-ZJC4` · `MEM-MRI7YLPZ-V6UK` · `MEM-MSQDI0G9-UNN1` · `TEST-123`

**DB الظاهر للـanon:**  
`family_memory_items` → `approved=1` فقط (id=14) · `pending/rejected/archived` = 0 صفوف ظاهرة.  
`family_memory_media` → صف واحد يشير إلى  
`memory-pending/MEM-MRI7YLPZ-V6UK/image-1783886496120.jpeg`

---

## 5) Orphans (مرشّحون)

**تعريف هذا الفحص:** ملف تحت `memory-pending/` قابل للـDOWNLOAD العام و**غير** مذكور في `family_memory_media` الظاهر للـanon.

| | العدد |
|--|------|
| مرتبط بصف media ظاهر | **1** |
| مرشّح يتيم / غير مربوط بالظاهر | **11** |

أمثلة مرشّحين:  
`MEM-MRHKZN0G-KS7O/image-….png` · عدة `video-…` · `TEST-123/image-test.jpg` (4 بايت) · `MEM-MSQDI0G9-UNN1/…`

**تحفظ:** قد توجد صفوف `pending/rejected` في DB مخفية عن anon بـRLS وتربط بعض الملفات — لذلك التسمية **orphan candidates** حتى يُغلق الفحص بـservice role / admin RPC.

---

## 6) MED-03 — قبول المندوب ≠ نشر الذكرى

### إثبات كود (✅)

في `delegate.js` عند القبول:

- `event|health|death` → إدراج `family_events`
- `tree` → تطبيق إضافة فرد
- ثم دائمًا `rpcSetDelegateApprovalRequestStatus(…, "approved")`
- **لا فرع** يستدعي `memory_admin_set_status_v1` ولا يحدّث `family_memory_items`

بينما تصنيف `memory_card` → `canAct: true` (يظهر للمندوب كقابل للإجراء).

النشر الفعلي للذكرى: طابور الإدارة → `memory_admin_set_status_v1`.

### إثبات صف حي عبر anon (❌ غير متاح)

`GET approval_requests` بـanon يعيد `[]` — لا يمكن مقارنة `memory_card` معتمد مقابل `family_memory_items.status` من هذا السياق.

**للحسم الحي لاحقًا (مسار إدارة):** قبول طلب `memory_card` واحد كمندوب ثم مقارنة الحالتين.

---

## 7) MED-04 — موبايل مناسبة → نشر يسقط الوسائط

### إثبات كود (✅)

| الجانب | السلوك |
|--------|--------|
| موبايل `eventRequestMessage.ts` | يضع `image_url` / `video_url` في JSON **مسطّح** تحت `__JSON__` · **بلا** `envelope.event` · **بلا** أسطر `رابط الصورة:` |
| ويب `event-builder.js` `buildFromApprovalRequest` | إن وُجد `envelope.event` → يأخذ `details` كما هي؛ وإلا → `extractEventMediaLinks(msg)` من الأسطر العربية فقط |
| النتيجة | طلب موبايل بوسائط مسطّحة **لا يُمرَّر** إعلاميًا إلى `details.imageUrl` عند البناء |

### ملاحظة حيّة (لا تنفي MED-04)

مناسبات ظاهرة للـanon (مثل id 64/63) تحتوي `details.imageUrl` يشير إلى `EVN-…` — هذا يتوافق مع مسار **ويب/envelope** ناجح، وليس مع مسار الموبايل المسطّح.

إثبات صف موبايل حي يحتاج طلبًا معروف المصدر من التطبيق ثم فحص `family_events.details` بعد قبول المندوب (مسار إدارة).

---

## 8) ما لم يُغلق بعد (يلزم SQL Workspace / service role)

```sql
-- للقراءة فقط — لا تُنفَّذ من هذه المهمة تلقائيًا
select id, name, public, file_size_limit from storage.buckets;
select policyname, cmd, qual, with_check
  from pg_policies
 where schemaname = 'storage' and tablename = 'objects';
```

- عدد objects الكلي والأحجام  
- مقارنة كل `media_url` / `details` مع وجود الملف (orphans شاملة)  
- صفوف `family_memory_items` غير `approved`  
- محتوى `approval_requests` لإثبات MED-03 صفًا  

---

## 9) ترتيب ما بعد هذا التقرير

1. إغلاق بنود SQL Workspace أعلاه (قراءة) إن رغب صاحب المنتج.  
2. **Person Visibility Specification** (وثيقة فقط) — بعد رضاكم عن إغلاق LIVE.  
3. ثم Composition لقاء الشخص (مفهوم · لا تنفيذ كود من الـmock).  

**GEN-01** يبقى مقفلًا · تنفيذ مؤجل.  
**لا DW · لا Migration وسائط · لا Person Photo في v1 حتى To-Be Media.**

---

## خاتمة

**تم الفحص الحي ضمن صلاحية anon + إثبات MED-03/04 من الكود.**  
لم يُصلح شيء. لم يُكتب SQL. لم يُرفع/يُحذف شيء في هذه الجولة.
