/**
 * Tree correction contract — reorder_children + name_correction + phone_correction.
 *
 * kind stays tree_edit for DB compatibility; operation drives the router.
 * Match inputs (names) never invent person_id.
 *
 * Browser: window.AlzidanTreeCorrectionContract
 * Node tests: module.exports
 */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.AlzidanTreeCorrectionContract = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var SCHEMA = "tree_correction.v1";
  var SCHEMA_VERSION = 1;
  var MARKER = "__JSON__:";
  var OPERATION_REORDER = "reorder_children";
  var OPERATION_NAME = "name_correction";
  var OPERATION_PHONE = "phone_correction";
  var OPERATION_BIRTH = "birth_date_correction";
  var OPERATION_PARENT = "parent_change";
  var OPERATION_CITY = "city_correction";
  var KIND_EDIT = "tree_edit";
  var PERSON_OPS = [
    OPERATION_NAME,
    OPERATION_PHONE,
    OPERATION_BIRTH,
    OPERATION_PARENT,
    OPERATION_CITY,
  ];

  function text(v) {
    return String(v == null ? "" : v)
      .replace(/\s+/g, " ")
      .trim();
  }

  function leafName(path) {
    var parts = text(path)
      .split("/")
      .map(text)
      .filter(Boolean);
    return parts.length ? parts[parts.length - 1] : "";
  }

  function normalizeMatchKey(name) {
    return text(name)
      .replace(/[أإآٱ]/g, "ا")
      .replace(/ة/g, "ه")
      .replace(/ى/g, "ي")
      .replace(/ؤ/g, "و")
      .replace(/ئ/g, "ي")
      .replace(/[ًٌٍَُِّْـ]/g, "")
      .toLowerCase();
  }

  /** Keys to try when matching a free-text request name under one parent. */
  function matchKeysForRequestName(raw) {
    var full = text(raw);
    if (!full) return [];
    var keys = [];
    var seen = {};
    function add(v) {
      var k = normalizeMatchKey(v);
      if (!k || seen[k]) return;
      seen[k] = true;
      keys.push(k);
    }
    add(full);
    add(leafName(full));
    var tokens = full.split(/\s+/).filter(Boolean);
    if (tokens.length) {
      add(tokens[0]);
      // Compound given names: عبدالرحمن / عبدالله / …
      if (tokens.length >= 2 && /^(عبد|ابو|أبو)/.test(tokens[0])) {
        add(tokens[0] + " " + tokens[1]);
      }
    }
    return keys;
  }

  /**
   * Extract ordered candidate names from legacy free-text correction messages.
   * Delegates to AlzidanTreeCorrectionLegacyRecovery when loaded.
   */
  function extractReorderCandidateNames(message) {
    var Legacy =
      (typeof globalThis !== "undefined" &&
        globalThis.AlzidanTreeCorrectionLegacyRecovery) ||
      (typeof window !== "undefined" &&
        window.AlzidanTreeCorrectionLegacyRecovery) ||
      null;
    if (!Legacy && typeof require === "function") {
      try {
        Legacy = require("./tree-correction-legacy-recovery.js");
      } catch (e) {}
    }
    if (Legacy && typeof Legacy.extractReorderCandidateNames === "function") {
      return Legacy.extractReorderCandidateNames(message);
    }
    if (Legacy && typeof Legacy.parseLegacyCorrectionRecovery === "function") {
      var parsed = Legacy.parseLegacyCorrectionRecovery(message);
      return (parsed && parsed.targets) || [];
    }
    // Minimal fallback if recovery module not loaded
    var raw = String(message || "");
    var names = [];
    var seen = {};
    String(raw)
      .replace(/[\u0660-\u0669]/g, function (ch) {
        return String(ch.charCodeAt(0) - 0x0660);
      })
      .split(/\r?\n/)
      .forEach(function (line) {
        var t = text(line);
        var m = t.match(/^(?:\d+)\s*[\).\-–:]\s*(.+)$/);
        if (!m) return;
        var n = text(m[1]);
        var k = normalizeMatchKey(n);
        if (!n || !k || seen[k]) return;
        if (/المرسل|ترتيب الاسماء|ترتيب الأسماء/.test(n)) return;
        seen[k] = true;
        names.push(n);
      });
    return names;
  }

  function parseLegacyCorrectionRecovery(message) {
    var Legacy =
      (typeof globalThis !== "undefined" &&
        globalThis.AlzidanTreeCorrectionLegacyRecovery) ||
      (typeof window !== "undefined" &&
        window.AlzidanTreeCorrectionLegacyRecovery) ||
      null;
    if (!Legacy && typeof require === "function") {
      try {
        Legacy = require("./tree-correction-legacy-recovery.js");
      } catch (e) {}
    }
    if (Legacy && typeof Legacy.parseLegacyCorrectionRecovery === "function") {
      return Legacy.parseLegacyCorrectionRecovery(message);
    }
    var targets = extractReorderCandidateNames(message);
    return {
      ok: targets.length >= 2,
      operation: targets.length >= 2 ? OPERATION_REORDER : "",
      targets: targets,
      ordered_children: targets.map(function (n, i) {
        return { person_id: "", name: n, match_name: n, position: i + 1 };
      }),
      extract_debug: ["legacy_module_missing"],
      reasons: targets.length >= 2 ? [] : ["وحدة الاستعادة غير محمّلة"],
      message_ar:
        targets.length >= 2
          ? "تم استخراج " + targets.length + " أهداف."
          : "وحدة الاستعادة غير محمّلة أو فشل الاستخراج.",
    };
  }

  function assessMatchLevel(opts) {
    var o = opts || {};
    var parentId = text(o.parent_person_id || "");
    var match = o.match || {};
    var requested = asArray(o.requested);
    var reqCount = requested.length || Number(o.requested_count) || 0;
    var matchedCount = asArray(match.matched).length;
    var ambiguousCount = asArray(match.ambiguous).length;
    var unmatchedCount = asArray(match.unmatched).length;

    if (reqCount < 2) {
      return {
        level: 4,
        key: "fundamental",
        label: "غموض جوهري",
        message_ar: "لا يمكن تحديد مجموعة الترتيب من الطلب.",
      };
    }
    if (!parentId) {
      return {
        level: 2,
        key: "pending_parent",
        label: "بانتظار الأب",
        message_ar:
          "تم التعرف على " +
          reqCount +
          " أشخاص من الطلب، لكن الأب المرجعي غير مثبت. اختر الأب من الشجرة لتأكيد المجموعة.",
        requested_count: reqCount,
      };
    }
    if (match.complete && matchedCount === reqCount) {
      return {
        level: 1,
        key: "complete",
        label: "تطابق كامل",
        message_ar: "تم العثور على " + matchedCount + " من " + reqCount + " أشخاص.",
        matched_count: matchedCount,
        requested_count: reqCount,
      };
    }
    if (matchedCount > 0 && (ambiguousCount > 0 || unmatchedCount > 0)) {
      return {
        level: 3,
        key: "partial",
        label: "مطابقة جزئية",
        message_ar:
          matchedCount +
          " من " +
          reqCount +
          " تمت مطابقتهم — حسم الغامض/غير المطابق قبل الحفظ.",
        matched_count: matchedCount,
        requested_count: reqCount,
        ambiguous_count: ambiguousCount,
        unmatched_count: unmatchedCount,
      };
    }
    return {
      level: 4,
      key: "fundamental",
      label: "غموض جوهري",
      message_ar:
        "تعذر مطابقة المجموعة تحت الأب المختار. راجع الأسماء أو الأب.",
      matched_count: matchedCount,
      requested_count: reqCount,
    };
  }

  function asArray(v) {
    return Array.isArray(v) ? v : [];
  }

  function extractBalancedObject(raw) {
    var s = String(raw || "");
    var start = s.indexOf("{");
    if (start < 0) return "";
    var depth = 0;
    var inString = false;
    var escape = false;
    for (var i = start; i < s.length; i++) {
      var ch = s.charAt(i);
      if (inString) {
        if (escape) {
          escape = false;
        } else if (ch === "\\") {
          escape = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) return s.slice(start, i + 1);
      }
    }
    return "";
  }

  function safeParseJson(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (!s) return { ok: false, error: "empty", value: null };
    try {
      return { ok: true, error: "", value: JSON.parse(s) };
    } catch (e1) {
      var balanced = extractBalancedObject(s);
      if (!balanced) {
        return {
          ok: false,
          error: (e1 && e1.message) || "parse_failed",
          value: null,
        };
      }
      try {
        return { ok: true, error: "recovered_object", value: JSON.parse(balanced) };
      } catch (e2) {
        return {
          ok: false,
          error: (e2 && e2.message) || "parse_failed",
          value: null,
        };
      }
    }
  }

  function extractJsonFromMessage(message) {
    var raw = String(message == null ? "" : message);
    var idx = raw.indexOf(MARKER);
    if (idx < 0) {
      return { ok: false, hasMarker: false, error: "no_marker", value: null, visible: raw };
    }
    var jsonPart = raw.slice(idx + MARKER.length).trim();
    var visible = raw.slice(0, idx).trim();
    var parsed = safeParseJson(jsonPart);
    return {
      ok: parsed.ok,
      hasMarker: true,
      error: parsed.error,
      value: parsed.value,
      visible: visible,
    };
  }

  function normalizeOrderedChild(item, index) {
    if (typeof item === "string") {
      return {
        person_id: "",
        name: text(item),
        match_name: text(item),
        position: index + 1,
      };
    }
    var obj = item && typeof item === "object" ? item : {};
    var name = text(obj.name || obj.match_name || obj.child_name || obj.leaf || "");
    return {
      person_id: text(obj.person_id || obj.personId || ""),
      name: name,
      match_name: text(obj.match_name || name),
      path: text(obj.path || obj.child_name || obj.name || ""),
      position: Number(obj.position) > 0 ? Number(obj.position) : index + 1,
    };
  }

  function normalizeReorderPayload(raw, row) {
    var src = raw && typeof raw === "object" ? raw : {};
    var rowObj = row && typeof row === "object" ? row : {};
    var childrenSrc =
      src.ordered_children ||
      src.orderedChildren ||
      src.children ||
      src.order ||
      [];
    var ordered = asArray(childrenSrc).map(normalizeOrderedChild).filter(function (c) {
      return c.person_id || c.name || c.match_name;
    });
    return {
      schema: SCHEMA,
      v: SCHEMA_VERSION,
      kind: KIND_EDIT,
      operation: OPERATION_REORDER,
      branch_key: text(
        src.branch_key || src.branch || rowObj.branch_key || ""
      ),
      parent_person_id: text(
        src.parent_person_id || src.parentPersonId || src.parent_id || ""
      ),
      parent_name: text(
        src.parent_name || src.parent || src.parent_path || src.father || ""
      ),
      parent_path: text(src.parent_path || src.parent_name || src.parent || ""),
      ordered_children: ordered,
      notes: text(src.notes || ""),
      review_state: text(src.review_state || ""),
      source: text(src.source || "web_rx"),
      submitter:
        src.submitter && typeof src.submitter === "object"
          ? {
              name: text(src.submitter.name),
              phone: text(src.submitter.phone),
            }
          : { name: "", phone: "" },
      created_at: text(src.created_at || rowObj.created_at || ""),
      applied_at: text(src.applied_at || ""),
    };
  }

  function validateReorderPayload(payload) {
    var p = normalizeReorderPayload(payload);
    var reasons = [];
    if (p.operation !== OPERATION_REORDER) {
      reasons.push("operation يجب أن يكون reorder_children");
    }
    if (!p.branch_key) reasons.push("الفرع مطلوب");
    if (!p.parent_person_id && !p.parent_name && !p.parent_path) {
      reasons.push("الأب مطلوب (هوية أو اسم للمطابقة)");
    }
    if (!p.ordered_children.length) {
      reasons.push("قائمة الأبناء المطلوبة فارغة");
    }
    if (p.ordered_children.length === 1) {
      reasons.push("الترتيب يحتاج ابنين على الأقل");
    }

    var ids = p.ordered_children
      .map(function (c) {
        return c.person_id;
      })
      .filter(Boolean);
    var allHaveIds =
      p.ordered_children.length > 0 &&
      ids.length === p.ordered_children.length;
    var uniqueIds = {};
    var dupId = false;
    ids.forEach(function (id) {
      if (uniqueIds[id]) dupId = true;
      uniqueIds[id] = true;
    });
    if (dupId) reasons.push("تكرار person_id في الترتيب المطلوب");

    var review_state = "needs_review";
    if (!reasons.length && allHaveIds && p.parent_person_id) {
      review_state = "ready";
    } else if (!reasons.length && !allHaveIds) {
      review_state = "needs_review";
      if (!p.parent_person_id) {
        reasons.push("parent_person_id غير مثبت — مطابقة قبل الحفظ");
      } else {
        reasons.push("بعض الأبناء بلا person_id — مطابقة قبل الحفظ");
      }
    } else if (reasons.length) {
      review_state = reasons.some(function (r) {
        return /فارغة|مطلوب|فرعين|ابنين/.test(r);
      })
        ? "unsupported"
        : "needs_review";
    }

    p.review_state = review_state;
    return {
      ok: reasons.length === 0 || review_state === "ready" || review_state === "needs_review",
      creatable: !reasons.some(function (r) {
        return /فارغة|مطلوب|ابنين|operation/.test(r);
      }),
      ready: review_state === "ready",
      review_state: review_state,
      reasons: reasons,
      payload: p,
    };
  }

  function serializeReorderMessage(input) {
    var validated = validateReorderPayload(input);
    var p = validated.payload;
    var lines = [];
    lines.push("طلب: صحح بيانات — ترتيب أبناء");
    lines.push("");
    if (input && input.requestId) {
      lines.push("رقم الطلب: " + text(input.requestId));
    }
    lines.push("العملية: " + OPERATION_REORDER);
    lines.push("العائلة: " + (p.branch_key || "—"));
    lines.push(
      "الأب: " +
        (p.parent_name || leafName(p.parent_path) || p.parent_path || "—")
    );
    if (p.parent_person_id) {
      lines.push("معرّف الأب: " + p.parent_person_id);
    }
    lines.push("");
    lines.push("الترتيب المطلوب (من الأكبر إلى الأصغر):");
    p.ordered_children.forEach(function (c, i) {
      var label = c.name || c.match_name || leafName(c.path) || "—";
      var idPart = c.person_id ? " [" + c.person_id + "]" : "";
      lines.push(String(i + 1) + ". " + label + idPart);
    });
    if (p.notes) {
      lines.push("");
      lines.push("ملاحظات: " + p.notes);
    }
    if (p.submitter && (p.submitter.name || p.submitter.phone)) {
      lines.push("");
      lines.push("بيانات المرسل:");
      if (p.submitter.name) lines.push("الاسم: " + p.submitter.name);
      if (p.submitter.phone) lines.push("الجوال: " + p.submitter.phone);
    }
    lines.push("");
    lines.push("حالة المراجعة: " + (p.review_state || validated.review_state));
    lines.push("");
    lines.push(MARKER);
    lines.push(
      JSON.stringify(
        {
          schema: SCHEMA,
          v: SCHEMA_VERSION,
          kind: KIND_EDIT,
          operation: OPERATION_REORDER,
          branch_key: p.branch_key,
          parent_person_id: p.parent_person_id,
          parent_name: p.parent_name,
          parent_path: p.parent_path,
          ordered_children: p.ordered_children.map(function (c) {
            return {
              person_id: c.person_id,
              name: c.name || c.match_name,
              match_name: c.match_name || c.name,
              path: c.path || "",
              position: c.position,
            };
          }),
          notes: p.notes,
          review_state: p.review_state || validated.review_state,
          source: p.source || "web_rx",
          submitter: p.submitter,
          created_at: p.created_at || new Date().toISOString(),
          applied_at: p.applied_at || "",
        },
        null,
        2
      )
    );
    return lines.join("\n");
  }

  function parseCorrectionMessage(message, row) {
    var extracted = extractJsonFromMessage(message);
    if (!extracted.hasMarker || !extracted.ok || !extracted.value) {
      return {
        ok: false,
        operation: "",
        review_state: "needs_review",
        reasons: [
          extracted.hasMarker
            ? "JSON غير صالح"
            : "لا يوجد envelope منظم للتصحيح",
        ],
        payload: null,
        visible: extracted.visible || String(message || ""),
      };
    }
    var value = extracted.value;
    var operation = text(value.operation || "");
    if (operation === OPERATION_REORDER) {
      var validated = validateReorderPayload(value, row);
      return {
        ok: validated.ok,
        operation: OPERATION_REORDER,
        review_state: validated.review_state,
        reasons: validated.reasons,
        payload: validated.payload,
        ready: validated.ready,
        creatable: validated.creatable,
        visible: extracted.visible,
      };
    }
    if (PERSON_OPS.indexOf(operation) >= 0) {
      var validatedP = validatePersonCorrectionPayload(value, row);
      return {
        ok: validatedP.ok,
        operation: operation,
        review_state: validatedP.review_state,
        reasons: validatedP.reasons,
        payload: validatedP.payload,
        ready: validatedP.ready,
        creatable: validatedP.creatable,
        visible: extracted.visible,
      };
    }
    return {
      ok: false,
      operation: operation,
      review_state: "unsupported",
      reasons: [
        operation
          ? "عملية غير مدعومة في هذه الشريحة: " + operation
          : "الحمولة بلا operation",
      ],
      payload: value,
      visible: extracted.visible,
    };
  }

  function assertCreatableReorder(messageOrPayload, row) {
    var parsed;
    if (typeof messageOrPayload === "string") {
      parsed = parseCorrectionMessage(messageOrPayload, row);
    } else {
      var validated = validateReorderPayload(messageOrPayload, row);
      parsed = {
        ok: validated.ok,
        operation: OPERATION_REORDER,
        review_state: validated.review_state,
        reasons: validated.reasons,
        payload: validated.payload,
        creatable: validated.creatable,
        ready: validated.ready,
      };
    }
    if (!parsed || parsed.operation !== OPERATION_REORDER) {
      return {
        ok: false,
        code: "REORDER_OPERATION_REQUIRED",
        message_ar: "طلب ترتيب الأبناء يجب أن يحمل operation=reorder_children",
      };
    }
    if (!parsed.creatable && parsed.reasons && parsed.reasons.length) {
      return {
        ok: false,
        code: "REORDER_PAYLOAD_INVALID",
        message_ar: parsed.reasons[0] || "حمولة ترتيب الأبناء غير صالحة",
        reasons: parsed.reasons,
      };
    }
    var message =
      typeof messageOrPayload === "string"
        ? messageOrPayload
        : serializeReorderMessage(
            Object.assign({}, parsed.payload, row || {})
          );
    return {
      ok: true,
      code: "",
      message_ar: "",
      message: message,
      payload: parsed.payload,
      review_state: parsed.review_state,
    };
  }

  /**
   * Match requested names to tree children under one parent.
   * Never invents person_id from name alone when ambiguous or missing.
   * Under a confirmed parent, unique given-name / prefix matches are allowed.
   */
  function matchChildrenToTree(requested, treeChildren) {
    var req = asArray(requested).map(normalizeOrderedChild);
    var tree = asArray(treeChildren).map(function (r) {
      var path = text(r.child_name || r.name || r.path || "");
      var name = text(r.leaf || r.display_name || leafName(path) || r.name || "");
      return {
        person_id: text(r.person_id || r.personId || ""),
        name: name,
        path: path,
        birth_order:
          r.birth_order != null && r.birth_order !== ""
            ? Number(r.birth_order)
            : null,
        parent_person_id: text(r.parent_person_id || r.parentPersonId || ""),
        parent_name: text(r.parent_name || r.parent || ""),
        id: r.id,
      };
    });

    var byId = {};
    var byName = {};
    tree.forEach(function (c) {
      if (c.person_id) byId[c.person_id] = c;
      matchKeysForRequestName(c.name).forEach(function (key) {
        if (!byName[key]) byName[key] = [];
        if (
          byName[key].every(function (x) {
            return x.person_id !== c.person_id;
          })
        ) {
          byName[key].push(c);
        }
      });
    });

    var matched = [];
    var ambiguous = [];
    var unmatched = [];
    var usedIds = {};

    function available(list) {
      return (list || []).filter(function (c) {
        return c.person_id && !usedIds[c.person_id];
      });
    }

    function findCandidates(item) {
      var raw = item.match_name || item.name || leafName(item.path);
      var keys = matchKeysForRequestName(raw);
      var found = [];
      var seenPid = {};
      keys.forEach(function (key) {
        available(byName[key]).forEach(function (c) {
          if (seenPid[c.person_id]) return;
          seenPid[c.person_id] = true;
          found.push(c);
        });
      });
      if (found.length) return found;

      // Prefix / containment under same parent only (unique).
      var reqKey = normalizeMatchKey(raw);
      if (!reqKey) return [];
      tree.forEach(function (c) {
        if (!c.person_id || usedIds[c.person_id]) return;
        var leafKey = normalizeMatchKey(c.name);
        if (!leafKey) return;
        if (
          reqKey === leafKey ||
          reqKey.indexOf(leafKey) === 0 ||
          leafKey.indexOf(reqKey) === 0
        ) {
          found.push(c);
        }
      });
      return found;
    }

    req.forEach(function (item, index) {
      if (item.person_id && byId[item.person_id]) {
        var hit = byId[item.person_id];
        if (usedIds[hit.person_id]) {
          ambiguous.push({
            index: index,
            request: item,
            reason: "person_id مكرر في الطلب",
            candidates: [hit],
          });
          return;
        }
        usedIds[hit.person_id] = true;
        matched.push({
          index: index,
          request: item,
          person_id: hit.person_id,
          name: hit.name,
          path: hit.path,
          birth_order: hit.birth_order,
          id: hit.id,
          match: "person_id",
        });
        return;
      }

      var cands = findCandidates(item);
      if (cands.length === 1) {
        usedIds[cands[0].person_id] = true;
        matched.push({
          index: index,
          request: item,
          person_id: cands[0].person_id,
          name: cands[0].name,
          path: cands[0].path,
          birth_order: cands[0].birth_order,
          id: cands[0].id,
          match: "unique_under_parent",
        });
        return;
      }
      if (cands.length > 1) {
        ambiguous.push({
          index: index,
          request: item,
          reason: "أكثر من تطابق محتمل تحت الأب",
          candidates: cands,
        });
        return;
      }
      unmatched.push({
        index: index,
        request: item,
        reason: item.person_id
          ? "person_id غير موجود تحت الأب"
          : "لا مطابقة تحت الأب المختار",
      });
    });

    var complete =
      matched.length === req.length &&
      !ambiguous.length &&
      !unmatched.length &&
      req.length > 0;

    var orderedIds = matched
      .slice()
      .sort(function (a, b) {
        return a.index - b.index;
      })
      .map(function (m) {
        return m.person_id;
      });

    return {
      complete: complete,
      matched: matched,
      ambiguous: ambiguous,
      unmatched: unmatched,
      ordered_person_ids: complete ? orderedIds : [],
      // Partial ordered ids only for display — never for silent save
      matched_person_ids_in_request_order: orderedIds,
    };
  }

  function buildReorderPreview(currentChildren, orderedPersonIds, opts) {
    var options = opts || {};
    var ids = asArray(orderedPersonIds).map(text).filter(Boolean);
    var ready = options.ready !== false && ids.length >= 2;

    if (!ready) {
      return {
        ready: false,
        changes: [],
        assignments: [],
        unchanged: [],
        changes_summary:
          "الأثر غير محسوب بعد — أكمل مطابقة الأب والمجموعة.",
        unchanged_summary:
          "بعد المطابقة: لن تتغير الهويات أو الأسماء أو الآباء أو الجوالات أو تواريخ الميلاد.",
        current_order: [],
        requested_order: [],
        canonical_summary: "",
      };
    }

    var byId = {};
    asArray(currentChildren).forEach(function (c) {
      var id = text(c.person_id || c.personId || "");
      if (!id) return;
      byId[id] = {
        person_id: id,
        name: text(c.name || leafName(c.path || c.child_name || "")),
        birth_order:
          c.birth_order != null && c.birth_order !== ""
            ? Number(c.birth_order)
            : null,
        path: text(c.path || c.child_name || c.name || ""),
      };
    });

    var changes = [];
    var assignments = [];
    var missingStored = 0;
    var unchanged = [
      "أسماء الأبناء",
      "هويات person_id",
      "الأب / parent_person_id",
      "الجوالات",
      "تواريخ الميلاد",
      "الفرع",
    ];

    // Current order from stored birth_order only (nulls last) — not UI array position.
    var current_order = ids
      .map(function (id) {
        return byId[id] || { person_id: id, name: id, birth_order: null };
      })
      .slice()
      .sort(function (a, b) {
        var aMissing = a.birth_order == null;
        var bMissing = b.birth_order == null;
        if (aMissing !== bMissing) return aMissing ? 1 : -1;
        if (a.birth_order !== b.birth_order) {
          return (a.birth_order || 0) - (b.birth_order || 0);
        }
        return String(a.name || "").localeCompare(String(b.name || ""), "ar");
      });

    var requested_order = ids.map(function (id, i) {
      var cur = byId[id];
      var to = i + 1;
      var from = cur ? cur.birth_order : null;
      if (from == null) missingStored += 1;
      assignments.push({
        person_id: id,
        name: cur ? cur.name : id,
        from: from,
        to: to,
        field: "birth_order",
        will_write: true,
      });
      if (from !== to) {
        changes.push({
          person_id: id,
          name: cur ? cur.name : id,
          from: from,
          to: to,
          field: "birth_order",
        });
      }
      return {
        person_id: id,
        name: cur ? cur.name : id,
        position: to,
        birth_order: from,
      };
    });

    var n = ids.length;
    var canonical_summary = ids
      .map(function (id, i) {
        var cur = byId[id];
        return (cur ? cur.name : id) + " = " + (i + 1);
      })
      .join("، ");

    return {
      ready: true,
      changes: changes,
      assignments: assignments,
      unchanged: unchanged,
      current_order: current_order,
      requested_order: requested_order,
      canonical_summary: canonical_summary,
      changes_summary:
        "سيُسند birth_order صراحةً لجميع أبناء المجموعة 1…" +
        n +
        " (وليس العناصر المتغيّرة فقط)." +
        (missingStored
          ? " حالياً " + missingStored + " بلا قيمة مخزّنة."
          : "") +
        (changes.length
          ? " يخالف المخزن حالياً: " + changes.length + "."
          : " القيم المخزّنة ستُثبَّت إن طابقت الهدف."),
      unchanged_summary:
        "لن تتغير هويات الأشخاص أو أسماؤهم أو آباؤهم أو جوالاتهم أو تواريخ الميلاد.",
    };
  }

  /**
   * After save: stored birth_order must equal 1..N and display-sort must follow it.
   */
  function verifyCanonicalBirthOrder(rows, orderedPersonIds) {
    var ids = asArray(orderedPersonIds).map(text).filter(Boolean);
    var byId = {};
    asArray(rows).forEach(function (r) {
      var id = text(r.person_id || r.personId || "");
      if (!id) return;
      byId[id] = {
        person_id: id,
        name: text(r.name || leafName(r.path || r.child_name || "")),
        birth_order:
          r.birth_order != null && r.birth_order !== ""
            ? Number(r.birth_order)
            : null,
      };
    });
    var errors = [];
    ids.forEach(function (id, i) {
      var expected = i + 1;
      var row = byId[id];
      if (!row) {
        errors.push("مفقود بعد الحفظ: " + id);
        return;
      }
      if (row.birth_order !== expected) {
        errors.push(
          (row.name || id) +
            ": مخزّن=" +
            (row.birth_order == null ? "—" : row.birth_order) +
            " متوقع=" +
            expected
        );
      }
    });
    var sorted = ids
      .map(function (id) {
        return byId[id];
      })
      .filter(Boolean)
      .slice()
      .sort(function (a, b) {
        var ao = a.birth_order == null ? 9999 : a.birth_order;
        var bo = b.birth_order == null ? 9999 : b.birth_order;
        return ao - bo;
      })
      .map(function (r) {
        return r.person_id;
      });
    if (sorted.join("|") !== ids.join("|")) {
      errors.push(
        "ترتيب العرض بعد الفرز بـ birth_order لا يطابق الترتيب canonical 1..N"
      );
    }
    return {
      ok: errors.length === 0,
      errors: errors,
      expected: ids.map(function (id, i) {
        return { person_id: id, birth_order: i + 1 };
      }),
    };
  }

  function isLegacyMobileCorrectionPhrase(message) {
    var msg = String(message || "");
    return /طلب تصحيح بيانات من تطبيق|طلب تصحيح بيانات|التصحيح المطلوب|الاسم\/المسار/.test(
      msg
    );
  }

  function looksLikeReorderFreeText(message) {
    var msg = String(message || "");
    return /ترتيب|رتّب|رتب الأبناء|من الأكبر|من الأصغر|birth_order|ترتيب الأبناء/.test(
      msg
    );
  }

  /**
   * Safe classification for legacy / misclassified rows.
   * Never forces reinterpretation as tree_card apply.
   */
  function classifyLegacyCorrection(row) {
    var kind = text(row && row.kind);
    var message = String((row && row.message) || "");
    var extracted = extractJsonFromMessage(message);
    var structured = null;
    if (extracted.ok && extracted.value) {
      structured = parseCorrectionMessage(message, row);
      if (structured.operation === OPERATION_REORDER) {
        return {
          isLegacy: false,
          isMisclassifiedTreeCard: false,
          safeReview: structured.review_state !== "ready",
          route: "reorder_children",
          operation: OPERATION_REORDER,
          review_state: structured.review_state,
          reasons: structured.reasons || [],
          payload: structured.payload,
          label: "ترتيب أبناء",
        };
      }
    }

    var legacyPhrase = isLegacyMobileCorrectionPhrase(message);
    var reorderHint = looksLikeReorderFreeText(message);
    var misclassifiedTreeCard =
      kind === "tree_card" &&
      (legacyPhrase || reorderHint) &&
      (!extracted.hasMarker ||
        (extracted.ok &&
          extracted.value &&
          text(extracted.value.kind) !== "tree_card" &&
          !text(extracted.value.name)));

    // tree_card without JSON + correction language → Safe Review (not add-person)
    if (kind === "tree_card" && legacyPhrase && !extracted.hasMarker) {
      return {
        isLegacy: true,
        isMisclassifiedTreeCard: true,
        safeReview: true,
        route: "safe_review",
        operation: reorderHint ? OPERATION_REORDER : "",
        review_state: "needs_review",
        reasons: [
          "طلب تصحيح قديم مصنّف tree_card بلا envelope إضافة فرد — مراجعة آمنة بلا تطبيق إضافة.",
        ],
        payload: null,
        label: "مراجعة آمنة (تصحيح قديم)",
      };
    }

    if (kind === "tree_card" && reorderHint && !extracted.hasMarker) {
      return {
        isLegacy: true,
        isMisclassifiedTreeCard: true,
        safeReview: true,
        route: "safe_review",
        operation: OPERATION_REORDER,
        review_state: "needs_review",
        reasons: [
          "نص يشير لترتيب أبناء دون عقد منظم — Safe Review بلا تطبيق tree_card.",
        ],
        payload: null,
        label: "مراجعة آمنة (ترتيب محتمل)",
      };
    }

    if (kind === KIND_EDIT && !extracted.hasMarker) {
      return {
        isLegacy: true,
        isMisclassifiedTreeCard: false,
        safeReview: true,
        route: "safe_review",
        operation: reorderHint ? OPERATION_REORDER : "",
        review_state: "needs_review",
        reasons: ["tree_edit بلا envelope منظم — مراجعة يدوية."],
        payload: null,
        label: "مراجعة آمنة (تصحيح)",
      };
    }

    if (misclassifiedTreeCard) {
      return {
        isLegacy: true,
        isMisclassifiedTreeCard: true,
        safeReview: true,
        route: "safe_review",
        operation: "",
        review_state: "needs_review",
        reasons: ["تصنيف tree_card غير متسق مع نية التصحيح."],
        payload: null,
        label: "مراجعة آمنة",
      };
    }

    return {
      isLegacy: false,
      isMisclassifiedTreeCard: false,
      safeReview: false,
      route: "",
      operation: "",
      review_state: "",
      reasons: [],
      payload: null,
      label: "",
    };
  }

  /**
   * Admin/Delegate router entry.
   */

  /**
   * Requester phone and target phone are independent identities.
   * approval_requests.phone / src.phone / submitter.phone = صاحب الطلب.
   * phone_new / target_phone = جوال الشخص المعدّل، وفقط في phone_correction.
   * Never copy the requester number onto the person being corrected.
   */
  function splitCorrectionIdentities(src, rowObj) {
    var input = src || {};
    var row = rowObj || {};
    var submitter =
      input.submitter && typeof input.submitter === "object"
        ? input.submitter
        : {};
    var targetObj =
      input.target_person && typeof input.target_person === "object"
        ? input.target_person
        : {};
    var requesterName = text(
      submitter.name || input.requester_name || row.name || ""
    );
    var requesterPhone = text(
      submitter.phone || input.requester_phone || row.phone || ""
    );
    var requesterPersonId = text(
      submitter.person_id ||
        submitter.personId ||
        input.requester_person_id ||
        ""
    );
    var personId = text(
      input.person_id || input.personId || targetObj.person_id || ""
    );
    var personName = text(
      input.person_name ||
        input.personName ||
        input.match_name ||
        targetObj.person_name ||
        targetObj.name ||
        ""
    );
    var path = text(
      input.path ||
        input.child_name ||
        input.childName ||
        targetObj.path ||
        ""
    );
    return {
      requesterName: requesterName,
      requesterPhone: requesterPhone,
      requesterPersonId: requesterPersonId,
      personId: personId,
      personName: personName,
      path: path,
      submitter: {
        name: requesterName,
        phone: requesterPhone,
        person_id: requesterPersonId || undefined,
      },
    };
  }

  function normalizePersonCorrectionPayload(input, row) {
    var src = input || {};
    var rowObj = row || {};
    var operation = text(src.operation || "");
    if (PERSON_OPS.indexOf(operation) < 0) operation = "";
    var ids = splitCorrectionIdentities(src, rowObj);
    var personId = ids.personId;
    var personName = ids.personName;
    var path = ids.path;
    var branch = text(
      src.branch_key || src.branchKey || rowObj.branch_key || ""
    );
    var nameNew = text(src.name_new || src.nameNew || src.new_name || "");
    var nameOld = text(src.name_old || src.nameOld || src.old_name || personName);
    var explicitTargetPhone = text(
      src.target_phone || src.phone_new || src.phoneNew || ""
    );
    var phoneNew = operation === OPERATION_PHONE ? explicitTargetPhone : "";
    var phoneOld = text(src.phone_old || src.phoneOld || "");
    var birthNew = text(src.birth_date_new || src.birthDateNew || "");
    var birthOld = text(
      src.birth_date_old || src.birthDateOld || src.birth_date_g_old || ""
    );
    var newParentId = text(
      src.new_parent_person_id || src.newParentPersonId || ""
    );
    var newParentName = text(
      src.new_parent_name || src.newParentName || ""
    );
    var newParentPath = text(
      src.new_parent_path || src.newParentPath || ""
    );
    var oldParentId = text(
      src.old_parent_person_id || src.oldParentPersonId || ""
    );
    var oldParentName = text(
      src.old_parent_name || src.oldParentName || ""
    );
    var cityNew = text(src.city_new || src.cityNew || "");
    var cityOld = text(src.city_old || src.cityOld || "");
    var areaNew = text(src.area_new || src.areaNew || "");
    var areaOld = text(src.area_old || src.areaOld || "");
    var notes = text(src.notes || "");
    var review = text(src.review_state || "");
    var selfEdit = !!(
      personId &&
      ids.requesterPersonId &&
      personId === ids.requesterPersonId
    );
    return {
      schema: SCHEMA,
      schema_version: SCHEMA_VERSION,
      kind: KIND_EDIT,
      operation: operation,
      branch_key: branch,
      person_id: personId,
      person_name: personName,
      path: path,
      target_person: {
        person_id: personId,
        person_name: personName,
        path: path,
      },
      requester_name: ids.requesterName,
      requester_phone: ids.requesterPhone,
      requester_person_id: ids.requesterPersonId,
      self_edit: selfEdit,
      name_old: nameOld,
      name_new: nameNew,
      phone_new: phoneNew,
      phone_old: phoneOld,
      target_phone: phoneNew,
      birth_date_new: birthNew,
      birth_date_old: birthOld,
      city_new: cityNew,
      city_old: cityOld,
      area_new: areaNew,
      area_old: areaOld,
      new_parent_person_id: newParentId,
      new_parent_name: newParentName,
      new_parent_path: newParentPath,
      old_parent_person_id: oldParentId,
      old_parent_name: oldParentName,
      notes: notes,
      review_state: review,
      source: text(src.source || "web_rx") || "web_rx",
      submitter: ids.submitter,
      created_at: text(src.created_at || src.createdAt || "") || null,
      applied_at: text(src.applied_at || "") || null,
    };
  }

  function validatePersonCorrectionPayload(input, row) {
    var p = normalizePersonCorrectionPayload(input, row);
    var reasons = [];
    if (PERSON_OPS.indexOf(p.operation) < 0) {
      reasons.push(
        "operation يجب أن يكون name/phone/birth_date/city_correction أو parent_change"
      );
    }
    if (!p.person_id) {
      reasons.push("person_id مطلوب — لا إرسال بالاسم وحده");
    }
    if (!p.branch_key) {
      reasons.push("branch_key مطلوب");
    }
    if (p.operation === OPERATION_NAME) {
      if (!p.name_new) reasons.push("name_new مطلوب");
      else if (/\s/.test(p.name_new)) {
        reasons.push("اسم الابن كلمة واحدة فقط (بدون نسب)");
      }
      if (p.name_old && text(p.name_old) === text(p.name_new)) {
        reasons.push("الاسم الجديد مطابق للقديم");
      }
    }
    if (p.operation === OPERATION_PHONE) {
      if (!p.phone_new) reasons.push("phone_new مطلوب");
      else if (!/^\+?[0-9]{8,15}$/.test(p.phone_new.replace(/\s/g, ""))) {
        reasons.push("صيغة الجوال غير صالحة");
      }
    }
    if (p.operation === OPERATION_BIRTH) {
      if (!p.birth_date_new) reasons.push("birth_date_new مطلوب");
      else if (!/^\d{4}-\d{2}-\d{2}$/.test(p.birth_date_new)) {
        reasons.push("صيغة تاريخ الميلاد: YYYY-MM-DD");
      }
      if (p.birth_date_old && p.birth_date_old === p.birth_date_new) {
        reasons.push("تاريخ الميلاد الجديد مطابق للقديم");
      }
    }
    if (p.operation === OPERATION_PARENT) {
      if (!p.new_parent_person_id) {
        reasons.push("new_parent_person_id مطلوب");
      }
      if (p.new_parent_person_id && p.new_parent_person_id === p.person_id) {
        reasons.push("لا يمكن أن يكون الأب هو نفس الشخص");
      }
      if (
        p.old_parent_person_id &&
        p.new_parent_person_id === p.old_parent_person_id
      ) {
        reasons.push("الأب الجديد مطابق للحالي");
      }
    }
    if (p.operation === OPERATION_CITY) {
      if (!p.city_new && !p.area_new) {
        reasons.push("المدينة أو الحي/القرية مطلوب");
      }
      if (p.city_new && p.city_new.length > 80) {
        reasons.push("المدينة أطول من المسموح");
      }
      if (p.area_new && p.area_new.length > 80) {
        reasons.push("الحي/القرية أطول من المسموح");
      }
      if (
        p.city_old &&
        p.city_new &&
        p.city_new === p.city_old &&
        (!p.area_new || p.area_new === p.area_old)
      ) {
        reasons.push("المدينة/الحي مطابق للحالي");
      }
      if (
        !p.city_new &&
        p.area_old &&
        p.area_new &&
        p.area_new === p.area_old
      ) {
        reasons.push("الحي/القرية مطابق للحالي");
      }
    }
    var ready = !reasons.length;
    return {
      ok: ready,
      ready: ready,
      creatable: ready,
      review_state: ready ? "ready" : "needs_review",
      reasons: reasons,
      payload: p,
    };
  }

  function serializePersonCorrectionMessage(input, row) {
    var p = normalizePersonCorrectionPayload(input, row);
    var lines = [];
    if (p.operation === OPERATION_NAME) {
      lines.push("طلب تصحيح اسم");
      lines.push("العملية: " + OPERATION_NAME);
      lines.push("الشخص: " + (p.person_name || p.person_id));
      if (p.name_old) lines.push("الاسم الحالي: " + p.name_old);
      lines.push("الاسم الجديد: " + p.name_new);
    } else if (p.operation === OPERATION_PHONE) {
      lines.push("طلب تصحيح جوال");
      lines.push("العملية: " + OPERATION_PHONE);
      lines.push("الشخص: " + (p.person_name || p.person_id));
      if (p.phone_old) lines.push("الجوال الحالي: " + p.phone_old);
      lines.push("الجوال الجديد: " + p.phone_new);
    } else if (p.operation === OPERATION_BIRTH) {
      lines.push("طلب تصحيح تاريخ ميلاد");
      lines.push("العملية: " + OPERATION_BIRTH);
      lines.push("الشخص: " + (p.person_name || p.person_id));
      if (p.birth_date_old) lines.push("الميلاد الحالي: " + p.birth_date_old);
      lines.push("الميلاد الجديد: " + p.birth_date_new);
    } else if (p.operation === OPERATION_PARENT) {
      lines.push("طلب تصحيح الأب");
      lines.push("العملية: " + OPERATION_PARENT);
      lines.push("الشخص: " + (p.person_name || p.person_id));
      if (p.old_parent_name || p.old_parent_person_id) {
        lines.push(
          "الأب الحالي: " + (p.old_parent_name || p.old_parent_person_id)
        );
      }
      lines.push(
        "الأب الجديد: " + (p.new_parent_name || p.new_parent_person_id)
      );
    } else if (p.operation === OPERATION_CITY) {
      lines.push("طلب تصحيح مدينة/قرية");
      lines.push("العملية: " + OPERATION_CITY);
      lines.push("الشخص: " + (p.person_name || p.person_id));
      if (p.city_old) lines.push("المدينة الحالية: " + p.city_old);
      if (p.city_new) lines.push("المدينة الجديدة: " + p.city_new);
      if (p.area_old) lines.push("الحي/القرية الحالي: " + p.area_old);
      if (p.area_new) lines.push("الحي/القرية الجديد: " + p.area_new);
    } else {
      lines.push("طلب تصحيح");
      lines.push("العملية: " + (p.operation || "—"));
    }
    if (p.branch_key) lines.push("الفرع: " + p.branch_key);
    if (p.notes) lines.push("ملاحظة: " + p.notes);
    lines.push("الشخص المعدّل: " + (p.person_name || p.person_id || "—"));
    if (p.path) lines.push("مسار الشخص المعدّل: " + p.path);
    if (p.requester_name || (p.submitter && p.submitter.name)) {
      lines.push(
        "المرسل: " + text(p.requester_name || (p.submitter && p.submitter.name))
      );
    }
    if (p.requester_phone || (p.submitter && p.submitter.phone)) {
      lines.push(
        "جوال المرسل: " +
          text(p.requester_phone || (p.submitter && p.submitter.phone))
      );
    }
    if (p.operation === OPERATION_PHONE && p.phone_new) {
      lines.push("جوال الشخص المعدّل (الجديد): " + p.phone_new);
    }
    lines.push("");
    lines.push(MARKER);
    lines.push(JSON.stringify(p, null, 2));
    return lines.join("\n");
  }

  function assertCreatablePersonCorrection(messageOrPayload, row) {
    var parsed;
    if (typeof messageOrPayload === "string") {
      parsed = parseCorrectionMessage(messageOrPayload, row);
    } else {
      var validated = validatePersonCorrectionPayload(messageOrPayload, row);
      parsed = {
        ok: validated.ok,
        operation: text((messageOrPayload && messageOrPayload.operation) || ""),
        review_state: validated.review_state,
        reasons: validated.reasons,
        payload: validated.payload,
        creatable: validated.creatable,
        ready: validated.ready,
      };
    }
    if (!parsed || PERSON_OPS.indexOf(parsed.operation) < 0) {
      return {
        ok: false,
        code: "PERSON_OPERATION_REQUIRED",
        message_ar:
          "طلب التصحيح يجب أن يحمل عملية مدعومة (اسم/جوال/ميلاد/أب/مدينة)",
      };
    }
    if (!parsed.creatable && parsed.reasons && parsed.reasons.length) {
      return {
        ok: false,
        code: "PERSON_PAYLOAD_INVALID",
        message_ar: parsed.reasons[0] || "حمولة تصحيح الشخص غير صالحة",
        reasons: parsed.reasons,
      };
    }
    var message =
      typeof messageOrPayload === "string"
        ? messageOrPayload
        : serializePersonCorrectionMessage(parsed.payload, row);
    return {
      ok: true,
      code: "",
      message_ar: "",
      message: message,
      payload: parsed.payload,
      review_state: parsed.review_state,
      operation: parsed.operation,
    };
  }

  function buildPersonCorrectionPreview(payload) {
    var p = normalizePersonCorrectionPayload(payload);
    if (p.operation === OPERATION_NAME) {
      return {
        changes: [
          "الاسم: «" + (p.name_old || "—") + "» → «" + p.name_new + "»",
          "المسار سيتحدّث ليعكس الاسم الجديد تحت نفس الأب",
        ],
        unchanged: [
          "الهوية",
          "الأب",
          "الجوال",
          "تاريخ الميلاد",
          "ترتيب الميلاد",
          "أبناء هذا الشخص (لا تُحدَّث مساراتهم تلقائيًا)",
        ],
      };
    }
    if (p.operation === OPERATION_PHONE) {
      return {
        changes: [
          "الجوال: «" + (p.phone_old || "—") + "» → «" + p.phone_new + "»",
        ],
        unchanged: ["الاسم", "الأب", "الترتيب", "تاريخ الميلاد", "الهوية"],
      };
    }
    if (p.operation === OPERATION_BIRTH) {
      return {
        changes: [
          "تاريخ الميلاد: «" +
            (p.birth_date_old || "—") +
            "» → «" +
            p.birth_date_new +
            "»",
        ],
        unchanged: ["الاسم", "الأب", "الجوال", "الترتيب", "الهوية"],
      };
    }
    if (p.operation === OPERATION_PARENT) {
      return {
        changes: [
          "الأب: «" +
            (p.old_parent_name || p.old_parent_person_id || "—") +
            "» → «" +
            (p.new_parent_name || p.new_parent_person_id) +
            "»",
          "مسار الشخص سيتحدّث تحت الأب الجديد",
        ],
        unchanged: [
          "الاسم (الورقة)",
          "الجوال",
          "تاريخ الميلاد",
          "الهوية",
          "أبناء هذا الشخص (مساراتهم لا تُحدَّث تلقائيًا)",
        ],
      };
    }
    if (p.operation === OPERATION_CITY) {
      var changes = [];
      if (p.city_new) {
        changes.push(
          "المدينة: «" + (p.city_old || "—") + "» → «" + p.city_new + "»"
        );
      }
      if (p.area_new) {
        changes.push(
          "الحي/القرية: «" + (p.area_old || "—") + "» → «" + p.area_new + "»"
        );
      }
      return {
        changes: changes,
        unchanged: ["الاسم", "الأب", "الجوال", "تاريخ الميلاد", "الترتيب", "الهوية"],
      };
    }
    return { changes: [], unchanged: [] };
  }

  function routeRequest(row) {
    var kind = text(row && row.kind);
    var message = String((row && row.message) || "");
    var legacy = classifyLegacyCorrection(row);
    if (legacy.route === "reorder_children") {
      return {
        route: "reorder_children",
        open: "reorder_editor",
        blockTreeCardApply: true,
        blockTreeCardEditor: true,
        label: legacy.label || "ترتيب أبناء",
        review_state: legacy.review_state,
        reasons: legacy.reasons,
        payload: legacy.payload,
        operation: OPERATION_REORDER,
      };
    }
    if (legacy.route === "safe_review" || legacy.safeReview) {
      return {
        route: "safe_review",
        open: "safe_review",
        blockTreeCardApply: true,
        blockTreeCardEditor: true,
        label: legacy.label || "مراجعة آمنة",
        review_state: "needs_review",
        reasons: legacy.reasons,
        payload: legacy.payload,
        operation: legacy.operation || "",
        isLegacy: true,
        isMisclassifiedTreeCard: !!legacy.isMisclassifiedTreeCard,
      };
    }

    var parsed = parseCorrectionMessage(message, row);
    if (parsed.operation === OPERATION_REORDER) {
      return {
        route: "reorder_children",
        open: "reorder_editor",
        blockTreeCardApply: true,
        blockTreeCardEditor: true,
        label: "ترتيب أبناء",
        review_state: parsed.review_state,
        reasons: parsed.reasons,
        payload: parsed.payload,
        operation: OPERATION_REORDER,
      };
    }
    if (parsed.operation === OPERATION_NAME) {
      return {
        route: "name_correction",
        open: "name_editor",
        blockTreeCardApply: true,
        blockTreeCardEditor: true,
        label: "تصحيح اسم",
        review_state: parsed.review_state,
        reasons: parsed.reasons,
        payload: parsed.payload,
        operation: OPERATION_NAME,
      };
    }
    if (parsed.operation === OPERATION_PHONE) {
      return {
        route: "phone_correction",
        open: "phone_editor",
        blockTreeCardApply: true,
        blockTreeCardEditor: true,
        label: "تصحيح جوال",
        review_state: parsed.review_state,
        reasons: parsed.reasons,
        payload: parsed.payload,
        operation: OPERATION_PHONE,
      };
    }
    if (parsed.operation === OPERATION_BIRTH) {
      return {
        route: "birth_date_correction",
        open: "birth_editor",
        blockTreeCardApply: true,
        blockTreeCardEditor: true,
        label: "تصحيح ميلاد",
        review_state: parsed.review_state,
        reasons: parsed.reasons,
        payload: parsed.payload,
        operation: OPERATION_BIRTH,
      };
    }
    if (parsed.operation === OPERATION_PARENT) {
      return {
        route: "parent_change",
        open: "parent_editor",
        blockTreeCardApply: true,
        blockTreeCardEditor: true,
        label: "تصحيح أب",
        review_state: parsed.review_state,
        reasons: parsed.reasons,
        payload: parsed.payload,
        operation: OPERATION_PARENT,
      };
    }
    if (parsed.operation === OPERATION_CITY) {
      return {
        route: "city_correction",
        open: "city_editor",
        blockTreeCardApply: true,
        blockTreeCardEditor: true,
        label: "تصحيح مدينة",
        review_state: parsed.review_state,
        reasons: parsed.reasons,
        payload: parsed.payload,
        operation: OPERATION_CITY,
      };
    }

    if (kind === "tree_card") {
      return {
        route: "tree_card",
        open: "tree_card_editor",
        blockTreeCardApply: false,
        blockTreeCardEditor: false,
        label: "إضافة فرد",
        review_state: "",
        reasons: [],
        payload: null,
        operation: "add_person",
      };
    }

    if (kind === KIND_EDIT) {
      return {
        route: "tree_edit",
        open: "branch_or_manual",
        blockTreeCardApply: true,
        blockTreeCardEditor: true,
        label: "تصحيح بيانات",
        review_state: "",
        reasons: [],
        payload: null,
        operation: "",
      };
    }

    return {
      route: "other",
      open: "",
      blockTreeCardApply: false,
      blockTreeCardEditor: false,
      label: "",
      review_state: "",
      reasons: [],
      payload: null,
      operation: "",
    };
  }

  function assessReorderQuality(row) {
    var routed = routeRequest(row);
    if (routed.route === "safe_review") {
      return {
        key: "review",
        label: "يحتاج مراجعة",
        reason: (routed.reasons && routed.reasons[0]) || "مراجعة آمنة لطلب قديم/غامض.",
        level: "needs_review",
        route: routed.route,
      };
    }
    if (routed.route === "reorder_children") {
      if (routed.review_state === "ready") {
        return {
          key: "complete",
          label: "مكتمل",
          reason: "ترتيب أبناء جاهز بالهويات.",
          level: "ready",
          route: routed.route,
        };
      }
      return {
        key: "review",
        label: "يحتاج مراجعة",
        reason:
          (routed.reasons && routed.reasons[0]) ||
          "ترتيب أبناء يحتاج مطابقة قبل الحفظ.",
        level: "needs_review",
        route: routed.route,
      };
    }
    if (
      routed.route === "name_correction" ||
      routed.route === "phone_correction" ||
      routed.route === "birth_date_correction" ||
      routed.route === "parent_change"
    ) {
      if (routed.review_state === "ready") {
        return {
          key: "complete",
          label: "مكتمل",
          reason: routed.label + " جاهز بالهوية.",
          level: "ready",
          route: routed.route,
        };
      }
      return {
        key: "review",
        label: "يحتاج مراجعة",
        reason: (routed.reasons && routed.reasons[0]) || "تصحيح شخص يحتاج مراجعة.",
        level: "needs_review",
        route: routed.route,
      };
    }
    return null;
  }

  return {
    SCHEMA: SCHEMA,
    SCHEMA_VERSION: SCHEMA_VERSION,
    MARKER: MARKER,
    OPERATION_REORDER: OPERATION_REORDER,
    OPERATION_NAME: OPERATION_NAME,
    OPERATION_PHONE: OPERATION_PHONE,
    OPERATION_BIRTH: OPERATION_BIRTH,
    OPERATION_PARENT: OPERATION_PARENT,
    OPERATION_CITY: OPERATION_CITY,
    KIND_EDIT: KIND_EDIT,
    text: text,
    leafName: leafName,
    normalizeMatchKey: normalizeMatchKey,
    matchKeysForRequestName: matchKeysForRequestName,
    extractReorderCandidateNames: extractReorderCandidateNames,
    parseLegacyCorrectionRecovery: parseLegacyCorrectionRecovery,
    assessMatchLevel: assessMatchLevel,
    extractJsonFromMessage: extractJsonFromMessage,
    normalizeReorderPayload: normalizeReorderPayload,
    validateReorderPayload: validateReorderPayload,
    serializeReorderMessage: serializeReorderMessage,
    parseCorrectionMessage: parseCorrectionMessage,
    assertCreatableReorder: assertCreatableReorder,
    splitCorrectionIdentities: splitCorrectionIdentities,
    normalizePersonCorrectionPayload: normalizePersonCorrectionPayload,
    validatePersonCorrectionPayload: validatePersonCorrectionPayload,
    serializePersonCorrectionMessage: serializePersonCorrectionMessage,
    assertCreatablePersonCorrection: assertCreatablePersonCorrection,
    buildPersonCorrectionPreview: buildPersonCorrectionPreview,
    matchChildrenToTree: matchChildrenToTree,
    buildReorderPreview: buildReorderPreview,
    verifyCanonicalBirthOrder: verifyCanonicalBirthOrder,
    classifyLegacyCorrection: classifyLegacyCorrection,
    routeRequest: routeRequest,
    assessReorderQuality: assessReorderQuality,
    isLegacyMobileCorrectionPhrase: isLegacyMobileCorrectionPhrase,
    looksLikeReorderFreeText: looksLikeReorderFreeText,
  };
});
