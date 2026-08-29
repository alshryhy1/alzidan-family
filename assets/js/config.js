(function () {
  "use strict";

  const SUPABASE_URL = "https://wbskjfdqpugnwvrykqcn.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_JhgwBIXhs6z4yBZOoE2EqA_UlzjzW9c";
  let sharedClient = null;

  function currentAdminToken() {
    try {
      if (window.AlzidanAdminCore && typeof window.AlzidanAdminCore.getAdminToken === "function") {
        return String(window.AlzidanAdminCore.getAdminToken() || "").trim();
      }
    } catch (e) {}
    try {
      if (window.AlzidanAuth && typeof window.AlzidanAuth.getAdminToken === "function") {
        return String(window.AlzidanAuth.getAdminToken() || "").trim();
      }
    } catch (e) {}
    return "";
  }

  function getClient() {
    const tokenNow = currentAdminToken();
    if (sharedClient && sharedClient.__alzidanAdminToken === tokenNow) return sharedClient;

    if (!window.supabase || typeof window.supabase.createClient !== "function") return null;

    sharedClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        headers: tokenNow ? { "X-Alzidan-Admin-Token": tokenNow } : {},
      },
    });
    sharedClient.__alzidanAdminToken = tokenNow;
    window.__alzidanSupabaseClient = sharedClient;
    window.__alzidanالخدمةClient = sharedClient;

    return sharedClient;
  }

  window.__alzidanConfig = {
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    getClient
  };
})();
