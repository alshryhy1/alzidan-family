/**
 * Request Experience (RX) — visitor intent-first entry.
 * Slice RX-1: hub + أضف فردًا end-to-end → approval_requests (no tree_* writes).
 * P0: tree index must match the public tree (groupChildrenRows) — completeness before gates.
 * P0 gate: affirming an existing person identity never creates tree_card add.
 * Spec: docs/REQUEST-EXPERIENCE-UX-v1.md (adopted 2026-08-09).
 */
(function () {
  "use strict";

  var BRANCHES = ["زيدان", "مزيد", "زايد", "لاحم", "ملحم"];
  /** Same key as app.js so RX reuses warm cache; must honor TTL (app writes {ts,rows}). */
  var CACHE_PREFIX = "alzidan_tree_children_cache_v1:";
  var CACHE_TTL_MS = 5 * 60 * 1000;
  var PAGE_SIZE = 1000;
  var TRACK_KEY = "alzidan_rx_my_requests_v1";
  var EXISTING_PERSON_MSG =
    "هذا الشخص موجود مسبقًا في الشجرة. إذا أردت تعديل بياناته فاستخدم (تصحيح بيانات شخص).";
  /** Retest note: father خميس must list حسن، حسين، عبدالعزيز، منصور، مزيد — same count as tree. */

  var INTENTS = [
    {
      id: "tree_card",
      label: "أضف فردًا للعائلة",
      blurb: "أرسل بيانات شخص جديد للمراجعة — دون حفظ في الشجرة الآن.",
      implemented: true,
    },
    {
      id: "tree_edit",
      label: "صحح بيانات شخص",
      blurb: "اختيار شخص موجود وتصحيح حقول محددة.",
      implemented: false,
      slice: "RX-2",
    },
    {
      id: "event_death",
      label: "أعلن وفاة",
      blurb: "إعلان وفاة مع تأكيد الشخص والتاريخ.",
      implemented: false,
      slice: "RX-3",
    },
    {
      id: "event_marriage",
      label: "أعلن زواج",
      blurb: "إعلان زواج بين طرفين مع التاريخ.",
      implemented: false,
      slice: "RX-4",
    },
    {
      id: "memory_card",
      label: "شارك ذكرى",
      blurb: "نص أو وسائط لذكرى عائلية.",
      implemented: false,
      slice: "RX-5",
    },
    {
      id: "special_card",
      label: "اطلب بطاقة",
      blurb: "طلب بطاقة خاصة حسب النوع المعتمد.",
      implemented: false,
      slice: "RX-6",
    },
  ];

  var STATUS_VISITOR = {
    pending: "تم الإرسال",
    submitted: "تم الإرسال",
    assigned: "وصل للمندوب",
    in_review: "تحت المراجعة",
    needs_changes: "نحتاج معلومة إضافية منك",
    approved: "تم قبول طلبك",
    applied: "تمت إضافة البيانات",
    done: "اكتمل",
    rejected: "لم يُقبل",
  };

  var root = document.querySelector("[data-rx-root]");
  if (!root) return;

  var state = {
    view: "home",
    intentId: "",
    facts: {
      personName: "",
      gender: "",
      birthDate: "",
      submitterName: "",
      submitterPhone: "",
      submitterEmail: "",
      parentQuery: "",
    },
    parentCandidates: [],
    selectedParent: null,
    parentConfirmed: false,
    /** Direct children under selectedParent — must match tree 100%. */
    childrenUnderParent: [],
    /** Matches for the person being added (identity), not father/context. */
    identityCandidates: [],
    selectedIdentity: null,
    /** User affirmed an existing tree person is the one they meant → never create add. */
    identityAffirmedExisting: false,
    /** User insists this is a different person who shares the same name. */
    differentPersonSameName: false,
    lastRequestId: "",
    lastStatusLabel: "",
    busy: false,
    error: "",
  };

  /** In-memory full person index per branch (no search limit). */
  var branchIndexCache = Object.create(null);

  function text(v) {
    return String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  }

  function escapeHtml(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function normalizePersonName(v) {
    var s = text(v);
    if (!s) return "";
    var parts = s.split(" ").map(text).filter(Boolean);
    if (
      parts.length >= 3 &&
      parts.every(function (p) {
        return p.length === 1 && /^[\u0600-\u06FF]$/.test(p);
      })
    ) {
      return parts.join("");
    }
    return s;
  }

  function normalizeSearchText(v) {
    return normalizePersonName(v || "")
      .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
      .replace(/[أإآ]/g, "ا")
      .replace(/ى/g, "ي")
      .replace(/ؤ/g, "و")
      .replace(/ئ/g, "ي")
      .replace(/ة/g, "ه")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function normalizePhone(v) {
    return String(v || "")
      .replace(/[٠-٩]/g, function (d) {
        return String(d.charCodeAt(0) - 1632);
      })
      .replace(/[۰-۹]/g, function (d) {
        return String(d.charCodeAt(0) - 1776);
      })
      .replace(/[^\d+]/g, "")
      .trim();
  }

  function normalizeEmail(v) {
    return text(v).toLowerCase();
  }

  function isLikelyEmail(v) {
    var s = normalizeEmail(v);
    return !!(s && s.indexOf("@") >= 0 && s.indexOf(".") >= 0 && s.length >= 6);
  }

  function makeRequestId() {
    var part1 = Math.random().toString(36).slice(2, 6).toUpperCase();
    var part2 = Math.random().toString(36).slice(2, 6).toUpperCase();
    return "REQ-" + part1 + "-" + part2;
  }

  function getClient() {
    if (window.__alzidanConfig && typeof window.__alzidanConfig.getClient === "function") {
      return window.__alzidanConfig.getClient();
    }
    return window.__alzidanSupabaseClient || window.__alzidanالخدمةClient || null;
  }

  function getBranchRootName(branchKey) {
    var k = normalizePersonName(branchKey);
    return k ? k + " بن مطلق بن زيدان" : "";
  }

  function getDisplayNameForNodeId(nodeId, branchRoot) {
    var id = normalizePersonName(nodeId || "");
    if (!id) return "";
    if (branchRoot && id === branchRoot) return id;
    var leaf = id.indexOf("/") >= 0 ? id.split("/").map(normalizePersonName).filter(Boolean).slice(-1)[0] || id : id;
    return leaf;
  }

  function pathLabelFromNodeId(nodeId, branchRoot) {
    var id = normalizePersonName(nodeId || "");
    if (!id) return "";
    var rootName = normalizePersonName(branchRoot || "");
    var parts = id.split("/").map(normalizePersonName).filter(Boolean);
    if (!parts.length) return "";
    return parts
      .map(function (p, idx) {
        if (idx === 0 && rootName && p === rootName) return getDisplayNameForNodeId(p, rootName);
        return getDisplayNameForNodeId(p, rootName);
      })
      .filter(Boolean)
      .join(" / ");
  }

  function readBranchCache(branchKey) {
    try {
      var raw = localStorage.getItem(CACHE_PREFIX + normalizePersonName(branchKey));
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.rows)) return null;
      var ts = typeof parsed.ts === "number" ? parsed.ts : 0;
      if (!ts || Date.now() - ts > CACHE_TTL_MS) return null;
      return parsed.rows;
    } catch (e) {
      return null;
    }
  }

  function writeBranchCache(branchKey, rows) {
    try {
      localStorage.setItem(
        CACHE_PREFIX + normalizePersonName(branchKey),
        JSON.stringify({ ts: Date.now(), rows: Array.isArray(rows) ? rows : [] })
      );
    } catch (e) {}
  }

  /**
   * Build the same person index the public tree search uses:
   * resolve leaf parents to full paths (branchRoot/leaf) so children under خميس
   * are not collapsed to bare leaf ids (which hid حسين / عبدالعزيز / منصور).
   * Mirrors app.js groupChildrenRows + collectSearchItemsForBranch intent.
   */
  function collectItemsForBranch(branchKey, rows) {
    var key = normalizePersonName(branchKey);
    var rootName = getBranchRootName(key);
    var byId = new Map();
    var idsByLeaf = new Map();

    function indexLeaf(id) {
      var nid = normalizePersonName(id || "");
      if (!nid) return;
      var leaf = getDisplayNameForNodeId(nid, rootName);
      if (!leaf) return;
      var set = idsByLeaf.get(leaf);
      if (!set) {
        set = new Set();
        idsByLeaf.set(leaf, set);
      }
      set.add(nid);
    }

    function upsert(id, meta) {
      var nid = normalizePersonName(id || "");
      if (!nid || nid === rootName) return null;
      indexLeaf(nid);
      var prev = byId.get(nid);
      if (prev) {
        if (meta && meta.personId && !prev.personId) prev.personId = meta.personId;
        if (meta && meta.parentPersonId && !prev.parentPersonId) {
          prev.parentPersonId = meta.parentPersonId;
        }
        if (meta && meta.parentId && !prev.parentId) prev.parentId = meta.parentId;
        return prev;
      }
      var leaf = getDisplayNameForNodeId(nid, rootName);
      var path = pathLabelFromNodeId(nid, rootName);
      var item = {
        branch: key,
        id: nid,
        leaf: leaf,
        path: path,
        personId: normalizePersonName((meta && meta.personId) || ""),
        parentPersonId: normalizePersonName((meta && meta.parentPersonId) || ""),
        parentId: normalizePersonName((meta && meta.parentId) || ""),
        searchText: normalizeSearchText([leaf, path, nid, key].join(" ")),
      };
      byId.set(nid, item);
      return item;
    }

    function ensureParentId(rawParent, childRaw) {
      var raw = normalizePersonName(rawParent || "");
      if (!raw) return rootName || "";
      if (raw.indexOf("/") >= 0) return raw;
      if (rootName && (raw === rootName || raw === key)) return rootName;
      var childFull = normalizePersonName(childRaw || "");
      if (childFull.indexOf("/") >= 0) {
        var parts = childFull.split("/").map(normalizePersonName).filter(Boolean);
        if (parts.length >= 2) {
          var derivedParent = parts.slice(0, -1).join("/");
          var derivedLeaf = parts[parts.length - 2] || "";
          if (
            derivedLeaf === raw ||
            getDisplayNameForNodeId(derivedParent, rootName) === raw ||
            derivedParent.lastIndexOf("/" + raw) === derivedParent.length - (raw.length + 1)
          ) {
            return derivedParent;
          }
        }
      }
      var candidates = idsByLeaf.get(raw);
      if (candidates && candidates.size === 1) return Array.from(candidates)[0];
      if (candidates && candidates.size > 1) return raw;
      if (rootName) {
        var underRoot = rootName + "/" + raw;
        upsert(underRoot, { parentId: rootName });
        return underRoot;
      }
      return raw;
    }

    var list = Array.isArray(rows) ? rows : [];
    // Pass 1: index rows that already carry full path ids so leaf-parent resolution can uniquify.
    list.forEach(function (r) {
      var childRaw = normalizePersonName(r.child_name || r.name || "");
      var parentRaw = normalizePersonName(r.parent_name || r.parent || "");
      if (childRaw.indexOf("/") >= 0) indexLeaf(childRaw);
      if (parentRaw.indexOf("/") >= 0) indexLeaf(parentRaw);
    });

    list.forEach(function (r) {
      var childRaw = normalizePersonName(r.child_name || r.name || "");
      var parentRaw = normalizePersonName(r.parent_name || r.parent || "");
      if (!childRaw) return;
      var parentId = ensureParentId(parentRaw, childRaw);
      if (!parentId) return;
      if (parentId !== rootName) {
        upsert(parentId, {
          personId: normalizePersonName(r.parent_person_id || ""),
        });
      }
      var childId;
      if (childRaw.indexOf("/") >= 0) {
        childId = childRaw;
        if (
          parentId &&
          childId !== parentId &&
          childId.indexOf(parentId + "/") !== 0 &&
          !(rootName && (childId === rootName || childId.indexOf(rootName + "/") === 0))
        ) {
          var base = parentId.split("/").map(normalizePersonName).filter(Boolean).slice(-1)[0] || "";
          if (base && childId.indexOf(base + "/") === 0) {
            childId = parentId + "/" + childId.slice((base + "/").length);
          }
        }
      } else {
        childId = parentId + "/" + childRaw;
      }
      upsert(childId, {
        personId: normalizePersonName(r.person_id || ""),
        parentPersonId: normalizePersonName(r.parent_person_id || ""),
        parentId: parentId,
      });
    });

    return Array.from(byId.values());
  }

  async function fetchAllBranchRows(branchKey) {
    var sb = getClient();
    if (!sb) return [];
    var all = [];
    var from = 0;
    try {
      for (;;) {
        var res = await sb
          .from("tree_children")
          .select("person_id,parent_person_id,parent_name,parent,child_name,name")
          .eq("branch_key", branchKey)
          .range(from, from + PAGE_SIZE - 1);
        if (res.error) {
          if (!all.length) return [];
          break;
        }
        var chunk = Array.isArray(res.data) ? res.data : [];
        all = all.concat(chunk);
        if (chunk.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }
    } catch (e) {
      return all.length ? all : [];
    }
    return all;
  }

  async function loadBranchRows(branchKey) {
    var cached = readBranchCache(branchKey);
    if (cached && cached.length) return cached;
    var rows = await fetchAllBranchRows(branchKey);
    if (rows.length) writeBranchCache(branchKey, rows);
    return rows;
  }

  async function getBranchItems(branchKey) {
    var key = normalizePersonName(branchKey);
    if (branchIndexCache[key] && branchIndexCache[key].length) return branchIndexCache[key];
    var rows = await loadBranchRows(key);
    var items = collectItemsForBranch(key, rows);
    branchIndexCache[key] = items;
    return items;
  }

  async function getAllPeopleItems() {
    var all = [];
    for (var i = 0; i < BRANCHES.length; i++) {
      all = all.concat(await getBranchItems(BRANCHES[i]));
    }
    return all;
  }

  async function searchPeople(query, opts) {
    opts = opts || {};
    var q = normalizeSearchText(query);
    if (q.length < 2) return [];
    var leafOnly = !!opts.leafOnly;
    var exactLeafOnly = !!opts.exactLeafOnly;
    var all = await getAllPeopleItems();
    var scored = all
      .map(function (item) {
        var leaf = normalizeSearchText(item.leaf);
        var path = normalizeSearchText(item.path);
        var score = 0;
        if (leaf === q) score = 100;
        else if (!exactLeafOnly && leaf.indexOf(q) === 0) score = 80;
        else if (!exactLeafOnly && !leafOnly && leaf.indexOf(q) >= 0) score = 60;
        else if (!exactLeafOnly && !leafOnly && path.indexOf(q) >= 0) score = 40;
        else if (!exactLeafOnly && !leafOnly && item.searchText.indexOf(q) >= 0) score = 20;
        return { item: item, score: score };
      })
      .filter(function (x) {
        return x.score > 0;
      })
      .sort(function (a, b) {
        return b.score - a.score || a.item.leaf.localeCompare(b.item.leaf, "ar");
      });
    if (opts.limit != null && opts.limit > 0) {
      scored = scored.slice(0, opts.limit);
    }
    return scored.map(function (x) {
      return x.item;
    });
  }

  /**
   * Father / context search: leaf matches first (no descendant LIMIT flood).
   * Children-under-father are loaded separately via parent_person_id — never via this cap.
   */
  async function searchParents(query) {
    var leafHits = await searchPeople(query, { leafOnly: true, limit: 0 });
    if (leafHits.length) return leafHits;
    return searchPeople(query, { limit: 40 });
  }

  /**
   * Soft identity collision for the person being added.
   * Prefer exact leaf matches; no hard cap that can drop the child under the chosen father.
   */
  async function searchIdentityCollisions(personName) {
    var exact = await searchPeople(personName, { exactLeafOnly: true, limit: 0 });
    if (exact.length) return exact;
    return searchPeople(personName, { leafOnly: true, limit: 0 }).filter(function (item) {
      var leaf = normalizeSearchText(item.leaf);
      var q = normalizeSearchText(personName);
      return leaf === q || leaf.indexOf(q) === 0;
    });
  }

  /**
   * Load ALL direct children for a selected father from tree_children.
   * No localStorage cache, no silent LIMIT, no virtual list — same rows SQL proves.
   * Prefer parent_person_id (canonical); fall back to branch rows matched by parent leaf/path.
   */
  async function fetchChildrenRowsForParent(parent) {
    if (!parent) return [];
    var sb = getClient();
    if (!sb) return [];
    var parentPid = text(parent.personId || "");
    var branch = normalizePersonName(parent.branch || "");
    var parentLeaf = normalizeSearchText(parent.leaf || "");
    var parentId = normalizePersonName(parent.id || "");
    var all = [];

    async function pageQuery(build) {
      var from = 0;
      var out = [];
      for (;;) {
        var q = build(sb.from("tree_children").select(
          "person_id,parent_person_id,parent_name,parent,child_name,name"
        ));
        var res = await q.range(from, from + PAGE_SIZE - 1);
        if (res.error) break;
        var chunk = Array.isArray(res.data) ? res.data : [];
        out = out.concat(chunk);
        if (chunk.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }
      return out;
    }

    try {
      if (parentPid) {
        all = await pageQuery(function (q) {
          return q.eq("parent_person_id", parentPid);
        });
      }
      // Fallback / supplement: name-path match within branch (never cached for this field).
      if ((!all.length || !parentPid) && branch) {
        var byBranch = await pageQuery(function (q) {
          return q.eq("branch_key", branch);
        });
        var matched = byBranch.filter(function (r) {
          var pRaw = normalizePersonName(r.parent_name || r.parent || "");
          if (!pRaw) return false;
          if (parentId && (pRaw === parentId || pRaw.indexOf(parentId) === 0)) return true;
          var pLeaf = normalizeSearchText(getDisplayNameForNodeId(pRaw, getBranchRootName(branch)));
          return parentLeaf && pLeaf === parentLeaf;
        });
        if (!all.length) {
          all = matched;
        } else {
          var seenPid = new Set(
            all.map(function (r) {
              return normalizePersonName(r.person_id || "");
            }).filter(Boolean)
          );
          matched.forEach(function (r) {
            var pid = normalizePersonName(r.person_id || "");
            if (pid && seenPid.has(pid)) return;
            if (pid) seenPid.add(pid);
            all.push(r);
          });
        }
      }
    } catch (e) {
      return [];
    }
    return all;
  }

  function rowsToSiblingItems(parent, rows) {
    var key = normalizePersonName(parent.branch || "");
    var rootName = getBranchRootName(key);
    var parentId = normalizePersonName(parent.id || "");
    var out = [];
    var seen = new Set();
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      var childRaw = normalizePersonName(r.child_name || r.name || "");
      if (!childRaw) return;
      var leaf = getDisplayNameForNodeId(childRaw, rootName);
      if (!leaf) return;
      var personId = normalizePersonName(r.person_id || "");
      var dedupe = personId || normalizeSearchText(leaf) + "|" + normalizePersonName(r.parent_person_id || "");
      if (seen.has(dedupe)) return;
      seen.add(dedupe);
      var id =
        childRaw.indexOf("/") >= 0
          ? childRaw
          : parentId
            ? parentId + "/" + leaf
            : leaf;
      out.push({
        branch: key,
        id: id,
        leaf: leaf,
        path: pathLabelFromNodeId(id, rootName),
        personId: personId,
        parentPersonId: normalizePersonName(r.parent_person_id || parent.personId || ""),
        parentId: parentId,
        searchText: normalizeSearchText([leaf, id, key].join(" ")),
      });
    });
    out.sort(function (a, b) {
      return String(a.leaf || "").localeCompare(String(b.leaf || ""), "ar");
    });
    return out;
  }

  /** Filter full sibling set by typed text — never shrinks the source list. */
  function filterChildrenByQuery(children, query) {
    var q = normalizeSearchText(query || "");
    if (!q) return children.slice();
    return (children || []).filter(function (c) {
      return (
        normalizeSearchText(c.leaf).indexOf(q) === 0 ||
        normalizeSearchText(c.leaf).indexOf(q) >= 0 ||
        (c.searchText && c.searchText.indexOf(q) >= 0)
      );
    });
  }

  async function refreshChildrenUnderParent() {
    state.childrenUnderParent = [];
    if (!state.selectedParent) return [];
    // Live tree_children fetch — do not use branch localStorage cache for siblings.
    var rows = await fetchChildrenRowsForParent(state.selectedParent);
    state.childrenUnderParent = rowsToSiblingItems(state.selectedParent, rows);
    try {
      console.info(
        "RX children-under-parent",
        state.selectedParent.leaf,
        state.childrenUnderParent.map(function (c) {
          return c.leaf;
        })
      );
    } catch (e) {}
    return state.childrenUnderParent;
  }

  /** True if a child with this leaf name already sits under the chosen parent. */
  function findExistingChildUnderParent(personName, parent, children) {
    if (!parent || !personName) return null;
    var leafQ = normalizeSearchText(personName);
    var list = children || [];
    for (var i = 0; i < list.length; i++) {
      if (normalizeSearchText(list[i].leaf) === leafQ) return list[i];
    }
    return null;
  }

  function isAlreadyChildUnderParent(personName, parent, candidates) {
    return !!findExistingChildUnderParent(personName, parent, candidates);
  }

  function blockExistingPerson(match, reason) {
    state.selectedIdentity = match || state.selectedIdentity || null;
    state.identityAffirmedExisting = true;
    state.differentPersonSameName = false;
    state.view = "exists";
    setError(EXISTING_PERSON_MSG);
    try {
      console.info("RX identity-gate blocked submit", reason || "existing-under-parent");
    } catch (e) {}
  }

  function resetIdentityGate() {
    state.identityCandidates = [];
    state.selectedIdentity = null;
    state.identityAffirmedExisting = false;
    state.differentPersonSameName = false;
  }

  function ancestorsFromParent(parent) {
    if (!parent || !parent.id) return [];
    var rootName = getBranchRootName(parent.branch);
    var parts = normalizePersonName(parent.id)
      .split("/")
      .map(normalizePersonName)
      .filter(Boolean);
    if (parts.length <= 1) return [];
    var middle = parts.slice(0, -1);
    if (rootName && middle[0] === rootName) middle = middle.slice(1);
    return middle
      .map(function (p) {
        return getDisplayNameForNodeId(p, rootName);
      })
      .reverse();
  }

  function genderLabel(g) {
    if (g === "male") return "ذكر";
    if (g === "female") return "أنثى";
    return "";
  }

  function intentById(id) {
    for (var i = 0; i < INTENTS.length; i++) {
      if (INTENTS[i].id === id) return INTENTS[i];
    }
    return null;
  }

  function readTracked() {
    try {
      var raw = localStorage.getItem(TRACK_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function writeTracked(list) {
    try {
      localStorage.setItem(TRACK_KEY, JSON.stringify((list || []).slice(0, 20)));
    } catch (e) {}
  }

  function trackLocal(entry) {
    var list = readTracked().filter(function (x) {
      return x && x.requestId !== entry.requestId;
    });
    list.unshift(entry);
    writeTracked(list);
  }

  function statusLabel(status) {
    var s = text(status).toLowerCase();
    return STATUS_VISITOR[s] || "تم الإرسال";
  }

  function setError(msg) {
    state.error = text(msg);
  }

  function clearError() {
    state.error = "";
  }

  function goHome() {
    state.view = "home";
    state.intentId = "";
    state.selectedParent = null;
    state.parentConfirmed = false;
    state.parentCandidates = [];
    state.childrenUnderParent = [];
    resetIdentityGate();
    state.error = "";
    render();
  }

  function render() {
    if (state.view === "home") renderHome();
    else if (state.view === "intent") renderIntentPreview();
    else if (state.view === "facts") renderFacts();
    else if (state.view === "identity") renderIdentityCollision();
    else if (state.view === "identity_confirm") renderIdentityConfirm();
    else if (state.view === "exists") renderExistsGate();
    else if (state.view === "confirm") renderConfirm();
    else if (state.view === "review") renderReview();
    else if (state.view === "done") renderDone();
    else if (state.view === "scaffold") renderScaffold();
    else renderHome();
  }

  function shell(title, bodyHtml, opts) {
    opts = opts || {};
    var back =
      opts.showBack !== false
        ? '<button type="button" class="btn btn-outline btn-sm" data-rx-back>رجوع</button>'
        : "";
    root.innerHTML =
      '<div class="rx-shell">' +
      '<div class="rx-shell-head">' +
      "<div>" +
      '<div class="rx-kicker">طلب للمراجعة</div>' +
      '<h2 class="rx-title">' +
      escapeHtml(title) +
      "</h2>" +
      (opts.sub
        ? '<p class="rx-sub">' + escapeHtml(opts.sub) + "</p>"
        : "") +
      "</div>" +
      back +
      "</div>" +
      (state.error
        ? '<div class="rx-alert rx-alert-error" role="alert">' +
          escapeHtml(state.error) +
          "</div>"
        : "") +
      '<div class="rx-body">' +
      bodyHtml +
      "</div>" +
      "</div>";
    var backBtn = root.querySelector("[data-rx-back]");
    if (backBtn) {
      backBtn.addEventListener("click", function () {
        clearError();
        if (state.view === "intent" || state.view === "scaffold" || state.view === "done") {
          goHome();
        } else if (state.view === "facts") {
          state.view = "intent";
          render();
        } else if (state.view === "identity" || state.view === "exists") {
          state.view = "facts";
          state.selectedIdentity = null;
          state.identityAffirmedExisting = false;
          render();
        } else if (state.view === "identity_confirm") {
          state.view = "identity";
          state.selectedIdentity = null;
          state.identityAffirmedExisting = false;
          render();
        } else if (state.view === "confirm") {
          state.view = state.identityCandidates.length && !state.differentPersonSameName ? "identity" : "facts";
          state.parentConfirmed = false;
          render();
        } else if (state.view === "review") {
          state.view = "confirm";
          render();
        } else {
          goHome();
        }
      });
    }
  }

  function renderHome() {
    var cards = INTENTS.map(function (intent) {
      return (
        '<button type="button" class="rx-intent-card" data-rx-intent="' +
        escapeHtml(intent.id) +
        '">' +
        '<span class="rx-intent-label">' +
        escapeHtml(intent.label) +
        "</span>" +
        '<span class="rx-intent-blurb">' +
        escapeHtml(intent.blurb) +
        "</span>" +
        (!intent.implemented
          ? '<span class="rx-intent-badge">قريبًا · ' +
            escapeHtml(intent.slice || "") +
            "</span>"
          : "") +
        "</button>"
      );
    }).join("");

    var tracked = readTracked();
    var trackHtml =
      tracked.length === 0
        ? '<p class="rx-muted">لا طلبات محلّية بعد. بعد الإرسال تظهر هنا بحالة الشحن البشرية.</p>'
        : '<ul class="rx-track-list">' +
          tracked
            .slice(0, 8)
            .map(function (row) {
              return (
                "<li>" +
                "<strong>" +
                escapeHtml(row.intentLabel || "طلب") +
                "</strong>" +
                '<span class="rx-track-status">' +
                escapeHtml(statusLabel(row.status)) +
                "</span>" +
                '<span class="rx-muted">' +
                escapeHtml(row.summary || row.requestId || "") +
                "</span>" +
                "</li>"
              );
            })
            .join("") +
          "</ul>";

    shell(
      "ماذا تريد أن تفعل؟",
      '<div class="rx-intent-grid">' +
        cards +
        "</div>" +
        '<div class="rx-track">' +
        "<h3>طلباتي</h3>" +
        '<p class="rx-muted">حالات الشحن: تم الإرسال → وصل للمندوب → تحت المراجعة → …</p>' +
        trackHtml +
        "</div>",
      {
        showBack: false,
        sub: "اختر نية بشرية. «ابدأ الآن» يدخل المسار فقط — ولا يغيّر الشجرة.",
      }
    );

    root.querySelectorAll("[data-rx-intent]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        clearError();
        var id = btn.getAttribute("data-rx-intent");
        var intent = intentById(id);
        if (!intent) return;
        state.intentId = id;
        if (!intent.implemented) {
          state.view = "scaffold";
        } else {
          state.view = "intent";
        }
        render();
      });
    });
  }

  function renderIntentPreview() {
    var intent = intentById(state.intentId);
    if (!intent) {
      goHome();
      return;
    }
    shell(
      intent.label,
      '<p class="rx-lead">' +
        escapeHtml(intent.blurb) +
        "</p>" +
        '<p class="rx-note">لن تُحفظ البيانات في الشجرة من هذه الشاشة. بعد المراجعة فقط تُضاف عبر مسار الاعتماد.</p>' +
        '<div class="rx-actions">' +
        '<button type="button" class="btn btn-primary" data-rx-start>ابدأ الآن</button>' +
        '<button type="button" class="btn btn-outline" data-rx-cancel>إلغاء</button>' +
        "</div>",
      { sub: "دخول المسار فقط — ليس إرسالًا." }
    );
    root.querySelector("[data-rx-start]").addEventListener("click", function () {
      clearError();
      state.view = "facts";
      state.selectedParent = null;
      state.parentConfirmed = false;
      state.parentCandidates = [];
      resetIdentityGate();
      render();
    });
    root.querySelector("[data-rx-cancel]").addEventListener("click", goHome);
  }

  function renderScaffold() {
    var intent = intentById(state.intentId);
    shell(
      intent ? intent.label : "نية",
      '<p class="rx-lead">هذه النية معتمدة في فهرس RX v1، وتنفيذ مسارها الكامل يأتي في الشريحة <strong>' +
        escapeHtml((intent && intent.slice) || "") +
        "</strong>.</p>" +
        '<p class="rx-note">الهيكل جاهز من الرئيسية (نية أولًا). لا شاشات زوجة/أبناء/ميلاد في v1.</p>' +
        '<div class="rx-actions">' +
        '<button type="button" class="btn btn-primary" data-rx-home>العودة للنوايا</button>' +
        "</div>",
      { sub: "Scaffold — الشريحة الحالية RX-1 تغطي «أضف فردًا» فقط." }
    );
    root.querySelector("[data-rx-home]").addEventListener("click", goHome);
  }

  function renderFacts() {
    var f = state.facts;
    var results =
      state.parentCandidates.length === 0
        ? state.facts.parentQuery.length >= 2
          ? '<p class="rx-muted">لا نتائج مطابقة — جرّب اسمًا أوضح أو سياقًا أطول.</p>'
          : '<p class="rx-muted">اكتب حرفين على الأقل للبحث عن الشخص الذي سيُضاف تحته.</p>'
        : '<ul class="rx-search-results">' +
          state.parentCandidates
            .map(function (item, idx) {
              return (
                '<li><button type="button" class="rx-search-item" data-rx-pick="' +
                idx +
                '">' +
                "<strong>" +
                escapeHtml(item.leaf) +
                "</strong>" +
                '<span class="rx-muted">الفرع: ' +
                escapeHtml(item.branch) +
                "</span>" +
                '<span class="rx-path">' +
                escapeHtml(item.path) +
                "</span>" +
                "</button></li>"
              );
            })
            .join("") +
          "</ul>";

    var siblingFilter = filterChildrenByQuery(state.childrenUnderParent, f.personName);
    var childrenList =
      state.selectedParent && state.childrenUnderParent.length
        ? '<div class="rx-children-under" data-rx-children-panel>' +
          "<strong>الأبناء الموجودون تحت هذا السياق (" +
          state.childrenUnderParent.length +
          "):</strong>" +
          (f.personName
            ? '<p class="rx-muted">تصفية حسب اسم الشخص: ' +
              siblingFilter.length +
              " من " +
              state.childrenUnderParent.length +
              "</p>"
            : '<p class="rx-muted">القائمة كاملة من tree_children — بلا حد عرض.</p>') +
          '<ul class="rx-children-list">' +
          siblingFilter
            .map(function (c) {
              return (
                '<li><button type="button" class="rx-child-pick" data-rx-child-name="' +
                escapeHtml(c.leaf) +
                '">' +
                escapeHtml(c.leaf) +
                "</button></li>"
              );
            })
            .join("") +
          "</ul>" +
          (siblingFilter.length === 0
            ? '<p class="rx-muted">لا تطابق لاسم الشخص ضمن الأبناء — القائمة المصدرية ما زالت ' +
              state.childrenUnderParent.length +
              ".</p>"
            : "") +
          "</div>"
        : state.selectedParent
          ? '<p class="rx-muted">لا أبناء مسجّلين تحت هذا السياق في الشجرة حاليًا.</p>'
          : "";

    var selected = state.selectedParent
      ? '<div class="rx-selected">' +
        "<strong>السياق المختار:</strong> " +
        escapeHtml(state.selectedParent.leaf) +
        '<div class="rx-path">' +
        escapeHtml(state.selectedParent.path) +
        "</div>" +
        childrenList +
        "</div>"
      : "";

    shell(
      "حقائق قصيرة",
      '<form class="rx-form" data-rx-facts-form>' +
        '<label class="rx-field"><span>اسم الشخص</span>' +
        '<input name="personName" required value="' +
        escapeHtml(f.personName) +
        '" autocomplete="off" /></label>' +
        '<label class="rx-field"><span>الجنس</span>' +
        '<select name="gender" required>' +
        '<option value="">اختر</option>' +
        '<option value="male"' +
        (f.gender === "male" ? " selected" : "") +
        ">ذكر</option>" +
        '<option value="female"' +
        (f.gender === "female" ? " selected" : "") +
        ">أنثى</option>" +
        "</select></label>" +
        '<label class="rx-field"><span>تاريخ الميلاد (اختياري)</span>' +
        '<input name="birthDate" type="date" value="' +
        escapeHtml(f.birthDate) +
        '" /></label>' +
        '<fieldset class="rx-fieldset">' +
        "<legend>تحت من في العائلة؟ (الأب / السياق)</legend>" +
        '<p class="rx-muted">هذا البحث لتحديد <strong>من سيُضاف تحته</strong> الشخص الجديد — وليس للبحث عن الشخص المراد إضافته. عند أكثر من احتمال اختر بوضوح.</p>' +
        '<label class="rx-field"><span>بحث عن الأب / السياق</span>' +
        '<input name="parentQuery" value="' +
        escapeHtml(f.parentQuery) +
        '" autocomplete="off" placeholder="مثال: محمد بن خالد" /></label>' +
        '<button type="button" class="btn btn-outline btn-sm" data-rx-search>ابحث</button>' +
        results +
        selected +
        "</fieldset>" +
        '<fieldset class="rx-fieldset"><legend>بيانات المرسل</legend>' +
        '<label class="rx-field"><span>اسمك</span>' +
        '<input name="submitterName" required value="' +
        escapeHtml(f.submitterName) +
        '" autocomplete="name" /></label>' +
        '<label class="rx-field"><span>رقم الجوال</span>' +
        '<input name="submitterPhone" required type="tel" inputmode="tel" value="' +
        escapeHtml(f.submitterPhone) +
        '" placeholder="05xxxxxxxx" autocomplete="tel" /></label>' +
        '<label class="rx-field"><span>البريد (اختياري)</span>' +
        '<input name="submitterEmail" type="email" value="' +
        escapeHtml(f.submitterEmail) +
        '" autocomplete="email" /></label>' +
        "</fieldset>" +
        '<div class="rx-actions">' +
        '<button type="submit" class="btn btn-primary">متابعة</button>' +
        "</div>" +
        "</form>",
      { sub: "قائمة الأبناء تحت الأب من نفس مصدر الشجرة — ثم فحص التكرار." }
    );

    var form = root.querySelector("[data-rx-facts-form]");
    var searchBtn = root.querySelector("[data-rx-search]");

    function readForm() {
      var fd = new FormData(form);
      var prevName = state.facts.personName;
      state.facts.personName = text(fd.get("personName"));
      state.facts.gender = text(fd.get("gender"));
      state.facts.birthDate = text(fd.get("birthDate"));
      state.facts.parentQuery = text(fd.get("parentQuery"));
      state.facts.submitterName = text(fd.get("submitterName"));
      state.facts.submitterPhone = normalizePhone(fd.get("submitterPhone"));
      state.facts.submitterEmail = text(fd.get("submitterEmail"));
      if (normalizeSearchText(prevName) !== normalizeSearchText(state.facts.personName)) {
        resetIdentityGate();
      }
    }

    searchBtn.addEventListener("click", async function () {
      clearError();
      readForm();
      if (state.facts.parentQuery.length < 2) {
        setError("اكتب حرفين على الأقل للبحث.");
        render();
        return;
      }
      searchBtn.disabled = true;
      searchBtn.textContent = "جاري البحث…";
      try {
        state.parentCandidates = await searchParents(state.facts.parentQuery);
        state.selectedParent = null;
        state.parentConfirmed = false;
        state.childrenUnderParent = [];
      } finally {
        render();
      }
    });

    root.querySelectorAll("[data-rx-pick]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        var idx = Number(btn.getAttribute("data-rx-pick"));
        state.selectedParent = state.parentCandidates[idx] || null;
        state.parentConfirmed = false;
        state.childrenUnderParent = [];
        clearError();
        render();
        if (state.selectedParent) {
          try {
            await refreshChildrenUnderParent();
            render();
          } catch (err) {
            setError("تعذر تحميل أبناء السياق من الشجرة.");
            render();
          }
        }
      });
    });

    root.querySelectorAll("[data-rx-child-pick]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var name = text(btn.getAttribute("data-rx-child-name"));
        if (!name) return;
        state.facts.personName = name;
        var match = findExistingChildUnderParent(name, state.selectedParent, state.childrenUnderParent);
        if (match) {
          blockExistingPerson(match, "picked-existing-sibling");
          render();
          return;
        }
        clearError();
        render();
      });
    });

    var personNameInput = form.querySelector('input[name="personName"]');
    if (personNameInput && state.selectedParent) {
      personNameInput.addEventListener("input", function () {
        state.facts.personName = text(personNameInput.value);
        var panel = root.querySelector("[data-rx-children-panel]");
        if (!panel || !state.childrenUnderParent.length) return;
        var filtered = filterChildrenByQuery(state.childrenUnderParent, state.facts.personName);
        var ul = panel.querySelector(".rx-children-list");
        var countMuted = panel.querySelectorAll(".rx-muted")[0];
        if (countMuted) {
          countMuted.textContent = state.facts.personName
            ? "تصفية حسب اسم الشخص: " + filtered.length + " من " + state.childrenUnderParent.length
            : "القائمة كاملة من tree_children — بلا حد عرض.";
        }
        if (ul) {
          ul.innerHTML = filtered
            .map(function (c) {
              return (
                '<li><button type="button" class="rx-child-pick" data-rx-child-name="' +
                escapeHtml(c.leaf) +
                '">' +
                escapeHtml(c.leaf) +
                "</button></li>"
              );
            })
            .join("");
          ul.querySelectorAll("[data-rx-child-pick]").forEach(function (btn) {
            btn.addEventListener("click", function () {
              var name = text(btn.getAttribute("data-rx-child-name"));
              if (!name) return;
              state.facts.personName = name;
              personNameInput.value = name;
              var match = findExistingChildUnderParent(
                name,
                state.selectedParent,
                state.childrenUnderParent
              );
              if (match) {
                blockExistingPerson(match, "picked-existing-sibling");
                render();
              }
            });
          });
        }
      });
    }

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      clearError();
      readForm();
      if (!state.facts.personName || !state.facts.gender) {
        setError("يرجى إدخال الاسم والجنس.");
        render();
        return;
      }
      if (!state.selectedParent) {
        setError("اختر من نتائج البحث الشخص الذي سيُضاف تحته، ثم تابع.");
        render();
        return;
      }
      if (!state.facts.submitterName || state.facts.submitterPhone.length < 9) {
        setError("يرجى إدخال اسم المرسل ورقم جوال صحيح.");
        render();
        return;
      }
      if (state.facts.submitterEmail && !isLikelyEmail(state.facts.submitterEmail)) {
        setError("يرجى إدخال بريد صحيح أو تركه فارغًا.");
        render();
        return;
      }

      var submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "جاري التحقق…";
      }

      try {
        var children = await refreshChildrenUnderParent();
        var underSameFather = findExistingChildUnderParent(
          state.facts.personName,
          state.selectedParent,
          children
        );
        if (underSameFather) {
          blockExistingPerson(underSameFather, "facts-submit-under-parent");
          render();
          return;
        }

        state.identityCandidates = await searchIdentityCollisions(state.facts.personName);

        if (state.identityCandidates.length && !state.differentPersonSameName) {
          state.selectedIdentity = null;
          state.identityAffirmedExisting = false;
          state.view = "identity";
          render();
          return;
        }

        state.view = "confirm";
        render();
      } catch (err) {
        setError("تعذر التحقق من الاسم حاليًا. حاول مرة أخرى.");
        render();
      }
    });
  }

  function renderIdentityCollision() {
    var name = state.facts.personName;
    var list =
      state.identityCandidates.length === 0
        ? '<p class="rx-muted">لا تطابقات ظاهرة.</p>'
        : '<ul class="rx-search-results">' +
          state.identityCandidates
            .map(function (item, idx) {
              return (
                '<li><button type="button" class="rx-search-item" data-rx-id-pick="' +
                idx +
                '">' +
                "<strong>" +
                escapeHtml(item.leaf) +
                "</strong>" +
                '<span class="rx-muted">الفرع: ' +
                escapeHtml(item.branch) +
                "</span>" +
                '<span class="rx-path">' +
                escapeHtml(item.path) +
                "</span>" +
                "</button></li>"
              );
            })
            .join("") +
          "</ul>";

    shell(
      "هل تقصد شخصًا موجودًا؟",
      '<div class="rx-confirm-card">' +
        '<p class="rx-lead">وجدنا في الشجرة أشخاصًا باسم «' +
        escapeHtml(name) +
        '».</p>' +
        '<p class="rx-note">إن كان المقصود أحدهم، <strong>لا يُنشأ طلب إضافة</strong> — الشخص موجود مسبقًا.</p>' +
        "<p>اختر الشخص إن كان هو المقصود، أو أكّد أنه شخص آخر بنفس الاسم:</p>" +
        list +
        '<div class="rx-actions">' +
        '<button type="button" class="btn btn-outline" data-rx-different-name>شخص آخر بنفس الاسم — أريد إضافة فرد جديد</button>' +
        '<button type="button" class="btn btn-outline" data-rx-back-facts>تعديل الاسم</button>' +
        "</div>" +
        "</div>",
      { sub: "بوابة الهوية — منفصلة عن تأكيد الأب/السياق." }
    );

    root.querySelectorAll("[data-rx-id-pick]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var idx = Number(btn.getAttribute("data-rx-id-pick"));
        state.selectedIdentity = state.identityCandidates[idx] || null;
        state.identityAffirmedExisting = false;
        clearError();
        state.view = "identity_confirm";
        render();
      });
    });
    root.querySelector("[data-rx-different-name]").addEventListener("click", async function () {
      try {
        var children = await refreshChildrenUnderParent();
        var under = findExistingChildUnderParent(
          state.facts.personName,
          state.selectedParent,
          children
        );
        if (under) {
          blockExistingPerson(under, "different-name-same-father");
          render();
          return;
        }
      } catch (err) {
        setError("تعذر التحقق قبل المتابعة. حاول مرة أخرى.");
        render();
        return;
      }
      state.differentPersonSameName = true;
      state.selectedIdentity = null;
      state.identityAffirmedExisting = false;
      clearError();
      state.view = "confirm";
      render();
    });
    root.querySelector("[data-rx-back-facts]").addEventListener("click", function () {
      resetIdentityGate();
      clearError();
      state.view = "facts";
      render();
    });
  }

  function renderIdentityConfirm() {
    var p = state.selectedIdentity;
    if (!p) {
      state.view = "identity";
      render();
      return;
    }
    shell(
      "تأكيد: شخص موجود؟",
      '<div class="rx-confirm-card">' +
        "<p>هل تقصد هذا الشخص <strong>الموجود مسبقًا</strong> في الشجرة؟</p>" +
        "<h3>" +
        escapeHtml(p.leaf) +
        "</h3>" +
        '<p class="rx-path"><strong>المسار:</strong> ' +
        escapeHtml(p.path) +
        "</p>" +
        '<p class="rx-muted">الفرع: ' +
        escapeHtml(p.branch) +
        "</p>" +
        '<p class="rx-note">إن أجبت بنعم: لن يُنشأ طلب «إضافة شخص» — هذا يمنع التكرار.</p>' +
        '<div class="rx-actions">' +
        '<button type="button" class="btn btn-primary" data-rx-id-yes>نعم، هذا هو المقصود</button>' +
        '<button type="button" class="btn btn-outline" data-rx-id-other>لا، اختيار آخر</button>' +
        "</div>" +
        "</div>",
      { sub: "تأكيد هوية الشخص المراد إضافته — ليس تأكيد الأب." }
    );
    root.querySelector("[data-rx-id-yes]").addEventListener("click", function () {
      // Affirming an existing tree person — never continue to review/send.
      state.identityAffirmedExisting = true;
      state.differentPersonSameName = false;
      clearError();
      blockExistingPerson(state.selectedIdentity, "id-yes-affirmed");
      render();
    });
    root.querySelector("[data-rx-id-other]").addEventListener("click", function () {
      state.selectedIdentity = null;
      state.identityAffirmedExisting = false;
      clearError();
      state.view = "identity";
      render();
    });
  }

  function renderExistsGate() {
    var p = state.selectedIdentity;
    var personBlock = p
      ? "<h3>" +
        escapeHtml(p.leaf) +
        "</h3>" +
        '<p class="rx-path"><strong>المسار:</strong> ' +
        escapeHtml(p.path) +
        "</p>" +
        '<p class="rx-muted">الفرع: ' +
        escapeHtml(p.branch) +
        "</p>"
      : "";
    shell(
      "الشخص موجود مسبقًا",
      '<div class="rx-confirm-card rx-exists-gate">' +
        '<p class="rx-lead">' +
        escapeHtml(EXISTING_PERSON_MSG) +
        "</p>" +
        '<p class="rx-note"><strong>لن يُنشأ طلب إضافة</strong> ولن يظهر شيء في الإدارة أو Workflow.</p>' +
        personBlock +
        "<p>ماذا تريد؟</p>" +
        '<div class="rx-actions rx-actions-stack">' +
        '<a class="btn btn-outline" href="#search">عرض / بحث عن الشخص في الشجرة</a>' +
        '<button type="button" class="btn btn-primary" data-rx-to-edit>تصحيح بيانات شخص</button>' +
        '<button type="button" class="btn btn-outline" data-rx-change-sel>تغيير الاسم أو السياق</button>' +
        '<button type="button" class="btn btn-outline" data-rx-diff-anyway>شخص آخر بنفس الاسم (سياق مختلف)</button>' +
        "</div>" +
        "</div>",
      { sub: "Truth Before Speed — منع الإنشاء قبل أي API." }
    );
    root.querySelector("[data-rx-to-edit]").addEventListener("click", function () {
      clearError();
      state.intentId = "tree_edit";
      state.view = "scaffold";
      render();
    });
    root.querySelector("[data-rx-change-sel]").addEventListener("click", function () {
      resetIdentityGate();
      state.parentConfirmed = false;
      clearError();
      state.view = "facts";
      render();
    });
    root.querySelector("[data-rx-diff-anyway]").addEventListener("click", async function () {
      try {
        var children = await refreshChildrenUnderParent();
        var under = findExistingChildUnderParent(
          state.facts.personName,
          state.selectedParent,
          children
        );
        if (under) {
          blockExistingPerson(under, "diff-anyway-same-father");
          render();
          return;
        }
      } catch (err) {
        setError("تعذر التحقق قبل المتابعة. حاول مرة أخرى.");
        render();
        return;
      }
      state.differentPersonSameName = true;
      state.identityAffirmedExisting = false;
      state.selectedIdentity = null;
      clearError();
      if (!state.selectedParent) {
        state.view = "facts";
        setError("اختر أبًا/سياقًا مختلفًا ثم تابع — لا إضافة صامتة لنفس المسار.");
      } else {
        state.view = "confirm";
      }
      render();
    });
  }

  function renderConfirm() {
    var p = state.selectedParent;
    if (!p) {
      state.view = "facts";
      render();
      return;
    }
    if (state.identityAffirmedExisting) {
      state.view = "exists";
      render();
      return;
    }
    var sameNameNote = state.differentPersonSameName
      ? '<p class="rx-note">أشرت أن هذا <strong>شخص جديد</strong> بنفس الاسم. أكّد أن الأب/السياق صحيح ومختلف عن الشخص الموجود.</p>'
      : "";
    shell(
      "تأكيد الأب / السياق",
      '<div class="rx-confirm-card">' +
        "<p>سيُضاف <strong>الشخص الجديد</strong> «" +
        escapeHtml(state.facts.personName) +
        "» تحت:</p>" +
        "<h3>" +
        escapeHtml(p.leaf) +
        "</h3>" +
        '<p class="rx-path"><strong>المسار:</strong> ' +
        escapeHtml(p.path) +
        "</p>" +
        '<p class="rx-muted">الفرع: ' +
        escapeHtml(p.branch) +
        "</p>" +
        sameNameNote +
        "<p>هل هذا هو <strong>الأب / السياق</strong> المقصود؟</p>" +
        '<div class="rx-actions">' +
        '<button type="button" class="btn btn-primary" data-rx-confirm-yes>نعم، هذا هو السياق</button>' +
        '<button type="button" class="btn btn-outline" data-rx-confirm-other>اختيار سياق آخر</button>' +
        "</div>" +
        "</div>",
      { sub: "تأكيد مكان الإضافة — ليس تأكيد أن الشخص الجديد موجود مسبقًا." }
    );
    root.querySelector("[data-rx-confirm-yes]").addEventListener("click", async function () {
      try {
        var children = await refreshChildrenUnderParent();
        var under = findExistingChildUnderParent(
          state.facts.personName,
          state.selectedParent,
          children
        );
        if (under) {
          blockExistingPerson(under, "confirm-parent-same-child");
          render();
          return;
        }
      } catch (err) {
        setError("تعذر التحقق قبل تأكيد السياق. حاول مرة أخرى.");
        render();
        return;
      }
      state.parentConfirmed = true;
      state.view = "review";
      clearError();
      render();
    });
    root.querySelector("[data-rx-confirm-other]").addEventListener("click", function () {
      state.selectedParent = null;
      state.parentConfirmed = false;
      state.childrenUnderParent = [];
      state.view = "facts";
      clearError();
      render();
    });
  }

  function renderReview() {
    if (state.identityAffirmedExisting) {
      state.view = "exists";
      render();
      return;
    }
    if (!state.selectedParent || !state.parentConfirmed) {
      state.view = "confirm";
      render();
      return;
    }
    var f = state.facts;
    var p = state.selectedParent;
    shell(
      "راجع قبل الإرسال",
      '<div class="rx-review">' +
        "<dl>" +
        "<div><dt>الاسم</dt><dd>" +
        escapeHtml(f.personName) +
        "</dd></div>" +
        "<div><dt>الجنس</dt><dd>" +
        escapeHtml(genderLabel(f.gender)) +
        "</dd></div>" +
        "<div><dt>الأب / السياق</dt><dd>" +
        escapeHtml(p.leaf) +
        "</dd></div>" +
        "<div><dt>المسار</dt><dd>" +
        escapeHtml(p.path) +
        "</dd></div>" +
        "<div><dt>تاريخ الميلاد</dt><dd>" +
        escapeHtml(f.birthDate || "—") +
        "</dd></div>" +
        "<div><dt>المرسل</dt><dd>" +
        escapeHtml(f.submitterName) +
        " · " +
        escapeHtml(f.submitterPhone) +
        "</dd></div>" +
        "</dl>" +
        (state.differentPersonSameName
          ? '<p class="rx-note">تنبيه: يوجد أشخاص بنفس الاسم في الشجرة؛ هذا الطلب لشخص <strong>جديد</strong> تحت السياق أعلاه.</p>'
          : "") +
        '<p class="rx-note">سيتم إرسال هذه المعلومات للمراجعة (لن تُحفظ في الشجرة الآن).</p>' +
        '<div class="rx-actions">' +
        '<button type="button" class="btn btn-primary" data-rx-submit' +
        (state.busy ? " disabled" : "") +
        ">أرسل الطلب للمراجعة</button>" +
        '<button type="button" class="btn btn-outline" data-rx-edit>تعديل</button>' +
        "</div>" +
        "</div>",
      { sub: "الإرسال الوحيد إلى مسار المراجعة." }
    );
    root.querySelector("[data-rx-edit]").addEventListener("click", function () {
      state.view = "facts";
      clearError();
      render();
    });
    root.querySelector("[data-rx-submit]").addEventListener("click", function () {
      submitAddPerson();
    });
  }

  function buildTreeCardMessage(payload) {
    var ancestors = Array.isArray(payload.ancestors) ? payload.ancestors : [];
    var lines = [];
    lines.push("طلب: أضف فردًا للعائلة");
    lines.push("");
    lines.push("رقم الطلب: " + payload.requestId);
    lines.push("العائلة: " + (payload.branch || ""));
    if (ancestors.length) {
      lines.push("سلسلة السياق:");
      ancestors.forEach(function (v, idx) {
        lines.push("  " + String(idx + 1) + "- " + (v || ""));
      });
    }
    lines.push("الأب / السياق: " + (payload.father || ""));
    if (payload.parentPath) lines.push("المسار: " + payload.parentPath);
    lines.push("الاسم: " + (payload.personName || ""));
    lines.push("الجنس: " + (payload.genderLabel || ""));
    lines.push("تاريخ الميلاد (اختياري): " + (payload.personDob || ""));
    lines.push("");
    lines.push("بيانات المرسل:");
    lines.push("الاسم: " + (payload.submitterName || ""));
    lines.push("الجوال: " + (payload.submitterPhone || ""));
    lines.push("البريد (اختياري): " + (payload.submitterEmail || ""));
    lines.push("التاريخ: " + new Date(payload.createdAt).toLocaleString("ar-SA"));
    lines.push("");
    lines.push("__JSON__:");
    lines.push(
      JSON.stringify(
        {
          v: 1,
          kind: "tree_card",
          rx: "v1",
          branch_key: payload.branch,
          grandfather: ancestors[0] || "",
          ancestors: ancestors,
          father: payload.father,
          father_path: payload.parentNodeId || payload.parentPath || "",
          father_person_id: payload.parentPersonId || "",
          parent_person_id: payload.parentPersonId || "",
          parent_path: payload.parentPath || "",
          parent_node_id: payload.parentNodeId || "",
          name: payload.personName,
          gender: payload.gender || "",
          birth_date_g: payload.personDob,
          city: "",
          area: "",
          children: [],
          submitter: {
            name: payload.submitterName,
            phone: payload.submitterPhone,
            email: payload.submitterEmail,
          },
          created_at: payload.createdAt,
        },
        null,
        2
      )
    );
    return lines.join("\n");
  }

  /** Map RX person items → snake_case rows the identity guard understands. */
  function toGuardPersonRow(item, parentFallback) {
    if (!item) return null;
    var parentPid = text(
      item.parentPersonId ||
        item.parent_person_id ||
        (parentFallback && parentFallback.personId) ||
        ""
    );
    var parentPath = text(
      item.parent_path ||
        item.parentPath ||
        item.parent_name ||
        (parentFallback && (parentFallback.path || parentFallback.id)) ||
        ""
    );
    return {
      leaf: item.leaf || "",
      person_id: text(item.personId || item.person_id || ""),
      personId: text(item.personId || item.person_id || ""),
      parent_person_id: parentPid,
      parentPersonId: parentPid,
      parent_path: parentPath,
      parent_name: parentPath,
      child_name: item.id || item.leaf || "",
      branch_key: item.branch || "",
      path: item.path || "",
    };
  }

  async function submitAddPerson() {
    if (state.busy) return;
    clearError();
    if (state.identityAffirmedExisting) {
      blockExistingPerson(state.selectedIdentity, "submit-affirmed");
      render();
      return;
    }
    // Selecting an existing tree identity (with person_id) means add-person is forbidden.
    var selectedExistingPid = text(
      (state.selectedIdentity &&
        (state.selectedIdentity.personId || state.selectedIdentity.person_id)) ||
        ""
    );
    if (selectedExistingPid) {
      blockExistingPerson(state.selectedIdentity, "submit-selected-person-id");
      render();
      return;
    }
    if (!state.selectedParent || !state.parentConfirmed) {
      setError("يلزم تأكيد السياق قبل الإرسال.");
      state.view = "confirm";
      render();
      return;
    }
    var sb = getClient();
    if (!sb) {
      setError("تعذر الإرسال لأن الربط غير مُعد.");
      render();
      return;
    }
    var Create = window.AlzidanHomeRequestCreate;
    if (!Create || typeof Create.create !== "function") {
      setError("حارس الهوية غير محمّل. حدّث الصفحة ثم أعد المحاولة.");
      render();
      return;
    }
    state.busy = true;
    render();
    var f = state.facts;
    var p = state.selectedParent;

    try {
      // Hard gate on live tree_children siblings — before any insert.
      var children = await refreshChildrenUnderParent();
      var underSameFather = findExistingChildUnderParent(f.personName, p, children);
      if (underSameFather) {
        state.busy = false;
        blockExistingPerson(underSameFather, "submit-under-parent");
        render();
        return;
      }
      var collisions = await searchIdentityCollisions(f.personName);
      state.identityCandidates = collisions;
      if (collisions.length && !state.differentPersonSameName) {
        state.busy = false;
        setError(
          "يوجد تطابق بالاسم في الشجرة. أكّد إن كان شخصًا موجودًا أو شخصًا آخر بنفس الاسم."
        );
        state.view = "identity";
        render();
        return;
      }
    } catch (gateErr) {
      state.busy = false;
      setError("تعذر التحقق قبل الإرسال. حاول مرة أخرى.");
      render();
      return;
    }

    var parentPersonId = text(p.personId || "");
    if (!parentPersonId) {
      state.busy = false;
      setError(
        "تعذر تحديد هوية الأب في الشجرة. أعد اختيار السياق من نتائج البحث ثم أكّد المسار."
      );
      state.view = "confirm";
      render();
      return;
    }
    var ancestors = ancestorsFromParent(p);
    var payload = {
      requestId: makeRequestId(),
      createdAt: new Date().toISOString(),
      branch: p.branch,
      father: p.leaf,
      parentPath: p.path,
      parentNodeId: p.id,
      parentPersonId: parentPersonId,
      ancestors: ancestors,
      personName: f.personName,
      gender: f.gender,
      genderLabel: genderLabel(f.gender),
      personDob: f.birthDate || "",
      submitterName: f.submitterName,
      submitterPhone: f.submitterPhone,
      submitterEmail: f.submitterEmail ? normalizeEmail(f.submitterEmail) : "",
    };
    var msg = buildTreeCardMessage(payload);
    var row = {
      request_id: payload.requestId,
      kind: "tree_card",
      branch_key: payload.branch,
      name: payload.submitterName,
      phone: payload.submitterPhone,
      email: payload.submitterEmail || null,
      message: msg,
      status: "pending",
      created_at: payload.createdAt,
    };
    var guardSiblings = (state.childrenUnderParent || [])
      .map(function (item) {
        return toGuardPersonRow(item, p);
      })
      .filter(Boolean);
    var guardPeople = (state.identityCandidates || [])
      .map(function (item) {
        return toGuardPersonRow(item, null);
      })
      .filter(Boolean)
      .concat(guardSiblings);
    var guardPayload = {
      person_name: f.personName,
      parent_person_id: parentPersonId,
      parent_path: p.path || p.id || "",
      father: p.leaf,
      branch_key: p.branch,
      identity_affirmed_existing: !!state.identityAffirmedExisting,
      different_person_same_name: !!state.differentPersonSameName,
      // Never invent a new id; only pass when an existing tree person was chosen.
      person_id: selectedExistingPid || "",
    };
    try {
      // Prefer live catalog from home-request-create (snake_case) + pass RX catalog as fallback.
      var created = await Create.create({
        type: "add_person",
        payload: guardPayload,
        catalog: { siblings: guardSiblings, people: guardPeople },
        client: sb,
        skipFetch: false,
        mode: "approval",
        row: row,
        acknowledgeReview: !!state.differentPersonSameName,
      });
      if (!created.ok) {
        state.busy = false;
        if (created.doubleSubmit) {
          setError(
            (created.guard && created.guard.message_ar) ||
              "طلب مكرر — لن يُنشأ طلب ثانٍ."
          );
          render();
          return;
        }
        if (created.blocked && created.guard && created.guard.code === "ADD_PERSON_EXISTS") {
          blockExistingPerson(
            (created.guard.matches && created.guard.matches[0]) || state.selectedIdentity,
            "guard-block"
          );
          render();
          return;
        }
        if (created.needsReview) {
          setError(
            (created.guard && created.guard.message_ar) ||
              "يوجد تطابق بالاسم في الشجرة. أكّد إن كان شخصًا موجودًا أو شخصًا آخر بنفس الاسم."
          );
          state.view = "identity";
          render();
          return;
        }
        setError(
          (created.guard && created.guard.message_ar) ||
            "تعذر إرسال الطلب حاليًا، حاول لاحقًا."
        );
        render();
        return;
      }
      try {
        await sb.functions.invoke("alzidan-email-notify", {
          body: { mode: "new_request", record: row },
        });
      } catch (notifyError) {}
      trackLocal({
        requestId: payload.requestId,
        intentLabel: "أضف فردًا للعائلة",
        status: "submitted",
        summary: payload.personName + " تحت " + payload.father,
        createdAt: payload.createdAt,
      });
      state.lastRequestId = payload.requestId;
      state.lastStatusLabel = statusLabel("submitted");
      state.busy = false;
      state.view = "done";
      clearError();
      render();
    } catch (e) {
      state.busy = false;
      setError("تعذر إرسال الطلب حاليًا، حاول لاحقًا.");
      render();
    }
  }

  function renderDone() {
    shell(
      "تم الإرسال",
      '<div class="rx-done">' +
        '<p class="rx-lead">وصل طلبك لمسار المراجعة.</p>' +
        '<p><strong>الحالة:</strong> ' +
        escapeHtml(state.lastStatusLabel || "تم الإرسال") +
        "</p>" +
        '<p class="rx-muted">مرجع المتابعة (ثانوي): ' +
        escapeHtml(state.lastRequestId) +
        "</p>" +
        '<p class="rx-note">لن تُحفظ البيانات في الشجرة حتى اعتماد الطلب وتطبيقه.</p>' +
        '<div class="rx-actions">' +
        '<button type="button" class="btn btn-primary" data-rx-home>طلب آخر</button>' +
        "</div>" +
        "</div>",
      { showBack: false, sub: "تتبع إنساني — لغة الشحن من رحلة القرار." }
    );
    root.querySelector("[data-rx-home]").addEventListener("click", function () {
      state.facts = {
        personName: "",
        gender: "",
        birthDate: "",
        submitterName: "",
        submitterPhone: "",
        submitterEmail: "",
        parentQuery: "",
      };
      resetIdentityGate();
      goHome();
    });
  }

  render();
})();
