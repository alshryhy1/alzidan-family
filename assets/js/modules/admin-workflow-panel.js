/**
 * Admin Workflow Engine v1 — minimal status panel in Requests module.
 * Reads/writes via admin_workflow_* RPCs only (ADR-010). Not Delegate Workspace.
 */
(() => {
  "use strict";

  const STATE_LABELS = {
    submitted: "مُقدَّم",
    assigned: "مُعيَّن",
    in_review: "قيد المراجعة",
    needs_changes: "يحتاج تعديل",
    approved: "معتمد",
    applied: "مُطبَّق",
    done: "مكتمل",
    rejected: "مرفوض",
  };

  const USER_LABELS = {
    submitted: "تم الإرسال",
    assigned: "وصل للمندوب",
    in_review: "تحت المراجعة",
    needs_changes: "نحتاج معلومة إضافية",
    approved: "تم قبول طلبك",
    applied: "تمت إضافة البيانات",
    done: "اكتمل",
    rejected: "لم يُقبل",
  };

  function core() {
    return window.AlzidanAdminCore || {};
  }

  function getClient() {
    const c = core();
    return typeof c.getClient === "function" ? c.getClient() : null;
  }

  function getToken() {
    const c = core();
    return typeof c.getAdminToken === "function"
      ? String(c.getAdminToken() || "").trim()
      : "";
  }

  function showAlert(kind, msg) {
    const c = core();
    if (typeof c.showAlert === "function") c.showAlert(kind, msg);
  }

  function requestRefFromHash() {
    try {
      const h = String(window.location.hash || "").replace(/^#/, "");
      const params = new URLSearchParams(h);
      return String(params.get("request") || "").trim();
    } catch (_) {
      return "";
    }
  }

  function setHashRequest(requestId) {
    try {
      const url = new URL(window.location.href);
      const params = new URLSearchParams(String(url.hash || "").replace(/^#/, ""));
      params.set("module", "requests");
      if (requestId) params.set("request", requestId);
      else params.delete("request");
      url.hash = params.toString();
      history.replaceState(null, "", url.pathname + url.search + url.hash);
    } catch (_) {}
  }

  function ensurePanel() {
    let panel = document.getElementById("admin-workflow-panel");
    if (panel) return panel;
    const section = document.getElementById("admin-requests-section");
    if (!section) return null;
    const card = section.querySelector(".card");
    if (!card) return null;

    panel = document.createElement("div");
    panel.id = "admin-workflow-panel";
    panel.className = "admin-workflow-panel";
    panel.setAttribute("dir", "rtl");
    panel.innerHTML =
      '<div class="wf-panel-head">' +
      "<strong>محرك السير v1</strong>" +
      '<span class="hint">حالة الطلب من Workflow Engine — ليست شاشة مندوب</span>' +
      "</div>" +
      '<div class="wf-panel-row">' +
      '<div class="field wf-field-ref">' +
      '<label for="wf-request-ref">رقم الطلب</label>' +
      '<input id="wf-request-ref" type="text" placeholder="مثل REQ-… أو المعرّف" autocomplete="off" />' +
      "</div>" +
      '<div class="wf-panel-actions">' +
      '<button type="button" class="btn btn-outline btn-sm" id="wf-btn-load">عرض الحالة</button>' +
      '<button type="button" class="btn btn-outline btn-sm" id="wf-btn-backfill" title="ملء wf_state من الحالة القديمة">تهيئة الحالات</button>' +
      "</div></div>" +
      '<div id="wf-status-box" class="wf-status-box hint">أدخل رقم طلب أو افتح رابطًا عميقًا #module=requests&amp;request=…</div>' +
      '<div id="wf-next-actions" class="wf-next-actions" hidden></div>' +
      '<div id="wf-transition-log" class="wf-transition-log" hidden></div>';

    const summary = document.getElementById("requests-inline-summary");
    if (summary && summary.parentNode === card) {
      card.insertBefore(panel, summary.nextSibling);
    } else {
      card.insertBefore(panel, card.firstChild);
    }
    return panel;
  }

  function stateLabel(code) {
    const k = String(code || "").trim();
    return STATE_LABELS[k] || k || "—";
  }

  function actionButtonLabel(code) {
    const k = String(code || "").trim();
    if (k === "approved") return "قبول";
    if (k === "rejected") return "رفض";
    return stateLabel(k);
  }

  function renderStatus(data) {
    const box = document.getElementById("wf-status-box");
    const actions = document.getElementById("wf-next-actions");
    const logEl = document.getElementById("wf-transition-log");
    if (!box) return;

    if (!data || !data.ok) {
      const code = data && data.code ? String(data.code) : "WF-000";
      box.textContent =
        code === "WF-001"
          ? "الطلب غير موجود."
          : "تعذر قراءة حالة السير (" + code + "). تأكد من تطبيق SQL المحرك.";
      if (actions) {
        actions.hidden = true;
        actions.innerHTML = "";
      }
      if (logEl) {
        logEl.hidden = true;
        logEl.innerHTML = "";
      }
      return;
    }

    const reqType = String(data.request_type || data.kind || "").trim();
    if (reqType === "delegate_secret_reset" || data.dedicated_ui) {
      box.innerHTML =
        '<div class="wf-status-main"><strong>طلب إعادة تعيين الرقم السري</strong></div>' +
        '<div class="hint">هذه نية مستقلة — ليست مسار الشجرة/المناسبات. استخدم أزرار الاعتماد/الرفض في صف الطلب بالجدول.</div>' +
        '<div class="hint">Legacy: ' +
        String(data.legacy_status || "—") +
        " · المندوب: " +
        String(data.name || "—") +
        " · الفرع: " +
        String(data.branch_key || "—") +
        "</div>";
      if (actions) {
        actions.hidden = false;
        actions.innerHTML =
          '<span class="hint">لا انتقالات Workflow عامة لهذا الطلب.</span>';
      }
      if (logEl) {
        logEl.hidden = true;
        logEl.innerHTML = "";
      }
      return;
    }

    const deep = String(data.wf_deep_link || "").trim();
    box.innerHTML =
      '<div class="wf-status-main">' +
      '<span class="status-pill status-wf">' +
      stateLabel(data.wf_state) +
      "</span>" +
      '<span class="hint">· ' +
      (USER_LABELS[data.wf_state] || "") +
      "</span></div>" +
      '<div class="hint">Legacy: ' +
      String(data.legacy_status || "—") +
      " · النوع: " +
      String(data.request_type || data.kind || "—") +
      (data.wf_owner_delegate_id
        ? " · المالك: " + String(data.wf_owner_delegate_id).slice(0, 8) + "…"
        : " · بلا مالك بعد") +
      "</div>" +
      (deep
        ? '<div class="hint">رابط عميق: <code>#' +
          deep.replace(/</g, "") +
          "</code></div>"
        : "");

    loadNextAndBind(String(data.request_id || ""));
    renderLog(Array.isArray(data.transitions) ? data.transitions : []);
  }

  function renderLog(rows) {
    const logEl = document.getElementById("wf-transition-log");
    if (!logEl) return;
    if (!rows.length) {
      logEl.hidden = true;
      logEl.innerHTML = "";
      return;
    }
    logEl.hidden = false;
    const lines = rows
      .slice(0, 8)
      .map((t) => {
        const ok = t.ok === false ? "✗" : "✓";
        return (
          "<li>" +
          ok +
          " " +
          stateLabel(t.from_state) +
          " → " +
          stateLabel(t.to_state) +
          (t.reason ? " — " + String(t.reason) : "") +
          "</li>"
        );
      })
      .join("");
    logEl.innerHTML = "<strong>آخر الانتقالات</strong><ul>" + lines + "</ul>";
  }

  async function rpc(name, args) {
    const sb = getClient();
    if (!sb) return { data: null, error: { message: "no_client" } };
    return sb.rpc(name, args);
  }

  async function loadRequest(ref) {
    const token = getToken();
    const requestRef = String(ref || "").trim();
    if (!token) {
      showAlert("error", "يلزم تسجيل الدخول أولاً.");
      return;
    }
    if (!requestRef) {
      showAlert("error", "أدخل رقم الطلب.");
      return;
    }
    const box = document.getElementById("wf-status-box");
    if (box) box.textContent = "جاري التحميل…";

    const { data, error } = await rpc("admin_workflow_get_v1", {
      p_token: token,
      p_request_ref: requestRef,
    });

    if (error) {
      const msg = String(error.message || "");
      if (/function|does not exist|schema cache/i.test(msg)) {
        renderStatus({ ok: false, code: "WF-SQL" });
        showAlert(
          "error",
          "محرك السير غير مفعّل بعد. طبّق COPY-ME-workflow-engine-v1.sql ثم أعد المحاولة.",
        );
        return;
      }
      renderStatus({ ok: false, code: "WF-RPC" });
      showAlert("error", "تعذر جلب حالة السير.");
      return;
    }

    const row = data && typeof data === "object" ? data : { ok: false };
    renderStatus(row);
    if (row.ok && row.request_id) {
      setHashRequest(row.request_id);
      const input = document.getElementById("wf-request-ref");
      if (input) input.value = row.request_id;
    }
  }

  async function loadNextAndBind(requestId) {
    const actions = document.getElementById("wf-next-actions");
    if (!actions) return;
    const token = getToken();
    const { data, error } = await rpc("admin_workflow_next_states_v1", {
      p_token: token,
      p_request_ref: requestId,
    });
    if (error || !data || !data.ok) {
      actions.hidden = true;
      actions.innerHTML = "";
      return;
    }
    if (data.dedicated_ui || data.intent === "delegate_secret_reset") {
      actions.hidden = false;
      actions.innerHTML =
        '<span class="hint">' +
        String(data.hint_ar || "استخدم بطاقة إعادة تعيين الرقم السري في الجدول.") +
        "</span>";
      return;
    }
    const next = Array.isArray(data.next) ? data.next : [];
    if (!next.length) {
      actions.hidden = false;
      actions.innerHTML = '<span class="hint">لا انتقالات تالية من هذه الحالة.</span>';
      return;
    }

    actions.hidden = false;
    actions.innerHTML =
      '<span class="hint">انتقال إداري:</span> ' +
      next
        .map((s) => {
          const code = String(s);
          return (
            '<button type="button" class="btn btn-outline btn-sm wf-next-btn" data-to="' +
            code +
            '">' +
            actionButtonLabel(code) +
            "</button>"
          );
        })
        .join(" ");

    actions.querySelectorAll(".wf-next-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const to = btn.getAttribute("data-to");
        console.info("ADMIN_RPC workflow transition click", {
          request_id: requestId,
          to_state: to,
        });
        transitionTo(requestId, to).catch(() => {});
      });
    });
  }

  async function transitionTo(requestId, toState) {
    const token = getToken();
    if (!token) {
      showAlert("error", "يلزم تسجيل الدخول أولاً.");
      return;
    }
    let reason = null;
    if (toState === "needs_changes" || toState === "rejected") {
      reason = window.prompt("سبب إلزامي لهذا الانتقال:");
      if (reason == null) return;
      if (!String(reason).trim()) {
        showAlert("error", "السبب مطلوب.");
        return;
      }
    }

    if (toState === "assigned") {
      console.info("ADMIN_RPC admin_workflow_assign_v1 start", requestId);
      const { data, error } = await rpc("admin_workflow_assign_v1", {
        p_token: token,
        p_request_ref: requestId,
        p_delegate_id: null,
      });
      console.info("ADMIN_RPC admin_workflow_assign_v1 done", {
        request_id: requestId,
        ok: !error && data && data.ok,
      });
      if (error) {
        showAlert("error", "تعذر التعيين. هل يوجد مندوب مفعّل لهذا الفرع؟");
        return;
      }
      if (!data || !data.ok) {
        const code = data && data.code ? data.code : "WF";
        showAlert("error", "فشل التعيين (" + code + ").");
        return;
      }
      showAlert("success", "تم التعيين.");
      await loadRequest(requestId);
      return;
    }

    console.info("ADMIN_RPC admin_workflow_transition_v1 start", {
      request_id: requestId,
      to_state: toState,
    });
    const { data, error } = await rpc("admin_workflow_transition_v1", {
      p_token: token,
      p_request_ref: requestId,
      p_to_state: toState,
      p_reason: reason,
      p_owner_delegate_id: null,
    });
    console.info("ADMIN_RPC admin_workflow_transition_v1 done", {
      request_id: requestId,
      to_state: toState,
      ok: !error && data && data.ok,
      code: data && data.code ? data.code : null,
    });
    if (error) {
      showAlert("error", "تعذر تنفيذ الانتقال.");
      return;
    }
    if (!data || !data.ok) {
      const code = data && data.code ? data.code : "WF";
      showAlert("error", "رُفض الانتقال (" + code + ").");
      await loadRequest(requestId);
      return;
    }
    showAlert("success", "تم الانتقال إلى: " + stateLabel(toState));
    await loadRequest(requestId);
  }

  async function runBackfill() {
    const token = getToken();
    if (!token) {
      showAlert("error", "يلزم تسجيل الدخول أولاً.");
      return;
    }
    if (!window.confirm("تهيئة wf_state لكل الطلبات بلا حالة سير؟")) return;
    const { data, error } = await rpc("admin_workflow_backfill_v1", {
      p_token: token,
    });
    if (error) {
      showAlert(
        "error",
        "تعذر التهيئة. طبّق COPY-ME-workflow-engine-v1.sql إن لم يُطبَّق.",
      );
      return;
    }
    const n = data && data.updated != null ? data.updated : "?";
    showAlert("success", "تمت تهيئة " + String(n) + " طلبًا.");
  }

  function bind() {
    const panel = ensurePanel();
    if (!panel || panel.dataset.bound === "1") return;
    panel.dataset.bound = "1";

    const loadBtn = document.getElementById("wf-btn-load");
    const backfillBtn = document.getElementById("wf-btn-backfill");
    const input = document.getElementById("wf-request-ref");

    if (loadBtn) {
      loadBtn.addEventListener("click", () => {
        const ref = input ? input.value : "";
        loadRequest(ref).catch(() => {});
      });
    }
    if (backfillBtn) {
      backfillBtn.addEventListener("click", () => {
        runBackfill().catch(() => {});
      });
    }
    if (input) {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          loadRequest(input.value).catch(() => {});
        }
      });
    }

    // Click request id cells → focus workflow panel
    const body = document.getElementById("requests-body");
    if (body) {
      body.addEventListener("click", (e) => {
        const tr = e.target.closest("tr");
        if (!tr) return;
        const firstTd = tr.querySelector("td");
        if (!firstTd || e.target !== firstTd) return;
        const ref = String(firstTd.textContent || "").trim();
        if (!ref) return;
        if (input) input.value = ref;
        loadRequest(ref).catch(() => {});
      });
    }
  }

  function bootFromHash() {
    const ref = requestRefFromHash();
    if (!ref) return;
    const input = document.getElementById("wf-request-ref");
    if (input) input.value = ref;
    loadRequest(ref).catch(() => {});
  }

  function init() {
    ensurePanel();
    bind();
    bootFromHash();
  }

  window.AlzidanAdminWorkflow = {
    init,
    loadRequest,
    requestRefFromHash,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  document.addEventListener("alzidan:admin-module", (ev) => {
    if (ev && ev.detail && ev.detail.id === "requests") {
      ensurePanel();
      bind();
      bootFromHash();
    }
  });

  window.addEventListener("hashchange", () => {
    if (requestRefFromHash()) bootFromHash();
  });
})();
