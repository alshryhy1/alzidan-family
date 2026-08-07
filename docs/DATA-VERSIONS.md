# Data / Schema / Migration Versions

خط الأساس بعد Patch Repair / Integrity foundation (2026-08-07).

| الحقل | القيمة | المعنى |
|--------|--------|--------|
| Schema Version | `baseline+spouses.husband_person_id+integrity_v1` | عمود زوجات + views/تقرير سلامة (`admin_integrity_report_v1`) |
| Data Version | `5` | استيراد tree_card يعيد استخدام الأب الموجود ولا يكرّره (ابن فقط) |
| Migration Version | `5` | `20260808_tree_import_reuse_existing.sql` — ✅ في المستودع؛ ⏳ COPY-ME على الإنتاج |

## تاريخ مختصر

| تاريخ | Data | Migration | ملاحظة |
|--------|------|-----------|--------|
| 2026-08-07 | `0` | `0` | Patch 0 baseline |
| 2026-08-07 | `1` | `1` | Patch 1 — هوية كانونية في مسارات الكتابة (Admin/Delegate) |
| 2026-08-07 | `2` | `2` | Patch 2 — قبول طلبات الإضافة = تطبيق متحقَّق (REQ-001/002) |
| 2026-08-07 | `3` | `3` | Patch 3 — زوجات عبر person_id (SPOUSE-001 / TREE-001)؛ SQL طُبّق + backfill 50/50 |
| 2026-08-07 | `4` | `4` | Repair + Integrity foundation — dry-run 25 مرشّحًا؛ apply معلّق على service_role/DB |
| 2026-08-08 | `5` | `5` | tree_card import reuse — لا تكرار الأب إن وُجد؛ SQL عبر COPY-ME |

يُحدَّث هذا الملف مع كل Patch يغلق بنجاح (ومع Health Center لاحقًا).
