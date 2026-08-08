# SQL Workspace — تقرير التسليم

**التاريخ:** 2026-08-09  
**الحالة:** واجهة ✅ · أوامر صيانة جاهزة ✅ · RPC تنفيذ 🟡 حتى يُشغَّل أمر الترقية/التفعيل من الإدارة  
**المسار:** `pages/admin.html` → بعد الدخول → **⚙ أدوات الصيانة** (`#module=tools`)

## قاعدة تشغيل (Standing rule)

**أي SQL صيانة/إصلاح جديد يُسلَّم كأمر جاهز داخل SQL Workspace** (تشغيل من الإدارة + تعليمه **مُنفذ**).  
ملفات `supabase/sql/*.sql` تبقى مصدر الحقيقة في المستودع.  
**لا** يُطلب من المشغّل لصق COPY-ME في Supabase إلا لسبب تقني موثّق — حاليًا: ترقية المنفّذ القديم الذي يرفض أجسام الدوال (`SQL-WS-MULTI`) مرة واحدة عبر preset `maint.sql_workspace_literal_aware_v1` أو ملفه إن فشل من الواجهة.

## أوامر الصيانة الجاهزة (Presets)

| المعرّف | العنوان | ملف المصدر |
|---------|---------|------------|
| `maint.sql_workspace_literal_aware_v1` | ترقية منفّذ SQL Workspace | `20260809_sql_workspace_literal_aware.sql` |
| `maint.fix_delegate_portal_path_v1` | إصلاح دخول المندوب بعد القبول (بوابة 1) | `COPY-ME-fix-delegate-portal-path.sql` |
| `maint.delegate_secret_reset_v1` | طلب إعادة تعيين الرقم السري | `COPY-ME-delegate-secret-reset.sql` |

التشغيل: **تشغيل** (متسلسل) → عند النجاح يُعلَّم **مُنفذ** تلقائيًا (أو يدويًا).

## الملفات

| ملف | دور |
|-----|-----|
| `pages/admin.html` | قسم المساحة + قائمة الأوامر الجاهزة |
| `assets/js/modules/admin-sql-presets.js` | فهرس الأوامر + تقسيم السكربت + حالة مُنفذ |
| `assets/js/modules/admin-sql-workspace.js` | تشغيل / تشغيل متسلسل / سجل |
| `assets/css/admin-sql-workspace.css` | تنسيق |
| `supabase/sql/COPY-ME-admin-sql-workspace.sql` | RPC الأساس + فحص حرفي للفاصلة المنقوطة داخل `$$` |

## كيف تشغّل إصلاحًا؟

1. Hard Refresh لـ `/pages/admin.html`
2. سجّل دخول الإدارة → **⚙ أدوات الصيانة**
3. من **أوامر الصيانة الجاهزة** اختر الأمر → **تشغيل** → أكّد
4. عند النجاح: يظهر **مُنفذ**

