# Patch 3 — تقرير الزوجات عبر person_id

**التاريخ:** 2026-08-07  
**الحالة:** مكتمل على طبقة العميل (Admin/Delegate) + SQL مساعد  
**المرجع:** [`ENGINEERING-ROADMAP.md`](./ENGINEERING-ROADMAP.md) بند 3 · [`ADR.md`](./ADR.md) ADR-001/002 · P0 wife bug / SPOUSE-001 / TREE-001  
**Depends on:** Patch 1 Canonical Person Identity · Patch 2 Verified Request Apply

---

## 1) ماذا تغيّر؟

1. **`resolveHusbandForSpouseWrite`** في `canonical-person.js`:
   - يفضّل `rowId` من التحديد ثم `person_id` من فهرس `pathToRow` قبل أي بحث اسم.
   - غموض اسم → `TREE-001` صريح؛ فشل الحل → `SPOUSE-001` عربي واضح.
2. **Admin** `admin-family-mgmt.js` و**Delegate** `delegate.js` (+ snippet):
   - مسارات حفظ/تحميل الزوجة والربط الجماعي وربط الأم تستخدم الحالّ الجديد.
   - كتابة `husband_person_id` مع `husband_id` (مع fallback إن لم يُطبَّق عمود القاعدة بعد).
3. **`modules/spouses.js`**: تحميل `person_id` مع خيارات الزوج وكتابته عند الحفظ.
4. **SQL** `supabase/sql/20260807_patch3_spouse_person_id.sql`:
   - عمود `tree_spouses.husband_person_id` + backfill من `tree_children.person_id`.
   - `tree_verify_spouse_husband_v1` للتحقق التشغيلي.
5. **Smoke:** `npm run verify:patch3`.

---

## 2) Compatibility Matrix

| المنصة | Affected | Verified | Not affected |
|--------|----------|----------|--------------|
| Web (عرض عام) | — | — | ✅ لا كتابة زوجات |
| Admin (إدارة عائلة / زوجات) | ✅ | ✅ smoke + مراجعة كود | — |
| Delegate (مندوب) | ✅ | ✅ smoke + مراجعة كود | — |
| iOS | — | — | ✅ عرض فقط |
| Android | — | — | ✅ مستقبلًا |
| Widget | — | — | ✅ |

---

## 3) معايير القبول

| المعيار | الحالة |
|---------|--------|
| إضافة زوجة مع زوج محدد بـ `person_id` / صف محدد تنجح دون بحث اسم | ✅ |
| اسم زوج غامض → خطأ صريح TREE-001 بلا ربط خاطئ | ✅ |
| لا «تعذر تحديد رقم الشخص» عندما يتوفر id من التحديد | ✅ حل من `rowId`/`person_id` أولًا |
| أساس تعدد الزوجات: `marriage_order` محفوظ + `husband_person_id` | ✅ دون كسر `husband_id` الحالي |
| Smoke | ✅ `npm run verify:patch3` |

---

## 4) SQL

| السكربت | الغرض | تطبيق الإنتاج |
|---------|--------|----------------|
| `20260807_patch3_spouse_person_id.sql` | عمود + backfill + verify helper | ✅ طُبّق على الإنتاج 2026-08-07 (dry-run: 0 أيتام زوج؛ backfill 50/50) |

---

## 5) Rollback

1. إرجاع كوميتات Patch 3 من git (JS + docs).
2. الإبقاء على `backups/patch-0-*`.
3. SQL: الإبقاء على العمود آمن (nullable) أو:
   - `DROP FUNCTION IF EXISTS public.tree_verify_spouse_husband_v1(bigint, uuid);`
   - العمود `husband_person_id` يمكن إبقاؤه دون ضرر.

---

## 6) جاهزية التالي

**Patch 3 مُغلق على العميل.**  
البند التالي الموازي المُدرَج رسميًا: **Admin — بطاقات خاصة RPC** (`docs/BUG-SPECIAL-CARDS-RPC.md`) — لا يبدأ تلقائيًا كبديل للزوجات؛ يُعالَج بعد الإغلاق أو بموافقة صريحة.

مسار B (موبايل 36) ومسار C (أخبار) يبقيان بانتظار إشارة المستخدم أو جدولة متوازية بعد استقرار الكتابة.
