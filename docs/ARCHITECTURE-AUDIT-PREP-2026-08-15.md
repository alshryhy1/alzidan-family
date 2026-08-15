# Architecture Audit / Preparation — عائلة الزيدان

**التاريخ:** 2026-08-15  
**النوع:** Audit فقط — **تم الفحص** · لم يُنفَّذ إصلاح  
**النطاق:** `alzidan-family` (ويب) · `alzidan-family-mobile` (موبايل)  
**ممنوع في هذه المهمة:** كود · Migration · SQL تشغيل · UI · RX/VE/WF/DW من تلقاء الوكيل

---

## القواعد المرجعية (مُسلَّم بها · غير مُنفَّذة بالكامل في الكود)

1. الوجود ≠ الظهور · المسار المطلوب: `DB → Family Engine → Visibility Policy → User Context → UI`  
2. لا عنصر نسائي في واجهات القرابة/البحث/التسلسل الحالية · السجلات النسائية تبقى في المحرك  
3. مجتمع نسائي مستقل = مستقبل · افصل Identity/Graph/Visibility عن Experience  
4. لا Person Photo / Avatar / Migration وسائط الآن  
5. مساحة المناديب مجمّدة  

---

# 1) ما هو موجود فعلًا

## A — Family / Identity

| عنصر | الواقع |
|------|--------|
| مصدر الأشخاص للشجرة/البحث | **`tree_children`** (+ `tree_parents` / `tree_branches`) |
| الزوجات | **`tree_spouses`** — سجلات نسائية حقيقية · **ليست** عقد شجرة عامة |
| ربط أم–ابن | **`tree_mother_links`** |
| ملخص زواج عام | **`tree_spouse_summary`** (إحصاءات · لا أسماء قابلة للبحث عادة) |
| ربط العضو | **`member_profiles`** (هاتف ↔ شخص/شجرة) |
| طلبات إضافة/تصحيح | **`approval_requests`** (قد تحمل `gender` في الرسالة قبل الكتابة) |

**العلاقات:** أب→ابن عبر `parent_person_id` / مسارات الاسم · زوجة عبر `tree_spouses.husband_id` · أم عبر `tree_mother_links`.

**افتراض الظهور الحالي:** أي صف في `tree_children` يُحمَّل للبحث/الشجرة العامة (فلتر فرع فقط). **لا** عمود `discoverable` / gender gate على القراءة العامة في الكود.

**بنات:** تبويب «ابنة» في إدارة العائلة يمر كـ`tree_children` · حقل gender في الحفظ **لا يُpersist** في مسار FM المفحوص → الابنة تصبح شخص شجرة قابلًا للبحث كأي ابن.

**زوجات:** موجودة في DB و**لا** تدخل فهرس البحث/الشجرة العامة لأن الواجهة لا تحمّل `tree_spouses` كأشخاص — غياب معماري عن الفهرس لا Visibility Engine.

## B — Visibility (أين يُصفّى؟)

| السطح | أين؟ | الحكم |
|-------|------|--------|
| شجرة / بحث أشخاص | تحميل كل `tree_children` للفرع ثم مطابقة نص | **لا Visibility Policy للشخص** · افتراض الوجود=الظهور |
| مناسبات / نبض / قائمة | جلب واسع ثم `isFamilyEventPubliclyVisible` | **إخفاء بعد الجلب (UI/عميل)** — يخالف مبدأ «لا SELECT ثم إخفاء» دستوريًا |
| ذكريات | `status=eq.approved` في الاستعلام | **تصفية عند الاستعلام** |
| بطاقات خاصة | `is_active` + جدولة عميل (+ RLS مذكور في SQL) | مختلط |
| بانر | `is_active` ثم فلتر ظهور | مختلط |
| زوجات في البحث العام | غير محمّلة | ليست إخفاء UI لصفوف محمّلة |

**خلاصة B:** سياسة الظهور **موجودة للمناسبات كعميل** · **للذكريات كـstatus** · **غائبة كطبقة موحّدة للأشخاص**. مبدأ «كل استعلام عبر Visibility» **غير مطبّق** على الشجرة/البحث.

## C — Roles / Capabilities

