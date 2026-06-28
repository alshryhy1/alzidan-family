(function () {
  "use strict";

  function getClient() {
    if (window.__alzidanConfig && typeof window.__alzidanConfig.getClient === "function") {
      const shared = window.__alzidanConfig.getClient();
      if (shared) return shared;
    }
    if (window.__alzidanSupabaseClient) return window.__alzidanSupabaseClient;
    if (window.__alzidanالخدمةClient) return window.__alzidanالخدمةClient;
    return null;
  }

  const viewsStatsEl = document.getElementById("views-stats");
  const refreshViewsStatsBtn = document.getElementById("refresh-views-stats");

function cleanVisitPathLabel(value) {
    let text = String(value == null ? "" : value).trim();
    if (!text) return "الصفحة الرئيسية";

    text = text.replace(/^file:\/\/\/?/i, "");
    text = text.split(String.fromCharCode(92)).join("/");

    const parts = text.split("/").filter(Boolean);
    text = parts.length ? parts[parts.length - 1] : text;

    text = text.replace(/\.html$/i, "").trim();

    if (!text || text === "index") return "الصفحة الرئيسية";
    if (/^index[_-]/i.test(text)) return "الصفحة الرئيسية";
    if (/^sandbox$/i.test(text)) return "بيئة اختبار";
    if (/patched|final|copy|backup|نسخة/i.test(text)) return "صفحة تجريبية";

    return text;
  }

  function isIgnoredVisitPathLabel(label) {
    const text = String(label || "").trim();
    if (!text) return true;
    if (text === "بيئة اختبار") return true;
    if (text === "صفحة تجريبية") return true;
    return false;
  }

  function renderViewsStatsLoading() { if (!viewsStatsEl) return; viewsStatsEl.textContent = "جاري تحميل الإحصاءات..."; } function renderViewsStatsError(text) { if (!viewsStatsEl) return; viewsStatsEl.textContent = text || "تعذر تحميل الإحصاءات."; } function renderViewsStats(data) { if (!viewsStatsEl) return; const total = data && data.total != null ? Number(data.total) : 0; const today = data && data.today != null ? Number(data.today) : 0; const last7 = data && data.last_7 != null ? Number(data.last_7) : 0; const lines = []; lines.push("إجمالي الزيارات: " + String(isFinite(total) ? total : 0)); lines.push("زيارات اليوم: " + String(isFinite(today) ? today : 0)); lines.push("آخر 7 أيام: " + String(isFinite(last7) ? last7 : 0)); const paths = data && Array.isArray(data.paths) ? data.paths : [];
    const mergedPaths = new Map();

    paths.forEach((p) => {
      const rawPath = p && p.path != null ? String(p.path) : "";
      const count = p && p.total != null ? Number(p.total) : 0;
      if (!rawPath || !isFinite(count) || count <= 0) return;

      const label = cleanVisitPathLabel(rawPath);
      if (isIgnoredVisitPathLabel(label)) return;

      mergedPaths.set(label, (mergedPaths.get(label) || 0) + count);
    });

    const topPaths = Array.from(mergedPaths.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    if (topPaths.length) {
      lines.push("");
      lines.push("أكثر الصفحات زيارة:");
      topPaths.forEach(([label, count]) => {
        lines.push("- " + label + " (" + String(count) + ")");
      });
    }

    viewsStatsEl.textContent = lines.join("\n"); } async function loadViewsStats() { const sb = getClient(); if (!sb) { renderViewsStatsError("الخدمة غير جاهزة حالياً."); return; } renderViewsStatsLoading(); const { data, error } = await sb.rpc("site_view_summary_v1", { p_days: 30 }); if (error) { const msg = String(error.message || ""); const low = msg.toLowerCase(); const isMissing = low.includes("could not find the function") || low.includes("does not exist") || String(error.code || "").toLowerCase() === "pgrst202"; if (isMissing) { renderViewsStatsError("تعذر تحميل إحصاءات الزيارات حالياً."); return; } renderViewsStatsError("تعذر تحميل الإحصاءات، حاول لاحقاً أو تواصل مع الإدارة."); return; } renderViewsStats(data || {}); }

  if (refreshViewsStatsBtn) {
    refreshViewsStatsBtn.addEventListener("click", () => loadViewsStats().catch(() => {}));
  }

  window.AlzidanAdminViews = {
    loadViewsStats
  };
})();
