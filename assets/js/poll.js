/* ===== extracted script block ===== */

(function(){
  const SUPABASE_URL = "https://wbskjfdqpugnwvrykqcn.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_JhgwBIXhs6z4yBZOoE2EqA_UlzjzW9c";
  let sbClient = null;

  function getClient(){
    if (sbClient) return sbClient;
    if (window.__alzidanالخدمةClient) return (sbClient = window.__alzidanالخدمةClient);
    if (!window.supabase || typeof window.supabase.createClient !== "function") return null;
    sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    window.__alzidanالخدمةClient = sbClient;
    return sbClient;
  }

  function getVoterKey(){
    const k = "alzidan_public_poll_voter_v1";
    try {
      let v = localStorage.getItem(k);
      if (!v) {
        v = "v_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2);
        localStorage.setItem(k, v);
      }
      return v;
    } catch(e) {
      return "session_" + Math.random().toString(36).slice(2);
    }
  }

  function buildCard(){
    const card = document.createElement("aside");
    card.className = "family-poll-card";
    card.innerHTML = `
      <div class="family-poll-ring" data-poll-ring style="--p:0%">
        <div class="family-poll-percent" data-poll-percent>0%</div>
      </div>
      <div>
        <div class="family-poll-title">تصويت عام</div>
        <div class="family-poll-question" data-poll-question>جاري تحميل التصويت...</div>
        <div class="family-poll-actions">
          <button class="family-poll-support" type="button" data-poll-vote="support">مؤيد</button>
          <button class="family-poll-oppose" type="button" data-poll-vote="oppose">معارض</button>
        </div>
        <div class="family-poll-stats">
          <span data-poll-support>مؤيد: 0</span>
          <span data-poll-oppose>معارض: 0</span>
          <span data-poll-total>الإجمالي: 0</span>
        </div>
        <div class="family-poll-status" data-poll-status></div>
      </div>
    `;
    return card;
  }

  async function loadPoll(card){
    const sb = getClient();
    const status = card.querySelector("[data-poll-status]");
    if (!sb) { status.textContent = "تعذر تحميل التصويت."; return; }

    const { data: polls, error } = await sb
      .from("family_polls")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending:false })
      .limit(1);

    if (error || !polls || !polls[0]) {
      status.textContent = "لا يوجد تصويت نشط حالياً.";
      return;
    }

    const poll = polls[0];
    card.dataset.pollId = String(poll.id);
    card.querySelector("[data-poll-question]").textContent = poll.question || "تصويت عام";

    const { data: votes } = await sb
      .from("family_poll_votes")
      .select("vote_value")
      .eq("poll_id", poll.id);

    const list = Array.isArray(votes) ? votes : [];
    const support = list.filter(v => v.vote_value === "support").length;
    const oppose = list.filter(v => v.vote_value === "oppose").length;
    const total = support + oppose;
    const percent = total ? Math.round((support / total) * 100) : 0;

    card.querySelector("[data-poll-ring]").style.setProperty("--p", percent + "%");
    card.querySelector("[data-poll-percent]").textContent = percent + "%";
    card.querySelector("[data-poll-support]").textContent = "مؤيد: " + support;
    card.querySelector("[data-poll-oppose]").textContent = "معارض: " + oppose;
    card.querySelector("[data-poll-total]").textContent = "الإجمالي: " + total;
    status.textContent = total ? "نسبة التأييد الحالية" : "كن أول المصوتين";
  }

  async function vote(card, value){
    const sb = getClient();
    const pollId = Number(card.dataset.pollId || 0);
    const status = card.querySelector("[data-poll-status]");
    if (!sb || !pollId) return;

    status.textContent = "جاري حفظ التصويت...";
    const { error } = await sb.from("family_poll_votes").insert({
      poll_id: pollId,
      voter_key: getVoterKey(),
      vote_value: value
    });

    if (error) {
      status.textContent = "تم تسجيل تصويتك سابقاً.";
      return;
    }

    status.textContent = "تم تسجيل تصويتك.";
    await loadPoll(card);
  }

  function mount(){
    const search = document.getElementById("search");
    if (!search || document.querySelector(".search-poll-row")) return;

    const row = document.createElement("div");
    row.className = "search-poll-row";

    const card = buildCard();
    const parent = search.parentNode;
    parent.insertBefore(row, search);

    const statsCard = document.createElement("aside");
    statsCard.className = "family-mini-stats-card";
    statsCard.innerHTML = '<div class="family-mini-stats-title">إحصائيات شجرة عائلة الزيدان</div><div class="family-mini-stats-circles"><div class="family-mini-stat-circle"><div class="family-mini-stat-value" id="mini-tree-total-card">—</div><div class="family-mini-stat-label">إجمالي الشجرة</div></div><div class="family-mini-stat-circle"><div class="family-mini-stat-value">٥</div><div class="family-mini-stat-label">الفروع</div></div><div class="family-mini-stat-circle"><div class="family-mini-stat-value" id="mini-visits-total-card">—</div><div class="family-mini-stat-label">إجمالي الزيارات</div></div></div>';

    row.appendChild(card);
    row.appendChild(statsCard);

    card.querySelectorAll("[data-poll-vote]").forEach(btn=>{
      btn.addEventListener("click", ()=>vote(card, btn.getAttribute("data-poll-vote")));
    });

    loadPoll(card).catch(()=>{});
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();

/* ===== extracted script block ===== */

(function(){
  function syncMiniStatsCard(){
    var tree = document.getElementById("mini-tree-total");
    var visits = document.getElementById("mini-visits-total");
    var treeCard = document.getElementById("mini-tree-total-card");
    var visitsCard = document.getElementById("mini-visits-total-card");
    if (tree && treeCard) treeCard.textContent = tree.textContent || "—";
    if (visits && visitsCard) visitsCard.textContent = visits.textContent || "—";
  }
  syncMiniStatsCard();
  setInterval(syncMiniStatsCard, 700);
})();
