/**
 * Canonical event-type catalog (shared across homepage, admin, delegates).
 * No Supabase table — code is the source of truth for selectable types.
 *
 * Families:
 *   news      — تهاني وأخبار (no required date/place)
 *   health    — صحة وعافية (no required date/place)
 *   death     — وفاة وتعزية (no required date/place)
 *   occasion  — مناسبات ودعوات (date required; time/place per type)
 */
(function (root) {
  "use strict";

  var EVENT_FAMILIES = [
    { key: "news", label: "تهاني وأخبار", legacyCategory: "happy" },
    { key: "health", label: "صحة وعافية", legacyCategory: "sick" },
    { key: "death", label: "وفاة وتعزية", legacyCategory: "death" },
    { key: "occasion", label: "مناسبات ودعوات", legacyCategory: "happy" },
  ];

  /**
   * @typedef {{
   *   key: string,
   *   label: string,
   *   family: 'news'|'health'|'death'|'occasion',
   *   requiresDate?: boolean,
   *   requiresTime?: boolean,
   *   requiresPlace?: boolean,
   *   requiresPlaceKind?: boolean,
   *   personLabel?: string,
   *   tickerKind?: 'congrats'|'health'|'death'|'upcoming'
   * }} EventTypeDef
   */

  /** @type {EventTypeDef[]} */
  var EVENT_TYPE_CATALOG = [
    // —— تهاني وأخبار ——
    { key: "promotion_notice", label: "ترقية", family: "news", personLabel: "اسم المُهنَّأ", tickerKind: "congrats" },
    { key: "graduation_notice", label: "تخرج", family: "news", personLabel: "اسم الخريج", tickerKind: "congrats" },
    { key: "success", label: "نجاح", family: "news", personLabel: "اسم المُهنَّأ", tickerKind: "congrats" },
    { key: "marriage", label: "زواج", family: "news", personLabel: "اسم العريس/العروسين", tickerKind: "congrats" },
    { key: "birth", label: "مولود جديد", family: "news", personLabel: "اسم المولود أو الأب", tickerKind: "congrats" },
    { key: "achievement", label: "تكريم وإنجاز", family: "news", personLabel: "اسم صاحب الإنجاز", tickerKind: "congrats" },
    { key: "appointment", label: "تعيين / منصب", family: "news", personLabel: "اسم المعيَّن", tickerKind: "congrats" },
    { key: "retirement_notice", label: "تقاعد", family: "news", personLabel: "اسم المتقاعد", tickerKind: "congrats" },
    { key: "certification", label: "شهادة / اعتماد", family: "news", personLabel: "اسم الحاصل على الشهادة", tickerKind: "congrats" },
    { key: "new_house", label: "منزل جديد", family: "news", personLabel: "اسم صاحب المنزل", tickerKind: "congrats" },
    { key: "family_news", label: "خبر عائلي", family: "news", personLabel: "الاسم المرتبط بالخبر", tickerKind: "congrats" },

    // —— صحة وعافية ——
    { key: "sick", label: "مريض", family: "health", personLabel: "اسم المريض", tickerKind: "health" },
    { key: "operation", label: "عملية", family: "health", personLabel: "اسم المريض", tickerKind: "health" },
    { key: "healing", label: "شفاء", family: "health", personLabel: "اسم المتعافي", tickerKind: "health" },
    { key: "discharge", label: "خروج من المستشفى", family: "health", personLabel: "اسم المريض", tickerKind: "health" },
    { key: "safety", label: "سلامة", family: "health", personLabel: "اسم الشخص", tickerKind: "health" },

    // —— وفاة وتعزية ——
    { key: "death", label: "إعلان وفاة", family: "death", personLabel: "اسم المتوفى", tickerKind: "death" },
    { key: "condolence", label: "تعزية", family: "death", personLabel: "اسم المتوفى / أهل الفقيد", tickerKind: "death" },

    // —— مناسبات ودعوات ——
    { key: "wedding", label: "حفل زواج", family: "occasion", requiresDate: true, requiresTime: true, requiresPlace: true, personLabel: "اسم العريس", tickerKind: "upcoming" },
    { key: "contract", label: "عقد قران", family: "occasion", requiresDate: true, requiresTime: false, requiresPlace: true, personLabel: "اسم العريس", tickerKind: "upcoming" },
    { key: "graduation", label: "حفل تخرج", family: "occasion", requiresDate: true, requiresTime: false, requiresPlace: false, personLabel: "اسم الخريج", tickerKind: "upcoming" },
    { key: "aqiqa", label: "عقيقة", family: "occasion", requiresDate: true, requiresTime: false, requiresPlace: false, personLabel: "اسم المولود / الأب", tickerKind: "upcoming" },
    { key: "feast", label: "وليمة", family: "occasion", requiresDate: true, requiresTime: true, requiresPlace: false, personLabel: "اسم الداعي", tickerKind: "upcoming" },
    { key: "gathering", label: "اجتماع عائلي", family: "occasion", requiresDate: true, requiresTime: true, requiresPlace: false, personLabel: "اسم الداعي", tickerKind: "upcoming" },
    { key: "family_meetup", label: "لقاء عائلي", family: "occasion", requiresDate: true, requiresTime: true, requiresPlace: false, personLabel: "اسم الداعي", tickerKind: "upcoming" },
    { key: "promotion", label: "حفل ترقية", family: "occasion", requiresDate: true, requiresTime: false, requiresPlace: true, personLabel: "اسم صاحب الحفل", tickerKind: "upcoming" },
    { key: "retirement", label: "حفل تقاعد", family: "occasion", requiresDate: true, requiresTime: false, requiresPlace: false, personLabel: "اسم المتقاعد", tickerKind: "upcoming" },
    { key: "dinner", label: "دعوة عشاء", family: "occasion", requiresDate: true, requiresTime: true, requiresPlace: false, personLabel: "اسم الداعي", tickerKind: "upcoming" },
    { key: "lunch", label: "دعوة غداء", family: "occasion", requiresDate: true, requiresTime: true, requiresPlace: false, personLabel: "اسم الداعي", tickerKind: "upcoming" },
    { key: "finjal_asr", label: "فنجال بعد صلاة العصر", family: "occasion", requiresDate: true, requiresTime: false, requiresPlace: false, personLabel: "اسم الداعي", tickerKind: "upcoming" },
    { key: "finjal_isha", label: "فنجال بعد صلاة العشاء", family: "occasion", requiresDate: true, requiresTime: false, requiresPlace: false, personLabel: "اسم الداعي", tickerKind: "upcoming" },
    { key: "finjal_hawlna", label: "فنجال والم اللي حولنا", family: "occasion", requiresDate: true, requiresTime: true, requiresPlace: false, personLabel: "اسم الداعي", tickerKind: "upcoming" },
    { key: "general", label: "مناسبة عامة", family: "occasion", requiresDate: true, requiresTime: false, requiresPlace: false, personLabel: "اسم صاحب المناسبة", tickerKind: "upcoming" },
  ];

  var TYPE_BY_KEY = {};
  EVENT_TYPE_CATALOG.forEach(function (def) {
    TYPE_BY_KEY[def.key] = def;
  });

  /** Legacy / Arabic aliases → catalog key (display + normalize). */
  var TYPE_MAP = {
    birth: "birth",
    marriage: "marriage",
    wedding: "wedding",
    contract: "contract",
    engagement: "marriage",
    graduation: "graduation",
    graduation_notice: "graduation_notice",
    promotion: "promotion",
    promotion_notice: "promotion_notice",
    congratulation: "family_news",
    family_news: "family_news",
    invitation: "dinner",
    gathering: "gathering",
    family_meetup: "family_meetup",
    meeting: "gathering",
    sick: "sick",
    operation: "operation",
    healing: "healing",
    discharge: "discharge",
    safety: "safety",
    death: "death",
    condolence: "condolence",
    success: "success",
    achievement: "achievement",
    appointment: "appointment",
    retirement_notice: "retirement_notice",
    retirement: "retirement",
    certification: "certification",
    new_house: "new_house",
    travel: "family_news",
    aqiqa: "aqiqa",
    feast: "feast",
    dinner: "dinner",
    lunch: "lunch",
    finjal_asr: "finjal_asr",
    finjal_isha: "finjal_isha",
    finjal_hawlna: "finjal_hawlna",
    happy: "family_news",
    general: "general",
    other: "general",
    مولود: "birth",
    "مولود جديد": "birth",
    زواج: "marriage",
    "حفل زواج": "wedding",
    "عقد قران": "contract",
    خطوبة: "marriage",
    تخرج: "graduation_notice",
    "حفل تخرج": "graduation",
    ترقية: "promotion_notice",
    "ترقية / وظيفة": "promotion_notice",
    "حفل ترقية": "promotion",
    "تهنئة ترقية": "promotion_notice",
    "ترقية مباركة": "promotion_notice",
    تهنئة: "family_news",
    "تهنئة عائلية": "family_news",
    "خبر عائلي": "family_news",
    دعوة: "dinner",
    "دعوة عائلية": "dinner",
    "دعوة عشاء": "dinner",
    "دعوة غداء": "lunch",
    اجتماع: "gathering",
    "اجتماع عائلي": "gathering",
    "لقاء عائلي": "family_meetup",
    مريض: "sick",
    عملية: "operation",
    شفاء: "healing",
    "خروج من المستشفى": "discharge",
    "خروج من المستشفي": "discharge",
    خروج: "discharge",
    سلامة: "safety",
    وفاة: "death",
    "إعلان وفاة": "death",
    تعزية: "condolence",
    نجاح: "success",
    تكريم: "achievement",
    إنجاز: "achievement",
    "تكريم وإنجاز": "achievement",
    تعيين: "appointment",
    منصب: "appointment",
    تقاعد: "retirement_notice",
    "حفل تقاعد": "retirement",
    شهادة: "certification",
    اعتماد: "certification",
    "منزل جديد": "new_house",
    سفر: "family_news",
    عقيقة: "aqiqa",
    وليمة: "feast",
    "فنجال بعد صلاة العصر": "finjal_asr",
    "فنجال العصر": "finjal_asr",
    "فنجال بعد صلاة العشاء": "finjal_isha",
    "فنجال العشاء": "finjal_isha",
    "فنجال والم اللي حولنا": "finjal_hawlna",
    "فنجال والم الي حولنا": "finjal_hawlna",
    "مناسبة عامة": "general",
  };

  var ARABIC_LABELS = {};
  EVENT_TYPE_CATALOG.forEach(function (def) {
    ARABIC_LABELS[def.key] = def.label;
  });
  // Legacy display-only labels
  ARABIC_LABELS.engagement = "خطوبة";
  ARABIC_LABELS.congratulation = "خبر عائلي";
  ARABIC_LABELS.invitation = "دعوة عشاء";
  ARABIC_LABELS.travel = "خبر عائلي";
  ARABIC_LABELS.happy = "خبر عائلي";
  ARABIC_LABELS.other = "مناسبة عامة";
  ARABIC_LABELS.meeting = "اجتماع عائلي";

  var BLOCKED_NEW_EVENT_TYPES = {
    engagement: true,
    خطوبة: true,
  };

  function normalizeText(v) {
    return String(v || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getEventTypeDef(type) {
    var key = normalizeEventType(type);
    return TYPE_BY_KEY[key] || null;
  }

  function normalizeEventType(raw) {
    var key = normalizeText(raw);
    if (!key) return "general";
    if (TYPE_MAP[key]) return TYPE_MAP[key];
    var lower = key.toLowerCase();
    if (TYPE_MAP[lower]) return TYPE_MAP[lower];
    if (TYPE_BY_KEY[key]) return key;
    if (TYPE_BY_KEY[lower]) return lower;
    return "general";
  }

  function eventTypeFromLabel(label) {
    return normalizeEventType(label);
  }

  function eventTypeArabicLabel(type) {
    var raw = normalizeText(type).toLowerCase();
    if (ARABIC_LABELS[raw]) return ARABIC_LABELS[raw];
    var normalized = normalizeEventType(type);
    return ARABIC_LABELS[normalized] || "مناسبة عامة";
  }

  function eventFamilyFromType(type) {
    var def = getEventTypeDef(type);
    if (def) return def.family;
    var t = normalizeEventType(type);
    if (t === "death" || t === "condolence") return "death";
    if (
      t === "sick" ||
      t === "operation" ||
      t === "discharge" ||
      t === "healing" ||
      t === "safety"
    ) {
      return "health";
    }
    if (TYPE_BY_KEY[t] && TYPE_BY_KEY[t].family === "occasion") return "occasion";
    return "news";
  }

  /** Legacy UI buckets: happy | sick | death */
  function eventCategoryFromType(type) {
    var family = eventFamilyFromType(type);
    if (family === "death") return "death";
    if (family === "health") return "sick";
    return "happy";
  }

  function isNoticeEventType(type) {
    return eventFamilyFromType(type) !== "occasion";
  }

  function eventRequiresDate(type) {
    var def = getEventTypeDef(type);
    if (def) return !!def.requiresDate;
    return eventFamilyFromType(type) === "occasion";
  }

  function eventRequiresTime(type) {
    var def = getEventTypeDef(type);
    return !!(def && def.requiresTime);
  }

  function eventRequiresPlace(type) {
    var def = getEventTypeDef(type);
    return !!(def && def.requiresPlace);
  }

  function eventRequiresPlaceKind(type) {
    var def = getEventTypeDef(type);
    return !!(def && def.requiresPlaceKind);
  }

  var EVENT_PLACE_KINDS = [
    { key: "home", label: "بالمنزل" },
    { key: "farm", label: "بالمزرعة" },
    { key: "desert", label: "بالبر" },
    { key: "resthouse", label: "بالاستراحة" },
  ];

  var PLACE_KIND_BY_KEY = {};
  EVENT_PLACE_KINDS.forEach(function (item) {
    PLACE_KIND_BY_KEY[item.key] = item;
  });

  var PLACE_KIND_ALIASES = {
    home: "home",
    بالمنزل: "home",
    المنزل: "home",
    منزل: "home",
    farm: "farm",
    بالمزرعة: "farm",
    المزرعة: "farm",
    مزرعة: "farm",
    desert: "desert",
    بالبر: "desert",
    البر: "desert",
    بر: "desert",
    resthouse: "resthouse",
    بالاستراحة: "resthouse",
    الاستراحة: "resthouse",
    استراحة: "resthouse",
  };

  function normalizePlaceKind(raw) {
    var key = normalizeText(raw);
    if (!key) return "";
    if (PLACE_KIND_BY_KEY[key]) return key;
    if (PLACE_KIND_ALIASES[key]) return PLACE_KIND_ALIASES[key];
    var lower = key.toLowerCase();
    if (PLACE_KIND_BY_KEY[lower]) return lower;
    if (PLACE_KIND_ALIASES[lower]) return PLACE_KIND_ALIASES[lower];
    return "";
  }

  function placeKindArabicLabel(kind) {
    var key = normalizePlaceKind(kind);
    return (PLACE_KIND_BY_KEY[key] && PLACE_KIND_BY_KEY[key].label) || "";
  }

  function toFiniteCoord(v, min, max) {
    var n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) return null;
    return Math.round(n * 1e6) / 1e6;
  }

  function coordsPair(lat, lng) {
    var a = toFiniteCoord(lat, -90, 90);
    var b = toFiniteCoord(lng, -180, 180);
    if (a == null || b == null) return null;
    return { lat: a, lng: b };
  }

  function parseCoordinates(raw) {
    var s = normalizeText(raw)
      .replace(/[٠-٩]/g, function (d) {
        return String("٠١٢٣٤٥٦٧٨٩".indexOf(d));
      })
      .replace(/[۰-۹]/g, function (d) {
        return String("۰۱۲۳۴۵۶۷۸۹".indexOf(d));
      });
    if (!s) return null;
    var m =
      s.match(/@(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/) ||
      s.match(/[?&](?:q|query|ll)=(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i) ||
      s.match(/geo:(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i) ||
      s.match(/^(-?\d+(?:\.\d+)?)\s*[,،]\s*(-?\d+(?:\.\d+)?)$/);
    if (!m) return null;
    return coordsPair(m[1], m[2]);
  }

  function mapsUrlFromCoords(lat, lng) {
    var pair = coordsPair(lat, lng);
    if (!pair) return "";
    return "https://maps.google.com/?q=" + pair.lat + "," + pair.lng;
  }

  function formatVenueLine(input) {
    var src = input && typeof input === "object" ? input : {};
    var kindLabel = placeKindArabicLabel(src.placeKind || src.place_kind);
    var extra = normalizeText(src.extra || src.place || src.placeName || src.place_name);
    var parts = [];
    if (kindLabel) parts.push(kindLabel);
    if (extra) parts.push(extra);
    return parts.join(" — ");
  }

  function venueFromDetails(details) {
    var src = details && typeof details === "object" ? details : {};
    var kind = normalizePlaceKind(src.place_kind || src.placeKind);
    var extra = normalizeText(src.extra || src.place || src.placeName || src.place_name);
    var pair =
      coordsPair(src.lat, src.lng) ||
      parseCoordinates(src.coords || src.coordinates || src.maps_url || src.mapsUrl || "");
    return {
      placeKind: kind,
      extra: extra,
      lat: pair ? pair.lat : null,
      lng: pair ? pair.lng : null,
    };
  }

  function isBlockedNewEventType(type) {
    var key = normalizeText(type);
    if (!key) return false;
    if (BLOCKED_NEW_EVENT_TYPES[key]) return true;
    return !!BLOCKED_NEW_EVENT_TYPES[key.toLowerCase()];
  }

  function isSelectableEventType(type) {
    var key = normalizeEventType(type);
    if (isBlockedNewEventType(type) || isBlockedNewEventType(key)) return false;
    return !!TYPE_BY_KEY[key];
  }

  function listEventTypesByFamily(family) {
    var f = normalizeText(family);
    return EVENT_TYPE_CATALOG.filter(function (def) {
      return def.family === f;
    });
  }

  function listNewsAndOccasionTypes() {
    return EVENT_TYPE_CATALOG.filter(function (def) {
      return def.family === "news" || def.family === "occasion";
    });
  }

  function listHealthTypes() {
    return listEventTypesByFamily("health");
  }

  function listDeathTypes() {
    return listEventTypesByFamily("death");
  }

  function tickerKindForType(type) {
    var def = getEventTypeDef(type);
    if (def && def.tickerKind) return def.tickerKind;
    var family = eventFamilyFromType(type);
    if (family === "death") return "death";
    if (family === "health") return "health";
    if (family === "occasion") return "upcoming";
    return "congrats";
  }

  function detailsKindFromCategory(category) {
    if (category === "death") return "death_notice";
    if (category === "sick" || category === "health") return "health_notice";
    return "happy_notice";
  }

  function personLabelForType(type) {
    var def = getEventTypeDef(type);
    return (def && def.personLabel) || "الاسم";
  }

  function eventRequestKindLabel(type) {
    var family = eventFamilyFromType(type);
    if (family === "news") return "تهنئة / خبر";
    if (family === "health") return "خبر صحي";
    if (family === "death") return "إعلان وفاة";
    return "بطاقة مناسبة";
  }

  function incidentDateFieldLabel(type) {
    var key = normalizeEventType(type);
    if (key === "birth") return "تاريخ الولادة";
    var family = eventFamilyFromType(type);
    if (family === "news") return "تاريخ الخبر";
    if (family === "health") return "تاريخ الحالة";
    if (family === "death") return "تاريخ الوفاة";
    return "تاريخ المناسبة";
  }

  function foldCatalogDigits(s) {
    return String(s || "")
      .replace(/[٠-٩]/g, function (d) {
        return String("٠١٢٣٤٥٦٧٨٩".indexOf(d));
      })
      .replace(/[۰-۹]/g, function (d) {
        return String("۰۱۲۳۴۵۶۷۸۹".indexOf(d));
      });
  }

  function parseGregorianDayMs(value) {
    var s = foldCatalogDigits(value)
      .replace(/[.\s]+/g, "/")
      .trim();
    if (!s) return null;
    var y = 0;
    var m = 0;
    var d = 0;
    var mm = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (mm) {
      y = parseInt(mm[1], 10);
      m = parseInt(mm[2], 10);
      d = parseInt(mm[3], 10);
    } else {
      mm = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
      if (!mm) return null;
      d = parseInt(mm[1], 10);
      m = parseInt(mm[2], 10);
      y = parseInt(mm[3], 10);
    }
    if (!y || y < 1800 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
    var dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
    return dt.getTime();
  }

  /**
   * News/health incident dates are optional facts, not party days.
   * Hide dates years away from publish (e.g. 2022-06-25 on an Aug 2026 newborn notice).
   */
  function newsIncidentDateIsPlausible(dateValue, createdAt, maxDaysBefore) {
    var day = parseGregorianDayMs(dateValue);
    if (day == null) return false;
    var createdMs = createdAt ? Date.parse(String(createdAt)) : Date.now();
    if (!Number.isFinite(createdMs)) createdMs = Date.now();
    var created = new Date(createdMs);
    var createdDay = new Date(created.getFullYear(), created.getMonth(), created.getDate()).getTime();
    var diffDays = Math.round((createdDay - day) / 86400000);
    var maxBefore = maxDaysBefore == null ? 30 : Number(maxDaysBefore);
    if (!Number.isFinite(maxBefore) || maxBefore < 1) maxBefore = 30;
    return diffDays >= -1 && diffDays <= maxBefore;
  }

  function eventTextIsTypeEcho(type, text) {
    var t = String(text || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!t) return true;
    var key = normalizeEventType(type);
    var label = eventTypeArabicLabel(key);
    function compact(s) {
      return String(s || "")
        .replace(/\s+/g, " ")
        .trim();
    }
    if (compact(t) === compact(label) || compact(t) === compact(key) || compact(t) === compact(type)) {
      return true;
    }
    var def = getEventTypeDef(key);
    if (def && compact(t) === compact(def.label)) return true;
    return false;
  }

  root.AlzidanEvents = root.AlzidanEvents || {};
  Object.assign(root.AlzidanEvents, {
    EVENT_FAMILIES: EVENT_FAMILIES,
    EVENT_TYPE_CATALOG: EVENT_TYPE_CATALOG,
    BLOCKED_NEW_EVENT_TYPES: BLOCKED_NEW_EVENT_TYPES,
    normalizeEventType: normalizeEventType,
    eventTypeFromLabel: eventTypeFromLabel,
    eventTypeArabicLabel: eventTypeArabicLabel,
    eventFamilyFromType: eventFamilyFromType,
    eventCategoryFromType: eventCategoryFromType,
    detailsKindFromCategory: detailsKindFromCategory,
    isNoticeEventType: isNoticeEventType,
    eventRequiresDate: eventRequiresDate,
    eventRequiresTime: eventRequiresTime,
    eventRequiresPlace: eventRequiresPlace,
    eventRequiresPlaceKind: eventRequiresPlaceKind,
    EVENT_PLACE_KINDS: EVENT_PLACE_KINDS,
    normalizePlaceKind: normalizePlaceKind,
    placeKindArabicLabel: placeKindArabicLabel,
    parseCoordinates: parseCoordinates,
    mapsUrlFromCoords: mapsUrlFromCoords,
    formatVenueLine: formatVenueLine,
    venueFromDetails: venueFromDetails,
    isBlockedNewEventType: isBlockedNewEventType,
    isSelectableEventType: isSelectableEventType,
    getEventTypeDef: getEventTypeDef,
    listEventTypesByFamily: listEventTypesByFamily,
    listNewsAndOccasionTypes: listNewsAndOccasionTypes,
    listHealthTypes: listHealthTypes,
    listDeathTypes: listDeathTypes,
    tickerKindForType: tickerKindForType,
    personLabelForType: personLabelForType,
    eventRequestKindLabel: eventRequestKindLabel,
    incidentDateFieldLabel: incidentDateFieldLabel,
    newsIncidentDateIsPlausible: newsIncidentDateIsPlausible,
    eventTextIsTypeEcho: eventTextIsTypeEcho,
  });
})(typeof window !== "undefined" ? window : globalThis);
