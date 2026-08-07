# Patch 2 — تقرير قبول إضافة ابن = تطبيق متحقَّق

**التاريخ:** 2026-08-07  
**الحالة:** مكتمل على طبقة العميل (Admin Requests) + SQL مساعد جاهز للتطبيق  
**المرجع:** [`ENGINEERING-ROADMAP.md`](./ENGINEERING-ROADMAP.md) بند 2 · [`ADR.md`](./ADR.md) ADR-006 · bug 34 / REQ-001 / REQ-002  
**Depends on:** Patch 1 Canonical Person Identity (`319cc1e` / `3a879de`)

---

## 1) ماذا تغيّر؟

1. **مسار القبول (tree_card / add-son)** في `assets/js/modules/requests.js`:
   - ترتيب الأحداث: **تطبيق + تحقق → ثم** `admin_set_request_status_v2(... approved)` / حالة «قبول».
   - عند فشل التطبيق أو التحقق: **لا** تُضبط الحالة على approved.
   - زر **إعادة تطبيق** لطلبات `tree_card` (إصلاح يتامى الاعتماد بدون تغيير الحالة).
2. **`importTreeCardToTree`** في `assets/js/modules/request-actions.js`:
   - تحميل فهرس الفرع (`pathToRow`).
   - إثراء كل حافة بـ `parent_person_id` (هوية كانونية).
   - غموض اسم الأب → `TREE-001`؛ أب غير قابل للحل (غير جذر فرع) → `TREE-003`.
   - تطبيق **متسلسل** (صف بصف) ثم **تحقق قراءة** من `tree_children`.
   - `inserted+updated` بلا صف متحقق / أو فشل الربط → `REQ-001` أو `REQ-002` — **ممنوع** النجاح الصامت.
3. **رموز** `REQ-001` / `REQ-002` في `canonical-person.js`.
4. **SQL** `supabase/sql/20260807_patch2_verified_request_apply.sql` (+ نسخة `scripts/`):
   - يعيد نشر `tree_resolve_parent_person_id_v1` (مساعد Patch 1).
   - يضيف `tree_verify_child_link_v1` للتحقق التشغيلي.
5. **Smoke:** `npm run verify:patch2`.

---

## 2) Compatibility Matrix

| المنصة | Affected | Verified | Not affected |
|--------|----------|----------|--------------|
| Web (عرض عام) | — | — | ✅ لا مسار قبول طلبات |
| Admin (طلبات / قبول tree_card) | ✅ | ✅ smoke + مراجعة كود ترتيب الأحداث | — |
| Delegate | — | — | ✅ لا يعتمد طلبات الإدارة هنا |
| iOS | — | — | ✅ عرض شجرة فقط؛ يظهر الابن بعد نجاح التطبيق على الخادم |
| Android | — | — | ✅ مستقبلًا |
| Widget | — | — | ✅ |

---

## 3) معايير القبول (Mazen / add-son)

| المعيار | الحالة |
|---------|--------|
| قبول add-son ينشئ صف `tree_children` ويربط عبر `parent_person_id` | ✅ منطق العميل + تحقق قراءة |
| الحالة «قبول» فقط بعد تطبيق متحقَّق | ✅ |
| ممنوع `inserted=0` / نجاح صامت / غموض اسم | ✅ REQ-001 / REQ-002 / TREE-001 |
| مسار إعادة تطبيق لليتيم المعتمد | ✅ زر «إعادة تطبيق» |
| Smoke | ✅ `npm run verify:patch2` |

**سيناريو مازن (مرجع):** إنشاء طلب إضافة ابن → قبول → صف مربوط بالأب الكانوني → ظاهر في الشجرة → ثم الحالة approved.  
السجلات القصيرة التاريخية (`نداء/مازن`, `مازن/محمد` بلا `parent_person_id`) تُعالَج عبر **إعادة تطبيق** بمسار عقدة كامل أو Repair بيانات — لا تُعلَّم approved من جديد بلا تحقق.

---

## 4) SQL — ماذا طُبّق؟

| السكربت | الغرض | تطبيق الإنتاج |
|---------|--------|----------------|
| `20260807_canonical_person_identity.sql` (Patch 1) | `tree_resolve_parent_person_id_v1` | يُطبَّق ضمن سكربت Patch 2 أدناه |
| `20260807_patch2_verified_request_apply.sql` | المساعد + `tree_verify_child_link_v1` | ✅ طُبّق على الإنتاج عبر `supabase db query --linked` (2026-08-07) |

**Dry-run قبل التطبيق:** استعلام الآباء الغامضيين (لا صفوف غامضة بـ exact parent name في هذه الجولة).  
**تحقق بعد التطبيق:** الدالتان موجودتان؛ resolve لمازن الأب OK؛ `tree_verify_child_link_v1` على المسار الكامل OK.

### إصلاح بيانات مازن (يتيم اعتماد)

- الطلب: `REQ-KH2S-17PK` (approved) كان قد أنشأ صفوفًا قصيرة بلا `parent_person_id`.
- الإصلاح: تحديث الصف `1742` إلى المسار الكامل تحت مازن الكانوني + حذف المكرر القصير `1741`.
- تحقق: `tree_verify_child_link_v1` → `ok:true` لـ `.../مازن/محمد`.

---

## 5) Rollback

1. إرجاع كوميتات Patch 2 من git (JS + docs).
2. الإبقاء على `backups/patch-0-20260807/`.
3. دوال SQL الجديدة آمنة للإبقاء؛ أو:
   - `DROP FUNCTION IF EXISTS public.tree_verify_child_link_v1(text,text,text,uuid);`
   - الإبقاء على `tree_resolve_parent_person_id_v1` (مفيد لـ Patch 1).

---

## 6) جاهزية Patch 3 (زوجات)

**جاهز لبدء Patch 3** بعد:

- نشر أصول Admin المحدَّثة
- تطبيق SQL المساعد على Supabase (إن لم يُطبَّق بعد)
- التحقق اليدوي/الخدمي لسيناريو مازن عند توفر service_role

**لا يُبدأ Patch 3 في نفس الجولة تلقائيًا** — بانتظار تأكيد إغلاق Patch 2.
