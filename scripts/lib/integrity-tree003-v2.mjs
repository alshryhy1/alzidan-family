/**
 * Integrity v2 — TREE-003 classification (read-only).
 * Keep in sync with assets/js/modules/integrity-tree003-v2.js
 *
 * 🟢 healthy / ok: root, tree_parents, or valid parent_person_id
 * 🟡 needs UUID link: living father resolved by path/sequence WITH person_id
 * 🟠 review «الأب غير موجود»: no living father (not a UUID-link repair)
 * 🔴 broken UUID + father absent
 */

export const REASON = {
  ROOT_PARENT: "root_parent",
  IN_TREE_PARENTS: "in_tree_parents",
  MISSING_UUID: "missing_uuid",
  BROKEN_PARENT_UUID: "broken_parent_uuid",
  MISSING_FATHER: "missing_father",
  AMBIGUOUS_FATHER: "ambiguous_father",
};

export const REASON_AR = {
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
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776));
}

export function normalizeArabicForCompare(value) {
  let s = normalizeArabicDigitsLocal(value);
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

export function childPath(row) {
  return norm((row && (row.child_name || row.name)) || "");
}

export function parentKey(row) {
  return norm((row && (row.parent_name || row.parent)) || "");
}

export function branchRootName(branchKey) {
  const k = norm(branchKey);
  if (!k) return "";
  return k + " بن مطلق بن زيدان";
}

export function isBranchRootParent(parent, branchKey) {
  const p = norm(parent);
  const b = norm(branchKey);
  if (!p || !b) return false;
  return p === b || p === branchRootName(b);
}

export function extractParentFromName(path) {
  const p = norm(path);
  if (!p || p.indexOf("/") < 0) return "";
  const parts = p.split("/").map(norm).filter(Boolean);
  if (parts.length < 2) return "";
  return parts.slice(0, -1).join("/");
}

export function buildParentIndex(children, parents) {
  const personIds = new Set();
  const paths = new Set();
  const treeParentNames = new Set();
  const byBranchPathNorm = new Map();
  const byBranchLeaf = new Map();
  const byBranchLeafNorm = new Map();
  const personIdMap = new Map();

  for (const c of children || []) {
    if (!c) continue;
    const branch = norm(c.branch_key);
    if (c.person_id) {
      const pid = String(c.person_id);
      personIds.add(pid);
      if (!personIdMap.has(pid)) personIdMap.set(pid, []);
      personIdMap.get(pid).push(c);
    }
    const path = childPath(c);
    if (branch && path) {
      paths.add(branch + "||" + path);
      const pathNormKey = branch + "||" + normalizeArabicForCompare(path);
      if (!byBranchPathNorm.has(pathNormKey)) byBranchPathNorm.set(pathNormKey, []);
      byBranchPathNorm.get(pathNormKey).push(c);
      const leaf =
        path.indexOf("/") >= 0 ? path.slice(path.lastIndexOf("/") + 1) : path;
      const leafKey = branch + "||" + leaf;
      if (!byBranchLeaf.has(leafKey)) byBranchLeaf.set(leafKey, []);
      byBranchLeaf.get(leafKey).push(c);
      const leafNormKey = branch + "||" + normalizeArabicForCompare(leaf);
      if (!byBranchLeafNorm.has(leafNormKey)) byBranchLeafNorm.set(leafNormKey, []);
      byBranchLeafNorm.get(leafNormKey).push(c);
    }
  }

  for (const p of parents || []) {
    if (!p) continue;
    const branch = norm(p.branch_key);
    const name = norm(p.name);
    if (branch && name) {
      treeParentNames.add(branch + "||" + name);
      paths.add(branch + "||" + name);
    }
  }

  return {
    personIds,
    paths,
    treeParentNames,
    byBranchPathNorm,
    byBranchLeaf,
    byBranchLeafNorm,
    personIdMap,
    children: children || [],
  };
}

function resolveFatherLocal(index, branch, parentPath) {
  const p = norm(parentPath);
  const b = norm(branch);
  if (!p || !b || !index) return null;
  if (isBranchRootParent(p, b)) return null;
  const normHits =
    index.byBranchPathNorm.get(b + "||" + normalizeArabicForCompare(p)) || [];
  const exact = normHits.filter((c) => childPath(c) === p);
  if (exact.length === 1) return exact[0];
  if (normHits.length === 1) return normHits[0];
  if (p.indexOf("/") < 0) {
    const leafHits = index.byBranchLeaf.get(b + "||" + p) || [];
    if (leafHits.length === 1) return leafHits[0];
    const leafNormHits =
      index.byBranchLeafNorm.get(b + "||" + normalizeArabicForCompare(p)) || [];
    if (leafNormHits.length === 1) return leafNormHits[0];
  }
  return null;
}

function isAmbiguousLeafLocal(index, branch, parentPath) {
  const p = norm(parentPath);
  const b = norm(branch);
  if (!p || !b || p.indexOf("/") >= 0) return false;
  if (isBranchRootParent(p, b)) return false;
  const leafHits = index.byBranchLeaf.get(b + "||" + p) || [];
  if (leafHits.length > 1) return true;
  const leafNormHits =
    index.byBranchLeafNorm.get(b + "||" + normalizeArabicForCompare(p)) || [];
  return leafNormHits.length > 1;
}

export function resolveExpectedFather(row, index) {
  const branch = norm(row && row.branch_key);
  const path = childPath(row);
  const stored = parentKey(row);
  const extracted = extractParentFromName(path);
  const pid = row && row.parent_person_id ? String(row.parent_person_id) : "";
  if (pid && index.personIdMap.has(pid)) {
    const list = index.personIdMap.get(pid) || [];
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
    const c = norm(candidate);
    if (!c || isBranchRootParent(c, branch)) return null;
    if (isAmbiguousLeafLocal(index, branch, c)) {
      const amb =
        index.byBranchLeafNorm.get(branch + "||" + normalizeArabicForCompare(c)) ||
        index.byBranchLeaf.get(branch + "||" + c) ||
        [];
      return {
        status: "ambiguous",
        father: null,
        person_id: null,
        expected_parent_path: c,
        method,
        ambiguous_candidates: amb.length,
      };
    }
    const father = resolveFatherLocal(index, branch, c);
    if (!father) return null;
    const fpid = father.person_id ? String(father.person_id) : null;
    if (!fpid) {
      return {
        status: "missing",
        father,
        person_id: null,
        expected_parent_path: childPath(father) || c,
        method,
      };
    }
    return {
      status: "found",
      father,
      person_id: fpid,
      expected_parent_path: childPath(father),
      method,
    };
  }

  const fromExtract = extracted ? tryPath(extracted, "name_path_strip") : null;
  if (
    fromExtract &&
    (fromExtract.status === "found" || fromExtract.status === "ambiguous")
  ) {
    return fromExtract;
  }
  const fromStored = stored ? tryPath(stored, "stored_parent") : null;
  if (
    fromStored &&
    (fromStored.status === "found" || fromStored.status === "ambiguous")
  ) {
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
  const father = resolved && resolved.father;
  return {
    ...base,
    expected_father_path: (resolved && resolved.expected_parent_path) || null,
    expected_father_method: (resolved && resolved.method) || null,
    found_father_id: father && father.id != null ? father.id : null,
    found_father_path: father ? childPath(father) : null,
    father_person_id_to_link: (resolved && resolved.person_id) || null,
    resolution_status: (resolved && resolved.status) || null,
  };
}

export function classifyChild(row, index) {
  const branch = norm((row && row.branch_key) || "");
  const path = childPath(row);
  const parent = parentKey(row);
  const parentPathKey = branch && parent ? branch + "||" + parent : "";
  const inTreeParents =
    !!parentPathKey && index.treeParentNames.has(parentPathKey);
  const isRoot = isBranchRootParent(parent, branch);
  const pid = row && row.parent_person_id ? String(row.parent_person_id) : "";
  const uuidOk = pid ? index.personIds.has(pid) : false;
  const base = {
    id: row.id,
    branch_key: branch,
    child_path: path,
    parent_key: parent,
    parent_person_id: pid || null,
    person_id: row.person_id || null,
  };

  if (isRoot || inTreeParents) {
    const reason = isRoot ? REASON.ROOT_PARENT : REASON.IN_TREE_PARENTS;
    return {
      ...base,
      severity: "healthy",
      code: null,
      issue: reason,
      reason,
      reason_ar: REASON_AR[reason],
    };
  }

  if (pid && uuidOk) {
    return {
      ...base,
      severity: "ok",
      code: null,
      issue: null,
      reason: null,
      reason_ar: null,
    };
  }

  const resolved = resolveExpectedFather(row, index);
  const enriched = attachResolution(base, resolved);

  if (resolved.status === "found" && resolved.person_id) {
    if (pid && pid === resolved.person_id) {
      return {
        ...enriched,
        severity: "ok",
        code: null,
        issue: null,
        reason: null,
        reason_ar: null,
      };
    }
    return {
      ...enriched,
      severity: "warning",
      code: "TREE-003-warn",
      issue: pid ? "needs_uuid_relink" : "needs_uuid_link",
      reason: REASON.MISSING_UUID,
      reason_ar: REASON_AR.missing_uuid,
    };
  }

  if (resolved.status === "ambiguous") {
    return {
      ...enriched,
      severity: "review",
      code: "TREE-003-review",
      issue: "ambiguous_father",
      reason: REASON.AMBIGUOUS_FATHER,
      reason_ar: REASON_AR.ambiguous_father,
    };
  }

  if (pid && !uuidOk) {
    return {
      ...enriched,
      severity: "error",
      code: "TREE-003",
      issue: "broken_parent_person_id",
      reason: REASON.BROKEN_PARENT_UUID,
      reason_ar: REASON_AR.broken_parent_uuid,
    };
  }

  return {
    ...enriched,
    severity: "review",
    code: "TREE-003-review",
    issue: "missing_father",
    reason: REASON.MISSING_FATHER,
    reason_ar: REASON_AR.missing_father,
  };
}

export function classifyAll(children, parents) {
  const index = buildParentIndex(children, parents);
  const healthy = [];
  const warnings = [];
  const errors = [];
  const reviews = [];
  for (const row of children || []) {
    const c = classifyChild(row, index);
    if (c.severity === "healthy") healthy.push(c);
    else if (c.severity === "warning") warnings.push(c);
    else if (c.severity === "error") errors.push(c);
    else if (c.severity === "review") reviews.push(c);
  }
  return { index, healthy, warnings, errors, reviews };
}
