/**
 * SQL Workspace — ready maintenance presets.
 * SQL source of truth: supabase/sql/*.sql (fetched at run time).
 * Done presets live in archive metadata; active list = pending / failed only.
 */
(function () {
  "use strict";

  const DONE_KEY = "alzidan_sql_ws_presets_done_v1";
  const FAIL_KEY = "alzidan_sql_ws_presets_fail_v1";

  /** @type {{id:string,title:string,desc:string,file:string,order:number,bootstrap?:boolean}[]} */
  const PRESETS = [
    {
      id: "maint.sql_workspace_literal_aware_v1",
      title: "ترقية منفّذ SQL Workspace (أجسام الدوال)",
      desc: "يرقّي المنفّذ عبر UPDATE pg_proc من داخل المساحة (بدون Supabase) ثم يسمح بـ CREATE FUNCTION والتشغيل المتسلسل.",
      file: "../supabase/sql/20260809_sql_workspace_executor_bootstrap.sql",
      order: 10,
      bootstrap: true,
    },
    {
      id: "maint.fix_delegate_portal_path_v1",
      title: "إصلاح دخول المندوب بعد القبول (بوابة 1)",
      desc: "تفعيل/مزامنة delegates_v2 عند اعتماد طلب مندوب + request_id في check_* — مطلوب قبل إعادة اختبار بوابة 1.",
      file: "../supabase/sql/COPY-ME-fix-delegate-portal-path.sql",
      order: 20,
    },
    {
      id: "maint.delegate_secret_reset_v1",
      title: "طلب إعادة تعيين الرقم السري (واجهة مخصصة)",
      desc: "نية منفصلة delegate_secret_reset + اعتماد/رفض يحدّثون الرقم السري دون كروم Workflow العام.",
      file: "../supabase/sql/COPY-ME-delegate-secret-reset.sql",
      order: 30,
    },
  ];

  function loadDone() {
    try {
      const raw = localStorage.getItem(DONE_KEY);
      const obj = raw ? JSON.parse(raw) : {};
      return obj && typeof obj === "object" ? obj : {};
    } catch (_) {
      return {};
    }
  }

  function saveDone(map) {
    try {
      localStorage.setItem(DONE_KEY, JSON.stringify(map || {}));
    } catch (_) {}
  }

  function loadFail() {
    try {
      const raw = localStorage.getItem(FAIL_KEY);
      const obj = raw ? JSON.parse(raw) : {};
      return obj && typeof obj === "object" ? obj : {};
    } catch (_) {
      return {};
    }
  }

  function saveFail(map) {
    try {
      localStorage.setItem(FAIL_KEY, JSON.stringify(map || {}));
    } catch (_) {}
  }

  function markDone(id, meta) {
    const map = loadDone();
    map[id] = Object.assign(
      { at: new Date().toISOString(), ok: true, archived: true },
      meta || {},
    );
    saveDone(map);
    const fails = loadFail();
    if (fails[id]) {
      delete fails[id];
      saveFail(fails);
    }
  }

  function markFail(id, meta) {
    const map = loadFail();
    map[id] = Object.assign(
      { at: new Date().toISOString(), ok: false },
      meta || {},
    );
    saveFail(map);
  }

  function clearDone(id) {
    const map = loadDone();
    delete map[id];
    saveDone(map);
  }

  function clearFail(id) {
    const map = loadFail();
    delete map[id];
    saveFail(map);
  }

  function isDone(id) {
    const row = loadDone()[id];
    return !!(row && row.ok);
  }

  function getFail(id) {
    return loadFail()[id] || null;
  }

  function listActivePresets() {
    return (PRESETS || [])
      .slice()
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .filter((p) => !isDone(p.id));
  }

  function listArchivedPresets() {
    const done = loadDone();
    return (PRESETS || [])
      .slice()
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .filter((p) => !!(done[p.id] && done[p.id].ok))
      .map((p) => ({
        preset: p,
        meta: done[p.id],
      }));
  }

  /**
   * Split SQL script into statements; respect $tag$ … $tag$ and quotes.
   */
  function splitSqlStatements(sql) {
    const src = String(sql || "");
    const out = [];
    let buf = "";
    let i = 0;
    const n = src.length;

    while (i < n) {
      const ch = src[i];

      if (ch === "-" && src[i + 1] === "-") {
        buf += ch;
        i++;
        while (i < n && src[i] !== "\n") {
          buf += src[i];
          i++;
        }
        continue;
      }

      if (ch === "/" && src[i + 1] === "*") {
        buf += "/*";
        i += 2;
        while (i < n - 1) {
          if (src[i] === "*" && src[i + 1] === "/") {
            buf += "*/";
            i += 2;
            break;
          }
          buf += src[i];
          i++;
        }
        continue;
      }

      if (ch === "$") {
        let j = i + 1;
        while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
        if (j < n && src[j] === "$") {
          const tag = src.slice(i, j + 1);
          buf += tag;
          i = j + 1;
          while (i <= n - tag.length) {
            if (src.slice(i, i + tag.length) === tag) {
              buf += tag;
              i += tag.length;
              break;
            }
            buf += src[i];
            i++;
          }
          continue;
        }
      }

      if (ch === "'") {
        buf += ch;
        i++;
        while (i < n) {
          buf += src[i];
          if (src[i] === "'") {
            if (src[i + 1] === "'") {
              buf += src[i + 1];
              i += 2;
              continue;
            }
            i++;
            break;
          }
          i++;
        }
        continue;
      }

      if (ch === ";") {
        const stmt = buf.trim();
        if (stmt) {
          const stripped = stmt
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/--[^\n]*/g, "")
            .trim();
          if (stripped) out.push(stmt);
        }
        buf = "";
        i++;
        continue;
      }

      buf += ch;
      i++;
    }

    const tail = buf.trim();
    if (tail) {
      const stripped = tail
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/--[^\n]*/g, "")
        .trim();
      if (stripped) out.push(tail);
    }
    return out;
  }

  async function fetchPresetSql(file) {
    const url = new URL(file, window.location.href).toString();
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(
        "تعذّر تحميل ملف SQL (" + res.status + "). تأكد أن مجلد supabase منشور مع الموقع.",
      );
    }
    return await res.text();
  }

  window.AlzidanSqlPresets = {
    PRESETS,
    splitSqlStatements,
    fetchPresetSql,
    loadDone,
    loadFail,
    markDone,
    markFail,
    clearDone,
    clearFail,
    isDone,
    getFail,
    listActivePresets,
    listArchivedPresets,
    DONE_KEY,
    FAIL_KEY,
  };
})();
