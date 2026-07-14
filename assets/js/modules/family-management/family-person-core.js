(function (root) {
  "use strict";

  var Core = root.AlzidanAdminCore || {};

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function escapeHtml(value) {
    if (typeof Core.escapeHtml === "function") return Core.escapeHtml(value);
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function setAlert(el, type, text) {
    if (!el) return;
    el.textContent = String(text || "");
    el.className = "alert fm-section-alert " + (type === "success" ? "alert-success" : "alert-error");
    el.style.display = text ? "block" : "none";
  }

  function hideAlert(el) {
    if (!el) return;
    el.style.display = "none";
    el.textContent = "";
    el.className = "alert fm-section-alert";
  }

  function setDeceasedFieldsUiMode(deceased, fieldEls) {
    var list = Array.isArray(fieldEls) ? fieldEls : [];
    list.forEach(function (el) {
      if (!el) return;
      var wrap = el.closest(".field") || el.parentElement;
      if (wrap && wrap.style) wrap.style.display = deceased ? "none" : "";
      try {
        el.disabled = !!deceased;
        if (deceased) el.value = "";
      } catch (e) {}
    });
  }

  function bindDeceasedToggle(checkbox, fieldEls) {
    if (!checkbox) return function () {};
    var apply = function () {
      setDeceasedFieldsUiMode(!!checkbox.checked, fieldEls);
    };
    checkbox.addEventListener("change", apply);
    apply();
    return apply;
  }

  function bindBirthDateSync(hijriEl, gregEl, api) {
    if (!hijriEl || !gregEl || !api) return;
    var syncing = false;

    function fromHijri() {
      if (syncing) return;
      var raw = String(hijriEl.value || "").trim();
      if (!raw) return;
      var hijriISO = typeof api.normalizeHijriDateISO === "function" ? api.normalizeHijriDateISO(raw) : "";
      if (!hijriISO) return;
      var gregISO = typeof api.hijriToGregorianISO === "function" ? api.hijriToGregorianISO(hijriISO) : "";
      if (!gregISO) return;
      syncing = true;
      hijriEl.value = hijriISO;
      gregEl.value = gregISO;
      syncing = false;
    }

    function fromGreg() {
      if (syncing) return;
      var raw = String(gregEl.value || "").trim();
      if (!raw) return;
      var gregISO = typeof api.normalizeGregorianDateISO === "function" ? api.normalizeGregorianDateISO(raw) : "";
      if (!gregISO) return;
      var hijriISO = typeof api.gregorianToHijriISO === "function" ? api.gregorianToHijriISO(gregISO) : "";
      if (!hijriISO) return;
      syncing = true;
      gregEl.value = gregISO;
      hijriEl.value = hijriISO;
      syncing = false;
    }

    hijriEl.addEventListener("input", fromHijri);
    hijriEl.addEventListener("blur", fromHijri);
    gregEl.addEventListener("change", fromGreg);
  }

  function parentNamesMatch(parentId, dbParentName, norm, baseName) {
    var parentNorm = norm(parentId || "");
    var dbParent = norm(dbParentName || "");
    if (!parentNorm || !dbParent) return true;
    var parentLeaf = baseName(parentId || "");
    if (dbParent === parentNorm || dbParent === parentLeaf) return true;
    if (dbParent.includes("/") && parentNorm.endsWith("/" + dbParent)) return true;
    if (parentNorm.includes("/") && dbParent.endsWith("/" + parentLeaf)) return true;
    return false;
  }

  function nodePathMatches(nodeId, mapKey, norm) {
    var id = norm(nodeId || "");
    var key = norm(mapKey || "");
    if (!id || !key) return false;
    if (id === key) return true;
    if (key.includes("/") && id.endsWith("/" + key)) return true;
    return false;
  }

  function resolveChildrenMapKey(childId, childrenMap, norm) {
    var id = norm(childId || "");
    if (!id) return "";
    var map = childrenMap || {};
    if (Array.isArray(map[id])) return id;
    var keys = Object.keys(map);
    for (var i = 0; i < keys.length; i++) {
      if (nodePathMatches(id, keys[i], norm)) return keys[i];
    }
    return "";
  }

  function deriveParentIdFromChildPath(childPath, rawParent, norm, baseName) {
    var childFull = norm(childPath || "");
    var raw = norm(rawParent || "");
    if (!raw || !childFull || childFull.indexOf("/") < 0) return "";
    var parts = childFull.split("/").map(function (p) { return norm(p); }).filter(Boolean);
    if (parts.length < 2) return "";
    var derivedParent = parts.slice(0, -1).join("/");
    var derivedLeaf = parts[parts.length - 2] || "";
    if (derivedLeaf === raw || baseName(derivedParent) === raw || derivedParent.endsWith("/" + raw)) {
      return derivedParent;
    }
    return "";
  }

  function buildPathToRowIndex(rows, normalizePersonName) {
    var norm =
      typeof normalizePersonName === "function"
        ? normalizePersonName
        : function (v) {
            return String(v || "").trim();
          };
    var pathToRow = {};
    (Array.isArray(rows) ? rows : []).forEach(function (row) {
      if (!row || row.id == null) return;
      var childPath = norm(row.child_name || row.name || "");
      var meta = {
        id: Number(row.id),
        person_id: row.person_id ? String(row.person_id) : "",
        parent_person_id: row.parent_person_id ? String(row.parent_person_id) : "",
        db_parent_name: norm(row.parent_name || row.parent || ""),
        db_child_name: childPath,
      };
      if (childPath) pathToRow[childPath] = meta;
      if (meta.person_id) pathToRow["pid:" + norm(meta.person_id)] = meta;
    });
    return pathToRow;
  }

  function findTreeRowMeta(pathToRow, path, childObj, helpers, parentId) {
    var helpersObj = helpers || {};
    var norm =
      typeof helpersObj.normalizePersonName === "function"
        ? helpersObj.normalizePersonName
        : function (v) {
            return String(v || "").trim();
          };
    var baseName =
      typeof helpersObj.normalizePersonBaseName === "function"
        ? helpersObj.normalizePersonBaseName
        : norm;
    if (childObj && childObj.rowId) {
      var wantedId = Number(childObj.rowId);
      var keys = Object.keys(pathToRow || {});
      for (var i = 0; i < keys.length; i++) {
        var entry = pathToRow[keys[i]];
        if (entry && Number(entry.id) === wantedId) return entry;
      }
    }
    var p = norm(path || (childObj && childObj.name) || "");
    if (!p) return null;
    var meta = pathToRow && pathToRow[p] ? pathToRow[p] : null;
    if (!meta && childObj && childObj.personId) meta = pathToRow["pid:" + norm(childObj.personId)];
    if (!meta) {
      var leaf = baseName(p);
      Object.keys(pathToRow || {}).forEach(function (key) {
        if (meta || key.indexOf("pid:") === 0) return;
        var candidate = pathToRow[key];
        var matchesChild = nodePathMatches(p, key, norm);
        if (!matchesChild) return;
        if (!parentNamesMatch(parentId, candidate && candidate.db_parent_name, norm, baseName)) return;
        meta = candidate;
      });
    }
    return meta && meta.id ? meta : null;
  }

  function attachTreeRowIdsToChildren(childrenMap, pathToRow, helpers) {
    var helpersObj = helpers || {};
    var norm =
      typeof helpersObj.normalizePersonName === "function"
        ? helpersObj.normalizePersonName
        : function (v) {
            return String(v || "").trim();
          };
    var baseName =
      typeof helpersObj.normalizePersonBaseName === "function"
        ? helpersObj.normalizePersonBaseName
        : norm;
    Object.keys(childrenMap || {}).forEach(function (parentKey) {
      var list = Array.isArray(childrenMap[parentKey]) ? childrenMap[parentKey] : [];
      list.forEach(function (child) {
        if (!child) return;
        var name = norm(child.name || "");
        var meta = findTreeRowMeta(pathToRow, name, child, helpersObj, parentKey);
        if (meta && meta.id) {
          child.rowId = meta.id;
          if (!child.personId && meta.person_id) child.personId = meta.person_id;
          if (name) pathToRow[name] = meta;
        }
      });
    });
  }

  function findTreeRowId(pathToRow, path, childObj, helpers, parentId) {
    var meta = findTreeRowMeta(pathToRow, path, childObj, helpers, parentId);
    return meta && meta.id ? Number(meta.id) : 0;
  }

  function buildDeleteNameAttempts(parentId, childId, helpers) {
    var helpersObj = helpers || {};
    var norm =
      typeof helpersObj.normalizePersonName === "function"
        ? helpersObj.normalizePersonName
        : function (v) {
            return String(v || "").trim();
          };
    var leafFn =
      typeof helpersObj.getLeafStoredNameFromNodeId === "function"
        ? helpersObj.getLeafStoredNameFromNodeId
        : typeof helpersObj.normalizePersonBaseName === "function"
          ? helpersObj.normalizePersonBaseName
          : function (v) {
              return norm(v);
            };
    var parentFull = norm(parentId || "");
    var childFull = norm(childId || "");
    var parentLeaf = leafFn(parentId || "");
    var childLeaf = leafFn(childId || "");
    var seen = {};
    var pairs = [];
    function pushPair(p, c) {
      var pn = norm(p || "");
      var cn = norm(c || "");
      if (!pn || !cn) return;
      var key = pn + "\0" + cn;
      if (seen[key]) return;
      seen[key] = true;
      pairs.push([pn, cn]);
    }
    var rowMeta = helpersObj.rowMeta || null;
    if (rowMeta && rowMeta.db_parent_name && rowMeta.db_child_name) {
      pushPair(rowMeta.db_parent_name, rowMeta.db_child_name);
      pushPair(rowMeta.db_parent_name, leafFn(rowMeta.db_child_name));
      pushPair(leafFn(rowMeta.db_parent_name), rowMeta.db_child_name);
      pushPair(leafFn(rowMeta.db_parent_name), leafFn(rowMeta.db_child_name));
    }
    pushPair(parentFull, childFull);
    pushPair(parentFull, childLeaf);
    pushPair(parentLeaf, childFull);
    pushPair(parentLeaf, childLeaf);
    return pairs;
  }

  root.AlzidanFamilyPersonCore = {
    normalizeText: normalizeText,
    escapeHtml: escapeHtml,
    setAlert: setAlert,
    hideAlert: hideAlert,
    setDeceasedFieldsUiMode: setDeceasedFieldsUiMode,
    bindDeceasedToggle: bindDeceasedToggle,
    bindBirthDateSync: bindBirthDateSync,
    parentNamesMatch: parentNamesMatch,
    nodePathMatches: nodePathMatches,
    resolveChildrenMapKey: resolveChildrenMapKey,
    deriveParentIdFromChildPath: deriveParentIdFromChildPath,
    buildPathToRowIndex: buildPathToRowIndex,
    attachTreeRowIdsToChildren: attachTreeRowIdsToChildren,
    findTreeRowMeta: findTreeRowMeta,
    findTreeRowId: findTreeRowId,
    buildDeleteNameAttempts: buildDeleteNameAttempts,
  };
})(typeof window !== "undefined" ? window : globalThis);
