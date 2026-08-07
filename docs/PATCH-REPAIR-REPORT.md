# Patch Repair / Integrity — تقرير إصلاح البيانات وأساس السلامة

**التاريخ:** 2026-08-07  
**الحالة:** تنظيف يدوي مكتمل (علي + مختصرات) ✅ · Integrity = قراءة فقط · أي إصلاح لاحق = dry-run ثم موافقة — لا apply تلقائي  
**المرجع:** [`ENGINEERING-ROADMAP.md`](./ENGINEERING-ROADMAP.md) بند Repair · [`ADR.md`](./ADR.md) ADR-001/002/004/007  
**Depends on:** Patch 0–3 · Patch News Expiry

---

## 1) الهدف (هذه الشريحة)

1. إصلاح آمن لـ `parent_person_id` المكسور/الناقص عندما يكون تطابق الأب **غير غامض**.
2. أساس Integrity Engine (views + `admin_integrity_report_v1`) نحو Health Center لاحقًا — **بدون** Redesign إدارة كامل.
3. توثيق ما أُصلح / ما أُجّل، ونسخ احتياطي قبل أي كتابة.

---

## 2) Backup

| البند | القيمة |
|--------|--------|
| Patch 0 (مرجع) | `backups/patch-0-20260807/` — **يُحتفظ به** |
| لقطة قبل الإصلاح | `backups/patch-repair-20260807/` (`tree_children` JSON + `meta/dry-run.json`) |
| pg_dump / service_role | غير متاح في هذه الجلسة (`SUPABASE_DB_PASSWORD` / `SUPABASE_SERVICE_ROLE_KEY` غير مضبوطين؛ CLI login-role → Forbidden) |

`RESTORE.md` داخل مجلد اللقطة + خطة Patch 0.

---

## 3) Dry-run (حي عبر anon REST — 2026-08-07)

| المؤشر | العدد |
|--------|------:|
| صفوف `tree_children` | 856 |
| `parent_person_id` مفقود | 38 |
| `parent_person_id` مكسور (UUID بلا صف حي) | 13 |
| **مرشّحو إصلاح غير غامض** | **25** |
| مؤجّل (جذور/مسارات قصيرة/غامض) | 26 |
| عناقيد اسم ورقة غامض | 172 |
| زوجات بلا زوج صالح | 0 |
| طلبات معتمدة ظاهرة لـ anon | 0 (RLS — REQ-001 غير مكتمل) |

### تفصيل المرشّحين (25)

| نمط المطابقة | العدد | ملاحظة |
|--------------|------:|--------|
| `exact_parent_name` | 14 | تطابق مسار أب حرفي فريد في الفرع |
| `norm_alef_maksura` (ى→ي) | 11 | إصلاح إملائي موثّق فقط؛ **لا** إعادة كتابة أسماء العرض |

معرفات الصفوف:  
`196, 212, 251, 287, 288, 577, 580, 582, 583, 938, 943, 944, 951, 1045, 1551–1555, 1594, 1604–1608`.

### مؤجّل (أمثلة)

| الحالة | إجراء لاحق |
|--------|------------|
| جذور/مراسي فروع بلا أب | متوقع — TREE-003 استثناء جذر |
| id `1734` أب `محمد` + UUID ميت | غامض — يدوي / Canonical Identity |
| مسارات قصيرة (عبدالعزيز، عيد، …) | إعادة تطبيق طلب أو Repair يدوي بمسار كامل |
| `approval_requests` معتمدة بلا أثر | يحتاج service_role + `admin_integrity_report_v1` |
| 172 عنقود اسم غامض | ليس إصلاحًا تلقائيًا (ADR-002) |

خام: `backups/patch-repair-20260807/meta/dry-run.json`.

---

## 4) ما شُحن في المستودع

| ملف | الغرض |
|-----|--------|
| `supabase/sql/20260807_patch_repair_parent_links.sql` (+ `scripts/`) | `tree_norm_arabic_path_v1` · `tree_repair_parent_candidates_v1` · `tree_repair_parent_person_id_apply_v1(dry_run)` |
| `supabase/sql/20260807_integrity_engine_v1.sql` (+ `scripts/`) | views سلامة + `admin_integrity_report_v1` / `admin_integrity_list_v1` |
| `scripts/repair-parent-person-id.mjs` | Dry-run حي · `--snapshot` · `--apply` (service_role) |
| `scripts/test-patch-repair.js` | Smoke وثائق/سكربتات |

