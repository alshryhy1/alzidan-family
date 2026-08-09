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

  function normalizeArabicForCompare(value) {
    var Struct = global.AlzidanIntegrityTreeStructure;
    if (Struct && typeof Struct.normalizeArabicForCompare === "function") {
      return Struct.normalizeArabicForCompare(value);
    }
    var Core = global.AlzidanAdminCore;
    if (Core && typeof Core.normalizeArabicForCompare === "function") {
      return Core.normalizeArabicForCompare(value);
    }
    var s = String(value == null ? "" : value);
    try {
      s = s.normalize("NFKD");
    } catch (_) {}
    s = s.replace(/[\u0300-\u036f]/g, "");
    s = s.replace(/[\u064B-\u065F\u0670]/g, "");
    s = s.replace(/\u0640/g, "");
    s = s.replace(/[إأآٱ]/g, "ا");
    s = s.replace(/ى/g, "ي");
    s = s.replace(/ة/g, "ه");
    s = s.replace(/\s+/g, " ").trim();
    return s;
  }

  function pathsEqual(a, b) {
    var Struct = global.AlzidanIntegrityTreeStructure;
    if (Struct && typeof Struct.pathsEqual === "function") {
      return Struct.pathsEqual(a, b);
    }
    var na = normalizeArabicForCompare(a);
    var nb = normalizeArabicForCompare(b);
    return !!na && !!nb && na === nb;
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

  function childPathOf(row) {
    var Struct = global.AlzidanIntegrityTreeStructure;
    if (Struct && typeof Struct.childPath === "function") {
      return Struct.childPath(row);
    }
    return norm((row && (row.child_name || row.name)) || "");
  }

  function buildIndex(children) {
    var Struct = global.AlzidanIntegrityTreeStructure;
    if (Struct && typeof Struct.buildNameIndex === "function") {
      return Struct.buildNameIndex(children);
    }
    return null;
  }

  function resolveFatherRow(children, branch, parentPath) {
    var Struct = global.AlzidanIntegrityTreeStructure;
    var index = buildIndex(children);
    if (Struct && typeof Struct.resolveFatherRow === "function" && index) {
      return Struct.resolveFatherRow(index, branch, parentPath);
    }
    var b = norm(branch);
    var p = norm(parentPath);
    if (!b || !p) return null;
    var exact = null;
    var normHits = [];
    (children || []).forEach(function (c) {
      if (!c || norm(c.branch_key) !== b) return;
      var path = childPathOf(c);
      if (path === p) exact = c;
      if (pathsEqual(path, p)) normHits.push(c);
    });
    if (exact) return exact;
    return normHits.length === 1 ? normHits[0] : null;
  }

  function leafOf(path) {
    var p = norm(path);
    if (!p) return "";
    return p.indexOf("/") >= 0 ? p.slice(p.lastIndexOf("/") + 1) : p;
  }

  var FLIP_BLOCK_AR =
    "هذا الإصلاح سينقل المشكلة إلى فئة أخرى — اختر أبًا موجودًا في الشجرة يطابق المسار";

  /** Count living father rows matching a parent path (exact or Arabic-normalized). */
  function listFatherMatches(children, branch, parentPath) {
    var b = norm(branch);
    var p = norm(parentPath);
    if (!b || !p) return [];
    var pNorm = normalizeArabicForCompare(p);
    var hits = [];
    (children || []).forEach(function (c) {
      if (!c || norm(c.branch_key) !== b) return;
      var path = childPathOf(c);
      if (!path) return;
      if (path === p || normalizeArabicForCompare(path) === pNorm) hits.push(c);
    });
    return hits;
  }

  function fatherLookupFailureAr(extracted, children, branch) {
    var label = norm(extracted);
    if (!label) {
      return "لم يتم استخراج اسم الأب من المسار — لا يمكن التحديث.";
    }
    var hits = listFatherMatches(children, branch, label);
    if (hits.length > 1) {
      return (
        "يوجد أكثر من أب بنفس الاسم «" +
        label +
        "» — لا يمكن التحديث حتى يُختار الأب الصحيح."
      );
    }
    if (hits.length === 1 && !hits[0].person_id) {
      return "لم يتم العثور على معرف الأب لـ «" + label + "».";
    }
    return (
      "لم يتم العثور على الأب: «" +
      label +
      "» — لا يمكن التحديث حتى يُنشأ الأب في الشجرة."
    );
  }

  /**
   * Unified repair target for parent_null / missing_father / path_mismatch.
   * Always prefers a living father's canonical name — never a free-typed extract
   * that would create missing_father.
   */
  function resolveUnifiedParentTarget(issue, children) {
    var path = norm(issue && (issue.child_path || issue.name));
    var extracted =
      norm(issue && issue.extracted_parent) || extractParentFromName(path);
    var branch = norm(issue && issue.branch_key);
    var fatherFromExtract = extracted
      ? resolveFatherRow(children, branch, extracted)
      : null;
    var canonicalFromExtract = fatherFromExtract
      ? childPathOf(fatherFromExtract)
      : "";
    var pidFromExtract =
      fatherFromExtract && fatherFromExtract.person_id
        ? String(fatherFromExtract.person_id)
        : null;

    var spellingDrift =
      !!(
        canonicalFromExtract &&
        extracted &&
        canonicalFromExtract !== extracted
      );

    if (canonicalFromExtract) {
      return {
        ok: true,
        parent: canonicalFromExtract,
        parent_name: canonicalFromExtract,
        parent_person_id: pidFromExtract,
        extracted: extracted,
        spelling_drift: spellingDrift,
        clears_missing_father: true,
        clears_path_mismatch: true,
        would_flip_only: false,
        reason_ar: spellingDrift
          ? "مواءمة حقل الأب لاسم الأب الموجود في الشجرة («" +
            canonicalFromExtract +
            "») — الأب من المسار مكتوب بطريقة مختلفة («" +
            extracted +
            "») بعد توحيد العربية."
          : "ربط حقل الأب باسم الأب الموجود فعليًا في الشجرة مع المعرف إن وُجد.",
        block_message_ar: null,
      };
    }

    // No living father for extract — never propose writing the raw extract.
    var failAr = fatherLookupFailureAr(extracted, children, branch);
    return {
      ok: false,
      parent: null,
      parent_name: null,
      parent_person_id: null,
      extracted: extracted,
      spelling_drift: false,
      clears_missing_father: false,
      clears_path_mismatch: false,
      would_flip_only: true,
      reason_ar: failAr,
      block_message_ar: failAr || FLIP_BLOCK_AR,
      requires_suggestions: true,
    };
  }

  /** Evaluate a manually chosen father suggestion against the name path. */
  function evaluateChosenFather(issue, children, chosen) {
    var path = norm(issue && (issue.child_path || issue.name));
    var extracted =
      norm(issue && issue.extracted_parent) || extractParentFromName(path);
    var chosenPath = norm(
      (chosen && (chosen.child_path || chosen.parent || chosen.parent_name)) ||
        "",
    );
    var branch = norm(issue && issue.branch_key);
    if (!chosenPath) {
      return {
        ok: false,
        would_flip_only: true,
        block_message_ar: FLIP_BLOCK_AR,
        clears_missing_father: false,
        clears_path_mismatch: false,
      };
    }
    var fatherRow =
      resolveFatherRow(children, branch, chosenPath) ||
      (chosen && chosen.id != null
        ? (children || []).find(function (c) {
            return c && String(c.id) === String(chosen.id);
          })
        : null);
    var canonical = fatherRow ? childPathOf(fatherRow) : chosenPath;
    var pid =
      (fatherRow && fatherRow.person_id) ||
      (chosen && chosen.person_id) ||
      null;

    var alignsWithExtract = true;
    if (extracted) {
      var extractFather = resolveFatherRow(children, branch, extracted);
      if (extractFather) {
        alignsWithExtract = childPathOf(extractFather) === canonical;
      } else {
        alignsWithExtract = pathsEqual(canonical, extracted);
      }
    }

    if (!alignsWithExtract) {
      return {
        ok: false,
        parent: canonical,
        parent_name: canonical,
        parent_person_id: pid ? String(pid) : null,
        would_flip_only: true,
        clears_missing_father: true,
        clears_path_mismatch: false,
        block_message_ar: FLIP_BLOCK_AR,
        reason_ar:
          "المرشّح يصلح «أب غير موجود في الشجرة» لكنه لا يطابق الأب من المسار — سينقل المشكلة إلى اختلاف كتابة المسار.",
      };
    }

    return {
      ok: true,
      parent: canonical,
      parent_name: canonical,
      parent_person_id: pid ? String(pid) : null,
      would_flip_only: false,
      clears_missing_father: true,
      clears_path_mismatch: true,
      block_message_ar: null,
      reason_ar: "اختيار المدير من المرشّحات — أب موجود يطابق المسار.",
    };
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
    if (!b || !p) return { person_id: null, candidates: [], canonical_path: null };
    var exact = [];
    var folded = [];
    var pNorm = normalizeArabicForCompare(p);
    (children || []).forEach(function (c) {
      if (!c || norm(c.branch_key) !== b) return;
      var path = norm(c.child_name || c.name);
      if (!path) return;
      if (path === p) exact.push(c);
      else if (normalizeArabicForCompare(path) === pNorm) folded.push(c);
    });
    var hits = exact.length ? exact : folded;
    if (hits.length === 1 && hits[0].person_id) {
      return {
        person_id: String(hits[0].person_id),
        candidates: hits,
        canonical_path: norm(hits[0].child_name || hits[0].name) || null,
      };
    }
    return {
      person_id: null,
      candidates: hits,
      canonical_path: null,
    };
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

    analysis._issue = issue;
    analysis._children = children;

    var unifiedCats =
      cat === "parent_null" ||
      cat === "parent_empty" ||
      cat === "path_mismatch" ||
      cat === "missing_father";

    if (unifiedCats) {
      var unified = resolveUnifiedParentTarget(issue, children);
      analysis.unified = unified;
      analysis.clears_missing_father = !!unified.clears_missing_father;
      analysis.clears_path_mismatch = !!unified.clears_path_mismatch;
      analysis.would_flip_only = !!unified.would_flip_only;
      analysis.block_message_ar = unified.block_message_ar || null;

      if (cat === "parent_null" || cat === "parent_empty") {
        analysis.repair_type = "fill_parent_from_name";
        analysis.root_cause_ar =
          analysis.root_cause_ar ||
          (stored && !parentCol
            ? "كتابة ناقصة: اسم الأب موجود وحقل الأب فارغ (مسار مندوب/استيراد/صيانة قديمة)."
            : "أُنشئ السجل بلا أب، أو فُقد الحقل عند الاستيراد/الصيانة.");
        analysis.write_path_ar =
          analysis.write_path_ar ||
          "كيفية الإصلاح: مندوب · إدارة الشجرة · استيراد · صيانة — بعد موافقة على سجل واحد.";
        if (unified.ok) {
          analysis.can_auto_propose = true;
          analysis.requires_manual_choice = false;
          analysis.proposed = {
            parent: unified.parent,
            parent_name: unified.parent_name,
            parent_person_id: unified.parent_person_id,
            reason_ar: unified.reason_ar,
          };
          analysis.decision_logic_ar = [
            "حقل الأب فارغ (أو كلا حقلي الأب).",
            extracted
              ? "الأب من المسار: «" + extracted + "»."
              : "تعذّر معرفة الأب من المسار.",
            "وُجد أب في الشجرة بالاسم «" + unified.parent + "».",
            "سيمسح: أب غير موجود في الشجرة؟ نعم · اختلاف كتابة المسار؟ نعم.",
          ];
        } else {
          analysis.can_auto_propose = false;
          analysis.requires_manual_choice = true;
          analysis.proposed = null;
          analysis.suggestions = suggestFatherMatches(issue, children, 5);
          analysis.decision_logic_ar = [
            "حقل الأب فارغ — لكن الأب من المسار لا يطابق سجل أب في الشجرة.",
            fatherLookupFailureAr(extracted, children, norm(issue && issue.branch_key)),
            "ممنوع ملء اسم أب غير موجود (سيُنشئ «أب غير موجود في الشجرة»).",
          ];
        }
      } else if (cat === "path_mismatch") {
        analysis.repair_type = "align_parent_to_canonical";
        analysis.root_cause_ar =
          analysis.root_cause_ar ||
          "تعديل الاسم/المسار دون تحديث حقل الأب، أو الاسم مكتوب بطريقة مختلفة عن صف الأب، أو استيراد جزئي.";
        analysis.write_path_ar =
          analysis.write_path_ar ||
          "كيفية الإصلاح: راجع من عدّل المسار دون حقل الأب (مندوب/إدارة/استيراد) ووحّد بعد موافقة.";
        var spellOnly =
          !!extracted &&
          !!stored &&
          pathsEqual(extracted, stored) &&
          (!parentCol || pathsEqual(parentCol, extracted));
        var alreadyCanonical =
          !!(
            unified.ok &&
            unified.parent &&
            parentCol === unified.parent &&
            norm(issue && issue.parent_name) === unified.parent
          );
        if (spellOnly || alreadyCanonical) {
          // دوخي↔دوخى بعد التطبيع: ليست مشكلة هيكلية. كتابة extracted تيتّم الأب.
          analysis.repair_type = "spelling_equivalent_no_write";
          analysis.can_auto_propose = false;
          analysis.requires_manual_choice = false;
          analysis.proposed = null;
          analysis.decision_logic_ar = [
            "الأب من المسار: «" + (extracted || "—") + "».",
            "المذكور في السجل: «" + (stored || "فارغ") + "».",
            spellOnly
              ? "بعد توحيد العربية (ى↔ي / همزة / ة↔ه) المساران متكافئان — ليست مشكلة هيكلية."
              : "حقل الأب مضبوط أصلًا على اسم الأب الموجود في الشجرة.",
            "لا تنفيذ إصلاح من مركز الصحة — أعد فحص التقرير (المقارنة أصبحت بالتوحيد).",
          ];
          analysis.root_cause_ar =
            "الاسم مكتوب بطريقة مختلفة عن حقل الأب (مثل دوخي/دوخى أو فضى/فضي) — الأب نفسه بعد التوحيد.";
        } else if (unified.ok) {
          analysis.can_auto_propose = true;
          analysis.requires_manual_choice = false;
          analysis.proposed = {
            parent: unified.parent,
            parent_name: unified.parent_name,
            parent_person_id: unified.parent_person_id,
            reason_ar: unified.reason_ar,
          };
          analysis.decision_logic_ar = [
            "الأب من المسار: «" + (extracted || "—") + "».",
            "المذكور في السجل: «" + (stored || "فارغ") + "».",
            "الأب الموجود في الشجرة: «" + unified.parent + "».",
            unified.spelling_drift
              ? "الاسم مكتوب بطريقة مختلفة عن صف الأب — نكتب اسم الأب الموجود فقط."
              : "مواءمة حقل الأب مع الأب الموجود في الشجرة.",
            "سيمسح: أب غير موجود في الشجرة؟ نعم · اختلاف كتابة المسار؟ نعم.",
          ];
        } else {
          analysis.can_auto_propose = false;
          analysis.requires_manual_choice = true;
          analysis.proposed = null;
          analysis.suggestions = suggestFatherMatches(
            Object.assign({}, issue, {
              stored_parent: extracted || stored,
              parent: extracted || stored,
            }),
            children,
            5,
          );
          analysis.decision_logic_ar = [
            fatherLookupFailureAr(extracted, children, norm(issue && issue.branch_key)),
            "لا يُكتب الأب من المسار كحقل أب إن لم يوجد في الشجرة.",
            "اختر أبًا موجودًا يطابق المسار (وإلا ستنتقل المشكلة إلى «أب غير موجود في الشجرة»).",
          ];
        }
      } else if (cat === "missing_father") {
        analysis.repair_type = "suggest_father_match";
        analysis.root_cause_ar =
          analysis.root_cause_ar ||
          "إملاء مختلف · أب لم يُضف بعد · اعتماد طلب بلا أب صالح.";
        analysis.write_path_ar =
          analysis.write_path_ar ||
          "كيفية الإصلاح: طلب مندوب / اعتماد / استيراد — ارفض الكتابة بلا أب موجود في الشجرة.";
        if (unified.ok) {
          // Extract resolves to a living father — one proposal clears both buckets.
          analysis.can_auto_propose = true;
          analysis.requires_manual_choice = false;
          analysis.proposed = {
            parent: unified.parent,
            parent_name: unified.parent_name,
            parent_person_id: unified.parent_person_id,
            reason_ar: unified.reason_ar,
          };
          analysis.suggestions = [];
          analysis.decision_logic_ar = [
            "الأب المذكور «" + (stored || "—") + "» غير موجود حرفيًا في الشجرة.",
            "الأب من المسار يطابق أبًا موجودًا بالاسم «" +
              unified.parent +
              "».",
            "اقتراح واحد يمسح «أب غير موجود في الشجرة» و«اختلاف كتابة المسار» معًا.",
          ];
        } else {
          analysis.can_auto_propose = false;
          analysis.requires_manual_choice = true;
          analysis.proposed = null;
          analysis.suggestions = suggestFatherMatches(issue, children, 5);
          analysis.decision_logic_ar = [
            fatherLookupFailureAr(stored || extracted, children, norm(issue && issue.branch_key)),
            "لا تنفيذ تلقائي باسم أب غير موجود — مرشّحات فقط.",
            "عند الاختيار: يجب أن يطابق المرشّح الأب من المسار وإلا يُحظر التنفيذ.",
          ];
        }
      }
    } else if (
      cat === "TREE-003" ||
      /TREE-003/i.test(String((issue && issue.code) || "")) ||
      (issue && issue.severity === "error" && issue.code)
    ) {
      analysis.repair_type = "link_parent_uuid";
      analysis.never_rename = true;
      var parentKey = stored || norm(issue && issue.parent_key);
      var link3 = findParentPersonId(children, issue.branch_key, parentKey);
      var canon3 = link3.canonical_path || parentKey;
      analysis.can_auto_propose = !!link3.person_id;
      analysis.requires_manual_choice = !link3.person_id;
      var linkFailAr = "";
      if (!link3.person_id) {
        if (link3.candidates && link3.candidates.length > 1) {
          linkFailAr =
            "يوجد أكثر من أب بنفس الاسم «" +
            (parentKey || "—") +
            "» — لا يمكن ربط المعرف تلقائيًا.";
        } else if (!parentKey) {
          linkFailAr = "لم يتم العثور على معرف الأب — لا مسار أب نصّي.";
        } else {
          linkFailAr =
            "لم يتم العثور على معرف الأب لـ «" +
            parentKey +
            "» — يلزم اختيار يدوي أو إصلاح سلامة البيانات أولًا.";
        }
      }
      analysis.decision_logic_ar = [
        "ربط داخلي: لا إعادة تسمية أبدًا — ربط معرف الأب فقط.",
        parentKey ? "مسار الأب النصّي: «" + parentKey + "»." : "لا مسار أب نصّي.",
        link3.person_id
          ? "وُجد معرف أب وحيد مطابق للمسار → اقتراح ربط بالاسم «" +
            canon3 +
            "»."
          : linkFailAr,
      ];
      analysis.root_cause_ar =
        analysis.root_cause_ar ||
        "اعتماد/مندوب/استيراد كتب السجل بلا معرف أب صالح، أو المعرف يشير لشخص محذوف.";
      analysis.write_path_ar =
        analysis.write_path_ar ||
        "كيفية الإصلاح: اربط معرف الأب عند وجود أب وحيد في الشجرة.";
      if (link3.person_id) {
        analysis.proposed = {
          parent: canon3 || null,
          parent_name: canon3 || null,
          parent_person_id: link3.person_id,
          reason_ar: "ربط معرف الأب المطابق للمسار — دون تغيير اسم الشخص.",
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
    } else if (cat === "possible_spelling_duplicates" || cat === "TREE-SPELL-DUP") {
      analysis.repair_type = "manual_review_no_merge";
      analysis.requires_manual_choice = true;
      analysis.can_auto_propose = false;
      analysis.proposed = null;
      analysis.never_rename = true;
      var diffReason =
        norm(issue && issue.diff_reason_ar) ||
        (function () {
          var Struct = global.AlzidanIntegrityTreeStructure;
          if (Struct && typeof Struct.explainArabicSpellingDiff === "function") {
            return Struct.explainArabicSpellingDiff(
              issue && issue.name_a,
              issue && issue.name_b,
            );
          }
          return "الاسم مكتوب بطريقة مختلفة";
        })();
      analysis.decision_logic_ar = [
        "أسماء قد تكون مكررة تحت نفس الأب بعد توحيد العربية (همزة / ى↔ي / ة↔ه / تشكيل).",
        "الاسم الأول: «" +
          norm(issue && issue.name_a) +
          "» · الاسم الثاني: «" +
          norm(issue && issue.name_b) +
          "».",
        "السبب: " + diffReason + ".",
        "الحالة: يحتاج مراجعة — لا اقتراح دمج ولا أمر إصلاح من مركز الصحة.",
        "قرار المشرف لاحقًا: إبقاء سجلين · أو دمج يدوي بعد التحقق.",
      ];
      analysis.root_cause_ar =
        analysis.root_cause_ar ||
        "متغيرات إملائية عربية أو سجلات مكررة تحت نفس الأب — الغموض مقصود حتى يقرر المشرف.";
      analysis.write_path_ar =
        analysis.write_path_ar ||
        "كيفية الإصلاح: لا مسار تنفيذ تلقائي. أي دمج لاحق يجب أن يكون يدويًا بعد موافقة صريحة.";
    } else {
      analysis.repair_type = "manual_review";
      analysis.requires_manual_choice = true;
      analysis.decision_logic_ar = [
        "لا اقتراح آلي لهذا النوع بعد — مراجعة يدوية عبر مساحة SQL.",
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
    if (
      cat === "path_mismatch" ||
      cat === "broken_relation" ||
      cat === "possible_spelling_duplicates" ||
      cat === "TREE-SPELL-DUP"
    ) {
      return "high";
    }
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
   * Blocks execute when the proposal would only flip the error bucket.
   */
  function previewRepair(analysis, chosenSuggestion) {
    var a = analysis || {};
    var children = a._children || [];
    var issue = a._issue || { id: a.issue_id, category: a.category };
    var after = a.proposed ? Object.assign({}, a.proposed) : null;
    var clearsMissing = !!a.clears_missing_father;
    var clearsPath = !!a.clears_path_mismatch;
    var wouldFlip = !!a.would_flip_only;
    var blockMsg = a.block_message_ar || null;

    if (chosenSuggestion) {
      var evalChosen = evaluateChosenFather(issue, children, chosenSuggestion);
      clearsMissing = !!evalChosen.clears_missing_father;
      clearsPath = !!evalChosen.clears_path_mismatch;
      wouldFlip = !!evalChosen.would_flip_only;
      blockMsg = evalChosen.block_message_ar || null;
      if (evalChosen.ok) {
        after = {
          parent: evalChosen.parent,
          parent_name: evalChosen.parent_name,
          parent_person_id: evalChosen.parent_person_id,
          reason_ar: evalChosen.reason_ar,
        };
      } else {
        after = null;
      }
    }

    var executable =
      a.repair_type === "manual_review_no_merge" ||
      a.repair_type === "manual_review" ||
      a.repair_type === "spelling_equivalent_no_write"
        ? false
        : !wouldFlip && !!(after && (after.parent || after.parent_person_id));

    var preview = {
      stage: "preview",
      analysis: a,
      before: a.before,
      after: after,
      decision_logic_ar: a.decision_logic_ar || [],
      why_ar: explainWhy(a, after),
      executable: executable,
      requires_approve: true,
      never_rename: !!a.never_rename,
      never_auto_merge: a.repair_type === "manual_review_no_merge",
      clears_missing_father: clearsMissing,
      clears_path_mismatch: clearsPath,
      would_flip_only: wouldFlip,
      block_message_ar: wouldFlip ? blockMsg || FLIP_BLOCK_AR : null,
      preview_flags_ar: [
        "سيمسح «أب غير موجود في الشجرة»؟ " + (clearsMissing ? "نعم" : "لا"),
        "سيمسح «الاسم مكتوب بطريقة مختلفة»؟ " + (clearsPath ? "نعم" : "لا"),
      ].join("\n"),
    };
    if (wouldFlip && preview.block_message_ar) {
      preview.why_ar =
        (preview.why_ar ? preview.why_ar + "\n" : "") + preview.block_message_ar;
    } else if (preview.preview_flags_ar) {
      preview.why_ar =
        (preview.why_ar ? preview.why_ar + "\n" : "") + preview.preview_flags_ar;
    }
    return preview;
  }

  function explainWhy(analysis, after) {
    var lines = (analysis && analysis.decision_logic_ar) || [];
    var out = lines.slice();
    if (after && after.reason_ar) out.push("سبب القيم المقترحة: " + after.reason_ar);
    if (analysis && analysis.repair_type === "fill_parent_from_name") {
      out.push(
        "المنطق: حقل الأب فارغ + أب موجود يطابق الأب من المسار → اقترح اسم الأب الموجود — ليس تخمينًا.",
      );
    }
    if (analysis && analysis.repair_type === "align_parent_to_canonical") {
      out.push("المنطق: لا يُكتب حقل الأب إلا إن وُجد سجل أب في الشجرة.");
    }
    if (analysis && analysis.never_rename) {
      out.push("قيد صارم: لا إعادة تسمية — ربط المعرف فقط.");
    }
    if (analysis && analysis.repair_type === "manual_review_no_merge") {
      out.push("قيد صارم: لا دمج تلقائي — الأسماء التي قد تكون مكررة للمراجعة فقط.");
    }
    if (!out.length) out.push("لا منطق اقتراح موثّق لهذه الحالة.");
    return out.join("\n");
  }

  /**
   * Build single-row UPDATE for SQL Workspace (Execute stage payload).
   * Pure APPLY only — no SELECT sandwich, no block comments.
   * (Block comments + Arabic paths with '/' hang old admin_sql_classify_v1.)
   * Approval already happened in Health Center; Workspace Run confirms mutate.
   */
  function buildExecuteSql(preview, meta) {
    var p = preview || {};
    var before = p.before || {};
    var after = p.after || {};
    var id = p.analysis && p.analysis.issue_id;
    var actor = (meta && meta.actor) || "admin";
    var reason = (meta && meta.reason) || (after && after.reason_ar) || "";
    if (p.would_flip_only || (p.analysis && p.analysis.would_flip_only && !p.after)) {
      return {
        ok: false,
        message_ar: p.block_message_ar || FLIP_BLOCK_AR,
      };
    }
    if (
      p.never_auto_merge ||
      (p.analysis && p.analysis.repair_type === "manual_review_no_merge")
    ) {
      return {
        ok: false,
        message_ar:
          "الأسماء التي قد تكون مكررة للمراجعة فقط — ممنوع توليد أمر دمج من مركز الصحة.",
      };
    }
    if (p.analysis && p.analysis.repair_type === "spelling_equivalent_no_write") {
      return {
        ok: false,
        message_ar:
          "المساران متكافئان بعد تطبيع العربية (مثل دوخي/دوخى) — لا UPDATE على parent. أعد فحص مركز الصحة.",
      };
    }
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

    var rowId = Number(id);
    var sql = [
      "-- مركز الصحة · سجل واحد · بعد موافقة المدير",
      "-- id: " + rowId + " · actor: " + String(actor).replace(/\n/g, " "),
      "-- reason: " + String(reason).replace(/\n/g, " ").slice(0, 200),
      "-- before.parent: " + String(before.parent == null ? "" : before.parent),
      "-- after.parent: " + String(after.parent == null ? "" : after.parent),
      "UPDATE public.tree_children",
      "SET",
      sets.join(",\n"),
      "WHERE id = " + rowId + ";",
    ].join("\n");

    return {
      ok: true,
      sql: sql,
      title: "إصلاح السجل رقم " + rowId + " (مركز الصحة)",
      row_id: rowId,
      before: before,
      after: after,
      success_meta: {
        row_id: rowId,
        father_name: after.parent || after.parent_name || "",
        after_parent: after.parent || after.parent_name || "",
        updated_parent: !!(after.parent != null && after.parent !== ""),
        updated_uuid: !!after.parent_person_id,
      },
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
   * Source labels for managers: طلب مندوب / استيراد / إدارة / صيانة / غير موثّق
   */
  function mapProvenanceSource(h) {
    var hints = h || {};
    if (hints.source_ar) return { source_ar: hints.source_ar, documented: true };
    var kind = String(hints.request_kind || "").toLowerCase();
    if (
      kind === "tree_delegate" ||
      kind === "events_delegate" ||
      kind.indexOf("delegate") >= 0
    ) {
      return { source_ar: "طلب مندوب", documented: true };
    }
    if (kind === "tree_card") {
      return { source_ar: "طلب مندوب", documented: true };
    }
    if (kind.indexOf("import") >= 0) {
      return { source_ar: "استيراد", documented: true };
    }
    if (kind) {
      return { source_ar: "إدارة", documented: true };
    }
    var heur = String(hints.heuristic_kind || "").toLowerCase();
    if (heur === "import" || /استيراد/.test(String(hints.heuristic_ar || ""))) {
      return { source_ar: "استيراد", documented: false };
    }
    if (
      heur === "maintenance" ||
      heur === "sql" ||
      /صيانة/.test(String(hints.heuristic_ar || ""))
    ) {
      return { source_ar: "صيانة", documented: false };
    }
    if (heur === "admin" || /إدارة/.test(String(hints.heuristic_ar || ""))) {
      return { source_ar: "إدارة", documented: false };
    }
    if (hints.heuristic_ar) {
      return { source_ar: "غير موثّق", documented: false };
    }
    return { source_ar: "غير موثّق", documented: false };
  }

  function buildProvenance(row, hints) {
    var h = hints || {};
    var mapped = mapProvenanceSource(h);
    var known = [];
    if (h.source_ar) known.push("مصدر صريح: " + h.source_ar);
    if (h.request_kind) known.push("مطابقة طلبات الاعتماد");
    if (h.heuristic_ar && !mapped.documented) known.push(h.heuristic_ar);

    var createdBy =
      h.created_by_ar ||
      (row && (row.created_by_name || row.created_by)) ||
      null;
    var modifiedBy =
      h.modified_by_ar ||
      (row && (row.updated_by_name || row.updated_by || row.modified_by)) ||
      null;

    return {
      source_ar: mapped.source_ar,
      documented: mapped.documented,
      created_at: row && row.created_at ? row.created_at : null,
      updated_at:
        row && (row.updated_at || row.modified_at)
          ? row.updated_at || row.modified_at
          : null,
      created_by_ar: createdBy ? String(createdBy) : "غير موثّق",
      modified_by_ar: modifiedBy ? String(modifiedBy) : "غير موثّق",
      detail_ar: known.length
        ? known.join(" · ")
        : "لا أعمدة تدقيق كافية على السجل — صادقًا: غير موثّق.",
      note_ar: mapped.documented
        ? ""
        : "إن لم يُذكر المصدر في القاعدة نكتب «غير موثّق» بدل التخمين.",
    };
  }

  /** Specific success line after a Health Center row repair runs in SQL Workspace. */
  function formatRepairSuccessAr(meta) {
    var m = meta || {};
    var id = m.row_id != null ? m.row_id : "?";
    var father = norm(m.father_name || m.after_parent || "");
    var msg = "تم إصلاح السجل رقم " + id + " بنجاح.";
    if (father) {
      msg += " تم ربطه بالأب «" + father + "»";
      var bits = [];
      if (m.updated_parent !== false) bits.push("حقل الأب");
      if (m.updated_uuid) bits.push("المعرّف");
      if (bits.length) msg += "، وتحديث " + bits.join(" و");
      msg += ".";
    }
    return msg;
  }

  /** Failure line that always includes WHY (سبب الفشل). */
  function formatRepairFailureAr(reason) {
    var why = String(reason || "").trim();
    if (!why) why = "سبب غير معروف — راجع رسالة النظام.";
    if (/^سبب الفشل/.test(why)) return why;
    return "فشل التنفيذ — سبب الفشل: " + why;
  }

  /**
   * Map raw SQL/RPC errors into Arabic-friendly reasons for managers.
   */
  function friendlySqlFailureAr(error, data) {
    if (data && data.message_ar) return String(data.message_ar);
    var code = String((error && error.code) || (data && data.error_code) || "");
    var raw = String(
      (error && error.message) || (data && data.message) || "",
    );
    if (/permission|not allowed|42501|JWT|RLS/i.test(raw) || code === "42501") {
      return "صلاحية غير كافية لتنفيذ الأمر" + (raw ? " — " + raw.slice(0, 120) : "");
    }
    if (/0 rows|no rows|ROW_COUNT|did not affect/i.test(raw)) {
      return "الصف غير موجود أو لم يتأثر أي سجل بالأمر";
    }
    if (/violates|foreign key|23503/i.test(raw) || code === "23503") {
      return "لم يتم العثور على الأب أو المعرف المشار إليه — " + raw.slice(0, 140);
    }
    if (/unique|duplicate|23505/i.test(raw) || code === "23505") {
      return "تعارض فريد في القاعدة — " + raw.slice(0, 140);
    }
    if (/syntax|42601/i.test(raw) || code === "42601") {
      return "خطأ في صياغة SQL — " + raw.slice(0, 140);
    }
    if (raw) return raw.slice(0, 220);
    return "تعذّر تنفيذ الأمر. راجع الصياغة أو الصلاحيات.";
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
    resolveUnifiedParentTarget: resolveUnifiedParentTarget,
    evaluateChosenFather: evaluateChosenFather,
    FLIP_BLOCK_AR: FLIP_BLOCK_AR,
    fatherLookupFailureAr: fatherLookupFailureAr,
    issueStillPresent: issueStillPresent,
    logRepair: logRepair,
    loadLog: loadLog,
    buildProvenance: buildProvenance,
    formatRepairSuccessAr: formatRepairSuccessAr,
    formatRepairFailureAr: formatRepairFailureAr,
    friendlySqlFailureAr: friendlySqlFailureAr,
    priorityLabel: priorityLabel,
    inferPriority: inferPriority,
  };

  global.AlzidanIntegrityRepairPipeline = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
