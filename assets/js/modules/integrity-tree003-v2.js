/**
 * Integrity v2 — TREE-003 classification (browser IIFE).
 * Keep in sync with scripts/lib/integrity-tree003-v2.mjs
 *
 * 🟢 healthy / ok: root, tree_parents, or valid parent_person_id
 * 🟡 needs UUID link: living father resolved by path/sequence WITH person_id,
 *    but child parent_person_id missing or broken
 * 🟠 review «الأب غير موجود»: no living father (not a UUID-link repair)
 * 🔴 broken UUID + father absent from indexes
 *
 * Text-only parent difference alone is NOT enough for red/repair when UUID
 * already points at a living father (see integrity-tree-structure-audit).
 */
(function (global) {
  "use strict";

  var REASON = {
    ROOT_PARENT: "root_parent",
    IN_TREE_PARENTS: "in_tree_parents",
    MISSING_UUID: "missing_uuid",
    BROKEN_PARENT_UUID: "broken_parent_uuid",
    MISSING_FATHER: "missing_father",
    AMBIGUOUS_FATHER: "ambiguous_father",
  };

  var REASON_AR = {
    root_parent: "أصل الفرع (Root Parent)",
    in_tree_parents: "موجود في tree_parents",
    missing_uuid: "يحتاج ربط UUID",
    broken_parent_uuid: "أب UUID مكسور",
    missing_father: "الأب غير موجود",
    ambiguous_father: "أب غامض — عدة مرشّحين",
  };

  function norm(v) {
    return String(v == null ? "" : v)
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeArabicDigitsLocal(v) {
    return String(v == null ? "" : v)
      .replace(/[٠-٩]/g, function (d) {
        return String(d.charCodeAt(0) - 1632);
      })
      .replace(/[۰-۹]/g, function (d) {
        return String(d.charCodeAt(0) - 1776);
      });
  }

  function normalizeArabicForCompare(value) {
    var Struct = global.AlzidanIntegrityTreeStructure;
    if (Struct && typeof Struct.normalizeArabicForCompare === "function") {
      return Struct.normalizeArabicForCompare(value);
    }
    var s = normalizeArabicDigitsLocal(value);
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

  function childPath(row) {
    return norm((row && (row.child_name || row.name)) || "");
  }

  function parentKey(row) {
    return norm((row && (row.parent_name || row.parent)) || "");
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

  function buildParentIndex(children, parents) {
    var personIds = new Set();
    var paths = new Set();
    var treeParentNames = new Set();
    var byBranchPathNorm = new Map();
    var byBranchLeaf = new Map();
    var byBranchLeafNorm = new Map();
    var personIdMap = new Map();
    (children || []).forEach(function (c) {
      if (!c) return;
      var branch = norm(c.branch_key);
      if (c.person_id) {
        var pid = String(c.person_id);
        personIds.add(pid);
        if (!personIdMap.has(pid)) personIdMap.set(pid, []);
        personIdMap.get(pid).push(c);
      }
      var path = childPath(c);
      if (branch && path) {
        paths.add(branch + "||" + path);
        var pathNormKey = branch + "||" + normalizeArabicForCompare(path);
        if (!byBranchPathNorm.has(pathNormKey)) byBranchPathNorm.set(pathNormKey, []);
        byBranchPathNorm.get(pathNormKey).push(c);
        var leaf = path.indexOf("/") >= 0 ? path.slice(path.lastIndexOf("/") + 1) : path;
        var leafKey = branch + "||" + leaf;
        if (!byBranchLeaf.has(leafKey)) byBranchLeaf.set(leafKey, []);
        byBranchLeaf.get(leafKey).push(c);
        var leafNormKey = branch + "||" + normalizeArabicForCompare(leaf);
        if (!byBranchLeafNorm.has(leafNormKey)) byBranchLeafNorm.set(leafNormKey, []);
        byBranchLeafNorm.get(leafNormKey).push(c);
      }
    });
    (parents || []).forEach(function (p) {
      if (!p) return;
      var branch = norm(p.branch_key);
      var name = norm(p.name);
      if (branch && name) {
        treeParentNames.add(branch + "||" + name);
        paths.add(branch + "||" + name);
      }
    });
    return {
      personIds: personIds,
      paths: paths,
      treeParentNames: treeParentNames,
      byBranchPathNorm: byBranchPathNorm,
      byBranchLeaf: byBranchLeaf,
      byBranchLeafNorm: byBranchLeafNorm,
      personIdMap: personIdMap,
      children: children || [],
    };
  }

  /** Local resolve mirroring Structure.resolveFatherRow (unique path / unique leaf only). */
  function resolveFatherLocal(index, branch, parentPath) {
    var Struct = global.AlzidanIntegrityTreeStructure;
    if (Struct && typeof Struct.resolveFatherRow === "function") {
      var sIndex =
        typeof Struct.buildNameIndex === "function"
          ? Struct.buildNameIndex(index.children || [])
          : null;
      if (sIndex) return Struct.resolveFatherRow(sIndex, branch, parentPath);
    }
    var p = norm(parentPath);
    var b = norm(branch);
    if (!p || !b || !index) return null;
    if (isBranchRootParent(p, b)) return null;
    var normHits = index.byBranchPathNorm.get(b + "||" + normalizeArabicForCompare(p)) || [];
    var exact = normHits.filter(function (c) {
      return childPath(c) === p;
    });
    if (exact.length === 1) return exact[0];
    if (normHits.length === 1) return normHits[0];
    if (p.indexOf("/") < 0) {
      var leafHits = index.byBranchLeaf.get(b + "||" + p) || [];
      if (leafHits.length === 1) return leafHits[0];
      var leafNormHits =
        index.byBranchLeafNorm.get(b + "||" + normalizeArabicForCompare(p)) || [];
      if (leafNormHits.length === 1) return leafNormHits[0];
    }
    return null;
  }

  function isAmbiguousLeafLocal(index, branch, parentPath) {
    var Struct = global.AlzidanIntegrityTreeStructure;
    if (Struct && typeof Struct.isAmbiguousLeafFather === "function") {
      var sIndex =
        typeof Struct.buildNameIndex === "function"
          ? Struct.buildNameIndex(index.children || [])
          : null;
      if (sIndex) return Struct.isAmbiguousLeafFather(sIndex, branch, parentPath);
    }
    var p = norm(parentPath);
    var b = norm(branch);
    if (!p || !b || p.indexOf("/") >= 0) return false;
    if (isBranchRootParent(p, b)) return false;
    var leafHits = index.byBranchLeaf.get(b + "||" + p) || [];
    if (leafHits.length > 1) return true;
    var leafNormHits =
      index.byBranchLeafNorm.get(b + "||" + normalizeArabicForCompare(p)) || [];
    return leafNormHits.length > 1;
  }

  /**
   * Path + parent_person_id resolution for UUID diagnosis (all rows).
   * Prefer Struct.resolveExpectedFatherForUuidLink when available.
   */
  function resolveExpectedFather(row, index) {
    var Struct = global.AlzidanIntegrityTreeStructure;
    if (
      Struct &&
      typeof Struct.resolveExpectedFatherForUuidLink === "function"
    ) {
      return Struct.resolveExpectedFatherForUuidLink(row, index.children || []);
    }
    var Engine = global.AlzidanTreeEngine;
    if (
      Engine &&
      typeof Engine.resolveExpectedFatherForUuidLink === "function"
    ) {
      var viaEngine = Engine.resolveExpectedFatherForUuidLink(
        row,
        index.children || [],
      );
      // Engine without Structure returns method=unavailable — fall through locally.
      if (viaEngine && viaEngine.method !== "unavailable") {
        return viaEngine;
      }
    }

    var branch = norm(row && row.branch_key);
    var path = childPath(row);
    var stored = parentKey(row);
    var extracted = extractParentFromName(path);
    var pid = row && row.parent_person_id ? String(row.parent_person_id) : "";
    if (pid && index.personIdMap.has(pid)) {
      var list = index.personIdMap.get(pid) || [];
      if (list.length) {
        return {
          status: "linked",
          father: list[0],
          person_id: pid,
          expected_parent_path: childPath(list[0]),
          method: "parent_person_id",
        };
      }
    }

    function tryPath(candidate, method) {
      var c = norm(candidate);
      if (!c || isBranchRootParent(c, branch)) return null;
      if (isAmbiguousLeafLocal(index, branch, c)) {
        var amb =
          index.byBranchLeafNorm.get(branch + "||" + normalizeArabicForCompare(c)) ||
          index.byBranchLeaf.get(branch + "||" + c) ||
          [];
        return {
          status: "ambiguous",
          father: null,
          person_id: null,
          expected_parent_path: c,
          method: method,
          ambiguous_candidates: amb.length,
        };
      }
      var father = resolveFatherLocal(index, branch, c);
      if (!father) return null;
      var fpid = father.person_id ? String(father.person_id) : null;
      if (!fpid) {
        return {
          status: "missing",
          father: father,
          person_id: null,
          expected_parent_path: childPath(father) || c,
          method: method,
        };
      }
      return {
        status: "found",
        father: father,
        person_id: fpid,
        expected_parent_path: childPath(father),
        method: method,
      };
    }

    var fromExtract = extracted ? tryPath(extracted, "name_path_strip") : null;
    if (fromExtract && (fromExtract.status === "found" || fromExtract.status === "ambiguous")) {
      return fromExtract;
    }
    var fromStored = stored ? tryPath(stored, "stored_parent") : null;
    if (fromStored && (fromStored.status === "found" || fromStored.status === "ambiguous")) {
      return fromStored;
    }
    if (fromExtract && fromExtract.status === "missing") return fromExtract;
    if (fromStored && fromStored.status === "missing") return fromStored;
    return {
      status: "missing",
      father: null,
      person_id: null,
      expected_parent_path: extracted || stored || "",
      method: extracted ? "name_path_strip" : stored ? "stored_parent" : "none",
    };
  }

  function attachResolution(base, resolved) {
    var father = resolved && resolved.father;
    return Object.assign({}, base, {
      expected_father_path: (resolved && resolved.expected_parent_path) || null,
      expected_father_method: (resolved && resolved.method) || null,
      found_father_id: father && father.id != null ? father.id : null,
      found_father_path: father ? childPath(father) : null,
      father_person_id_to_link: (resolved && resolved.person_id) || null,
      resolution_status: (resolved && resolved.status) || null,
    });
  }

  function classifyChild(row, index) {
    var branch = norm((row && row.branch_key) || "");
    var path = childPath(row);
    var parent = parentKey(row);
    var parentPathKey = branch && parent ? branch + "||" + parent : "";
    var inTreeParents =
      !!parentPathKey && index.treeParentNames.has(parentPathKey);
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

    // Valid parent_person_id is primary — already linked (e.g. 1738–1740).
    // Text≠UUID is structure-audit path_mismatch review, not UUID-link / missing father.
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

    var resolved = resolveExpectedFather(row, index);
    var enriched = attachResolution(base, resolved);

    // Living father with known person_id → needs UUID link / relink (repairable)
    if (resolved.status === "found" && resolved.person_id) {
      var alreadySame = pid && pid === resolved.person_id;
      if (alreadySame) {
        return Object.assign({}, enriched, {
          severity: "ok",
          code: null,
          issue: null,
          reason: null,
          reason_ar: null,
        });
      }
      return Object.assign({}, enriched, {
        severity: "warning",
        code: "TREE-003-warn",
        issue: pid ? "needs_uuid_relink" : "needs_uuid_link",
        reason: REASON.MISSING_UUID,
        reason_ar: REASON_AR.missing_uuid,
      });
    }

    // Ambiguous leaf (multiple محمد) — review, no auto UUID repair
    if (resolved.status === "ambiguous") {
      return Object.assign({}, enriched, {
        severity: "review",
        code: "TREE-003-review",
        issue: "ambiguous_father",
        reason: REASON.AMBIGUOUS_FATHER,
        reason_ar: REASON_AR.ambiguous_father,
      });
    }

    // Broken UUID and no resolvable living father → real TREE-003 error
    if (pid && !uuidOk) {
      return Object.assign({}, enriched, {
        severity: "error",
        code: "TREE-003",
        issue: "broken_parent_person_id",
        reason: REASON.BROKEN_PARENT_UUID,
        reason_ar: REASON_AR.broken_parent_uuid,
      });
    }

    // No UUID and father truly missing → «الأب غير موجود» (not UUID-link bucket)
    return Object.assign({}, enriched, {
      severity: "review",
      code: "TREE-003-review",
      issue: "missing_father",
      reason: REASON.MISSING_FATHER,
      reason_ar: REASON_AR.missing_father,
    });
  }

  function classifyAll(children, parents) {
    var index = buildParentIndex(children, parents);
    var healthy = [];
    var warnings = [];
    var errors = [];
    var reviews = [];
    (children || []).forEach(function (row) {
      var c = classifyChild(row, index);
      if (c.severity === "healthy" || c.severity === "ok") {
        if (c.severity === "healthy") healthy.push(c);
      } else if (c.severity === "warning") warnings.push(c);
      else if (c.severity === "error") errors.push(c);
      else if (c.severity === "review") reviews.push(c);
    });
    return {
      index: index,
      healthy: healthy,
      warnings: warnings,
      errors: errors,
      reviews: reviews,
    };
  }

  global.AlzidanIntegrityTree003V2 = {
    REASON: REASON,
    REASON_AR: REASON_AR,
    childPath: childPath,
    parentKey: parentKey,
    branchRootName: branchRootName,
    isBranchRootParent: isBranchRootParent,
    buildParentIndex: buildParentIndex,
    resolveExpectedFather: resolveExpectedFather,
    classifyChild: classifyChild,
    classifyAll: classifyAll,
  };
})(typeof window !== "undefined" ? window : globalThis);
