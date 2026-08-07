# Data / Schema / Migration Versions

خط الأساس بعد Patch 2 — Verified Request Apply (2026-08-07).

| الحقل | القيمة | المعنى |
|--------|--------|--------|
| Schema Version | `baseline` | هيكل الجداول دون قيود schema جديدة إلزامية |
| Data Version | `2` | قبول tree_card/add-son = تطبيق متحقَّق مربوط بـ `parent_person_id` قبل «قبول» |
| Migration Version | `2` | سكربت `supabase/sql/20260807_patch2_verified_request_apply.sql` (يشمل مساعد Patch 1 + `tree_verify_child_link_v1`) — ✅ طُبّق على الإنتاج 2026-08-07 عبر Supabase CLI linked؛ منطق العميل ساري فور النشر |

## تاريخ مختصر

| تاريخ | Data | Migration | ملاحظة |
|--------|------|-----------|--------|
| 2026-08-07 | `0` | `0` | Patch 0 baseline |
| 2026-08-07 | `1` | `1` | Patch 1 — هوية كانونية في مسارات الكتابة (Admin/Delegate) |
| 2026-08-07 | `2` | `2` | Patch 2 — قبول طلبات الإضافة = تطبيق متحقَّق (REQ-001/002) |

يُحدَّث هذا الملف مع كل Patch يغلق بنجاح (ومع Health Center لاحقًا).
