/**
 * Home request hub — visitor intent-first entry.
 * Paths: أضف فردًا · صحح بيانات · مناسبة · ذكرى · بطاقة · حالة صحية · وفاة.
 * No direct tree writes from these screens — requests go to review / طلباتي.
 * Spec: docs/REQUEST-EXPERIENCE-UX-v1.md (adopted 2026-08-09).
 */
(function () {
  "use strict";

  var BRANCHES = ["زيدان", "مزيد", "زايد", "لاحم", "ملحم"];
  /** Same key as app.js so RX reuses warm cache; must honor TTL (app writes {ts,rows}). */
  var CACHE_PREFIX = "alzidan_tree_children_cache_v1:";
  var CACHE_TTL_MS = 5 * 60 * 1000;
  var PAGE_SIZE = 1000;
  var TrackStore = window.AlzidanRxMyRequests || null;
  var TRACK_KEY =
    (TrackStore && TrackStore.TRACK_KEY) || "alzidan_rx_my_requests_v1";
  /** Home «طلباتي» display cap — UI only; does not delete DB/local history. */
  var TRACK_DEFAULT_LIMIT = 10;
  var EXISTING_PERSON_MSG =
    "هذا الشخص موجود مسبقًا في الشجرة. إذا أردت تعديل بياناته فاستخدم (تصحيح بيانات شخص).";
  /** Retest note: father خميس must list حسن، حسين، عبدالعزيز، منصور، مزيد — same count as tree. */

  var INTENTS = [
    {
      id: "tree_card",
      label: "أضف فردًا للعائلة",
      blurb: "أرسل بيانات شخص جديد للمراجعة — بدون حفظ مباشر في الشجرة.",
      implemented: true,
    },
    {
      id: "tree_edit",
      label: "صحح بيانات شخص",
      blurb: "اختر شخصًا موجودًا وحدد ما تريد تصحيحه ثم أرسل للمراجعة.",
      implemented: true,
    },
    {
      id: "occasion",
      label: "إضافة مناسبة",
      blurb: "زواج، تخرج، مولود وغيرها — إرسال للمراجعة.",
      implemented: true,
    },
    {
      id: "memory_card",
      label: "شارك ذكرى",
      blurb: "عنوان ونص ووسائط اختيارية — تظهر في طلباتي بعد الإرسال.",
      implemented: true,
    },
    {
      id: "special_card",
      label: "اطلب بطاقة",
      blurb: "اختر نوع البطاقة والشخص ثم أرسل للمراجعة.",
      implemented: true,
    },
    {
      id: "patient",
      label: "حالة صحية",
      blurb: "مريض، عملية، أو خروج — إرسال للمراجعة.",
      implemented: true,
    },
    {
      id: "event_death",
      label: "إعلان وفاة",
      blurb: "إعلان وفاة مع اسم المتوفى والتاريخ.",
      implemented: true,
    },
  ];

  function uf() {
    return window.AlzidanUserFacingRequestMessages || null;
  }

  function STATUS_VISITOR() {
    var U = uf();
    var pending =
      (U && U.MESSAGES && U.MESSAGES.CHIP_PENDING) ||
      (U && U.MESSAGES && U.MESSAGES.PENDING) ||
      "بانتظار المراجعة";
    var approved =
      (U && U.MESSAGES && U.MESSAGES.CHIP_APPROVED) ||
      (U && U.MESSAGES && U.MESSAGES.APPROVED) ||
      "تمت الموافقة";
    var rejected =
      (U && U.MESSAGES && U.MESSAGES.CHIP_REJECTED) ||
      (U && U.MESSAGES && U.MESSAGES.REJECTED) ||
      "مرفوض";
    return {
      pending: pending,
      submitted: pending,
      assigned: pending,
      in_review: pending,
      needs_changes: pending,
      approved: approved,
      applied: approved,
      done: approved,
      scheduled: (U && U.MESSAGES && U.MESSAGES.CHIP_SCHEDULED) || "مجدول للظهور",
      visible: (U && U.MESSAGES && U.MESSAGES.CHIP_VISIBLE) || "ظاهر الآن",
      ended: (U && U.MESSAGES && U.MESSAGES.CHIP_ENDED) || "منتهٍ",
      rejected: rejected,
    };
  }

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
    /** UI-only: expand «طلباتي» beyond default cap. */
    trackShowAll: false,
    /** UI-only: keep «طلباتي» <details> open across re-renders. */
    trackDetailsOpen: false,
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

  function normalizeArabicDigitsToLatin(v) {
    return String(v == null ? "" : v).replace(/[٠-٩۰-۹０-９]/g, function (ch) {
      var code = ch.charCodeAt(0);
      if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
      if (code >= 0x06F0 && code <= 0x06F9) return String(code - 0x06F0);
      if (code >= 0xFF10 && code <= 0xFF19) return String(code - 0xFF10);
      return ch;
    });
  }

  function normalizePhone(v) {
    if (window.AlzidanPhoneIntl && typeof window.AlzidanPhoneIntl.canonicalizePhone === "function") {
      return window.AlzidanPhoneIntl.canonicalizePhone(v) || "";
    }
    var digits = normalizeArabicDigitsToLatin(String(v || ""))
      .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
      .replace(/[^0-9]/g, "")
      .trim();
    if (!digits) return "";
    if (digits.indexOf("00966") === 0 && digits.length === 14 && digits.charAt(5) === "5") {
      return "+966" + digits.slice(5);
    }
    if (digits.indexOf("966") === 0 && digits.length === 12 && digits.charAt(3) === "5") {
      return "+966" + digits.slice(3);
    }
    if (digits.charAt(0) === "5" && digits.length === 9) return "+966" + digits;
    if (digits.indexOf("05") === 0 && digits.length === 10) return "+966" + digits.slice(1);
    return digits;
  }

  function isValidSaudiMobile(v) {
    if (window.AlzidanPhoneIntl && typeof window.AlzidanPhoneIntl.isValidPhone === "function") {
      return window.AlzidanPhoneIntl.isValidPhone(v);
    }
    return /^\+9665[0-9]{8}$/.test(normalizePhone(v));
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

  var SPECIAL_CARD_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
  var SPECIAL_CARD_IMAGE_MIME = {
    "image/jpeg": 1,
    "image/png": 1,
    "image/webp": 1,
    "image/gif": 1,
    "image/heic": 1,
    "image/heif": 1,
  };
  var SPECIAL_CARD_IMAGE_EXT = {
    jpg: 1,
    jpeg: 1,
    png: 1,
    webp: 1,
    gif: 1,
    heic: 1,
    heif: 1,
  };

  function specialCardFileExt(name, fallback) {
    var base = String(name || "").split("?")[0].trim();
    var m = /\.([a-z0-9]{1,8})$/i.exec(base);
    return (m ? m[1] : fallback || "jpg").toLowerCase();
  }

  function specialCardPublicStorageUrl(path) {
    var cfg = window.__alzidanConfig || {};
    return (
      String(cfg.SUPABASE_URL || "").replace(/\/+$/, "") +
      "/storage/v1/object/public/event-media/" +
      String(path || "")
        .split("/")
        .map(encodeURIComponent)
        .join("/")
    );
  }

  function isAllowedSpecialCardImage(file) {
    if (!file) return false;
    var type = String(file.type || "").trim().toLowerCase();
    var ext = specialCardFileExt(file.name, "").toLowerCase();
    return !!(SPECIAL_CARD_IMAGE_MIME[type] || SPECIAL_CARD_IMAGE_EXT[ext]);
  }

  /** Reuse event-media bucket (same as memory/event public uploads). */
  async function uploadSpecialCardImage(sb, requestId, file) {
    if (!file) return "";
    if (file.size > SPECIAL_CARD_IMAGE_MAX_BYTES) {
      throw new Error("حجم الصورة أكبر من 10MB.");
    }
    if (!isAllowedSpecialCardImage(file)) {
      throw new Error("نوع الصورة غير مدعوم.");
    }
    var path =
      "special-card-pending/" +
      String(requestId || makeRequestId().replace("REQ", "CRD")) +
      "/image-" +
      Date.now() +
      "." +
      specialCardFileExt(file.name, "jpg");
    var res = await sb.storage.from("event-media").upload(path, file, {
      contentType: file.type || "image/jpeg",
      upsert: false,
    });
    if (res.error) {
      throw new Error("تعذر رفع الصورة.");
    }
    return specialCardPublicStorageUrl(path);
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
      // Always supplement with name/path match in-branch. Some children may lack
      // parent_person_id; UUID-only fetch then looks "complete" while omitting them.
      if (branch) {
        var byBranch = await pageQuery(function (q) {
          return q.eq("branch_key", branch);
        });
        var matched = byBranch.filter(function (r) {
          var pRaw = normalizePersonName(r.parent_name || r.parent || "");
          if (!pRaw) return false;
          if (parentId && (pRaw === parentId || pRaw.indexOf(parentId + "/") === 0 || pRaw === parentId)) {
            // Direct children only: parent path equals selected parent id (not deeper).
            return pRaw === parentId;
          }
          var pLeaf = normalizeSearchText(
            getDisplayNameForNodeId(pRaw, getBranchRootName(branch))
          );
          // Leaf-only match is too wide (many خميس). Prefer full parentId when known.
          if (parentId) return false;
          return parentLeaf && pLeaf === parentLeaf;
        });
        if (!all.length) {
          all = matched;
        } else {
          var seenPid = new Set(
            all
              .map(function (r) {
                return normalizePersonName(r.person_id || "");
              })
              .filter(Boolean)
          );
          var seenLeaf = new Set(
            all.map(function (r) {
              return normalizeSearchText(
                getDisplayNameForNodeId(
                  r.child_name || r.name || "",
                  getBranchRootName(branch)
                )
              );
            })
          );
          matched.forEach(function (r) {
            var pid = normalizePersonName(r.person_id || "");
            var leaf = normalizeSearchText(
              getDisplayNameForNodeId(
                r.child_name || r.name || "",
                getBranchRootName(branch)
              )
            );
            if (pid && seenPid.has(pid)) return;
            if (!pid && leaf && seenLeaf.has(leaf)) return;
            if (pid) seenPid.add(pid);
            if (leaf) seenLeaf.add(leaf);
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


  /** Live DB proof: child leaf already under this parent_person_id (ignores UI sibling cache). */
  async function liveChildExistsUnderParentPid(parentPersonId, personName) {
    var pid = text(parentPersonId || "");
    var leafQ = normalizeSearchText(personName || "");
    if (!pid || !leafQ) return null;
    var sb = getClient();
    if (!sb) {
      var e0 = new Error("LIVE_CHILD_CHECK_NO_CLIENT");
      e0.code = "LIVE_CHILD_CHECK_FAILED";
      throw e0;
    }
    var Create = window.AlzidanHomeRequestCreate;
    if (Create && typeof Create.findExistingChildLive === "function") {
      var live = await Create.findExistingChildLive(sb, {
        person_name: personName,
        parent_person_id: pid,
      });
      if (!live) return null;
      return {
        leaf: live.leaf || personName,
        personId: normalizePersonName(live.person_id || ""),
        person_id: normalizePersonName(live.person_id || ""),
        parentPersonId: pid,
        parent_person_id: pid,
        path: normalizePersonName(live.parent_path || ""),
        branch: (state.selectedParent && state.selectedParent.branch) || "",
        reason: live.reason || "live_db_same_parent",
      };
    }
    var res = await sb
      .from("tree_children")
      .select("person_id,parent_person_id,parent_name,child_name,name")
      .eq("parent_person_id", pid)
      .limit(1000);
    if (res.error) {
      var e1 = new Error(
        (res.error && res.error.message) || "LIVE_CHILD_CHECK_QUERY_FAILED"
      );
      e1.code = "LIVE_CHILD_CHECK_FAILED";
      throw e1;
    }
    var rows = Array.isArray(res.data) ? res.data : [];
    for (var i = 0; i < rows.length; i++) {
      var raw = normalizePersonName(rows[i].child_name || rows[i].name || "");
      var leaf =
        raw.indexOf("/") >= 0 ? getDisplayNameForNodeId(raw, "") : raw;
      if (normalizeSearchText(leaf) === leafQ) {
        return {
          leaf: leaf,
          personId: normalizePersonName(rows[i].person_id || ""),
          person_id: normalizePersonName(rows[i].person_id || ""),
          parentPersonId: pid,
          parent_person_id: pid,
          path: normalizePersonName(rows[i].parent_name || ""),
          branch: (state.selectedParent && state.selectedParent.branch) || "",
          reason: "live_db_same_parent_normalized_name",
        };
      }
    }
    return null;
  }

  /**
   * Same-father existence must BLOCK before any «شخص آخر بنفس الاسم» identity UI.
   * Uses parent_person_id live lookup — must NOT depend on sibling-list success.
   */
  async function blockIfExistsUnderSelectedFather(reason) {
    var parent = state.selectedParent;
    var name = text((state.facts && state.facts.personName) || "");
    if (!parent || !name) return false;
    var parentPid = text(parent.personId || "");
    if (!parentPid) return false;

    var listHit = findExistingChildUnderParent(
      name,
      parent,
      state.childrenUnderParent
    );
    if (listHit) {
      blockExistingPerson(listHit, reason || "siblings-under-parent");
      return true;
    }

    var liveHit = await liveChildExistsUnderParentPid(parentPid, name);
    if (liveHit) {
      blockExistingPerson(liveHit, reason || "live-parent-person-id");
      return true;
    }
    return false;
  }

  /**
   * Partition identity collisions: same-father hits → exists/block; never identity-review.
   * Only other-context same-name candidates may reach view:"identity".
   */
  function partitionIdentityCollisions(candidates) {
    var parent = state.selectedParent;
    var parentPid = text((parent && parent.personId) || "");
    var parentNodeId = normalizePersonName((parent && parent.id) || "");
    var sameFather = [];
    var others = [];
    (Array.isArray(candidates) ? candidates : []).forEach(function (c) {
      if (!c) return;
      var cParentPid = text(c.parentPersonId || c.parent_person_id || "");
      var cId = normalizePersonName(c.id || "");
      var leaf = normalizePersonName(c.leaf || "");
      // Direct child only: parent_person_id match, or exact parentNodeId/leaf (not deeper descendants).
      var underSamePid = !!(parentPid && cParentPid && parentPid === cParentPid);
      var underSamePath = !!(
        parentNodeId &&
        leaf &&
        cId === parentNodeId + "/" + leaf
      );
      if (underSamePid || underSamePath) sameFather.push(c);
      else others.push(c);
    });
    return { sameFather: sameFather, others: others };
  }

  /**
   * Before showing identity-review: live same-father gate, then only non-father collisions.
   * Returns "exists" | "identity" | "confirm".
   */
  async function decideAfterNameCheck() {
    if (await blockIfExistsUnderSelectedFather("before-identity-same-father")) {
      return "exists";
    }
    var collisions = await searchIdentityCollisions(state.facts.personName);
    var parts = partitionIdentityCollisions(collisions);
    if (parts.sameFather.length) {
      blockExistingPerson(parts.sameFather[0], "identity-hit-same-father");
      return "exists";
    }
    state.identityCandidates = parts.others;
    if (parts.others.length && !state.differentPersonSameName) {
      return "identity";
    }
    return "confirm";
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
    if (TrackStore && typeof TrackStore.read === "function") {
      return TrackStore.read();
    }
    try {
      var raw = localStorage.getItem(TRACK_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function writeTracked(list) {
    if (TrackStore && typeof TrackStore.write === "function") {
      TrackStore.write(list);
      return;
    }
    try {
      localStorage.setItem(TRACK_KEY, JSON.stringify((list || []).slice(0, 20)));
    } catch (e) {}
  }

  function trackLocal(entry) {
    if (TrackStore && typeof TrackStore.append === "function") {
      TrackStore.append(entry);
      return;
    }
    var list = readTracked().filter(function (x) {
      return x && x.requestId !== entry.requestId;
    });
    list.unshift(entry);
    writeTracked(list);
  }

  /**
   * Admin hard-deletes via admin_delete_request_v1 (DELETE row).
   * Home «طلباتي» is a localStorage mirror — sync live status from DB.
   * anon cannot SELECT approval_requests under RLS (empty/error) → use
   * public_my_request_statuses_v1 (SECURITY DEFINER) when available.
   * On network/RPC failure: keep local list (do not purge blindly).
   * @returns {Promise<boolean>} true if local list changed
   */
  function trackIdKey(raw) {
    return text(raw).toUpperCase();
  }

  async function fetchLiveRequestStatuses(ids) {
    var sb = getClient();
    if (!sb || !ids || !ids.length) {
      return { ok: false, via: "", rows: [], error: "no_client" };
    }
    var cleanIds = [];
    var seenIds = Object.create(null);
    for (var i = 0; i < ids.length; i++) {
      var id = text(ids[i]);
      var key = trackIdKey(id);
      if (!id || seenIds[key]) continue;
      seenIds[key] = true;
      cleanIds.push(id);
    }
    if (!cleanIds.length) {
      return { ok: false, via: "", rows: [], error: "no_ids" };
    }

    // Prefer SECURITY DEFINER RPC — required because RLS hides approval_requests.
    var rpcAttempts = [
      { p_ids: cleanIds },
      { p_ids: cleanIds.map(trackIdKey) },
    ];
    for (var a = 0; a < rpcAttempts.length; a++) {
      try {
        var rpc = await sb.rpc("public_my_request_statuses_v1", rpcAttempts[a]);
        if (!rpc.error && Array.isArray(rpc.data)) {
          return { ok: true, via: "rpc", rows: rpc.data, error: "" };
        }
        // Missing function / schema cache → keep trying fallbacks once.
        if (
          rpc &&
          rpc.error &&
          /PGRST202|Could not find the function|schema cache/i.test(
            String(rpc.error.message || rpc.error.code || "")
          )
        ) {
          return {
            ok: false,
            via: "rpc_missing",
            rows: [],
            error: String(rpc.error.message || "rpc_missing"),
          };
        }
      } catch (eRpc) {}
    }

    // Fallback direct select (works only if RLS allows). No reject_reason column.
    try {
      var res = await sb
        .from("approval_requests")
        .select("request_id,status,message")
        .in("request_id", cleanIds);
      if (res && res.error) {
        return {
          ok: false,
          via: "select",
          rows: [],
          error: String((res.error && res.error.message) || "select_error"),
        };
      }
      var rows = Array.isArray(res && res.data) ? res.data : [];
      // RLS often returns [] with HTTP 200 — not authoritative.
      if (!rows.length) {
        return { ok: false, via: "select_empty", rows: [], error: "rls_empty" };
      }
      return { ok: true, via: "select", rows: rows, error: "" };
    } catch (eSel) {
      return { ok: false, via: "select", rows: [], error: "select_exception" };
    }
  }

  function liveRejectReasonFromRow(db) {
    var direct = text(db && (db.reject_reason || db.rejection_reason));
    if (direct) return direct;
    var Vis =
      typeof window !== "undefined" ? window.AlzidanEventVisibility : null;
    if (Vis && typeof Vis.extractRejectReasonForUi === "function") {
      return text(Vis.extractRejectReasonForUi(db)) || "";
    }
    var U = uf();
    if (U && typeof U.safeRejectionReason === "function") {
      var msg = text(db && db.message);
      var jsonIdx = msg.indexOf("__JSON__");
      if (jsonIdx >= 0) msg = msg.slice(0, jsonIdx);
      var lines = msg.split(/\n/g);
      for (var i = 0; i < lines.length; i++) {
        var line = text(lines[i]);
        if (/^سبب الرفض\s*:|^السبب\s*:|^سبب\s*:/.test(line)) {
          return U.safeRejectionReason(
            line.replace(/^سبب الرفض\s*:\s*|^السبب\s*:\s*|^سبب\s*:\s*/, "")
          );
        }
      }
    }
    return "";
  }

  async function reconcileTrackedWithDb() {
    var list = readTracked();
    if (!list.length) return false;
    var ids = [];
    var seen = Object.create(null);
    for (var i = 0; i < list.length; i++) {
      var rid = text(list[i] && list[i].requestId);
      var key = trackIdKey(rid);
      if (!rid || seen[key]) continue;
      seen[key] = true;
      ids.push(rid);
    }
    if (!ids.length) return false;

    var fetched = await fetchLiveRequestStatuses(ids);
    if (!fetched.ok) return false;

    var live = fetched.rows || [];
    var byId = Object.create(null);
    for (var j = 0; j < live.length; j++) {
      var liveId = trackIdKey(live[j] && live[j].request_id);
      if (liveId) byId[liveId] = live[j];
    }

    var next = [];
    var changed = false;
    var canPurgeMissing = fetched.via === "rpc";
    for (var k = 0; k < list.length; k++) {
      var row = list[k];
      var id = text(row && row.requestId);
      if (!id) {
        changed = true;
        continue;
      }
      var db = byId[trackIdKey(id)];
      if (!db) {
        if (canPurgeMissing) {
          // RPC authoritative: row gone (admin hard-delete).
          changed = true;
          continue;
        }
        next.push(row);
        continue;
      }
      var liveStatus = normalizeTrackStatus(db.status);
      var liveReason = liveRejectReasonFromRow(db);
      var prevStatus = normalizeTrackStatus(row.status);
      var prevReason = text(row.rejectReason || row.reject_reason);
      var patch = null;
      if (liveStatus && liveStatus !== prevStatus) {
        patch = Object.assign({}, row, { status: liveStatus });
      }
      if (liveReason !== prevReason) {
        patch = Object.assign({}, patch || row, {
          rejectReason: liveReason,
          reject_reason: liveReason,
        });
      }
      if (patch) {
        changed = true;
        next.push(patch);
      } else {
        next.push(row);
      }
    }
    if (changed) writeTracked(next);
    return changed;
  }

  var trackReconcileInFlight = null;
  var trackLastReconcileAt = 0;
  var TRACK_RECONCILE_TTL_MS = 8000;
  var trackFocusBound = false;

  /** Re-fetch live rows and re-render home track when local list was purged/updated. */
  function scheduleTrackReconcile(force) {
    if (!force && Date.now() - trackLastReconcileAt < TRACK_RECONCILE_TTL_MS) {
      return trackReconcileInFlight;
    }
    if (trackReconcileInFlight) {
      if (!force) return trackReconcileInFlight;
      // Force: chain another pass after the in-flight one finishes.
      return trackReconcileInFlight.then(function () {
        trackLastReconcileAt = 0;
        return scheduleTrackReconcile(true);
      });
    }
    trackLastReconcileAt = Date.now();
    trackReconcileInFlight = reconcileTrackedWithDb()
      .then(function (changed) {
        trackReconcileInFlight = null;
        if (changed && state.view === "home") render();
        return changed;
      })
      .catch(function () {
        trackReconcileInFlight = null;
        return false;
      });
    return trackReconcileInFlight;
  }

  function bindTrackRefreshHooks() {
    if (trackFocusBound) return;
    trackFocusBound = true;
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && state.view === "home") {
        scheduleTrackReconcile(true);
      }
    });
    window.addEventListener("focus", function () {
      if (state.view === "home") scheduleTrackReconcile(true);
    });
  }

  function statusLabel(status, row) {
    var U = uf();
    var Vis =
      typeof window !== "undefined" ? window.AlzidanEventVisibility : null;
    if (Vis && typeof Vis.deriveSubmitterRequestStatus === "function" && row) {
      var derived = Vis.deriveSubmitterRequestStatus(row, null);
      if (derived && derived.label) return derived.label;
    }
    if (U && typeof U.statusChipLabel === "function") {
      return U.statusChipLabel(status, row && row.kind);
    }
    var s = text(status).toLowerCase();
    var map = STATUS_VISITOR();
    return map[s] || map.pending;
  }

  function submitSuccessCopy(kind, notifyFailed) {
    var U = uf();
    if (U && typeof U.composeSubmitSuccess === "function") {
      return U.composeSubmitSuccess({
        kind: kind,
        notifyFailed: !!notifyFailed,
      });
    }
    var primary = "تم إرسال طلبك بنجاح، وهو الآن قيد المراجعة.";
    var notifyNote = notifyFailed
      ? "تم حفظ طلبك بنجاح، لكن تعذر إرسال إشعار البريد الإلكتروني حاليًا. لا حاجة لإعادة إرسال الطلب."
      : "";
    return {
      primary: primary,
      notifyNote: notifyNote,
      full: notifyNote ? primary + " " + notifyNote : primary,
    };
  }

  function scrubUserError(err, fallback) {
    var U = uf();
    if (U && typeof U.mapTechnicalErrorToArabic === "function") {
      return U.mapTechnicalErrorToArabic(err, fallback);
    }
    return text(fallback) || "تعذر إرسال الطلب حاليًا. حاول مرة أخرى لاحقًا.";
  }

  /** Newest first for home «طلباتي» display. */
  function sortedTracked() {
    var list = readTracked().slice();
    list.sort(function (a, b) {
      var at = String((a && a.createdAt) || "");
      var bt = String((b && b.createdAt) || "");
      if (bt > at) return 1;
      if (bt < at) return -1;
      return 0;
    });
    return list;
  }

  /** Submitter homepage buckets — keep accepted/rejected visible after decision. */
  var TRACK_BUCKETS = {
    pending: { key: "pending", label: "بانتظار الإجراء", emoji: "🟠" },
    approved: { key: "approved", label: "تم القبول", emoji: "🟢" },
    rejected: { key: "rejected", label: "تم الرفض", emoji: "🔴" },
  };

  /** Normalize DB / local / Arabic status tokens to pending|approved|rejected. */
  function normalizeTrackStatus(raw) {
    var s = text(raw).toLowerCase();
    if (!s) return "pending";
    if (
      s === "rejected" ||
      s === "denied" ||
      s.indexOf("رفض") >= 0 ||
      s.indexOf("مرفوض") >= 0
    ) {
      return "rejected";
    }
    if (
      s === "approved" ||
      s === "applied" ||
      s === "done" ||
      s === "accepted" ||
      s === "scheduled" ||
      s === "visible" ||
      s === "ended" ||
      s === "deferred" ||
      s.indexOf("قبول") >= 0 ||
      s.indexOf("موافق") >= 0 ||
      s.indexOf("معتمد") >= 0
    ) {
      return "approved";
    }
    if (
      s === "pending" ||
      s === "submitted" ||
      s === "assigned" ||
      s === "in_review" ||
      s === "needs_changes" ||
      s.indexOf("انتظار") >= 0 ||
      s.indexOf("مراجعة") >= 0
    ) {
      return "pending";
    }
    return "pending";
  }

  function trackBucketKey(row) {
    return normalizeTrackStatus(row && row.status);
  }

  function trackBucketLabel(key) {
    var b = TRACK_BUCKETS[key] || TRACK_BUCKETS.pending;
    return b.label;
  }

  function trackTypeLabel(row) {
    var label = text(row && row.intentLabel);
    if (label && /[\u0600-\u06FF]/.test(label)) return label;
    var U = uf();
    if (U && typeof U.kindLabelAr === "function") {
      return U.kindLabelAr(row && row.kind) || "طلب";
    }
    return label || "طلب";
  }

  function formatTrackDate(raw) {
    var s = text(raw);
    if (!s) return "—";
    if (s.indexOf("T") < 0 && s.length <= 20) return s;
    var d = new Date(s);
    if (isNaN(d.getTime())) {
      return s.length > 16 ? s.slice(0, 16) : s;
    }
    try {
      return d.toLocaleDateString("ar-SA", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch (e) {
      return d.toISOString().slice(0, 10);
    }
  }

  /** تاريخ الطلب = وقت الإرسال؛ إن غاب فالـ dateLabel كاحتياط. */
  function trackDateLabel(row) {
    var sent = text(row && row.createdAt);
    if (sent) return formatTrackDate(sent);
    return formatTrackDate(row && row.dateLabel);
  }

  function trackRejectReason(row) {
    var raw = text(
      row && (row.rejectReason || row.reject_reason || row.reason)
    );
    var U = uf();
    if (U && typeof U.safeRejectionReason === "function") {
      return U.safeRejectionReason(raw);
    }
    var Vis =
      typeof window !== "undefined" ? window.AlzidanEventVisibility : null;
    if (Vis && typeof Vis.extractRejectReasonForUi === "function") {
      return text(Vis.extractRejectReasonForUi(row)) || "";
    }
    if (!raw || /[{}\[\]<>]|__JSON__|https?:\/\//i.test(raw)) return "";
    if (!/[\u0600-\u06FF]/.test(raw)) return "";
    return raw.slice(0, 280);
  }

  function buildCompactTrackRowHtml(row) {
    var bucket = trackBucketKey(row);
    var statusText = trackBucketLabel(bucket);
    var reason = bucket === "rejected" ? trackRejectReason(row) : "";
    return (
      '<li class="rx-track-item rx-track-item--' +
      bucket +
      '">' +
      '<div class="rx-track-row">' +
      '<div class="rx-track-field">' +
      '<span class="rx-track-k">نوع الطلب</span>' +
      '<span class="rx-track-type">' +
      escapeHtml(trackTypeLabel(row)) +
      "</span></div>" +
      '<div class="rx-track-field">' +
      '<span class="rx-track-k">تاريخ الطلب</span>' +
      '<span class="rx-track-date">' +
      escapeHtml(trackDateLabel(row)) +
      "</span></div>" +
      '<div class="rx-track-field">' +
      '<span class="rx-track-k">الحالة الحالية</span>' +
      '<span class="rx-track-status rx-track-status--' +
      bucket +
      '">' +
      escapeHtml(statusText) +
      "</span></div>" +
      (reason
        ? '<div class="rx-track-field rx-track-field--reason">' +
          '<span class="rx-track-k">سبب الرفض</span>' +
          '<span class="rx-track-reason">' +
          escapeHtml(reason) +
          "</span></div>"
        : "") +
      "</div></li>"
    );
  }

  function buildTrackBucketListHtml(rows) {
    if (!rows.length) {
      return '<p class="rx-track-empty">لا طلبات في هذه الحالة.</p>';
    }
    return (
      '<ul class="rx-track-list">' +
      rows.map(buildCompactTrackRowHtml).join("") +
      "</ul>"
    );
  }

  /** Collapsed-by-default «طلباتي» for the submitter who created the requests. */
  function buildTrackHtml() {
    var tracked = sortedTracked();
    var limit = state.trackShowAll ? tracked.length : TRACK_DEFAULT_LIMIT;
    var visible = tracked.slice(0, limit);
    var buckets = {
      pending: [],
      approved: [],
      rejected: [],
    };
    for (var i = 0; i < visible.length; i++) {
      var key = trackBucketKey(visible[i]);
      if (!buckets[key]) key = "pending";
      buckets[key].push(visible[i]);
    }

    var pendingCount = buckets.pending.length;
    var approvedCount = buckets.approved.length;
    var rejectedCount = buckets.rejected.length;

    var summaryCounts =
      '<div class="rx-track-summary-counts" aria-label="ملخص حالات طلباتي">' +
      '<span class="rx-track-count rx-track-count--pending">' +
      TRACK_BUCKETS.pending.emoji +
      " " +
      escapeHtml(TRACK_BUCKETS.pending.label) +
      ' <b>' +
      pendingCount +
      "</b></span>" +
      '<span class="rx-track-count rx-track-count--approved">' +
      TRACK_BUCKETS.approved.emoji +
      " " +
      escapeHtml(TRACK_BUCKETS.approved.label) +
      ' <b>' +
      approvedCount +
      "</b></span>" +
      '<span class="rx-track-count rx-track-count--rejected">' +
      TRACK_BUCKETS.rejected.emoji +
      " " +
      escapeHtml(TRACK_BUCKETS.rejected.label) +
      ' <b>' +
      rejectedCount +
      "</b></span>" +
      "</div>";

    var bodyInner = "";
    if (tracked.length === 0) {
      bodyInner =
        '<p class="rx-muted">لا طلبات بعد. بعد الإرسال تظهر هنا بحالتها.</p>';
    } else {
      bodyInner =
        summaryCounts +
        '<div class="rx-track-box" role="region" aria-label="قائمة طلباتي">' +
        '<section class="rx-track-bucket rx-track-bucket--pending">' +
        "<h4>" +
        TRACK_BUCKETS.pending.emoji +
        " " +
        escapeHtml(TRACK_BUCKETS.pending.label) +
        " (" +
        pendingCount +
        ")</h4>" +
        buildTrackBucketListHtml(buckets.pending) +
        "</section>" +
        '<section class="rx-track-bucket rx-track-bucket--approved">' +
        "<h4>" +
        TRACK_BUCKETS.approved.emoji +
        " " +
        escapeHtml(TRACK_BUCKETS.approved.label) +
        " (" +
        approvedCount +
        ")</h4>" +
        buildTrackBucketListHtml(buckets.approved) +
        "</section>" +
        '<section class="rx-track-bucket rx-track-bucket--rejected">' +
        "<h4>" +
        TRACK_BUCKETS.rejected.emoji +
        " " +
        escapeHtml(TRACK_BUCKETS.rejected.label) +
        " (" +
        rejectedCount +
        ")</h4>" +
        buildTrackBucketListHtml(buckets.rejected) +
        "</section>" +
        "</div>";
    }

    var moreBtn = "";
    if (!state.trackShowAll && tracked.length > TRACK_DEFAULT_LIMIT) {
      moreBtn =
        '<button type="button" class="btn btn-outline btn-sm rx-track-more" data-rx-track-more>' +
        "عرض كل طلباتي (" +
        tracked.length +
        ")</button>";
    } else if (state.trackShowAll && tracked.length > TRACK_DEFAULT_LIMIT) {
      moreBtn =
        '<button type="button" class="btn btn-outline btn-sm rx-track-more" data-rx-track-less>' +
        "عرض آخر " +
        TRACK_DEFAULT_LIMIT +
        "</button>";
    }

    return (
      '<details class="rx-track" data-rx-track-details' +
      (state.trackDetailsOpen ? " open" : "") +
      ">" +
      '<summary class="rx-track-summary">طلباتي</summary>' +
      '<div class="rx-track-body">' +
      '<p class="rx-muted">طلباتك التي أرسلتها للمراجعة — الحالة الحالية بعد القرار.</p>' +
      bodyInner +
      moreBtn +
      "</div>" +
      "</details>"
    );
  }

  function bindTrackUi() {
    var det = root.querySelector("[data-rx-track-details]");
    if (det) {
      det.addEventListener("toggle", function () {
        state.trackDetailsOpen = !!det.open;
        if (det.open) scheduleTrackReconcile(true);
      });
    }
    var more = root.querySelector("[data-rx-track-more]");
    if (more) {
      more.addEventListener("click", function () {
        state.trackShowAll = true;
        state.trackDetailsOpen = true;
        render();
      });
    }
    var less = root.querySelector("[data-rx-track-less]");
    if (less) {
      less.addEventListener("click", function () {
        state.trackShowAll = false;
        state.trackDetailsOpen = true;
        render();
      });
    }
  }

  function setError(msg) {
    state.error = text(msg);
  }

  function clearError() {
    state.error = "";
  }

  function parkOccasionForm() {
    var park = document.querySelector("[data-rx-occasion-park]");
    var panel = document.querySelector("[data-rx-occasion-panel]");
    if (!park || !panel) return;
    if (panel.parentNode !== park) park.appendChild(panel);
  }

  function mountOccasionForm() {
    var mount = root.querySelector("[data-rx-occasion-mount]");
    var panel = document.querySelector("[data-rx-occasion-panel]");
    if (!mount || !panel) return;
    mount.appendChild(panel);
  }

  function parkPatientForm() {
    var park = document.querySelector("[data-rx-patient-park]");
    var panel = document.querySelector("[data-rx-patient-panel]");
    if (!park || !panel) return;
    if (panel.parentNode !== park) park.appendChild(panel);
  }

  function mountPatientForm() {
    var mount = root.querySelector("[data-rx-patient-mount]");
    var panel = document.querySelector("[data-rx-patient-panel]");
    if (!mount || !panel) return;
    mount.appendChild(panel);
  }

  function parkDeathForm() {
    var park = document.querySelector("[data-rx-death-park]");
    var panel = document.querySelector("[data-rx-death-panel]");
    if (!park || !panel) return;
    if (panel.parentNode !== park) park.appendChild(panel);
  }

  function mountDeathForm() {
    var mount = root.querySelector("[data-rx-death-mount]");
    var panel = document.querySelector("[data-rx-death-panel]");
    if (!mount || !panel) return;
    mount.appendChild(panel);
  }


  function parkTreeEditForm() {
    var park = document.querySelector("[data-rx-tree-edit-park]");
    var panel = document.querySelector("[data-rx-tree-edit-panel]");
    if (!park || !panel) return;
    if (panel.parentNode !== park) park.appendChild(panel);
  }

  function mountTreeEditForm() {
    var mount = root.querySelector("[data-rx-tree-edit-mount]");
    var panel = document.querySelector("[data-rx-tree-edit-panel]");
    if (!mount || !panel) return;
    mount.appendChild(panel);
    bindSimplePersonSuggest(panel);
    bindTreeEditSubmit(panel);
  }

  function parkMemoryForm() {
    var park = document.querySelector("[data-rx-memory-park]");
    var panel = document.querySelector("[data-rx-memory-panel]");
    if (!park || !panel) return;
    if (panel.parentNode !== park) park.appendChild(panel);
  }

  function mountMemoryForm() {
    var mount = root.querySelector("[data-rx-memory-mount]");
    var panel = document.querySelector("[data-rx-memory-panel]");
    if (!mount || !panel) return;
    mount.appendChild(panel);
    var host = panel.querySelector("[data-rx-memory-submit-root]");
    if (!host) return;
    if (host.getAttribute("data-memory-mounted") === "1") return;
    var Mem = window.AlzidanMemorySubmit;
    if (!Mem || typeof Mem.mount !== "function") {
      host.innerHTML =
        '<p class="rx-muted">تعذر تحميل نموذج الذكرى. حدّث الصفحة ثم أعد المحاولة.</p>';
      return;
    }
    Mem.mount({
      root: host,
      mode: "public",
      onSaved: function (result) {
        var requestId =
          text(result && (result.requestId || result.id)) ||
          makeRequestId().replace("REQ", "MEM");
        trackLocal(
          TrackStore && typeof TrackStore.buildMemoryEntry === "function"
            ? TrackStore.buildMemoryEntry({
                requestId: requestId,
                title: text(result && result.title) || "ذكرى",
                person: text(result && result.person_name) || "",
                status: "submitted",
                createdAt: new Date().toISOString(),
              })
            : {
                requestId: requestId,
                kind: "memory_card",
                intentLabel: "شارك ذكرى",
                status: "submitted",
                summary: "ذكرى",
                createdAt: new Date().toISOString(),
              }
        );
        state.lastRequestId = requestId;
        state.lastStatusLabel = statusLabel("submitted");
        state.lastNotifyWarn = "";
        state.view = "done";
        render();
      },
    });
    host.setAttribute("data-memory-mounted", "1");
  }

  function parkSpecialCardForm() {
    var park = document.querySelector("[data-rx-special-card-park]");
    var panel = document.querySelector("[data-rx-special-card-panel]");
    if (!park || !panel) return;
    if (panel.parentNode !== park) park.appendChild(panel);
  }

  function mountSpecialCardForm() {
    var mount = root.querySelector("[data-rx-special-card-mount]");
    var panel = document.querySelector("[data-rx-special-card-panel]");
    if (!mount || !panel) return;
    mount.appendChild(panel);
    bindSimplePersonSuggest(panel);
    bindSpecialCardSubmit(panel);
  }

  function parkAllForms() {
    parkOccasionForm();
    parkPatientForm();
    parkDeathForm();
    parkTreeEditForm();
    parkMemoryForm();
    parkSpecialCardForm();
  }

  function clearSuggestBox(box) {
    if (!box) return;
    box.innerHTML = "";
    box.hidden = true;
  }

  function bindSimplePersonSuggest(scope) {
    if (!scope || scope.getAttribute("data-rx-suggest-bound") === "1") return;
    var input = scope.querySelector("[data-event-person]");
    var box = scope.querySelector("[data-event-person-suggest]");
    var idInput = scope.querySelector("[data-event-person-id]");
    var branchSelect = scope.querySelector("[data-event-branch]");
    var hint = scope.querySelector("[data-event-branch-hint]");
    if (!input || !box) return;
    scope.setAttribute("data-rx-suggest-bound", "1");
    var timer = null;

    function applyPick(item) {
      input.value = text(item.leaf || item.display_name || item.person_name || "");
      if (idInput) idInput.value = text(item.personId || item.person_id || "");
      if (branchSelect && item.branch) {
        branchSelect.value = item.branch;
        if (hint) {
          hint.textContent =
            "تم تحديد الفرع من اختيار الشخص — يمكنك تغييره إن لزم.";
          hint.hidden = false;
        }
      }
      clearSuggestBox(box);
    }

    input.addEventListener("input", function () {
      if (idInput) idInput.value = "";
      var q = text(input.value);
      clearTimeout(timer);
      if (q.length < 2) {
        clearSuggestBox(box);
        return;
      }
      timer = setTimeout(function () {
        searchPeople(q, { limit: 8 })
          .then(function (rows) {
            box.innerHTML = "";
            var use = document.createElement("button");
            use.type = "button";
            use.className = "rx-person-suggest-btn";
            use.innerHTML = "<strong>استخدام: " + escapeHtml(q) + "</strong>";
            use.addEventListener("click", function () {
              if (idInput) idInput.value = "";
              clearSuggestBox(box);
            });
            box.appendChild(use);
            (rows || []).slice(0, 8).forEach(function (row) {
              var btn = document.createElement("button");
              btn.type = "button";
              btn.className = "rx-person-suggest-btn";
              btn.innerHTML =
                "<strong>" +
                escapeHtml(row.leaf || "") +
                "</strong><br><small>" +
                escapeHtml(row.path || row.branch || "") +
                "</small>";
              btn.addEventListener("click", function () {
                applyPick(row);
              });
              box.appendChild(btn);
            });
            box.hidden = false;
          })
          .catch(function () {
            clearSuggestBox(box);
          });
      }, 220);
    });
  }

  function setFormAlert(form, type, message) {
    var el =
      form.querySelector("[data-tree-edit-submit-alert]") ||
      form.querySelector("[data-special-card-submit-alert]");
    if (!el) return;
    el.className =
      "founder-alert " +
      (type === "success" ? "founder-alert-success" : "founder-alert-error");
    el.textContent = String(message || "");
    el.style.display = message ? "block" : "none";
  }

  function bindTreeEditSubmit(panel) {
    var form = panel.querySelector("[data-tree-edit-submit-form]");
    if (!form || form.getAttribute("data-rx-bound") === "1") return;
    form.setAttribute("data-rx-bound", "1");
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      submitTreeEdit(form);
    });
    form.addEventListener("reset", function () {
      setFormAlert(form, "success", "");
      var idInput = form.querySelector("[data-event-person-id]");
      if (idInput) idInput.value = "";
    });
    // toggle correction value fields
    form.querySelectorAll("[data-edit-field]").forEach(function (cb) {
      cb.addEventListener("change", function () {
        var key = cb.getAttribute("data-edit-field");
        var wrap = form.querySelector('[data-edit-value-wrap="' + key + '"]');
        if (wrap) wrap.hidden = !cb.checked;
      });
    });
  }

  function buildTreeEditMessage(payload) {
    var lines = [];
    lines.push("طلب: صحح بيانات شخص");
    lines.push("");
    lines.push("رقم الطلب: " + payload.requestId);
    lines.push("الفرع: " + (payload.branch || ""));
    lines.push("الشخص: " + (payload.personName || ""));
    if (payload.personId) lines.push("معرّف الشخص: " + payload.personId);
    lines.push("الحقول المطلوب تصحيحها:");
    (payload.fields || []).forEach(function (f) {
      lines.push(
        "  - " +
          (f.label || f.key) +
          ": " +
          (f.value || "(بدون قيمة جديدة — توضيح في الملاحظات)")
      );
    });
    if (payload.notes) {
      lines.push("");
      lines.push("ملاحظات:");
      lines.push(payload.notes);
    }
    lines.push("");
    lines.push("بيانات المرسل:");
    lines.push("الاسم: " + (payload.submitterName || ""));
    lines.push("الجوال: " + (payload.submitterPhone || ""));
    lines.push("التاريخ: " + new Date(payload.createdAt).toLocaleString("ar-SA"));
    lines.push("");
    lines.push("__JSON__:");
    lines.push(
      JSON.stringify(
        {
          v: 1,
          kind: "tree_edit",
          branch_key: payload.branch,
          person_id: payload.personId || "",
          person_name: payload.personName || "",
          fields: payload.fields || [],
          notes: payload.notes || "",
          submitter: {
            name: payload.submitterName,
            phone: payload.submitterPhone,
          },
          created_at: payload.createdAt,
        },
        null,
        2
      )
    );
    return lines.join("\n");
  }

  async function submitTreeEdit(form) {
    if (form.dataset.submitting === "1") return;
    form.dataset.submitting = "1";
    var submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "جاري الإرسال...";
    }
    try {
      setFormAlert(form, "error", "");
      var personName = text(form.querySelector('[name="person"]') && form.querySelector('[name="person"]').value);
      var personId = text(
        form.querySelector("[data-event-person-id]") &&
          form.querySelector("[data-event-person-id]").value
      );
      var branch = text(form.querySelector('[name="branch"]') && form.querySelector('[name="branch"]').value);
      var submitterName = text(
        form.querySelector('[name="submitterName"]') &&
          form.querySelector('[name="submitterName"]').value
      );
      var phoneWrap = form.querySelector("[data-phone-intl]");
      var phone =
        phoneWrap && window.AlzidanPhoneIntl
          ? window.AlzidanPhoneIntl.readE164(phoneWrap, true).e164 || ""
          : normalizePhone(
              form.querySelector('[name="phone"]') && form.querySelector('[name="phone"]').value
            );
      var notes = text(form.querySelector('[name="notes"]') && form.querySelector('[name="notes"]').value);
      var fieldDefs = [
        { key: "name", label: "الاسم" },
        { key: "gender", label: "الجنس" },
        { key: "birth_date", label: "تاريخ الميلاد" },
        { key: "other", label: "أخرى" },
      ];
      var fields = [];
      fieldDefs.forEach(function (def) {
        var cb = form.querySelector('[data-edit-field="' + def.key + '"]');
        if (!cb || !cb.checked) return;
        var valEl = form.querySelector('[name="edit_' + def.key + '"]');
        fields.push({
          key: def.key,
          label: def.label,
          value: text(valEl && valEl.value),
        });
      });
      if (!personName || !branch || !submitterName || !phone) {
        setFormAlert(form, "error", "أكمل اسم الشخص والفرع واسم المرسل والجوال.");
        return;
      }
      if (!isValidSaudiMobile(phone)) {
        setFormAlert(form, "error", "رقم الجوال غير صحيح. اختر الدولة واكتب الرقم المحلي فقط.");
        return;
      }
      if (!fields.length) {
        setFormAlert(form, "error", "حدّد حقلًا واحدًا على الأقل للتصحيح.");
        return;
      }
      var sb = getClient();
      if (!sb) {
        setFormAlert(form, "error", "تعذر الإرسال لأن الربط غير مُعد.");
        return;
      }
      var Create = window.AlzidanHomeRequestCreate;
      if (!Create || typeof Create.create !== "function") {
        setFormAlert(form, "error", "حارس الهوية غير محمّل. حدّث الصفحة ثم أعد المحاولة.");
        return;
      }
      // Soft duplicate: pending tree_edit for same person_id or same name+branch
      try {
        var pendingQ = await sb
          .from("approval_requests")
          .select("id,request_id,kind,message,status,branch_key")
          .eq("kind", "tree_edit")
          .eq("status", "pending")
          .limit(40);
        if (!pendingQ.error && Array.isArray(pendingQ.data)) {
          var hit = pendingQ.data.some(function (row) {
            var msg = String(row.message || "");
            if (personId && msg.indexOf(personId) >= 0) return true;
            return (
              text(row.branch_key) === branch &&
              msg.indexOf("الشخص: " + personName) >= 0
            );
          });
          if (hit) {
            setFormAlert(
              form,
              "error",
              "يوجد طلب تصحيح قيد المراجعة لنفس الشخص. راقبه من طلباتي."
            );
            return;
          }
        }
      } catch (dupErr) {}

      var payload = {
        requestId: makeRequestId().replace("REQ", "TED"),
        createdAt: new Date().toISOString(),
        branch: branch,
        personName: personName,
        personId: personId,
        fields: fields,
        notes: notes,
        submitterName: submitterName,
        submitterPhone: phone,
      };
      var row = {
        request_id: payload.requestId,
        kind: "tree_edit",
        branch_key: branch,
        name: submitterName,
        phone: phone,
        email: null,
        message: buildTreeEditMessage(payload),
        status: "pending",
        created_at: payload.createdAt,
      };
      var created = await Create.create({
        type: "tree_edit",
        payload: {
          person_id: personId,
          person_name: personName,
          branch_key: branch,
          fields: fields.map(function (f) {
            return f.key + "=" + f.value;
          }).join("|"),
          phone: phone,
        },
        client: sb,
        mode: "approval",
        row: row,
        skipFetch: true,
      });
      if (!created.ok) {
        setFormAlert(
          form,
          "error",
          scrubUserError(
            (created.guard && created.guard.message_ar) || created.error,
            created.doubleSubmit
              ? "طلب مكرر — لن يُنشأ طلب ثانٍ."
              : "تعذر إرسال الطلب حاليًا."
          )
        );
        return;
      }
      var treeEditNotifyFailed = false;
      try {
        var treeEditNotify = null;
        if (typeof Create.notifyBranchDelegatesOfRequest === "function") {
          treeEditNotify = await Create.notifyBranchDelegatesOfRequest(sb, row);
        } else {
          await sb.functions.invoke("alzidan-email-notify", {
            body: { mode: "branch_delegate_new_request", record: row },
          });
          try {
            await sb.functions.invoke("alzidan-push-notify", {
              body: { mode: "branch_delegate_new_request", record: row },
            });
          } catch (_) {}
        }
        if (
          uf() &&
          typeof uf().didNotifyFail === "function" &&
          uf().didNotifyFail(treeEditNotify)
        ) {
          treeEditNotifyFailed = true;
        } else if (treeEditNotify && treeEditNotify.ok === false) {
          treeEditNotifyFailed = true;
        }
        if (treeEditNotifyFailed) {
          try {
            console.warn("[branch-delegate-notify] tree_edit", treeEditNotify);
          } catch (_) {}
        }
      } catch (e2) {
        treeEditNotifyFailed = true;
        try {
          console.warn("[branch-delegate-notify] tree_edit", e2);
        } catch (_) {}
      }
      trackLocal(
        TrackStore && typeof TrackStore.buildTreeEditEntry === "function"
          ? TrackStore.buildTreeEditEntry({
              requestId: payload.requestId,
              person: personName,
              fields: fields.map(function (f) {
                return f.label;
              }).join("، "),
              status: "submitted",
              createdAt: payload.createdAt,
            })
          : {
              requestId: payload.requestId,
              kind: "tree_edit",
              intentLabel: "صحح بيانات شخص",
              status: "submitted",
              summary: personName,
              person: personName,
              createdAt: payload.createdAt,
            }
      );
      form.reset();
      var idInput = form.querySelector("[data-event-person-id]");
      if (idInput) idInput.value = "";
      state.lastRequestId = payload.requestId;
      state.lastStatusLabel = statusLabel("submitted");
      state.lastNotifyWarn = treeEditNotifyFailed
        ? submitSuccessCopy("tree_edit", true).notifyNote
        : "";
      state.view = "done";
      render();
    } finally {
      form.dataset.submitting = "";
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "إرسال";
      }
    }
  }

  function bindSpecialCardSubmit(panel) {
    var form = panel.querySelector("[data-special-card-submit-form]");
    if (!form || form.getAttribute("data-rx-bound") === "1") return;
    form.setAttribute("data-rx-bound", "1");
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      submitSpecialCard(form);
    });
    form.addEventListener("reset", function () {
      setFormAlert(form, "success", "");
      var idInput = form.querySelector("[data-event-person-id]");
      if (idInput) idInput.value = "";
    });
  }

  function buildSpecialCardMessage(payload) {
    var lines = [];
    lines.push("طلب: اطلب بطاقة");
    lines.push("");
    lines.push("رقم الطلب: " + payload.requestId);
    lines.push("الفرع: " + (payload.branch || ""));
    lines.push("نوع البطاقة: " + (payload.cardTypeLabel || payload.cardType || ""));
    lines.push("الشخص: " + (payload.personName || ""));
    if (payload.personId) lines.push("معرّف الشخص: " + payload.personId);
    if (payload.imageUrl) lines.push("رابط الصورة: " + payload.imageUrl);
    if (payload.notes) {
      lines.push("");
      lines.push("ملاحظات:");
      lines.push(payload.notes);
    }
    lines.push("");
    lines.push("بيانات المرسل:");
    lines.push("الاسم: " + (payload.submitterName || ""));
    lines.push("الجوال: " + (payload.submitterPhone || ""));
    lines.push("التاريخ: " + new Date(payload.createdAt).toLocaleString("ar-SA"));
    lines.push("");
    lines.push("__JSON__:");
    lines.push(
      JSON.stringify(
        {
          v: 1,
          kind: "special_card",
          branch_key: payload.branch,
          card_type: payload.cardType,
          card_type_label: payload.cardTypeLabel,
          person_id: payload.personId || "",
          person_name: payload.personName || "",
          imageUrl: payload.imageUrl || "",
          notes: payload.notes || "",
          submitter: {
            name: payload.submitterName,
            phone: payload.submitterPhone,
          },
          created_at: payload.createdAt,
        },
        null,
        2
      )
    );
    return lines.join("\n");
  }

  async function submitSpecialCard(form) {
    if (form.dataset.submitting === "1") return;
    form.dataset.submitting = "1";
    var submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "جاري الإرسال...";
    }
    try {
      setFormAlert(form, "error", "");
      var personName = text(form.querySelector('[name="person"]') && form.querySelector('[name="person"]').value);
      var personId = text(
        form.querySelector("[data-event-person-id]") &&
          form.querySelector("[data-event-person-id]").value
      );
      var branch = text(form.querySelector('[name="branch"]') && form.querySelector('[name="branch"]').value);
      var cardTypeEl = form.querySelector('[name="cardType"]');
      var cardType = text(cardTypeEl && cardTypeEl.value);
      var cardTypeLabel = text(
        cardTypeEl &&
          cardTypeEl.options &&
          cardTypeEl.options[cardTypeEl.selectedIndex] &&
          cardTypeEl.options[cardTypeEl.selectedIndex].textContent
      );
      var submitterName = text(
        form.querySelector('[name="submitterName"]') &&
          form.querySelector('[name="submitterName"]').value
      );
      var phoneWrap = form.querySelector("[data-phone-intl]");
      var phone =
        phoneWrap && window.AlzidanPhoneIntl
          ? window.AlzidanPhoneIntl.readE164(phoneWrap, true).e164 || ""
          : normalizePhone(
              form.querySelector('[name="phone"]') && form.querySelector('[name="phone"]').value
            );
      var notes = text(form.querySelector('[name="notes"]') && form.querySelector('[name="notes"]').value);
      var imageInput = form.querySelector("[data-special-card-image]");
      var imageFile =
        imageInput && imageInput.files && imageInput.files[0]
          ? imageInput.files[0]
          : null;
      if (!personName || !branch || !cardType || !submitterName || !phone) {
        setFormAlert(
          form,
          "error",
          "أكمل نوع البطاقة واسم الشخص والفرع واسم المرسل والجوال."
        );
        return;
      }
      if (!isValidSaudiMobile(phone)) {
        setFormAlert(form, "error", "رقم الجوال غير صحيح. اختر الدولة واكتب الرقم المحلي فقط.");
        return;
      }
      if (imageFile) {
        if (imageFile.size > SPECIAL_CARD_IMAGE_MAX_BYTES) {
          setFormAlert(form, "error", "حجم الصورة أكبر من 10MB.");
          return;
        }
        if (!isAllowedSpecialCardImage(imageFile)) {
          setFormAlert(form, "error", "نوع الصورة غير مدعوم.");
          return;
        }
      }
      var sb = getClient();
      if (!sb) {
        setFormAlert(form, "error", "تعذر الإرسال لأن الربط غير مُعد.");
        return;
      }
      var Create = window.AlzidanHomeRequestCreate;
      if (!Create || typeof Create.create !== "function") {
        setFormAlert(form, "error", "حارس الهوية غير محمّل. حدّث الصفحة ثم أعد المحاولة.");
        return;
      }
      try {
        var pendingQ = await sb
          .from("approval_requests")
          .select("id,request_id,kind,message,status,branch_key")
          .eq("kind", "special_card")
          .eq("status", "pending")
          .limit(40);
        if (!pendingQ.error && Array.isArray(pendingQ.data)) {
          var hit = pendingQ.data.some(function (row) {
            var msg = String(row.message || "");
            if (msg.indexOf("نوع البطاقة: " + cardTypeLabel) < 0) return false;
            if (personId && msg.indexOf(personId) >= 0) return true;
            return (
              text(row.branch_key) === branch &&
              msg.indexOf("الشخص: " + personName) >= 0
            );
          });
          if (hit) {
            setFormAlert(
              form,
              "error",
              "يوجد طلب بطاقة مشابه قيد المراجعة. راقبه من طلباتي."
            );
            return;
          }
        }
      } catch (dupErr) {}

      var payload = {
        requestId: makeRequestId().replace("REQ", "CRD"),
        createdAt: new Date().toISOString(),
        branch: branch,
        personName: personName,
        personId: personId,
        cardType: cardType,
        cardTypeLabel: cardTypeLabel,
        notes: notes,
        imageUrl: "",
        submitterName: submitterName,
        submitterPhone: phone,
      };
      if (imageFile) {
        try {
          setFormAlert(form, "success", "جاري رفع الصورة...");
          payload.imageUrl = await uploadSpecialCardImage(
            sb,
            payload.requestId,
            imageFile
          );
        } catch (upErr) {
          setFormAlert(
            form,
            "error",
            (upErr &&
              scrubUserError(upErr, "تعذر رفع الصورة.")) ||
            "تعذر رفع الصورة."
          );
          return;
        }
      }
      var row = {
        request_id: payload.requestId,
        kind: "special_card",
        branch_key: branch,
        name: submitterName,
        phone: phone,
        email: null,
        message: buildSpecialCardMessage(payload),
        status: "pending",
        created_at: payload.createdAt,
      };
      var created = await Create.create({
        type: "special_card",
        payload: {
          person_id: personId,
          person_name: personName,
          branch_key: branch,
          card_type: cardType,
          phone: phone,
        },
        client: sb,
        mode: "approval",
        row: row,
        skipFetch: true,
      });
      if (!created.ok) {
        setFormAlert(
          form,
          "error",
          scrubUserError(
            (created.guard && created.guard.message_ar) || created.error,
            created.doubleSubmit
              ? "طلب مكرر — لن يُنشأ طلب ثانٍ."
              : "تعذر إرسال الطلب حاليًا."
          )
        );
        return;
      }
      var specialNotifyFailed = false;
      try {
        var specialNotify = null;
        if (typeof Create.notifyAdminOfRequest === "function") {
          specialNotify = await Create.notifyAdminOfRequest(sb, row);
        } else {
          await sb.functions.invoke("alzidan-email-notify", {
            body: { mode: "admin_new_request", record: row },
          });
          try {
            await sb.functions.invoke("alzidan-push-notify", {
              body: { mode: "admin_new_request", record: row },
            });
          } catch (_) {}
        }
        if (
          uf() &&
          typeof uf().didNotifyFail === "function" &&
          uf().didNotifyFail(specialNotify)
        ) {
          specialNotifyFailed = true;
        } else if (specialNotify && specialNotify.ok === false) {
          specialNotifyFailed = true;
        }
        if (specialNotifyFailed) {
          try {
            console.warn("[admin-notify] special_card", specialNotify);
          } catch (_) {}
        }
      } catch (e) {
        specialNotifyFailed = true;
        try {
          console.warn("[admin-notify] special_card", e);
        } catch (_) {}
      }
      // special_card → central admin only (do not notify branch delegates)
      trackLocal(
        TrackStore && typeof TrackStore.buildSpecialCardEntry === "function"
          ? TrackStore.buildSpecialCardEntry({
              requestId: payload.requestId,
              person: personName,
              cardType: cardTypeLabel,
              status: "submitted",
              createdAt: payload.createdAt,
            })
          : {
              requestId: payload.requestId,
              kind: "special_card",
              intentLabel: "اطلب بطاقة",
              status: "submitted",
              summary: cardTypeLabel + " · " + personName,
              person: personName,
              createdAt: payload.createdAt,
            }
      );
      form.reset();
      var idInput = form.querySelector("[data-event-person-id]");
      if (idInput) idInput.value = "";
      state.lastRequestId = payload.requestId;
      state.lastStatusLabel = statusLabel("submitted");
      state.lastNotifyWarn = specialNotifyFailed
        ? submitSuccessCopy("special_card", true).notifyNote
        : "";
      state.view = "done";
      render();
    } finally {
      form.dataset.submitting = "";
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "إرسال";
      }
    }
  }

  function renderTreeEdit() {
    shell(
      "صحح بيانات شخص",
      '<p class="rx-lead">اختر الشخص وحدد الحقول التي تريد تصحيحها، ثم أرسل للمراجعة.</p>' +
        '<div class="rx-tree-edit-mount" data-rx-tree-edit-mount></div>',
      { sub: "يظهر في طلباتي — بدون حفظ مباشر في الشجرة." }
    );
    mountTreeEditForm();
  }

  function renderMemory() {
    shell(
      "شارك ذكرى",
      '<p class="rx-lead">أرسل ذكرى عائلية (عنوان ونص ووسائط اختيارية) للمراجعة.</p>' +
        '<div class="rx-memory-mount" data-rx-memory-mount></div>',
      { sub: "يظهر في طلباتي بعد الإرسال." }
    );
    mountMemoryForm();
  }

  function renderSpecialCard() {
    shell(
      "اطلب بطاقة",
      '<p class="rx-lead">اختر نوع البطاقة والشخص، ويمكنك إرفاق صورة اختيارية، ثم أرسل الطلب للمراجعة.</p>' +
        '<div class="rx-special-card-mount" data-rx-special-card-mount></div>',
      { sub: "يظهر في طلباتي — بدون حفظ مباشر." }
    );
    mountSpecialCardForm();
  }

  function openTreeEdit() {
    clearError();
    state.intentId = "tree_edit";
    state.view = "tree_edit";
    render();
    try {
      if (root && typeof root.scrollIntoView === "function") {
        root.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } catch (e) {}
  }

  function openMemory() {
    clearError();
    state.intentId = "memory_card";
    state.view = "memory";
    render();
    try {
      if (root && typeof root.scrollIntoView === "function") {
        root.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } catch (e) {}
  }

  function openSpecialCard() {
    clearError();
    state.intentId = "special_card";
    state.view = "special_card";
    render();
    try {
      if (root && typeof root.scrollIntoView === "function") {
        root.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } catch (e) {}
  }


  function openOccasion() {
    clearError();
    state.intentId = "occasion";
    state.view = "occasion";
    render();
    try {
      if (root && typeof root.scrollIntoView === "function") {
        root.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } catch (e) {}
  }

  function openPatient() {
    clearError();
    state.intentId = "patient";
    state.view = "patient";
    render();
    try {
      if (root && typeof root.scrollIntoView === "function") {
        root.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } catch (e) {}
  }

  function openDeath() {
    clearError();
    state.intentId = "event_death";
    state.view = "death";
    render();
    try {
      if (root && typeof root.scrollIntoView === "function") {
        root.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } catch (e) {}
  }

  function goHome() {
    parkAllForms();
    state.view = "home";
    state.intentId = "";
    state.selectedParent = null;
    state.parentConfirmed = false;
    state.parentCandidates = [];
    state.childrenUnderParent = [];
    resetIdentityGate();
    state.error = "";
    render();
    scheduleTrackReconcile(true);
  }

  function render() {
    parkAllForms();
    if (state.view === "home") renderHome();
    else if (state.view === "intent") renderIntentPreview();
    else if (state.view === "occasion") renderOccasion();
    else if (state.view === "patient") renderPatient();
    else if (state.view === "death") renderDeath();
    else if (state.view === "tree_edit") renderTreeEdit();
    else if (state.view === "memory") renderMemory();
    else if (state.view === "special_card") renderSpecialCard();
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
    parkAllForms();
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
        if (
          state.view === "intent" ||
          state.view === "scaffold" ||
          state.view === "done" ||
          state.view === "occasion" ||
          state.view === "patient" ||
          state.view === "death" ||
          state.view === "tree_edit" ||
          state.view === "memory" ||
          state.view === "special_card"
        ) {
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
        '<button type="button" class="rx-intent-card rx-intent-card--compact" data-rx-intent="' +
        escapeHtml(intent.id) +
        '">' +
        '<span class="rx-intent-label">' +
        escapeHtml(intent.label) +
        "</span>" +
        (!intent.implemented
          ? '<span class="rx-intent-badge">قريبًا</span>'
          : "") +
        "</button>"
      );
    }).join("");

    /* Compact home: title + type buttons, then طلباتي below. */
    parkAllForms();
    root.innerHTML =
      '<div class="rx-shell rx-shell--compact-home">' +
      (state.error
        ? '<div class="rx-alert rx-alert-error" role="alert">' +
          escapeHtml(state.error) +
          "</div>"
        : "") +
      '<div class="rx-body"><div class="rx-intent-grid rx-intent-grid--compact">' +
      cards +
      "</div>" +
      buildTrackHtml() +
      "</div></div>";

    root.querySelectorAll("[data-rx-intent]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        clearError();
        var id = btn.getAttribute("data-rx-intent");
        var intent = intentById(id);
        if (!intent) return;
        state.intentId = id;
        if (id === "occasion") {
          state.view = "occasion";
        } else if (id === "patient") {
          state.view = "patient";
        } else if (id === "event_death") {
          state.view = "death";
        } else if (id === "tree_edit") {
          state.view = "tree_edit";
        } else if (id === "memory_card") {
          state.view = "memory";
        } else if (id === "special_card") {
          state.view = "special_card";
        } else if (!intent.implemented) {
          state.view = "scaffold";
        } else {
          state.view = "intent";
        }
        render();
      });
    });
    bindTrackUi();
    bindTrackRefreshHooks();
    scheduleTrackReconcile(true);
  }

  function renderOccasion() {
    shell(
      "إضافة مناسبة",
      '<p class="rx-lead">أرسل خبر مناسبة للعائلة للمراجعة والاعتماد. الزواج نوع من أنواع المناسبة — اختره من القائمة.</p>' +
        '<div class="rx-occasion-mount" data-rx-occasion-mount></div>',
      {
        sub: "زواج · تخرج · مولود · سفر وغيرها — يظهر في طلباتي بعد الإرسال.",
      }
    );
    mountOccasionForm();
  }

  function renderPatient() {
    shell(
      "حالة صحية",
      '<p class="rx-lead">أرسل حالة مرضية للعائلة للمراجعة والاعتماد — مريض أو عملية أو خروج.</p>' +
        '<div class="rx-patient-mount" data-rx-patient-mount></div>',
      {
        sub: "مريض · عملية · خروج من المستشفى — يظهر في طلباتي بعد الإرسال.",
      }
    );
    mountPatientForm();
  }

  function renderDeath() {
    shell(
      "إعلان وفاة",
      '<p class="rx-lead">أرسل إعلان وفاة للعائلة للمراجعة والاعتماد — اسم المتوفى والتاريخ.</p>' +
        '<div class="rx-death-mount" data-rx-death-mount></div>',
      {
        sub: "يظهر في طلباتي بعد الإرسال — وبعد المراجعة في قسم الوفيات.",
      }
    );
    mountDeathForm();
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
        '<p class="rx-note">لن تُحفظ البيانات مباشرة. بعد الإرسال تظهر في طلباتي، وتُضاف بعد المراجعة فقط.</p>' +
        '<div class="rx-actions">' +
        '<button type="button" class="btn btn-primary" data-rx-start>ابدأ</button>' +
        '<button type="button" class="btn btn-outline" data-rx-cancel>إلغاء</button>' +
        "</div>",
      { sub: "هذه الخطوة للبدء فقط — الإرسال في النهاية." }
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
      intent ? intent.label : "طلب",
      '<p class="rx-lead">هذا الخيار غير متاح حاليًا.</p>' +
        '<div class="rx-actions">' +
        '<button type="button" class="btn btn-primary" data-rx-home>العودة</button>' +
        "</div>",
      { sub: "قريبًا." }
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
            : '<p class="rx-muted">القائمة كاملة كما في الشجرة — بلا حد عرض.</p>') +
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
        (window.AlzidanPhoneIntl
          ? window.AlzidanPhoneIntl.fieldHtml({
              key: "rx-submitter",
              nationalName: "submitterPhone",
              required: true,
              value: f.submitterPhone,
              hint: "اختر الدولة ثم اكتب الرقم المحلي فقط.",
            })
          : '<input name="submitterPhone" required type="text" inputmode="numeric" autocomplete="tel" dir="ltr" value="' +
            escapeHtml(f.submitterPhone) +
            '" placeholder="5XXXXXXXX" />') +
        '</label>' +
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
    if (form && window.AlzidanPhoneIntl) window.AlzidanPhoneIntl.bindAllIn(form);

    function readForm() {
      var fd = new FormData(form);
      var prevName = state.facts.personName;
      state.facts.personName = text(fd.get("personName"));
      state.facts.gender = text(fd.get("gender"));
      state.facts.birthDate = text(fd.get("birthDate"));
      state.facts.parentQuery = text(fd.get("parentQuery"));
      state.facts.submitterName = text(fd.get("submitterName"));
      var phoneWrap = form.querySelector('[data-phone-intl="rx-submitter"]');
      if (phoneWrap && window.AlzidanPhoneIntl) {
        var pr = window.AlzidanPhoneIntl.readE164(phoneWrap, true);
        state.facts.submitterPhone = pr.e164 || "";
      } else {
        state.facts.submitterPhone = normalizePhone(fd.get("submitterPhone"));
      }
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
            : "القائمة كاملة كما في الشجرة — بلا حد عرض.";
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
      if (!state.facts.submitterName || !isValidSaudiMobile(state.facts.submitterPhone)) {
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
        await refreshChildrenUnderParent();
        // Live parent_person_id gate BEFORE identity-review («شخص آخر بنفس الاسم»).
        var next = await decideAfterNameCheck();
        if (next === "exists") {
          render();
          return;
        }
        if (next === "identity") {
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
        await refreshChildrenUnderParent();
        if (await blockIfExistsUnderSelectedFather("different-name-same-father")) {
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
        '<p class="rx-note"><strong>لن يُنشأ طلب إضافة</strong> — استخدم «صحح بيانات شخص» إن أردت تعديل بياناته.</p>' +
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
      state.view = "tree_edit";
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
        await refreshChildrenUnderParent();
        if (await blockIfExistsUnderSelectedFather("diff-anyway-same-father")) {
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
        await refreshChildrenUnderParent();
        if (await blockIfExistsUnderSelectedFather("confirm-parent-same-child")) {
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
      { sub: "إرسال الطلب للمراجعة." }
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
    var Contract =
      (typeof window !== "undefined" && window.AlzidanTreeCardContract) || null;
    if (Contract && typeof Contract.serializeTreeCardRequest === "function") {
      var ancestors = Array.isArray(payload.ancestors) ? payload.ancestors : [];
      var canonical = Contract.normalizeTreeCardPayload(
        {
          v: 1,
          schema: Contract.SCHEMA || "tree_card.v1",
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
        {
          row: {
            request_id: payload.requestId,
            branch_key: payload.branch,
            name: payload.submitterName,
            phone: payload.submitterPhone,
            email: payload.submitterEmail,
            created_at: payload.createdAt,
          },
        }
      );
      return Contract.serializeTreeCardRequest(canonical, {
        request_id: payload.requestId,
        branch_key: payload.branch,
        name: payload.submitterName,
        phone: payload.submitterPhone,
        email: payload.submitterEmail,
        created_at: payload.createdAt,
      });
    }
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
          schema: "tree_card.v1",
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
    state.busy = true;
    clearError();
    if (state.identityAffirmedExisting) {
      state.busy = false;
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
      state.busy = false;
      blockExistingPerson(state.selectedIdentity, "submit-selected-person-id");
      render();
      return;
    }
    if (!state.selectedParent || !state.parentConfirmed) {
      state.busy = false;
      setError("يلزم تأكيد السياق قبل الإرسال.");
      state.view = "confirm";
      render();
      return;
    }
    var sb = getClient();
    if (!sb) {
      state.busy = false;
      setError("تعذر الإرسال لأن الربط غير مُعد.");
      render();
      return;
    }
    var Create = window.AlzidanHomeRequestCreate;
    if (!Create || typeof Create.create !== "function") {
      state.busy = false;
      setError("حارس الهوية غير محمّل. حدّث الصفحة ثم أعد المحاولة.");
      render();
      return;
    }
    render();
    var f = state.facts;
    var p = state.selectedParent;

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

    // Same-father live gate FIRST — never send same-father hits to identity-review.
    // Create.create also fail-closes with the same parent_person_id lookup before INSERT.
    try {
      var nextGate = await decideAfterNameCheck();
      if (nextGate === "exists") {
        state.busy = false;
        render();
        return;
      }
      if (nextGate === "identity") {
        state.busy = false;
        setError(
          "يوجد تطابق بالاسم في الشجرة. أكّد إن كان شخصًا موجودًا أو شخصًا آخر بنفس الاسم."
        );
        state.view = "identity";
        render();
        return;
      }
      try {
        console.info("[RX submitAddPerson live-pid-gate]", {
          personName: f.personName,
          parentPersonId: parentPersonId,
          parentPath: text(p.id || p.path || ""),
          liveHit: null,
          different_person_same_name: !!state.differentPersonSameName,
          acknowledgeReview: !!state.differentPersonSameName,
          guardDecision: "continue",
          guardReason: "no-live-pid-match",
        });
      } catch (logErr2) {}
    } catch (gateErr) {
      state.busy = false;
      setError("تعذر التحقق قبل الإرسال. حاول مرة أخرى.");
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
      // Prefer unspaced node id (matches tree_children.parent_name); path label is fallback.
      parent_path: p.id || p.path || "",
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
      var notifyWarn = "";
      try {
        var CreateNotify = window.AlzidanHomeRequestCreate;
        var branchNotify = null;
        if (CreateNotify && typeof CreateNotify.notifyBranchDelegatesOfRequest === "function") {
          branchNotify = await CreateNotify.notifyBranchDelegatesOfRequest(sb, row);
        } else {
          branchNotify = await sb.functions.invoke("alzidan-email-notify", {
            body: { mode: "branch_delegate_new_request", record: row },
          });
          try {
            await sb.functions.invoke("alzidan-push-notify", {
              body: { mode: "branch_delegate_new_request", record: row },
            });
          } catch (_) {}
          branchNotify = {
            ok: !(branchNotify && branchNotify.error),
            emailError:
              branchNotify && branchNotify.error
                ? String(branchNotify.error.message || branchNotify.error)
                : "",
          };
        }
        var notifyFailed =
          (uf() &&
            typeof uf().didNotifyFail === "function" &&
            uf().didNotifyFail(branchNotify)) ||
          (branchNotify && branchNotify.ok === false);
        if (notifyFailed) {
          try {
            console.warn("[branch-delegate-notify]", branchNotify);
          } catch (_) {}
          notifyWarn = submitSuccessCopy("tree_card", true).notifyNote;
        }
      } catch (branchNotifyError) {
        notifyWarn = submitSuccessCopy("tree_card", true).notifyNote;
        try {
          console.warn("[branch-delegate-notify]", branchNotifyError);
        } catch (_) {}
      }
      trackLocal(
        TrackStore && typeof TrackStore.buildAddPersonEntry === "function"
          ? TrackStore.buildAddPersonEntry({
              requestId: payload.requestId,
              personName: payload.personName,
              father: payload.father,
              status: "submitted",
              createdAt: payload.createdAt,
            })
          : {
              requestId: payload.requestId,
              kind: "tree_card",
              intentLabel: "أضف فردًا للعائلة",
              status: "submitted",
              summary: payload.personName + " تحت " + payload.father,
              createdAt: payload.createdAt,
            }
      );
      state.lastRequestId = payload.requestId;
      state.lastStatusLabel = statusLabel("submitted");
      state.lastNotifyWarn = notifyWarn || "";
      state.busy = false;
      state.view = "done";
      clearError();
      render();
    } catch (e) {
      state.busy = false;
      setError(scrubUserError(e, "تعذر إرسال الطلب حاليًا، حاول لاحقًا."));
      render();
    }
  }

  function renderDone() {
    var copy = submitSuccessCopy(
      state.intentId || "tree_card",
      !!state.lastNotifyWarn
    );
    var notifyNote = state.lastNotifyWarn
      ? '<p class="rx-note" style="color:#b45309">' +
        escapeHtml(state.lastNotifyWarn) +
        "</p>"
      : "";
    shell(
      "تم الإرسال",
      '<div class="rx-done">' +
        '<p class="rx-lead">' +
        escapeHtml(copy.primary) +
        "</p>" +
        '<p><strong>الحالة:</strong> ' +
        escapeHtml(state.lastStatusLabel || statusLabel("submitted")) +
        "</p>" +
        '<p class="rx-muted">مرجع المتابعة (ثانوي): ' +
        escapeHtml(state.lastRequestId) +
        "</p>" +
        '<p class="rx-note">' +
        escapeHtml(
          state.intentId === "memory_card"
            ? "تظهر الذكرى لدى الإدارة في «الذكريات» للمراجعة قبل النشر."
            : "يظهر طلبك في طلباتي. بدون حفظ مباشر حتى تتم المراجعة."
        ) +
        "</p>" +
        notifyNote +
        '<div class="rx-actions">' +
        '<button type="button" class="btn btn-primary" data-rx-home>طلب آخر</button>' +
        "</div>" +
        "</div>",
      { showBack: false, sub: copy.primary }
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

  if (TrackStore && typeof TrackStore.onChange === "function") {
    TrackStore.onChange(function () {
      if (state.view === "home") render();
    });
  }

  function openIntentFromHash() {
    var hash = String(location.hash || "");
    if (hash === "#send-event" || hash === "#rx-occasion") {
      openOccasion();
    } else if (hash === "#send-patient" || hash === "#rx-patient") {
      openPatient();
    } else if (hash === "#send-death" || hash === "#rx-death") {
      openDeath();
    } else if (hash === "#rx-tree-edit" || hash === "#send-tree-edit") {
      openTreeEdit();
    } else if (hash === "#rx-memory" || hash === "#send-memory") {
      openMemory();
    } else if (hash === "#rx-special-card" || hash === "#send-special-card") {
      openSpecialCard();
    }
  }

  window.AlzidanRequestExperience = {
    openOccasion: openOccasion,
    openPatient: openPatient,
    openDeath: openDeath,
    openTreeEdit: openTreeEdit,
    openMemory: openMemory,
    openSpecialCard: openSpecialCard,
  };

  render();
  scheduleTrackReconcile(true);
  openIntentFromHash();
  window.addEventListener("hashchange", openIntentFromHash);
})();
