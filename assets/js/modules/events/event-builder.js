(function (root) {
  "use strict";

  const E = root.AlzidanEvents || {};

  function normalizeText(v) {
    return String(v || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function emptyRowFields() {
    return {
      hospital_name: "",
      hospital_dept: "",
      contact_method: "",
      contact_phone: "",
      visit_date_from: "",
      visit_date_to: "",
      visit_time_from: "",
      visit_time_to: "",
    };
  }

  function stringifyDetails(details) {
    return JSON.stringify(details);
  }

  function buildFromApprovalRequest(input) {
    const row = input.row || {};
    const requestId = normalizeText(row.request_id);
    const msg = String(row.message || "");
    const envelope = E.parseJsonEnvelopeFromMessage
      ? E.parseJsonEnvelopeFromMessage(msg)
      : null;

    if (envelope && envelope.event && typeof envelope.event === "object") {
      const event = envelope.event;
      let details = E.parseDetailsValue ? E.parseDetailsValue(event.details) : {};
      details.requestId = requestId;
      return {
        branch_key: normalizeText(row.branch_key || event.branch_key || ""),
        type: normalizeText(event.type || "gathering"),
        person: normalizeText(event.person || row.name || ""),
        date_label: normalizeText(event.date_label || ""),
        event_date: normalizeText(event.event_date || ""),
        details: stringifyDetails(details),
        hospital_name: normalizeText(event.hospital_name || ""),
        hospital_dept: normalizeText(event.hospital_dept || ""),
        contact_method: normalizeText(event.contact_method || ""),
        contact_phone: normalizeText(event.contact_phone || ""),
        visit_date_from: normalizeText(event.visit_date_from || ""),
        visit_date_to: normalizeText(event.visit_date_to || ""),
        visit_time_from: normalizeText(event.visit_time_from || ""),
        visit_time_to: normalizeText(event.visit_time_to || ""),
        created_at: normalizeText(
          event.created_at || row.created_at || new Date().toISOString(),
        ),
      };
    }

    const media = E.extractEventMediaLinks ? E.extractEventMediaLinks(msg) : { image: "", video: "" };
    const typeLabel = E.readMessageLine
      ? E.readMessageLine(msg, ["نوع المناسبة", "النوع"])
      : "";
    const text = E.readMessageLine ? E.readMessageLine(msg, ["النص"]) : "";
    const details = {
      v: 1,
      kind: "happy_notice",
      requestId,
      text,
      imageUrl: media.image || "",
      videoUrl: media.video || "",
      showDays: 7,
    };

    return {
      branch_key: normalizeText(
        row.branch_key || (E.readMessageLine ? E.readMessageLine(msg, "الفرع") : ""),
      ),
      type: E.eventTypeFromLabel ? E.eventTypeFromLabel(typeLabel) : "gathering",
      person:
        (E.readMessageLine
          ? E.readMessageLine(msg, ["اسم صاحب المناسبة", "صاحب المناسبة"])
          : "") || normalizeText(row.name || ""),
      date_label: E.readMessageLine ? E.readMessageLine(msg, "التاريخ") : "",
      event_date: "",
      details: stringifyDetails(details),
      ...emptyRowFields(),
      contact_phone: normalizeText(row.phone || ""),
      created_at: normalizeText(row.created_at || new Date().toISOString()),
    };
  }

  function buildFromPublicForm(input) {
    const requestId = normalizeText(input.requestId);
    const details = {
      v: 1,
      kind: "happy_notice",
      requestId,
      text: normalizeText(input.text),
      extra: normalizeText(input.place),
      imageUrl: normalizeText(input.imageUrl),
      videoUrl: normalizeText(input.videoUrl),
      showDays: 7,
    };
    return {
      branch_key: normalizeText(input.branch),
      type: normalizeText(input.type),
      person: normalizeText(input.person),
      date_label: normalizeText(input.dateLabel),
      event_date: normalizeText(input.eventDate || ""),
      details: stringifyDetails(details),
      ...emptyRowFields(),
      created_at: normalizeText(input.createdAt || new Date().toISOString()),
    };
  }

  function buildFromDelegateForm(input) {
    const category = normalizeText(input.category || "happy");
    const branch = normalizeText(input.branch);
    const type = normalizeText(input.type || (category === "death" ? "death" : ""));
    const person = normalizeText(input.person);
    const dateLabel = normalizeText(input.dateLabel);
    const eventDate = normalizeText(input.eventDate);
    const showDays = Number(input.showDays) > 0 ? Number(input.showDays) : 7;
    const createdAt = normalizeText(input.createdAt || new Date().toISOString());

    if (category === "death") {
      const details = {
        v: 1,
        kind: "death_notice",
        prayerPlace: normalizeText(input.prayerPlace),
        prayerTime: normalizeText(input.prayerTime),
        burialPlace: normalizeText(input.burialPlace),
        burialTime: normalizeText(input.burialTime),
        condolencePlace: normalizeText(input.condolencePlace),
        condolenceTime: normalizeText(input.condolenceTime),
        phones: Array.isArray(input.phones) ? input.phones : [],
        notes: normalizeText(input.notes),
        showDays,
      };
      return {
        branch_key: branch,
        type: "death",
        person,
        date_label: dateLabel || null,
        event_date: eventDate || null,
        details: stringifyDetails(details),
        ...emptyRowFields(),
        created_at: createdAt,
      };
    }

    if (category === "sick") {
      const place = input.place === "home" ? "home" : "hospital";
      const details = {
        v: 1,
        kind: "health_notice",
        place,
        homeCity: normalizeText(input.homeCity),
        homeArea: normalizeText(input.homeArea),
        notes: normalizeText(input.notes),
        hospitalName: normalizeText(input.hospitalName),
        hospitalDept: normalizeText(input.hospitalDept),
        showDays,
      };
      return {
        branch_key: branch,
        type: type || "sick",
        person,
        date_label: dateLabel || null,
        event_date: eventDate || null,
        details: stringifyDetails(details),
        hospital_name: normalizeText(input.hospitalName) || null,
        hospital_dept: normalizeText(input.hospitalDept) || null,
        contact_method: normalizeText(input.contactMethod) || null,
        contact_phone: normalizeText(input.contactPhone) || null,
        visit_date_from: normalizeText(input.visitDateFrom) || null,
        visit_date_to: normalizeText(input.visitDateTo) || null,
        visit_time_from: normalizeText(input.visitTimeFrom) || null,
        visit_time_to: normalizeText(input.visitTimeTo) || null,
        created_at: createdAt,
      };
    }

    const details = {
      v: 1,
      kind: "happy_notice",
      text: normalizeText(input.text),
      extra: normalizeText(input.extra),
      imageUrl: normalizeText(input.imageUrl),
      videoUrl: normalizeText(input.videoUrl),
      showDays,
    };
    return {
      branch_key: branch,
      type,
      person,
      date_label: dateLabel || null,
      event_date: eventDate || null,
      details: stringifyDetails(details),
      ...emptyRowFields(),
      created_at: createdAt,
    };
  }

  function buildFromAdminCms(input) {
    const oldDetails = E.parseDetailsValue ? E.parseDetailsValue(input.oldDetails) : {};
    const text = normalizeText(input.text);
    const imageUrl = normalizeText(input.imageUrl);
    const videoUrl = normalizeText(input.videoUrl);
    const type = normalizeText(input.type || "general");
    const hospitalName =
      normalizeText(input.hospitalName) ||
      normalizeText(oldDetails.hospitalName || oldDetails.hospital_name);
    const hospitalDept =
      normalizeText(input.hospitalDept) ||
      normalizeText(oldDetails.hospitalDept || oldDetails.hospital_dept);
    const homeCity =
      normalizeText(input.homeCity) ||
      normalizeText(oldDetails.homeCity || oldDetails.home_city);
    const homeArea =
      normalizeText(input.homeArea) ||
      normalizeText(oldDetails.homeArea || oldDetails.home_area);
    const contactMethod = normalizeText(input.contactMethod);
    const contactPhone = normalizeText(input.contactPhone);
    const visitDateFrom =
      contactMethod === "visit" ? normalizeText(input.visitDateFrom) : "";
    const visitDateTo =
      contactMethod === "visit" ? normalizeText(input.visitDateTo) : "";
    const visitTimeFrom =
      contactMethod === "visit" ? normalizeText(input.visitTimeFrom) : "";
    const visitTimeTo =
      contactMethod === "visit" ? normalizeText(input.visitTimeTo) : "";
    const prayerPlace = normalizeText(input.prayerPlace);
    const burialPlace = normalizeText(input.burialPlace);
    const condolencePlace = normalizeText(input.condolencePlace);
    const showDays = Number(oldDetails.showDays || 7) || 7;
    const isDeath = type === "death";
    const isHealth = type === "sick" || type === "operation" || type === "discharge";

    let details;
    if (isDeath) {
      details = {
        ...oldDetails,
        v: 1,
        kind: "death_notice",
        notes: text || normalizeText(oldDetails.notes),
        prayerPlace: prayerPlace || normalizeText(oldDetails.prayerPlace),
        burialPlace: burialPlace || normalizeText(oldDetails.burialPlace),
        condolencePlace: condolencePlace || normalizeText(oldDetails.condolencePlace),
        showDays,
      };
    } else if (isHealth) {
      let place = normalizeText(oldDetails.place) === "home" ? "home" : "hospital";
      if (hospitalName || hospitalDept) place = "hospital";
      else if (homeCity || homeArea) place = "home";
      details = {
        ...oldDetails,
        v: 1,
        kind: "health_notice",
        place,
        notes: text || normalizeText(oldDetails.notes),
        hospitalName,
        hospitalDept,
        homeCity,
        homeArea,
        showDays,
      };
    } else {
      details = {
        ...oldDetails,
        v: oldDetails.v || 1,
        kind: "happy_notice",
        text,
        imageUrl,
        videoUrl,
        showDays,
      };
    }
    if (imageUrl) details.imageUrl = imageUrl;
    if (videoUrl) details.videoUrl = videoUrl;

    const row = {
      branch_key: normalizeText(input.branch),
      type,
      person: normalizeText(input.person),
      date_label: normalizeText(input.dateLabel),
      event_date: normalizeText(input.eventDate),
      details: stringifyDetails(details),
      hospital_name: isHealth ? hospitalName || null : null,
      hospital_dept: isHealth ? hospitalDept || null : null,
      contact_method: isHealth ? contactMethod || null : null,
      contact_phone: isHealth ? contactPhone || null : null,
      visit_date_from: isHealth ? visitDateFrom || null : null,
      visit_date_to: isHealth ? visitDateTo || null : null,
      visit_time_from: isHealth ? visitTimeFrom || null : null,
      visit_time_to: isHealth ? visitTimeTo || null : null,
    };
    if (input.id != null && Number(input.id) > 0) row.id = Number(input.id);
    return row;
  }

  function buildFamilyEventRow(input) {
    const source = normalizeText(input && input.source);
    if (source === "approval_request") return buildFromApprovalRequest(input);
    if (source === "public_form") return buildFromPublicForm(input);
    if (source === "delegate_form") return buildFromDelegateForm(input);
    if (source === "admin_cms") return buildFromAdminCms(input);
    return null;
  }

  root.AlzidanEvents = root.AlzidanEvents || {};
  Object.assign(root.AlzidanEvents, {
    buildFamilyEventRow,
  });
})(typeof window !== "undefined" ? window : globalThis);
