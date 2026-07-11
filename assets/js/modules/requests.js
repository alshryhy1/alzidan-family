(() => {
  "use strict";

  function requestStatusLabel(status) {
    const value = String(status || "").trim();
    if (value === "pending") return "انتظار";
    if (value === "approved") return "قبول";
    if (value === "rejected") return "رفض";
    return value || "-";
  }



  const Core = window.AlzidanAdminCore || {};
  const {
    showAlert,
    hideAlert,
    getClient,
    getAdminToken,
    formatDateTimeArSaVerbose,
    coerceRpcId,
    kindLabel,
    statusLabel,
    renderEmpty,
    tokenFromRpcResult,
  } = Core;

  const requestActions = window.AlzidanRequestActions || {};

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
    const rawMessage = requestActions.requestMessageWithoutMediaLinks
      ? requestActions.requestMessageWithoutMediaLinks(row.message || "")
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
  function normalizeQualityKeyText(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
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

    const summaryData = [
      ["رقم الطلب", String(row && row.request_id ? row.request_id : "")],
      ["نوع الطلب", kindLabel(row && row.kind ? row.kind : "")],
      ["الفرع", String(row && row.branch_key ? row.branch_key : "")],
      ["الاسم", String(row && row.name ? row.name : "")],
      ["الجوال", String(row && row.phone ? row.phone : "")],
      ["البريد", String(row && row.email ? row.email : "")],
      ["التاريخ", row && row.created_at ? formatDateTimeArSaVerbose(row.created_at) : ""],
    ];
    const eventData = parseEventPayloadFromRow(row);
    if (String(row && row.kind ? row.kind : "") === "event_card") {
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

    summaryData
      .filter((item) => String(item[1] || "").trim())
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
    requestActions.appendRequestMediaPreview(summaryPanel, row.message || "");
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
    tr.appendChild(tdText(row.email || ""));
    const tdStatus = document.createElement("td");
    const pill = document.createElement("span");
    pill.className =
      "status-pill " +
      (row.status === "approved"
        ? "status-approved"
        : row.status === "rejected"
          ? "status-rejected"
          : "status-pending");
    pill.textContent = requestStatusLabel(row.status);
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
    actions.appendChild(approveBtn);
    actions.appendChild(rejectBtn);
    if (row.kind === "event_card") actions.appendChild(publishEventBtn);
    actions.appendChild(editBranchBtn);
    actions.appendChild(deleteBtn);
    tdActions.appendChild(actions);
    tr.appendChild(tdActions);
    editBranchBtn.addEventListener("click", async () => {
      hideAlert();
      if (row.kind === "tree_card") {
        requestActions.openTreeCardEditor(row);
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
      const message = requestActions.updateBranchInRequestMessage(
        row.message,
        branchKey,
        row.kind,
      );
      let treeRows = [];
      if (row.status === "approved" && row.kind === "tree_card") {
        const built = buildTreeCardRows(row, currentBranch);
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
    approveBtn.addEventListener("click", async () => {
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
      const id = coerceRpcId(row.id != null ? row.id : row.request_id);
      if (!id) {
        showAlert("error", "بيانات الطلب ناقصة.");
        return;
      }
      if (row.kind === "tree_card") {
        const imported = await requestActions.importTreeCardToTree(sb, token, row);
        if (!imported.ok) {
          showAlert("error", imported.message || "تعذر إضافة البطاقة للشجرة.");
          return;
        }
      } else if (row.kind === "event_card") {
        const published = await requestActions.publishEventCardRequest(sb, token, row);
        if (!published.ok) {
          showAlert("error", published.message || "تعذر نشر المناسبة.");
          window.alert(published.message || "تعذر نشر المناسبة.");
          return;
        }
      }
      const { data, error } = await sb.rpc("admin_set_request_status_v2", {
        p_token: token,
        p_id: id,
        p_status: "approved",
      });
      if (error) {
        showAlert(
          "error",
          "تعذر اعتماد الطلب حالياً، حاول لاحقاً أو تواصل مع الإدارة.",
        );
        return;
      }
      if (data === false) {
        showAlert(
          "error",
          "تعذر اعتماد الطلب. انتهت الجلسة أو لا توجد صلاحية.",
        );
        return;
      }
      if (row.kind === "tree_card") {
        showAlert(
          "success",
          `تم قبول الطلب وإضافة البيانات للشجرة: ${row.request_id}`,
        );
      } else if (row.kind === "event_card") {
        showAlert(
          "success",
          `تم قبول الطلب ونشر المناسبة في الويب والتطبيق: ${row.request_id}`,
        );
      } else {
        showAlert("success", `تم قبول الطلب: ${row.request_id}`);
      }
      await loadRequests();
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
      const published = await requestActions.publishEventCardRequest(sb, token, row);
      publishEventBtn.disabled = false;
      if (!published.ok) {
        showAlert("error", published.message || "تعذر نشر المناسبة.");
        window.alert(published.message || "تعذر نشر المناسبة.");
        return;
      }
      showAlert(
        "success",
        `تم نشر المناسبة في الويب والتطبيق: ${row.request_id}`,
      );
      window.alert("تم نشر المناسبة في الويب والتطبيق.");
      await loadRequests();
    });
    deleteBtn.addEventListener("click", async () => {
      hideAlert();
      const id = coerceRpcId(row.id != null ? row.id : row.request_id);
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
      const { data, error } = await sb.rpc("admin_delete_request_v1", {
        p_token: token,
        p_id: String(id),
      });
      deleteBtn.disabled = false;
      if (error) {
        showAlert("error", "تعذر حذف الطلب، حاول لاحقاً أو تواصل مع الإدارة.");
        return;
      }
      if (data !== true) {
        showAlert("error", "لم يتم حذف الطلب. انتهت الجلسة أو لا توجد صلاحية.");
        return;
      }
      showAlert("success", "تم حذف الطلب : " + String(row.request_id || id));
      await loadRequests();
      window.AlzidanRequestsStats.loadRequestsStats().catch(() => {});
    });
    rejectBtn.addEventListener("click", async () => {
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
      const id = coerceRpcId(row.id != null ? row.id : row.request_id);
      if (!id) {
        showAlert("error", "بيانات الطلب ناقصة.");
        return;
      }
      const { data, error } = await sb.rpc("admin_set_request_status_v2", {
        p_token: token,
        p_id: id,
        p_status: "rejected",
      });
      if (error) {
        showAlert(
          "error",
          "تعذر رفض الطلب حالياً، حاول لاحقاً أو تواصل مع الإدارة.",
        );
        return;
      }
      if (data === false) {
        showAlert("error", "تعذر رفض الطلب. انتهت الجلسة أو لا توجد صلاحية.");
        return;
      }
      showAlert("success", `تم رفض الطلب: ${row.request_id}`);
      await loadRequests();
    });
    requestsBody.appendChild(tr);
  }
  function normalizeRequestSearchText(value) {
    return String(value == null ? "" : value)
      .toLowerCase()
      .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
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
      p_limit: 5000,
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
    init();
    loadRequests().catch(() => {});
  }

  window.AlzidanAdminRequestsModule = Object.assign(
    window.AlzidanAdminRequestsModule || {},
    { bootstrap },
  );
})();
