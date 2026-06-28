(() => {
  "use strict";

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
  const requestSearchInput = document.getElementById("requests-search");
  const requestsPageSizeSelect = document.getElementById("requests-page-size");
  const requestsPrevPageBtn = document.getElementById("requests-prev");
  const requestsNextPageBtn = document.getElementById("requests-next");
  const requestsPageInfo = document.getElementById("requests-page-info");

  let requestsAllRows = [];
  let requestsCurrentPage = 1;

  function buildRequestDetailsText(row) {
    const lines = [
      row.request_id ? "رقم الطلب: " + row.request_id : "",
      row.branch_key ? "الفرع: " + row.branch_key : "",
      row.phone ? "الجوال: " + row.phone : "",
      row.email ? "البريد: " + row.email : "",
      row.created_at
        ? "التاريخ الكامل: " + formatDateTimeArSaVerbose(row.created_at)
        : "",
      "",
      requestActions.requestMessageWithoutMediaLinks(row.message || ""),
    ].filter(
      (line, index, arr) => line || (index > 0 && index < arr.length - 1),
    );
    return lines.join("\n").trim() || "لا توجد تفاصيل إضافية.";
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
  function renderRequestRow(row) {
    if (!requestsBody) return;
    const tr = document.createElement("tr");
    function tdText(text) {
      const td = document.createElement("td");
      td.textContent = text || "";
      return td;
    }
    tr.appendChild(tdText(row.request_id || ""));
    tr.appendChild(tdText(kindLabel(row.kind)));
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
    pill.textContent = statusLabel(row.status);
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
    const body = document.createElement("div");
    body.textContent = buildRequestDetailsText(row);
    det.appendChild(sum);
    det.appendChild(body);
    requestActions.appendRequestMediaPreview(body, row.message || "");
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
      statusLabel(row.status),
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
    requestsBody.innerHTML = "";
    const query = requestSearchInput ? requestSearchInput.value : "";
    const filtered = requestsAllRows.filter((row) =>
      requestRowMatchesSearch(row, query),
    );
    if (!filtered.length) {
      renderEmpty("لا توجد طلبات مطابقة للبحث والفلاتر الحالية.");
    } else {
      filtered.forEach((row) => renderRequestRow(row));
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

  init();
  loadRequests().catch(() => {});
})();
