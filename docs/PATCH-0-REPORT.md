# Patch 0 — تقرير الحماية وفحص السلامة

**التاريخ:** 2026-08-07  
**الحالة:** مكتمل مع تحفّظ واحد (انظر البوابة)  
**المرجع:** [`ENGINEERING-ROADMAP.md`](./ENGINEERING-ROADMAP.md) §6 · [`ADR.md`](./ADR.md) ADR-007  
**طريقة الوصول:** قراءة فقط عبر Supabase REST بمفتاح `anon` (بدون تعديل بيانات الإنتاج)

---

## 1) Backup

| البند | القيمة |
|--------|--------|
| المسار | `backups/patch-0-20260807/` (محلي، مستثنى من git عبر `backups/` و`*backup*`) |
| الصيغة | لقطات JSON لكل جدول |
| المصدر | `https://wbskjfdqpugnwvrykqcn.supabase.co/rest/v1/...` |
| pg_dump / service_role | غير متاح في هذه الجلسة (لا كلمة مرور DB ولا `SUPABASE_SERVICE_ROLE_KEY` محليًا) |

### الجداول المصدَّرة والعدد

| جدول | الصفوف |
|------|--------|
| `tree_children` | 857 |
| `tree_spouses` | 50 |
| `tree_mother_links` | 143 |
| `approval_requests` | 0 *(مرئي لـ anon — انظر التحفظ)* |
| `family_events` | 3 |
| `banner_messages` | 1 |
| `member_profiles` | 6 |
| `family_memory_items` | 2 |
| `site_settings` | 3 |
| `family_polls` | 0 |

تفاصيل SHA-256 للملفات في: `backups/patch-0-20260807/meta/integrity-scan.json`.

خطوات الاسترجاع: [`../backups/patch-0-20260807/RESTORE.md`](../backups/patch-0-20260807/RESTORE.md) (نسخة محلية مع النسخة الاحتياطية).

---

## 2) Integrity Scan — الأرقام الرئيسية

توزيع الفروع في `tree_children`: ملحم 88 · زيدان 166 · لاحم 403 · مزيد 155 · زايد 45.

| الفحص | العدد | ملاحظة |
|--------|------:|--------|
| `person_id` مفقود | **0** | سليم |
| `parent_person_id` مفقود | **40** | منها ~14 جذور/مراسي فروع متوقعة |
| `parent_name` مفقود | **0** | سليم |
| `parent_person_id` لا يطابق أي `person_id` حي | **13** | آباء محذوفون/غير مزامَنين — مرشّح لـ Repair لاحقًا |
| `parent_name` بلا عقدة مطابقة في الفرع | **1** | اختلاف إملائي محتمل: `دوخى` vs `دوخي` (مزيد) |
| تكرار `person_id` | **0** | سليم |
| عناقيد اسم كامل مكرّر (نفس المسار) | **0** | سليم |
| عناقيد اسم ورقة غامض (نفس الاسم القصير داخل فرع) | **172** | متوقع قبل Canonical Identity — خطر الربط بالاسم |
| زوجات بلا زوج صالح (`husband_id` → `tree_children.id`) | **0** | الـ 50 زوجة مربوطة بـ row id |
| دورات عبر `parent_person_id` | **0** | سليم |
| دورات عبر سلسلة `parent_name` | **0** | سليم |
| بنرات منتهية وما زالت `is_active=true` | **1** | id=7، `show_days=7` منذ 2026-07-18 |
| أحداث تجاوزت `showDays` في `details` | **3** | كلها أقدم من 7 أيام |
| طلبات معتمدة بلا أثر في الشجرة (خاصة add-son) | **غير مكتمل** | `approval_requests` تُرجع 0 صفوف لـ anon (RLS) |

نتائج خام: `backups/patch-0-20260807/meta/integrity-scan.json`.

---

## 3) Versioning (خط الأساس قبل Identity)

انظر أيضًا [`DATA-VERSIONS.md`](./DATA-VERSIONS.md).

| الحقل | القيمة الحالية |
|--------|----------------|
| **Schema Version** | `baseline` |
| **Data Version** | `0` |
| **Migration Version** | `0` |

بعد Patch 1 (Canonical Person Identity) يُرفع Data/Migration وفق سكربت الهوية.

---

## 4) Rollback Plan

1. **قبل أي كتابة في Patch 1+:** الاحتفاظ بمجلد `backups/patch-0-20260807/` وعدم حذفه.
2. **استرجاع جدول واحد:** من JSON عبر upsert حذر بمفتاح طبيعي (`id` أو `(branch_key, parent_name, child_name)` / `person_id`) — التفاصيل في `RESTORE.md`.
3. **استرجاع كامل مفضّل:** عند توفر `service_role` أو اتصال Postgres: استيراد JSON أو `pg_restore` من dump جديد يؤخذ قبل أول migration كتابة.
4. **لا يُنفَّذ rollback تلقائيًا** — يدوي بعد فشل Validation لكل Patch.
5. **ADR:** أثناء الاسترجاع والتجارب يُمنع الربط بالاسم عند الكتابة (ADR-002).

---

## 5) البوابة — جاهزية Patch 1

| معيار Patch 0 | الحالة |
|----------------|--------|
| Backup للجداول الحرجة | ✅ JSON محلي |
| Integrity Scan + تقرير | ✅ |
| تسجيل Schema/Data/Migration | ✅ `baseline` / `0` / `0` |
| Rollback موثّق | ✅ |
| فحص طلبات معتمدة بلا أثر | ⚠️ ناقص بدون service_role |

### الحكم

**Patch 0 مكتمل مع تحفّظ:** النسخ والفحص والتوثيق جاهزة؛ بند طلبات الاعتماد يحتاج إعادة فحص بمفتاح خدمة لاحقًا.

**جاهز لبدء Patch 1 (Canonical Person Identity):** نعم — بشرط عدم لمس منطق قبول الطلبات حتى يُغلق فحص `approval_requests` أو يُدرج صراحةً في Patch 2 (Requests).

**لم يُبدأ Patch 1 في هذه الجولة** (وفق القيد).
