(function (root) {
  "use strict";

  var Events = root.AlzidanEvents || {};

  function catalogOptions(list) {
    return (list || []).map(function (def) {
      return { value: def.key, label: def.label, family: def.family };
    });
  }

  function newsAndOccasionOptions() {
    if (typeof Events.listNewsAndOccasionTypes === "function") {
      return catalogOptions(Events.listNewsAndOccasionTypes());
    }
    return [];
  }

  function healthOptions() {
    if (typeof Events.listHealthTypes === "function") {
      return catalogOptions(Events.listHealthTypes());
    }
    return [
      { value: "sick", label: "مريض" },
      { value: "operation", label: "عملية" },
      { value: "healing", label: "شفاء" },
      { value: "discharge", label: "خروج من المستشفى" },
      { value: "safety", label: "سلامة" },
    ];
  }

  function deathOptions() {
    if (typeof Events.listDeathTypes === "function") {
      return catalogOptions(Events.listDeathTypes());
    }
    return [
      { value: "death", label: "إعلان وفاة" },
      { value: "condolence", label: "تعزية" },
    ];
  }

  function familyOptions() {
    return (Events.EVENT_FAMILIES || []).map(function (f) {
      return { value: f.key, label: f.label };
    });
  }

  // Backward-compatible aliases used by older panels.
  var HAPPY_TYPE_OPTIONS = newsAndOccasionOptions();
  var SICK_TYPE_OPTIONS = healthOptions();
  var DEATH_TYPE_OPTIONS = deathOptions();

  var VISIBILITY_OPTIONS = [
    { value: "1", label: "يوم" },
    { value: "2", label: "يومان" },
    { value: "3", label: "ثلاثة أيام" },
    { value: "4", label: "أربعة أيام" },
    { value: "5", label: "خمسة أيام" },
    { value: "6", label: "ستة أيام" },
    { value: "7", label: "أسبوع" },
  ];

  var SHOW_BEFORE_OPTIONS = [
    { value: "1", label: "قبل يوم" },
    { value: "2", label: "قبل يومين" },
    { value: "3", label: "قبل 3 أيام" },
    { value: "5", label: "قبل 5 أيام" },
    { value: "7", label: "قبل أسبوع" },
  ];

  var BLOCKED_NEW_EVENT_TYPES =
    Events.BLOCKED_NEW_EVENT_TYPES || { engagement: true, خطوبة: true };

  function normalizeText(v) {
    return String(v || "").replace(/\s+/g, " ").trim();
  }

  function isBlockedNewEventType(type) {
    if (typeof Events.isBlockedNewEventType === "function") {
      return Events.isBlockedNewEventType(type);
    }
    var key = normalizeText(type);
    if (!key) return false;
    if (BLOCKED_NEW_EVENT_TYPES[key]) return true;
    return !!BLOCKED_NEW_EVENT_TYPES[key.toLowerCase()];
  }

  function isAllowedCatalogType(type) {
    if (typeof Events.isSelectableEventType === "function") {
      return Events.isSelectableEventType(type);
    }
    return !isBlockedNewEventType(type);
  }

  function isAllowedHappyType(type) {
    return isAllowedCatalogType(type);
  }

  function isAllowedSickType(type) {
    var key =
      typeof Events.normalizeEventType === "function"
        ? Events.normalizeEventType(type)
        : normalizeText(type);
    var family =
      typeof Events.eventFamilyFromType === "function"
        ? Events.eventFamilyFromType(key)
        : "";
    return family === "health" && isAllowedCatalogType(key);
  }

  function fillSelectOptions(selectEl, options, opts) {
    if (!selectEl) return;
    var selected = opts && opts.selected != null ? String(opts.selected) : "";
    var placeholder =
      opts && opts.placeholder ? String(opts.placeholder) : "اختر النوع";
    var html =
      '<option value="">' +
      placeholder.replace(/</g, "&lt;").replace(/>/g, "&gt;") +
      "</option>";
    (options || []).forEach(function (opt) {
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

  function fillHappyTypeSelect(selectEl, opts) {
    fillSelectOptions(selectEl, newsAndOccasionOptions(), opts);
  }

  function fillFamilySelect(selectEl, opts) {
    fillSelectOptions(
      selectEl,
      familyOptions(),
      Object.assign({ placeholder: "ماذا تريد نشره؟" }, opts || {}),
    );
  }

  function fillTypeSelectForFamily(selectEl, family, opts) {
    var list = [];
    if (typeof Events.listEventTypesByFamily === "function") {
      list = catalogOptions(Events.listEventTypesByFamily(family));
    }
    fillSelectOptions(
      selectEl,
      list,
      Object.assign({ placeholder: "اختر النوع" }, opts || {}),
    );
  }

  function categoryFromTab(tab) {
    var t = normalizeText(tab);
    if (t === "sick" || t === "health" || t === "death") {
      return t === "health" ? "sick" : t;
    }
    if (t === "news" || t === "occasion" || t === "happy") return "happy";
    return "happy";
  }

  function buildDelegateFormPayload(category, values) {
    var v = values || {};
    var branch = normalizeText(v.branch);
    var type = normalizeText(v.type);
    if (type && !isAllowedCatalogType(type)) {
      throw new Error("نوع غير مسموح. اختر نوعًا من القائمة.");
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
        place: normalizeText(v.place),
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
    DEATH_TYPE_OPTIONS: DEATH_TYPE_OPTIONS,
    VISIBILITY_OPTIONS: VISIBILITY_OPTIONS,
    SHOW_BEFORE_OPTIONS: SHOW_BEFORE_OPTIONS,
    BLOCKED_NEW_EVENT_TYPES: BLOCKED_NEW_EVENT_TYPES,
    isBlockedNewEventType: isBlockedNewEventType,
    isAllowedHappyType: isAllowedHappyType,
    isAllowedSickType: isAllowedSickType,
    isAllowedCatalogType: isAllowedCatalogType,
    fillHappyTypeSelect: fillHappyTypeSelect,
    fillFamilySelect: fillFamilySelect,
    fillTypeSelectForFamily: fillTypeSelectForFamily,
    fillSelectOptions: fillSelectOptions,
    newsAndOccasionOptions: newsAndOccasionOptions,
    healthOptions: healthOptions,
    deathOptions: deathOptions,
    familyOptions: familyOptions,
    categoryFromTab: categoryFromTab,
    buildDelegateFormPayload: buildDelegateFormPayload,
    buildRowFromForm: buildRowFromForm,
    normalizeText: normalizeText,
  };
})(typeof window !== "undefined" ? window : globalThis);
