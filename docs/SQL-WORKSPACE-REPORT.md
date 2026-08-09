# SQL Workspace — تقرير التسليم

**التاريخ:** 2026-08-09  
**الحالة:** واجهة ✅ · أوامر جاهزة ✅ · طابور/أرشيف ✅ · **منفّذ v2 (CREATE OR REPLACE فقط)** ✅  
**المسار:** `pages/admin.html` → بعد الدخول → **⚙ أدوات الصيانة** (`#module=tools`)

## لماذا فشل مسار pg_proc

السكربت السابق (`20260809_sql_workspace_executor_bootstrap.sql`) حاول:

`UPDATE pg_proc SET prosrc = …`

حتى بحساب `postgres` على Supabase النتيجة:

`ERROR: 42501: permission denied for table pg_proc`

إذن المشكلة **ليست** SQL Workspace ولا المتصفح — التعديل على كتالوج النظام **ممنوع** في Supabase. أي بطاقة ترقية تعتمد على `pg_proc` لن تعمل إطلاقًا.

## التصميم الجديد (بدون كتالوج)

| المكوّن | الدور |
|---------|--------|
| `admin_sql_sql_without_literals_v1` | يتجاهل `;` داخل `$$` / نصوص / تعليقات |
| `admin_sql_split_statements_v1` | تقسيم سكربت متعدد الأوامر بأمان |
| `admin_sql_execute_v1` | أمر واحد (literal-aware) |
| **`admin_sql_workspace_run_v2`** | تشغيل سكربت متعدد الأوامر عبر `EXECUTE` فقط |

ملف التثبيت الوحيد المسموح:

- `supabase/sql/COPY-ME-admin-sql-workspace-run-v2.sql`
- `supabase/sql/20260809_admin_sql_workspace_run_v2.sql`

محتواه: **CREATE OR REPLACE FUNCTION + GRANT/REVOKE فقط** — لا `UPDATE` على جداول النظام.

الملفات القديمة بـ `UPDATE pg_proc` **مُلغاة** وتعيد رسالة `SQL-WS-RETIRED-PG-PROC`.

## Chicken-egg

1. إن كان المنفّذ القديم يرفض أي `;` (حتى داخل أجسام الدوال) → لا يمكن زرع plpgsql من داخل المساحة بدون كتالوج.  
2. الحل المعماري: **لصق مرة واحدة** لملف v2 في **Supabase SQL Editor** (CREATE OR REPLACE مسموح).  
3. بعدها العميل يستدعي `admin_sql_workspace_run_v2` — أوامر الصيانة من المساحة إلى الأبد.  
4. إن كان `execute_v1` لا يزال literal-aware، قد ينجح التثبيت من بطاقة المساحة مباشرة (تقسيم أوامر + CREATE OR REPLACE) دون لصق.

## أوامر الصيانة الجاهزة

| المعرّف | العنوان | ملف |
|---------|---------|-----|
| `maint.sql_workspace_run_v2` | تثبيت منفّذ SQL Workspace v2 | `COPY-ME-admin-sql-workspace-run-v2.sql` |
| `maint.fix_delegate_portal_path_v1` | إصلاح دخول المندوب بعد القبول | `COPY-ME-fix-delegate-portal-path.sql` |
| `maint.delegate_secret_reset_v1` | طلب إعادة تعيين الرقم السري | `COPY-ME-delegate-secret-reset.sql` |

## إعادة الاختبار (دقيق)

1. Hard Refresh لـ `/pages/admin.html` (Cmd+Shift+R).
2. **مرة واحدة في Supabase:** الصق `COPY-ME-admin-sql-workspace-run-v2.sql` → Run  
   (يتوقع نجاحًا كاملًا — CREATE OR REPLACE فقط، بلا خطأ `pg_proc`).
3. الإدارة → **⚙ أدوات الصيانة** → شغّل **تثبيت منفّذ SQL Workspace v2** (يجب أن يكتشف الجاهزية ويُأرشف، أو يثبّت إن نجح عبر المساحة).
4. شغّل **إصلاح دخول المندوب بعد القبول (بوابة 1)** من المساحة — بدون الرجوع لـ Supabase.
5. ثم **إعادة تعيين الرقم السري** إن لزم.

**بوابة 1 = 🟢** («اغلاق ١» 2026-08-09) · **بوابة 2 = 🟢** («ابدا» 2026-08-09) · **رحلة القرار = ✅** («ابدا» 2026-08-09). التالي: مراجعة تصميم Request Experience — [`REQUEST-EXPERIENCE-UX-v1.md`](./REQUEST-EXPERIENCE-UX-v1.md).