| الممثل | موجود؟ | نموذج الصلاحية |
|--------|--------|----------------|
| زائر | نعم (anon) | قراءة عامة + إرسال طلبات · بلا جدول capabilities |
| عضو | `member_profiles` + جلسة هاتف | هوية ناعمة · ليس كتالوج صلاحيات |
| مندوب | **`delegates_v2` + أدوار + `delegate_role_permissions`** | **طبقة capabilities حقيقية** (ويب + SQL enforce) |
| إدارة | توكن مشترك `admin_token_ok_v1` | بوابة توكن · ليست أدوارًا دقيقة |

**موبايل:** `public_app_login_by_phone_v1` يعيد `member|delegate|both` للترحيب/الدفع — **ليس** بوابة سر المندوب ولا enforce لـ`tree.write`.

## D — Media (As-Is)

```text
اختيار → رفع → event-media (ما يستخدمه الكود)
  → Public URL → DB (media_url / details / message)
  → موافقة/status → ظهور (approved / event visibility)
  → قراءة UI → حذف صف غالبًا بلا حذف Storage
```

| مرحلة | ملفات/جداول رئيسية |
|-------|---------------------|
| رفع ذكرى | `memory/submit.js` · `memorySubmit.ts` · مسار `memory-pending/…` |
| رفع مناسبة | `event-submit.js` · `EventsScreen.tsx` |
| نشر ذكرى | **`memory_admin_set_status_v1`** (إدارة) |
| جسر مندوب | `approval_requests` kind=`memory_card` |
| قراءة | `memory.ts` / `memory/home.js` · `status=approved` |

**LIST≠DOWNLOAD≠UPLOAD≠DELETE≠RLS** — فحص حي جزئي فقط سابقًا.

## E — تباعد ويب / موبايل

| | ويب | موبايل |
|--|-----|--------|
| كتابة شجرة | إدارة/مندوب (+ دين Tree Engine) | طلبات فقط |
| نشر مناسبات/ذكريات | نعم (مندوب/إدارة) | لا واجهة نشر |
| وسائط مناسبة | envelope `event.details` | JSON مسطّح → خطر سقوط عند النشر |
| صلاحيات مندوب | سر + enforce | هاتف فقط (إشعار) |
| شجرة | كاملة | قراءة |

## F — Women's Experience مستقبلًا

**نعم معماريًا ممكن** فوق نفس `tree_children` / المحرك **إذا** وُجدت طبقة Visibility/Capabilities — **بدون** نسخ الشجرة.  
اليوم: لا تجربة نسائية · الزوجات في جدول منفصل · البنات غير مميّزات بعد الكتابة · لا يمنع المستقبل إن لم نجمّد افتراض «كل tree_child ظاهر».

---

# 2) ما هو غير موجود

- Visibility Policy موحّدة للأشخاص (`discoverable` / سياق مشاهد)
- Person Photo / Avatar / `person_media` path
- Signed URL architecture للوسائط الخاصة
- Capabilities للزائر/العضو (فقط مندوب)
- مجتمع نسائي / Women's Experience
- مساحة المناديب (طلب ككيان خدمة) — مجمّدة
- حذف Storage عند reject/archive (في الكود)
- إثبات حي كامل: كل buckets · كل RLS · orphans

---

# 3) افتراضات خاطئة في الكود / المنتج

| الافتراض | الواقع |
|----------|--------|
| الوجود ≠ الظهور للأشخاص | **مخالف** لـ`tree_children` العام |
| لا نساء في الواجهة = لا نساء في الشجرة | الزوجات مخفيات عن الفهرس · **البنات إن كُتبن يظهرن** |
| gender في نموذج الإضافة يُحفظ | مسار FM لا يpersist gender |
| قبول المندوب للذكرى = نشر الذكرى | **MED-03:** يحدث اعتماد الطلب بلا `memory_admin_set_status_v1` |
| مندوب على الموبايل = صلاحيات ويب | هوية إشعار فقط |
| صورة الشخص متاحة للـComposition | لا مسار منتج |
| event-media الوحيد في Supabase | مثبت كاستخدام كود فقط |

---

# 4) الفجوات

