/**
 * SQL Workspace — daily work queue + execution archive (admin token gated).
 * Daily screen = current command state only (pending/failed/running).
 * Attempt history lives in archive/audit and must never contradict current state.
 * Successful runs leave the daily screen and live in archive; never auto-run on load.
 */
(function () {
  const LEGACY_HISTORY_KEY = "alzidan_sql_ws_history_v1";
  const QUEUE_KEY = "alzidan_sql_ws_queue_v1";
  const ARCHIVE_KEY = "alzidan_sql_ws_archive_v1";
  /** One-shot flag: collapse historical fail spam in localStorage. */
  const DAILY_COLLAPSE_FLAG = "alzidan_sql_ws_daily_collapse_v4";
  const QUEUE_MAX = 60;
  const ARCHIVE_MAX = 200;
  const MUTATE_RE =
    /^\s*(UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|INSERT|REPLACE|GRANT|REVOKE|COMMENT|COPY|VACUUM|REINDEX|CLUSTER|CALL|DO)\b/i;
  /** All free-editor attempts share one daily card (never a failure history). */
  const EDITOR_COMMAND_KEY = "editor:last";
  const EDITOR_DAILY_ID = "daily_editor_last";
  const EDITOR_DAILY_TITLE = "آخر محاولة محرر";
  /** Retired pg_proc bootstrap — never load/run as a maintenance path. */
  const RETIRED_BOOTSTRAP_IDS = {
    "maint.sql_workspace_executor_bootstrap_v1": true,
    "maint.sql_workspace_literal_aware_v1": true,
  };
  const RETIRED_MSG_AR =
    "متقاعد — لا يُشغَّل. استخدم COPY-ME-admin-sql-workspace-run-v2.sql في Supabase مرة إن لزم، أو بطاقة تثبيت v2";
  const V2_BLOCK_CARD_AR =
    "تثبيت v2 مطلوب — الصق مرة واحدة في Supabase: supabase/sql/COPY-ME-admin-sql-workspace-run-v2.sql ثم شغّل بطاقة «تثبيت منفّذ SQL Workspace v2».";

  let migrated = false;
  let dailyCollapsed = false;
  let inProgress = null;
  /** Preset id last loaded into the editor (SSOT link for editor runs). */
  let activeEditorPresetId = "";
  /** True when admin_sql_workspace_run_v2 is callable. */
  let executorReady = false;
  let bootstrapping = false;
  let multiRetryUsed = false;
  /** True after we un-archived false «تعليم كمُنفذ» because v2 is missing. */
  let v2InstallRequiredBanner = false;
  const V2_RPC = "admin_sql_workspace_run_v2";
  const V1_RPC = "admin_sql_execute_v1";
  const V2_INSTALL_FILE = "../supabase/sql/COPY-ME-admin-sql-workspace-run-v2.sql";
  const V2_PRESET_ID = "maint.sql_workspace_run_v2";
  const V2_SUPABASE_HINT =
    "المنفّذ الحالي (v1) يرفض أكثر من أمر. الصق ملف COPY-ME-admin-sql-workspace-run-v2.sql مرة واحدة في Supabase SQL Editor أولًا (CREATE OR REPLACE فقط)، ثم ارجع وشغّل بطاقة «تثبيت منفّذ SQL Workspace v2».";

  function isRetiredPresetId(id) {
    const s = String(id || "").trim();
    if (!s) return false;
    if (RETIRED_BOOTSTRAP_IDS[s]) return true;
    return /executor_bootstrap|literal_aware/i.test(s);
  }

  function isRetiredSql(sql) {
    const s = String(sql || "");
    if (!s.trim()) return false;
    if (/UPDATE\s+pg_proc\b/i.test(s)) return true;
    if (/SQL-WS-RETIRED-PG-PROC/i.test(s)) return true;
    if (/sql_workspace_executor_bootstrap/i.test(s)) return true;
    if (/maint\.sql_workspace_executor_bootstrap_v1/i.test(s)) return true;
    if (/alzidan_ws_prosrc/i.test(s)) return true;
    if (/permission denied for table pg_proc/i.test(s)) return true;
    return false;
  }

  function isRetiredDailyEntry(entry) {
    const it = entry && typeof entry === "object" ? entry : {};
    if (isRetiredPresetId(it.presetId) || isRetiredPresetId(it.version)) {
      return true;
    }
    if (isRetiredSql(it.sql)) return true;
    if (/pg_proc|SQL-WS-RETIRED|42501/i.test(String(it.error || ""))) {
      return true;
    }
    return false;
  }

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
      if (legacy.length) {
        const queue = loadJsonArray(QUEUE_KEY, localStorage);
        const archive = loadJsonArray(ARCHIVE_KEY, localStorage);
        const seenQ = new Set(
          queue.map((x) => String(x.id || "") + "|" + String(x.at || "")),
        );
        const seenA = new Set(
          archive.map((x) => String(x.id || "") + "|" + String(x.at || "")),
        );
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
        saveJsonArray(QUEUE_KEY, localStorage, collapseDailyItems(queue), QUEUE_MAX);
        saveJsonArray(ARCHIVE_KEY, localStorage, archive, ARCHIVE_MAX);
        try {
          sessionStorage.removeItem(LEGACY_HISTORY_KEY);
        } catch (_) {}
      }
    } catch (_) {}
    migrateCollapseDailySpam();
  }

  function knownPresetIdSet() {
    const api = presetsApi();
    const ids = new Set();
    ((api && api.PRESETS) || []).forEach((p) => {
      if (p && p.id) ids.add(String(p.id));
    });
    return ids;
  }

  function isMultiFailMessage(msg) {
    return /SQL-WS-MULTI|أمر واحد فقط|يُسمح بأمر واحد/i.test(String(msg || ""));
  }

  /**
   * Existing localStorage often holds a failure *history* (pre-SSOT).
   * Keep latest row per command key only; drop obsolete presets; one editor card.
   */
  function migrateCollapseDailySpam() {
    if (dailyCollapsed) return;
    dailyCollapsed = true;
    try {
      const flag = localStorage.getItem(DAILY_COLLAPSE_FLAG);
      const queue = loadJsonArray(QUEUE_KEY, localStorage);
      const next = collapseDailyItems(queue).map((it) => {
        if (isMultiFailMessage(it.error)) {
          return Object.assign({}, it, {
            error: V2_SUPABASE_HINT,
          });
        }
        return it;
      });
      const changed =
        flag !== "1" || JSON.stringify(queue) !== JSON.stringify(next);
      if (changed) {
        saveJsonArray(QUEUE_KEY, localStorage, next, QUEUE_MAX);
      }
      // Rewrite stored MULTI fail badges on ready presets (without clearing).
      try {
        const api = presetsApi();
        if (api && typeof api.loadFail === "function" && api.FAIL_KEY) {
          const fails = api.loadFail() || {};
          let fChanged = false;
          Object.keys(fails).forEach((id) => {
            const row = fails[id];
            if (!row) return;
            if (isMultiFailMessage(row.error)) {
              fails[id] = Object.assign({}, row, {
                error: V2_SUPABASE_HINT,
                needs_supabase: true,
              });
              fChanged = true;
            }
          });
          if (fChanged) {
            localStorage.setItem(api.FAIL_KEY, JSON.stringify(fails));
          }
        }
      } catch (_) {}
      try {
        localStorage.setItem(DAILY_COLLAPSE_FLAG, "1");
      } catch (_) {}
      scrubRetiredDailyNoise();
    } catch (_) {}
  }

  /** Rewrite or clear MULTI fail flags so the UI never looks like a retry log. */
  function clearMultiFailNoise() {
    const api = presetsApi();
    if (api && typeof api.loadFail === "function") {
      const fails = api.loadFail() || {};
      let changed = false;
      Object.keys(fails).forEach((id) => {
        const row = fails[id];
        if (!row) return;
        if (executorReady) {
          if (id === V2_PRESET_ID || isMultiFailMessage(row.error)) {
            if (typeof api.clearFail === "function") api.clearFail(id);
            changed = true;
          }
          return;
        }
        if (isMultiFailMessage(row.error) || row.needs_supabase) {
          fails[id] = Object.assign({}, row, {
            error: V2_SUPABASE_HINT,
            needs_supabase: true,
          });
          changed = true;
        }
      });
      if (changed && !executorReady && typeof api.loadFail === "function") {
        try {
          localStorage.setItem(
            api.FAIL_KEY || "alzidan_sql_ws_presets_fail_v1",
            JSON.stringify(fails),
          );
        } catch (_) {}
      }
    }
    const q = loadJsonArray(QUEUE_KEY, localStorage)
      .map((raw) => {
        const it = normalizeEntry(raw);
        if (!executorReady && isMultiFailMessage(it.error)) {
          it.error = V2_SUPABASE_HINT;
        }
        return it;
      })
      .filter((it) => {
        if (!executorReady) return true;
        if (it.presetId === V2_PRESET_ID) return false;
        if (isMultiFailMessage(it.error)) return false;
        return true;
      });
    saveJsonArray(QUEUE_KEY, localStorage, collapseDailyItems(q), QUEUE_MAX);
  }

  function scrubRetiredDailyNoise() {
    const before = loadJsonArray(QUEUE_KEY, localStorage);
    const next = before.filter(function (raw) {
      return !isRetiredDailyEntry(raw);
    });
    if (JSON.stringify(before) !== JSON.stringify(next)) {
      saveJsonArray(QUEUE_KEY, localStorage, collapseDailyItems(next), QUEUE_MAX);
    }
    // Drop obsolete retired preset fail badges.
    try {
      const api = presetsApi();
      if (api && typeof api.loadFail === "function" && typeof api.clearFail === "function") {
        const fails = api.loadFail() || {};
        Object.keys(fails).forEach(function (id) {
          if (isRetiredPresetId(id)) api.clearFail(id);
        });
      }
    } catch (_) {}
  }

  /**
   * Clear leftover pg_proc / bootstrap_v1 editor contents (leave box empty).
   * Returns true when the editor was scrubbed.
   */
  function scrubRetiredEditorContent(opts) {
    const quiet = !!(opts && opts.quiet);
    cacheEls();
    if (!els.editor) return false;
    const sql = String(els.editor.value || "");
    const retiredPreset = isRetiredPresetId(activeEditorPresetId);
    if (!retiredPreset && !isRetiredSql(sql)) return false;
    activeEditorPresetId = "";
    els.editor.value = "";
    setEditorVisible(true);
    if (!quiet) {
      setError(RETIRED_MSG_AR);
      setStatus("err", "متقاعد — لا يُشغَّل");
    } else {
      setError("");
      setStatus("", "أُزيل سكربت متقاعد من المحرر");
    }
    return true;
  }

  function looksLikeFalseArchiveMeta(meta, presetId) {
    const m = meta && typeof meta === "object" ? meta : {};
    if (m.manual) return true;
    if (presetId === V2_PRESET_ID) {
      // Marked done but probe says missing → not really installed.
      return !m.via && !m.already;
    }
    // Maintenance cards that need v2 cannot have succeeded without it.
    if (!m.via && !m.statements && !m.rowCount && !m.bootstrap) return true;
    return false;
  }

  /**
   * If v2 RPC is absent, reverse false «تعليم كمُنفذ» archive marks and
   * force a single blocking install card.
   */
  function reconcileArchiveWithExecutorReady() {
    const api = presetsApi();
    if (!api) return { cleared: [] };
    if (executorReady) {
      v2InstallRequiredBanner = false;
      return { cleared: [] };
    }
    const done =
      typeof api.loadDone === "function" ? api.loadDone() || {} : {};
    const cleared = [];
    Object.keys(done).forEach(function (id) {
      const meta = done[id];
      if (!meta || !meta.ok) return;
      if (!looksLikeFalseArchiveMeta(meta, id) && id !== V2_PRESET_ID) return;
      // Without v2, archived maintenance presets are not trustworthy.
      if (typeof api.clearDone === "function") api.clearDone(id);
      cleared.push(id);
    });
    if (cleared.length) {
      const arch = loadJsonArray(ARCHIVE_KEY, localStorage).filter(function (raw) {
        const it = normalizeEntry(raw);
        if (cleared.indexOf(it.presetId) >= 0) return false;
        if (isRetiredDailyEntry(it)) return false;
        return true;
      });
      saveJsonArray(ARCHIVE_KEY, localStorage, arch, ARCHIVE_MAX);
      v2InstallRequiredBanner = true;
    } else {
      v2InstallRequiredBanner = !executorReady;
    }
    return { cleared: cleared };
  }

  function makeId() {
    return "op_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function normalizeSqlKey(sql) {
    return String(sql || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function sqlSame(a, b) {
    const na = normalizeSqlKey(a);
    const nb = normalizeSqlKey(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    const n = Math.min(na.length, nb.length);
    // Archive may store a truncated preview of the same command.
    return n >= 80 && (na.slice(0, n) === nb.slice(0, n));
  }

  function inferPresetIdFromSql(sql) {
    const s = String(sql || "");
    if (
      /admin_sql_workspace_run_v2/i.test(s) &&
      /create\s+or\s+replace\s+function/i.test(s)
    ) {
      return V2_PRESET_ID;
    }
    if (
      /fix_delegate_portal_path|delegates_v2/i.test(s) &&
      /request_id/i.test(s)
    ) {
      return "maint.fix_delegate_portal_path_v1";
    }
    if (/delegate_secret_reset/i.test(s)) {
      return "maint.delegate_secret_reset_v1";
    }
    return "";
  }

  function resolvePresetId(entry) {
    const it = entry && typeof entry === "object" ? entry : {};
    if (it.presetId) return String(it.presetId);
    if (it.version && String(it.version).indexOf("maint.") === 0) {
      return String(it.version);
    }
    return inferPresetIdFromSql(it.sql) || "";
  }

  /** Stable key: one daily card per command (not per attempt). */
  function commandKey(entry) {
    const presetId = resolvePresetId(entry);
    const known = knownPresetIdSet();
    if (presetId && known.has(presetId)) return "p:" + presetId;
    // Free-editor / unknown / obsolete → single ephemeral daily slot.
    return EDITOR_COMMAND_KEY;
  }

  function normalizeEntry(raw) {
    const it = raw && typeof raw === "object" ? raw : {};
    const presetId = resolvePresetId(it) || it.presetId || "";
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
      version: it.version || presetId || "",
      presetId: presetId,
      auditId: it.auditId != null ? it.auditId : null,
      source: it.source || "editor",
    };
  }

  function isCommandSucceeded(entry) {
    const it = normalizeEntry(entry || {});
    if (it.ok || it.status === "done" || it.archived) return true;
    const api = presetsApi();
    if (
      it.presetId &&
      api &&
      typeof api.isDone === "function" &&
      api.isDone(it.presetId)
    ) {
      return true;
    }
    const arch = loadArchive();
    if (it.presetId && arch.some((a) => a && a.ok && a.presetId === it.presetId)) {
      return true;
    }
    if (it.sql && arch.some((a) => a && a.ok && sqlSame(a.sql, it.sql))) {
      return true;
    }
    return false;
  }

  function clearDailyForCommand(ref) {
    const base = normalizeEntry(ref || {});
    const key = commandKey(base);
    const api = presetsApi();
    if (base.presetId && api && typeof api.clearFail === "function") {
      api.clearFail(base.presetId);
    }
    const q = loadQueue().filter((x) => {
      const row = normalizeEntry(x);
      if (commandKey(row) === key) return false;
      if (base.presetId && row.presetId === base.presetId) return false;
      if (base.sql && row.sql && sqlSame(base.sql, row.sql)) return false;
      return true;
    });
    saveQueue(q);
  }

  /** Collapse many fail attempts into the latest card per command. */
  function collapseDailyItems(items) {
    const byKey = new Map();
    const known = knownPresetIdSet();
    (items || []).forEach((raw) => {
      const it = normalizeEntry(raw);
      if (isCommandSucceeded(it)) return;
      if (it.status === "done" || it.ok) return;
      if (isRetiredDailyEntry(it)) return;
      const presetId = resolvePresetId(it);
      // Drop obsolete maintenance cards that are no longer in the catalog.
      if (presetId && !known.has(presetId)) {
        // Old literal_aware / renamed presets: do not keep a daily ghost card.
        if (
          it.source === "preset" ||
          isRetiredPresetId(presetId) ||
          String(it.title || "").indexOf("literal") >= 0
        ) {
          return;
        }
      }
      const key = commandKey(it);
      if (key === EDITOR_COMMAND_KEY) {
        it.source = "editor";
        it.title = EDITOR_DAILY_TITLE;
        it.presetId = "";
        it.id = EDITOR_DAILY_ID;
      } else if (presetId) {
        it.presetId = presetId;
        it.id = "daily_" + presetId;
      }
      const prev = byKey.get(key);
      if (!prev || String(it.at || "") >= String(prev.at || "")) {
        byKey.set(key, it);
      }
    });
    return Array.from(byKey.values()).sort((a, b) =>
      String(b.at || "").localeCompare(String(a.at || "")),
    );
  }

  function purgeDailySucceeded() {
    const before = loadQueue();
    const next = collapseDailyItems(before);
    if (JSON.stringify(before) !== JSON.stringify(next)) {
      saveQueue(next);
    }
    return next;
  }

  /**
   * Daily SSOT write: update the single current card for this command.
   * Never append a new fail card for every retry.
   */
  function upsertDailyCommand(entry) {
    const item = normalizeEntry(
      Object.assign({}, entry, {
        ok: false,
        status: entry.status || "failed",
      }),
    );
    if (isCommandSucceeded(item)) {
      clearDailyForCommand(item);
      renderQueue();
      return null;
    }
    const key = commandKey(item);
    const others = [];
    let existing = null;
    loadQueue().forEach((x) => {
      const row = normalizeEntry(x);
      if (isCommandSucceeded(row)) return;
      if (commandKey(row) === key) {
        if (!existing || String(row.at || "") >= String(existing.at || "")) {
          existing = row;
        }
        return;
      }
      others.push(row);
    });
    if (existing) item.id = existing.id;
    others.unshift(item);
    saveQueue(collapseDailyItems(others));
    renderQueue();
    return item;
  }

  /**
   * Success SSOT write: archive only + remove from presets daily surfaces.
   * A command must never appear as both executed and failed/pending.
   */
  function recordCommandSuccess(entry) {
    const item = normalizeEntry(
      Object.assign({}, entry, { ok: true, status: "done", archived: true }),
    );
    const api = presetsApi();
    if (item.presetId && api && typeof api.markDone === "function") {
      api.markDone(item.presetId, {
        actor: item.actor,
        requestId: item.requestId,
        version: item.version || item.presetId,
        archived: true,
        statements: item.rowCount,
      });
    }
    const items = loadArchive().filter((x) => {
      if (x.id === item.id) return false;
      // One current archive card per maintenance preset.
      if (item.presetId && x.presetId === item.presetId) return false;
      return true;
    });
    items.unshift(item);
    saveArchive(items);
    clearDailyForCommand(item);
    if (activeEditorPresetId && activeEditorPresetId === item.presetId) {
      activeEditorPresetId = "";
    }
    renderPresets();
    renderQueue();
    renderArchive();
    return item;
  }

  function pushQueue(entry) {
    return upsertDailyCommand(entry);
  }

  function pushArchive(entry) {
    return recordCommandSuccess(entry);
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
    const rawMsg = String(
      (error && error.message) || (data && data.message) || (data && data.message_ar) || "",
    );
    if (
      code === "57014" ||
      /statement timeout|canceling statement/i.test(rawMsg)
    ) {
      return (
        "انتهت مهلة التنفيذ (timeout). إن كان السكربت يحتوي تعليقًا كتليًا /* … */ فأزلْه أو استخدم بطاقة dry-run / APPLY المنفصلتين، أو أعد تثبيت منفّذ v2 المحدَّث ثم أعد المحاولة."
      );
    }
    if (
      code === "PGRST202" ||
      /could not find|schema cache|admin_sql_workspace_run_v2/i.test(rawMsg)
    ) {
      return V2_SUPABASE_HINT;
    }
    if (isMultiFailMessage(rawMsg) || code === "SQL-WS-MULTI") {
      return V2_SUPABASE_HINT;
    }
    if (/pg_proc|42501/i.test(rawMsg)) {
      return (
        "مسار UPDATE pg_proc مُلغى وغير مسموح في Supabase. " + V2_SUPABASE_HINT
      );
    }
    if (/not allowed|permission|JWT/i.test(String((error && error.message) || ""))) {
      return "غير مصرح. سجّل دخول الإدارة ثم أعد المحاولة.";
    }
    if (code === "ADMIN-RPC-001") {
      return String((error && error.message) || "تعذّر الاتصال بخدمة الإدارة.");
    }
    if (rawMsg) {
      return (
        "تعذّر تنفيذ الأمر. راجع الصياغة أو الصلاحيات. (" +
        rawMsg.slice(0, 160) +
        ")"
      );
    }
    return "تعذّر تنفيذ الأمر. راجع الصياغة أو الصلاحيات.";
  }

  function isMissingRpcError(error, payload) {
    const code = String(
      (error && error.code) || (payload && payload.error_code) || "",
    );
    const msg = String(
      (error && error.message) || (payload && payload.message_ar) || "",
    );
    return (
      code === "PGRST202" ||
      code === "42883" ||
      /could not find the function|schema cache|does not exist/i.test(msg)
    );
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
    const retired = !ok && !busy && isRetiredDailyEntry(it);
    const badge = busy
      ? "قيد التنفيذ"
      : ok
        ? "مُنفذ"
        : retired
          ? "متقاعد — غير قابل للتنفيذ"
          : "فشل — أعد التنفيذ";
    const cls = busy
      ? " is-busy"
      : ok
        ? " is-ok"
        : retired
          ? " is-fail"
          : " is-fail";
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
      ((retired ? RETIRED_MSG_AR : it.error)
        ? '<span class="sql-ws-hist-err">' +
          escapeHtml(retired ? RETIRED_MSG_AR : it.error) +
          "</span>"
        : "") +
      '<span class="sql-ws-hist-preview" dir="ltr">' +
      escapeHtml((it.sql || it.title || "").slice(0, 120)) +
      "</span>" +
      "</button>"
    );
  }

  function listDailyWorkItems() {
    const items = purgeDailySucceeded();
    if (!inProgress) return items;
    const live = normalizeEntry(inProgress);
    const key = commandKey(live);
    const rest = items.filter(
      (x) => commandKey(x) !== key && x.id !== live.id,
    );
    rest.unshift(live);
    return rest;
  }

  function renderQueue() {
    if (!els.queue) return;
    const items = listDailyWorkItems();
    if (!items.length) {
      els.queue.innerHTML =
        '<div class="hint">لا أوامر بانتظار التنفيذ. الشاشة اليومية نظيفة — الأوامر الناجحة في الأرشيف.</div>';
      return;
    }
    els.queue.innerHTML = items
      .map((it) => renderOpCard(it, { archive: false }))
      .join("");
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
    activeEditorPresetId = "";
    if (els.editor) els.editor.value = "";
    if (els.meta) els.meta.textContent = "";
    if (els.results) els.results.innerHTML = "";
    setError("");
    setStatus("", "");
    setEditorVisible(true);
  }

  function archivePresetSuccess(presetId, meta) {
    const api = presetsApi();
    const p =
      api && Array.isArray(api.PRESETS)
        ? api.PRESETS.find((x) => x.id === presetId)
        : null;
    const m = meta || {};
    return pushArchive({
      id: "preset_" + presetId,
      at: m.at || new Date().toISOString(),
      ok: true,
      title: (p && p.title) || m.title || presetId,
      presetId: presetId,
      actor: m.actor || getActorLabel(),
      requestId: m.requestId || "",
      version: m.version || presetId,
      source: m.source || "preset",
      sql: m.sql || "",
      rowCount: m.statements != null ? m.statements : m.rowCount,
    });
  }

  async function probeExecutorReady(token) {
    const { data, error } = await invokeRpc(
      V2_RPC,
      {
        p_token: token,
        p_sql: "SELECT 1 AS n",
        p_confirm_mutate: false,
      },
      { timeoutMs: 30000 },
    );
    const payload =
      data && typeof data === "object" && !Array.isArray(data) ? data : null;
    if (isMissingRpcError(error, payload)) {
      return { ready: false, reason: "v2_missing" };
    }
    if (error || !payload || payload.ok === false) {
      // Function exists but probe SQL failed — still treat as present if not missing.
      if (payload && payload.executor === "workspace_run_v2") {
        return { ready: true, reason: "ok_with_payload_error" };
      }
      return { ready: false, reason: "probe_failed" };
    }
    return { ready: true, reason: "ok" };
  }

  async function copyText(text) {
    const s = String(text || "");
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(s);
        return true;
      }
    } catch (_) {}
    try {
      const ta = document.createElement("textarea");
      ta.value = s;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return !!ok;
    } catch (_) {
      return false;
    }
  }

  /**
   * Install v2 via CREATE OR REPLACE only.
   * Tries Workspace (split + execute_v1) first; never touches pg_proc.
   * If the old executor rejects CREATE FUNCTION, returns needs_supabase.
   */
  async function runExecutorBootstrap(token) {
    if (bootstrapping) {
      return { ok: false, error: "تثبيت المنفّذ قيد التنفيذ بالفعل" };
    }
    bootstrapping = true;
    try {
      const api = presetsApi();
      if (!api || typeof api.fetchPresetSql !== "function") {
        return { ok: false, error: "وحدة الأوامر الجاهزة غير محمّلة" };
      }

      const already = await probeExecutorReady(token);
      if (already.ready) {
        executorReady = true;
        clearMultiFailNoise();
        archivePresetSuccess(V2_PRESET_ID, {
          bootstrap: true,
          actor: getActorLabel(),
          version: "workspace_run_v2",
          already: true,
        });
        return { ok: true, skipped: true };
      }

      setStatus("busy", "جاري تثبيت منفّذ SQL Workspace v2 (CREATE OR REPLACE)…");
      const sql = await api.fetchPresetSql(V2_INSTALL_FILE);
      const stmts =
        typeof api.splitSqlStatements === "function"
          ? api.splitSqlStatements(sql)
          : [];
      if (!stmts.length) {
        return { ok: false, error: "ملف تثبيت المنفّذ v2 فارغ" };
      }

      let usedV1 = false;
      for (let i = 0; i < stmts.length; i++) {
        setStatus(
          "busy",
          "تثبيت v2 — أمر " + (i + 1) + " / " + stmts.length + "…",
        );
        const { data, error } = await invokeRpc(
          V1_RPC,
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
          if (isMultiError(payload, error) || /pg_proc|42501/i.test(
            String((error && error.message) || ""),
          )) {
            const copied = await copyText(sql);
            return {
              ok: false,
              needs_supabase: true,
              error:
                "المنفّذ القديم لا يستطيع تثبيت CREATE FUNCTION من داخل المساحة " +
                "(أو رُفض أي مسار كتالوج). الصق الملف مرة واحدة في Supabase SQL Editor " +
                "(CREATE OR REPLACE فقط — بدون pg_proc)" +
                (copied ? " — نُسخ إلى الحافظة." : " — افتح البطاقة «عرض في المحرر».") +
                " بعد النجاح: أعد تشغيل بطاقة التثبيت ثم أوامر بوابة 1 من المساحة.",
              sql: sql,
            };
          }
          return {
            ok: false,
            error:
              "فشل تثبيت v2 عند الأمر " +
              (i + 1) +
              " / " +
              stmts.length +
              ": " +
              friendlyRpcError(error, payload),
            step: i + 1,
          };
        }
        usedV1 = true;
      }

      // PostgREST schema cache may lag; retry probe briefly.
      let probe = await probeExecutorReady(token);
      if (!probe.ready) {
        await new Promise(function (r) {
          setTimeout(r, 1200);
        });
        probe = await probeExecutorReady(token);
      }
      if (!probe.ready) {
        const copied = await copyText(sql);
        return {
          ok: false,
          needs_supabase: true,
          error:
            (usedV1
              ? "أُرسلت أوامر CREATE OR REPLACE لكن PostgREST لا يرى v2 بعد. "
              : "") +
            "الصق COPY-ME-admin-sql-workspace-run-v2.sql مرة في Supabase ثم أعد المحاولة" +
            (copied ? " (نُسخ إلى الحافظة)." : "."),
          sql: sql,
        };
      }

      executorReady = true;
      clearMultiFailNoise();
      archivePresetSuccess(V2_PRESET_ID, {
        bootstrap: true,
        actor: getActorLabel(),
        version: "workspace_run_v2",
        via: usedV1 ? "execute_v1_split" : "probe",
      });
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
      clearMultiFailNoise();
      return { ok: true, skipped: true };
    }
    return runExecutorBootstrap(token);
  }

  async function invokeWorkspaceSql(token, sql, confirmMutate) {
    if (executorReady) {
      return invokeRpc(
        V2_RPC,
        {
          p_token: token,
          p_sql: sql,
          p_confirm_mutate: !!confirmMutate,
        },
        { timeoutMs: 90000 },
      );
    }
    const probe = await probeExecutorReady(token);
    if (probe.ready) {
      executorReady = true;
      return invokeRpc(
        V2_RPC,
        {
          p_token: token,
          p_sql: sql,
          p_confirm_mutate: !!confirmMutate,
        },
        { timeoutMs: 90000 },
      );
    }
    return invokeRpc(
      V1_RPC,
      {
        p_token: token,
        p_sql: sql,
        p_confirm_mutate: !!confirmMutate,
      },
      { timeoutMs: 90000 },
    );
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
    if (isRetiredSql(sql) || isRetiredPresetId(activeEditorPresetId)) {
      scrubRetiredEditorContent();
      scrubRetiredDailyNoise();
      clearDailyForCommand({
        id: EDITOR_DAILY_ID,
        source: "editor",
        sql: sql,
        title: EDITOR_DAILY_TITLE,
      });
      renderQueue();
      setError(RETIRED_MSG_AR);
      setStatus("err", "متقاعد — لا يُشغَّل");
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
    const presetId =
      activeEditorPresetId || inferPresetIdFromSql(sql) || "";
    const opId = presetId ? "daily_" + presetId : EDITOR_DAILY_ID;
    inProgress = normalizeEntry({
      id: opId,
      at: new Date().toISOString(),
      ok: false,
      status: "running",
      sql: sql,
      actor: actor,
      requestId: requestId,
      version: presetId || cls.first || "SQL",
      presetId: presetId,
      source: presetId ? "preset" : "editor",
      title: presetId ? "أمر صيانة من المحرر" : EDITOR_DAILY_TITLE,
    });
    renderQueue();

    setError("");
    setStatus("busy", "جاري التنفيذ…");
    if (els.run) els.run.disabled = true;

    const started = Date.now();
    let { data, error } = await invokeWorkspaceSql(
      token,
      sql,
      !!cls.mutating || confirmMutate,
    );

    if (els.run) els.run.disabled = false;

    let payload =
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
      if (
        (isMultiError(payload, error) || isMissingRpcError(error, payload)) &&
        !multiRetryUsed
      ) {
        multiRetryUsed = true;
        setStatus("busy", "المنفّذ v2 غير جاهز — جاري التثبيت ثم إعادة المحاولة…");
        const up = await ensureExecutorReady(token, { force: true });
        if (up.ok) {
          if (els.run) els.run.disabled = false;
          inProgress = null;
          return runSql({ confirmMutate: true });
        }
        setError(up.error || "تعذّر تثبيت منفّذ SQL Workspace v2");
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
      if (presetId && typeof presetsApi().markFail === "function") {
        presetsApi().markFail(presetId, {
          error: msg,
          actor: actor,
          requestId: requestId,
          needs_supabase: isMultiFailMessage(msg) || /Supabase/i.test(msg),
        });
      }
      // Editor fails: one ephemeral daily card only (never append history).
      // Linked preset fails update that preset's single daily card.
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
        version: presetId || cls.first || "SQL",
        presetId: presetId,
        source: presetId ? "preset" : "editor",
        title: presetId ? "أمر صيانة من المحرر" : EDITOR_DAILY_TITLE,
        auditId: payload && payload.audit_id,
      });
      renderPresets();
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
      version: presetId || cls.first || "SQL",
      presetId: presetId,
      source: presetId ? "preset" : "editor",
      title: presetId ? "أمر صيانة من المحرر" : EDITOR_DAILY_TITLE,
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
      id: "maint.sql_workspace_run_v2",
      title: "تثبيت منفّذ SQL Workspace v2",
      desc:
        "إلزامي أولًا: إن ظهر «يُسمح بأمر واحد فقط» فالصق COPY-ME-admin-sql-workspace-run-v2.sql مرة في Supabase ثم أعد تشغيل هذه البطاقة.",
      file: "../supabase/sql/COPY-ME-admin-sql-workspace-run-v2.sql",
      order: 10,
      bootstrap: true,
      supabaseOnce: true,
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
    {
      id: "maint.repair_null_parent_columns_dry_run_v1",
      title: "معاينة parent/child_name الفارغ (dry-run)",
      desc: "قراءة فقط: صفوف parent/child_name الفارغ ومقترح الملء — قبل APPLY.",
      file: "../supabase/sql/COPY-ME-repair-null-parent-columns-dry-run.sql",
      order: 40,
    },
    {
      id: "maint.repair_null_parent_columns_apply_v1",
      title: "تطبيق ملء parent/child_name (APPLY)",
      desc: "كتابة بعد نجاح dry-run وموافقة صريحة — لا Auto Repair.",
      file: "../supabase/sql/COPY-ME-repair-null-parent-columns-apply.sql",
      order: 41,
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
      getFail: function (id) {
        if (api.isDone(id)) return null;
        return loadMap(FAIL_KEY)[id] || null;
      },
      commandState: function (id) {
        if (api.isDone(id)) return "archived";
        if (api.getFail(id)) return "failed";
        return "pending";
      },
      markDone: function (id, meta) {
        const map = loadMap(DONE_KEY);
        map[id] = Object.assign({ at: new Date().toISOString(), ok: true, archived: true }, meta || {});
        saveMap(DONE_KEY, map);
        const fails = loadMap(FAIL_KEY);
        if (fails[id]) { delete fails[id]; saveMap(FAIL_KEY, fails); }
      },
      markFail: function (id, meta) {
        if (api.isDone(id)) return;
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
        (archivedN ? " · " + archivedN + " في الأرشيف" : "") +
        (executorReady ? " · المنفّذ v2 جاهز" : " · المنفّذ v2 غير مفعّل");
    }
    if (!items.length) {
      if (!executorReady) {
        host.innerHTML =
          '<div class="alert alert-error sql-ws-v2-gate" role="status">' +
          "<strong>تثبيت v2 مطلوب:</strong> " +
          escapeHtml(V2_BLOCK_CARD_AR) +
          "</div>";
        return;
      }
      host.innerHTML =
        '<div class="hint">لا أوامر صيانة بانتظار التنفيذ الآن. الأوامر المُنفَّذة في «سجل التنفيذ / الأرشيف» أدناه — أو ألغِ «مُنفذ» من الأرشيف إن احتجت إعادة تشغيل.</div>';
      return;
    }
    const gateBanner = !executorReady
      ? '<div class="alert alert-error sql-ws-v2-gate" role="status" style="margin:0 0 10px;">' +
        "<strong>" +
        (v2InstallRequiredBanner ? "تثبيت v2 مطلوب:" : "خطوة إلزامية قبل باقي البطاقات:") +
        "</strong> " +
        escapeHtml(v2InstallRequiredBanner ? V2_BLOCK_CARD_AR : V2_SUPABASE_HINT) +
        "</div>"
      : "";
    host.innerHTML =
      gateBanner +
      items
        .map(function (p) {
          const fail =
            typeof api.getFail === "function" ? api.getFail(p.id) : null;
          const multi =
            !!(fail && isMultiFailMessage(fail.error)) ||
            !!(fail && fail.needs_supabase);
          const isV2 = p.id === V2_PRESET_ID || p.bootstrap || p.supabaseOnce;
          let badgeHtml;
          if (isV2 && !executorReady) {
            badgeHtml =
              '<span class="sql-ws-preset-badge is-fail">يلزم Supabase أولًا</span> · ' +
              "الصق COPY-ME-admin-sql-workspace-run-v2.sql مرة في SQL Editor ثم اضغط تشغيل";
          } else if (fail) {
            const errShow = multi
              ? "موقوف حتى تثبيت v2 في Supabase"
              : String(fail.error || "").slice(0, 100);
            badgeHtml =
              '<span class="sql-ws-preset-badge is-fail">' +
              (multi ? "فشل — ثبّت v2 أولًا" : "فشل — أعد التنفيذ") +
              "</span> · " +
              escapeHtml(formatTime(fail.at)) +
              (errShow ? " · " + escapeHtml(errShow) : "");
          } else {
            badgeHtml = '<span class="sql-ws-preset-badge">جاهز للتشغيل</span>';
          }
          const desc = isV2 && !executorReady
            ? V2_SUPABASE_HINT
            : multi && !isV2
              ? "لا تُعاد المحاولة الآن. ثبّت منفّذ v2 من البطاقة الأولى (لصق الملف في Supabase إن لزم) ثم شغّل هذه البطاقة مرة واحدة."
              : p.desc || "";
          return (
            '<div class="sql-ws-preset' +
            (fail || (isV2 && !executorReady) ? " is-fail" : "") +
            '" data-preset-id="' +
            escapeHtml(p.id) +
            '">' +
            '<div class="sql-ws-preset-main">' +
            '<div class="sql-ws-preset-title">' +
            escapeHtml(p.title) +
            "</div>" +
            '<div class="hint sql-ws-preset-desc">' +
            escapeHtml(desc) +
            "</div>" +
            '<div class="sql-ws-preset-meta hint">' +
            badgeHtml +
            (p.bootstrap ? " · تثبيت منفّذ v2" : "") +
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
    if (isRetiredPresetId(id)) {
      activeEditorPresetId = "";
      if (els.editor) els.editor.value = "";
      setEditorVisible(true);
      setStatus("err", "متقاعد — لا يُشغَّل");
      setError(RETIRED_MSG_AR);
      return;
    }
    const p = (api.PRESETS || []).find((x) => x.id === id);
    if (!p) return;
    setStatus("busy", "جاري تحميل الأمر…");
    try {
      const sql = await api.fetchPresetSql(p.file);
      if (isRetiredSql(sql) || /SQL-WS-RETIRED-PG-PROC/i.test(sql)) {
        activeEditorPresetId = "";
        if (els.editor) els.editor.value = "";
        setEditorVisible(true);
        setStatus("err", "متقاعد — لا يُشغَّل");
        setError(RETIRED_MSG_AR);
        return;
      }
      activeEditorPresetId = id;
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
    if (isRetiredPresetId(id)) {
      if (els.editor) els.editor.value = "";
      setEditorVisible(true);
      setError(RETIRED_MSG_AR);
      setStatus("err", "متقاعد — لا يُشغَّل");
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
        "»\n\nسيُنفَّذ بعد تأكيد التغيير" +
        (p.bootstrap
          ? " (تثبيت CREATE OR REPLACE — بدون تعديل pg_proc)."
          : " عبر منفّذ Workspace v2.") +
        "\nهل تريد المتابعة؟",
    );
    if (!okConfirm) {
      setStatus("", "أُلغي التشغيل");
      return;
    }

    if (p.bootstrap) {
      setStatus("busy", "جاري تثبيت / فحص منفّذ v2…");
      const boot = await runExecutorBootstrap(token);
      if (boot.ok) {
        setStatus(
          "ok",
          boot.skipped
            ? "✅ المنفّذ v2 جاهز مسبقًا — نُقل إلى الأرشيف"
            : "✅ تم تثبيت منفّذ SQL Workspace v2 — نُقل إلى الأرشيف",
        );
        setError("");
        setEditorVisible(false);
        renderPresets();
        renderQueue();
        renderArchive();
        return;
      }
      if (boot.needs_supabase && boot.sql && els.editor) {
        if (isRetiredSql(boot.sql)) {
          els.editor.value = "";
          setError(RETIRED_MSG_AR);
        } else {
          els.editor.value = boot.sql;
        }
        setEditorVisible(true);
      }
      if (typeof api.markFail === "function") {
        api.markFail(p.id, {
          error: boot.error || "فشل التثبيت",
          actor: getActorLabel(),
          needs_supabase: !!boot.needs_supabase,
        });
      }
      pushQueue({
        id: "preset_" + p.id,
        at: new Date().toISOString(),
        ok: false,
        status: "failed",
        title: p.title,
        presetId: p.id,
        error: boot.error || "فشل التثبيت",
        actor: getActorLabel(),
        version: p.id,
        source: "preset",
        sql: boot.sql || "",
      });
      setError(boot.error || "تعذّر تثبيت المنفّذ v2");
      setStatus(
        "err",
        boot.needs_supabase ? "يلزم لصق مرة في Supabase" : "فشل التثبيت",
      );
      renderPresets();
      return;
    }

    const up = await ensureExecutorReady(token);
    if (!up.ok) {
      if (up.needs_supabase && up.sql && els.editor) {
        if (isRetiredSql(up.sql)) {
          els.editor.value = "";
          setError(RETIRED_MSG_AR);
        } else {
          els.editor.value = up.sql;
        }
        setEditorVisible(true);
      }
      setError(up.error || "تعذّر تثبيت منفّذ SQL Workspace v2");
      setStatus("err", "المنفّذ غير جاهز");
      return;
    }
    if (!up.skipped) {
      setStatus("ok", "تم تثبيت المنفّذ v2 — متابعة الأمر…");
      renderPresets();
    }

    const requestId = readLinkedRequestId();
    const actor = getActorLabel();
    const dailyId = "daily_" + p.id;
    inProgress = normalizeEntry({
      id: dailyId,
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
        id: dailyId,
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

    if (els.run) els.run.disabled = true;
    setStatus("busy", "تشغيل عبر منفّذ Workspace v2…");
    let { data, error } = await invokeWorkspaceSql(token, sql, true);
    let payload =
      data && typeof data === "object" && !Array.isArray(data) ? data : null;
    let doneCount = 0;

    if (
      (isMissingRpcError(error, payload) || isMultiError(payload, error)) &&
      !executorReady
    ) {
      const stmts = api.splitSqlStatements(sql);
      if (!stmts.length) {
        inProgress = null;
        setStatus("err", "فارغ");
        setError("لم يُعثر على أوامر قابلة للتنفيذ في الملف.");
        if (els.run) els.run.disabled = false;
        renderQueue();
        return;
      }
      error = null;
      payload = { ok: true };
      for (let i = 0; i < stmts.length; i++) {
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
        if (els.editor) els.editor.value = stmts[i];
        const step = await invokeWorkspaceSql(token, stmts[i], true);
        const stepPayload =
          step.data &&
          typeof step.data === "object" &&
          !Array.isArray(step.data)
            ? step.data
            : null;
        if (step.error || !stepPayload || stepPayload.ok === false) {
          error = step.error;
          payload = stepPayload;
          break;
        }
        doneCount++;
        payload = stepPayload;
      }
      if (els.editor) els.editor.value = sql;
      if (!error && doneCount === stmts.length) {
        payload = Object.assign({}, payload || {}, {
          ok: true,
          statements_ok: doneCount,
          statement_count: doneCount,
        });
      }
    } else if (payload && payload.ok !== false && !error) {
      doneCount =
        payload.statements_ok != null
          ? Number(payload.statements_ok)
          : payload.statement_count != null
            ? Number(payload.statement_count)
            : 1;
    }

    if (els.run) els.run.disabled = false;

    if (error || !payload || payload.ok === false) {
      const msg = friendlyRpcError(error, payload);
      inProgress = null;
      if (typeof api.markFail === "function") {
        api.markFail(p.id, {
          error: msg,
          actor: actor,
          requestId: requestId,
        });
      }
      pushQueue({
        id: dailyId,
        at: new Date().toISOString(),
        ok: false,
        status: "failed",
        title: p.title,
        presetId: p.id,
        error: msg,
        sql: sql,
        actor: actor,
        requestId: requestId,
        version: p.id,
        source: "preset",
        auditId: payload && payload.audit_id,
      });
      setError(msg);
      setStatus("err", "فشل التنفيذ");
      renderPresets();
      return;
    }

    const at = new Date().toISOString();
    inProgress = null;
    pushArchive({
      id: "preset_" + p.id,
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
      executor: (payload && payload.executor) || "workspace_run_v2",
    });

    let statusMsg =
      "✅ تم تنفيذ الأمر الجاهز (" +
      doneCount +
      " أوامر) — نُقل إلى الأرشيف";
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
  }

  function restoreFromEntry(it) {
    if (!it || !els.editor) return;
    if (isRetiredDailyEntry(it)) {
      activeEditorPresetId = "";
      els.editor.value = "";
      setEditorVisible(true);
      setError(RETIRED_MSG_AR);
      setStatus("err", "متقاعد — لا يُشغَّل");
      scrubRetiredDailyNoise();
      renderQueue();
      return;
    }
    if (it.presetId) activeEditorPresetId = it.presetId;
    if (it.sql) {
      if (isRetiredSql(it.sql)) {
        activeEditorPresetId = "";
        els.editor.value = "";
        setEditorVisible(true);
        setError(RETIRED_MSG_AR);
        setStatus("err", "متقاعد — لا يُشغَّل");
        return;
      }
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
        const id = doneBtn.getAttribute("data-preset-done");
        if (isRetiredPresetId(id)) {
          setError(RETIRED_MSG_AR);
          setStatus("err", "متقاعد — لا يُشغَّل");
          return;
        }
        if (!executorReady) {
          v2InstallRequiredBanner = true;
          setError(V2_BLOCK_CARD_AR);
          setStatus("err", "تثبيت v2 مطلوب");
          renderPresets();
          return;
        }
        archivePresetSuccess(id, {
          manual: true,
          actor: getActorLabel(),
          requestId: readLinkedRequestId(),
          version: id,
        });
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
    migrateCollapseDailySpam();
    scrubRetiredDailyNoise();
    purgeDailySucceeded();
    renderQueue();
    renderArchive();
    setEditorVisible(true);
    // Always open with an empty editor (no default SELECT / no draft restore).
    clearEditor();
    scrubRetiredEditorContent({ quiet: true });

    (async function probeExecutorOnBind() {
      const token = getToken();
      if (!token) {
        scrubRetiredEditorContent({ quiet: true });
        scrubRetiredDailyNoise();
        renderPresets();
        renderQueue();
        return;
      }
      try {
        const probe = await probeExecutorReady(token);
        executorReady = !!probe.ready;
        if (executorReady) {
          v2InstallRequiredBanner = false;
          clearMultiFailNoise();
        } else {
          reconcileArchiveWithExecutorReady();
        }
      } catch (_) {}
      scrubRetiredEditorContent({ quiet: true });
      scrubRetiredDailyNoise();
      purgeDailySucceeded();
      renderPresets();
      renderQueue();
      renderArchive();
    })();

    document.addEventListener("alzidan:admin-module", (ev) => {
      if (ev && ev.detail && ev.detail.id === "tools") {
        migrateCollapseDailySpam();
        clearEditor();
        scrubRetiredEditorContent({ quiet: true });
        scrubRetiredDailyNoise();
        purgeDailySucceeded();
        (async function () {
          const token = getToken();
          if (token) {
            try {
              const probe = await probeExecutorReady(token);
              executorReady = !!probe.ready;
              if (executorReady) {
                v2InstallRequiredBanner = false;
                clearMultiFailNoise();
              } else {
                reconcileArchiveWithExecutorReady();
              }
            } catch (_) {}
          }
          renderQueue();
          renderArchive();
          renderPresets();
        })();
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
    /** Load explicit SQL into the editor (Health Center staged repair). */
    loadSql: function (sql, meta) {
      const text = String(sql || "");
      // Must leave Health (#module=health) — otherwise sql-workspace-section stays admin-module-off.
      try {
        const shell = window.AlzidanAdminShell;
        if (shell && typeof shell.navigate === "function") {
          shell.navigate("tools");
        } else {
          const url = new URL(window.location.href);
          const params = new URLSearchParams(String(url.hash || "").replace(/^#/, ""));
          params.set("module", "tools");
          url.hash = params.toString();
          history.replaceState(null, "", url.pathname + url.search + url.hash);
          window.dispatchEvent(new HashChangeEvent("hashchange"));
        }
      } catch (_) {}
      if (!els.editor) {
        els.editor = document.getElementById("sql-ws-editor");
      }
      if (!els.editor) return false;
      els.editor.value = text;
      activeEditorPresetId = "";
      setEditorVisible(true);
      const title = (meta && meta.title) || "أمر من مركز الصحة";
      setStatus(
        "ok",
        "✅ محمّل من مركز الصحة: " + title + " — راجع الأمر ثم شغّل بعد الموافقة (صف واحد).",
      );
      setError("");
      const reveal = function () {
        try {
          const section = document.getElementById("sql-workspace-section");
          if (section && typeof section.scrollIntoView === "function") {
            section.scrollIntoView({ behavior: "smooth", block: "start" });
          }
          if (els.editor && typeof els.editor.focus === "function") {
            els.editor.focus();
          }
        } catch (_) {}
      };
      // After shell navigate + visibility toggle, scroll on next frames.
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(function () {
          requestAnimationFrame(reveal);
        });
      } else {
        setTimeout(reveal, 50);
      }
      return true;
    },
  };
})();
