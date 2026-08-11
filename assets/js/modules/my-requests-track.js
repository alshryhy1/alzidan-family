/**
 * Shared local mirror for home «طلباتي» (request-experience).
 * Key: alzidan_rx_my_requests_v1 — أضف فردًا · تصحيح · مناسبة · ذكرى · بطاقة · مرضى · وفاة.
 * Global: window.AlzidanRxMyRequests
 */
(function (global) {
  "use strict";

  var TRACK_KEY = "alzidan_rx_my_requests_v1";
  var MAX_ENTRIES = 20;
  var listeners = [];

  function text(v) {
    return String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  }

  function read() {
    try {
      var raw = global.localStorage && global.localStorage.getItem(TRACK_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function write(list) {
    try {
      if (!global.localStorage) return;
      global.localStorage.setItem(
        TRACK_KEY,
        JSON.stringify((list || []).slice(0, MAX_ENTRIES))
      );
    } catch (e) {}
  }

  function append(entry) {
    if (!entry || !text(entry.requestId)) return read();
    var list = read().filter(function (x) {
      return x && x.requestId !== entry.requestId;
    });
    list.unshift(entry);
    write(list);
    for (var i = 0; i < listeners.length; i++) {
      try {
        listeners[i](entry, list);
      } catch (e) {}
    }
    return list;
  }

  function onChange(fn) {
    if (typeof fn === "function") listeners.push(fn);
  }

  function isDeathKind(row) {
    var bucket = text(
      row && (row.eventCategory || row.bucket || row.category)
    ).toLowerCase();
    if (bucket === "death" || bucket === "condolence") return true;
    var label = text(row && row.intentLabel);
    if (
      label.indexOf("وفاة") >= 0 ||
      label.indexOf("إعلان وفاة") >= 0 ||
      label.indexOf("أعلن وفاة") >= 0
    ) {
      return true;
    }
    var et = text(row && (row.eventTypeRaw || row.type || "")).toLowerCase();
    return et === "death";
  }

  function isPatientKind(row) {
    if (isDeathKind(row)) return false;
    var bucket = text(
      row && (row.eventCategory || row.bucket || row.category)
    ).toLowerCase();
    if (bucket === "health" || bucket === "sick" || bucket === "patient") {
      return true;
    }
    var label = text(row && row.intentLabel);
    if (
      label.indexOf("حالة صحية") >= 0 ||
      label.indexOf("مرض") >= 0 ||
      label.indexOf("مريض") >= 0 ||
      label.indexOf("عملية") >= 0
    ) {
      return true;
    }
    var et = text(row && (row.eventTypeRaw || row.type || "")).toLowerCase();
    return et === "sick" || et === "operation" || et === "discharge";
  }

  function isOccasionKind(row) {
    if (isPatientKind(row) || isDeathKind(row)) return false;
    var kind = text(row && row.kind).toLowerCase();
    if (
      kind === "event_card" ||
      kind === "occasion" ||
      kind === "event" ||
      kind === "family_event" ||
      kind === "event_request"
    ) {
      return true;
    }
    var label = text(row && row.intentLabel);
    return label.indexOf("مناسبة") >= 0;
  }

  function isAddPersonKind(row) {
    var kind = text(row && row.kind).toLowerCase();
    if (kind === "tree_card" || kind === "add_person") return true;
    var label = text(row && row.intentLabel);
    return label.indexOf("أضف فرد") >= 0 || label.indexOf("فردًا") >= 0;
  }

  function buildOccasionEntry(payload) {
    var p = payload || {};
    var person = text(p.person || p.ownerName || p.title || "");
    var typeLabel = text(p.typeLabel || p.eventType || p.type || "");
    var dateLabel = text(p.dateLabel || p.event_date || p.date_label || "");
    var requestId = text(p.requestId || p.request_id || "");
    var createdAt =
      text(p.createdAt || p.created_at || "") || new Date().toISOString();
    var summaryParts = [];
    if (person) summaryParts.push("صاحب المناسبة: " + person);
    if (typeLabel) summaryParts.push("النوع: " + typeLabel);
    if (dateLabel) summaryParts.push("التاريخ: " + dateLabel);
    return {
      requestId: requestId,
      kind: "event_card",
      intentLabel: "إضافة مناسبة",
      status: text(p.status) || "submitted",
      summary: summaryParts.join(" · "),
      person: person,
      eventType: typeLabel,
      dateLabel: dateLabel,
      eventCategory: "happy",
      createdAt: createdAt,
    };
  }

  function buildPatientEntry(payload) {
    var p = payload || {};
    var person = text(p.person || p.patientName || p.title || "");
    var typeLabel = text(p.typeLabel || p.eventType || p.type || "");
    var typeRaw = text(p.type || p.eventTypeRaw || "").toLowerCase();
    var dateLabel = text(p.dateLabel || p.event_date || p.date_label || "");
    var hospital = text(p.hospital || p.hospitalName || p.place || "");
    var requestId = text(p.requestId || p.request_id || "");
    var createdAt =
      text(p.createdAt || p.created_at || "") || new Date().toISOString();
    var summaryParts = [];
    if (person) summaryParts.push("المريض: " + person);
    if (typeLabel) summaryParts.push("النوع: " + typeLabel);
    if (hospital) summaryParts.push("المكان: " + hospital);
    if (dateLabel) summaryParts.push("التاريخ: " + dateLabel);
    return {
      requestId: requestId,
      kind: "event_card",
      intentLabel: "حالة صحية",
      status: text(p.status) || "submitted",
      summary: summaryParts.join(" · "),
      person: person,
      eventType: typeLabel,
      eventTypeRaw: typeRaw,
      dateLabel: dateLabel,
      hospital: hospital,
      eventCategory: "health",
      bucket: "health",
      createdAt: createdAt,
    };
  }

  function buildDeathEntry(payload) {
    var p = payload || {};
    var person = text(p.person || p.deceasedName || p.title || "");
    var dateLabel = text(p.dateLabel || p.event_date || p.date_label || "");
    var place = text(p.place || p.condolencePlace || "");
    var requestId = text(p.requestId || p.request_id || "");
    var createdAt =
      text(p.createdAt || p.created_at || "") || new Date().toISOString();
    var summaryParts = [];
    if (person) summaryParts.push("المتوفى: " + person);
    if (dateLabel) summaryParts.push("التاريخ: " + dateLabel);
    if (place) summaryParts.push("المكان: " + place);
    return {
      requestId: requestId,
      kind: "event_card",
      intentLabel: "إعلان وفاة",
      status: text(p.status) || "submitted",
      summary: summaryParts.join(" · "),
      person: person,
      eventType: "وفاة",
      eventTypeRaw: "death",
      dateLabel: dateLabel,
      place: place,
      eventCategory: "death",
      bucket: "death",
      createdAt: createdAt,
    };
  }

  function buildAddPersonEntry(payload) {
    var p = payload || {};
    var personName = text(p.personName || p.name || "");
    var father = text(p.father || "");
    return {
      requestId: text(p.requestId || p.request_id || ""),
      kind: "tree_card",
      intentLabel: "أضف فردًا للعائلة",
      status: text(p.status) || "submitted",
      summary: personName + (father ? " تحت " + father : ""),
      createdAt:
        text(p.createdAt || p.created_at || "") || new Date().toISOString(),
    };
  }


  function isTreeEditKind(row) {
    var kind = text(row && row.kind).toLowerCase();
    if (kind === "tree_edit") return true;
    var label = text(row && row.intentLabel);
    return label.indexOf("صحح") >= 0 || label.indexOf("تصحيح") >= 0;
  }

  function isMemoryKind(row) {
    var kind = text(row && row.kind).toLowerCase();
    if (kind === "memory_card" || kind === "memory") return true;
    var label = text(row && row.intentLabel);
    return label.indexOf("ذكرى") >= 0;
  }

  function isSpecialCardKind(row) {
    var kind = text(row && row.kind).toLowerCase();
    if (kind === "special_card") return true;
    var label = text(row && row.intentLabel);
    return label.indexOf("بطاقة") >= 0 && label.indexOf("طلب") >= 0;
  }

  function buildTreeEditEntry(payload) {
    var p = payload || {};
    var person = text(p.person || p.personName || "");
    var fields = text(p.fields || "");
    var requestId = text(p.requestId || p.request_id || "");
    var createdAt =
      text(p.createdAt || p.created_at || "") || new Date().toISOString();
    var summaryParts = [];
    if (person) summaryParts.push(person);
    if (fields) summaryParts.push("الحقول: " + fields);
    return {
      requestId: requestId,
      kind: "tree_edit",
      intentLabel: "صحح بيانات شخص",
      status: text(p.status) || "submitted",
      summary: summaryParts.join(" · "),
      person: person,
      fields: fields,
      createdAt: createdAt,
    };
  }

  function buildMemoryEntry(payload) {
    var p = payload || {};
    var title = text(p.title || "");
    var person = text(p.person || p.person_name || p.personName || "");
    var requestId = text(p.requestId || p.request_id || "");
    var createdAt =
      text(p.createdAt || p.created_at || "") || new Date().toISOString();
    var summaryParts = [];
    if (title) summaryParts.push(title);
    if (person) summaryParts.push("الشخص: " + person);
    return {
      requestId: requestId,
      kind: "memory_card",
      intentLabel: "شارك ذكرى",
      status: text(p.status) || "submitted",
      summary: summaryParts.join(" · ") || "ذكرى",
      title: title,
      person: person,
      createdAt: createdAt,
    };
  }

  function buildSpecialCardEntry(payload) {
    var p = payload || {};
    var person = text(p.person || p.personName || "");
    var cardType = text(p.cardType || p.card_type || p.typeLabel || "");
    var requestId = text(p.requestId || p.request_id || "");
    var createdAt =
      text(p.createdAt || p.created_at || "") || new Date().toISOString();
    var summaryParts = [];
    if (cardType) summaryParts.push(cardType);
    if (person) summaryParts.push(person);
    return {
      requestId: requestId,
      kind: "special_card",
      intentLabel: "اطلب بطاقة",
      status: text(p.status) || "submitted",
      summary: summaryParts.join(" · "),
      person: person,
      cardType: cardType,
      createdAt: createdAt,
    };
  }

  var api = {
    TRACK_KEY: TRACK_KEY,
    read: read,
    write: write,
    append: append,
    onChange: onChange,
    isOccasionKind: isOccasionKind,
    isPatientKind: isPatientKind,
    isDeathKind: isDeathKind,
    isAddPersonKind: isAddPersonKind,
    isTreeEditKind: isTreeEditKind,
    isMemoryKind: isMemoryKind,
    isSpecialCardKind: isSpecialCardKind,
    buildOccasionEntry: buildOccasionEntry,
    buildPatientEntry: buildPatientEntry,
    buildDeathEntry: buildDeathEntry,
    buildAddPersonEntry: buildAddPersonEntry,
    buildTreeEditEntry: buildTreeEditEntry,
    buildMemoryEntry: buildMemoryEntry,
    buildSpecialCardEntry: buildSpecialCardEntry,
  };

  global.AlzidanRxMyRequests = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
