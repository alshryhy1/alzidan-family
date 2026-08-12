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

  function toSqlDateOrEmpty(v) {
    const raw = normalizeText(v)
      .replace(/[٠-٩]/g, function (d) {
        return String("٠١٢٣٤٥٦٧٨٩".indexOf(d));
      })
      .replace(/[۰-۹]/g, function (d) {
        return String("۰۱۲۳۴۵۶۷۸۹".indexOf(d));
      })
      .replace(/[.\s]+/g, "/");
    if (!raw) return "";
    let y = null;
    let m = null;
    let d = null;
    let mm = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (mm) {
      y = parseInt(mm[1], 10);
      m = parseInt(mm[2], 10);
      d = parseInt(mm[3], 10);
    } else {
      mm = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
      if (mm) {
        d = parseInt(mm[1], 10);
        m = parseInt(mm[2], 10);
        y = parseInt(mm[3], 10);
      }
    }
    if (!y || !m || !d) return "";
    if (y < 1800 || y > 2100) return "";
    if (m < 1 || m > 12 || d < 1 || d > 31) return "";
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (
      dt.getUTCFullYear() !== y ||
      dt.getUTCMonth() !== m - 1 ||
      dt.getUTCDate() !== d
    ) {
      return "";
    }
    return (
      String(y).padStart(4, "0") +
      "-" +
      String(m).padStart(2, "0") +
      "-" +
      String(d).padStart(2, "0")
    );
  }

  function toSqlTimestamptzOrEmpty(v) {
    const s = normalizeText(v);
    if (!s) return "";
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return s;
    const ms = Date.parse(s);
    if (!Number.isFinite(ms)) return "";
    return new Date(ms).toISOString();
  }

  function sanitizeFamilyEventRowForPublish(row) {
    if (!row || typeof row !== "object") return row;
    const out = Object.assign({}, row);
    const isoEvent =
      toSqlDateOrEmpty(out.event_date) || toSqlDateOrEmpty(out.date_label);
    out.event_date = isoEvent || "";
    out.date_label = normalizeText(out.date_label) || out.event_date || "";
    out.visit_date_from = toSqlDateOrEmpty(out.visit_date_from);
    out.visit_date_to = toSqlDateOrEmpty(out.visit_date_to);
    const created = toSqlTimestamptzOrEmpty(out.created_at);
    if (created) out.created_at = created;
    else delete out.created_at;
    const showAt = toSqlTimestamptzOrEmpty(out.show_at);
    if (showAt) out.show_at = showAt;
    else delete out.show_at;
    const endAt = toSqlTimestamptzOrEmpty(out.end_at);
    if (endAt) out.end_at = endAt;
    else delete out.end_at;
    if (typeof E.normalizeEventType === "function") {
      out.type = E.normalizeEventType(out.type || "gathering");
    }
    return out;
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
      const Vis = root.AlzidanEventVisibility || {};
      const schedule =
        typeof Vis.buildScheduleFields === "function"
          ? Vis.buildScheduleFields({
              event_date: normalizeText(event.event_date || event.date_label || ""),
              show_before_days:
                event.show_before_days != null
                  ? event.show_before_days
                  : details.show_before_days != null
                    ? details.show_before_days
                    : 3,
              show_at: event.show_at || details.show_at || "",
              end_at: event.end_at || details.end_at || "",
            })
          : { show_before_days: 3 };
      details =
        typeof Vis.mergeScheduleIntoDetails === "function"
          ? Vis.mergeScheduleIntoDetails(details, schedule)
          : Object.assign({}, details, schedule);
      const out = {
        branch_key: normalizeText(row.branch_key || event.branch_key || ""),
        type: E.normalizeEventType
          ? E.normalizeEventType(event.type || event.typeLabel || "gathering")
          : normalizeText(event.type || "gathering"),
        person: normalizeText(event.person || row.name || ""),
        date_label: normalizeText(event.date_label || ""),
        event_date: toSqlDateOrEmpty(event.event_date || ""),
        details: stringifyDetails(details),
        hospital_name: normalizeText(event.hospital_name || ""),
        hospital_dept: normalizeText(event.hospital_dept || ""),
        contact_method: normalizeText(event.contact_method || ""),
        contact_phone: normalizeText(event.contact_phone || ""),
        visit_date_from: toSqlDateOrEmpty(event.visit_date_from || ""),
        visit_date_to: toSqlDateOrEmpty(event.visit_date_to || ""),
        visit_time_from: normalizeText(event.visit_time_from || ""),
        visit_time_to: normalizeText(event.visit_time_to || ""),
        created_at:
          toSqlTimestamptzOrEmpty(event.created_at || row.created_at) ||
          new Date().toISOString(),
      };
      if (schedule.show_before_days != null) out.show_before_days = schedule.show_before_days;
      if (schedule.show_at) out.show_at = schedule.show_at;
      if (schedule.end_at) out.end_at = schedule.end_at;
      return out;
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
          ? E.readMessageLine(msg, [
              "اسم صاحب المناسبة",
              "صاحب المناسبة",
              "اسم المريض",
              "اسم المتوفى",
              "اسم المولود",
              "اسم العريس",
              "اسم الخريج",
            ])
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
    const type = normalizeText(input.type);
    const isHealth =
      type === "sick" || type === "operation" || type === "discharge";
    const isDeath = type === "death";
    const hospitalName = normalizeText(
      input.hospitalName || input.hospital_name || (isHealth ? input.place : ""),
    );
    const hospitalDept = normalizeText(
      input.hospitalDept || input.hospital_dept || "",
    );
    const notes = normalizeText(input.text || input.notes || "");
    const place = normalizeText(input.place || "");
    const personId = normalizeText(input.person_id || input.personId || "");

    if (isDeath) {
      const details = {
        v: 1,
        kind: "death_notice",
        requestId,
        notes,
        condolencePlace: place,
        prayerPlace: normalizeText(input.prayerPlace || ""),
        burialPlace: normalizeText(input.burialPlace || ""),
        phones: normalizeText(input.phone || input.contactPhone || "")
          ? [normalizeText(input.phone || input.contactPhone || "")]
          : [],
        showDays: 7,
      };
      if (personId) {
        details.person_id = personId;
        details.personId = personId;
      }
      return {
        branch_key: normalizeText(input.branch),
        type: "death",
        person: normalizeText(input.person),
        date_label: normalizeText(input.dateLabel),
        event_date: normalizeText(input.eventDate || input.dateLabel || ""),
        details: stringifyDetails(details),
        ...emptyRowFields(),
        contact_phone: normalizeText(input.phone || input.contactPhone || ""),
        created_at: normalizeText(input.createdAt || new Date().toISOString()),
      };
    }

    if (isHealth) {
      const placeKind =
        normalizeText(input.placeKind) === "home"
          ? "home"
          : hospitalName || hospitalDept
            ? "hospital"
            : "hospital";
      const details = {
        v: 1,
        kind: "health_notice",
        requestId,
        place: placeKind,
        notes,
        hospitalName,
        hospitalDept,
        homeCity: normalizeText(input.homeCity || input.home_city || ""),
        homeArea: normalizeText(input.homeArea || input.home_area || ""),
        showDays: 7,
      };
      return {
        branch_key: normalizeText(input.branch),
        type: type || "sick",
        person: normalizeText(input.person),
        date_label: normalizeText(input.dateLabel),
        event_date: normalizeText(input.eventDate || ""),
        details: stringifyDetails(details),
        ...emptyRowFields(),
        hospital_name: hospitalName || null,
        hospital_dept: hospitalDept || null,
        contact_phone: normalizeText(input.phone || input.contactPhone || ""),
        created_at: normalizeText(input.createdAt || new Date().toISOString()),
      };
    }

    const details = {
      v: 1,
      kind: "happy_notice",
      requestId,
      text: notes,
      extra: place,
      imageUrl: normalizeText(input.imageUrl),
      videoUrl: normalizeText(input.videoUrl),
      showDays: 7,
    };
    const Vis = root.AlzidanEventVisibility || {};
    const schedule =
      typeof Vis.buildScheduleFields === "function"
        ? Vis.buildScheduleFields({
            event_date: normalizeText(input.eventDate || input.dateLabel || ""),
            show_before_days:
              input.showBeforeDays != null
                ? input.showBeforeDays
                : input.show_before_days != null
                  ? input.show_before_days
                  : 3,
            show_at: input.showAt || input.show_at || "",
            end_at: input.endAt || input.end_at || "",
          })
        : { show_before_days: 3 };
    const merged =
      typeof Vis.mergeScheduleIntoDetails === "function"
        ? Vis.mergeScheduleIntoDetails(details, schedule)
        : Object.assign({}, details, schedule);
    const row = {
      branch_key: normalizeText(input.branch),
      type,
      person: normalizeText(input.person),
      date_label: normalizeText(input.dateLabel),
      event_date: normalizeText(input.eventDate || ""),
      details: stringifyDetails(merged),
      ...emptyRowFields(),
      created_at: normalizeText(input.createdAt || new Date().toISOString()),
    };
    if (schedule.show_before_days != null) row.show_before_days = schedule.show_before_days;
    if (schedule.show_at) row.show_at = schedule.show_at;
    if (schedule.end_at) row.end_at = schedule.end_at;
    return row;
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
    const Vis = root.AlzidanEventVisibility || {};
    const schedule =
      typeof Vis.buildScheduleFields === "function"
        ? Vis.buildScheduleFields({
            event_date: eventDate || dateLabel,
            show_before_days:
              input.showBeforeDays != null
                ? input.showBeforeDays
                : input.show_before_days != null
                  ? input.show_before_days
                  : 3,
            show_at: input.showAt || input.show_at || "",
            end_at: input.endAt || input.end_at || "",
            manual_hidden: input.manualHidden || input.manual_hidden || false,
          })
        : {
            show_before_days: 3,
            show_at: null,
            end_at: null,
            manual_hidden: false,
          };

    function applySchedule(detailsObj, rowOut) {
      const merged =
        typeof Vis.mergeScheduleIntoDetails === "function"
          ? Vis.mergeScheduleIntoDetails(detailsObj, schedule)
          : Object.assign({}, detailsObj, schedule);
      if (rowOut) {
        if (schedule.show_before_days != null) {
          rowOut.show_before_days = schedule.show_before_days;
        }
        if (schedule.show_at) rowOut.show_at = schedule.show_at;
        if (schedule.end_at) rowOut.end_at = schedule.end_at;
        if (schedule.manual_hidden) rowOut.manual_hidden = true;
      }
      return merged;
    }

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
    const row = {
      branch_key: branch,
      type,
      person,
      date_label: dateLabel || null,
      event_date: eventDate || null,
      details: stringifyDetails(details),
      ...emptyRowFields(),
      created_at: createdAt,
    };
    row.details = stringifyDetails(applySchedule(details, row));
    return row;
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
      // Non-health empties stay "" (golden + emptyRowFields). Health may use null.
      hospital_name: isHealth ? hospitalName || null : "",
      hospital_dept: isHealth ? hospitalDept || null : "",
      contact_method: isHealth ? contactMethod || null : "",
      contact_phone: isHealth ? contactPhone || null : "",
      visit_date_from: isHealth ? visitDateFrom || null : "",
      visit_date_to: isHealth ? visitDateTo || null : "",
      visit_time_from: isHealth ? visitTimeFrom || null : "",
      visit_time_to: isHealth ? visitTimeTo || null : "",
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
    sanitizeFamilyEventRowForPublish,
    toSqlDateOrEmpty,
  });
})(typeof window !== "undefined" ? window : globalThis);
