/**
 * Shared Arabic-only copy for homepage / public request results.
 * Never surface Edge/Supabase/English/JSON/codes to end users.
 * Global: window.AlzidanUserFacingRequestMessages
 *
 * Content/event requests ≠ delegate permission requests.
 */
(function (root) {
  "use strict";

  var MSG = {
    SUBMIT_SUCCESS: "تم إرسال طلبك بنجاح، وهو الآن قيد المراجعة.",
    PENDING: "طلبك بانتظار المراجعة",
    PENDING_LONG: "طلبك بانتظار المراجعة.",
    APPROVED: "تمت الموافقة على طلبك",
    APPROVED_LONG: "تمت الموافقة على طلبك.",
    /** Privilege / delegate kinds only — never use for homepage content. */
    APPROVED_PRIVILEGE: "تم قبول طلبك بنجاح.",
    APPROVED_CLARIFICATION_PRIVILEGE:
      "يمكنك الآن استخدام الصلاحية التي تم قبولها.",
    APPROVED_CLARIFICATION_TREE:
      "ستظهر البيانات في الشجرة بعد اكتمال التطبيق.",
    APPROVED_CLARIFICATION_EDIT: "سيتم تطبيق التصحيح وفق مسار المراجعة.",
    APPROVED_CLARIFICATION_PUBLISH:
      "سيظهر المحتوى للعامة وفق جدولة الظهور المعتمدة.",
    APPROVED_CLARIFICATION_DEFAULT:
      "يمكنك متابعة التفاصيل من قسم طلباتي.",
    REJECTED: "تم رفض طلبك",
    REJECTED_LONG: "تم رفض طلبك.",
    STATUS_UPDATE_APPROVED: "تحديث على طلبك: تمت الموافقة على المناسبة.",
    STATUS_UPDATE_REJECTED: "تحديث على طلبك: تم رفض طلبك.",
    NOTIFY_FAILURE_AFTER_SAVE:
      "تم حفظ طلبك بنجاح، لكن تعذر إرسال إشعار البريد الإلكتروني حاليًا. لا حاجة لإعادة إرسال الطلب.",
    GENERIC_SUBMIT_ERROR:
      "تعذر إرسال الطلب حاليًا. حاول مرة أخرى لاحقًا.",
    GENERIC_LOAD_ERROR: "تعذر تحميل البيانات حاليًا. حاول مرة أخرى لاحقًا.",
    DUPLICATE_PENDING:
      "يوجد طلب مشابه قيد المراجعة حاليًا. راقبه من طلباتي.",
    DATE_EXPIRED:
      "تاريخ المناسبة منتهٍ ولا يمكن إرسالها. اختر تاريخًا اليوم أو لاحقًا.",
    // طلباتي chips — persist after accept/reject (do not disappear)
    CHIP_PENDING: "بانتظار المراجعة",
    CHIP_APPROVED: "تمت الموافقة",
    CHIP_REJECTED: "تم الرفض",
    CHIP_DEFERRED: "مؤجل",
    CHIP_SCHEDULED: "مجدول للظهور",
    CHIP_VISIBLE: "ظاهر الآن",
    CHIP_ENDED: "منتهٍ",
  };

  function text(v) {
    return String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  }

  function normalizeStatus(status) {
    var s = text(status).toLowerCase();
    if (
      s === "pending" ||
      s === "submitted" ||
      s === "assigned" ||
      s === "in_review" ||
      s === "needs_changes"
    ) {
      return "pending";
    }
    if (s === "approved" || s === "applied" || s === "done" || s === "accepted") {
      return "approved";
    }
    if (s === "rejected" || s === "denied") return "rejected";
    if (s === "scheduled" || s === "مجدول" || s === "مجدول للظهور") return "scheduled";
    if (s === "deferred" || s === "مؤجل" || s === "postponed") return "deferred";
    if (s === "visible" || s === "ظاهر" || s === "ظاهر الآن") return "visible";
    if (s === "ended" || s === "منته" || s === "منتهٍ" || s === "منتهية") return "ended";
    if (s === "submit_success" || s === "created" || s === "sent") {
      return "submit_success";
    }
    if (
      s === "notify_failure" ||
      s === "notify_failed" ||
      s === "email_notify_failed"
    ) {
      return "notify_failure";
    }
    return s || "pending";
  }

  function normalizeKind(kind) {
    return text(kind).toLowerCase();
  }

  function isPrivilegeKind(kind) {
    var k = normalizeKind(kind);
    return (
      k === "tree_delegate" ||
      k === "events_delegate" ||
      k === "org_role" ||
      k === "delegate" ||
      k === "delegate_access" ||
      k === "delegate_secret_reset"
    );
  }

  function isTreeAddKind(kind) {
    var k = normalizeKind(kind);
    return k === "tree_card" || k === "add_person" || k === "tree_founder";
  }

  function isTreeEditKind(kind) {
    return normalizeKind(kind) === "tree_edit";
  }

  function isPublishKind(kind) {
    var k = normalizeKind(kind);
    return (
      k === "event_card" ||
      k === "family_event" ||
      k === "event_request" ||
      k === "memory_card" ||
      k === "memory" ||
      k === "special_card" ||
      k === "occasion" ||
      k === "patient" ||
      k === "event_death"
    );
  }

  function approvedClarification(kind) {
    if (isPrivilegeKind(kind)) return MSG.APPROVED_CLARIFICATION_PRIVILEGE;
    if (isTreeAddKind(kind)) return MSG.APPROVED_CLARIFICATION_TREE;
    if (isTreeEditKind(kind)) return MSG.APPROVED_CLARIFICATION_EDIT;
    if (isPublishKind(kind)) return MSG.APPROVED_CLARIFICATION_PUBLISH;
    return MSG.APPROVED_CLARIFICATION_DEFAULT;
  }

  function looksTechnical(raw) {
    var s = text(raw);
    if (!s) return true;
    if (/[{}\[\]<>]|https?:\/\//i.test(s)) return true;
    if (/__JSON__|events_audit|tree_audit|"op"\s*:|"kind"\s*:|"v"\s*:/i.test(s)) {
      return true;
    }
    if (
      /Failed to|Edge Function|FunctionsHttpError|Supabase|Postgrest|PGRST|JWT|CORS|NetworkError|TypeError|ReferenceError|invoke_error|notify_failed|resend_|missing_|schema cache|permission denied|row-level security|RPC|SQL|JSON|stack|trace|wbskjfdqpugnwvrykqcn|not allowed/i.test(
        s
      )
    ) {
      return true;
    }
    if (/^[a-z0-9_.:\-/\s]+$/i.test(s) && /[a-z]/i.test(s)) return true;
    // Mixed mostly-Latin → hide from users.
    var latin = (s.match(/[A-Za-z]/g) || []).length;
    var arabic = (s.match(/[\u0600-\u06FF]/g) || []).length;
    if (latin > 0 && arabic === 0) return true;
    if (latin >= 8 && latin > arabic) return true;
    return false;
  }

  function kindLabelAr(kind) {
    var k = normalizeKind(kind);
    if (
      k === "events_audit" ||
      k === "tree_audit" ||
      k.endsWith("_audit")
    ) {
      return "سجل داخلي";
    }
    var map = {
      event_card: "مناسبة عائلية",
      family_event: "مناسبة عائلية",
      event_request: "طلب إضافة مناسبة",
      occasion: "مناسبة عائلية",
      patient: "حالة صحية",
      event_death: "إشعار وفاة",
      tree_card: "طلب إضافة فرد",
      tree_edit: "طلب تصحيح بيانات",
      memory_card: "طلب ذكرى",
      special_card: "طلب بطاقة",
      tree_founder: "طلب مؤسس في الشجرة",
      org_role: "طلب عضوية/دور",
      tree_delegate: "طلب مندوب شجرة",
      events_delegate: "طلب مندوب مناسبات",
    };
    return map[k] || "طلب محتوى عائلي";
  }

  /** Short optional notify for submitter only. */
  function statusUpdateNotifyCopy(kind, status) {
    var st = normalizeStatus(status);
    var label = kindLabelAr(kind);
    if (st === "approved") {
      if (isPrivilegeKind(kind)) return MSG.APPROVED_PRIVILEGE;
      return "تحديث على طلبك: تمت الموافقة على " + label + ".";
    }
    if (st === "rejected") {
      return "تحديث على طلبك: تم رفض " + label + ".";
    }
    return MSG.PENDING_LONG;
  }

  function isSafeArabicUserReason(raw) {
    var s = text(raw);
    if (!s || s.length < 2 || s.length > 280) return false;
    if (looksTechnical(s)) return false;
    return /[\u0600-\u06FF]/.test(s);
  }

  function safeRejectionReason(reason) {
    return isSafeArabicUserReason(reason) ? text(reason) : "";
  }

  function mapTechnicalErrorToArabic(error, fallback) {
    var fb = text(fallback) || MSG.GENERIC_SUBMIT_ERROR;
    if (error == null || error === "") return fb;
    var msg = "";
    if (typeof error === "string") msg = error;
    else if (error && typeof error === "object") {
      msg = text(
        error.message_ar ||
          error.message ||
          error.error_description ||
          error.error ||
          error.details ||
          error.hint ||
          ""
      );
      if (!msg && error.context) {
        try {
          msg = text(String(error.context.statusText || error.context));
        } catch (_) {}
      }
    } else {
      msg = text(error);
    }
    if (!msg) return fb;
    if (isSafeArabicUserReason(msg) && !looksTechnical(msg)) return msg;
    var low = msg.toLowerCase();
    if (
      /failed to send a request to the edge function|functionshttperror|edge function/i.test(
        low
      )
    ) {
      return "تعذر إرسال الإشعار حاليًا. إن كان الطلب محفوظًا فلا حاجة لإعادة الإرسال.";
    }
    if (/failed to fetch|networkerror|cors|timeout|network/i.test(low)) {
      return "تعذر الاتصال حاليًا. تحقق من الشبكة ثم حاول مرة أخرى.";
    }
    if (/duplicate|unique|already exists|23505/i.test(low)) {
      return MSG.DUPLICATE_PENDING;
    }
    if (/permission|rls|42501|not authorized|jwt/i.test(low)) {
      return "تعذر إكمال العملية بسبب صلاحية غير كافية. حاول لاحقًا.";
    }
    if (/not configured|missing.*key|service.?role/i.test(low)) {
      return fb;
    }
    try {
      console.warn("[user-facing-request-messages] scrubbed error", msg);
    } catch (_) {}
    return fb;
  }

  /**
   * @param {string} kind request kind (tree_card, event_card, …)
   * @param {string} status pending|approved|rejected|submit_success|notify_failure|scheduled|visible|ended|…
   * @param {{ reason?: string, includeClarification?: boolean, notifyFailed?: boolean }} [opts]
   */
  function userFacingRequestMessage(kind, status, opts) {
    var options = opts || {};
    var st = normalizeStatus(status);
    if (st === "submit_success") {
      if (options.notifyFailed) {
        return MSG.SUBMIT_SUCCESS + " " + MSG.NOTIFY_FAILURE_AFTER_SAVE;
      }
      return MSG.SUBMIT_SUCCESS;
    }
    if (st === "notify_failure") return MSG.NOTIFY_FAILURE_AFTER_SAVE;
    if (st === "pending") return MSG.PENDING_LONG;
    if (st === "scheduled") return MSG.CHIP_SCHEDULED;
    if (st === "deferred") return MSG.CHIP_DEFERRED;
    if (st === "visible") return MSG.CHIP_VISIBLE;
    if (st === "ended") return MSG.CHIP_ENDED;
    if (st === "approved") {
      // Content/homepage: «تمت الموافقة على طلبك» — never «طلب المندوب».
      var base = isPrivilegeKind(kind) ? MSG.APPROVED_PRIVILEGE : MSG.APPROVED_LONG;
      if (options.includeClarification === false) return base;
      return base + " " + approvedClarification(kind);
    }
    if (st === "rejected") {
      var reason = safeRejectionReason(options.reason);
      return reason ? MSG.REJECTED_LONG + " " + reason : MSG.REJECTED_LONG;
    }
    return MSG.PENDING_LONG;
  }

  /** Compact status chip / طلباتي label (no long clarification). */
  function statusChipLabel(status, kind, eventRow) {
    var Vis =
      (typeof root !== "undefined" && root.AlzidanEventVisibility) ||
      (typeof window !== "undefined" && window.AlzidanEventVisibility) ||
      null;
    if (
      Vis &&
      typeof Vis.deriveSubmitterRequestStatus === "function" &&
      (kind || eventRow)
    ) {
      var derived = Vis.deriveSubmitterRequestStatus(
        { status: status, kind: kind },
        eventRow || null
      );
      if (derived && derived.label) return derived.label;
    }
    var st = normalizeStatus(status);
    if (st === "approved") return MSG.CHIP_APPROVED;
    if (st === "rejected") return MSG.CHIP_REJECTED;
    if (st === "scheduled") return MSG.CHIP_SCHEDULED;
    if (st === "deferred") return MSG.CHIP_DEFERRED;
    if (st === "visible") return MSG.CHIP_VISIBLE;
    if (st === "ended") return MSG.CHIP_ENDED;
    if (st === "submit_success") return MSG.SUBMIT_SUCCESS;
    return MSG.CHIP_PENDING;
  }

  /**
   * Compose UI after a successful insert (request ok regardless of notify).
   * @returns {{ ok: true, requestOk: true, notifyOk: boolean, primary: string, notifyNote: string, full: string }}
   */
  function composeSubmitSuccess(opts) {
    var options = opts || {};
    var notifyOk = options.notifyOk !== false && !options.notifyFailed;
    var primary = MSG.SUBMIT_SUCCESS;
    var notifyNote = notifyOk ? "" : MSG.NOTIFY_FAILURE_AFTER_SAVE;
    return {
      ok: true,
      requestOk: true,
      notifyOk: !!notifyOk,
      primary: primary,
      notifyNote: notifyNote,
      full: notifyNote ? primary + " " + notifyNote : primary,
    };
  }

  /** True when notify result means email soft-failure (request still saved). */
  function didNotifyFail(notifyResult) {
    if (!notifyResult) return false;
    if (notifyResult.notifyFailed === true) return true;
    // Prefer explicit emailOk when present — email failure is the user-facing soft note.
    if (Object.prototype.hasOwnProperty.call(notifyResult, "emailOk")) {
      return notifyResult.emailOk === false;
    }
    if (notifyResult.ok === false) return true;
    return false;
  }

  var api = {
    MESSAGES: MSG,
    userFacingRequestMessage: userFacingRequestMessage,
    statusChipLabel: statusChipLabel,
    statusUpdateNotifyCopy: statusUpdateNotifyCopy,
    kindLabelAr: kindLabelAr,
    mapTechnicalErrorToArabic: mapTechnicalErrorToArabic,
    safeRejectionReason: safeRejectionReason,
    isSafeArabicUserReason: isSafeArabicUserReason,
    looksTechnical: looksTechnical,
    composeSubmitSuccess: composeSubmitSuccess,
    didNotifyFail: didNotifyFail,
    approvedClarification: approvedClarification,
    isPrivilegeKind: isPrivilegeKind,
    isPublishKind: isPublishKind,
  };

  root.AlzidanUserFacingRequestMessages = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
