# Data / Schema / Migration Versions

خط الأساس بعد Patch 1 — Canonical Person Identity (2026-08-07).

| الحقل | القيمة | المعنى |
|--------|--------|--------|
| Schema Version | `baseline` | هيكل الجداول دون قيود schema جديدة إلزامية |
| Data Version | `1` | عقود الكتابة تعتمد Canonical Person Identity (`person_id` / Node Path؛ ممنوع الربط الغامض بالاسم) |
| Migration Version | `1` | سكربت `supabase/sql/20260807_canonical_person_identity.sql` (مساعد `tree_resolve_parent_person_id_v1`) — **يُطبَّق يدويًا بعد dry-run**؛ إصلاحات العميل سارية في الكود فور النشر |

## تاريخ مختصر

| تاريخ | Data | Migration | ملاحظة |
|--------|------|-----------|--------|
| 2026-08-07 | `0` | `0` | Patch 0 baseline |
| 2026-08-07 | `1` | `1` | Patch 1 — هوية كانونية في مسارات الكتابة (Admin/Delegate) |

يُحدَّث هذا الملف مع كل Patch يغلق بنجاح (ومع Health Center لاحقًا).
