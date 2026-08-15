/**
 * Canonical contract for approval_requests.kind = tree_card.
 *
 * message → parse → normalize → validate → serialize
 *
 * Browser: window.AlzidanTreeCardContract
 * Node tests: module.exports
 */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.AlzidanTreeCardContract = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var SCHEMA = "tree_card.v1";
  var SCHEMA_VERSION = 1;
  var MARKER = "__JSON__:";

  function text(v) {
    return String(v == null ? "" : v)
      .replace(/\s+/g, " ")
      .trim();
  }

  function asArray(v) {
    return Array.isArray(v) ? v : [];
  }

  function leafName(path) {
    var parts = text(path)
      .split("/")
      .map(text)
      .filter(Boolean);
    return parts.length ? parts[parts.length - 1] : "";
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

  function readLineValue(lines, labels) {
    var wanted = (Array.isArray(labels) ? labels : [labels]).map(text);
    for (var i = 0; i < lines.length; i++) {
      var line = text(lines[i]);
      for (var j = 0; j < wanted.length; j++) {
        var label = wanted[j];
        if (!label) continue;
        var prefix = label + ":";
        if (line.indexOf(prefix) === 0) return text(line.slice(prefix.length));
      }
    }
    return "";
  }

  function parseAncestorLines(visible) {
    var lines = String(visible || "").split(/\r?\n/);
    var ancestors = [];
    var lineage = [];
    var inLineage = false;
    var inAncestors = false;
    for (var i = 0; i < lines.length; i++) {
      var raw = String(lines[i] || "");
      var line = text(raw);
      if (!line) {
        inLineage = false;
        inAncestors = false;
        continue;
      }
      if (/^مسار النسب/.test(line) || /^سلسلة السياق/.test(line)) {
        inLineage = true;
        inAncestors = false;
        continue;
      }
      if (/^سلسلة الأجداد/.test(line)) {
        inAncestors = true;
        inLineage = false;
        continue;
      }
      var gf = line.match(/^الجد\s*(\d+)\s*(?:\(إجباري\))?\s*:\s*(.+)$/);
      if (gf) {
        ancestors[Number(gf[1]) - 1] = text(gf[2]);
        continue;
      }
      if (inLineage) {
        var numbered = line.match(/^\d+\s*[-–.]\s*(.+)$/);
        if (numbered) {
          lineage.push(text(numbered[1]));
          continue;
        }
        if (/^(الأب|الاسم|العائلة|بيانات|الأبناء)/.test(line)) {
          inLineage = false;
        } else if (line.indexOf(":") < 0) {
          lineage.push(line);
        }
      }
      if (inAncestors) {
        var numberedA = line.match(/^\d+\s*[-–.]\s*(.+)$/);
        if (numberedA) ancestors.push(text(numberedA[1]));
        else if (/^(الأب|الاسم|العائلة|بيانات)/.test(line)) inAncestors = false;
      }
      var ctx = line.match(/^\s*\d+\s*-\s*(.+)$/);
      if (ctx && /سلسلة السياق/.test(String(lines[Math.max(0, i - 8)] || ""))) {
        /* handled via inLineage when header seen */
      }
    }
    return {
      ancestors: ancestors.filter(Boolean),
      lineage_path: lineage.filter(Boolean),
    };
  }

  function parseRelationLines(visible) {
    var lines = String(visible || "").split(/\r?\n/);
    var rows = [];
    var inBlock = false;
    for (var i = 0; i < lines.length; i++) {
      var line = text(lines[i]);
      if (/^العلاقات العائلية/.test(line)) {
        inBlock = true;
        continue;
      }
      if (!inBlock) continue;
      if (/^(الأب|الاسم|العائلة|بيانات|الأبناء|__JSON__)/.test(line)) break;
      var m = line.match(/^\d+\s*[-–.]\s*(.+?)\s*←\s*(.+?)(?:\s*—\s*(.+))?$/);
      if (!m) continue;
      rows.push({
        parent_name: text(m[1]),
        child_name: text(m[2]),
        birth_date_g: text(m[3] || ""),
      });
    }
    return rows;
  }

  function parseChildrenBlock(visible) {
    var lines = String(visible || "").split(/\r?\n/);
    var children = [];
    var inBlock = false;
    for (var i = 0; i < lines.length; i++) {
      var line = text(lines[i]);
      if (/^الأبناء/.test(line)) {
        inBlock = true;
        continue;
      }
      if (!inBlock) continue;
      if (/^(بيانات المرسل|__JSON__|العائلة)/.test(line)) break;
      if (line === "(لا يوجد)") continue;
      var m = line.match(
        /^\d+\s*[-–.]\s*الاسم\s*:\s*(.*?)\s*(?:—|-)\s*تاريخ الميلاد\s*:\s*(.*)$/,
      );
      if (m) {
        var name = text(m[1]);
        if (name) children.push({ name: name, dob: text(m[2]) });
      }
    }
    return children;
  }

  function reconstructFromVisibleText(message, row) {
    var raw = String(message || "");
    var markerIdx = raw.indexOf(MARKER);
    var visible = markerIdx >= 0 ? raw.slice(0, markerIdx) : raw;
    var lines = visible.split(/\r?\n/);
    var recovered = [];
    var needs = [];

    var branch =
      readLineValue(lines, ["العائلة (إجباري)", "العائلة"]) ||
      text(row && row.branch_key) ||
      "";
    if (branch.indexOf("/") >= 0) {
      // template sometimes lists options "زيدان / مزيد / ..."
      var first = branch.split("/")[0];
      if (/زيدان|مزيد|زايد|لاحم|ملحم/.test(text(first))) branch = text(first);
    }
    if (branch) recovered.push("branch_key");
    else needs.push("branch_key");

    var father =
      readLineValue(lines, ["الأب (إجباري)", "الأب / السياق", "الأب"]) || "";
    if (father) recovered.push("father");
    else needs.push("father");

    var name =
      readLineValue(lines, ["الاسم (إجباري)", "الاسم"]) ||
      text(row && row.name) ||
      "";
    // Prefer person name over submitter: if line is under "بيانات المرسل" skip.
    var personLine = "";
    for (var i = 0; i < lines.length; i++) {
      var L = text(lines[i]);
      if (/^بيانات المرسل/.test(L)) break;
      if (/^الاسم(?:\s*\(إجباري\))?\s*:/.test(L)) {
        personLine = text(L.replace(/^الاسم(?:\s*\(إجباري\))?\s*:/, ""));
      }
    }
    if (personLine) name = personLine;
    if (name) recovered.push("name");
    else needs.push("name");

    var dob = readLineValue(lines, [
      "تاريخ الميلاد (اختياري)",
      "تاريخ الميلاد",
    ]);
    if (dob) recovered.push("birth_date_g");

    var city = readLineValue(lines, ["المدينة (اختياري)", "المدينة"]);
    if (city) recovered.push("city");
    var area = readLineValue(lines, ["الحي/القرية (اختياري)", "الحي/القرية"]);
    if (area) recovered.push("area");

    var anc = parseAncestorLines(visible);
    if (anc.ancestors.length) recovered.push("ancestors");
    if (anc.lineage_path.length) recovered.push("lineage_path");

    var treeRows = parseRelationLines(visible);
    if (treeRows.length) recovered.push("tree_rows");

    var children = parseChildrenBlock(visible);
    if (children.length) recovered.push("children");

    var submitterName = "";
    var submitterPhone = text(row && row.phone) || "";
    var submitterEmail = text(row && row.email) || "";
    var inSubmitter = false;
    for (var s = 0; s < lines.length; s++) {
      var sl = text(lines[s]);
      if (/^بيانات المرسل/.test(sl)) {
        inSubmitter = true;
        continue;
      }
      if (!inSubmitter) continue;
      if (sl.indexOf("__JSON__") === 0) break;
      if (/^الاسم\s*:/.test(sl)) submitterName = text(sl.replace(/^الاسم\s*:/, ""));
      if (/^الجوال\s*:/.test(sl))
        submitterPhone = text(sl.replace(/^الجوال\s*:/, "")) || submitterPhone;
      if (/^البريد/.test(sl))
        submitterEmail = text(sl.replace(/^البريد(?:\s*\(اختياري\))?\s*:/, "")) ||
          submitterEmail;
    }
    if (!submitterName) submitterName = text(row && row.name) || "";
    if (submitterName || submitterPhone) recovered.push("submitter");

    var parentPath = "";
    if (anc.lineage_path.length >= 2) {
      parentPath = anc.lineage_path.slice(0, -1).join("/");
      if (!father) father = leafName(anc.lineage_path[anc.lineage_path.length - 2] || "");
    }

    var payload = {
      v: SCHEMA_VERSION,
      schema: SCHEMA,
      kind: "tree_card",
      branch_key: branch,
      father: father,
      father_path: parentPath,
      parent_path: parentPath,
      parent_node_id: parentPath,
      name: name,
      birth_date_g: dob,
      city: city,
      area: area,
      grandfather: anc.ancestors[0] || "",
      ancestors: anc.ancestors,
      lineage_path: anc.lineage_path,
      tree_rows: treeRows,
      children: children,
      father_person_id: "",
      parent_person_id: "",
      selected_parent_person_id: "",
      submitter: {
        name: submitterName,
        phone: submitterPhone,
        email: submitterEmail,
      },
      created_at: text(row && row.created_at) || "",
      recovery: {
        mode: "visible_text",
        fields_recovered: recovered,
        needs_review_fields: needs,
      },
    };

    var usable = !!(branch && (name || father || treeRows.length));
    return {
      ok: usable,
      payload: usable ? payload : null,
      recovered: recovered,
      needs_review_fields: needs,
      reason: usable
        ? "تمت الاستعادة من النص الظاهر (بدون اختراع معرفات)."
        : "النص الظاهر لا يكفي لبناء حمولة قابلة للتعديل.",
    };
  }

  function normalizeTreeCardPayload(input, opts) {
    var src = input && typeof input === "object" ? input : {};
    var options = opts || {};
    var row = options.row || {};
    var submitterSrc =
      src.submitter && typeof src.submitter === "object" ? src.submitter : {};

    var fatherPersonId = text(
      src.father_person_id ||
        src.parent_person_id ||
        src.selected_parent_person_id ||
        "",
    );
    var fatherPath = text(
      src.father_path || src.parent_path || src.parent_node_id || "",
    );
    var father = text(src.father || leafName(fatherPath) || "");
    var ancestors = asArray(src.ancestors)
      .map(text)
      .filter(Boolean);
    if (!ancestors.length) {
      ancestors = [
        src.grandfather,
        src.grandfather2,
        src.grandfather3,
        src.grandfather4,
      ]
        .map(text)
        .filter(Boolean);
    }

    var children = asArray(src.children)
      .map(function (c) {
        if (!c || typeof c !== "object") return null;
        var n = text(c.name || c.child_name || "");
        if (!n) return null;
        return { name: n, dob: text(c.dob || c.birth_date_g || "") };
      })
      .filter(Boolean);

    var treeRows = asArray(src.tree_rows)
      .map(function (r) {
        if (!r || typeof r !== "object") return null;
        var parent = text(r.parent_name || r.parent || "");
        var child = text(r.child_name || r.name || r.child || "");
        if (!parent || !child) return null;
        var out = {
          parent_name: parent,
          child_name: child,
          birth_date_g: text(r.birth_date_g || ""),
        };
        var ppid = text(r.parent_person_id || "");
        if (ppid) out.parent_person_id = ppid;
        return out;
      })
      .filter(Boolean);

    var lineage = asArray(src.lineage_path).map(text).filter(Boolean);

    var out = {
      v: Number(src.v) > 0 ? Number(src.v) : SCHEMA_VERSION,
      schema: text(src.schema) || SCHEMA,
      kind: "tree_card",
      branch_key: text(src.branch_key || row.branch_key || ""),
      name: text(src.name || ""),
      father: father,
      father_path: fatherPath,
      parent_path: text(src.parent_path || fatherPath),
      parent_node_id: text(src.parent_node_id || fatherPath),
      father_person_id: fatherPersonId,
      parent_person_id: fatherPersonId,
      selected_parent_person_id: fatherPersonId,
      grandfather: text(src.grandfather || ancestors[0] || ""),
      grandfather2: text(src.grandfather2 || ancestors[1] || ""),
      grandfather3: text(src.grandfather3 || ancestors[2] || ""),
      grandfather4: text(src.grandfather4 || ancestors[3] || ""),
      ancestors: ancestors,
      lineage_path: lineage,
      tree_rows: treeRows,
      children: children,
      birth_date_g: text(src.birth_date_g || ""),
      city: text(src.city || ""),
      area: text(src.area || ""),
      gender: text(src.gender || ""),
      submitter: {
        name: text(submitterSrc.name || row.name || ""),
        phone: text(submitterSrc.phone || row.phone || ""),
        email: text(submitterSrc.email || row.email || ""),
      },
      created_at: text(src.created_at || row.created_at || ""),
    };

    if (src.rx) out.rx = src.rx;
    if (src.admin_corrected_at) out.admin_corrected_at = text(src.admin_corrected_at);
    if (src.recovery && typeof src.recovery === "object") out.recovery = src.recovery;
    if (options.recoveryMeta && typeof options.recoveryMeta === "object") {
      out.recovery = Object.assign({}, out.recovery || {}, options.recoveryMeta);
    }
    return out;
  }

  function validateTreeCardPayload(payload, opts) {
    var p = payload && typeof payload === "object" ? payload : null;
    var options = opts || {};
    var reasons = [];
    var needsReview = [];

    if (!p) {
      return {
        ok: false,
        level: "invalid",
        reasons: ["لا توجد حمولة بعد التحليل."],
        needs_review: ["payload"],
      };
    }

    if (text(p.kind) && text(p.kind) !== "tree_card") {
      reasons.push("kind غير متوافق: " + text(p.kind));
    }
    if (!text(p.branch_key)) {
      reasons.push("الفرع غير محدد.");
      needsReview.push("branch_key");
    }
    if (!text(p.name) && !asArray(p.tree_rows).length) {
      reasons.push("الاسم غير محدد.");
      needsReview.push("name");
    }
    if (
      !text(p.father) &&
      !text(p.father_path) &&
      !text(p.parent_person_id) &&
      !asArray(p.tree_rows).length
    ) {
      reasons.push("الأب غير محدد.");
      needsReview.push("father");
    }
    if (!Array.isArray(p.children)) needsReview.push("children");
    if (!Array.isArray(p.ancestors)) needsReview.push("ancestors");
    if (!Array.isArray(p.tree_rows)) needsReview.push("tree_rows");

    if (
      options.requireParentPersonId &&
      !text(p.parent_person_id || p.father_person_id)
    ) {
      reasons.push("parent_person_id غير محسوم.");
      needsReview.push("parent_person_id");
    }

    var recoverable = !!(p.recovery && p.recovery.mode);
    var hasCore = !!(text(p.branch_key) && (text(p.name) || asArray(p.tree_rows).length));
    var parentOk = !!(
      text(p.parent_person_id) ||
      text(p.father_path) ||
      text(p.father) ||
      asArray(p.tree_rows).length
    );

    var level;
    if (!hasCore) level = "invalid";
    else if (needsReview.length && !parentOk) level = "needs_review";
    else if (recoverable || needsReview.length) level = recoverable ? "recoverable" : "needs_review";
    else if (reasons.length) level = "needs_review";
    else level = "complete";

    return {
      ok: level === "complete" || level === "recoverable",
      level: level,
      reasons: reasons,
      needs_review: needsReview,
    };
  }

  function parseTreeCardRequestMessage(message, row) {
    var raw = message == null ? "" : String(message);
    var base = {
      ok: false,
      status: "invalid",
      hasMarker: false,
      jsonValid: false,
      parseError: "",
      schema: "",
      payload: null,
      recovery: null,
      reasons: [],
      raw: raw,
    };

    if (!text(raw)) {
      base.parseError = "empty_message";
      base.reasons = ["message فارغ."];
      var emptyShell = normalizeTreeCardPayload(
        {
          kind: "tree_card",
          branch_key: text(row && row.branch_key),
          name: "",
          submitter: {
            name: text(row && row.name),
            phone: text(row && row.phone),
            email: text(row && row.email),
          },
          created_at: text(row && row.created_at),
          recovery: {
            mode: "empty_shell",
            fields_recovered: [],
            needs_review_fields: ["name", "father", "branch_key"],
            prior_parse_error: "empty_message",
          },
        },
        { row: row },
      );
      base.payload = emptyShell;
      base.recovery = emptyShell.recovery;
      base.status = "needs_review";
      base.ok = true;
      return base;
    }

    var idx = raw.indexOf(MARKER);
    if (idx >= 0) {
      base.hasMarker = true;
      var jsonText = raw.slice(idx + MARKER.length).trim();
      if (!jsonText) {
        base.parseError = "marker_without_json";
        base.reasons = ["وُجد __JSON__: بدون محتوى."];
      } else {
        var parsed = safeParseJson(jsonText);
        if (parsed.ok && parsed.value && typeof parsed.value === "object") {
          base.jsonValid = true;
          base.parseError = parsed.error || "";
          var normalized = normalizeTreeCardPayload(parsed.value, { row: row });
          var validation = validateTreeCardPayload(normalized);
          base.payload = normalized;
          base.schema = normalized.schema || SCHEMA;
          base.status = validation.level;
          base.ok = validation.ok || validation.level === "needs_review";
          base.reasons = validation.reasons;
          return base;
        }
        base.parseError = parsed.error || "malformed_json";
        base.reasons = ["JSON تالف أو غير قابل للقراءة."];
      }
    } else {
      base.parseError = "no_marker";
      base.reasons = ["لا يوجد __JSON__: في الرسالة."];
    }

    var reconstructed = reconstructFromVisibleText(raw, row || {});
    if (reconstructed.ok && reconstructed.payload) {
      var norm = normalizeTreeCardPayload(reconstructed.payload, {
        row: row,
        recoveryMeta: {
          mode: "visible_text",
          fields_recovered: reconstructed.recovered || [],
          needs_review_fields: reconstructed.needs_review_fields || [],
          prior_parse_error: base.parseError,
        },
      });
      var val = validateTreeCardPayload(norm);
      base.payload = norm;
      base.recovery = norm.recovery || null;
      base.schema = SCHEMA;
      base.status = val.level === "complete" ? "recoverable" : val.level;
      base.ok = true;
      base.reasons = [reconstructed.reason].concat(val.reasons || []);
      return base;
    }

    // Last resort: open with row-level crumbs only (still no invented IDs).
    var crumb = normalizeTreeCardPayload(
      {
        kind: "tree_card",
        branch_key: text(row && row.branch_key),
        name: "",
        submitter: {
          name: text(row && row.name),
          phone: text(row && row.phone),
          email: text(row && row.email),
        },
        created_at: text(row && row.created_at),
        recovery: {
          mode: "empty_shell",
          fields_recovered: [],
          needs_review_fields: ["name", "father", "branch_key"],
          prior_parse_error: base.parseError,
        },
      },
      { row: row },
    );
    base.payload = crumb;
    base.recovery = crumb.recovery;
    base.status = "needs_review";
    base.ok = true; // editor may open in recovery; not creatable
    base.reasons = base.reasons.concat([
      reconstructed.reason || "تعذر الاستعادة من النص.",
    ]);
    return base;
  }

  function buildVisibleLines(payload, reqRow) {
    var p = normalizeTreeCardPayload(payload || {}, { row: reqRow });
    var ancestors = asArray(p.ancestors);
    var children = asArray(p.children);
    var treeRows = asArray(p.tree_rows);
    var lineage = asArray(p.lineage_path);
    var submitter = p.submitter || {};
    var lines = [
      "بطاقة إضافة بيانات للشجرة",
      "",
      "رقم الطلب: " + text(reqRow && reqRow.request_id),
      "العائلة (إجباري): " + text(p.branch_key),
    ];
    if (treeRows.length) {
      lines.push("العلاقات العائلية:");
      treeRows.forEach(function (relation, idx) {
        lines.push(
          String(idx + 1) +
            "- " +
            text(relation.parent_name) +
            " ← " +
            text(relation.child_name) +
            (relation.birth_date_g ? " — " + text(relation.birth_date_g) : ""),
        );
      });
    } else if (lineage.length) {
      lines.push("مسار النسب من الأكبر إلى الأصغر:");
      lineage.forEach(function (name, idx) {
        lines.push(String(idx + 1) + "- " + text(name));
      });
    } else if (ancestors.length) {
      lines.push("سلسلة الأجداد:");
      ancestors.forEach(function (name, idx) {
        lines.push("الجد " + String(idx + 1) + ": " + text(name));
      });
    }
    lines.push("الأب (إجباري): " + text(p.father));
    lines.push("الاسم (إجباري): " + text(p.name));
    lines.push("تاريخ الميلاد (اختياري): " + text(p.birth_date_g));
    lines.push("المدينة (اختياري): " + text(p.city));
    lines.push("الحي/القرية (اختياري): " + text(p.area));
    lines.push("", "الأبناء (اختياري):");
    if (children.length) {
      children.forEach(function (child, idx) {
        lines.push(
          String(idx + 1) +
            "- الاسم: " +
            text(child.name) +
            " — تاريخ الميلاد: " +
            text(child.dob),
        );
      });
    } else {
      lines.push("(لا يوجد)");
    }
    lines.push("", "بيانات المرسل (إجباري):");
    lines.push("الاسم: " + text(submitter.name));
    lines.push("الجوال: " + text(submitter.phone));
    lines.push("البريد (اختياري): " + text(submitter.email));
    lines.push(
      "التاريخ: " +
        text(p.created_at || (reqRow && reqRow.created_at) || new Date().toISOString()),
    );
    return lines;
  }

  function serializeTreeCardRequest(payload, reqRow) {
    var normalized = normalizeTreeCardPayload(payload || {}, { row: reqRow });
    // Persist recovery metadata only when still in recovery / needs review.
    var body = Object.assign({}, normalized);
    if (body.recovery && body.recovery.mode === "empty_shell") {
      /* keep */
    } else if (body.recovery && !asArray(body.recovery.needs_review_fields).length) {
      delete body.recovery;
    }
    var lines = buildVisibleLines(body, reqRow || {});
    lines.push("", MARKER);
    lines.push(JSON.stringify(body, null, 2));
    return lines.join("\n");
  }

  function assertCreatableEnvelope(message, row) {
    var parsed = parseTreeCardRequestMessage(message, row);
    if (!parsed.hasMarker || !parsed.jsonValid || !parsed.payload) {
      return {
        ok: false,
        code: "TREE_CARD_ENVELOPE_REQUIRED",
        message_ar:
          "طلب الشجرة يجب أن يحتوي __JSON__: صالحًا قبل الإرسال. أعد المحاولة من النموذج الرسمي.",
      };
    }
    var validation = validateTreeCardPayload(parsed.payload);
    if (validation.level === "invalid") {
      return {
        ok: false,
        code: "TREE_CARD_PAYLOAD_INVALID",
        message_ar: "بيانات بطاقة الشجرة غير مكتملة للإرسال.",
        reasons: validation.reasons,
      };
    }
    // Rewrite to canonical serialized form (idempotent for good payloads).
    return {
      ok: true,
      payload: parsed.payload,
      message: serializeTreeCardRequest(parsed.payload, row || {}),
    };
  }

  function assessRequestQuality(row) {
    var kind = text(row && row.kind);
    if (kind !== "tree_card") return null;
    var parsed = parseTreeCardRequestMessage(row && row.message, row);
    var labels = {
      complete: "مكتمل",
      recoverable: "قابل للاستعادة",
      needs_review: "يحتاج مراجعة",
      invalid: "غير صالح",
    };
    var level = parsed.status || "invalid";
    if (parsed.jsonValid && parsed.payload) {
      var v = validateTreeCardPayload(parsed.payload);
      level = v.level;
    } else if (parsed.recovery && parsed.payload) {
      level = parsed.status === "needs_review" ? "needs_review" : "recoverable";
    }
    var reason =
      (parsed.reasons && parsed.reasons[0]) ||
      (level === "complete"
        ? "طلب الشجرة يحتوي حمولة canonical صالحة."
        : level === "recoverable"
          ? "تمت/يمكن استعادة الحمولة من النص أو JSON الجزئي."
          : level === "needs_review"
            ? "الحمولة تحتاج مراجعة قبل الاعتماد."
            : "لا يمكن بناء حمولة صالحة من الرسالة.");
    return {
      key: level === "recoverable" ? "review" : level === "invalid" ? "missing" : level === "needs_review" ? "review" : "complete",
      level: level,
      label: labels[level] || level,
      reason: reason,
      parse: {
        hasMarker: parsed.hasMarker,
        jsonValid: parsed.jsonValid,
        parseError: parsed.parseError,
        schema: parsed.schema,
        recoveryMode: parsed.recovery && parsed.recovery.mode,
      },
    };
  }

  function formatAdminSourceDiagnostics(row) {
    var parsed = parseTreeCardRequestMessage(row && row.message, row);
    var q = assessRequestQuality(row) || {};
    var lines = [
      "— تشخيص إداري (tree_card) —",
      "parser_status: " + (parsed.status || ""),
      "has_marker: " + String(!!parsed.hasMarker),
      "json_valid: " + String(!!parsed.jsonValid),
      "parse_error: " + (parsed.parseError || "—"),
      "schema: " + (parsed.schema || "—"),
      "quality_level: " + (q.level || "—"),
      "recovery: " +
        (parsed.recovery && parsed.recovery.mode
          ? parsed.recovery.mode
          : "—"),
      "reasons: " + ((parsed.reasons || []).join(" | ") || "—"),
      "",
      "— الرسالة الخام —",
      String(row && row.message ? row.message : "(فارغ)"),
    ];
    return lines.join("\n");
  }

  return {
    SCHEMA: SCHEMA,
    SCHEMA_VERSION: SCHEMA_VERSION,
    MARKER: MARKER,
    text: text,
    parseTreeCardRequestMessage: parseTreeCardRequestMessage,
    normalizeTreeCardPayload: normalizeTreeCardPayload,
    validateTreeCardPayload: validateTreeCardPayload,
    serializeTreeCardRequest: serializeTreeCardRequest,
    assertCreatableEnvelope: assertCreatableEnvelope,
    assessRequestQuality: assessRequestQuality,
    formatAdminSourceDiagnostics: formatAdminSourceDiagnostics,
    reconstructFromVisibleText: reconstructFromVisibleText,
  };
});
