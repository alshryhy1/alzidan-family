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
      return "وظيفة التنفيذ غير مفعّلة بعد. طبّق ملف COPY-ME ثم أعد المحاولة.";
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

  async function runSql(opts) {
    const confirmMutate = !!(opts && opts.confirmMutate);
    const token = getToken();
    if (!token) {
      setError("سجّل دخول الإدارة أولاً.");
      setStatus("err", "غير مصرح");
      return;
    }
    const sql = String((els.editor && els.editor.value) || "").trim();
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
  };
})();
