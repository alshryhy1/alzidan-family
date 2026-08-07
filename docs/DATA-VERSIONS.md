# Data / Schema / Migration Versions

خط الأساس بعد Patch Repair / Integrity foundation (2026-08-07).

| الحقل | القيمة | المعنى |
|--------|--------|--------|
| Schema Version | `baseline+spouses.husband_person_id+integrity_v1` | عمود زوجات + views/تقرير سلامة (`admin_integrity_report_v1`) |
| Data Version | `4` | إصلاح روابط `parent_person_id` غير الغامضة (exact + ى→ي) — dry-run 25؛ apply إنتاج ⏳ |
| Migration Version | `4` | `20260807_patch_repair_parent_links.sql` + `20260807_integrity_engine_v1.sql` — ✅ في المستودع؛ ⏳ نشر/apply على الإنتاج بانتظار DB credentials |

## تاريخ مختصر

| تاريخ | Data | Migration | ملاحظة |
|--------|------|-----------|--------|
| 2026-08-07 | `0` | `0` | Patch 0 baseline |
| 2026-08-07 | `1` | `1` | Patch 1 — هوية كانونية في مسارات الكتابة (Admin/Delegate) |
| 2026-08-07 | `2` | `2` | Patch 2 — قبول طلبات الإضافة = تطبيق متحقَّق (REQ-001/002) |
| 2026-08-07 | `3` | `3` | Patch 3 — زوجات عبر person_id (SPOUSE-001 / TREE-001)؛ SQL طُبّق + backfill 50/50 |
| 2026-08-07 | `4` | `4` | Repair + Integrity foundation — dry-run 25 مرشّحًا؛ apply معلّق على service_role/DB |

يُحدَّث هذا الملف مع كل Patch يغلق بنجاح (ومع Health Center لاحقًا).
