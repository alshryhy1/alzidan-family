/**
 * Integrity Repair Pipeline — staged, approval-gated repairs.
 * Stages: Analyze → Preview → Approve → Execute (SQL Workspace) → Re-verify → Log
 *
 * Policy (R-7): NO auto-repair-all · NO silent writes from Health Center.
 * Execute = load explicit single-row SQL into SQL Workspace after admin approve.
 *
 * Global: window.AlzidanIntegrityRepairPipeline
 */
(function (global) {
  "use strict";

  var LOG_KEY = "alzidan_health_repair_log_v1";
  var STAGES = [
    "analyze",
    "preview",
    "approve",
    "execute",
    "reverify",
    "log",
  ];

  function norm(v) {
    return String(v == null ? "" : v)
      .replace(/\s+/g, " ")
      .trim();
  }

  function sqlLit(v) {
    return "'" + String(v == null ? "" : v).replace(/'/g, "''") + "'";
  }

  function loadLog() {
    try {
      var raw = localStorage.getItem(LOG_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (_) {
      return [];
    }
  }

  function saveLog(entries) {
    try {
      localStorage.setItem(LOG_KEY, JSON.stringify((entries || []).slice(0, 200)));
    } catch (_) {}
  }

  function appendLog(entry) {
    var list = loadLog();
    list.unshift(
      Object.assign(
        {
          at: new Date().toISOString(),
          stage: "log",
        },
        entry || {},
      ),
    );
    saveLog(list);
    return list[0];
  }

  function extractParentFromName(path) {
    var Struct = global.AlzidanIntegrityTreeStructure;
    if (Struct && typeof Struct.extractParentFromName === "function") {
      return Struct.extractParentFromName(path);
    }
    var p = norm(path);
    if (!p || p.indexOf("/") < 0) return "";
    var parts = p.split("/").map(norm).filter(Boolean);
    if (parts.length < 2) return "";
    return parts.slice(0, -1).join("/");
  }

  function leafOf(path) {
    var p = norm(path);
    if (!p) return "";
    return p.indexOf("/") >= 0 ? p.slice(p.lastIndexOf("/") + 1) : p;
  }

  /** Levenshtein distance — capped for short Arabic name leaves. */
  function editDistance(a, b) {
    var s = norm(a);
    var t = norm(b);
    if (s === t) return 0;
    if (!s.length) return t.length;
    if (!t.length) return s.length;
    if (Math.abs(s.length - t.length) > 4) return 99;
    var prev = [];
    var i;
    var j;
    for (j = 0; j <= t.length; j++) prev[j] = j;
    for (i = 1; i <= s.length; i++) {
      var cur = [i];
      for (j = 1; j <= t.length; j++) {
        var cost = s.charAt(i - 1) === t.charAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      }
      prev = cur;
    }
    return prev[t.length];
  }

  /**
   * Suggest nearest father rows for missing_father — NEVER auto-apply.
   */
  function suggestFatherMatches(issue, children, limit) {
    var max = limit == null ? 5 : limit;
    var branch = norm(issue && issue.branch_key);
    var target = norm(
      (issue && (issue.stored_parent || issue.parent_name || issue.parent)) || "",
    );
    var targetLeaf = leafOf(target);
    var out = [];
    (children || []).forEach(function (c) {
      if (!c || norm(c.branch_key) !== branch) return;
      var path = norm(c.child_name || c.name);
      if (!path) return;
      var distPath = editDistance(path, target);
      var distLeaf = editDistance(leafOf(path), targetLeaf);
      var dist = Math.min(distPath, distLeaf);
      if (dist > 3 && path.indexOf(targetLeaf) < 0 && target.indexOf(leafOf(path)) < 0) {
        return;
      }
      out.push({
        id: c.id,
        person_id: c.person_id || null,
        child_path: path,
        distance: dist,
        score_ar:
          dist === 0
            ? "تطابق تام"
            : dist <= 2
              ? "قريب جدًا"
              : "مرشّح للمراجعة",
      });
    });
    out.sort(function (a, b) {
      return a.distance - b.distance || String(a.child_path).localeCompare(String(b.child_path));
    });
    return out.slice(0, max);
  }

  function findParentPersonId(children, branch, parentPath) {
    var b = norm(branch);
    var p = norm(parentPath);
    if (!b || !p) return { person_id: null, candidates: [] };
    var hits = [];
    (children || []).forEach(function (c) {
      if (!c || norm(c.branch_key) !== b) return;
      var path = norm(c.child_name || c.name);
      if (path === p) hits.push(c);
    });
    if (hits.length === 1 && hits[0].person_id) {
      return { person_id: String(hits[0].person_id), candidates: hits };
    }
    return { person_id: null, candidates: hits };
  }

  /**
   * Analyze (read-only): error type, cause, impact, proposed fix — no mutation.
   */
  function analyzeIssue(issue, context) {
    var ctx = context || {};
    var children = ctx.children || [];
    var cat = norm(issue && issue.category) || norm(issue && issue.code);
    var path = norm(issue && (issue.child_path || issue.name));
    var extracted = norm(issue && issue.extracted_parent) || extractParentFromName(path);
    var stored = norm(issue && (issue.stored_parent || issue.parent_name || issue.parent));
    var parentCol = issue && issue.parent != null ? norm(issue.parent) : "";
    var impact = Array.isArray(issue && issue.impact)
      ? issue.impact.slice()
      : issue && issue.impact_ar
        ? String(issue.impact_ar).split(" · ")
        : [];

    var analysis = {
      stage: "analyze",
      issue_id: issue && issue.id,
      category: cat,
      category_ar: (issue && issue.category_ar) || cat,
      priority: (issue && issue.priority) || inferPriority(cat, issue),
      priority_ar: (issue && issue.priority_ar) || "",
      impact: impact,
      impact_ar: (issue && issue.impact_ar) || impact.join(" · "),
      root_cause_ar: (issue && issue.root_cause_ar) || "",
      write_path_ar: (issue && issue.write_path_ar) || "",
      provenance: (issue && issue.provenance) || null,
      before: {
        parent: parentCol || null,
        parent_name: norm(issue && issue.parent_name) || null,
        parent_person_id: (issue && issue.parent_person_id) || null,
        child_path: path || null,
      },
      proposed: null,
      decision_logic_ar: [],
      suggestions: [],
      can_auto_propose: false,
      requires_manual_choice: false,
      repair_type: null,
      never_rename: cat === "TREE-003" || /TREE-003/i.test(String(issue && issue.code || "")),
    };

    if (!analysis.priority_ar) {
      analysis.priority_ar = priorityLabel(analysis.priority);
    }

    if (cat === "parent_null" || cat === "parent_empty") {
      var fillFrom = extracted || stored || "";
      var link = fillFrom
        ? findParentPersonId(children, issue.branch_key, fillFrom)
        : { person_id: null, candidates: [] };
      analysis.repair_type = "fill_parent_from_name";
      analysis.can_auto_propose = !!fillFrom;
      analysis.decision_logic_ar = [
        "عمود parent فارغ (أو كلا العمودين).",
        fillFrom
          ? "استُخرج مسار الأب من name بإزالة آخر مقطع → «" + fillFrom + "»."
          : "لا يمكن الاستخراج من الاسم — يلزم إدخال يدوي.",
        link.person_id
          ? "وُجد صف أب وحيد في الفرع → اقتراح ربط parent_person_id."
          : link.candidates.length > 1
            ? "أكثر من صف يطابق مسار الأب — لا ربط UUID تلقائيًا."
            : "لا صف أب مطابق بعد — يُملأ المسار فقط؛ الربط لاحقًا.",
      ];
      analysis.root_cause_ar =
        analysis.root_cause_ar ||
        (stored && !parentCol
          ? "كتابة ثنائية الأعمدة ناقصة: parent_name موجود و parent فارغ (مسار مندوب/استيراد/صيانة legacy)."
          : "أُنشئ الصف بلا parent، أو فُقد العمود عند الاستيراد/الصيانة.");
      analysis.write_path_ar =
        analysis.write_path_ar ||
        "مسارات دين Tree Engine: مندوب · إدارة شجرة · استيراد CSV/بطاقة · صيانة SQL — الحارس الجديد يمنع التكرار؛ الصفوف القديمة تُصلح يدويًا.";
      if (fillFrom) {
        analysis.proposed = {
          parent: fillFrom,
          parent_name: fillFrom,
          parent_person_id: link.person_id,
          reason_ar: "ملء parent من المسار المستخرج من الاسم (وليس تخمينًا حرًا).",
        };
      }
    } else if (cat === "path_mismatch") {
      analysis.repair_type = "align_parent_to_extracted";
      analysis.can_auto_propose = !!extracted;
      analysis.decision_logic_ar = [
        "المسار في name يحدّد الأب المتوقع بإزالة آخر مقطع.",
        extracted
          ? "المستخرج: «" + extracted + "» ≠ المخزّن: «" + (stored || "NULL") + "»."
          : "لا مستخرج صالح.",
        "الاقتراح: مواءمة parent/parent_name مع المستخرج — دون إعادة تسمية الشخص.",
      ];
      analysis.root_cause_ar =
        analysis.root_cause_ar ||
        "تعديل اسم/مسار دون مزامنة عمود parent، أو استيراد جزئي، أو أداة صيانة.";
      analysis.write_path_ar =
        analysis.write_path_ar ||
        "راجع مسار الكتابة الذي عدّل name دون parent (مندوب/إدارة/استيراد).";
      if (extracted) {
        var link2 = findParentPersonId(children, issue.branch_key, extracted);
        analysis.proposed = {
          parent: extracted,
          parent_name: extracted,
          parent_person_id: link2.person_id,
          reason_ar: "مواءمة parent مع المستخرج من name.",
        };
      }
    } else if (cat === "missing_father") {
      analysis.repair_type = "suggest_father_match";
      analysis.requires_manual_choice = true;
      analysis.can_auto_propose = false;
      analysis.suggestions = suggestFatherMatches(issue, children, 5);
      analysis.decision_logic_ar = [
        "الأب النصّي غير موجود كصف في tree_children لنفس الفرع.",
        "لا إصلاح تلقائي — تُعرض أقرب المطابقات فقط.",
        "بعد اختيار المطابقة واعتماد المدير: ربط/تصحيح المسار أو إنشاء الأب عبر المسار المنتج (ليس تخمينًا صامتًا).",
      ];
      analysis.root_cause_ar =
        analysis.root_cause_ar ||
        "خطأ إملائي / متغيرات كتابة · أب لم يُستورد · اعتماد طلب بلا أب صالح.";
      analysis.write_path_ar =
        analysis.write_path_ar ||
        "طلب مندوب / Workflow اعتماد / استيراد — يجب رفض الكتابة بلا أب موجود (Validation + Tree Engine).";
    } else if (
      cat === "TREE-003" ||
      /TREE-003/i.test(String((issue && issue.code) || "")) ||
      (issue && issue.severity === "error" && issue.code)
    ) {
      analysis.repair_type = "link_parent_uuid";
      analysis.never_rename = true;
      var parentKey = stored || norm(issue && issue.parent_key);
      var link3 = findParentPersonId(children, issue.branch_key, parentKey);
      analysis.can_auto_propose = !!link3.person_id;
      analysis.requires_manual_choice = !link3.person_id;
      analysis.decision_logic_ar = [
        "TREE-003: لا إعادة تسمية أبدًا — ربط parent_person_id فقط.",
        parentKey ? "مسار الأب النصّي: «" + parentKey + "»." : "لا مسار أب نصّي.",
        link3.person_id
          ? "وُجد UUID أب وحيد مطابق للمسار → اقتراح ربط."
          : "لا تطابق وحيد — يلزم اختيار يدوي أو إصلاح سلامة البيانات أولًا.",
      ];
      analysis.root_cause_ar =
        analysis.root_cause_ar ||
        "اعتماد/مندوب/استيراد كتب الصف بلا UUID أب صالح، أو UUID يشير لشخص محذوف.";
      analysis.write_path_ar =
        analysis.write_path_ar ||
        "مسار الكتابة يجب يمر Tree Engine ويربط parent_person_id عند وجود أب وحيد.";
      if (link3.person_id) {
        analysis.proposed = {
          parent: parentKey || null,
          parent_name: parentKey || null,
          parent_person_id: link3.person_id,
          reason_ar: "ربط UUID الأب المطابق للمسار — دون تغيير الاسم.",
        };
      }
      if (!link3.person_id && link3.candidates.length) {
        analysis.suggestions = link3.candidates.map(function (c) {
          return {
            id: c.id,
            person_id: c.person_id || null,
            child_path: norm(c.child_name || c.name),
            distance: 0,
            score_ar: "مطابق للمسار",
          };
        });
      }
    } else {
      analysis.repair_type = "manual_review";
      analysis.requires_manual_choice = true;
      analysis.decision_logic_ar = [
        "لا اقتراح آلي لهذا النوع بعد — مراجعة يدوية عبر SQL Workspace.",
      ];
      analysis.root_cause_ar =
        analysis.root_cause_ar || "غير مصنّف لخط إصلاح مُنمّط.";
    }

    return analysis;
  }

  function inferPriority(cat, issue) {
    if (cat === "parent_null" || cat === "parent_empty" || cat === "missing_father") {
      return "critical";
    }
    if (cat === "path_mismatch" || cat === "broken_relation") return "high";
    if (
      cat === "duplicate_person_id" ||
      /TREE-003/i.test(String((issue && issue.code) || "")) ||
      (issue && issue.severity === "warning")
    ) {
      return "medium";
    }
    return "medium";
  }

  function priorityLabel(p) {
    if (p === "critical") return "🔴 حرج";
    if (p === "high") return "🟠 مرتفع";
    if (p === "medium") return "🟡 متوسط";
    if (p === "healthy") return "🟢 سليم";
    return p || "—";
  }

  /**
   * Preview: before/after + why — still no mutation.
   */
  function previewRepair(analysis, chosenSuggestion) {
    var a = analysis || {};
    var after = a.proposed ? Object.assign({}, a.proposed) : null;
    if (chosenSuggestion && chosenSuggestion.person_id) {
      after = {
        parent: chosenSuggestion.child_path || (a.proposed && a.proposed.parent) || null,
        parent_name:
          chosenSuggestion.child_path || (a.proposed && a.proposed.parent_name) || null,
        parent_person_id: String(chosenSuggestion.person_id),
        reason_ar: "اختيار المدير من المرشّحات بعد مراجعة.",
      };
    }
    return {
      stage: "preview",
      analysis: a,
      before: a.before,
      after: after,
      decision_logic_ar: a.decision_logic_ar || [],
      why_ar: explainWhy(a, after),
      executable: !!(after && (after.parent || after.parent_person_id)),
      requires_approve: true,
      never_rename: !!a.never_rename,
    };
  }

  function explainWhy(analysis, after) {
    var lines = (analysis && analysis.decision_logic_ar) || [];
    var out = lines.slice();
    if (after && after.reason_ar) out.push("سبب القيم المقترحة: " + after.reason_ar);
    if (analysis && analysis.repair_type === "fill_parent_from_name") {
      out.push("المنطق: parent فارغ + مسار اسم قابل للاستخراج → اقترح الملء — ليس تخمينًا.");
    }
    if (analysis && analysis.never_rename) {
      out.push("قيد صارم: لا إعادة تسمية — ربط UUID فقط.");
    }
    if (!out.length) out.push("لا منطق اقتراح موثّق لهذه الحالة.");
    return out.join("\n");
  }

  /**
   * Build single-row UPDATE SQL for SQL Workspace (Execute stage payload).
   * Commented APPLY block — admin must review then run.
   */
  function buildExecuteSql(preview, meta) {
    var p = preview || {};
    var before = p.before || {};
    var after = p.after || {};
    var id = p.analysis && p.analysis.issue_id;
    var actor = (meta && meta.actor) || "admin";
    var reason = (meta && meta.reason) || (after && after.reason_ar) || "";
    if (id == null || !after) {
      return {
        ok: false,
        message_ar: "لا معاينة قابلة للتنفيذ.",
      };
    }

    var sets = [];
    if (after.parent != null && after.parent !== "") {
      sets.push("  parent = " + sqlLit(after.parent));
      sets.push("  parent_name = " + sqlLit(after.parent_name || after.parent));
    }
    if (after.parent_person_id) {
      sets.push("  parent_person_id = " + sqlLit(after.parent_person_id) + "::uuid");
    }
    if (!sets.length) {
      return { ok: false, message_ar: "لا حقول للتحديث في المعاينة." };
    }

    var sql = [
      "-- =============================================================================",
      "-- Health Center staged repair — صف واحد · بعد موافقة المدير",
      "-- Pipeline: Analyze → Preview → Approve → Execute → Re-verify → Log",
      "-- سياسة: بلا إصلاح الكل · بلا كتابة صامتة من مركز الصحة",
      "-- actor: " + actor,
      "-- reason: " + String(reason).replace(/\n/g, " "),
      "-- before.parent: " + String(before.parent),
      "-- before.parent_person_id: " + String(before.parent_person_id),
      "-- after.parent: " + String(after.parent),
      "-- after.parent_person_id: " + String(after.parent_person_id),
      "-- =============================================================================",
      "",
      "-- 0) Dry-run تحقق قبل التطبيق",
      "SELECT id, branch_key, parent, parent_name, parent_person_id,",
      "       coalesce(child_name, name) AS child_path",
      "FROM public.tree_children",
      "WHERE id = " + Number(id) + ";",
      "",
      "-- 1) APPLY — أزل التعليق بعد المراجعة والموافقة الصريحة",
      "/*",
      "UPDATE public.tree_children",
      "SET",
      sets.join(",\n"),
      "WHERE id = " + Number(id) + ";",
      "*/",
      "",
      "-- 2) Re-verify",
      "SELECT id, parent, parent_name, parent_person_id,",
      "       coalesce(child_name, name) AS child_path",
      "FROM public.tree_children",
      "WHERE id = " + Number(id) + ";",
    ].join("\n");

    return {
      ok: true,
      sql: sql,
      title: "إصلاح صف #" + id + " (مركز الصحة)",
      row_id: id,
      before: before,
      after: after,
    };
  }

  /**
   * Re-verify helper: does the same issue still appear in a fresh audit list?
   */
  function issueStillPresent(auditLists, category, rowId) {
    var lists = auditLists || {};
    var rows = lists[category] || [];
    var id = String(rowId);
    return rows.some(function (r) {
      return r && String(r.id) === id;
    });
  }

  function logRepair(entry) {
    return appendLog(entry);
  }

  /**
   * Best-effort provenance from row + optional request matches.
   */
  function buildProvenance(row, hints) {
    var h = hints || {};
    var known = [];
    var source = "غير موثّق";
    var documented = false;

    if (h.source_ar) {
      source = h.source_ar;
      documented = true;
      known.push("مصدر صريح: " + h.source_ar);
    } else if (h.request_kind) {
      source =
        h.request_kind === "tree_card"
          ? "طلب بطاقة شجرة (اعتماد/Workflow)"
          : h.request_kind.indexOf("delegate") >= 0
            ? "طلب مندوب"
            : "طلب إداري: " + h.request_kind;
      documented = true;
      known.push("مطابقة approval_requests");
    } else if (h.heuristic_ar) {
      source = h.heuristic_ar + " (استدلال — غير مؤكد)";
      known.push(h.heuristic_ar);
    }

    return {
      source_ar: source,
      documented: documented,
      created_at: row && row.created_at ? row.created_at : null,
      updated_at: row && (row.updated_at || row.modified_at) ? row.updated_at || row.modified_at : null,
      modified_by_ar:
        h.modified_by_ar ||
        (row && (row.updated_by || row.modified_by)) ||
        "غير موثّق",
      detail_ar: known.length
        ? known.join(" · ")
        : "لا أعمدة تدقيق كافية على الصف — صادقًا: غير موثّق.",
      note_ar: documented
        ? ""
        : "إن لم يُذكر المصدر في القاعدة نكتب «غير موثّق» بدل التخمين.",
    };
  }

  var api = {
    STAGES: STAGES,
    LOG_KEY: LOG_KEY,
    analyzeIssue: analyzeIssue,
    previewRepair: previewRepair,
    explainWhy: explainWhy,
    buildExecuteSql: buildExecuteSql,
    suggestFatherMatches: suggestFatherMatches,
    findParentPersonId: findParentPersonId,
    issueStillPresent: issueStillPresent,
    logRepair: logRepair,
    loadLog: loadLog,
    buildProvenance: buildProvenance,
    priorityLabel: priorityLabel,
    inferPriority: inferPriority,
  };

  global.AlzidanIntegrityRepairPipeline = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
