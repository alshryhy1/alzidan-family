# المرحلة 2 — Delegates v2

**الحالة:** 🟡 SQL أساس+فرض **مُطبَّق على الإنتاج** — بانتظار اختبار قبول فقط (أقرب لـ 🟢)  
**التاريخ:** 2026-08-08 · **آخر تحديث قبول:** 2026-08-09  
**قائمة القبول التنفيذية (عربي):** [`DELEGATES-V2-ACCEPTANCE.md`](./DELEGATES-V2-ACCEPTANCE.md) ← **نفّذها الآن لإغلاق بوابة 1**  
**المرجع:** [`ENGINEERING-ROADMAP.md`](./ENGINEERING-ROADMAP.md) §0 نموذج الحالات · §22 · برنامج (ب) · [`ADMIN-REDESIGN-PHASE1.md`](./ADMIN-REDESIGN-PHASE1.md) · [`WORKFLOW-ENGINE-V1-REPORT.md`](./WORKFLOW-ENGINE-V1-REPORT.md)

> **ملاحظة إدارة مشروع:** لا تُعلَّم الشريحة 🟢 «منشور ومختبر» قبل نجاح اختبار القبول. وجود SQL في المستودع أو تطبيقه ≠ 🟢 دون §§ القبول.  
> **2026-08-09:** اعتماد UX لمساحة المندوب («ابدا») **لا يغيّر** هذه البوابة — ما زال المطلوب قبولًا فقط · لا برمجة DW.

## الهدف

صلاحيات مندوب مكتملة على مستوى البيانات + فرضها في RPC + رسائل عربية واضحة في بوابة المندوب — **دون** Workflow Engine ودون Delegate Workspace.

| بند خارطة الطريق | الحالة في المستودع |
|------------------|---------------------|
| صلاحيات حسب الدور (Role-based) | ✅ كتالوج + تعيين دور |
| صلاحيات حسب الفرع (Branch-based) | ✅ `branch_key` إلزامي |
| صلاحيات حسب نوع العملية | ✅ `delegate_role_permissions` + فرض في RPC |
| تفعيل / تعطيل | ✅ RPC + مرآة legacy + فرض `is_enabled` |
| سجل تدقيق الصلاحيات | ✅ تفعيل/تعطيل/دور (مع `previous_role_key`) / مزامنة |
| اعتماد متعدد المراحل | ⚪ هيكل فقط — المنطق فوق Workflow Engine لاحقًا |

## SQL المطلوب من المستخدم

شغّل بالترتيب في **Supabase SQL Editor** (مرة واحدة لكل ملف؛ آمن لإعادة التشغيل).

**طريقة النسخ (إلزامية):** افتح الملف في المحرر → **Select All** → **Copy** → الصق في SQL Editor.  
**لا تنسخ من الشات** — أسوار Markdown تكسر اللصق.

| الترتيب | ملف النسخ | المصدر |
|---------|-----------|--------|
| 1 | `supabase/sql/COPY-ME-delegates-v2.sql` | `20260808_delegates_v2_foundation.sql` |
| 2 | `supabase/sql/COPY-ME-delegates-v2-enforce.sql` | `20260808_delegates_v2_enforce_permissions.sql` |

### ماذا يفعل ملف Enforce (الشريحة 2)

- `delegate_v2_check_op_v1` / `delegate_v2_has_op_v1` — فحص: فرع + هوية + سر + `is_enabled` + مفتاح العملية
- إعادة تعريف `tree_delegate_allowed_v1` لفرض `tree.write` عند وجود صف `delegates_v2`
- إعادة تعريف `events_delegate_allowed_v1` لفرض `events.write`
- `tree_delegate_can_read_v1` / `events_delegate_can_read_v1`
- إثراء `check_tree_delegate_access` / `check_events_delegate_access` برموز سبب: `disabled` · `no_permission` · `bad_secret`
- `delegate_session_permissions_v1` — قائمة العمليات للجلسة
- قائمة/اعتماد طلبات المناسبات عبر read/write المناسب
- تدقيق أقوى عند تغيير الدور (`previous_role_key`)
- **Fallback:** إن لم يوجد صف `delegates_v2` تُستخدم `approval_requests` القديمة

