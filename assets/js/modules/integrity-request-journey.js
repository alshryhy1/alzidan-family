/**
 * Request Integrity — Health Center card (read-only).
 * Automated data-level proxies for the Request Experience journey.
 * Not a full E2E UI test; each check declares auto vs manual_smoke.
 *
 * Global: window.AlzidanIntegrityRequestJourney
 */
(function (global) {
  "use strict";

  function norm(v) {
    return String(v == null ? "" : v)
      .replace(/\s+/g, " ")
      .trim();
  }

  function childPath(row) {
    return norm((row && (row.child_name || row.name)) || "");
  }

  function parentCol(row) {
    return norm((row && row.parent) || "");
  }

  function parentName(row) {
    return norm((row && row.parent_name) || "");
  }

  function storedParent(row) {
    return parentName(row) || parentCol(row);
  }

  function leafOf(path) {
    var p = norm(path);
    if (!p) return "";
    return p.indexOf("/") >= 0 ? p.slice(p.lastIndexOf("/") + 1) : p;
  }

  /**
   * @param {object[]} children tree_children rows
   * @param {object[]} [pendingRequests] optional approval_requests sample
   */
  function auditRequestJourney(children, pendingRequests) {
    var rows = Array.isArray(children) ? children : [];
    var pending = Array.isArray(pendingRequests) ? pendingRequests : [];

    // Index by parent_person_id and by parent path column
    var byParentPid = new Map();
    var byParentPath = new Map();
    var withPid = 0;
    var withoutPid = 0;
    var parentNull = 0;
    var fathersWithPidChildren = new Set();

    rows.forEach(function (c) {
      if (!c) return;
      if (c.person_id) withPid += 1;
      else withoutPid += 1;
      if (!parentCol(c) && !isLikelyRoot(c)) parentNull += 1;

      var ppid = c.parent_person_id ? String(c.parent_person_id) : "";
      if (ppid) {
        fathersWithPidChildren.add(ppid);
        if (!byParentPid.has(ppid)) byParentPid.set(ppid, []);
        byParentPid.get(ppid).push(c);
      }
      var sp = storedParent(c);
      var branch = norm(c.branch_key);
      if (sp && branch) {
        var key = branch + "||" + sp;
        if (!byParentPath.has(key)) byParentPath.set(key, []);
        byParentPath.get(key).push(c);
      }
    });

    // Proxy 1: children visible via parent_person_id but missing from parent-path query
    var pathQueryGaps = [];
    byParentPid.forEach(function (list) {
      list.forEach(function (c) {
        var sp = storedParent(c);
        var pCol = parentCol(c);
        if (!pCol || (sp && pCol && pCol !== sp)) {
          pathQueryGaps.push({
            id: c.id,
            branch_key: c.branch_key,
            child_path: childPath(c),
            parent: pCol || "NULL",
            impact: "لا يظهر ضمن أبناء الأب (استعلام المسار)",
          });
        } else if (!sp) {
          pathQueryGaps.push({
            id: c.id,
            branch_key: c.branch_key,
            child_path: childPath(c),
            parent: "NULL",
            impact: "لا يظهر ضمن أبناء الأب",
          });
        }
      });
    });

    // Proxy 2: search / father listing risk — parent NULL non-roots
    var searchHidden = rows
      .filter(function (c) {
        return c && !parentCol(c) && !isLikelyRoot(c) && childPath(c);
      })
      .slice(0, 50)
      .map(function (c) {
        return {
          id: c.id,
          branch_key: c.branch_key,
          child_path: childPath(c),
          parent: "NULL",
          impact: "لا يظهر في البحث / تصفية الأب بالمسار",
        };
      });

    // Proxy 3: duplicate-create risk — same leaf under same branch with >1 rows lacking unique person_id
    var leafClusters = new Map();
    rows.forEach(function (c) {
      if (!c) return;
      var leaf = leafOf(childPath(c));
      var branch = norm(c.branch_key);
      if (!leaf || !branch) return;
      var key = branch + "||" + leaf;
      if (!leafClusters.has(key)) leafClusters.set(key, []);
      leafClusters.get(key).push(c);
    });
    var duplicateRisk = [];
    leafClusters.forEach(function (list, key) {
      if (list.length < 2) return;
      var missingPid = list.filter(function (c) {
        return !c.person_id;
      }).length;
      if (missingPid > 0 || list.length > 1) {
        duplicateRisk.push({
          id: list.map(function (c) {
            return c.id;
          }).join(","),
          branch_key: key.split("||")[0],
          child_path: key.split("||")[1],
          parent: "",
          impact: "يسمح بطلبات مكررة / غموض هوية",
          count: list.length,
        });
      }
    });

    // Proxy 4: pending tree requests without parent_person_id (routing / WF risk)
    var routingWeak = pending
      .filter(function (r) {
        if (!r) return false;
        var kind = norm(r.kind || r.request_type || "");
        var st = norm(r.status || "");
        if (st && st !== "pending") return false;
        var treeish =
          kind.indexOf("tree") >= 0 ||
          kind.indexOf("person") >= 0 ||
          kind === "add_person" ||
          kind === "tree_card";
        if (!treeish && !r.parent_person_id && !r.father_person_id) {
          // include if message/payload hints father
          return false;
        }
        var pid = r.parent_person_id || r.father_person_id || "";
        return treeish && !pid;
      })
      .slice(0, 25)
      .map(function (r) {
        return {
          id: r.id || r.request_id || "",
          branch_key: r.branch_key || "",
          child_path: r.kind || "",
          parent: "",
          impact: "يعطل مسار الطلبات / قد يصل للطرف الخطأ",
        };
      });

    var checks = [
      {
        id: "rx_children_under_father",
        label: "هل كل أبناء الأب يظهرون في مصدر بيانات الطلبات؟",
        mode: "auto",
        mode_ar: "آلي (وكيل بيانات)",
        ok: pathQueryGaps.length === 0,
        count: pathQueryGaps.length,
        detail_ar:
          pathQueryGaps.length === 0
            ? "لا فجوة بين معرف الأب وحقل الأب في العيّنة المفهرسة."
            : "أبناء لهم معرف أب لكن حقل الأب فارغ/منحرف — قد يختفون من قائمة الأبناء في الطلبات.",
        impact: "لا يظهر ضمن أبناء الأب",
        samples: pathQueryGaps.slice(0, 15),
      },
      {
        id: "rx_search_matches",
        label: "هل البحث يظهر كل المطابقات؟",
        mode: "auto",
        mode_ar: "آلي (وكيل بيانات)",
        ok: searchHidden.length === 0,
        count: searchHidden.length,
        detail_ar:
          searchHidden.length === 0
            ? "لا سجلات غير-جذر بحقل أب فارغ في المسح."
            : "سجلات بحقل أب فارغ قد تُستبعد من بحث/تصفية بالمسار.",
        impact: "لا يظهر في البحث",
        samples: searchHidden.slice(0, 15),
      },
      {
        id: "rx_block_existing_person",
        label: "هل يُمنع إرسال طلب لشخص موجود؟",
        mode: "manual_smoke",
        mode_ar: "يدوي (تحقق قصير)",
        ok: null,
        count: null,
        detail_ar:
          "تحقق يدوي: اختر شخصًا موجودًا في الواجهة → بوابة الهوية يجب أن تمنع «أضف فردًا». الآلي: عناقيد ورقة مكررة = " +
          String(duplicateRisk.length) +
          ".",
        impact: "يسمح بطلبات مكررة",
        samples: duplicateRisk.slice(0, 10),
        related_auto_count: duplicateRisk.length,
      },
      {
        id: "rx_duplicate_before_create",
        label: "هل يُكتشف التكرار قبل الإنشاء؟",
        mode: "auto",
        mode_ar: "آلي (وكيل بيانات)",
        ok: duplicateRisk.length === 0,
        count: duplicateRisk.length,
        detail_ar:
          duplicateRisk.length === 0
            ? "لا عناقيد ورقة متعددة تحت نفس الفرع في المسح."
            : "عناقيد اسم ورقة مكررة — خطر إنشاء مكرر إن فشلت بوابة الهوية.",
        impact: "يسمح بطلبات مكررة",
        samples: duplicateRisk.slice(0, 15),
      },
      {
        id: "rx_reaches_correct_party",
        label: "هل يصل الطلب للطرف الصحيح؟",
        mode: "auto",
        mode_ar: "آلي جزئي + تحقق يدوي",
        ok: routingWeak.length === 0,
        count: routingWeak.length,
        detail_ar:
          routingWeak.length === 0
            ? pending.length
              ? "لا طلبات شجرة معلّقة بلا معرف أب في العيّنة."
              : "لم تُحمَّل طلبات معلّقة — أعد التحديث بعد الدخول. التحقق اليدوي: اعتمد طلب إضافة وتحقق من المندوب/الفرع."
            : "طلبات شجرة معلّقة بلا معرف أب — قد تتعطّل التوجيه أو الاعتماد.",
        impact: "يعطل مسار الطلبات",
        samples: routingWeak,
      },
      {
        id: "rx_identity_coverage",
        label: "تغطية معرف الشخص (وكيل اكتمال الهوية)",
        mode: "auto",
        mode_ar: "آلي (وكيل بيانات)",
        ok: withoutPid === 0,
        count: withoutPid,
        detail_ar:
          "سجلات لها معرف شخص: " +
          String(withPid) +
          " · بلا معرف شخص: " +
          String(withoutPid) +
          " · حقل أب فارغ (غير جذر): " +
          String(parentNull) +
          ".",
        impact: "يحتاج ربط المعرف",
        samples: [],
      },
    ];

    var autoFailed = checks.filter(function (c) {
      return c.mode === "auto" && c.ok === false;
    }).length;
    var manual = checks.filter(function (c) {
      return c.mode === "manual_smoke" || c.mode.indexOf("يدوي") >= 0;
    }).length;

    return {
      mode: "read_only",
      schema: "request_integrity_v1",
      totals: {
        checks: checks.length,
        auto_failed: autoFailed,
        parent_null_non_root: parentNull,
        without_person_id: withoutPid,
        path_query_gaps: pathQueryGaps.length,
        duplicate_leaf_clusters: duplicateRisk.length,
      },
      checks: checks,
      legend: {
        auto: "فحص آلي على بيانات الشجرة/الطلبات — ليس بديلاً عن التحقق اليدوي القصير في الواجهة.",
        manual_smoke:
          "خطوات يدوية قصيرة على الصفحة الرئيسية بعد تحديث التقرير.",
      },
      manual_smoke_steps: [
        "افتح الرئيسية → أضف فردًا → أكّد شخصًا موجودًا: يجب ألا يُسمح بالإنشاء.",
        "اختر أبًا معروفًا (مثال: خميس) وتأكد أن كل الأبناء الظاهرين في مركز الصحة يظهرون في القائمة.",
        "ابحث عن اسم معروف جزئيًا وكاملًا — قارن العدد مع سجلات الشجرة لنفس الاسم.",
        "أرسل طلب إضافة لشخص جديد تحت أب صحيح — تحقق أنه يصل لمندوب/فرع الأب.",
      ],
    };
  }

  function isLikelyRoot(row) {
    var branch = norm(row && row.branch_key);
    var sp = storedParent(row);
    if (!branch) return false;
    if (sp === branch) return true;
    if (sp === branch + " بن مطلق بن زيدان") return true;
    var path = childPath(row);
    if (path === branch || path === branch + " بن مطلق بن زيدان") return true;
    return false;
  }

  var api = {
    auditRequestJourney: auditRequestJourney,
  };

  global.AlzidanIntegrityRequestJourney = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
