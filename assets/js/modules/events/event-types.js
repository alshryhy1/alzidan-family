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
    isBlockedNewEventType: isBlockedNewEventType,
    isSelectableEventType: isSelectableEventType,
    getEventTypeDef: getEventTypeDef,
    listEventTypesByFamily: listEventTypesByFamily,
    listNewsAndOccasionTypes: listNewsAndOccasionTypes,
    listHealthTypes: listHealthTypes,
    listDeathTypes: listDeathTypes,
    tickerKindForType: tickerKindForType,
    personLabelForType: personLabelForType,
  });
})(typeof window !== "undefined" ? window : globalThis);
