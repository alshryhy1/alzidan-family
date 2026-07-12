(function () {
  "use strict";

  let pollsLoadBtn = null;
  let pollsNewBtn = null;
  let pollsListEl = null;
  let pollsForm = null;
  let pollsIdInput = null;
  let pollsQuestionInput = null;
  let pollsDescriptionInput = null;
  let pollsActiveInput = null;
  let pollsEndsAtInput = null;
  let pollsDeleteBtn = null;
  let pollsStatusEl = null;
  let pollsRows = [];
  let isInitialized = false;

  function getClient() {
    const core = window.AlzidanAdminCore || {};
    if (typeof core.getClient === "function") return core.getClient();
    if (window.__alzidanConfig && typeof window.__alzidanConfig.getClient === "function") {
      return window.__alzidanConfig.getClient();
    }
    return window.__alzidanSupabaseClient || null;
  }

  function getAdminToken() {
    const core = window.AlzidanAdminCore || {};
    if (typeof core.getAdminToken === "function") return core.getAdminToken();
    return "";
  }

  function escapeHtml(value) {
    const core = window.AlzidanAdminCore || {};
    if (typeof core.escapeHtml === "function") return core.escapeHtml(value);
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setPollsStatus(text) {
    if (pollsStatusEl) pollsStatusEl.textContent = String(text || "");
  }

  function resetPollsForm() {
    if (pollsIdInput) pollsIdInput.value = "";
    if (pollsQuestionInput) pollsQuestionInput.value = "";
    if (pollsDescriptionInput) pollsDescriptionInput.value = "";
    if (pollsActiveInput) pollsActiveInput.checked = false;
    if (pollsEndsAtInput) pollsEndsAtInput.value = "";
    setPollsStatus("نموذج تصويت جديد.");
  }

  function formatEndsAtLabel(value) {
    if (!value) return "بدون تاريخ انتهاء";
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return String(value).slice(0, 16);
    return d.toLocaleString("ar-SA");
  }

  function toDatetimeLocalValue(value) {
    if (!value) return "";
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return (
      d.getFullYear() +
      "-" +
      pad(d.getMonth() + 1) +
      "-" +
      pad(d.getDate()) +
      "T" +
      pad(d.getHours()) +
      ":" +
      pad(d.getMinutes())
    );
  }

  function renderPollsList() {
    if (!pollsListEl) return;
    pollsListEl.innerHTML = "";
    if (!pollsRows.length) {
      pollsListEl.innerHTML = '<div class="hint">لا توجد تصويتات محفوظة.</div>';
      return;
    }

    pollsRows.forEach((row) => {
      const card = document.createElement("div");
      card.className = "source-tree-item";
      const question = String(row.question || "بدون سؤال");
      const shortQuestion =
        question.length > 90 ? question.slice(0, 90) + "..." : question;
      const support = Number(row.support_count || 0);
      const oppose = Number(row.oppose_count || 0);
      const total = support + oppose;
      const activeLabel = row.is_active ? "نشط" : "غير نشط";
      const ended =
        row.ends_at && Date.parse(row.ends_at) < Date.now() ? " · منتهٍ" : "";

      card.innerHTML =
        "<strong>#" +
        escapeHtml(row.id) +
        " — " +
        escapeHtml(shortQuestion) +
        "</strong>" +
        '<div class="hint">' +
        escapeHtml(activeLabel + ended) +
        " · مؤيد: " +
        escapeHtml(support) +
        " · معارض: " +
        escapeHtml(oppose) +
        " · الإجمالي: " +
        escapeHtml(total) +
        " · انتهاء: " +
        escapeHtml(formatEndsAtLabel(row.ends_at)) +
        "</div>" +
        '<div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">' +
        '<button class="btn btn-outline btn-sm" type="button">تعديل</button>' +
        "</div>";

      const btn = card.querySelector("button");
      if (btn) btn.addEventListener("click", () => fillPollsForm(row));
      pollsListEl.appendChild(card);
    });
  }

  function fillPollsForm(row) {
    if (!row) return;
    if (pollsIdInput) pollsIdInput.value = row.id || "";
    if (pollsQuestionInput) pollsQuestionInput.value = row.question || "";
    if (pollsDescriptionInput) pollsDescriptionInput.value = row.description || "";
    if (pollsActiveInput) pollsActiveInput.checked = row.is_active === true;
    if (pollsEndsAtInput) pollsEndsAtInput.value = toDatetimeLocalValue(row.ends_at);
    setPollsStatus("تعديل التصويت رقم #" + (row.id || ""));
  }

  async function attachVoteCounts(rows) {
    const sb = getClient();
    if (!sb || !Array.isArray(rows) || !rows.length) return rows || [];

    const ids = rows.map((r) => Number(r.id)).filter((id) => id > 0);
    if (!ids.length) return rows;

    const { data: votes, error } = await sb
      .from("family_poll_votes")
      .select("poll_id,vote_value")
      .in("poll_id", ids);

    if (error) return rows;

    const counts = new Map();
    (Array.isArray(votes) ? votes : []).forEach((vote) => {
      const pollId = Number(vote.poll_id);
      if (!pollId) return;
      const bucket = counts.get(pollId) || { support: 0, oppose: 0 };
      if (vote.vote_value === "support") bucket.support += 1;
      else if (vote.vote_value === "oppose") bucket.oppose += 1;
      counts.set(pollId, bucket);
    });

    return rows.map((row) => {
      const c = counts.get(Number(row.id)) || { support: 0, oppose: 0 };
      return Object.assign({}, row, {
        support_count: c.support,
        oppose_count: c.oppose,
      });
    });
  }

  async function loadPollsRows() {
    const sb = getClient();
    if (!sb) {
      setPollsStatus("تعذر الاتصال، حاول لاحقاً أو تواصل مع الإدارة.");
      return;
    }

    setPollsStatus("جاري تحميل التصويتات...");
    const { data, error } = await sb
      .from("family_polls")
      .select("id,question,description,is_active,created_at,ends_at")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      setPollsStatus("تعذر التحميل، حاول لاحقاً أو تواصل مع الإدارة.");
      return;
    }

    pollsRows = await attachVoteCounts(Array.isArray(data) ? data : []);
    renderPollsList();
    setPollsStatus("تم تحميل " + pollsRows.length + " تصويت.");
  }

  async function savePollRow(event) {
    if (event) event.preventDefault();

    const sb = getClient();
    const token = getAdminToken();
    const id = Number(pollsIdInput && pollsIdInput.value ? pollsIdInput.value : 0);
    const question =
      pollsQuestionInput && pollsQuestionInput.value
        ? pollsQuestionInput.value.trim()
        : "";
    const description =
      pollsDescriptionInput && pollsDescriptionInput.value
        ? pollsDescriptionInput.value.trim()
        : "";
    const isActive = pollsActiveInput ? !!pollsActiveInput.checked : false;
    const endsAtRaw =
      pollsEndsAtInput && pollsEndsAtInput.value ? pollsEndsAtInput.value : "";
    const endsAt = endsAtRaw ? new Date(endsAtRaw).toISOString() : null;

    if (!sb || !token) {
      setPollsStatus("سجل الدخول أولاً.");
      return;
    }
    if (!question) {
      setPollsStatus("اكتب سؤال التصويت.");
      return;
    }

    setPollsStatus(id ? "جاري حفظ التصويت..." : "جاري إنشاء التصويت...");

    const row = {
      question: question,
      description: description || null,
      is_active: isActive,
      ends_at: endsAt,
    };
    if (id) row.id = id;

    const { data, error } = await sb.rpc("admin_poll_save_v1", {
      p_token: token,
      p_row: row,
    });

    if (error) {
      const msg = String(error.message || "");
      if (msg.toLowerCase().includes("could not find the function")) {
        setPollsStatus(
          "نفّذ ملف SQL: supabase/sql/admin_polls_and_view_stats.sql في Supabase.",
        );
        return;
      }
      setPollsStatus("تعذر الحفظ، حاول لاحقاً أو تواصل مع الإدارة.");
      return;
    }

    const ok = data && data.ok === true;
    if (!ok) {
      setPollsStatus("تعذر حفظ التصويت. تحقق من البيانات.");
      return;
    }

    if (pollsIdInput && data.id) pollsIdInput.value = String(data.id);
    setPollsStatus("تم حفظ التصويت.");
    await loadPollsRows();
  }

  async function deletePollRow() {
    const sb = getClient();
    const token = getAdminToken();
    const id = Number(pollsIdInput && pollsIdInput.value ? pollsIdInput.value : 0);

    if (!sb || !token) {
      setPollsStatus("سجل الدخول أولاً.");
      return;
    }
    if (!id) {
      setPollsStatus("اختر تصويتاً أولاً.");
      return;
    }

    const ok = window.confirm(
      "سيتم حذف هذا التصويت وجميع أصواته نهائياً. هل أنت متأكد؟",
    );
    if (!ok) return;

    setPollsStatus("جاري حذف التصويت...");
    const { data, error } = await sb.rpc("admin_poll_delete_v1", {
      p_token: token,
      p_id: id,
    });

    if (error) {
      const msg = String(error.message || "");
      if (msg.toLowerCase().includes("could not find the function")) {
        setPollsStatus(
          "نفّذ ملف SQL: supabase/sql/admin_polls_and_view_stats.sql في Supabase.",
        );
        return;
      }
      setPollsStatus("تعذر الحذف، حاول لاحقاً أو تواصل مع الإدارة.");
      return;
    }

    if (!data) {
      setPollsStatus("تعذر حذف التصويت.");
      return;
    }

    resetPollsForm();
    setPollsStatus("تم حذف التصويت.");
    await loadPollsRows();
  }

  function initAdminPolls() {
    if (isInitialized) return;

    pollsLoadBtn = document.getElementById("polls-load");
    pollsNewBtn = document.getElementById("polls-new");
    pollsListEl = document.getElementById("polls-list");
    pollsForm = document.getElementById("polls-form");
    pollsIdInput = document.getElementById("polls-id");
    pollsQuestionInput = document.getElementById("polls-question");
    pollsDescriptionInput = document.getElementById("polls-description");
    pollsActiveInput = document.getElementById("polls-active");
    pollsEndsAtInput = document.getElementById("polls-ends-at");
    pollsDeleteBtn = document.getElementById("polls-delete");
    pollsStatusEl = document.getElementById("polls-status");

    if (pollsLoadBtn) {
      pollsLoadBtn.addEventListener("click", () => loadPollsRows().catch(() => {}));
    }
    if (pollsNewBtn) {
      pollsNewBtn.addEventListener("click", resetPollsForm);
    }
    if (pollsForm) {
      pollsForm.addEventListener("submit", (event) => savePollRow(event).catch(() => {}));
    }
    if (pollsDeleteBtn) {
      pollsDeleteBtn.addEventListener("click", () => deletePollRow().catch(() => {}));
    }

    window.AlzidanAdminPolls = {
      loadPollsRows,
      resetPollsForm,
    };

    isInitialized = true;
  }

  window.AlzidanAdminPollsModule = {
    initAdminPolls,
    loadPollsRows,
  };
})();
