# المرحلة 2 — Delegates v2 (أساس)

**الحالة:** جارية (شريحة 1 — Foundation)  
**التاريخ:** 2026-08-08  
**المرجع:** [`ENGINEERING-ROADMAP.md`](./ENGINEERING-ROADMAP.md) §17 · [`ADMIN-REDESIGN-PHASE1.md`](./ADMIN-REDESIGN-PHASE1.md)

## الهدف من هذه الشريحة

بناء أساس Delegates v2 دون غليان المحيط:

| بند خارطة الطريق | في هذه الشريحة |
|------------------|----------------|
| صلاحيات حسب الدور (Role-based) | ✅ كتالوج أدوار + صلاحيات عمليات + تعيين دور في الواجهة |
| صلاحيات حسب الفرع (Branch-based) | ✅ حقل `branch_key` إلزامي على `delegates_v2` |
| صلاحيات حسب نوع العملية | ✅ جدول `delegate_role_permissions` (`tree.write` / `events.write` / …) |
| اعتماد متعدد المراحل | 🟡 هيكل جدول `delegate_approval_stages` فقط (منطق لاحق) |
| سجل تدقيق كامل | ✅ `admin_audit_log` + كتابة عند تفعيل/تعطيل/دور/مزامنة |
| تفعيل / تعطيل المندوبين | ✅ RPC + واجهة (+ مرآة لـ `approval_requests` القديمة) |

## SQL المطلوب من المستخدم

شغّل مرة واحدة في **Supabase SQL Editor**.

**طريقة النسخ (إلزامية):** افتح الملف في المحرر → **Select All** → **Copy** → الصق في SQL Editor.  
**لا تنسخ من الشات** — أسوار Markdown (```) تكسر اللصق.

ملفات نظيفة (بدون أسوار):

- `supabase/sql/COPY-ME-delegates-v2.sql` — جاهز للنسخ (تعليق إنجليزي سطر واحد أعلى الملف فقط)
- `supabase/sql/20260808_delegates_v2_foundation.sql` — المصدر الرسمي

ينشئ:

- `delegate_roles` · `delegate_role_permissions`
- `delegates_v2` (هوية مندوب + دور + فرع + `is_enabled`)
- `delegate_approval_stages` (هيكل)
- `admin_audit_log`
- RPCs:
  - `admin_delegates_v2_list_v1`
  - `admin_delegates_v2_sync_from_requests_v1`
  - `admin_delegates_v2_set_enabled_v1`
  - `admin_delegates_v2_set_role_v1`
  - `admin_delegate_roles_list_v1`
  - `admin_audit_log_list_v1`

بدون هذا الملف: الواجهة تعمل بـ**وضع مؤقت** من `admin_list_requests` (tree/events_delegate) وتعرض تلميح SQL.

## واجهة الإدارة

| ملف | الدور |
|-----|--------|
| `assets/js/modules/admin-delegates-v2.js` | قائمة · تفعيل/تعطيل · دور · مزامنة · سجل تدقيق |
| `assets/js/admin-shell.js` | موديول `delegates` لم يعد stub |
| `assets/css/admin-shell.css` | أنماط الجدول والحالة |

افتح: `/pages/admin.html#module=delegates`

### اختبار دخان

1. دخول الإدارة.
2. من الشريط الجانبي أو الـ Hub → **المندوبون**.
3. إن ظهر تلميح SQL → طبّق الملف ثم **مزامنة من الطلبات القديمة**.
4. تحقق من ظهور الفرع + الدور + مفعّل/معطّل.
5. عطّل مندوبًا ثم فعّله — يجب ظهور صف في سجل التدقيق أسفل الصفحة.
6. مركز السجل (`#module=audit`) يبقى لمسار تعديلات الشجرة/المناسبات القديمة.

## علاقة المرحلة 1

Phase 1 = شِلّ + Hub + توجيه موديولات ✅ (أساس مكتمل).  
ما تبقى من Phase 1 (تحميل كسول، تعميق Workflow) = تحسينات تكرارية — **ليست حاجزًا** أمام Phase 2.

## التالي (شرائح لاحقة في Phase 2)

1. فرض الصلاحيات فعليًا داخل `tree_delegate_allowed_v1` / `events_*` عبر الدور + العملية + `is_enabled`.
2. منطق Multi-stage approval على الطلبات (stage1 مندوب → stage2 إدارة).
3. واجهة منح/سحب صلاحيات عمليات أدق من القائمة المنسدلة للدور.
4. ربط Event Bus بعد تغيير صلاحيات المندوب (ADR-003).

## Compatibility

| المنصة | الحالة |
|--------|--------|
| Admin Web | Affected |
| Web العام | Not affected |
| Mobile | Not affected |
| Widget | Not affected |

## Definition of Done (شريحة 1)

- [x] SQL أساس الأدوار/الفرع/التدقيق + RPCs
- [x] موديول إدارة يتجاوز الـ stub
- [x] تفعيل/تعطيل + عرض الدور/الفرع
- [x] وثيقة المرحلة + تحديث الخارطة
- [ ] اختبار دخان بعد تطبيق SQL على الإنتاج
