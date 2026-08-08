/**
 * SQL Workspace — maintenance module console (admin token gated).
 * Execution only via UI controls; never auto-runs on load.
 */
(function () {
  const HISTORY_KEY = "alzidan_sql_ws_history_v1";
  const HISTORY_MAX = 40;
  const MUTATE_RE =
    /^\s*(UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|INSERT|REPLACE|GRANT|REVOKE|COMMENT|COPY|VACUUM|REINDEX|CLUSTER|CALL|DO)\b/i;

  function getToken() {
    try {
      if (
        window.AlzidanAuth &&
        typeof window.AlzidanAuth.getAdminToken === "function"
      ) {
        const t = String(window.AlzidanAuth.getAdminToken() || "").trim();
        if (t) return t;
      }
    } catch (_) {}
    try {
      const s = String(
        sessionStorage.getItem("alzidan_admin_token_session_v1") || "",
      ).trim();
      if (s) return s;
    } catch (_) {}
    try {
      return String(localStorage.getItem("alzidan_admin_token_v1") || "").trim();
    } catch (_) {
      return "";
    }
  }

  async function invokeRpc(fnName, params, opts) {
    const core = window.AlzidanAdminCore || {};
    if (typeof core.invokeAdminRpc === "function") {
      return core.invokeAdminRpc(fnName, params || {}, opts || {});
    }
    if (typeof window.invokeAdminRpc === "function") {
      return window.invokeAdminRpc(fnName, params || {}, opts || {});
    }
    return {
      data: null,
      error: {
        message: "عميل الإدارة غير جاهز (SQL-WS-001).",
        code: "SQL-WS-001",
      },
    };
  }

  function classifyLocal(sql) {
    const raw = String(sql || "").trim();
    if (!raw) return { empty: true, mutating: false, selectish: false };
    let work = raw.replace(/^\s*--[^\n]*\n?/gm, "").trim();
    work = work.replace(/^\s*\/\*[\s\S]*?\*\//, "").trim();
    const first = (work.match(/^\s*([A-Za-z]+)/) || [])[1] || "";
    const upper = first.toUpperCase();
    const selectish = ["SELECT", "WITH", "SHOW", "EXPLAIN", "VALUES", "TABLE"].includes(
      upper,
    );
    const mutating = MUTATE_RE.test(work);
    return { empty: false, mutating, selectish, first: upper };
  }

  function loadHistory() {
    try {
      const raw = sessionStorage.getItem(HISTORY_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (_) {
      return [];
    }
  }

  function saveHistory(items) {
    try {
      sessionStorage.setItem(
        HISTORY_KEY,
        JSON.stringify((items || []).slice(0, HISTORY_MAX)),
      );
    } catch (_) {}
  }

  function pushHistory(entry) {
    const items = loadHistory();
    items.unshift(entry);
    saveHistory(items);
    renderHistory();
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatTime(iso) {
    try {
      const d = iso ? new Date(iso) : new Date();
      return d.toLocaleString("ar-SA", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        day: "2-digit",
        month: "2-digit",
      });
    } catch (_) {
      return String(iso || "");
    }
  }

  function friendlyRpcError(error, data) {
    if (data && data.message_ar) return String(data.message_ar);
    const code = String((error && error.code) || (data && data.error_code) || "");
    if (code === "PGRST202" || /could not find|schema cache/i.test(String((error && error.message) || ""))) {
      return "وظيفة التنفيذ غير مفعّلة بعد. من أدوات الصيانة شغّل أمر «ترقية منفّذ SQL Workspace» (أو مرة واحدة من Supabase إن رُفض بسبب SQL-WS-MULTI).";
    }
    if (/not allowed|permission|JWT/i.test(String((error && error.message) || ""))) {
      return "غير مصرح. سجّل دخول الإدارة ثم أعد المحاولة.";
    }
    if (code === "ADMIN-RPC-001") {
      return String((error && error.message) || "تعذّر الاتصال بخدمة الإدارة.");
    }
    return "تعذّر تنفيذ الأمر. راجع الصياغة أو الصلاحيات.";
  }

  const els = {};

  function cacheEls() {
    els.root = document.getElementById("sql-workspace-section");
    els.editor = document.getElementById("sql-ws-editor");
    els.editorWrap = document.getElementById("sql-ws-editor-wrap");
    els.run = document.getElementById("sql-ws-run");
    els.copy = document.getElementById("sql-ws-copy");
    els.clear = document.getElementById("sql-ws-clear");
    els.download = document.getElementById("sql-ws-download");
    els.toggleSql = document.getElementById("sql-ws-toggle-sql");
    els.status = document.getElementById("sql-ws-status");
    els.meta = document.getElementById("sql-ws-meta");
    els.error = document.getElementById("sql-ws-error");
    els.results = document.getElementById("sql-ws-results");
    els.history = document.getElementById("sql-ws-history");
  }

  function setStatus(kind, text) {
    if (!els.status) return;
    els.status.className =
      "sql-ws-status" +
      (kind === "ok" ? " is-ok" : kind === "err" ? " is-err" : kind === "busy" ? " is-busy" : "");
    els.status.textContent = text || "";
  }

  function setError(text) {
    if (!els.error) return;
    if (!text) {
      els.error.hidden = true;
      els.error.textContent = "";
      return;
    }
    els.error.hidden = false;
    els.error.textContent = text;
  }

  function setEditorVisible(visible) {
    if (!els.editorWrap) return;
    els.editorWrap.hidden = !visible;
    if (els.toggleSql) {
      els.toggleSql.hidden = visible;
      els.toggleSql.setAttribute("aria-expanded", visible ? "true" : "false");
    }
  }

  function renderResults(rows) {
    if (!els.results) return;
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) {
      els.results.innerHTML =
        '<div class="hint">لا صفوف للعرض (الأمر نُفّذ دون نتيجة جدولية، أو النتيجة فارغة).</div>';
      return;
    }
    const keys = [];
    list.forEach((row) => {
      if (row && typeof row === "object") {
        Object.keys(row).forEach((k) => {
          if (!keys.includes(k)) keys.push(k);
        });
      }
    });
    if (!keys.length) {
      els.results.innerHTML =
        '<div class="hint">تعذّر تفسير صفوف النتيجة.</div>';
      return;
    }
    let html =
      '<div class="table-wrap sql-ws-table-wrap"><table><thead><tr>' +
      keys.map((k) => "<th>" + escapeHtml(k) + "</th>").join("") +
      "</tr></thead><tbody>";
    list.forEach((row) => {
      html += "<tr>";
      keys.forEach((k) => {
        const v = row ? row[k] : "";
        const cell =
          v == null
            ? ""
            : typeof v === "object"
              ? JSON.stringify(v)
              : String(v);
        html += "<td>" + escapeHtml(cell) + "</td>";
      });
      html += "</tr>";
    });
    html += "</tbody></table></div>";
    els.results.innerHTML = html;
  }

  function renderHistory() {
    if (!els.history) return;
    const items = loadHistory();
    if (!items.length) {
      els.history.innerHTML =
        '<div class="hint">لا أوامر بعد. يظهر هنا آخر التنفيذات في هذه الجلسة.</div>';
      return;
    }
    els.history.innerHTML = items
      .map((it, idx) => {
        const ok = !!it.ok;
        return (
          '<button type="button" class="sql-ws-hist-item' +
          (ok ? " is-ok" : " is-fail") +
          '" data-hist-idx="' +
          idx +
          '">' +
          '<span class="sql-ws-hist-time">' +
          escapeHtml(formatTime(it.at)) +
          "</span>" +
          '<span class="sql-ws-hist-badge">' +
          (ok ? "نجاح" : "فشل") +
          "</span>" +
          '<span class="sql-ws-hist-rows">صفوف: ' +
          escapeHtml(String(it.rowCount != null ? it.rowCount : "—")) +
          "</span>" +
          (it.error
            ? '<span class="sql-ws-hist-err">' + escapeHtml(it.error) + "</span>"
            : "") +
          '<span class="sql-ws-hist-preview" dir="ltr">' +
          escapeHtml((it.sql || "").slice(0, 120)) +
          "</span>" +
          "</button>"
        );
      })
      .join("");
  }

  function downloadSql() {
    const sql = String((els.editor && els.editor.value) || "");
    const blob = new Blob([sql], { type: "text/sql;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "alzidan-sql-workspace.sql";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 0);
  }

  async function copySql() {
    const sql = String((els.editor && els.editor.value) || "");
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(sql);
      } else if (els.editor) {
        els.editor.focus();
        els.editor.select();
        document.execCommand("copy");
      }
      setStatus("ok", "تم نسخ أمر SQL");
    } catch (_) {
      setStatus("err", "تعذّر النسخ");
    }
  }

  function clearEditor() {
    if (els.editor) els.editor.value = "";
    if (els.meta) els.meta.textContent = "";
    if (els.results) els.results.innerHTML = "";
    setError("");
    setStatus("", "");
    setEditorVisible(true);
  }

  function readEditorSql() {
    const editor =
      document.getElementById("sql-ws-editor") || els.editor || null;
    if (editor && els.editor !== editor) els.editor = editor;
    return String((editor && editor.value) || "").trim();
  }

  async function runSql(opts) {
    const confirmMutate = !!(opts && opts.confirmMutate);
    const token = getToken();
    if (!token) {
      setError("سجّل دخول الإدارة أولاً.");
      setStatus("err", "غير مصرح");
      return;
    }
    const sql = readEditorSql();
    if (!sql) {
      setError("أدخل أمر SQL أولاً.");
      setStatus("err", "فارغ");
      return;
    }

    const cls = classifyLocal(sql);
    if (cls.mutating && !confirmMutate) {
      const kw = cls.first || "MUTATE";
      const ok = window.confirm(
        "تحذير: الأمر يبدأ بـ " +
          kw +
          " وقد يغيّر البيانات أو المخطط.\n\nهل تريد المتابعة؟",
      );
      if (!ok) {
        setStatus("", "أُلغي التنفيذ");
        return;
      }
      return runSql({ confirmMutate: true });
    }

    setError("");
    setStatus("busy", "جاري التنفيذ…");
    if (els.run) els.run.disabled = true;

    const started = Date.now();
    const { data, error } = await invokeRpc(
      "admin_sql_execute_v1",
      {
        p_token: token,
        p_sql: sql,
        p_confirm_mutate: !!cls.mutating,
      },
      { timeoutMs: 60000 },
    );

    if (els.run) els.run.disabled = false;

    const payload =
      data && typeof data === "object" && !Array.isArray(data) ? data : null;

    if (payload && payload.needs_confirm) {
      const ok = window.confirm(
        String(payload.message_ar || "أمر يغيّر البيانات — هل تؤكد؟"),
      );
      if (!ok) {
        setStatus("", "أُلغي التنفيذ");
        return;
      }
      return runSql({ confirmMutate: true });
    }

    if (error || !payload || payload.ok === false) {
      const msg = friendlyRpcError(error, payload);
      setError(msg);
      setStatus("err", "فشل التنفيذ");
      if (els.meta) {
        const ms =
          (payload && payload.elapsed_ms) != null
            ? payload.elapsed_ms
            : Date.now() - started;
        els.meta.textContent = "المدة: " + ms + " مللي ثانية";
      }
      pushHistory({
        at: new Date().toISOString(),
        ok: false,
        rowCount: null,
        error: msg,
        sql: sql,
      });
      setEditorVisible(true);
      return;
    }

    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const rowCount =
      payload.row_count != null ? Number(payload.row_count) : rows.length;
    const ms =
      payload.elapsed_ms != null ? Number(payload.elapsed_ms) : Date.now() - started;

    setStatus("ok", "✅ تم التنفيذ");
    setError("");
    if (els.meta) {
      els.meta.textContent =
        "المدة: " +
        ms +
        " مللي ثانية · الصفوف المتأثرة/المعروضة: " +
        rowCount +
        (payload.truncated ? " (مقتطع للعرض)" : "");
    }
    renderResults(payload.is_select === false ? [] : rows);
    setEditorVisible(false);
    pushHistory({
      at: new Date().toISOString(),
      ok: true,
      rowCount: rowCount,
      error: "",
      sql: sql,
    });
  }


  function presetsApi() {
    return window.AlzidanSqlPresets || null;
  }

  function renderPresets() {
    const host = document.getElementById("sql-ws-presets");
    const api = presetsApi();
    if (!host || !api) return;
    const done = api.loadDone();
    const items = (api.PRESETS || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    host.innerHTML = items
      .map((p) => {
        const row = done[p.id];
        const ok = !!(row && row.ok);
        return (
          '<div class="sql-ws-preset' +
          (ok ? " is-done" : "") +
          '" data-preset-id="' +
          escapeHtml(p.id) +
          '">' +
          '<div class="sql-ws-preset-main">' +
          '<div class="sql-ws-preset-title">' +
          escapeHtml(p.title) +
          "</div>" +
          '<div class="hint sql-ws-preset-desc">' +
          escapeHtml(p.desc || "") +
          "</div>" +
          '<div class="sql-ws-preset-meta hint">' +
          (ok
            ? '<span class="sql-ws-preset-badge is-done">مُنفذ</span> · ' +
              escapeHtml(formatTime(row.at))
            : '<span class="sql-ws-preset-badge">جاهز للتشغيل</span>') +
          (p.bootstrap ? " · ترقية منفّذ" : "") +
          "</div></div>" +
          '<div class="sql-ws-preset-actions">' +
          '<button type="button" class="btn btn-primary btn-sm" data-preset-run="' +
          escapeHtml(p.id) +
          '">تشغيل</button>' +
          '<button type="button" class="btn btn-outline btn-sm" data-preset-load="' +
          escapeHtml(p.id) +
          '">عرض في المحرر</button>' +
          '<button type="button" class="btn btn-outline btn-sm" data-preset-done="' +
          escapeHtml(p.id) +
          '" title="تعليم يدوي كمُنفذ">' +
          (ok ? "إلغاء مُنفذ" : "تعليم كمُنفذ") +
          "</button>" +
          "</div></div>"
        );
      })
      .join("");
  }

  async function loadPresetIntoEditor(id) {
    const api = presetsApi();
    if (!api) return;
    const p = (api.PRESETS || []).find((x) => x.id === id);
    if (!p) return;
    setStatus("busy", "جاري تحميل الأمر…");
    try {
      const sql = await api.fetchPresetSql(p.file);
      if (els.editor) els.editor.value = sql;
      setEditorVisible(true);
      setStatus("ok", "تم تحميل: " + p.title);
      setError("");
    } catch (e) {
      setStatus("err", "فشل التحميل");
      setError(String((e && e.message) || e));
    }
  }

  async function runPreset(id) {
    const api = presetsApi();
    if (!api) {
      setError("وحدة الأوامر الجاهزة غير محمّلة.");
      return;
    }
    const p = (api.PRESETS || []).find((x) => x.id === id);
    if (!p) return;
    const token = getToken();
    if (!token) {
      setError("سجّل دخول الإدارة أولاً.");
      setStatus("err", "غير مصرح");
      return;
    }
    const okConfirm = window.confirm(
      "تشغيل أمر الصيانة:\n«" +
        p.title +
        "»\n\nسيُنفَّذ على مراحل (أوامر متسلسلة) بعد تأكيد التغيير.\nهل تريد المتابعة؟",
    );
    if (!okConfirm) {
      setStatus("", "أُلغي التشغيل");
      return;
    }

    setError("");
    setStatus("busy", "جاري تحميل SQL…");
    let sql;
    try {
      sql = await api.fetchPresetSql(p.file);
    } catch (e) {
      setStatus("err", "فشل التحميل");
      setError(String((e && e.message) || e));
      return;
    }
    if (els.editor) els.editor.value = sql;
    setEditorVisible(true);

    const stmts = api.splitSqlStatements(sql);
    if (!stmts.length) {
      setStatus("err", "فارغ");
      setError("لم يُعثر على أوامر قابلة للتنفيذ في الملف.");
      return;
    }

    if (els.run) els.run.disabled = true;
    let doneCount = 0;
    for (let i = 0; i < stmts.length; i++) {
      const stmt = stmts[i];
      setStatus(
        "busy",
        "تشغيل متسلسل " + (i + 1) + " / " + stmts.length + "…",
      );
      if (els.editor) els.editor.value = stmt;
      const cls = classifyLocal(stmt);
      const { data, error } = await invokeRpc(
        "admin_sql_execute_v1",
        {
          p_token: token,
          p_sql: stmt,
          p_confirm_mutate: true,
        },
        { timeoutMs: 90000 },
      );
      const payload =
        data && typeof data === "object" && !Array.isArray(data) ? data : null;
      if (error || !payload || payload.ok === false) {
        const msg = friendlyRpcError(error, payload);
        setError(
          "توقف عند الأمر " +
            (i + 1) +
            " / " +
            stmts.length +
            ": " +
            msg +
            (p.bootstrap
              ? " — إن كان الخطأ SQL-WS-MULTI على منفّذ قديم، نفّذ ملف الترقية مرة واحدة من Supabase ثم أعد المحاولة."
              : ""),
        );
        setStatus("err", "فشل متسلسل عند #" + (i + 1));
        if (els.run) els.run.disabled = false;
        renderPresets();
        return;
      }
      doneCount++;
      pushHistory({
        at: new Date().toISOString(),
        ok: true,
        rowCount: payload.row_count,
        error: "",
        sql: stmt,
      });
    }

    if (els.editor) els.editor.value = sql;
    if (els.run) els.run.disabled = false;
    api.markDone(p.id, { statements: doneCount });
    setStatus("ok", "✅ تم تنفيذ الأمر الجاهز (" + doneCount + " أوامر) — مُعلَّم كمُنفذ");
    setError("");
    setEditorVisible(false);
    renderPresets();
  }

  function bindPresets() {
    const host = document.getElementById("sql-ws-presets");
    if (!host || host.dataset.bound === "1") {
      renderPresets();
      return;
    }
    host.dataset.bound = "1";
    host.addEventListener("click", (e) => {
      const runBtn = e.target.closest("[data-preset-run]");
      if (runBtn) {
        runPreset(runBtn.getAttribute("data-preset-run")).catch(() => {});
        return;
      }
      const loadBtn = e.target.closest("[data-preset-load]");
      if (loadBtn) {
        loadPresetIntoEditor(loadBtn.getAttribute("data-preset-load")).catch(
          () => {},
        );
        return;
      }
      const doneBtn = e.target.closest("[data-preset-done]");
      if (doneBtn) {
        const api = presetsApi();
        if (!api) return;
        const id = doneBtn.getAttribute("data-preset-done");
        if (api.isDone(id)) api.clearDone(id);
        else api.markDone(id, { manual: true });
        renderPresets();
      }
    });
    renderPresets();
  }


  function bindToolsNav() {
    if (!els.root) return;
    els.root.querySelectorAll("[data-sql-ws-jump]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-sql-ws-jump");
        const target = id ? document.getElementById(id) : null;
        if (!target) return;
        target.classList.remove("is-collapsed");
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  function bind() {
    cacheEls();
    if (!els.root || els.root.dataset.sqlWsBound === "1") return;
    els.root.dataset.sqlWsBound = "1";

    if (els.run) els.run.addEventListener("click", () => runSql());
    if (els.copy) els.copy.addEventListener("click", () => copySql());
    if (els.clear) els.clear.addEventListener("click", () => clearEditor());
    if (els.download) els.download.addEventListener("click", () => downloadSql());
    if (els.toggleSql) {
      els.toggleSql.addEventListener("click", () => setEditorVisible(true));
    }
    if (els.history) {
      els.history.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-hist-idx]");
        if (!btn) return;
        const idx = Number(btn.getAttribute("data-hist-idx"));
        const items = loadHistory();
        const it = items[idx];
        if (!it || !els.editor) return;
        els.editor.value = it.sql || "";
        setEditorVisible(true);
        setStatus("", "استُعيد من السجل");
      });
    }

    bindToolsNav();
    renderHistory();
    setEditorVisible(true);
    // Keep sample query as real value (not placeholder-only) so Run works on first open.
    if (els.editor && !String(els.editor.value || "").trim()) {
      els.editor.value = "SELECT id, child_name FROM tree_children LIMIT 20;";
    }

    document.addEventListener("alzidan:admin-module", (ev) => {
      if (ev && ev.detail && ev.detail.id === "tools") {
        renderHistory();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }

  window.AlzidanSqlWorkspace = {
    run: runSql,
    refreshHistory: renderHistory,
    renderPresets: renderPresets,
    runPreset: runPreset,
  };
})();
