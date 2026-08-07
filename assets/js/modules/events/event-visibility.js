/**
 * مصدر ظهور الأخبار الواحد (مسار C / NEWS-001).
 * يُستخدم من الصفحة العامة؛ التطبيق والودجت يطابقان نفس القواعد.
 *
 * القواعد:
 * - وفاة: 3 أيام تقويمية من يوم الحدث (أو created_at إن لم يوجد event_date)
 * - غير الوفاة: ضمن نافذة showDays من created_at (1–7، افتراضي 7)
 * - الأفراح المؤرخة: تختفي بعد انتهاء يوم المناسبة
 * - event_date = null: يعتمد على created_at / showDays (لا ظهور أبدي)
 */
(function (root) {
  "use strict";

  var DEATH_KEEP_DAYS = 3;
  var DEFAULT_SHOW_DAYS = 7;

  function normalizeText(v) {
    return String(v == null ? "" : v).trim();
  }

  function normalizeArabicDigits(value) {
    return String(value || "")
      .replace(/[٠-٩]/g, function (d) {
        return String("٠١٢٣٤٥٦٧٨٩".indexOf(d));
      })
      .replace(/[۰-۹]/g, function (d) {
        return String("۰۱۲۳۴۵۶۷۸۹".indexOf(d));
      })
      .replace(/[\\\-.]/g, "/")
      .trim();
  }

  function startOfLocalDayMs(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  }

  function clampVisibilityDays(value, fallback) {
    var fb = fallback == null ? DEFAULT_SHOW_DAYS : fallback;
    var n = parseInt(String(value == null ? "" : value).trim(), 10);
    if (!Number.isFinite(n)) return fb;
    if (n < 1) return 1;
    if (n > 7) return 7;
    return n;
  }

  function safeParseJson(raw) {
    if (raw == null || raw === "") return null;
    if (typeof raw === "object") return raw;
    try {
      var parsed = JSON.parse(String(raw));
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  function parseEventEnvelope(row) {
    return safeParseJson(row && row.details != null ? row.details : null);
  }

  function getEventVisibilityDays(row) {
    if (row && row.showDays != null && row.showDays !== "") {
      return clampVisibilityDays(row.showDays);
    }
    var env = parseEventEnvelope(row || {});
    if (
      env &&
      env.v === 1 &&
      (env.kind === "happy_notice" || env.kind === "health_notice" || env.kind === "death_notice")
    ) {
      return clampVisibilityDays(env.showDays);
    }
    return DEFAULT_SHOW_DAYS;
  }

  function isDeathEventType(row) {
    return normalizeText(row && row.type ? row.type : "").toLowerCase() === "death";
  }

  function isHappyEventType(row) {
    var type = normalizeText(row && row.type ? row.type : "").toLowerCase();
    if (!type) return true;
    return !(type === "death" || type === "sick" || type === "operation" || type === "discharge");
  }

  function parseHijriApproxToGregorianMs(label) {
    var s = normalizeArabicDigits(label || "");
    var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (!m) return null;
    var day = parseInt(m[1], 10);
    var month = parseInt(m[2], 10);
    var year = parseInt(m[3], 10);
    if (!year || !month || !day) return null;
    try {
      var approxDays = Math.round((year - 1448) * 354.367 + (month - 1) * 29.5306 + (day - 1));
      var base = Date.UTC(2026, 5, 26, 12, 0, 0);
      var fmt = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", {
        timeZone: "UTC",
        day: "numeric",
        month: "numeric",
        year: "numeric",
      });
      for (var delta = -45; delta <= 45; delta++) {
        var date = new Date(base + (approxDays + delta) * 86400000);
        var parts = fmt.formatToParts(date);
        var get = function (t) {
          var p = parts.find(function (x) {
            return x.type === t;
          });
          return Number(p && p.value);
        };
        if (get("year") === year && get("month") === month && get("day") === day) {
          return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()).getTime();
        }
      }
    } catch (e) {}
    var fallback =
      new Date(2026, 5, 26).getTime() +
      Math.round((year - 1448) * 354.367 + (month - 1) * 29.5306 + (day - 1)) * 24 * 60 * 60 * 1000;
    return Number.isFinite(fallback) ? fallback : null;
  }

  function eventDayMs(row) {
    var eventDate = normalizeArabicDigits(row && row.event_date ? row.event_date : row.eventDate || "");
    if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(eventDate)) {
      var parts = eventDate.split("/");
      var year = Number(parts[0]);
      var month = Number(parts[1]);
      var day = Number(parts[2]);
      if (year >= 1900) return new Date(year, month - 1, day).getTime();
      if (year >= 1300 && year < 1900) return parseHijriApproxToGregorianMs(day + "/" + month + "/" + year);
    }
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(eventDate)) return parseHijriApproxToGregorianMs(eventDate);

    var details = parseEventEnvelope(row) || {};
    return (
      parseHijriApproxToGregorianMs(row && row.date_label ? row.date_label : row.date || "") ||
      parseHijriApproxToGregorianMs(details.date_label || details.dateLabel || details.hijriDate || details.date || "")
    );
  }

  function daysFromEventDay(row, now) {
    var day = eventDayMs(row);
    if (day == null) return null;
    var today = now || new Date();
    var start = startOfLocalDayMs(today);
    return Math.round((day - start) / (24 * 60 * 60 * 1000));
  }

  function isWithinDaysFromEventDay(row, keepDays, now) {
    var days = Math.max(1, Number(keepDays) || 1);
    var diff = daysFromEventDay(row, now);
    if (diff !== null) return diff >= -(days - 1);

    var createdAt = row && row.created_at ? Date.parse(String(row.created_at)) : NaN;
    if (!Number.isFinite(createdAt) && row && row.createdAt) {
      createdAt = Date.parse(String(row.createdAt));
    }
    if (!Number.isFinite(createdAt)) return true;
    var created = new Date(createdAt);
    var createdStart = startOfLocalDayMs(created);
    var todayStart = startOfLocalDayMs(now || new Date());
    var ageDays = Math.round((todayStart - createdStart) / (24 * 60 * 60 * 1000));
    return ageDays >= 0 && ageDays <= days - 1;
  }

  function isCreatedWithinShowWindow(row, now) {
    var createdAt = row && row.created_at ? Date.parse(String(row.created_at)) : NaN;
    if (!Number.isFinite(createdAt) && row && row.createdAt) {
      createdAt = Date.parse(String(row.createdAt));
    }
    if (!Number.isFinite(createdAt)) return true;
    var nowMs = (now || new Date()).getTime();
    var maxAgeMs = Math.max(1, getEventVisibilityDays(row)) * 24 * 60 * 60 * 1000;
    return createdAt >= nowMs - maxAgeMs;
  }

  function isFamilyEventPubliclyVisible(row, now) {
    if (isDeathEventType(row)) return isWithinDaysFromEventDay(row, DEATH_KEEP_DAYS, now);
    if (!isCreatedWithinShowWindow(row, now)) return false;
    if (isHappyEventType(row)) {
      var diff = daysFromEventDay(row, now);
      if (diff !== null && diff < 0) return false;
    }
    return true;
  }

  function nextVisibilityRefreshDate(now) {
    var d = now || new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 5);
  }

  var api = {
    DEATH_KEEP_DAYS: DEATH_KEEP_DAYS,
    DEFAULT_SHOW_DAYS: DEFAULT_SHOW_DAYS,
    clampVisibilityDays: clampVisibilityDays,
    getEventVisibilityDays: getEventVisibilityDays,
    isDeathEventType: isDeathEventType,
    isHappyEventType: isHappyEventType,
    daysFromEventDay: daysFromEventDay,
    isWithinDaysFromEventDay: isWithinDaysFromEventDay,
    isCreatedWithinShowWindow: isCreatedWithinShowWindow,
    isFamilyEventPubliclyVisible: isFamilyEventPubliclyVisible,
    isPubliclyVisible: isFamilyEventPubliclyVisible,
    nextVisibilityRefreshDate: nextVisibilityRefreshDate,
  };

  root.AlzidanEventVisibility = api;
  root.AlzidanEvents = root.AlzidanEvents || {};
  root.AlzidanEvents.visibility = api;
})(typeof window !== "undefined" ? window : globalThis);