بدون الملف 1: واجهة الإدارة تعمل بوضع مؤقت.  
بدون الملف 2: الكتالوج موجود لكن الكتابة لا تُفرض عبر الدور/`is_enabled`.

## واجهة الإدارة

| ملف | الدور |
|-----|--------|
| `assets/js/modules/admin-delegates-v2.js` | قائمة · تفعيل/تعطيل · دور · مزامنة · سجل تدقيق |
| `assets/js/admin-shell.js` | موديول `delegates` |

افتح: `/pages/admin.html#module=delegates`

## بوابة المندوب

| ملف | الدور |
|-----|--------|
| `assets/js/delegate.js` | رفض عمليات الشجرة/المناسبات برسائل عربية حسب `reason` |
| `assets/js/delegate-events-mgmt.js` | نفس رموز الرفض للمناسبات |

أمثلة رسائل:

- معطّل → «حساب المندوب معطّل…»
- بلا صلاحية عملية → «دورك الحالي لا يسمح…»
- سر غير مطابق → «بيانات الدخول لا تطابق…»

## اختبار قبول (بعد SQL)

**المصدر التنفيذي الكامل (خانات ☐ + معايير إغلاق):** [`DELEGATES-V2-ACCEPTANCE.md`](./DELEGATES-V2-ACCEPTANCE.md)

ملخص سريع:

1. طبّق الملف 1 ثم 2 → Hard Refresh للإدارة.
2. إدارة → المندوبون → مزامنة من الطلبات القديمة.
3. عطّل مندوبًا → حاول الدخول/الكتابة من بوابة المندوب → يجب الرفض برسالة التعطيل + صف تدقيق.
4. فعّل مندوبًا بدور `viewer` → محاولة حفظ شجرة/مناسبة → رفض «لا يسمح».
5. غيّر الدور إلى `branch_editor` أو `full_delegate` → الكتابة المسموحة تنجح؛ صف تدقيق يعرض الدور السابق والجديد.
6. مندوب بلا صف v2 (إن وُجد) يبقى على مسار legacy حتى المزامنة.

## التالي (خارج هذه الشريحة)

1. **بعد قبول ✅:** تجميد Product Foundation (بوابة 2) ثم Request Experience — ليس Delegate Workspace.
2. منطق Multi-stage فوق **Workflow Engine** (ليس الآن).
3. واجهة منح/سحب صلاحيات عمليات أدق من قائمة الدور.
4. Event Bus بعد تغيير صلاحيات (ADR-003).
5. **لا** كود Delegate Workspace رغم اعتماد UX («ابدا») — السلّم: RX → VE → WF أولًا.

## Compatibility

| المنصة | الحالة |
|--------|--------|
| Admin Web | Affected |
| Delegate portal | Affected |
| Web العام | Not affected |
| Mobile | Not affected |

## Definition of Done

### شريحة 1 — Foundation
- [x] SQL أساس الأدوار/الفرع/التدقيق + RPCs
- [x] موديول إدارة يتجاوز الـ stub
- [x] تفعيل/تعطيل + عرض الدور/الفرع
- [ ] اختبار دخان/قبول — نفّذ [`DELEGATES-V2-ACCEPTANCE.md`](./DELEGATES-V2-ACCEPTANCE.md) §1–4

### شريحة 2 — Enforce (هذه)
- [x] فرض `is_enabled` + دور + مفاتيح العمليات في RPC
- [x] تدقيق تغيير الدور يشمل السابق
- [x] بوابة المندوب ترفض برسائل عربية واضحة
- [x] COPY-ME نظيف بلا أسوار Markdown
- [x] تطبيق SQL على الإنتاج (مفترض / أكّد في قبول §0)
- [ ] اختبار قبول الأربعة (صلاحيات · أدوار · تفعيل · تدقيق) → بعدها 🟢 — [`DELEGATES-V2-ACCEPTANCE.md`](./DELEGATES-V2-ACCEPTANCE.md) §6