### أوامر التشغيل

```bash
# Dry-run + لقطة
node scripts/repair-parent-person-id.mjs --snapshot

# تطبيق عبر REST (يتطلب SUPABASE_SERVICE_ROLE_KEY)
SUPABASE_SERVICE_ROLE_KEY=... node scripts/repair-parent-person-id.mjs --apply --snapshot

# أو عبر SQL (بعد نشر دوال الإصلاح):
# select public.tree_repair_parent_person_id_apply_v1(true);
# select public.tree_repair_parent_person_id_apply_v1(false);

npm run verify:repair
```

نشر SQL على الإنتاج (عند توفر ربط CLI / كلمة مرور DB):

```bash
supabase db query --linked --agent=no --yes -f supabase/sql/20260807_patch_repair_parent_links.sql
supabase db query --linked --agent=no --yes -f supabase/sql/20260807_integrity_engine_v1.sql
```

---

## 5) تطبيق الإنتاج — الحالة

| خطوة | الحالة |
|------|--------|
| Dry-run مرشّحين | ✅ 25 |
| لقطة قبل الكتابة | ✅ `backups/patch-repair-20260807/` |
| نشر دوال SQL | ⏳ معلّق (CLI Forbidden بدون `SUPABASE_DB_PASSWORD`) |
| تطبيق الـ 25 صفًا | ⏳ معلّق (لا service_role محليًا) |
| `admin_integrity_report_v1` على الإنتاج | ⏳ بعد نشر SQL |
| فحص REQ-001 على `approval_requests` | ⏳ بعد service_role |

**عند توفر الاعتماد:** نفّذ الأوامر أعلاه ثم حدّث هذا التقرير بأرقام `repaired` الفعلية وتحقق `would_repair=0`.

---

## 6) Compatibility Matrix

| المنصة | Affected | Verified | Not affected |
|--------|----------|----------|--------------|
| Web (عرض) | — | — | ✅ قراءة شجرة؛ الروابط تتحسّن بعد apply |
| Admin | ✅ RPC تقرير لاحقًا | ⏳ بعد نشر SQL | — |
| Delegate | — | — | ✅ |
| iOS / Widget | — | — | ✅ لا عمل موبايل في هذه الشريحة |
| Android | — | — | ✅ |

---

## 7) Rollback

1. الإبقاء على `backups/patch-0-20260807/` و`backups/patch-repair-20260807/`.
2. استرجاع `parent_person_id` من JSON للصفوف المعدَّلة فقط (upsert بـ `id`).
3. دوال/views الجديدة آمنة للإبقاء أو:
   - `DROP FUNCTION IF EXISTS public.tree_repair_parent_person_id_apply_v1(boolean);`
   - `DROP FUNCTION IF EXISTS public.tree_repair_parent_candidates_v1();`
   - `DROP FUNCTION IF EXISTS public.admin_integrity_report_v1(text);`
   - `DROP FUNCTION IF EXISTS public.admin_integrity_list_v1(text, text, int);`
   - `DROP VIEW IF EXISTS public.v_integrity_*;`

---

## 8) Versioning (Schema / Data / Migration Version)

انظر [`DATA-VERSIONS.md`](./DATA-VERSIONS.md):

| الحقل | بعد هذه الشريحة (مستهدف بعد apply) |
|--------|-------------------------------------|
| Schema | `baseline+spouses.husband_person_id+integrity_v1` |
| Data | `4` (إصلاح روابط أب غير غامضة) |
| Migration Version | `4` |

**حاليًا في git:** الإصدارات تُسجَّل كـ 4 للسكربتات؛ علامة «طُبّق على الإنتاج» تبقى ⏳ حتى ينجح apply.

---

## 9) جاهزية Health Center / Admin redesign

| جاهز الآن | ليس بعد |
|-----------|---------|
| Views + admin report RPC كأساس Health Center | UI Health Center كامل |
| Dry-run إصلاح 25 صفًا آمنًا | Apply الإنتاج بدون DB credentials |
| توثيق المؤجّل (deferred) + REQ-001 محدوديته | Redesign إدارة/مندوبين (§17) |

**لا حاجز معماري** لبدء Health Center لاحقًا بعد نشر SQL؛ الحاجز التشغيلي الوحيد لإغلاق أرقام KPI (أبناء بلا أب → أقرب للصفر) هو تنفيذ الـ apply + معالجة المؤجّل يدويًا.
