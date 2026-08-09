/**
 * SQL Workspace — ready maintenance presets.
 * SQL source of truth: supabase/sql/*.sql (fetched at run time).
 * Command lifecycle SSOT: archived (done) > failed > pending.
 * Done presets live in archive only; active list = not-yet-done current state.
 */
(function () {
  "use strict";

  const DONE_KEY = "alzidan_sql_ws_presets_done_v1";
  const FAIL_KEY = "alzidan_sql_ws_presets_fail_v1";

  /** @type {{id:string,title:string,desc:string,file:string,order:number,bootstrap?:boolean,supabaseOnce?:boolean}[]} */
  const PRESETS = [
    {
      id: "maint.sql_workspace_run_v2",
      title: "تثبيت منفّذ SQL Workspace v2",
      desc:
        "إلزامي أولًا: إن ظهر «يُسمح بأمر واحد فقط» فالصق COPY-ME-admin-sql-workspace-run-v2.sql مرة واحدة في Supabase SQL Editor (CREATE OR REPLACE فقط — بدون pg_proc). بعدها شغّل هذه البطاقة ثم بقية أوامر الصيانة من المساحة.",
      file: "../supabase/sql/COPY-ME-admin-sql-workspace-run-v2.sql",
      order: 10,
      bootstrap: true,
      supabaseOnce: true,
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
    {
      id: "maint.repair_null_parent_columns_dry_run_v1",
      title: "معاينة parent/child_name الفارغ (dry-run)",
      desc: "قراءة فقط: يعرض الصفوف ذات parent أو child_name فارغ ومقترح الملء. شغّله أولًا قبل APPLY. ليس إصلاحًا تلقائيًا.",
      file: "../supabase/sql/COPY-ME-repair-null-parent-columns-dry-run.sql",
      order: 40,
    },
    {
      id: "maint.repair_null_parent_columns_apply_v1",
      title: "تطبيق ملء parent/child_name (APPLY)",
      desc: "كتابة: املأ parent من parent_name أو مسار name بعد نجاح dry-run وموافقة صريحة. لا Auto Repair من مركز الصحة.",
      file: "../supabase/sql/COPY-ME-repair-null-parent-columns-apply.sql",
      order: 41,
    },
    {
      id: "maint.link_uuid_nada_tuaisan_hamad_mohammad_dry_run_v1",
      title: "ربط UUID سلسلة نداء-طعيسان-حمد-محمد (1738-1740) — معاينة",
      desc: "SELECT واحد آمن لـ Workspace: اسم الأب وperson_id لـ 1738/1739/1740. إن لم يُحل نداء بفرادة يظهر المرشحون دون APPLY.",
      file: "../supabase/sql/COPY-ME-link-uuid-nada-tuaisan-hamad-mohammad-dry-run.sql",
      order: 50,
    },
    {
      id: "maint.link_uuid_nada_tuaisan_hamad_mohammad_apply_v1",
      title: "ربط UUID سلسلة نداء-طعيسان-حمد-محمد (1738-1740) — APPLY",
      desc: "UPDATE واحد لـ parent_person_id فقط (بلا CTE). 1740 بشرط نداء فريد. أعد المعاينة بعد النجاح. لا Auto Repair.",
      file: "../supabase/sql/COPY-ME-link-uuid-nada-tuaisan-hamad-mohammad-apply.sql",
      order: 51,
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

  /**
   * Single source of truth for a maintenance command:
   * archived (done) > failed > pending. Attempt history must not override.
   */
  function commandState(id) {
    if (isDone(id)) return "archived";
    if (getFail(id)) return "failed";
    return "pending";
  }

  function markDone(id, meta) {
    const map = loadDone();
    map[id] = Object.assign(
      { at: new Date().toISOString(), ok: true, archived: true },
      meta || {},
    );
    saveDone(map);
    // Success supersedes every prior fail flag for this command.
    const fails = loadFail();
    if (fails[id]) {
      delete fails[id];
      saveFail(fails);
    }
  }

  function markFail(id, meta) {
    // Never paint "failed" over an archived success.
    if (isDone(id)) return;
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
    if (isDone(id)) return null;
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
    commandState,
    listActivePresets,
    listArchivedPresets,
    DONE_KEY,
    FAIL_KEY,
  };
})();
