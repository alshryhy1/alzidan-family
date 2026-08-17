(() => {
  "use strict";

  const Core = window.AlzidanAdminCore || {};
  const {
    showAlert,
    getClient,
    getAdminToken,
    formatDateTimeArSaVerbose,
    coerceRpcId,
    isLikelyEmail,
    normalizeEmail,
  } = Core;

  /** Browser IIFE must not touch Node's bare `global` (ReferenceError → silent Accept fail). */
  function treeEngineApi() {
    const root =
      typeof window !== "undefined"
        ? window
        : typeof globalThis !== "undefined"
          ? globalThis
          : null;
    return root && root.AlzidanTreeEngine ? root.AlzidanTreeEngine : null;
  }

  let reloadRequests = async function () {};
  function setReloadRequests(fn) {
    reloadRequests = typeof fn === "function" ? fn : async function () {};
    try {
      if (window.AlzidanRequestActions) {
        window.AlzidanRequestActions._reloadRequests = reloadRequests;
      }
    } catch (_) {}
  }
  const treeCardEditDialog = document.getElementById("tree-card-edit-dialog");
  const treeCardEditForm = document.getElementById("tree-card-edit-form");
  let treeCardEditError = document.getElementById("tree-card-edit-error");
  const treeCardEditCancel = document.getElementById("tree-card-edit-cancel");

  let treeCardEditRow = null;
  /** In-flight open-path father UUID resolve; save awaits this to avoid race. */
  let treeCardFatherAutoResolvePromise = null;
  let treeCardFatherSearchTimer = null;
  let treeCardFatherSearchSeq = 0;
  /** Max father typeahead hits (FM-style capped list; never bulk-load branch). */
  const TREE_CARD_FATHER_SEARCH_LIMIT = 40;
  const TREE_CARD_FATHER_SEARCH_DEBOUNCE_MS = 220;
  const TREE_CARD_RELATION_MISMATCH_AR =
    "العلاقة المختارة لا تتوافق مع الشجرة الحالية. راجع الأب المختار.";

  function normalizeTreeCardText(v) {
    return String(v || "")
      .replace(/\s+/g, " ")
      .trim();
  }
  function safeParseJsonTextLoose(v) {
    try {
      if (v == null) return null;
      const s = String(v || "").trim();
      if (!s) return null;
      return JSON.parse(s);
    } catch (e) {
      return null;
    }
  }
  function treeCardContract() {
    return (
      (typeof window !== "undefined" && window.AlzidanTreeCardContract) || null
    );
  }

  /**
   * Canonical parse+normalize for tree_card messages.
   * Prefer Contract; fall back to legacy marker parse.
   * Returns normalized payload or null only when Contract unavailable AND no JSON.
   */
  function extractTreeCardPayloadFromMessage(msg, row) {
    const Contract = treeCardContract();
    if (Contract && typeof Contract.parseTreeCardRequestMessage === "function") {
      const parsed = Contract.parseTreeCardRequestMessage(msg, row || null);
      if (parsed && parsed.payload) return parsed.payload;
      return null;
    }
    const text = String(msg || "");
    const marker = "__JSON__:";
    const idx = text.indexOf(marker);
    if (idx < 0) return null;
    const jsonText = text.slice(idx + marker.length).trim();
    if (!jsonText) return null;
    const parsed = safeParseJsonTextLoose(jsonText);
    return parsed && typeof parsed === "object" ? parsed : null;
  }

  function parseTreeCardRequestForEditor(row) {
    const Contract = treeCardContract();
    const message = row && row.message ? row.message : "";
    if (Contract && typeof Contract.parseTreeCardRequestMessage === "function") {
      return Contract.parseTreeCardRequestMessage(message, row);
    }
    const payload = extractTreeCardPayloadFromMessage(message, row);
    return {
      ok: !!payload,
      status: payload ? "complete" : "invalid",
      hasMarker: String(message).indexOf("__JSON__:") >= 0,
      jsonValid: !!payload,
      payload: payload,
      recovery: null,
      reasons: payload ? [] : ["تعذر قراءة تفاصيل بطاقة الشجرة (لا يوجد JSON)."],
      raw: String(message || ""),
    };
  }
  function updateBranchInRequestMessage(message, branchKey, kind) {
    const text = String(message || "");
    const branch = normalizeTreeCardText(branchKey);
    if (!text || !branch) return text;
    if (kind === "tree_card") {
      const Contract = treeCardContract();
      let payload = extractTreeCardPayloadFromMessage(text);
      if (!payload && Contract) {
        const parsed = Contract.parseTreeCardRequestMessage(text, {
          branch_key: branch,
        });
        payload = parsed && parsed.payload ? parsed.payload : null;
      }
      if (payload) {
        payload.branch_key = branch;
        if (Contract && typeof Contract.serializeTreeCardRequest === "function") {
          return Contract.serializeTreeCardRequest(payload, {
            branch_key: branch,
          });
        }
        const marker = "__JSON__:";
        const idx = text.indexOf(marker);
        const visiblePart = idx >= 0 ? text.slice(0, idx).trimEnd() : text;
        const updatedVisible = /^العائلة \(إجباري\):.*$/m.test(visiblePart)
          ? visiblePart.replace(
              /^العائلة \(إجباري\):.*$/m,
              "العائلة (إجباري): " + branch,
            )
          : visiblePart;
        return (
          updatedVisible +
          "\n\n" +
          marker +
          "\n" +
          JSON.stringify(payload, null, 2)
        );
      }
    }
    if (/^الفرع:.*$/m.test(text)) {
      return text.replace(/^الفرع:.*$/m, "الفرع: " + branch);
    }
    return text;
  }
  function normalizeAdminPhone(v) {
    return String(v || "")
      .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632))
      .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 1776))
      .replace(/[^\d+]/g, "")
      .trim();
  }
  function extractRequestMediaLinks(message) {
    const Events = window.AlzidanEvents || {};
    if (typeof Events.extractEventMediaLinks === "function") {
      return Events.extractEventMediaLinks(message);
    }
    const media = { image: "", video: "" };
    return media;
  }
  function requestMessageWithoutMediaLinks(message) {
    const marker = "__JSON__:";
    const rawText = String(message || "");
    const markerIndex = rawText.indexOf(marker);
    const visibleText = markerIndex >= 0 ? rawText.slice(0, markerIndex) : rawText;

    return visibleText
      .split(/\r?\n/)
      .filter((rawLine) => {
        const line = String(rawLine || "").trim();
        if (/^رابط الصورة\s*:/i.test(line)) return false;
        if (/^رابط الفيديو\s*:/i.test(line)) return false;
        return true;
      })
      .join("\n")
      .trim();
  }
  function appendRequestMediaPreview(parent, message) {
    const Events = window.AlzidanEvents || {};
    const media = extractRequestMediaLinks(message);
    // Hard gate — never attach <video> for empty/junk URLs (no fail-open if validator missing).
    const image =
      typeof Events.resolveValidImageUrl === "function"
        ? Events.resolveValidImageUrl(media.image)
        : typeof Events.isValidImageUrl === "function" && Events.isValidImageUrl(media.image)
          ? media.image
          : "";
    const video =
      typeof Events.resolveValidVideoUrl === "function"
        ? Events.resolveValidVideoUrl(media.video)
        : typeof Events.isValidVideoUrl === "function" && Events.isValidVideoUrl(media.video)
          ? media.video
          : "";
    if (!image && !video) return;
    const wrap = document.createElement("div");
    wrap.className = "request-media-preview";
    if (image) {
      const item = document.createElement("div");
      item.className = "request-media-item";
      const title = document.createElement("div");
      title.className = "request-media-title";
      title.textContent = "الصورة المرفقة";
      const img = document.createElement("img");
      img.alt = "الصورة المرفقة مع الطلب";
      img.loading = "lazy";
      img.src = image;
      const note = document.createElement("div");
      note.className = "request-media-note";
      note.textContent = "الصورة المرفقة مع الطلب.";
      item.appendChild(title);
      item.appendChild(img);
      item.appendChild(note);
      wrap.appendChild(item);
    }
    if (video) {
      const item = document.createElement("div");
      item.className = "request-media-item";
      const title = document.createElement("div");
      title.className = "request-media-title";
      title.textContent = "الفيديو المرفق";
      const videoEl = document.createElement("video");
      videoEl.controls = true;
      videoEl.preload = "metadata";
      videoEl.src = video;
      item.appendChild(title);
      item.appendChild(videoEl);
      wrap.appendChild(item);
    }
    parent.appendChild(wrap);
  }
  function summarizePushInvokeDetail(pushResult) {
    const parts = [];
    const status = Number(
      pushResult && pushResult.httpStatus != null
        ? pushResult.httpStatus
        : pushResult &&
            pushResult.error &&
            pushResult.error.context &&
            pushResult.error.context.status,
    );
    if (Number.isFinite(status) && status > 0) parts.push("HTTP " + status);
    const snippet = String(
      (pushResult && pushResult.bodySnippet) ||
        (pushResult &&
          pushResult.data &&
          (pushResult.data.error ||
            (typeof pushResult.data === "string" ? pushResult.data : ""))) ||
        "",
    )
      .replace(/\s+/g, " ")
      .trim();
    if (snippet) parts.push(snippet.slice(0, 140));
    return parts.join(" — ");
  }

  async function extractFunctionsInvokeFailure(error, fallbackData) {
    const out = {
      data: fallbackData || null,
      httpStatus: null,
      bodySnippet: "",
    };
    const ctx = error && error.context;
    if (ctx && typeof ctx.status === "number") out.httpStatus = ctx.status;
    if (!ctx) return out;

    try {
      if (typeof ctx.clone === "function") {
        const cloned = ctx.clone();
        if (typeof cloned.text === "function") {
          const text = await cloned.text();
          out.bodySnippet = String(text || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 240);
          try {
            out.data = JSON.parse(text);
          } catch (_) {}
        }
      } else if (typeof ctx.json === "function") {
        out.data = await ctx.json();
        out.bodySnippet = JSON.stringify(out.data).slice(0, 240);
      } else if (typeof ctx.text === "function") {
        out.bodySnippet = String(await ctx.text() || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 240);
      }
    } catch (_) {}

    if (!out.bodySnippet && out.data && typeof out.data === "object") {
      try {
        out.bodySnippet = JSON.stringify(out.data).slice(0, 240);
      } catch (_) {}
    }
    return out;
  }

  function formatInvalidCredentialsPushHint(pushResult) {
    const tokenConfigured =
      pushResult &&
      pushResult.data &&
      pushResult.data.expo_access_token_configured === true;
    return (
      "نُشرت المناسبة، لكن Expo رفض التذاكر بـ InvalidCredentials — هذه مشكلة اعتمادات Expo (APNs/FCM أو رمز الوصول)، وليست CORS. " +
      (tokenConfigured
        ? "رمز EXPO_ACCESS_TOKEN مضبوط على Supabase؛ راجع في Expo Dashboard → Credentials مفاتيح APNs للإنتاج وFCM V1 للمشروع 8a6659eb-ef85-49b5-a8db-7b7be96b8c1f، ثم eas credentials إن لزم."
        : "الخطوة التالية: أنشئ Access Token من expo.dev → Account settings → Access tokens، ثم نفّذ: supabase secrets set EXPO_ACCESS_TOKEN=... --project-ref wbskjfdqpugnwvrykqcn ثم أعد نشر alzidan-push-notify، وتأكد من اعتمادات EAS (APNs/FCM) للإنتاج.")
    );
  }

  function formatPushNotifyAdminMessage(pushResult) {
    if (!pushResult) {
      return "نُشرت المناسبة، لكن حالة إشعار التطبيق غير معروفة (راجع Console: PUSH_NOTIFY_*).";
    }
    const ticketErrors = Array.isArray(
      pushResult.data && pushResult.data.errors,
    )
      ? pushResult.data.errors.map(String)
      : [];
    const disabled = Number(
      pushResult.data && pushResult.data.disabled != null
        ? pushResult.data.disabled
        : 0,
    );
    const hasDeviceNotRegistered = ticketErrors.some((e) =>
      /DeviceNotRegistered/i.test(e),
    );
    const hasInvalidCredentials = ticketErrors.some((e) =>
      /InvalidCredentials/i.test(e),
    );
    if (pushResult.ok) {
      const sent = Number(
        pushResult.data && pushResult.data.sent != null
          ? pushResult.data.sent
          : 0,
      );
      const failedTickets = ticketErrors.length;
      const deliveredGuess = Math.max(0, sent - failedTickets);
      if (sent > 0 && failedTickets === 0) {
        return "تم إرسال إشعار التطبيق إلى " + sent + " جهاز/أجهزة (Expo Push).";
      }
      if (sent > 0 && deliveredGuess > 0 && failedTickets > 0) {
        return (
          "أُرسل إشعار التطبيق إلى نحو " +
          deliveredGuess +
          " جهاز، مع فشل " +
          failedTickets +
          " تذكرة Expo" +
          (hasDeviceNotRegistered
            ? " (DeviceNotRegistered — غالباً رمز قديم أو بناء بدون اعتماد APNs للإنتاج)."
            : ".") +
          (disabled > 0 ? " عُطّلت " + disabled + " رموز." : "")
        );
      }
      if (sent > 0 && failedTickets > 0) {
        if (hasInvalidCredentials) {
          return formatInvalidCredentialsPushHint(pushResult);
        }
        return (
          "نُشرت المناسبة، لكن Expo رفض كل تذاكر الدفع" +
          (hasDeviceNotRegistered
            ? " (DeviceNotRegistered). افتح تطبيق App Store على جهاز حقيقي، اسمح بالإشعارات، وتأكد من ظهور صف ios/enabled في push_tokens، ثم راجع EAS credentials لـ APNs الإنتاج."
            : ": " + ticketErrors.slice(0, 3).join("; ")) +
          (disabled > 0 ? " عُطّلت " + disabled + " رموز." : "")
        );
      }
      return "تم استدعاء إشعار التطبيق بنجاح.";
    }
    const skipped = String(pushResult.skipped || "").trim();
    if (skipped === "no_push_tokens") {
      return (
        "نُشرت المناسبة، لكن لا توجد أجهزة مسجّلة في push_tokens. " +
        "إشعار التطبيق (Expo) يختلف عن إشعار المتصفح: افتح تطبيق App Store (ليس Expo Go فقط)، اسمح بالإشعارات، " +
        "ثم تأكد أن رمزاً platform=ios و enabled=true ظهر في جدول push_tokens."
      );
    }
    if (skipped === "missing_event_fields") {
      return "نُشرت المناسبة، لكن إشعار التطبيق تُخطّي لنقص النوع/الاسم.";
    }
    if (skipped) {
      return "نُشرت المناسبة، لكن إشعار التطبيق تُخطّي (" + skipped + ").";
    }
    if (hasInvalidCredentials) {
      return formatInvalidCredentialsPushHint(pushResult);
    }
    if (hasDeviceNotRegistered || (ticketErrors.length && !pushResult.ok)) {
      return (
        "نُشرت المناسبة، لكن إشعار Expo فشل" +
        (hasDeviceNotRegistered
          ? " (DeviceNotRegistered). تطبيق App Store يحتاج رمز push جديد + اعتماد APNs إنتاج عبر EAS؛ رموز Expo Go/معاينة لا تكفي للمتجر."
          : ": " + ticketErrors.slice(0, 3).join("; ")) +
        (disabled > 0 ? " عُطّلت " + disabled + " رموز تالفة." : "")
      );
    }
    const detail = summarizePushInvokeDetail(pushResult);
    const errMsg = String(
      (pushResult.data && pushResult.data.error) ||
        (pushResult.error &&
          (pushResult.error.message || pushResult.error.context || pushResult.error)) ||
        pushResult.reason ||
        "",
    ).trim();
    if (/Failed to send a request|Failed to fetch|NetworkError|CORS/i.test(errMsg)) {
      return (
        "نُشرت المناسبة، لكن استدعاء alzidan-push-notify فشل من المتصفح (شبكة/CORS أو الدالة غير منشورة)" +
        (detail ? ": " + detail : ".") +
        " راجع Network → alzidan-push-notify و Console: PUSH_NOTIFY_INVOKE_ERROR."
      );
    }
    if (/missing_service_role_key|push_tokens fetch failed/i.test(errMsg + " " + detail)) {
      return (
        "نُشرت المناسبة، لكن دالة الدفع فشلت (أسرار/صلاحيات الخدمة)" +
        (detail ? ": " + detail : ".") +
        " راجع سجلات Edge Function."
      );
    }
    return (
      "نُشرت المناسبة، لكن إشعار التطبيق لم يكتمل" +
      (detail ? ": " + detail : errMsg ? ": " + errMsg.slice(0, 160) : ".") +
      " راجع Console: PUSH_NOTIFY_*."
    );
  }

  async function notifyFamilyEventPush(sb, eventRow) {
    if (!sb || !eventRow) return { ok: false, reason: "missing_client_or_row" };
    let data = null;
    let error = null;
    try {
      const res = await sb.functions.invoke("alzidan-push-notify", {
        body: {
          type: eventRow.type || "",
          person: eventRow.person || "",
          branch_key: eventRow.branch_key || "",
          details: eventRow.details || "",
        },
      });
      data = res.data;
      error = res.error;
    } catch (invokeErr) {
      try {
        console.error("PUSH_NOTIFY_INVOKE_ERROR", invokeErr);
      } catch (_) {}
      return {
        ok: false,
        reason: "invoke_exception",
        error: invokeErr,
        httpStatus: null,
        bodySnippet: String(
          (invokeErr && (invokeErr.message || invokeErr)) || "",
        ).slice(0, 240),
      };
    }
    if (error) {
      const extracted = await extractFunctionsInvokeFailure(error, data);
      const body = extracted.data;
      try {
        console.error("PUSH_NOTIFY_INVOKE_ERROR", {
          message: error && error.message,
          httpStatus: extracted.httpStatus,
          bodySnippet: extracted.bodySnippet,
          body: body || null,
          error,
        });
      } catch (_) {}
      if (body && body.skipped) {
        return {
          ok: false,
          skipped: body.skipped,
          data: body,
          error,
          httpStatus: extracted.httpStatus,
          bodySnippet: extracted.bodySnippet,
        };
      }
      return {
        ok: false,
        reason: "invoke_error",
        error,
        data: body,
        httpStatus: extracted.httpStatus,
        bodySnippet: extracted.bodySnippet,
      };
    }
    if (data && data.skipped) {
      try {
        console.warn("PUSH_NOTIFY_SKIPPED", data.skipped, data);
      } catch (_) {}
      return { ok: false, skipped: data.skipped, data };
    }
    if (data && data.ok === false) {
      try {
        console.error("PUSH_NOTIFY_FAILED", data);
      } catch (_) {}
      return {
        ok: false,
        data,
        bodySnippet: String(data.error || JSON.stringify(data)).slice(0, 240),
      };
    }
    try {
      console.log("PUSH_NOTIFY_OK", data);
    } catch (_) {}
    return { ok: true, data };
  }

  function isEventPublishRequestKind(kind) {
    const k = String(kind || "").trim();
    return (
      k === "event_card" || k === "family_event" || k === "event_request"
    );
  }

  /** Same link key as admin_publish_event_card_v1 idempotency (details contains request_id). */
  function familyEventDetailsMatchRequestId(details, requestId) {
    const rid = String(requestId || "").trim();
    if (!rid) return false;
    const s = String(details == null ? "" : details);
    if (!s) return false;
    if (
      s.indexOf('"requestId":"' + rid + '"') >= 0 ||
      s.indexOf('"request_id":"' + rid + '"') >= 0
    ) {
      return true;
    }
    return s.indexOf(rid) >= 0;
  }

  function normalizeEventMatchText(v) {
    return String(v == null ? "" : v)
      .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
      .replace(/[أإآ]/g, "ا")
      .replace(/ى/g, "ي")
      .replace(/ة/g, "ه")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function normalizeEventMatchDate(v) {
    const Guard = window.AlzidanDupIdentityGuard;
    if (Guard && typeof Guard.normalizeDateKey === "function") {
      return String(Guard.normalizeDateKey(v) || "");
    }
    const s = String(v == null ? "" : v).trim();
    const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (iso) {
      return (
        iso[1] +
        "-" +
        String(iso[2]).padStart(2, "0") +
        "-" +
        String(iso[3]).padStart(2, "0")
      );
    }
    return normalizeEventMatchText(s);
  }

  function familyEventMatchesPublishIdentity(ev, identity) {
    if (!ev || !identity) return false;
    if (normalizeEventMatchText(ev.type) !== normalizeEventMatchText(identity.type)) {
      return false;
    }
    if (
      normalizeEventMatchText(ev.person) !==
      normalizeEventMatchText(identity.person)
    ) {
      return false;
    }
    const wantDate = normalizeEventMatchDate(identity.date);
    if (!wantDate) return false;
    const gotDate = normalizeEventMatchDate(
      ev.event_date || ev.date_label || "",
    );
    return !!gotDate && gotDate === wantDate;
  }

  function buildPublishIdentityFromRequest(row) {
    const Events = window.AlzidanEvents || {};
    if (typeof Events.buildFamilyEventRow === "function") {
      const built = Events.buildFamilyEventRow({
        source: "approval_request",
        row,
      });
      if (built && built.type && built.person) {
        return {
          type: String(built.type || "").trim(),
          person: String(built.person || "").trim(),
          date: String(built.event_date || built.date_label || "").trim(),
        };
      }
    }
    const person = String((row && row.name) || "").trim();
    return person
      ? { type: "gathering", person, date: "" }
      : null;
  }

  /**
   * Same visibility-removal path as Delete (admin_delete_request_v1):
   * DELETE family_events WHERE details LIKE '%' || request_id || '%'.
   * Used by table Delete, table Reject, and Workflow Engine reject.
   * Primary: admin_unpublish_events_for_request_v1 (same SQL match as delete).
   * Fallback: SELECT + admin_family_event_delete_v1 (occasions admin delete RPC).
   */
  async function unpublishPublishedEventForRequest(sb, token, row) {
    if (!isEventPublishRequestKind(row && row.kind)) {
      return { ok: true, skipped: true, deleted: 0 };
    }
    const requestId = String(
      row && row.request_id ? row.request_id : "",
    ).trim();
    if (!sb || !token) {
      return { ok: false, deleted: 0, message: "بيانات النشر ناقصة." };
    }

    const identity = buildPublishIdentityFromRequest(row);
    const person =
      (identity && identity.person) ||
      String((row && row.name) || "").trim() ||
      null;
    const evType = (identity && identity.type) || null;
    const evDate = (identity && identity.date) || null;

    // Primary: same server DELETE as admin_delete_request_v1 (security definer).
    try {
      const { data, error } = await sb.rpc(
        "admin_unpublish_events_for_request_v1",
        {
          p_token: token,
          p_request_id: requestId || null,
          p_person: person,
          p_type: evType,
          p_date: evDate,
        },
      );
      if (!error && data && data.ok === true) {
        const deleted = Number(data.deleted) || 0;
        // Trust security-definer RPC even when deleted=0 (already gone / no match).
        // Falling through to client SELECT used to abort admin delete on RLS errors.
        if (deleted > 0) {
          try {
            localStorage.setItem("alzidan_events_refresh_v1", String(Date.now()));
            window.dispatchEvent(new CustomEvent("alzidan-events-refresh"));
          } catch (_) {}
        }
        try {
          console.info("UNPUBLISH_EVENT ok", {
            via: "rpc",
            request_id: requestId,
            deleted,
          });
        } catch (_) {}
        return { ok: true, deleted, via: "rpc" };
      } else if (
        error &&
        !/could not find|schema cache|PGRST202|404/i.test(
          String(error.message || ""),
        )
      ) {
        const raw = String(error.message || error.details || "").toLowerCase();
        if (/not allowed|permission|jwt|auth/i.test(raw)) {
          return {
            ok: false,
            deleted: 0,
            message: "انتهت جلسة الإدارة أو لا توجد صلاحية لإزالة المناسبة المنشورة.",
            error,
          };
        }
        return {
          ok: false,
          deleted: 0,
          message: "تعذر إزالة المناسبة المنشورة من الشريط/المناسبات.",
          error,
        };
      }
      // RPC missing → fall through to client safety net.
    } catch (e) {
      // fall through
    }

    const byId = new Map();
    if (requestId) {
      try {
        // Same LIKE match as admin_delete_request_v1
        const { data, error } = await sb
          .from("family_events")
          .select("id,details,type,person,date_label,event_date")
          .like("details", "%" + requestId + "%")
          .limit(50);
        if (error) {
          // Soft-fail: SELECT quirks/RLS must not block admin delete/reject.
          // Security-definer RPCs (admin_delete_request_v1 / reject trigger) clean up.
          try {
            console.warn("UNPUBLISH_EVENT select soft-fail", error);
          } catch (_) {}
          return {
            ok: true,
            deleted: 0,
            softFail: true,
            message:
              "تعذر البحث عن المناسبة المنشورة؛ سيُعتمد مسار الحذف/الرفض الآمن.",
            error,
          };
        }
        (Array.isArray(data) ? data : []).forEach((ev) => {
          if (
            familyEventDetailsMatchRequestId(ev && ev.details, requestId) &&
            ev &&
            ev.id != null
          ) {
            byId.set(Number(ev.id), ev);
          }
        });
      } catch (e) {
        try {
          console.warn("UNPUBLISH_EVENT select threw soft-fail", e);
        } catch (_) {}
        return {
          ok: true,
          deleted: 0,
          softFail: true,
          message:
            "تعذر البحث عن المناسبة المنشورة؛ سيُعتمد مسار الحذف/الرفض الآمن.",
          error: e,
        };
      }
    }

    // Fallback: same identity as findExistingEventLive / dup-guard (type+person+date).
    if (!byId.size && identity && identity.type && identity.person && identity.date) {
      try {
        const { data, error } = await sb
          .from("family_events")
          .select("id,details,type,person,date_label,event_date")
          .eq("type", identity.type)
          .limit(200);
        if (error) {
          // Soft-fail: SELECT quirks/RLS must not block admin delete/reject.
          // Security-definer RPCs (admin_delete_request_v1 / reject trigger) clean up.
          try {
            console.warn("UNPUBLISH_EVENT select soft-fail", error);
          } catch (_) {}
          return {
            ok: true,
            deleted: 0,
            softFail: true,
            message:
              "تعذر البحث عن المناسبة المنشورة؛ سيُعتمد مسار الحذف/الرفض الآمن.",
            error,
          };
        }
        (Array.isArray(data) ? data : []).forEach((ev) => {
          if (
            familyEventMatchesPublishIdentity(ev, identity) &&
            ev &&
            ev.id != null
          ) {
            byId.set(Number(ev.id), ev);
          }
        });
      } catch (e) {
        try {
          console.warn("UNPUBLISH_EVENT select threw soft-fail", e);
        } catch (_) {}
        return {
          ok: true,
          deleted: 0,
          softFail: true,
          message:
            "تعذر البحث عن المناسبة المنشورة؛ سيُعتمد مسار الحذف/الرفض الآمن.",
          error: e,
        };
      }
    }

    const matches = Array.from(byId.values());
    let deleted = 0;
    for (let i = 0; i < matches.length; i++) {
      const id = Number(matches[i] && matches[i].id);
      if (!Number.isFinite(id) || id <= 0) continue;
      // Same RPC used by occasions «إدارة المناسبات» delete button.
      const { data, error } = await sb.rpc("admin_family_event_delete_v1", {
        p_token: token,
        p_id: id,
      });
      if (error || data !== true) {
        return {
          ok: false,
          deleted,
          message: "تعذر حذف المناسبة المنشورة من الشريط/المناسبات.",
          error,
        };
      }
      deleted += 1;
    }
    try {
      localStorage.setItem("alzidan_events_refresh_v1", String(Date.now()));
      window.dispatchEvent(new CustomEvent("alzidan-events-refresh"));
    } catch (_) {}
    try {
      console.info("UNPUBLISH_EVENT ok", {
        via: "client",
        request_id: requestId,
        deleted,
      });
    } catch (_) {}
    return { ok: true, deleted, via: "client" };
  }

  function publishEventRpcErrorMeta(error) {
    const msg = String((error && error.message) || "");
    const details = String((error && error.details) || "");
    const hint = String((error && error.hint) || "");
    const blob = (msg + " " + details + " " + hint).toLowerCase();
    const needsSql =
      msg.includes("تعذر تنفيذ العملية") ||
      msg.includes("تحديث الخدمة") ||
      /could not find|schema cache|pgrst202|does not exist|404/.test(blob);
    const badDate = /invalid input syntax|date\/time/.test(blob);
    return { msg, blob, needsSql, badDate };
  }

  async function publishEventCardRequest(sb, token, row, opts) {
    const options = opts && typeof opts === "object" ? opts : {};
    const skipFamilyPush = options.skipFamilyPush === true;
    const requestId = String(
      row && row.request_id ? row.request_id : "",
    ).trim();
    if (!requestId) return { ok: false, message: "رقم الطلب ناقص." };
    const Events = window.AlzidanEvents || {};
    let eventRow =
      typeof Events.buildFamilyEventRow === "function"
        ? Events.buildFamilyEventRow({ source: "approval_request", row })
        : null;
    if (!eventRow || !eventRow.branch_key || !eventRow.type || !eventRow.person) {
      return {
        ok: false,
        message:
          "بيانات المناسبة ناقصة، افتح عرض الطلب وتأكد من الفرع والنوع والاسم.",
      };
    }
    // Accept/publish ≠ immediate show: persist schedule (default 3 days before event_date).
    const Vis = window.AlzidanEventVisibility || null;
    function applyPublishSchedule(target) {
      const row = target || {};
      if (!(Vis && typeof Vis.buildScheduleFields === "function")) {
        if (row.show_before_days == null && !row.show_at) row.show_before_days = 3;
        return row;
      }
      const sch = Vis.buildScheduleFields({
        event_date: row.event_date || "",
        date_label: row.date_label || "",
        date: row.date_label || row.date || "",
        show_before_days: row.show_before_days != null ? row.show_before_days : 3,
        show_at: row.show_at || "",
        end_at: row.end_at || "",
        manual_hidden: row.manual_hidden || false,
      });
      if (sch.show_before_days != null) row.show_before_days = sch.show_before_days;
      if (sch.show_at) row.show_at = sch.show_at;
      if (sch.end_at) row.end_at = sch.end_at;
      row.manual_hidden = !!sch.manual_hidden;
      if (typeof Vis.mergeScheduleIntoDetails === "function") {
        const merged = Vis.mergeScheduleIntoDetails(row.details, sch);
        row.details = typeof merged === "string" ? merged : JSON.stringify(merged);
      }
      return row;
    }
    eventRow = applyPublishSchedule(eventRow);
    if (typeof Events.sanitizeFamilyEventRowForPublish === "function") {
      eventRow = Events.sanitizeFamilyEventRowForPublish(eventRow);
    }
    if (!eventRow.branch_key || !eventRow.type || !eventRow.person) {
      return {
        ok: false,
        message:
          "بيانات المناسبة ناقصة، افتح عرض الطلب وتأكد من الفرع والنوع والاسم.",
      };
    }

    async function callPublish(payload) {
      return sb.rpc("admin_publish_event_card_v1", {
        p_token: token,
        p_request_id: requestId,
        p_row: payload,
      });
    }

    let { data, error } = await callPublish(eventRow);
    if (error && publishEventRpcErrorMeta(error).badDate) {
      try {
        console.warn("PUBLISH_EVENT date-cast retry", error);
      } catch (_) {}
      // Keep schedule; only clear Gregorian cast fields that Postgres rejected.
      let retryRow = Object.assign({}, eventRow, {
        event_date: "",
        visit_date_from: "",
        visit_date_to: "",
      });
      delete retryRow.created_at;
      retryRow = applyPublishSchedule(retryRow);
      const second = await callPublish(retryRow);
      data = second.data;
      error = second.error;
      if (!error && data === true) eventRow = retryRow;
    }
    if (error) {
      try {
        console.warn("PUBLISH_EVENT rpc error", error);
      } catch (_) {}
      const meta = publishEventRpcErrorMeta(error);
      if (meta.needsSql) {
        return {
          ok: false,
          needsSql: true,
          message:
            "تعذر نشر المناسبة حالياً. من أدوات الصيانة شغّل «جدولة ظهور المناسبات» ثم حدّث الصفحة وأعد النشر.",
        };
      }
      return {
        ok: false,
        message: "تعذر نشر المناسبة حالياً، حاول لاحقاً أو تواصل مع الإدارة.",
      };
    }
    if (data !== true)
      return {
        ok: false,
        message: "تعذر نشر المناسبة. تحقق من صلاحية الإدارة.",
      };
    // Callers that also send status_changed to the submitter should pass
    // skipFamilyPush:true, then notify the submitter, then call notifyFamilyEventPush
    // — otherwise a dead Expo token disabled during family broadcast can block approval push.
    if (skipFamilyPush) {
      return {
        ok: true,
        eventRow,
        push: null,
        pushMessage: "",
        familyPushDeferred: true,
      };
    }
    const push = await notifyFamilyEventPush(sb, eventRow);
    return {
      ok: true,
      eventRow,
      push,
      pushMessage: formatPushNotifyAdminMessage(push),
    };
  }
  function buildTreeCardMessageFromPayload(payload, reqRow) {
    const Contract = treeCardContract();
    if (Contract && typeof Contract.serializeTreeCardRequest === "function") {
      const normalized =
        typeof Contract.normalizeTreeCardPayload === "function"
          ? Contract.normalizeTreeCardPayload(payload || {}, { row: reqRow })
          : payload || {};
      return Contract.serializeTreeCardRequest(normalized, reqRow || {});
    }
    const ancestors = Array.isArray(payload.ancestors) ? payload.ancestors : [];
    const children = Array.isArray(payload.children) ? payload.children : [];
    const submitter = payload.submitter || {};
    const lines = [
      "بطاقة إضافة بيانات للشجرة",
      "",
      "رقم الطلب: " + String(reqRow.request_id || ""),
      "العائلة (إجباري): " + String(payload.branch_key || ""),
    ];
    const lineagePath = Array.isArray(payload.lineage_path)
      ? payload.lineage_path
      : [];
    const treeRows = Array.isArray(payload.tree_rows) ? payload.tree_rows : [];
    if (treeRows.length) {
      lines.push("العلاقات العائلية:");
      treeRows.forEach((relation, idx) => {
        lines.push(
          String(idx + 1) +
            "- " +
            relationPathLabel(relation.parent_name) +
            " ← " +
            relationLeafName(relation.child_name) +
            (relation.birth_date_g ? " — " + relation.birth_date_g : ""),
        );
      });
    } else if (lineagePath.length) {
      lines.push("مسار النسب من الأكبر إلى الأصغر:");
      lineagePath.forEach((name, idx) =>
        lines.push(String(idx + 1) + "- " + name),
      );
    } else {
      lines.push("سلسلة الأجداد:");
      ancestors.forEach((name, idx) =>
        lines.push("الجد " + String(idx + 1) + ": " + name),
      );
    }
    lines.push("الأب (إجباري): " + String(payload.father || ""));
    lines.push("الاسم (إجباري): " + String(payload.name || ""));
    lines.push(
      "تاريخ الميلاد (اختياري): " + String(payload.birth_date_g || ""),
    );
    lines.push("المدينة (اختياري): " + String(payload.city || ""));
    lines.push("الحي/القرية (اختياري): " + String(payload.area || ""));
    lines.push("", "الأبناء (اختياري):");
    if (children.length) {
      children.forEach((child, idx) => {
        lines.push(
          String(idx + 1) +
            "- الاسم: " +
            child.name +
            " — تاريخ الميلاد: " +
            String(child.dob || ""),
        );
      });
    } else {
      lines.push("(لا يوجد)");
    }
    lines.push("", "بيانات المرسل (إجباري):");
    lines.push("الاسم: " + String(submitter.name || ""));
    lines.push("الجوال: " + String(submitter.phone || ""));
    lines.push("البريد (اختياري): " + String(submitter.email || ""));
    lines.push(
      "التاريخ: " +
        formatDateTimeArSaVerbose(
          payload.created_at || reqRow.created_at || new Date().toISOString(),
        ),
    );
    lines.push("", "__JSON__:", JSON.stringify(payload, null, 2));
    return lines.join("\n");
  }
  function parseEditedChildren(text) {
    const children = [];
    const lines = String(text || "").split(/\r?\n/);
    for (const raw of lines) {
      const line = normalizeTreeCardText(raw);
      if (!line) continue;
      const parts = line.split("|");
      const name = normalizeTreeCardText(parts[0] || "");
      const dob = normalizeTreeCardText(parts.slice(1).join("|") || "");
      if (!name) continue;
      children.push({ name, dob });
    }
    return children;
  }
  function showTreeCardEditError(text) {
    if (!treeCardEditError) {
      treeCardEditError = document.getElementById("tree-card-edit-error");
    }
    const el = treeCardEditError || document.getElementById("tree-card-edit-error");
    if (!el) {
      if (text) {
        try {
          window.alert(String(text));
        } catch (_) {}
      }
      return;
    }
    treeCardEditError = el;
    el.textContent = String(text || "");
    el.style.display = text ? "block" : "none";
  }
  function relationLeafName(path) {
    const parts = String(path || "")
      .split("/")
      .map(normalizeTreeCardText)
      .filter(Boolean);
    return parts.length ? parts[parts.length - 1] : "";
  }
  function relationPathLabel(path) {
    return String(path || "")
      .split("/")
      .map(normalizeTreeCardText)
      .filter(Boolean)
      .join(" ← ");
  }
  function escapeTreeCardHtml(v) {
    return String(v || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function treeCardFormEl(name) {
    return treeCardEditForm && treeCardEditForm.elements
      ? treeCardEditForm.elements[name]
      : null;
  }

  function treeCardBranchRoot(branch) {
    const b = normalizeTreeCardText(branch || "");
    return b ? b + " بن مطلق بن زيدان" : "";
  }

  function isTreeCardBranchRootPath(path, branch) {
    const p = normalizeTreeCardText(path || "");
    const b = normalizeTreeCardText(branch || "");
    const root = treeCardBranchRoot(b);
    return !!p && (p === b || p === root);
  }

  function fatherSearchMatches(term, label, value) {
    const q = normalizeTreeCardText(term || "");
    if (!q) return false;
    const SpousesCore = window.AlzidanSpousesCore || {};
    if (SpousesCore && typeof SpousesCore.matchesOrderedSubstring === "function") {
      return (
        SpousesCore.matchesOrderedSubstring(q, label || "") ||
        SpousesCore.matchesOrderedSubstring(q, value || "")
      );
    }
    const ql = q.toLowerCase();
    return (
      String(label || "")
        .toLowerCase()
        .indexOf(ql) >= 0 ||
      String(value || "")
        .toLowerCase()
        .indexOf(ql) >= 0
    );
  }

  function filterFatherSearchOptions(term, options) {
    const q = normalizeTreeCardText(term || "");
    if (!q) return [];
    const list = Array.isArray(options) ? options : [];
    return list
      .filter(function (opt) {
        return fatherSearchMatches(
          q,
          opt.label || opt.leaf || "",
          opt.value || opt.path || "",
        );
      })
      .slice(0, TREE_CARD_FATHER_SEARCH_LIMIT);
  }

  function fatherShortDisambiguator(path) {
    const parts = String(path || "")
      .split("/")
      .map(normalizeTreeCardText)
      .filter(Boolean);
    if (parts.length < 2) return "";
    return parts[parts.length - 2] || "";
  }

  function labelFatherOptions(rows) {
    const mapped = (rows || [])
      .map(function (r) {
        const path = normalizeTreeCardText(
          r.person_lineage ||
            r.child_name ||
            r.full_name ||
            r.name ||
            r.path ||
            "",
        );
        const personId = normalizeTreeCardText(
          r.person_id || r.personId || r.id || "",
        );
        const leaf =
          relationLeafName(path) ||
          normalizeTreeCardText(r.display_name || r.leaf || "");
        return {
          path: path,
          value: path,
          person_id: personId,
          leaf: leaf,
          label: leaf,
        };
      })
      .filter(function (o) {
        // Path is required; person_id may be resolved after pick.
        return !!o.path;
      });
    const leafCounts = {};
    mapped.forEach(function (o) {
      leafCounts[o.leaf] = (leafCounts[o.leaf] || 0) + 1;
    });
    return mapped.map(function (o) {
      let label = o.leaf || o.path;
      if ((leafCounts[o.leaf] || 0) > 1) {
        // Full path for ambiguous same-leaf fathers (e.g. many محمد).
        label = (o.leaf || "") + " — " + o.path;
      }
      return Object.assign({}, o, { label: label });
    });
  }

  function rankFatherSearchOptions(term, options) {
    const q = normalizeTreeCardText(term || "");
    const list = Array.isArray(options) ? options.slice() : [];
    list.sort(function (a, b) {
      const aLeaf = normalizeTreeCardText(a.leaf || "");
      const bLeaf = normalizeTreeCardText(b.leaf || "");
      const aExact = aLeaf === q ? 0 : aLeaf.indexOf(q) === 0 ? 1 : 2;
      const bExact = bLeaf === q ? 0 : bLeaf.indexOf(q) === 0 ? 1 : 2;
      if (aExact !== bExact) return aExact - bExact;
      const aPid = a.person_id ? 0 : 1;
      const bPid = b.person_id ? 0 : 1;
      if (aPid !== bPid) return aPid - bPid;
      return String(a.path || "").localeCompare(String(b.path || ""), "ar");
    });
    return list;
  }

  async function resolveFatherIdentityInTree(sb, branch, personId, pathHint) {
    const pid = normalizeTreeCardText(personId || "");
    const path = normalizeTreeCardText(pathHint || "");
    const key = normalizeTreeCardText(branch || "");
    if (!sb) return { ok: false };

    if (pid) {
      let q = sb
        .from("tree_children")
        .select("person_id,child_name,name,branch_key,parent_name,parent")
        .eq("person_id", pid)
        .limit(8);
      if (key) q = q.eq("branch_key", key);
      const res = await q;
      if (!res.error && Array.isArray(res.data) && res.data.length) {
        let row = res.data[0];
        if (path && res.data.length > 1) {
          const hit = res.data.find(function (r) {
            return (
              normalizeTreeCardText(r.child_name || r.name || "") === path
            );
          });
          if (hit) row = hit;
        }
        const resolvedPath = normalizeTreeCardText(
          row.child_name || row.name || path || "",
        );
        const resolvedPid = normalizeTreeCardText(row.person_id || pid);
        if (resolvedPid) {
          return { ok: true, path: resolvedPath, person_id: resolvedPid };
        }
      }
    }

    if (path) {
      let byChild = sb
        .from("tree_children")
        .select("person_id,child_name,name,branch_key,parent_name,parent")
        .eq("child_name", path)
        .limit(5);
      if (key) byChild = byChild.eq("branch_key", key);
      let res = await byChild;
      if (res.error || !Array.isArray(res.data) || !res.data.length) {
        let byName = sb
          .from("tree_children")
          .select("person_id,child_name,name,branch_key,parent_name,parent")
          .eq("name", path)
          .limit(5);
        if (key) byName = byName.eq("branch_key", key);
        res = await byName;
      }
      if (!res.error && Array.isArray(res.data) && res.data.length) {
        const withPid = res.data.filter(function (r) {
          return !!normalizeTreeCardText(r.person_id || "");
        });
        const pool = withPid.length ? withPid : res.data;
        if (pool.length === 1) {
          const row = pool[0];
          const resolvedPid = normalizeTreeCardText(row.person_id || "");
          const resolvedPath = normalizeTreeCardText(
            row.child_name || row.name || path,
          );
          if (resolvedPid) {
            return { ok: true, path: resolvedPath, person_id: resolvedPid };
          }
        } else if (pid) {
          const hit = pool.find(function (r) {
            return normalizeTreeCardText(r.person_id || "") === pid;
          });
          if (hit) {
            return {
              ok: true,
              path: normalizeTreeCardText(hit.child_name || hit.name || path),
              person_id: pid,
            };
          }
        }
      }
    }

    return { ok: false };
  }

  async function queryFatherSearchCandidates(branch, term) {
    const q = normalizeTreeCardText(term || "");
    if (q.length < 1) return [];
    const sb = getClient();
    const key = normalizeTreeCardText(branch || "");
    const out = [];
    const root = treeCardBranchRoot(key);
    if (root && fatherSearchMatches(q, root, key)) {
      out.push({
        path: root,
        value: root,
        person_id: "",
        leaf: relationLeafName(root) || key,
        label: key + " (أصل الفرع)",
        is_root: true,
      });
    }
    if (!sb) return out.slice(0, TREE_CARD_FATHER_SEARCH_LIMIT);

    let rows = [];
    // Primary: tree_children leaf/path search (always includes person_id when present).
    // Avoid relying solely on memory_tree_search_v1 parent_name matches that can
    // surface children-of-X when searching for X.
    try {
      const FM = window.AlzidanFamilyPersonCore || {};
      const orFilter =
        typeof FM.buildPersonNameIlikeOrFilter === "function"
          ? FM.buildPersonNameIlikeOrFilter(q)
          : "child_name.ilike.%" + q + "%,name.ilike.%" + q + "%";
      let fb = sb
        .from("tree_children")
        .select("person_id,branch_key,child_name,name,parent_name,parent")
        .or(orFilter)
        .limit(TREE_CARD_FATHER_SEARCH_LIMIT);
      if (key) fb = fb.eq("branch_key", key);
      const res = await fb;
      if (!res.error && Array.isArray(res.data)) {
        rows = res.data.map(function (r) {
          const lineage =
            normalizeTreeCardText(r.child_name) ||
            normalizeTreeCardText(r.name);
          return {
            person_id: r.person_id,
            full_name: lineage,
            display_name: relationLeafName(lineage) || lineage,
            person_lineage: lineage,
            child_name: lineage,
            branch_key: r.branch_key,
          };
        });
      }
    } catch (_) {
      rows = [];
    }

    if (!rows.length) {
      try {
        const rpc = await sb.rpc("memory_tree_search_v1", {
          p_query: q,
          p_branch_key: key || null,
          p_limit: TREE_CARD_FATHER_SEARCH_LIMIT,
        });
        if (!rpc.error && rpc.data) {
          rows = typeof rpc.data === "string" ? JSON.parse(rpc.data) : rpc.data;
          if (!Array.isArray(rows)) rows = [];
        }
      } catch (_) {
        rows = [];
      }
    }

    let labeled = labelFatherOptions(rows);
    // Prefer people whose leaf matches the query (e.g. محمد) over descendants
    // whose path merely contains the query.
    const FMLeaf = window.AlzidanFamilyPersonCore || {};
    const qVariants =
      typeof FMLeaf.arabicSearchQueryVariants === "function"
        ? FMLeaf.arabicSearchQueryVariants(q)
        : [q];
    const leafHits = labeled.filter(function (o) {
      const leaf = normalizeTreeCardText(o.leaf || "");
      return qVariants.some(function (qv) {
        return leaf === qv || leaf.indexOf(qv) >= 0;
      });
    });
    if (leafHits.length) labeled = leafHits;
    labeled = rankFatherSearchOptions(q, filterFatherSearchOptions(q, labeled));
    const seen = {};
    labeled.forEach(function (opt) {
      const id = opt.person_id || opt.path;
      if (!id || seen[id]) return;
      seen[id] = true;
      out.push(opt);
    });
    return out.slice(0, TREE_CARD_FATHER_SEARCH_LIMIT);
  }

  function renderFatherSearchResults(items) {
    const box = document.getElementById("edit-card-father-results");
    if (!box) return;
    if (!items || !items.length) {
      box.classList.remove("fm-open");
      box.innerHTML = "";
      return;
    }
    box.innerHTML = items
      .map(function (opt) {
        return (
          '<div class="fm-search-item" role="option" data-father-path="' +
          escapeTreeCardHtml(opt.path || "") +
          '" data-father-pid="' +
          escapeTreeCardHtml(opt.person_id || "") +
          '" data-father-label="' +
          escapeTreeCardHtml(opt.label || opt.leaf || "") +
          '">' +
          escapeTreeCardHtml(opt.label || opt.leaf || opt.path || "") +
          "</div>"
        );
      })
      .join("");
    box.classList.add("fm-open");
    box.querySelectorAll(".fm-search-item").forEach(function (el) {
      el.addEventListener("click", function () {
        selectTreeCardFather({
          path: el.getAttribute("data-father-path") || "",
          person_id: el.getAttribute("data-father-pid") || "",
          label: el.getAttribute("data-father-label") || "",
          inferAncestors: true,
        });
      });
    });
  }

  function setFatherSearchOpen(open) {
    const wrap = document.getElementById("edit-card-father-search-wrap");
    const search = document.getElementById("edit-card-father-search");
    if (wrap) wrap.style.display = open ? "block" : "none";
    if (!open) {
      renderFatherSearchResults([]);
      if (search) search.value = "";
    } else if (search) {
      search.focus();
    }
  }

  function treeCardFatherPersonIdValue() {
    return normalizeTreeCardText(
      treeCardFormEl("fatherPersonId") && treeCardFormEl("fatherPersonId").value,
    );
  }

  /**
   * Seed father typeahead without dispatching "input" (input clears a bound
   * father UUID — that raced with manual pick during auto-resolve).
   */
  async function seedFatherSearchTerm(term, opts) {
    const o = opts || {};
    const q = normalizeTreeCardText(term || "");
    setFatherSearchOpen(true);
    const search = document.getElementById("edit-card-father-search");
    if (search) {
      if (o.placeholder) search.placeholder = String(o.placeholder);
      search.value = q;
    }
    if (!q) {
      renderFatherSearchResults([]);
      return;
    }
    const seq = ++treeCardFatherSearchSeq;
    const branch = normalizeTreeCardText(
      treeCardFormEl("branch") && treeCardFormEl("branch").value,
    );
    const items = await queryFatherSearchCandidates(branch, q);
    if (seq !== treeCardFatherSearchSeq) return;
    // If admin already bound a father while we queried, do not clobber UI.
    if (treeCardFatherPersonIdValue()) return;
    renderFatherSearchResults(items);
  }

  function updateFatherCurrentUi() {
    const current = document.getElementById("edit-card-father-current");
    const clearBtn = document.getElementById("edit-card-father-clear");
    const pathEl = treeCardFormEl("fatherPath");
    const pidEl = treeCardFormEl("fatherPersonId");
    const labelEl = treeCardFormEl("fatherLabel");
    const path = normalizeTreeCardText(pathEl && pathEl.value);
    const pid = normalizeTreeCardText(pidEl && pidEl.value);
    const label =
      normalizeTreeCardText(labelEl && labelEl.value) ||
      relationLeafName(path) ||
      "";
    if (!current) return;
    if (!path && !pid) {
      current.textContent =
        "الأب الحالي: غير محدد — اضغط «تغيير الأب» للبحث في الشجرة.";
      current.classList.add("is-empty");
      if (clearBtn) clearBtn.style.display = "none";
      return;
    }
    const leaf = label || relationLeafName(path) || "محدد";
    const branch =
      treeCardFormEl("branch") && treeCardFormEl("branch").value;
    if (pid) {
      current.textContent = "الأب الحالي: " + leaf;
      current.classList.remove("is-empty");
    } else if (isTreeCardBranchRootPath(path, branch)) {
      current.textContent = "الأب الحالي: " + leaf + " (أصل الفرع)";
      current.classList.remove("is-empty");
    } else {
      current.textContent =
        "الأب الحالي: " + leaf + " — بانتظار ربط الهوية من الشجرة";
      current.classList.add("is-empty");
    }
    if (clearBtn) clearBtn.style.display = "inline-flex";
  }

  function clearTreeCardFatherSelection() {
    const pathEl = treeCardFormEl("fatherPath");
    const pidEl = treeCardFormEl("fatherPersonId");
    const labelEl = treeCardFormEl("fatherLabel");
    if (pathEl) pathEl.value = "";
    if (pidEl) pidEl.value = "";
    if (labelEl) labelEl.value = "";
    updateFatherCurrentUi();
    setFatherSearchOpen(true);
  }

  function inferAncestorsFromFatherPath(path, branch) {
    const root = treeCardBranchRoot(branch);
    const parts = String(path || "")
      .split("/")
      .map(normalizeTreeCardText)
      .filter(Boolean);
    if (root && parts[0] === root) parts.shift();
    if (parts.length) parts.pop();
    return parts.slice().reverse().slice(0, 4);
  }

  function selectTreeCardFather(opts) {
    const o = opts || {};
    const path = normalizeTreeCardText(o.path || "");
    let pid = normalizeTreeCardText(o.person_id || "");
    const label =
      normalizeTreeCardText(o.label || "") || relationLeafName(path) || "";
    const branch = normalizeTreeCardText(
      treeCardFormEl("branch") && treeCardFormEl("branch").value,
    );
    const pathEl = treeCardFormEl("fatherPath");
    const pidEl = treeCardFormEl("fatherPersonId");
    const labelEl = treeCardFormEl("fatherLabel");
    if (pathEl) pathEl.value = path;
    if (pidEl) pidEl.value = pid;
    if (labelEl) labelEl.value = label;
    if (o.inferAncestors && path) {
      const inferred = inferAncestorsFromFatherPath(path, branch);
      ["grandfather1", "grandfather2", "grandfather3", "grandfather4"].forEach(
        function (name, idx) {
          const el = treeCardFormEl(name);
          if (el) el.value = inferred[idx] || "";
        },
      );
    }
    updateFatherCurrentUi();
    setFatherSearchOpen(false);
    showTreeCardEditError("");

    // Resolve missing person_id from exact tree path (person_id is SSOT).
    if (
      path &&
      !pid &&
      !isTreeCardBranchRootPath(path, branch) &&
      o.resolveIdentity !== false
    ) {
      const sb = getClient();
      if (sb) {
        showTreeCardEditError("جاري التحقق من هوية الأب في الشجرة…");
        resolveFatherIdentityInTree(sb, branch, "", path)
          .then(function (resolved) {
            if (!resolved || !resolved.ok || !resolved.person_id) {
              showTreeCardEditError(
                "تعذر ربط الأب بهوية فريدة في الشجرة. اختر نتيجة بحث أخرى لنفس الاسم.",
              );
              return;
            }
            if (pathEl && pathEl.value !== path) return; // user changed selection
            if (pathEl && resolved.path) pathEl.value = resolved.path;
            if (pidEl) pidEl.value = resolved.person_id;
            if (labelEl && !labelEl.value) {
              labelEl.value = relationLeafName(resolved.path) || label;
            }
            if (o.inferAncestors && resolved.path) {
              const inferred = inferAncestorsFromFatherPath(
                resolved.path,
                branch,
              );
              [
                "grandfather1",
                "grandfather2",
                "grandfather3",
                "grandfather4",
              ].forEach(function (name, idx) {
                const el = treeCardFormEl(name);
                if (el) el.value = inferred[idx] || "";
              });
            }
            updateFatherCurrentUi();
            showTreeCardEditError("");
          })
          .catch(function () {
            showTreeCardEditError(
              "تعذر التحقق من الأب. حاول اختياره مرة أخرى من نتائج البحث.",
            );
          });
      }
    }
  }

  function renderOriginalRequestReview(payload, row) {
    const box = document.getElementById("edit-card-original-review");
    if (!box) return;
    const p = payload || {};
    const submitter = p.submitter || {};
    const ancestors = treeCardAncestorsClosestFirst(p);
    const rows = [
      ["الفرع", p.branch_key || (row && row.branch_key) || "—"],
      ["الاسم", p.name || "—"],
      ["الأب", p.father || relationLeafName(p.father_path || "") || "—"],
      ["الجد 1", ancestors[0] || p.grandfather || "—"],
      ["الجد 2", ancestors[1] || p.grandfather2 || "—"],
      ["الجد 3", ancestors[2] || p.grandfather3 || "—"],
      ["الجد 4", ancestors[3] || p.grandfather4 || "—"],
      ["تاريخ الميلاد", p.birth_date_g || "—"],
      ["المدينة", p.city || "—"],
      ["الحي/القرية", p.area || "—"],
      ["المرسل", submitter.name || (row && row.name) || "—"],
      ["الجوال", submitter.phone || (row && row.phone) || "—"],
      ["البريد", submitter.email || (row && row.email) || "—"],
    ];
    box.innerHTML =
      '<dl class="tce-kv">' +
      rows
        .map(function (pair) {
          return (
            "<dt>" +
            escapeTreeCardHtml(pair[0]) +
            "</dt><dd>" +
            escapeTreeCardHtml(pair[1]) +
            "</dd>"
          );
        })
        .join("") +
      "</dl>";
  }

  function fillCorrectionFieldsFromPayload(payload, row) {
    const p = payload || {};
    const submitter = p.submitter || {};
    const branch = normalizeTreeCardText(
      p.branch_key || (row && row.branch_key) || "",
    );
    const ancestors = treeCardAncestorsClosestFirst(p);
    if (treeCardFormEl("branch")) treeCardFormEl("branch").value = branch;
    if (treeCardFormEl("personName"))
      treeCardFormEl("personName").value = normalizeTreeCardText(p.name || "");
    if (treeCardFormEl("birthDate"))
      treeCardFormEl("birthDate").value = normalizeTreeCardText(
        p.birth_date_g || "",
      );
    if (treeCardFormEl("city"))
      treeCardFormEl("city").value = normalizeTreeCardText(p.city || "");
    if (treeCardFormEl("area"))
      treeCardFormEl("area").value = normalizeTreeCardText(p.area || "");
    if (treeCardFormEl("grandfather1"))
      treeCardFormEl("grandfather1").value = ancestors[0] || "";
    if (treeCardFormEl("grandfather2"))
      treeCardFormEl("grandfather2").value = ancestors[1] || "";
    if (treeCardFormEl("grandfather3"))
      treeCardFormEl("grandfather3").value = ancestors[2] || "";
    if (treeCardFormEl("grandfather4"))
      treeCardFormEl("grandfather4").value = ancestors[3] || "";
    if (treeCardFormEl("submitterName"))
      treeCardFormEl("submitterName").value = normalizeTreeCardText(
        submitter.name || (row && row.name) || "",
      );
    if (treeCardFormEl("submitterPhone"))
      treeCardFormEl("submitterPhone").value = normalizeAdminPhone(
        submitter.phone || (row && row.phone) || "",
      );
    if (treeCardFormEl("submitterEmail"))
      treeCardFormEl("submitterEmail").value = normalizeEmail(
        submitter.email || (row && row.email) || "",
      );

    const fatherLeaf = normalizeTreeCardText(p.father || "");
    const fatherPath = normalizeTreeCardText(
      p.father_path || p.parent_path || p.parent_node_id || "",
    );
    const fatherPid = normalizeTreeCardText(
      p.father_person_id ||
        p.parent_person_id ||
        p.selected_parent_person_id ||
        "",
    );
    if (fatherPid || (fatherPath && fatherPath.indexOf("/") >= 0)) {
      selectTreeCardFather({
        path: fatherPath || fatherLeaf,
        person_id: fatherPid,
        label: fatherLeaf || relationLeafName(fatherPath) || "",
        inferAncestors: !ancestors.length,
        resolveIdentity: true,
      });
    } else {
      // Text-only father from member request — show grandparents/name but do not
      // pretend the father is verified until person_id is resolved.
      clearTreeCardFatherSelection();
      setFatherSearchOpen(false);
      updateFatherCurrentUi();
      if (fatherLeaf) {
        showTreeCardEditError(
          "جاري ربط الأب «" + fatherLeaf + "» بهوية الشجرة…",
        );
      }
    }
  }

  /**
   * Resolve admin-correction father person_id from request text + ancestors
   * using targeted tree_children lookups (no full-branch dump).
   */
  async function autoResolveAdminFatherFromPayload(payload, branch) {
    const sb = getClient();
    const key = normalizeTreeCardText(branch || "");
    const p = payload || {};
    if (!sb || !key) return { ok: false, reason: "no_client" };

    const existingPid = normalizeTreeCardText(
      p.father_person_id ||
        p.parent_person_id ||
        p.selected_parent_person_id ||
        "",
    );
    const existingPath = normalizeTreeCardText(
      p.father_path || p.parent_path || p.parent_node_id || "",
    );
    if (existingPid) {
      const verified = await resolveFatherIdentityInTree(
        sb,
        key,
        existingPid,
        existingPath,
      );
      if (verified.ok) return verified;
    }

    const hints = buildTreeCardFatherResolveHints(p, key);
    const found = [];
    const seenPid = {};
    for (let i = 0; i < hints.hints.length; i += 1) {
      const hint = hints.hints[i];
      const path = normalizeTreeCardText(hint.path || "");
      if (!path || path.indexOf("/") < 0) continue; // skip bare leaf guesses first
      const resolved = await resolveFatherIdentityInTree(sb, key, "", path);
      if (resolved && resolved.ok && resolved.person_id) {
        if (seenPid[resolved.person_id]) continue;
        seenPid[resolved.person_id] = true;
        found.push(resolved);
      }
    }

    // If full-path hints missed, try unique leaf under closest grandfather.
    if (!found.length && hints.father) {
      const leaf = hints.father;
      const gf = hints.closestGrandfather || "";
      let res = await sb
        .from("tree_children")
        .select("person_id,child_name,name,branch_key,parent_name,parent")
        .eq("branch_key", key)
        .ilike("child_name", "%/" + leaf)
        .limit(20);
      if (res.error || !Array.isArray(res.data) || !res.data.length) {
        res = await sb
          .from("tree_children")
          .select("person_id,child_name,name,branch_key,parent_name,parent")
          .eq("branch_key", key)
          .ilike("child_name", "%" + leaf)
          .limit(20);
      }
      if (!res.error && Array.isArray(res.data)) {
        const leafHits = res.data.filter(function (r) {
          const path = normalizeTreeCardText(r.child_name || r.name || "");
          const pid = normalizeTreeCardText(r.person_id || "");
          if (!pid || relationLeafName(path) !== leaf) return false;
          if (gf && path.indexOf("/" + gf + "/" + leaf) < 0) return false;
          return true;
        });
        const uniq = {};
        leafHits.forEach(function (r) {
          const pid = normalizeTreeCardText(r.person_id || "");
          if (!pid || uniq[pid]) return;
          uniq[pid] = {
            ok: true,
            path: normalizeTreeCardText(r.child_name || r.name || ""),
            person_id: pid,
          };
        });
        Object.keys(uniq).forEach(function (k) {
          found.push(uniq[k]);
        });
      }
    }

    if (found.length === 1) {
      return {
        ok: true,
        path: found[0].path,
        person_id: found[0].person_id,
        label: relationLeafName(found[0].path) || hints.father || "",
      };
    }
    if (found.length > 1) {
      return {
        ok: false,
        ambiguous: true,
        candidates: found,
        father: hints.father || "",
      };
    }
    return { ok: false, reason: "not_found", father: hints.father || "" };
  }

  function collectAdminCorrection(branch) {
    const personName = normalizeTreeCardText(
      treeCardFormEl("personName") && treeCardFormEl("personName").value,
    );
    const fatherPath = normalizeTreeCardText(
      treeCardFormEl("fatherPath") && treeCardFormEl("fatherPath").value,
    );
    const fatherPid = normalizeTreeCardText(
      treeCardFormEl("fatherPersonId") && treeCardFormEl("fatherPersonId").value,
    );
    const fatherLabel = normalizeTreeCardText(
      treeCardFormEl("fatherLabel") && treeCardFormEl("fatherLabel").value,
    );
    const dob = normalizeTreeCardText(
      treeCardFormEl("birthDate") && treeCardFormEl("birthDate").value,
    );
    const city = normalizeTreeCardText(
      treeCardFormEl("city") && treeCardFormEl("city").value,
    );
    const area = normalizeTreeCardText(
      treeCardFormEl("area") && treeCardFormEl("area").value,
    );
    const ancestors = [
      normalizeTreeCardText(
        treeCardFormEl("grandfather1") && treeCardFormEl("grandfather1").value,
      ),
      normalizeTreeCardText(
        treeCardFormEl("grandfather2") && treeCardFormEl("grandfather2").value,
      ),
      normalizeTreeCardText(
        treeCardFormEl("grandfather3") && treeCardFormEl("grandfather3").value,
      ),
      normalizeTreeCardText(
        treeCardFormEl("grandfather4") && treeCardFormEl("grandfather4").value,
      ),
    ].filter(Boolean);
    if (!personName) {
      return { ok: false, message: "اكتب اسم الشخص المضاف." };
    }
    if (!fatherPath) {
      return { ok: false, message: "اختر الأب من البحث قبل الحفظ." };
    }
    const isRoot = isTreeCardBranchRootPath(fatherPath, branch);
    if (!isRoot && !fatherPid && fatherPath.indexOf("/") < 0) {
      return {
        ok: false,
        message:
          "اختر الأب من نتائج البحث حتى يُربط بمعرّف الشجرة قبل الحفظ.",
      };
    }
    const fatherLeaf = fatherLabel || relationLeafName(fatherPath) || fatherPath;
    const childPath = fatherPath + "/" + personName;
    const rows = [
      {
        branch_key: branch,
        parent_name: fatherPath,
        child_name: childPath,
        birth_date_g: dob || "",
        parent_person_id: isRoot ? "" : fatherPid,
        city: city || "",
        area: area || "",
      },
    ];
    return {
      ok: true,
      rows: rows,
      personName: personName,
      fatherPath: fatherPath,
      fatherLeaf: fatherLeaf,
      fatherPersonId: isRoot ? "" : fatherPid,
      ancestors: ancestors,
      dob: dob,
      city: city,
      area: area,
      isRoot: isRoot,
    };
  }

  async function verifyFatherPersonInTree(sb, branch, personId, pathHint) {
    return resolveFatherIdentityInTree(sb, branch, personId, pathHint);
  }

  function resolveFatherPathFromPayload(payload, branch, pathToRow) {
    const hints = buildTreeCardFatherResolveHints(payload || {}, branch);
    const index = pathToRow || {};
    for (let i = 0; i < hints.hints.length; i += 1) {
      const hint = hints.hints[i];
      const direct = index[hint.path];
      if (direct && direct.person_id) {
        return {
          path: normalizeTreeCardText(direct.db_child_name || hint.path),
          person_id: String(direct.person_id),
        };
      }
      if (typeof resolveExistingTreeNode === "function") {
        const resolved = resolveExistingTreeNode(index, {
          path: hint.path,
          leaf: relationLeafName(hint.path),
          parentPath: hint.parentPath || "",
        });
        if (
          resolved &&
          resolved.ok &&
          resolved.found &&
          resolved.meta &&
          resolved.meta.person_id
        ) {
          return {
            path: normalizeTreeCardText(
              resolved.meta.db_child_name || hint.path,
            ),
            person_id: String(resolved.meta.person_id),
          };
        }
      }
    }
    return null;
  }

  function normalizeKnownLahmSalehRows(rows, branch) {
    const source = Array.isArray(rows) ? rows : [];
    if (normalizeTreeCardText(branch) !== "لاحم") return source;
    const root = "لاحم بن مطلق بن زيدان";
    const badPrefixes = [
      root + "/صالح سليمان عواد",
      root + "/عواد سليمان صالح",
      root + "/صالح/عواد",
    ];
    const hasBadPath = source.some((item) => {
      const parent = normalizeTreeCardText(
        item && item.parent_name ? item.parent_name : "",
      );
      const child = normalizeTreeCardText(
        item && item.child_name ? item.child_name : "",
      );
      const leaf = relationLeafName(child);
      const isDirectBadAwwad = parent === root + "/صالح" && leaf === "عواد";
      const isBadAwwadSon =
        (parent === "عواد" || parent === root + "/صالح/عواد") &&
        leaf === "سليمان";
      const isBadNaif =
        (parent === "سليمان" || parent === root + "/صالح/سليمان") &&
        leaf === "نايف";
      return (
        isDirectBadAwwad ||
        isBadAwwadSon ||
        isBadNaif ||
        badPrefixes.some(
          (prefix) =>
            parent === prefix ||
            parent.startsWith(prefix + "/") ||
            child === prefix ||
            child.startsWith(prefix + "/"),
        )
      );
    });
    if (!hasBadPath) return source;
    const canonicalAwwad = root + "/صالح/سليمان/عواد";
    const fixed = source
      .filter((item) => {
        const child = normalizeTreeCardText(
          item && item.child_name ? item.child_name : "",
        );
        return !badPrefixes.includes(child);
      })
      .map((item) => {
        let parent = normalizeTreeCardText(
          item && item.parent_name ? item.parent_name : "",
        );
        let child = normalizeTreeCardText(
          item && item.child_name ? item.child_name : "",
        );
        const leaf = relationLeafName(child);
        if (parent === root + "/صالح" && leaf === "عواد") {
          parent = root + "/صالح/سليمان";
          child = canonicalAwwad;
        } else if (
          (parent === "عواد" || parent === root + "/صالح/عواد") &&
          leaf === "سليمان"
        ) {
          parent = canonicalAwwad;
          child = canonicalAwwad + "/سليمان";
        } else if (
          (parent === "سليمان" || parent === root + "/صالح/سليمان") &&
          leaf === "نايف"
        ) {
          parent = canonicalAwwad + "/سليمان";
          child = canonicalAwwad + "/سليمان/نايف";
        }
        badPrefixes.forEach((prefix) => {
          if (parent === prefix || parent.startsWith(prefix + "/"))
            parent = canonicalAwwad + parent.slice(prefix.length);
          if (child === prefix || child.startsWith(prefix + "/"))
            child = canonicalAwwad + child.slice(prefix.length);
        });
        return {
          ...(item || {}),
          branch_key: "لاحم",
          parent_name: parent,
          child_name: child,
        };
      });
    const required = [
      { branch_key: "لاحم", parent_name: root, child_name: root + "/صالح" },
      {
        branch_key: "لاحم",
        parent_name: root + "/صالح",
        child_name: root + "/صالح/سليمان",
      },
      {
        branch_key: "لاحم",
        parent_name: root + "/صالح/سليمان",
        child_name: canonicalAwwad,
      },
      {
        branch_key: "لاحم",
        parent_name: canonicalAwwad,
        child_name: canonicalAwwad + "/سليمان",
      },
      {
        branch_key: "لاحم",
        parent_name: canonicalAwwad + "/سليمان",
        child_name: canonicalAwwad + "/سليمان/نايف",
      },
    ];
    const seen = new Set();
    return required.concat(fixed).filter((item) => {
      const parent = normalizeTreeCardText(
        item && item.parent_name ? item.parent_name : "",
      );
      const child = normalizeTreeCardText(
        item && item.child_name ? item.child_name : "",
      );
      const key = parent + "|" + child;
      if (!parent || !child || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  function openTreeCardEditor(row) {
    try {
      const Corr = window.AlzidanTreeCorrectionContract;
      const Reorder = window.AlzidanTreeCorrectionReorder;
      if (Corr && typeof Corr.routeRequest === "function") {
        const routed = Corr.routeRequest(row);
        if (routed && routed.blockTreeCardEditor) {
          if (
            Reorder &&
            (routed.open === "reorder_editor" || routed.open === "safe_review")
          ) {
            if (routed.open === "safe_review") {
              Reorder.openSafeReview(row, { mode: "admin" });
            } else {
              Reorder.openReorderChildrenEditor(row, { mode: "admin" });
            }
            return;
          }
          showAlert(
            "error",
            (routed.reasons && routed.reasons[0]) ||
              "هذا الطلب ليس بطاقة إضافة فرد — افتح مسار التصحيح المناسب.",
          );
          return;
        }
      }
      const dialog =
        document.getElementById("tree-card-edit-dialog") || treeCardEditDialog;
      const form =
        document.getElementById("tree-card-edit-form") || treeCardEditForm;
      if (!dialog || !form || typeof dialog.showModal !== "function") {
        showAlert("error", "نافذة التعديل غير متاحة في الصفحة. حدّث الصفحة بقوة.");
        return;
      }
      const parsed = parseTreeCardRequestForEditor(row);
      const payload = parsed && parsed.payload ? parsed.payload : null;
      if (!payload) {
        // Contract always returns a shell; legacy fallback only.
        showAlert(
          "error",
          (parsed && parsed.reasons && parsed.reasons[0]) ||
            "تعذر قراءة تفاصيل بطاقة الشجرة.",
        );
        return;
      }
      treeCardEditRow = row;
      showTreeCardEditError("");
      // افتح النافذة فورًا قبل أي تعبئة — يمنع انطباع التجمّد.
      if (dialog.open) {
        try {
          dialog.close();
        } catch (_) {}
      }
      dialog.showModal();
      renderOriginalRequestReview(payload, row);
      fillCorrectionFieldsFromPayload(payload, row);
      setFatherSearchOpen(false);
      const recoveryMode =
        (payload.recovery && payload.recovery.mode) ||
        (parsed && !parsed.jsonValid ? parsed.status : "");
      if (recoveryMode && recoveryMode !== "complete") {
        const reason =
          (parsed.reasons && parsed.reasons[0]) ||
          "الطلب بلا envelope كامل — وضع استعادة. أكمل الحقول واختر الأب من الشجرة ثم احفظ.";
        showTreeCardEditError(
          "وضع استعادة (" + String(recoveryMode) + "): " + reason,
        );
      }
      try {
        const first = form.querySelector("#edit-card-person-name");
        if (first && typeof first.focus === "function") first.focus();
      } catch (_) {}

      // Auto-bind father person_id from unique tree path (member text is not enough).
      treeCardFatherAutoResolvePromise = (async function () {
        const branch = normalizeTreeCardText(
          (treeCardFormEl("branch") && treeCardFormEl("branch").value) ||
            payload.branch_key ||
            (row && row.branch_key) ||
            "",
        );
        if (treeCardFatherPersonIdValue()) {
          return;
        }
        // Do not invent parent UUID during empty-shell recovery.
        if (payload.recovery && payload.recovery.mode === "empty_shell") {
          return;
        }
        const resolved = await autoResolveAdminFatherFromPayload(payload, branch);
        if (treeCardEditRow !== row) return; // dialog moved on
        // Admin may have picked a father while auto-resolve was in flight —
        // never overwrite/clear that bind (dispatchEvent("input") used to).
        if (treeCardFatherPersonIdValue()) {
          return;
        }
        if (resolved && resolved.ok && resolved.person_id) {
          selectTreeCardFather({
            path: resolved.path,
            person_id: resolved.person_id,
            label:
              resolved.label ||
              relationLeafName(resolved.path) ||
              normalizeTreeCardText(payload.father || ""),
            inferAncestors: true,
            resolveIdentity: false,
          });
          return;
        }
        if (resolved && resolved.ambiguous) {
          showTreeCardEditError(
            "يوجد أكثر من شخص باسم «" +
              (resolved.father || "الأب") +
              "». اختر الأب الصحيح من البحث.",
          );
          await seedFatherSearchTerm(resolved.father || "");
          return;
        }
        if (payload.recovery && payload.recovery.mode) {
          showTreeCardEditError(
            "وضع استعادة: اختر الأب من الشجرة ثم احفظ لبناء الحمولة canonical.",
          );
          const leafHint = normalizeTreeCardText(payload.father || "");
          if (leafHint) {
            await seedFatherSearchTerm(leafHint, {
              placeholder: "ابحث عن الأب: " + leafHint,
            });
          }
          return;
        }
        const leaf = normalizeTreeCardText(payload.father || "");
        if (leaf) {
          showTreeCardEditError(
            "تعذر ربط الأب «" +
              leaf +
              "» تلقائيًا. افتح «تغيير الأب» واختره من نتائج البحث.",
          );
          await seedFatherSearchTerm(leaf, {
            placeholder: "ابحث عن الأب: " + leaf,
          });
        }
      })().catch(function () {
        if (treeCardFatherPersonIdValue()) {
          return;
        }
        showTreeCardEditError(
          "تعذر التحقق من الأب تلقائيًا. اختره يدويًا من البحث.",
        );
      });
    } catch (err) {
      console.error("openTreeCardEditor failed", err);
      try {
        showAlert(
          "error",
          "تعذر فتح التعديل: " +
            String((err && err.message) || err || "خطأ غير معروف"),
        );
      } catch (_) {
        try {
          window.alert("تعذر فتح التعديل.");
        } catch (_) {}
      }
    }
  }

  function buildTreeCardRows(reqRow, branchOverride) {
    const Contract = treeCardContract();
    let payload = extractTreeCardPayloadFromMessage(
      reqRow && reqRow.message ? reqRow.message : "",
      reqRow,
    );
    if (payload && Contract && typeof Contract.normalizeTreeCardPayload === "function") {
      payload = Contract.normalizeTreeCardPayload(payload, { row: reqRow });
    }
    if (!payload)
      return {
        ok: false,
        message: "تعذر قراءة بيانات البطاقة (JSON غير موجود).",
        rows: [],
      };
    // Recovered empty shell must not invent tree edges.
    if (
      payload.recovery &&
      payload.recovery.mode === "empty_shell" &&
      !normalizeTreeCardText(payload.name || "")
    ) {
      return {
        ok: false,
        message: "الطلب في وضع استعادة — أكمل الاسم والأب من «تعديل كامل» أولًا.",
        rows: [],
      };
    }
    const branchKey = normalizeTreeCardText(
      branchOverride || payload.branch_key || reqRow.branch_key || "",
    );
    const father = normalizeTreeCardText(payload.father || "");
    const fatherPersonId = normalizeTreeCardText(
      payload.father_person_id ||
        payload.parent_person_id ||
        payload.selected_parent_person_id ||
        "",
    );
    const personName = normalizeTreeCardText(payload.name || "");
    const personDob = normalizeTreeCardText(payload.birth_date_g || "");
    const city = normalizeTreeCardText(payload.city || "");
    const area = normalizeTreeCardText(payload.area || "");
    if (!branchKey) {
      return {
        ok: false,
        message: "بيانات البطاقة ناقصة (العائلة).",
        rows: [],
      };
    }
    const createdAt = normalizeTreeCardText(
      payload.created_at || reqRow.created_at || new Date().toISOString(),
    );
    const rows = [];
    const seen = new Set();
    function pushEdge(parent, child, extra) {
      const p = normalizeTreeCardText(parent || "");
      const c = normalizeTreeCardText(child || "");
      if (!p || !c) return;
      const key = branchKey + "|" + p + "|" + c;
      if (seen.has(key)) return;
      seen.add(key);
      let row = {
        branch_key: branchKey,
        parent_name: p,
        parent: p,
        child_name: c,
        name: c,
        created_at: createdAt,
      };
      if (extra && typeof extra === "object") Object.assign(row, extra);
      if (!row.gender && personName && relationLeafName(c) === personName) {
        const g = normalizeTreeCardText(payload.gender || "");
        if (g) row.gender = g;
      }
      const TE = treeEngineApi();
      if (TE && typeof TE.prepareChildWriteRow === "function") {
        const prepared = TE.prepareChildWriteRow(row);
        if (!prepared.ok) return;
        row = prepared.row;
      }
      const fatherPath = normalizeTreeCardText(payload.father_path || father);
      if (
        fatherPersonId &&
        !normalizeTreeCardText(row.parent_person_id || "")
      ) {
        const rowParent = normalizeTreeCardText(row.parent_name || row.parent || "");
        const fatherLeaf = relationLeafName(fatherPath || father);
        const rowLeaf = relationLeafName(rowParent);
        const isSelectedFather =
          !!rowParent &&
          ((fatherPath && rowParent === fatherPath) ||
            (!!father && rowParent === father) ||
            // Short parent leaf on the son edge (legacy payloads).
            (rowParent.indexOf("/") < 0 &&
              fatherLeaf &&
              rowLeaf === fatherLeaf));
        if (isSelectedFather) {
          row.parent_person_id = fatherPersonId;
        }
      }
      rows.push(row);
    }
    const customRows = Array.isArray(payload.tree_rows)
      ? payload.tree_rows
      : [];
    if (customRows.length) {
      if (!fatherPersonId && !customRows.every((item) => {
        const parent = normalizeTreeCardText(item && item.parent_name ? item.parent_name : "");
        const branchRoot = branchKey + " بن مطلق بن زيدان";
        const isRoot = parent === branchKey || parent === branchRoot;
        return isRoot || normalizeTreeCardText(item && item.parent_person_id ? item.parent_person_id : "");
      })) {
        return {
          ok: false,
          message:
            "بطاقة الشجرة بلا parent_person_id للأب المحدد — أوقف الاعتماد (TREE-003).",
          code: "TREE-003",
          rows: [],
        };
      }
      customRows.forEach((item) => {
        const parent = normalizeTreeCardText(
          item && item.parent_name ? item.parent_name : "",
        );
        const child = normalizeTreeCardText(
          item && item.child_name ? item.child_name : "",
        );
        if (!parent || !child) return;
        // Never stamp father_person_id onto every ancestor edge — only this
        // row's own parent_person_id (pushEdge still binds the final father).
        const rowPid = normalizeTreeCardText(
          (item && item.parent_person_id) || "",
        );
        pushEdge(parent, child, {
          birth_date_g: normalizeTreeCardText(item.birth_date_g || ""),
          city: normalizeTreeCardText(item.city || ""),
          area: normalizeTreeCardText(item.area || ""),
          person_id: normalizeTreeCardText((item && item.person_id) || "") || undefined,
          parent_person_id: rowPid || undefined,
        });
      });
      return { ok: true, rows, father_person_id: fatherPersonId };
    }
    if (!father || !personName) {
      return {
        ok: false,
        message: "بيانات البطاقة ناقصة (الأب/الاسم).",
        rows: [],
      };
    }
    // RX / path-stamped payloads: single verified edge under the selected parent.
    // Avoid inventing ancestor write-edges from display labels.
    const parentNodeId = normalizeTreeCardText(
      payload.parent_node_id || payload.father_path || "",
    );
    if ((payload.rx || parentNodeId) && fatherPersonId) {
      const parentPath = parentNodeId || father;
      const childPath = alignChildPathUnderParent(parentPath, personName);
      pushEdge(parentPath, childPath, {
        birth_date_g: personDob || "",
        city: city || "",
        area: area || "",
        parent_person_id: fatherPersonId,
      });
      return {
        ok: true,
        rows,
        father_person_id: fatherPersonId,
        father_path: parentPath,
      };
    }
    if (!fatherPersonId) {
      return {
        ok: false,
        message:
          "يلزم parent_person_id / father_person_id قبل الاعتماد (TREE-003). إن وُجد مسار فريد سيُحل تلقائياً عند القبول؛ وإلا افتح «تعديل كامل» واختر الأب من الشجرة ثم احفظ.",
        code: "TREE-003",
        rows: [],
      };
    }
    const lineagePath = Array.isArray(payload.lineage_path)
      ? payload.lineage_path
          .map((v) => normalizeTreeCardText(v))
          .filter(Boolean)
      : [];
    if (lineagePath.length) {
      const branchRoot = branchKey + " بن مطلق بن زيدان";
      let parentId = branchRoot;
      lineagePath.forEach((baseName, idx) => {
        const childId = parentId + "/" + baseName;
        const isLeaf = idx === lineagePath.length - 1;
        pushEdge(
          parentId,
          childId,
          isLeaf
            ? {
                birth_date_g: personDob || "",
                city: city || "",
                area: area || "",
                parent_person_id:
                  parentId === normalizeTreeCardText(payload.father_path || father)
                    ? fatherPersonId
                    : undefined,
              }
            : null,
        );
        parentId = childId;
      });
      const kids = Array.isArray(payload.children) ? payload.children : [];
      kids.forEach((c) => {
        const childName = normalizeTreeCardText(c && c.name ? c.name : "");
        const childDob = normalizeTreeCardText(c && c.dob ? c.dob : "");
        if (!childName) return;
        pushEdge(parentId, parentId + "/" + childName, {
          birth_date_g: childDob || "",
          parent_person_id: fatherPersonId,
        });
      });
      return { ok: true, rows, father_person_id: fatherPersonId };
    }
    const ancestorsFromArray = Array.isArray(payload.ancestors)
      ? payload.ancestors
      : [];
    const ancestorsFromFields = [
      payload.grandfather,
      payload.grandfather2,
      payload.grandfather3,
      payload.grandfather4,
    ].filter(Boolean);
    const ancestorsClosestFirst = (
      ancestorsFromArray.length ? ancestorsFromArray : ancestorsFromFields
    )
      .map((v) => normalizeTreeCardText(v))
      .filter(Boolean);
    const farthestFirst = ancestorsClosestFirst.slice().reverse();
    for (let i = 0; i + 1 < farthestFirst.length; i += 1) {
      pushEdge(farthestFirst[i], farthestFirst[i + 1]);
    }
    if (ancestorsClosestFirst.length) {
      pushEdge(ancestorsClosestFirst[0], father);
    }
    const fatherPath = normalizeTreeCardText(payload.father_path || father);
    pushEdge(father, personName, {
      birth_date_g: personDob || "",
      city: city || "",
      area: area || "",
      parent_person_id: fatherPersonId,
    });
    const kids = Array.isArray(payload.children) ? payload.children : [];
    kids.forEach((c) => {
      const childName = normalizeTreeCardText(c && c.name ? c.name : "");
      const childDob = normalizeTreeCardText(c && c.dob ? c.dob : "");
      if (!childName) return;
      // Children of the added person — parent is the new child path, not the selected father.
      pushEdge(personName, childName, { birth_date_g: childDob || "" });
    });
    return { ok: true, rows, father_person_id: fatherPersonId, father_path: fatherPath };
  }
  (function bindTreeCardFatherSearch() {
    if (
      typeof document === "undefined" ||
      typeof document.addEventListener !== "function" ||
      typeof document.getElementById !== "function"
    ) {
      return;
    }
    const changeBtn = document.getElementById("edit-card-father-change");
    const clearBtn = document.getElementById("edit-card-father-clear");
    const searchInput = document.getElementById("edit-card-father-search");
    if (changeBtn) {
      changeBtn.addEventListener("click", function () {
        setFatherSearchOpen(true);
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        clearTreeCardFatherSelection();
      });
    }
    if (searchInput) {
      searchInput.addEventListener("input", function () {
        // Typing means the admin is changing father — clear prior bind.
        // Programmatic seeds must use seedFatherSearchTerm (not input events).
        const pathEl = treeCardFormEl("fatherPath");
        const pidEl = treeCardFormEl("fatherPersonId");
        const labelEl = treeCardFormEl("fatherLabel");
        if (
          (pidEl && pidEl.value) ||
          (pathEl && normalizeTreeCardText(pathEl.value))
        ) {
          if (pathEl) pathEl.value = "";
          if (pidEl) pidEl.value = "";
          if (labelEl) labelEl.value = "";
          updateFatherCurrentUi();
        }
        const term = searchInput.value;
        if (treeCardFatherSearchTimer) clearTimeout(treeCardFatherSearchTimer);
        treeCardFatherSearchTimer = setTimeout(async function () {
          const seq = ++treeCardFatherSearchSeq;
          const branch = normalizeTreeCardText(
            treeCardFormEl("branch") && treeCardFormEl("branch").value,
          );
          const items = await queryFatherSearchCandidates(branch, term);
          if (seq !== treeCardFatherSearchSeq) return;
          renderFatherSearchResults(items);
        }, TREE_CARD_FATHER_SEARCH_DEBOUNCE_MS);
      });
      searchInput.addEventListener("focus", function () {
        // Re-query for the visible term without clearing a bound father.
        const term = normalizeTreeCardText(searchInput.value);
        if (!term) return;
        const seq = ++treeCardFatherSearchSeq;
        const branch = normalizeTreeCardText(
          treeCardFormEl("branch") && treeCardFormEl("branch").value,
        );
        queryFatherSearchCandidates(branch, term).then(function (items) {
          if (seq !== treeCardFatherSearchSeq) return;
          renderFatherSearchResults(items);
        });
      });
    }
    document.addEventListener("click", function (e) {
      const wrap = document.getElementById("edit-card-father-search-wrap");
      const results = document.getElementById("edit-card-father-results");
      if (!wrap || !results || !results.classList.contains("fm-open")) return;
      if (wrap.contains(e.target)) return;
      results.classList.remove("fm-open");
    });
  })();

  if (treeCardEditForm && treeCardEditForm.elements.branch) {
    treeCardEditForm.elements.branch.addEventListener("change", function () {
      clearTreeCardFatherSelection();
      setFatherSearchOpen(false);
      updateFatherCurrentUi();
      showTreeCardEditError("تغيّر الفرع — اختر الأب من جديد عبر «تغيير الأب».");
    });
  }
  if (treeCardEditCancel) {
    treeCardEditCancel.addEventListener("click", () => {
      treeCardEditRow = null;
      treeCardFatherAutoResolvePromise = null;
      showTreeCardEditError("");
      if (treeCardEditDialog && treeCardEditDialog.open)
        treeCardEditDialog.close();
    });
  }
  if (treeCardEditForm) {
    // Never use method=dialog auto-close: if submit is cancelled/fails mid-flight,
    // the dialog must stay open with a visible error (not a silent close).
    try {
      treeCardEditForm.setAttribute("method", "post");
      treeCardEditForm.setAttribute("action", "#");
    } catch (_) {}
    treeCardEditForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (typeof event.stopPropagation === "function") event.stopPropagation();
      showTreeCardEditError("");
      const row = treeCardEditRow;
      if (!row) {
        showTreeCardEditError("تعذر تحديد الطلب.");
        return;
      }
      const submitBtn = treeCardEditForm.querySelector('button[type="submit"]');
      try {
      // Wait for open-path auto-resolve so Save does not run on text-only father.
      if (treeCardFatherAutoResolvePromise) {
        try {
          await treeCardFatherAutoResolvePromise;
        } catch (_) {}
        if (treeCardEditRow !== row) {
          showTreeCardEditError("أُغلق التعديل أثناء التحقق من الأب — أعد فتح «تعديل كامل».");
          return;
        }
      }
      const branch = normalizeTreeCardText(
        treeCardEditForm.elements.branch.value,
      );
      const correction = collectAdminCorrection(branch);
      const submitterName = normalizeTreeCardText(
        treeCardEditForm.elements.submitterName.value,
      );
      const submitterPhone = normalizeAdminPhone(
        treeCardEditForm.elements.submitterPhone.value,
      );
      const submitterEmail = normalizeEmail(
        treeCardEditForm.elements.submitterEmail.value,
      );
      if (
        !branch ||
        !correction.ok ||
        !submitterName ||
        submitterPhone.length < 9
      ) {
        showTreeCardEditError(
          correction.ok ? "أكمل الفرع وبيانات المرسل." : correction.message,
        );
        return;
      }
      if (submitterEmail && !isLikelyEmail(submitterEmail)) {
        showTreeCardEditError("البريد الإلكتروني غير صحيح.");
        return;
      }
      const oldPayload = extractTreeCardPayloadFromMessage(row.message, row) || {};
      const core = window.AlzidanAdminCore || {};
      const sb =
        typeof getClient === "function"
          ? getClient()
          : typeof core.getClient === "function"
            ? core.getClient()
            : null;
      const token = String(
        (typeof getAdminToken === "function"
          ? getAdminToken()
          : typeof core.getAdminToken === "function"
            ? core.getAdminToken()
            : "") || "",
      ).trim();
      const idCoerce =
        typeof coerceRpcId === "function"
          ? coerceRpcId
          : typeof core.coerceRpcId === "function"
            ? core.coerceRpcId
            : function (v) {
                return String(v == null ? "" : v).trim();
              };
      const id = idCoerce(row.id != null ? row.id : row.request_id);
      if (!sb || !token || !id) {
        showTreeCardEditError("يلزم تسجيل الدخول والاتصال بقاعدة البيانات.");
        return;
      }

      const stampedRows = [];
      for (let i = 0; i < correction.rows.length; i += 1) {
        const edge = Object.assign({}, correction.rows[i]);
        const parent = normalizeTreeCardText(edge.parent_name || "");
        const isRoot = isTreeCardBranchRootPath(parent, branch);
        if (!isRoot) {
          let pid = normalizeTreeCardText(edge.parent_person_id || "");
          const pathHint = normalizeTreeCardText(
            edge.parent_name || correction.fatherPath || "",
          );
          if (!pid && pathHint) {
            const resolvedEarly = await verifyFatherPersonInTree(
              sb,
              branch,
              "",
              pathHint,
            );
            if (resolvedEarly && resolvedEarly.ok && resolvedEarly.person_id) {
              pid = resolvedEarly.person_id;
              if (resolvedEarly.path) edge.parent_name = resolvedEarly.path;
            }
          }
          if (!pid) {
            showTreeCardEditError(TREE_CARD_RELATION_MISMATCH_AR);
            return;
          }
          const verified = await verifyFatherPersonInTree(
            sb,
            branch,
            pid,
            edge.parent_name || pathHint,
          );
          if (!verified.ok || !verified.person_id) {
            showTreeCardEditError(TREE_CARD_RELATION_MISMATCH_AR);
            return;
          }
          if (verified.path) edge.parent_name = verified.path;
          edge.child_name = edge.parent_name + "/" + correction.personName;
          edge.parent_person_id = verified.person_id;
        } else {
          edge.parent_person_id = "";
        }
        stampedRows.push(edge);
      }

      const fatherPath = normalizeTreeCardText(
        (stampedRows[0] && stampedRows[0].parent_name) || correction.fatherPath,
      );
      const fatherPersonId = normalizeTreeCardText(
        (stampedRows[0] && stampedRows[0].parent_person_id) ||
          correction.fatherPersonId ||
          "",
      );
      const ancestors = correction.ancestors || [];

      const payload = Object.assign({}, oldPayload, {
        v: 1,
        kind: "tree_card",
        branch_key: branch,
        name: correction.personName,
        father: correction.fatherLeaf,
        father_path: fatherPath,
        father_person_id: fatherPersonId,
        parent_person_id: fatherPersonId,
        selected_parent_person_id: fatherPersonId,
        parent_node_id: fatherPath,
        parent_path: fatherPath,
        grandfather: ancestors[0] || "",
        grandfather2: ancestors[1] || "",
        grandfather3: ancestors[2] || "",
        grandfather4: ancestors[3] || "",
        ancestors: ancestors,
        lineage_path: [],
        tree_rows: stampedRows,
        birth_date_g: correction.dob || "",
        city: correction.city || "",
        area: correction.area || "",
        children: Array.isArray(oldPayload.children) ? oldPayload.children : [],
        submitter: {
          name: submitterName,
          phone: submitterPhone,
          email: submitterEmail,
        },
        created_at:
          oldPayload.created_at || row.created_at || new Date().toISOString(),
        admin_corrected_at: new Date().toISOString(),
      });

      const message = buildTreeCardMessageFromPayload(payload, row);
      // p_old_tree_rows is only applied by RPC when status=approved.
      // Pending member requests often lack father person_id — do NOT run
      // buildTreeCardRows(old) through TREE-003 or save is blocked incorrectly.
      let oldTreeRows = [];
      if (String(row.status || "") === "approved") {
        try {
          const stampedOld = await stampTreeCardFatherPersonId(sb, row);
          const oldSource =
            stampedOld && stampedOld.ok && stampedOld.row
              ? stampedOld.row
              : row;
          const oldBuilt = buildTreeCardRows(
            oldSource,
            row.branch_key || oldPayload.branch_key || "",
          );
          if (oldBuilt.ok) oldTreeRows = oldBuilt.rows || [];
        } catch (_) {
          oldTreeRows = [];
        }
      }
      if (submitBtn) submitBtn.disabled = true;
      console.info("ADMIN_RPC admin_update_request_branch_v1 start", {
        id: String(id),
        father_person_id: fatherPersonId,
        father_path: fatherPath,
        status: row.status,
      });
      const { data, error } = await sb.rpc("admin_update_request_branch_v1", {
        p_token: token,
        p_id: String(id),
        p_old_branch_key:
          normalizeTreeCardText(
            row.branch_key || oldPayload.branch_key || "",
          ) || null,
        p_branch_key: branch,
        p_name: submitterName,
        p_phone: submitterPhone,
        p_email: submitterEmail || null,
        p_message: message,
        p_old_tree_rows: oldTreeRows,
        p_new_tree_rows: stampedRows,
      });
      if (submitBtn) submitBtn.disabled = false;
      console.info("ADMIN_RPC admin_update_request_branch_v1 done", {
        id: String(id),
        data: data,
        error: error && error.message,
      });
      if (error) {
        const errMsg =
          "تعذر حفظ التعديلات حالياً، حاول لاحقاً أو تواصل مع الإدارة." +
          (error.message ? " (" + String(error.message) + ")" : "");
        showTreeCardEditError(errMsg);
        return;
      }
      if (data !== true) {
        showTreeCardEditError("لا يمكن تعديل هذا الطلب في حالته الحالية.");
        return;
      }
      treeCardEditRow = null;
      treeCardFatherAutoResolvePromise = null;
      if (treeCardEditDialog && treeCardEditDialog.open) {
        treeCardEditDialog.close();
      } else {
        const dlg =
          document.getElementById("tree-card-edit-dialog") || treeCardEditDialog;
        if (dlg && dlg.open) dlg.close();
      }
      const alertFn =
        typeof showAlert === "function"
          ? showAlert
          : typeof core.showAlert === "function"
            ? core.showAlert
            : null;
      const okMsg =
        row.status === "approved"
          ? "تم حفظ تصحيح الإدارة وتحديث بيانات الشجرة."
          : "تم حفظ تصحيح الإدارة.";
      if (alertFn) {
        alertFn("success", okMsg);
      }
      try {
        const sbStatus = document.getElementById("sb-status");
        if (sbStatus) {
          sbStatus.textContent = okMsg;
          sbStatus.style.color = "#065f46";
        }
      } catch (_) {}
      await reloadRequests();
      } catch (saveErr) {
        if (submitBtn) submitBtn.disabled = false;
        try {
          console.error("tree-card-edit save failed", saveErr);
        } catch (_) {}
        const errMsg =
          "تعذر حفظ التصحيح: " +
          String((saveErr && saveErr.message) || saveErr || "خطأ غير متوقع");
        showTreeCardEditError(errMsg);
      }
    });
  }

  function canonicalHelpers() {
    return {
      normalizePersonName: normalizeTreeCardText,
      getLeafStoredNameFromNodeId: function (v) {
        const n = normalizeTreeCardText(v || "");
        if (!n) return "";
        if (n.indexOf("/") < 0) return n;
        const parts = n.split("/").map((p) => normalizeTreeCardText(p)).filter(Boolean);
        return parts.length ? parts[parts.length - 1] : n;
      },
    };
  }

  function requestFail(code, message, extra) {
    const out = {
      ok: false,
      code: code || "",
      message: message || "",
      inserted: 0,
      updated: 0,
      skipped: 0,
      verified: 0,
      rows: [],
    };
    if (extra && typeof extra === "object") Object.assign(out, extra);
    return out;
  }

  function countExactParentPersonMatches(pathToRow, parentPersonId) {
    const pid = normalizeTreeCardText(parentPersonId || "");
    if (!pid || !pathToRow) return { count: 0, meta: null };
    const meta = pathToRow["pid:" + pid] || null;
    if (meta && meta.person_id) return { count: 1, meta: meta };
    // Fallback scan: exactly one row with this person_id
    const hits = [];
    Object.keys(pathToRow).forEach((key) => {
      if (key.indexOf("pid:") === 0) return;
      const row = pathToRow[key];
      if (row && normalizeTreeCardText(row.person_id || "") === pid) hits.push(row);
    });
    if (hits.length === 1) return { count: 1, meta: hits[0] };
    return { count: hits.length, meta: null };
  }

  function parentPathsCompatible(parentPath, dbParent) {
    const CP = window.AlzidanCanonicalPerson;
    if (CP && typeof CP.parentNamesCompatible === "function") {
      return CP.parentNamesCompatible(
        parentPath,
        dbParent,
        normalizeTreeCardText,
        relationLeafName,
      );
    }
    const a = normalizeTreeCardText(parentPath || "");
    const b = normalizeTreeCardText(dbParent || "");
    if (!a || !b) return true;
    if (a === b) return true;
    const aLeaf = relationLeafName(a);
    const bLeaf = relationLeafName(b);
    const aIsPath = a.indexOf("/") >= 0;
    const bIsPath = b.indexOf("/") >= 0;
    // Full path vs full path: never treat shared leaf (محمد) as the same father.
    if (aIsPath && bIsPath) {
      return a.endsWith("/" + b) || b.endsWith("/" + a);
    }
    if (!aIsPath) {
      return b === a || bLeaf === a || b.endsWith("/" + a);
    }
    if (!bIsPath) {
      return a === b || aLeaf === b || a.endsWith("/" + b);
    }
    return false;
  }

  /** True when an indexed tree row sits under the intended parent (UUID and/or path). */
  function metaMatchesIntendedParent(meta, parentPersonId, parentPath) {
    if (!meta) return false;
    const wantPid = normalizeTreeCardText(parentPersonId || "");
    const metaPid = normalizeTreeCardText(meta.parent_person_id || "");
    if (wantPid) {
      return !!metaPid && metaPid === wantPid;
    }
    const wantParent = normalizeTreeCardText(parentPath || "");
    if (!wantParent) return true;
    return parentPathsCompatible(wantParent, meta.db_parent_name || "");
  }

  /**
   * Resolve an existing tree node for reuse (not insert).
   * Order: person_id → exact path → unique leaf under parent → unique leaf in branch.
   * Ambiguity → TREE-001 (never silent pick).
   */
  function resolveExistingTreeNode(pathToRow, opts) {
    const CP = window.AlzidanCanonicalPerson;
    const options = opts || {};
    const personId = normalizeTreeCardText(options.personId || "");
    const path = normalizeTreeCardText(options.path || "");
    const parentPersonId = normalizeTreeCardText(options.parentPersonId || "");
    const parentPath = normalizeTreeCardText(options.parentPath || "");
    const leaf = relationLeafName(path) || normalizeTreeCardText(options.leaf || "");
    const label = relationPathLabel(path || leaf || personId);

    function metaMatchesWantedPath(meta) {
      if (!meta) return false;
      if (!path && !leaf) return true;
      const metaPath = normalizeTreeCardText(meta.db_child_name || "");
      const metaLeaf = relationLeafName(metaPath);
      const wantLeaf = leaf || relationLeafName(path);
      if (path && metaPath === path) return true;
      if (wantLeaf && metaLeaf === wantLeaf) return true;
      if (
        path &&
        metaPath &&
        (metaPath.endsWith("/" + path) ||
          path.endsWith("/" + metaPath) ||
          metaPath.endsWith("/" + wantLeaf))
      ) {
        return true;
      }
      return false;
    }

    if (personId) {
      const byPid = countExactParentPersonMatches(pathToRow, personId);
      if (byPid.count === 1 && byPid.meta) {
        // Ignore a stamped person_id that conflicts with the edge's parent/child path
        // (legacy tree_rows often copied father_person_id onto every ancestor edge).
        if (
          metaMatchesWantedPath(byPid.meta) &&
          metaMatchesIntendedParent(byPid.meta, parentPersonId, parentPath)
        ) {
          return { ok: true, found: true, meta: byPid.meta };
        }
      } else if (byPid.count > 1) {
        return requestFail(
          (CP && CP.ERROR && CP.ERROR.TREE_001) || "TREE-001",
          "تعذر تحديد «" +
            label +
            "» لأن المعرّف يطابق أكثر من صف (TREE-001).",
          { matchCount: byPid.count, person_id: personId },
        );
      }
    }

    if (path && pathToRow && pathToRow[path] && pathToRow[path].id) {
      const exactMeta = pathToRow[path];
      if (metaMatchesIntendedParent(exactMeta, parentPersonId, parentPath)) {
        return { ok: true, found: true, meta: exactMeta };
      }
    }

    if (CP && typeof CP.resolveFromPathIndex === "function" && (path || personId)) {
      const fromIndex = CP.resolveFromPathIndex(
        pathToRow,
        path,
        personId,
        canonicalHelpers(),
      );
      if (
        fromIndex &&
        fromIndex.ok &&
        fromIndex.meta &&
        metaMatchesIntendedParent(fromIndex.meta, parentPersonId, parentPath)
      ) {
        return { ok: true, found: true, meta: fromIndex.meta };
      }
      if (fromIndex && fromIndex.code === "TREE-001") {
        return requestFail(
          (CP && CP.ERROR && CP.ERROR.TREE_001) || "TREE-001",
          "تعذر تحديد «" +
            label +
            "» لأن الاسم يطابق أكثر من شخص في الشجرة. اختر المسار الكامل أو معرّف الشخص (TREE-001).",
          { matchCount: fromIndex.matchCount || 0 },
        );
      }
    }

    if (!leaf || !pathToRow) {
      return { ok: true, found: false, meta: null };
    }

    const hits = [];
    const seen = {};
    Object.keys(pathToRow).forEach((key) => {
      if (key.indexOf("pid:") === 0) return;
      const row = pathToRow[key];
      if (!row || row.id == null) return;
      const childPath = normalizeTreeCardText(row.db_child_name || key);
      const childLeaf = relationLeafName(childPath);
      if (childLeaf !== leaf && childPath !== path) return;
      if (parentPersonId) {
        if (normalizeTreeCardText(row.parent_person_id || "") !== parentPersonId) {
          return;
        }
      } else if (parentPath) {
        if (
          !parentPathsCompatible(
            parentPath,
            row.db_parent_name || "",
          )
        ) {
          return;
        }
      }
      const id = Number(row.id);
      if (seen[id]) return;
      seen[id] = true;
      hits.push(row);
    });

    if (hits.length === 1) {
      return { ok: true, found: true, meta: hits[0] };
    }
    if (hits.length > 1) {
      const distinct = {};
      hits.forEach((h) => {
        const p = normalizeTreeCardText(h.person_id || "");
        if (p) distinct[p] = h;
      });
      const pids = Object.keys(distinct);
      if (
        pids.length === 1 &&
        hits.every((h) => normalizeTreeCardText(h.person_id || "") === pids[0])
      ) {
        return { ok: true, found: true, meta: distinct[pids[0]] };
      }
      return requestFail(
        (CP && CP.ERROR && CP.ERROR.TREE_001) || "TREE-001",
        "تعذر تحديد «" +
          label +
          "» لأن الاسم يطابق أكثر من شخص في الشجرة. اختر المسار الكامل أو معرّف الشخص (TREE-001).",
        { matchCount: hits.length },
      );
    }
    return { ok: true, found: false, meta: null };
  }

  /**
   * Bind a write edge to a resolved existing parent (canonical path + person_id).
   * Branch-root parents have no person row.
   */
  function enrichOneTreeCardRow(row, pathToRow) {
    const CP = window.AlzidanCanonicalPerson;
    const payload = Object.assign({}, row || {});
    const parent = normalizeTreeCardText(payload.parent_name || "");
    const branch = normalizeTreeCardText(payload.branch_key || "");
    const branchRoot = branch ? branch + " بن مطلق بن زيدان" : "";
    const isBranchRoot =
      !!branch && (parent === branch || parent === branchRoot);

    if (!parent) {
      return requestFail(
        (CP && CP.ERROR && CP.ERROR.REQ_002) || "REQ-002",
        (CP && CP.MSG && CP.MSG.REQ_002) ||
          "فشل إنشاء أو ربط الابن بعد الاعتماد (REQ-002).",
      );
    }

    if (isBranchRoot) {
      // Root edges have no parent person row — allow missing parent_person_id.
      return { ok: true, row: payload };
    }

    const parentPidHint = normalizeTreeCardText(
      payload.parent_person_id || payload.father_person_id || "",
    );
    const resolved = resolveExistingTreeNode(pathToRow, {
      personId: parentPidHint,
      path: parent,
      leaf: relationLeafName(parent),
    });
    if (!resolved.ok) {
      // Prefer Arabic father-specific TREE-001 wording.
      if (resolved.code === "TREE-001") {
        return requestFail(
          "TREE-001",
          "الأب «" +
            relationPathLabel(parent) +
            "» يطابق أكثر من شخص في الشجرة — لن يُنشأ ابن تحت أب غامض. اختر المسار الكامل أو معرّف الأب (TREE-001).",
          { matchCount: resolved.matchCount || 0 },
        );
      }
      return resolved;
    }
    if (!resolved.found || !resolved.meta) {
      if (parentPidHint) {
        return requestFail(
          (CP && CP.ERROR && CP.ERROR.TREE_003) || "TREE-003",
          (CP && CP.MSG && CP.MSG.TREE_004) ||
            "عزل حالة الأبناء: parent_person_id لا يطابق شخصًا واحدًا (TREE-004).",
          { reason: "parent_person_id_not_in_tree", parent_person_id: parentPidHint },
        );
      }
      return requestFail(
        (CP && CP.ERROR && CP.ERROR.TREE_003) || "TREE-003",
        "تعذر تحديد الأب «" +
          relationPathLabel(parent) +
          "» في الشجرة — الأب غير موجود أو بلا هوية فريدة (TREE-003).",
        { reason: "parent_not_found" },
      );
    }

    const meta = resolved.meta;
    const parentPid = normalizeTreeCardText(meta.person_id || parentPidHint || "");
    if (!parentPid) {
      return requestFail(
        (CP && CP.ERROR && CP.ERROR.TREE_003) || "TREE-003",
        (CP && CP.MSG && CP.MSG.TREE_003) ||
          "تعذر تحديد معرّف الأب (parent_person_id) لهذا المسار (TREE-003).",
        { reason: "missing_parent_person_id" },
      );
    }

    payload.parent_person_id = parentPid;
    if (meta.db_child_name) {
      payload.parent_name = meta.db_child_name;
      payload.parent = meta.db_child_name;
    }
    return { ok: true, row: payload, parentMeta: meta };
  }

  async function loadPathToRowForBranch(sb, branchKey) {
    const key = normalizeTreeCardText(branchKey || "");
    if (!sb || !key) return {};
    const fields = [
      "id,person_id,parent_person_id,branch_key,parent_name,parent,child_name,name",
      "id,branch_key,parent_name,parent,child_name,name,person_id",
    ];
    const FM = window.AlzidanFamilyPersonCore || {};
    for (let i = 0; i < fields.length; i += 1) {
      const q = await sb
        .from("tree_children")
        .select(fields[i])
        .eq("branch_key", key)
        .limit(5000);
      if (!q.error && Array.isArray(q.data)) {
        if (typeof FM.buildPathToRowIndex === "function") {
          return FM.buildPathToRowIndex(q.data, normalizeTreeCardText);
        }
        const index = {};
        q.data.forEach((row) => {
          if (!row || row.id == null) return;
          const childPath = normalizeTreeCardText(row.child_name || row.name || "");
          const meta = {
            id: Number(row.id),
            person_id: row.person_id ? String(row.person_id) : "",
            parent_person_id: row.parent_person_id
              ? String(row.parent_person_id)
              : "",
            db_parent_name: normalizeTreeCardText(
              row.parent_name || row.parent || "",
            ),
            db_child_name: childPath,
          };
          if (childPath) index[childPath] = meta;
          if (meta.person_id) index["pid:" + meta.person_id] = meta;
        });
        return index;
      }
    }
    return {};
  }

  function indexImportedChild(pathToRow, dbRow) {
    if (!pathToRow || !dbRow || dbRow.id == null) return pathToRow;
    const childPath = normalizeTreeCardText(dbRow.child_name || dbRow.name || "");
    const meta = {
      id: Number(dbRow.id),
      person_id: dbRow.person_id ? String(dbRow.person_id) : "",
      parent_person_id: dbRow.parent_person_id
        ? String(dbRow.parent_person_id)
        : "",
      db_parent_name: normalizeTreeCardText(
        dbRow.parent_name || dbRow.parent || "",
      ),
      db_child_name: childPath,
    };
    if (childPath) pathToRow[childPath] = meta;
    if (meta.person_id) pathToRow["pid:" + meta.person_id] = meta;
    return pathToRow;
  }

  async function fetchTreeCardChildRow(sb, row) {
    const branch = normalizeTreeCardText(row.branch_key || "");
    const parent = normalizeTreeCardText(row.parent_name || "");
    const child = normalizeTreeCardText(row.child_name || "");
    if (!sb || !branch || !parent || !child) return null;
    let res = await sb
      .from("tree_children")
      .select("id,person_id,parent_person_id,parent_name,parent,child_name,name")
      .eq("branch_key", branch)
      .eq("parent_name", parent)
      .eq("child_name", child)
      .limit(3);
    if (res.error || !Array.isArray(res.data) || !res.data.length) {
      res = await sb
        .from("tree_children")
        .select("id,person_id,parent_person_id,parent_name,parent,child_name,name")
        .eq("branch_key", branch)
        .eq("parent_name", parent)
        .eq("name", child)
        .limit(3);
    }
    if (res.error || !Array.isArray(res.data) || !res.data.length) return null;
    const parentPid = normalizeTreeCardText(row.parent_person_id || "");
    if (parentPid) {
      const linked = res.data.find(
        (r) => String(r.parent_person_id || "") === parentPid,
      );
      return linked || null;
    }
    return res.data[0];
  }

  async function verifyTreeCardRowsInTree(sb, rows) {
    const list = Array.isArray(rows) ? rows : [];
    if (!sb || !list.length) {
      return { ok: false, verified: 0, missing: list.length };
    }
    let verified = 0;
    const missing = [];
    for (let i = 0; i < list.length; i += 1) {
      const row = list[i] || {};
      const hit = await fetchTreeCardChildRow(sb, row);
      if (!hit) {
        missing.push(row);
        continue;
      }
      const parentPid = normalizeTreeCardText(row.parent_person_id || "");
      const branch = normalizeTreeCardText(row.branch_key || "");
      const parent = normalizeTreeCardText(row.parent_name || "");
      const branchRoot = branch ? branch + " بن مطلق بن زيدان" : "";
      const isBranchRoot =
        !!branch && (parent === branch || parent === branchRoot);
      if (parentPid) {
        if (String(hit.parent_person_id || "") !== parentPid) {
          missing.push(row);
          continue;
        }
      } else if (!isBranchRoot) {
        // Non-root edges must be linked via parent_person_id after apply
        if (!hit.parent_person_id) {
          missing.push(row);
          continue;
        }
      }
      verified += 1;
    }
    return {
      ok: missing.length === 0 && verified === list.length,
      verified,
      missing: missing.length,
      missingRows: missing,
    };
  }

  /**
   * Align child_name to canonical parent path + leaf (avoid short-path duplicates).
   */
  function alignChildPathUnderParent(parentPath, childPath) {
    const parent = normalizeTreeCardText(parentPath || "");
    const child = normalizeTreeCardText(childPath || "");
    const leaf = relationLeafName(child) || child;
    if (!parent || !leaf) return child;
    if (child.indexOf("/") >= 0 && child.indexOf(parent + "/") === 0) return child;
    if (parent.indexOf("/") >= 0 || parent.indexOf(" بن مطلق بن زيدان") >= 0) {
      return parent + "/" + leaf;
    }
    return child.indexOf("/") >= 0 ? child : leaf;
  }

  /** Ancestors closest-first (grandfather first) from tree_card JSON. */
  function treeCardAncestorsClosestFirst(payload) {
    const fromArray = Array.isArray(payload && payload.ancestors)
      ? payload.ancestors
      : [];
    const fromFields = [
      payload && payload.grandfather,
      payload && payload.grandfather2,
      payload && payload.grandfather3,
      payload && payload.grandfather4,
    ].filter(Boolean);
    return (fromArray.length ? fromArray : fromFields)
      .map((v) => normalizeTreeCardText(v))
      .filter(Boolean);
  }

  /**
   * Build father path / leaf hints for UUID stamp (prefer unique slash paths).
   * Ancestors are closest-first → reverse for root→…→father.
   */
  function buildTreeCardFatherResolveHints(payload, branchKey) {
    const branch = normalizeTreeCardText(branchKey || "");
    const branchRoot = branch ? branch + " بن مطلق بن زيدان" : "";
    const father = normalizeTreeCardText((payload && payload.father) || "");
    const ancestorsClosest = treeCardAncestorsClosestFirst(payload || {});
    const farthestFirst = ancestorsClosest.slice().reverse();
    const closestGrandfather = ancestorsClosest[0] || "";
    const ordered = [];
    const seen = {};
    function pushHint(path, parentPath) {
      const p = normalizeTreeCardText(path || "");
      if (!p) return;
      const key = p + "|" + normalizeTreeCardText(parentPath || "");
      if (seen[key]) return;
      seen[key] = true;
      ordered.push({
        path: p,
        parentPath: normalizeTreeCardText(parentPath || ""),
      });
    }

    // Explicit path fields first (RX / edit dialog).
    pushHint(payload && payload.parent_node_id, closestGrandfather);
    pushHint(payload && payload.father_path, closestGrandfather);
    pushHint(payload && payload.parent_path, closestGrandfather);

    // Reconstruct unique path: branchRoot / فايز / … / هاجس / محمد
    if (father && farthestFirst.length) {
      if (branchRoot) {
        pushHint([branchRoot].concat(farthestFirst, [father]).join("/"), "");
      }
      pushHint(farthestFirst.concat([father]).join("/"), "");
      // Father leaf constrained by closest grandfather (disambiguates محمد).
      pushHint(father, closestGrandfather);
      if (branchRoot && farthestFirst.length) {
        pushHint(
          father,
          [branchRoot].concat(farthestFirst).join("/"),
        );
        pushHint(father, farthestFirst.join("/"));
      }
    } else if (father) {
      pushHint(father, "");
    }

    return {
      hints: ordered,
      father: father,
      closestGrandfather: closestGrandfather,
      ancestorsClosest: ancestorsClosest,
    };
  }

  /**
   * Stamp missing father person_id for RX / legacy payloads that only stored a path.
   * Uses ancestors + father when UUID missing; unique match only (TREE-001 if ambiguous).
   * Always hits tree_children when resolution is needed (visible Fetch on Accept).
   */
  async function stampTreeCardFatherPersonId(sb, reqRow) {
    const CP = window.AlzidanCanonicalPerson;
    const payload = extractTreeCardPayloadFromMessage(
      reqRow && reqRow.message ? reqRow.message : "",
      reqRow,
    );
    if (!payload) return { ok: true, row: reqRow, resolved: false };
    const existing = normalizeTreeCardText(
      payload.father_person_id ||
        payload.parent_person_id ||
        payload.selected_parent_person_id ||
        "",
    );
    if (existing) return { ok: true, row: reqRow, resolved: false, person_id: existing };

    const branchKey = normalizeTreeCardText(
      payload.branch_key || (reqRow && reqRow.branch_key) || "",
    );
    const builtHints = buildTreeCardFatherResolveHints(payload, branchKey);
    const hints = builtHints.hints;
    if (!sb || !branchKey || !hints.length) {
      return {
        ok: false,
        code: (CP && CP.ERROR && CP.ERROR.TREE_003) || "TREE-003",
        message:
          "يلزم parent_person_id / father_person_id من اختيار الأب قبل الاعتماد (TREE-003). افتح «تعديل كامل» واختر الأب من الشجرة ثم احفظ وأعد القبول.",
        row: reqRow,
        resolved: false,
      };
    }

    console.info("ADMIN_RPC approve resolve-parent start", {
      request_id: reqRow && reqRow.request_id,
      branch_key: branchKey,
      hints: hints.slice(0, 6).map((h) => h.path),
      ancestors: builtHints.ancestorsClosest.slice(0, 6),
    });
    const pathToRow = await loadPathToRowForBranch(sb, branchKey);
    let personId = "";
    let fatherPath = "";
    let ambiguous = null;
    for (let i = 0; i < hints.length; i += 1) {
      const hint = hints[i];
      const direct = pathToRow[hint.path];
      if (direct && direct.person_id) {
        personId = String(direct.person_id);
        fatherPath = normalizeTreeCardText(direct.db_child_name || hint.path);
        break;
      }
      const resolved = resolveExistingTreeNode(pathToRow, {
        path: hint.path,
        leaf: relationLeafName(hint.path),
        parentPath: hint.parentPath || "",
      });
      if (resolved && resolved.ok && resolved.found && resolved.meta && resolved.meta.person_id) {
        personId = String(resolved.meta.person_id);
        fatherPath = normalizeTreeCardText(
          resolved.meta.db_child_name || hint.path,
        );
        break;
      }
      if (resolved && !resolved.ok && resolved.code === "TREE-001") {
        ambiguous = resolved;
      }
    }
    if (!personId && ambiguous) {
      return {
        ok: false,
        code: "TREE-001",
        message:
          "الأب «" +
          relationPathLabel(builtHints.father || "") +
          "» يطابق أكثر من شخص — لن يُعتمد بلا مسار فريد. افتح «تعديل كامل» واختر مسار الأب من الشجرة (TREE-001).",
        row: reqRow,
        resolved: false,
        matchCount: ambiguous.matchCount || 0,
      };
    }
    if (!personId) {
      return {
        ok: false,
        code: (CP && CP.ERROR && CP.ERROR.TREE_003) || "TREE-003",
        message:
          "تعذر تحديد معرّف الأب من المسار النصي (TREE-003). افتح «تعديل كامل» واختر الأب «" +
          relationPathLabel(builtHints.father || "") +
          "» تحت «" +
          relationPathLabel(builtHints.closestGrandfather || "") +
          "» من الشجرة ثم احفظ وأعد القبول.",
        row: reqRow,
        resolved: false,
      };
    }

    const stamped = Object.assign({}, payload, {
      father_person_id: personId,
      parent_person_id: personId,
      father_path: fatherPath || payload.father_path || payload.parent_node_id || "",
      parent_node_id:
        payload.parent_node_id || fatherPath || payload.father_path || "",
      parent_path:
        payload.parent_path || fatherPath || payload.father_path || "",
    });
    // Keep tree_rows edges in sync so approve does not lose parent_person_id
    // when legacy payloads only had path text on the son edge.
    if (Array.isArray(payload.tree_rows) && payload.tree_rows.length) {
      const fatherLeaf = relationLeafName(fatherPath || stamped.father || "");
      stamped.tree_rows = payload.tree_rows.map(function (edge) {
        const next = Object.assign({}, edge || {});
        const parent = normalizeTreeCardText(next.parent_name || "");
        if (!parent) return next;
        if (normalizeTreeCardText(next.parent_person_id || "")) return next;
        const isFatherEdge =
          (fatherPath && parent === fatherPath) ||
          parent === normalizeTreeCardText(stamped.father || "") ||
          (parent.indexOf("/") < 0 &&
            fatherLeaf &&
            relationLeafName(parent) === fatherLeaf);
        if (isFatherEdge) next.parent_person_id = personId;
        if (fatherPath && isFatherEdge && parent.indexOf("/") < 0) {
          next.parent_name = fatherPath;
          const leaf = relationLeafName(next.child_name || stamped.name || "");
          if (leaf) next.child_name = fatherPath + "/" + leaf;
        }
        return next;
      });
    }
    const marker = "__JSON__:";
    const text = String(reqRow.message || "");
    const idx = text.indexOf(marker);
    const visible = idx >= 0 ? text.slice(0, idx).trimEnd() : text;
    const message =
      visible + "\n\n" + marker + "\n" + JSON.stringify(stamped, null, 2);
    console.info("ADMIN_RPC approve resolve-parent ok", {
      request_id: reqRow && reqRow.request_id,
      person_id: personId,
      father_path: fatherPath,
    });
    return {
      ok: true,
      row: Object.assign({}, reqRow, { message: message }),
      resolved: true,
      person_id: personId,
    };
  }

  /**
   * Patch 2+ — Verified apply for tree_card / add-son.
   * If father/ancestors already exist → reuse them; insert only missing children.
   * Never blind-insert the full tree_rows chain (no duplicate fathers).
   * Event order: build → resolve parent → skip-or-import child → verify → then approved.
   */
  async function importTreeCardToTree(sb, token, reqRow) {
    const CP = window.AlzidanCanonicalPerson;
    const stamped = await stampTreeCardFatherPersonId(sb, reqRow);
    if (stamped && stamped.ok === false) {
      return requestFail(
        stamped.code || (CP && CP.ERROR && CP.ERROR.TREE_003) || "TREE-003",
        stamped.message ||
          "يلزم تحديد الأب قبل الاعتماد (TREE-003). افتح «تعديل كامل» واختره من الشجرة.",
        { matchCount: stamped.matchCount || 0 },
      );
    }
    const workingRow = stamped && stamped.row ? stamped.row : reqRow;
    const built = buildTreeCardRows(workingRow);
    if (!built.ok) {
      return requestFail(
        built.code || (CP && CP.ERROR && CP.ERROR.REQ_002) || "REQ-002",
        built.message ||
          ((CP && CP.MSG && CP.MSG.REQ_002) ||
            "فشل إنشاء أو ربط الابن بعد الاعتماد (REQ-002)."),
      );
    }
    if (!built.rows || !built.rows.length) {
      return requestFail(
        (CP && CP.ERROR && CP.ERROR.REQ_001) || "REQ-001",
        (CP && CP.MSG && CP.MSG.REQ_001) ||
          "لا يمكن قبول الطلب: لم يُثبت أي أثر في الشجرة (REQ-001).",
      );
    }
    const branchKey = normalizeTreeCardText(
      (built.rows[0] && built.rows[0].branch_key) || reqRow.branch_key || "",
    );
    let pathToRow = await loadPathToRowForBranch(sb, branchKey);

    const appliedRows = [];
    let insertedTotal = 0;
    let updatedTotal = 0;
    let skippedTotal = 0;

    for (let i = 0; i < built.rows.length; i += 1) {
      // Resolve parent against existing tree (person_id / path / unique match).
      const enriched = enrichOneTreeCardRow(built.rows[i], pathToRow);
      if (!enriched.ok) return enriched;
      const row = enriched.row;
      row.child_name = alignChildPathUnderParent(
        row.parent_name,
        row.child_name,
      );

      // If child already exists under that parent → reuse; do not re-insert father/chain.
      const existingChild = resolveExistingTreeNode(pathToRow, {
        personId: row.person_id || "",
        path: row.child_name,
        parentPersonId: row.parent_person_id || "",
        parentPath: row.parent_name || "",
        leaf: relationLeafName(row.child_name),
      });
      if (!existingChild.ok) return existingChild;
      if (existingChild.found && existingChild.meta) {
        const meta = existingChild.meta;
        const wantPid = normalizeTreeCardText(row.parent_person_id || "");
        const metaPid = normalizeTreeCardText(meta.parent_person_id || "");
        const wantParent = normalizeTreeCardText(row.parent_name || "");
        const metaParent = normalizeTreeCardText(meta.db_parent_name || "");
        // Never reuse a same-name child under a different محمد / father UUID.
        const parentMismatch =
          (wantPid && metaPid && wantPid !== metaPid) ||
          (wantPid && !metaPid) ||
          (wantParent.indexOf("/") >= 0 &&
            metaParent.indexOf("/") >= 0 &&
            wantParent !== metaParent);
        if (!parentMismatch) {
          const reuse = Object.assign({}, row, {
            child_name: meta.db_child_name || row.child_name,
            parent_name:
              meta.db_parent_name || row.parent_name || row.parent || "",
            parent: meta.db_parent_name || row.parent_name || row.parent || "",
            person_id: meta.person_id || row.person_id || "",
            parent_person_id:
              meta.parent_person_id || row.parent_person_id || "",
          });
          pathToRow = indexImportedChild(pathToRow, {
            id: meta.id,
            person_id: reuse.person_id,
            parent_person_id: reuse.parent_person_id,
            parent_name: reuse.parent_name,
            parent: reuse.parent_name,
            child_name: reuse.child_name,
            name: reuse.child_name,
          });
          appliedRows.push(reuse);
          skippedTotal += 1;
          continue;
        }
      }

      const TE = treeEngineApi();
      let writeRow = row;
      if (TE && typeof TE.prepareChildWriteRow === "function") {
        const prepared = TE.prepareChildWriteRow(row);
        if (!prepared.ok) {
          return requestFail(
            prepared.code || "TREE-PARENT-NULL",
            prepared.message_ar ||
              "رفض كتابة صف بلا مسار أب (Tree Engine).",
            { detail: prepared.message || "" },
          );
        }
        writeRow = prepared.row;
      } else if (
        !normalizeTreeCardText(row.parent_name || row.parent || "")
      ) {
        return requestFail(
          "TREE-PARENT-NULL",
          "رفض كتابة صف بلا مسار أب.",
        );
      }

      const before = await fetchTreeCardChildRow(sb, writeRow);
      // Prefer upsert-insert for missing children: admin_tree_children_import_v1
      // step 4 can wrongly UPDATE another same-leaf son under a different محمد
      // (shared parent leaf) instead of inserting under the selected father UUID.
      let inserted = 0;
      let updated = 0;
      let skipped = 0;
      const upsert = await sb.rpc("admin_tree_child_upsert_v1", {
        p_token: token,
        p_row: writeRow,
      });
      if (upsert.error) {
        const msg = String(upsert.error.message || "");
        const low = msg.toLowerCase();
        // Older deployments may lack upsert — fall back to import RPC.
        if (
          /could not find|schema cache|pgrst202|does not exist/i.test(msg) ||
          low.includes("pgrst202")
        ) {
          const { data, error } = await sb.rpc("admin_tree_children_import_v1", {
            p_token: token,
            p_rows: [writeRow],
          });
          if (error) {
            const em = String(error.message || "");
            const el = em.toLowerCase();
            if (el.includes("tree-001") || em.includes("TREE-001")) {
              return requestFail(
                (CP && CP.ERROR && CP.ERROR.TREE_001) || "TREE-001",
                "الأب «" +
                  relationPathLabel(row.parent_name || "") +
                  "» غامض أو غير فريد — أوقف الاعتماد (TREE-001).",
                { detail: em },
              );
            }
            return requestFail(
              (CP && CP.ERROR && CP.ERROR.REQ_002) || "REQ-002",
              "تعذر إضافة البيانات للشجرة حالياً، حاول لاحقاً أو تواصل مع الإدارة. (REQ-002)",
              { detail: em, rows: appliedRows },
            );
          }
          inserted = data && data.inserted != null ? Number(data.inserted) : 0;
          updated = data && data.updated != null ? Number(data.updated) : 0;
          skipped = data && data.skipped != null ? Number(data.skipped) : 0;
        } else if (low.includes("tree-001") || msg.includes("TREE-001")) {
          return requestFail(
            (CP && CP.ERROR && CP.ERROR.TREE_001) || "TREE-001",
            "الأب «" +
              relationPathLabel(row.parent_name || "") +
              "» غامض أو غير فريد — أوقف الاعتماد (TREE-001).",
            { detail: msg },
          );
        } else {
          return requestFail(
            (CP && CP.ERROR && CP.ERROR.REQ_002) || "REQ-002",
            "تعذر إضافة البيانات للشجرة حالياً، حاول لاحقاً أو تواصل مع الإدارة. (REQ-002)",
            { detail: msg, rows: appliedRows },
          );
        }
      } else if (upsert.data && upsert.data.ok === false) {
        return requestFail(
          (CP && CP.ERROR && CP.ERROR.REQ_002) || "REQ-002",
          "تعذر إضافة البيانات للشجرة حالياً، حاول لاحقاً أو تواصل مع الإدارة. (REQ-002)",
          { detail: String((upsert.data && upsert.data.reason) || ""), rows: appliedRows },
        );
      } else {
        inserted = 1;
      }
      insertedTotal += Number.isFinite(inserted) ? inserted : 0;
      updatedTotal += Number.isFinite(updated) ? updated : 0;
      skippedTotal += Number.isFinite(skipped) ? skipped : 0;

      const after = await fetchTreeCardChildRow(sb, writeRow);
      const parent = normalizeTreeCardText(writeRow.parent_name || "");
      const branch = normalizeTreeCardText(writeRow.branch_key || "");
      const branchRoot = branch ? branch + " بن مطلق بن زيدان" : "";
      const isBranchRoot =
        !!branch && (parent === branch || parent === branchRoot);
      const linkedOk = writeRow.parent_person_id
        ? after &&
          String(after.parent_person_id || "") ===
            String(writeRow.parent_person_id) &&
          normalizeTreeCardText(after.child_name || after.name || "") ===
            normalizeTreeCardText(writeRow.child_name || "")
        : !!after && (isBranchRoot || !!after.parent_person_id);
      if (!linkedOk) {
        const updatedOnly =
          !inserted &&
          (Number.isFinite(updated) ? updated : 0) > 0 &&
          !!writeRow.parent_person_id;
        return requestFail(
          (CP && CP.ERROR && CP.ERROR.REQ_002) || "REQ-002",
          updatedOnly
            ? "تعذر إنشاء الابن تحت الأب المحدد: وُجد اسم مطابق تحت أب آخر بنفس ورقة الاسم، ولم يُدرج صف جديد تحت الأب المختار (REQ-002)."
            : (CP && CP.MSG && CP.MSG.REQ_002) ||
                "فشل إنشاء أو ربط الابن بعد الاعتماد (REQ-002).",
          {
            inserted: insertedTotal,
            updated: updatedTotal,
            skipped: skippedTotal,
            rows: appliedRows,
            reason: updatedOnly ? "same_leaf_under_other_father" : "link_verify_failed",
          },
        );
      }
      pathToRow = indexImportedChild(pathToRow, after);
      appliedRows.push(row);
      // If RPC reported 0/0 but row existed and is linked, count as verified update path
      if (!inserted && !updated && before && after) {
        updatedTotal += 1;
      }
    }

    // Verify only newly written / reused edges that should exist after apply.
    const verify = await verifyTreeCardRowsInTree(sb, appliedRows);
    if (!verify.ok) {
      if (!(insertedTotal + updatedTotal + skippedTotal)) {
        return requestFail(
          (CP && CP.ERROR && CP.ERROR.REQ_001) || "REQ-001",
          (CP && CP.MSG && CP.MSG.REQ_001) ||
            "لا يمكن قبول الطلب: لم يُثبت أي أثر في الشجرة (REQ-001).",
          {
            inserted: insertedTotal,
            updated: updatedTotal,
            skipped: skippedTotal,
            verified: verify.verified,
          },
        );
      }
      // Reused-only apply (all ancestors existed, son linked) still needs verify ok.
      if (!(insertedTotal + updatedTotal) && skippedTotal) {
        // Skipped rows must still be readable; if verify failed, treat as REQ-002.
        return requestFail(
          (CP && CP.ERROR && CP.ERROR.REQ_002) || "REQ-002",
          (CP && CP.MSG && CP.MSG.REQ_002) ||
            "فشل إنشاء أو ربط الابن بعد الاعتماد (REQ-002).",
          {
            inserted: insertedTotal,
            updated: updatedTotal,
            skipped: skippedTotal,
            verified: verify.verified,
          },
        );
      }
      return requestFail(
        (CP && CP.ERROR && CP.ERROR.REQ_002) || "REQ-002",
        (CP && CP.MSG && CP.MSG.REQ_002) ||
          "فشل إنشاء أو ربط الابن بعد الاعتماد (REQ-002).",
        {
          inserted: insertedTotal,
          updated: updatedTotal,
          skipped: skippedTotal,
          verified: verify.verified,
        },
      );
    }

    const parts = [];
    parts.push("جديد: " + String(insertedTotal));
    parts.push("تحديث: " + String(updatedTotal));
    if (skippedTotal) parts.push("موجود مسبقاً: " + String(skippedTotal));
    parts.push("متحقق: " + String(verify.verified));
    return {
      ok: true,
      code: "",
      message: parts.join("، "),
      inserted: insertedTotal,
      updated: updatedTotal,
      skipped: skippedTotal,
      verified: verify.verified,
      rows: appliedRows,
    };
  }

  /** Re-apply for already-approved orphan tree_card requests (no status change). */
  async function reapplyApprovedTreeCard(sb, token, reqRow) {
    return importTreeCardToTree(sb, token, reqRow);
  }

  window.AlzidanRequestActions = {
    setReloadRequests,
    publishEventCardRequest,
    isEventPublishRequestKind,
    familyEventDetailsMatchRequestId,
    familyEventMatchesPublishIdentity,
    unpublishPublishedEventForRequest,
    notifyFamilyEventPush,
    formatPushNotifyAdminMessage,
    openTreeCardEditor,
    importTreeCardToTree,
    reapplyApprovedTreeCard,
    buildTreeCardRows,
    enrichOneTreeCardRow,
    resolveExistingTreeNode,
    alignChildPathUnderParent,
    verifyTreeCardRowsInTree,
    countExactParentPersonMatches,
    buildTreeCardFatherResolveHints,
    stampTreeCardFatherPersonId,
    updateBranchInRequestMessage,
    extractRequestMediaLinks,
    appendRequestMediaPreview,
    requestMessageWithoutMediaLinks,
  };
})();
