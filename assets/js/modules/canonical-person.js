/**
 * Canonical Person Identity (Patch 1 / ADR-001, ADR-002)
 *
 * Layers (stable → derived):
 *   person_id → Node Path → Display Name → Search Name
 *
 * Writes must resolve via person_id and/or Node Path index.
 * Never pick the first ambiguous name match (no limit(1) / data[0] guessing).
 */
(function (root) {
  "use strict";

  var ERROR = {
    TREE_001: "TREE-001",
    TREE_003: "TREE-003",
    TREE_004: "TREE-004",
    SPOUSE_001: "SPOUSE-001",
    REQ_001: "REQ-001",
    REQ_002: "REQ-002",
  };

  var MSG = {
    TREE_001:
      "تعذر تحديد الشخص لأن الاسم يطابق أكثر من شخص في الشجرة. اختر المسار الكامل أو معرّف الشخص (TREE-001).",
    TREE_001_SHORT:
      "تطابق اسم متعدد — يلزم person_id أو مسار عقدة كامل (TREE-001).",
    TREE_003: "تعذر تحديد معرّف الأب (parent_person_id) لهذا المسار (TREE-003).",
    TREE_004:
      "عزل حالة الأبناء: الأب المحدد تغيّر أو لا يوجد parent_person_id فريد — أوقف العملية دون إنشاء أبناء (TREE-004).",
    SPOUSE_001:
      "تعذر حل هوية الزوج للكتابة. اختر الشخص من الشجرة (person_id / مسار العقدة) وليس بالاسم فقط (SPOUSE-001).",
    NOT_FOUND: "تعذر تحديد رقم الشخص في قاعدة البيانات.",
    NOT_FOUND_CHILD: "تعذر تحديد رقم الابن في قاعدة البيانات.",
    REQ_001:
      "لا يمكن قبول الطلب: لم يُثبت أي أثر في الشجرة (REQ-001).",
    REQ_002:
      "فشل إنشاء أو ربط الابن بعد الاعتماد (REQ-002).",
  };

  function defaultNorm(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function leafFromPath(path, norm) {
    var n = (norm || defaultNorm)(path || "");
    if (!n) return "";
    if (n.indexOf("/") < 0) return n;
    var parts = n.split("/").map(function (p) {
      return (norm || defaultNorm)(p);
    }).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : n;
  }

  function displayNameFromNodePath(nodePath, branchRoot, norm) {
    var n = (norm || defaultNorm)(nodePath || "");
    if (!n) return "";
    return leafFromPath(n, norm);
  }

  function searchNameFromNodePath(nodePath, norm) {
    return leafFromPath(nodePath, norm);
  }

  function isUuidLike(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      String(value || "").trim(),
    );
  }

  function fail(code, message, extra) {
    var out = {
      ok: false,
      rowId: 0,
      personId: "",
      code: code || ERROR.TREE_001,
      message: message || MSG.TREE_001,
    };
    if (extra) {
      Object.keys(extra).forEach(function (k) {
        out[k] = extra[k];
      });
    }
    return out;
  }

  function okResult(rowId, personId, meta) {
    return {
      ok: true,
      rowId: Number(rowId) || 0,
      personId: personId ? String(personId) : "",
      code: "",
      message: "",
      meta: meta || null,
    };
  }

  function resolveFromPathIndex(pathToRow, nodePath, personId, helpers) {
    var helpersObj = helpers || {};
    var norm =
      typeof helpersObj.normalizePersonName === "function"
        ? helpersObj.normalizePersonName
        : defaultNorm;
    var index = pathToRow || {};
    var pid = norm(personId || "");
    if (pid) {
      var byPid = index["pid:" + pid];
      if (byPid && byPid.id) return okResult(byPid.id, byPid.person_id || pid, byPid);
      var keys = Object.keys(index);
      for (var i = 0; i < keys.length; i++) {
        if (keys[i].indexOf("pid:") === 0) continue;
        var entry = index[keys[i]];
        if (entry && norm(entry.person_id || "") === pid && entry.id) {
          return okResult(entry.id, entry.person_id || pid, entry);
        }
      }
    }
    var path = norm(nodePath || "");
    if (!path) return fail(ERROR.SPOUSE_001, MSG.SPOUSE_001);
    var exact = index[path];
    if (exact && exact.id) {
      return okResult(exact.id, exact.person_id || "", exact);
    }
    var matches = [];
    Object.keys(index).forEach(function (key) {
      if (key.indexOf("pid:") === 0) return;
      var candidate = index[key];
      if (!candidate || !candidate.id) return;
      var k = norm(key);
      if (k === path) {
        matches.push(candidate);
        return;
      }
      if (path.indexOf("/") >= 0 && k.indexOf("/") >= 0) {
        if (path === k || path.endsWith("/" + k) || k.endsWith("/" + path)) {
          matches.push(candidate);
        }
      }
    });
    if (matches.length === 1) {
      return okResult(matches[0].id, matches[0].person_id || "", matches[0]);
    }
    if (matches.length > 1) {
      return fail(ERROR.TREE_001, MSG.TREE_001, { matchCount: matches.length });
    }
    return fail(ERROR.SPOUSE_001, MSG.NOT_FOUND);
  }

  function parentNamesCompatible(parentPath, dbParent, norm, leafFn) {
    var parentNorm = norm(parentPath || "");
    var db = norm(dbParent || "");
    if (!parentNorm || !db) return true;
    var parentLeaf = leafFn(parentNorm);
    if (db === parentNorm || db === parentLeaf) return true;
    if (parentNorm.endsWith("/" + db) || db.endsWith("/" + parentLeaf)) return true;
    if (parentNorm.endsWith("/" + leafFn(db))) return true;
    return false;
  }

  async function resolveTreeRowIdFromDb(options) {
    var opts = options || {};
    var sb = opts.sb;
    var branchKey = String(opts.branchKey || "").trim();
    var nodePath = opts.nodePath || "";
    var personId = opts.personId || "";
    var parentPath = opts.parentPath || "";
    var helpersObj = opts.helpers || {};
    var norm =
      typeof helpersObj.normalizePersonName === "function"
        ? helpersObj.normalizePersonName
        : defaultNorm;
    var leafFn =
      typeof helpersObj.getLeafStoredNameFromNodeId === "function"
        ? helpersObj.getLeafStoredNameFromNodeId
        : function (v) {
            return leafFromPath(v, norm);
          };

    if (!sb || !branchKey) {
      return fail(ERROR.SPOUSE_001, MSG.NOT_FOUND);
    }

    var pid = norm(personId || "");
    if (pid && isUuidLike(pid)) {
      var byPerson = await sb
        .from("tree_children")
        .select("id,person_id,parent_name,parent,child_name,name")
        .eq("branch_key", branchKey)
        .eq("person_id", pid)
        .limit(5);
      if (!byPerson.error && Array.isArray(byPerson.data)) {
        if (byPerson.data.length === 1) {
          var row = byPerson.data[0];
          return okResult(row.id, row.person_id || pid, row);
        }
        if (byPerson.data.length > 1) {
          return fail(ERROR.TREE_001, MSG.TREE_001, { matchCount: byPerson.data.length });
        }
      }
    }

    var path = norm(nodePath || "");
    if (!path) return fail(ERROR.SPOUSE_001, MSG.NOT_FOUND);

    var candidates = [];
    var seen = {};
    function pushRows(rows) {
      (Array.isArray(rows) ? rows : []).forEach(function (row) {
        if (!row || row.id == null) return;
        var id = Number(row.id);
        if (seen[id]) return;
        seen[id] = true;
        candidates.push(row);
      });
    }

    var exactCols = ["child_name", "name"];
    for (var c = 0; c < exactCols.length; c++) {
      var q = await sb
        .from("tree_children")
        .select("id,person_id,parent_name,parent,child_name,name")
        .eq("branch_key", branchKey)
        .eq(exactCols[c], path)
        .limit(20);
      if (!q.error) pushRows(q.data);
    }

    if (candidates.length === 0) {
      var leaf = leafFn(path);
      if (leaf && leaf !== path) {
        for (var c2 = 0; c2 < exactCols.length; c2++) {
          var q2 = await sb
            .from("tree_children")
            .select("id,person_id,parent_name,parent,child_name,name")
            .eq("branch_key", branchKey)
            .eq(exactCols[c2], leaf)
            .limit(20);
          if (!q2.error) pushRows(q2.data);
        }
      }
    }

    if (candidates.length === 0) {
      return fail(ERROR.SPOUSE_001, MSG.NOT_FOUND);
    }

    var parentNorm = norm(parentPath || "");
    var filtered = candidates;
    if (parentNorm) {
      filtered = candidates.filter(function (row) {
        return parentNamesCompatible(
          parentNorm,
          row.parent_name || row.parent || "",
          norm,
          leafFn,
        );
      });
      if (filtered.length === 0) {
        return fail(ERROR.SPOUSE_001, MSG.NOT_FOUND, { matchCount: candidates.length });
      }
    }

    if (filtered.length === 1) {
      return okResult(filtered[0].id, filtered[0].person_id || "", filtered[0]);
    }

    var distinctPids = {};
    filtered.forEach(function (row) {
      var p = norm(row.person_id || "");
      if (p) distinctPids[p] = row;
    });
    var pidKeys = Object.keys(distinctPids);
    if (
      pidKeys.length === 1 &&
      filtered.every(function (r) {
        return norm(r.person_id || "") === pidKeys[0];
      })
    ) {
      return okResult(distinctPids[pidKeys[0]].id, pidKeys[0], distinctPids[pidKeys[0]]);
    }

    return fail(ERROR.TREE_001, MSG.TREE_001, { matchCount: filtered.length });
  }

  async function resolveTreeRowIdForWrite(options) {
    var opts = options || {};
    var helpersObj = opts.helpers || {};
    var norm =
      typeof helpersObj.normalizePersonName === "function"
        ? helpersObj.normalizePersonName
        : defaultNorm;
    var fromIndex = resolveFromPathIndex(
      opts.pathToRow,
      opts.nodePath,
      opts.personId,
      opts.helpers,
    );
    if (fromIndex.ok && fromIndex.rowId) return fromIndex;
    if (fromIndex.code === ERROR.TREE_001) return fromIndex;

    // Patch 3: prefer person_id already known from selection index before any name DB search.
    var nextOpts = Object.assign({}, opts);
    var pid = norm(nextOpts.personId || "");
    if (!pid && fromIndex.meta && fromIndex.meta.person_id) {
      pid = norm(fromIndex.meta.person_id);
      nextOpts.personId = pid;
    }
    if (!pid) {
      var path = norm(opts.nodePath || "");
      var exact = opts.pathToRow && path ? opts.pathToRow[path] : null;
      if (exact && exact.person_id) {
        nextOpts.personId = norm(exact.person_id);
      }
    }
    return resolveTreeRowIdFromDb(nextOpts);
  }

  /**
   * Spouse write resolve (Patch 3): selection row id / person_id first.
   * Never name-only limit(1). Ambiguity → TREE-001. Unresolvable → SPOUSE-001.
   */
  async function resolveHusbandForSpouseWrite(options) {
    var opts = options || {};
    var helpersObj = opts.helpers || {};
    var norm =
      typeof helpersObj.normalizePersonName === "function"
        ? helpersObj.normalizePersonName
        : defaultNorm;
    var path = norm(opts.nodePath || "");
    var personId = norm(opts.personId || "");
    var rowIdHint = Number(opts.rowId || 0);

    if (rowIdHint > 0) {
      return okResult(rowIdHint, personId, {
        id: rowIdHint,
        person_id: personId,
      });
    }

    var index = opts.pathToRow || {};
    if (personId) {
      var byPid = index["pid:" + personId];
      if (byPid && byPid.id) {
        return okResult(byPid.id, byPid.person_id || personId, byPid);
      }
    }
    if (path && index[path] && index[path].id) {
      return okResult(
        index[path].id,
        index[path].person_id || personId,
        index[path],
      );
    }

    var resolved = await resolveTreeRowIdForWrite({
      sb: opts.sb,
      branchKey: opts.branchKey,
      nodePath: path,
      personId: personId,
      parentPath: opts.parentPath || "",
      pathToRow: index,
      helpers: helpersObj,
    });
    if (resolved.ok && resolved.rowId) return resolved;
    if (resolved.code === ERROR.TREE_001) return resolved;
    return fail(ERROR.SPOUSE_001, MSG.SPOUSE_001, {
      matchCount: resolved.matchCount || 0,
      cause: resolved.code || "",
    });
  }

  function attachParentPersonId(row, pathToRow, parentPath, helpers) {
    var payload = Object.assign({}, row || {});
    if (payload.parent_person_id) return payload;
    var resolved = resolveFromPathIndex(pathToRow, parentPath, "", helpers);
    if (resolved.ok && resolved.personId) {
      payload.parent_person_id = resolved.personId;
    }
    return payload;
  }

  root.AlzidanCanonicalPerson = {
    ERROR: ERROR,
    MSG: MSG,
    normalizeSearchName: searchNameFromNodePath,
    nodePathToDisplayName: displayNameFromNodePath,
    nodePathToSearchName: searchNameFromNodePath,
    leafFromPath: leafFromPath,
    isUuidLike: isUuidLike,
    resolveFromPathIndex: resolveFromPathIndex,
    resolveTreeRowIdFromDb: resolveTreeRowIdFromDb,
    resolveTreeRowIdForWrite: resolveTreeRowIdForWrite,
    resolveHusbandForSpouseWrite: resolveHusbandForSpouseWrite,
    attachParentPersonId: attachParentPersonId,
    parentNamesCompatible: parentNamesCompatible,
  };
})(typeof window !== "undefined" ? window : globalThis);

if (typeof module !== "undefined" && module.exports) {
  module.exports = globalThis.AlzidanCanonicalPerson;
}
