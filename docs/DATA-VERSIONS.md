# Data / Schema / Migration Versions

خط الأساس بعد Patch 3 — Spouses via person_id (2026-08-07).

| الحقل | القيمة | المعنى |
|--------|--------|--------|
| Schema Version | `baseline+spouses.husband_person_id` | إضافة اختيارية لعمود `tree_spouses.husband_person_id` دون كسر `husband_id` |
| Data Version | `3` | زوجات/ربط أم عبر هوية كانونية (`person_id` / row id من التحديد) — بلا ربط اسم غامض |
| Migration Version | `3` | سكربت `supabase/sql/20260807_patch3_spouse_person_id.sql` (+ `tree_verify_spouse_husband_v1`) — ✅ طُبّق على الإنتاج 2026-08-07 |

## تاريخ مختصر

| تاريخ | Data | Migration | ملاحظة |
|--------|------|-----------|--------|
| 2026-08-07 | `0` | `0` | Patch 0 baseline |
| 2026-08-07 | `1` | `1` | Patch 1 — هوية كانونية في مسارات الكتابة (Admin/Delegate) |
| 2026-08-07 | `2` | `2` | Patch 2 — قبول طلبات الإضافة = تطبيق متحقَّق (REQ-001/002) |
| 2026-08-07 | `3` | `3` | Patch 3 — زوجات عبر person_id (SPOUSE-001 / TREE-001) |

يُحدَّث هذا الملف مع كل Patch يغلق بنجاح (ومع Health Center لاحقًا).
