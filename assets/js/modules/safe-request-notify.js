/**
 * MANDATORY safe outbound renderer for request notifications.
 * Rule: structured fields → kind → status → Arabic template.
 * If kind/status cannot be mapped → do NOT send (return null). NEVER use raw message.
 * Global: window.AlzidanSafeRequestNotify
 */
(function (root) {
  "use strict";

  var KNOWN_KINDS = {
    event_card: { label: "إضافة مناسبة", family: "content" },
    family_event: { label: "إضافة مناسبة", family: "content" },
    event_request: { label: "إضافة مناسبة", family: "content" },
    occasion: { label: "إضافة مناسبة", family: "content" },
    patient: { label: "حالة صحية", family: "content" },
    health: { label: "حالة صحية", family: "content" },
    event_death: { label: "إشعار وفاة", family: "content" },
    tree_card: { label: "إضافة فرد", family: "content" },
    add_person: { label: "إضافة فرد", family: "content" },
    tree_edit: { label: "تصحيح بيانات", family: "content" },
    memory_card: { label: "ذكرى", family: "content" },
    memory: { label: "ذكرى", family: "content" },
    special_card: { label: "طلب بطاقة", family: "content" },
    tree_founder: { label: "مؤسس في الشجرة", family: "content" },
    org_role: { label: "عضوية/دور", family: "privilege" },
    tree_delegate: { label: "مندوب شجرة", family: "privilege" },
    events_delegate: { label: "مندوب مناسبات", family: "privilege" },
    test_request: { label: "طلب اختبار", family: "content" },
    delegate_secret_reset: { label: "إعادة تعيين رقم سري", family: "privilege" },
  };

  var STATUS_AR = {
    pending: "بانتظار المراجعة",
    approved: "تمت الموافقة",
    rejected: "تم الرفض",
    deferred: "مؤجل",
    needs_changes: "يحتاج تعديل",
    scheduled: "مجدول للظهور",
    visible: "ظاهر الآن",
    ended: "منتهٍ",
  };

  function text(v) {
    return String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  }

  function normalizeKind(kind) {
    return text(kind).toLowerCase();
  }

  function normalizeStatus(status) {
    var s = text(status).toLowerCase();
    if (s === "accepted" || s === "applied" || s === "done") return "approved";
    if (s === "denied") return "rejected";
    if (s === "postponed" || s === "مؤجل") return "deferred";
    if (s === "مجدول" || s === "مجدول للظهور") return "scheduled";
    if (s === "ظاهر" || s === "ظاهر الآن") return "visible";
    if (s === "منته" || s === "منتهٍ" || s === "منتهية") return "ended";
    if (s === "needs_changes" || s === "needs-changes" || s === "changes_requested") {
      return "needs_changes";
    }
    if (
      s === "submitted" ||
      s === "assigned" ||
      s === "in_review"
    ) {
      return "pending";
    }
    return s;
  }

  function isInternalAuditKind(kind) {
    var k = normalizeKind(kind);
    return (
      !k ||
      k === "events_audit" ||
      k === "tree_audit" ||
      k === "audit" ||
      k.endsWith("_audit") ||
      /^eva-/i.test(k) ||
      /^aud-/i.test(k)
    );
  }

  function isKnownKind(kind) {
    var k = normalizeKind(kind);
    return !!(KNOWN_KINDS[k] && !isInternalAuditKind(k));
  }

  function kindMeta(kind) {
    var k = normalizeKind(kind);
    return KNOWN_KINDS[k] || null;
  }

  function looksBanned(raw) {
    var s = text(raw);
    if (!s) return false;
    if (/__JSON__|events_audit|tree_audit|secret_hash|request_pk/i.test(s)) return true;
    if (/[{}\[\]]/.test(s)) return true;
    if (/"v"\s*:|"op"\s*:|"kind"\s*:|"at"\s*:/i.test(s)) return true;
    if (
      /Failed to|Edge Function|Supabase|Postgrest|PGRST|JWT|RPC|SQL|not allowed|stack|trace/i.test(
        s
      )
    ) {
      return true;
    }
    return false;
  }

  function safeDisplayName(raw) {
    var s = text(raw).slice(0, 80);
    if (!s || looksBanned(s)) return "";
    if (/[A-Za-z0-9_]{12,}/.test(s) && !/[\u0600-\u06FF]/.test(s)) return "";
    // Allow Arabic names / short labels only
    if (!/[\u0600-\u06FF]/.test(s) && !/^[0-9\s\-_/]+$/.test(s)) return "";
    return s;
  }

  function safeArabicReason(raw) {
    var s = text(raw).slice(0, 200);
    if (!s || looksBanned(s)) return "";
    if (!/[\u0600-\u06FF]/.test(s)) return "";
    var latin = (s.match(/[A-Za-z]/g) || []).length;
    var arabic = (s.match(/[\u0600-\u06FF]/g) || []).length;
    if (latin >= 8 && latin > arabic) return "";
    return s;
  }

  /**
   * Mandatory renderer. Returns null → caller MUST NOT send.
   * Never reads or returns record.message.
   *
   * @param {{ mode: string, kind: string, status?: string, branch_key?: string, person?: string, name?: string, reject_reason?: string, audience?: 'submitter'|'delegate'|'admin' }} input
   * @returns {{ ok: true, subject: string, title: string, body: string, text: string, kindLabel: string, statusLabel: string } | null}
   */
  function safeRenderOutbound(input) {
    var opts = input || {};
    var mode = text(opts.mode || "").toLowerCase() || "status_changed";
    var kind = normalizeKind(opts.kind);
    var audience = text(opts.audience || "submitter").toLowerCase() || "submitter";
    var meta = kindMeta(kind);

    if (isInternalAuditKind(kind) || !meta) {
      try {
        console.warn("[safe-request-notify] blocked unknown/internal kind", kind, mode);
      } catch (_) {}
      return null;
    }

    var kindLabel = meta.label;
    var branch = safeDisplayName(opts.branch_key || opts.branch || "");
    var person = safeDisplayName(opts.person || opts.name || "");
    var reason = safeArabicReason(opts.reject_reason || opts.reason || "");
    var status = normalizeStatus(opts.status);

    // ---- status_changed → SUBMITTER only templates ----
    if (mode === "status_changed") {
      if (audience !== "submitter") {
        try {
          console.warn("[safe-request-notify] blocked non-submitter status notify");
        } catch (_) {}
        return null;
      }
      if (
        status !== "approved" &&
        status !== "rejected" &&
        status !== "deferred" &&
        status !== "needs_changes"
      ) {
        try {
          console.warn("[safe-request-notify] blocked unmapped status", status);
        } catch (_) {}
        return null;
      }

      var statusLabel = STATUS_AR[status];
      var lines = [
        "تحديث طلبك في عائلة الزيدان",
        "نوع الطلب: " + kindLabel,
      ];
      if (branch) lines.push("الفرع: " + branch);
      if (person) lines.push("الموضوع: " + person);
      lines.push("الحالة: " + statusLabel);
      if ((status === "rejected" || status === "needs_changes") && reason) {
        lines.push("السبب: " + reason);
      }
      lines.push("يمكنك المتابعة من قسم طلباتي.");

      var subject = "تحديث طلبك: " + statusLabel + " — " + kindLabel;
      var body = lines.join("\n");
      return {
        ok: true,
        subject: subject,
        title: subject,
        body: body,
        text: body,
        kindLabel: kindLabel,
        statusLabel: statusLabel,
      };
    }

    // ---- branch delegate new request (reviewer inbox) ----
    if (mode === "branch_delegate_new_request") {
      if (meta.family === "privilege") return null;
      if (!branch) {
        try {
          console.warn("[safe-request-notify] blocked branch notify without branch");
        } catch (_) {}
        return null;
      }
      var dSubject = "طلب جديد يحتاج مراجعتك";
      var dBody = [
        "السلام عليكم،",
        "",
        "وصل طلب «" + kindLabel + "» لفرع " + branch + "، ويحتاج إلى مراجعتك.",
        person ? "الاسم/الموضوع: " + person : "",
        "",
        "هذا إشعار لمندوب الفرع فقط — ليس رسالة لصاحب الطلب.",
      ]
        .filter(Boolean)
        .join("\n");
      return {
        ok: true,
        subject: dSubject,
        title: dSubject,
        body: dBody,
        text: dBody,
        kindLabel: kindLabel,
        statusLabel: STATUS_AR.pending,
      };
    }

    // ---- admin new request ----
    if (mode === "admin_new_request") {
      var aSubject = "طلب جديد بانتظار اعتمادك";
      var aBody = [
        "السلام عليكم،",
        "",
        "وصل طلب «" + kindLabel + "»" + (branch ? " لفرع " + branch : "") + " بانتظار الاعتماد.",
        person ? "الاسم/الموضوع: " + person : "",
      ]
        .filter(Boolean)
        .join("\n");
      return {
        ok: true,
        subject: aSubject,
        title: aSubject,
        body: aBody,
        text: aBody,
        kindLabel: kindLabel,
        statusLabel: STATUS_AR.pending,
      };
    }

    // ---- submitter ack after create ----
    if (mode === "new_request" || mode === "submitter_ack") {
      if (audience === "delegate") return null;
      var sSubject = "تم إرسال طلبك بنجاح — " + kindLabel;
      var sBody = [
        "تم إرسال طلبك بنجاح، وهو الآن قيد المراجعة.",
        "نوع الطلب: " + kindLabel,
        branch ? "الفرع: " + branch : "",
        "يمكنك متابعة الحالة من قسم طلباتي.",
      ]
        .filter(Boolean)
        .join("\n");
      return {
        ok: true,
        subject: sSubject,
        title: sSubject,
        body: sBody,
        text: sBody,
        kindLabel: kindLabel,
        statusLabel: STATUS_AR.pending,
      };
    }

    try {
      console.warn("[safe-request-notify] blocked unknown mode", mode, kind);
    } catch (_) {}
    return null;
  }

  /** Strip forbidden fields from a record before any network call. */
  function scrubRecordForNotify(record) {
    var src = record && typeof record === "object" ? record : {};
    return {
      request_id: text(src.request_id || "") || null,
      kind: normalizeKind(src.kind),
      branch_key: text(src.branch_key || src.branch || "") || null,
      status: normalizeStatus(src.status) || null,
      email: text(src.email || "") || null,
      phone: text(src.phone || "") || null,
      name: safeDisplayName(src.name || src.person || "") || null,
      person: safeDisplayName(src.person || src.name || "") || null,
      reject_reason: safeArabicReason(src.reject_reason || src.rejection_reason || src.reason || "") || null,
    };
  }

  /**
   * UI-only: strip __JSON__ / audit blobs / technical fragments from display text.
   * Never returns raw message payload; empty string if nothing safe remains.
   */
  function safeUiDetailText(raw) {
    var s = text(raw);
    if (!s) return "";
    var jsonIdx = s.indexOf("__JSON__");
    if (jsonIdx >= 0) s = text(s.slice(0, jsonIdx));
    s = s
      .split(/\n/)
      .map(function (line) {
        return text(line);
      })
      .filter(function (line) {
        if (!line) return false;
        if (looksBanned(line)) return false;
        if (/^تمت مراجعة الطلب بواسطة/.test(line)) return false;
        if (/^---$/.test(line)) return false;
        return /[\u0600-\u06FF]/.test(line);
      })
      .join(" · ");
    if (!s || looksBanned(s)) return "";
    return s.slice(0, 280);
  }

  var api = {
    KNOWN_KINDS: KNOWN_KINDS,
    STATUS_AR: STATUS_AR,
    isKnownKind: isKnownKind,
    isInternalAuditKind: isInternalAuditKind,
    kindMeta: kindMeta,
    looksBanned: looksBanned,
    safeDisplayName: safeDisplayName,
    safeArabicReason: safeArabicReason,
    safeUiDetailText: safeUiDetailText,
    safeRenderOutbound: safeRenderOutbound,
    scrubRecordForNotify: scrubRecordForNotify,
    normalizeKind: normalizeKind,
    normalizeStatus: normalizeStatus,
  };

  root.AlzidanSafeRequestNotify = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
