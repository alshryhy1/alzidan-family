# BUG — بطاقات خاصة: حفظ 200 والقائمة فارغة

**التاريخ:** 2026-08-07  
**الحالة:** مُشخَّص + إصلاح عميل + SQL قائمة (`ADMIN-SC-LIST-001`) — يتطلّب تطبيق SQL على الإنتاج ثم تحقق يدوي  
**الموضع في الخطة:** إصلاحات لوحة الإدارة · `ENGINEERING-ROADMAP.md` §8ب  
**الرمز:** `ADMIN-SC-LIST-001` (يتبع `ADMIN-RPC-001`)

---

## الأعراض

- Console: `ADMIN_RPC admin_special_cards_save_v1 start` ثم `ok` (`status: 200`) عبر `rest-fetch`.
- الواجهة تبقى: «اختر بطاقة… / لا توجد بطاقات خاصة محملة».

## السبب الجذري

1. **الحفظ يعمل** عبر `invokeAdminRpc` → `admin_special_cards_save_v1` (SECURITY DEFINER) فيتجاوز RLS.
2. **بعد الحفظ** يستدعي `loadSpecialCardsRows()` مسارًا مختلفًا:  
   `sb.from("special_cards").select("*")`.
3. قراءة الجدول بدور `anon` تحت RLS ترجع **`[]` مع HTTP 200** (`content-range: */0`) — ليست تعليق session-lock وليست فشل شبكة.
4. لا توجد دالة قائمة إدارية `admin_special_cards_list_v1` على الإنتاج (PGRST202).

النتيجة: السجل يُكتب في القاعدة، والقائمة الإدارية تُحدَّث من استعلام فارغ بسبب RLS.

## الإصلاح

1. SQL: [`supabase/sql/admin_special_cards_list_v1.sql`](../supabase/sql/admin_special_cards_list_v1.sql)  
   `admin_special_cards_list_v1(p_token, p_limit)` — SECURITY DEFINER + `admin_token_ok_v1`.
2. العميل: `loadSpecialCardsRows` يستخدم `invokeAdminRpc("admin_special_cards_list_v1", …)` بدلًا من `.from("special_cards")`.
3. بعد الحفظ: إدراج صف محلي مؤقت ثم تحديث من القائمة الإدارية.

## تطبيق مطلوب على الإنتاج

نفّذ ملف SQL أعلاه مرة واحدة في Supabase SQL Editor، ثم حدّث لوحة الإدارة.

## Regression / تحقق يدوي

1. طبّق SQL.
2. إدارة → بطاقات خاصة → حفظ بطاقة جديدة.
3. Console: `admin_special_cards_save_v1` ok ثم `admin_special_cards_list_v1` ok.
4. القائمة تعرض البطاقة + رسالة «تم تحميل N بطاقة خاصة».
5. زر «تحميل» يعيد نفس القائمة.

## مرتبط

- [`BUG-SPECIAL-CARDS-RPC.md`](./BUG-SPECIAL-CARDS-RPC.md) — تعليق `sb.rpc` قبل Network (`ADMIN-RPC-001`).
