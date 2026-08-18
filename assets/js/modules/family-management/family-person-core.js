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

  /** Path fallback key when person_id is missing (ى/ي, أ/ا, ة/ه). */
  function normalizePathKeyForDedupe(path, normFn) {
    var n = typeof normFn === "function" ? normFn : normalizeText;
    return n(path || "")
      .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
      .replace(/[أإآ]/g, "ا")
      .replace(/ى/g, "ي")
      .replace(/ؤ/g, "و")
      .replace(/ئ/g, "ي")
      .replace(/ة/g, "ه")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Resolve person UUID for a node path:
   * 1) pathToRow[path].person_id (the person's own tree_children row)
   * 2) unanimous parentPersonId on children keyed under that path
   *    (covers parent_name spelling variants like دوخي/دوخى)
   */
  function resolvePersonIdForNodePath(nodePath, pathToRow, childrenMap, normFn) {
    var norm = typeof normFn === "function" ? normFn : normalizeText;
    var path = norm(nodePath || "");
    if (!path) return "";
    var meta = pathToRow && pathToRow[path] ? pathToRow[path] : null;
    if (meta && meta.person_id) return norm(meta.person_id);
    if (path.indexOf("pid:") === 0 && pathToRow && pathToRow[path] && pathToRow[path].person_id) {
      return norm(pathToRow[path].person_id);
    }
    var list =
      childrenMap && Array.isArray(childrenMap[path]) ? childrenMap[path] : [];
    var seenPid = "";
    for (var i = 0; i < list.length; i++) {
      var child = list[i];
      var pp = norm(
        (child && (child.parentPersonId || child.parent_person_id)) || "",
      );
      if (!pp) continue;
      if (!seenPid) seenPid = pp;
      else if (seenPid !== pp) return "";
    }
    return seenPid;
  }

  /** Prefer the person's own db_child_name path when person_id is known. */
  function canonicalNodePathForPerson(personId, pathToRow, fallbackPath, normFn) {
    var norm = typeof normFn === "function" ? normFn : normalizeText;
    var pid = norm(personId || "");
    if (pid && pathToRow && pathToRow["pid:" + pid]) {
      var meta = pathToRow["pid:" + pid];
      var own = norm((meta && meta.db_child_name) || "");
      if (own) return own;
    }
    return norm(fallbackPath || "");
  }

  /**
   * Dedupe person search/select options by person_id (primary), else
   * normalized path. Colliding identical labels across different UUIDs
   * get a short person_id suffix for disambiguation only.
   */
  function dedupePersonOptionsByPersonId(options, opts) {
    var list = Array.isArray(options) ? options : [];
    var o = opts || {};
    var norm =
      typeof o.normalizePersonName === "function"
        ? o.normalizePersonName
        : normalizeText;
    var resolvePid =
      typeof o.resolvePersonId === "function"
        ? o.resolvePersonId
        : function () {
            return "";
          };
    var pathToRow = o.pathToRow || {};
    var byKey = Object.create(null);
    var order = [];

    list.forEach(function (opt) {
      if (!opt) return;
      var value = norm(opt.value || "");
      if (!value) return;
      var pid = norm(opt.personId || resolvePid(value) || "");
      var key = pid
        ? "pid:" + pid
        : "path:" + normalizePathKeyForDedupe(value, norm);
      if (!byKey[key]) {
        byKey[key] = {
          value: value,
          label: opt.label || value,
          personId: pid,
        };
        order.push(key);
        return;
      }
      var existing = byKey[key];
      if (pid && !existing.personId) existing.personId = pid;
      if (pid && pathToRow["pid:" + pid] && pathToRow["pid:" + pid].db_child_name) {
        var canon = norm(pathToRow["pid:" + pid].db_child_name);
        if (value === canon) {
          existing.value = value;
          if (opt.label) existing.label = opt.label;
        }
      } else {
        var candMeta = pathToRow[value];
        var existMeta = pathToRow[existing.value];
        if (candMeta && candMeta.person_id && !(existMeta && existMeta.person_id)) {
          existing.value = value;
          if (opt.label) existing.label = opt.label;
        }
      }
    });

    var labelCounts = Object.create(null);
    order.forEach(function (k) {
      var lab = byKey[k].label || byKey[k].value;
      labelCounts[lab] = (labelCounts[lab] || 0) + 1;
    });

    return order.map(function (k) {
      var item = byKey[k];
      var label = item.label || item.value;
      if (labelCounts[label] > 1 && item.personId) {
        label = label + " · " + String(item.personId).slice(0, 8);
      }
      return {
        value: item.value,
        label: label,
        personId: item.personId || "",
      };
    });
  }

  /**
   * Children State Isolation (TREE-004) + UUID-primary display:
   * - When parentPersonId is known: return EVERY child in the map whose
   *   parentPersonId matches (covers parent_name spelling variants like
   *   دوخي/دوخى under the same father UUID). Never fuzzy-match by path.
   * - When parentPersonId is missing: exact map key only (never reuse
   *   another father's array via suffix/leaf matching).
   */
  function childrenForSelectedParent(childrenMap, parentId, opts) {
    var options = opts || {};
    var norm =
      typeof options.normalizePersonName === "function"
        ? options.normalizePersonName
        : normalizeText;
    var key = norm(parentId || "");
    if (!key) return { key: "", list: [], sharedRef: false };
    var map = childrenMap || {};
    var parentPersonId = norm(options.parentPersonId || "");
    var list = [];
    var seen = Object.create(null);

    function pushUnique(child) {
      if (!child) return;
      var id =
        norm(child.personId || child.person_id || "") ||
        norm(child.name || "");
      if (!id || seen[id]) return;
      seen[id] = true;
      list.push(child);
    }

    if (parentPersonId) {
      Object.keys(map).forEach(function (mapKey) {
        var arr = map[mapKey];
        if (!Array.isArray(arr)) return;
        arr.forEach(function (child) {
          var pp = norm(child.parentPersonId || child.parent_person_id || "");
          if (pp === parentPersonId) pushUnique(child);
        });
      });
      // Legacy rows under the exact path key without parentPersonId.
      var exact = Array.isArray(map[key]) ? map[key] : [];
      exact.forEach(function (child) {
        var pp = norm(child.parentPersonId || child.parent_person_id || "");
        if (!pp) pushUnique(child);
      });
    } else {
      var raw = Array.isArray(map[key]) ? map[key] : [];
      raw.forEach(pushUnique);
    }
    return { key: key, list: list, sharedRef: false };
  }

  /**
   * When the same father UUID is keyed under multiple parent_name spellings
   * (e.g. دوخي vs دوخى), union those children onto every affected map key.
   * Does not invent relationships — only re-groups rows that already share
   * parentPersonId. Leaves single-key fathers unchanged.
   */
  function unionChildrenMapByParentPersonId(childrenMap, normalizePersonNameFn) {
    var norm =
      typeof normalizePersonNameFn === "function"
        ? normalizePersonNameFn
        : normalizeText;
    var map = childrenMap || {};
    var byPid = Object.create(null);
    Object.keys(map).forEach(function (parentKey) {
      var arr = map[parentKey];
      if (!Array.isArray(arr)) return;
      for (var i = 0; i < arr.length; i++) {
        var child = arr[i];
        var pp = norm(
          (child && (child.parentPersonId || child.parent_person_id)) || "",
        );
        if (!pp) continue;
        if (!byPid[pp]) byPid[pp] = { keys: [], children: [] };
        if (byPid[pp].keys.indexOf(parentKey) < 0) byPid[pp].keys.push(parentKey);
        byPid[pp].children.push(child);
      }
    });
    Object.keys(byPid).forEach(function (pp) {
      var entry = byPid[pp];
      if (!entry.keys || entry.keys.length < 2) return;
      var seen = Object.create(null);
      var merged = [];
      for (var i = 0; i < entry.children.length; i++) {
        var child = entry.children[i];
        var id =
          norm((child && (child.personId || child.person_id)) || "") ||
          norm((child && child.name) || "");
        if (!id || seen[id]) continue;
        seen[id] = true;
        merged.push(child);
      }
      entry.keys.forEach(function (k) {
        var without = (Array.isArray(map[k]) ? map[k] : []).filter(function (c) {
          return (
            norm((c && (c.parentPersonId || c.parent_person_id)) || "") !== pp
          );
        });
        var copies = merged.map(function (c) {
          return {
            name: c.name,
            personId: c.personId || c.person_id || "",
            parentPersonId: c.parentPersonId || c.parent_person_id || "",
            year: c.year || "",
            order: c.order || "",
            gdate: c.gdate || "",
            hdate: c.hdate || "",
            city: c.city || "",
            area: c.area || "",
            deceased: !!c.deceased,
            photoUrl: c.photoUrl || c.photo_url || "",
            rowId: c.rowId,
          };
        });
        map[k] = without.concat(copies);
      });
    });
    return map;
  }

  /** Ensure two parent keys never share the same array reference. */
  function isolateChildrenMapArrays(childrenMap) {
    var map = childrenMap || {};
    var seen = new Map();
    Object.keys(map).forEach(function (key) {
      var list = map[key];
      if (!Array.isArray(list)) return;
      if (seen.has(list)) {
        map[key] = list.slice();
        return;
      }
      seen.set(list, key);
    });
    return map;
  }

  /**
   * Build a write-bound parent context at selection/open time.
   * Save paths must use this snapshot — never a stale children array.
   */
  function bindParentWriteContext(parentPath, pathToRow, helpers) {
    var helpersObj = helpers || {};
    var norm =
      typeof helpersObj.normalizePersonName === "function"
        ? helpersObj.normalizePersonName
        : normalizeText;
    var path = norm(parentPath || "");
    var meta =
      path && pathToRow && pathToRow[path]
        ? pathToRow[path]
        : path && pathToRow && pathToRow["pid:" + path]
          ? pathToRow["pid:" + path]
          : null;
    var personId = meta && meta.person_id ? norm(meta.person_id) : "";
    return {
      parentPath: path,
      parentPersonId: personId,
      parentRowId: meta && meta.id ? Number(meta.id) : 0,
      boundAt: Date.now(),
    };
  }

  function attachBoundParentToRow(row, boundParent) {
    var payload = Object.assign({}, row || {});
    var bound = boundParent || {};
    if (bound.parentPath) {
      payload.parent_name = bound.parentPath;
      payload.parent = bound.parentPath;
    }
    if (bound.parentPersonId) {
      payload.parent_person_id = bound.parentPersonId;
    }
    return payload;
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
        photo_url: String(row.photo_url || row.photoUrl || "").trim(),
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
      var leafMatches = [];
      Object.keys(pathToRow || {}).forEach(function (key) {
        if (key.indexOf("pid:") === 0) return;
        var candidate = pathToRow[key];
        var matchesChild = nodePathMatches(p, key, norm);
        if (!matchesChild) return;
        if (!parentNamesMatch(parentId, candidate && candidate.db_parent_name, norm, baseName)) return;
        leafMatches.push(candidate);
      });
      if (leafMatches.length === 1) meta = leafMatches[0];
      // >1 matches: leave unresolved (ADR-002 — no silent first pick)
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

  var ORIGIN_LOCK_MSG = "هذا من الأصول — لا يمكن تعديله أو حذفه.";

  function branchRootNameForKey(branchKey, norm) {
    var n = typeof norm === "function" ? norm : normalizeText;
    var k = n(branchKey || "");
    if (!k) return "";
    return k + " بن مطلق بن زيدان";
  }

  /** Parent is branch key or «X بن مطلق بن زيدان» (Integrity is_branch_root parent check). */
  function isBranchRootParentName(parentName, branchKey, norm) {
    var n = typeof norm === "function" ? norm : normalizeText;
    var parent = n(parentName || "");
    var branch = n(branchKey || "");
    if (!parent || !branch) return false;
    return parent === branch || parent === branchRootNameForKey(branch, n);
  }

  /**
   * أصل: رأس الفرع نفسه، أو ابن مباشر تحت رأس الفرع.
   * Example: «صلف» under «مزيد بن مطلق بن زيدان».
   */
  function isOriginPerson(nodeId, branchKey, opts) {
    var options = opts || {};
    var norm =
      typeof options.normalizePersonName === "function"
        ? options.normalizePersonName
        : normalizeText;
    var id = norm(nodeId || "");
    var branch = norm(branchKey || "");
    if (!id || !branch) return false;
    var root = branchRootNameForKey(branch, norm);
    if (id === branch || id === root) return true;

    var parent = norm(options.parentId || options.parentName || "");
    if (!parent && options.pathToRow) {
      var meta = options.pathToRow[id] || null;
      if (!meta && options.personId) {
        meta = options.pathToRow["pid:" + norm(options.personId)] || null;
      }
      if (meta) parent = norm(meta.db_parent_name || "");
    }
    if (!parent && id.indexOf("/") >= 0) {
      var parts = id.split("/").map(function (p) { return norm(p); }).filter(Boolean);
      if (parts.length >= 2) parent = parts.slice(0, -1).join("/");
    }
    return isBranchRootParentName(parent, branch, norm);
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

  /** Max typeahead hits — never dump the full branch into the person search UI. */
  var PERSON_SEARCH_LIMIT = 40;

  function personLeafName(path) {
    var n = normalizeText(path || "");
    if (!n) return "";
    var parts = n.split("/").map(normalizeText).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : n;
  }

  /**
   * Expand Arabic alef/hamza spellings so «عبدالإله» finds «عبدالاله» via ilike.
   * Returns unique non-empty variants (original first).
   */
  function arabicSearchQueryVariants(term) {
    var raw = normalizeText(term || "");
    if (!raw) return [];
    var collapsed = raw
      .replace(/[\u064B-\u065F\u0670]/g, "")
      .replace(/ـ/g, "")
      .replace(/[\u0622\u0623\u0625]/g, "\u0627")
      .replace(/\s+/g, " ")
      .trim();
    var out = [];
    var seen = Object.create(null);
    [raw, collapsed].forEach(function (v) {
      var n = normalizeText(v || "");
      if (!n || seen[n]) return;
      seen[n] = true;
      out.push(n);
    });
    return out;
  }

  /**
   * Build a PostgREST `.or(...)` clause for child_name/name ilike across variants.
   */
  function buildPersonNameIlikeOrFilter(term) {
    var variants = arabicSearchQueryVariants(term);
    if (!variants.length) return "";
    var parts = [];
    variants.forEach(function (v) {
      // Escape PostgREST special chars in patterns.
      var safe = String(v).replace(/[,()]/g, " ");
      if (!safe) return;
      parts.push("child_name.ilike.%" + safe + "%");
      parts.push("name.ilike.%" + safe + "%");
    });
    return parts.length ? parts.join(",") : "";
  }

  /**
   * Build capped person typeahead options from tree_children-like rows.
   * Prefer leaf-name matches (never auto-pick first; never rely on parent_name alone).
   * Ambiguous same-leaf names always include the full path for disambiguation.
   */
  function buildPersonSearchOptionsFromRows(rows, term, opts) {
    var o = opts || {};
    var q = normalizeText(term || "");
    var limit =
      typeof o.limit === "number" && o.limit > 0
        ? Math.min(Math.floor(o.limit), 50)
        : PERSON_SEARCH_LIMIT;
    var SpousesCore = root.AlzidanSpousesCore || {};
    var matchFn =
      typeof o.matchesOrderedSubstring === "function"
        ? o.matchesOrderedSubstring
        : SpousesCore && typeof SpousesCore.matchesOrderedSubstring === "function"
          ? SpousesCore.matchesOrderedSubstring
          : function (query, target) {
              var a = normalizeText(query).toLowerCase();
              var b = normalizeText(target).toLowerCase();
              return !!a && b.indexOf(a) !== -1;
            };

    var mapped = [];
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      if (!r) return;
      var path = normalizeText(
        r.person_lineage ||
          r.child_name ||
          r.full_name ||
          r.name ||
          r.path ||
          "",
      );
      if (!path) return;
      var personId = normalizeText(r.person_id || r.personId || "");
      var leaf =
        personLeafName(path) ||
        normalizeText(r.display_name || r.leaf || "");
      mapped.push({
        value: path,
        path: path,
        personId: personId,
        person_id: personId,
        leaf: leaf,
        label: leaf || path,
      });
    });

    // Prefer people whose leaf matches the query over descendants whose path
    // merely contains the query (parent_name / mid-path false positives).
    var qVariants = arabicSearchQueryVariants(q);
    var leafHits = mapped.filter(function (opt) {
      var leaf = normalizeText(opt.leaf || "");
      if (!leaf) return false;
      return qVariants.some(function (qv) {
        return leaf === qv || matchFn(qv, leaf);
      });
    });
    var pool = leafHits.length
      ? leafHits
      : mapped.filter(function (opt) {
          return qVariants.some(function (qv) {
            return matchFn(qv, opt.leaf || "") || matchFn(qv, opt.path || "");
          });
        });

    pool.sort(function (a, b) {
      var aLeaf = normalizeText(a.leaf || "");
      var bLeaf = normalizeText(b.leaf || "");
      var aExact = qVariants.indexOf(aLeaf) >= 0 ? 0 : aLeaf.indexOf(q) === 0 ? 1 : 2;
      var bExact = qVariants.indexOf(bLeaf) >= 0 ? 0 : bLeaf.indexOf(q) === 0 ? 1 : 2;
      if (aExact !== bExact) return aExact - bExact;
      var aPid = a.personId ? 0 : 1;
      var bPid = b.personId ? 0 : 1;
      if (aPid !== bPid) return aPid - bPid;
      return String(a.path || "").localeCompare(String(b.path || ""), "ar");
    });

    var leafCounts = Object.create(null);
    pool.forEach(function (opt) {
      var leaf = normalizeText(opt.leaf || "");
      if (!leaf) return;
      leafCounts[leaf] = (leafCounts[leaf] || 0) + 1;
    });

    var seen = Object.create(null);
    var out = [];
    for (var i = 0; i < pool.length && out.length < limit; i++) {
      var opt = pool[i];
      var id = opt.personId || opt.path;
      if (!id || seen[id]) continue;
      seen[id] = true;
      var leaf = normalizeText(opt.leaf || "");
      var label = leaf || opt.path;
      if (leaf && (leafCounts[leaf] || 0) > 1) {
        // Full path — never auto-pick; admin must choose the exact person.
        label = leaf + " — " + opt.path;
      }
      out.push({
        value: opt.path,
        path: opt.path,
        label: label,
        personId: opt.personId || "",
        person_id: opt.personId || "",
        leaf: leaf,
      });
    }
    return out;
  }

  /**
   * Sibling leaf-name collision under one father list.
   * On edit, pass excludeChildId / excludePersonId so the row being saved
   * is not treated as a duplicate of itself (birth_order / phone / dates).
   */
  function findSiblingNameCollision(siblings, childBase, opts) {
    var options = opts || {};
    var norm =
      typeof options.normalizePersonName === "function"
        ? options.normalizePersonName
        : normalizeText;
    var baseName =
      typeof options.normalizePersonBaseName === "function"
        ? options.normalizePersonBaseName
        : function (v) {
            var n = norm(v || "");
            if (!n) return "";
            var parts = n.split("/").map(norm).filter(Boolean);
            return parts.length ? parts[parts.length - 1] : n;
          };
    var want = baseName(childBase || "");
    if (!want) return "";
    var excludeChildId = norm(options.excludeChildId || "");
    var excludePersonId = norm(options.excludePersonId || "");
    var list = Array.isArray(siblings) ? siblings : [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i] || {};
      if (baseName(c.name || "") !== want) continue;
      var name = norm(c.name || "");
      var pid = norm(c.personId || c.person_id || "");
      if (excludeChildId && name === excludeChildId) continue;
      if (excludePersonId && pid && pid === excludePersonId) continue;
      return name;
    }
    return "";
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
    normalizePathKeyForDedupe: normalizePathKeyForDedupe,
    resolvePersonIdForNodePath: resolvePersonIdForNodePath,
    canonicalNodePathForPerson: canonicalNodePathForPerson,
    dedupePersonOptionsByPersonId: dedupePersonOptionsByPersonId,
    PERSON_SEARCH_LIMIT: PERSON_SEARCH_LIMIT,
    personLeafName: personLeafName,
    arabicSearchQueryVariants: arabicSearchQueryVariants,
    buildPersonNameIlikeOrFilter: buildPersonNameIlikeOrFilter,
    buildPersonSearchOptionsFromRows: buildPersonSearchOptionsFromRows,
    childrenForSelectedParent: childrenForSelectedParent,
    unionChildrenMapByParentPersonId: unionChildrenMapByParentPersonId,
    isolateChildrenMapArrays: isolateChildrenMapArrays,
    bindParentWriteContext: bindParentWriteContext,
    attachBoundParentToRow: attachBoundParentToRow,
    deriveParentIdFromChildPath: deriveParentIdFromChildPath,
    buildPathToRowIndex: buildPathToRowIndex,
    attachTreeRowIdsToChildren: attachTreeRowIdsToChildren,
    findTreeRowMeta: findTreeRowMeta,
    findTreeRowId: findTreeRowId,
    buildDeleteNameAttempts: buildDeleteNameAttempts,
    findSiblingNameCollision: findSiblingNameCollision,
    ORIGIN_LOCK_MSG: ORIGIN_LOCK_MSG,
    branchRootNameForKey: branchRootNameForKey,
    isBranchRootParentName: isBranchRootParentName,
    isOriginPerson: isOriginPerson,
  };
})(typeof window !== "undefined" ? window : globalThis);
