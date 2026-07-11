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
    success: "general",
    new_house: "general",
    happy: "general",
    general: "general",
    مولود: "birth",
    زواج: "marriage",
    "عقد قران": "marriage",
    خطوبة: "marriage",
    تخرج: "graduation",
    ترقية: "promotion",
    "ترقية / وظيفة": "promotion",
    اجتماع: "gathering",
    "اجتماع عائلي": "gathering",
    مريض: "sick",
    عملية: "operation",
    وفاة: "death",
    نجاح: "general",
    "منزل جديد": "general",
  };

  const ARABIC_LABELS = {
    birth: "مولود",
    marriage: "زواج",
    graduation: "تخرج",
    promotion: "ترقية",
    gathering: "اجتماع",
    sick: "مريض",
    operation: "عملية",
    discharge: "خروج",
    death: "وفاة",
    general: "مناسبة عامة",
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
    return ARABIC_LABELS[normalizeEventType(type)] || "مناسبة عامة";
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
