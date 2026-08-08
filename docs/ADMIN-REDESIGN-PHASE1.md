# المرحلة 1 — Admin Redesign + Modules

**الحالة:** أساس الشِلّ مكتمل — بقية البنود تكرارية (لا حاجز أمام Phase 2)  
**التاريخ:** 2026-08-07 · تحديث حالة: 2026-08-08  
**المرجع:** [`ENGINEERING-ROADMAP.md`](./ENGINEERING-ROADMAP.md) §17 · [`ADR.md`](./ADR.md)

## الهدف

استبدال صفحة الإدارة الطويلة المزدحمة بـ**لوحة مراكز (موديولات)** مستقلة، مع الإبقاء على القدرات الحالية ومسارات الاعتماد/`invokeAdminRpc` دون إعادة كتابة كاملة.

## المعمارية

```
pages/admin.html
  ├── تسجيل الدخول (كما هو)
  ├── #admin-shell-sidebar     ← قائمة الموديولات (RTL)
  ├── #admin-module-hub        ← بطاقات الدخول السريع + شريط Workflow
  └── أقسام DOM الحالية
        data-admin-module="…"  ← يُعرض موديول واحد في كل مرة
```

| ملف | الدور |
|-----|--------|
| `assets/js/admin-shell.js` | سجل الموديولات + توجيه hash `#module=` + إظهار/إخفاء |
| `assets/css/admin-shell.css` | هيكل الشريط الجانبي والـ Hub |
| `assets/js/admin.js` / `admin-auth.js` | دون كسر: التوكن و`invokeAdminRpc` والصلاحيات |

**مبدأ الهجرة التدريجية:** الأقسام تبقى في DOM؛ الشِلّ يُخفي غير النشط بـ`.admin-module-off`. لا نقل منطق RPC في هذه الدفعة.

### Workflow التشغيلي (معروض في الـ Hub)

1. مراجعة → 2. اعتماد → 3. تطبيق متحقَّق → 4. سجل / صحة البيانات  

(سياسة «لا قبول بلا تطبيق» تبقى في مسارات الطلبات الحالية.)

## قائمة الموديولات

| id | العنوان | مصدر الأقسام | الحالة |
|----|---------|--------------|--------|
| `hub` | لوحة التحكم | `#admin-module-hub` | ✅ جديد |
| `requests` | الطلبات | `admin-requests-section` · `requests-stats-section` | ✅ مُرحَّل للعرض |
| `tree` | الشجرة | `admin-family-management-section` · `bulk-name-audit-section` | ✅ مُرحَّل للعرض |
| `members` | الأعضاء | `admin-quality-center` · `admin-review-shortcut` | ✅ مُرحَّل للعرض |
| `events` | المناسبات | `events-source-manager` · `banner-messages-manager` | ✅ مُرحَّل للعرض |
| `memories` | الذكريات | `admin-memory-section` | ✅ مُرحَّل للعرض |
| `delegates` | المندوبون | `admin-module-delegates` | ✅ Phase 2 بدأ — انظر [`DELEGATES-V2-PHASE2.md`](./DELEGATES-V2-PHASE2.md) |
| `health` | مركز الصحة | `health-center-section` | ✅ مُرحَّل (Integrity قراءة فقط) |
| `audit` | مركز السجل | `delegate-audit` | ✅ مُرحَّل للعرض |
| `special-cards` | البطاقات الخاصة | `special-cards-manager` | ✅ مُرحَّل (حفظ/قائمة RPC) |
| `polls` | التصويت | `polls-manager` | ✅ مُرحَّل للعرض |
| `stats` | الإحصاءات | `views-stats-section` · `marriage-stats-section` | ✅ مُرحَّل للعرض |
| `tools` | أدوات الصيانة | `sql-workspace-section` + أدوات الاستيراد/واتساب/مراجعة | ✅ SQL Workspace ظاهر داخل الموديول |

## كيف تُفتح اللوحة الجديدة

1. افتح `/pages/admin.html` (أو `/admin.html` يعيد التوجيه).
2. سجّل دخول الإدارة كالمعتاد.
3. بعد الدخول تظهر **لوحة التحكم** + الشريط الجانبي للمراكز.
4. روابط مباشرة: `#module=health` · `#module=requests` · `#module=tree` · `#module=special-cards` …

Cache-bust الحالي للأصول: `?v=20260808sw2`.

## ما لم يُنفَّذ بعد (بقية Phase 1)

- فصل ملفات JS ثقيلة لكل موديول (تحميل كسول)
- توحيد كل عمليات الاعتماد تحت معالج Workflow واحد في الواجهة
- تنظيف أقسام الصيانة القديمة من DOM العام
- تحسينات Admin UX (بحث/فلاتر/bulk) → **المرحلة 3**
- Delegates v2 → **المرحلة 2 جارية** — [`DELEGATES-V2-PHASE2.md`](./DELEGATES-V2-PHASE2.md)
- UX الموبايل → **المرحلة 4** (ممنوع الآن)

## Compatibility

| المنصة | الحالة |
|--------|--------|
| Admin Web | Affected + Verified محليًا (شِلّ + tags) |
| Web العام | Not affected |
| Mobile | Not affected |
| Widget | Not affected |

## Definition of Done (جزئي لهذه الدفعة)

- [x] شِلّ + Hub + توجيه موديول واحد
- [x] ربط الأقسام الحالية دون كسر المعرّفات
- [x] Stub المندوبون
- [x] وثيقة المرحلة + تحديث الخارطة
- [ ] اختبار دخان يدوي بعد النشر (دخول → Hub → طلبات/شجرة/صحة/بطاقات)

## تحديث 2026-08-08

**قرار:** لا فجوة حرجة في التنقل (الشِلّ يعمل). Phase 1 = **shell done, continue iteratively**.  
التركيز التنفيذي انتقل إلى **Phase 2 — Delegates v2**.
