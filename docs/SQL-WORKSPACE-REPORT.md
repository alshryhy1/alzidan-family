# SQL Workspace — تقرير التسليم

**التاريخ:** 2026-08-09  
**الحالة:** واجهة ✅ · أوامر جاهزة ✅ · طابور/أرشيف ✅ · **منفّذ literal-aware عبر bootstrap من المساحة** ✅  
**المسار:** `pages/admin.html` → بعد الدخول → **⚙ أدوات الصيانة** (`#module=tools`)

## سبب فشل 1/9 (الجذر الحقيقي)

ملف `20260809_sql_workspace_executor_bootstrap.sql` السابق أرسل كأمر أول:

`EXECUTE replace(...)`

على مستوى SQL العادي. في SQL يعني `EXECUTE` تشغيل **prepared statement** باسم `replace` — فيفشل فورًا (`prepared statement "replace" does not exist`) ويظهر كـ SQL-WS-EXEC / «تحقق من الصيغة…».  
كان هناك أيضًا سطر رأس تالف `EXECUTE replace + chr(59)),` يُدمَج في الأمر 1.

المنفّذ القديم يرفض أي حرف `;` خام (حتى داخل `$$`) → SQL-WS-MULTI على أوامر `CREATE FUNCTION`.

## الإصلاح (بدون Supabase)

Preset **ترقية منفّذ SQL Workspace** يشغّل bootstrap من 4 أوامر:

1. `CREATE` لـ stub SQL لـ `admin_sql_sql_without_literals_v1` (بلا `;`)
2. `UPDATE pg_proc` لزرع جسم الـ stripper (بلا `;` خام — الأجسام تُرمَّز بـ `@SC@` ثم `chr(59)`)
3. `UPDATE pg_proc` لزرع جسم `admin_sql_execute_v1` الحرفي
4. `DO` لمنح/سحب الصلاحيات (بعد الترقية — الفشل هنا لا يُلغي الترقية إن نجح الفحص)

عند تشغيل أي أمر صيانة آخر: المساحة **ترقّي المنفّذ تلقائيًا** إن لزم ثم تتابع.

## أوامر الصيانة الجاهزة

| المعرّف | العنوان | ملف |
|---------|---------|-----|
| `maint.sql_workspace_literal_aware_v1` | ترقية منفّذ SQL Workspace | `20260809_sql_workspace_executor_bootstrap.sql` |
| `maint.fix_delegate_portal_path_v1` | إصلاح دخول المندوب بعد القبول | `COPY-ME-fix-delegate-portal-path.sql` |
| `maint.delegate_secret_reset_v1` | طلب إعادة تعيين الرقم السري | `COPY-ME-delegate-secret-reset.sql` |

## إعادة الاختبار (Workspace فقط)

1. Hard Refresh لـ `/pages/admin.html` (Cmd+Shift+R) حتى يُحمَّل JS + ملف bootstrap الجديد
2. دخول الإدارة → **⚙ أدوات الصيانة** (`#module=tools`)
3. إن ظهرت بطاقة فاشلة قديمة: تجاهل أو أعد التشغيل — شغّل **ترقية منفّذ SQL Workspace**
4. بعد النجاح: **إصلاح دخول المندوب…** ثم **إعادة تعيين الرقم السري**
5. الناجح ينتقل إلى **سجل التنفيذ / الأرشيف**

**بوابة 1 ما زالت 🟡** حتى ينجح أمر إصلاح دخول المندوب ويُعاد اختبار مسار المندوب.

لا يُطلب لصق في Supabase SQL Editor كمسار افتراضي. إن فشل `UPDATE pg_proc` بصلاحيات المزوّد فقط عندها يُستثنى اللصق مرة واحدة.
