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

  /** Strip leading -- / block comments (loop), matching fixed admin_sql_classify_v1. */
  function stripLeadingSqlComments(sql) {
    let work = String(sql || "");
    for (;;) {
      work = work.replace(/^\s+/, "");
      if (!work) break;
      if (work.slice(0, 2) === "--") {
        const nl = work.indexOf("\n");
        work = nl < 0 ? "" : work.slice(nl + 1);
        continue;
      }
      if (work.slice(0, 2) === "/*") {
        const end = work.indexOf("*/", 2);
        if (end < 0) {
          work = "";
          break;
        }
        work = work.slice(end + 2);
        continue;
      }
      break;
    }
    return work.trim();
  }

  function classifyLocal(sql) {
    const raw = String(sql || "").trim();
    if (!raw) return { empty: true, mutating: false, selectish: false };
    const work = stripLeadingSqlComments(raw);
    if (!work) return { empty: true, mutating: false, selectish: false };
    const first = (work.match(/^\s*([A-Za-z]+)/) || [])[1] || "";
    const upper = first.toUpperCase();
    const selectish = ["SELECT", "WITH", "SHOW", "EXPLAIN", "VALUES", "TABLE"].includes(
      upper,
    );
    const mutating = MUTATE_RE.test(work);
    return { empty: false, mutating, selectish, first: upper };
  }

  /**
   * Safe for old execute_v1 / pre-fix classify: one statement, line comments only.
   * Rejects block comments (known classify timeout with '/' paths) and DO blocks.
   */
  function isSimpleSingleStatement(sql) {
    const raw = String(sql || "");
    if (!raw.trim()) return false;
    if (/\/\*|\*\//.test(raw)) return false;
    if (/\bDO\s+\$/i.test(raw)) return false;
    const work = stripLeadingSqlComments(raw);
    if (!work) return false;
    if (!/^(SELECT|WITH|UPDATE|INSERT|DELETE)\b/i.test(work)) return false;
    const body = work.replace(/;\s*$/, "");
    return body.indexOf(";") < 0;
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

  let pendingHealthRepair = null;

  function friendlyRpcError(error, data) {
    const Pipe = window.AlzidanIntegrityRepairPipeline;
    if (Pipe && typeof Pipe.friendlySqlFailureAr === "function") {
      const mapped = Pipe.friendlySqlFailureAr(error, data);
      if (mapped) {
        // Keep workspace-specific overrides below for multi/v2/timeout.
      }
    }
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
        "انتهت مهلة التنفيذ. غالبًا تعليق كتلي مع مسارات فيها '/' علّق التصنيف القديم — أزل التعليق الكتلي أو أعد الإرسال من مركز الصحة (تحديث سجل واحد فقط)، أو ثبّت منفّذ مساحة SQL ثم Hard Refresh."
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
    if (/pg_proc|42501/i.test(rawMsg) && /pg_proc/i.test(rawMsg)) {
      return (
        "مسار تحديث النظام مُلغى وغير مسموح. " + V2_SUPABASE_HINT
      );
    }
    if (/not allowed|permission|JWT|RLS|42501/i.test(rawMsg) || code === "42501") {
      return (
        "صلاحية غير كافية لتنفيذ الأمر" +
        (rawMsg ? " — " + rawMsg.slice(0, 140) : ". سجّل دخول الإدارة ثم أعد المحاولة.")
      );
    }
    if (/0 rows|no rows affected|did not update|ROW_COUNT/i.test(rawMsg)) {
      return "الصف غير موجود أو لم يتأثر أي سجل بالأمر" + (rawMsg ? " — " + rawMsg.slice(0, 120) : "");
    }
    if (/foreign key|23503|violates foreign/i.test(rawMsg) || code === "23503") {
      return "لم يتم العثور على الأب أو المعرف المشار إليه — " + rawMsg.slice(0, 140);
    }
    if (/unique|duplicate|23505/i.test(rawMsg) || code === "23505") {
      return "تعارض فريد في القاعدة — " + rawMsg.slice(0, 140);
    }
    if (/syntax|42601/i.test(rawMsg) || code === "42601") {
      return "خطأ في صياغة الأمر — " + rawMsg.slice(0, 140);
    }
    if (code === "ADMIN-RPC-001") {
      return String((error && error.message) || "تعذّر الاتصال بخدمة الإدارة.");
    }
    if (Pipe && typeof Pipe.friendlySqlFailureAr === "function") {
      const fromPipe = Pipe.friendlySqlFailureAr(error, data);
      if (fromPipe) return fromPipe;
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
    // Health one-row UPDATE / plain SELECT: prefer execute_v1 (single classify,
    // works on old executor, avoids multi-statement splitter).
    if (isSimpleSingleStatement(sql)) {
      return invokeRpc(
        V1_RPC,
        {
          p_token: token,
          p_sql: sql,
          p_confirm_mutate: !!confirmMutate,
        },
        { timeoutMs: 45000 },
      );
    }
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
    if (/\/\*/.test(sql)) {
      setError(
        "المحرر يحتوي تعليقًا كتليًا /* … */ — هذا يعلّق التصنيف القديم (timeout). احذف التعليق الكتلي أو أعد «أرسل إلى SQL Workspace» من مركز الصحة بعد التحديث.",
      );
      setStatus("err", "تعليق كتلي مرفوض");
      return;
    }
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
      const Pipe = window.AlzidanIntegrityRepairPipeline;
      const failLine =
        Pipe && typeof Pipe.formatRepairFailureAr === "function"
          ? Pipe.formatRepairFailureAr(msg)
          : "فشل التنفيذ — سبب الفشل: " + msg;
      setError(failLine);
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
        error: failLine,
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
    if (pendingHealthRepair) {
      const hr = pendingHealthRepair;
      pendingHealthRepair = null;
      const Pipe = window.AlzidanIntegrityRepairPipeline;
      if (Pipe && typeof Pipe.formatRepairSuccessAr === "function") {
        statusMsg = "✅ " + Pipe.formatRepairSuccessAr(hr);
      } else {
        statusMsg =
          "✅ تم إصلاح السجل رقم " +
          (hr.row_id != null ? hr.row_id : "?") +
          " بنجاح.";
      }
    } else if (requestId) {
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
      sql: `-- SQL Workspace executor v2 — CREATE OR REPLACE / GRANT only.
-- NO pg_catalog writes. NO UPDATE pg_proc. Safe on Supabase (incl. free tier).
--
-- Chicken-egg: paste once in Supabase SQL Editor if the old Workspace executor
-- rejects CREATE FUNCTION (naive ';' check or broken stripper stub).
-- After this lands: Admin → tools → maintenance cards run via
-- admin_sql_workspace_run_v2 forever (Workspace path).
--
-- Preset: maint.sql_workspace_run_v2
-- Safe to re-run.

-- 0) Classifier (dependency of execute_v1 / run_v2)
create or replace function public.admin_sql_classify_v1(p_sql text)
returns jsonb
language plpgsql
immutable
as $fn$
declare
  v_raw text := btrim(coalesce(p_sql, ''));
  v_work text;
  v_first text;
  v_mutating boolean := false;
  v_selectish boolean := false;
  v_block_end int;
begin
  if v_raw = '' then
    return jsonb_build_object('empty', true, 'mutating', false, 'selectish', false, 'first', null);
  end if;

  -- Strip leading line/block comments without regex backtracking.
  -- (Naive '/\\*.*?\\*/' with flag n can statement-timeout on SQL that contains '/' paths.)
  v_work := v_raw;
  loop
    v_work := btrim(v_work);
    if v_work = '' then
      exit;
    end if;
    if substr(v_work, 1, 2) = '--' then
      v_work := regexp_replace(v_work, '^--[^\\n]*\\n?', '');
      continue;
    end if;
    if substr(v_work, 1, 2) = '/*' then
      v_block_end := position('*/' in substr(v_work, 3));
      if v_block_end > 0 then
        -- substr(v_work,3) index + 2 (for '/*') + 2 (for '*/') - 1 = v_block_end + 3
        v_work := substr(v_work, v_block_end + 4);
        continue;
      end if;
      -- Unclosed block comment → treat as empty
      v_work := '';
      exit;
    end if;
    exit;
  end loop;

  v_work := btrim(v_work);
  if v_work = '' then
    return jsonb_build_object('empty', true, 'mutating', false, 'selectish', false, 'first', null);
  end if;
  v_first := upper(substring(v_work from '^\\s*([A-Za-z]+)'));

  v_selectish := v_first in ('SELECT', 'WITH', 'SHOW', 'EXPLAIN', 'VALUES', 'TABLE');
  v_mutating := v_first in (
    'UPDATE', 'DELETE', 'DROP', 'ALTER', 'TRUNCATE', 'CREATE',
    'INSERT', 'REPLACE', 'GRANT', 'REVOKE', 'COMMENT', 'COPY',
    'VACUUM', 'REINDEX', 'CLUSTER', 'SECURITY', 'CALL', 'DO'
  );

  return jsonb_build_object(
    'empty', false,
    'mutating', v_mutating,
    'selectish', v_selectish,
    'first', v_first
  );
end;
$fn$;

-- 1) Literal/comment stripper (fixes identity stub left by retired pg_proc bootstrap)
create or replace function public.admin_sql_sql_without_literals_v1(p_sql text)
returns text
language plpgsql
immutable
as $fn$
declare
  v text := coalesce(p_sql, '');
  v_out text := '';
  i int := 1;
  n int;
  ch text;
  tag text;
  endtag text;
  j int;
begin
  n := char_length(v);
  while i <= n loop
    ch := substr(v, i, 1);
    if ch = '$' then
      j := i + 1;
      while j <= n and substr(v, j, 1) ~ '[A-Za-z0-9_]' loop
        j := j + 1;
      end loop;
      if j <= n and substr(v, j, 1) = '$' then
        tag := substr(v, i, j - i + 1);
        endtag := tag;
        i := j + 1;
        v_out := v_out || ' ';
        while i <= n loop
          if substr(v, i, char_length(endtag)) = endtag then
            i := i + char_length(endtag);
            v_out := v_out || ' ';
            exit;
          end if;
          v_out := v_out || ' ';
          i := i + 1;
        end loop;
        continue;
      end if;
    end if;
    if ch = chr(39) then
      v_out := v_out || ' ';
      i := i + 1;
      while i <= n loop
        if substr(v, i, 1) = chr(39) then
          if i < n and substr(v, i + 1, 1) = chr(39) then
            v_out := v_out || '  ';
            i := i + 2;
            continue;
          end if;
          i := i + 1;
          exit;
        end if;
        v_out := v_out || ' ';
        i := i + 1;
      end loop;
      continue;
    end if;
    if ch = '-' and i < n and substr(v, i + 1, 1) = '-' then
      while i <= n and substr(v, i, 1) <> E'\\n' loop
        v_out := v_out || ' ';
        i := i + 1;
      end loop;
      continue;
    end if;
    if ch = '/' and i < n and substr(v, i + 1, 1) = '*' then
      v_out := v_out || '  ';
      i := i + 2;
      while i < n loop
        if substr(v, i, 2) = '*/' then
          v_out := v_out || '  ';
          i := i + 2;
          exit;
        end if;
        v_out := v_out || ' ';
        i := i + 1;
      end loop;
      continue;
    end if;
    v_out := v_out || ch;
    i := i + 1;
  end loop;
  return v_out;
end;
$fn$;

-- 2) Statement splitter (dollar-quote / string / comment aware)
create or replace function public.admin_sql_split_statements_v1(p_sql text)
returns text[]
language plpgsql
immutable
as $fn$
declare
  v text := coalesce(p_sql, '');
  n int := char_length(v);
  i int := 1;
  ch text;
  buf text := '';
  out_arr text[] := array[]::text[];
  tag text;
  endtag text;
  j int;
  stripped text;
begin
  while i <= n loop
    ch := substr(v, i, 1);

    if ch = '-' and i < n and substr(v, i + 1, 1) = '-' then
      buf := buf || ch;
      i := i + 1;
      while i <= n and substr(v, i, 1) <> E'\\n' loop
        buf := buf || substr(v, i, 1);
        i := i + 1;
      end loop;
      continue;
    end if;

    if ch = '/' and i < n and substr(v, i + 1, 1) = '*' then
      buf := buf || '/*';
      i := i + 2;
      while i < n loop
        if substr(v, i, 2) = '*/' then
          buf := buf || '*/';
          i := i + 2;
          exit;
        end if;
        buf := buf || substr(v, i, 1);
        i := i + 1;
      end loop;
      continue;
    end if;

    if ch = '$' then
      j := i + 1;
      while j <= n and substr(v, j, 1) ~ '[A-Za-z0-9_]' loop
        j := j + 1;
      end loop;
      if j <= n and substr(v, j, 1) = '$' then
        tag := substr(v, i, j - i + 1);
        endtag := tag;
        buf := buf || tag;
        i := j + 1;
        while i <= n loop
          if substr(v, i, char_length(endtag)) = endtag then
            buf := buf || endtag;
            i := i + char_length(endtag);
            exit;
          end if;
          buf := buf || substr(v, i, 1);
          i := i + 1;
        end loop;
        continue;
      end if;
    end if;

    if ch = chr(39) then
      buf := buf || ch;
      i := i + 1;
      while i <= n loop
        buf := buf || substr(v, i, 1);
        if substr(v, i, 1) = chr(39) then
          if i < n and substr(v, i + 1, 1) = chr(39) then
            buf := buf || substr(v, i + 1, 1);
            i := i + 2;
            continue;
          end if;
          i := i + 1;
          exit;
        end if;
        i := i + 1;
      end loop;
      continue;
    end if;

    if ch = ';' then
      stripped := btrim(
        regexp_replace(
          regexp_replace(buf, '/\\*.*?\\*/', '', 'ng'),
          '--[^\\n]*',
          '',
          'n'
        )
      );
      if stripped <> '' then
        out_arr := out_arr || btrim(buf);
      end if;
      buf := '';
      i := i + 1;
      continue;
    end if;

    buf := buf || ch;
    i := i + 1;
  end loop;

  stripped := btrim(
    regexp_replace(
      regexp_replace(buf, '/\\*.*?\\*/', '', 'ng'),
      '--[^\\n]*',
      '',
      'n'
    )
  );
  if stripped <> '' then
    out_arr := out_arr || btrim(buf);
  end if;

  return out_arr;
end;
$fn$;

-- 3) Single-statement executor (literal-aware MULTI check)
create or replace function public.admin_sql_execute_v1(
  p_token text,
  p_sql text,
  p_confirm_mutate boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_sql text;
  v_cls jsonb;
  v_is_mutating boolean;
  v_is_selectish boolean;
  v_started timestamptz;
  v_elapsed_ms integer;
  v_row_count bigint := 0;
  v_rows jsonb := '[]'::jsonb;
  v_truncated boolean := false;
  v_audit_id bigint;
  v_err_state text;
  v_err_msg text;
  v_limit integer := 500;
  v_probe text;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  v_sql := btrim(coalesce(p_sql, ''));
  if v_sql = '' then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'SQL-WS-EMPTY',
      'message_ar', 'أدخل أمر SQL أولاً.'
    );
  end if;

  v_probe := public.admin_sql_sql_without_literals_v1(v_sql);
  v_probe := regexp_replace(v_probe, ';\\s*$', '');
  if position(';' in v_probe) > 0 then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'SQL-WS-MULTI',
      'message_ar', 'يُسمح بأمر واحد فقط في كل تنفيذ. للصيانة متعددة الأوامر: استخدم المنفّذ v2 أو «أوامر الصيانة الجاهزة».'
    );
  end if;
  v_sql := regexp_replace(v_sql, ';\\s*$', '');

  v_cls := public.admin_sql_classify_v1(v_sql);
  v_is_mutating := coalesce((v_cls->>'mutating')::boolean, false);
  v_is_selectish := coalesce((v_cls->>'selectish')::boolean, false);

  if v_is_mutating and not coalesce(p_confirm_mutate, false) then
    return jsonb_build_object(
      'ok', false,
      'needs_confirm', true,
      'error_code', 'SQL-WS-CONFIRM',
      'message_ar', 'هذا أمر يغيّر البيانات. أكّد التنفيذ للمتابعة.',
      'first_keyword', v_cls->>'first'
    );
  end if;

  v_started := clock_timestamp();

  begin
    if v_is_selectish then
      execute
        'select coalesce(jsonb_agg(to_jsonb(q)), ''[]''::jsonb), count(*)::bigint '
        || 'from (select * from (' || v_sql || ') _sql_ws_src limit '
        || (v_limit + 1)::text
        || ') q'
      into v_rows, v_row_count;

      if v_row_count > v_limit then
        v_truncated := true;
        v_row_count := v_limit;
        select coalesce(jsonb_agg(val), '[]'::jsonb)
          into v_rows
        from (
          select value as val
          from jsonb_array_elements(coalesce(v_rows, '[]'::jsonb))
          limit v_limit
        ) s;
      end if;
    else
      execute v_sql;
      get diagnostics v_row_count = row_count;
      v_rows := '[]'::jsonb;
    end if;
  exception when others then
    get stacked diagnostics
      v_err_state = returned_sqlstate,
      v_err_msg = message_text;
    v_elapsed_ms := greatest(
      0,
      (extract(epoch from (clock_timestamp() - v_started)) * 1000)::integer
    );

    begin
      v_audit_id := public.admin_audit_write_v1(
        'admin',
        left(coalesce(p_token, ''), 12),
        'sql.execute',
        'sql_workspace',
        null,
        null,
        jsonb_build_object(
          'ok', false,
          'mutating', v_is_mutating,
          'selectish', v_is_selectish,
          'first_keyword', v_cls->>'first',
          'sql_preview', left(v_sql, 400),
          'elapsed_ms', v_elapsed_ms,
          'sqlstate', v_err_state,
          'error_code', 'SQL-WS-EXEC',
          'executor', 'execute_v1'
        )
      );
    exception when others then
      v_audit_id := null;
    end;

    return jsonb_build_object(
      'ok', false,
      'error_code', 'SQL-WS-EXEC',
      'message_ar', 'تعذّر تنفيذ الأمر. راجع الصياغة أو الصلاحيات ثم أعد المحاولة.',
      'hint_ar', 'تفاصيل تقنية محفوظة في سجل التدقيق فقط.',
      'elapsed_ms', v_elapsed_ms,
      'audit_id', v_audit_id
    );
  end;

  v_elapsed_ms := greatest(
    0,
    (extract(epoch from (clock_timestamp() - v_started)) * 1000)::integer
  );

  begin
    v_audit_id := public.admin_audit_write_v1(
      'admin',
      left(coalesce(p_token, ''), 12),
      'sql.execute',
      'sql_workspace',
      null,
      null,
      jsonb_build_object(
        'ok', true,
        'mutating', v_is_mutating,
        'selectish', v_is_selectish,
        'first_keyword', v_cls->>'first',
        'sql_preview', left(v_sql, 400),
        'row_count', v_row_count,
        'truncated', v_truncated,
        'elapsed_ms', v_elapsed_ms,
        'confirmed_mutate', coalesce(p_confirm_mutate, false),
        'executor', 'execute_v1'
      )
    );
  exception when others then
    v_audit_id := null;
  end;

  return jsonb_build_object(
    'ok', true,
    'is_select', v_is_selectish,
    'is_mutating', v_is_mutating,
    'first_keyword', v_cls->>'first',
    'row_count', v_row_count,
    'truncated', v_truncated,
    'elapsed_ms', v_elapsed_ms,
    'rows', coalesce(v_rows, '[]'::jsonb),
    'audit_id', v_audit_id,
    'message_ar', 'تم التنفيذ',
    'executor', 'execute_v1'
  );
end;
$fn$;

-- 4) Multi-statement Workspace runner (no catalog hacks)
create or replace function public.admin_sql_workspace_run_v2(
  p_token text,
  p_sql text,
  p_confirm_mutate boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_raw text;
  v_stmts text[];
  v_stmt text;
  v_cls jsonb;
  v_any_mutating boolean := false;
  v_started timestamptz;
  v_elapsed_ms integer;
  v_limit integer := 500;
  v_stmt_count integer := 0;
  v_ok_count integer := 0;
  v_row_count bigint := 0;
  v_rows jsonb := '[]'::jsonb;
  v_truncated boolean := false;
  v_is_selectish boolean := false;
  v_is_mutating boolean := false;
  v_first text;
  v_audit_id bigint;
  v_err_state text;
  v_err_msg text;
  v_last_first text;
  i integer;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  v_raw := btrim(coalesce(p_sql, ''));
  if v_raw = '' then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'SQL-WS-EMPTY',
      'message_ar', 'أدخل أمر SQL أولاً.'
    );
  end if;

  v_stmts := public.admin_sql_split_statements_v1(v_raw);
  v_stmt_count := coalesce(array_length(v_stmts, 1), 0);
  if v_stmt_count < 1 then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'SQL-WS-EMPTY',
      'message_ar', 'لم يُعثر على أوامر قابلة للتنفيذ.'
    );
  end if;

  for i in 1..v_stmt_count loop
    v_cls := public.admin_sql_classify_v1(v_stmts[i]);
    if coalesce((v_cls->>'empty')::boolean, false) then
      continue;
    end if;
    if coalesce((v_cls->>'mutating')::boolean, false) then
      v_any_mutating := true;
      exit;
    end if;
  end loop;

  if v_any_mutating and not coalesce(p_confirm_mutate, false) then
    v_cls := public.admin_sql_classify_v1(v_stmts[1]);
    return jsonb_build_object(
      'ok', false,
      'needs_confirm', true,
      'error_code', 'SQL-WS-CONFIRM',
      'message_ar', 'هذا السكربت يغيّر البيانات أو المخطط. أكّد التنفيذ للمتابعة.',
      'first_keyword', v_cls->>'first',
      'statement_count', v_stmt_count
    );
  end if;

  v_started := clock_timestamp();

  for i in 1..v_stmt_count loop
    v_stmt := regexp_replace(btrim(v_stmts[i]), ';\\s*$', '');
    if v_stmt = '' then
      continue;
    end if;

    v_cls := public.admin_sql_classify_v1(v_stmt);
    if coalesce((v_cls->>'empty')::boolean, false) then
      continue;
    end if;
    v_is_mutating := coalesce((v_cls->>'mutating')::boolean, false);
    v_is_selectish := coalesce((v_cls->>'selectish')::boolean, false);
    v_first := v_cls->>'first';
    v_last_first := v_first;
    v_row_count := 0;
    v_rows := '[]'::jsonb;
    v_truncated := false;

    begin
      if v_is_selectish then
        execute
          'select coalesce(jsonb_agg(to_jsonb(q)), ''[]''::jsonb), count(*)::bigint '
          || 'from (select * from (' || v_stmt || ') _sql_ws_src limit '
          || (v_limit + 1)::text
          || ') q'
        into v_rows, v_row_count;

        if v_row_count > v_limit then
          v_truncated := true;
          v_row_count := v_limit;
          select coalesce(jsonb_agg(val), '[]'::jsonb)
            into v_rows
          from (
            select value as val
            from jsonb_array_elements(coalesce(v_rows, '[]'::jsonb))
            limit v_limit
          ) s;
        end if;
      else
        execute v_stmt;
        get diagnostics v_row_count = row_count;
        v_rows := '[]'::jsonb;
      end if;
    exception when others then
      get stacked diagnostics
        v_err_state = returned_sqlstate,
        v_err_msg = message_text;
      v_elapsed_ms := greatest(
        0,
        (extract(epoch from (clock_timestamp() - v_started)) * 1000)::integer
      );

      begin
        v_audit_id := public.admin_audit_write_v1(
          'admin',
          left(coalesce(p_token, ''), 12),
          'sql.execute',
          'sql_workspace',
          null,
          null,
          jsonb_build_object(
            'ok', false,
            'mutating', v_is_mutating,
            'selectish', v_is_selectish,
            'first_keyword', v_first,
            'sql_preview', left(v_stmt, 400),
            'elapsed_ms', v_elapsed_ms,
            'sqlstate', v_err_state,
            'error_code', 'SQL-WS-EXEC',
            'executor', 'workspace_run_v2',
            'statement_index', i,
            'statement_count', v_stmt_count,
            'ok_before_fail', v_ok_count
          )
        );
      exception when others then
        v_audit_id := null;
      end;

      return jsonb_build_object(
        'ok', false,
        'error_code', 'SQL-WS-EXEC',
        'message_ar',
          'تعذّر التنفيذ عند الأمر ' || i::text || ' / ' || v_stmt_count::text
          || '. راجع الصياغة أو الصلاحيات ثم أعد المحاولة.',
        'hint_ar', 'تفاصيل تقنية محفوظة في سجل التدقيق فقط.',
        'elapsed_ms', v_elapsed_ms,
        'audit_id', v_audit_id,
        'statement_index', i,
        'statement_count', v_stmt_count,
        'executor', 'workspace_run_v2'
      );
    end;

    v_ok_count := v_ok_count + 1;
  end loop;

  v_elapsed_ms := greatest(
    0,
    (extract(epoch from (clock_timestamp() - v_started)) * 1000)::integer
  );

  begin
    v_audit_id := public.admin_audit_write_v1(
      'admin',
      left(coalesce(p_token, ''), 12),
      'sql.execute',
      'sql_workspace',
      null,
      null,
      jsonb_build_object(
        'ok', true,
        'mutating', v_any_mutating,
        'selectish', v_is_selectish,
        'first_keyword', v_last_first,
        'sql_preview', left(v_raw, 400),
        'row_count', v_row_count,
        'truncated', v_truncated,
        'elapsed_ms', v_elapsed_ms,
        'confirmed_mutate', coalesce(p_confirm_mutate, false),
        'executor', 'workspace_run_v2',
        'statement_count', v_stmt_count,
        'statements_ok', v_ok_count
      )
    );
  exception when others then
    v_audit_id := null;
  end;

  return jsonb_build_object(
    'ok', true,
    'is_select', v_is_selectish,
    'is_mutating', v_any_mutating,
    'first_keyword', v_last_first,
    'row_count', case when v_is_selectish then v_row_count else v_ok_count end,
    'truncated', v_truncated,
    'elapsed_ms', v_elapsed_ms,
    'rows', coalesce(v_rows, '[]'::jsonb),
    'audit_id', v_audit_id,
    'message_ar', 'تم التنفيذ',
    'executor', 'workspace_run_v2',
    'statement_count', v_stmt_count,
    'statements_ok', v_ok_count
  );
end;
$fn$;

comment on function public.admin_sql_workspace_run_v2(text, text, boolean) is
  'SQL Workspace v2: admin-token gated multi-statement runner. CREATE/REPLACE only — never touches pg_proc.';

comment on function public.admin_sql_split_statements_v1(text) is
  'Split SQL script into statements; respects dollar-quotes, strings, comments.';

revoke all on function public.admin_sql_classify_v1(text) from public;
grant execute on function public.admin_sql_classify_v1(text)
  to anon, authenticated;

revoke all on function public.admin_sql_sql_without_literals_v1(text) from public;
grant execute on function public.admin_sql_sql_without_literals_v1(text)
  to anon, authenticated;

revoke all on function public.admin_sql_split_statements_v1(text) from public;
grant execute on function public.admin_sql_split_statements_v1(text)
  to anon, authenticated;

revoke all on function public.admin_sql_execute_v1(text, text, boolean) from public;
grant execute on function public.admin_sql_execute_v1(text, text, boolean)
  to anon, authenticated;

revoke all on function public.admin_sql_workspace_run_v2(text, text, boolean) from public;
grant execute on function public.admin_sql_workspace_run_v2(text, text, boolean)
  to anon, authenticated;
`,
      order: 10,
      bootstrap: true,
      supabaseOnce: true,
    },
    {
      id: "maint.push_tokens_phone_v1",
      title: "ربط جوال المندوب بإشعارات التطبيق (push_tokens.phone)",
      desc: "عمود push_tokens.phone + register_push_token_v1(p_phone). SQL مضمّن.",
      file: "../supabase/sql/COPY-ME-push-tokens-phone.sql",
      sql: `-- COPY-ME: push_tokens.phone + register_push_token_v1(p_phone)
-- Run in Supabase SQL editor (wbskjfdqpugnwvrykqcn).
-- Safe/additive: adds optional phone for branch-delegate targeted Expo push.
-- Public family broadcast push path is unchanged (still all enabled tokens).

alter table public.push_tokens
  add column if not exists phone text;

comment on column public.push_tokens.phone is
  'Optional Saudi mobile (05XXXXXXXX) bound for branch-delegate targeted push.';

create index if not exists push_tokens_phone_enabled_idx
  on public.push_tokens (phone)
  where enabled = true and phone is not null and btrim(phone) <> '';

-- Normalize Arabic/Persian/fullwidth digits then keep digits only.
create or replace function public.push_tokens_norm_phone(p text)
returns text
language plpgsql
immutable
as $$
declare
  s text := coalesce(p, '');
  i int;
  ch text;
  code int;
  out text := '';
begin
  for i in 1..char_length(s) loop
    ch := substr(s, i, 1);
    code := ascii(ch);
    if code >= 1632 and code <= 1641 then -- Arabic-Indic ٠-٩
      out := out || chr(code - 1632 + 48);
    elsif code >= 1776 and code <= 1785 then -- Eastern Arabic-Indic ۰-۹
      out := out || chr(code - 1776 + 48);
    elsif code >= 65296 and code <= 65305 then -- Fullwidth ０-９
      out := out || chr(code - 65296 + 48);
    else
      out := out || ch;
    end if;
  end loop;
  out := regexp_replace(out, '\\D', '', 'g');
  if out like '00966%' and char_length(out) = 14 and substr(out, 6, 1) = '5' then
    return '0' || substr(out, 6);
  end if;
  if out like '966%' and char_length(out) = 12 and substr(out, 4, 1) = '5' then
    return '0' || substr(out, 4);
  end if;
  if char_length(out) = 9 and substr(out, 1, 1) = '5' then
    return '0' || out;
  end if;
  return out;
end;
$$;

-- Replace 4-arg overload so optional p_phone works without ambiguity.
drop function if exists public.register_push_token_v1(text, text, text, text);
drop function if exists public.register_push_token_v1(text, text, text, text, text);

create or replace function public.register_push_token_v1(
  p_token text,
  p_platform text,
  p_device_name text default null,
  p_app_version text default null,
  p_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text := btrim(coalesce(p_token, ''));
  v_phone text := nullif(public.push_tokens_norm_phone(p_phone), '');
begin
  if v_token = '' then
    return jsonb_build_object('ok', false, 'error', 'missing_token');
  end if;

  insert into public.push_tokens as t (
    token, platform, device_name, app_version, phone, enabled, updated_at
  )
  values (
    v_token,
    nullif(btrim(coalesce(p_platform, '')), ''),
    p_device_name,
    p_app_version,
    v_phone,
    true,
    now()
  )
  on conflict (token) do update set
    platform = excluded.platform,
    device_name = excluded.device_name,
    app_version = excluded.app_version,
    -- Keep prior binding if this registration omits phone.
    phone = coalesce(excluded.phone, t.phone),
    enabled = true,
    updated_at = now();

  return jsonb_build_object('ok', true, 'phone', v_phone);
end;
$$;

revoke all on function public.register_push_token_v1(text, text, text, text, text) from public;
grant execute on function public.register_push_token_v1(text, text, text, text, text) to anon, authenticated;
grant execute on function public.push_tokens_norm_phone(text) to anon, authenticated;
`,
      order: 12,
      supabaseOnce: true,
    },
    {
      id: "maint.public_app_login_by_phone_v1",
      title: "دخول التطبيق بالجوال للعضو أو المندوب (ربط الإشعار)",
      desc: "RPC public_app_login_by_phone_v1: يقبل رقم عضو أو مندوب مفعّل لربط push_tokens.phone بعد التسجيل.",
      file: "../supabase/sql/COPY-ME-public-app-login-by-phone.sql",
      sql: `-- COPY-ME: public_app_login_by_phone_v1
-- Safe/additive: member_profiles OR enabled delegates_v2 login for push phone bind.

create or replace function public.public_app_login_by_phone_v1(p_phone text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_phone text := nullif(public.push_tokens_norm_phone(p_phone), '');
  v_member public.member_profiles%rowtype;
  v_delegate public.delegates_v2%rowtype;
  v_has_member boolean := false;
  v_has_delegate boolean := false;
  v_role text := 'none';
begin
  if v_phone is null or char_length(v_phone) < 9 then
    return jsonb_build_object('ok', false, 'error', 'bad_phone');
  end if;

  if to_regclass('public.member_profiles') is not null then
    select m.*
      into v_member
    from public.member_profiles m
    where public.push_tokens_norm_phone(m.phone) = v_phone
    order by m.id desc
    limit 1;
    v_has_member := found;
  end if;

  if to_regclass('public.delegates_v2') is not null then
    select d.*
      into v_delegate
    from public.delegates_v2 d
    where coalesce(d.is_enabled, true) = true
      and public.push_tokens_norm_phone(d.phone) = v_phone
    order by d.updated_at desc nulls last, d.created_at desc nulls last
    limit 1;
    v_has_delegate := found;
  end if;

  if not v_has_member and not v_has_delegate then
    return jsonb_build_object('ok', false, 'error', 'not_found', 'phone', v_phone);
  end if;

  if v_has_member and v_has_delegate then
    v_role := 'both';
  elsif v_has_delegate then
    v_role := 'delegate';
  else
    v_role := 'member';
  end if;

  return jsonb_build_object(
    'ok', true,
    'role', v_role,
    'phone', v_phone,
    'member_id', case when v_has_member then v_member.id else null end,
    'tree_child_id', case when v_has_member then v_member.tree_child_id else null end,
    'person_id', case when v_has_member then v_member.person_id else null end,
    'branch_key', coalesce(
      nullif(btrim(coalesce(case when v_has_member then v_member.branch_key else null end, '')), ''),
      nullif(btrim(coalesce(case when v_has_delegate then v_delegate.branch_key else null end, '')), '')
    ),
    'display_name', coalesce(
      nullif(btrim(coalesce(case when v_has_member then v_member.display_name else null end, '')), ''),
      nullif(btrim(coalesce(case when v_has_delegate then v_delegate.name else null end, '')), ''),
      'مندوب الفرع'
    ),
    'delegate_id', case when v_has_delegate then v_delegate.id else null end,
    'delegate_role_key', case when v_has_delegate then v_delegate.role_key else null end,
    'is_delegate', v_has_delegate,
    'is_member', v_has_member
  );
end;
$$;

revoke all on function public.public_app_login_by_phone_v1(text) from public;
grant execute on function public.public_app_login_by_phone_v1(text) to anon, authenticated;
`,
      order: 12.5,
      supabaseOnce: true,
    },
    {
      id: "maint.push_send_dedupe_v1",
      title: "منع تكرار إشعار نفس الطلب لنفس الجهاز (push_send_dedupe)",
      desc: "جدول push_send_dedupe. الدالة تستخدم ذاكرة مؤقتة حتى بدون الجدول.",
      file: "../supabase/sql/COPY-ME-push-send-dedupe.sql",
      sql: `-- COPY-ME: push_send_dedupe (event_key + token)
create table if not exists public.push_send_dedupe (
  event_key text not null,
  token text not null,
  created_at timestamptz not null default now(),
  primary key (event_key, token)
);
create index if not exists push_send_dedupe_created_at_idx
  on public.push_send_dedupe (created_at);
alter table public.push_send_dedupe enable row level security;
revoke all on table public.push_send_dedupe from anon, authenticated;
`,
      order: 13,
      supabaseOnce: true,
    },
    {
      id: "maint.fix_delegate_portal_path_v1",
      title: "إصلاح دخول المندوب بعد القبول (بوابة 1)",
      desc: "تفعيل/مزامنة delegates_v2 عند اعتماد طلب مندوب + request_id في check_*.",
      file: "../supabase/sql/COPY-ME-fix-delegate-portal-path.sql",
      sql: `-- Operator path: Admin → SQL Workspace → أوامر الصيانة الجاهزة
-- Preset id: maint.fix_delegate_portal_path_v1
-- Source of truth file (do not prefer external paste).

-- =============================================================================
-- FIX: Delegate portal path after approve (Gate 1)
-- Safe to re-run.
--
-- Root cause:
--   1) Admin «قبول» updates approval_requests (Legacy) only — does NOT upsert
--      delegates_v2, so login (which prefers v2) is out of sync.
--   2) check_*_delegate_access v2 success omitted request_id; portal JS treated
--      that as verification failure → «تعذر التحقق من بيانات الدخول حاليًا».
--
-- This script:
--   A) Upserts/activates delegates_v2 from an approved tree/events request
--   B) Trigger: any Legacy status→approved for those kinds activates v2
--   C) Fixes check_tree/events_delegate_access to return request_id on v2
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A) Activate / upsert delegates_v2 from one approval_requests row (by pk id)
-- -----------------------------------------------------------------------------
-- NOTE: Prefer COPY-ME-delegates-v2-dual-role-activate.sql / sync-email preset
-- (includes dual-intent message → full_delegate + email sync). Kept in sync here.
create or replace function public.delegates_v2_activate_from_request_pk_v1(
  p_request_pk bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.approval_requests%rowtype;
  v_tree public.approval_requests%rowtype;
  v_events public.approval_requests%rowtype;
  v_branch text;
  v_phone text;
  v_email text;
  v_id uuid;
  v_role text;
  v_enabled boolean;
  v_hash text;
  v_name text;
  v_email_store text;
  v_msg_json jsonb;
  v_roles jsonb;
  v_tree_status text;
  v_events_status text;
  v_tree_rid text;
  v_events_rid text;
  v_dual_from_message boolean := false;
  v_marker int;
  v_json_text text;
begin
  if to_regclass('public.delegates_v2') is null then
    return jsonb_build_object('ok', false, 'reason', 'no_v2_schema');
  end if;

  if p_request_pk is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;

  select * into v_req
  from public.approval_requests
  where id = p_request_pk
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_req.kind is null
     or v_req.kind not in ('tree_delegate', 'events_delegate') then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'not_delegate_kind');
  end if;

  v_branch := public.delegates_v2_norm_branch(v_req.branch_key);
  v_phone := public.delegates_v2_norm_phone(v_req.phone);
  v_email := public.delegates_v2_norm_email(v_req.email);

  if v_branch = '' or v_phone = '' then
    return jsonb_build_object('ok', false, 'reason', 'missing_identity');
  end if;

  select * into v_tree
  from public.approval_requests r
  where r.kind = 'tree_delegate'
    and public.delegates_v2_norm_branch(r.branch_key) = v_branch
    and public.delegates_v2_norm_phone(r.phone) = v_phone
    and (
      v_email = ''
      or public.delegates_v2_norm_email(r.email) = ''
      or public.delegates_v2_norm_email(r.email) = v_email
    )
  order by r.created_at desc nulls last
  limit 1;

  select * into v_events
  from public.approval_requests r
  where r.kind = 'events_delegate'
    and public.delegates_v2_norm_branch(r.branch_key) = v_branch
    and public.delegates_v2_norm_phone(r.phone) = v_phone
    and (
      v_email = ''
      or public.delegates_v2_norm_email(r.email) = ''
      or public.delegates_v2_norm_email(r.email) = v_email
    )
  order by r.created_at desc nulls last
  limit 1;

  v_tree_status := coalesce(v_tree.status, '');
  v_events_status := coalesce(v_events.status, '');
  v_tree_rid := nullif(btrim(coalesce(v_tree.request_id, '')), '');
  v_events_rid := nullif(btrim(coalesce(v_events.request_id, '')), '');

  v_msg_json := null;
  begin
    v_marker := position('__JSON__:' in coalesce(v_req.message, ''));
    if v_marker > 0 then
      v_json_text := btrim(substring(v_req.message from v_marker + length('__JSON__:')));
      if v_json_text <> '' then
        v_msg_json := v_json_text::jsonb;
      end if;
    end if;
  exception when others then
    v_msg_json := null;
  end;

  if coalesce(v_req.status, '') = 'approved' and v_msg_json is not null then
    v_roles := coalesce(v_msg_json->'delegate_roles', '[]'::jsonb);
    if jsonb_typeof(v_roles) = 'array'
       and v_roles @> '["tree_delegate"]'::jsonb
       and v_roles @> '["events_delegate"]'::jsonb then
      v_dual_from_message := true;
      if v_tree_rid is null then
        v_tree_status := 'approved';
        v_tree_rid := nullif(btrim(coalesce(v_req.request_id, '')), '');
      elsif v_tree_status <> 'approved' and v_req.kind = 'tree_delegate' then
        v_tree_status := 'approved';
        v_tree_rid := nullif(btrim(coalesce(v_req.request_id, '')), '');
      end if;
      if v_events_rid is null then
        v_events_status := 'approved';
        v_events_rid := nullif(btrim(coalesce(v_req.request_id, '')), '');
      elsif v_events_status <> 'approved' and v_req.kind = 'events_delegate' then
        v_events_status := 'approved';
        v_events_rid := nullif(btrim(coalesce(v_req.request_id, '')), '');
      end if;
    end if;
  end if;

  v_role := public.delegates_v2_infer_role(v_tree_status, v_events_status);
  v_enabled := (v_tree_status = 'approved' or v_events_status = 'approved');
  v_hash := nullif(btrim(coalesce(
    case
      when v_req.kind = 'tree_delegate' then v_req.secret_hash
      else coalesce(v_events.secret_hash, v_tree.secret_hash, v_req.secret_hash)
    end,
    ''
  )), '');
  if v_hash is null then
    v_hash := nullif(btrim(coalesce(v_tree.secret_hash, v_events.secret_hash, '')), '');
  end if;
  v_name := nullif(btrim(coalesce(v_req.name, v_tree.name, v_events.name, '')), '');
  v_email_store := nullif(lower(btrim(coalesce(
    nullif(btrim(coalesce(v_req.email, '')), ''),
    nullif(btrim(coalesce(v_tree.email, '')), ''),
    nullif(btrim(coalesce(v_events.email, '')), ''),
    ''
  ))), '');

  select d.id into v_id
  from public.delegates_v2 d
  where public.delegates_v2_norm_branch(d.branch_key) = v_branch
    and public.delegates_v2_norm_phone(d.phone) = v_phone
    and (
      v_email = ''
      or public.delegates_v2_norm_email(d.email) = ''
      or public.delegates_v2_norm_email(d.email) = v_email
    )
  order by d.updated_at desc nulls last, d.created_at desc nulls last
  limit 1;

  if v_id is null then
    insert into public.delegates_v2 (
      branch_key, name, phone, email, secret_hash, role_key, is_enabled,
      tree_request_id, events_request_id, updated_at
    ) values (
      nullif(btrim(v_req.branch_key), ''),
      v_name,
      nullif(btrim(v_req.phone), ''),
      v_email_store,
      v_hash,
      v_role,
      v_enabled,
      v_tree_rid,
      v_events_rid,
      now()
    )
    returning id into v_id;
  else
    update public.delegates_v2 d
    set
      name = coalesce(v_name, d.name),
      email = coalesce(v_email_store, d.email),
      secret_hash = coalesce(v_hash, d.secret_hash),
      role_key = v_role,
      is_enabled = v_enabled,
      tree_request_id = coalesce(v_tree_rid, d.tree_request_id),
      events_request_id = coalesce(v_events_rid, d.events_request_id),
      updated_at = now()
    where d.id = v_id;
  end if;

  perform public.admin_audit_write_v1(
    'system',
    'approve_activate',
    'delegate.activate_from_request',
    'delegates_v2',
    v_id::text,
    nullif(btrim(v_req.branch_key), ''),
    jsonb_build_object(
      'request_pk', p_request_pk,
      'request_id', v_req.request_id,
      'kind', v_req.kind,
      'status', v_req.status,
      'role_key', v_role,
      'is_enabled', v_enabled,
      'email', v_email_store,
      'dual_from_message', v_dual_from_message,
      'at', now()
    )
  );

  return jsonb_build_object(
    'ok', true,
    'delegate_id', v_id,
    'role_key', v_role,
    'is_enabled', v_enabled,
    'has_secret', v_hash is not null,
    'dual_from_message', v_dual_from_message,
    'tree_request_id', v_tree_rid,
    'events_request_id', v_events_rid
  );
end;
$$;

-- Admin-token wrapper (callable from requests UI after قبول)
create or replace function public.admin_delegates_v2_activate_from_request_v1(
  p_token text,
  p_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pk bigint;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;
  begin
    v_pk := trim(coalesce(p_id, ''))::bigint;
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'bad_id');
  end;
  return public.delegates_v2_activate_from_request_pk_v1(v_pk);
end;
$$;

-- -----------------------------------------------------------------------------
-- B) Trigger: Legacy approve/reject of delegate kinds keeps delegates_v2 in sync
-- -----------------------------------------------------------------------------
create or replace function public.delegates_v2_approval_requests_sync_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if to_regclass('public.delegates_v2') is null then
    return new;
  end if;

  if new.kind is null
     or new.kind not in ('tree_delegate', 'events_delegate') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status in ('approved', 'rejected') then
      perform public.delegates_v2_activate_from_request_pk_v1(new.id);
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.status is distinct from old.status
       and new.status in ('approved', 'rejected') then
      perform public.delegates_v2_activate_from_request_pk_v1(new.id);
    elsif new.status = 'approved'
      and (
        new.secret_hash is distinct from old.secret_hash
        or new.phone is distinct from old.phone
        or new.branch_key is distinct from old.branch_key
      ) then
      perform public.delegates_v2_activate_from_request_pk_v1(new.id);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_delegates_v2_approval_requests_sync
  on public.approval_requests;

create trigger trg_delegates_v2_approval_requests_sync
after insert or update of status, secret_hash, phone, branch_key
on public.approval_requests
for each row
execute function public.delegates_v2_approval_requests_sync_trg();

-- Backfill: activate any already-approved delegate requests missing/outdated v2
do $$
declare
  r record;
begin
  if to_regclass('public.delegates_v2') is null then
    return;
  end if;
  for r in
    select id
    from public.approval_requests
    where kind in ('tree_delegate', 'events_delegate')
      and status = 'approved'
    order by created_at desc nulls last
    limit 2000
  loop
    perform public.delegates_v2_activate_from_request_pk_v1(r.id);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- C) check_tree_delegate_access — include request_id on v2 success (login key)
-- -----------------------------------------------------------------------------
create or replace function public.check_tree_delegate_access(
  p_branch_key text,
  p_phone text,
  p_email text,
  p_secret_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_check jsonb;
  v_ok text;
  r record;
  v_write jsonb;
  v_req_id text;
  v_phone text;
  v_email text;
begin
  v_check := public.delegate_v2_check_op_v1(
    p_branch_key, p_phone, p_email, p_secret_hash, 'tree.read'
  );
  v_ok := v_check->>'ok';

  if v_ok = 'true' then
    v_write := public.delegate_v2_check_op_v1(
      p_branch_key, p_phone, p_email, p_secret_hash, 'tree.write'
    );
    select
      nullif(btrim(coalesce(d.tree_request_id, d.events_request_id, '')), ''),
      nullif(btrim(coalesce(d.phone, '')), ''),
      nullif(btrim(coalesce(d.email, '')), '')
      into v_req_id, v_phone, v_email
    from public.delegates_v2 d
    where d.id::text = nullif(btrim(coalesce(v_check->>'delegate_id', '')), '')
    limit 1;

    return jsonb_build_object(
      'allowed', true,
      'status', 'approved',
      'source', 'v2',
      'reason', null,
      'delegate_id', v_check->>'delegate_id',
      'role_key', v_check->>'role_key',
      'branch_key', coalesce(v_check->>'branch_key', p_branch_key),
      'request_id', coalesce(v_req_id, v_check->>'delegate_id'),
      'phone', coalesce(v_phone, p_phone),
      'email', coalesce(v_email, p_email),
      'operations', jsonb_build_object(
        'tree.read', true,
        'tree.write', coalesce((v_write->>'ok')::boolean, false)
      )
    );
  end if;

  if v_ok = 'false' then
    return jsonb_build_object(
      'allowed', false,
      'status', case
        when v_check->>'reason' = 'disabled' then 'disabled'
        when v_check->>'reason' = 'bad_secret' then 'approved'
        else coalesce(v_check->>'reason', 'denied')
      end,
      'source', 'v2',
      'reason', v_check->>'reason',
      'operation_key', v_check->>'operation_key',
      'role_key', v_check->>'role_key',
      'delegate_id', v_check->>'delegate_id',
      'request_id', null
    );
  end if;

  -- Legacy path (only when no delegates_v2 row for identity)
  select request_id, status, branch_key, phone, email, secret_hash
  into r
  from public.approval_requests
  where kind = 'tree_delegate'
    and public.delegates_v2_norm_branch(branch_key)
      = public.delegates_v2_norm_branch(p_branch_key)
    and public.delegates_v2_norm_phone(phone)
      = public.delegates_v2_norm_phone(p_phone)
  order by created_at desc
  limit 1;

  if not found then
    -- events-only approved delegates: allow portal login via events.read
    v_check := public.delegate_v2_check_op_v1(
      p_branch_key, p_phone, p_email, p_secret_hash, 'events.read'
    );
    if (v_check->>'ok') = 'true' then
      select
        nullif(btrim(coalesce(d.events_request_id, d.tree_request_id, '')), ''),
        nullif(btrim(coalesce(d.phone, '')), ''),
        nullif(btrim(coalesce(d.email, '')), '')
      into v_req_id, v_phone, v_email
      from public.delegates_v2 d
      where d.id::text = nullif(btrim(coalesce(v_check->>'delegate_id', '')), '')
      limit 1;
      return jsonb_build_object(
        'allowed', true,
        'status', 'approved',
        'source', 'v2',
        'reason', null,
        'delegate_id', v_check->>'delegate_id',
        'role_key', v_check->>'role_key',
        'branch_key', coalesce(v_check->>'branch_key', p_branch_key),
        'request_id', coalesce(v_req_id, v_check->>'delegate_id'),
        'phone', coalesce(v_phone, p_phone),
        'email', coalesce(v_email, p_email),
        'operations', jsonb_build_object('tree.read', false, 'tree.write', false, 'events.read', true)
      );
    end if;

    select ar.request_id, ar.status, ar.branch_key, ar.phone, ar.email, ar.secret_hash
    into r
    from public.approval_requests ar
    where ar.kind = 'events_delegate'
      and public.delegates_v2_norm_branch(ar.branch_key)
        = public.delegates_v2_norm_branch(p_branch_key)
      and public.delegates_v2_norm_phone(ar.phone)
        = public.delegates_v2_norm_phone(p_phone)
    order by ar.created_at desc
    limit 1;

    if not found then
      return jsonb_build_object(
        'allowed', false,
        'status', 'not_found',
        'source', 'legacy',
        'reason', 'not_found'
      );
    end if;
  end if;

  if r.status <> 'approved' then
    return jsonb_build_object(
      'allowed', false,
      'status', r.status,
      'source', 'legacy',
      'reason', r.status,
      'request_id', r.request_id
    );
  end if;

  if coalesce(r.secret_hash, '') <> coalesce(p_secret_hash, '') then
    return jsonb_build_object(
      'allowed', false,
      'status', 'approved',
      'source', 'legacy',
      'reason', 'bad_secret',
      'request_id', r.request_id
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'status', 'approved',
    'source', 'legacy',
    'reason', null,
    'request_id', r.request_id,
    'branch_key', r.branch_key,
    'phone', r.phone,
    'email', r.email,
    'operations', jsonb_build_object('tree.read', true, 'tree.write', true)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- check_events_delegate_access — include request_id on v2 success
-- -----------------------------------------------------------------------------
create or replace function public.check_events_delegate_access(
  p_branch_key text,
  p_phone text,
  p_email text,
  p_secret_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_check jsonb;
  v_ok text;
  v_row record;
  v_allowed boolean := false;
  v_write jsonb;
  v_req_id text;
begin
  v_check := public.delegate_v2_check_op_v1(
    p_branch_key, p_phone, p_email, p_secret_hash, 'events.read'
  );
  v_ok := v_check->>'ok';

  if v_ok = 'true' then
    v_write := public.delegate_v2_check_op_v1(
      p_branch_key, p_phone, p_email, p_secret_hash, 'events.write'
    );
    select nullif(btrim(coalesce(d.events_request_id, d.tree_request_id, '')), '')
    into v_req_id
    from public.delegates_v2 d
    where d.id::text = nullif(btrim(coalesce(v_check->>'delegate_id', '')), '')
    limit 1;

    return jsonb_build_object(
      'allowed', true,
      'status', 'approved',
      'source', 'v2',
      'reason', null,
      'delegate_id', v_check->>'delegate_id',
      'role_key', v_check->>'role_key',
      'request_id', coalesce(v_req_id, v_check->>'delegate_id'),
      'operations', jsonb_build_object(
        'events.read', true,
        'events.write', coalesce((v_write->>'ok')::boolean, false)
      )
    );
  end if;

  if v_ok = 'false' then
    return jsonb_build_object(
      'allowed', false,
      'status', case
        when v_check->>'reason' = 'disabled' then 'disabled'
        when v_check->>'reason' = 'bad_secret' then 'approved'
        else coalesce(v_check->>'reason', 'denied')
      end,
      'source', 'v2',
      'reason', v_check->>'reason',
      'operation_key', v_check->>'operation_key',
      'role_key', v_check->>'role_key',
      'delegate_id', v_check->>'delegate_id',
      'request_id', null
    );
  end if;

  select r.request_id, r.status, r.secret_hash
  into v_row
  from public.approval_requests r
  where r.kind in ('events_delegate', 'tree_delegate')
    and public.delegates_v2_norm_branch(r.branch_key)
      = public.delegates_v2_norm_branch(p_branch_key)
    and public.delegates_v2_norm_phone(r.phone)
      = public.delegates_v2_norm_phone(p_phone)
    and (
      nullif(btrim(coalesce(p_email, '')), '') is null
      or public.delegates_v2_norm_email(r.email)
         = public.delegates_v2_norm_email(p_email)
    )
  order by r.created_at desc
  limit 1;

  if v_row.request_id is null then
    return jsonb_build_object(
      'allowed', false,
      'status', null,
      'source', 'legacy',
      'reason', 'not_found',
      'request_id', null
    );
  end if;

  if v_row.status = 'approved' then
    select public.events_delegate_allowed_legacy_v1(
      p_branch_key, p_phone, p_email, p_secret_hash
    ) into v_allowed;
  end if;

  return jsonb_build_object(
    'allowed', coalesce(v_allowed, false),
    'status', v_row.status,
    'source', 'legacy',
    'reason', case
      when coalesce(v_allowed, false) then null
      when v_row.status = 'approved' then 'bad_secret'
      else v_row.status
    end,
    'request_id', v_row.request_id
  );
end;
$$;

grant execute on function public.delegates_v2_activate_from_request_pk_v1(bigint)
  to anon, authenticated;
grant execute on function public.admin_delegates_v2_activate_from_request_v1(text, text)
  to anon, authenticated;
grant execute on function public.check_tree_delegate_access(text, text, text, text)
  to anon, authenticated;
grant execute on function public.check_events_delegate_access(text, text, text, text)
  to anon, authenticated;
`,
      order: 20,
    },
    {
      id: "maint.delegate_secret_reset_v1",
      title: "طلب إعادة تعيين الرقم السري (واجهة مخصصة)",
      desc: "نية منفصلة delegate_secret_reset + اعتماد/رفض يحدّثون الرقم السري.",
      file: "../supabase/sql/COPY-ME-delegate-secret-reset.sql",
      sql: `-- Operator path: Admin → SQL Workspace → أوامر الصيانة الجاهزة
-- Preset id: maint.delegate_secret_reset_v1
-- Source of truth file (do not prefer external paste).

-- Keep this file as source of truth. Prefer Workspace over external paste.
-- =============================================================================
-- FIX: Dedicated delegate secret-reset intent (not generic Workflow chrome)
-- Safe to re-run. Operator path: Admin → SQL Workspace → أوامر الصيانة الجاهزة.
-- Source of truth for preset id: maint.delegate_secret_reset_v1
-- =============================================================================

create or replace function public.delegate_secret_reset_norm_branch(p text)
returns text language sql immutable as $$
  select regexp_replace(btrim(coalesce(p, '')), '\\s+', ' ', 'g');
$$;

create or replace function public.delegate_secret_reset_norm_phone(p text)
returns text language sql immutable as $$
  select regexp_replace(btrim(coalesce(p, '')), '\\s+', '', 'g');
$$;

create or replace function public.delegate_secret_reset_norm_email(p text)
returns text language sql immutable as $$
  select lower(regexp_replace(btrim(coalesce(p, '')), '\\s+', '', 'g'));
$$;

create or replace function public.delegate_secret_reset_submit_v1(
  p_branch_key text,
  p_phone text,
  p_email text,
  p_secret_hash text,
  p_request_id text default null,
  p_message text default null,
  p_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch text := public.delegate_secret_reset_norm_branch(p_branch_key);
  v_phone text := public.delegate_secret_reset_norm_phone(p_phone);
  v_email text := public.delegate_secret_reset_norm_email(p_email);
  v_hash text := nullif(btrim(coalesce(p_secret_hash, '')), '');
  v_req_id text := nullif(btrim(coalesce(p_request_id, '')), '');
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
  v_delegate_name text;
  v_has_identity boolean := false;
  v_pending_id text;
  v_now timestamptz := now();
  v_pk bigint;
  v_deep text;
begin
  if v_branch = '' or v_phone = '' or v_hash is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;

  if to_regclass('public.delegates_v2') is not null then
    select d.name into v_delegate_name
    from public.delegates_v2 d
    where public.delegate_secret_reset_norm_branch(d.branch_key) = v_branch
      and public.delegate_secret_reset_norm_phone(d.phone) = v_phone
      and (
        v_email = ''
        or public.delegate_secret_reset_norm_email(d.email) = ''
        or public.delegate_secret_reset_norm_email(d.email) = v_email
      )
      and coalesce(d.is_enabled, true) = true
    order by d.updated_at desc nulls last
    limit 1;
    if found then
      v_has_identity := true;
    end if;
  end if;

  if not v_has_identity then
    select r.name into v_delegate_name
    from public.approval_requests r
    where r.kind in ('tree_delegate', 'events_delegate')
      and r.status = 'approved'
      and public.delegate_secret_reset_norm_branch(r.branch_key) = v_branch
      and public.delegate_secret_reset_norm_phone(r.phone) = v_phone
      and (
        v_email = ''
        or public.delegate_secret_reset_norm_email(r.email) = ''
        or public.delegate_secret_reset_norm_email(r.email) = v_email
      )
    order by r.created_at desc nulls last
    limit 1;
    if found then
      v_has_identity := true;
    end if;
  end if;

  if not v_has_identity then
    return jsonb_build_object('ok', false, 'reason', 'not_a_delegate');
  end if;

  select r.request_id into v_pending_id
  from public.approval_requests r
  where r.kind = 'delegate_secret_reset'
    and r.status = 'pending'
    and public.delegate_secret_reset_norm_branch(r.branch_key) = v_branch
    and public.delegate_secret_reset_norm_phone(r.phone) = v_phone
  order by r.created_at desc nulls last
  limit 1;

  if v_pending_id is not null then
    return jsonb_build_object(
      'ok', false,
      'reason', 'duplicate_pending',
      'request_id', v_pending_id
    );
  end if;

  if v_req_id is null then
    v_req_id := 'SRS-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4))
      || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 5, 4));
  end if;

  if v_name is null then
    v_name := nullif(btrim(coalesce(v_delegate_name, '')), '');
  end if;

  if v_msg is null then
    v_msg := 'طلب إعادة تعيين الرقم السري للمندوب'
      || E'\\n' || 'رقم الطلب: ' || v_req_id
      || E'\\n' || 'الفرع: ' || v_branch
      || E'\\n' || 'الجوال: ' || v_phone
      || E'\\n' || 'بانتظار الإدارة';
  end if;

  if position('delegate_secret_reset' in v_msg) = 0 then
    v_msg := v_msg || E'\\n__JSON__:' || jsonb_build_object(
      'v', 1,
      'kind', 'delegate_secret_reset',
      'intent', 'secret_reset',
      'at', v_now
    )::text;
  end if;

  v_deep := 'module=requests&request=' || v_req_id;
  begin
    v_deep := public.workflow_deep_link_for_v1(v_req_id);
  exception when others then
    v_deep := 'module=requests&request=' || v_req_id;
  end;

  insert into public.approval_requests (
    request_id, kind, branch_key, name, phone, email, secret_hash,
    message, status, created_at, request_type, wf_state, wf_deep_link, wf_updated_at
  ) values (
    v_req_id,
    'delegate_secret_reset',
    nullif(btrim(p_branch_key), ''),
    v_name,
    nullif(btrim(p_phone), ''),
    nullif(lower(btrim(coalesce(p_email, ''))), ''),
    v_hash,
    v_msg,
    'pending',
    v_now,
    'delegate_secret_reset',
    null,
    v_deep,
    v_now
  )
  returning id into v_pk;

  begin
    if to_regclass('public.workflow_notification_events') is not null then
      insert into public.workflow_notification_events (
        request_id, request_pk, event_key, recipient_hint, channel, payload
      ) values (
        v_req_id, v_pk, 'secret_reset.submitted', 'admin', 'log',
        jsonb_build_object('kind', 'delegate_secret_reset', 'branch_key', v_branch, 'phone', v_phone, 'at', v_now)
      );
    end if;
  exception when others then null;
  end;

  return jsonb_build_object('ok', true, 'request_id', v_req_id, 'id', v_pk, 'name', v_name);
end;
$$;

create or replace function public.admin_delegate_secret_reset_approve_v1(
  p_token text,
  p_id text,
  p_secret_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pk bigint;
  v_req public.approval_requests%rowtype;
  v_hash text;
  v_branch text;
  v_phone text;
  v_email text;
  v_legacy_n int := 0;
  v_v2_n int := 0;
  v_delegate_id uuid;
  v_notify_channel text := 'admin_copy_only';
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  begin
    v_pk := trim(coalesce(p_id, ''))::bigint;
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'bad_id');
  end;

  select * into v_req from public.approval_requests where id = v_pk for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_req.kind is distinct from 'delegate_secret_reset' then
    return jsonb_build_object('ok', false, 'reason', 'wrong_kind');
  end if;
  if v_req.status = 'approved' then
    return jsonb_build_object('ok', true, 'already', true, 'request_id', v_req.request_id, 'notify_channel', v_notify_channel);
  end if;
  if v_req.status is distinct from 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'not_pending', 'status', v_req.status);
  end if;

  v_hash := nullif(btrim(coalesce(p_secret_hash, v_req.secret_hash, '')), '');
  if v_hash is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_secret_hash');
  end if;

  v_branch := public.delegate_secret_reset_norm_branch(v_req.branch_key);
  v_phone := public.delegate_secret_reset_norm_phone(v_req.phone);
  v_email := public.delegate_secret_reset_norm_email(v_req.email);

  update public.approval_requests r
  set secret_hash = v_hash
  where r.kind in ('tree_delegate', 'events_delegate')
    and r.status = 'approved'
    and public.delegate_secret_reset_norm_branch(r.branch_key) = v_branch
    and public.delegate_secret_reset_norm_phone(r.phone) = v_phone
    and (
      v_email = ''
      or public.delegate_secret_reset_norm_email(r.email) = ''
      or public.delegate_secret_reset_norm_email(r.email) = v_email
    );
  get diagnostics v_legacy_n = row_count;

  if to_regclass('public.delegates_v2') is not null then
    update public.delegates_v2 d
    set secret_hash = v_hash, updated_at = now()
    where public.delegate_secret_reset_norm_branch(d.branch_key) = v_branch
      and public.delegate_secret_reset_norm_phone(d.phone) = v_phone
      and (
        v_email = ''
        or public.delegate_secret_reset_norm_email(d.email) = ''
        or public.delegate_secret_reset_norm_email(d.email) = v_email
      );
    get diagnostics v_v2_n = row_count;

    select d.id into v_delegate_id
    from public.delegates_v2 d
    where public.delegate_secret_reset_norm_branch(d.branch_key) = v_branch
      and public.delegate_secret_reset_norm_phone(d.phone) = v_phone
    order by d.updated_at desc nulls last
    limit 1;
  end if;

  if v_legacy_n = 0 and v_v2_n = 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_delegate_target');
  end if;

  update public.approval_requests
  set
    status = 'approved',
    secret_hash = v_hash,
    request_type = 'delegate_secret_reset',
    wf_state = 'done',
    wf_updated_at = now()
  where id = v_pk;

  begin
    perform public.admin_audit_write_v1(
      'admin', 'admin_token', 'delegate.secret_reset_approve', 'approval_request',
      v_req.request_id, nullif(btrim(v_req.branch_key), ''),
      jsonb_build_object('request_pk', v_pk, 'legacy_updated', v_legacy_n, 'v2_updated', v_v2_n, 'delegate_id', v_delegate_id, 'at', now())
    );
  exception when others then null;
  end;

  begin
    if to_regclass('public.workflow_notification_events') is not null then
      insert into public.workflow_notification_events (
        request_id, request_pk, event_key, recipient_hint, channel, payload
      ) values (
        v_req.request_id, v_pk, 'secret_reset.approved', 'submitter', 'log',
        jsonb_build_object('kind', 'delegate_secret_reset', 'legacy_updated', v_legacy_n, 'v2_updated', v_v2_n, 'note', 'no_guaranteed_push_channel', 'at', now())
      );
      v_notify_channel := 'log';
    end if;
  exception when others then
    v_notify_channel := 'admin_copy_only';
  end;

  return jsonb_build_object(
    'ok', true,
    'request_id', v_req.request_id,
    'legacy_updated', v_legacy_n,
    'v2_updated', v_v2_n,
    'delegate_id', v_delegate_id,
    'notify_channel', v_notify_channel,
    'notify_limitation', 'لا قناة إشعار مضمونة للمندوب — انسخ الرقم السري مرة واحدة وأبلغه يدويًا إن لزم.'
  );
end;
$$;

create or replace function public.admin_delegate_secret_reset_reject_v1(
  p_token text,
  p_id text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pk bigint;
  v_req public.approval_requests%rowtype;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  begin
    v_pk := trim(coalesce(p_id, ''))::bigint;
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'bad_id');
  end;

  select * into v_req from public.approval_requests where id = v_pk for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_req.kind is distinct from 'delegate_secret_reset' then
    return jsonb_build_object('ok', false, 'reason', 'wrong_kind');
  end if;
  if v_req.status = 'rejected' then
    return jsonb_build_object('ok', true, 'already', true, 'request_id', v_req.request_id);
  end if;

  update public.approval_requests
  set
    status = 'rejected',
    request_type = 'delegate_secret_reset',
    wf_state = 'rejected',
    wf_updated_at = now(),
    message = case
      when nullif(btrim(coalesce(p_reason, '')), '') is null then message
      else coalesce(message, '') || E'\\nسبب الرفض: ' || btrim(p_reason)
    end
  where id = v_pk;

  begin
    perform public.admin_audit_write_v1(
      'admin', 'admin_token', 'delegate.secret_reset_reject', 'approval_request',
      v_req.request_id, nullif(btrim(v_req.branch_key), ''),
      jsonb_build_object('request_pk', v_pk, 'reason', nullif(btrim(coalesce(p_reason, '')), ''), 'at', now())
    );
  exception when others then null;
  end;

  begin
    if to_regclass('public.workflow_notification_events') is not null then
      insert into public.workflow_notification_events (
        request_id, request_pk, event_key, recipient_hint, channel, payload
      ) values (
        v_req.request_id, v_pk, 'secret_reset.rejected', 'submitter', 'log',
        jsonb_build_object('kind', 'delegate_secret_reset', 'at', now())
      );
    end if;
  exception when others then null;
  end;

  return jsonb_build_object('ok', true, 'request_id', v_req.request_id);
end;
$$;

create or replace function public.admin_workflow_next_states_v1(
  p_token text,
  p_request_ref text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pk bigint;
  v_row public.approval_requests%rowtype;
  v_from text;
  v_next text[];
  v_type text;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  v_pk := public.workflow_resolve_request_pk_v1(p_request_ref);
  if v_pk is null then
    return jsonb_build_object('ok', false, 'code', 'WF-001', 'next', '[]'::jsonb);
  end if;

  select * into v_row from public.approval_requests where id = v_pk;
  v_type := coalesce(nullif(btrim(v_row.request_type), ''), v_row.kind);

  if v_type = 'delegate_secret_reset' or v_row.kind = 'delegate_secret_reset' then
    return jsonb_build_object(
      'ok', true,
      'dedicated_ui', true,
      'intent', 'delegate_secret_reset',
      'label_ar', 'طلب إعادة تعيين الرقم السري',
      'wf_state', coalesce(nullif(btrim(v_row.wf_state), ''), v_row.status),
      'next', '[]'::jsonb,
      'hint_ar', 'استخدم بطاقة إعادة التعيين في جدول الطلبات (اعتماد / رفض) — ليست مسار الشجرة أو المناسبات.'
    );
  end if;

  v_from := coalesce(
    nullif(btrim(v_row.wf_state), ''),
    public.workflow_infer_state_from_legacy_v1(v_row.status)
  );

  v_next := case v_from
    when 'submitted' then array['assigned']
    when 'assigned' then array['in_review']
    when 'in_review' then array['needs_changes', 'approved', 'rejected']
    when 'needs_changes' then array['in_review']
    when 'approved' then array['applied']
    when 'applied' then array['done']
    else array[]::text[]
  end;

  return jsonb_build_object('ok', true, 'wf_state', v_from, 'next', to_jsonb(v_next));
end;
$$;

create or replace function public.admin_workflow_backfill_v1(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int := 0;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  update public.approval_requests r
  set
    wf_state = public.workflow_infer_state_from_legacy_v1(r.status),
    wf_deep_link = coalesce(
      nullif(btrim(r.wf_deep_link), ''),
      public.workflow_deep_link_for_v1(r.request_id)
    ),
    request_type = coalesce(nullif(btrim(r.request_type), ''), r.kind),
    wf_updated_at = coalesce(r.wf_updated_at, now())
  where nullif(btrim(coalesce(r.wf_state, '')), '') is null
    and coalesce(r.kind, '') is distinct from 'delegate_secret_reset'
    and coalesce(r.request_type, '') is distinct from 'delegate_secret_reset';

  get diagnostics v_n = row_count;

  update public.approval_requests r
  set
    request_type = 'delegate_secret_reset',
    wf_deep_link = coalesce(
      nullif(btrim(r.wf_deep_link), ''),
      public.workflow_deep_link_for_v1(r.request_id)
    )
  where r.kind = 'delegate_secret_reset'
    and (
      nullif(btrim(coalesce(r.request_type, '')), '') is null
      or r.request_type is distinct from 'delegate_secret_reset'
    );

  begin
    perform public.admin_audit_write_v1(
      'admin', 'admin_token', 'workflow.backfill', 'approval_request', null, null,
      jsonb_build_object('updated', v_n, 'skipped_kind', 'delegate_secret_reset')
    );
  exception when others then null;
  end;

  return jsonb_build_object('ok', true, 'updated', v_n);
end;
$$;

grant execute on function public.delegate_secret_reset_submit_v1(text, text, text, text, text, text, text)
  to anon, authenticated;
grant execute on function public.admin_delegate_secret_reset_approve_v1(text, text, text)
  to anon, authenticated;
grant execute on function public.admin_delegate_secret_reset_reject_v1(text, text, text)
  to anon, authenticated;
grant execute on function public.admin_workflow_next_states_v1(text, text)
  to anon, authenticated;
grant execute on function public.admin_workflow_backfill_v1(text)
  to anon, authenticated;
`,
      order: 30,
    },
    {
      id: "maint.delegates_v2_dual_role_activate_v1",
      title: "مندوب شجرة+مناسبات → full_delegate",
      desc: "إصلاح تفعيل المندوب عند طلب الصلاحيتين معًا (قراءة delegate_roles من الرسالة). إعادة التفعيل محصورة بهيثم/مزيد/0558516818/REQ-1X7P-WIVV فقط — لا تمس مناديب آخرين.",
      file: "../supabase/sql/COPY-ME-delegates-v2-dual-role-activate.sql",
      sql: `-- =============================================================================
-- COPY-ME: dual tree+events delegate → full_delegate on activate
-- Preset id: maint.delegates_v2_dual_role_activate_v1
-- Safe to re-run.
--
-- Workspace shape (IMPORTANT — keep at 2 statements):
--   1) CREATE OR REPLACE activate function (schema only; no row mutations)
--   2) ONE SELECT: reactivate ONLY هيثم / مزيد / 0558516818 / REQ-1X7P-WIVV
--
-- Scope: command 2 touches THAT identity only (phone AND branch AND request_id).
-- No DO blocks. No loops over other approved delegates.
--
-- Root cause:
--   HTML «إرسال الطلب» inserted ONE approval_requests row with kind=tree_delegate
--   when both roles were checked (delegate_roles only in message JSON).
--   Activate looked only for a sibling kind=events_delegate row → none →
--   events_request_id=null → delegates_v2_infer_role → branch_editor (no events.write).
-- =============================================================================

create or replace function public.delegates_v2_activate_from_request_pk_v1(
  p_request_pk bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $alz_dual$
declare
  v_req public.approval_requests%rowtype;
  v_tree public.approval_requests%rowtype;
  v_events public.approval_requests%rowtype;
  v_branch text;
  v_phone text;
  v_email text;
  v_id uuid;
  v_role text;
  v_enabled boolean;
  v_hash text;
  v_name text;
  v_email_store text;
  v_msg_json jsonb;
  v_roles jsonb;
  v_tree_status text;
  v_events_status text;
  v_tree_rid text;
  v_events_rid text;
  v_dual_from_message boolean := false;
  v_marker int;
  v_json_text text;
begin
  if to_regclass('public.delegates_v2') is null then
    return jsonb_build_object('ok', false, 'reason', 'no_v2_schema');
  end if;

  if p_request_pk is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;

  select * into v_req
  from public.approval_requests
  where id = p_request_pk
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_req.kind is null
     or v_req.kind not in ('tree_delegate', 'events_delegate') then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'not_delegate_kind');
  end if;

  v_branch := public.delegates_v2_norm_branch(v_req.branch_key);
  v_phone := public.delegates_v2_norm_phone(v_req.phone);
  v_email := public.delegates_v2_norm_email(v_req.email);

  if v_branch = '' or v_phone = '' then
    return jsonb_build_object('ok', false, 'reason', 'missing_identity');
  end if;

  -- Latest tree + events rows for same identity (role inference)
  select * into v_tree
  from public.approval_requests r
  where r.kind = 'tree_delegate'
    and public.delegates_v2_norm_branch(r.branch_key) = v_branch
    and public.delegates_v2_norm_phone(r.phone) = v_phone
    and (
      v_email = ''
      or public.delegates_v2_norm_email(r.email) = ''
      or public.delegates_v2_norm_email(r.email) = v_email
    )
  order by r.created_at desc nulls last
  limit 1;

  select * into v_events
  from public.approval_requests r
  where r.kind = 'events_delegate'
    and public.delegates_v2_norm_branch(r.branch_key) = v_branch
    and public.delegates_v2_norm_phone(r.phone) = v_phone
    and (
      v_email = ''
      or public.delegates_v2_norm_email(r.email) = ''
      or public.delegates_v2_norm_email(r.email) = v_email
    )
  order by r.created_at desc nulls last
  limit 1;

  v_tree_status := coalesce(v_tree.status, '');
  v_events_status := coalesce(v_events.status, '');
  v_tree_rid := nullif(btrim(coalesce(v_tree.request_id, '')), '');
  v_events_rid := nullif(btrim(coalesce(v_events.request_id, '')), '');

  -- Dual-intent fallback: one approved row whose message lists both roles,
  -- and the missing kind has no sibling approval_requests row.
  v_msg_json := null;
  v_roles := null;
  begin
    v_marker := position('__JSON__:' in coalesce(v_req.message, ''));
    if v_marker > 0 then
      v_json_text := btrim(substring(v_req.message from v_marker + length('__JSON__:')));
      if v_json_text <> '' then
        v_msg_json := v_json_text::jsonb;
      end if;
    end if;
  exception when others then
    v_msg_json := null;
  end;

  if coalesce(v_req.status, '') = 'approved' and v_msg_json is not null then
    v_roles := coalesce(v_msg_json->'delegate_roles', '[]'::jsonb);
    if jsonb_typeof(v_roles) = 'array'
       and v_roles @> '["tree_delegate"]'::jsonb
       and v_roles @> '["events_delegate"]'::jsonb then
      v_dual_from_message := true;
      if v_tree_rid is null then
        v_tree_status := 'approved';
        v_tree_rid := nullif(btrim(coalesce(v_req.request_id, '')), '');
      elsif v_tree_status <> 'approved' and v_req.kind = 'tree_delegate' then
        v_tree_status := 'approved';
        v_tree_rid := nullif(btrim(coalesce(v_req.request_id, '')), '');
      end if;
      if v_events_rid is null then
        v_events_status := 'approved';
        v_events_rid := nullif(btrim(coalesce(v_req.request_id, '')), '');
      elsif v_events_status <> 'approved' and v_req.kind = 'events_delegate' then
        v_events_status := 'approved';
        v_events_rid := nullif(btrim(coalesce(v_req.request_id, '')), '');
      end if;
    end if;
  end if;

  v_role := public.delegates_v2_infer_role(v_tree_status, v_events_status);
  v_enabled := (
    v_tree_status = 'approved'
    or v_events_status = 'approved'
  );
  v_hash := nullif(btrim(coalesce(
    case
      when v_req.kind = 'tree_delegate' then v_req.secret_hash
      else coalesce(v_events.secret_hash, v_tree.secret_hash, v_req.secret_hash)
    end,
    ''
  )), '');
  if v_hash is null then
    v_hash := nullif(btrim(coalesce(v_tree.secret_hash, v_events.secret_hash, '')), '');
  end if;
  v_name := nullif(btrim(coalesce(v_req.name, v_tree.name, v_events.name, '')), '');
  v_email_store := nullif(lower(btrim(coalesce(
    nullif(btrim(coalesce(v_req.email, '')), ''),
    nullif(btrim(coalesce(v_tree.email, '')), ''),
    nullif(btrim(coalesce(v_events.email, '')), ''),
    ''
  ))), '');

  select d.id into v_id
  from public.delegates_v2 d
  where public.delegates_v2_norm_branch(d.branch_key) = v_branch
    and public.delegates_v2_norm_phone(d.phone) = v_phone
    and (
      v_email = ''
      or public.delegates_v2_norm_email(d.email) = ''
      or public.delegates_v2_norm_email(d.email) = v_email
    )
  order by d.updated_at desc nulls last, d.created_at desc nulls last
  limit 1;

  if v_id is null then
    insert into public.delegates_v2 (
      branch_key, name, phone, email, secret_hash, role_key, is_enabled,
      tree_request_id, events_request_id, updated_at
    ) values (
      nullif(btrim(v_req.branch_key), ''),
      v_name,
      nullif(btrim(v_req.phone), ''),
      v_email_store,
      v_hash,
      v_role,
      v_enabled,
      v_tree_rid,
      v_events_rid,
      now()
    )
    returning id into v_id;
  else
    update public.delegates_v2 d
    set
      name = coalesce(v_name, d.name),
      email = coalesce(v_email_store, d.email),
      secret_hash = coalesce(v_hash, d.secret_hash),
      role_key = v_role,
      is_enabled = v_enabled,
      tree_request_id = coalesce(v_tree_rid, d.tree_request_id),
      events_request_id = coalesce(v_events_rid, d.events_request_id),
      updated_at = now()
    where d.id = v_id;
  end if;

  begin
    perform public.admin_audit_write_v1(
      'system',
      'approve_activate',
      'delegate.activate_from_request',
      'delegates_v2',
      v_id::text,
      nullif(btrim(v_req.branch_key), ''),
      jsonb_build_object(
        'request_pk', p_request_pk,
        'request_id', v_req.request_id,
        'kind', v_req.kind,
        'status', v_req.status,
        'role_key', v_role,
        'is_enabled', v_enabled,
        'email', v_email_store,
        'dual_from_message', v_dual_from_message,
        'at', now()
      )
    );
  exception when others then
    null;
  end;

  return jsonb_build_object(
    'ok', true,
    'delegate_id', v_id,
    'role_key', v_role,
    'is_enabled', v_enabled,
    'has_secret', v_hash is not null,
    'dual_from_message', v_dual_from_message,
    'tree_request_id', v_tree_rid,
    'events_request_id', v_events_rid
  );
end;
$alz_dual$;

-- Haitham-only reactivation (no helper fn, no DO, no mass loop)
select jsonb_build_object(
  'ok', true,
  'scope', 'haitham_only',
  'request_id', 'REQ-1X7P-WIVV',
  'branch', 'مزيد',
  'phone', '0558516818',
  'activate', (
    select public.delegates_v2_activate_from_request_pk_v1(r.id)
    from public.approval_requests r
    where r.request_id = 'REQ-1X7P-WIVV'
      and r.kind in ('tree_delegate', 'events_delegate')
      and public.delegates_v2_norm_phone(r.phone) in ('0558516818', '558516818')
      and public.delegates_v2_norm_branch(r.branch_key) = 'مزيد'
    order by r.created_at desc nulls last
    limit 1
  ),
  'spot_check', (
    select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb)
    from (
      select
        id,
        branch_key,
        phone,
        role_key,
        is_enabled,
        tree_request_id,
        events_request_id,
        updated_at
      from public.delegates_v2
      where public.delegates_v2_norm_phone(phone) in ('0558516818', '558516818')
        and public.delegates_v2_norm_branch(branch_key) = 'مزيد'
      order by updated_at desc nulls last
      limit 5
    ) d
  )
) as repair_result;
`,
      order: 21,
    },
    {
      id: "maint.delegates_v2_sync_email_v1",
      title: "مزامنة بريد المندوب عند الاعتماد (delegates_v2)",
      desc: "نسخ email من approval_requests إلى delegates_v2 عند الاعتماد — لإشعارات طلبات الفرع. SQL مضمّن. يشمل dual tree+events → full_delegate.",
      file: "../supabase/sql/COPY-ME-delegates-v2-sync-email.sql",
      sql: `-- =============================================================================
-- COPY-ME: sync email onto delegates_v2 on approve/update (optional)
-- email column already exists — no ADD COLUMN needed.
-- Safe to re-run. Enables private branch-delegate email notify.
-- =============================================================================

create or replace function public.delegates_v2_activate_from_request_pk_v1(
  p_request_pk bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.approval_requests%rowtype;
  v_tree public.approval_requests%rowtype;
  v_events public.approval_requests%rowtype;
  v_branch text;
  v_phone text;
  v_email text;
  v_id uuid;
  v_role text;
  v_enabled boolean;
  v_hash text;
  v_name text;
  v_email_store text;
  v_msg_json jsonb;
  v_roles jsonb;
  v_tree_status text;
  v_events_status text;
  v_tree_rid text;
  v_events_rid text;
  v_dual_from_message boolean := false;
  v_marker int;
  v_json_text text;
begin
  if to_regclass('public.delegates_v2') is null then
    return jsonb_build_object('ok', false, 'reason', 'no_v2_schema');
  end if;

  if p_request_pk is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;

  select * into v_req
  from public.approval_requests
  where id = p_request_pk
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_req.kind is null
     or v_req.kind not in ('tree_delegate', 'events_delegate') then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'not_delegate_kind');
  end if;

  v_branch := public.delegates_v2_norm_branch(v_req.branch_key);
  v_phone := public.delegates_v2_norm_phone(v_req.phone);
  v_email := public.delegates_v2_norm_email(v_req.email);

  if v_branch = '' or v_phone = '' then
    return jsonb_build_object('ok', false, 'reason', 'missing_identity');
  end if;

  -- Latest tree + events rows for same identity (role inference)
  select * into v_tree
  from public.approval_requests r
  where r.kind = 'tree_delegate'
    and public.delegates_v2_norm_branch(r.branch_key) = v_branch
    and public.delegates_v2_norm_phone(r.phone) = v_phone
    and (
      v_email = ''
      or public.delegates_v2_norm_email(r.email) = ''
      or public.delegates_v2_norm_email(r.email) = v_email
    )
  order by r.created_at desc nulls last
  limit 1;

  select * into v_events
  from public.approval_requests r
  where r.kind = 'events_delegate'
    and public.delegates_v2_norm_branch(r.branch_key) = v_branch
    and public.delegates_v2_norm_phone(r.phone) = v_phone
    and (
      v_email = ''
      or public.delegates_v2_norm_email(r.email) = ''
      or public.delegates_v2_norm_email(r.email) = v_email
    )
  order by r.created_at desc nulls last
  limit 1;

  v_tree_status := coalesce(v_tree.status, '');
  v_events_status := coalesce(v_events.status, '');
  v_tree_rid := nullif(btrim(coalesce(v_tree.request_id, '')), '');
  v_events_rid := nullif(btrim(coalesce(v_events.request_id, '')), '');

  -- Dual-intent fallback: one approved row whose message lists both roles,
  -- and the missing kind has no sibling approval_requests row.
  v_msg_json := null;
  v_roles := null;
  begin
    v_marker := position('__JSON__:' in coalesce(v_req.message, ''));
    if v_marker > 0 then
      v_json_text := btrim(substring(v_req.message from v_marker + length('__JSON__:')));
      if v_json_text <> '' then
        v_msg_json := v_json_text::jsonb;
      end if;
    end if;
  exception when others then
    v_msg_json := null;
  end;

  if coalesce(v_req.status, '') = 'approved' and v_msg_json is not null then
    v_roles := coalesce(v_msg_json->'delegate_roles', '[]'::jsonb);
    if jsonb_typeof(v_roles) = 'array'
       and v_roles @> '["tree_delegate"]'::jsonb
       and v_roles @> '["events_delegate"]'::jsonb then
      v_dual_from_message := true;
      if v_tree_rid is null then
        v_tree_status := 'approved';
        v_tree_rid := nullif(btrim(coalesce(v_req.request_id, '')), '');
      elsif v_tree_status <> 'approved' and v_req.kind = 'tree_delegate' then
        v_tree_status := 'approved';
        v_tree_rid := nullif(btrim(coalesce(v_req.request_id, '')), '');
      end if;
      if v_events_rid is null then
        v_events_status := 'approved';
        v_events_rid := nullif(btrim(coalesce(v_req.request_id, '')), '');
      elsif v_events_status <> 'approved' and v_req.kind = 'events_delegate' then
        v_events_status := 'approved';
        v_events_rid := nullif(btrim(coalesce(v_req.request_id, '')), '');
      end if;
    end if;
  end if;

  v_role := public.delegates_v2_infer_role(v_tree_status, v_events_status);
  v_enabled := (
    v_tree_status = 'approved'
    or v_events_status = 'approved'
  );
  v_hash := nullif(btrim(coalesce(
    case
      when v_req.kind = 'tree_delegate' then v_req.secret_hash
      else coalesce(v_events.secret_hash, v_tree.secret_hash, v_req.secret_hash)
    end,
    ''
  )), '');
  if v_hash is null then
    v_hash := nullif(btrim(coalesce(v_tree.secret_hash, v_events.secret_hash, '')), '');
  end if;
  v_name := nullif(btrim(coalesce(v_req.name, v_tree.name, v_events.name, '')), '');
  v_email_store := nullif(lower(btrim(coalesce(
    nullif(btrim(coalesce(v_req.email, '')), ''),
    nullif(btrim(coalesce(v_tree.email, '')), ''),
    nullif(btrim(coalesce(v_events.email, '')), ''),
    ''
  ))), '');

  select d.id into v_id
  from public.delegates_v2 d
  where public.delegates_v2_norm_branch(d.branch_key) = v_branch
    and public.delegates_v2_norm_phone(d.phone) = v_phone
    and (
      v_email = ''
      or public.delegates_v2_norm_email(d.email) = ''
      or public.delegates_v2_norm_email(d.email) = v_email
    )
  order by d.updated_at desc nulls last, d.created_at desc nulls last
  limit 1;

  if v_id is null then
    insert into public.delegates_v2 (
      branch_key, name, phone, email, secret_hash, role_key, is_enabled,
      tree_request_id, events_request_id, updated_at
    ) values (
      nullif(btrim(v_req.branch_key), ''),
      v_name,
      nullif(btrim(v_req.phone), ''),
      v_email_store,
      v_hash,
      v_role,
      v_enabled,
      v_tree_rid,
      v_events_rid,
      now()
    )
    returning id into v_id;
  else
    update public.delegates_v2 d
    set
      name = coalesce(v_name, d.name),
      email = coalesce(v_email_store, d.email),
      secret_hash = coalesce(v_hash, d.secret_hash),
      role_key = v_role,
      is_enabled = v_enabled,
      tree_request_id = coalesce(v_tree_rid, d.tree_request_id),
      events_request_id = coalesce(v_events_rid, d.events_request_id),
      updated_at = now()
    where d.id = v_id;
  end if;

  perform public.admin_audit_write_v1(
    'system',
    'approve_activate',
    'delegate.activate_from_request',
    'delegates_v2',
    v_id::text,
    nullif(btrim(v_req.branch_key), ''),
    jsonb_build_object(
      'request_pk', p_request_pk,
      'request_id', v_req.request_id,
      'kind', v_req.kind,
      'status', v_req.status,
      'role_key', v_role,
      'is_enabled', v_enabled,
      'email', v_email_store,
      'dual_from_message', v_dual_from_message,
      'at', now()
    )
  );

  return jsonb_build_object(
    'ok', true,
    'delegate_id', v_id,
    'role_key', v_role,
    'is_enabled', v_enabled,
    'has_secret', v_hash is not null,
    'dual_from_message', v_dual_from_message,
    'tree_request_id', v_tree_rid,
    'events_request_id', v_events_rid
  );
end;
$$;

create or replace function public.delegates_v2_approval_requests_sync_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if to_regclass('public.delegates_v2') is null then
    return new;
  end if;

  if new.kind is null
     or new.kind not in ('tree_delegate', 'events_delegate') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status in ('approved', 'rejected') then
      perform public.delegates_v2_activate_from_request_pk_v1(new.id);
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.status is distinct from old.status
       and new.status in ('approved', 'rejected') then
      perform public.delegates_v2_activate_from_request_pk_v1(new.id);
    elsif new.status = 'approved'
      and (
        new.secret_hash is distinct from old.secret_hash
        or new.phone is distinct from old.phone
        or new.branch_key is distinct from old.branch_key
        or new.email is distinct from old.email
      ) then
      perform public.delegates_v2_activate_from_request_pk_v1(new.id);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_delegates_v2_approval_requests_sync
  on public.approval_requests;

create trigger trg_delegates_v2_approval_requests_sync
after insert or update of status, secret_hash, phone, branch_key, email
on public.approval_requests
for each row
execute function public.delegates_v2_approval_requests_sync_trg();
`,
      order: 31,
      supabaseOnce: true,
    },
    {
      id: "maint.delegates_v2_backfill_emails_v1",
      title: "تعبئة بريد المناديب من طلبات الاعتماد",
      desc: "ينسخ email من approval_requests (معتمد) إلى delegates_v2 عندما يكون بريد المندوب فارغًا. ليس توسيع صلاحيات طلبات الفرع.",
      file: "../supabase/sql/COPY-ME-delegates-v2-backfill-emails.sql",
      sql: `-- COPY-ME: backfill delegates_v2.email from approved approval_requests
-- Safe to re-run. Only fills empty/null emails — does not overwrite existing.
-- NOTE: must start with UPDATE (not WITH) so SQL Workspace classify treats it as mutate
-- (WITH…UPDATE was mis-read as SELECT and wrapped → fail at statement 1).

update public.delegates_v2 d
set email = s.email,
    updated_at = now()
from (
  select distinct on (
    public.delegates_v2_norm_branch(r.branch_key),
    public.delegates_v2_norm_phone(r.phone)
  )
    public.delegates_v2_norm_branch(r.branch_key) as branch_key,
    public.delegates_v2_norm_phone(r.phone) as phone,
    public.delegates_v2_norm_email(r.email) as email
  from public.approval_requests r
  where r.status = 'approved'
    and r.kind in ('tree_delegate', 'events_delegate')
    and nullif(public.delegates_v2_norm_email(r.email), '') is not null
  order by
    public.delegates_v2_norm_branch(r.branch_key),
    public.delegates_v2_norm_phone(r.phone),
    r.created_at desc nulls last
) s
where public.delegates_v2_norm_branch(d.branch_key) = s.branch_key
  and public.delegates_v2_norm_phone(d.phone) = s.phone
  and coalesce(d.is_enabled, false) is true
  and nullif(public.delegates_v2_norm_email(d.email), '') is null;

-- تحقق سريع لفرع مزيد
select id, branch_key, phone, email, is_enabled, role_key, updated_at
from public.delegates_v2
where public.delegates_v2_norm_branch(branch_key) = 'مزيد'
order by updated_at desc nulls last;
`,
      order: 33,
      supabaseOnce: true,
    },
    {
      id: "maint.delegate_branch_requests_expand_v2",
      title: "توسيع طلبات الفرع للمندوب v2 (سجل الحالات + اسم المراجع)",
      desc:
        "إعادة تطبيق إلزامية: القائمة تُرجع pending+approved+rejected بـ can_read + حقول الجدولة + ختم اسم المندوب. v1 قد تُؤرشف كمنفّذ رغم أن الجسم ما زال pending فقط — شغّل هذه البطاقة ثم بطاقة التحقق.",
      file: "../supabase/sql/COPY-ME-delegate-branch-requests-expand.sql",
      sql: `-- COPY-ME: Expand branch-delegate request queue beyond events + keep history.
-- Preset id: maint.delegate_branch_requests_expand_v2
-- (v1 may be archived as «منفذ» while live body was still pending-only —
--  the old probe only checked to_regprocedure IS NOT NULL.)
-- Run manually in Supabase SQL Editor / SQL Workspace. Do NOT auto-execute from the app.
--
-- Goal (Request Lifecycle v2):
--   Branch delegate can list + approve/reject branch requests for:
--     event_card / family_event / event_request
--     tree_card  (إضافة فرد)
--     tree_edit  (تصحيح)
--     memory_card (ذكرى — إن وُجدت في approval_requests)
--   Explicitly EXCLUDED (central admin only):
--     special_card (البطاقة / طلب بطاقة)
--     tree_delegate / events_delegate / delegate_secret_reset / …
--     events_audit / tree_audit (internal audit rows — never in inbox)
--
-- CRITICAL: list returns pending + approved + rejected so handled items
-- do NOT disappear from «طلبات فرعي».
--
-- Enriched payload (jsonb array): approval_requests fields + schedule/publish
-- fields joined from family_events when published (show_at, show_before_days,
-- event_date, end_at, manual_hidden, published, event_id) + reviewed_by when
-- stamped on the message.
-- Visibility state is computed on read by the client (no cron).
--
-- Auth:
--   List: tree OR events can_read (same gate as portal login read path)
--   Status change:
--     event kinds  → events_delegate_allowed_v1
--     tree/memory  → tree_delegate_allowed_v1
--   On status change: append internal review stamp with delegate display name.

drop function if exists public.delegate_list_event_requests_v1(text, text, text, text);

create or replace function public.delegate_list_event_requests_v1(
  p_branch_key text,
  p_phone text,
  p_email text,
  p_secret_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_out jsonb := '[]'::jsonb;
begin
  -- Read gate (not write/allowed): login uses can_read; list must match.
  if not (
    public.tree_delegate_can_read_v1(p_branch_key, p_phone, p_email, p_secret_hash)
    or public.events_delegate_can_read_v1(p_branch_key, p_phone, p_email, p_secret_hash)
  ) then
    return v_out;
  end if;

  select coalesce(jsonb_agg(row_payload order by sort_status, created_at desc), '[]'::jsonb)
  into v_out
  from (
    select
      (
        to_jsonb(r)
        || jsonb_build_object(
          'show_at', e.show_at,
          'show_before_days', e.show_before_days,
          'event_date', e.event_date,
          'end_at', e.end_at,
          'manual_hidden', e.manual_hidden,
          'published', (e.id is not null),
          'event_id', e.id,
          'date_label', e.date_label,
          'event_type', e.type,
          'reviewed_by', nullif(
            btrim(
              coalesce(
                (regexp_match(
                  coalesce(r.message, ''),
                  'تمت مراجعة الطلب بواسطة المندوب:\s*([^\n\r]+)'
                ))[1],
                (regexp_match(
                  coalesce(r.message, ''),
                  'تمت مراجعة الطلب بواسطة\s*([^\n\r.]+)'
                ))[1],
                ''
              )
            ),
            ''
          )
        )
      ) as row_payload,
      case lower(coalesce(r.status, ''))
        when 'pending' then 0
        when 'approved' then 1
        when 'rejected' then 2
        else 3
      end as sort_status,
      r.created_at
    from public.approval_requests r
    left join lateral (
      select fe.*
      from public.family_events fe
      where nullif(btrim(coalesce(r.request_id, '')), '') is not null
        and (
          coalesce(fe.details, '') like '%' || r.request_id || '%'
        )
        and regexp_replace(btrim(coalesce(fe.branch_key, '')), '\s+', ' ', 'g')
          = regexp_replace(btrim(coalesce(r.branch_key, '')), '\s+', ' ', 'g')
      order by fe.id desc
      limit 1
    ) e on true
    where r.status in ('pending', 'approved', 'rejected')
      and r.kind in (
        'event_card',
        'family_event',
        'event_request',
        'tree_card',
        'tree_edit',
        'memory_card'
      )
      -- special_card + audit kinds intentionally excluded
      and regexp_replace(btrim(coalesce(r.branch_key, '')), '\s+', ' ', 'g')
        = regexp_replace(btrim(coalesce(p_branch_key, '')), '\s+', ' ', 'g')
    order by sort_status, r.created_at desc
    limit 200
  ) q;

  return coalesce(v_out, '[]'::jsonb);
end;
$$;

drop function if exists public.delegate_set_approval_request_status_v1(text, bigint, text);
drop function if exists public.delegate_set_approval_request_status_v1(text, bigint, text, text, text, text);

create or replace function public.delegate_set_approval_request_status_v1(
  p_branch_key text,
  p_request_id bigint,
  p_status text,
  p_phone text default null,
  p_email text default null,
  p_secret_hash text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.approval_requests%rowtype;
  v_status text;
  v_kind text;
  v_auth_ok boolean := false;
  v_stamp text;
  v_msg text;
  v_reviewer text;
begin
  v_status := case
    when lower(btrim(coalesce(p_status, ''))) = 'approved' then 'approved'
    when lower(btrim(coalesce(p_status, ''))) = 'rejected' then 'rejected'
    else null
  end;
  if v_status is null then
    return false;
  end if;

  select * into v_row
  from public.approval_requests r
  where r.id = p_request_id
    and r.status = 'pending'
    and r.kind in (
      'event_card',
      'family_event',
      'event_request',
      'tree_card',
      'tree_edit',
      'memory_card'
    )
    and regexp_replace(btrim(coalesce(r.branch_key, '')), '\s+', ' ', 'g')
      = regexp_replace(btrim(coalesce(p_branch_key, '')), '\s+', ' ', 'g')
  limit 1;

  if v_row.id is null then
    return false;
  end if;

  v_kind := coalesce(v_row.kind, '');

  if p_phone is not null or p_email is not null or p_secret_hash is not null then
    if v_kind in ('event_card', 'family_event', 'event_request') then
      v_auth_ok := public.events_delegate_allowed_v1(
        p_branch_key, p_phone, p_email, p_secret_hash
      );
    elsif v_kind in ('tree_card', 'tree_edit', 'memory_card') then
      v_auth_ok := public.tree_delegate_allowed_v1(
        p_branch_key, p_phone, p_email, p_secret_hash
      );
    else
      return false;
    end if;

    if not v_auth_ok then
      return false;
    end if;
  end if;

  -- Prefer display name from delegates_v2 (security definer path).
  v_reviewer := null;
  begin
    select nullif(btrim(coalesce(d.name, '')), '')
      into v_reviewer
    from public.delegates_v2 d
    where public.delegates_v2_norm_branch(d.branch_key)
        = public.delegates_v2_norm_branch(p_branch_key)
      and (
        nullif(btrim(coalesce(p_phone, '')), '') is null
        or public.delegates_v2_norm_phone(d.phone)
           = public.delegates_v2_norm_phone(p_phone)
      )
      and coalesce(d.is_enabled, false) is true
    order by d.updated_at desc nulls last
    limit 1;
  exception when others then
    v_reviewer := null;
  end;

  if v_reviewer is not null then
    v_stamp := E'\n---\nتمت مراجعة الطلب بواسطة المندوب: ' || v_reviewer || '.';
  elsif nullif(btrim(coalesce(p_phone, '')), '') is not null
     or nullif(btrim(coalesce(p_email, '')), '') is not null then
    v_stamp := E'\n---\nتمت مراجعة الطلب بواسطة مندوب الفرع.';
  else
    v_stamp := E'\n---\nتمت مراجعة الطلب بواسطة أحد المراجعين المعتمدين.';
  end if;

  v_msg := coalesce(v_row.message, '');
  if position('تمت مراجعة الطلب بواسطة' in v_msg) = 0 then
    v_msg := v_msg || v_stamp;
  end if;

  update public.approval_requests
  set
    status = v_status,
    message = v_msg
  where id = p_request_id;

  return found;
end;
$$;

grant execute on function public.delegate_list_event_requests_v1(text, text, text, text) to anon, authenticated;
grant execute on function public.delegate_set_approval_request_status_v1(text, bigint, text, text, text, text) to anon, authenticated;

-- Smoke: prove BODY is lifecycle v2 (not merely that the name exists).
select
  (select to_regprocedure('public.delegate_list_event_requests_v1(text,text,text,text)') is not null) as has_list,
  (select to_regprocedure('public.delegate_set_approval_request_status_v1(text,bigint,text,text,text,text)') is not null) as has_set,
  (
    select coalesce(pg_get_functiondef('public.delegate_list_event_requests_v1(text,text,text,text)'::regprocedure), '')
      like '%pending%'
     and coalesce(pg_get_functiondef('public.delegate_list_event_requests_v1(text,text,text,text)'::regprocedure), '')
      like '%approved%'
     and coalesce(pg_get_functiondef('public.delegate_list_event_requests_v1(text,text,text,text)'::regprocedure), '')
      like '%rejected%'
     and coalesce(pg_get_functiondef('public.delegate_list_event_requests_v1(text,text,text,text)'::regprocedure), '')
      like '%show_at%'
     and coalesce(pg_get_functiondef('public.delegate_list_event_requests_v1(text,text,text,text)'::regprocedure), '')
      like '%jsonb_agg%'
  ) as list_body_is_lifecycle_v2,
  (
    select pg_typeof(public.delegate_list_event_requests_v1('__probe__', '', '', ''))::text
  ) as list_return_type;
`,
      order: 34.1,
      supabaseOnce: true,
    },
    {
      id: "maint.delegates_v2_update_email_v1",
      title: "تحديث بريد المندوب من مساحة العمل",
      desc: "RPC: delegates_v2_update_email_v1 — حفظ/تحديث email بالجوال+الفرع+الرقم السري.",
      file: "../supabase/sql/COPY-ME-delegates-v2-update-email.sql",
      sql: `-- COPY-ME: delegates_v2_update_email_v1
create or replace function public.delegates_v2_update_email_v1(
  p_branch_key text,
  p_phone text,
  p_secret_hash text,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch text;
  v_phone text;
  v_hash text := nullif(btrim(coalesce(p_secret_hash, '')), '');
  v_email text;
  v_row public.delegates_v2%rowtype;
  v_legacy_n integer := 0;
begin
  if to_regclass('public.delegates_v2') is null then
    return jsonb_build_object('ok', false, 'reason', 'no_v2_schema');
  end if;
  v_branch := public.delegates_v2_norm_branch(p_branch_key);
  v_phone := public.delegates_v2_norm_phone(p_phone);
  v_email := public.delegates_v2_norm_email(p_email);
  if v_branch = '' or v_phone = '' or v_hash is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;
  if v_email = '' or position('@' in v_email) = 0 or position('.' in v_email) = 0 or char_length(v_email) < 6 then
    return jsonb_build_object('ok', false, 'reason', 'bad_email');
  end if;
  select d.* into v_row from public.delegates_v2 d
  where public.delegates_v2_norm_branch(d.branch_key) = v_branch
    and public.delegates_v2_norm_phone(d.phone) = v_phone
    and nullif(btrim(coalesce(d.secret_hash, '')), '') is not null
    and d.secret_hash = v_hash
  order by d.updated_at desc nulls last, d.created_at desc nulls last
  limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if coalesce(v_row.is_enabled, false) is not true then
    return jsonb_build_object('ok', false, 'reason', 'disabled', 'delegate_id', v_row.id);
  end if;
  update public.delegates_v2 d set email = v_email, updated_at = now() where d.id = v_row.id;
  update public.approval_requests r set email = v_email
  where r.kind in ('tree_delegate', 'events_delegate') and r.status = 'approved'
    and public.delegates_v2_norm_branch(r.branch_key) = v_branch
    and public.delegates_v2_norm_phone(r.phone) = v_phone;
  get diagnostics v_legacy_n = row_count;
  return jsonb_build_object('ok', true, 'delegate_id', v_row.id, 'branch_key', v_branch, 'phone', v_phone, 'email', v_email, 'legacy_updated', v_legacy_n);
end;
$$;
revoke all on function public.delegates_v2_update_email_v1(text, text, text, text) from public;
grant execute on function public.delegates_v2_update_email_v1(text, text, text, text) to anon, authenticated;
`,
      order: 32,
      supabaseOnce: true,
    },
    {
      id: "maint.repair_null_parent_columns_dry_run_v1",
      title: "معاينة parent/child_name الفارغ (dry-run)",
      desc: "قراءة فقط: صفوف parent/child_name الفارغ ومقترح الملء — قبل APPLY.",
      file: "../supabase/sql/COPY-ME-repair-null-parent-columns-dry-run.sql",
      sql: `-- =============================================================================
-- COPY-ME: Dry-run — صفوف parent / child_name الفارغ (قراءة فقط)
-- Preset: maint.repair_null_parent_columns_dry_run_v1
-- سياسة: لا تشغيل تلقائي من Health Center (R-7). راجع الصفوف ثم شغّل APPLY منفصلًا.
-- ملاحظة Workspace: أمر SELECT واحد فقط — بلا /* */ (تصنيف المنفّذ يعلّق عليها).
-- =============================================================================

SELECT
  id,
  branch_key,
  parent,
  parent_name,
  child_name,
  name,
  coalesce(
    nullif(btrim(parent_name), ''),
    CASE
      WHEN position('/' in coalesce(name, child_name, '')) > 0
        THEN regexp_replace(coalesce(name, child_name), '/[^/]+$', '')
      ELSE NULL
    END
  ) AS proposed_parent,
  parent_person_id
FROM public.tree_children
WHERE nullif(btrim(coalesce(parent, '')), '') IS NULL
   OR nullif(btrim(coalesce(child_name, '')), '') IS NULL
ORDER BY branch_key, id
LIMIT 200;
`,
      order: 40,
    },
    {
      id: "maint.repair_null_parent_columns_apply_v1",
      title: "تطبيق ملء parent/child_name (APPLY)",
      desc: "كتابة بعد نجاح dry-run وموافقة صريحة — لا Auto Repair.",
      file: "../supabase/sql/COPY-ME-repair-null-parent-columns-apply.sql",
      sql: `-- =============================================================================
-- COPY-ME: APPLY — ملء parent / child_name الفارغ (كتابة)
-- Preset: maint.repair_null_parent_columns_apply_v1
-- سياسة: شغّل فقط بعد نجاح dry-run وموافقة صريحة. ليس Auto Repair.
-- Safe to re-run. لا يحذف صفوفًا.
-- ملاحظة Workspace: بلا تعليقات كتلية /* */ — أوامر صريحة فقط.
-- =============================================================================

UPDATE public.tree_children c
SET
  parent = coalesce(
    nullif(btrim(c.parent), ''),
    nullif(btrim(c.parent_name), ''),
    CASE
      WHEN position('/' in coalesce(c.name, c.child_name, '')) > 0
        THEN regexp_replace(coalesce(c.name, c.child_name), '/[^/]+$', '')
      ELSE NULL
    END
  ),
  parent_name = coalesce(
    nullif(btrim(c.parent_name), ''),
    nullif(btrim(c.parent), ''),
    CASE
      WHEN position('/' in coalesce(c.name, c.child_name, '')) > 0
        THEN regexp_replace(coalesce(c.name, c.child_name), '/[^/]+$', '')
      ELSE c.parent_name
    END
  ),
  child_name = coalesce(nullif(btrim(c.child_name), ''), nullif(btrim(c.name), '')),
  name = coalesce(nullif(btrim(c.name), ''), nullif(btrim(c.child_name), ''))
WHERE nullif(btrim(coalesce(c.parent, '')), '') IS NULL
   OR nullif(btrim(coalesce(c.child_name, '')), '') IS NULL;

SELECT count(*) AS still_null_parent
FROM public.tree_children
WHERE nullif(btrim(coalesce(parent, '')), '') IS NULL;
`,
      order: 41,
    },
    {
      id: "maint.link_uuid_nada_tuaisan_hamad_mohammad_dry_run_v1",
      title: "ربط UUID سلسلة نداء-طعيسان-حمد-محمد (1738-1740) — معاينة",
      desc: "SELECT واحد: اسم الأب وperson_id لـ 1738/1739/1740 ومرشحو نداء.",
      file: "../supabase/sql/COPY-ME-link-uuid-nada-tuaisan-hamad-mohammad-dry-run.sql",
      sql: `-- COPY-ME dry-run link UUID 1738-1740 (read-only)
SELECT
  c.id AS child_id,
  coalesce(c.name, c.child_name) AS child_name_path,
  coalesce(nullif(btrim(c.parent), ''), nullif(btrim(c.parent_name), '')) AS child_parent_text,
  c.person_id AS child_person_id,
  c.parent_person_id AS child_parent_person_id_now,
  CASE c.id
    WHEN 1738 THEN 1739::bigint
    WHEN 1739 THEN 1740::bigint
    WHEN 1740 THEN (
      SELECT min(f.id)
      FROM public.tree_children f
      WHERE f.branch_key = c.branch_key
        AND f.id <> c.id
        AND f.person_id IS NOT NULL
        AND coalesce(nullif(btrim(f.name), ''), nullif(btrim(f.child_name), ''))
          = coalesce(nullif(btrim(c.parent), ''), nullif(btrim(c.parent_name), ''))
      HAVING count(DISTINCT f.person_id) = 1
    )
  END AS proposed_father_id,
  CASE c.id
    WHEN 1738 THEN (SELECT f.person_id FROM public.tree_children f WHERE f.id = 1739)
    WHEN 1739 THEN (SELECT f.person_id FROM public.tree_children f WHERE f.id = 1740)
    WHEN 1740 THEN (
      SELECT min(f.person_id::text)::uuid
      FROM public.tree_children f
      WHERE f.branch_key = c.branch_key
        AND f.id <> c.id
        AND f.person_id IS NOT NULL
        AND coalesce(nullif(btrim(f.name), ''), nullif(btrim(f.child_name), ''))
          = coalesce(nullif(btrim(c.parent), ''), nullif(btrim(c.parent_name), ''))
      HAVING count(DISTINCT f.person_id) = 1
    )
  END AS proposed_father_person_id
FROM public.tree_children c
WHERE c.id IN (1738, 1739, 1740)
ORDER BY c.id;
`,
      order: 50,
    },
    {
      id: "maint.link_uuid_nada_tuaisan_hamad_mohammad_apply_v1",
      title: "ربط UUID سلسلة نداء-طعيسان-حمد-محمد (1738-1740) — APPLY",
      desc: "UPDATE واحد لـ parent_person_id فقط؛ 1740 بشرط نداء فريد.",
      file: "../supabase/sql/COPY-ME-link-uuid-nada-tuaisan-hamad-mohammad-apply.sql",
      sql: `-- COPY-ME APPLY link UUID 1738-1740 (parent_person_id only)
UPDATE public.tree_children c
SET parent_person_id = t.father_person_id
FROM (
  SELECT
    1738::bigint AS child_id,
    f.person_id AS father_person_id
  FROM public.tree_children f
  WHERE f.id = 1739
    AND f.person_id IS NOT NULL
  UNION ALL
  SELECT
    1739::bigint,
    f.person_id
  FROM public.tree_children f
  WHERE f.id = 1740
    AND f.person_id IS NOT NULL
  UNION ALL
  SELECT
    child.id,
    min(f.person_id::text)::uuid
  FROM public.tree_children child
  JOIN public.tree_children f
    ON f.branch_key = child.branch_key
   AND f.id <> child.id
   AND f.person_id IS NOT NULL
   AND coalesce(nullif(btrim(f.name), ''), nullif(btrim(f.child_name), ''))
     = coalesce(nullif(btrim(child.parent), ''), nullif(btrim(child.parent_name), ''))
  WHERE child.id = 1740
    AND coalesce(nullif(btrim(child.parent), ''), nullif(btrim(child.parent_name), '')) IS NOT NULL
  GROUP BY child.id
  HAVING count(DISTINCT f.person_id) = 1
) t
WHERE c.id = t.child_id
  AND c.id IN (1738, 1739, 1740)
  AND c.parent_person_id IS DISTINCT FROM t.father_person_id;
`,
      order: 51,
    },
    {
id: "maint.event_schedule_visibility_probe_v1",
      title: "تحقق: جدولة/توسيع/دفع (قراءة فقط)",
      desc: "SELECT واحد للتأكد من أعمدة الجدولة ودوال التوسيع/التفعيل وجدول الدفع — بلا كتابة.",
      sql: `-- VERIFY ONLY (read): schedule columns + REAL list-body lifecycle check
-- Old probe only checked to_regprocedure IS NOT NULL — that stayed true for pending-only.
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'family_events'
      and column_name in ('show_before_days', 'show_at', 'end_at', 'manual_hidden')) as family_event_schedule_cols,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'banner_messages'
      and column_name in ('show_start', 'show_end', 'is_permanent')) as banner_schedule_cols,
  (select to_regprocedure('public.delegate_list_event_requests_v1(text,text,text,text)') is not null) as has_delegate_list_fn,
  (
    select coalesce(pg_get_functiondef('public.delegate_list_event_requests_v1(text,text,text,text)'::regprocedure), '')
      like '%pending%'
     and coalesce(pg_get_functiondef('public.delegate_list_event_requests_v1(text,text,text,text)'::regprocedure), '')
      like '%approved%'
     and coalesce(pg_get_functiondef('public.delegate_list_event_requests_v1(text,text,text,text)'::regprocedure), '')
      like '%rejected%'
     and coalesce(pg_get_functiondef('public.delegate_list_event_requests_v1(text,text,text,text)'::regprocedure), '')
      like '%show_at%'
     and coalesce(pg_get_functiondef('public.delegate_list_event_requests_v1(text,text,text,text)'::regprocedure), '')
      not like '%r.status = ''pending''%'
  ) as list_body_is_lifecycle_v2,
  (select to_regprocedure('public.delegates_v2_activate_from_request_pk_v1(bigint)') is not null) as has_dual_role_activate,
  (select to_regclass('public.push_send_dedupe') is not null) as has_push_send_dedupe,
  (select exists(
      select 1 from information_schema.columns
      where table_schema='public' and table_name='push_tokens' and column_name='phone'
   )) as has_push_tokens_phone;
`,
      order: 54.5,
    },
    {
            id: "maint.event_schedule_visibility_v1",
      title: "جدولة ظهور المناسبات والأخبار",
      desc: "آمن لإعادة التشغيل: أعمدة الجدولة + تحديث دوال النشر/الحفظ/إدراج المندوب. SQL مضمّن (لا يعتمد على fetch لملف gitignored). إن ظهرت الأعمدة فقط بدون سلوك الجدولة فأعد تشغيل هذه البطاقة.",
      file: "../supabase/sql/COPY-ME-event-schedule-visibility.sql",
      sql: `-- =============================================================================
-- COPY-ME: event schedule visibility + banner time window
-- Preset id: maint.event_schedule_visibility_v1
-- Safe to re-run (IF NOT EXISTS / CREATE OR REPLACE).
--
-- What this does:
--   1) family_events: show_before_days, show_at, end_at, manual_hidden
--   2) banner_messages: show_start, show_end, is_permanent
--   3) Update admin publish/save RPCs to persist schedule fields (optional columns)
--
-- Visibility is computed on read by the app (no cron required).
-- Soft-hide only — never deletes rows for expiry.
-- =============================================================================

-- 1) family_events schedule columns
alter table public.family_events
  add column if not exists show_before_days int;

alter table public.family_events
  add column if not exists show_at timestamptz;

alter table public.family_events
  add column if not exists end_at timestamptz;

alter table public.family_events
  add column if not exists manual_hidden boolean default false;

comment on column public.family_events.show_before_days is
  'Days before event_date when public visibility starts (default 3). Overridden by show_at.';
comment on column public.family_events.show_at is
  'Optional absolute timestamp when the event becomes publicly visible.';
comment on column public.family_events.end_at is
  'Optional absolute timestamp when public visibility ends (soft-hide).';
comment on column public.family_events.manual_hidden is
  'Admin/delegate early soft-hide; row kept in DB.';

-- Backfill defaults for dated happy rows missing schedule (do not mass-touch delegates)
update public.family_events e
set show_before_days = coalesce(e.show_before_days, 3)
where e.show_before_days is null
  and e.event_date is not null
  and lower(coalesce(e.type, '')) not in ('death', 'sick', 'operation', 'discharge');

-- 2) banner_messages time window
alter table public.banner_messages
  add column if not exists show_start timestamptz;

alter table public.banner_messages
  add column if not exists show_end timestamptz;

alter table public.banner_messages
  add column if not exists is_permanent boolean default false;

comment on column public.banner_messages.show_start is
  'When the banner becomes visible (null = use created_at legacy window).';
comment on column public.banner_messages.show_end is
  'When the banner soft-hides (null + is_permanent=true = permanent).';
comment on column public.banner_messages.is_permanent is
  'If true, ignore show_end and keep visible until is_active=false.';

-- Seed show_start from created_at where missing (preserve current behaviour)
update public.banner_messages b
set show_start = coalesce(b.show_start, b.created_at)
where b.show_start is null;

update public.banner_messages b
set show_end = coalesce(
  b.show_end,
  b.created_at + make_interval(days => greatest(1, least(coalesce(b.show_days, 7), 7)))
)
where b.show_end is null
  and coalesce(b.is_permanent, false) = false
  and b.created_at is not null;

-- 3) admin_publish_event_card_v1 — persist schedule columns when present
create or replace function public.admin_publish_event_card_v1(
  p_token text,
  p_request_id text,
  p_row jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id text;
  v_details text;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  v_request_id := nullif(btrim(coalesce(p_request_id, '')), '');
  if v_request_id is null or p_row is null or jsonb_typeof(p_row) <> 'object' then
    return false;
  end if;

  if exists (
    select 1
    from public.family_events e
    where coalesce(e.details, '') like '%' || v_request_id || '%'
  ) then
    return true;
  end if;

  v_details := nullif(p_row->>'details', '');

  insert into public.family_events (
    branch_key,
    type,
    person,
    date_label,
    event_date,
    details,
    hospital_name,
    hospital_dept,
    contact_method,
    contact_phone,
    visit_date_from,
    visit_date_to,
    visit_time_from,
    visit_time_to,
    created_at,
    show_before_days,
    show_at,
    end_at,
    manual_hidden
  )
  values (
    nullif(p_row->>'branch_key', ''),
    nullif(p_row->>'type', ''),
    nullif(p_row->>'person', ''),
    nullif(p_row->>'date_label', ''),
    case
      when btrim(coalesce(p_row->>'event_date', '')) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        and substring(btrim(p_row->>'event_date') from 1 for 4)::int between 1800 and 2100
      then btrim(p_row->>'event_date')::date
      else null
    end,
    v_details,
    nullif(p_row->>'hospital_name', ''),
    nullif(p_row->>'hospital_dept', ''),
    nullif(p_row->>'contact_method', ''),
    nullif(p_row->>'contact_phone', ''),
    case
      when btrim(coalesce(p_row->>'visit_date_from', '')) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      then btrim(p_row->>'visit_date_from')::date
      else null
    end,
    case
      when btrim(coalesce(p_row->>'visit_date_to', '')) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      then btrim(p_row->>'visit_date_to')::date
      else null
    end,
    nullif(p_row->>'visit_time_from', ''),
    nullif(p_row->>'visit_time_to', ''),
    coalesce(nullif(p_row->>'created_at', '')::timestamptz, now()),
    coalesce(
      nullif(p_row->>'show_before_days', '')::int,
      3
    ),
    nullif(p_row->>'show_at', '')::timestamptz,
    nullif(p_row->>'end_at', '')::timestamptz,
    coalesce((p_row->>'manual_hidden')::boolean, false)
  );

  return true;
end;
$$;

revoke all on function public.admin_publish_event_card_v1(text, text, jsonb) from public;
grant execute on function public.admin_publish_event_card_v1(text, text, jsonb) to anon, authenticated;

-- 4) admin_family_event_insert/save — keep schedule fields
create or replace function public.admin_family_event_insert_v1(
  p_token text,
  p_row jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  if p_row is null or jsonb_typeof(p_row) <> 'object' then
    return jsonb_build_object('ok', false);
  end if;

  if nullif(btrim(coalesce(p_row->>'branch_key', '')), '') is null
     or nullif(btrim(coalesce(p_row->>'type', '')), '') is null
     or nullif(btrim(coalesce(p_row->>'person', '')), '') is null then
    return jsonb_build_object('ok', false);
  end if;

  insert into public.family_events (
    branch_key,
    type,
    person,
    date_label,
    event_date,
    details,
    hospital_name,
    hospital_dept,
    contact_method,
    contact_phone,
    visit_date_from,
    visit_date_to,
    visit_time_from,
    visit_time_to,
    created_at,
    show_before_days,
    show_at,
    end_at,
    manual_hidden
  )
  values (
    nullif(btrim(p_row->>'branch_key'), ''),
    nullif(btrim(p_row->>'type'), ''),
    nullif(btrim(p_row->>'person'), ''),
    nullif(btrim(p_row->>'date_label'), ''),
    nullif(btrim(p_row->>'event_date'), '')::date,
    nullif(p_row->>'details', ''),
    nullif(btrim(p_row->>'hospital_name'), ''),
    nullif(btrim(p_row->>'hospital_dept'), ''),
    nullif(btrim(p_row->>'contact_method'), ''),
    nullif(btrim(p_row->>'contact_phone'), ''),
    nullif(btrim(p_row->>'visit_date_from'), '')::date,
    nullif(btrim(p_row->>'visit_date_to'), '')::date,
    nullif(btrim(p_row->>'visit_time_from'), ''),
    nullif(btrim(p_row->>'visit_time_to'), ''),
    coalesce(nullif(btrim(p_row->>'created_at'), '')::timestamptz, now()),
    coalesce(nullif(btrim(p_row->>'show_before_days'), '')::int, 3),
    nullif(btrim(p_row->>'show_at'), '')::timestamptz,
    nullif(btrim(p_row->>'end_at'), '')::timestamptz,
    coalesce((p_row->>'manual_hidden')::boolean, false)
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.admin_family_event_save_v1(
  p_token text,
  p_row jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
  v_updated boolean := false;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  if p_row is null or jsonb_typeof(p_row) <> 'object' then
    return jsonb_build_object('ok', false);
  end if;

  v_id := nullif(btrim(coalesce(p_row->>'id', '')), '')::bigint;
  if v_id is null then
    return jsonb_build_object('ok', false);
  end if;

  if nullif(btrim(coalesce(p_row->>'branch_key', '')), '') is null
     or nullif(btrim(coalesce(p_row->>'type', '')), '') is null
     or nullif(btrim(coalesce(p_row->>'person', '')), '') is null then
    return jsonb_build_object('ok', false, 'id', v_id);
  end if;

  update public.family_events e
  set
    branch_key = nullif(btrim(p_row->>'branch_key'), ''),
    type = nullif(btrim(p_row->>'type'), ''),
    person = nullif(btrim(p_row->>'person'), ''),
    date_label = nullif(btrim(p_row->>'date_label'), ''),
    event_date = nullif(btrim(p_row->>'event_date'), '')::date,
    details = nullif(p_row->>'details', ''),
    hospital_name = nullif(btrim(p_row->>'hospital_name'), ''),
    hospital_dept = nullif(btrim(p_row->>'hospital_dept'), ''),
    contact_method = nullif(btrim(p_row->>'contact_method'), ''),
    contact_phone = nullif(btrim(p_row->>'contact_phone'), ''),
    visit_date_from = nullif(btrim(p_row->>'visit_date_from'), '')::date,
    visit_date_to = nullif(btrim(p_row->>'visit_date_to'), '')::date,
    visit_time_from = nullif(btrim(p_row->>'visit_time_from'), ''),
    visit_time_to = nullif(btrim(p_row->>'visit_time_to'), ''),
    show_before_days = coalesce(
      nullif(btrim(p_row->>'show_before_days'), '')::int,
      e.show_before_days,
      3
    ),
    show_at = coalesce(
      nullif(btrim(p_row->>'show_at'), '')::timestamptz,
      e.show_at
    ),
    end_at = coalesce(
      nullif(btrim(p_row->>'end_at'), '')::timestamptz,
      e.end_at
    ),
    manual_hidden = coalesce(
      (p_row->>'manual_hidden')::boolean,
      e.manual_hidden,
      false
    )
  where e.id = v_id;

  v_updated := found;
  return jsonb_build_object('ok', v_updated, 'id', v_id);
end;
$$;

grant execute on function public.admin_family_event_insert_v1(text, jsonb) to anon, authenticated;
grant execute on function public.admin_family_event_save_v1(text, jsonb) to anon, authenticated;

-- 5) banner update RPC — accept show_start / show_end / is_permanent
create or replace function public.admin_banner_message_update_v1(
  p_token text,
  p_id bigint,
  p_branch_key text,
  p_message text,
  p_show_days int,
  p_is_active boolean,
  p_created_at timestamptz default null,
  p_show_start timestamptz default null,
  p_show_end timestamptz default null,
  p_is_permanent boolean default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  update public.banner_messages b
  set
    branch_key = nullif(trim(coalesce(p_branch_key, '')), ''),
    message = nullif(trim(coalesce(p_message, '')), ''),
    show_days = greatest(1, least(coalesce(p_show_days, b.show_days, 7), 7)),
    is_active = coalesce(p_is_active, b.is_active, true),
    created_at = coalesce(p_created_at, b.created_at),
    show_start = coalesce(p_show_start, p_created_at, b.show_start, b.created_at),
    show_end = case
      when coalesce(p_is_permanent, b.is_permanent, false) then null
      else coalesce(p_show_end, b.show_end)
    end,
    is_permanent = coalesce(p_is_permanent, b.is_permanent, false)
  where b.id = p_id;

  return found;
end;
$$;

grant execute on function public.admin_banner_message_update_v1(
  text, bigint, text, text, int, boolean, timestamptz, timestamptz, timestamptz, boolean
) to anon, authenticated;

-- Optional: keep older 7-arg signature working via overload wrapper
create or replace function public.admin_banner_message_update_v1(
  p_token text,
  p_id bigint,
  p_branch_key text,
  p_message text,
  p_show_days int,
  p_is_active boolean,
  p_created_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.admin_banner_message_update_v1(
    p_token,
    p_id,
    p_branch_key,
    p_message,
    p_show_days,
    p_is_active,
    p_created_at,
    p_created_at,
    null,
    null
  );
end;
$$;

grant execute on function public.admin_banner_message_update_v1(
  text, bigint, text, text, int, boolean, timestamptz
) to anon, authenticated;

-- 5) Delegate insert path — persist schedule so approve ≠ immediate public show
create or replace function public.family_events_insert_v1(
  p_branch_key text,
  p_phone text,
  p_email text,
  p_secret_hash text,
  p_row jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.events_delegate_allowed_v1(p_branch_key, p_phone, p_email, p_secret_hash) then
    return false;
  end if;

  insert into public.family_events (
    branch_key,
    type,
    person,
    date_label,
    event_date,
    details,
    hospital_name,
    hospital_dept,
    contact_method,
    contact_phone,
    visit_date_from,
    visit_date_to,
    visit_time_from,
    visit_time_to,
    created_at,
    show_before_days,
    show_at,
    end_at,
    manual_hidden
  )
  values (
    p_branch_key,
    nullif(p_row->>'type', ''),
    nullif(p_row->>'person', ''),
    nullif(p_row->>'date_label', ''),
    nullif(p_row->>'event_date', '')::date,
    nullif(p_row->>'details', ''),
    nullif(p_row->>'hospital_name', ''),
    nullif(p_row->>'hospital_dept', ''),
    nullif(p_row->>'contact_method', ''),
    nullif(p_row->>'contact_phone', ''),
    nullif(p_row->>'visit_date_from', '')::date,
    nullif(p_row->>'visit_date_to', '')::date,
    nullif(p_row->>'visit_time_from', ''),
    nullif(p_row->>'visit_time_to', ''),
    coalesce(nullif(p_row->>'created_at', '')::timestamptz, now()),
    coalesce(nullif(p_row->>'show_before_days', '')::int, 3),
    nullif(p_row->>'show_at', '')::timestamptz,
    nullif(p_row->>'end_at', '')::timestamptz,
    coalesce((p_row->>'manual_hidden')::boolean, false)
  );

  -- Internal audit only — edge notify MUST skip events_audit kinds.
  perform public.events_audit_log_v1(
    p_branch_key,
    p_phone,
    p_email,
    p_secret_hash,
    jsonb_build_object(
      'v', 1,
      'kind', 'events_audit',
      'op', 'insert',
      'branch_key', p_branch_key,
      'type', coalesce(p_row->>'type', ''),
      'person', coalesce(p_row->>'person', ''),
      'event_date', coalesce(p_row->>'event_date', ''),
      'at', now()::timestamptz
    )
  );

  return true;
end;
$$;

grant execute on function public.family_events_insert_v1(text, text, text, text, jsonb) to anon, authenticated;

-- Smoke select (workspace-friendly final statement)
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'family_events'
      and column_name in ('show_before_days', 'show_at', 'end_at', 'manual_hidden')) as family_event_schedule_cols,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'banner_messages'
      and column_name in ('show_start', 'show_end', 'is_permanent')) as banner_schedule_cols;
`,
      order: 55,
    },
    {
      id: "maint.admin_delete_request_unpublish_event_v1",
      title: "حذف الطلب يلغي نشر المناسبة (family_events)",
      desc:
        "CREATE OR REPLACE لـ admin_delete_request_v1: عند حذف event_card يُحذف صف family_events المطابق لـ request_id. لا يمس tree_card. بدون silent exception.",
      file: "../supabase/sql/COPY-ME-admin-delete-request-unpublish-event.sql",
      sql: `-- Extends admin_delete_request_v1 so deleting an event_card request
-- also removes the published family_events row (public ticker / المناسبات).
-- Resolves p_id as approval_requests.id (digits-only) OR request_id (EVN-*).
-- Never strip digits from EVN-* (e.g. EVN-A6HR-PLQ8 must not become id=68).
-- No silent exception swallow — real errors surface to the admin UI.

create or replace function public.admin_delete_request_v1(
  p_token text,
  p_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_raw text := nullif(btrim(coalesce(p_id, '')), '');
  v_id bigint := null;
  v_kind text := null;
  v_request_id text := null;
begin
  if not public.admin_token_ok_v1(p_token) then
    return false;
  end if;

  if v_raw is null then
    return false;
  end if;

  -- Pure digits = approval_requests.id.
  if v_raw ~ '^[0-9]+$' then
    v_id := v_raw::bigint;
    select r.kind, r.request_id
      into v_kind, v_request_id
    from public.approval_requests r
    where r.id = v_id
    limit 1;
  else
    -- EVN-* / OCC-* / any non-pure-numeric token → request_id lookup.
    select r.id, r.kind, r.request_id
      into v_id, v_kind, v_request_id
    from public.approval_requests r
    where r.request_id = v_raw
    limit 1;
  end if;

  if v_id is null then
    return false;
  end if;

  if v_kind in ('event_card', 'family_event', 'event_request')
     and nullif(btrim(coalesce(v_request_id, '')), '') is not null then
    delete from public.family_events e
    where coalesce(e.details, '') like '%' || v_request_id || '%';
  end if;

  delete from public.approval_requests where id = v_id;
  return found;
end;
$$;

revoke all on function public.admin_delete_request_v1(text, text) from public;
grant execute on function public.admin_delete_request_v1(text, text) to anon, authenticated;
`,
      order: 60,
      supabaseOnce: true,
    },
    {
      id: "maint.admin_family_event_delete_unlink_request_v1",
      title: "حذف المناسبة يلغي طلب المندوب",
      desc:
        "CREATE OR REPLACE لـ admin_family_event_delete_v1: عند حذف صف من «إدارة الأخبار والمناسبات» يُحذف أيضاً approval_request المرتبط (event_card) حتى يختفي من طلبات فرعي. شغّله مرة ثم احذف من اللوحة.",
      file: "../supabase/sql/COPY-ME-admin-family-event-delete-unlink-request.sql",
      sql: `-- COPY-ME: run in Supabase SQL Editor / SQL Workspace
-- Preset id: maint.admin_family_event_delete_unlink_request_v1
--
-- Admin delete of a family_events row must also remove the linked
-- approval_requests (event_card / family_event / event_request) so the item
-- disappears from homepage AND delegate «طلبات فرعي» (not left as «منشور»).
--
-- Safe to re-run (CREATE OR REPLACE only — no data DELETE).

create or replace function public.admin_family_event_delete_v1(
  p_token text,
  p_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_details text;
  v_request_id text := null;
  v_deleted boolean := false;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  if p_id is null or p_id <= 0 then
    return false;
  end if;

  select e.details
    into v_details
  from public.family_events e
  where e.id = p_id
  limit 1;

  if not found then
    return false;
  end if;

  -- Extract requestId / request_id from details JSON when present.
  begin
    if nullif(btrim(coalesce(v_details, '')), '') is not null then
      v_request_id := nullif(btrim(coalesce(
        (v_details::jsonb)->>'requestId',
        (v_details::jsonb)->>'request_id',
        ((v_details::jsonb)->'event')->>'requestId',
        ((v_details::jsonb)->'event')->>'request_id',
        ''
      )), '');
    end if;
  exception
    when others then
      v_request_id := null;
  end;

  -- Fallback: requestId embedded as text in details.
  if v_request_id is null and nullif(btrim(coalesce(v_details, '')), '') is not null then
    v_request_id := nullif(
      btrim(
        coalesce(
          (regexp_match(v_details, '("requestId"|"request_id")\\s*:\\s*"([^"]+)"'))[2],
          ''
        )
      ),
      ''
    );
  end if;

  delete from public.family_events e where e.id = p_id;
  v_deleted := found;

  if not v_deleted then
    return false;
  end if;

  -- Remove linked approval request so delegate inbox/history stops showing it
  -- as an active published/approved event card.
  if v_request_id is not null then
    delete from public.approval_requests r
    where r.request_id = v_request_id
      and r.kind in ('event_card', 'family_event', 'event_request');
  end if;

  return true;
end;
$$;

revoke all on function public.admin_family_event_delete_v1(text, bigint) from public;
grant execute on function public.admin_family_event_delete_v1(text, bigint) to anon, authenticated;

comment on function public.admin_family_event_delete_v1(text, bigint) is
  'Admin hard-delete family_events by id and unlink matching event approval_requests.';

-- Harden admin_delete_request_v1: unpublish family_events then delete request.
-- No silent exception swallow — real errors surface (Arabic-mapped in UI).
-- Extends admin_delete_request_v1 so deleting an event_card request
-- also removes the published family_events row (public ticker / المناسبات).
-- Resolves p_id as approval_requests.id (digits-only) OR request_id (EVN-*).
-- Never strip digits from EVN-* (e.g. EVN-A6HR-PLQ8 must not become id=68).
-- No silent exception swallow — real errors surface to the admin UI.

create or replace function public.admin_delete_request_v1(
  p_token text,
  p_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_raw text := nullif(btrim(coalesce(p_id, '')), '');
  v_id bigint := null;
  v_kind text := null;
  v_request_id text := null;
begin
  if not public.admin_token_ok_v1(p_token) then
    return false;
  end if;

  if v_raw is null then
    return false;
  end if;

  -- Pure digits = approval_requests.id.
  if v_raw ~ '^[0-9]+$' then
    v_id := v_raw::bigint;
    select r.kind, r.request_id
      into v_kind, v_request_id
    from public.approval_requests r
    where r.id = v_id
    limit 1;
  else
    -- EVN-* / OCC-* / any non-pure-numeric token → request_id lookup.
    select r.id, r.kind, r.request_id
      into v_id, v_kind, v_request_id
    from public.approval_requests r
    where r.request_id = v_raw
    limit 1;
  end if;

  if v_id is null then
    return false;
  end if;

  if v_kind in ('event_card', 'family_event', 'event_request')
     and nullif(btrim(coalesce(v_request_id, '')), '') is not null then
    delete from public.family_events e
    where coalesce(e.details, '') like '%' || v_request_id || '%';
  end if;

  delete from public.approval_requests where id = v_id;
  return found;
end;
$$;

revoke all on function public.admin_delete_request_v1(text, text) from public;
grant execute on function public.admin_delete_request_v1(text, text) to anon, authenticated;

select
  (select to_regprocedure('public.admin_family_event_delete_v1(text,bigint)') is not null)
    as has_family_event_delete,
  (select pg_get_functiondef('public.admin_family_event_delete_v1(text,bigint)'::regprocedure)
     like '%approval_requests%') as delete_unlinks_requests,
  (select to_regprocedure('public.admin_delete_request_v1(text,text)') is not null)
    as has_delete_request;
`,
      order: 60.5,
      supabaseOnce: true,
    },
    {
      id: "maint.cleanup_orphan_approved_event_requests_v1",
      title: "تنظيف طلبات مناسبات يتيمة (مقبولة بلا نشر)",
      desc:
        "APPLY: يحذف approval_requests بحالة approved لنوع مناسبة ولم يعد لها صف في family_events (بقايا بعد حذف تجريبي من اللوحة). لا يمس pending/rejected ولا الشجرة.",
      file: "../supabase/sql/COPY-ME-cleanup-orphan-approved-event-requests.sql",
      sql: `-- APPLY: cleanup orphan approved event requests
-- Preset: maint.cleanup_orphan_approved_event_requests_v1

delete from public.approval_requests r
where r.kind in ('event_card', 'family_event', 'event_request')
  and lower(coalesce(r.status, '')) = 'approved'
  and nullif(btrim(coalesce(r.request_id, '')), '') is not null
  and not exists (
    select 1 from public.family_events e
    where coalesce(e.details, '') like '%' || r.request_id || '%'
  );

select
  (
    select count(*)::int
    from public.approval_requests r
    where r.kind in ('event_card', 'family_event', 'event_request')
      and lower(coalesce(r.status, '')) = 'approved'
      and nullif(btrim(coalesce(r.request_id, '')), '') is not null
      and not exists (
        select 1 from public.family_events e
        where coalesce(e.details, '') like '%' || r.request_id || '%'
      )
  ) as remaining_orphan_approved_event_requests;
`,
      order: 60.6,
      supabaseOnce: true,
    },
    {
      id: "maint.admin_reject_request_unpublish_event_v1",
      title: "رفض الطلب يلغي نشر المناسبة (family_events)",
      desc: "Trigger: عند status=rejected لـ event_card/family_event/event_request يُحذف صف family_events المطابق لـ request_id (يشمل محرك السير). لا يستبدل admin_set_request_status_v2. الصق مرة في Supabase SQL Editor.",
      file: "../supabase/sql/COPY-ME-admin-reject-request-unpublish-event.sql",
      sql: `-- COPY-ME: run in Supabase SQL Editor (once)
-- عند رفض طلب مناسبة (event_card / family_event / event_request):
-- يُحذف صف family_events المطابق لـ request_id من details (الشريط + المناسبات).
-- Trigger آمن — لا يستبدل admin_set_request_status_v2.
-- يعمل أيضاً عندما يضبط محرك السير status=rejected عبر admin_workflow_transition_v1.
-- الواجهة أيضاً تلغي النشر من JS (unpublishPublishedEventForRequest) + RPC
-- COPY-ME-admin-unpublish-events-for-request-v1.sql (هوية type+person+date كاحتياط).

create or replace function public.trg_approval_request_reject_unpublish_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.status = 'rejected'
     and NEW.kind in ('event_card', 'family_event', 'event_request')
     and nullif(btrim(coalesce(NEW.request_id, '')), '') is not null
     and (
       TG_OP = 'INSERT'
       or OLD.status is distinct from NEW.status
     ) then
    -- Exact same match as admin_delete_request_v1
    delete from public.family_events e
    where coalesce(e.details, '') like '%' || NEW.request_id || '%';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_approval_request_reject_unpublish_event
  on public.approval_requests;

create trigger trg_approval_request_reject_unpublish_event
  after insert or update of status on public.approval_requests
  for each row
  execute function public.trg_approval_request_reject_unpublish_event();
`,
      order: 61,
      supabaseOnce: true,
    },
    {
      id: "maint.admin_unpublish_events_for_request_v1",
      title: "RPC إلغاء نشر مناسبة لطلب (رفض/حذف)",
      desc: "admin_unpublish_events_for_request_v1: حذف family_events بـ request_id أو type+person+date من الواجهة/محرك السير بدون الاعتماد على SELECT فقط. الصق مرة في Supabase SQL Editor.",
      file: "../supabase/sql/COPY-ME-admin-unpublish-events-for-request-v1.sql",
      sql: `-- COPY-ME: run once in Supabase SQL Editor
-- RPC لإلغاء نشر family_events عند رفض/حذف طلب مناسبة.

-- Admin: unpublish family_events for an approval request (reject / delete helpers).
-- Security definer — does not rely on client SELECT + like quirks.
-- Match: request_id inside details, else type+person+date identity.
-- event_date cast to text (column may be date) — btrim(date) used to abort the RPC.

create or replace function public.admin_unpublish_events_for_request_v1(
  p_token text,
  p_request_id text default null,
  p_person text default null,
  p_type text default null,
  p_date text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rid text := nullif(btrim(coalesce(p_request_id, '')), '');
  v_person text := nullif(btrim(coalesce(p_person, '')), '');
  v_type text := nullif(btrim(coalesce(p_type, '')), '');
  v_date text := nullif(btrim(coalesce(p_date, '')), '');
  v_deleted int := 0;
begin
  if not public.admin_token_ok_v1(p_token) then
    return jsonb_build_object('ok', false, 'code', 'AUTH', 'deleted', 0);
  end if;

  -- Exact same match as admin_delete_request_v1 (delete path that already works).
  if v_rid is not null then
    delete from public.family_events e
    where coalesce(e.details, '') like '%' || v_rid || '%';
    get diagnostics v_deleted = row_count;
  end if;

  if v_deleted = 0 and v_person is not null and v_type is not null and v_date is not null then
    delete from public.family_events e
    where e.type = v_type
      and e.person = v_person
      and (
        coalesce(nullif(btrim(e.event_date::text), ''), '') = v_date
        or coalesce(nullif(btrim(coalesce(e.date_label, '')), ''), '') = v_date
      );
    get diagnostics v_deleted = row_count;
  end if;

  return jsonb_build_object('ok', true, 'deleted', coalesce(v_deleted, 0));
end;
$$;

revoke all on function public.admin_unpublish_events_for_request_v1(text, text, text, text, text) from public;
grant execute on function public.admin_unpublish_events_for_request_v1(text, text, text, text, text) to anon, authenticated;

comment on function public.admin_unpublish_events_for_request_v1(text, text, text, text, text) is
  'Reject/delete helper: remove published family_events by request_id in details or type+person+date.';
`,
      order: 61.5,
      supabaseOnce: true,
    },
    {
      id: "maint.cleanup_evn_lk9x_rqui_v1",
      title: "تنظيف طلب EVN-LK9X-RQUI (حسن خميس)",
      desc:
        "APPLY: يحذف طلب EVN-LK9X-RQUI من approval_requests وأي family_events مرتبط. بعد التشغيل: Hard Refresh لجدول الطلبات.",
      file: "../supabase/sql/COPY-ME-cleanup-evn-lk9x-rqui.sql",
      sql: `-- APPLY: remove stuck request EVN-LK9X-RQUI (حسن خميس / مزيد / بطاقة مناسبة)
-- Preset: maint.cleanup_evn_lk9x_rqui_v1
-- Safe scope: this request_id only (+ matching family_events details).

delete from public.family_events e
where coalesce(e.details, '') like '%EVN-LK9X-RQUI%';

delete from public.approval_requests r
where r.request_id = 'EVN-LK9X-RQUI'
  and r.kind in ('event_card', 'family_event', 'event_request');

select
  (select count(*)::int
     from public.approval_requests r
    where r.request_id = 'EVN-LK9X-RQUI') as remaining_requests,
  (select count(*)::int
     from public.family_events e
    where coalesce(e.details, '') like '%EVN-LK9X-RQUI%') as remaining_family_events;
`,
      order: 61.6,
      supabaseOnce: true,
    },
    {
      id: "maint.cleanup_stuck_gathering_hasan_dry_run_v1",
      title: "معاينة مناسبة حسن/اجتماع عالقة في family_events",
      desc: "قراءة فقط: orphan gathering لحسن (تاريخ/تجربه/EVN/هاتف). شغّله قبل APPLY أو احذف من «إدارة الأخبار والمناسبات».",
      file: "../supabase/sql/COPY-ME-cleanup-stuck-gathering-hasan-dry-run.sql",
      sql: `-- DRY-RUN only (SELECT). Find stuck «حسن / اجتماع عائلي» rows left in family_events
-- after deleting the approval request from الطلبات without unpublishing.
-- Prefer UI: Admin → إدارة الأخبار والمناسبات → تحميل → اختر حسن/اجتماع → حذف.
-- Then run APPLY only if the row remains (deletes newest match only).

select
  e.id,
  e.branch_key,
  e.type,
  e.person,
  e.date_label,
  e.event_date,
  e.contact_phone,
  e.created_at,
  left(coalesce(e.details, ''), 220) as details_preview
from public.family_events e
where e.type = 'gathering'
  and e.person ilike '%حسن%'
  and (
    coalesce(e.date_label, '') like '%١٤٤٨-٣-٣%'
    or coalesce(e.date_label, '') like '%1448-3-3%'
    or coalesce(e.details, '') ilike '%تجربه%'
    or coalesce(e.details, '') ilike '%تجربة%'
    or coalesce(e.details, '') ilike '%EVN-%'
    or coalesce(e.contact_phone, '') like '%551840058%'
  )
order by e.created_at desc
limit 20;
`,
      order: 62,
    },
    {
      id: "maint.cleanup_stuck_gathering_hasan_apply_v1",
      title: "حذف مناسبة حسن/اجتماع العالقة (APPLY)",
      desc: "DELETE صف واحد فقط (أحدث مطابقة). يفضّل الحذف من لوحة المناسبات (admin_family_event_delete_v1). لا يمس الشجرة ولا الطلبات.",
      file: "../supabase/sql/COPY-ME-cleanup-stuck-gathering-hasan-apply.sql",
      sql: `-- APPLY: hard-delete ONE stuck gathering row for حسن (اجتماع عائلي) — newest match only.
-- 1) Run COPY-ME-cleanup-stuck-gathering-hasan-dry-run.sql and confirm the top id
--    (live orphan seen: id=42, date_label=١٤٤٨-٣-٣, details text=تجربه, requestId EVN-HTWF-NWTM).
-- 2) Prefer UI if the row still appears: Admin → إدارة الأخبار والمناسبات → حذف
--    (uses admin_family_event_delete_v1). No need to touch الطلبات (already gone).
-- 3) This DELETE targets a single id via subquery LIMIT 1 — not a mass delete.
-- 4) Does not touch tree_children / add-person / approval_requests.

delete from public.family_events e
where e.id = (
  select x.id
  from public.family_events x
  where x.type = 'gathering'
    and x.person ilike '%حسن%'
    and (
      coalesce(x.date_label, '') like '%١٤٤٨-٣-٣%'
      or coalesce(x.date_label, '') like '%1448-3-3%'
      or coalesce(x.details, '') ilike '%تجربه%'
      or coalesce(x.details, '') ilike '%تجربة%'
      or coalesce(x.details, '') ilike '%EVN-%'
      or coalesce(x.contact_phone, '') like '%551840058%'
    )
  order by x.created_at desc
  limit 1
)
returning e.id, e.type, e.person, e.date_label, e.event_date, e.created_at;
`,
      order: 63,
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
      fetchPresetSql: async function (presetOrFile) {
        if (presetOrFile && typeof presetOrFile === "object") {
          const inline = String(presetOrFile.sql || "").trim();
          if (inline) return String(presetOrFile.sql);
          if (presetOrFile.file) return api.fetchPresetSql(presetOrFile.file);
          throw new Error("لا يوجد SQL مضمّن ولا مسار ملف لهذا الأمر الجاهز.");
        }
        const file = String(presetOrFile || "");
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
      const sql = await api.fetchPresetSql(p);
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
      sql = await api.fetchPresetSql(p);
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
      const Pipe = window.AlzidanIntegrityRepairPipeline;
      const failLine =
        Pipe && typeof Pipe.formatRepairFailureAr === "function"
          ? Pipe.formatRepairFailureAr(msg)
          : "فشل التنفيذ — سبب الفشل: " + msg;
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
        error: failLine,
        sql: sql,
        actor: actor,
        requestId: requestId,
        version: p.id,
        source: "preset",
        auditId: payload && payload.audit_id,
      });
      setError(failLine);
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
      pendingHealthRepair =
        meta && meta.health_repair ? Object.assign({}, meta.health_repair) : null;
      setEditorVisible(true);
      const title = (meta && meta.title) || "أمر من مركز الصحة";
      setStatus(
        "ok",
        "✅ محمّل من مركز الصحة: " +
          title +
          " — تحديث سجل واحد · راجع ثم نفّذ الإصلاح وأكّد الكتابة.",
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
