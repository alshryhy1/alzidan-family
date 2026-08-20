/**
 * Tree Structure Integrity Audit — read-only.
 * Extends Health Center (ADR-004 / R-7): detect broken parent links; never auto-repair.
 *
 * Categories:
 *  - parent_null: column `parent` is NULL/blank (dual-column drift)
 *  - parent_empty: both parent and parent_name empty
 *  - missing_father: no valid parent_person_id AND parent string matches no living father
 *  - path_mismatch: parent extracted from name path ≠ stored parent, OR stored parent
 *    text conflicts with a valid parent_person_id (orange review — not missing_father)
 *  - possible_spelling_duplicates: sibling names match after Arabic normalize (review only)
 *  - wrong_name_similarity: siblings under same father, edit distance 1 after normalize
 *  - suspicious_name_typo: OCR/typo patterns (محد، أرقام في الاسم) — not popular names
 *  - duplicate_person_id
 *  - spouses_without_husband
 *  - broken_relation: union of structural failures (no healthy father link)
 *
 * TREE-003 / missing-father rule: a resolvable parent_person_id is primary relationship
 * evidence. Never emit red «الأب غير موجود» when the UUID points at a living father row.
 */
(function (global) {
  "use strict";

  var CAT = {
    PARENT_NULL: "parent_null",
    PARENT_EMPTY: "parent_empty",
    MISSING_FATHER: "missing_father",
    PATH_MISMATCH: "path_mismatch",
    POSSIBLE_SPELLING_DUPLICATES: "possible_spelling_duplicates",
    WRONG_NAME_SIMILARITY: "wrong_name_similarity",
    SUSPICIOUS_NAME_TYPO: "suspicious_name_typo",
    DUPLICATE_PERSON_ID: "duplicate_person_id",
    SPOUSES_WITHOUT_HUSBAND: "spouses_without_husband",
    BROKEN_RELATION: "broken_relation",
  };

  var CAT_AR = {
    parent_null: "حقل الأب فارغ",
    parent_empty: "الأب غير مذكور",
    missing_father: "الأب غير موجود في الشجرة",
    path_mismatch: "عدم تطابق/مراجعة",
    possible_spelling_duplicates: "تكرار تحت الأب نفسه",
    wrong_name_similarity: "تشابه خاطئ تحت الأب",
    suspicious_name_typo: "كتابة مشتبهة في الاسم",
    duplicate_person_id: "معرف شخص مكرر",
    spouses_without_husband: "زوجات بلا زوج صالح",
    broken_relation: "أبناء بدون أب صالح",
  };

  /** Impact hints shown in Health Center (product language). */
  var CAT_IMPACT = {
    parent_null: [
      "لا يظهر ضمن أبناء الأب",
      "لا يظهر في البحث",
      "يسمح بطلبات مكررة",
    ],
    parent_empty: [
      "لا يظهر ضمن أبناء الأب",
      "لا يظهر في البحث",
      "يعطل مسار الطلبات",
    ],
    missing_father: [
      "لا يظهر ضمن أبناء الأب",
      "يعطل مسار الطلبات",
      "يسمح بطلبات مكررة",
    ],
    path_mismatch: [
      "لا يظهر ضمن أبناء الأب",
      "لا يظهر في البحث",
      "يعطل مسار الطلبات",
    ],
    possible_spelling_duplicates: [
      "يسمح بطلبات مكررة",
      "يُربك البحث في الطلبات",
    ],
    wrong_name_similarity: [
      "يسمح بطلبات مكررة",
      "يُربك البحث في الطلبات",
    ],
    suspicious_name_typo: [
      "يُربك البحث في الطلبات",
      "يسمح بطلبات مكررة",
    ],
    duplicate_person_id: [
      "يسمح بطلبات مكررة",
      "يحتاج ربط المعرف الداخلي",
      "يعطل مسار الطلبات",
    ],
    spouses_without_husband: ["يعطل مسار الطلبات", "لا يظهر في البحث"],
    broken_relation: [
      "لا يظهر ضمن أبناء الأب",
      "لا يظهر في البحث",
      "يعطل مسار الطلبات",
    ],
  };

  /** Priority: manager sees what to fix first. */
  var PRIORITY = {
    CRITICAL: "critical",
    HIGH: "high",
    MEDIUM: "medium",
    HEALTHY: "healthy",
  };

  var PRIORITY_AR = {
    critical: "🔴 حرج",
    high: "🟠 مرتفع",
    medium: "🟡 متوسط",
    healthy: "🟢 سليم",
  };

  var CAT_PRIORITY = {
    parent_null: PRIORITY.CRITICAL,
    parent_empty: PRIORITY.CRITICAL,
    missing_father: PRIORITY.CRITICAL,
    path_mismatch: PRIORITY.HIGH,
    possible_spelling_duplicates: PRIORITY.HIGH,
    wrong_name_similarity: PRIORITY.HIGH,
    suspicious_name_typo: PRIORITY.MEDIUM,
    broken_relation: PRIORITY.HIGH,
    duplicate_person_id: PRIORITY.MEDIUM,
    spouses_without_husband: PRIORITY.MEDIUM,
  };

  /** Root-cause templates (fix the source, not only the symptom). */
  var CAT_ROOT_CAUSE = {
    parent_null:
      "أُنشئ بلا أب، أو حقل الأب فارغ بينما اسم الأب موجود — غالبًا من استيراد أو مندوب أو صيانة قديمة.",
    parent_empty:
      "سجل بلا أب مذكور — غالبًا استيراد ناقص أو أداة صيانة تجاوزت التحقق.",
    missing_father:
      "لا يوجد parent_person_id صالح، ونص الأب لا يطابق أحدًا في الشجرة: إملاء مختلف، أو الأب لم يُضف بعد، أو اعتماد طلب بلا أب صالح.",
    path_mismatch:
      "عُدّل المسار دون تحديث حقل الأب، أو نص الأب لا يطابق الأب المرتبط بـ UUID، أو الاسم مكتوب بطريقة مختلفة عن صف الأب. اختلاف ى/ي وحده بعد التوحيد لا يُعدّ مشكلة هيكلية.",
    possible_spelling_duplicates:
      "اسمان تحت نفس الأب تطابقا بعد توحيد العربية (همزة / ى↔ي / ة↔ه / تشكيل) — قد يكونان شخصًا واحدًا أو شخصين مختلفين.",
    wrong_name_similarity:
      "اسمان تحت نفس الأب يختلفان بحرف زائد أو ناقص بعد التوحيد — غالبًا خطأ إدخال لا أخوان باسمين مختلفين (مثل سعيد وسعود).",
    suspicious_name_typo:
      "ورقة الاسم تطابق نمط مسح أو خطأ شائع (محد بدل محمد، رقم داخل الاسم، رمز OCR).",
    duplicate_person_id:
      "دمج أو استيراد مكرر — يحتاج ربط المعرف الداخلي لا إعادة تسمية.",
    spouses_without_husband: "زوجة رُبطت بزوج غير موجود أو معرف مكسور.",
    broken_relation: "مشكلة مركّبة — راجع الفئة الأساسية للسجل.",
  };

  var CAT_WRITE_PATH = {
    parent_null:
      "كيفية الإصلاح: اربط السجل بأب موجود في الشجرة (مندوب · إدارة الشجرة · استيراد · صيانة) بعد الموافقة.",
    parent_empty:
      "كيفية الإصلاح: امنع الكتابة بلا أب للمستجد؛ السجلات القديمة تُصلح خطوة بخطوة بعد موافقة.",
    missing_father:
      "كيفية الإصلاح: أنشئ الأب أولًا في الشجرة، أو صحّح اسم الأب ليطابق سجلًا موجودًا — ارفض الاعتماد بلا أب.",
    path_mismatch:
      "كيفية الإصلاح: وحّد حقل الأب مع المسار عبر إصلاح صف واحد بعد موافقة (مندوب/إدارة/استيراد).",
    possible_spelling_duplicates:
      "كيفية الإصلاح: مراجعة يدوية فقط — لا دمج تلقائي. قرّر لاحقًا الإبقاء أو الدمج بعد التحقق.",
    wrong_name_similarity:
      "كيفية الإصلاح: راجع إن كانا شخصًا واحدًا بخطأ إملائي أو شخصين — لا دمج تلقائي.",
    suspicious_name_typo:
      "كيفية الإصلاح: صحّح ورقة الاسم من إدارة الشجرة بعد التأكد — ليس توحيد أسماء شائعة.",
    duplicate_person_id:
      "كيفية الإصلاح: ربط المعرف الداخلي عبر مسار الكتابة الموحّد — بلا إعادة تسمية.",
    spouses_without_husband:
      "كيفية الإصلاح: اربط الزوجة بزوج موجود عبر معرف الزوج (إدارة/مندوب).",
    broken_relation: "كيفية الإصلاح: راجع الفئة الأساسية لنفس السجل أعلاه.",
  };

  var GROUP_DATA_INTEGRITY = "data_integrity";
  var GROUP_UUID_LINK = "uuid_link";

  function normalizeArabicDigitsLocal(v) {
    return String(v == null ? "" : v)
      .replace(/[٠-٩]/g, function (d) {
        return String(d.charCodeAt(0) - 1632);
      })
      .replace(/[۰-۹]/g, function (d) {
        return String(d.charCodeAt(0) - 1776);
      });
  }

  /** Shared with Core.normalizeArabicForCompare when available. */
  function normalizeArabicForCompare(value) {
    var Core = global.AlzidanAdminCore;
    if (Core && typeof Core.normalizeArabicForCompare === "function") {
      return Core.normalizeArabicForCompare(value);
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

  function norm(v) {
    return String(v == null ? "" : v)
      .replace(/\s+/g, " ")
      .trim();
  }

  /** Path equality after Arabic fold (ى↔ي · همزة · ة↔ه · مسافات). */
  function pathsEqual(a, b) {
    var na = normalizeArabicForCompare(a);
    var nb = normalizeArabicForCompare(b);
    return !!na && !!nb && na === nb;
  }

  /**
   * Explain why two Arabic spellings match after normalize (tree-manager language).
   * e.g. أنس / انس → اختلاف همزة
   */
  function explainArabicSpellingDiff(a, b) {
    var s1 = norm(a);
    var s2 = norm(b);
    if (!s1 || !s2) return "غير موثّق";
    if (s1 === s2) return "نفس الكتابة";

    function stripMarks(s) {
      return String(s || "").replace(/[\u064B-\u065F\u0670\u0640]/g, "");
    }
    function foldHamza(s) {
      return String(s || "")
        .replace(/[إأآٱ]/g, "ا")
        .replace(/ؤ/g, "و")
        .replace(/ئ/g, "ي")
        .replace(/ء/g, "");
    }

    var reasons = [];
    var curA = s1;
    var curB = s2;
    var nextA = stripMarks(curA);
    var nextB = stripMarks(curB);
    if (curA !== curB && nextA === nextB) reasons.push("اختلاف تشكيل");
    curA = nextA;
    curB = nextB;

    nextA = foldHamza(curA);
    nextB = foldHamza(curB);
    if (curA !== curB && nextA === nextB) reasons.push("اختلاف همزة");
    curA = nextA;
    curB = nextB;

    nextA = curA.replace(/ى/g, "ي");
    nextB = curB.replace(/ى/g, "ي");
    if (curA !== curB && nextA === nextB) reasons.push("اختلاف ياء (ى/ي)");
    curA = nextA;
    curB = nextB;

    nextA = curA.replace(/ة/g, "ه");
    nextB = curB.replace(/ة/g, "ه");
    if (curA !== curB && nextA === nextB) reasons.push("اختلاف تاء مربوطة (ة/ه)");
    curA = nextA;
    curB = nextB;

    if (reasons.length) return reasons.join(" + ");
    if (normalizeArabicForCompare(s1) === normalizeArabicForCompare(s2)) {
      return "الاسم مكتوب بطريقة مختلفة";
    }
    return "الاسم مكتوب بطريقة مختلفة";
  }

  function childPath(row) {
    return norm((row && (row.child_name || row.name)) || "");
  }

  function parentColumn(row) {
    return norm((row && row.parent) || "");
  }

  function parentNameColumn(row) {
    return norm((row && row.parent_name) || "");
  }

  /** Stored parent used by most queries: parent_name preferred, then parent. */
  function storedParent(row) {
    return parentNameColumn(row) || parentColumn(row);
  }

  function leafName(path) {
    var p = norm(path);
    if (!p) return "";
    return p.indexOf("/") >= 0 ? norm(p.slice(p.lastIndexOf("/") + 1)) : p;
  }

  /** First path segment — short names like محمد/حمد → محمد (person given name). */
  function givenName(path) {
    var p = norm(path);
    if (!p) return "";
    return p.indexOf("/") >= 0 ? norm(p.slice(0, p.indexOf("/"))) : p;
  }

  function fatherDisplay(row) {
    var stored = storedParent(row);
    if (stored) return leafName(stored) || stored;
    return "—";
  }

  /**
   * Living father row via parent_person_id (primary TREE-003 evidence).
   * Returns null when UUID missing or not present in the children index.
   */
  function resolveFatherByPersonId(index, parentPersonId) {
    if (!index || parentPersonId == null) return null;
    var pid = String(parentPersonId).trim();
    if (!pid) return null;
    var list = index.personIdMap.get(pid) || [];
    if (!list.length) return null;
    return list[0];
  }

  /**
   * True when stored parent text identifies the same living father as parent_person_id.
   * Accepts full path, leaf, given-name, or unique text resolve to same person_id.
   */
  function textAgreesWithUuidFather(index, branch, stored, fatherRow) {
    var s = norm(stored);
    if (!s || !fatherRow) return true;
    var fPath = childPath(fatherRow);
    if (pathsEqual(s, fPath)) return true;
    var fLeaf = leafName(fPath);
    if (fLeaf && pathsEqual(s, fLeaf)) return true;
    var fGiven = givenName(fPath);
    if (fGiven && pathsEqual(s, fGiven)) return true;
    var resolved = resolveFatherRow(index, branch, s);
    if (
      resolved &&
      resolved.person_id &&
      fatherRow.person_id &&
      String(resolved.person_id) === String(fatherRow.person_id)
    ) {
      return true;
    }
    return false;
  }

  /** Arabic relation label via UUID: محمد→حمد */
  function relationViaUuidAr(childRow, fatherRow) {
    var childLabel = givenName(childPath(childRow)) || childPath(childRow) || "—";
    var fatherLabel = givenName(childPath(fatherRow)) || childPath(fatherRow) || "—";
    return childLabel + "→" + fatherLabel;
  }

  /**
   * Prefer parent_person_id; else branch + normalized parent path.
   * Empty key → skip spelling-dup grouping (orphan / root without father).
   */
  function fatherGroupKey(row) {
    var ppid = row && row.parent_person_id != null ? String(row.parent_person_id).trim() : "";
    if (ppid) return "pid:" + ppid;
    var branch = norm(row && row.branch_key);
    var parent = storedParent(row);
    if (!parent) {
      parent = extractParentFromName(childPath(row));
    }
    if (!parent) return "";
    return "path:" + branch + "||" + normalizeArabicForCompare(parent);
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

  /** Derive parent path by stripping the last segment of name/child_name. */
  function extractParentFromName(path) {
    var p = norm(path);
    if (!p || p.indexOf("/") < 0) return "";
    var parts = p.split("/").map(norm).filter(Boolean);
    if (parts.length < 2) return "";
    return parts.slice(0, -1).join("/");
  }

  function buildNameIndex(children) {
    var byBranchPath = new Set();
    var byBranchPathNorm = new Map();
    var byBranchLeaf = new Map();
    var byBranchLeafNorm = new Map();
    var personIdMap = new Map();
    (children || []).forEach(function (c) {
      if (!c) return;
      var branch = norm(c.branch_key);
      var path = childPath(c);
      if (branch && path) {
        byBranchPath.add(branch + "||" + path);
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
      if (c.person_id) {
        var pid = String(c.person_id);
        if (!personIdMap.has(pid)) personIdMap.set(pid, []);
        personIdMap.get(pid).push(c);
      }
    });
    return {
      byBranchPath: byBranchPath,
      byBranchPathNorm: byBranchPathNorm,
      byBranchLeaf: byBranchLeaf,
      byBranchLeafNorm: byBranchLeafNorm,
      personIdMap: personIdMap,
    };
  }

  function fatherExists(index, branch, parentPath) {
    var p = norm(parentPath);
    var b = norm(branch);
    if (!p || !b) return false;
    if (isBranchRootParent(p, b)) return true;
    if (index.byBranchPath.has(b + "||" + p)) return true;
    var pathNormHits = index.byBranchPathNorm.get(b + "||" + normalizeArabicForCompare(p)) || [];
    if (pathNormHits.length === 1) return true;
    // Leaf-only parent string: unique leaf hit in branch counts as found
    if (p.indexOf("/") < 0) {
      var hits = index.byBranchLeaf.get(b + "||" + p) || [];
      if (hits.length === 1) return true;
      var leafNormHits =
        index.byBranchLeafNorm.get(b + "||" + normalizeArabicForCompare(p)) || [];
      return leafNormHits.length === 1;
    }
    return false;
  }

  /**
   * Prefer exact path; else unique Arabic-normalized full path; else unique leaf.
   * Returns the living tree_children row — caller must use childPath(row) as canonical parent string.
   * Ambiguous leaf-only matches (e.g. multiple محمد) return null — never guess.
   */
  function resolveFatherRow(index, branch, parentPath) {
    var p = norm(parentPath);
    var b = norm(branch);
    if (!p || !b || !index) return null;
    if (isBranchRootParent(p, b)) return null;
    var exact = [];
    var normHits = index.byBranchPathNorm.get(b + "||" + normalizeArabicForCompare(p)) || [];
    normHits.forEach(function (c) {
      if (childPath(c) === p) exact.push(c);
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

  /**
   * True when parentPath is a leaf-only string with multiple living matches in branch.
   * Used to reject wrong «محمد» candidates for UUID link proposals.
   */
  function isAmbiguousLeafFather(index, branch, parentPath) {
    var p = norm(parentPath);
    var b = norm(branch);
    if (!p || !b || !index || p.indexOf("/") >= 0) return false;
    if (isBranchRootParent(p, b)) return false;
    var leafHits = index.byBranchLeaf.get(b + "||" + p) || [];
    if (leafHits.length > 1) return true;
    var leafNormHits =
      index.byBranchLeafNorm.get(b + "||" + normalizeArabicForCompare(p)) || [];
    return leafNormHits.length > 1;
  }

  /**
   * Resolve the expected living father for TREE-003 UUID linking (all such rows).
   * Preference:
   *  1) valid parent_person_id → living father (already linked)
   *  2) strip last segment of child name/path → full-path / unique match
   *  3) stored parent path (parent_name/parent) → same resolver
   * Never renames. Rejects ambiguous leaf-only matches.
   *
   * @returns {{
   *   status: 'linked'|'found'|'ambiguous'|'missing',
   *   father: object|null,
   *   person_id: string|null,
   *   expected_parent_path: string,
   *   method: string,
   *   ambiguous_candidates?: number
   * }}
   */
  function resolveExpectedFatherForUuidLink(row, childrenOrIndex) {
    var branch = norm(row && row.branch_key);
    var path = childPath(row);
    var stored = storedParent(row);
    var extracted = extractParentFromName(path);
    var index =
      childrenOrIndex && childrenOrIndex.byBranchPath
        ? childrenOrIndex
        : buildNameIndex(childrenOrIndex || []);

    var uuidFather = resolveFatherByPersonId(index, row && row.parent_person_id);
    if (uuidFather && uuidFather.person_id) {
      return {
        status: "linked",
        father: uuidFather,
        person_id: String(uuidFather.person_id),
        expected_parent_path: childPath(uuidFather),
        method: "parent_person_id",
      };
    }

    function tryPath(candidate, method) {
      var c = norm(candidate);
      if (!c || isBranchRootParent(c, branch)) return null;
      if (isAmbiguousLeafFather(index, branch, c)) {
        var ambHits =
          index.byBranchLeafNorm.get(
            branch + "||" + normalizeArabicForCompare(c),
          ) ||
          index.byBranchLeaf.get(branch + "||" + c) ||
          [];
        return {
          status: "ambiguous",
          father: null,
          person_id: null,
          expected_parent_path: c,
          method: method,
          ambiguous_candidates: ambHits.length,
        };
      }
      var father = resolveFatherRow(index, branch, c);
      if (!father) return null;
      var pid = father.person_id ? String(father.person_id) : null;
      if (!pid) {
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
        person_id: pid,
        expected_parent_path: childPath(father),
        method: method,
      };
    }

    // Prefer tree-sequence path (strip last segment) over short stored parent text.
    var fromExtract = extracted ? tryPath(extracted, "name_path_strip") : null;
    if (fromExtract && fromExtract.status === "found") return fromExtract;
    if (fromExtract && fromExtract.status === "ambiguous") return fromExtract;

    var fromStored = stored ? tryPath(stored, "stored_parent") : null;
    if (fromStored && fromStored.status === "found") return fromStored;
    if (fromStored && fromStored.status === "ambiguous") return fromStored;

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

  /** True when stored parent aligns with name-extracted path (normalize or same canonical father). */
  function parentAlignedWithExtract(index, branch, stored, extracted) {
    var s = norm(stored);
    var e = norm(extracted);
    if (!e) return !s;
    if (s && pathsEqual(s, e)) return true;
    if (!s) return false;
    var fatherE = resolveFatherRow(index, branch, e);
    if (!fatherE) return false;
    var canonical = childPath(fatherE);
    if (s === canonical || pathsEqual(s, canonical)) return true;
    var fatherS = resolveFatherRow(index, branch, s);
    return !!(fatherS && childPath(fatherS) === canonical);
  }

  function impactFor(category) {
    return (CAT_IMPACT[category] || []).slice();
  }

  function impactLabel(category) {
    return impactFor(category).join(" · ");
  }

  function priorityFor(category) {
    return CAT_PRIORITY[category] || PRIORITY.MEDIUM;
  }

  function priorityLabel(category) {
    return PRIORITY_AR[priorityFor(category)] || PRIORITY_AR.medium;
  }

  function rootCauseFor(category) {
    return CAT_ROOT_CAUSE[category] || "سبب غير مصنّف — راجع الصف يدويًا.";
  }

  function writePathFor(category) {
    return CAT_WRITE_PATH[category] || "مسار كتابة غير موثّق.";
  }

  function issueRow(row, category, extra) {
    var path = childPath(row);
    var extracted = extractParentFromName(path);
    var pri = priorityFor(category);
    return Object.assign(
      {
        id: row.id,
        branch_key: norm(row.branch_key),
        child_path: path,
        parent: parentColumn(row) || null,
        parent_name: parentNameColumn(row) || null,
        stored_parent: storedParent(row) || null,
        extracted_parent: extracted || null,
        person_id: row.person_id || null,
        parent_person_id: row.parent_person_id || null,
        created_at: row.created_at || null,
        updated_at: row.updated_at || null,
        category: category,
        category_ar: CAT_AR[category] || category,
        group: GROUP_DATA_INTEGRITY,
        group_ar: "سلامة البيانات",
        severity: "error",
        priority: pri,
        priority_ar: PRIORITY_AR[pri] || pri,
        impact: impactFor(category),
        impact_ar: impactLabel(category),
        root_cause_ar: rootCauseFor(category),
        write_path_ar: writePathFor(category),
        code: "TREE-STRUCT",
      },
      extra || {},
    );
  }

  function groupSiblingsByFather(children) {
    var groups = new Map();
    (Array.isArray(children) ? children : []).forEach(function (c) {
      if (!c) return;
      var key = fatherGroupKey(c);
      if (!key) return;
      if (!leafName(childPath(c))) return;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    });
    return groups;
  }

  function editDistanceOneMax(a, b) {
    a = String(a || "");
    b = String(b || "");
    if (a === b) return 0;
    var m = a.length;
    var n = b.length;
    if (Math.abs(m - n) > 1) return 2;
    if (!m) return n;
    if (!n) return m;
    var prev = [];
    var i;
    var j;
    for (j = 0; j <= n; j += 1) prev[j] = j;
    for (i = 1; i <= m; i += 1) {
      var cur = [i];
      var ca = a.charAt(i - 1);
      for (j = 1; j <= n; j += 1) {
        var cost = ca === b.charAt(j - 1) ? 0 : 1;
        var del = prev[j] + 1;
        var ins = cur[j - 1] + 1;
        var sub = prev[j - 1] + cost;
        cur[j] = del < ins ? (del < sub ? del : sub) : ins < sub ? ins : sub;
        if (cur[j] > 1 && j === n && i < m) {
          /* keep computing; names are short */
        }
      }
      prev = cur;
    }
    return prev[n];
  }

  function pairSortKey(x, y) {
    var fa = normalizeArabicForCompare(x.father_label || "");
    var fb = normalizeArabicForCompare(y.father_label || "");
    if (fa < fb) return -1;
    if (fa > fb) return 1;
    return String(x.id).localeCompare(String(y.id));
  }

  /**
   * Sibling pairs under same father whose leaf names match after Arabic normalize.
   * Read-only · no auto-merge (Truth Before Speed).
   */
  function findPossibleSpellingDuplicates(children) {
    var groups = groupSiblingsByFather(children);

    var pairs = [];
    var seenPair = new Set();

    groups.forEach(function (siblings) {
      if (!siblings || siblings.length < 2) return;
      var i;
      var j;
      for (i = 0; i < siblings.length; i += 1) {
        for (j = i + 1; j < siblings.length; j += 1) {
          var a = siblings[i];
          var b = siblings[j];
          if (a.id != null && b.id != null && Number(a.id) === Number(b.id)) continue;
          var leafA = leafName(childPath(a));
          var leafB = leafName(childPath(b));
          if (!leafA || !leafB) continue;
          var normA = normalizeArabicForCompare(leafA);
          var normB = normalizeArabicForCompare(leafB);
          if (!normA || !normB || normA !== normB) continue;
          var idA = a.id != null ? Number(a.id) : 0;
          var idB = b.id != null ? Number(b.id) : 0;
          var lo = idA && idB ? Math.min(idA, idB) : idA || idB;
          var hi = idA && idB ? Math.max(idA, idB) : idA || idB;
          var pairKey = "dup:" + lo + ":" + hi;
          if (seenPair.has(pairKey)) continue;
          seenPair.add(pairKey);

          var first = idA && idB && idA > idB ? b : a;
          var second = first === a ? b : a;
          var name1 = leafName(childPath(first));
          var name2 = leafName(childPath(second));
          var path1 = childPath(first);
          var path2 = childPath(second);
          var fatherLabel = fatherDisplay(first) || fatherDisplay(second);
          var sameRaw = name1 === name2;
          var diffReason = sameRaw
            ? "نفس الكتابة تحت الأب"
            : explainArabicSpellingDiff(name1, name2);
          pairs.push({
            id: pairKey,
            id_a: first.id,
            id_b: second.id,
            branch_key: norm(first.branch_key) || norm(second.branch_key),
            child_path: path1 + " ↔ " + path2,
            child_path_a: path1,
            child_path_b: path2,
            parent: storedParent(first) || storedParent(second) || null,
            parent_name: parentNameColumn(first) || parentNameColumn(second) || null,
            stored_parent: storedParent(first) || storedParent(second) || null,
            extracted_parent: null,
            person_id: first.person_id || null,
            person_id_a: first.person_id || null,
            person_id_b: second.person_id || null,
            parent_person_id: first.parent_person_id || second.parent_person_id || null,
            father_label: fatherLabel,
            name_a: name1,
            name_b: name2,
            normalized_name: normA,
            similarity_pct: 100,
            similarity_ar: "100%",
            diff_reason_ar: diffReason,
            status_ar: "يحتاج مراجعة",
            created_at: first.created_at || null,
            updated_at: first.updated_at || null,
            created_by: first.created_by || null,
            updated_by: first.updated_by || first.modified_by || null,
            category: CAT.POSSIBLE_SPELLING_DUPLICATES,
            category_ar: CAT_AR.possible_spelling_duplicates,
            group: GROUP_DATA_INTEGRITY,
            group_ar: "سلامة البيانات",
            severity: "warning",
            priority: PRIORITY.HIGH,
            priority_ar: PRIORITY_AR.high,
            impact: impactFor(CAT.POSSIBLE_SPELLING_DUPLICATES),
            impact_ar: impactLabel(CAT.POSSIBLE_SPELLING_DUPLICATES),
            root_cause_ar: rootCauseFor(CAT.POSSIBLE_SPELLING_DUPLICATES),
            write_path_ar: writePathFor(CAT.POSSIBLE_SPELLING_DUPLICATES),
            code: "TREE-SPELL-DUP",
            repair_forbidden: true,
            never_auto_merge: true,
            reason_ar: sameRaw
              ? "سجلان بنفس الاسم تحت الأب «" +
                fatherLabel +
                "»: «" +
                name1 +
                "» — يحتاج قرار المشرف (لا دمج تلقائي)."
              : "تطابق بعد توحيد العربية تحت الأب «" +
                fatherLabel +
                "»: «" +
                name1 +
                "» ↔ «" +
                name2 +
                "» (" +
                diffReason +
                ") — يحتاج قرار المشرف (لا دمج تلقائي).",
          });
        }
      }
    });

    pairs.sort(pairSortKey);
    return pairs;
  }

  /**
   * Given names that often appear as distinct brothers. Same-father pairs
   * among these are not «wrong similarity» (سعد/سعيد, عمر/عمرو).
   */
  var COMMON_DISTINCT_GIVEN = (function () {
    var raw = [
      "محمد",
      "احمد",
      "عبدالله",
      "عبدالرحمن",
      "عبدالعزيز",
      "عبدالاله",
      "عبدالوهاب",
      "فهد",
      "فهاد",
      "خالد",
      "سلطان",
      "نايف",
      "سعد",
      "سعيد",
      "سعود",
      "عمر",
      "عمرو",
      "علي",
      "علوي",
      "حسن",
      "حسين",
      "يوسف",
      "ابراهيم",
      "فارس",
      "ياسر",
      "منيف",
      "ماجد",
      "مشعل",
      "تركي",
      "بدر",
      "نواف",
      "راكان",
      "فيصل",
      "طلال",
      "مشاري",
      "مقرن",
      "بندر",
      "حمد",
      "حمود",
      "صالح",
      "سليمان",
      "ناصر",
      "نصر",
      "مطلق",
      "منصور",
      "زيد",
      "زيدان",
      "مزيد",
      "زايد",
      "ملحم",
      "لاحم",
    ];
    var set = new Set();
    raw.forEach(function (n) {
      var k = normalizeArabicForCompare(n);
      if (k) set.add(k);
    });
    return set;
  })();

  function bothCommonDistinctGivens(normA, normB) {
    return COMMON_DISTINCT_GIVEN.has(normA) && COMMON_DISTINCT_GIVEN.has(normB);
  }

  /**
   * Siblings under the same father whose normalized leaves differ by one character.
   * Not the public «popular names» list (محمد across the family).
   */
  function findWrongNameSimilarity(children) {
    var groups = groupSiblingsByFather(children);
    var pairs = [];
    var seenPair = new Set();

    groups.forEach(function (siblings) {
      if (!siblings || siblings.length < 2) return;
      var i;
      var j;
      for (i = 0; i < siblings.length; i += 1) {
        for (j = i + 1; j < siblings.length; j += 1) {
          var a = siblings[i];
          var b = siblings[j];
          if (a.id != null && b.id != null && Number(a.id) === Number(b.id)) continue;
          var leafA = leafName(childPath(a));
          var leafB = leafName(childPath(b));
          if (!leafA || !leafB) continue;
          var normA = normalizeArabicForCompare(leafA);
          var normB = normalizeArabicForCompare(leafB);
          if (!normA || !normB || normA === normB) continue;
          if (normA.length < 3 || normB.length < 3) continue;
          if (Math.abs(normA.length - normB.length) !== 1) continue;
          if (editDistanceOneMax(normA, normB) !== 1) continue;
          if (bothCommonDistinctGivens(normA, normB)) continue;
          var idA = a.id != null ? Number(a.id) : 0;
          var idB = b.id != null ? Number(b.id) : 0;
          var lo = idA && idB ? Math.min(idA, idB) : idA || idB;
          var hi = idA && idB ? Math.max(idA, idB) : idA || idB;
          var pairKey = "near:" + lo + ":" + hi;
          if (seenPair.has(pairKey)) continue;
          seenPair.add(pairKey);

          var first = idA && idB && idA > idB ? b : a;
          var second = first === a ? b : a;
          var name1 = leafName(childPath(first));
          var name2 = leafName(childPath(second));
          var path1 = childPath(first);
          var path2 = childPath(second);
          var fatherLabel = fatherDisplay(first) || fatherDisplay(second);
          var longer = Math.max(normA.length, normB.length) || 1;
          var pct = Math.round((1 - 1 / longer) * 100);
          pairs.push({
            id: pairKey,
            id_a: first.id,
            id_b: second.id,
            branch_key: norm(first.branch_key) || norm(second.branch_key),
            child_path: path1 + " ↔ " + path2,
            child_path_a: path1,
            child_path_b: path2,
            parent: storedParent(first) || storedParent(second) || null,
            parent_name: parentNameColumn(first) || parentNameColumn(second) || null,
            stored_parent: storedParent(first) || storedParent(second) || null,
            extracted_parent: null,
            person_id: first.person_id || null,
            person_id_a: first.person_id || null,
            person_id_b: second.person_id || null,
            parent_person_id: first.parent_person_id || second.parent_person_id || null,
            father_label: fatherLabel,
            name_a: name1,
            name_b: name2,
            normalized_name: "",
            similarity_pct: pct,
            similarity_ar: pct + "%",
            diff_reason_ar: "حرف زائد أو ناقص بعد التوحيد",
            status_ar: "يحتاج مراجعة",
            created_at: first.created_at || null,
            updated_at: first.updated_at || null,
            created_by: first.created_by || null,
            updated_by: first.updated_by || first.modified_by || null,
            category: CAT.WRONG_NAME_SIMILARITY,
            category_ar: CAT_AR.wrong_name_similarity,
            group: GROUP_DATA_INTEGRITY,
            group_ar: "سلامة البيانات",
            severity: "warning",
            priority: PRIORITY.HIGH,
            priority_ar: PRIORITY_AR.high,
            impact: impactFor(CAT.WRONG_NAME_SIMILARITY),
            impact_ar: impactLabel(CAT.WRONG_NAME_SIMILARITY),
            root_cause_ar: rootCauseFor(CAT.WRONG_NAME_SIMILARITY),
            write_path_ar: writePathFor(CAT.WRONG_NAME_SIMILARITY),
            code: "TREE-NAME-NEAR",
            repair_forbidden: true,
            never_auto_merge: true,
            reason_ar:
              "تشابه خاطئ تحت الأب «" +
              fatherLabel +
              "»: «" +
              name1 +
              "» ↔ «" +
              name2 +
              "» — حرف زائد أو ناقص. ليست الأسماء الشائعة في الرئيسية. لا دمج تلقائي.",
          });
        }
      }
    });

    pairs.sort(pairSortKey);
    return pairs;
  }

  var SUSPICIOUS_NAME_RULES = [
    { pattern: /(^|\/|\s)محد($|\/|\s)/, label: "محد بدل محمد غالبًا" },
    { pattern: /(^|\/|\s)ممد($|\/|\s)/, label: "ممد بدل محمد غالبًا" },
    { pattern: /(^|\/|\s)مليف($|\/|\s)/, label: "مليف بدل منيف غالبًا" },
    { pattern: /(^|\/|\s)لا في($|\/|\s)/, label: "لا في بدل محمد غالبًا" },
    { pattern: /(^|\/|\s)قارس($|\/|\s)/, label: "قارس بدل فارس غالبًا" },
    { pattern: /(^|\/|\s)باسر($|\/|\s)/, label: "باسر بدل ياسر غالبًا" },
    { pattern: /(^|\/|\s)شحاذالاسم($|\/|\s)/, label: "التصق فيها عنوان الاسم" },
    { pattern: /(^|\/|\s)الاسم($|\/|\s)/, label: "كلمة الاسم دخلت داخل السجل" },
    { pattern: /[0-9٠-٩]/, label: "يوجد رقم داخل الاسم" },
    { pattern: /[\[\]،.]{2,}|[\[\]]/, label: "رمز من المسح داخل الاسم" },
  ];

  function findSuspiciousNameTypos(children) {
    var out = [];
    (Array.isArray(children) ? children : []).forEach(function (c) {
      if (!c) return;
      var path = childPath(c);
      var leaf = leafName(path);
      var hay = (leaf || "") + "/" + (path || "");
      var hits = [];
      var r;
      for (r = 0; r < SUSPICIOUS_NAME_RULES.length; r += 1) {
        if (SUSPICIOUS_NAME_RULES[r].pattern.test(hay)) {
          hits.push(SUSPICIOUS_NAME_RULES[r].label);
        }
      }
      if (!hits.length) return;
      out.push(
        issueRow(c, CAT.SUSPICIOUS_NAME_TYPO, {
          reason_ar: hits.join(" · "),
          father_label: fatherDisplay(c),
          name_a: leaf,
        }),
      );
    });
    return out;
  }

  /**
   * @param {object[]} children tree_children rows
   * @param {object[]} [spouses] tree_spouses rows
   * @returns {object} audit report (read-only)
   */
  function auditTreeStructure(children, spouses) {
    var rows = Array.isArray(children) ? children : [];
    var index = buildNameIndex(rows);
    var parentNull = [];
    var parentEmpty = [];
    var missingFather = [];
    var pathMismatch = [];
    var brokenRelation = [];
    var healthy = 0;
    var seenBroken = new Set();

    function markBroken(issue) {
      var key = String(issue.id) + "|" + issue.category;
      if (seenBroken.has(key)) return;
      seenBroken.add(key);
      brokenRelation.push(issue);
    }

    rows.forEach(function (c) {
      if (!c) return;
      var branch = norm(c.branch_key);
      var path = childPath(c);
      var pCol = parentColumn(c);
      var pName = parentNameColumn(c);
      var stored = storedParent(c);
      var extracted = extractParentFromName(path);
      var isRoot = isBranchRootParent(stored, branch) || isBranchRootParent(extracted, branch);

      var colNull = !pCol;
      var bothEmpty = !pCol && !pName;

      if (colNull && !isRoot) {
        parentNull.push(
          issueRow(c, CAT.PARENT_NULL, {
            reason_ar: "حقل الأب فارغ بينما الاسم/المسار موجود",
          }),
        );
      }
      if (bothEmpty && path && !isRoot) {
        parentEmpty.push(
          issueRow(c, CAT.PARENT_EMPTY, {
            reason_ar: "parent و parent_name فارغان",
          }),
        );
      }

      // Path vs stored: Arabic-normalize + same canonical father → leave path_mismatch.
      // Dual-column parent=NULL alone stays in parent_null (not path_mismatch).
      // Valid parent_person_id is primary for missing_father only — never red «أب غير موجود»
      // when UUID resolves; text≠UUID becomes orange path_mismatch review instead.
      var uuidFather = resolveFatherByPersonId(index, c.parent_person_id);
      var textFatherOk =
        !!stored && !isRoot && fatherExists(index, branch, stored);
      var uuidFatherOk = !!uuidFather;
      var livingFatherOk = isRoot || uuidFatherOk || textFatherOk;
      var uuidTextConflict =
        uuidFatherOk &&
        !!stored &&
        !isRoot &&
        !textAgreesWithUuidFather(index, branch, stored, uuidFather);

      if (extracted && !isRoot) {
        var aligned = parentAlignedWithExtract(index, branch, stored, extracted);
        var colAligned =
          !!pCol &&
          (pathsEqual(pCol, extracted) ||
            parentAlignedWithExtract(index, branch, pCol, extracted));
        if (stored && !aligned) {
          var fatherForExtract = resolveFatherRow(index, branch, extracted);
          pathMismatch.push(
            issueRow(c, CAT.PATH_MISMATCH, {
              reason_ar:
                "الأب من المسار: «" +
                extracted +
                "» ≠ حقل الأب: «" +
                (pCol || "فارغ") +
                "» / اسم الأب: «" +
                (pName || "فارغ") +
                "»",
              canonical_father_path: fatherForExtract
                ? childPath(fatherForExtract)
                : null,
            }),
          );
        } else if (
          stored &&
          aligned &&
          pCol &&
          !colAligned &&
          !pathsEqual(pCol, stored)
        ) {
          pathMismatch.push(
            issueRow(c, CAT.PATH_MISMATCH, {
              reason_ar:
                "حقل الأب «" +
                pCol +
                "» لا يطابق اسم الأب / الأب من المسار بعد التوحيد",
            }),
          );
        }
      }

      // Text parent conflicts with valid UUID father → orange review, NOT missing_father
      if (uuidTextConflict) {
        var rel = relationViaUuidAr(c, uuidFather);
        pathMismatch.push(
          issueRow(c, CAT.PATH_MISMATCH, {
            reason_ar:
              "عدم تطابق/مراجعة: نص الأب «" +
              stored +
              "» لا يطابق الأب عبر UUID — العلاقة الفعلية: " +
              rel +
              " («" +
              childPath(uuidFather) +
              "»)",
            relation_via_uuid_ar: rel,
            uuid_father_path: childPath(uuidFather),
            uuid_father_person_id: uuidFather.person_id || null,
            review_kind: "parent_text_uuid_mismatch",
          }),
        );
      }

      // Missing father: only when UUID is absent/broken AND text parent has no living row
      if (stored && !isRoot && !livingFatherOk) {
        missingFather.push(
          issueRow(c, CAT.MISSING_FATHER, {
            reason_ar:
              "الأب «" +
              stored +
              "» غير موجود في tree_children.name لنفس الفرع" +
              (c.parent_person_id
                ? " وparent_person_id لا يشير لصف أب صالح"
                : " (بلا parent_person_id صالح)"),
          }),
        );
      }

      var structurallyOk =
        !bothEmpty &&
        (isRoot ||
          (livingFatherOk &&
            (!extracted ||
              parentAlignedWithExtract(index, branch, stored, extracted))));
      // Dual-column: parent col should match when path has parent
      if (extracted && colNull && !uuidFatherOk) structurallyOk = false;
      if (stored && !isRoot && !livingFatherOk) {
        structurallyOk = false;
      }
      // UUID-valid but text conflicts → still needs orange review (not healthy)
      if (uuidTextConflict) {
        structurallyOk = false;
      }

      if (structurallyOk) {
        healthy += 1;
      } else if (!isRoot || colNull || bothEmpty) {
        var primary =
          bothEmpty
            ? CAT.PARENT_EMPTY
            : !livingFatherOk
              ? CAT.MISSING_FATHER
              : colNull && !uuidFatherOk
                ? CAT.PARENT_NULL
                : CAT.PATH_MISMATCH;
        var brokenExtra = {
          reason_ar: CAT_AR[primary] || primary,
        };
        if (uuidFatherOk) {
          brokenExtra.relation_via_uuid_ar = relationViaUuidAr(c, uuidFather);
          brokenExtra.uuid_father_path = childPath(uuidFather);
        }
        markBroken(issueRow(c, primary, brokenExtra));
      }
    });

    var duplicatePersonId = [];
    index.personIdMap.forEach(function (list, pid) {
      if (list.length < 2) return;
      list.forEach(function (c) {
        duplicatePersonId.push(
          issueRow(c, CAT.DUPLICATE_PERSON_ID, {
            reason_ar: "person_id مكرر (" + list.length + " صفوف): " + pid,
            duplicate_count: list.length,
          }),
        );
      });
    });

    var spellingDupes = findPossibleSpellingDuplicates(rows);
    var wrongSimilarity = findWrongNameSimilarity(rows);
    var nameTypos = findSuspiciousNameTypos(rows);

    var spousesBad = [];
    var byId = new Map();
    rows.forEach(function (c) {
      if (c && c.id != null) byId.set(Number(c.id), c);
    });
    var personIds = index.personIdMap;
    (spouses || []).forEach(function (s) {
      if (!s) return;
      var hid = s.husband_id != null ? Number(s.husband_id) : 0;
      var hpid = s.husband_person_id ? String(s.husband_person_id) : "";
      var ok =
        (hid && byId.has(hid)) || (hpid && personIds.has(hpid));
      if (!ok) {
        spousesBad.push({
          id: s.id,
          branch_key: norm(s.branch_key),
          child_path: "",
          parent: null,
          parent_name: null,
          stored_parent: null,
          extracted_parent: null,
          person_id: hpid || null,
          wife_name: s.wife_name || "",
          husband_id: hid || null,
          category: CAT.SPOUSES_WITHOUT_HUSBAND,
          category_ar: CAT_AR.spouses_without_husband,
          group: GROUP_UUID_LINK,
          group_ar: "الربط الداخلي",
          severity: "warning",
          priority: PRIORITY.MEDIUM,
          priority_ar: PRIORITY_AR.medium,
          impact: impactFor(CAT.SPOUSES_WITHOUT_HUSBAND),
          impact_ar: impactLabel(CAT.SPOUSES_WITHOUT_HUSBAND),
          root_cause_ar: rootCauseFor(CAT.SPOUSES_WITHOUT_HUSBAND),
          write_path_ar: writePathFor(CAT.SPOUSES_WITHOUT_HUSBAND),
          code: "TREE-STRUCT",
          reason_ar: "زوجة بلا زوج صالح في الشجرة: " + norm(s.wife_name),
        });
      }
    });

    var lists = {};
    lists[CAT.PARENT_NULL] = parentNull;
    lists[CAT.PARENT_EMPTY] = parentEmpty;
    lists[CAT.MISSING_FATHER] = missingFather;
    lists[CAT.PATH_MISMATCH] = pathMismatch;
    lists[CAT.POSSIBLE_SPELLING_DUPLICATES] = spellingDupes;
    lists[CAT.WRONG_NAME_SIMILARITY] = wrongSimilarity;
    lists[CAT.SUSPICIOUS_NAME_TYPO] = nameTypos;
    lists[CAT.DUPLICATE_PERSON_ID] = duplicatePersonId;
    lists[CAT.SPOUSES_WITHOUT_HUSBAND] = spousesBad;
    lists[CAT.BROKEN_RELATION] = brokenRelation;

    var criticalCount =
      parentNull.length + parentEmpty.length + missingFather.length;
    var highCount = pathMismatch.length + spellingDupes.length + wrongSimilarity.length;
    // broken_relation overlaps — counted in high "needs review" separately via path
    var needsReview = highCount + brokenRelation.length;

    return {
      mode: "read_only",
      schema: "tree_structure_audit_v3",
      totals: {
        tree_children: rows.length,
        healthy_relations: healthy,
        parent_null: parentNull.length,
        parent_empty: parentEmpty.length,
        missing_father: missingFather.length,
        path_mismatch: pathMismatch.length,
        possible_spelling_duplicates: spellingDupes.length,
        wrong_name_similarity: wrongSimilarity.length,
        suspicious_name_typo: nameTypos.length,
        duplicate_person_id: duplicatePersonId.length,
        spouses_without_husband: spousesBad.length,
        broken_relation: brokenRelation.length,
        priority_critical: criticalCount,
        priority_high: needsReview,
        priority_medium: duplicatePersonId.length + spousesBad.length + nameTypos.length,
      },
      summary_card: {
        critical: criticalCount,
        needs_review: needsReview,
        uuid_link_needed: duplicatePersonId.length + spousesBad.length,
        healthy: healthy,
        possible_spelling_duplicates: spellingDupes.length,
        wrong_name_similarity: wrongSimilarity.length,
        suspicious_name_typo: nameTypos.length,
        labels: {
          critical: "🔴 حرج (أب فارغ · أب غير موجود في الشجرة)",
          needs_review: "🟠 يحتاج مراجعة (مسار/علاقة/أخطاء أسماء)",
          uuid_link_needed: "🟡 يحتاج ربط المعرف الداخلي",
          healthy: "🟢 علاقات سليمة",
        },
        note_ar:
          "أولوية الإصلاح: حرج → مراجعة → ربط المعرف. أخطاء الأسماء (تكرار/تشابه خاطئ) للمراجعة فقط — بلا دمج تلقائي. الأسماء الشائعة في الرئيسية ليست أخطاء.",
      },
      groups: {
        data_integrity: {
          id: GROUP_DATA_INTEGRITY,
          label: "🔴 سلامة البيانات",
          label_short: "سلامة البيانات",
          severity: "error",
          categories: [
            CAT.PARENT_NULL,
            CAT.MISSING_FATHER,
            CAT.PATH_MISMATCH,
            CAT.POSSIBLE_SPELLING_DUPLICATES,
            CAT.WRONG_NAME_SIMILARITY,
            CAT.SUSPICIOUS_NAME_TYPO,
            CAT.PARENT_EMPTY,
            CAT.BROKEN_RELATION,
          ],
        },
        uuid_link: {
          id: GROUP_UUID_LINK,
          label: "🟡 الربط الداخلي",
          label_short: "الربط الداخلي",
          severity: "warning",
          note_ar:
            "يحتاج ربط المعرف الداخلي — مهم للاعتماد الآمن ومسار الطلبات.",
        },
      },
      categories: [
        {
          id: "total",
          label: "إجمالي الأشخاص",
          count: rows.length,
          ok: true,
          group: "summary",
        },
        {
          id: "healthy_relations",
          label: "🟢 علاقات صحيحة",
          count: healthy,
          ok: true,
          group: "summary",
          priority: PRIORITY.HEALTHY,
        },
        {
          id: CAT.PARENT_NULL,
          label: "🔴 " + CAT_AR.parent_null,
          count: parentNull.length,
          ok: parentNull.length === 0,
          group: GROUP_DATA_INTEGRITY,
          group_ar: "سلامة البيانات",
          priority: CAT_PRIORITY.parent_null,
          priority_ar: PRIORITY_AR.critical,
          impact_ar: impactLabel(CAT.PARENT_NULL),
          root_cause_ar: rootCauseFor(CAT.PARENT_NULL),
        },
        {
          id: CAT.MISSING_FATHER,
          label: "🔴 " + CAT_AR.missing_father,
          count: missingFather.length,
          ok: missingFather.length === 0,
          group: GROUP_DATA_INTEGRITY,
          group_ar: "سلامة البيانات",
          priority: CAT_PRIORITY.missing_father,
          priority_ar: PRIORITY_AR.critical,
          impact_ar: impactLabel(CAT.MISSING_FATHER),
          root_cause_ar: rootCauseFor(CAT.MISSING_FATHER),
        },
        {
          id: CAT.PATH_MISMATCH,
          label: "🟠 " + CAT_AR.path_mismatch,
          count: pathMismatch.length,
          ok: pathMismatch.length === 0,
          group: GROUP_DATA_INTEGRITY,
          group_ar: "سلامة البيانات",
          priority: CAT_PRIORITY.path_mismatch,
          priority_ar: PRIORITY_AR.high,
          impact_ar: impactLabel(CAT.PATH_MISMATCH),
          root_cause_ar: rootCauseFor(CAT.PATH_MISMATCH),
        },
        {
          id: CAT.POSSIBLE_SPELLING_DUPLICATES,
          label: "🟠 " + CAT_AR.possible_spelling_duplicates,
          count: spellingDupes.length,
          ok: spellingDupes.length === 0,
          group: GROUP_DATA_INTEGRITY,
          group_ar: "سلامة البيانات",
          priority: CAT_PRIORITY.possible_spelling_duplicates,
          priority_ar: PRIORITY_AR.high,
          impact_ar: impactLabel(CAT.POSSIBLE_SPELLING_DUPLICATES),
          root_cause_ar: rootCauseFor(CAT.POSSIBLE_SPELLING_DUPLICATES),
          note_ar: "مراجعة فقط — لا دمج تلقائي.",
        },
        {
          id: CAT.WRONG_NAME_SIMILARITY,
          label: "🟠 " + CAT_AR.wrong_name_similarity,
          count: wrongSimilarity.length,
          ok: wrongSimilarity.length === 0,
          group: GROUP_DATA_INTEGRITY,
          group_ar: "سلامة البيانات",
          priority: CAT_PRIORITY.wrong_name_similarity,
          priority_ar: PRIORITY_AR.high,
          impact_ar: impactLabel(CAT.WRONG_NAME_SIMILARITY),
          root_cause_ar: rootCauseFor(CAT.WRONG_NAME_SIMILARITY),
          note_ar: "تحت الأب نفسه فقط — ليست الأسماء الشائعة.",
        },
        {
          id: CAT.SUSPICIOUS_NAME_TYPO,
          label: "🟡 " + CAT_AR.suspicious_name_typo,
          count: nameTypos.length,
          ok: nameTypos.length === 0,
          group: GROUP_DATA_INTEGRITY,
          group_ar: "سلامة البيانات",
          priority: CAT_PRIORITY.suspicious_name_typo,
          priority_ar: PRIORITY_AR.medium,
          impact_ar: impactLabel(CAT.SUSPICIOUS_NAME_TYPO),
          root_cause_ar: rootCauseFor(CAT.SUSPICIOUS_NAME_TYPO),
        },
        {
          id: CAT.PARENT_EMPTY,
          label: "🔴 " + CAT_AR.parent_empty,
          count: parentEmpty.length,
          ok: parentEmpty.length === 0,
          group: GROUP_DATA_INTEGRITY,
          group_ar: "سلامة البيانات",
          priority: CAT_PRIORITY.parent_empty,
          priority_ar: PRIORITY_AR.critical,
          impact_ar: impactLabel(CAT.PARENT_EMPTY),
          root_cause_ar: rootCauseFor(CAT.PARENT_EMPTY),
        },
        {
          id: CAT.DUPLICATE_PERSON_ID,
          label: "🟡 " + CAT_AR.duplicate_person_id,
          count: duplicatePersonId.length,
          ok: duplicatePersonId.length === 0,
          group: GROUP_UUID_LINK,
          group_ar: "الربط الداخلي",
          priority: CAT_PRIORITY.duplicate_person_id,
          priority_ar: PRIORITY_AR.medium,
          impact_ar: impactLabel(CAT.DUPLICATE_PERSON_ID),
          root_cause_ar: rootCauseFor(CAT.DUPLICATE_PERSON_ID),
        },
        {
          id: CAT.BROKEN_RELATION,
          label: "🟠 " + CAT_AR.broken_relation,
          count: brokenRelation.length,
          ok: brokenRelation.length === 0,
          group: GROUP_DATA_INTEGRITY,
          group_ar: "سلامة البيانات",
          priority: CAT_PRIORITY.broken_relation,
          priority_ar: PRIORITY_AR.high,
          impact_ar: impactLabel(CAT.BROKEN_RELATION),
          root_cause_ar: rootCauseFor(CAT.BROKEN_RELATION),
        },
        {
          id: CAT.SPOUSES_WITHOUT_HUSBAND,
          label: "🟡 " + CAT_AR.spouses_without_husband,
          count: spousesBad.length,
          ok: spousesBad.length === 0,
          group: GROUP_UUID_LINK,
          group_ar: "الربط الداخلي",
          priority: CAT_PRIORITY.spouses_without_husband,
          priority_ar: PRIORITY_AR.medium,
          impact_ar: impactLabel(CAT.SPOUSES_WITHOUT_HUSBAND),
          root_cause_ar: rootCauseFor(CAT.SPOUSES_WITHOUT_HUSBAND),
        },
      ],
      lists: lists,
    };
  }

  var api = {
    CAT: CAT,
    CAT_AR: CAT_AR,
    CAT_IMPACT: CAT_IMPACT,
    PRIORITY: PRIORITY,
    PRIORITY_AR: PRIORITY_AR,
    CAT_PRIORITY: CAT_PRIORITY,
    CAT_ROOT_CAUSE: CAT_ROOT_CAUSE,
    CAT_WRITE_PATH: CAT_WRITE_PATH,
    GROUP_DATA_INTEGRITY: GROUP_DATA_INTEGRITY,
    GROUP_UUID_LINK: GROUP_UUID_LINK,
    normalizeArabicForCompare: normalizeArabicForCompare,
    explainArabicSpellingDiff: explainArabicSpellingDiff,
    pathsEqual: pathsEqual,
    extractParentFromName: extractParentFromName,
    storedParent: storedParent,
    fatherGroupKey: fatherGroupKey,
    fatherExists: fatherExists,
    resolveFatherRow: resolveFatherRow,
    resolveFatherByPersonId: resolveFatherByPersonId,
    isAmbiguousLeafFather: isAmbiguousLeafFather,
    resolveExpectedFatherForUuidLink: resolveExpectedFatherForUuidLink,
    textAgreesWithUuidFather: textAgreesWithUuidFather,
    relationViaUuidAr: relationViaUuidAr,
    givenName: givenName,
    parentAlignedWithExtract: parentAlignedWithExtract,
    childPath: childPath,
    buildNameIndex: buildNameIndex,
    findPossibleSpellingDuplicates: findPossibleSpellingDuplicates,
    findWrongNameSimilarity: findWrongNameSimilarity,
    bothCommonDistinctGivens: bothCommonDistinctGivens,
    findSuspiciousNameTypos: findSuspiciousNameTypos,
    impactFor: impactFor,
    impactLabel: impactLabel,
    priorityFor: priorityFor,
    rootCauseFor: rootCauseFor,
    writePathFor: writePathFor,
    auditTreeStructure: auditTreeStructure,
  };

  global.AlzidanIntegrityTreeStructure = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
