(function () {
  "use strict";

  const SUPABASE_URL = "https://wbskjfdqpugnwvrykqcn.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_JhgwBIXhs6z4yBZOoE2EqA_UlzjzW9c";
  let sharedClient = null;

  function getClient() {
    if (sharedClient) return sharedClient;

    if (window.__alzidanSupabaseClient) {
      sharedClient = window.__alzidanSupabaseClient;
      window.__alzidanالخدمةClient = sharedClient;
      return sharedClient;
    }

    if (window.__alzidanالخدمةClient) {
      sharedClient = window.__alzidanالخدمةClient;
      window.__alzidanSupabaseClient = sharedClient;
      return sharedClient;
    }

    if (!window.supabase || typeof window.supabase.createClient !== "function") return null;

    sharedClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
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
