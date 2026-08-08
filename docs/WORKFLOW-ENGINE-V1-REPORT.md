# Workflow Engine v1 — تقرير التسليم (Foundation)

**التاريخ:** 2026-08-08  
**الحالة:** 🟡 كود + SQL في المستودع — بانتظار تطبيق `COPY-ME-workflow-engine-v1.sql` + دخان إداري  
**المواصفة:** [`WORKFLOW-SPECIFICATION-v1.md`](./WORKFLOW-SPECIFICATION-v1.md) · [`PLATFORM-PRINCIPLES.md`](./PLATFORM-PRINCIPLES.md) · ADR-010  
**الخارطة:** [`ENGINEERING-ROADMAP.md`](./ENGINEERING-ROADMAP.md)

## قرار التصميم (مهم)

**تكييف `approval_requests` وليس نظام طلبات موازٍ.**

| الخيار | القرار |
|--------|--------|
| جدول طلبات جديد | ❌ مرفوض — يكرّر SSOT ويكسر الواجهات الحالية |
| أعمدة `wf_*` على `approval_requests` | ✅ معتمد |
| `status` القديمي (`pending` / `approved` / `rejected`) | يبقى للتوافق؛ يُحدَّث تلقائيًا من `wf_state` |
| `wf_state` | مصدر الحقيقة لآلة الحالات (Workflow SSOT) |

خريطة الجسر: `submitted|assigned|in_review|needs_changes` → `pending` · `approved|applied|done` → `approved` · `rejected` → `rejected`.

## ماذا شُحن؟

1. **مخطط:** أعمدة `wf_state` · `wf_owner_delegate_id` · `wf_deep_link` · `wf_updated_at` · `request_type`
2. **جداول:** `workflow_transition_log` · `workflow_notification_events` (قناة `log` فقط في v1)
3. **RPCs إدارية (admin token):**
   - `admin_workflow_get_v1`
   - `admin_workflow_transition_v1`
   - `admin_workflow_assign_v1` (تعيين بالفرع عبر `delegates_v2`)
   - `admin_workflow_backfill_v1`
   - `admin_workflow_next_states_v1`
4. **Stub مندوب:** `delegate_workflow_transition_v1` → `WF-DELEGATE-NOT-READY`
5. **Deep link:** `module=requests&request=<request_id>`
6. **لوحة حالة صغيرة** في موديول الطلبات (ليست Delegate Workspace)
7. **Audit:** كل انتقال ناجح/مرفوض عبر `admin_audit_write_v1` + سجل الانتقالات

## الملفات

| ملف | دور |
|-----|-----|
| `supabase/sql/20260808_workflow_engine_v1.sql` | المصدر |
| `supabase/sql/COPY-ME-workflow-engine-v1.sql` | للصق في Supabase SQL Editor |
| `assets/js/modules/admin-workflow-panel.js` | لوحة الحالة الإدارية |
| `assets/css/admin-workflow-panel.css` | تنسيق اللوحة |
| `assets/js/admin-shell.js` | دعم `#module=…&request=…` |
| `assets/js/modules/requests.js` | عرض `wf_state` إن وُجد |
| `pages/admin.html` | ربط الأصول |
| `docs/WORKFLOW-ENGINE-V1-REPORT.md` | هذا التقرير |

## SQL المطلوب من المستخدم

**الملف:** `supabase/sql/COPY-ME-workflow-engine-v1.sql`

1. افتح الملف في المحرر  
2. Select All → Copy  
3. الصق في Supabase SQL Editor → Run  

لا تنسخ من الشات.

## كيف تختبر؟

1. طبّق COPY-ME → Hard Refresh لـ `/pages/admin.html`
2. إدارة → **الطلبات** (`#module=requests`)
3. لوحة **محرك السير v1** → «تهيئة الحالات» (مرة) ثم أدخل رقم طلب → «عرض الحالة»
4. نفّذ انتقالًا مسموحًا (مثل تعيين إن وُجد مندوب مفعّل للفرع)
5. تحقق من ظهور صف في سجل الانتقالات؛ الرفض بلا سبب لـ `needs_changes`/`rejected` يعيد `WF-004`
6. رابط عميق: `#module=requests&request=<request_id>`

بدون SQL: اللوحة تظهر ورسالة عربية أن المحرك غير مفعّل بعد.

## خارج هذه الشريحة (عمدًا)

- Request Experience UI  
- Delegate Workspace  
- Push notifications (أحداث log فقط)  
- استبدال أزرار قبول/رفض القديمة بالكامل (تبقى للتوافق حتى Family Engine Alignment)

## التالي

بعد دخان المحرك: **Request Experience** (مرحلة كانونية 2) — نية المستخدم تستدعي المحرك فقط.

## Compatibility

| المنصة | الحالة |
|--------|--------|
| Admin Web — Requests | Affected |
| Delegate portal | Stub فقط — Not production path |
| Web العام / Mobile | Not affected |
