(function (root) {
  "use strict";

  var Events = root.AlzidanEvents || {};

  // Shared selectable catalog for homepage + delegate (and any consumer).
  // Legacy DB rows may still use "engagement"/خطوبة for display only — do not add them here.
  var HAPPY_TYPE_OPTIONS = [
    { value: "birth", label: "مولود جديد" },
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

  /** أيام الظهور قبل تاريخ المناسبة (افتراضي 3). */
  var SHOW_BEFORE_OPTIONS = [
    { value: "1", label: "قبل يوم" },
    { value: "2", label: "قبل يومين" },
    { value: "3", label: "قبل 3 أيام" },
    { value: "5", label: "قبل 5 أيام" },
    { value: "7", label: "قبل أسبوع" },
  ];

  var BLOCKED_NEW_EVENT_TYPES = {
    engagement: true,
    خطوبة: true,
  };

  var ALLOWED_HAPPY_TYPE_VALUES = HAPPY_TYPE_OPTIONS.reduce(function (acc, opt) {
    if (opt && opt.value) acc[String(opt.value)] = true;
    return acc;
  }, {});

  var ALLOWED_SICK_TYPE_VALUES = SICK_TYPE_OPTIONS.reduce(function (acc, opt) {
    if (opt && opt.value) acc[String(opt.value)] = true;
    return acc;
  }, {});

  function normalizeText(v) {
    return String(v || "").replace(/\s+/g, " ").trim();
  }

  function isBlockedNewEventType(type) {
    var key = normalizeText(type);
    if (!key) return false;
    if (BLOCKED_NEW_EVENT_TYPES[key]) return true;
    var lower = key.toLowerCase();
    return !!BLOCKED_NEW_EVENT_TYPES[lower];
  }

  function isAllowedHappyType(type) {
    var key = normalizeText(type);
    if (!key || isBlockedNewEventType(key)) return false;
    return !!ALLOWED_HAPPY_TYPE_VALUES[key];
  }

  function isAllowedSickType(type) {
    var key = normalizeText(type);
    if (!key) return false;
    return !!ALLOWED_SICK_TYPE_VALUES[key];
  }

  function fillHappyTypeSelect(selectEl, opts) {
    if (!selectEl) return;
    var selected = opts && opts.selected != null ? String(opts.selected) : "";
    var placeholder =
      opts && opts.placeholder
        ? String(opts.placeholder)
        : "اختر نوع المناسبة";
    var html =
      '<option value="">' +
      placeholder.replace(/</g, "&lt;").replace(/>/g, "&gt;") +
      "</option>";
    HAPPY_TYPE_OPTIONS.forEach(function (opt) {
      var value = String(opt.value || "");
      var label = String(opt.label || value);
      var sel = value && value === selected ? " selected" : "";
      html +=
        '<option value="' +
        value.replace(/"/g, "&quot;") +
        '"' +
        sel +
        ">" +
        label.replace(/</g, "&lt;").replace(/>/g, "&gt;") +
        "</option>";
    });
    selectEl.innerHTML = html;
  }

  function categoryFromTab(tab) {
    var t = normalizeText(tab);
    if (t === "sick" || t === "death") return t;
    return "happy";
  }

  function buildDelegateFormPayload(category, values) {
    var v = values || {};
    var branch = normalizeText(v.branch);
    var type = normalizeText(v.type);
    if (category === "happy" && type && !isAllowedHappyType(type)) {
      throw new Error("نوع المناسبة غير مسموح. اختر نوعًا من القائمة.");
    }
    if (category === "sick" && type && !isAllowedSickType(type)) {
      throw new Error("نوع الحالة غير مسموح. اختر نوعًا من القائمة.");
    }
    var base = {
      source: "delegate_form",
      category: category,
      branch: branch,
      type: type,
      person: normalizeText(v.person),
      dateLabel: normalizeText(v.dateLabel),
      eventDate: normalizeText(v.eventDate),
      showDays: Number(v.showDays) > 0 ? Number(v.showDays) : 7,
      showBeforeDays:
        Number(v.showBeforeDays) > 0
          ? Number(v.showBeforeDays)
          : Number(v.show_before_days) > 0
            ? Number(v.show_before_days)
            : 3,
      showAt: normalizeText(v.showAt || v.show_at || ""),
      endAt: normalizeText(v.endAt || v.end_at || ""),
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
    try {
      return Events.buildFamilyEventRow(buildDelegateFormPayload(category, values));
    } catch (err) {
      return null;
    }
  }

  root.AlzidanEventFormCore = {
    HAPPY_TYPE_OPTIONS: HAPPY_TYPE_OPTIONS,
    SICK_TYPE_OPTIONS: SICK_TYPE_OPTIONS,
    VISIBILITY_OPTIONS: VISIBILITY_OPTIONS,
    SHOW_BEFORE_OPTIONS: SHOW_BEFORE_OPTIONS,
    BLOCKED_NEW_EVENT_TYPES: BLOCKED_NEW_EVENT_TYPES,
    isBlockedNewEventType: isBlockedNewEventType,
    isAllowedHappyType: isAllowedHappyType,
    isAllowedSickType: isAllowedSickType,
    fillHappyTypeSelect: fillHappyTypeSelect,
    categoryFromTab: categoryFromTab,
    buildDelegateFormPayload: buildDelegateFormPayload,
    buildRowFromForm: buildRowFromForm,
    normalizeText: normalizeText,
  };
})(typeof window !== "undefined" ? window : globalThis);
