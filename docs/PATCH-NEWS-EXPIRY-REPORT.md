# Patch C — News Expiry Unification Report (Family / Web)

**التاريخ:** 2026-08-07  
**الحالة:** مكتمل (مصدر ظهور ويب + توثيق)  
**المرجع:** [`ENGINEERING-ROADMAP.md`](./ENGINEERING-ROADMAP.md) بند **4** · مسار **C** · ADR-008  
**تقرير الموبايل:** `alzidan-family-mobile/docs/PATCH-NEWS-EXPIRY-REPORT.md`

---

## 1) الهدف

مصدر ظهور واحد لأخبار `family_events` عبر Web / Mobile / Widget حتى KPI: **أخبار منتهية ظاهرة = 0** (`NEWS-001`).

---

## 2) التغييرات (هذا المستودع)

| ملف | الدور |
|-----|--------|
| `assets/js/modules/events/event-visibility.js` | مصدر ظهور الويب الموثّق (`AlzidanEventVisibility`) |
| `pages/index.html` | تحميل الوحدة قبل `app.js` |
| `assets/js/app.js` | يستدعي الوحدة لـ `isFamilyEventPubliclyVisible` (مع fallback) |
| `scripts/verify-news-expiry.mjs` | Smoke |
| `package.json` | `verify:news-expiry` |
| `docs/ENGINEERING-ROADMAP.md` | تحديث تقدّم مسار C |

---

## 3) القواعد (ملخص)

انظر تقرير الموبايل §2 — مطابقة حرفية قدر الإمكان بين JS / TS / Swift.

---

## 4) Compatibility Matrix

| المنصة | Affected | Verified |
|--------|----------|----------|
| Web | ✅ | ✅ smoke |
| iOS + Widget | ✅ (مستودع الموبايل) | ✅ smoke منطق |
| Admin/Delegate | Not affected للعرض العام | — |

---

## 5) الخطوة التالية

مسار **Repair / Integrity** حسب خارطة الطريق (بعد استقرار C).
