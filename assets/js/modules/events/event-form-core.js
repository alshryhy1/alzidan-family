(function (root) {
  "use strict";

  var Events = root.AlzidanEvents || {};

  var HAPPY_TYPE_OPTIONS = [
    { value: "birth", label: "مولود جديد" },
    { value: "engagement", label: "خطوبة" },
    { value: "contract", label: "عقد قران" },
    { value: "marriage", label: "زواج" },
    { value: "graduation", label: "تخرج" },
    { value: "success", label: "نجاح / تفوق" },
    { value: "promotion", label: "ترقية / وظيفة" },
    { value: "new_house", label: "منزل جديد" },
    { value: "travel", label: "سفر" },
    { value: "gathering", label: "اجتماع عائلي" },
  ];

  var SICK_TYPE_OPTIONS = [
    { value: "sick", label: "مريض" },
    { value: "operation", label: "عملية" },
    { value: "discharge", label: "خروج من المستشفى" },
  ];

  var VISIBILITY_OPTIONS = [
    { value: "1", label: "يوم" },
    { value: "2", label: "يومان" },
    { value: "3", label: "ثلاثة أيام" },
    { value: "4", label: "أربعة أيام" },
    { value: "5", label: "خمسة أيام" },
    { value: "6", label: "ستة أيام" },
    { value: "7", label: "أسبوع" },
  ];

  function normalizeText(v) {
    return String(v || "").replace(/\s+/g, " ").trim();
  }

  function categoryFromTab(tab) {
    var t = normalizeText(tab);
    if (t === "sick" || t === "death") return t;
    return "happy";
  }

  function buildDelegateFormPayload(category, values) {
    var v = values || {};
    var branch = normalizeText(v.branch);
    var base = {
      source: "delegate_form",
      category: category,
      branch: branch,
      type: normalizeText(v.type),
      person: normalizeText(v.person),
      dateLabel: normalizeText(v.dateLabel),
      eventDate: normalizeText(v.eventDate),
      showDays: Number(v.showDays) > 0 ? Number(v.showDays) : 7,
      createdAt: v.createdAt || new Date().toISOString(),
    };
    if (category === "happy") {
      return Object.assign(base, {
        text: normalizeText(v.text),
        extra: normalizeText(v.extra),
        imageUrl: normalizeText(v.imageUrl),
        videoUrl: normalizeText(v.videoUrl),
      });
    }
    if (category === "sick") {
      return Object.assign(base, {
        place: v.place === "home" ? "home" : "hospital",
        hospitalName: normalizeText(v.hospitalName),
        hospitalDept: normalizeText(v.hospitalDept),
        homeCity: normalizeText(v.homeCity),
        homeArea: normalizeText(v.homeArea),
        contactMethod: normalizeText(v.contactMethod),
        contactPhone: normalizeText(v.contactPhone),
        visitDateFrom: normalizeText(v.visitDateFrom),
        visitDateTo: normalizeText(v.visitDateTo),
        visitTimeFrom: normalizeText(v.visitTimeFrom),
        visitTimeTo: normalizeText(v.visitTimeTo),
        notes: normalizeText(v.notes),
      });
    }
    return Object.assign(base, {
      prayerPlace: normalizeText(v.prayerPlace),
      prayerTime: normalizeText(v.prayerTime),
      burialPlace: normalizeText(v.burialPlace),
      burialTime: normalizeText(v.burialTime),
      condolencePlace: normalizeText(v.condolencePlace),
      condolenceTime: normalizeText(v.condolenceTime),
      phones: Array.isArray(v.phones) ? v.phones : [],
      notes: normalizeText(v.notes),
    });
  }

  function buildRowFromForm(category, values) {
    if (typeof Events.buildFamilyEventRow !== "function") return null;
    return Events.buildFamilyEventRow(buildDelegateFormPayload(category, values));
  }

  root.AlzidanEventFormCore = {
    HAPPY_TYPE_OPTIONS: HAPPY_TYPE_OPTIONS,
    SICK_TYPE_OPTIONS: SICK_TYPE_OPTIONS,
    VISIBILITY_OPTIONS: VISIBILITY_OPTIONS,
    categoryFromTab: categoryFromTab,
    buildDelegateFormPayload: buildDelegateFormPayload,
    buildRowFromForm: buildRowFromForm,
    normalizeText: normalizeText,
  };
})(typeof window !== "undefined" ? window : globalThis);
