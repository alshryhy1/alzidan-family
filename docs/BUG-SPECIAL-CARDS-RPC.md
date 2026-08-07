# BUG — حفظ البطاقات الخاصة: RPC لا يُرسل طلب Network

**التاريخ:** 2026-08-07  
**الحالة:** إصلاح الحفظ (`ADMIN-RPC-001`) ✅ — متابعة القائمة الفارغة بعد الحفظ في [`BUG-SPECIAL-CARDS-LIST.md`](./BUG-SPECIAL-CARDS-LIST.md)  
**الموضع في الخطة:** إصلاحات لوحة الإدارة · `ENGINEERING-ROADMAP.md` §8ب  
**الرمز:** `ADMIN-RPC-001`

---

## الأعراض (تشخيص المستخدم)

تتبع `saveSpecialCardRow` في `assets/js/admin.js`:

- STEP 1 … STEP 5 … STEP 5.5 ✅
- ثم توقف نهائي — لا STEP 6
- في Network **لا يظهر** أي طلب `/rest/v1/rpc/admin_special_cards_save_v1`

الاستدعاء المتوقف سابقًا:

```js
await sb.rpc("admin_special_cards_save_v1", { p_token, p_id, p_row: payload })
```

## ما استُبعد

النموذج، `collectSpecialCardPayload()`، title/person_name، `getClient()`، `getAdminToken()`، شروط التحقق — تعمل حتى STEP 5.5.  
دالة SQL `admin_special_cards_save_v1` موجودة على الإنتاج وممنوحة لـ `anon` — غياب الطلب يشير لطبقة العميل قبل `fetch`.

## السبب الجذري (الأرجح)

`await sb.rpc(...)` في supabase-js يمر عبر غلاف المصادقة (`getSession` / auth lock) قبل إنشاء طلب HTTP.

- RPCs الإدارية تعتمد أصلًا على `p_token` وليس جلسة مستخدم.
- إذا عُلّق قفل الجلسة: الوعد لا يُحلّ ولا يُرفض، و**لا يُرسل أي طلب Network** — يطابق التشخيص تمامًا.
- الدالة SQL سليمة؛ المشكلة ليست «فشل السيرفر بصمت».

## الإصلاح (جذري)

1. **`invokeAdminRpc`** في `admin.js`: استدعاء REST مباشر  
   `POST {SUPABASE_URL}/rest/v1/rpc/{fn}` مع `apikey` + مهلة + سجلات `ADMIN_RPC …`.
2. حفظ/حذف البطاقات الخاصة يستخدمان `invokeAdminRpc` (مع `JSON` صريح و`try/catch`).
3. تعطيل `persistSession` / `autoRefreshToken` عند إنشاء عميل الإدارة في `config.js` و`admin.js` لتقليل قفل الجلسة على بقية `sb.rpc`.

## Regression / تحقق يدوي

1. افتح الإدارة → بطاقات خاصة → بطاقة جديدة → حفظ.
2. Network يجب أن يظهر `admin_special_cards_save_v1`.
3. Console: `ADMIN_RPC admin_special_cards_save_v1 start` ثم `ok`.
4. عند فشل التوكن: خطأ ظاهر وليس تعليقًا صامتًا.

## متابعة (القائمة فارغة رغم 200)

الحفظ عبر REST نجح، لكن التحميل كان `sb.from("special_cards")` تحت RLS فيُرجع `[]`.  
انظر [`BUG-SPECIAL-CARDS-LIST.md`](./BUG-SPECIAL-CARDS-LIST.md) و`admin_special_cards_list_v1`.

## ما تبقّى اختياريًا

ترحيل بقية `sb.rpc` الإدارية تدريجيًا إلى `invokeAdminRpc` لنفس الحماية.