| ID | الفجوة |
|----|--------|
| VIS-01 | أشخاص: لا سياسة ظهور قبل UI |
| VIS-02 | مناسبات: fetch-then-hide |
| GEN-01 | **Gender/Visibility Modeling** — أبناء/بنات + أزواج/زوجات عبر سياسة ظهور واحدة · ليس «إخفاء بنات» فقط · مكان السجل ≠ الظهور · ممنوع حذف/نقل للإخفاء — التفاصيل: [`GEN-01-GENDER-VISIBILITY-MODELING.md`](./GEN-01-GENDER-VISIBILITY-MODELING.md) |
| MED-01 | مسار Public كامل في التطبيق |
| MED-03 | مندوب + memory_card بلا نشر عنصر الذاكرة |
| MED-04 | موبايل مناسبة → publish قد يسقط الوسائط |
| MED-05 | orphans مرشّحة (لا حذف Storage) |
| CAP-01 | لا capabilities موحّدة خارج المندوب |
| LIVE-01 | فحص Supabase الحي غير مكتمل |

---

# 5) ملفات / دوال / جداول متأثرة (عينة)

**جداول:** `tree_children` · `tree_spouses` · `tree_mother_links` · `tree_spouse_summary` · `member_profiles` · `family_events` · `family_memory_*` · `approval_requests` · `delegates_v2` · `delegate_role_permissions` · `special_cards`

**ويب:** `app.js` · `event-visibility.js` · `memory/submit.js` · `memory/home.js` · `event-submit.js` · `event-builder.js` · `delegate.js` · `admin-memory-queue.js` · `admin-family-mgmt.js` · `request-experience.js` · `home-request-create.js`

**موبايل:** `publicData.ts` · `memory.ts` · `memorySubmit.ts` · `eventVisibility.ts` · `EventsScreen.tsx` · `eventRequestMessage.ts` · `ProfileScreen.tsx` · `supabase.ts`

**SQL/مرجع:** `COPY-ME-delegates-v2*.sql` · نصوص bucket في `admin.js` · `MEDIA-PIPELINE-MAP-v1.md` · `PERSON-VISIBILITY-MATRIX-v1.md`

---

# 6) المخاطر

### P0 — يمنع الاعتماد الآمن للتصميم/الوسائط

| | |
|--|--|
| **MED-03** | قبول مندوب لذكرى بلا نشر العنصر |
| **MED-01 / Storage عام** | Public URL + رفع anon (مع تحفظ: RLS الحي غير مثبت كاملًا) |
| **VIS-01** | أشخاص بلا Visibility Policy — أي Composition «زائر/عضو» بلا محرك حقيقي ستُكذب عند التنفيذ |

### P1 — قبل المرحلة التالية

| | |
|--|--|
| **MED-04** | وسائط مناسبة موبايل عند النشر |
| **MED-05** | orphans |
| **LIVE-01** | إغلاق فحص Supabase الحي |
| **CAP-01 / تباعد موبايل** | مندوب هاتف ≠ قدرات ويب |
| **GEN-01** | Gender/Visibility Modeling (بنات+زوجات+…) بلا سياسة موحّدة — الظهور اليوم صدفة جداول/استعلام لا محرك | `GEN-01-GENDER-VISIBILITY-MODELING.md` · ابنة→`tree_children` ظاهرة · زوجة→`tree_spouses` غائبة عن الفهرس · gender يضيع عند حفظ الابن/الابنة |
| **VIS-02** | مناسبات: إخفاء بعد الجلب |

### P2 — دين يمكن تأجيله

- allowlists في JS تتباعد عن SQL  
- مصفوفة زائر/عضو غير مشحونة  
- تجميل DW / RX من تلقاء الوكيل  
- Composition بصورة شخص  

---

# 7) توصية المرحلة التالية (فحص فقط · لا تنفيذ)

1. **إكمال Supabase الحي** (Dashboard / SQL Workspace): buckets · policies لكل عملية (LIST/DOWNLOAD/UPLOAD/DELETE) · عيّنة objects · orphans.  
2. **إثبات حي MED-03 و MED-04** بسيناريو واحد لكل منهما.  
3. **ورقة Visibility للأشخاص** (مواصفة لا كود): أين تُصفّى الشجرة/البحث قبل أن تُبنى واجهة لقاء الشخص.  
4. **الإبقاء على التجميد:** لا Person Photo · لا DW · لا Migration وسائط · لا Composition→كود.  
5. أي تنفيذ لاحق = **اعتماد منفصل صريح**.

---

## خاتمة

**تم الفحص.**  
لم يُصلح شيء.  
لم يُبدأ RX-Build / VE / WF / Delegate Workspace.  
الواقع الحالي: محرك أشخاص مفتوح الظهور · وسائط عامة · صلاحيات مندوب ناضجة على الويب فقط · فجوة نشر ذكريات المندوب · تباعد موبايل/ويب في الوسائط والنشر.
