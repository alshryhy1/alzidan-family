(function (root) {
  "use strict";

  const TYPE_MAP = {
    birth: "birth",
    marriage: "marriage",
    contract: "marriage",
    engagement: "marriage",
    graduation: "graduation",
    promotion: "promotion",
    gathering: "gathering",
    sick: "sick",
    operation: "operation",
    discharge: "discharge",
    death: "death",
    success: "success",
    new_house: "new_house",
    travel: "travel",
    happy: "happy",
    general: "general",
    other: "other",
    meeting: "gathering",
    مولود: "birth",
    زواج: "marriage",
    "عقد قران": "contract",
    خطوبة: "engagement",
    تخرج: "graduation",
    ترقية: "promotion",
    "ترقية / وظيفة": "promotion",
    اجتماع: "gathering",
    "اجتماع عائلي": "gathering",
    مريض: "sick",
    عملية: "operation",
    وفاة: "death",
    نجاح: "success",
    "منزل جديد": "new_house",
    سفر: "travel",
  };

  const ARABIC_LABELS = {
    birth: "عقيقة مولود",
    marriage: "زواج",
    engagement: "خطوبة",
    contract: "عقد قران",
    graduation: "حفل تخرج",
    promotion: "حفل ترقية",
    success: "نجاح / تفوق",
    new_house: "منزل جديد",
    travel: "سفر",
    gathering: "اجتماع عائلي",
    meeting: "اجتماع عائلي",
    sick: "مريض",
    operation: "عملية",
    discharge: "خروج من المستشفى",
    death: "وفاة",
    general: "مناسبة عامة",
    happy: "فرح",
    other: "أخرى",
  };

  function normalizeText(v) {
    return String(v || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeEventType(raw) {
    const key = normalizeText(raw);
    return TYPE_MAP[key] || "general";
  }

  function eventTypeFromLabel(label) {
    return normalizeEventType(label);
  }

  function eventTypeArabicLabel(type) {
    const raw = normalizeText(type).toLowerCase();
    if (ARABIC_LABELS[raw]) return ARABIC_LABELS[raw];
    const normalized = normalizeEventType(type);
    return ARABIC_LABELS[normalized] || "مناسبة عامة";
  }

  function eventCategoryFromType(type) {
    const t = normalizeEventType(type);
    if (t === "death") return "death";
    if (t === "sick" || t === "operation" || t === "discharge") return "sick";
    return "happy";
  }

  function detailsKindFromCategory(category) {
    if (category === "death") return "death_notice";
    if (category === "sick") return "health_notice";
    return "happy_notice";
  }

  root.AlzidanEvents = root.AlzidanEvents || {};
  Object.assign(root.AlzidanEvents, {
    normalizeEventType,
    eventTypeFromLabel,
    eventTypeArabicLabel,
    eventCategoryFromType,
    detailsKindFromCategory,
  });
})(typeof window !== "undefined" ? window : globalThis);
