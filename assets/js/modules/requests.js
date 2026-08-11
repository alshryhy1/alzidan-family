(() => {
  "use strict";

  function requestStatusLabel(status, row) {
    const Vis = window.AlzidanEventVisibility || null;
    if (row && Vis && typeof Vis.deriveReviewerRequestStatus === "function") {
      const derived = Vis.deriveReviewerRequestStatus(row, null);
      if (derived && derived.label) return derived.label;
    }
    const value = String(status || "").trim();
    if (value === "pending") return "بانتظار الإجراء";
    if (value === "approved") return "تم القبول";
    if (value === "rejected") return "تم الرفض";
    if (value === "submitted") return "مُقدَّم";
    if (value === "assigned") return "مُعيَّن";
    if (value === "in_review") return "قيد المراجعة";
    if (value === "needs_changes") return "يحتاج تعديل";
    if (value === "applied") return "مُطبَّق";
    if (value === "done") return "مكتمل";
    if (value === "scheduled") return "مقبول — مجدول للظهور";
    if (value === "visible") return "مقبول — منشور / ظاهر الآن";
    if (value === "ended") return "مقبول — منتهٍ";
    return value || "-";
  }



  const Core = window.AlzidanAdminCore || {};
  const {
    formatDateTimeArSaVerbose,
    coerceRpcId,
    kindLabel,
    statusLabel,
    renderEmpty,
    tokenFromRpcResult,
  } = Core;

  function getClient() {
    const c = window.AlzidanAdminCore || {};
    return typeof c.getClient === "function" ? c.getClient() : null;
  }

  function getAdminToken() {
    const c = window.AlzidanAdminCore || {};
    if (typeof c.getAdminToken === "function") {
      return String(c.getAdminToken() || "").trim();
    }
    if (
      window.AlzidanAuth &&
      typeof window.AlzidanAuth.getAdminToken === "function"
    ) {
      return String(window.AlzidanAuth.getAdminToken() || "").trim();
    }
    return "";
  }

  
  function scrubAdminUserError(err, fallback) {
    var U =
      (typeof window !== "undefined" && window.AlzidanUserFacingRequestMessages) ||
      null;
    if (U && typeof U.mapTechnicalErrorToArabic === "function") {
      return U.mapTechnicalErrorToArabic(err, fallback || "تعذر إكمال العملية.");
    }
    var fb = String(fallback || "تعذر إكمال العملية.");
    var msg = "";
    if (typeof err === "string") msg = err;
    else if (err && typeof err === "object")
      msg = String(err.message || err.details || err.error || "");
    if (!msg) return fb;
    if (/Failed to|Edge Function|not allowed|PGRST|permission denied|JWT|schema cache|row-level|Supabase|__JSON__/i.test(msg))
      return fb;
    if (/[A-Za-z]{8,}/.test(msg) && !/[؀-ۿ]/.test(msg)) return fb;
    return msg;
  }

function showAlert(kind, msg) {
    const c = window.AlzidanAdminCore || {};
    if (typeof c.showAlert === "function") c.showAlert(kind, msg);
    const sbStatus = document.getElementById("sb-status");
    if (sbStatus) {
      sbStatus.textContent = String(msg || "");
      sbStatus.style.color = kind === "error" ? "#991b1b" : "#065f46";
    }
    const alertEl = document.getElementById("alert");
    if (alertEl && kind === "error") {
      try {
        alertEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
      } catch (_) {}
    }
  }

  function hideAlert() {
    const c = window.AlzidanAdminCore || {};
    if (typeof c.hideAlert === "function") c.hideAlert();
  }

  /** Soft end-user notify after decision — SUBMITTER only via scrubbed structured fields. */
  async function notifyRequesterStatusChanged(sb, row, status, reason) {
    if (!sb || !row) return;
    const Safe =
      (typeof window !== "undefined" && window.AlzidanSafeRequestNotify) || null;
    const kind = String(row.kind || "").trim().toLowerCase();
    const st = String(status || "").trim().toLowerCase();

    let rec;
    if (Safe && typeof Safe.scrubRecordForNotify === "function") {
      rec = Safe.scrubRecordForNotify(
        Object.assign({}, row, {
          status: st,
          reject_reason: reason || row.reject_reason || null,
        }),
      );
    } else {
      if (
        kind === "events_audit" ||
        kind === "tree_audit" ||
        kind.endsWith("_audit")
      ) {
        return;
      }
      rec = {
        request_id: row.request_id || null,
        kind: row.kind || "",
        branch_key: row.branch_key || "",
        status: st,
        email: String(row.email || "").trim() || null,
        phone: String(row.phone || "").trim() || null,
        reject_reason: reason || row.reject_reason || null,
        name: row.name || null,
        person: row.name || null,
      };
    }

    if (Safe && typeof Safe.safeRenderOutbound === "function") {
      const preview = Safe.safeRenderOutbound({
        mode: "status_changed",
        kind: rec.kind,
        status: rec.status,
        branch_key: rec.branch_key,
        person: rec.person || rec.name,
        reject_reason: rec.reject_reason,
        audience: "submitter",
      });
      if (!preview) {
        try {
          console.warn("[status_changed] safe_render_blocked", rec.kind, rec.status);
        } catch (_) {}
        return;
      }
    }

    if (st !== "approved" && st !== "rejected" && st !== "deferred") return;

    try {
      if (String(rec.email || "").trim()) {
        await sb.functions.invoke("alzidan-email-notify", {
          body: { mode: "status_changed", record: rec },
        });
      }
    } catch (e) {
      try {
        console.warn("[status_changed email]", e);
      } catch (_) {}
    }
    try {
      if (String(rec.phone || "").trim()) {
        await sb.functions.invoke("alzidan-push-notify", {
          body: { mode: "status_changed", record: rec },
        });
      }
    } catch (e) {
      try {
        console.warn("[status_changed push]", e);
      } catch (_) {}
    }
  }

  function requestActions() {
    return window.AlzidanRequestActions || {};
  }

  const requestsBody = document.getElementById("requests-body");
  const filterStatus = document.getElementById("filter-status");
  const filterKind = document.getElementById("filter-kind");
  const requestSearchInput = document.getElementById("request-search");
  const requestsPageSizeSelect = document.getElementById("requests-page-size");
  const requestsPrevPageBtn = document.getElementById("requests-prev-page");
  const requestsNextPageBtn = document.getElementById("requests-next-page");
  const requestsPageInfo = document.getElementById("requests-page-info");
  let requestsQualityFilterSelect = null;

  let requestsAllRows = [];
  let requestsCurrentPage = 1;


  function isSecretResetRequest(row) {
    const kind = String((row && row.kind) || "").trim();
    const rtype = String((row && row.request_type) || "").trim();
    return kind === "delegate_secret_reset" || rtype === "delegate_secret_reset";
  }

  function isDelegateAccessKind(kind) {
    const k = String(kind || "").trim();
    return k === "tree_delegate" || k === "events_delegate";
  }

  function delegateRequestBaseId(requestId) {
    return String(requestId || "")
      .trim()
      .replace(/-TREE$/i, "")
      .replace(/-EVENTS$/i, "");
  }

  function parseDelegateRolesFromRow(row) {
    const env = parseRequestEnvelopeState(row && row.message);
    const roles = [];
    if (env && env.valid && env.parsed && Array.isArray(env.parsed.delegate_roles)) {
      env.parsed.delegate_roles.forEach((r) => {
        const k = String(r || "").trim();
        if ((k === "tree_delegate" || k === "events_delegate") && !roles.includes(k)) {
          roles.push(k);
        }
      });
    }
    const kind = String(row && row.kind ? row.kind : "").trim();
    if ((kind === "tree_delegate" || kind === "events_delegate") && !roles.includes(kind)) {
      roles.push(kind);
    }
    return roles;
  }

  async function approveDelegateSiblingRequests(sb, token, row) {
    const kind = String(row && row.kind ? row.kind : "").trim();
    if (kind !== "tree_delegate" && kind !== "events_delegate") {
      return { approvedIds: [], activateId: null };
    }
    const phone = String(row.phone || "").trim();
    const branch = String(row.branch_key || "").trim();
    const baseId = delegateRequestBaseId(row.request_id);
    const siblingKind = kind === "tree_delegate" ? "events_delegate" : "tree_delegate";
    const roles = parseDelegateRolesFromRow(row);
    const wantsSibling =
      roles.includes(siblingKind) || /-(TREE|EVENTS)$/i.test(String(row.request_id || ""));
    if (!wantsSibling || !phone || !branch || !baseId) {
      return { approvedIds: [], activateId: null };
    }

    let siblings = [];
    try {
      const { data, error } = await sb.rpc("admin_list_requests", {
        p_token: token,
        p_status: "pending",
        p_kind: siblingKind,
        p_limit: 200,
      });
      if (!error && Array.isArray(data)) siblings = data;
    } catch (_) {}

    const matched = siblings.filter((s) => {
      if (String(s.branch_key || "").trim() !== branch) return false;
      if (String(s.phone || "").trim() !== phone) return false;
      const sid = String(s.request_id || "");
      return (
        delegateRequestBaseId(sid) === baseId ||
        sid === baseId + (siblingKind === "tree_delegate" ? "-TREE" : "-EVENTS")
      );
    });

    const approvedIds = [];
    for (const sib of matched) {
      const sibId = coerceRpcId(sib.id != null ? sib.id : sib.request_id);
      if (!sibId) continue;
      try {
        const { data, error } = await sb.rpc("admin_set_request_status_v2", {
          p_token: token,
          p_id: sibId,
          p_status: "approved",
        });
        if (!error && data !== false) approvedIds.push(String(sibId));
      } catch (_) {}
    }
    return {
      approvedIds,
      activateId: approvedIds.length ? approvedIds[approvedIds.length - 1] : null,
    };
  }

  function normalizeAdminRequestEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function isLikelyAdminRequestEmail(value) {
    const s = normalizeAdminRequestEmail(value);
    if (window.AlzidanAdminCore && typeof window.AlzidanAdminCore.isLikelyEmail === "function") {
      return !!window.AlzidanAdminCore.isLikelyEmail(s);
    }
    return !!(s && s.includes("@") && s.includes(".") && s.length >= 6);
  }

  function updateEmailInRequestMessage(message, email) {
    const em = normalizeAdminRequestEmail(email);
    const text = String(message || "");
    const marker = "__JSON__:";
    const idx = text.indexOf(marker);
    let visible = idx >= 0 ? text.slice(0, idx).trimEnd() : text;
    const jsonRaw = idx >= 0 ? text.slice(idx + marker.length).trim() : "";

    if (/^البريد الإلكتروني:\s*.*$/m.test(visible)) {
      visible = visible.replace(/^البريد الإلكتروني:\s*.*$/m, "البريد الإلكتروني: " + em);
    } else if (/^البريد:\s*.*$/m.test(visible)) {
      visible = visible.replace(/^البريد:\s*.*$/m, "البريد: " + em);
    } else if (/^الايميل:\s*.*$/m.test(visible)) {
      visible = visible.replace(/^الايميل:\s*.*$/m, "الايميل: " + em);
    } else if (em && /^الجوال:\s*.*$/m.test(visible)) {
      visible = visible.replace(/^(الجوال:\s*.*)$/m, "$1\nالبريد: " + em);
    } else if (em) {
      visible = (visible ? visible + "\n" : "") + "البريد: " + em;
    }

    if (jsonRaw) {
      try {
        const payload = JSON.parse(jsonRaw);
        if (payload && typeof payload === "object") {
          payload.email = em;
          return (
            visible +
            "\n\n" +
            marker +
            "\n" +
            JSON.stringify(payload, null, 2)
          );
        }
      } catch (_) {}
    }
    return visible;
  }

  async function persistDelegateRequestEmail(row, email) {
    const em = normalizeAdminRequestEmail(email);
    if (!isLikelyAdminRequestEmail(em)) {
      return { ok: false, message: "البريد الإلكتروني غير صحيح." };
    }
    const sb = getClient();
    if (!sb) return { ok: false, message: "تعذر الاتصال." };
    const token = getAdminToken();
    if (!token) return { ok: false, message: "يلزم تسجيل الدخول أولاً." };
    const id = coerceRpcId(row && (row.id != null ? row.id : row.request_id));
    if (!id) return { ok: false, message: "بيانات الطلب ناقصة." };
    const branchKey =
      typeof normalizeTreeCardText === "function"
        ? normalizeTreeCardText(row.branch_key || "")
        : String(row.branch_key || "").trim();
    if (!branchKey) {
      return { ok: false, message: "الفرع مطلوب قبل حفظ بريد المندوب." };
    }
    const message = updateEmailInRequestMessage(row.message, em);
    const { data, error } = await sb.rpc("admin_update_request_branch_v1", {
      p_token: token,
      p_id: String(id),
      p_old_branch_key: branchKey,
      p_branch_key: branchKey,
      p_name: row.name || null,
      p_phone: row.phone || null,
      p_email: em,
      p_message: message || null,
      p_old_tree_rows: [],
      p_new_tree_rows: [],
    });
    if (error) {
      return {
        ok: false,
        message: "تعذر حفظ البريد حالياً، حاول لاحقاً أو تواصل مع الإدارة.",
      };
    }
    if (data !== true) {
      return {
        ok: false,
        message: "لم يتم حفظ البريد. يمكن تعديل الطلبات المنتظرة أو المقبولة فقط.",
      };
    }
    row.email = em;
    row.message = message;
    // Sync email onto delegates_v2 when the request is already approved.
    if (String(row.status || "") === "approved") {
      try {
        await sb.rpc("admin_delegates_v2_activate_from_request_v1", {
          p_token: token,
          p_id: String(id),
        });
      } catch (_) {}
    }
    return { ok: true, email: em };
  }

  function normalizeRequestDigits(value) {
    return String(value || "")
      .replace(/[٠-٩]/g, (d) => "0123456789"["٠١٢٣٤٥٦٧٨٩".indexOf(d)])
      .replace(/[۰-۹]/g, (d) => "0123456789"["۰۱۲۳۴۵۶۷۸۹".indexOf(d)]);
  }

  function extractProposedSecretFromMessage(message) {
    const text = String(message || "");
    const m =
      /الرقم السري المقترح:\s*(.+)$/m.exec(text) ||
      /الرقم السري:\s*(.+)$/m.exec(text);
    return m ? normalizeRequestDigits(String(m[1] || "")).trim() : "";
  }

  function renderSecretResetCard(actions, row, approveBtn, rejectBtn) {
    actions.innerHTML = "";
    const title = document.createElement("div");
    title.className = "hint";
    title.style.fontWeight = "800";
    title.style.marginBottom = "6px";
    title.textContent = "طلب إعادة تعيين الرقم السري";
    const sub = document.createElement("div");
    sub.className = "hint";
    sub.style.marginBottom = "8px";
    sub.textContent =
      (row.name || "مندوب") +
      " · " +
      (row.branch_key || "—") +
      " · بانتظار الإدارة";
    approveBtn.textContent = "اعتماد وإصدار رقم سري جديد";
    approveBtn.className = "btn btn-primary btn-sm";
    rejectBtn.textContent = "رفض";
    rejectBtn.className = "btn btn-outline btn-sm";
    const canApprove = row.status !== "approved" && row.status !== "rejected";
    const canReject = row.status !== "rejected";
    approveBtn.disabled = !canApprove;
    rejectBtn.disabled = !canReject;
    actions.appendChild(title);
    actions.appendChild(sub);
    actions.appendChild(approveBtn);
    actions.appendChild(rejectBtn);
  }

  function grantLabel(value) {
    const key = String(value || "").trim();
    if (key === "events_delegate") return "مندوب المناسبات";
    if (key === "tree_delegate") return "مندوب الشجرة";
    if (key === "member_registration") return "تسجيل عضو";
    return key || "غير محدد";
  }

  function tryFormatJsonRequestMessage(message) {
    const text = String(message || "").trim();
    if (!text) return "";
    if (!text.startsWith("{") || !text.endsWith("}")) return "";

    try {
      const obj = JSON.parse(text);
      if (!obj || typeof obj !== "object") return "";

      const kind = String(obj.kind || "").trim();
      if (kind === "admin_grant") {
        return "طلب صلاحية إداري" +
          "\n" +
          "نوع الصلاحية: " + grantLabel(obj.grant);
      }

      const lines = [];
      if (kind) lines.push("النوع: " + kindLabel(kind));
      if (obj.grant) lines.push("الصلاحية: " + grantLabel(obj.grant));
      if (obj.at) lines.push("وقت العملية: " + formatDateTimeArSaVerbose(obj.at));
      return lines.join("\n").trim();
    } catch (e) {
      return "";
    }
  }

  function buildRequestDetailsText(row) {
    const rawMessage = requestActions().requestMessageWithoutMediaLinks
      ? requestActions().requestMessageWithoutMediaLinks(row.message || "")
      : String(row.message || "");
    const jsonMarker = "__JSON__:";
    const markerIndex = rawMessage.indexOf(jsonMarker);
    const safeMessage = markerIndex >= 0 ? rawMessage.slice(0, markerIndex).trimEnd() : rawMessage;
    const prettyJsonMessage = tryFormatJsonRequestMessage(safeMessage);

    const lines = [
      row.request_id ? "رقم الطلب: " + row.request_id : "",
      row.branch_key ? "الفرع: " + row.branch_key : "",
      row.phone ? "الجوال: " + row.phone : "",
      row.email ? "البريد: " + row.email : "",
      row.created_at
        ? "التاريخ الكامل: " + formatDateTimeArSaVerbose(row.created_at)
        : "",
      "",
      prettyJsonMessage || safeMessage,
    ].filter(
      (line, index, arr) => line || (index > 0 && index < arr.length - 1),
    );
    return lines.join("\n").trim() || "لا توجد تفاصيل إضافية.";
  }
  function buildRequestSourceText(row) {
    const raw = String(row && row.message ? row.message : "").trim();
    return raw || "لا يوجد مصدر خام لهذا الطلب.";
  }
  function parseRequestEnvelopeState(message) {
    const text = String(message || "");
    const marker = "__JSON__:";
    const idx = text.indexOf(marker);
    if (idx < 0) return { hasMarker: false, parsed: null, valid: false };
    const raw = text.slice(idx + marker.length).trim();
    if (!raw) return { hasMarker: true, parsed: null, valid: false };
    try {
      const parsed = JSON.parse(raw);
      return { hasMarker: true, parsed, valid: true };
    } catch (e) {
      return { hasMarker: true, parsed: null, valid: false };
    }
  }
  function readRequestLineValue(message, labels) {
    const wanted = (Array.isArray(labels) ? labels : [labels]).map((x) =>
      String(x || "").trim(),
    );
    const lines = String(message || "").split(/\r?\n/);
    for (const rawLine of lines) {
      const line = String(rawLine || "").trim();
      for (const label of wanted) {
        const prefix = label + ":";
        if (line.startsWith(prefix)) return line.slice(prefix.length).trim();
      }
    }
    return "";
  }
  function parseEventPayloadFromRow(row) {
    const Events = window.AlzidanEvents || {};
    if (typeof Events.parseEventCardMessage !== "function") {
      return { envelope: null, type: "", person: "", date: "", text: "", image: "", video: "" };
    }
    const parsed = Events.parseEventCardMessage(row);
    return {
      envelope: parsed.envelope,
      type: parsed.type,
      person: parsed.person,
      date: parsed.dateLabel || parsed.eventDate,
      text: parsed.text || parsed.detailsText,
      image: parsed.imageUrl,
      video: parsed.videoUrl,
    };
  }
  function parseSpecialCardPayloadFromRow(row) {
    const env = parseRequestEnvelopeState(row && row.message);
    const parsed =
      env && env.valid && env.parsed && typeof env.parsed === "object"
        ? env.parsed
        : {};
    const media =
      requestActions && typeof requestActions().extractRequestMediaLinks === "function"
        ? requestActions().extractRequestMediaLinks(row && row.message)
        : { image: "", video: "" };
    const cardType =
      String(parsed.card_type || "").trim() ||
      readRequestLineValue(row && row.message, ["نوع البطاقة"]);
    const person =
      String(parsed.person_name || "").trim() ||
      readRequestLineValue(row && row.message, ["الشخص"]);
    const imageUrl =
      String(parsed.imageUrl || parsed.image_url || "").trim() ||
      String(media.image || "").trim();
    return {
      card_type: String(parsed.card_type || "").trim(),
      card_type_label:
        String(parsed.card_type_label || "").trim() || cardType,
      person_name: person,
      person_id: String(parsed.person_id || "").trim(),
      imageUrl: imageUrl,
      notes: String(parsed.notes || "").trim(),
      branch_key:
        String(parsed.branch_key || (row && row.branch_key) || "").trim(),
    };
  }
  function openSpecialCardCmsFromRequest(row) {
    const payload = parseSpecialCardPayloadFromRow(row);
    const filler =
      (window.AlzidanAdminCore &&
        window.AlzidanAdminCore.fillSpecialCardFromHomeRequest) ||
      null;
    if (typeof filler !== "function") {
      return {
        ok: false,
        message: "نموذج البطاقات الخاصة غير جاهز. حدّث الصفحة ثم أعد المحاولة.",
      };
    }
    return filler(payload) || { ok: true };
  }
  function normalizeQualityKeyText(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
      .replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
      .replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
      .replace(/\s+/g, " ")
      .trim();
  }
  function buildRequestQualityContext(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const counts = new Map();
    list.forEach((row) => {
      const kind = String(row && row.kind ? row.kind : "").trim();
      if (kind !== "event_card") return;
      const parsed = parseEventPayloadFromRow(row);
      const key = [
        "event_card",
        normalizeQualityKeyText(row && row.branch_key ? row.branch_key : ""),
        normalizeQualityKeyText(parsed.person),
        normalizeQualityKeyText(parsed.date),
      ].join("|");
      if (!key.replace(/\|/g, "").trim()) return;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return { duplicateCounts: counts };
  }
  function classifyRequestQuality(row, context) {
    const kind = String(row && row.kind ? row.kind : "").trim();
    const msg = String(row && row.message ? row.message : "");
    const hasBranch = !!String(row && row.branch_key ? row.branch_key : "").trim();
    const hasSender = !!String(row && (row.name || row.phone || row.email) ? (row.name || row.phone || row.email) : "").trim();
    const env = parseRequestEnvelopeState(msg);

    if (!msg.trim()) return { key: "missing", label: "ناقص", reason: "الرسالة فارغة." };

    if (kind === "event_card") {
      const parsed = parseEventPayloadFromRow(row);
      const missing = [];
      if (!hasBranch) missing.push("الفرع");
      if (!parsed.person) missing.push("الاسم");
      if (!parsed.date) missing.push("التاريخ");
      if (!parsed.text) missing.push("النص");

      if (env.hasMarker && !env.valid) {
        return { key: "review", label: "يحتاج مراجعة", reason: "يوجد JSON لكنه غير صالح للقراءة." };
      }
      if (missing.length) {
        return { key: "missing", label: "ناقص", reason: "حقول ناقصة: " + missing.join("، ") };
      }

      const dupKey = [
        "event_card",
        normalizeQualityKeyText(row && row.branch_key ? row.branch_key : ""),
        normalizeQualityKeyText(parsed.person),
        normalizeQualityKeyText(parsed.date),
      ].join("|");
      const dupCount = context && context.duplicateCounts ? (context.duplicateCounts.get(dupKey) || 0) : 0;
      if (dupCount > 1) {
        return { key: "review", label: "يحتاج مراجعة", reason: "يوجد طلب مكرر بنفس الاسم والتاريخ في نفس الفرع." };
      }

      if (!parsed.image && !parsed.video) {
        return { key: "review", label: "يحتاج مراجعة", reason: "لا توجد مرفقات (صورة/فيديو)." };
      }

      return {
        key: "complete",
        label: "مكتمل",
        reason: "البيانات الأساسية مكتملة مع عدم وجود تكرار ظاهر.",
      };
    }

    if (kind === "tree_card") {
      if (env.hasMarker && !env.valid) {
        return { key: "review", label: "يحتاج مراجعة", reason: "بيانات الشجرة بصيغة JSON غير صالحة." };
      }
      if (env.valid && hasBranch) {
        return { key: "complete", label: "مكتمل", reason: "طلب الشجرة يحتوي JSON صالح." };
      }
      return hasBranch
        ? { key: "review", label: "يحتاج مراجعة", reason: "لا توجد بيانات JSON للشجرة." }
        : { key: "missing", label: "ناقص", reason: "الفرع غير محدد." };
    }

    if (!hasBranch && !hasSender) {
      return { key: "missing", label: "ناقص", reason: "الطلب يفتقد بيانات تعريف أساسية." };
    }
    return { key: "complete", label: "مكتمل", reason: "لا توجد نواقص ظاهرة في الحقول العامة." };
  }
  function createRequestQualityPill(row, context) {
    const quality = classifyRequestQuality(row, context);
    const pill = document.createElement("span");
    pill.style.display = "inline-flex";
    pill.style.alignItems = "center";
    pill.style.marginTop = "6px";
    pill.style.padding = "2px 9px";
    pill.style.borderRadius = "999px";
    pill.style.fontSize = "11px";
    pill.style.fontWeight = "800";
    pill.style.border = "1px solid transparent";
    pill.textContent = "جودة: " + quality.label;
    pill.title = quality.reason || "";

    if (quality.key === "complete") {
      pill.style.background = "#ecfdf5";
      pill.style.color = "#065f46";
      pill.style.borderColor = "#a7f3d0";
    } else if (quality.key === "missing") {
      pill.style.background = "#fef2f2";
      pill.style.color = "#991b1b";
      pill.style.borderColor = "#fecaca";
    } else {
      pill.style.background = "#fff7ed";
      pill.style.color = "#9a3412";
      pill.style.borderColor = "#fed7aa";
    }
    return pill;
  }
  function ensureQualityFilterControl() {
    if (requestsQualityFilterSelect) return requestsQualityFilterSelect;

    const section = document.getElementById("admin-requests-section");
    if (!section) return null;
    const search = document.getElementById("request-search");
    if (!search || !search.parentElement) return null;

    const wrapper = document.createElement("label");
    wrapper.style.display = "inline-flex";
    wrapper.style.alignItems = "center";
    wrapper.style.gap = "6px";
    wrapper.style.marginInlineStart = "8px";
    wrapper.style.flexWrap = "nowrap";
    wrapper.style.whiteSpace = "nowrap";

    const text = document.createElement("span");
    text.textContent = "جودة الطلب";
    text.style.fontWeight = "800";
    text.style.fontSize = "12px";

    const select = document.createElement("select");
    select.id = "requests-quality-filter";
    select.className = "input";
    select.style.minWidth = "130px";
    select.innerHTML =
      '<option value="all">كل الجودات</option>' +
      '<option value="complete">مكتمل</option>' +
      '<option value="missing">ناقص</option>' +
      '<option value="review">يحتاج مراجعة</option>';

    wrapper.appendChild(text);
    wrapper.appendChild(select);
    search.parentElement.appendChild(wrapper);

    requestsQualityFilterSelect = select;
    requestsQualityFilterSelect.addEventListener("change", () => {
      requestsCurrentPage = 1;
      renderRequestsPage();
    });
    return requestsQualityFilterSelect;
  }
  function buildRequestDetailsView(row) {
    const wrap = document.createElement("div");

    const tabs = document.createElement("div");
    tabs.style.display = "flex";
    tabs.style.gap = "6px";
    tabs.style.marginBottom = "8px";

    const summaryBtn = document.createElement("button");
    summaryBtn.type = "button";
    summaryBtn.className = "btn btn-outline btn-sm";
    summaryBtn.textContent = "الملخص";

    const sourceBtn = document.createElement("button");
    sourceBtn.type = "button";
    sourceBtn.className = "btn btn-outline btn-sm";
    sourceBtn.textContent = "المصدر";

    tabs.appendChild(summaryBtn);
    tabs.appendChild(sourceBtn);

    const summaryPanel = document.createElement("div");
    summaryPanel.style.lineHeight = "1.65";

    const kindKey = String(row && row.kind ? row.kind : "");
    const isDelegateReq = isDelegateAccessKind(kindKey);
    const emailDisplay = String(row && row.email ? row.email : "").trim();
    const summaryData = [
      ["رقم الطلب", String(row && row.request_id ? row.request_id : "")],
      ["نوع الطلب", kindLabel(kindKey)],
      ["الفرع", String(row && row.branch_key ? row.branch_key : "")],
      ["الاسم", String(row && row.name ? row.name : "")],
      ["الجوال", String(row && row.phone ? row.phone : "")],
      [
        "البريد الإلكتروني",
        emailDisplay || (isDelegateReq ? "لم يُسجّل — لن تصله إشعارات طلبات الفرع" : ""),
      ],
      ["التاريخ", row && row.created_at ? formatDateTimeArSaVerbose(row.created_at) : ""],
    ];
    if (isDelegateReq) {
      const roles = parseDelegateRolesFromRow(row);
      if (roles.length) {
        summaryData.push([
          "الصلاحيات المطلوبة",
          roles
            .map((r) =>
              r === "tree_delegate"
                ? "مندوب الشجرة"
                : r === "events_delegate"
                  ? "مندوب المناسبات"
                  : r,
            )
            .join(" + "),
        ]);
      }
    }
    const eventData = parseEventPayloadFromRow(row);
    if (kindKey === "event_card") {
      summaryData.push(["نوع المناسبة", eventData.type || "غير محدد"]);
      summaryData.push(["صاحب المناسبة", eventData.person || "غير محدد"]);
      summaryData.push(["تاريخ المناسبة", eventData.date || "غير محدد"]);
      summaryData.push(["نص المناسبة", eventData.text || "غير متوفر"]);
      summaryData.push([
        "المرفقات",
        eventData.image || eventData.video
          ? [eventData.image ? "صورة" : "", eventData.video ? "فيديو" : ""]
              .filter(Boolean)
              .join(" + ")
          : "لا يوجد",
      ]);
    }
    if (kindKey === "special_card") {
      const cardData = parseSpecialCardPayloadFromRow(row);
      summaryData.push([
        "نوع البطاقة",
        cardData.card_type_label || cardData.card_type || "غير محدد",
      ]);
      summaryData.push(["الشخص", cardData.person_name || "غير محدد"]);
      if (cardData.notes) summaryData.push(["ملاحظات", cardData.notes]);
      summaryData.push([
        "المرفقات",
        cardData.imageUrl ? "صورة" : "لا يوجد",
      ]);
    }

    summaryData
      .filter((item) => {
        const key = String(item[0] || "");
        if (isDelegateReq && key === "البريد الإلكتروني") return true;
        return String(item[1] || "").trim();
      })
      .forEach((item) => {
        const rowEl = document.createElement("div");
        rowEl.style.marginBottom = "4px";
        const label = document.createElement("strong");
        label.textContent = item[0] + ": ";
        const value = document.createElement("span");
        value.textContent = item[1];
        rowEl.appendChild(label);
        rowEl.appendChild(value);
        summaryPanel.appendChild(rowEl);
      });

    if (isDelegateReq) {
      const emailEdit = document.createElement("div");
      emailEdit.className = "delegate-admin-email-edit";
      emailEdit.style.cssText =
        "margin-top:10px;padding:10px;border:1px solid rgba(4,120,87,0.18);border-radius:10px;background:#f8faf8;";
      const emailLabel = document.createElement("label");
      emailLabel.textContent = "البريد الإلكتروني (للإشعارات)";
      emailLabel.style.cssText = "display:block;font-size:12px;font-weight:700;margin-bottom:4px;color:#065f46;";
      const emailInput = document.createElement("input");
      emailInput.type = "email";
      emailInput.inputMode = "email";
      emailInput.autocomplete = "email";
      emailInput.dir = "ltr";
      emailInput.placeholder = "name@example.com";
      emailInput.value = emailDisplay;
      emailInput.dataset.delegateEmailInput = "1";
      emailInput.style.cssText = "width:100%;padding:8px 10px;border-radius:8px;border:1px solid #d1d5db;box-sizing:border-box;";
      const emailHint = document.createElement("div");
      emailHint.className = "hint";
      emailHint.style.marginTop = "4px";
      emailHint.textContent =
        "أدخِل أو عدّل البريد قبل القبول — يُحفظ في الطلب ويُزامن لحساب المندوب عند الاعتماد.";
      const emailSave = document.createElement("button");
      emailSave.type = "button";
      emailSave.className = "btn btn-outline btn-sm";
      emailSave.style.marginTop = "8px";
      emailSave.textContent = "حفظ البريد";
      emailSave.addEventListener("click", async () => {
        hideAlert();
        emailSave.disabled = true;
        const res = await persistDelegateRequestEmail(row, emailInput.value);
        emailSave.disabled = false;
        if (!res.ok) {
          showAlert("error", res.message || "تعذر حفظ البريد.");
          return;
        }
        showAlert("success", "تم حفظ بريد المندوب: " + res.email);
        await loadRequests();
      });
      emailEdit.appendChild(emailLabel);
      emailEdit.appendChild(emailInput);
      emailEdit.appendChild(emailHint);
      emailEdit.appendChild(emailSave);
      summaryPanel.appendChild(emailEdit);
    }

    if (!summaryPanel.childElementCount) {
      summaryPanel.style.whiteSpace = "pre-wrap";
      summaryPanel.textContent = buildRequestDetailsText(row);
    }

    const sourcePanel = document.createElement("pre");
    sourcePanel.style.whiteSpace = "pre-wrap";
    sourcePanel.style.lineHeight = "1.65";
    sourcePanel.style.margin = "0";
    sourcePanel.style.display = "none";
    sourcePanel.style.direction = "ltr";
    sourcePanel.textContent = buildRequestSourceText(row);

    function setView(mode) {
      const isSummary = mode === "summary";
      summaryPanel.style.display = isSummary ? "block" : "none";
      sourcePanel.style.display = isSummary ? "none" : "block";
      summaryBtn.className =
        "btn btn-sm " + (isSummary ? "btn-primary" : "btn-outline");
      sourceBtn.className =
        "btn btn-sm " + (isSummary ? "btn-outline" : "btn-primary");
    }

    summaryBtn.addEventListener("click", () => setView("summary"));
    sourceBtn.addEventListener("click", () => setView("source"));

    wrap.appendChild(tabs);
    wrap.appendChild(summaryPanel);
    wrap.appendChild(sourcePanel);
    requestActions().appendRequestMediaPreview(summaryPanel, row.message || "");
    setView("summary");
    return wrap;
  }
  function formatDateShortForRequests(value) {
    if (!value) return "";
    try {
      const d = new Date(value);
      if (isNaN(d.getTime())) return String(value || "");
      return d.toLocaleDateString("ar-SA", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
    } catch (e) {
      return String(value || "");
    }
  }
  function renderRequestRow(row, qualityContext) {
    if (!requestsBody) return;
    const tr = document.createElement("tr");
    function tdText(text) {
      const td = document.createElement("td");
      td.textContent = text || "";
      return td;
    }
    tr.appendChild(tdText(row.request_id || ""));
    const tdKind = document.createElement("td");
    const kindMain = document.createElement("div");
    kindMain.textContent = kindLabel(row.kind);
    tdKind.appendChild(kindMain);
    tdKind.appendChild(createRequestQualityPill(row, qualityContext));
    tr.appendChild(tdKind);
    tr.appendChild(tdText(row.branch_key || ""));
    tr.appendChild(tdText(row.name || ""));
    tr.appendChild(tdText(row.phone || ""));
    tr.appendChild(
      tdText(
        row.email ||
          (isDelegateAccessKind(row.kind) ? "لم يُسجّل" : ""),
      ),
    );
    const tdStatus = document.createElement("td");
    const pill = document.createElement("span");
    const displayStatus = String(row.wf_state || row.status || "").trim();
    const legacy = String(row.status || "").trim();
    pill.className =
      "status-pill " +
      (legacy === "approved" || displayStatus === "approved" || displayStatus === "applied" || displayStatus === "done"
        ? "status-approved"
        : legacy === "rejected" || displayStatus === "rejected"
          ? "status-rejected"
          : "status-pending");
    pill.textContent = requestStatusLabel(displayStatus || legacy, row);
    if (row.wf_state) pill.title = "Workflow: " + String(row.wf_state);
    const Vis = window.AlzidanEventVisibility || null;
    if (
      Vis &&
      typeof Vis.deriveReviewerRequestStatus === "function" &&
      (legacy === "approved" || displayStatus === "approved")
    ) {
      const derived = Vis.deriveReviewerRequestStatus(row, null);
      const visKey = String((derived && derived.key) || "").toLowerCase();
      if (visKey === "scheduled") pill.className = "status-pill status-scheduled";
      else if (visKey === "visible") pill.className = "status-pill status-approved";
      else if (visKey === "ended") pill.className = "status-pill status-ended";
      if (derived && derived.label) pill.textContent = derived.label;
    }
    tdStatus.appendChild(pill);
    tr.appendChild(tdStatus);
    const tdDate = document.createElement("td");
    if (row.created_at) {
      try {
        tdDate.textContent = formatDateShortForRequests(row.created_at);
      } catch (e) {
        tdDate.textContent = String(row.created_at || "");
      }
    } else {
      tdDate.textContent = "";
    }
    tr.appendChild(tdDate);
    const tdMsg = document.createElement("td");
    const det = document.createElement("details");
    det.className = "msg";
    const sum = document.createElement("summary");
    sum.textContent = "عرض";
    const body = buildRequestDetailsView(row);
    det.appendChild(sum);
    det.appendChild(body);
    tdMsg.appendChild(det);
    tr.appendChild(tdMsg);
    const tdActions = document.createElement("td");
    const actions = document.createElement("div");
    actions.className = "cell-actions";
    const approveBtn = document.createElement("button");
    approveBtn.type = "button";
    approveBtn.className = "btn btn-primary btn-sm";
    approveBtn.textContent = "قبول";
    const publishEventBtn = document.createElement("button");
    publishEventBtn.type = "button";
    publishEventBtn.className = "btn btn-primary btn-sm";
    publishEventBtn.textContent = "نشر";
    publishEventBtn.title = "نشر المناسبة في الويب والتطبيق";
    const fillSpecialCardBtn = document.createElement("button");
    fillSpecialCardBtn.type = "button";
    fillSpecialCardBtn.className = "btn btn-outline btn-sm";
    fillSpecialCardBtn.textContent = "تعبئة البطاقة";
    fillSpecialCardBtn.title =
      "تعبئة نموذج البطاقات الخاصة من هذا الطلب (مع الصورة إن وُجدت)";
    const rejectBtn = document.createElement("button");
    rejectBtn.type = "button";
    rejectBtn.className = "btn btn-outline btn-sm";
    rejectBtn.textContent = "رفض";
    const editBranchBtn = document.createElement("button");
    editBranchBtn.type = "button";
    editBranchBtn.className = "btn btn-outline btn-sm";
    editBranchBtn.textContent =
      row.kind === "tree_card" ? "تعديل كامل" : "تعديل الفرع";
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn btn-outline btn-sm btn-danger";
    deleteBtn.textContent = "حذف";
    const canApprove = row.status !== "approved";
    const canReject = row.status !== "rejected";
    approveBtn.disabled = !canApprove;
    rejectBtn.disabled = !canReject;
    editBranchBtn.disabled =
      row.status !== "pending" && row.status !== "approved";
    const reapplyBtn = document.createElement("button");
    reapplyBtn.type = "button";
    reapplyBtn.className = "btn btn-outline btn-sm";
    reapplyBtn.textContent = "إعادة تطبيق";
    reapplyBtn.title = "إعادة تطبيق بطاقة الشجرة دون تغيير الحالة (إصلاح يتيم)";
    const canReapply =
      row.kind === "tree_card" &&
      (row.status === "approved" || row.status === "pending");
    reapplyBtn.disabled = !canReapply;
    if (isSecretResetRequest(row)) {
      renderSecretResetCard(actions, row, approveBtn, rejectBtn);
    } else {
      if (isDelegateAccessKind(row.kind)) {
        const emailBox = document.createElement("div");
        emailBox.className = "delegate-admin-email";
        emailBox.style.cssText =
          "display:flex;flex-direction:column;gap:4px;min-width:190px;margin-bottom:8px;padding:8px;border:1px solid rgba(4,120,87,0.16);border-radius:10px;background:#f8faf8;";
        const emailLbl = document.createElement("label");
        emailLbl.textContent = "البريد الإلكتروني";
        emailLbl.style.cssText = "font-size:12px;font-weight:700;color:#065f46;";
        const emailInput = document.createElement("input");
        emailInput.type = "email";
        emailInput.inputMode = "email";
        emailInput.autocomplete = "email";
        emailInput.dir = "ltr";
        emailInput.placeholder = "name@example.com";
        emailInput.value = String(row.email || "");
        emailInput.dataset.delegateEmailInput = "1";
        emailInput.style.cssText =
          "width:100%;padding:7px 9px;border-radius:8px;border:1px solid #d1d5db;box-sizing:border-box;font-size:13px;";
        const emailSaveBtn = document.createElement("button");
        emailSaveBtn.type = "button";
        emailSaveBtn.className = "btn btn-outline btn-sm";
        emailSaveBtn.textContent = "حفظ البريد";
        emailSaveBtn.addEventListener("click", async () => {
          hideAlert();
          emailSaveBtn.disabled = true;
          const res = await persistDelegateRequestEmail(row, emailInput.value);
          emailSaveBtn.disabled = false;
          if (!res.ok) {
            showAlert("error", res.message || "تعذر حفظ البريد.");
            return;
          }
          showAlert("success", "تم حفظ بريد المندوب: " + res.email);
          await loadRequests();
        });
        emailBox.appendChild(emailLbl);
        emailBox.appendChild(emailInput);
        emailBox.appendChild(emailSaveBtn);
        actions.appendChild(emailBox);
      }
      actions.appendChild(approveBtn);
      actions.appendChild(rejectBtn);
      if (row.kind === "tree_card") actions.appendChild(reapplyBtn);
      if (row.kind === "event_card") {
        publishEventBtn.disabled = row.status === "rejected";
        publishEventBtn.title =
          row.status === "rejected"
            ? "الطلب مرفوض — احذفه أو أعد قبوله قبل النشر"
            : "نشر المناسبة في الويب والتطبيق";
        actions.appendChild(publishEventBtn);
      }
      if (row.kind === "special_card") actions.appendChild(fillSpecialCardBtn);
      actions.appendChild(editBranchBtn);
      actions.appendChild(deleteBtn);
    }
    tdActions.appendChild(actions);
    tr.appendChild(tdActions);
    editBranchBtn.addEventListener("click", async () => {
      hideAlert();
      if (row.kind === "tree_card") {
        try {
          if (
            !requestActions ||
            typeof requestActions().openTreeCardEditor !== "function"
          ) {
            showAlert(
              "error",
              "وحدة التعديل غير محمّلة. حدّث الصفحة بقوة (Cmd+Shift+R).",
            );
            return;
          }
          requestActions().openTreeCardEditor(row);
        } catch (err) {
          console.error("تعديل كامل", err);
          showAlert(
            "error",
            "تعذر فتح التعديل الكامل: " +
              String((err && err.message) || err || ""),
          );
        }
        return;
      }
      const branches = ["زيدان", "مزيد", "زايد", "لاحم", "ملحم"];
      const currentBranch = normalizeTreeCardText(row.branch_key || "");
      const entered = window.prompt(
        "اكتب الفرع الصحيح:\n" + branches.join(" / "),
        currentBranch,
      );
      if (entered == null) return;
      const branchKey = normalizeTreeCardText(entered);
      if (!branches.includes(branchKey)) {
        showAlert("error", "الفرع غير صحيح. اختر: " + branches.join("، "));
        return;
      }
      if (branchKey === currentBranch) {
        showAlert("error", "لم يتغير الفرع.");
        return;
      }
      const sb = getClient();
      if (!sb) {
        showAlert("error", "تعذر الاتصال.");
        return;
      }
      const token = getAdminToken();
      if (!token) {
        showAlert("error", "يلزم تسجيل الدخول أولاً.");
        return;
      }
      const id = coerceRpcId(row.id != null ? row.id : row.request_id);
      if (!id) {
        showAlert("error", "بيانات الطلب ناقصة.");
        return;
      }
      const message = requestActions().updateBranchInRequestMessage(
        row.message,
        branchKey,
        row.kind,
      );
      let treeRows = [];
      if (row.status === "approved" && row.kind === "tree_card") {
        const built =
          typeof requestActions().buildTreeCardRows === "function"
            ? requestActions().buildTreeCardRows(row, currentBranch)
            : { ok: false, message: "تعذر قراءة بيانات بطاقة الشجرة." };
        if (!built.ok) {
          showAlert(
            "error",
            built.message || "تعذر قراءة بيانات بطاقة الشجرة.",
          );
          return;
        }
        treeRows = built.rows.map((item) => ({
          parent_name: item.parent_name,
          child_name: item.child_name,
        }));
      }
      editBranchBtn.disabled = true;
      const { data, error } = await sb.rpc("admin_update_request_branch_v1", {
        p_token: token,
        p_id: String(id),
        p_old_branch_key: currentBranch || null,
        p_branch_key: branchKey,
        p_name: row.name || null,
        p_phone: row.phone || null,
        p_email: row.email || null,
        p_message: message || null,
        p_old_tree_rows: treeRows,
        p_new_tree_rows: treeRows,
      });
      if (error) {
        const errorText = String(error.message || "");
        const missingRpc =
          errorText.toLowerCase().includes("could not find the function") ||
          errorText.toLowerCase().includes("does not exist") ||
          String(error.code || "").toLowerCase() === "pgrst202";
        showAlert(
          "error",
          missingRpc
            ? "تعذر تعديل الفرع حالياً، حاول لاحقاً أو تواصل مع الإدارة."
            : "تعذر تعديل الفرع حالياً، حاول لاحقاً أو تواصل مع الإدارة.",
        );
        editBranchBtn.disabled = false;
        return;
      }
      if (data !== true) {
        showAlert(
          "error",
          "لم يتم تعديل الطلب. يمكن تعديل الطلبات المنتظرة أو المقبولة فقط.",
        );
        editBranchBtn.disabled = false;
        return;
      }
      const movedText =
        row.status === "approved" && row.kind === "tree_card"
          ? " ونقل بيانات البطاقة إلى الفرع الصحيح"
          : "";
      showAlert(
        "success",
        "تم تعديل الفرع من «" +
          (currentBranch || "غير محدد") +
          "» إلى «" +
          branchKey +
          "»" +
          movedText +
          ".",
      );
      await loadRequests();
    });
    reapplyBtn.addEventListener("click", async () => {
      hideAlert();
      const sb = getClient();
      if (!sb) {
        showAlert("error", "تعذر الاتصال.");
        return;
      }
      const token = getAdminToken();
      if (!token) {
        showAlert("error", "يلزم تسجيل الدخول أولاً.");
        return;
      }
      if (row.kind !== "tree_card") return;
      reapplyBtn.disabled = true;
      const applied =
        typeof requestActions().reapplyApprovedTreeCard === "function"
          ? await requestActions().reapplyApprovedTreeCard(sb, token, row)
          : await requestActions().importTreeCardToTree(sb, token, row);
      reapplyBtn.disabled = !canReapply;
      if (!applied.ok) {
        showAlert(
          "error",
          (applied.message || "تعذر إعادة التطبيق.") +
            (applied.code ? " [" + applied.code + "]" : ""),
        );
        return;
      }
      showAlert(
        "success",
        "تمت إعادة التطبيق بتحقق: " +
          (row.request_id || "") +
          (applied.message ? " (" + applied.message + ")" : ""),
      );
      await loadRequests();
    });
    approveBtn.addEventListener("click", async () => {
      hideAlert();
      const rowId = coerceRpcId(row.id != null ? row.id : row.request_id);
      console.info("ADMIN_RPC approve click", {
        request_id: row.request_id,
        id: rowId,
        kind: row.kind,
        status: row.status,
      });
      if (isSecretResetRequest(row)) {
        const sb = getClient();
        if (!sb) {
          showAlert("error", "تعذر الاتصال.");
          return;
        }
        const token = getAdminToken();
        if (!token) {
          showAlert("error", "يلزم تسجيل الدخول أولاً.");
          return;
        }
        const id = coerceRpcId(row.id != null ? row.id : row.request_id);
        if (!id) {
          showAlert("error", "بيانات الطلب ناقصة.");
          return;
        }
        const proposed = extractProposedSecretFromMessage(row.message);
        const ok = window.confirm(
          "اعتماد طلب إعادة تعيين الرقم السري؟\n" +
            "المندوب: " +
            (row.name || "—") +
            "\nالفرع: " +
            (row.branch_key || "—") +
            (proposed
              ? "\n\nسيُعتمد الرقم السري الذي اقترحه المندوب. انسخه بعد النجاح وأبلغه إن لم تصل إشعارات."
              : "\n\nسيُعتمد الهاش المخزّن في الطلب."),
        );
        if (!ok) return;
        approveBtn.disabled = true;
        const { data, error } = await sb.rpc("admin_delegate_secret_reset_approve_v1", {
          p_token: token,
          p_id: String(id),
          p_secret_hash: null,
        });
        approveBtn.disabled = false;
        if (error) {
          const msg = String(error.message || "");
          showAlert(
            "error",
            /could not find|schema cache|PGRST202/i.test(msg)
              ? "RPC غير مفعّل. من أدوات الصيانة شغّل أمر «طلب إعادة تعيين الرقم السري»."
              : "تعذر اعتماد إعادة التعيين.",
          );
          return;
        }
        if (!data || data.ok === false) {
          showAlert(
            "error",
            "فشل الاعتماد (" + String((data && data.reason) || "unknown") + ").",
          );
          return;
        }
        let note =
          "تم اعتماد إعادة التعيين: " +
          (row.request_id || "") +
          " · حُدّث Legacy=" +
          String(data.legacy_updated != null ? data.legacy_updated : "?") +
          " · v2=" +
          String(data.v2_updated != null ? data.v2_updated : "?");
        if (proposed) {
          note +=
            "\n\nالرقم السري الجديد (انسخه الآن): " +
            proposed +
            "\n" +
            (data.notify_limitation ||
              "لا قناة إشعار مضمونة للمندوب — أبلغه يدويًا إن لزم.");
          try {
            window.alert(note);
          } catch (_) {}
        } else if (data.notify_limitation) {
          note += "\n" + String(data.notify_limitation);
        }
        showAlert("success", note);
        try {
          await sb.functions.invoke("alzidan-email-notify", {
            body: {
              mode: "secret_reset_approved",
              record: {
                request_id: row.request_id,
                kind: "delegate_secret_reset",
                branch_key: row.branch_key,
                phone: row.phone,
                email: row.email,
                name: row.name,
              },
            },
          });
        } catch (_) {}
        await loadRequests();
        return;
      }

      const sb = getClient();
      if (!sb) {
        showAlert("error", "تعذر الاتصال.");
        return;
      }
      const token = getAdminToken();
      if (!token) {
        showAlert("error", "يلزم تسجيل الدخول أولاً.");
        return;
      }
      const id = coerceRpcId(row.id != null ? row.id : row.request_id);
      if (!id) {
        showAlert("error", "بيانات الطلب ناقصة.");
        return;
      }
      approveBtn.disabled = true;
      try {
      // Delegate access: require/persist notify email before approve so it syncs to delegates_v2.
      if (isDelegateAccessKind(row.kind)) {
        const emailInputs = tr.querySelectorAll("[data-delegate-email-input]");
        let emailToUse = "";
        emailInputs.forEach((el) => {
          const v = normalizeAdminRequestEmail(el && el.value);
          if (v) emailToUse = v;
        });
        if (!emailToUse) emailToUse = normalizeAdminRequestEmail(row.email);
        if (!isLikelyAdminRequestEmail(emailToUse)) {
          const entered = window.prompt(
            "البريد الإلكتروني إلزامي لإشعارات طلبات الفرع.\nأدخله قبل قبول طلب المندوب:",
            String(row.email || ""),
          );
          if (entered == null) {
            approveBtn.disabled = false;
            return;
          }
          emailToUse = normalizeAdminRequestEmail(entered);
        }
        if (!isLikelyAdminRequestEmail(emailToUse)) {
          approveBtn.disabled = false;
          showAlert("error", "البريد الإلكتروني غير صحيح. لم يتم قبول الطلب.");
          return;
        }
        if (emailToUse !== normalizeAdminRequestEmail(row.email)) {
          const saved = await persistDelegateRequestEmail(row, emailToUse);
          if (!saved.ok) {
            approveBtn.disabled = false;
            showAlert("error", saved.message || "تعذر حفظ البريد قبل القبول.");
            return;
          }
        } else {
          row.email = emailToUse;
        }
        emailInputs.forEach((el) => {
          if (el) el.value = emailToUse;
        });
      }
      let applyInfo = null;
      let publishedEvent = null;
      // ADR-006 / Patch 2: verified apply BEFORE status becomes «قبول»
      // First network call is intentional (tree resolve/import) — then admin_set_request_status_v2.
      if (row.kind === "tree_card") {
        const actions = requestActions();
        if (!actions || typeof actions.importTreeCardToTree !== "function") {
          approveBtn.disabled = false;
          const errMsg =
            "وحدة تطبيق بطاقة الشجرة غير محمّلة. حدّث الصفحة بقوة ثم أعد القبول.";
          showAlert("error", errMsg);
          try {
            window.alert(errMsg);
          } catch (_) {}
          return;
        }
        console.info("ADMIN_RPC approve tree_card apply start", row.request_id);
        applyInfo = await actions.importTreeCardToTree(sb, token, row);
        if (!applyInfo || !applyInfo.ok) {
          approveBtn.disabled = false;
          const errMsg =
            ((applyInfo && applyInfo.message) || "تعذر إضافة البطاقة للشجرة.") +
            (applyInfo && applyInfo.code ? " [" + applyInfo.code + "]" : "");
          showAlert("error", errMsg);
          try {
            window.alert(errMsg);
          } catch (_) {}
          return;
        }
        console.info("ADMIN_RPC approve tree_card apply ok", row.request_id);
      } else if (row.kind === "event_card") {
        publishedEvent = await requestActions().publishEventCardRequest(
          sb,
          token,
          row,
        );
        if (!publishedEvent.ok) {
          approveBtn.disabled = false;
          showAlert("error", publishedEvent.message || "تعذر نشر المناسبة.");
          window.alert(publishedEvent.message || "تعذر نشر المناسبة.");
          return;
        }
      }
      console.info("ADMIN_RPC admin_set_request_status_v2 start", {
        id,
        status: "approved",
      });
      const { data, error } = await sb.rpc("admin_set_request_status_v2", {
        p_token: token,
        p_id: id,
        p_status: "approved",
      });
      console.info("ADMIN_RPC admin_set_request_status_v2 done", {
        id,
        ok: !error && data !== false,
        error: error ? String(error.message || error) : null,
      });
      if (error) {
        approveBtn.disabled = false;
        showAlert(
          "error",
          row.kind === "tree_card"
            ? "طُبّقت بيانات الشجرة لكن تعذر ضبط الحالة على «قبول». استخدم إعادة التطبيق عند الحاجة."
            : "تعذر اعتماد الطلب حالياً، حاول لاحقاً أو تواصل مع الإدارة.",
        );
        return;
      }
      if (data === false) {
        approveBtn.disabled = false;
        showAlert(
          "error",
          "تعذر اعتماد الطلب. انتهت الجلسة أو لا توجد صلاحية.",
        );
        return;
      }
      // Activate Delegates v2 login credentials from the same approved row
      // (SSOT for portal login after «قبول» — also mirrored by DB trigger when SQL applied).
      // Dual tree+events: also approve pending sibling -TREE/-EVENTS row, then activate
      // (activate merges both kinds → full_delegate when both approved / dual message).
      if (row.kind === "tree_delegate" || row.kind === "events_delegate") {
        try {
          const sibling = await approveDelegateSiblingRequests(sb, token, row);
          const act = await sb.rpc("admin_delegates_v2_activate_from_request_v1", {
            p_token: token,
            p_id: String(id),
          });
          if (sibling.activateId && String(sibling.activateId) !== String(id)) {
            try {
              await sb.rpc("admin_delegates_v2_activate_from_request_v1", {
                p_token: token,
                p_id: String(sibling.activateId),
              });
            } catch (_) {}
          }
          if (act.error && !/could not find the function|PGRST202/i.test(String(act.error.message || ""))) {
            showAlert(
              "error",
              "تم قبول الطلب لكن تعذر تفعيل دخول المندوب. طبّق COPY-ME-delegates-v2-dual-role-activate.sql ثم أعد القبول أو المزامنة.",
            );
            approveBtn.disabled = false;
            await loadRequests();
            return;
          }
          if (act.data && act.data.ok === false && act.data.reason !== "not_delegate_kind") {
            showAlert(
              "error",
              "تم قبول الطلب لكن تفعيل دخول المندوب فشل (" +
                String(act.data.reason || "unknown") +
                "). راجع سجل المندوبين أو أعد المزامنة.",
            );
            approveBtn.disabled = false;
            await loadRequests();
            return;
          }
          const roleKey = act.data && act.data.role_key ? String(act.data.role_key) : "";
          const dualOk = roleKey === "full_delegate" || (sibling.approvedIds && sibling.approvedIds.length);
          if (dualOk) {
            showAlert(
              "success",
              `تم قبول الطلب وتفعيل دخول المندوب` +
                (roleKey === "full_delegate" ? " (شجرة + مناسبات)" : "") +
                `: ${row.request_id}`,
            );
            approveBtn.disabled = false;
            await loadRequests();
            return;
          }
        } catch (activateErr) {}
      }
      if (row.kind === "tree_card") {
        const extra = applyInfo && applyInfo.message ? " (" + applyInfo.message + ")" : "";
        showAlert(
          "success",
          `تم قبول الطلب بعد تطبيق متحقَّق في الشجرة: ${row.request_id}` + extra,
        );
      } else if (row.kind === "event_card") {
        const pushOk = publishedEvent && publishedEvent.push && publishedEvent.push.ok;
        const pushMsg =
          (publishedEvent && publishedEvent.pushMessage) ||
          (typeof requestActions().formatPushNotifyAdminMessage === "function"
            ? requestActions().formatPushNotifyAdminMessage(
                publishedEvent && publishedEvent.push,
              )
            : "");
        if (pushOk) {
          showAlert(
            "success",
            `تم قبول الطلب ونشر المناسبة: ${row.request_id}. ${pushMsg}`,
          );
        } else {
          showAlert(
            "error",
            `تم قبول الطلب ونشر المناسبة في الويب/القائمة: ${row.request_id}. ${pushMsg || "إشعار التطبيق لم يُرسل — راجع Console: PUSH_NOTIFY_*."}`,
          );
        }
      } else if (row.kind === "tree_delegate" || row.kind === "events_delegate") {
        showAlert(
          "success",
          `تم قبول الطلب وتفعيل دخول المندوب: ${row.request_id}`,
        );
      } else if (row.kind === "special_card") {
        const filled = openSpecialCardCmsFromRequest(row);
        if (filled && filled.ok) {
          showAlert(
            "success",
            `تم قبول طلب البطاقة: ${row.request_id}. تم تعبئة نموذج البطاقة الخاصة — راجع ثم احفظ.`,
          );
        } else {
          showAlert(
            "success",
            `تم قبول طلب البطاقة: ${row.request_id}. ${(filled && filled.message) || "افتح وحدة البطاقات الخاصة يدوياً."}`,
          );
        }
      } else {
        showAlert("success", `تم قبول الطلب: ${row.request_id}`);
      }
      await notifyRequesterStatusChanged(sb, row, "approved");
      await loadRequests();
      } catch (approveErr) {
        approveBtn.disabled = false;
        try {
          console.error("ADMIN_RPC approve failed", approveErr);
        } catch (_) {}
        const errMsg =
          "تعذر قبول الطلب: " +
          String(
            (approveErr && approveErr.message) || approveErr || "خطأ غير متوقع",
          );
        showAlert("error", errMsg);
        try {
          window.alert(errMsg);
        } catch (_) {}
      }
    });
    fillSpecialCardBtn.addEventListener("click", () => {
      hideAlert();
      const filled = openSpecialCardCmsFromRequest(row);
      if (!filled || !filled.ok) {
        showAlert(
          "error",
          (filled && filled.message) || "تعذر تعبئة نموذج البطاقة.",
        );
        return;
      }
      showAlert(
        "success",
        "تم تعبئة نموذج البطاقة الخاصة من الطلب" +
          (filled.person ? " — " + filled.person : "") +
          (filled.imageUrl ? " (مع الصورة)" : "") +
          ".",
      );
    });
    publishEventBtn.addEventListener("click", async () => {
      hideAlert();
      const sb = getClient();
      if (!sb) {
        showAlert("error", "تعذر الاتصال.");
        return;
      }
      const token = getAdminToken();
      if (!token) {
        showAlert("error", "يلزم تسجيل الدخول أولاً.");
        return;
      }
      publishEventBtn.disabled = true;
      const published = await requestActions().publishEventCardRequest(sb, token, row);
      publishEventBtn.disabled = false;
      if (!published.ok) {
        showAlert("error", published.message || "تعذر نشر المناسبة.");
        window.alert(published.message || "تعذر نشر المناسبة.");
        return;
      }
      const pushOk = published.push && published.push.ok;
      const pushMsg =
        published.pushMessage ||
        (typeof requestActions().formatPushNotifyAdminMessage === "function"
          ? requestActions().formatPushNotifyAdminMessage(published.push)
          : "");
      if (pushOk) {
        showAlert(
          "success",
          `تم نشر المناسبة: ${row.request_id}. ${pushMsg}`,
        );
        window.alert("تم نشر المناسبة. " + pushMsg);
      } else {
        showAlert(
          "error",
          `تم نشر المناسبة في الويب/القائمة: ${row.request_id}. ${pushMsg || "إشعار التطبيق لم يُرسل — راجع Console: PUSH_NOTIFY_*."}`,
        );
        window.alert(
          pushMsg ||
            "نُشرت المناسبة لكن إشعار التطبيق لم يُرسل. راجع Console: PUSH_NOTIFY_*.",
        );
      }
      await loadRequests();
    });
    deleteBtn.addEventListener("click", async () => {
      hideAlert();
      // Prefer numeric row.id; request_id (EVN-*) is resolved server-side too.
      const id = coerceRpcId(
        row.id != null && String(row.id).trim() !== ""
          ? row.id
          : row.request_id,
      );
      if (!id) {
        showAlert("error", "بيانات الطلب ناقصة.");
        return;
      }
      const confirmed = window.confirm(
        "تأكيد حذف الطلب نهائياً ؟ لا يمكن التراجع.",
      );
      if (!confirmed) return;
      const sb = getClient();
      if (!sb) {
        showAlert("error", "تعذر الاتصال.");
        return;
      }
      const token = getAdminToken();
      if (!token) {
        showAlert("error", "يلزم تسجيل الدخول أولاً.");
        return;
      }
      deleteBtn.disabled = true;
      let unpubWarn = "";
      try {
        // Best-effort unpublish first. Do NOT abort delete on failure —
        // admin_delete_request_v1 also removes family_events. Blocking here
        // left rejected EVN-* rows undeletable when unpublish RPC/date cast failed.
        if (
          requestActions &&
          typeof requestActions().unpublishPublishedEventForRequest ===
            "function"
        ) {
          try {
            const unpub =
              await requestActions().unpublishPublishedEventForRequest(
                sb,
                token,
                row,
              );
            if (unpub && unpub.ok === false) {
              unpubWarn =
                unpub.message ||
                "تعذر إلغاء النشر مسبقاً؛ سيُحذف الطلب عبر دالة الحذف.";
              try {
                console.warn("UNPUBLISH_BEFORE_DELETE soft-fail", unpub);
              } catch (_) {}
            }
          } catch (unpubErr) {
            unpubWarn =
              "تعذر إلغاء النشر مسبقاً؛ سيُحذف الطلب عبر دالة الحذف.";
            try {
              console.warn("UNPUBLISH_BEFORE_DELETE threw", unpubErr);
            } catch (_) {}
          }
        }
        const { data, error } = await sb.rpc("admin_delete_request_v1", {
          p_token: token,
          p_id: String(id),
        });
        if (error) {
          const raw = String(
            error.message || error.details || "",
          ).toLowerCase();
          if (/not allowed|permission|jwt|auth/i.test(raw)) {
            showAlert(
              "error",
              "انتهت جلسة الإدارة أو لا توجد صلاحية لحذف الطلب. سجّل الدخول ثم أعد المحاولة.",
            );
          } else if (
            /could not find|schema cache|PGRST202|function .* does not exist/i.test(
              raw,
            )
          ) {
            showAlert(
              "error",
              "دالة الحذف غير محدّثة في القاعدة. من أدوات الصيانة شغّل أمر «حذف الطلب يلغي نشر المناسبة» ثم Hard Refresh.",
            );
          } else if (/foreign key|violates|constraint/i.test(raw)) {
            showAlert(
              "error",
              "تعذر حذف الطلب بسبب ارتباط في القاعدة. أزل المناسبة المنشورة أولاً أو تواصل مع الإدارة.",
            );
          } else {
            showAlert("error", scrubAdminUserError(error, "تعذر حذف الطلب حالياً."));
          }
          return;
        }
        if (data !== true) {
          showAlert(
            "error",
            "لم يتم حذف الطلب. انتهت الجلسة أو لا توجد صلاحية، أو الطلب غير موجود. إن استمرت المشكلة: من أدوات الصيانة شغّل «حذف الطلب يلغي نشر المناسبة» (أو تنظيف EVN-LK9X-RQUI) ثم Hard Refresh.",
          );
          return;
        }
        showAlert(
          "success",
          "تم حذف الطلب : " +
            String(row.request_id || id) +
            (unpubWarn ? " — تنبيه: " + unpubWarn : ""),
        );
        await loadRequests();
        window.AlzidanRequestsStats.loadRequestsStats().catch(() => {});
      } catch (err) {
        showAlert(
          "error",
          scrubAdminUserError(err, "تعذر حذف الطلب حالياً."),
        );
      } finally {
        deleteBtn.disabled = false;
      }
    });
    rejectBtn.addEventListener("click", async () => {
      hideAlert();
      if (isSecretResetRequest(row)) {
        const sb = getClient();
        if (!sb) {
          showAlert("error", "تعذر الاتصال.");
          return;
        }
        const token = getAdminToken();
        if (!token) {
          showAlert("error", "يلزم تسجيل الدخول أولاً.");
          return;
        }
        const id = coerceRpcId(row.id != null ? row.id : row.request_id);
        if (!id) {
          showAlert("error", "بيانات الطلب ناقصة.");
          return;
        }
        const reason = window.prompt("سبب الرفض (اختياري):") || "";
        rejectBtn.disabled = true;
        const { data, error } = await sb.rpc("admin_delegate_secret_reset_reject_v1", {
          p_token: token,
          p_id: String(id),
          p_reason: reason || null,
        });
        rejectBtn.disabled = false;
        if (error) {
          const msg = String(error.message || "");
          showAlert(
            "error",
            /could not find|schema cache|PGRST202/i.test(msg)
              ? "RPC غير مفعّل. من أدوات الصيانة شغّل أمر «طلب إعادة تعيين الرقم السري»."
              : "تعذر رفض الطلب.",
          );
          return;
        }
        if (!data || data.ok === false) {
          showAlert("error", "فشل الرفض.");
          return;
        }
        showAlert("success", "تم رفض طلب إعادة التعيين: " + (row.request_id || ""));
        await loadRequests();
        return;
      }
      const sb = getClient();
      if (!sb) {
        showAlert("error", "تعذر الاتصال.");
        return;
      }
      const token = getAdminToken();
      if (!token) {
        showAlert("error", "يلزم تسجيل الدخول أولاً.");
        return;
      }
      const id = coerceRpcId(row.id != null ? row.id : row.request_id);
      if (!id) {
        showAlert("error", "بيانات الطلب ناقصة.");
        return;
      }
      rejectBtn.disabled = true;
      // Best-effort unpublish. Reject trigger also removes family_events —
      // do not abort reject when pre-unpublish fails (same bug as Delete).
      let unpublishedCount = 0;
      let unpubWarn = "";
      if (
        requestActions &&
        typeof requestActions().unpublishPublishedEventForRequest === "function"
      ) {
        try {
          const unpub = await requestActions().unpublishPublishedEventForRequest(
            sb,
            token,
            row,
          );
          if (unpub && unpub.ok === false) {
            unpubWarn =
              unpub.message ||
              "تعذر إلغاء النشر مسبقاً؛ سيُرفض الطلب عبر مسار الحالة.";
            try {
              console.warn("UNPUBLISH_BEFORE_REJECT soft-fail", unpub);
            } catch (_) {}
          } else {
            unpublishedCount = Number(unpub && unpub.deleted) || 0;
          }
        } catch (unpubErr) {
          unpubWarn =
            "تعذر إلغاء النشر مسبقاً؛ سيُرفض الطلب عبر مسار الحالة.";
          try {
            console.warn("UNPUBLISH_BEFORE_REJECT threw", unpubErr);
          } catch (_) {}
        }
      }
      const { data, error } = await sb.rpc("admin_set_request_status_v2", {
        p_token: token,
        p_id: id,
        p_status: "rejected",
      });
      const isEventKind =
        requestActions &&
        typeof requestActions().isEventPublishRequestKind === "function"
          ? requestActions().isEventPublishRequestKind(row.kind)
          : row.kind === "event_card" ||
            row.kind === "family_event" ||
            row.kind === "event_request";
      // After status=rejected the DB trigger may have removed rows JS missed.
      let stillPublic = 0;
      if (isEventKind && String(row.request_id || "").trim()) {
        try {
          const check = await sb
            .from("family_events")
            .select("id")
            .like("details", "%" + String(row.request_id).trim() + "%")
            .limit(5);
          stillPublic = Array.isArray(check.data) ? check.data.length : 0;
        } catch (_) {}
      }
      rejectBtn.disabled = false;
      if (error) {
        showAlert(
          "error",
          unpublishedCount > 0
            ? "أُزيلت المناسبة من الشريط لكن تعذر ضبط حالة الطلب على «رفض». حدّث الصفحة أو أعد المحاولة."
            : "تعذر رفض الطلب حالياً، حاول لاحقاً أو تواصل مع الإدارة.",
        );
        return;
      }
      if (data === false) {
        showAlert(
          "error",
          unpublishedCount > 0
            ? "أُزيلت المناسبة من الشريط لكن تعذر رفض الطلب (جلسة/صلاحية)."
            : "تعذر رفض الطلب. انتهت الجلسة أو لا توجد صلاحية.",
        );
        return;
      }
      if (isEventKind && stillPublic > 0) {
        showAlert(
          "error",
          `تم رفض الطلب: ${row.request_id} — لكن ما زال ${stillPublic} صف في family_events ظاهرًا. احذفه من إدارة المناسبات (نفس مسار الحذف) أو شغّل SQL إلغاء النشر من أدوات الصيانة.`,
        );
      } else if (isEventKind && (unpublishedCount > 0 || stillPublic === 0)) {
        showAlert(
          "success",
          `تم رفض الطلب وإزالة المناسبة من الشريط/المناسبات: ${row.request_id}`,
        );
      } else {
        showAlert("success", `تم رفض الطلب: ${row.request_id}`);
      }
      await notifyRequesterStatusChanged(sb, row, "rejected");
      await loadRequests();
    });
    requestsBody.appendChild(tr);
  }
  function normalizeRequestSearchText(value) {
    return String(value == null ? "" : value)
      .toLowerCase()
      .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
      .replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
      .replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
      .trim();
  }
  function requestRowMatchesSearch(row, query) {
    const q = normalizeRequestSearchText(query);
    if (!q) return true;
    const text = [
      row.request_id,
      row.id,
      kindLabel(row.kind),
      row.kind,
      row.branch_key,
      row.name,
      row.phone,
      row.email,
      requestStatusLabel(row.status),
      row.created_at,
    ]
      .map(normalizeRequestSearchText)
      .join(" | ");
    return text.includes(q);
  }
  function getRequestsPageSize() {
    const n = Number(
      requestsPageSizeSelect && requestsPageSizeSelect.value
        ? requestsPageSizeSelect.value
        : 50,
    );
    return Number.isFinite(n) && n > 0 ? n : 50;
  }
  function renderRequestsPage() {
    if (!requestsBody) return;
    ensureQualityFilterControl();
    requestsBody.innerHTML = "";
    const query = requestSearchInput ? requestSearchInput.value : "";
    const qualityFilter = requestsQualityFilterSelect
      ? String(requestsQualityFilterSelect.value || "all")
      : "all";
    const qualityContext = buildRequestQualityContext(requestsAllRows);
    const filtered = requestsAllRows.filter((row) => {
      if (!requestRowMatchesSearch(row, query)) return false;
      if (qualityFilter === "all") return true;
      return classifyRequestQuality(row, qualityContext).key === qualityFilter;
    });
    if (!filtered.length) {
      renderEmpty("لا توجد طلبات مطابقة للبحث والفلاتر الحالية.");
    } else {
      filtered.forEach((row) => renderRequestRow(row, qualityContext));
    }
    if (requestsPageInfo) {
      requestsPageInfo.textContent = "عدد النتائج: " + String(filtered.length);
    }
    if (requestsPrevPageBtn) requestsPrevPageBtn.disabled = true;
    if (requestsNextPageBtn) requestsNextPageBtn.disabled = true;
  }
  async function loadRequests() {
    if (!requestsBody) return;
    requestsBody.innerHTML = "";
    const sb = getClient();
    if (!sb) {
      renderEmpty("الخدمة غير جاهزة حالياً.");
      return;
    }
    const token = getAdminToken();
    if (!token) {
      renderEmpty("سجل الدخول للإدارة لعرض الطلبات.");
      return;
    }
    const statusValue = String(filterStatus?.value || "pending");
    const kindValue = String(filterKind?.value || "all");
    const { data, error } = await sb.rpc("admin_list_requests", {
      p_token: token,
      p_status: statusValue === "all" ? null : statusValue,
      p_kind: kindValue === "all" ? null : kindValue,
      p_limit: 50,
    });
    if (error) {
      renderEmpty("تعذر جلب الطلبات حالياً، حاول لاحقاً أو تواصل مع الإدارة.");
      return;
    }
    requestsAllRows = Array.isArray(data) ? data : [];
    requestsCurrentPage = 1;
    renderRequestsPage();
  }


  function init() {
    ensureQualityFilterControl();
    if (filterStatus)
      filterStatus.addEventListener("change", () => loadRequests().catch(() => {}));
    if (filterKind)
      filterKind.addEventListener("change", () => loadRequests().catch(() => {}));
    if (requestSearchInput)
      requestSearchInput.addEventListener("input", () => {
        requestsCurrentPage = 1;
        renderRequestsPage();
      });
    if (requestsPageSizeSelect)
      requestsPageSizeSelect.addEventListener("change", () => {
        requestsCurrentPage = 1;
        renderRequestsPage();
      });
    if (requestsPrevPageBtn)
      requestsPrevPageBtn.addEventListener("click", () => {
        requestsCurrentPage = Math.max(1, requestsCurrentPage - 1);
        renderRequestsPage();
      });
    if (requestsNextPageBtn)
      requestsNextPageBtn.addEventListener("click", () => {
        requestsCurrentPage += 1;
        renderRequestsPage();
      });
  }

  window.AlzidanAdminRequests = {
    init,
    loadRequests,
    renderRequestsPage,
  };

  function bootstrap() {
    if (bootstrap.didRun) return;
    bootstrap.didRun = true;
    // Bind filters/pager only. Auth (AlzidanAuth) owns the initial loadRequests().
    init();
  }

  window.AlzidanAdminRequestsModule = Object.assign(
    window.AlzidanAdminRequestsModule || {},
    { bootstrap },
  );
})();
