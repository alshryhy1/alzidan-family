(function () {
  const SUPABASE_URL = "https://wbskjfdqpugnwvrykqcn.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_JhgwBIXhs6z4yBZOoE2EqA_UlzjzW9c";
  let sbClient = null;
  function getAlzidanClient() {
    if (sbClient) return sbClient;
    if (window.__alzidanالخدمةClient) {
      sbClient = window.__alzidanالخدمةClient;
      return sbClient;
    }
    if (!window.supabase || typeof window.supabase.createClient !== "function") return null;
    sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    window.__alzidanالخدمةClient = sbClient;
    return sbClient;
  }
  window.__alzidanConfig = {
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    getClient: getAlzidanClient,
    getAlzidanClient
  };
})();