/**
 * SQL Workspace — daily work queue + execution archive (admin token gated).
 * Successful runs leave the daily screen and live in archive; never auto-run on load.
 */
(function () {
  const LEGACY_HISTORY_KEY = "alzidan_sql_ws_history_v1";
  const QUEUE_KEY = "alzidan_sql_ws_queue_v1";
  const ARCHIVE_KEY = "alzidan_sql_ws_archive_v1";
  const QUEUE_MAX = 60;
  const ARCHIVE_MAX = 200;
  const MUTATE_RE =
    /^\s*(UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|INSERT|REPLACE|GRANT|REVOKE|COMMENT|COPY|VACUUM|REINDEX|CLUSTER|CALL|DO)\b/i;

  let migrated = false;
  let inProgress = null;
  let executorReady = false;
  let bootstrapping = false;
  let multiRetryUsed = false;

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

  function getActorLabel() {
    try {
      const el = document.getElementById("admin-username");
      const name = String((el && el.value) || "").trim();
      if (name) return name;
    } catch (_) {}
    const token = getToken();
    if (token) return "إدارة (" + token.slice(0, 8) + "…)";
    return "إدارة";
  }

  function readLinkedRequestId() {
    const el = document.getElementById("sql-ws-request-id");
    return String((el && el.value) || "").trim();
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

  function loadJsonArray(key, storage) {
    try {
      const raw = storage.getItem(key);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (_) {
      return [];
    }
  }

  function saveJsonArray(key, storage, items, max) {
    try {
      storage.setItem(key, JSON.stringify((items || []).slice(0, max)));
    } catch (_) {}
  }

  function loadQueue() {
    migrateLegacyHistory();
    return loadJsonArray(QUEUE_KEY, localStorage);
  }

  function saveQueue(items) {
    saveJsonArray(QUEUE_KEY, localStorage, items, QUEUE_MAX);
  }

  function loadArchive() {
    migrateLegacyHistory();
    return loadJsonArray(ARCHIVE_KEY, localStorage);
  }

  function saveArchive(items) {
    saveJsonArray(ARCHIVE_KEY, localStorage, items, ARCHIVE_MAX);
  }

  function migrateLegacyHistory() {
    if (migrated) return;
    migrated = true;
    try {
      const legacy = loadJsonArray(LEGACY_HISTORY_KEY, sessionStorage);
      if (!legacy.length) return;
      const queue = loadJsonArray(QUEUE_KEY, localStorage);
      const archive = loadJsonArray(ARCHIVE_KEY, localStorage);
      const seenQ = new Set(queue.map((x) => String(x.id || "") + "|" + String(x.at || "")));
      const seenA = new Set(archive.map((x) => String(x.id || "") + "|" + String(x.at || "")));
      legacy.forEach((it) => {
        const entry = normalizeEntry(it);
        const key = String(entry.id || "") + "|" + String(entry.at || "");
        if (entry.ok) {
          if (!seenA.has(key)) {
            archive.unshift(entry);
            seenA.add(key);
          }
        } else if (!seenQ.has(key)) {
          queue.unshift(entry);
          seenQ.add(key);
        }
      });
      saveJsonArray(QUEUE_KEY, localStorage, queue, QUEUE_MAX);
      saveJsonArray(ARCHIVE_KEY, localStorage, archive, ARCHIVE_MAX);
      try {
        sessionStorage.removeItem(LEGACY_HISTORY_KEY);
      } catch (_) {}
    } catch (_) {}
  }

  function makeId() {
    return "op_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function normalizeEntry(raw) {
    const it = raw && typeof raw === "object" ? raw : {};
    return {
      id: it.id || makeId(),
      at: it.at || new Date().toISOString(),
      ok: !!it.ok,
      status: it.status || (it.ok ? "done" : "failed"),
      rowCount: it.rowCount != null ? it.rowCount : null,
      error: it.error || "",
      sql: it.sql || "",
      title: it.title || "",
      actor: it.actor || "",
      requestId: it.requestId || it.request_id || "",
      version: it.version || "",
      presetId: it.presetId || "",
      auditId: it.auditId != null ? it.auditId : null,
      source: it.source || "editor",
    };
  }

  function pushQueue(entry) {
    const item = normalizeEntry(Object.assign({}, entry, { ok: false, status: entry.status || "failed" }));
    const items = loadQueue().filter((x) => x.id !== item.id);
    items.unshift(item);
    saveQueue(items);
    renderQueue();
    return item;
  }

  function pushArchive(entry) {
    const item = normalizeEntry(
      Object.assign({}, entry, { ok: true, status: "done", archived: true }),
    );
    const items = loadArchive().filter((x) => x.id !== item.id);
    items.unshift(item);
    saveArchive(items);
    // Remove matching failed queue rows for same sql/preset
    const q = loadQueue().filter((x) => {
      if (item.presetId && x.presetId === item.presetId) return false;
      if (item.sql && x.sql === item.sql && !x.ok) return false;
      return x.id !== item.id;
    });
    saveQueue(q);
    renderQueue();
    renderArchive();
    return item;
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
        year: "numeric",
      });
    } catch (_) {
      return String(iso || "");
    }
  }

  function friendlyRpcError(error, data) {
    if (data && data.message_ar) return String(data.message_ar);
    const code = String((error && error.code) || (data && data.error_code) || "");
    if (code === "PGRST202" || /could not find|schema cache/i.test(String((error && error.message) || ""))) {
      return "وظيفة التنفيذ غير مفعّلة بعد. من أدوات الصيانة شغّل أمر «ترقية منفّذ SQL Workspace».";
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
    els.queue = document.getElementById("sql-ws-queue") || document.getElementById("sql-ws-history");
    els.archive = document.getElementById("sql-ws-archive");
    els.cleanLog = document.getElementById("sql-ws-clean-log");
    els.archiveRefresh = document.getElementById("sql-ws-archive-refresh");
    els.requestId = document.getElementById("sql-ws-request-id");
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

  function renderOpCard(it, opts) {
    const o = opts || {};
    const ok = !!it.ok;
    const busy = it.status === "running";
    const badge = busy ? "قيد التنفيذ" : ok ? "مُنفذ" : "فشل — أعد التنفيذ";
    const cls = busy ? " is-busy" : ok ? " is-ok" : " is-fail";
    return (
      '<button type="button" class="sql-ws-hist-item' +
      cls +
      '" data-' +
      (o.archive ? "arch" : "queue") +
      '-id="' +
      escapeHtml(it.id) +
      '">' +
      '<span class="sql-ws-hist-time">' +
      escapeHtml(formatTime(it.at)) +
      "</span>" +
      '<span class="sql-ws-hist-badge">' +
      badge +
      "</span>" +
      (it.title
        ? '<span class="sql-ws-hist-title">' + escapeHtml(it.title) + "</span>"
        : "") +
      (it.actor
        ? '<span class="sql-ws-hist-actor">المنفّذ: ' +
          escapeHtml(it.actor) +
          "</span>"
        : "") +
      (it.requestId
        ? '<span class="sql-ws-hist-req">الطلب: ' +
          escapeHtml(it.requestId) +
          "</span>"
        : "") +
      (it.version
        ? '<span class="sql-ws-hist-ver">النسخة: ' +
          escapeHtml(it.version) +
          "</span>"
        : "") +
      '<span class="sql-ws-hist-rows">صفوف: ' +
      escapeHtml(String(it.rowCount != null ? it.rowCount : "—")) +
      "</span>" +
      (it.error
        ? '<span class="sql-ws-hist-err">' + escapeHtml(it.error) + "</span>"
        : "") +
      '<span class="sql-ws-hist-preview" dir="ltr">' +
      escapeHtml((it.sql || it.title || "").slice(0, 120)) +
      "</span>" +
      "</button>"
    );
  }

  function renderQueue() {
    if (!els.queue) return;
    const items = loadQueue().slice();
    if (inProgress) {
      items.unshift(inProgress);
    }
    if (!items.length) {
      els.queue.innerHTML =
        '<div class="hint">لا أوامر بانتظار التنفيذ. الشاشة اليومية نظيفة — الأوامر الناجحة في الأرشيف.</div>';
      return;
    }
    els.queue.innerHTML = items.map((it) => renderOpCard(it, { archive: false })).join("");
  }

  function archiveFromPresets() {
    const api = presetsApi();
    if (!api || typeof api.listArchivedPresets !== "function") return [];
    return api.listArchivedPresets().map(({ preset, meta }) =>
      normalizeEntry({
        id: "preset_" + preset.id,
        at: meta.at,
        ok: true,
        status: "done",
        title: preset.title,
        actor: meta.actor || "",
        requestId: meta.requestId || "",
        version: preset.id,
        presetId: preset.id,
        sql: "",
        rowCount: meta.statements != null ? meta.statements : null,
        source: "preset",
      }),
    );
  }

  function renderArchive() {
    if (!els.archive) return;
    const local = loadArchive();
    const fromPresets = archiveFromPresets();
    const byKey = new Map();
    fromPresets.concat(local).forEach((it) => {
      const key = it.presetId
        ? "p:" + it.presetId
        : it.id || "a:" + it.at + ":" + (it.sql || "").slice(0, 40);
      if (!byKey.has(key)) byKey.set(key, it);
    });
    const items = Array.from(byKey.values()).sort((a, b) =>
      String(b.at || "").localeCompare(String(a.at || "")),
    );
    if (!items.length) {
      els.archive.innerHTML =
        '<div class="hint">الأرشيف فارغ بعد. بعد نجاح أي تنفيذ يظهر هنا مع التاريخ والمنفّذ.</div>';
      return;
    }
    els.archive.innerHTML = items.map((it) => renderOpCard(it, { archive: true })).join("");
  }

  async function refreshArchiveFromAudit() {
    const token = getToken();
    if (!token) {
      setStatus("err", "سجّل دخول الإدارة لاستعراض سجل التدقيق");
      return;
    }
    setStatus("busy", "جاري جلب سجل التدقيق…");
    const { data, error } = await invokeRpc(
      "admin_audit_log_list_v1",
      { p_token: token, p_entity_type: "sql_workspace", p_limit: 80 },
      { timeoutMs: 30000 },
    );
    if (error) {
      setStatus("err", "تعذّر جلب سجل التدقيق");
      renderArchive();
      return;
    }
    const rows = Array.isArray(data) ? data : [];
    const archive = loadArchive();
    const seen = new Set(archive.map((x) => "audit:" + String(x.auditId || "")));
    rows.forEach((row) => {
      const payload = row && row.payload && typeof row.payload === "object" ? row.payload : {};
      if (!payload.ok) return;
      const auditId = row.id;
      if (seen.has("audit:" + String(auditId))) return;
      archive.push(
        normalizeEntry({
          id: "audit_" + auditId,
          at: row.created_at,
          ok: true,
          actor: row.actor_ref || "إدارة",
          requestId: payload.request_id || payload.requestId || "",
          version: payload.first_keyword || "sql.execute",
          sql: payload.sql_preview || "",
          rowCount: payload.row_count,
          auditId: auditId,
          source: "audit",
          title: "تنفيذ SQL (تدقيق)",
        }),
      );
      seen.add("audit:" + String(auditId));
    });
    archive.sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
    saveArchive(archive);
    setStatus("ok", "تم دمج سجل التدقيق في الأرشيف");
    renderArchive();
  }

  function cleanLogToArchive() {
    const queue = loadQueue();
    const keep = [];
    let moved = 0;
    queue.forEach((it) => {
      if (it && (it.ok || it.status === "done")) {
        pushArchive(it);
        moved++;
      } else {
        keep.push(it);
      }
    });
    // Also ensure all done presets stay archived-only (already filtered in UI)
    saveQueue(keep);
    renderQueue();
    renderArchive();
    renderPresets();
    setStatus(
      "ok",
      moved
        ? "تم نقل " + moved + " عملية منجزة إلى الأرشيف (بدون حذف)"
        : "لا عمليات منجزة في شاشة العمل — الأرشيف لم يتغيّر",
    );
  }

  async function closeLinkedRequest(requestId, atIso) {
    const rid = String(requestId || "").trim();
    if (!rid) return { ok: false, skipped: true };
    const token = getToken();
    if (!token) return { ok: false, error: "لا رمز إدارة" };
    const core = window.AlzidanAdminCore || {};
    const id =
      typeof core.coerceRpcId === "function" ? core.coerceRpcId(rid) : rid;
    const { data, error } = await invokeRpc(
      "admin_set_request_status_v2",
      { p_token: token, p_id: id, p_status: "approved" },
      { timeoutMs: 30000 },
    );
    if (error || data === false) {
      return {
        ok: false,
        error: (error && error.message) || "تعذّر إغلاق الطلب المرتبط",
      };
    }
    const when = formatTime(atIso || new Date().toISOString());
    return {
      ok: true,
      message: "تم تنفيذ أمر الصيانة بنجاح بتاريخ " + when,
    };
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

  async function probeExecutorReady(token) {
    // Probe without any raw ';' in the SQL text (old executor rejects those).
    const probe =
      "SELECT position(chr(59) in public.admin_sql_sql_without_literals_v1(" +
      "chr(36)||chr(36)||'BEGIN NULL'||chr(59)||' END'||chr(36)||chr(36))) AS n";
    const { data, error } = await invokeRpc(
      "admin_sql_execute_v1",
      { p_token: token, p_sql: probe, p_confirm_mutate: false },
      { timeoutMs: 30000 },
    );
    const payload =
      data && typeof data === "object" && !Array.isArray(data) ? data : null;
    if (error || !payload || payload.ok === false) {
      return { ready: false, reason: "probe_failed" };
    }
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const n =
      rows[0] && rows[0].n != null ? Number(rows[0].n) : Number.NaN;
    return { ready: n === 0, reason: n === 0 ? "ok" : "stripper_broken" };
  }

  async function runExecutorBootstrap(token) {
    if (bootstrapping) {
      return { ok: false, error: "ترقية المنفّذ قيد التنفيذ بالفعل" };
    }
    bootstrapping = true;
    try {
      const api = presetsApi();
      if (!api || typeof api.fetchPresetSql !== "function") {
        return { ok: false, error: "وحدة الأوامر الجاهزة غير محمّلة" };
      }
      setStatus("busy", "جاري ترقية منفّذ SQL Workspace…");
      const sql = await api.fetchPresetSql(
        "../supabase/sql/20260809_sql_workspace_executor_bootstrap.sql",
      );
      const stmts = api.splitSqlStatements(sql);
      if (!stmts.length) {
        return { ok: false, error: "ملف ترقية المنفّذ فارغ" };
      }
      for (let i = 0; i < stmts.length; i++) {
        setStatus(
          "busy",
          "ترقية المنفّذ " + (i + 1) + " / " + stmts.length + "…",
        );
        const { data, error } = await invokeRpc(
          "admin_sql_execute_v1",
          {
            p_token: token,
            p_sql: stmts[i],
            p_confirm_mutate: true,
          },
          { timeoutMs: 90000 },
        );
        const payload =
          data && typeof data === "object" && !Array.isArray(data)
            ? data
            : null;
        if (error || !payload || payload.ok === false) {
          const code = String(
            (payload && payload.error_code) || (error && error.code) || "",
          );
          return {
            ok: false,
            error:
              "فشلت ترقية المنفّذ عند الخطوة " +
              (i + 1) +
              ": " +
              friendlyRpcError(error, payload) +
              (code ? " [" + code + "]" : ""),
            step: i + 1,
          };
        }
      }
      executorReady = true;
      if (typeof api.markDone === "function") {
        api.markDone("maint.sql_workspace_literal_aware_v1", {
          bootstrap: true,
          actor: getActorLabel(),
          version: "executor_bootstrap_v1",
          archived: true,
        });
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    } finally {
      bootstrapping = false;
    }
  }

  async function ensureExecutorReady(token, opts) {
    const force = !!(opts && opts.force);
    if (executorReady && !force) {
      return { ok: true, skipped: true };
    }
    const probe = await probeExecutorReady(token);
    if (probe.ready) {
      executorReady = true;
      return { ok: true, skipped: true };
    }
    return runExecutorBootstrap(token);
  }

  function isMultiError(payload, error) {
    const code = String(
      (payload && payload.error_code) || (error && error.code) || "",
    );
    const msg = String(
      (payload && payload.message_ar) ||
        (error && error.message) ||
        "",
    );
    return (
      code === "SQL-WS-MULTI" ||
      /SQL-WS-MULTI|أمر واحد فقط/i.test(msg)
    );
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

    const requestId = readLinkedRequestId();
    const actor = getActorLabel();
    const opId = makeId();
    inProgress = normalizeEntry({
      id: opId,
      at: new Date().toISOString(),
      ok: false,
      status: "running",
      sql: sql,
      actor: actor,
      requestId: requestId,
      version: cls.first || "SQL",
      source: "editor",
      title: "أمر من المحرر",
    });
    renderQueue();

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
      inProgress = null;
      renderQueue();
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
      if (isMultiError(payload, error) && !multiRetryUsed) {
        multiRetryUsed = true;
        setStatus("busy", "المنفّذ قديم — جاري الترقية ثم إعادة المحاولة…");
        const up = await ensureExecutorReady(token, { force: true });
        if (up.ok) {
          if (els.run) els.run.disabled = false;
          inProgress = null;
          return runSql({ confirmMutate: true });
        }
        setError(up.error || "تعذّرت ترقية المنفّذ");
      }
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
      inProgress = null;
      pushQueue({
        id: opId,
        at: new Date().toISOString(),
        ok: false,
        status: "failed",
        rowCount: null,
        error: msg,
        sql: sql,
        actor: actor,
        requestId: requestId,
        version: cls.first || "SQL",
        source: "editor",
        title: "أمر من المحرر",
        auditId: payload && payload.audit_id,
      });
      setEditorVisible(true);
      return;
    }

    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const rowCount =
      payload.row_count != null ? Number(payload.row_count) : rows.length;
    const ms =
      payload.elapsed_ms != null ? Number(payload.elapsed_ms) : Date.now() - started;
    const at = new Date().toISOString();

    inProgress = null;
    pushArchive({
      id: opId,
      at: at,
      ok: true,
      rowCount: rowCount,
      error: "",
      sql: sql,
      actor: actor,
      requestId: requestId,
      version: cls.first || "SQL",
      source: "editor",
      title: "أمر من المحرر",
      auditId: payload.audit_id,
    });

    let statusMsg = "✅ تم التنفيذ — نُقل إلى الأرشيف";
    if (requestId) {
      const closed = await closeLinkedRequest(requestId, at);
      if (closed.ok) {
        statusMsg = closed.message;
      } else if (!closed.skipped) {
        statusMsg =
          "✅ تم التنفيذ وأُرشف — تعذّر إغلاق الطلب: " +
          (closed.error || "");
      }
    }

    setStatus("ok", statusMsg);
    setError("");
    if (els.meta) {
      els.meta.textContent =
        "المدة: " +
        ms +
        " مللي ثانية · الصفوف المتأثرة/المعروضة: " +
        rowCount +
        (payload.truncated ? " (مقتطع للعرض)" : "") +
        " · المنفّذ: " +
        actor;
    }
    renderResults(payload.is_select === false ? [] : rows);
    setEditorVisible(false);
  }

  const FALLBACK_PRESETS = [
    {
      id: "maint.sql_workspace_literal_aware_v1",
      title: "ترقية منفّذ SQL Workspace (أجسام الدوال)",
      desc: "يصلح SQL-WS-MULTI من داخل المساحة ثم يسمح بـ CREATE FUNCTION.",
      file: "../supabase/sql/20260809_sql_workspace_executor_bootstrap.sql",
      order: 10,
      bootstrap: true,
    },
    {
      id: "maint.fix_delegate_portal_path_v1",
      title: "إصلاح دخول المندوب بعد القبول (بوابة 1)",
      desc: "تفعيل/مزامنة delegates_v2 عند اعتماد طلب مندوب + request_id في check_*.",
      file: "../supabase/sql/COPY-ME-fix-delegate-portal-path.sql",
      order: 20,
    },
    {
      id: "maint.delegate_secret_reset_v1",
      title: "طلب إعادة تعيين الرقم السري (واجهة مخصصة)",
      desc: "نية منفصلة delegate_secret_reset + اعتماد/رفض يحدّثون الرقم السري.",
      file: "../supabase/sql/COPY-ME-delegate-secret-reset.sql",
      order: 30,
    },
  ];

  function ensurePresetsApi() {
    if (window.AlzidanSqlPresets && Array.isArray(window.AlzidanSqlPresets.PRESETS)) {
      return window.AlzidanSqlPresets;
    }
    // Fallback catalog so the Workspace never looks like "editor only".
    const DONE_KEY = "alzidan_sql_ws_presets_done_v1";
    const FAIL_KEY = "alzidan_sql_ws_presets_fail_v1";
    function loadMap(key) {
      try {
        const raw = localStorage.getItem(key);
        const obj = raw ? JSON.parse(raw) : {};
        return obj && typeof obj === "object" ? obj : {};
      } catch (_) {
        return {};
      }
    }
    function saveMap(key, map) {
      try {
        localStorage.setItem(key, JSON.stringify(map || {}));
      } catch (_) {}
    }
    const api = {
      PRESETS: FALLBACK_PRESETS.slice(),
      loadDone: function () { return loadMap(DONE_KEY); },
      loadFail: function () { return loadMap(FAIL_KEY); },
      isDone: function (id) {
        const row = loadMap(DONE_KEY)[id];
        return !!(row && row.ok);
      },
      getFail: function (id) { return loadMap(FAIL_KEY)[id] || null; },
      markDone: function (id, meta) {
        const map = loadMap(DONE_KEY);
        map[id] = Object.assign({ at: new Date().toISOString(), ok: true, archived: true }, meta || {});
        saveMap(DONE_KEY, map);
        const fails = loadMap(FAIL_KEY);
        if (fails[id]) { delete fails[id]; saveMap(FAIL_KEY, fails); }
      },
      markFail: function (id, meta) {
        const map = loadMap(FAIL_KEY);
        map[id] = Object.assign({ at: new Date().toISOString(), ok: false }, meta || {});
        saveMap(FAIL_KEY, map);
      },
      clearDone: function (id) {
        const map = loadMap(DONE_KEY);
        delete map[id];
        saveMap(DONE_KEY, map);
      },
      clearFail: function (id) {
        const map = loadMap(FAIL_KEY);
        delete map[id];
        saveMap(FAIL_KEY, map);
      },
      listActivePresets: function () {
        return api.PRESETS.filter(function (p) { return !api.isDone(p.id); })
          .sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
      },
      listArchivedPresets: function () {
        const done = api.loadDone();
        return api.PRESETS.filter(function (p) { return !!(done[p.id] && done[p.id].ok); })
          .map(function (p) { return { preset: p, meta: done[p.id] }; });
      },
      splitSqlStatements: function (sql) {
        // Minimal splitter: prefer full module when loaded.
        return String(sql || "").split(/;\s*\n/).map(function (s) { return s.trim(); }).filter(Boolean);
      },
      fetchPresetSql: async function (file) {
        const url = new URL(file, window.location.href).toString();
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) {
          throw new Error("تعذّر تحميل ملف SQL (" + res.status + ").");
        }
        return await res.text();
      },
      DONE_KEY: DONE_KEY,
      FAIL_KEY: FAIL_KEY,
      _fallback: true,
    };
    window.AlzidanSqlPresets = api;
    return api;
  }

  function presetsApi() {
    return ensurePresetsApi();
  }

  function renderPresets() {
    const host = document.getElementById("sql-ws-presets");
    const countEl = document.getElementById("sql-ws-presets-count");
    if (!host) return;
    const api = presetsApi();
    const items =
      typeof api.listActivePresets === "function"
        ? api.listActivePresets()
        : (api.PRESETS || []).filter(function (p) { return !api.isDone(p.id); });
    const archivedN =
      typeof api.listArchivedPresets === "function"
        ? api.listArchivedPresets().length
        : 0;
    if (countEl) {
      countEl.textContent =
        (items.length ? items.length + " بانتظار التنفيذ" : "لا أوامر معلّقة") +
        (archivedN ? " · " + archivedN + " في الأرشيف" : "");
    }
    if (!items.length) {
      host.innerHTML =
        '<div class="hint">لا أوامر صيانة بانتظار التنفيذ الآن. الأوامر المُنفَّذة في «سجل التنفيذ / الأرشيف» أدناه — أو ألغِ «مُنفذ» من الأرشيف إن احتجت إعادة تشغيل.</div>';
      return;
    }
    host.innerHTML = items
      .map(function (p) {
        const fail = typeof api.getFail === "function" ? api.getFail(p.id) : null;
        return (
          '<div class="sql-ws-preset' +
          (fail ? " is-fail" : "") +
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
          (fail
            ? '<span class="sql-ws-preset-badge is-fail">فشل — أعد التنفيذ</span> · ' +
              escapeHtml(formatTime(fail.at)) +
              (fail.error
                ? " · " + escapeHtml(String(fail.error).slice(0, 80))
                : "")
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
          '" title="تعليم يدوي كمُنفذ ونقله للأرشيف">تعليم كمُنفذ</button>' +
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

    if (!p.bootstrap) {
      const up = await ensureExecutorReady(token);
      if (!up.ok) {
        setError(up.error || "تعذّرت ترقية منفّذ SQL Workspace");
        setStatus("err", "المنفّذ غير جاهز");
        return;
      }
      if (!up.skipped) {
        setStatus("ok", "تم ترقية المنفّذ — متابعة الأمر…");
        renderPresets();
      }
    }

    const requestId = readLinkedRequestId();
    const actor = getActorLabel();
    const opId = makeId();
    inProgress = normalizeEntry({
      id: opId,
      at: new Date().toISOString(),
      ok: false,
      status: "running",
      title: p.title,
      presetId: p.id,
      actor: actor,
      requestId: requestId,
      version: p.id,
      source: "preset",
    });
    renderQueue();

    setError("");
    setStatus("busy", "جاري تحميل SQL…");
    let sql;
    try {
      sql = await api.fetchPresetSql(p.file);
    } catch (e) {
      inProgress = null;
      const msg = String((e && e.message) || e);
      if (typeof api.markFail === "function") {
        api.markFail(p.id, { error: msg, actor: actor, requestId: requestId });
      }
      pushQueue({
        id: opId,
        at: new Date().toISOString(),
        ok: false,
        status: "failed",
        title: p.title,
        presetId: p.id,
        error: msg,
        actor: actor,
        requestId: requestId,
        version: p.id,
        source: "preset",
      });
      setStatus("err", "فشل التحميل");
      setError(msg);
      renderPresets();
      return;
    }
    if (els.editor) els.editor.value = sql;
    setEditorVisible(true);

    const stmts = api.splitSqlStatements(sql);
    if (!stmts.length) {
      inProgress = null;
      setStatus("err", "فارغ");
      setError("لم يُعثر على أوامر قابلة للتنفيذ في الملف.");
      renderQueue();
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
      if (inProgress) {
        inProgress = Object.assign({}, inProgress, {
          title: p.title + " (" + (i + 1) + "/" + stmts.length + ")",
        });
        renderQueue();
      }
      if (els.editor) els.editor.value = stmt;
      let { data, error } = await invokeRpc(
        "admin_sql_execute_v1",
        {
          p_token: token,
          p_sql: stmt,
          p_confirm_mutate: true,
        },
        { timeoutMs: 90000 },
      );
      let payload =
        data && typeof data === "object" && !Array.isArray(data) ? data : null;
      if (error || !payload || payload.ok === false) {
        if (isMultiError(payload, error) && !p.bootstrap) {
          setStatus(
            "busy",
            "SQL-WS-MULTI — ترقية المنفّذ ثم إعادة الخطوة " +
              (i + 1) +
              "…",
          );
          const up = await ensureExecutorReady(token, { force: true });
          if (up.ok) {
            const retry = await invokeRpc(
              "admin_sql_execute_v1",
              {
                p_token: token,
                p_sql: stmt,
                p_confirm_mutate: true,
              },
              { timeoutMs: 90000 },
            );
            const retryPayload =
              retry.data &&
              typeof retry.data === "object" &&
              !Array.isArray(retry.data)
                ? retry.data
                : null;
            if (!retry.error && retryPayload && retryPayload.ok !== false) {
              doneCount++;
              continue;
            }
            error = retry.error;
            payload = retryPayload;
          }
        }
        const msg = friendlyRpcError(error, payload);
        inProgress = null;
        if (typeof api.markFail === "function") {
          api.markFail(p.id, {
            error: msg,
            actor: actor,
            requestId: requestId,
            atStep: i + 1,
          });
        }
        pushQueue({
          id: opId,
          at: new Date().toISOString(),
          ok: false,
          status: "failed",
          title: p.title,
          presetId: p.id,
          error:
            "توقف عند الأمر " + (i + 1) + " / " + stmts.length + ": " + msg,
          sql: stmt,
          actor: actor,
          requestId: requestId,
          version: p.id,
          source: "preset",
          auditId: payload && payload.audit_id,
        });
        setError(
          "توقف عند الأمر " +
            (i + 1) +
            " / " +
            stmts.length +
            ": " +
            msg,
        );
        setStatus("err", "فشل متسلسل عند #" + (i + 1));
        if (els.run) els.run.disabled = false;
        renderPresets();
        return;
      }
      doneCount++;
    }

    if (els.editor) els.editor.value = sql;
    if (els.run) els.run.disabled = false;
    const at = new Date().toISOString();
    inProgress = null;
    api.markDone(p.id, {
      statements: doneCount,
      actor: actor,
      requestId: requestId,
      version: p.id,
      archived: true,
    });
    pushArchive({
      id: opId,
      at: at,
      ok: true,
      rowCount: doneCount,
      title: p.title,
      presetId: p.id,
      actor: actor,
      requestId: requestId,
      version: p.id,
      source: "preset",
      sql: sql.slice(0, 400),
    });

    let statusMsg =
      "✅ تم تنفيذ الأمر الجاهز (" + doneCount + " أوامر) — نُقل إلى الأرشيف";
    if (requestId) {
      const closed = await closeLinkedRequest(requestId, at);
      if (closed.ok) {
        statusMsg = closed.message;
      } else if (!closed.skipped) {
        statusMsg =
          statusMsg + " · تعذّر إغلاق الطلب: " + (closed.error || "");
      }
    }

    setStatus("ok", statusMsg);
    setError("");
    setEditorVisible(false);
    renderPresets();
    renderQueue();
    renderArchive();
  }

  function restoreFromEntry(it) {
    if (!it || !els.editor) return;
    if (it.sql) {
      els.editor.value = it.sql;
      setEditorVisible(true);
      setStatus("", "استُعيد من السجل");
      return;
    }
    if (it.presetId) {
      loadPresetIntoEditor(it.presetId).catch(() => {});
    }
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
        const p = (api.PRESETS || []).find((x) => x.id === id);
        api.markDone(id, {
          manual: true,
          actor: getActorLabel(),
          requestId: readLinkedRequestId(),
          version: id,
          archived: true,
        });
        pushArchive({
          id: makeId(),
          at: new Date().toISOString(),
          ok: true,
          title: (p && p.title) || id,
          presetId: id,
          actor: getActorLabel(),
          requestId: readLinkedRequestId(),
          version: id,
          source: "preset",
          sql: "",
        });
        renderPresets();
        renderArchive();
        setStatus("ok", "عُلّم كمُنفذ ونُقل إلى الأرشيف");
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
    if (els.cleanLog) {
      els.cleanLog.addEventListener("click", () => cleanLogToArchive());
    }
    if (els.archiveRefresh) {
      els.archiveRefresh.addEventListener("click", () => {
        refreshArchiveFromAudit().catch(() => {});
      });
    }
    if (els.queue) {
      els.queue.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-queue-id]");
        if (!btn) return;
        const id = btn.getAttribute("data-queue-id");
        const items = loadQueue();
        const it =
          (inProgress && inProgress.id === id ? inProgress : null) ||
          items.find((x) => x.id === id);
        restoreFromEntry(it);
      });
    }
    if (els.archive) {
      els.archive.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-arch-id]");
        if (!btn) return;
        const id = btn.getAttribute("data-arch-id");
        const items = loadArchive().concat(archiveFromPresets());
        const it = items.find((x) => x.id === id);
        restoreFromEntry(it);
      });
    }

    bindToolsNav();
    bindPresets();
    renderQueue();
    renderArchive();
    setEditorVisible(true);
    if (els.editor && !String(els.editor.value || "").trim()) {
      els.editor.value = "SELECT id, child_name FROM tree_children LIMIT 20;";
    }

    document.addEventListener("alzidan:admin-module", (ev) => {
      if (ev && ev.detail && ev.detail.id === "tools") {
        renderQueue();
        renderArchive();
        renderPresets();
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
    refreshHistory: renderQueue,
    refreshQueue: renderQueue,
    refreshArchive: renderArchive,
    cleanLog: cleanLogToArchive,
    renderPresets: renderPresets,
    runPreset: runPreset,
  };
})();
