/**
 * Integrity v2 — TREE-003 classification (read-only).
 *
 * 🟢 healthy: parent is branch Root OR exists in tree_parents
 * 🟡 warning: parent_person_id NULL (or broken UUID) but father findable by name/path
 * 🔴 error: parent_person_id points to missing UUID AND parent not in children/parents indexes
 */

export const REASON = {
  ROOT_PARENT: "root_parent",
  IN_TREE_PARENTS: "in_tree_parents",
  MISSING_UUID: "missing_uuid",
  BROKEN_PARENT_UUID: "broken_parent_uuid",
};

export const REASON_AR = {
  root_parent: "أصل الفرع (Root Parent)",
  in_tree_parents: "موجود في tree_parents",
  missing_uuid: "يحتاج ربط UUID فقط",
  broken_parent_uuid: "أب UUID مكسور",
};

export function childPath(row) {
  return String((row && (row.child_name || row.name)) || "");
}

export function parentKey(row) {
  return String((row && (row.parent_name || row.parent)) || "");
}

export function branchRootName(branchKey) {
  const k = String(branchKey || "").trim();
  if (!k) return "";
  return k + " بن مطلق بن زيدان";
}

export function isBranchRootParent(parent, branchKey) {
  const p = String(parent || "").trim();
  const b = String(branchKey || "").trim();
  if (!p || !b) return false;
  return p === b || p === branchRootName(b);
}

/**
 * Build lookup indexes from tree_children + tree_parents.
 * tree_parents columns used: branch_key, name (no person_id in current schema).
 */
export function buildParentIndex(children, parents) {
  const personIds = new Set();
  const paths = new Set(); // `${branch}||${path}`
  const treeParentNames = new Set(); // `${branch}||${name}`

  for (const c of children || []) {
    if (!c) continue;
    const branch = String(c.branch_key || "");
    if (c.person_id) personIds.add(String(c.person_id));
    const path = childPath(c);
    if (branch && path) paths.add(branch + "||" + path);
  }

  for (const p of parents || []) {
    if (!p) continue;
    const branch = String(p.branch_key || "");
    const name = String(p.name || "").trim();
    if (branch && name) {
      treeParentNames.add(branch + "||" + name);
      paths.add(branch + "||" + name);
    }
  }

  return { personIds, paths, treeParentNames };
}

export function classifyChild(row, index) {
  const branch = String((row && row.branch_key) || "");
  const path = childPath(row);
  const parent = parentKey(row);
  const parentPathKey = branch && parent ? branch + "||" + parent : "";
  const inTreeParents =
    !!parentPathKey && index.treeParentNames.has(parentPathKey);
  const pathFound = !!parentPathKey && index.paths.has(parentPathKey);
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

  // 🟢 Healthy: branch root OR listed in tree_parents
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

  // Linked UUID resolves in children (+ parents index has no person_id today)
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

  // 🟡 Warning: NULL UUID but father findable by name/path
  if (!pid && pathFound) {
    return {
      ...base,
      severity: "warning",
      code: "TREE-003-warn",
      issue: "needs_uuid_link",
      reason: REASON.MISSING_UUID,
      reason_ar: REASON_AR.missing_uuid,
    };
  }

  // 🟡 Recoverable broken UUID: path exists in children/parents index
  if (pid && !uuidOk && pathFound) {
    return {
      ...base,
      severity: "warning",
      code: "TREE-003-warn",
      issue: "needs_uuid_relink",
      reason: REASON.MISSING_UUID,
      reason_ar: REASON_AR.missing_uuid,
    };
  }

  // 🔴 Real TREE-003: broken UUID and parent absent from both indexes
  if (pid && !uuidOk && !pathFound && !inTreeParents) {
    return {
      ...base,
      severity: "error",
      code: "TREE-003",
      issue: "broken_parent_person_id",
      reason: REASON.BROKEN_PARENT_UUID,
      reason_ar: REASON_AR.broken_parent_uuid,
    };
  }

  // NULL UUID and father not findable — not a false-root alarm; keep as warning
  if (!pid) {
    return {
      ...base,
      severity: "warning",
      code: "TREE-003-warn",
      issue: "missing_parent_person_id",
      reason: REASON.MISSING_UUID,
      reason_ar: REASON_AR.missing_uuid,
    };
  }

  return {
    ...base,
    severity: "ok",
    code: null,
    issue: null,
    reason: null,
    reason_ar: null,
  };
}

export function classifyAll(children, parents) {
  const index = buildParentIndex(children, parents);
  const healthy = [];
  const warnings = [];
  const errors = [];
  for (const row of children || []) {
    const c = classifyChild(row, index);
    if (c.severity === "healthy") healthy.push(c);
    else if (c.severity === "warning") warnings.push(c);
    else if (c.severity === "error") errors.push(c);
  }
  return { index, healthy, warnings, errors };
}
