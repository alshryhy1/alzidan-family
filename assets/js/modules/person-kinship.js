/**
 * Member person-card kinship — same labels as the mobile encounter.
 * Paternal/maternal: أبوك / ابنك / شقيقك / أخ / أخ من الأب / أخ من أمك / جدك من الأب / حفيدك
 * Maternal uncles: جدك من الأم / خالك / ابن خالك / ابن خالتك
 * Proven only. Same-father is not assumed half-brother. Same first name is not assumed same mother.
 */
(function (root) {
  "use strict";

  var MATERNAL_LABELS = {
    "جدك من الأم": true,
    خالك: true,
    "ابن خالك": true,
    "ابن خالتك": true,
    "أخ من أمك": true,
  };

  var ENCOUNTER_LABELS = {
    "جدك من الأم": true,
    خالك: true,
    "ابن خالك": true,
    "ابن خالتك": true,
    "أخ من أمك": true,
    حفيدك: true,
    "حفيدك من ابنتك": true,
    "ابن أخيك": true,
    "ابن أختك": true,
    عمك: true,
    "ابن عمك": true,
    ابنك: true,
  };

  var BRANCHES = ["زيدان", "مزيد", "زايد", "لاحم", "ملحم"];

  var member = {
    viewer: null,
    maternalById: {},
    maternalByPath: {},
    allChildren: [],
    ctx: null,
    ready: false,
    loadPromise: null,
  };

  function pathAliases(person) {
    var aliases = {};
    function add(value) {
      var key = normalizePathKey(value);
      if (key) aliases[key] = true;
    }
    add(nodePathId(person));
    add(person && person.name);
    add(person && person.parentName ? person.parentName + "/" + leafPersonName(person.name || "") : "");
    return Object.keys(aliases);
  }

  function indexMaternalMaps(children, maternalById) {
    var byPath = {};
    (children || []).forEach(function (child) {
      var label = maternalById[Number(child.id)];
      if (!label) return;
      pathAliases(child).forEach(function (alias) {
        if (!byPath[alias]) byPath[alias] = label;
      });
    });
    return byPath;
  }

  function findTarget(nodeId, rows, branchKey, extraRows) {
    var wanted = normalizePathKey(nodeId);
    var people = []
      .concat(Array.isArray(rows) ? rows : [])
      .concat(Array.isArray(extraRows) ? extraRows : [])
      .map(function (row) {
        return row && row.id != null && row.name != null ? row : childFromRow(row, branchKey);
      });
    var seen = {};
    people = people.filter(function (person) {
      var dedupe = String(person.id || "") + "|" + nodePathId(person);
      if (seen[dedupe]) return false;
      seen[dedupe] = true;
      return true;
    });
    function pathMatches(person) {
      var path = nodePathId(person);
      return path === wanted || normalizePathKey(person.name) === wanted;
    }
    var matches = people.filter(pathMatches);
    if (matches.length !== 1) {
      var parts = String(nodeId || "")
        .split("/")
        .map(function (part) {
          return part.trim();
        })
        .filter(Boolean);
      var wantedLeaf = arabicNorm(parts.length ? parts[parts.length - 1] : "");
      var wantedParent = normalizePathKey(parts.slice(0, -1).join("/"));
      if (wantedLeaf) {
        matches = people.filter(function (person) {
          if (arabicNorm(leafPersonName(person.name || "")) !== wantedLeaf) return false;
          if (!wantedParent) return pathMatches(person);
          var parent = normalizePathKey(effectiveParentName(person));
          return parent === wantedParent || nodePathId(person) === wanted;
        });
      }
    }
    if (matches.length > 1) {
      var withId = matches.filter(function (person) {
        return Number(person.id) > 0;
      });
      if (withId.length) matches = withId;
    }
    if (matches.length >= 1) {
      var byKey = {};
      matches.forEach(function (person) {
        var key = String(Number(person.id) || nodePathId(person));
        if (!byKey[key]) byKey[key] = person;
      });
      var unique = Object.keys(byKey).map(function (key) {
        return byKey[key];
      });
      if (unique.length === 1) return unique[0];
      var uniquePaths = {};
      unique.forEach(function (person) {
        var path = nodePathId(person);
        if (path && !uniquePaths[path]) uniquePaths[path] = person;
      });
      var pathKeys = Object.keys(uniquePaths);
      if (pathKeys.length === 1) return uniquePaths[pathKeys[0]];
    }
    var parts = String(nodeId || "")
      .split("/")
      .map(function (part) {
        return part.trim();
      })
      .filter(Boolean);
    return {
      id: 0,
      name: String(nodeId || ""),
      parentName: parts.slice(0, -1).join("/"),
      branchKey: String(branchKey || ""),
      gender: null,
    };
  }

  function maternalLabelForTarget(viewerId, target, byId, byPath, ctx) {
    if (!viewerId || !target) return null;
    var fromId = target.id ? byId[Number(target.id)] : null;
    if (fromId) return fromId;
    var aliases = pathAliases(target);
    for (var i = 0; i < aliases.length; i += 1) {
      if (byPath[aliases[i]]) return byPath[aliases[i]];
    }
    var viewer =
      (ctx && ctx.viewerPerson && Number(ctx.viewerPerson.id) === Number(viewerId)
        ? ctx.viewerPerson
        : null) || { id: viewerId };
    if (ctx) {
      var linked = linkLabelForTarget(viewer, target, ctx);
      if (linked) return linked;
    }
    if (ctx && target.id) return resolveMaternalKinshipLabel(viewerId, target.id, ctx);
    if (ctx && target.name) {
      var resolved = findTarget(target.name, ctx.children, target.branchKey, []);
      if (resolved.id) {
        var fromResolved = byId[Number(resolved.id)] || resolveMaternalKinshipLabel(viewerId, resolved.id, ctx);
        if (fromResolved) return fromResolved;
      }
    }
    return null;
  }

  function linkLabelForTarget(viewer, target, ctx) {
    if (!viewer || !target || !ctx) return null;
    var map = linkKinshipByTargetId(viewer, ctx);
    if (target.id && map[Number(target.id)]) return map[Number(target.id)];
    var targetPath = nodePathId(target);
    var targetParent = normalizePathKey(effectiveParentName(target));
    var targetLeaf = arabicNorm(leafPersonName(target.name || targetPath));
    var children = ctx.children || [];
    for (var i = 0; i < children.length; i += 1) {
      var child = children[i];
      var label = map[Number(child.id)];
      if (!label) continue;
      if (targetPath && nodePathId(child) === targetPath) return label;
      if (targetLeaf && arabicNorm(leafPersonName(child.name || "")) === targetLeaf) {
        var childParent = normalizePathKey(effectiveParentName(child));
        if (targetParent && childParent === targetParent) return label;
      }
    }
    return null;
  }

  function setMemberState(viewer, maternalById, maternalByPath, allChildren, ctx, ready) {
    member = {
      viewer: viewer || null,
      maternalById: maternalById || {},
      maternalByPath: maternalByPath || {},
      allChildren: Array.isArray(allChildren) ? allChildren : [],
      ctx: ctx || null,
      ready: ready === true,
      loadPromise: member.loadPromise || null,
    };
  }

  function clearMember() {
    member.loadPromise = null;
    setMemberState(null, {}, {}, [], null, false);
  }

  function notifyKinshipReady() {
    try {
      if (typeof window !== "undefined" && window.dispatchEvent) {
        window.dispatchEvent(new CustomEvent("alzidan-kinship-ready"));
      }
    } catch (e) {}
  }

  function encounterForCard(input) {
    var viewer = member.viewer;
    if (!viewer || !Number(viewer.id)) {
      return { mode: "visitor", kinship: null, sharedBadge: null, ready: member.ready };
    }
    var nodeId = input && input.nodeId;
    var branchKey = input && input.branchKey;
    var rows = input && input.rows;
    var target = findTarget(nodeId, rows, branchKey, member.allChildren);
    var viewerPath = nodePathId(viewer);
    var targetPath = nodePathId(target);
    if (Number(target.id) && Number(viewer.id) === Number(target.id)) {
      return { mode: "self", kinship: null, sharedBadge: null, ready: member.ready };
    }
    if (viewerPath && targetPath && viewerPath === targetPath) {
      return { mode: "self", kinship: null, sharedBadge: null, ready: member.ready };
    }
    var maternal = maternalLabelForTarget(
      viewer.id,
      target,
      member.maternalById,
      member.maternalByPath,
      member.ctx,
    );
    var kinship = resolveProvenKinshipLabel(viewer, target, maternal, member.ctx);
    var sharedBadge = kinship ? null : resolveSharedAncestorBadge(viewer, target);
    return { mode: "member", kinship: kinship, sharedBadge: sharedBadge, ready: member.ready };
  }

  function isPublicLineageHiddenPerson(person) {
    var gender = String((person && person.gender) || "")
      .trim()
      .toLowerCase();
    return (
      gender === "daughter" ||
      gender === "female" ||
      gender === "f" ||
      gender === "أنثى" ||
      gender === "انثى" ||
      gender === "ابنة" ||
      gender === "بنت"
    );
  }

  function leafPersonName(value) {
    var parts = String(value || "")
      .split("/")
      .map(function (part) {
        return part
          .trim()
          .replace(/\s*رحمه الله\s*/g, "")
          .replace(/\s*\(رحمه الله\)\s*/g, "");
      })
      .filter(Boolean);
    return parts.length ? parts[parts.length - 1] : String(value || "").trim();
  }

  function normalizePathKey(value) {
    return arabicNorm(
      String(value || "")
        .replace(/\s*رحمه الله\s*/g, "")
        .replace(/\s*\(رحمه الله\)\s*/g, ""),
    );
  }

  function nodePathId(person) {
    var rawName = String((person && person.name) || "").trim();
    var nameKey = normalizePathKey(rawName);
    if (!nameKey) return "";
    if (rawName.indexOf("/") >= 0) return nameKey;
    var parentKey = normalizePathKey((person && person.parentName) || "");
    var leaf = normalizePathKey(leafPersonName(rawName));
    if (parentKey && leaf) {
      if (parentKey === leaf || parentKey.slice(-("/" + leaf).length) === "/" + leaf) {
        return parentKey;
      }
      return parentKey + "/" + leaf;
    }
    return nameKey;
  }

  function pathSegments(person) {
    var id = nodePathId(person);
    if (!id) return [];
    return id
      .split("/")
      .map(function (part) {
        return part.trim();
      })
      .filter(Boolean);
  }

  function commonPrefixLength(left, right) {
    var limit = Math.min(left.length, right.length);
    var index = 0;
    while (
      index < limit &&
      normalizePathKey(left[index] || "") === normalizePathKey(right[index] || "")
    ) {
      index += 1;
    }
    return index;
  }

  function grandfatherOrdinalLabel(generationsUp) {
    if (generationsUp === 2) return "الجد";
    if (generationsUp === 3) return "الجد الثاني";
    if (generationsUp === 4) return "الجد الرابع";
    if (generationsUp === 5) return "الجد الخامس";
    return null;
  }

  function parentPathKey(path) {
    var parts = normalizePathKey(path)
      .split("/")
      .map(function (part) {
        return part.trim();
      })
      .filter(Boolean);
    if (parts.length < 2) return "";
    return parts.slice(0, -1).join("/");
  }

  /** Derive parent path from full child path when parent_name is missing in tree rows. */
  function effectiveParentName(person) {
    var explicit = String((person && person.parentName) || "").trim();
    if (explicit) return explicit;
    var path = nodePathId(person);
    if (!path) return "";
    return parentPathKey(path);
  }

  function resolveProvenKinshipLabel(viewer, target, maternalLabel, ctx) {
    if (!viewer || !target) return null;
    if (Number(viewer.id) && Number(target.id) && Number(viewer.id) === Number(target.id)) {
      return null;
    }

    var maternal = String(maternalLabel || "").trim();
    if (!maternal && ctx && target) {
      maternal = linkLabelForTarget(viewer, target, ctx) || "";
      if (!maternal && viewer.id && target.id) {
        maternal = resolveMaternalKinshipLabel(viewer.id, target.id, ctx) || "";
      }
    }

    var viewerNode = nodePathId(viewer);
    var targetNode = nodePathId(target);
    if (!viewerNode || !targetNode) return maternal || null;

    var viewerParent = normalizePathKey(effectiveParentName(viewer));
    var targetParent = normalizePathKey(effectiveParentName(target));

    if (viewerParent && viewerParent === targetNode) return "أبوك";
    if (targetParent && targetParent === viewerNode) return "ابنك";
    if (maternal === "ابنك") return "ابنك";
    if (viewerParent && targetParent && viewerParent === targetParent) {
      var bond = siblingBondKind(viewer, target, ctx || null);
      if (bond === "full") return "شقيقك";
      if (bond === "paternal") return "أخ من الأب";
      if (maternal === "أخ من أمك") return "شقيقك";
      return "أخ";
    }

    var paternalGrandfather = parentPathKey(effectiveParentName(viewer) || viewer.parentName);
    if (paternalGrandfather && paternalGrandfather === targetNode) return "جدك من الأب";
    var targetPaternalGrandfather = parentPathKey(effectiveParentName(target) || target.parentName);
    if (targetPaternalGrandfather && targetPaternalGrandfather === viewerNode) return "حفيدك";

    if (maternal === "حفيدك من ابنتك") return "حفيدك من ابنتك";
    if (maternal === "ابن أختك") return "ابن أختك";
    if (maternal === "أخ من أمك") return "أخ من أمك";
    if (maternal === "حفيدك") return "حفيدك";

    var viewerPath = pathSegments(viewer);
    var targetPath = pathSegments(target);
    var shared = commonPrefixLength(viewerPath, targetPath);
    if (!shared) return maternal || null;

    var viewerUp = viewerPath.length - shared;
    var targetUp = targetPath.length - shared;

    if (targetUp === 0 && viewerUp === 2) return "جدك من الأب";
    if (viewerUp === 0 && targetUp === 2) {
      if (maternal === "حفيدك من ابنتك") return "حفيدك من ابنتك";
      return "حفيدك";
    }
    if (viewerUp === 1 && targetUp === 2) {
      if (maternal === "ابن أختك") return "ابن أختك";
      return "ابن أخيك";
    }
    if (viewerUp === 2 && targetUp === 1) {
      if (maternal === "خالك") return "خالك";
      return "عمك";
    }
    if (viewerUp === 2 && targetUp === 2) {
      if (
        maternal === "أخ من أمك" ||
        maternal === "ابن خالك" ||
        maternal === "ابن خالتك"
      ) {
        return maternal;
      }
      return "ابن عمك";
    }

    return maternal || null;
  }

  function resolveSharedAncestorBadge(viewer, target) {
    if (!viewer || !target) return null;
    if (Number(viewer.id) && Number(target.id) && Number(viewer.id) === Number(target.id)) {
      return null;
    }
    if (resolveProvenKinshipLabel(viewer, target)) return null;

    var viewerPath = pathSegments(viewer);
    var targetPath = pathSegments(target);
    if (viewerPath.length < 2 || targetPath.length < 2) return null;

    var shared = commonPrefixLength(viewerPath, targetPath);
    if (!shared) return null;

    var viewerUp = viewerPath.length - shared;
    var targetUp = targetPath.length - shared;
    if (viewerUp < 1 || targetUp < 1) return null;

    var meetAt = Math.max(viewerUp, targetUp);
    var ancestorName = leafPersonName(viewerPath[shared - 1] || "");
    if (!ancestorName) return null;

    var ordinal = grandfatherOrdinalLabel(meetAt);
    if (!ordinal) return null;
    if (meetAt >= 4) return "لا يجمعكما إلا " + ordinal + ": " + ancestorName;
    return "يجمعكما " + ordinal + ": " + ancestorName;
  }

  function arabicNorm(value) {
    return String(value || "")
      .replace(/[\u064B-\u065F\u0670]/g, "")
      .replace(/ـ/g, "")
      .replace(/[أإآ]/g, "ا")
      .replace(/ة/g, "ه")
      .replace(/ى/g, "ي")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function nasabTokens(value) {
    return arabicNorm(value)
      .replace(/(^|\s)(بنت|بن|ابن)(\s|$)/g, " ")
      .split(" ")
      .map(function (part) {
        return part.trim();
      })
      .filter(Boolean);
  }

  function parentPathOf(path) {
    return parentPathKey(path);
  }

  function lineagePath(value) {
    var raw = String(value || "").trim();
    if (raw.indexOf("/") < 0) return "";
    return normalizePathKey(raw);
  }

  function samePath(left, right) {
    var a = normalizePathKey(left);
    var b = normalizePathKey(right);
    return Boolean(a && b && a === b);
  }

  function isSonRow(row) {
    return !isPublicLineageHiddenPerson(row);
  }

  function childPath(row) {
    return nodePathId(row);
  }

  function uniqueByNasab(rows, branchKey, query) {
    var tokens = nasabTokens(query);
    var wanted = tokens[0] || "";
    var father = tokens[1] || "";
    if (!wanted) return null;
    var branch = arabicNorm(branchKey);
    var inBranch = rows.filter(function (row) {
      if (branch && arabicNorm(row.branchKey) !== branch) return false;
      return arabicNorm(leafPersonName(row.name)) === wanted;
    });
    if (inBranch.length === 1) return inBranch[0];
    if (inBranch.length > 1 && father) {
      var narrowed = inBranch.filter(function (row) {
        return arabicNorm(leafPersonName(row.parentName)) === father;
      });
      return narrowed.length === 1 ? narrowed[0] : null;
    }
    return null;
  }

  function uniqueFatherNodeFromNasab(rows, branchKey, query) {
    var tokens = nasabTokens(query);
    var father = tokens[1] || "";
    var grandfather = tokens[2] || "";
    if (!father) return null;
    var branch = arabicNorm(branchKey);
    var matches = rows.filter(function (row) {
      if (branch && arabicNorm(row.branchKey) !== branch) return false;
      if (arabicNorm(leafPersonName(row.name)) !== father) return false;
      if (grandfather && arabicNorm(leafPersonName(row.parentName)) !== grandfather) {
        return false;
      }
      return true;
    });
    return matches.length === 1 ? matches[0] : null;
  }

  function uniqueMaleNodeByPath(rows, path, branchKey) {
    var wanted = normalizePathKey(path);
    var branch = normalizePathKey(branchKey);
    if (!wanted) return null;
    var matches = rows.filter(function (row) {
      if (!isSonRow(row)) return false;
      if (branch && normalizePathKey(row.branchKey) !== branch) return false;
      return childPath(row) === wanted || normalizePathKey(row.name) === wanted;
    });
    return matches.length === 1 ? matches[0] : null;
  }

  function isConfirmedLink(confidence) {
    var value = String(confidence || "")
      .trim()
      .toLowerCase();
    return !value || value === "confirmed";
  }

  function isActiveSpouse(status) {
    var value = String(status || "active")
      .trim()
      .toLowerCase();
    return !value || value === "active";
  }

  function isFamilyMember(value) {
    if (value === true || value === 1) return true;
    if (typeof value === "string") {
      var v = value.trim().toLowerCase();
      return v === "true" || v === "t" || v === "yes" || v === "y" || v === "1" || v === "نعم";
    }
    return false;
  }

  function uniqueSpouseForSister(spouses, sister) {
    var sisterPath = childPath(sister);
    var sisterLeaf = arabicNorm(leafPersonName(sister.name));
    var branch = normalizePathKey(sister.branchKey);

    var byPath = spouses.filter(function (spouse) {
      if (!isActiveSpouse(spouse.status) || !isFamilyMember(spouse.wifeIsFamilyMember)) {
        return false;
      }
      var path = lineagePath(spouse.wifeLineage);
      return Boolean(path && sisterPath && path === sisterPath);
    });
    if (byPath.length === 1) return byPath[0];
    if (byPath.length > 1) return null;

    if (!sisterLeaf) return null;
    var byLeaf = spouses.filter(function (spouse) {
      if (!isActiveSpouse(spouse.status) || !isFamilyMember(spouse.wifeIsFamilyMember)) {
        return false;
      }
      if (lineagePath(spouse.wifeLineage)) return false;
      if (branch && spouse.wifeBranchKey && normalizePathKey(spouse.wifeBranchKey) !== branch) {
        return false;
      }
      var nameLeaf =
        nasabTokens(spouse.wifeName || "")[0] || arabicNorm(leafPersonName(spouse.wifeName || ""));
      var lineageLeaf =
        nasabTokens(spouse.wifeLineage || "")[0] ||
        arabicNorm(leafPersonName(spouse.wifeLineage || ""));
      return nameLeaf === sisterLeaf || lineageLeaf === sisterLeaf;
    });
    return byLeaf.length === 1 ? byLeaf[0] : null;
  }

  function normalizeSpouseRow(row) {
    if (!row) return null;
    var id = Number(row.id || 0);
    if (!id) return null;
    return {
      id: id,
      husbandId: Number(row.husbandId || row.husband_id || 0),
      wifeName: row.wifeName != null ? row.wifeName : row.wife_name,
      wifeLineage: row.wifeLineage != null ? row.wifeLineage : row.wife_lineage,
      wifeIsFamilyMember:
        row.wifeIsFamilyMember != null ? row.wifeIsFamilyMember : row.wife_is_family_member,
      wifeBranchKey: row.wifeBranchKey != null ? row.wifeBranchKey : row.wife_branch_key,
      status: row.status,
    };
  }

  function fatherNodeForViewer(viewer, ctx) {
    var fatherPath = normalizePathKey(effectiveParentName(viewer));
    if (!fatherPath) return null;
    var matches = (ctx && ctx.children ? ctx.children : []).filter(function (row) {
      if (!isSonRow(row)) return false;
      return nodePathId(row) === fatherPath || normalizePathKey(row.name) === fatherPath;
    });
    return matches.length === 1 ? matches[0] : null;
  }

  function activeWifeCountByHusband(spouses) {
    var counts = {};
    (spouses || []).forEach(function (spouse) {
      if (!spouse || !spouse.husbandId || !isActiveSpouse(spouse.status)) return;
      counts[spouse.husbandId] = (counts[spouse.husbandId] || 0) + 1;
    });
    return counts;
  }

  function wifeNasabText(spouse) {
    var name = String((spouse && spouse.wifeName) || "").trim();
    var lineage = String((spouse && spouse.wifeLineage) || "").trim();
    var nameCount = nasabTokens(name).length;
    var lineageCount = nasabTokens(lineage).length;
    if (lineageCount > nameCount) return lineage;
    if (nameCount > lineageCount) return name;
    if (lineage.indexOf("/") >= 0) return lineage;
    return lineage || name;
  }

  function wifeRoleTowardViewer(spouse, viewer) {
    if (!spouse || !viewer || !isFamilyMember(spouse.wifeIsFamilyMember)) return null;
    if (!isActiveSpouse(spouse.status)) return null;
    var viewerPath = normalizePathKey(nodePathId(viewer));
    var viewerParent = normalizePathKey(effectiveParentName(viewer));
    var viewerGf = parentPathKey(viewerParent);
    var nasab = wifeNasabText(spouse);
    var lineage = lineagePath(spouse.wifeLineage) || lineagePath(nasab);
    var tokens = nasabTokens(nasab);
    var wifeLeaf = tokens[0] || "";
    var wifeFather = tokens[1] || "";
    var wifeGf = tokens[2] || "";
    var selfLeaf = arabicNorm(leafPersonName(viewerPath));
    var fatherLeaf = arabicNorm(leafPersonName(viewerParent));
    var gfLeaf = arabicNorm(leafPersonName(viewerGf));

    if (lineage && viewerPath && lineage === viewerPath) return "self";
    if (selfLeaf && wifeLeaf === selfLeaf && wifeFather && fatherLeaf && wifeFather === fatherLeaf) {
      if (!wifeGf || !gfLeaf || wifeGf === gfLeaf) return "self";
    }
    if (lineage && viewerPath && parentPathOf(lineage) === viewerPath) return "daughter";
    if (
      wifeFather &&
      selfLeaf &&
      wifeFather === selfLeaf &&
      wifeLeaf &&
      wifeLeaf !== selfLeaf
    ) {
      if (!wifeGf || !fatherLeaf || wifeGf === fatherLeaf) return "daughter";
    }
    if (lineage && viewerParent && parentPathOf(lineage) === viewerParent && lineage !== viewerPath) {
      return "sister";
    }
    if (
      wifeFather &&
      fatherLeaf &&
      wifeFather === fatherLeaf &&
      wifeLeaf &&
      wifeLeaf !== selfLeaf
    ) {
      if (!wifeGf || !gfLeaf || wifeGf === gfLeaf) return "sister";
    }
    return null;
  }

  function childIdsForSpouse(spouse, ctx, wifeCounts) {
    var ids = [];
    var seen = {};
    (ctx && ctx.motherLinks ? ctx.motherLinks : []).forEach(function (item) {
      if (Number(item.spouseId) !== Number(spouse.id)) return;
      if (!isConfirmedLink(item.confidence)) return;
      var childId = Number(item.childId || 0);
      if (!childId || seen[childId]) return;
      seen[childId] = true;
      ids.push(childId);
    });
    if (ids.length) return ids;
    if ((wifeCounts && wifeCounts[spouse.husbandId] ? wifeCounts[spouse.husbandId] : 0) !== 1) {
      return [];
    }
    var husband = ((ctx && ctx.children) || []).filter(function (row) {
      return Number(row.id) === Number(spouse.husbandId);
    })[0];
    if (!husband) return [];
    sonsOfParent(ctx, nodePathId(husband), husband.branchKey).forEach(function (son) {
      var childId = Number(son.id || 0);
      if (!childId || seen[childId]) return;
      seen[childId] = true;
      ids.push(childId);
    });
    return ids;
  }

  function linkKinshipByTargetId(viewer, ctx) {
    var map = {};
    if (!viewer || !ctx) return map;
    var counts = activeWifeCountByHusband(ctx.spouses);
    (ctx.spouses || []).forEach(function (spouse) {
      var role = wifeRoleTowardViewer(spouse, viewer);
      if (!role) return;
      var label =
        role === "self" ? "ابنك" : role === "daughter" ? "حفيدك من ابنتك" : role === "sister" ? "ابن أختك" : "";
      if (!label) return;
      childIdsForSpouse(spouse, ctx, counts).forEach(function (childId) {
        if (!childId || childId === Number(viewer.id)) return;
        var child = ((ctx.children || []).filter(function (row) {
          return Number(row.id) === childId;
        })[0] || { id: childId, gender: "son" });
        if (child.gender && !isSonRow(child)) return;
        if (!map[childId]) map[childId] = label;
      });
    });
    return map;
  }

  function inferMotherSpouse(viewer, ctx) {
    if (!viewer || !ctx) return null;
    var link = confirmedMotherLinkForChild(viewer.id, ctx);
    if (link) {
      return (
        (ctx.spouses || []).filter(function (row) {
          return Number(row.id) === Number(link.spouseId);
        })[0] || null
      );
    }
    var father = fatherNodeForViewer(viewer, ctx);
    if (!father) return null;
    var wives = (ctx.spouses || []).filter(function (spouse) {
      return Number(spouse.husbandId) === Number(father.id) && isActiveSpouse(spouse.status);
    });
    if (wives.length !== 1 || !isFamilyMember(wives[0].wifeIsFamilyMember)) return null;
    return wives[0];
  }

  function resolveMotherNode(viewerId, ctx) {
    var viewer =
      (ctx && ctx.viewerPerson && Number(ctx.viewerPerson.id) === Number(viewerId)
        ? ctx.viewerPerson
        : null) ||
      ((ctx && ctx.children) || []).filter(function (row) {
        return Number(row.id) === Number(viewerId);
      })[0] || { id: viewerId };
    var link = (ctx.motherLinks || []).filter(function (row) {
      return Number(row.childId) === Number(viewerId) && isConfirmedLink(row.confidence);
    })[0];
    var spouse = inferMotherSpouse(viewer, ctx);
    if (!link && !spouse) return null;
    var isMember = spouse
      ? isFamilyMember(spouse.wifeIsFamilyMember)
      : !!(link && isFamilyMember(link.motherIsFamilyMember));
    if (!isMember) return null;

    var lineage = String((spouse && spouse.wifeLineage) || (link && link.motherLineage) || "").trim();
    var name = String((spouse && spouse.wifeName) || (link && link.motherName) || "").trim();
    var branchKey = String((spouse && spouse.wifeBranchKey) || (link && link.motherBranchKey) || "").trim();
    var path = lineagePath(lineage);

    var node = null;
    if (path) {
      var matches = ctx.children.filter(function (row) {
        if (branchKey && normalizePathKey(row.branchKey) !== normalizePathKey(branchKey)) {
          return false;
        }
        return childPath(row) === path || normalizePathKey(row.name) === path;
      });
      if (matches.length === 1) node = matches[0];
      else if (matches.length > 1) return null;
    }
    if (!node && (name || lineage)) {
      node = uniqueByNasab(ctx.children, branchKey, name || lineage);
    }
    if (!node && (name || lineage)) {
      var fatherNode = uniqueFatherNodeFromNasab(ctx.children, branchKey, name || lineage);
      if (fatherNode) {
        var fatherPath = childPath(fatherNode);
        if (fatherPath) {
          return {
            node: null,
            grandfatherPath: fatherPath,
            branchKey: fatherNode.branchKey || branchKey,
            maternalGrandfather: fatherNode,
          };
        }
      }
    }
    if (!node && path) {
      var gfFromPath = parentPathOf(path);
      if (!gfFromPath) return null;
      return {
        node: null,
        grandfatherPath: gfFromPath,
        branchKey: branchKey,
        maternalGrandfather: uniqueMaleNodeByPath(ctx.children, gfFromPath, branchKey),
      };
    }
    if (!node) return null;

    var grandfatherPath = normalizePathKey(node.parentName) || parentPathOf(childPath(node));
    if (!grandfatherPath) return null;
    var resolvedBranch = node.branchKey || branchKey;
    return {
      node: node,
      grandfatherPath: grandfatherPath,
      branchKey: resolvedBranch,
      maternalGrandfather: uniqueMaleNodeByPath(ctx.children, grandfatherPath, resolvedBranch),
    };
  }

  function sonsOfParent(ctx, parentPath, branchKey) {
    var parent = normalizePathKey(parentPath);
    var branch = normalizePathKey(branchKey);
    if (!parent) return [];
    return ctx.children.filter(function (row) {
      if (!isSonRow(row)) return false;
      if (branch && normalizePathKey(row.branchKey) !== branch) return false;
      var rowParent = normalizePathKey(row.parentName);
      return Boolean(rowParent && rowParent === parent);
    });
  }

  function daughtersOfParent(ctx, parentPath, branchKey) {
    var parent = normalizePathKey(parentPath);
    var branch = normalizePathKey(branchKey);
    if (!parent) return [];
    return ctx.children.filter(function (row) {
      if (!isPublicLineageHiddenPerson(row)) return false;
      if (branch && normalizePathKey(row.branchKey) !== branch) return false;
      return normalizePathKey(row.parentName) === parent;
    });
  }

  function motherIdentityKeys(link, spouse) {
    var keys = {};
    function add(value, minTokens) {
      var raw = String(value || "").trim();
      if (!raw) return;
      var norm = arabicNorm(raw);
      var tokens = nasabTokens(raw);
      if (norm && tokens.length >= (minTokens || 2)) keys[norm] = true;
      var path = lineagePath(raw);
      if (path) keys["path:" + path] = true;
      if (tokens.length >= 3) keys["t3:" + tokens.slice(0, 3).join(" ")] = true;
      if (tokens.length >= 2) keys["t2:" + tokens.slice(0, 2).join(" ")] = true;
    }
    if (spouse) {
      add(spouse.wifeLineage, 1);
      add(spouse.wifeName, 2);
    }
    if (link) {
      add(link.motherLineage, 1);
      add(link.motherName, 2);
    }
    return Object.keys(keys).filter(Boolean);
  }

  function motherLinksShareIdentity(viewerLink, viewerSpouse, otherLink, otherSpouse) {
    if (
      viewerLink &&
      otherLink &&
      Number(viewerLink.spouseId || 0) > 0 &&
      Number(viewerLink.spouseId) === Number(otherLink.spouseId)
    ) {
      return true;
    }
    var left = motherIdentityKeys(viewerLink, viewerSpouse);
    var right = motherIdentityKeys(otherLink, otherSpouse);
    if (!left.length || !right.length) return false;
    for (var i = 0; i < left.length; i += 1) {
      for (var j = 0; j < right.length; j += 1) {
        if (left[i] === right[j]) return true;
      }
    }
    return false;
  }

  function confirmedMotherLinkForChild(childId, ctx) {
    if (!ctx || !childId) return null;
    return (
      (ctx.motherLinks || []).filter(function (item) {
        return Number(item.childId) === Number(childId) && isConfirmedLink(item.confidence);
      })[0] || null
    );
  }

  function shareProvenFather(left, right) {
    var a = normalizePathKey(effectiveParentName(left));
    var b = normalizePathKey(effectiveParentName(right));
    return Boolean(a && b && a === b);
  }

  function shareProvenMother(leftId, rightId, ctx) {
    var leftLink = confirmedMotherLinkForChild(leftId, ctx);
    var rightLink = confirmedMotherLinkForChild(rightId, ctx);
    if (!leftLink || !rightLink) return false;
    var spouseMap = spouseByIdMap((ctx && ctx.spouses) || []);
    return motherLinksShareIdentity(
      leftLink,
      spouseMap[Number(leftLink.spouseId)],
      rightLink,
      spouseMap[Number(rightLink.spouseId)],
    );
  }

  function provenDifferentMother(leftId, rightId, ctx) {
    var leftLink = confirmedMotherLinkForChild(leftId, ctx);
    var rightLink = confirmedMotherLinkForChild(rightId, ctx);
    if (!leftLink || !rightLink) return false;
    return !shareProvenMother(leftId, rightId, ctx);
  }

  function siblingBondKind(viewer, other, ctx) {
    if (!viewer || !other) return null;
    var sameFather = shareProvenFather(viewer, other);
    var sameMother = shareProvenMother(viewer.id, other.id, ctx);
    if (sameFather && sameMother) return "full";
    if (sameFather && provenDifferentMother(viewer.id, other.id, ctx)) return "paternal";
    if (sameMother && !sameFather) return "maternal";
    if (sameFather) return "brother";
    return null;
  }

  function siblingCardSuffix(kind) {
    if (kind === "full") return "شقيق";
    if (kind === "paternal") return "من الأب";
    if (kind === "maternal") return "من الأم";
    return "";
  }

  function siblingChipClass(kind) {
    if (kind === "full") return "is-full-kin";
    if (kind === "paternal") return "is-paternal-kin";
    if (kind === "maternal") return "is-maternal-kin";
    if (kind === "grandson") return "is-grandson-kin";
    if (kind === "nephew") return "is-nephew-kin";
    if (kind === "uncle" || kind === "cousin") return "is-paternal-kin";
    return "";
  }

  function spouseByIdMap(spouses) {
    var map = {};
    (spouses || []).forEach(function (row) {
      if (row && row.id) map[Number(row.id)] = row;
    });
    return map;
  }

  function normalizeMotherLinkRow(row) {
    return {
      childId: Number(row.childId || row.child_id || 0),
      spouseId: Number(row.spouseId || row.spouse_id || 0),
      motherName: row.motherName != null ? row.motherName : row.mother_name,
      motherLineage: row.motherLineage != null ? row.motherLineage : row.mother_lineage,
      motherIsFamilyMember:
        row.motherIsFamilyMember != null ? row.motherIsFamilyMember : row.mother_is_family_member,
      motherBranchKey:
        row.motherBranchKey != null ? row.motherBranchKey : row.mother_branch_key,
      confidence: row.confidence,
    };
  }

  function dedupeMotherLinks(links) {
    var seen = {};
    var out = [];
    (links || []).forEach(function (row) {
      var normalized = normalizeMotherLinkRow(row);
      if (!normalized.childId || !normalized.spouseId) return;
      var key = normalized.childId + "|" + normalized.spouseId;
      if (seen[key]) return;
      seen[key] = true;
      out.push(normalized);
    });
    return out;
  }

  async function loadMotherLinksForSpouseIds(sb, spouseIds) {
    var ids = Array.from(new Set((spouseIds || []).map(Number).filter(Boolean)));
    var out = [];
    for (var i = 0; i < ids.length; i += 1) {
      var rows = await selectRows(sb, "tree_mother_links", {
        select:
          "child_id,spouse_id,mother_name,mother_lineage,mother_is_family_member,mother_branch_key,confidence",
        eq: { spouse_id: ids[i] },
        limit: 500,
      });
      rows.forEach(function (row) {
        out.push(normalizeMotherLinkRow(row));
      });
    }
    return dedupeMotherLinks(out);
  }

  async function expandMotherLinksForViewer(sb, viewerId, initialLinks, initialSpouses) {
    var links = dedupeMotherLinks(initialLinks || []);
    var spouses = Array.isArray(initialSpouses) ? initialSpouses.slice() : [];
    var viewerLink = links.filter(function (item) {
      return Number(item.childId) === Number(viewerId) && isConfirmedLink(item.confidence);
    })[0];
    if (!viewerLink) return { motherLinks: links, spouses: spouses };

    var spouseMap = spouseByIdMap(spouses);
    var viewerSpouse = spouseMap[Number(viewerLink.spouseId)];
    var spouseRows = await selectRows(sb, "tree_spouses", {
      select:
        "id,husband_id,wife_name,wife_lineage,wife_is_family_member,wife_branch_key,status",
      limit: 5000,
    });
    var matchingSpouseIds = [];
    spouseRows.forEach(function (row) {
      if (!isFamilyMember(row.wife_is_family_member)) return;
      var spouse = {
        id: Number(row.id || 0),
        husbandId: Number(row.husband_id || 0),
        wifeName: row.wife_name,
        wifeLineage: row.wife_lineage,
        wifeIsFamilyMember: row.wife_is_family_member,
        wifeBranchKey: row.wife_branch_key,
        status: row.status,
      };
      if (
        motherLinksShareIdentity(
          viewerLink,
          viewerSpouse,
          { motherLineage: viewerLink.motherLineage, motherName: viewerLink.motherName },
          spouse,
        )
      ) {
        matchingSpouseIds.push(spouse.id);
      }
    });
    matchingSpouseIds.push(Number(viewerLink.spouseId || 0));
    matchingSpouseIds = Array.from(new Set(matchingSpouseIds.filter(Boolean)));

    var expandedLinks = await loadMotherLinksForSpouseIds(sb, matchingSpouseIds);
    var expandedSpouses = await loadSpousesByIds(sb, matchingSpouseIds);
    return {
      motherLinks: dedupeMotherLinks(links.concat(expandedLinks)),
      spouses: expandedSpouses,
    };
  }

  function resolveTreeChildIdFromRows(rows, person) {
    var path = normalizePathKey((person && person.name) || "");
    var branch = String((person && person.branchKey) || "").trim();
    var parentPath = normalizePathKey((person && person.parentName) || "");
    if (!path) return 0;
    var leaf = path.split("/").filter(Boolean).slice(-1)[0] || path;
    var matches = (Array.isArray(rows) ? rows : []).filter(function (row) {
      var rowBranch = String(row.branch_key || branch || "").trim();
      if (branch && rowBranch && normalizePathKey(rowBranch) !== normalizePathKey(branch)) return false;
      var rowPath = normalizePathKey(row.child_name || row.name || "");
      if (!rowPath) return false;
      if (rowPath === path || arabicNorm(rowPath) === arabicNorm(path)) return true;
      if (path.endsWith("/" + rowPath) || rowPath.endsWith("/" + path)) return true;
      var rowLeaf = rowPath.split("/").filter(Boolean).slice(-1)[0] || "";
      if (!rowLeaf || arabicNorm(rowLeaf) !== arabicNorm(leaf)) return false;
      if (!parentPath) return true;
      var rowParent = normalizePathKey(row.parent_name || row.parent || "");
      return rowParent === parentPath || rowPath.startsWith(parentPath + "/") || parentPath.endsWith("/" + rowLeaf);
    });
    if (matches.length === 1) return Number(matches[0].id || 0);
    return 0;
  }

  async function resolveTreeChildId(sb, person) {
    var id = Number((person && (person.treeChildId || person.id)) || 0);
    if (id > 0) return id;
    var fromRows = resolveTreeChildIdFromRows(person && person.sourceRows, person);
    if (fromRows > 0) return fromRows;
    var path = normalizePathKey((person && person.name) || "");
    var branch = String((person && person.branchKey) || "").trim();
    if (!path || !branch || !sb) return 0;
    var rows = await selectRows(sb, "tree_children", {
      select: "id,child_name,name,branch_key,parent_name,parent",
      eq: { branch_key: branch },
      limit: 3000,
    });
    return resolveTreeChildIdFromRows(rows, person);
  }

  async function hydrateHiddenViewerPerson(sb, person, phone) {
    if (!person) return person;
    if (String(person.name || "").trim() && String(person.parentName || "").trim()) {
      return person;
    }
    var row = null;
    if (sb && phone) {
      try {
        var rpc = await sb.rpc("tree_member_viewer_v1", { p_phone: phone });
        var rows = Array.isArray(rpc && rpc.data) ? rpc.data : rpc && rpc.data ? [rpc.data] : [];
        row = rows[0] || null;
      } catch (e) {}
    }
    if (!row) return person;
    return normalizePerson({
      id: Number(row.id || person.id || 0),
      name: row.child_name || row.name || person.name,
      parentName: row.parent_name || row.parent || person.parentName,
      branchKey: row.branch_key || person.branchKey,
      gender: row.gender || person.gender,
    });
  }

  async function loadKinshipContextForPerson(sb, personInput) {
    var raw = personInput || {};
    var resolvedId = Number(raw.id || raw.treeChildId || 0);
    if (!resolvedId && sb) {
      resolvedId = await resolveTreeChildId(sb, raw);
    }
    var person = normalizePerson(
      resolvedId > 0 ? Object.assign({}, raw, { id: resolvedId }) : null,
    );
    if (!person) return null;
    person = await hydrateHiddenViewerPerson(sb, person, raw.phone);

    var branchLists = await Promise.all(
      BRANCHES.map(function (branch) {
        return selectRows(sb, "tree_children", {
          select: "id,branch_key,parent_name,parent,child_name,name,gender",
          eq: { branch_key: branch },
          limit: 2000,
        });
      }),
    );
    var children = [];
    branchLists.forEach(function (list) {
      list.forEach(function (row) {
        children.push(childFromRow(row, row.branch_key));
      });
    });

    var initialLinks = await selectRows(sb, "tree_mother_links", {
      select:
        "child_id,spouse_id,mother_name,mother_lineage,mother_is_family_member,mother_branch_key,confidence",
      eq: { child_id: person.id },
      limit: 20,
    });
    var motherLinks = dedupeMotherLinks(
      initialLinks.map(function (row) {
        return normalizeMotherLinkRow(row);
      }),
    );
    var spouseRows = await selectRows(sb, "tree_spouses", {
      select:
        "id,husband_id,wife_name,wife_lineage,wife_is_family_member,wife_branch_key,status",
      limit: 5000,
    });
    var spouses = spouseRows.map(normalizeSpouseRow).filter(Boolean);
    var relatedIds = {};
    motherLinks.forEach(function (row) {
      if (row.spouseId) relatedIds[row.spouseId] = true;
    });
    var ctxHint = {
      children: children,
      spouses: spouses,
      motherLinks: motherLinks,
      viewerPerson: person,
    };
    spouses.forEach(function (spouse) {
      if (wifeRoleTowardViewer(spouse, person)) relatedIds[spouse.id] = true;
    });
    var inferred = inferMotherSpouse(person, ctxHint);
    if (inferred) {
      relatedIds[inferred.id] = true;
      spouses.forEach(function (spouse) {
        if (
          motherLinksShareIdentity(
            {
              spouseId: inferred.id,
              motherLineage: inferred.wifeLineage,
              motherName: inferred.wifeName,
            },
            inferred,
            {
              spouseId: spouse.id,
              motherLineage: spouse.wifeLineage,
              motherName: spouse.wifeName,
            },
            spouse,
          )
        ) {
          relatedIds[spouse.id] = true;
        }
      });
    }
    var extraLinks = await loadMotherLinksForSpouseIds(
      sb,
      Object.keys(relatedIds).map(Number).filter(Boolean),
    );
    motherLinks = dedupeMotherLinks(motherLinks.concat(extraLinks));
    var husbandIds = spouses
      .filter(function (spouse) {
        return relatedIds[spouse.id];
      })
      .map(function (spouse) {
        return spouse.husbandId;
      });
    await ensureChildrenById(sb, { children: children }, husbandIds);
    return {
      viewer: person,
      children: children,
      motherLinks: motherLinks,
      spouses: spouses,
      viewerPerson: person,
    };
  }

  function maternalSiblingsForViewer(viewerId, ctx) {
    var viewerLink = ctx.motherLinks.filter(function (item) {
      return Number(item.childId) === Number(viewerId) && isConfirmedLink(item.confidence);
    })[0];
    if (!viewerLink) return [];

    var spouseMap = spouseByIdMap(ctx.spouses);
    var viewerSpouse = spouseMap[Number(viewerLink.spouseId)];
    var viewerChild =
      (ctx.children || []).filter(function (row) {
        return Number(row.id) === Number(viewerId);
      })[0] ||
      (ctx.viewerPerson && Number(ctx.viewerPerson.id) === Number(viewerId) ? ctx.viewerPerson : null);

    var out = [];
    var seen = {};
    ctx.motherLinks.forEach(function (item) {
      if (!isConfirmedLink(item.confidence)) return;
      var childId = Number(item.childId || 0);
      if (!childId || childId === Number(viewerId) || seen[childId]) return;
      var otherSpouse = spouseMap[Number(item.spouseId)];
      if (!motherLinksShareIdentity(viewerLink, viewerSpouse, item, otherSpouse)) return;
      var child = ctx.children.filter(function (row) {
        return Number(row.id) === childId;
      })[0];
      if (!child || !isSonRow(child)) return;
      if (viewerChild && shareProvenFather(viewerChild, child)) return;
      seen[childId] = true;
      out.push(childId);
    });
    return out;
  }

  function maternalRelativesForViewer(viewerId, ctx) {
    var maternalSiblings = maternalSiblingsForViewer(viewerId, ctx);
    var empty = {
      "جدك من الأم": [],
      خالك: [],
      "ابن خالك": [],
      "ابن خالتك": [],
      "أخ من أمك": maternalSiblings,
    };
    var mother = resolveMotherNode(viewerId, ctx);
    if (!mother) return empty;

    var viewerLink = ctx.motherLinks.filter(function (item) {
      return Number(item.childId) === Number(viewerId);
    })[0];
    var spouse = ctx.spouses.filter(function (row) {
      return viewerLink && Number(row.id) === Number(viewerLink.spouseId);
    })[0];
    var motherPath = mother.node
      ? childPath(mother.node)
      : lineagePath((spouse && spouse.wifeLineage) || "");

    var khals = sonsOfParent(ctx, mother.grandfatherPath, mother.branchKey).filter(function (row) {
      if (mother.node && Number(row.id) === Number(mother.node.id)) return false;
      if (motherPath && (childPath(row) === motherPath || samePath(row.name, motherPath))) {
        return false;
      }
      return true;
    });

    var ibnKhal = [];
    khals.forEach(function (khal) {
      sonsOfParent(ctx, childPath(khal), khal.branchKey).forEach(function (son) {
        ibnKhal.push(son);
      });
    });

    var sisters = daughtersOfParent(ctx, mother.grandfatherPath, mother.branchKey).filter(
      function (row) {
        if (mother.node && Number(row.id) === Number(mother.node.id)) return false;
        if (motherPath && childPath(row) === motherPath) return false;
        return true;
      },
    );

    var ibnKhalaIds = {};
    sisters.forEach(function (sister) {
      var sisterSpouse = uniqueSpouseForSister(ctx.spouses, sister);
      if (!sisterSpouse) return;
      ctx.motherLinks.forEach(function (item) {
        if (Number(item.spouseId) !== Number(sisterSpouse.id)) return;
        if (!isConfirmedLink(item.confidence)) return;
        var child = ctx.children.filter(function (row) {
          return Number(row.id) === Number(item.childId);
        })[0];
        if (!child || !isSonRow(child)) return;
        if (Number(child.id) === Number(viewerId)) return;
        ibnKhalaIds[Number(child.id)] = true;
      });
    });

    return {
      "جدك من الأم": mother.maternalGrandfather ? [Number(mother.maternalGrandfather.id)] : [],
      خالك: khals.map(function (row) {
        return Number(row.id);
      }),
      "ابن خالك": ibnKhal.map(function (row) {
        return Number(row.id);
      }),
      "ابن خالتك": Object.keys(ibnKhalaIds).map(Number),
      "أخ من أمك": maternalSiblings,
    };
  }

  function mapFromRelativeSets(relatives) {
    var map = {};
    (relatives["جدك من الأم"] || []).forEach(function (id) {
      map[id] = "جدك من الأم";
    });
    (relatives.خالك || []).forEach(function (id) {
      if (!map[id]) map[id] = "خالك";
    });
    (relatives["ابن خالك"] || []).forEach(function (id) {
      if (!map[id]) map[id] = "ابن خالك";
    });
    (relatives["ابن خالتك"] || []).forEach(function (id) {
      if (!map[id]) map[id] = "ابن خالتك";
    });
    (relatives["أخ من أمك"] || []).forEach(function (id) {
      if (!map[id]) map[id] = "أخ من أمك";
    });
    return map;
  }

  function resolveMaternalKinshipLabel(viewerId, targetId, ctx) {
    if (!viewerId || !targetId || Number(viewerId) === Number(targetId)) return null;
    var relatives = maternalRelativesForViewer(viewerId, ctx);
    if (relatives["جدك من الأم"].indexOf(Number(targetId)) >= 0) return "جدك من الأم";
    if (relatives.خالك.indexOf(Number(targetId)) >= 0) return "خالك";
    if (relatives["ابن خالك"].indexOf(Number(targetId)) >= 0) return "ابن خالك";
    if (relatives["ابن خالتك"].indexOf(Number(targetId)) >= 0) return "ابن خالتك";
    if (relatives["أخ من أمك"].indexOf(Number(targetId)) >= 0) return "أخ من أمك";
    return null;
  }

  function childFromRow(row, branchKey) {
    var name = String((row && (row.child_name || row.childName || row.name)) || "");
    var parentName = String((row && (row.parent_name || row.parentName || row.parent)) || "");
    if (!parentName && name.indexOf("/") >= 0) {
      parentName = name.split("/").slice(0, -1).join("/");
    }
    return {
      id: Number((row && (row.id || row.rowId)) || 0),
      name: name,
      parentName: parentName,
      branchKey: String((row && (row.branch_key || row.branchKey || branchKey)) || ""),
      gender: (row && row.gender) || null,
    };
  }

  function normalizePerson(person) {
    if (!person) return null;
    var id = Number(person.id || 0);
    if (!id) return null;
    return {
      id: id,
      name: String(person.name || ""),
      parentName: String(person.parentName || person.parent_name || person.parent || ""),
      branchKey: String(person.branchKey || person.branch_key || ""),
      gender: person.gender || null,
    };
  }

  function isEncounterLabel(label) {
    return Boolean(ENCOUNTER_LABELS[String(label || "").trim()]);
  }

  async function selectRows(sb, table, query) {
    if (!sb || typeof sb.from !== "function") return [];
    var req = sb.from(table).select(query.select || "*");
    if (query.eq) {
      Object.keys(query.eq).forEach(function (key) {
        req = req.eq(key, query.eq[key]);
      });
    }
    if (query.in) {
      Object.keys(query.in).forEach(function (key) {
        var values = query.in[key];
        if (values && values.length) req = req.in(key, values);
      });
    }
    if (query.limit) req = req.limit(query.limit);
    var res = await req;
    if (res && res.error) return [];
    return Array.isArray(res && res.data) ? res.data : [];
  }

  async function loadSpousesByIds(sb, spouseIds) {
    var spouses = [];
    var ids = Array.from(new Set((spouseIds || []).map(Number).filter(Boolean)));
    for (var i = 0; i < ids.length; i += 1) {
      var rows = await selectRows(sb, "tree_spouses", {
        select:
          "id,husband_id,wife_name,wife_lineage,wife_is_family_member,wife_branch_key,status",
        eq: { id: ids[i] },
        limit: 1,
      });
      if (!rows[0]) continue;
      spouses.push({
        id: Number(rows[0].id || 0),
        husbandId: Number(rows[0].husband_id || 0),
        wifeName: rows[0].wife_name,
        wifeLineage: rows[0].wife_lineage,
        wifeIsFamilyMember: rows[0].wife_is_family_member,
        wifeBranchKey: rows[0].wife_branch_key,
        status: rows[0].status,
      });
    }
    return spouses.filter(function (row) {
      return row.id;
    });
  }

  function relativeItemFromChild(child, kind, suffix) {
    if (!child || !isSonRow(child)) return null;
    var nodeId = nodePathId(child) || normalizePathKey(child.name);
    if (!nodeId) return null;
    return {
      id: nodeId,
      label: leafPersonName(child.name || nodeId) + (suffix ? " — " + suffix : ""),
      kind: kind || "relative",
      className: siblingChipClass(kind),
    };
  }

  function rpcLabelToCard(label) {
    var value = String(label || "").trim();
    if (value === "أخ من أمك") return { group: "siblings", kind: "maternal", suffix: "من الأم" };
    if (value === "حفيدك") return { group: "grandsons", kind: "grandson", suffix: "من ابنك" };
    if (value === "حفيدك من ابنتك") return { group: "grandsons", kind: "grandson", suffix: "من ابنتك" };
    if (value === "ابن أخيك") return { group: "nephews", kind: "nephew", suffix: "ابن أخ" };
    if (value === "ابن أختك") return { group: "nephews", kind: "nephew", suffix: "ابن أخت" };
    if (value === "عمك") return { group: "uncles", kind: "uncle", suffix: "عمك" };
    if (value === "خالك") return { group: "uncles", kind: "uncle", suffix: "خالك" };
    if (value === "ابن عمك") return { group: "cousins", kind: "cousin", suffix: "ابن عم" };
    if (value === "ابن خالك" || value === "ابن خالتك") {
      return { group: "cousins", kind: "cousin", suffix: value === "ابن خالك" ? "ابن خال" : "ابن خالة" };
    }
    if (value === "ابنك") return { group: "sons", kind: "son", suffix: "ابنك" };
    return null;
  }

  async function fetchRpcRelativeRows(sb, personId) {
    var rows = [];
    try {
      var rpc = await sb.rpc("tree_kinship_for_person_v1", { p_person_id: personId });
      rows = Array.isArray(rpc && rpc.data) ? rpc.data : rpc && rpc.data ? [rpc.data] : [];
    } catch (e) {}
    if (!rows.length) {
      try {
        var rpcM = await sb.rpc("tree_maternal_kinship_for_viewer_v1", { p_viewer_id: personId });
        rows = Array.isArray(rpcM && rpcM.data) ? rpcM.data : rpcM && rpcM.data ? [rpcM.data] : [];
      } catch (e2) {}
    }
    return rows;
  }

  async function ensureChildrenById(sb, ctx, ids) {
    var childrenById = {};
    ((ctx && ctx.children) || []).forEach(function (row) {
      if (row && row.id) childrenById[Number(row.id)] = row;
    });
    var missing = (ids || []).filter(function (id) {
      return id && !childrenById[id];
    });
    if (missing.length) {
      var extra = await selectRows(sb, "tree_children", {
        select: "id,branch_key,parent_name,parent,child_name,name,gender",
        in: { id: missing },
        limit: 500,
      });
      extra.forEach(function (row) {
        var child = childFromRow(row, row.branch_key);
        if (child && child.id) {
          childrenById[child.id] = child;
          ctx.children.push(child);
        }
      });
    }
    return childrenById;
  }

  async function loadRelativesForCard(sb, personInput) {
      var empty = { siblings: [], grandsons: [], nephews: [], uncles: [], sons: [] };
    try {
      var input = Object.assign({}, personInput || {});
      if (!input.sourceRows && input.ctx && Array.isArray(input.ctx.sourceRows)) {
        input.sourceRows = input.ctx.sourceRows;
      }
      var ctx = await loadKinshipContextForPerson(sb, input);
      var viewer = ctx && ctx.viewer;
      if (!viewer || !viewer.id) return empty;

      var rpcKindById = {};
      var rpcRows = await fetchRpcRelativeRows(sb, viewer.id);
      rpcRows.forEach(function (row) {
        var personId = Number((row && row.person_id) || 0);
        var mapped = rpcLabelToCard(row && row.label);
        if (!personId || !mapped) return;
        rpcKindById[personId] = mapped;
      });
      ctx.viewerPerson = viewer;
      var linkMap = linkKinshipByTargetId(viewer, ctx);
      Object.keys(linkMap).forEach(function (id) {
        var mapped = rpcLabelToCard(linkMap[id]);
        if (!mapped) return;
        rpcKindById[id] = rpcKindById[id] || mapped;
      });
      var fromMaternal = mapFromRelativeSets(maternalRelativesForViewer(viewer.id, ctx));
      Object.keys(fromMaternal).forEach(function (id) {
        var mapped = rpcLabelToCard(fromMaternal[id]);
        if (!mapped) return;
        rpcKindById[id] = rpcKindById[id] || mapped;
      });

      var localIds = {};
      (ctx.children || []).forEach(function (child) {
        if (!child || Number(child.id) === Number(viewer.id) || !isSonRow(child)) return;
        if (shareProvenFather(viewer, child)) localIds[Number(child.id)] = true;
      });
      (ctx.motherLinks || []).forEach(function (item) {
        var childId = Number(item.childId || 0);
        if (!childId || childId === Number(viewer.id) || !isConfirmedLink(item.confidence)) return;
        if (shareProvenMother(viewer.id, childId, ctx)) localIds[childId] = true;
      });
      sonsOfParent(ctx, nodePathId(viewer), viewer.branchKey).forEach(function (son) {
        sonsOfParent(ctx, nodePathId(son), son.branchKey).forEach(function (gs) {
          localIds[Number(gs.id)] = true;
          if (!rpcKindById[gs.id]) {
            rpcKindById[gs.id] = { group: "grandsons", kind: "grandson", suffix: "من ابنك" };
          }
        });
      });
      sonsOfParent(ctx, effectiveParentName(viewer), viewer.branchKey).forEach(function (bro) {
        if (Number(bro.id) === Number(viewer.id)) return;
        sonsOfParent(ctx, nodePathId(bro), bro.branchKey).forEach(function (n) {
          localIds[Number(n.id)] = true;
          if (!rpcKindById[n.id]) {
            rpcKindById[n.id] = { group: "nephews", kind: "nephew", suffix: "ابن أخ" };
          }
        });
      });
      var fatherPath = normalizePathKey(effectiveParentName(viewer));
      var gfPath = parentPathKey(fatherPath);
      if (gfPath) {
        sonsOfParent(ctx, gfPath, viewer.branchKey).forEach(function (uncle) {
          if (!uncle || normalizePathKey(nodePathId(uncle)) === fatherPath) return;
          localIds[Number(uncle.id)] = true;
          if (!rpcKindById[uncle.id]) {
            rpcKindById[uncle.id] = { group: "uncles", kind: "uncle", suffix: "عم" };
          }
        });
      }

      var ids = {};
      Object.keys(localIds).forEach(function (id) {
        ids[id] = true;
      });
      Object.keys(rpcKindById).forEach(function (id) {
        ids[id] = true;
      });
      var idList = Object.keys(ids).map(Number).filter(Boolean);
      var childrenById = await ensureChildrenById(sb, ctx, idList);
      var seenNode = {};
      var out = { siblings: [], grandsons: [], nephews: [], uncles: [], sons: [] };

      idList.forEach(function (childId) {
        var child = childrenById[childId];
        if (!child) return;
        var rpcMapped = rpcKindById[childId];
        var bond = siblingBondKind(viewer, child, ctx);
        var mapped = null;
        if (bond) {
          mapped = {
            group: "siblings",
            kind: bond,
            suffix: siblingCardSuffix(bond),
          };
        } else if (rpcMapped) {
          mapped = rpcMapped;
        }
        if (!mapped) return;
        var item = relativeItemFromChild(child, mapped.kind, mapped.suffix);
        if (!item || seenNode[item.id]) return;
        seenNode[item.id] = true;
        if (mapped.group === "grandsons") out.grandsons.push(item);
        else if (mapped.group === "nephews") out.nephews.push(item);
        else if (mapped.group === "uncles") out.uncles.push(item);
        else if (mapped.group === "cousins") out.nephews.push(item);
        else if (mapped.group === "sons") out.sons.push(item);
        else out.siblings.push(item);
      });
      return out;
    } catch (e) {
      return empty;
    }
  }

  async function loadSiblingItemsForCard(sb, personInput) {
    var pack = await loadRelativesForCard(sb, personInput);
    return pack.siblings || [];
  }

  async function loadMaternalSiblingItemsForCard(sb, personInput) {
    var items = await loadSiblingItemsForCard(sb, personInput);
    return items.filter(function (item) {
      return item && item.kind === "maternal";
    });
  }

  async function loadForMember(sb, viewerInput) {
    var viewer = normalizePerson(viewerInput);
    if (!viewer) {
      clearMember();
      return member;
    }
    setMemberState(viewer, {}, {}, [], null, false);

    try {
      var ctxPack = await loadKinshipContextForPerson(sb, viewerInput);
      if (!ctxPack) {
        setMemberState(viewer, {}, {}, [], null, true);
        notifyKinshipReady();
        member.loadPromise = null;
        return member;
      }
      viewer = ctxPack.viewer;
      var ctx = {
        children: ctxPack.children,
        motherLinks: ctxPack.motherLinks,
        spouses: ctxPack.spouses,
        viewerPerson: viewer,
      };
      var fromLocal = mapFromRelativeSets(maternalRelativesForViewer(viewer.id, ctx));
      var fromLinks = linkKinshipByTargetId(viewer, ctx);

      var fromRpc = {};
      try {
        var rpc = await sb.rpc("tree_kinship_for_person_v1", {
          p_person_id: viewer.id,
        });
        var rpcRows = Array.isArray(rpc && rpc.data) ? rpc.data : rpc && rpc.data ? [rpc.data] : [];
        rpcRows.forEach(function (row) {
          var personId = Number((row && row.person_id) || 0);
          var label = String((row && row.label) || "").trim();
          if (!personId || !isEncounterLabel(label)) return;
          if (!fromRpc[personId]) fromRpc[personId] = label;
        });
      } catch (e) {}
      try {
        var rpcM = await sb.rpc("tree_maternal_kinship_for_viewer_v1", {
          p_viewer_id: viewer.id,
        });
        var rpcMRows = Array.isArray(rpcM && rpcM.data) ? rpcM.data : rpcM && rpcM.data ? [rpcM.data] : [];
        rpcMRows.forEach(function (row) {
          var personId = Number((row && row.person_id) || 0);
          var label = String((row && row.label) || "").trim();
          if (!personId || !isEncounterLabel(label)) return;
          if (!fromRpc[personId]) fromRpc[personId] = label;
        });
      } catch (e) {}

      var maternalById = Object.assign({}, fromRpc, fromLocal, fromLinks);
      var extraIds = Object.keys(maternalById).map(Number).filter(function (id) {
        return id && !(ctx.children || []).some(function (child) {
          return Number(child.id) === id;
        });
      });
      if (extraIds.length) {
        await ensureChildrenById(sb, ctx, extraIds);
      }
      setMemberState(
        viewer,
        maternalById,
        indexMaternalMaps(ctx.children, maternalById),
        ctx.children,
        ctx,
        true,
      );
      notifyKinshipReady();
    } catch (e) {
      setMemberState(viewer, {}, {}, [], null, true);
      notifyKinshipReady();
    }
    member.loadPromise = null;
    return member;
  }

  function ensureMemberKinship(sb, viewerInput) {
    var sameId =
      member.ready &&
      member.viewer &&
      Number(member.viewer.id) === Number(viewerInput && viewerInput.id);
    var viewerHasPath =
      member.viewer &&
      String(member.viewer.parentName || "").trim() &&
      String(member.viewer.name || "").trim();
    if (sameId && viewerHasPath) {
      return Promise.resolve(member);
    }
    if (member.loadPromise) return member.loadPromise;
    var pending = loadForMember(sb, viewerInput);
    member.loadPromise = pending;
    return pending || Promise.resolve(member);
  }

  var api = {
    leafPersonName: leafPersonName,
    normalizePathKey: normalizePathKey,
    nodePathId: nodePathId,
    resolveProvenKinshipLabel: resolveProvenKinshipLabel,
    resolveSharedAncestorBadge: resolveSharedAncestorBadge,
    maternalRelativesForViewer: maternalRelativesForViewer,
    resolveMaternalKinshipLabel: resolveMaternalKinshipLabel,
    mapFromRelativeSets: mapFromRelativeSets,
    loadKinshipContextForPerson: loadKinshipContextForPerson,
    loadSiblingItemsForCard: loadSiblingItemsForCard,
    loadRelativesForCard: loadRelativesForCard,
    linkKinshipByTargetId: linkKinshipByTargetId,
    loadMaternalSiblingItemsForCard: loadMaternalSiblingItemsForCard,
    siblingBondKind: siblingBondKind,
    resolveTreeChildId: resolveTreeChildId,
    maternalSiblingsForViewer: maternalSiblingsForViewer,
    encounterForCard: encounterForCard,
    loadForMember: loadForMember,
    ensureMemberKinship: ensureMemberKinship,
    getMemberViewer: function () {
      return member.viewer || null;
    },
    wifeRoleTowardViewer: wifeRoleTowardViewer,
    isReady: function () {
      return member.ready === true;
    },
    setMemberState: setMemberState,
    clearMember: clearMember,
    findTarget: findTarget,
  };

  root.AlzidanPersonKinship = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
