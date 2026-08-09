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

  function issueRow(row, category, extra) {
    var path = childPath(row);
    var extracted = extractParentFromName(path);
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
        category: category,
        category_ar: CAT_AR[category] || category,
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

    return {
      mode: "read_only",
      schema: "tree_structure_audit_v1",
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
      },
      categories: [
        {
          id: "total",
          label: "إجمالي الأشخاص",
          count: rows.length,
          ok: true,
        },
        {
          id: "healthy_relations",
          label: "علاقات صحيحة",
          count: healthy,
          ok: true,
        },
        {
          id: CAT.PARENT_NULL,
          label: CAT_AR.parent_null,
          count: parentNull.length,
          ok: parentNull.length === 0,
        },
        {
          id: CAT.MISSING_FATHER,
          label: CAT_AR.missing_father,
          count: missingFather.length,
          ok: missingFather.length === 0,
        },
        {
          id: CAT.PATH_MISMATCH,
          label: CAT_AR.path_mismatch,
          count: pathMismatch.length,
          ok: pathMismatch.length === 0,
        },
        {
          id: CAT.PARENT_EMPTY,
          label: CAT_AR.parent_empty,
          count: parentEmpty.length,
          ok: parentEmpty.length === 0,
        },
        {
          id: CAT.DUPLICATE_PERSON_ID,
          label: CAT_AR.duplicate_person_id,
          count: duplicatePersonId.length,
          ok: duplicatePersonId.length === 0,
        },
        {
          id: CAT.BROKEN_RELATION,
          label: CAT_AR.broken_relation,
          count: brokenRelation.length,
          ok: brokenRelation.length === 0,
        },
        {
          id: CAT.SPOUSES_WITHOUT_HUSBAND,
          label: CAT_AR.spouses_without_husband,
          count: spousesBad.length,
          ok: spousesBad.length === 0,
        },
      ],
      lists: lists,
    };
  }

  var api = {
    CAT: CAT,
    CAT_AR: CAT_AR,
    extractParentFromName: extractParentFromName,
    storedParent: storedParent,
    auditTreeStructure: auditTreeStructure,
  };

  global.AlzidanIntegrityTreeStructure = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
