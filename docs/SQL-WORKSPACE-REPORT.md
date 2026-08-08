# SQL Workspace — تقرير التسليم

**التاريخ:** 2026-08-08  
**الحالة:** واجهة ✅ في موديول أدوات الصيانة · RPC تنفيذ 🟡 بانتظار تطبيق SQL يدويًا  
**المسار:** `pages/admin.html` → بعد الدخول → **⚙ أدوات الصيانة** (`#module=tools`)

## ماذا أُضيف؟

مساحة عمل SQL داخل موديول الصيانة الحالي (ليست صفحة جديدة):

1. **وحدة SQL** (أولاً): محرر كبير + تشغيل · نسخ · تنظيف · تحميل SQL + نتائج جدول + سجل «آخر أوامر SQL»
2. مولّد أوامر الدفعة (Batch)
3. استيراد CSV
4. أدوات واتساب
5. مراجعة الشجرة

## الملفات

| ملف | دور |
|-----|-----|
| `pages/admin.html` | قسم `#sql-workspace-section` أول أدوات الصيانة؛ إزالة `display:none` عن أقسام الصيانة؛ cache-bust `?v=20260808sw2` |
| `assets/js/modules/admin-sql-workspace.js` | منطق التشغيل / التأكيد / السجل / النتائج |
| `assets/css/admin-sql-workspace.css` | تنسيق الوحدة |
| `assets/js/admin-shell.js` | تسجيل الأقسام تحت `tools` + وصف الموديول |
| `assets/js/admin-ui.js` | عدم طيّ مساحة SQL تلقائيًا |
| `supabase/sql/20260808_admin_sql_workspace_v1.sql` | RPC `admin_sql_execute_v1` + تدقيق |
| `supabase/sql/COPY-ME-admin-sql-workspace.sql` | نسخة للصق في Supabase SQL Editor |
| `docs/SQL-WORKSPACE-REPORT.md` | هذا التقرير |

## مكونات الواجهة

- محرر SQL كبير (`#sql-ws-editor`)
- أزرار: تشغيل · نسخ · تنظيف · تحميل SQL · عرض SQL (بعد نجاح التنفيذ)
- حالة `✅ تم التنفيذ` + المدة + عدد الصفوف
- إخفاء نص SQL بعد النجاح مع زر «عرض SQL»
- جدول نتائج + سجل جلسة محلي
- تأكيد قبل أوامر التغيير: UPDATE DELETE DROP ALTER TRUNCATE CREATE …
- SELECT بدون تأكيد

## RPC / SQL

- **مطلوب تطبيق يدوي:** نعم
- الملف: `supabase/sql/COPY-ME-admin-sql-workspace.sql`
- الوظيفة: `admin_sql_execute_v1(p_token, p_sql, p_confirm_mutate)`
- الحماية: `admin_token_ok_v1` · أمر واحد · تأكيد للـ mutating · كتابة `admin_audit_log` (`action_key = sql.execute`)
- **لا يُنفَّذ أي SQL على القاعدة أثناء التطوير/النشر** — التنفيذ فقط من واجهة الوحدة بعد تطبيق الـ RPC

### كيف تطبّق RPC؟

1. افتح الملف `supabase/sql/COPY-ME-admin-sql-workspace.sql` في المحرر
2. Select All → Copy
3. الصق في Supabase SQL Editor → Run  
لا تنسخ من الشات.

## Migration؟

لا migration منفصلة عبر CLI مطلوبة. تطبيق ملف COPY-ME مرة واحدة على المشروع كافٍ (safe to re-run).

## أين تظهر بعد النشر؟

1. Hard Refresh لـ `/pages/admin.html` (أو `/admin.html`)
2. سجّل دخول الإدارة
3. من الـ Hub أو الشريط: **⚙ أدوات الصيانة** → `#module=tools`
4. البطاقة الأولى: **مساحة عمل SQL**

بدون تطبيق COPY-ME: الواجهة تظهر، والتنفيذ يعرض رسالة عربية أن الوظيفة غير مفعّلة بعد.
