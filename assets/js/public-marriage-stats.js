(() => {
  "use strict";

  function getClient() {
    if (window.__alzidanConfig && typeof window.__alzidanConfig.getClient === "function") {
      return window.__alzidanConfig.getClient();
    }
    return window.__alzidanSupabaseClient || window.__alzidanالخدمةClient || null;
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;");
  }

  function pct(part, total) {
    const p = Number(part) || 0;
    const t = Number(total) || 0;
    if (!t) return "0%";
    const value = Math.round((p * 1000) / t) / 10;
    return String(value).replace(/\.0$/, "") + "%";
  }

  function getEls() {
    return {
      root: document.querySelector("[data-public-affinity-overview]"),
      status: document.querySelector("[data-public-affinity-status]"),
      cards: document.querySelector("[data-public-affinity-cards]"),
      branches: document.querySelector("[data-public-affinity-branches]"),
    };
  }

  function setStatus(text) {
    const { status } = getEls();
    if (status) status.textContent = text;
  }

  function setEmpty(text) {
    const { cards, branches } = getEls();
    if (cards) cards.innerHTML = "";
    if (branches) branches.innerHTML = '<div class="stats-alert">' + esc(text) + "</div>";
  }

  function render(rows) {
    const { cards, branches } = getEls();
    if (!cards || !branches) return;

    const list = Array.isArray(rows) ? rows : [];
    const active = list.filter((row) => String(row.status || "active") === "active");

    if (!active.length) {
      setStatus("لا توجد بيانات مصاهرة حالياً.");
      setEmpty("لا توجد سجلات مصاهرة منشورة حالياً.");
      return;
    }

    const inside = active.filter((row) => row.wife_is_family_member === true).length;
    const outside = active.filter((row) => row.wife_is_family_member === false).length;
    const unknown = active.filter((row) => row.wife_is_family_member !== true && row.wife_is_family_member !== false).length;

    const byBranch = new Map();
    active.forEach((row) => {
      if (row.wife_is_family_member !== true) return;
      const branch = String(row.wife_branch_key || "غير محدد").trim() || "غير محدد";
      byBranch.set(branch, (byBranch.get(branch) || 0) + 1);
    });

    const topBranches = Array.from(byBranch.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ar"))
      .slice(0, 5);

    cards.innerHTML = [
      {
        label: "إجمالي المصاهرات",
        value: active.length,
        sub: "سجلات فعالة",
      },
      {
        label: "داخل العائلة",
        value: pct(inside, active.length),
        sub: String(inside) + " سجل",
      },
      {
        label: "خارج العائلة",
        value: pct(outside, active.length),
        sub: String(outside) + " سجل",
      },
      {
        label: "غير محدد",
        value: pct(unknown, active.length),
        sub: String(unknown) + " سجل",
      },
    ]
      .map(
        (card) =>
          '<div class="public-affinity-card">' +
          '<div class="public-affinity-label">' + esc(card.label) + "</div>" +
          '<div class="public-affinity-value">' + esc(card.value) + "</div>" +
          '<div class="public-affinity-sub">' + esc(card.sub) + "</div>" +
          "</div>",
      )
      .join("");

    const rowsHtml = topBranches.length
      ? topBranches
          .map(
            ([name, total]) =>
              '<div class="public-affinity-row">' +
              '<div class="public-affinity-row-name">' + esc(name) + "</div>" +
              '<div class="public-affinity-row-value">' + esc(total) + "</div>" +
              "</div>",
          )
          .join("")
      : '<div class="stats-updated">لا توجد مصاهرات داخلية مصنفة حسب الفروع حتى الآن.</div>';

    branches.innerHTML =
      '<div class="stats-updated">أعلى فروع المصاهرة الداخلية</div>' + rowsHtml;

    setStatus("تم التحديث الآن.");
  }

  async function loadPublicAffinityStats() {
    const { root } = getEls();
    if (!root) return;

    const sb = getClient();
    if (!sb) {
      setStatus("الخدمة غير جاهزة.");
      setEmpty("تعذر الوصول لخدمة البيانات حالياً.");
      return;
    }

    setStatus("جاري تحميل نسب المصاهرة...");

    const { data, error } = await sb
      .from("tree_spouse_summary")
      .select("wife_is_family_member,wife_branch_key,status")
      .limit(5000);

    if (error) {
      setStatus("تعذر تحميل النسب.");
      setEmpty("تعذر تحميل نسب المصاهرة: " + (error.message || "خطأ"));
      return;
    }

    render(data || []);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => loadPublicAffinityStats().catch(() => {}));
  } else {
    loadPublicAffinityStats().catch(() => {});
  }

  window.AlzidanPublicMarriageStats = { load: loadPublicAffinityStats };
})();
