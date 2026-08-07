/**
 * Delegates v2 — Phase 2 foundation (admin module)
 * List / enable-disable / role display + audit trail.
 * Falls back to legacy approval_requests when SQL not applied yet.
 */
(function () {
  "use strict";

  const ROLE_TITLES = {
    viewer: "عرض فقط",
    branch_editor: "محرر فرع",
    events_editor: "محرر مناسبات",
    full_delegate: "مندوب كامل",
    approver_l1: "معتمد مرحلة 1",
  };

  let state = {
    mode: "v2", // v2 | legacy | missing_sql
    rows: [],
    roles: [],
    audit: [],
    busy: false,
    loadedOnce: false,
  };

  function core() {
    return window.AlzidanAdminCore || {};
  }

  function getToken() {
    const c = core();
    if (typeof c.getAdminToken === "function") {
      return String(c.getAdminToken() || "").trim();
    }
    return "";
  }

  async function rpc(fnName, params, opts) {
    const c = core();
    if (typeof c.invokeAdminRpc === "function") {
      return c.invokeAdminRpc(fnName, params || {}, opts || {});
    }
    const sb = typeof c.getClient === "function" ? c.getClient() : null;
    if (!sb || typeof sb.rpc !== "function") {
      return {
        data: null,
        error: { message: "عميل الإدارة غير جاهز", code: "ADMIN-RPC-001" },
      };
    }
    return sb.rpc(fnName, params || {});
  }

  function showAlert(type, msg) {
    const c = core();
    if (typeof c.showAlert === "function") c.showAlert(type, msg);
  }

  function hideAlert() {
    const c = core();
    if (typeof c.hideAlert === "function") c.hideAlert();
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function roleTitle(key, fallback) {
    const k = String(key || "").trim();
    return (
      ROLE_TITLES[k] ||
      String(fallback || "").trim() ||
      k ||
      "—"
    );
  }

  function buildKey(branch, phone, email) {
    return [
      String(branch || "").trim(),
      String(phone || "").trim(),
      String(email || "").trim().toLowerCase(),
    ].join("|");
  }

  function ensurePanel() {
    let section = document.getElementById("admin-module-delegates");
    if (!section) {
      const host =
        document.getElementById("admin-protected-sections") ||
        document.querySelector(".page");
      if (!host) return null;
      section = document.createElement("section");
      section.id = "admin-module-delegates";
      section.className = "section admin-only-section";
      section.setAttribute("data-admin-module", "delegates");
      host.appendChild(section);
    }
    section.classList.remove("admin-module-stub");
    if (section.dataset.delegatesV2Ready === "1") return section;

    section.innerHTML =
      '<div class="section-header"><div>' +
      '<div class="section-title">المندوبون — Delegates v2</div>' +
      '<div class="hint">أساس المرحلة 2: قائمة المندوبين، الدور/الفرع، تفعيل وتعطيل، وسجل تدقيق إداري.</div>' +
      "</div></div>" +
      '<div class="card delegates-v2-card">' +
      '<div class="delegates-v2-toolbar">' +
      '<button type="button" class="btn btn-primary btn-sm" id="delegates-v2-refresh">تحديث القائمة</button>' +
      '<button type="button" class="btn btn-outline btn-sm" id="delegates-v2-sync">مزامنة من الطلبات القديمة</button>' +
      '<button type="button" class="btn btn-outline btn-sm" data-go-module="audit">مركز السجل (تعديلات المناديب)</button>' +
      '<button type="button" class="btn btn-outline btn-sm" data-go-module="requests">طلبات المناديب</button>' +
      "</div>" +
      '<div id="delegates-v2-status" class="hint" style="margin: 10px 0;"></div>' +
      '<div id="delegates-v2-sql-hint" class="delegates-v2-sql-hint" hidden></div>' +
      '<div class="table-wrap" aria-label="قائمة المندوبين">' +
      '<table class="delegates-v2-table" style="min-width: 920px;">' +
      "<thead><tr>" +
      "<th>المندوب</th><th>الفرع</th><th>الدور</th><th>الحالة</th><th>تواصل</th><th>إجراءات</th>" +
      "</tr></thead>" +
      '<tbody id="delegates-v2-body"></tbody>' +
      "</table></div>" +
      '<div class="delegates-v2-audit-block">' +
      "<h3>سجل تدقيق الإدارة (Delegates v2)</h3>" +
      '<div id="delegates-v2-audit-status" class="hint"></div>' +
      '<div class="table-wrap"><table style="min-width: 720px;"><thead><tr>' +
      "<th>الوقت</th><th>الإجراء</th><th>الفرع</th><th>التفاصيل</th>" +
      '</tr></thead><tbody id="delegates-v2-audit-body"></tbody></table></div>' +
      "</div></div>";

    section.addEventListener("click", (e) => {
      const go = e.target.closest("[data-go-module]");
      if (go && window.AlzidanAdminShell && typeof window.AlzidanAdminShell.navigate === "function") {
        window.AlzidanAdminShell.navigate(go.getAttribute("data-go-module"));
        return;
      }
      const toggle = e.target.closest("[data-delegate-toggle]");
      if (toggle) {
        const id = toggle.getAttribute("data-delegate-toggle");
        const enabled = toggle.getAttribute("data-enabled") === "1";
        setEnabled(id, !enabled);
        return;
      }
      const roleSel = e.target.closest("select[data-delegate-role]");
      if (roleSel) return;
    });

    section.addEventListener("change", (e) => {
      const sel = e.target.closest("select[data-delegate-role]");
      if (!sel) return;
      setRole(sel.getAttribute("data-delegate-role"), sel.value);
    });

    const refreshBtn = section.querySelector("#delegates-v2-refresh");
    const syncBtn = section.querySelector("#delegates-v2-sync");
    if (refreshBtn) refreshBtn.addEventListener("click", () => loadAll({ force: true }));
    if (syncBtn) syncBtn.addEventListener("click", syncFromLegacy);

    section.dataset.delegatesV2Ready = "1";
    return section;
  }

  function setStatus(text) {
    const el = document.getElementById("delegates-v2-status");
    if (el) el.textContent = text || "";
  }

  function setSqlHint(show, message) {
    const el = document.getElementById("delegates-v2-sql-hint");
    if (!el) return;
    if (!show) {
      el.hidden = true;
      el.innerHTML = "";
      return;
    }
    el.hidden = false;
    el.innerHTML =
      "<strong>يلزم تطبيق SQL مرة واحدة:</strong> " +
      esc(message || "شغّل ملف supabase/sql/20260808_delegates_v2_foundation.sql في SQL Editor.") +
      " حتى ذلك الحين تُعرض قائمة مبسّطة من الطلبات القديمة.";
  }

  function isMissingFn(err) {
    const msg = String(
      (err && (err.message || err.details || err.hint)) || err || "",
    ).toLowerCase();
    return (
      msg.includes("could not find") ||
      msg.includes("does not exist") ||
      msg.includes("schema cache") ||
      msg.includes("pgrst202") ||
      msg.includes("42883")
    );
  }

  function inferRoleFromCaps(treeStatus, eventsStatus) {
    const t = String(treeStatus || "") === "approved";
    const e = String(eventsStatus || "") === "approved";
    if (t && e) return "full_delegate";
    if (e && !t) return "events_editor";
    if (t) return "branch_editor";
    return "viewer";
  }

  async function loadLegacyFallback() {
    const token = getToken();
    const treeRes = await rpc("admin_list_requests", {
      p_token: token,
      p_status: null,
      p_kind: "tree_delegate",
      p_limit: 2000,
    });
    if (treeRes.error) throw treeRes.error;
    const eventsRes = await rpc("admin_list_requests", {
      p_token: token,
      p_status: null,
      p_kind: "events_delegate",
      p_limit: 2000,
    });
    if (eventsRes.error) throw eventsRes.error;

    const pickLatest = (a, b) => {
      if (!a) return b || null;
      if (!b) return a || null;
      return String(b.created_at || "").localeCompare(String(a.created_at || "")) > 0
        ? b
        : a;
    };
    const map = new Map();
    (Array.isArray(treeRes.data) ? treeRes.data : []).forEach((r) => {
      const key = buildKey(r.branch_key, r.phone, r.email);
      if (!key || key === "||") return;
      const cur = map.get(key) || { tree: null, events: null };
      cur.tree = pickLatest(cur.tree, r);
      map.set(key, cur);
    });
    (Array.isArray(eventsRes.data) ? eventsRes.data : []).forEach((r) => {
      const key = buildKey(r.branch_key, r.phone, r.email);
      if (!key || key === "||") return;
      const cur = map.get(key) || { tree: null, events: null };
      cur.events = pickLatest(cur.events, r);
      map.set(key, cur);
    });

    state.mode = "legacy";
    state.rows = Array.from(map.entries()).map(([key, caps]) => {
      const src = caps.tree || caps.events || {};
      const role = inferRoleFromCaps(
        caps.tree && caps.tree.status,
        caps.events && caps.events.status,
      );
      const enabled =
        (caps.tree && caps.tree.status === "approved") ||
        (caps.events && caps.events.status === "approved");
      return {
        id: key,
        legacy: true,
        branch_key: src.branch_key,
        name: src.name,
        phone: src.phone,
        email: src.email,
        role_key: role,
        role_title_ar: roleTitle(role),
        is_enabled: !!enabled,
        _caps: caps,
      };
    });
    state.audit = [];
  }

  async function loadV2() {
    const token = getToken();
    const listRes = await rpc("admin_delegates_v2_list_v1", {
      p_token: token,
      p_limit: 500,
    });
    if (listRes.error) {
      if (isMissingFn(listRes.error)) {
        state.mode = "missing_sql";
        setSqlHint(true);
        await loadLegacyFallback();
        return;
      }
      throw listRes.error;
    }
    state.mode = "v2";
    setSqlHint(false);
    state.rows = Array.isArray(listRes.data) ? listRes.data : [];

    const rolesRes = await rpc("admin_delegate_roles_list_v1", { p_token: token });
    if (!rolesRes.error && Array.isArray(rolesRes.data)) {
      state.roles = rolesRes.data;
    }

    const auditRes = await rpc("admin_audit_log_list_v1", {
      p_token: token,
      p_entity_type: "delegates_v2",
      p_limit: 80,
    });
    if (!auditRes.error && Array.isArray(auditRes.data)) {
      state.audit = auditRes.data;
    } else {
      state.audit = [];
    }
  }

  function renderTable() {
    const body = document.getElementById("delegates-v2-body");
    if (!body) return;
    body.innerHTML = "";
    if (!state.rows.length) {
      const tr = document.createElement("tr");
      tr.innerHTML =
        '<td colspan="6" class="hint">لا يوجد مندوبون بعد. اضغط «مزامنة من الطلبات القديمة» بعد تطبيق SQL، أو اعتمد مناديب من موديول الطلبات.</td>';
      body.appendChild(tr);
      return;
    }

    state.rows.forEach((row) => {
      const tr = document.createElement("tr");
      const enabled = !!row.is_enabled;
      const id = String(row.id || "");
      let roleCell;
      if (state.mode === "v2" && state.roles.length) {
        const opts = state.roles
          .map((r) => {
            const sel =
              String(r.role_key) === String(row.role_key) ? " selected" : "";
            return (
              '<option value="' +
              esc(r.role_key) +
              '"' +
              sel +
              ">" +
              esc(r.title_ar || r.role_key) +
              "</option>"
            );
          })
          .join("");
        roleCell =
          '<select class="delegates-v2-role" data-delegate-role="' +
          esc(id) +
          '"' +
          (state.busy ? " disabled" : "") +
          ">" +
          opts +
          "</select>";
      } else {
        roleCell = esc(roleTitle(row.role_key, row.role_title_ar));
      }

      const contact = [row.phone, row.email].filter(Boolean).map(esc).join(" · ") || "—";
      tr.innerHTML =
        "<td><strong>" +
        esc(row.name || "مندوب") +
        "</strong></td>" +
        "<td>" +
        esc(row.branch_key || "—") +
        "</td>" +
        "<td>" +
        roleCell +
        "</td>" +
        '<td><span class="delegates-v2-pill ' +
        (enabled ? "is-on" : "is-off") +
        '">' +
        (enabled ? "مفعّل" : "معطّل") +
        "</span></td>" +
        "<td>" +
        contact +
        "</td>" +
        "<td>" +
        '<button type="button" class="btn btn-outline btn-sm" data-delegate-toggle="' +
        esc(id) +
        '" data-enabled="' +
        (enabled ? "1" : "0") +
        '"' +
        (state.busy ? " disabled" : "") +
        ">" +
        (enabled ? "تعطيل" : "تفعيل") +
        "</button></td>";
      body.appendChild(tr);
    });
  }

  function renderAudit() {
    const body = document.getElementById("delegates-v2-audit-body");
    const st = document.getElementById("delegates-v2-audit-status");
    if (!body) return;
    body.innerHTML = "";
    if (state.mode !== "v2") {
      if (st)
        st.textContent =
          "سجل التدقيق الإداري يظهر بعد تطبيق SQL الأساس (admin_audit_log).";
      return;
    }
    if (!state.audit.length) {
      if (st) st.textContent = "لا سجلات بعد — تظهر عند التفعيل/التعطيل/تغيير الدور.";
      return;
    }
    if (st) st.textContent = "آخر " + String(state.audit.length) + " إجراء.";
    const c = core();
    state.audit.forEach((row) => {
      const tr = document.createElement("tr");
      let when = String(row.created_at || "");
      try {
        if (typeof c.formatDateTimeArSaVerbose === "function" && row.created_at) {
          when = c.formatDateTimeArSaVerbose(row.created_at);
        }
      } catch (_) {}
      let details = "";
      try {
        details = row.payload ? JSON.stringify(row.payload) : "";
      } catch (_) {
        details = String(row.payload || "");
      }
      tr.innerHTML =
        "<td>" +
        esc(when) +
        "</td><td>" +
        esc(row.action_key || "") +
        "</td><td>" +
        esc(row.branch_key || "—") +
        "</td><td><code class=\"delegates-v2-code\">" +
        esc(details) +
        "</code></td>";
      body.appendChild(tr);
    });
  }

  async function loadAll(opts) {
    ensurePanel();
    const token = getToken();
    if (!token) {
      setStatus("سجّل دخول الإدارة لعرض المندوبين.");
      return;
    }
    if (state.busy) return;
    state.busy = true;
    setStatus("جاري التحميل...");
    try {
      await loadV2();
      const n = state.rows.length;
      const modeLabel =
        state.mode === "v2"
          ? "Delegates v2"
          : "وضع مؤقت (طلبات قديمة)";
      setStatus("عدد المندوبين: " + String(n) + " — " + modeLabel);
      renderTable();
      renderAudit();
      state.loadedOnce = true;
    } catch (err) {
      console.error("delegates_v2_load", err);
      setStatus("تعذر تحميل المندوبين.");
      showAlert(
        "error",
        "تعذر تحميل المندوبين حالياً، حاول لاحقاً أو تواصل مع الإدارة.",
      );
    } finally {
      state.busy = false;
    }
  }

  async function syncFromLegacy() {
    const token = getToken();
    if (!token) {
      showAlert("error", "سجّل الدخول أولاً.");
      return;
    }
    hideAlert();
    state.busy = true;
    setStatus("جاري المزامنة من approval_requests...");
    try {
      const res = await rpc("admin_delegates_v2_sync_from_requests_v1", {
        p_token: token,
      });
      if (res.error) {
        if (isMissingFn(res.error)) {
          setSqlHint(true);
          showAlert(
            "error",
            "طبّق أولاً ملف SQL: supabase/sql/20260808_delegates_v2_foundation.sql",
          );
          return;
        }
        showAlert("error", "تعذرت المزامنة حالياً.");
        return;
      }
      const upserted =
        res.data && typeof res.data === "object"
          ? Number(res.data.upserted || 0)
          : 0;
      showAlert("success", "تمت المزامنة. عدد السجلات: " + String(upserted));
      state.busy = false;
      await loadAll({ force: true });
    } catch (err) {
      console.error("delegates_v2_sync", err);
      showAlert("error", "تعذرت المزامنة.");
    } finally {
      state.busy = false;
    }
  }

  async function setEnabledLegacy(row, enabled) {
    const token = getToken();
    const caps = row._caps || {};
    const status = enabled ? "approved" : "rejected";
    const targets = [];
    if (caps.tree && caps.tree.id != null) targets.push(caps.tree.id);
    if (caps.events && caps.events.id != null) targets.push(caps.events.id);
    if (!targets.length && enabled) {
      showAlert(
        "error",
        "لا توجد صفوف صلاحية قديمة لهذا المندوب. طبّق SQL ثم زامِن.",
      );
      return;
    }
    for (const rawId of targets) {
      const c = core();
      const id =
        typeof c.coerceRpcId === "function" ? c.coerceRpcId(rawId) : rawId;
      const { error } = await rpc("admin_set_request_status_v2", {
        p_token: token,
        p_id: id,
        p_status: status,
      });
      if (error) throw error;
    }
  }

  async function setEnabled(id, enabled) {
    const token = getToken();
    if (!token || state.busy) return;
    const row = state.rows.find((r) => String(r.id) === String(id));
    if (!row) return;
    const label = enabled ? "تفعيل" : "تعطيل";
    if (!window.confirm("تأكيد " + label + " المندوب؟")) return;
    hideAlert();
    state.busy = true;
    try {
      if (state.mode === "v2" && !row.legacy) {
        const { error } = await rpc("admin_delegates_v2_set_enabled_v1", {
          p_token: token,
          p_id: id,
          p_enabled: !!enabled,
        });
        if (error) throw error;
      } else {
        await setEnabledLegacy(row, enabled);
      }
      showAlert("success", "تم " + label + " المندوب.");
      state.busy = false;
      await loadAll({ force: true });
    } catch (err) {
      console.error("delegates_v2_set_enabled", err);
      showAlert("error", "تعذر تحديث حالة المندوب.");
    } finally {
      state.busy = false;
    }
  }

  async function setRole(id, roleKey) {
    const token = getToken();
    if (!token || state.mode !== "v2" || state.busy) return;
    hideAlert();
    state.busy = true;
    try {
      const { error } = await rpc("admin_delegates_v2_set_role_v1", {
        p_token: token,
        p_id: id,
        p_role_key: roleKey,
      });
      if (error) throw error;
      showAlert("success", "تم تحديث دور المندوب.");
      state.busy = false;
      await loadAll({ force: true });
    } catch (err) {
      console.error("delegates_v2_set_role", err);
      showAlert("error", "تعذر تحديث الدور.");
      state.busy = false;
      renderTable();
    }
  }

  function onModule(e) {
    const id = e && e.detail && e.detail.id;
    if (id === "delegates") {
      ensurePanel();
      loadAll();
    }
  }

  function boot() {
    ensurePanel();
    document.addEventListener("alzidan:admin-module", onModule);
    const obs = new MutationObserver(() => {
      if (
        document.body.classList.contains("admin-authenticated") &&
        window.AlzidanAdminShell &&
        typeof window.AlzidanAdminShell.getCurrent === "function" &&
        window.AlzidanAdminShell.getCurrent() === "delegates" &&
        !state.loadedOnce
      ) {
        loadAll();
      }
    });
    obs.observe(document.body, { attributes: true, attributeFilter: ["class"] });

    window.AlzidanDelegatesV2 = {
      refresh: () => loadAll({ force: true }),
      sync: syncFromLegacy,
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
