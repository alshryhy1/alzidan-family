/**
 * Alzidan DateEngine (ADR-009)
 *
 * Unified Hijri ⇄ Gregorian business-date library.
 * - Auto convert both ways (no convert button)
 * - Accepts: 1448/2/25, 1448-2-25, Arabic/Indic digits, Gregorian equivalents
 * - Live validation while typing
 * - Storage pair helpers: *_g + *_h (synced) — schema migration is gradual
 * - Reject Hijri values for Gregorian timestamp columns (e.g. poll ends_at)
 * - Ban raw `new Date()` for business dates outside this module
 */
(function (root) {
  "use strict";

  var ERROR = {
    DATE_001: "DATE-001", // unparseable / empty invalid
    DATE_002: "DATE-002", // Hijri in Gregorian timestamp column
    DATE_003: "DATE-003", // out of allowed calendar range
    DATE_004: "DATE-004", // incomplete while typing (soft)
  };

  var HIJRI_YEAR_MIN = 1200;
  var HIJRI_YEAR_MAX = 1700;
  var GREG_YEAR_MIN = 1800;
  var GREG_YEAR_MAX = 2100;
  var GREG_TS_YEAR_MIN = 1900;
  var GREG_TS_YEAR_MAX = 2100;

  var umalquraFormatter = (function () {
    try {
      return new Intl.DateTimeFormat("en-US-u-ca-islamic-umalqura", {
        timeZone: "UTC",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
    } catch (e) {
      return null;
    }
  })();

  function normalizeDigits(value) {
    return String(value == null ? "" : value)
      .replace(/[٠-٩]/g, function (d) {
        return String(d.charCodeAt(0) - 1632);
      })
      .replace(/[۰-۹]/g, function (d) {
        return String(d.charCodeAt(0) - 1776);
      });
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function formatISO(parts) {
    if (!parts) return "";
    return (
      String(parts.y).padStart(4, "0") +
      "-" +
      pad2(parts.mo) +
      "-" +
      pad2(parts.d)
    );
  }

  function gregorianToJdn(y, m, d) {
    var a = Math.floor((14 - m) / 12);
    var y2 = y + 4800 - a;
    var m2 = m + 12 * a - 3;
    return (
      d +
      Math.floor((153 * m2 + 2) / 5) +
      365 * y2 +
      Math.floor(y2 / 4) -
      Math.floor(y2 / 100) +
      Math.floor(y2 / 400) -
      32045
    );
  }

  function jdnToGregorian(jdn) {
    var a = jdn + 32044;
    var b = Math.floor((4 * a + 3) / 146097);
    var c = a - Math.floor((146097 * b) / 4);
    var d = Math.floor((4 * c + 3) / 1461);
    var e = c - Math.floor((1461 * d) / 4);
    var m = Math.floor((5 * e + 2) / 153);
    var day = e - Math.floor((153 * m + 2) / 5) + 1;
    var month = m + 3 - 12 * Math.floor(m / 10);
    var year = 100 * b + d - 4800 + Math.floor(m / 10);
    return { y: year, mo: month, d: day };
  }

  function hijriToJdn(y, m, d) {
    return (
      d +
      Math.ceil(29.5 * (m - 1)) +
      (y - 1) * 354 +
      Math.floor((3 + 11 * y) / 30) +
      1948439 -
      1
    );
  }

  function jdnToHijri(jdn) {
    var y = Math.floor((30 * (jdn - 1948439) + 10646) / 10631);
    var firstDay = hijriToJdn(y, 1, 1);
    var m = Math.min(12, Math.ceil((jdn - firstDay + 1) / 29.5) + 1);
    if (m < 1) m = 1;
    if (m > 12) m = 12;
    var d = jdn - hijriToJdn(y, m, 1) + 1;
    if (d < 1) {
      m = Math.max(1, m - 1);
      d = jdn - hijriToJdn(y, m, 1) + 1;
    }
    if (d > 30) d = 30;
    return { y: y, mo: m, d: d };
  }

  function umalquraHijriPartsFromDate(date) {
    if (!umalquraFormatter || !date) return null;
    var parts = umalquraFormatter.formatToParts(date);
    var get = function (t) {
      var p = parts.find(function (x) {
        return x.type === t;
      });
      return p ? p.value : "";
    };
    var y = parseInt(get("year"), 10);
    var mo = parseInt(get("month"), 10);
    var d = parseInt(get("day"), 10);
    if (!y || !mo || !d) return null;
    return { y: y, mo: mo, d: d };
  }

  function convertHijriToGregorian(parts) {
    if (!parts) return null;
    var approx = jdnToGregorian(hijriToJdn(parts.y, parts.mo, parts.d));
    if (umalquraFormatter && approx) {
      var base = Date.UTC(approx.y, approx.mo - 1, approx.d, 12, 0, 0);
      for (var delta = -10; delta <= 10; delta++) {
        var date = new Date(base + delta * 86400000);
        var got = umalquraHijriPartsFromDate(date);
        if (got && got.y === parts.y && got.mo === parts.mo && got.d === parts.d) {
          return {
            y: date.getUTCFullYear(),
            mo: date.getUTCMonth() + 1,
            d: date.getUTCDate(),
          };
        }
      }
    }
    return approx;
  }

  function convertGregorianToHijri(parts) {
    if (!parts) return null;
    if (umalquraFormatter) {
      var date = new Date(Date.UTC(parts.y, parts.mo - 1, parts.d, 12, 0, 0));
      var um = umalquraHijriPartsFromDate(date);
      if (um) return um;
    }
    return jdnToHijri(gregorianToJdn(parts.y, parts.mo, parts.d));
  }

  function inferCalendar(y, hint) {
    if (hint === "hijri" || hint === "gregorian") return hint;
    if (y >= HIJRI_YEAR_MIN && y <= HIJRI_YEAR_MAX) return "hijri";
    if (y >= GREG_YEAR_MIN && y <= GREG_YEAR_MAX) return "gregorian";
    return null;
  }

  /**
   * Parse a business date string (date-only or datetime).
   * Accepts separators / - . and Arabic/Indic digits.
   */
  function parse(input, options) {
    var opts = options || {};
    var raw = String(input == null ? "" : input).trim();
    if (!raw) {
      return {
        ok: false,
        empty: true,
        code: ERROR.DATE_001,
        message: "التاريخ فارغ.",
        raw: raw,
      };
    }

    var normalized = normalizeDigits(raw)
      .replace(/\s+/g, " ")
      .replace(/[٫،]/g, ".")
      .trim();

    // datetime-local / ISO datetime: keep date part for calendar, preserve time
    var timePart = null;
    var datePart = normalized;
    var dtMatch = /^(\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2})[ T](\d{1,2}:\d{2}(?::\d{2})?)/.exec(
      normalized,
    );
    if (dtMatch) {
      datePart = dtMatch[1];
      timePart = dtMatch[2];
    }

    datePart = datePart.replace(/[.]/g, "-").replace(/[\\]/g, "/");

    var y;
    var mo;
    var d;
    var mIso = /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/.exec(datePart);
    var mDmy = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec(datePart);

    if (mIso) {
      y = parseInt(mIso[1], 10);
      mo = parseInt(mIso[2], 10);
      d = parseInt(mIso[3], 10);
    } else if (mDmy) {
      d = parseInt(mDmy[1], 10);
      mo = parseInt(mDmy[2], 10);
      y = parseInt(mDmy[3], 10);
    } else {
      // Soft incomplete while typing: 1448, 1448/, 1448/2
      if (/^\d{1,4}([\/\-]\d{0,2}){0,2}$/.test(datePart.replace(/\s/g, ""))) {
        return {
          ok: false,
          incomplete: true,
          code: ERROR.DATE_004,
          message: "أكمل التاريخ…",
          raw: raw,
          normalized: normalized,
        };
      }
      return {
        ok: false,
        code: ERROR.DATE_001,
        message: "صيغة التاريخ غير مفهومة. أمثلة: 1448/2/25 أو 2026-08-07",
        raw: raw,
        normalized: normalized,
      };
    }

    if (!y || !mo || !d || mo < 1 || mo > 12 || d < 1 || d > 31) {
      return {
        ok: false,
        code: ERROR.DATE_001,
        message: "يوم/شهر غير صالح.",
        raw: raw,
      };
    }

    var calendar = inferCalendar(y, opts.calendar || opts.expect);
    if (!calendar) {
      return {
        ok: false,
        code: ERROR.DATE_003,
        message: "السنة خارج النطاق الهجري/الميلادي المتوقع.",
        raw: raw,
        y: y,
        mo: mo,
        d: d,
      };
    }

    if (calendar === "hijri" && (y < HIJRI_YEAR_MIN || y > HIJRI_YEAR_MAX || d > 30)) {
      return {
        ok: false,
        code: ERROR.DATE_003,
        message: "تاريخ هجري خارج النطاق المسموح.",
        raw: raw,
      };
    }
    if (
      calendar === "gregorian" &&
      (y < GREG_YEAR_MIN || y > GREG_YEAR_MAX)
    ) {
      return {
        ok: false,
        code: ERROR.DATE_003,
        message: "تاريخ ميلادي خارج النطاق المسموح.",
        raw: raw,
      };
    }

    var parts = { y: y, mo: mo, d: d, calendar: calendar };
    var gParts = calendar === "gregorian" ? parts : convertHijriToGregorian(parts);
    var hParts = calendar === "hijri" ? parts : convertGregorianToHijri(parts);
    if (!gParts || !hParts) {
      return {
        ok: false,
        code: ERROR.DATE_001,
        message: "تعذر تحويل التاريخ.",
        raw: raw,
      };
    }

    var isoG = formatISO(gParts);
    var isoH = formatISO(hParts);
    var result = {
      ok: true,
      raw: raw,
      normalized: normalized,
      calendar: calendar,
      y: y,
      mo: mo,
      d: d,
      g: isoG,
      h: isoH,
      gParts: { y: gParts.y, mo: gParts.mo, d: gParts.d },
      hParts: { y: hParts.y, mo: hParts.mo, d: hParts.d },
      time: timePart,
    };

    if (timePart) {
      result.gDateTimeLocal = isoG + "T" + timePart.slice(0, 5);
    }

    return result;
  }

  function validate(input, options) {
    return parse(input, options);
  }

  function convert(inputOrParts, toCalendar) {
    var to = toCalendar === "hijri" ? "hijri" : "gregorian";
    var parsed =
      inputOrParts && typeof inputOrParts === "object" && inputOrParts.y
        ? {
            ok: true,
            calendar: inputOrParts.calendar || inferCalendar(inputOrParts.y),
            y: inputOrParts.y,
            mo: inputOrParts.mo,
            d: inputOrParts.d,
          }
        : parse(inputOrParts);

    if (!parsed || !parsed.ok) return parsed;

    var parts = { y: parsed.y, mo: parsed.mo, d: parsed.d };
    if (parsed.calendar === to) {
      return {
        ok: true,
        calendar: to,
        iso: formatISO(parts),
        parts: parts,
      };
    }
    var out =
      to === "gregorian"
        ? convertHijriToGregorian(parts)
        : convertGregorianToHijri(parts);
    if (!out) {
      return { ok: false, code: ERROR.DATE_001, message: "تعذر التحويل." };
    }
    return { ok: true, calendar: to, iso: formatISO(out), parts: out };
  }

  function format(partsOrIso, style) {
    var parts =
      partsOrIso && typeof partsOrIso === "object"
        ? partsOrIso
        : null;
    if (!parts) {
      var p = parse(partsOrIso);
      if (!p.ok) return "";
      parts = { y: p.y, mo: p.mo, d: p.d };
    }
    var iso = formatISO(parts);
    if (style === "slash") {
      return parts.y + "/" + parts.mo + "/" + parts.d;
    }
    return iso;
  }

  /**
   * Synced storage pair for business dates (birth, death, event, poll_end, …).
   * Does NOT migrate DB schema — callers write both when columns exist.
   */
  function toSyncedPair(input, options) {
    var parsed = parse(input, options);
    if (!parsed.ok) return parsed;
    return {
      ok: true,
      g: parsed.g,
      h: parsed.h,
      calendar: parsed.calendar,
      raw: parsed.raw,
    };
  }

  /**
   * Guard for Gregorian timestamptz / datetime columns (poll ends_at, etc.).
   * Rejects Hijri years that would be stored as fake CE timestamps.
   */
  function assertGregorianTimestamp(input, options) {
    var opts = options || {};
    var raw = String(input == null ? "" : input).trim();
    if (!raw) {
      if (opts.optional) {
        return { ok: true, empty: true, iso: null };
      }
      return {
        ok: false,
        code: ERROR.DATE_001,
        message: "تاريخ الانتهاء مطلوب.",
      };
    }

    var normalized = normalizeDigits(raw);
    var yearMatch = /^(\d{4})/.exec(normalized.trim());
    var rawYear = yearMatch ? Number(yearMatch[1]) : NaN;
    if (Number.isFinite(rawYear) && rawYear >= HIJRI_YEAR_MIN && rawYear <= HIJRI_YEAR_MAX) {
      return {
        ok: false,
        code: ERROR.DATE_002,
        message:
          "لا يُسمح بتاريخ هجري في حقل ميلادي (مثل ends_at). استخدم سنة ميلادية (مثال: 2026).",
        year: rawYear,
        raw: raw,
      };
    }

    var parsed = parse(normalized, { expect: "gregorian" });
    if (!parsed.ok) {
      // datetime-local may still parse via Date for save path
      var ms = Date.parse(normalized);
      if (!Number.isFinite(ms)) {
        return {
          ok: false,
          code: parsed.code || ERROR.DATE_001,
          message: parsed.message || "تاريخ غير صالح.",
          raw: raw,
        };
      }
      var dy = new Date(ms).getFullYear();
      if (dy < GREG_TS_YEAR_MIN || dy > GREG_TS_YEAR_MAX) {
        return {
          ok: false,
          code: ERROR.DATE_003,
          message: "سنة الميلاد/الانتهاء خارج النطاق الميلادي المسموح (1900–2100).",
          year: dy,
          raw: raw,
        };
      }
      if (dy >= HIJRI_YEAR_MIN && dy <= HIJRI_YEAR_MAX) {
        return {
          ok: false,
          code: ERROR.DATE_002,
          message:
            "لا يُسمح بتاريخ هجري في حقل ميلادي (مثل ends_at). استخدم سنة ميلادية (مثال: 2026).",
          year: dy,
          raw: raw,
        };
      }
      return {
        ok: true,
        iso: new Date(ms).toISOString(),
        ms: ms,
        year: dy,
        g: parsed.g || null,
        h: parsed.h || null,
      };
    }

    if (parsed.calendar === "hijri") {
      return {
        ok: false,
        code: ERROR.DATE_002,
        message:
          "لا يُسمح بتاريخ هجري في حقل ميلادي (مثل ends_at). استخدم سنة ميلادية (مثال: 2026).",
        year: parsed.y,
        raw: raw,
      };
    }

    var gYear = parsed.gParts.y;
    if (gYear < GREG_TS_YEAR_MIN || gYear > GREG_TS_YEAR_MAX) {
      return {
        ok: false,
        code: ERROR.DATE_003,
        message: "سنة الميلاد/الانتهاء خارج النطاق الميلادي المسموح (1900–2100).",
        year: gYear,
        raw: raw,
      };
    }

    var iso;
    if (parsed.time) {
      var local = parsed.g + "T" + parsed.time.slice(0, 5);
      var tms = new Date(local).getTime();
      if (!Number.isFinite(tms)) {
        return {
          ok: false,
          code: ERROR.DATE_001,
          message: "وقت الانتهاء غير صالح.",
          raw: raw,
        };
      }
      iso = new Date(tms).toISOString();
    } else {
      // date-only → end of local day for expiry semantics is caller choice;
      // here we store noon UTC-ish via local midnight parse
      var dayMs = new Date(parsed.g + "T00:00").getTime();
      if (!Number.isFinite(dayMs)) {
        return {
          ok: false,
          code: ERROR.DATE_001,
          message: "تاريخ غير صالح.",
          raw: raw,
        };
      }
      iso = new Date(dayMs).toISOString();
    }

    return {
      ok: true,
      iso: iso,
      g: parsed.g,
      h: parsed.h,
      year: gYear,
      raw: raw,
    };
  }

  /**
   * Bind live validation to an input. First consumer: admin poll ends_at.
   */
  function bindLiveValidation(inputEl, options) {
    var opts = options || {};
    if (!inputEl) return function () {};

    var statusEl = opts.statusEl || null;
    var mode = opts.mode || "gregorianTimestamp";

    function run() {
      var value = inputEl.value;
      var result;
      if (mode === "gregorianTimestamp") {
        result = assertGregorianTimestamp(value, { optional: true });
      } else {
        result = validate(value, opts);
        if (result.empty) result = { ok: true, empty: true };
      }

      var msg = "";
      if (result.empty) {
        msg = opts.emptyHint || "";
      } else if (!result.ok) {
        if (result.incomplete) msg = result.message || "أكمل التاريخ…";
        else msg = result.message || "تاريخ غير صالح.";
      } else if (result.h && result.g && mode !== "gregorianTimestamp") {
        msg = "ميلادي: " + result.g + " · هجري: " + result.h;
      } else if (mode === "gregorianTimestamp" && result.year) {
        msg = "تاريخ ميلادي صالح (" + result.year + ").";
      }

      if (statusEl) {
        statusEl.textContent = msg;
        statusEl.style.color = result.ok || result.empty || result.incomplete ? "" : "#991b1b";
      }

      if (typeof opts.onValidate === "function") opts.onValidate(result);
      return result;
    }

    inputEl.addEventListener("input", run);
    inputEl.addEventListener("change", run);
    inputEl.addEventListener("blur", run);
    run();
    return run;
  }

  var api = {
    ERROR: ERROR,
    normalizeDigits: normalizeDigits,
    parse: parse,
    validate: validate,
    convert: convert,
    format: format,
    toSyncedPair: toSyncedPair,
    assertGregorianTimestamp: assertGregorianTimestamp,
    bindLiveValidation: bindLiveValidation,
    /** @deprecated Prefer DateEngine; exposed for migration only */
    _nowForUiOnly: function () {
      return new Date();
    },
  };

  root.AlzidanDateEngine = api;
})(typeof window !== "undefined" ? window : globalThis);
