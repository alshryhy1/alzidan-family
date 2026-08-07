# Patch Integrity — تقرير قراءة فقط (2026-08-07)

**الحالة:** مسح حي ✅ (قراءة فقط) · Health Center أدنى في الإدارة ✅  
**السياسة:** بلا UPDATE/DELETE تلقائي · التنظيف اليدوي مكتمل خارج النطاق  
**المرجع:** [`ENGINEERING-ROADMAP.md`](./ENGINEERING-ROADMAP.md) · [`PATCH-DATA-CLEANUP-DONE.md`](./PATCH-DATA-CLEANUP-DONE.md) · [`PATCH-INTEGRITY-DEPLOY-SQL.md`](./PATCH-INTEGRITY-DEPLOY-SQL.md)

---

## بوابة التنظيف المكتمل

| فحص | النتيجة |
|------|---------|
| `577–583` / `321` / `1730` ما زالت موجودة؟ | لا ✅ |
| `1417–1423` و`491`/`492` موجودة؟ | نعم ✅ |

خام: `docs/integrity-scan-latest.json` → `cleanup_gate.ok = true`

---

## ملخص المسح (anon REST — قراءة فقط)

| المؤشر | العدد |
|--------|------:|
| صفوف `tree_children` | 851 |
| `parent_person_id` مفقود | 37 |
| `parent_person_id` مكسور | 9 |
| مجموع روابط أب غير صالحة | 46 |
| عناقيد اسم ورقة غامض | 170 |
| زوجات بلا زوج صالح | 0 |
| مسارات قصيرة للمراجعة (ليست أهداف حذف) | 22 |

الأمر:

```bash
npm run integrity:scan
```

---

## ماذا يعني هذا؟

- توجد حالات **مشابهة في الطبقة** (أبناء بلا أب UUID صالح، عناقيد أسماء غامضة، مسارات قصيرة) — للتقرير والمراجعة فقط.
- **لا** إصلاح تلقائي في هذه المرحلة.
- أي إصلاح لاحق: Dry-run → موافقة صريحة → ثم كتابة.

---

## Health Center

قسم **مركز صحة البيانات** في `pages/admin.html`:

- يستدعي `admin_integrity_report_v1` إن وُجد.
- وإلا: مسح محلي قراءة فقط من `tree_children` / `tree_spouses`.
- لا أزرار حذف أو apply.

لنشر RPC التقرير فقط (اختياري): Step B في [`PATCH-INTEGRITY-DEPLOY-SQL.md`](./PATCH-INTEGRITY-DEPLOY-SQL.md).

---

## التالي على الخارطة

1. (اختياري) نشر `20260807_integrity_engine_v1.sql` في SQL Editor — قراءة فقط.  
2. مراجعة عيّنات التقرير يدويًا عند الرغبة في إصلاحات لاحقة.  
3. Features: بحث · صفحة العضو · إشعارات… (حسب ترتيب الخارطة بعد Integrity/Health Center).
