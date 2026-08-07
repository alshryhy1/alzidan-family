/**
 * Integrity v2 — TREE-003 classification (browser IIFE).
 * Keep in sync with scripts/lib/integrity-tree003-v2.mjs
 */
(function (global) {
  "use strict";

  var REASON = {
    ROOT_PARENT: "root_parent",
    IN_TREE_PARENTS: "in_tree_parents",
    MISSING_UUID: "missing_uuid",
    BROKEN_PARENT_UUID: "broken_parent_uuid",
  };

  var REASON_AR = {
    root_parent: "أصل الفرع (Root Parent)",
    in_tree_parents: "موجود في tree_parents",
    missing_uuid: "يحتاج ربط UUID فقط",
    broken_parent_uuid: "أب UUID مكسور",
  };

  function childPath(row) {
    return String((row && (row.child_name || row.name)) || "");
  }

  function parentKey(row) {
    return String((row && (row.parent_name || row.parent)) || "");
  }

  function branchRootName(branchKey) {
    var k = String(branchKey || "").trim();
    if (!k) return "";
    return k + " بن مطلق بن زيدان";
  }

  function isBranchRootParent(parent, branchKey) {
    var p = String(parent || "").trim();
    var b = String(branchKey || "").trim();
    if (!p || !b) return false;
    return p === b || p === branchRootName(b);
  }

  function buildParentIndex(children, parents) {
    var personIds = new Set();
    var paths = new Set();
    var treeParentNames = new Set();
    (children || []).forEach(function (c) {
      if (!c) return;
      var branch = String(c.branch_key || "");
      if (c.person_id) personIds.add(String(c.person_id));
      var path = childPath(c);
      if (branch && path) paths.add(branch + "||" + path);
    });
    (parents || []).forEach(function (p) {
      if (!p) return;
      var branch = String(p.branch_key || "");
      var name = String(p.name || "").trim();
      if (branch && name) {
        treeParentNames.add(branch + "||" + name);
        paths.add(branch + "||" + name);
      }
    });
    return { personIds: personIds, paths: paths, treeParentNames: treeParentNames };
  }

  function classifyChild(row, index) {
    var branch = String((row && row.branch_key) || "");
    var path = childPath(row);
    var parent = parentKey(row);
    var parentPathKey = branch && parent ? branch + "||" + parent : "";
    var inTreeParents =
      !!parentPathKey && index.treeParentNames.has(parentPathKey);
    var pathFound = !!parentPathKey && index.paths.has(parentPathKey);
    var isRoot = isBranchRootParent(parent, branch);
    var pid = row && row.parent_person_id ? String(row.parent_person_id) : "";
    var uuidOk = pid ? index.personIds.has(pid) : false;
    var base = {
      id: row.id,
      branch_key: branch,
      child_path: path,
      parent_key: parent,
      parent_person_id: pid || null,
      person_id: row.person_id || null,
    };

    if (isRoot || inTreeParents) {
      var reason = isRoot ? REASON.ROOT_PARENT : REASON.IN_TREE_PARENTS;
      return {
        id: base.id,
        branch_key: base.branch_key,
        child_path: base.child_path,
        parent_key: base.parent_key,
        parent_person_id: base.parent_person_id,
        person_id: base.person_id,
        severity: "healthy",
        code: null,
        issue: reason,
        reason: reason,
        reason_ar: REASON_AR[reason],
      };
    }

    if (pid && uuidOk) {
      return {
        id: base.id,
        branch_key: base.branch_key,
        child_path: base.child_path,
        parent_key: base.parent_key,
        parent_person_id: base.parent_person_id,
        person_id: base.person_id,
        severity: "ok",
        code: null,
        issue: null,
        reason: null,
        reason_ar: null,
      };
    }

    if (!pid && pathFound) {
      return Object.assign({}, base, {
        severity: "warning",
        code: "TREE-003-warn",
        issue: "needs_uuid_link",
        reason: REASON.MISSING_UUID,
        reason_ar: REASON_AR.missing_uuid,
      });
    }

    if (pid && !uuidOk && pathFound) {
      return Object.assign({}, base, {
        severity: "warning",
        code: "TREE-003-warn",
        issue: "needs_uuid_relink",
        reason: REASON.MISSING_UUID,
        reason_ar: REASON_AR.missing_uuid,
      });
    }

    if (pid && !uuidOk && !pathFound && !inTreeParents) {
      return Object.assign({}, base, {
        severity: "error",
        code: "TREE-003",
        issue: "broken_parent_person_id",
        reason: REASON.BROKEN_PARENT_UUID,
        reason_ar: REASON_AR.broken_parent_uuid,
      });
    }

    if (!pid) {
      return Object.assign({}, base, {
        severity: "warning",
        code: "TREE-003-warn",
        issue: "missing_parent_person_id",
        reason: REASON.MISSING_UUID,
        reason_ar: REASON_AR.missing_uuid,
      });
    }

    return Object.assign({}, base, {
      severity: "ok",
      code: null,
      issue: null,
      reason: null,
      reason_ar: null,
    });
  }

  function classifyAll(children, parents) {
    var index = buildParentIndex(children, parents);
    var healthy = [];
    var warnings = [];
    var errors = [];
    (children || []).forEach(function (row) {
      var c = classifyChild(row, index);
      if (c.severity === "healthy") healthy.push(c);
      else if (c.severity === "warning") warnings.push(c);
      else if (c.severity === "error") errors.push(c);
    });
    return { index: index, healthy: healthy, warnings: warnings, errors: errors };
  }

  global.AlzidanIntegrityTree003V2 = {
    REASON: REASON,
    REASON_AR: REASON_AR,
    childPath: childPath,
    parentKey: parentKey,
    branchRootName: branchRootName,
    isBranchRootParent: isBranchRootParent,
    buildParentIndex: buildParentIndex,
    classifyChild: classifyChild,
    classifyAll: classifyAll,
  };
})(typeof window !== "undefined" ? window : globalThis);
