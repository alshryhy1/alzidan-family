/**
 * Tree Structure Integrity Audit — read-only.
 * Extends Health Center (ADR-004 / R-7): detect broken parent links; never auto-repair.
 *
 * Categories:
 *  - parent_null: column `parent` is NULL/blank (dual-column drift)
 *  - parent_empty: both parent and parent_name empty
 *  - missing_father: parent string set but no matching tree_children.name/child_name
 *  - path_mismatch: parent extracted from name path ≠ stored parent
 *  - duplicate_person_id
 *  - spouses_without_husband
 *  - broken_relation: union of structural failures (no healthy father link)
 */
(function (global) {
  "use strict";

  var CAT = {
    PARENT_NULL: "parent_null",
    PARENT_EMPTY: "parent_empty",
    MISSING_FATHER: "missing_father",
    PATH_MISMATCH: "path_mismatch",
    DUPLICATE_PERSON_ID: "duplicate_person_id",
    SPOUSES_WITHOUT_HUSBAND: "spouses_without_husband",
    BROKEN_RELATION: "broken_relation",
  };

  var CAT_AR = {
    parent_null: "parent = NULL",
    parent_empty: "parent فارغ",
    missing_father: "الأب غير موجود",
    path_mismatch: "عدم تطابق المسار مع parent",
    duplicate_person_id: "person_id مكرر",
    spouses_without_husband: "زوجات بلا زوج صالح",
    broken_relation: "أبناء بدون أب صالح",
  };

  /** Impact hints shown in Health Center (product language). */
  var CAT_IMPACT = {
    parent_null: [
      "لا يظهر ضمن أبناء الأب",
      "لا يظهر في البحث",
      "يسمح بطلبات مكررة",
    ],
    parent_empty: [
      "لا يظهر ضمن أبناء الأب",
      "لا يظهر في البحث",
      "يؤثر على Workflow",
    ],
    missing_father: [
      "لا يظهر ضمن أبناء الأب",
      "يؤثر على Workflow",
      "يسمح بطلبات مكررة",
    ],
    path_mismatch: [
      "لا يظهر ضمن أبناء الأب",
      "لا يظهر في البحث",
      "يؤثر على Workflow",
    ],
    duplicate_person_id: ["يسمح بطلبات مكررة", "يحتاج ربط UUID", "يؤثر على Workflow"],
    spouses_without_husband: ["يؤثر على Workflow", "لا يظهر في البحث"],
    broken_relation: [
      "لا يظهر ضمن أبناء الأب",
      "لا يظهر في البحث",
      "يؤثر على Workflow",
    ],
  };

  /** Priority: manager sees what to fix first. */
  var PRIORITY = {
    CRITICAL: "critical",
    HIGH: "high",
    MEDIUM: "medium",
    HEALTHY: "healthy",
  };

  var PRIORITY_AR = {
    critical: "🔴 حرج",
    high: "🟠 مرتفع",
    medium: "🟡 متوسط",
    healthy: "🟢 سليم",
  };

  var CAT_PRIORITY = {
    parent_null: PRIORITY.CRITICAL,
    parent_empty: PRIORITY.CRITICAL,
    missing_father: PRIORITY.CRITICAL,
    path_mismatch: PRIORITY.HIGH,
    broken_relation: PRIORITY.HIGH,
    duplicate_person_id: PRIORITY.MEDIUM,
    spouses_without_husband: PRIORITY.MEDIUM,
  };

  /** Root-cause templates (fix the source, not only the symptom). */
  var CAT_ROOT_CAUSE = {
    parent_null:
      "أُنشئ بلا parent، أو انجراف ثنائي الأعمدة (parent_name موجود و parent فارغ) من استيراد/مندوب/صيانة legacy.",
    parent_empty:
      "صف بلا أب نصّي — غالبًا استيراد ناقص أو أداة صيانة أو مسار كتابة تجاوز الحارس.",
    missing_father:
      "قيمة أب لا تطابق صفًا حيًا: خطأ إملائي / متغيرات كتابة / أب لم يُستورد / اعتماد طلب بلا أب صالح.",
    path_mismatch:
      "تعديل المسار (name) دون مزامنة parent، أو استيراد جزئي، أو صيانة يدوية.",
    duplicate_person_id: "دمج/استيراد مكرر أو نسخ صفوف — يحتاج ربط UUID لا إعادة تسمية.",
    spouses_without_husband: "زوجة رُبطت بزوج غير موجود أو UUID مكسور.",
    broken_relation: "فشل هيكلي مركّب — راجع الفئة الأساسية للصف.",
  };

  var CAT_WRITE_PATH = {
    parent_null:
      "مسار الكتابة المشتبه: مندوب · إدارة شجرة · استيراد CSV/بطاقة · صيانة SQL — أصلح المصدر عبر Tree Engine (رفض parent=NULL).",
    parent_empty:
      "Validation + Tree Engine يجب أن يرفضا الكتابة بلا أب؛ الصفوف القديمة = إصلاح staged.",
    missing_father:
      "طلب مندوب / Workflow اعتماد / استيراد — ارفض عند غياب الأب في الشجرة.",
    path_mismatch:
      "أي مسار يحدّث name دون parent (مندوب/إدارة/استيراد) — وحّد عبر Tree Engine.prepareChildWriteRow.",
    duplicate_person_id: "استيراد/دمج — Canonical Person + Tree Engine sole writer.",
    spouses_without_husband: "مسار ربط الزوجات (إدارة/مندوب) — حل الزوج بـ person_id.",
    broken_relation: "نفس مسارات سلامة البيانات أعلاه.",
  };

  var GROUP_DATA_INTEGRITY = "data_integrity";
  var GROUP_UUID_LINK = "uuid_link";

  function norm(v) {
    return String(v == null ? "" : v)
      .replace(/\s+/g, " ")
      .trim();
  }

  function childPath(row) {
    return norm((row && (row.child_name || row.name)) || "");
  }

  function parentColumn(row) {
    return norm((row && row.parent) || "");
  }

  function parentNameColumn(row) {
    return norm((row && row.parent_name) || "");
  }

  /** Stored parent used by most queries: parent_name preferred, then parent. */
  function storedParent(row) {
    return parentNameColumn(row) || parentColumn(row);
  }

  function branchRootName(branchKey) {
    var k = norm(branchKey);
    if (!k) return "";
    return k + " بن مطلق بن زيدان";
  }

  function isBranchRootParent(parent, branchKey) {
    var p = norm(parent);
    var b = norm(branchKey);
    if (!p || !b) return false;
    return p === b || p === branchRootName(b);
  }

  /** Derive parent path by stripping the last segment of name/child_name. */
  function extractParentFromName(path) {
    var p = norm(path);
    if (!p || p.indexOf("/") < 0) return "";
    var parts = p.split("/").map(norm).filter(Boolean);
    if (parts.length < 2) return "";
    return parts.slice(0, -1).join("/");
  }

  function buildNameIndex(children) {
    var byBranchPath = new Set();
    var byBranchLeaf = new Map();
    var personIdMap = new Map();
    (children || []).forEach(function (c) {
      if (!c) return;
      var branch = norm(c.branch_key);
      var path = childPath(c);
      if (branch && path) {
        byBranchPath.add(branch + "||" + path);
        var leaf = path.indexOf("/") >= 0 ? path.slice(path.lastIndexOf("/") + 1) : path;
        var leafKey = branch + "||" + leaf;
        if (!byBranchLeaf.has(leafKey)) byBranchLeaf.set(leafKey, []);
        byBranchLeaf.get(leafKey).push(c);
      }
      if (c.person_id) {
        var pid = String(c.person_id);
        if (!personIdMap.has(pid)) personIdMap.set(pid, []);
        personIdMap.get(pid).push(c);
      }
    });
    return {
      byBranchPath: byBranchPath,
      byBranchLeaf: byBranchLeaf,
      personIdMap: personIdMap,
    };
  }

  function fatherExists(index, branch, parentPath) {
    var p = norm(parentPath);
    var b = norm(branch);
    if (!p || !b) return false;
    if (isBranchRootParent(p, b)) return true;
    if (index.byBranchPath.has(b + "||" + p)) return true;
    // Leaf-only parent string: unique leaf hit in branch counts as found
    if (p.indexOf("/") < 0) {
      var hits = index.byBranchLeaf.get(b + "||" + p) || [];
      return hits.length === 1;
    }
    return false;
  }

  function impactFor(category) {
    return (CAT_IMPACT[category] || []).slice();
  }

  function impactLabel(category) {
    return impactFor(category).join(" · ");
  }

  function priorityFor(category) {
    return CAT_PRIORITY[category] || PRIORITY.MEDIUM;
  }

  function priorityLabel(category) {
    return PRIORITY_AR[priorityFor(category)] || PRIORITY_AR.medium;
  }

  function rootCauseFor(category) {
    return CAT_ROOT_CAUSE[category] || "سبب غير مصنّف — راجع الصف يدويًا.";
  }

  function writePathFor(category) {
    return CAT_WRITE_PATH[category] || "مسار كتابة غير موثّق.";
  }

  function issueRow(row, category, extra) {
    var path = childPath(row);
    var extracted = extractParentFromName(path);
    var pri = priorityFor(category);
    return Object.assign(
      {
        id: row.id,
        branch_key: norm(row.branch_key),
        child_path: path,
        parent: parentColumn(row) || null,
        parent_name: parentNameColumn(row) || null,
        stored_parent: storedParent(row) || null,
        extracted_parent: extracted || null,
        person_id: row.person_id || null,
        parent_person_id: row.parent_person_id || null,
        created_at: row.created_at || null,
        updated_at: row.updated_at || null,
        category: category,
        category_ar: CAT_AR[category] || category,
        group: GROUP_DATA_INTEGRITY,
        group_ar: "سلامة البيانات",
        severity: "error",
        priority: pri,
        priority_ar: PRIORITY_AR[pri] || pri,
        impact: impactFor(category),
        impact_ar: impactLabel(category),
        root_cause_ar: rootCauseFor(category),
        write_path_ar: writePathFor(category),
        code: "TREE-STRUCT",
      },
      extra || {},
    );
  }

  /**
   * @param {object[]} children tree_children rows
   * @param {object[]} [spouses] tree_spouses rows
   * @returns {object} audit report (read-only)
   */
  function auditTreeStructure(children, spouses) {
    var rows = Array.isArray(children) ? children : [];
    var index = buildNameIndex(rows);
    var parentNull = [];
    var parentEmpty = [];
    var missingFather = [];
    var pathMismatch = [];
    var brokenRelation = [];
    var healthy = 0;
    var seenBroken = new Set();

    function markBroken(issue) {
      var key = String(issue.id) + "|" + issue.category;
      if (seenBroken.has(key)) return;
      seenBroken.add(key);
      brokenRelation.push(issue);
    }

    rows.forEach(function (c) {
      if (!c) return;
      var branch = norm(c.branch_key);
      var path = childPath(c);
      var pCol = parentColumn(c);
      var pName = parentNameColumn(c);
      var stored = storedParent(c);
      var extracted = extractParentFromName(path);
      var isRoot = isBranchRootParent(stored, branch) || isBranchRootParent(extracted, branch);

      var colNull = !pCol;
      var bothEmpty = !pCol && !pName;

      if (colNull && !isRoot) {
        parentNull.push(
          issueRow(c, CAT.PARENT_NULL, {
            reason_ar: "عمود parent فارغ بينما الاسم/المسار موجود",
          }),
        );
      }
      if (bothEmpty && path && !isRoot) {
        parentEmpty.push(
          issueRow(c, CAT.PARENT_EMPTY, {
            reason_ar: "parent و parent_name فارغان",
          }),
        );
      }

      // Path-derived parent vs stored parent (and vs parent column)
      if (extracted) {
        var compareTarget = stored || "";
        var colMismatch = !pCol || pCol !== extracted;
        var storedMismatch = !compareTarget || compareTarget !== extracted;
        // Also flag when parent_name matches extracted but parent column does not
        if (colMismatch || storedMismatch) {
          // Root with empty parent column but extracted is root path is still drift if parent col null
          if (!(isRoot && !colNull && compareTarget === extracted)) {
            if (colMismatch || (stored && stored !== extracted) || (!stored && extracted)) {
              pathMismatch.push(
                issueRow(c, CAT.PATH_MISMATCH, {
                  reason_ar:
                    "المستخرج من الاسم: «" +
                    extracted +
                    "» ≠ parent: «" +
                    (pCol || "NULL") +
                    "» / parent_name: «" +
                    (pName || "NULL") +
                    "»",
                }),
              );
            }
          }
        }
      }

      // Missing father: has a parent string but no person row with that name
      if (stored && !isRoot && !fatherExists(index, branch, stored)) {
        missingFather.push(
          issueRow(c, CAT.MISSING_FATHER, {
            reason_ar:
              "الأب «" + stored + "» غير موجود في tree_children.name لنفس الفرع",
          }),
        );
      }

      var structurallyOk =
        !bothEmpty &&
        (isRoot ||
          (stored &&
            fatherExists(index, branch, stored) &&
            (!extracted || extracted === stored || extracted === pName)));
      // Dual-column: parent col should match when path has parent
      if (extracted && colNull) structurallyOk = false;
      if (stored && !isRoot && !fatherExists(index, branch, stored)) {
        structurallyOk = false;
      }

      if (structurallyOk) {
        healthy += 1;
      } else if (!isRoot || colNull || bothEmpty) {
        var primary =
          bothEmpty
            ? CAT.PARENT_EMPTY
            : !stored || (stored && !fatherExists(index, branch, stored))
              ? CAT.MISSING_FATHER
              : colNull
                ? CAT.PARENT_NULL
                : CAT.PATH_MISMATCH;
        markBroken(
          issueRow(c, primary, {
            reason_ar: CAT_AR[primary] || primary,
          }),
        );
      }
    });

    var duplicatePersonId = [];
    index.personIdMap.forEach(function (list, pid) {
      if (list.length < 2) return;
      list.forEach(function (c) {
        duplicatePersonId.push(
          issueRow(c, CAT.DUPLICATE_PERSON_ID, {
            reason_ar: "person_id مكرر (" + list.length + " صفوف): " + pid,
            duplicate_count: list.length,
          }),
        );
      });
    });

    var spousesBad = [];
    var byId = new Map();
    rows.forEach(function (c) {
      if (c && c.id != null) byId.set(Number(c.id), c);
    });
    var personIds = index.personIdMap;
    (spouses || []).forEach(function (s) {
      if (!s) return;
      var hid = s.husband_id != null ? Number(s.husband_id) : 0;
      var hpid = s.husband_person_id ? String(s.husband_person_id) : "";
      var ok =
        (hid && byId.has(hid)) || (hpid && personIds.has(hpid));
      if (!ok) {
        spousesBad.push({
          id: s.id,
          branch_key: norm(s.branch_key),
          child_path: "",
          parent: null,
          parent_name: null,
          stored_parent: null,
          extracted_parent: null,
          person_id: hpid || null,
          wife_name: s.wife_name || "",
          husband_id: hid || null,
          category: CAT.SPOUSES_WITHOUT_HUSBAND,
          category_ar: CAT_AR.spouses_without_husband,
          group: GROUP_UUID_LINK,
          group_ar: "الربط الداخلي",
          severity: "warning",
          priority: PRIORITY.MEDIUM,
          priority_ar: PRIORITY_AR.medium,
          impact: impactFor(CAT.SPOUSES_WITHOUT_HUSBAND),
          impact_ar: impactLabel(CAT.SPOUSES_WITHOUT_HUSBAND),
          root_cause_ar: rootCauseFor(CAT.SPOUSES_WITHOUT_HUSBAND),
          write_path_ar: writePathFor(CAT.SPOUSES_WITHOUT_HUSBAND),
          code: "TREE-STRUCT",
          reason_ar: "زوجة بلا زوج صالح في الشجرة: " + norm(s.wife_name),
        });
      }
    });

    var lists = {};
    lists[CAT.PARENT_NULL] = parentNull;
    lists[CAT.PARENT_EMPTY] = parentEmpty;
    lists[CAT.MISSING_FATHER] = missingFather;
    lists[CAT.PATH_MISMATCH] = pathMismatch;
    lists[CAT.DUPLICATE_PERSON_ID] = duplicatePersonId;
    lists[CAT.SPOUSES_WITHOUT_HUSBAND] = spousesBad;
    lists[CAT.BROKEN_RELATION] = brokenRelation;

    var criticalCount =
      parentNull.length + parentEmpty.length + missingFather.length;
    var highCount = pathMismatch.length;
    // broken_relation overlaps — counted in high "needs review" separately via path
    var needsReview = highCount + brokenRelation.length;

    return {
      mode: "read_only",
      schema: "tree_structure_audit_v2",
      totals: {
        tree_children: rows.length,
        healthy_relations: healthy,
        parent_null: parentNull.length,
        parent_empty: parentEmpty.length,
        missing_father: missingFather.length,
        path_mismatch: pathMismatch.length,
        duplicate_person_id: duplicatePersonId.length,
        spouses_without_husband: spousesBad.length,
        broken_relation: brokenRelation.length,
        priority_critical: criticalCount,
        priority_high: needsReview,
        priority_medium: duplicatePersonId.length + spousesBad.length,
      },
      summary_card: {
        critical: criticalCount,
        needs_review: needsReview,
        uuid_link_needed: duplicatePersonId.length + spousesBad.length,
        healthy: healthy,
        labels: {
          critical: "🔴 حرج (parent=NULL · أب مفقود)",
          needs_review: "🟠 يحتاج مراجعة (مسار/علاقة)",
          uuid_link_needed: "🟡 يحتاج ربط UUID",
          healthy: "🟢 علاقات سليمة",
        },
        note_ar:
          "أولوية الإصلاح للمدير: حرج → مراجعة → UUID. بلا «إصلاح الكل».",
      },
      groups: {
        data_integrity: {
          id: GROUP_DATA_INTEGRITY,
          label: "🔴 سلامة البيانات",
          label_short: "سلامة البيانات",
          severity: "error",
          categories: [
            CAT.PARENT_NULL,
            CAT.MISSING_FATHER,
            CAT.PATH_MISMATCH,
            CAT.PARENT_EMPTY,
            CAT.BROKEN_RELATION,
          ],
        },
        uuid_link: {
          id: GROUP_UUID_LINK,
          label: "🟡 الربط الداخلي (UUID)",
          label_short: "الربط الداخلي",
          severity: "warning",
          note_ar:
            "TREE-003 / يحتاج ربط UUID — ليس تافهًا؛ يمنع الاعتماد الآمن ويؤثر على Workflow.",
        },
      },
      categories: [
        {
          id: "total",
          label: "إجمالي الأشخاص",
          count: rows.length,
          ok: true,
          group: "summary",
        },
        {
          id: "healthy_relations",
          label: "🟢 علاقات صحيحة",
          count: healthy,
          ok: true,
          group: "summary",
          priority: PRIORITY.HEALTHY,
        },
        {
          id: CAT.PARENT_NULL,
          label: "🔴 " + CAT_AR.parent_null,
          count: parentNull.length,
          ok: parentNull.length === 0,
          group: GROUP_DATA_INTEGRITY,
          group_ar: "سلامة البيانات",
          priority: CAT_PRIORITY.parent_null,
          priority_ar: PRIORITY_AR.critical,
          impact_ar: impactLabel(CAT.PARENT_NULL),
          root_cause_ar: rootCauseFor(CAT.PARENT_NULL),
        },
        {
          id: CAT.MISSING_FATHER,
          label: "🔴 " + CAT_AR.missing_father,
          count: missingFather.length,
          ok: missingFather.length === 0,
          group: GROUP_DATA_INTEGRITY,
          group_ar: "سلامة البيانات",
          priority: CAT_PRIORITY.missing_father,
          priority_ar: PRIORITY_AR.critical,
          impact_ar: impactLabel(CAT.MISSING_FATHER),
          root_cause_ar: rootCauseFor(CAT.MISSING_FATHER),
        },
        {
          id: CAT.PATH_MISMATCH,
          label: "🟠 " + CAT_AR.path_mismatch,
          count: pathMismatch.length,
          ok: pathMismatch.length === 0,
          group: GROUP_DATA_INTEGRITY,
          group_ar: "سلامة البيانات",
          priority: CAT_PRIORITY.path_mismatch,
          priority_ar: PRIORITY_AR.high,
          impact_ar: impactLabel(CAT.PATH_MISMATCH),
          root_cause_ar: rootCauseFor(CAT.PATH_MISMATCH),
        },
        {
          id: CAT.PARENT_EMPTY,
          label: "🔴 " + CAT_AR.parent_empty,
          count: parentEmpty.length,
          ok: parentEmpty.length === 0,
          group: GROUP_DATA_INTEGRITY,
          group_ar: "سلامة البيانات",
          priority: CAT_PRIORITY.parent_empty,
          priority_ar: PRIORITY_AR.critical,
          impact_ar: impactLabel(CAT.PARENT_EMPTY),
          root_cause_ar: rootCauseFor(CAT.PARENT_EMPTY),
        },
        {
          id: CAT.DUPLICATE_PERSON_ID,
          label: "🟡 " + CAT_AR.duplicate_person_id,
          count: duplicatePersonId.length,
          ok: duplicatePersonId.length === 0,
          group: GROUP_UUID_LINK,
          group_ar: "الربط الداخلي",
          priority: CAT_PRIORITY.duplicate_person_id,
          priority_ar: PRIORITY_AR.medium,
          impact_ar: impactLabel(CAT.DUPLICATE_PERSON_ID),
          root_cause_ar: rootCauseFor(CAT.DUPLICATE_PERSON_ID),
        },
        {
          id: CAT.BROKEN_RELATION,
          label: "🟠 " + CAT_AR.broken_relation,
          count: brokenRelation.length,
          ok: brokenRelation.length === 0,
          group: GROUP_DATA_INTEGRITY,
          group_ar: "سلامة البيانات",
          priority: CAT_PRIORITY.broken_relation,
          priority_ar: PRIORITY_AR.high,
          impact_ar: impactLabel(CAT.BROKEN_RELATION),
          root_cause_ar: rootCauseFor(CAT.BROKEN_RELATION),
        },
        {
          id: CAT.SPOUSES_WITHOUT_HUSBAND,
          label: "🟡 " + CAT_AR.spouses_without_husband,
          count: spousesBad.length,
          ok: spousesBad.length === 0,
          group: GROUP_UUID_LINK,
          group_ar: "الربط الداخلي",
          priority: CAT_PRIORITY.spouses_without_husband,
          priority_ar: PRIORITY_AR.medium,
          impact_ar: impactLabel(CAT.SPOUSES_WITHOUT_HUSBAND),
          root_cause_ar: rootCauseFor(CAT.SPOUSES_WITHOUT_HUSBAND),
        },
      ],
      lists: lists,
    };
  }

  var api = {
    CAT: CAT,
    CAT_AR: CAT_AR,
    CAT_IMPACT: CAT_IMPACT,
    PRIORITY: PRIORITY,
    PRIORITY_AR: PRIORITY_AR,
    CAT_PRIORITY: CAT_PRIORITY,
    CAT_ROOT_CAUSE: CAT_ROOT_CAUSE,
    CAT_WRITE_PATH: CAT_WRITE_PATH,
    GROUP_DATA_INTEGRITY: GROUP_DATA_INTEGRITY,
    GROUP_UUID_LINK: GROUP_UUID_LINK,
    extractParentFromName: extractParentFromName,
    storedParent: storedParent,
    impactFor: impactFor,
    impactLabel: impactLabel,
    priorityFor: priorityFor,
    rootCauseFor: rootCauseFor,
    writePathFor: writePathFor,
    auditTreeStructure: auditTreeStructure,
  };

  global.AlzidanIntegrityTreeStructure = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
