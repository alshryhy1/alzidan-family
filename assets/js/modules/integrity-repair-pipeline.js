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
    return p.indexOf("/") >= 0 ? norm(p.slice(p.lastIndexOf("/") + 1)) : p;
  }

  function parentPrefixOf(path) {
    var p = norm(path);
    if (!p || p.indexOf("/") < 0) return "";
    return norm(p.slice(0, p.lastIndexOf("/")));
  }

  /** Prefer the more orthographically marked Arabic spelling (همزة / أ …). */
  function preferArabicSpelling(a, b) {
    var s1 = norm(a);
    var s2 = norm(b);
    if (!s1) return s2;
    if (!s2) return s1;
    if (s1 === s2) return s1;
    function score(s) {
      var n = 0;
      if (/[أإآؤئء]/.test(s)) n += 3;
      if (/ة/.test(s)) n += 1;
      if (s !== normalizeArabicForCompare(s)) n += 1;
      return n;
    }
    var sc1 = score(s1);
    var sc2 = score(s2);
    if (sc1 !== sc2) return sc1 > sc2 ? s1 : s2;
    return s1.length >= s2.length ? s1 : s2;
  }

  /** Resolve living father from parent_person_id, then stored parent path. */
  function resolveStoredFatherRow(issue, children) {
    var branch = norm(issue && issue.branch_key);
    var ppid =
      issue && issue.parent_person_id != null
        ? String(issue.parent_person_id).trim()
        : "";
    if (ppid) {
      var byPid = (children || []).find(function (c) {
        return c && String(c.person_id || "") === ppid;
      });
      if (byPid) return byPid;
    }
    var stored = norm(
      issue && (issue.stored_parent || issue.parent_name || issue.parent),
    );
    if (!stored) return null;
    return resolveFatherRow(children || [], branch, stored);
  }

  /**
   * Spelling-only path fix: rewrite child name prefix to canonical parent spelling.
   * Never nulls parent / parent_person_id.
   */
  function buildAlignNamePathSpelling(issue, children) {
    var path = norm(issue && (issue.child_path || issue.name));
    var extracted =
      norm(issue && issue.extracted_parent) || parentPrefixOf(path);
    var stored = norm(
      issue && (issue.stored_parent || issue.parent_name || issue.parent),
    );
    var parentCol = issue && issue.parent != null ? norm(issue.parent) : "";
    var leaf = leafOf(path);
    if (!path || !leaf || !extracted) return null;

    var unified = resolveUnifiedParentTarget(issue, children || []);
    var canonical =
      (unified && unified.ok && unified.parent) || stored || extracted;
    if (!canonical) return null;
    if (!pathsEqual(extracted, canonical)) return null;
    if (extracted === canonical) return null;

    var newPath = canonical + "/" + leaf;
    if (newPath === path) return null;
    if (!pathsEqual(newPath, path)) return null;

    return {
      ok: true,
      repair_type: "align_name_path_spelling",
      child_path: newPath,
      name: newPath,
      child_name: newPath,
      parent: parentCol || stored || null,
      parent_name: stored || parentCol || null,
      parent_person_id: (issue && issue.parent_person_id) || null,
      keep_parent: true,
      reason_ar:
        "توحيد إملاء المسار في الاسم من «" +
        extracted +
        "» إلى «" +
        canonical +
        "» — دون تغيير حقل الأب أو المعرف.",
      impact_ar:
        "المعرف والأبناء وحقل الأب بلا تغيير · يُحدَّث مسار الاسم فقط ليطابق إملاء الأب الكانوني.",
      affected_rows: 1,
    };
  }

  /**
   * Truncated/wrong name path while stored parent (or parent_person_id) is a living father.
   * Rewrite name under that father — never null parent / never flip buckets.
   */
  function buildAlignNameToStoredParent(issue, children) {
    var path = norm(issue && (issue.child_path || issue.name));
    var leaf = leafOf(path);
    if (!path || !leaf) return null;

    var fatherRow = resolveStoredFatherRow(issue, children || []);
    if (!fatherRow) return null;

    var canonical = childPathOf(fatherRow);
    if (!canonical) return null;

    var newPath = canonical + "/" + leaf;
    if (newPath === path) return null;
    if (parentPrefixOf(newPath) !== canonical) return null;

    var parentCol = issue && issue.parent != null ? norm(issue.parent) : "";
    var stored = norm(
      issue && (issue.stored_parent || issue.parent_name || issue.parent),
    );
    var pid =
      (issue && issue.parent_person_id) ||
      (fatherRow && fatherRow.person_id) ||
      null;

    return {
      ok: true,
      repair_type: "align_name_to_parent_path",
      child_path: newPath,
      name: newPath,
      child_name: newPath,
      parent: parentCol || stored || canonical,
      parent_name: stored || parentCol || canonical,
      parent_person_id: pid ? String(pid) : null,
      keep_parent: true,
      reason_ar:
        "تصحيح مسار الاسم ليطابق الأب الموجود «" +
        canonical +
        "» — الاسم الحالي «" +
        path +
        "» لا يستخرج أبًا صالحًا؛ حقل الأب/المعرف بلا تغيير.",
      impact_ar:
        "يُحدَّث الاسم/المسار فقط · الأب ومعرف الأب بلا تغيير · تختفي «الاسم مكتوب بطريقة مختلفة».",
      affected_rows: 1,
    };
  }

  /** Count rows whose name/parent path uses oldPath as exact path or prefix. */
  function countPathPrefixImpact(children, branch, oldPath) {
    var b = norm(branch);
    var old = norm(oldPath);
    if (!old) return 0;
    var n = 0;
    (children || []).forEach(function (c) {
      if (!c) return;
      if (b && norm(c.branch_key) !== b) return;
      var name = norm(c.child_name || c.name);
      var p = norm(c.parent || c.parent_name);
      if (name === old || name.indexOf(old + "/") === 0) n += 1;
      else if (p === old || p.indexOf(old + "/") === 0) n += 1;
    });
    return n;
  }

  /**
   * Unify leaf spelling for one row (possible_spelling_duplicates action).
   */
  function buildUnifyLeafName(issue, chosenFrom, chosenTo, children) {
    var fromLeaf = norm(chosenFrom);
    var toLeaf = norm(chosenTo);
    if (!fromLeaf || !toLeaf || fromLeaf === toLeaf) {
      return { ok: false, message_ar: "لا اختلاف إملائي لتوحيده." };
    }
    if (!pathsEqual(fromLeaf, toLeaf)) {
      return {
        ok: false,
        message_ar: "الاسمان ليسا متكافئين بعد توحيد العربية — راجع يدويًا.",
      };
    }
    var pathA = norm(issue && issue.child_path_a);
    var pathB = norm(issue && issue.child_path_b);
    var idA = issue && issue.id_a;
    var idB = issue && issue.id_b;
    var targetId = null;
    var oldPath = "";
    var newPath = "";
    if (leafOf(pathA) === fromLeaf) {
      targetId = idA;
      oldPath = pathA;
      newPath = parentPrefixOf(pathA)
        ? parentPrefixOf(pathA) + "/" + toLeaf
        : toLeaf;
    } else if (leafOf(pathB) === fromLeaf) {
      targetId = idB;
      oldPath = pathB;
      newPath = parentPrefixOf(pathB)
        ? parentPrefixOf(pathB) + "/" + toLeaf
        : toLeaf;
    }
    if (targetId == null || !oldPath || !newPath || oldPath === newPath) {
      return {
        ok: false,
        message_ar: "تعذر تحديد السجل المراد توحيد اسمه.",
      };
    }
    var Struct = global.AlzidanIntegrityTreeStructure;
    var diffReason =
      (issue && issue.diff_reason_ar) ||
      (Struct && typeof Struct.explainArabicSpellingDiff === "function"
        ? Struct.explainArabicSpellingDiff(fromLeaf, toLeaf)
        : "اختلاف إملائي");
    var affected = countPathPrefixImpact(
      children,
      issue && issue.branch_key,
      oldPath,
    );
    if (affected < 1) affected = 1;
    return {
      ok: true,
      repair_type: "unify_leaf_name",
      issue_id: targetId,
      from_leaf: fromLeaf,
      to_leaf: toLeaf,
      old_path: oldPath,
      child_path: newPath,
      name: newPath,
      child_name: newPath,
      keep_parent: true,
      parent: null,
      parent_name: null,
      parent_person_id: null,
      reason_ar:
        "توحيد الاسم من «" +
        fromLeaf +
        "» إلى «" +
        toLeaf +
        "» (" +
        diffReason +
        ").",
      diff_reason_ar: diffReason,
      affected_rows: affected,
      impact_ar:
        "يُحدَّث مسار الاسم للسجل" +
        (affected > 1
          ? " وما يتفرّع منه من مسارات (" + affected + ")"
          : "") +
        " — بلا دمج ودون حذف.",
      confirm_ar: {
        current: fromLeaf,
        proposed: toLeaf,
        reason: diffReason,
        affected: affected,
      },
    };
  }

  /** Merge preview for spelling-duplicate pair — never silent. */
  function buildMergePairPreview(issue, survivorId, children) {
    var idA = issue && issue.id_a;
    var idB = issue && issue.id_b;
    var survivor = survivorId != null ? Number(survivorId) : Number(idA);
    var loser = survivor === Number(idA) ? Number(idB) : Number(idA);
    if (!survivor || !loser || survivor === loser) {
      return {
        ok: false,
        message_ar: "اختر سجلًا يبقى وسجلًا يُدمَج — نفس الشخص فقط.",
      };
    }
    var survPath =
      survivor === Number(idA)
        ? norm(issue && issue.child_path_a)
        : norm(issue && issue.child_path_b);
    var losePath =
      loser === Number(idA)
        ? norm(issue && issue.child_path_a)
        : norm(issue && issue.child_path_b);
    var childCount = 0;
    (children || []).forEach(function (c) {
      if (!c) return;
      var p = norm(c.parent || c.parent_name);
      if (p === losePath) childCount += 1;
    });
    return {
      ok: true,
      repair_type: "merge_duplicate_pair",
      survivor_id: survivor,
      loser_id: loser,
      survivor_path: survPath,
      loser_path: losePath,
      children_to_reparent: childCount,
      affected_rows: 1 + childCount,
      reason_ar:
        "دمج السجل #" +
        loser +
        " («" +
        leafOf(losePath) +
        "») في #" +
        survivor +
        " («" +
        leafOf(survPath) +
        "») — بعد تأكيد أنهما نفس الشخص.",
      impact_ar:
        "أبناء المتأثرون بإعادة ربط الأب: " +
        childCount +
        " · يُحذف سجل المكرر بعد إعادة الربط · بلا تنفيذ صامت.",
      danger_ar:
        "تحذير: الدمج يغيّر علاقات الأبناء ويحذف سجلًا. راجع المعاينة ثم نفّذ من مساحة SQL فقط.",
    };
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

    var leaf = leafOf(path);
    var extractFather = extracted
      ? resolveFatherRow(children, branch, extracted)
      : null;
    var alignsWithExtract = true;
    if (extracted) {
      if (extractFather) {
        alignsWithExtract = childPathOf(extractFather) === canonical;
      } else {
        alignsWithExtract = pathsEqual(canonical, extracted);
      }
    }

    // Truncated/orphan extract: choosing a living father + rewriting name under him
    // clears path_mismatch without flipping to missing_father.
    if (!alignsWithExtract && !extractFather && leaf && canonical) {
      var fixedName = canonical + "/" + leaf;
      return {
        ok: true,
        parent: canonical,
        parent_name: canonical,
        parent_person_id: pid ? String(pid) : null,
        child_path: fixedName,
        child_name: fixedName,
        name: fixedName,
        keep_parent: false,
        would_flip_only: false,
        clears_missing_father: true,
        clears_path_mismatch: true,
        block_message_ar: null,
        reason_ar:
          "اختيار المدير: ربط الأب «" +
          canonical +
          "» وتصحيح مسار الاسم إلى «" +
          fixedName +
          "» (الأب من المسار «" +
          extracted +
          "» غير موجود).",
      };
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
    var father = resolveFatherRow(children, b, p);
    if (father && father.person_id) {
      return {
        person_id: String(father.person_id),
        candidates: [father],
        canonical_path: childPathOf(father) || null,
        father: father,
      };
    }
    // Ambiguous or missing — surface leaf collisions for manual review
    var candidates = [];
    if (p.indexOf("/") < 0) {
      (children || []).forEach(function (c) {
        if (!c || norm(c.branch_key) !== b) return;
        var path = childPathOf(c);
        var leaf =
          path.indexOf("/") >= 0 ? path.slice(path.lastIndexOf("/") + 1) : path;
        if (pathsEqual(leaf, p) || leaf === p) candidates.push(c);
      });
    }
    return {
      person_id: null,
      candidates: candidates,
      canonical_path: null,
      father: null,
    };
  }

  /**
   * Resolve expected father for TREE-003 UUID link across all such rows.
   * Uses Structure/Tree Engine helpers — path strip preferred over leaf guess.
   */
  function resolveUuidLinkFather(issue, children) {
    var row = {
      id: issue && issue.id,
      branch_key: issue && issue.branch_key,
      child_name: issue && (issue.child_path || issue.child_name || issue.name),
      name: issue && (issue.child_path || issue.name),
      parent: issue && (issue.parent || issue.parent_key || issue.stored_parent),
      parent_name:
        issue &&
        (issue.parent_name || issue.parent_key || issue.stored_parent),
      parent_person_id: issue && issue.parent_person_id,
      person_id: issue && issue.person_id,
    };
    var Struct = global.AlzidanIntegrityTreeStructure;
    var Engine = global.AlzidanTreeEngine;
    if (
      Struct &&
      typeof Struct.resolveExpectedFatherForUuidLink === "function"
    ) {
      return Struct.resolveExpectedFatherForUuidLink(row, children || []);
    }
    if (
      Engine &&
      typeof Engine.resolveExpectedFatherForUuidLink === "function"
    ) {
      return Engine.resolveExpectedFatherForUuidLink(row, children || []);
    }
    var path = childPathOf(row);
    var extracted = extractParentFromName(path);
    var stored = norm(
      issue && (issue.stored_parent || issue.parent_name || issue.parent || issue.parent_key),
    );
    var branch = norm(issue && issue.branch_key);
    var father =
      (extracted && resolveFatherRow(children, branch, extracted)) ||
      (stored && resolveFatherRow(children, branch, stored)) ||
      null;
    if (father && father.person_id) {
      return {
        status: "found",
        father: father,
        person_id: String(father.person_id),
        expected_parent_path: childPathOf(father),
        method: extracted ? "name_path_strip" : "stored_parent",
      };
    }
    return {
      status: "missing",
      father: null,
      person_id: null,
      expected_parent_path: extracted || stored || "",
      method: "fallback",
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
        var sameCanonicalFather =
          !!(
            unified.ok &&
            unified.parent &&
            ((stored && pathsEqual(stored, unified.parent)) ||
              (parentCol && pathsEqual(parentCol, unified.parent)) ||
              (extracted && pathsEqual(extracted, unified.parent)))
          );
        var spellOnly =
          (!!extracted &&
            !!stored &&
            pathsEqual(extracted, stored) &&
            (!parentCol || pathsEqual(parentCol, extracted))) ||
          (sameCanonicalFather &&
            !!extracted &&
            !!stored &&
            pathsEqual(extracted, stored));
        var alreadyCanonical =
          !!(
            unified.ok &&
            unified.parent &&
            parentCol === unified.parent &&
            norm(issue && issue.parent_name) === unified.parent
          );
        var nameUnderStored = buildAlignNameToStoredParent(issue, children);
        if (spellOnly || alreadyCanonical || (sameCanonicalFather && pathsEqual(extracted, stored))) {
          // دوخي↔دوخى بعد التطبيع: ليست مشكلة هيكلية — لا نفرّغ الأب ولا نقلب الفئة.
          analysis.repair_type = "spelling_equivalent_no_write";
          analysis.can_auto_propose = false;
          analysis.requires_manual_choice = false;
          analysis.proposed = null;
          analysis.would_flip_only = false;
          analysis.block_message_ar = null;
          analysis.clears_missing_father = true;
          analysis.clears_path_mismatch = true;
          analysis.resolved_by_normalize = true;
          analysis.resolved_message_ar =
            "لا حاجة لإصلاح: الاختلاف إملائي فقط والعلاقة صحيحة";
          analysis.decision_logic_ar = [
            "الأب من المسار: «" + (extracted || "—") + "».",
            "المذكور في السجل: «" + (stored || "فارغ") + "».",
            spellOnly || pathsEqual(extracted, stored)
              ? "بعد توحيد العربية (ى↔ي / همزة / ة↔ه) المساران متكافئان — ليست مشكلة هيكلية."
              : "حقل الأب مضبوط أصلًا على اسم الأب الموجود في الشجرة.",
            analysis.resolved_message_ar,
            "لا يُفرَّغ حقل الأب · لا تنفيذ يفرّغ المعاينة.",
          ];
          analysis.root_cause_ar =
            "الاسم مكتوب بطريقة مختلفة عن حقل الأب (مثل دوخي/دوخى أو فضى/فضي) — الأب نفسه بعد التوحيد.";
          var alignOpt = buildAlignNamePathSpelling(issue, children);
          analysis.optional_align_name_path = alignOpt;
          if (alignOpt && alignOpt.ok) {
            analysis.decision_logic_ar.push(
              "اختياري: «توحيد إملاء الاسم ليطابق الأب» → «" +
                alignOpt.child_path +
                "» دون تغيير الأب/المعرف.",
            );
          }
        } else if (unified.ok) {
          // Extract resolves to a living father — align parent fields to that father.
          // (Do this before name-under-stored so a wrong-but-living stored parent
          // does not swallow a valid extract match.)
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
        } else if (nameUnderStored && nameUnderStored.ok) {
          // 1602-style: parent/UUID صالحان لكن الاسم مختصر أو لا يستخرج أبًا موجودًا.
          analysis.repair_type = "align_name_to_parent_path";
          analysis.can_auto_propose = true;
          analysis.requires_manual_choice = false;
          analysis.proposed = nameUnderStored;
          analysis.would_flip_only = false;
          analysis.block_message_ar = null;
          analysis.clears_missing_father = true;
          analysis.clears_path_mismatch = true;
          analysis.root_cause_ar =
            "مسار الاسم ناقص أو لا يطابق الأب المخزّن — حقل الأب صحيح؛ يُصحَّح الاسم فقط.";
          analysis.write_path_ar =
            "كيفية الإصلاح: توحيد مسار الاسم تحت الأب الموجود دون تفريغ الأب أو المعرف.";
          analysis.decision_logic_ar = [
            "الأب من المسار: «" + (extracted || "—") + "» (غير صالح أو لا يطابق).",
            "المذكور في السجل: «" + (stored || "فارغ") + "».",
            "وُجد الأب في الشجرة — يُقترح تصحيح الاسم إلى «" +
              nameUnderStored.child_path +
              "».",
            "حقل الأب والمعرف بلا تغيير · لا After فارغ · لا نقل للفئة.",
          ];
        } else {
          analysis.can_auto_propose = false;
          analysis.requires_manual_choice = true;
          analysis.proposed = null;
          // Prefer stored parent for suggestions when present (not the orphan extract).
          analysis.suggestions = suggestFatherMatches(
            Object.assign({}, issue, {
              stored_parent: stored || extracted,
              parent: stored || extracted,
              parent_name: stored || extracted,
            }),
            children,
            5,
          );
          analysis.decision_logic_ar = [
            fatherLookupFailureAr(extracted, children, norm(issue && issue.branch_key)),
            "لا يُكتب الأب من المسار كحقل أب إن لم يوجد في الشجرة.",
            "اختر أبًا موجودًا؛ إن كان المسار مختصرًا سيُصحَّح الاسم تحت الأب المختار.",
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
      cat === "TREE-003-warn" ||
      /TREE-003/i.test(String((issue && issue.code) || "")) ||
      (issue &&
        (issue.issue === "needs_uuid_link" ||
          issue.issue === "needs_uuid_relink" ||
          issue.reason === "missing_uuid")) ||
      (issue && issue.severity === "error" && issue.code)
    ) {
      analysis.repair_type = "link_parent_uuid";
      analysis.never_rename = true;
      analysis.uuid_only = true;
      var uuidRes = resolveUuidLinkFather(issue, children);
      var fatherRow = uuidRes.father || null;
      var fatherPid = uuidRes.person_id || null;
      var expectedPath =
        uuidRes.expected_parent_path ||
        stored ||
        norm(issue && issue.parent_key) ||
        "";
      var currentPid =
        issue && issue.parent_person_id != null
          ? String(issue.parent_person_id).trim()
          : "";

      analysis.expected_father_path = expectedPath || null;
      analysis.found_father_id = fatherRow && fatherRow.id != null ? fatherRow.id : null;
      analysis.found_father_path = fatherRow ? childPathOf(fatherRow) : null;
      analysis.father_person_id_to_link = fatherPid;
      analysis.current_parent_person_id = currentPid || null;
      analysis.resolution = uuidRes;

      // Names never change for UUID link
      var keepParent = stored || parentCol || expectedPath || null;
      analysis.before.parent = parentCol || keepParent;
      analysis.before.parent_name =
        norm(issue && issue.parent_name) || keepParent;

      if (uuidRes.status === "linked" && fatherPid) {
        analysis.can_auto_propose = false;
        analysis.requires_manual_choice = false;
        analysis.proposed = null;
        analysis.decision_logic_ar = [
          "العلاقة عبر UUID صحيحة أصلًا — لا حاجة لربط.",
          "الأب المرتبط: «" + (uuidRes.expected_parent_path || "—") + "».",
        ];
        analysis.root_cause_ar =
          analysis.root_cause_ar || "parent_person_id يشير لأب حي صالح.";
        analysis.write_path_ar =
          analysis.write_path_ar || "لا إصلاح — العلاقة سليمة.";
      } else if (uuidRes.status === "found" && fatherPid) {
        analysis.can_auto_propose = true;
        analysis.requires_manual_choice = false;
        analysis.proposed = {
          parent: keepParent,
          parent_name: keepParent,
          parent_person_id: fatherPid,
          keep_names: true,
          uuid_only: true,
          reason_ar:
            "ربط parent_person_id فقط بأب المسار «" +
            (uuidRes.expected_parent_path || expectedPath) +
            "» — بلا تغيير أسماء.",
        };
        analysis.decision_logic_ar = [
          "تحديد الأب الحقيقي من مسار/علاقة الشجرة (" +
            (uuidRes.method || "path") +
            ").",
          "سجل الابن: #" +
            String(issue && issue.id) +
            " · «" +
            (path || "—") +
            "».",
          "الأب المتوقع: «" + (expectedPath || "—") + "».",
          "سجل الأب الموجود: #" +
            String(fatherRow && fatherRow.id) +
            " · «" +
            childPathOf(fatherRow) +
            "».",
          "parent_person_id الحالي: " + (currentPid || "—"),
          "person_id للأب للربط: " + fatherPid,
          "قبل → بعد: " +
            (currentPid || "null") +
            " → " +
            fatherPid,
          "SQL المقترح يحدّث parent_person_id فقط.",
        ];
        analysis.root_cause_ar =
          analysis.root_cause_ar ||
          "الأب موجود في الشجرة بمعرف صالح، لكن سجل الابن بلا parent_person_id مطابق.";
        analysis.write_path_ar =
          analysis.write_path_ar ||
          "كيفية الإصلاح: UPDATE parent_person_id فقط بعد تحليل → معاينة → موافقة → مساحة SQL.";
      } else if (uuidRes.status === "ambiguous") {
        analysis.can_auto_propose = false;
        analysis.requires_manual_choice = true;
        analysis.proposed = null;
        analysis.decision_logic_ar = [
          "أب غامض — عدة مرشّحين بنفس ورقة الاسم («" +
            (expectedPath || "—") +
            "») — لا تخمين محمد/غيره.",
          "راجع يدويًا في تسلسل الشجرة ثم اربط المعرف.",
        ];
        analysis.root_cause_ar =
          analysis.root_cause_ar ||
          "تطابق ورقة اسم غير فريد — لا ربط UUID تلقائي.";
        analysis.write_path_ar =
          analysis.write_path_ar ||
          "كيفية الإصلاح: اختر الأب الصحيح من التسلسل يدويًا ثم اربط المعرف.";
        var ambLink = findParentPersonId(
          children,
          issue.branch_key,
          expectedPath,
        );
        if (ambLink.candidates && ambLink.candidates.length) {
          analysis.suggestions = ambLink.candidates.map(function (c) {
            return {
              id: c.id,
              person_id: c.person_id || null,
              child_path: childPathOf(c),
              distance: 0,
              score_ar: "مرشّح غامض — تحقق من التسلسل",
            };
          });
        }
      } else {
        // Father truly missing — no UUID repair
        analysis.can_auto_propose = false;
        analysis.requires_manual_choice = true;
        analysis.proposed = null;
        analysis.repair_type = "manual_review";
        analysis.decision_logic_ar = [
          "الأب غير موجود في الشجرة — لا اقتراح ربط UUID.",
          "المسار المتوقع: «" + (expectedPath || "—") + "».",
          "صنّف للمراجعة: أنشئ الأب أولًا أو صحّح المسار، ثم أعد الفحص.",
        ];
        analysis.root_cause_ar =
          analysis.root_cause_ar ||
          "لا صف أب حي يطابق مسار الاسم/حقل الأب — ليس مجرد نقص UUID.";
        analysis.write_path_ar =
          analysis.write_path_ar ||
          "كيفية الإصلاح: أضف الأب للشجرة أو صحّح العلاقة نصيًا أولًا — بلا ربط UUID.";
      }
    } else if (cat === "possible_spelling_duplicates" || cat === "TREE-SPELL-DUP") {
      analysis.repair_type = "manual_review_no_merge";
      analysis.requires_manual_choice = true;
      analysis.can_auto_propose = false;
      analysis.proposed = null;
      analysis.never_rename = false;
      analysis.never_auto_merge = true;
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
      var preferred = preferArabicSpelling(
        issue && issue.name_a,
        issue && issue.name_b,
      );
      var otherLeaf =
        preferred === norm(issue && issue.name_a)
          ? norm(issue && issue.name_b)
          : norm(issue && issue.name_a);
      analysis.spelling_pair = {
        name_a: norm(issue && issue.name_a),
        name_b: norm(issue && issue.name_b),
        preferred: preferred,
        other: otherLeaf,
        diff_reason_ar: diffReason,
        id_a: issue && issue.id_a,
        id_b: issue && issue.id_b,
      };
      analysis.decision_logic_ar = [
        "أسماء قد تكون مكررة تحت نفس الأب بعد توحيد العربية (همزة / ى↔ي / ة↔ه / تشكيل).",
        "الاسم الأول: «" +
          norm(issue && issue.name_a) +
          "» · الاسم الثاني: «" +
          norm(issue && issue.name_b) +
          "».",
        "السبب: " + diffReason + ".",
        "إجراءات متاحة للمشرف: مراجعة · توحيد الاسم · دمج السجلين (نفس الشخص فقط) · تجاهل.",
        "لا دمج تلقائي — أي كتابة تمر بتحليل → معاينة → موافقة → مساحة SQL.",
      ];
      analysis.root_cause_ar =
        analysis.root_cause_ar ||
        "متغيرات إملائية عربية أو سجلات مكررة تحت نفس الأب — الغموض مقصود حتى يقرر المشرف.";
      analysis.write_path_ar =
        analysis.write_path_ar ||
        "كيفية الإصلاح: توحيد الإملاء إن كانا نفس الشخص بأسماء مختلفة، أو دمج يدوي بعد تأكيد الهوية، أو تجاهل إن كانا شخصين.";
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
        if (evalChosen.child_path) {
          after.child_path = evalChosen.child_path;
          after.child_name = evalChosen.child_name || evalChosen.child_path;
          after.name = evalChosen.name || evalChosen.child_path;
          after.keep_parent = !!evalChosen.keep_parent;
        }
      } else {
        after = null;
      }
    }

    // Spelling-only: never show empty After as if parent would be nulled.
    if (a.repair_type === "spelling_equivalent_no_write") {
      wouldFlip = false;
      blockMsg = null;
      after = {
        parent: (a.before && a.before.parent) || null,
        parent_name: (a.before && a.before.parent_name) || null,
        parent_person_id: (a.before && a.before.parent_person_id) || null,
        child_path: (a.before && a.before.child_path) || null,
        unchanged: true,
        reason_ar:
          a.resolved_message_ar ||
          "لا حاجة لإصلاح: الاختلاف إملائي فقط والعلاقة صحيحة",
      };
    }

    if (
      (a.repair_type === "align_name_path_spelling" ||
        a.repair_type === "align_name_to_parent_path") &&
      a.proposed
    ) {
      after = Object.assign({}, a.proposed);
      wouldFlip = false;
      blockMsg = null;
      clearsPath = true;
      clearsMissing = true;
    }

    if (a.repair_type === "unify_leaf_name" && a.proposed) {
      after = Object.assign({}, a.proposed);
      wouldFlip = false;
      blockMsg = null;
    }

    if (a.repair_type === "merge_duplicate_pair" && a.proposed) {
      after = Object.assign({}, a.proposed);
      wouldFlip = false;
    }

    if (a.repair_type === "link_parent_uuid" && a.proposed) {
      after = Object.assign({}, a.proposed);
      wouldFlip = false;
      blockMsg = null;
      // UUID-only: never treat as name rewrite
      after.uuid_only = true;
      after.keep_names = true;
    }

    var nameOnly =
      a.repair_type === "align_name_path_spelling" ||
      a.repair_type === "align_name_to_parent_path" ||
      a.repair_type === "unify_leaf_name" ||
      !!(after && after.keep_parent && (after.child_path || after.child_name));
    var mergePair = a.repair_type === "merge_duplicate_pair";
    var uuidOnly =
      a.repair_type === "link_parent_uuid" ||
      !!(after && (after.uuid_only || after.keep_names));

    var executable =
      a.repair_type === "manual_review_no_merge" ||
      a.repair_type === "manual_review" ||
      a.repair_type === "spelling_equivalent_no_write"
        ? false
        : nameOnly
          ? !!(after && (after.child_path || after.child_name || after.name))
          : mergePair
            ? !!(after && after.survivor_id && after.loser_id)
            : uuidOnly
              ? !!(after && after.parent_person_id)
              : !wouldFlip &&
                !!(
                  after &&
                  (after.parent ||
                    after.parent_person_id ||
                    after.child_path)
                );

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
      uuid_only: uuidOnly,
      never_auto_merge: a.repair_type === "manual_review_no_merge",
      resolved_by_normalize: !!a.resolved_by_normalize,
      resolved_message_ar: a.resolved_message_ar || null,
      optional_align_name_path: a.optional_align_name_path || null,
      clears_missing_father: clearsMissing,
      clears_path_mismatch: clearsPath,
      would_flip_only: wouldFlip,
      block_message_ar: wouldFlip ? blockMsg || FLIP_BLOCK_AR : null,
      expected_father_path: a.expected_father_path || null,
      found_father_id: a.found_father_id || null,
      found_father_path: a.found_father_path || null,
      father_person_id_to_link:
        a.father_person_id_to_link ||
        (after && after.parent_person_id) ||
        null,
      current_parent_person_id:
        a.current_parent_person_id ||
        (a.before && a.before.parent_person_id) ||
        null,
      preview_flags_ar: a.resolved_by_normalize
        ? a.resolved_message_ar ||
          "لا حاجة لإصلاح: الاختلاف إملائي فقط والعلاقة صحيحة"
        : uuidOnly
          ? [
              "تحديث parent_person_id فقط — الأسماء بلا تغيير.",
              "سيمسح «يحتاج ربط UUID»؟ " +
                (after && after.parent_person_id ? "نعم (بعد إعادة الفحص)" : "لا"),
            ].join("\n")
          : [
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
    if (
      analysis &&
      (analysis.repair_type === "align_name_to_parent_path" ||
        analysis.repair_type === "align_name_path_spelling")
    ) {
      out.push(
        "المنطق: حقل الأب صالح — يُصحَّح مسار الاسم فقط دون تفريغ الأب أو المعرف.",
      );
    }
    if (analysis && analysis.never_rename) {
      out.push("قيد صارم: لا إعادة تسمية — ربط المعرف فقط.");
    }
    if (analysis && analysis.repair_type === "link_parent_uuid") {
      out.push(
        "المنطق: الأب من مسار الشجرة → صف الأب → person_id → تحديث parent_person_id فقط.",
      );
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
    var repairType = (p.analysis && p.analysis.repair_type) || "";

    if (p.would_flip_only || (p.analysis && p.analysis.would_flip_only && !p.after)) {
      return {
        ok: false,
        message_ar: p.block_message_ar || FLIP_BLOCK_AR,
      };
    }
    if (
      p.never_auto_merge ||
      repairType === "manual_review_no_merge"
    ) {
      return {
        ok: false,
        message_ar:
          "الأسماء التي قد تكون مكررة للمراجعة فقط — ممنوع توليد أمر دمج من مركز الصحة دون اختيار صريح «دمج السجلين».",
      };
    }
    if (repairType === "spelling_equivalent_no_write" || p.resolved_by_normalize) {
      return {
        ok: false,
        message_ar:
          p.resolved_message_ar ||
          "لا حاجة لإصلاح: الاختلاف إملائي فقط والعلاقة صحيحة",
      };
    }

    if (repairType === "merge_duplicate_pair") {
      var survivor = after.survivor_id;
      var loser = after.loser_id;
      var survPath = norm(after.survivor_path);
      var losePath = norm(after.loser_path);
      if (!survivor || !loser || !survPath || !losePath) {
        return { ok: false, message_ar: "معاينة الدمج غير مكتملة." };
      }
      var mergeSql = [
        "-- مركز الصحة · دمج مكرر محتمل · بعد موافقة المدير — راجع بحذر",
        "-- survivor: " + survivor + " · loser: " + loser + " · actor: " + String(actor).replace(/\n/g, " "),
        "-- reason: " + String(reason).replace(/\n/g, " ").slice(0, 200),
        "-- 1) إعادة ربط أبناء السجل المحذوف إلى المسار الناجي",
        "UPDATE public.tree_children",
        "SET parent = " + sqlLit(survPath) + ",",
        "    parent_name = " + sqlLit(survPath),
        "WHERE (parent = " + sqlLit(losePath) + " OR parent_name = " + sqlLit(losePath) + ")",
        "  AND id <> " + Number(loser) + ";",
        "",
        "-- 2) حذف السجل المكرر (نفس الشخص فقط — راجع العدد قبل التشغيل)",
        "DELETE FROM public.tree_children",
        "WHERE id = " + Number(loser) + ";",
      ].join("\n");
      return {
        ok: true,
        sql: mergeSql,
        title: "دمج السجلين #" + loser + " → #" + survivor + " (مركز الصحة)",
        row_id: loser,
        before: before,
        after: after,
        success_meta: {
          row_id: survivor,
          father_name: "",
          merge: true,
          survivor_id: survivor,
          loser_id: loser,
        },
      };
    }

    if (id == null && after.issue_id != null) id = after.issue_id;
    if (id == null || !after) {
      return {
        ok: false,
        message_ar: "لا معاينة قابلة للتنفيذ.",
      };
    }

    var sets = [];
    var newName = norm(after.child_path || after.child_name || after.name);
    var nameOnly =
      repairType === "align_name_path_spelling" ||
      repairType === "align_name_to_parent_path" ||
      repairType === "unify_leaf_name" ||
      !!after.keep_parent;
    var uuidOnly =
      repairType === "link_parent_uuid" ||
      !!after.uuid_only ||
      !!after.keep_names;
    var nameAndParent = !!(newName && after.parent && !after.keep_parent && !uuidOnly);

    if (uuidOnly && after.parent_person_id) {
      // TREE-003: names never change — parent_person_id only
      sets.push(
        "  parent_person_id = " + sqlLit(after.parent_person_id) + "::uuid",
      );
    } else if (nameOnly && newName) {
      sets.push("  child_name = " + sqlLit(newName));
      sets.push("  name = " + sqlLit(newName));
      if (repairType === "unify_leaf_name" && after.old_path && after.affected_rows > 1) {
        // Also rewrite descendant prefixes — separate UPDATEs after the leaf row.
      }
    } else if (nameAndParent) {
      sets.push("  child_name = " + sqlLit(newName));
      sets.push("  name = " + sqlLit(newName));
      sets.push("  parent = " + sqlLit(after.parent));
      sets.push("  parent_name = " + sqlLit(after.parent_name || after.parent));
      if (after.parent_person_id) {
        sets.push(
          "  parent_person_id = " + sqlLit(after.parent_person_id) + "::uuid",
        );
      }
    } else {
      if (after.parent != null && after.parent !== "") {
        sets.push("  parent = " + sqlLit(after.parent));
        sets.push("  parent_name = " + sqlLit(after.parent_name || after.parent));
      }
      if (after.parent_person_id) {
        sets.push(
          "  parent_person_id = " + sqlLit(after.parent_person_id) + "::uuid",
        );
      }
    }
    if (!sets.length) {
      return { ok: false, message_ar: "لا حقول للتحديث في المعاينة." };
    }

    var rowId = Number(id);
    var sqlParts = [
      "-- مركز الصحة · سجل واحد · بعد موافقة المدير",
      "-- id: " + rowId + " · actor: " + String(actor).replace(/\n/g, " "),
      "-- reason: " + String(reason).replace(/\n/g, " ").slice(0, 200),
    ];
    if (uuidOnly) {
      sqlParts.push(
        "-- before.parent_person_id: " +
          String(before.parent_person_id == null ? "" : before.parent_person_id),
      );
      sqlParts.push(
        "-- after.parent_person_id: " +
          String(after.parent_person_id == null ? "" : after.parent_person_id),
      );
      sqlParts.push("-- names unchanged (UUID link only)");
    } else {
      sqlParts.push(
        "-- before.parent: " + String(before.parent == null ? "" : before.parent),
      );
      sqlParts.push(
        "-- after.parent: " +
          String(
            nameOnly
              ? "(بدون تغيير الأب)"
              : after.parent == null
                ? ""
                : after.parent,
          ),
      );
    }
    if (newName && (nameOnly || nameAndParent)) {
      sqlParts.push("-- after.name: " + newName);
    }
    sqlParts.push("UPDATE public.tree_children");
    sqlParts.push("SET");
    sqlParts.push(sets.join(",\n"));
    sqlParts.push("WHERE id = " + rowId + ";");

    if (
      repairType === "unify_leaf_name" &&
      after.old_path &&
      newName &&
      after.old_path !== newName
    ) {
      var oldP = norm(after.old_path);
      sqlParts.push("");
      sqlParts.push("-- تحديث المسارات المتفرّعة التي تبدأ بالمسار القديم (إن وُجدت)");
      sqlParts.push("UPDATE public.tree_children");
      sqlParts.push("SET");
      sqlParts.push(
        "  child_name = " +
          sqlLit(newName) +
          " || substr(child_name, " +
          (oldP.length + 1) +
          "),",
      );
      sqlParts.push(
        "  name = " +
          sqlLit(newName) +
          " || substr(name, " +
          (oldP.length + 1) +
          ")",
      );
      sqlParts.push(
        "WHERE id <> " +
          rowId +
          " AND (child_name LIKE " +
          sqlLit(oldP + "/%") +
          " OR name LIKE " +
          sqlLit(oldP + "/%") +
          ");",
      );
      sqlParts.push("UPDATE public.tree_children");
      sqlParts.push("SET");
      sqlParts.push("  parent = " + sqlLit(newName) + " || substr(parent, " + (oldP.length + 1) + "),");
      sqlParts.push(
        "  parent_name = " +
          sqlLit(newName) +
          " || substr(parent_name, " +
          (oldP.length + 1) +
          ")",
      );
      sqlParts.push(
        "WHERE parent LIKE " +
          sqlLit(oldP + "/%") +
          " OR parent = " +
          sqlLit(oldP) +
          " OR parent_name LIKE " +
          sqlLit(oldP + "/%") +
          " OR parent_name = " +
          sqlLit(oldP) +
          ";",
      );
    }

    var sql = sqlParts.join("\n");

    return {
      ok: true,
      sql: sql,
      title: nameOnly
        ? repairType === "align_name_to_parent_path"
          ? "تصحيح مسار الاسم للسجل رقم " + rowId + " (مركز الصحة)"
          : "توحيد إملاء الاسم للسجل رقم " + rowId + " (مركز الصحة)"
        : uuidOnly
          ? "ربط UUID للسجل رقم " + rowId + " (parent_person_id فقط)"
          : "إصلاح السجل رقم " + rowId + " (مركز الصحة)",
      row_id: rowId,
      before: before,
      after: after,
      success_meta: {
        row_id: rowId,
        father_name: nameOnly || uuidOnly
          ? ""
          : after.parent || after.parent_name || "",
        after_parent: nameOnly || uuidOnly
          ? ""
          : after.parent || after.parent_name || "",
        updated_parent:
          !nameOnly &&
          !uuidOnly &&
          !!(after.parent != null && after.parent !== ""),
        updated_uuid: !!(uuidOnly || (!nameOnly && after.parent_person_id)),
        uuid_only: !!uuidOnly,
        expected_father_person_id: uuidOnly
          ? after.parent_person_id || null
          : null,
        updated_name: !!(nameOnly || nameAndParent),
        from_leaf: after.from_leaf || null,
        to_leaf: after.to_leaf || null,
      },
    };
  }

  /** Activate optional path-spelling unify on an existing spelling_equivalent analysis. */
  function adoptAlignNamePathSpelling(analysis) {
    var a = analysis || {};
    var opt = a.optional_align_name_path;
    if (!opt || !opt.ok) {
      return {
        ok: false,
        message_ar: "لا اقتراح لتوحيد إملاء المسار في الاسم.",
      };
    }
    a.repair_type = "align_name_path_spelling";
    a.resolved_by_normalize = false;
    a.can_auto_propose = true;
    a.requires_manual_choice = false;
    a.would_flip_only = false;
    a.block_message_ar = null;
    a.proposed = {
      child_path: opt.child_path,
      name: opt.child_path,
      child_name: opt.child_path,
      parent: opt.parent,
      parent_name: opt.parent_name,
      parent_person_id: opt.parent_person_id,
      keep_parent: true,
      reason_ar: opt.reason_ar,
      impact_ar: opt.impact_ar,
      affected_rows: opt.affected_rows || 1,
    };
    a.decision_logic_ar = (a.decision_logic_ar || []).concat([
      "تم اعتماد توحيد إملاء المسار في الاسم — الأب/المعرف بلا تغيير.",
    ]);
    return { ok: true, analysis: a };
  }

  /** Build human-readable proposed-fix explanation (اعرض الإصلاح المقترح). */
  function formatProposedFixAr(analysis, preview) {
    var a = analysis || {};
    var p = preview || {};
    var after = (p && p.after) || a.proposed || {};
    var lines = [];
    lines.push("سبب المشكلة: " + (a.root_cause_ar || "—"));
    lines.push("كيفية إصلاحها: " + (a.write_path_ar || "—"));
    if (a.resolved_by_normalize || a.repair_type === "spelling_equivalent_no_write") {
      lines.push(
        a.resolved_message_ar ||
          "لا حاجة لإصلاح: الاختلاف إملائي فقط والعلاقة صحيحة",
      );
      lines.push("الأثر: لا تغيير على UUID أو الأبناء أو حقل الأب.");
      if (a.optional_align_name_path && a.optional_align_name_path.ok) {
        lines.push(
          "اقتراح اختياري: توحيد إملاء المسار → «" +
            a.optional_align_name_path.child_path +
            "».",
        );
        lines.push(
          "عدد السجلات المتأثرة (إن اعتُمد التوحيد): " +
            (a.optional_align_name_path.affected_rows || 1),
        );
      }
      return lines.join("\n");
    }
    if (a.repair_type === "unify_leaf_name") {
      lines.push("الإصلاح المقترح: " + (after.reason_ar || "توحيد الاسم"));
      lines.push(
        "من «" +
          (after.from_leaf || "") +
          "» إلى «" +
          (after.to_leaf || "") +
          "».",
      );
      lines.push("عدد السجلات المتأثرة: " + (after.affected_rows || 1));
      lines.push(after.impact_ar || "تحديث مسار الاسم فقط.");
      return lines.join("\n");
    }
    if (a.repair_type === "merge_duplicate_pair") {
      lines.push("الإصلاح المقترح: " + (after.reason_ar || "دمج السجلين"));
      lines.push(after.impact_ar || "");
      lines.push(after.danger_ar || "");
      lines.push("عدد السجلات المتأثرة: " + (after.affected_rows || "—"));
      return lines.filter(Boolean).join("\n");
    }
    if (a.repair_type === "align_name_path_spelling") {
      lines.push("الإصلاح المقترح: توحيد إملاء الاسم ليطابق الأب");
      lines.push(
        "قبل: «" +
          ((a.before && a.before.child_path) || "—") +
          "»",
      );
      lines.push("بعد: «" + (after.child_path || after.name || "—") + "»");
      lines.push(
        after.impact_ar ||
          "UUID/الأبناء/حقل الأب بلا تغيير — مسار الاسم فقط.",
      );
      lines.push("عدد السجلات المتأثرة: " + (after.affected_rows || 1));
      return lines.join("\n");
    }
    if (a.repair_type === "align_name_to_parent_path") {
      lines.push("الإصلاح المقترح: تصحيح مسار الاسم ليطابق الأب");
      lines.push(
        "قبل: «" + ((a.before && a.before.child_path) || "—") + "»",
      );
      lines.push("بعد: «" + (after.child_path || after.name || "—") + "»");
      lines.push("الأب/المعرف: بلا تغيير");
      lines.push(
        after.impact_ar ||
          "يُحدَّث الاسم فقط حتى يختفي اختلاف المسار.",
      );
      lines.push("عدد السجلات المتأثرة: " + (after.affected_rows || 1));
      return lines.join("\n");
    }
    if (a.repair_type === "link_parent_uuid") {
      lines.push("الإصلاح المقترح: ربط UUID فقط (بلا تغيير أسماء)");
      lines.push(
        "سجل الابن: #" +
          String(a.issue_id || "") +
          " · «" +
          ((a.before && a.before.child_path) || "—") +
          "»",
      );
      lines.push("الأب المتوقع: «" + (a.expected_father_path || "—") + "»");
      lines.push(
        "parent_person_id الحالي: " +
          String(a.current_parent_person_id || (a.before && a.before.parent_person_id) || "—"),
      );
      lines.push(
        "سجل الأب الموجود: #" +
          String(a.found_father_id || "—") +
          " · «" +
          (a.found_father_path || "—") +
          "»",
      );
      lines.push(
        "person_id للأب للربط: " +
          String(a.father_person_id_to_link || (after && after.parent_person_id) || "—"),
      );
      lines.push(
        "قبل → بعد: " +
          String(a.current_parent_person_id || (a.before && a.before.parent_person_id) || "null") +
          " → " +
          String((after && after.parent_person_id) || "—"),
      );
      return lines.join("\n");
    }
    lines.push(
      "الإصلاح المقترح: " +
        (after.reason_ar ||
          (after.parent
            ? "تعيين الأب إلى «" + after.parent + "»"
            : "— لا اقتراح")),
    );
    lines.push(
      "قبل ← الأب: " +
        String((a.before && a.before.parent) || "فارغ") +
        " · المعرف: " +
        String((a.before && a.before.parent_person_id) || "—"),
    );
    lines.push(
      "بعد ← الأب: " +
        String(after.parent || "—") +
        " · المعرف: " +
        String(after.parent_person_id || "—"),
    );
    lines.push("الأثر: " + (a.impact_ar || "—"));
    if (p.preview_flags_ar) lines.push(p.preview_flags_ar);
    lines.push(
      p.executable
        ? "الحالة: قابل للتنفيذ بعد الموافقة عبر مساحة SQL."
        : "الحالة: غير قابل للتنفيذ تلقائيًا — اختر مرشّحًا أو راجع يدويًا.",
    );
    return lines.join("\n");
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
    if (m.merge) {
      return (
        "✅ تم تجهيز دمج السجل #" +
        (m.loser_id || "?") +
        " في #" +
        (m.survivor_id || id) +
        " عبر مساحة SQL — أكّد التنفيذ هناك."
      );
    }
    if (m.updated_name && m.from_leaf && m.to_leaf) {
      return (
        "✅ تم توحيد الاسم من «" + m.from_leaf + "» إلى «" + m.to_leaf + "»."
      );
    }
    if (m.updated_name) {
      return "✅ تم توحيد إملاء المسار في الاسم للسجل رقم " + id + ".";
    }
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
    resolveUuidLinkFather: resolveUuidLinkFather,
    resolveUnifiedParentTarget: resolveUnifiedParentTarget,
    evaluateChosenFather: evaluateChosenFather,
    buildAlignNamePathSpelling: buildAlignNamePathSpelling,
    buildAlignNameToStoredParent: buildAlignNameToStoredParent,
    buildUnifyLeafName: buildUnifyLeafName,
    buildMergePairPreview: buildMergePairPreview,
    adoptAlignNamePathSpelling: adoptAlignNamePathSpelling,
    formatProposedFixAr: formatProposedFixAr,
    preferArabicSpelling: preferArabicSpelling,
    countPathPrefixImpact: countPathPrefixImpact,
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
