# Patch 1 — Inventory: Relationship Write Paths

**التاريخ:** 2026-08-07  
**المرجع:** ADR-001 / ADR-002 · Canonical Person Identity

تصنيف الربط عند الكتابة:

| التصنيف | المعنى |
|---------|--------|
| **name-based** | مفتاح الربط الأساسي اسم / `limit(1)` / أول تطابق |
| **mixed** | مسار عقدة أو `person_id` متاح لكن يوجد fallback بالاسم الغامض |
| **person_id-based** | الربط عبر `person_id` (UUID) أو `tree_children.id` المحلول من فهرس مسار→صف دون تخمين |

---

## Web / Admin / Delegate

| # | المسار | الملف | العملية | قبل Patch 1 |
|---|--------|-------|---------|-------------|
| 1 | `getTreePersonIdByName` | `assets/js/admin-family-mgmt.js` | حل `tree_children.id` للزوج/الابن | **name-based** (`limit(1)` على `child_name`/`name` ثم ورقة اسم) |
| 2 | `familyApiSaveWife` | نفس الملف | إضافة/تعديل زوجة | **name-based** عبر #1 |
| 3 | `familyApiLoadWivesForPerson` | نفس الملف | قراءة زوجات (تمهيد كتابة) | **name-based** عبر #1 |
| 4 | `familyApiConfirmLinkAllChildrenToOnlyWife` | نفس الملف | ربط جماعي أبناء↔زوجة | **name-based** عبر #1 |
| 5 | `familyApiLinkChildToSpouse` | نفس الملف | ربط ابن بأم | **name-based** عبر #1 |
| 6 | `familyApiSaveChild` | نفس الملف | إضافة ابن/سلسلة | **mixed** — الأب = Node Path؛ بدون `parent_person_id` صريح؛ ربط الأم عبر #5 |
| 7 | `familyApiUpdateChild` | نفس الملف | تعديل ابن | **mixed** — يفضّل `id`/`person_id` من `pathToRow` |
| 8 | `familyApiDeleteChild` / `resolveAdminTreeRowId` | نفس الملف | حذف ابن | **mixed** — فهرس مسار ثم DB؛ **`q.data[0]` عند فشل تطابق الأب** |
| 9 | `familyApiDeleteSubtree` | نفس الملف | حذف شجرة فرعية | **person_id-based** عبر `pathToRow.id` |
| 10 | `getTreePersonIdByName` | `assets/js/delegate.js` | حل صف للزوجات/الربط | **name-based** أسوأ: `eq("name")` + `limit(1)` بلا فرع |
| 11 | `familyApiSaveWife` / روابط الأم | `delegate.js` | زوجات وربط أبناء | **name-based** عبر #10 |
| 12 | `familyApiSaveChild` + `rpcInsertTreeChildRow` | `delegate.js` | إضافة ابن | **mixed** — يحاول `parent_person_id` ثم RPC قد يحل الأب بالاسم الورقي |
| 13 | `familyApiUpdateChild` | `delegate.js` | تعديل | **mixed** — يفضّل `person_id` |
| 14 | `familyApiDeleteChild` | `delegate.js` | حذف | **mixed** — meta من `pathToRow` ثم اسم |
| 15 | نسخة مكررة من API العائلة | `scripts/delegate-family-api-snippet.js` | نفس مسارات المندوب | **name-based** مثل #10 |
| 16 | `importTreeCardToTree` | `assets/js/modules/request-actions.js` | استيراد بطاقة عند الاعتماد | **mixed** — RPC استيراد؛ تطبيق الاعتماد = Patch 2 |
| 17 | `admin_tree_children_import_v1` | `assets/js/admin.js` SQL + bulk | استيراد صفوف | **mixed** — `min(person_id)` فقط عند `HAVING count=1` |
| 18 | `admin_tree_child_upsert_v1` | `admin.js` SQL | upsert إداري | **mixed** |
| 19 | `tree_children_insert_v1` | `admin.js` SQL | إدراج مندوب | **mixed** |
| 20 | `tree_children_update_by_person_id_v1` | `scripts/tree-update-by-person-id.sql` | تحديث بالـ UUID | **person_id-based** |
| 21 | دمج تكرارات يدوي | `duplicate_merge_plan.sql` | دمج صفوف | **person_id-based** (يدوي؛ ليس UI حي) |
| 22 | تدقيق أسماء جماعي | `assets/js/admin-bulk-name-audit.js` | يستدعي import RPC | عبر #17 |
| 23 | جودة الشجرة | `assets/js/admin-quality.js` | قراءة/تشخيص | لا كتابة علاقات مباشرة |
| 24 | **Tree Engine guard** | `assets/js/modules/tree-engine.js` | `prepareChildWriteRow` / رفض `parent=NULL` | **هدف sole writer** — غلاف رقيق اليوم؛ ليس كل المسارات تمر عبره بعد |

---

## دين Tree Engine sole writer (2026-08-09)

الدستور: لا كتابة مباشرة في `tree_children` — Validation → Workflow → **Tree Engine** فقط.  
**الواقع اليوم:** الحارس موجود ومربوط جزئيًا (`request-actions` اعتماد · `delegate` حفظ ابن). المسارات أعلاه (#1–#19 وغيرها) = **دين مواءمة** حتى Family Engine Alignment — لا ندّعي فرضًا كاملًا.

---

## Mobile (`alzidan-family-mobile`)

| المسار | ملاحظة |
|--------|--------|
| قراءة `tree_children` | عرض فقط — **لا مسار كتابة علاقات** |
| `AdditionsScreen` / طلبات | تكتب `approval_requests` فقط (Patch 2) |

Patch 1 لا يلمس محرك عرض الموبايل (بند 36 = مسار B).

---

## مخاطر قبل الإصلاح

1. تشابه الأسماء + `limit(1)` → ربط خاطئ صامت.
2. «تعذر تحديد رقم الشخص» رغم توفر مسار العقدة / `pathToRow`.
3. `resolveAdminTreeRowId` يختار `q.data[0]` عند فشل تطابق الأب.
4. RPC المندوب يرسل `parent_name` كورقة اسم؛ بدون `parent_person_id` خطر غموض.
