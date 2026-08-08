# SQL Workspace — تقرير التسليم

**التاريخ:** 2026-08-09  
**الحالة:** واجهة ✅ · أوامر جاهزة ✅ · طابور/أرشيف ✅ · **منفّذ literal-aware عبر bootstrap من المساحة** ✅  
**المسار:** `pages/admin.html` → بعد الدخول → **⚙ أدوات الصيانة** (`#module=tools`)

## سبب SQL-WS-MULTI (الجذر)

المنفّذ القديم على قاعدة البيانات يفحص وجود `;` في نص الأمر **خامًا**، فيرفض أي `CREATE FUNCTION` فيه فواصل منقوطة داخل `$$…$$`.  
ملفات COPY-ME سليمة — الخطأ في المنفّذ لا في محتوى الأوامر.

## الإصلاح (بدون Supabase)

Preset **ترقية منفّذ SQL Workspace** يشغّل `20260809_sql_workspace_executor_bootstrap.sql`:  
أوامر بلا `;` خام (عبر `EXECUTE replace(..., chr(59))`) تُثبّت المنفّذ الحرفي ثم تعمل بقية الأوامر.

عند تشغيل أي أمر صيانة آخر: المساحة **ترقّي المنفّذ تلقائيًا** إن لزم ثم تتابع.

## أوامر الصيانة الجاهزة

| المعرّف | العنوان | ملف |
|---------|---------|-----|
| `maint.sql_workspace_literal_aware_v1` | ترقية منفّذ SQL Workspace | `20260809_sql_workspace_executor_bootstrap.sql` |
| `maint.fix_delegate_portal_path_v1` | إصلاح دخول المندوب بعد القبول | `COPY-ME-fix-delegate-portal-path.sql` |
| `maint.delegate_secret_reset_v1` | طلب إعادة تعيين الرقم السري | `COPY-ME-delegate-secret-reset.sql` |

## إعادة الاختبار (Workspace فقط)

1. Hard Refresh لـ `/pages/admin.html`
2. دخول الإدارة → **⚙ أدوات الصيانة** (`#module=tools`)
3. شغّل **ترقية منفّذ SQL Workspace** (أو أي أمر آخر — الترقية تلقائية)
4. ثم **إصلاح دخول المندوب…** ثم **إعادة تعيين الرقم السري** حسب الحاجة
5. الناجح ينتقل إلى **سجل التنفيذ / الأرشيف**

لا يُطلب لصق في Supabase SQL Editor كمسار افتراضي.
