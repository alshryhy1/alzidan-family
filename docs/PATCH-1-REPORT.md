# Patch 1 — تقرير Canonical Person Identity

**التاريخ:** 2026-08-07  
**الحالة:** مكتمل على طبقة العميل (Admin/Delegate) مع SQL مساعد غير مطبَّق على الإنتاج بعد  
**المرجع:** [`ENGINEERING-ROADMAP.md`](./ENGINEERING-ROADMAP.md) · [`ADR.md`](./ADR.md) ADR-001/002 · [`PATCH-1-WRITE-PATHS.md`](./PATCH-1-WRITE-PATHS.md)

---

## 1) ماذا تغيّر؟

1. **جرد مسارات الكتابة** → `docs/PATCH-1-WRITE-PATHS.md`.
2. **وحدة مشتركة** `assets/js/modules/canonical-person.js`:
   - الطبقات: `person_id` → Node Path → Display Name → Search Name
   - `resolveTreeRowIdForWrite` / `resolveFromPathIndex` / `attachParentPersonId`
   - عند تطابق متعدد: فشل صريح `TREE-001` (عربي) — بلا `limit(1)` أو `data[0]`.
3. **Admin** `admin-family-mgmt.js`: إزالة البحث بالاسم + `limit(1)`؛ حذف اختيار `q.data[0]`؛ تمرير `parent_person_id` عند upsert؛ رسائل زوجة/ربط أم عبر الحالّ الجديد.
4. **Delegate** `delegate.js` (+ snippet): نفس العقد؛ `findStablePersonId` يقرأ `pathToRow` أولًا؛ إدراج الابن يEnrich بـ `parent_person_id`.
5. **`family-person-core.js`**: عند تطابق ورقة اسم متعدد في الفهرس لا يُختار الأول صامتًا.
6. **SQL مساعد** `supabase/sql/20260807_canonical_person_identity.sql` — `tree_resolve_parent_person_id_v1` (TREE-001 عند غموض). لم يُنفَّذ على الإنتاج في هذه الجولة.
7. **Smoke** `npm run verify:identity` → `scripts/test-canonical-person-identity.js`.

---

## 2) Compatibility Matrix

| المنصة | Affected | Verified | Not affected |
|--------|----------|----------|--------------|
| Web (عرض عام) | — | — | ✅ لا مسارات كتابة علاقات |
| Admin (إدارة الشجرة / زوجات) | ✅ | ✅ smoke + مراجعة كود | — |
| Delegate (مندوب الشجرة) | ✅ | ✅ smoke + مراجعة كود | — |
| iOS | — | — | ✅ لا كتابة علاقات شجرة (عرض فقط؛ بند 36 = Patch B) |
| Android | — | — | ✅ مستقبلًا / لا كتابة علاقات |
| Widget | — | — | ✅ |

---

## 3) معايير القبول

| المعيار | الحالة |
|---------|--------|
| لا ربط خاطئ لأسماء متشابهة (علي صالح لاحم vs علي صالح ناصر صالح لاحم) | ✅ مسار كامل / `person_id`؛ ورقة غامضة → TREE-001 |
| لا «تعذر تحديد رقم الشخص» بسبب بحث اسم مع توفر مسار/`pathToRow` | ✅ الحل من الفهرس أولًا |
| لا مسار كتابة يستخدم الاسم كمفتاح أساسي | ✅ مسارات Admin/Delegate الحية؛ الاستيراد/RPC ينتظر `parent_person_id` من العميل |
| Smoke هوية | ✅ `npm run verify:identity` |

**الحكم:** **Pass** لطبقة العميل. **Partial** لطبقة DB حتى تطبيق SQL المساعد وربط RPC الحية به (اختياري طالما العميل يرسل `parent_person_id`).

---

## 4) مخاطر متبقية

| الخطر | التخفيف |
|--------|---------|
| SQL المساعد غير مطبَّق على Supabase | العميل يرسل `parent_person_id`؛ تطبيق السكربت بعد dry-run |
| اعتماد طلبات (add-son) ما زال Patch 2 | لم يُمس منطق القبول عمدًا |
| استيراد بطاقة شجرة / bulk import يعتمد RPC | يُفضّل تمرير `person_id`؛ الغموض على السيرفر يبقى حتى ربط المساعد |
| بيانات قديمة بلا `parent_person_id` | Integrity / Repair لاحقًا — لا migration بيانات جماعية في Patch 1 |
| كاش الموبايل لعرض مكرر (36) | خارج النطاق — مسار B |

---

## 5) Rollback

1. إرجاع كوميتات Patch 1 من git.
2. عدم حذف `backups/patch-0-*`.
3. إن طُبّق SQL المساعد: الإبقاء عليه آمن (دالة جديدة فقط) أو `DROP FUNCTION tree_resolve_parent_person_id_v1` إن لزم.

---

## 6) جاهزية Patch 2

**جاهز لبدء Patch 2 (طلبات الإضافة = قبول متحقَّق)** بشرط:

- نشر أصول JS المحدَّثة (Admin/Delegate + `canonical-person.js`)
- الإبقاء على فحص `approval_requests` بمفتاح خدمة عند توفره (تحفّظ Patch 0)

**لا Blocker** على هوية الكتابة للانتقال إلى Patch 2.
