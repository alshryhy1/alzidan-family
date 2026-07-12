(function () {
  "use strict";

  function getClient() {
    if (window.__alzidanConfig && typeof window.__alzidanConfig.getClient === "function") {
      return window.__alzidanConfig.getClient();
    }
    return window.__alzidanSupabaseClient || window.__alzidanالخدمةClient || null;
  }

  function trackView(path) {
    const sb = getClient();
    const normalized = String(path || "").trim();
    if (!sb || !normalized) return Promise.resolve(false);
    return sb.rpc("site_track_view_v1", { p_path: normalized }).catch(() => false);
  }

  function detectMemoryPath() {
    const pathname = String(window.location.pathname || "").toLowerCase();
    if (!pathname.includes("memory")) return null;
    if (pathname.includes("person")) return "memory/person";
    if (pathname.includes("admin")) return "memory/admin";
    return "memory/index";
  }

  function autoTrackMemoryPage() {
    const path = detectMemoryPath();
    if (!path) return;
    trackView(path);
  }

  window.AlzidanViewTracker = {
    trackView: trackView,
    autoTrackMemoryPage: autoTrackMemoryPage,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoTrackMemoryPage);
  } else {
    autoTrackMemoryPage();
  }
})();
