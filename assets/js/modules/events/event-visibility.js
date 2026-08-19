/**
 * مصدر ظهور الأخبار الواحد (مسار C / NEWS-001 + جدولة الظهور).
 * يُستخدم من الصفحة العامة؛ التطبيق والودجت يطابقان نفس القواعد.
 *
 * الظهور = f(now, event_date, show_before_days / show_at, end_at, manual_hidden)
 * لا يعتمد على cron — يُحسب عند القراءة.
 *
 * حالات دورة الحياة للمناسبة المعتمدة:
 * - scheduled / مجدولة للظهور
 * - visible / ظاهر الآن
 * - ended / منتهية
 * - hidden / مخفية يدويًا
 */
(function (root) {
  "use strict";

  var DEATH_KEEP_DAYS = 3;
  var DEFAULT_SHOW_DAYS = 7;
  var DEFAULT_SHOW_BEFORE_DAYS = 3;
  var SHOW_BEFORE_DAY_OPTIONS = [1, 2, 3, 5, 7];

  var MSG = {
    DATE_EXPIRED:
      "تاريخ المناسبة منتهٍ ولا يمكن إرسالها. اختر تاريخًا اليوم أو لاحقًا.",
    DATE_INVALID: "تاريخ المناسبة غير مفهوم. أدخل تاريخًا صحيحًا.",
    DATE_REQUIRED: "أدخل التاريخ. بدونه لا يُحدد وقت ظهور المناسبة.",
    SCHEDULED: "مجدولة للظهور",
    VISIBLE: "ظاهر الآن",
    ENDED: "منتهية",
    HIDDEN: "مخفية",
    PENDING_CHIP: "بانتظار المراجعة",
    APPROVED_CHIP: "تمت الموافقة",
    SCHEDULED_CHIP: "مجدول للظهور",
    VISIBLE_CHIP: "ظاهر الآن",
    ENDED_CHIP: "منتهٍ",
    REJECTED_CHIP: "مرفوض",
  };

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

  var RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;

  function riyadhYmd(date) {
    var d = date instanceof Date ? date : new Date(date);
    var parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Riyadh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(d);
    var get = function (t) {
      var p = parts.find(function (x) {
        return x.type === t;
      });
      return Number(p && p.value);
    };
    return { y: get("year"), m: get("month"), d: get("day") };
  }

  function riyadhDayStartMs(year, month, day) {
    return Date.UTC(year, month - 1, day, 0, 0, 0) - RIYADH_OFFSET_MS;
  }

  function startOfLocalDayMs(date) {
    var p = riyadhYmd(date || new Date());
    return riyadhDayStartMs(p.y, p.m, p.d);
  }

  function endOfLocalDayMs(date) {
    return startOfLocalDayMs(date) + 24 * 60 * 60 * 1000 - 1;
  }

  function clampVisibilityDays(value, fallback) {
    var fb = fallback == null ? DEFAULT_SHOW_DAYS : fallback;
    var n = parseInt(String(value == null ? "" : value).trim(), 10);
    if (!Number.isFinite(n)) return fb;
    if (n < 1) return 1;
    if (n > 7) return 7;
    return n;
  }

  function clampShowBeforeDays(value, fallback) {
    var fb = fallback == null ? DEFAULT_SHOW_BEFORE_DAYS : fallback;
    var n = parseInt(String(value == null ? "" : value).trim(), 10);
    if (!Number.isFinite(n)) return fb;
    if (SHOW_BEFORE_DAY_OPTIONS.indexOf(n) >= 0) return n;
    if (n < 1) return 1;
    if (n > 7) return 7;
    // nearest allowed
    var best = SHOW_BEFORE_DAY_OPTIONS[0];
    var bestDiff = Math.abs(best - n);
    for (var i = 1; i < SHOW_BEFORE_DAY_OPTIONS.length; i++) {
      var d = Math.abs(SHOW_BEFORE_DAY_OPTIONS[i] - n);
      if (d < bestDiff) {
        best = SHOW_BEFORE_DAY_OPTIONS[i];
        bestDiff = d;
      }
    }
    return best;
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

  function readScheduleField(row, snake, camel) {
    if (!row) return null;
    if (row[snake] != null && row[snake] !== "") return row[snake];
    if (row[camel] != null && row[camel] !== "") return row[camel];
    var env = parseEventEnvelope(row) || {};
    if (env[snake] != null && env[snake] !== "") return env[snake];
    if (env[camel] != null && env[camel] !== "") return env[camel];
    return null;
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

  function getShowBeforeDays(row) {
    var raw = readScheduleField(row, "show_before_days", "showBeforeDays");
    if (raw == null || raw === "") return DEFAULT_SHOW_BEFORE_DAYS;
    return clampShowBeforeDays(raw, DEFAULT_SHOW_BEFORE_DAYS);
  }

  function isManualHidden(row) {
    var raw = readScheduleField(row, "manual_hidden", "manualHidden");
    if (raw === true || raw === 1 || raw === "1" || raw === "true") return true;
    if (row && (row.is_hidden === true || row.isHidden === true)) return true;
    return false;
  }

  function isDeathEventType(row) {
    return normalizeText(row && row.type ? row.type : "").toLowerCase() === "death";
  }

  function isHappyEventType(row) {
    var type = normalizeText(row && row.type ? row.type : "").toLowerCase();
    if (!type) return true;
    return !(type === "death" || type === "sick" || type === "operation" || type === "discharge");
  }

  function isHealthEventType(row) {
    var type = normalizeText(row && row.type ? row.type : "").toLowerCase();
    return type === "sick" || type === "operation" || type === "discharge";
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

  function parseIsoDateToLocalDayMs(raw) {
    var s = normalizeArabicDigits(String(raw || "")).replace(/-/g, "/");
    var iso = /^(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(s);
    if (!iso) return null;
    var year = Number(iso[1]);
    var month = Number(iso[2]);
    var day = Number(iso[3]);
    if (!year || !month || !day) return null;
    if (year >= 1900) return riyadhDayStartMs(year, month, day);
    if (year >= 1300 && year < 1900) {
      return parseHijriApproxToGregorianMs(day + "/" + month + "/" + year);
    }
    return null;
  }

  function eventDayMs(row) {
    var eventDate = normalizeArabicDigits(
      row && row.event_date != null
        ? row.event_date
        : row && row.eventDate != null
          ? row.eventDate
          : ""
    );
    if (/^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}/.test(eventDate)) {
      var dayMs = parseIsoDateToLocalDayMs(eventDate);
      if (dayMs != null) return dayMs;
    }
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(eventDate)) {
      return parseHijriApproxToGregorianMs(eventDate);
    }

    var details = parseEventEnvelope(row) || {};
    return (
      parseIsoDateToLocalDayMs(row && row.date_label ? row.date_label : row && row.date ? row.date : "") ||
      parseHijriApproxToGregorianMs(row && row.date_label ? row.date_label : row && row.date ? row.date : "") ||
      parseIsoDateToLocalDayMs(details.date_label || details.dateLabel || details.event_date || details.date || "") ||
      parseHijriApproxToGregorianMs(
        details.date_label || details.dateLabel || details.hijriDate || details.date || ""
      )
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

  function parseTimestampMs(raw) {
    if (raw == null || raw === "") return null;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    var ms = Date.parse(String(raw));
    return Number.isFinite(ms) ? ms : null;
  }

  /**
   * نافذة الظهور المجدولة للمناسبات المؤرخة (أفراح وغيرها).
   * show_at يتقدّم على show_before_days.
   * end_at يتقدّم على نهاية يوم المناسبة.
   */
  function resolveScheduleWindow(row, now) {
    var dayMs = eventDayMs(row);
    var showAtRaw = readScheduleField(row, "show_at", "showAt");
    var endAtRaw = readScheduleField(row, "end_at", "endAt");
    var showAtMs = parseTimestampMs(showAtRaw);
    var endAtMs = parseTimestampMs(endAtRaw);
    var beforeDays = getShowBeforeDays(row);

    if (showAtMs == null && dayMs != null) {
      showAtMs = dayMs - beforeDays * 24 * 60 * 60 * 1000;
    }
    if (endAtMs == null && dayMs != null) {
      endAtMs = endOfLocalDayMs(new Date(dayMs));
    }

    return {
      showAtMs: showAtMs,
      endAtMs: endAtMs,
      beforeDays: beforeDays,
      eventDayMs: dayMs,
      hasSchedule: showAtMs != null || endAtMs != null || dayMs != null,
    };
  }

  /**
   * دورة حياة الظهور لمناسبة معتمدة (أو صف family_events منشور).
   * @returns {'hidden'|'scheduled'|'visible'|'ended'|'legacy'}
   */
  function deriveEventLifecycleState(row, now) {
    var when = now || new Date();
    var nowMs = when.getTime();
    if (isManualHidden(row)) return "hidden";

    if (isDeathEventType(row)) {
      return isWithinDaysFromEventDay(row, DEATH_KEEP_DAYS, when) ? "visible" : "ended";
    }

    if (isHealthEventType(row)) {
      if (!isCreatedWithinShowWindow(row, when)) return "ended";
      return "visible";
    }

    // Happy / dated occasions — Riyadh calendar day wins over a stale UTC end_at/show_at.
    var win = resolveScheduleWindow(row, when);
    if (win.eventDayMs != null || win.showAtMs != null || win.endAtMs != null) {
      var riyadhDiff = win.eventDayMs != null ? daysFromEventDay(row, when) : null;
      var riyadhDayEnd =
        win.eventDayMs != null ? endOfLocalDayMs(new Date(win.eventDayMs)) : null;
      if (riyadhDiff === 0) return "visible";
      if (riyadhDayEnd != null && nowMs <= riyadhDayEnd && riyadhDiff != null && riyadhDiff <= 0) {
        return "visible";
      }
      if (win.endAtMs != null && nowMs > win.endAtMs) return "ended";
      if (riyadhDiff != null && riyadhDiff < 0) return "ended";
      if (win.showAtMs != null && nowMs < win.showAtMs) return "scheduled";
      return "visible";
    }

    // Date label present but unparsed → treat as scheduled (do not show as "new").
    var datedHint = normalizeText(
      (row && (row.event_date || row.date_label || row.date || row.dateLabel)) || ""
    );
    if (datedHint) return "scheduled";

    // Legacy undated: created_at + showDays window
    if (!isCreatedWithinShowWindow(row, when)) return "ended";
    return "visible";
  }

  function lifecycleStateLabelAr(state) {
    var s = normalizeText(state).toLowerCase();
    if (s === "scheduled") return MSG.SCHEDULED;
    if (s === "visible") return MSG.VISIBLE;
    if (s === "ended") return MSG.ENDED;
    if (s === "hidden") return MSG.HIDDEN;
    return MSG.VISIBLE;
  }

  function isFamilyEventPubliclyVisible(row, now) {
    var state = deriveEventLifecycleState(row, now);
    return state === "visible";
  }

  function nextVisibilityRefreshDate(now) {
    var d = now || new Date();
    var winRefresh = null;
    // Midnight next local day as baseline; callers may also pass rows.
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 5);
  }

  /**
   * Validate event date for public/delegate create of dated happy occasions.
   * Death/health: past dates allowed (incident already happened / ongoing).
   * @returns {{ ok: boolean, reason?: string, dayMs?: number|null, isFuture?: boolean, isPast?: boolean, isToday?: boolean }}
   */
  function validateEventDateForSubmit(rawDate, opts) {
    var options = opts || {};
    var category = normalizeText(options.category || options.type || "happy").toLowerCase();
    var allowPast =
      options.allowPast === true ||
      category === "death" ||
      category === "sick" ||
      category === "health" ||
      category === "operation" ||
      category === "discharge";
    var required = options.required !== false;
    var raw = normalizeText(rawDate);
    if (!raw) {
      if (required) return { ok: false, reason: MSG.DATE_REQUIRED };
      return { ok: true, dayMs: null };
    }

    var dayMs =
      parseIsoDateToLocalDayMs(raw) ||
      parseHijriApproxToGregorianMs(normalizeArabicDigits(raw)) ||
      null;
    if (dayMs == null) {
      return { ok: false, reason: MSG.DATE_INVALID };
    }

    var today = startOfLocalDayMs(options.now || new Date());
    var isPast = dayMs < today;
    var isToday = dayMs === today;
    var isFuture = dayMs > today;

    if (isPast && !allowPast) {
      return {
        ok: false,
        reason: MSG.DATE_EXPIRED,
        dayMs: dayMs,
        isPast: true,
        isToday: false,
        isFuture: false,
      };
    }
    return {
      ok: true,
      dayMs: dayMs,
      isPast: isPast,
      isToday: isToday,
      isFuture: isFuture,
    };
  }

  /**
   * Build schedule fields to store on family_events / details.
   * Default: show 3 days before event_date; end at end of event day.
   */
  function buildScheduleFields(input) {
    var src = input || {};
    var showAt = normalizeText(src.show_at || src.showAt || "");
    var endAt = normalizeText(src.end_at || src.endAt || "");
    var before =
      src.show_before_days != null
        ? src.show_before_days
        : src.showBeforeDays != null
          ? src.showBeforeDays
          : DEFAULT_SHOW_BEFORE_DAYS;
    var showBeforeDays = clampShowBeforeDays(before, DEFAULT_SHOW_BEFORE_DAYS);
    var manualHidden = !!(src.manual_hidden || src.manualHidden);

    var fields = {
      show_before_days: showBeforeDays,
      show_at: showAt || null,
      end_at: endAt || null,
      manual_hidden: manualHidden,
    };

    // Prefer explicit show_at; otherwise derive from Gregorian or Hijri label.
    if (!fields.show_at) {
      var dayMs =
        parseIsoDateToLocalDayMs(src.event_date) ||
        eventDayMs({
          event_date: src.event_date,
          date_label: src.date_label || src.dateLabel || src.date || "",
          date: src.date || "",
        }) ||
        parseHijriApproxToGregorianMs(src.date_label || src.dateLabel || src.event_date || src.date || "");
      if (dayMs != null) {
        var start = new Date(dayMs - showBeforeDays * 24 * 60 * 60 * 1000);
        fields.show_at = start.toISOString();
        fields.end_at = fields.end_at || new Date(endOfLocalDayMs(new Date(dayMs))).toISOString();
      }
    }
    return fields;
  }

  /**
   * Merge schedule into details JSON string/object without dropping other keys.
   */
  function mergeScheduleIntoDetails(details, schedule) {
    var base =
      details && typeof details === "object" && !Array.isArray(details)
        ? Object.assign({}, details)
        : safeParseJson(details) || {};
    var sch = schedule || {};
    if (sch.show_before_days != null) base.show_before_days = sch.show_before_days;
    if (sch.show_at != null && sch.show_at !== "") base.show_at = sch.show_at;
    if (sch.end_at != null && sch.end_at !== "") base.end_at = sch.end_at;
    if (sch.manual_hidden != null) base.manual_hidden = !!sch.manual_hidden;
    return base;
  }

  function formatArabicDateTime(raw) {
    var ms = parseTimestampMs(raw);
    if (ms == null) return "";
    try {
      return new Date(ms).toLocaleString("ar-SA", {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (e) {
      return "";
    }
  }

  /**
   * Build an event-ish row for lifecycle from approval request + optional published event fields.
   */
  function coalesceEventRowForLifecycle(requestRow, eventRow) {
    if (eventRow && typeof eventRow === "object") return eventRow;
    var req = requestRow || {};
    var row = {
      type: req.event_type || req.type || "",
      event_date: req.event_date || null,
      date_label: req.date_label || null,
      show_at: req.show_at || null,
      show_before_days: req.show_before_days != null ? req.show_before_days : null,
      end_at: req.end_at || null,
      manual_hidden: req.manual_hidden,
      details: req.details || null,
      created_at: req.created_at || req.approved_at || null,
    };
    if (row.event_date || row.show_at || row.date_label || row.details) return row;

    var msg = String(req.message || "");
    try {
      var idx = msg.indexOf("__JSON__");
      if (idx >= 0) {
        var env = safeParseJson(msg.slice(idx + 8).replace(/^[\s:]+/, ""));
        if (env && env.event) return env.event;
        if (env && (env.event_date || env.date_label || env.show_at)) return env;
      }
    } catch (e) {}
    return null;
  }

  /**
   * Reviewer (delegate/admin) status label — separates approval vs visibility.
   * Approved events: «مقبول — مجدول للظهور في …» / «مقبول — منشور / ظاهر الآن» / «مقبول — منتهٍ».
   * @returns {{ key: string, label: string, visibility?: string, showAtLabel?: string }}
   */
  function deriveReviewerRequestStatus(requestRow, eventRow, now) {
    var status = normalizeText(requestRow && requestRow.status).toLowerCase();
    if (status === "rejected" || status === "denied") {
      return { key: "rejected", label: "تم الرفض" };
    }
    if (
      status === "pending" ||
      status === "submitted" ||
      status === "assigned" ||
      status === "in_review" ||
      status === "needs_changes" ||
      !status
    ) {
      return { key: "pending", label: "بانتظار الإجراء" };
    }

    var kind = normalizeText(requestRow && requestRow.kind).toLowerCase();
    var isPublish =
      kind === "event_card" ||
      kind === "family_event" ||
      kind === "event_request" ||
      kind === "occasion" ||
      kind === "patient" ||
      kind === "event_death";

    if (!isPublish) {
      return { key: "approved", label: "تم القبول" };
    }

    // List RPC sets published/event_id from a live family_events join.
    // When the event was admin-deleted, published=false — do not re-invent
    // «منشور» from leftover schedule fields inside the request message JSON.
    var listSaysUnpublished =
      requestRow &&
      (requestRow.published === false || requestRow.published === "false") &&
      (requestRow.event_id == null || requestRow.event_id === "");
    if (listSaysUnpublished) {
      return { key: "approved", label: "تم القبول", visibility: "unpublished" };
    }

    var row = coalesceEventRowForLifecycle(requestRow, eventRow);
    if (!row) {
      var publishedFlag =
        requestRow &&
        (requestRow.published === true ||
          requestRow.published === "true" ||
          requestRow.event_id != null);
      return {
        key: publishedFlag ? "visible" : "approved",
        label: publishedFlag ? "مقبول — منشور / ظاهر الآن" : "تم القبول",
      };
    }

    var life = deriveEventLifecycleState(row, now);
    var win = resolveScheduleWindow(row, now);
    var showAtLabel = formatArabicDateTime(win && win.showAtMs != null ? win.showAtMs : row.show_at);

    if (life === "ended" || life === "hidden") {
      return { key: "ended", label: "مقبول — منتهٍ", visibility: life, showAtLabel: showAtLabel };
    }
    if (life === "scheduled") {
      return {
        key: "scheduled",
        label: showAtLabel
          ? "مقبول — مجدول للظهور في " + showAtLabel
          : "مقبول — مجدول للظهور",
        visibility: "scheduled",
        showAtLabel: showAtLabel,
      };
    }
    if (life === "visible") {
      return {
        key: "visible",
        label: "مقبول — منشور / ظاهر الآن",
        visibility: "visible",
        showAtLabel: showAtLabel,
      };
    }
    return { key: "approved", label: "تم القبول", visibility: life || "", showAtLabel: showAtLabel };
  }

  /**
   * Safe reject-reason text for UI (never raw JSON / __JSON__).
   */
  function extractRejectReasonForUi(requestRow) {
    var Safe =
      typeof root !== "undefined" && root.AlzidanSafeRequestNotify
        ? root.AlzidanSafeRequestNotify
        : typeof globalThis !== "undefined"
          ? globalThis.AlzidanSafeRequestNotify
          : null;
    var raw =
      (requestRow &&
        (requestRow.reject_reason ||
          requestRow.rejection_reason ||
          requestRow.reason)) ||
      "";
    var msg = String(requestRow && requestRow.message ? requestRow.message : "");
    if (!raw) {
      var scrubbed = msg;
      var jsonIdx = scrubbed.indexOf("__JSON__");
      if (jsonIdx >= 0) scrubbed = scrubbed.slice(0, jsonIdx);
      var lines = scrubbed
        .split(/\n/g)
        .map(function (x) {
          return String(x || "").trim();
        })
        .filter(Boolean);
      var reasonLine = lines.find(function (x) {
        return /^سبب الرفض\s*:|^السبب\s*:|^سبب\s*:/.test(x);
      });
      if (reasonLine) {
        raw = reasonLine.replace(/^سبب الرفض\s*:\s*|^السبب\s*:\s*|^سبب\s*:\s*/, "");
      }
    }
    raw = String(raw || "").trim();
    if (!raw) return "";
    if (Safe && typeof Safe.safeUiDetailText === "function") {
      return Safe.safeUiDetailText(raw) || "";
    }
    if (/__JSON__|[{}\[\]]|events_audit/i.test(raw)) return "";
    return raw.slice(0, 280);
  }

  /**
   * Derive submitter «طلباتي» display status from approval row + optional event row.
   * @returns {{ key: string, label: string }}
   */
  function deriveSubmitterRequestStatus(requestRow, eventRow, now) {
    var status = normalizeText(requestRow && requestRow.status).toLowerCase();
    if (
      status === "rejected" ||
      status === "denied"
    ) {
      return { key: "rejected", label: MSG.REJECTED_CHIP };
    }
    if (
      status === "pending" ||
      status === "submitted" ||
      status === "assigned" ||
      status === "in_review" ||
      status === "needs_changes" ||
      !status
    ) {
      return { key: "pending", label: MSG.PENDING_CHIP };
    }

    // approved / applied / done
    var kind = normalizeText(requestRow && requestRow.kind).toLowerCase();
    var isPublish =
      kind === "event_card" ||
      kind === "family_event" ||
      kind === "event_request" ||
      kind === "occasion" ||
      kind === "patient" ||
      kind === "event_death";

    if (!isPublish) {
      return { key: "approved", label: MSG.APPROVED_CHIP };
    }

    var row = eventRow || null;
    if (!row && requestRow) {
      // Fallback: schedule may live in message envelope
      var msg = String(requestRow.message || "");
      var env = null;
      try {
        var idx = msg.indexOf("__JSON__");
        if (idx >= 0) {
          env = safeParseJson(msg.slice(idx + 8).replace(/^[\s:]+/, ""));
        }
      } catch (e) {}
      if (env && env.event) row = env.event;
      else if (requestRow.event_date || requestRow.date_label) {
        row = {
          type: requestRow.type || "gathering",
          event_date: requestRow.event_date,
          date_label: requestRow.date_label,
          details: requestRow.details,
          created_at: requestRow.created_at || requestRow.approved_at,
        };
      }
    }

    if (!row) {
      return { key: "approved", label: MSG.APPROVED_CHIP };
    }

    var life = deriveEventLifecycleState(row, now);
    if (life === "ended" || life === "hidden") {
      return { key: "ended", label: MSG.ENDED_CHIP };
    }
    if (life === "scheduled") {
      return { key: "scheduled", label: MSG.SCHEDULED_CHIP };
    }
    if (life === "visible") {
      return { key: "visible", label: MSG.VISIBLE_CHIP };
    }
    return { key: "approved", label: MSG.APPROVED_CHIP };
  }

  /** Banner visibility: show_start/show_end or legacy created_at+show_days. Soft-hide via is_active. */
  function isBannerPubliclyVisible(row, now) {
    if (!row) return false;
    if (row.is_active === false || row.isActive === false) return false;
    var when = now || new Date();
    var nowMs = when.getTime();

    var startRaw = row.show_start != null ? row.show_start : row.showStart;
    var endRaw = row.show_end != null ? row.show_end : row.showEnd;
    var startMs = parseTimestampMs(startRaw);
    var endMs = parseTimestampMs(endRaw);
    var permanent =
      row.is_permanent === true ||
      row.isPermanent === true ||
      (endRaw === null && startRaw != null) ||
      String(row.permanent || "") === "1";

    if (startMs != null || endMs != null || permanent) {
      if (startMs != null && nowMs < startMs) return false;
      if (!permanent && endMs != null && nowMs > endMs) return false;
      return true;
    }

    // Legacy: created_at + show_days
    var createdAt = row.created_at ? Date.parse(String(row.created_at)) : NaN;
    if (!Number.isFinite(createdAt)) return true;
    var days = Math.min(Math.max(Number(row.show_days || 7), 1), 7);
    return createdAt >= nowMs - days * 24 * 60 * 60 * 1000;
  }

  var api = {
    DEATH_KEEP_DAYS: DEATH_KEEP_DAYS,
    DEFAULT_SHOW_DAYS: DEFAULT_SHOW_DAYS,
    DEFAULT_SHOW_BEFORE_DAYS: DEFAULT_SHOW_BEFORE_DAYS,
    SHOW_BEFORE_DAY_OPTIONS: SHOW_BEFORE_DAY_OPTIONS,
    MESSAGES: MSG,
    clampVisibilityDays: clampVisibilityDays,
    clampShowBeforeDays: clampShowBeforeDays,
    getEventVisibilityDays: getEventVisibilityDays,
    getShowBeforeDays: getShowBeforeDays,
    isDeathEventType: isDeathEventType,
    isHappyEventType: isHappyEventType,
    isHealthEventType: isHealthEventType,
    daysFromEventDay: daysFromEventDay,
    isWithinDaysFromEventDay: isWithinDaysFromEventDay,
    isCreatedWithinShowWindow: isCreatedWithinShowWindow,
    resolveScheduleWindow: resolveScheduleWindow,
    deriveEventLifecycleState: deriveEventLifecycleState,
    lifecycleStateLabelAr: lifecycleStateLabelAr,
    isFamilyEventPubliclyVisible: isFamilyEventPubliclyVisible,
    isPubliclyVisible: isFamilyEventPubliclyVisible,
    nextVisibilityRefreshDate: nextVisibilityRefreshDate,
    validateEventDateForSubmit: validateEventDateForSubmit,
    buildScheduleFields: buildScheduleFields,
    mergeScheduleIntoDetails: mergeScheduleIntoDetails,
    deriveSubmitterRequestStatus: deriveSubmitterRequestStatus,
    deriveReviewerRequestStatus: deriveReviewerRequestStatus,
    coalesceEventRowForLifecycle: coalesceEventRowForLifecycle,
    extractRejectReasonForUi: extractRejectReasonForUi,
    formatArabicDateTime: formatArabicDateTime,
    isBannerPubliclyVisible: isBannerPubliclyVisible,
    isManualHidden: isManualHidden,
    eventDayMs: eventDayMs,
  };

  root.AlzidanEventVisibility = api;
  root.AlzidanEvents = root.AlzidanEvents || {};
  root.AlzidanEvents.visibility = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
