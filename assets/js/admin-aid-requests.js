(() => {
  "use strict";

  let rowsCache = [];
  let loading = false;
  let bound = false;

  function getAdminToken() {
    if (window.AlzidanAuth && typeof window.AlzidanAuth.getAdminToken === "function") {
      return String(window.AlzidanAuth.getAdminToken() || "").trim();
    }
    return "";
  }

  function getClient() {
    if (window.AlzidanAdminCore && typeof window.AlzidanAdminCore.getClient === "function") {
      return window.AlzidanAdminCore.getClient();
    }
    if (window.__alzidanConfig && typeof window.__alzidanConfig.getClient === "function") {
      return window.__alzidanConfig.getClient();
    }
    return window.__alzidanSupabaseClient || null;
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setStatus(text, isError) {
    const el = document.getElementById("admin-aid-status");
    if (!el) return;
    el.textContent = text || "";
    el.style.color = isError ? "#991b1b" : "";
  }

  function statusLabel(status) {
    const s = String(status || "").toLowerCase();
    if (s === "pending") return "بانتظار";
    if (s === "published") return "منشور";
    if (s === "closed") return "مغلق";
    if (s === "declined") return "مرفوض";
    return status || "—";
  }

  function whatsAppUrl(phone) {
    let d = String(phone || "").replace(/\D/g, "");
    if (!d) return "";
    if (d.length === 9 && d.startsWith("5")) d = "966" + d;
    if (d.startsWith("0") && d.length === 10) d = "966" + d.slice(1);
    return "https://wa.me/" + d;
  }

  function renderTable(rows) {
    const body = document.getElementById("admin-aid-body");
    const countEl = document.getElementById("admin-aid-count");
    if (!body) return;
    const filter = String((document.getElementById("admin-aid-filter") || {}).value || "all");
    const list = (rows || []).filter((r) => {
      if (filter === "all") return true;
      return String(r.status || "") === filter;
    });
    if (countEl) {
      countEl.textContent =
        "الكل: " +
        String((rows || []).length) +
        " · المعروض: " +
        String(list.length) +
        " · بانتظار: " +
        String((rows || []).filter((r) => r.status === "pending").length);
    }
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="7" class="hint">لا طلبات مطابقة.</td></tr>';
      return;
    }
    body.innerHTML = list
      .map((row) => {
        const phone = String(row.contact_phone || row.member_phone || "").trim();
        const wa = whatsAppUrl(phone);
        const nameCell = row.hide_name
          ? esc(row.member_name || "—") + ' <span class="hint">(مخفي عند النشر)</span>'
          : esc(row.member_name || "—");
        const phoneCell = phone
          ? esc(phone) +
            (wa
              ? ' <a class="btn btn-outline btn-sm" href="' +
                esc(wa) +
                '" target="_blank" rel="noopener">واتساب</a>'
              : "")
          : "—";
        const actions =
          '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
          (row.status !== "published"
            ? '<button type="button" class="btn btn-primary btn-sm" data-aid-act="published" data-aid-id="' +
              esc(String(row.id)) +
              '">اعتماد ونشر</button>'
            : "") +
          (row.status === "published"
            ? '<button type="button" class="btn btn-outline btn-sm" data-aid-act="closed" data-aid-id="' +
              esc(String(row.id)) +
              '">إغلاق</button>'
            : "") +
          (row.status === "pending"
            ? '<button type="button" class="btn btn-outline btn-sm" data-aid-act="declined" data-aid-id="' +
              esc(String(row.id)) +
              '">رفض</button>'
            : "") +
          "</div>";
        return (
          "<tr>" +
          "<td>#" +
          esc(String(row.id)) +
          "<div class=\"hint\">" +
          esc(statusLabel(row.status)) +
          "</div></td>" +
          "<td>" +
          nameCell +
          "<div class=\"hint\">" +
          esc(row.situation_label || row.situation || "") +
          (row.branch_key ? " · " + esc(row.branch_key) : "") +
          "</div></td>" +
          '<td dir="ltr">' +
          phoneCell +
          "</td>" +
          "<td>" +
          esc(row.need_text || "") +
          "</td>" +
          "<td>" +
          esc(row.public_title || "—") +
          "</td>" +
          "<td>" +
          esc(row.publish_contact_note || "صندوق العائلة / تواصل الإدارة") +
          "</td>" +
          "<td>" +
          actions +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  async function loadRows() {
    if (loading) return;
    if (!getAdminToken()) {
      setStatus("سجّل دخول الإدارة أولاً.", true);
      rowsCache = [];
      renderTable([]);
      return;
    }
    const sb = getClient();
    if (!sb) {
      setStatus("تعذر الاتصال بقاعدة البيانات.", true);
      return;
    }
    loading = true;
    setStatus("جاري التحميل…");
    try {
      const res = await sb.rpc("admin_aid_requests_list_v1", { p_token: getAdminToken() });
      if (res.error) throw res.error;
      const data = res.data || {};
      if (data.ok === false) {
        throw new Error(data.error === "not_allowed" ? "غير مصرح" : data.error || "خطأ");
      }
      rowsCache = Array.isArray(data.rows) ? data.rows : [];
      renderTable(rowsCache);
      setStatus("النشر للعامة بلا اسم. المساعدة عبر صندوق العائلة — لا تنشر حساباً باسم المستفيدة.");
    } catch (error) {
      console.error(error);
      const msg = error && error.message ? String(error.message) : "خطأ";
      if (/could not find the function|schema cache|PGRST202/i.test(msg)) {
        setStatus(
          "نفّذ SQL: supabase/sql/COPY-ME-family-aid-requests-v1.sql ثم حدّث الصفحة.",
          true,
        );
      } else {
        setStatus("تعذر التحميل: " + msg, true);
      }
      rowsCache = [];
      renderTable([]);
    } finally {
      loading = false;
    }
  }

  async function setStatusAction(id, status) {
    if (!getAdminToken()) {
      setStatus("سجّل دخول الإدارة أولاً.", true);
      return;
    }
    const sb = getClient();
    if (!sb) return;
    const row = rowsCache.find((r) => Number(r.id) === Number(id)) || {};
    const defaultTitle =
      status === "published"
        ? "طلب مساعدة معتمد — " + String(row.situation_label || "للعائلة")
        : null;
    const note =
      status === "published"
        ? window.prompt(
            "ملاحظة التواصل للعامة (صندوق العائلة / واتساب الإدارة):",
            String(
              row.publish_contact_note ||
                "للتقديم: تواصل مع إدارة العائلة. التحويل عبر صندوق العائلة — وليس باسم المستفيدة.",
            ),
          )
        : null;
    if (status === "published" && note === null) return;

    setStatus("جاري الحفظ…");
    try {
      const res = await sb.rpc("admin_aid_request_set_status_v1", {
        p_token: getAdminToken(),
        p_id: Number(id),
        p_status: status,
        p_admin_note: null,
        p_public_title: defaultTitle,
        p_public_body: status === "published" ? String(row.need_text || "") : null,
        p_publish_contact_note: status === "published" ? String(note || "").trim() : null,
      });
      if (res.error) throw res.error;
      if (res.data && res.data.ok === false) {
        throw new Error(res.data.error || "فشل الحفظ");
      }
      await loadRows();
      setStatus(
        status === "published"
          ? "نُشر للعامة بلا اسم. المساعدة عبر الملاحظة المعروضة."
          : "تم تحديث الحالة.",
      );
    } catch (error) {
      console.error(error);
      setStatus("تعذر التحديث: " + (error && error.message ? error.message : "خطأ"), true);
    }
  }

  function bind() {
    if (bound) return;
    bound = true;
    const reload = document.getElementById("admin-aid-reload");
    if (reload) reload.addEventListener("click", () => loadRows().catch(() => {}));
    const filter = document.getElementById("admin-aid-filter");
    if (filter) filter.addEventListener("change", () => renderTable(rowsCache));
    const body = document.getElementById("admin-aid-body");
    if (body) {
      body.addEventListener("click", (ev) => {
        const btn = ev.target && ev.target.closest ? ev.target.closest("[data-aid-act]") : null;
        if (!btn) return;
        const id = btn.getAttribute("data-aid-id");
        const act = btn.getAttribute("data-aid-act");
        if (!id || !act) return;
        setStatusAction(id, act).catch(() => {});
      });
    }
    document.addEventListener("alzidan:admin-module", (ev) => {
      const id = ev && ev.detail ? String(ev.detail.id || "") : "";
      if (id === "giving" && getAdminToken()) {
        loadRows().catch(() => {});
      }
    });
  }

  function init() {
    if (!document.getElementById("admin-aid-requests-section")) return;
    bind();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.AlzidanAdminAidRequests = { load: loadRows };
})();
