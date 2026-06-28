(() => {
  "use strict";

  const Core = window.AlzidanAdminCore || {};
  const {
    getClient,
    getAdminToken,
    kindLabel,
  } = Core;

  function renderRequestsStatsLoading() {
    const el = document.getElementById("requests-stats");
    if (!el) return;
    el.textContent = "جاري تحميل الإحصاء...";
  }
  function renderRequestsStatsError(text) {
    const el = document.getElementById("requests-stats");
    if (!el) return;
    el.textContent = String(text || "تعذر عرض الإحصاء.");
  }
  function renderRequestsStats(list, limit) {
    const el = document.getElementById("requests-stats");
    if (!el) return;
    const rows = Array.isArray(list) ? list : [];
    const total = rows.length;
    const byKind = new Map();
    const byStatus = new Map();
    rows.forEach((row) => {
      const kind = String(row.kind || "unknown");
      const status = String(row.status || "unknown");
      byKind.set(kind, (byKind.get(kind) || 0) + 1);
      byStatus.set(status, (byStatus.get(status) || 0) + 1);
    });
    function card(label, value, extraClass) {
      return (
        '<div class="requests-stat-card ' +
        (extraClass || "") +
        '">' +
        "<strong>" +
        String(value || 0) +
        "</strong>" +
        "<span>" +
        label +
        "</span>" +
        "</div>"
      );
    }
    const kindOrder = ["tree_card", "tree_audit", "event_card", "events_audit"];
    let html = '<div class="requests-stats-cards">';
    html += card("إجمالي الطلبات", total, "stat-total");
    html += card("انتظار", byStatus.get("pending") || 0, "stat-pending");
    html += card("قبول", byStatus.get("approved") || 0, "stat-approved");
    html += card("رفض", byStatus.get("rejected") || 0, "stat-rejected");
    const hiddenKinds = new Set([
      "tree_delegate",
      "events_delegate",
      "test_request",
    ]);
    const customLabels = {
      tree_audit: "تعديل الشجرة",
      events_audit: "تعديل المناسبات",
    };
    kindOrder.forEach((kind) => {
      if (hiddenKinds.has(kind)) return;
      const count = byKind.get(kind) || 0;
      if (count <= 0) return;
      const label = customLabels[kind] || kindLabel(kind);
      html += card(label, count, "stat-kind");
    });
    html += "</div>";
    if (limit && total >= limit) {
      html +=
        '<div class="hint" style="margin-top:8px;">تم عرض أول ' +
        String(limit) +
        " طلب فقط.</div>";
    }
    el.innerHTML = html;
  }
  async function loadRequestsStats() {
    const sb = getClient();
    if (!sb) {
      renderRequestsStatsError("الخدمة غير جاهزة حالياً.");
      return;
    }
    const token = getAdminToken();
    if (!token) {
      renderRequestsStatsError("سجل الدخول للإدارة لعرض الإحصاء.");
      return;
    }
    const limit = 5000;
    renderRequestsStatsLoading();
    const { data, error } = await sb.rpc("admin_list_requests", {
      p_token: token,
      p_status: null,
      p_kind: null,
      p_limit: limit,
    });
    if (error) {
      renderRequestsStatsError(
        "تعذر تحميل الإحصاء، حاول لاحقاً أو تواصل مع الإدارة.",
      );
      return;
    }
    const list = Array.isArray(data) ? data : [];
    renderRequestsStats(list, limit);
  }


  window.AlzidanRequestsStats = {
    loadRequestsStats,
  };
})();
