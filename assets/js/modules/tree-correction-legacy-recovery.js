/**
 * Legacy correction recovery parser (independent of tree_card / modern envelopes).
 *
 * Purpose: recover operation intent + match-input targets from raw historical
 * approval_requests.message text — without inventing person_id.
 *
 * Browser: window.AlzidanTreeCorrectionLegacyRecovery
 * Node: module.exports
 */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.AlzidanTreeCorrectionLegacyRecovery = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var ARABIC_DIGITS = {
    "٠": "0",
    "٠": "0",
    "١": "1",
    "٢": "2",
    "٣": "3",
    "٤": "4",
    "٥": "5",
    "٦": "6",
    "٧": "7",
    "٨": "8",
    "٩": "9",
  };

  // Eastern Arabic-Indic (U+0660–U+0669) + some Persian forms already covered above.
  ARABIC_DIGITS["\u0660"] = "0";
  ARABIC_DIGITS["\u0661"] = "1";
  ARABIC_DIGITS["\u0662"] = "2";
  ARABIC_DIGITS["\u0663"] = "3";
  ARABIC_DIGITS["\u0664"] = "4";
  ARABIC_DIGITS["\u0665"] = "5";
  ARABIC_DIGITS["\u0666"] = "6";
  ARABIC_DIGITS["\u0667"] = "7";
  ARABIC_DIGITS["\u0668"] = "8";
  ARABIC_DIGITS["\u0669"] = "9";

  function text(v) {
    return String(v == null ? "" : v)
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeArabicDigits(raw) {
    return String(raw == null ? "" : raw).replace(
      /[\u0660-\u0669\u06F0-\u06F9]/g,
      function (ch) {
        var code = ch.charCodeAt(0);
        if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
        if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
        return ARABIC_DIGITS[ch] || ch;
      }
    );
  }

  function readLabeledValue(lines, labels) {
    var wanted = (Array.isArray(labels) ? labels : [labels]).map(text);
    for (var i = 0; i < lines.length; i++) {
      var line = text(lines[i]);
      for (var j = 0; j < wanted.length; j++) {
        var label = wanted[j];
        if (!label) continue;
        var prefix = label + ":";
        if (line.indexOf(prefix) === 0) return text(line.slice(prefix.length));
        // Arabic colon variant
        prefix = label + "：";
        if (line.indexOf(prefix) === 0) return text(line.slice(prefix.length));
      }
    }
    return "";
  }

  /**
   * Slice the raw message from «التصحيح المطلوب» until sender / next section.
   */
  function extractCorrectionRequiredBlock(message) {
    var raw = String(message || "");
    var startRe = /التصحيح\s*المطلوب\s*[:：]?\s*/i;
    var m = startRe.exec(raw);
    if (!m) {
      return { ok: false, block: "", reason: "missing_correction_required_label" };
    }
    var from = m.index + m[0].length;
    var rest = raw.slice(from);
    var endRe =
      /\n\s*(?:المرسل|الجوال|البريد|رقم الطلب|بيانات المرسل|العائلة)\s*[:：]/i;
    var end = rest.search(endRe);
    var block = end >= 0 ? rest.slice(0, end) : rest;
    block = String(block || "").trim();
    if (!block) {
      return { ok: false, block: "", reason: "empty_correction_required_block" };
    }
    return { ok: true, block: block, reason: "" };
  }

  /**
   * Parse one numbered target line: «١-عبدالرحمن عقلا» / «1) فايز» / «- فوزان»
   */
  function parseNumberedTargetLine(line) {
    var original = String(line == null ? "" : line);
    var normalized = normalizeArabicDigits(original);
    var t = text(normalized);
    if (!t) return null;

    var m =
      t.match(/^(?:[-•*]\s+)(.+)$/) ||
      t.match(/^(\d+)\s*[\).\-–:]\s*(.+)$/) ||
      t.match(/^(\d+)\s+(.+)$/);
    if (!m) return null;
    var name = text(m[m.length - 1] || "");
    var index =
      m.length === 3 && m[1] && /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : null;
    if (!name) return null;
    return { index: index, name: name, raw: text(original) };
  }

  function isMetaOrSenderName(name) {
    var n = text(name);
    if (!n) return true;
    if (
      /^(طلب|الفرع|العائلة|الأب|الجوال|البريد|المرسل|المسار|رقم|العملية|حالة|ترتيب(?:\s+ال(?:اسماء|أسماء|أبناء))?)/.test(
        n
      )
    ) {
      return true;
    }
    if (/ترتيب\s+ال(?:اسماء|أسماء)/.test(n)) return true;
    if (/بالترتيب\s+الصحيح/.test(n)) return true;
    return false;
  }

  function detectOperationHint(message, pathHint, targets) {
    var msg = String(message || "");
    var path = text(pathHint);
    if (
      /ترتيب|رتّب|رتب الأبناء|بالترتيب\s+الصحيح|birth_order/.test(msg) ||
      /ترتيب/.test(path)
    ) {
      if (targets && targets.length >= 2) return "reorder_children";
      return "reorder_children";
    }
    if (/أب\s*خطأ|تغيير\s*الأب|نقل\s*تحت/.test(msg)) return "parent_change";
    if (/جوال|رقم\s*الجوال|هاتف/.test(msg)) return "phone_correction";
    return "";
  }

  /**
   * Main entry: recover structured correction intent from legacy raw message.
   */
  function parseLegacyCorrectionRecovery(message) {
    var raw = String(message == null ? "" : message);
    var debug = [];
    var lines = raw.split(/\r?\n/);

    var branch = readLabeledValue(lines, ["الفرع", "العائلة", "العائلة (إجباري)"]);
    var pathHint = readLabeledValue(lines, [
      "الاسم/المسار",
      "الاسم / المسار",
      "المسار",
    ]);
    var sender = readLabeledValue(lines, ["المرسل", "اسم المرسل", "الاسم"]);
    // Prefer explicit المرسل label over generic الاسم
    var senderExplicit = readLabeledValue(lines, ["المرسل", "اسم المرسل"]);
    if (senderExplicit) sender = senderExplicit;

    debug.push("branch=" + (branch || "—"));
    debug.push("path_hint=" + (pathHint || "—"));
    debug.push("sender=" + (sender || "—"));

    var blockRes = extractCorrectionRequiredBlock(raw);
    var targets = [];
    var seen = {};
    var parseNotes = [];

    function pushTarget(name, source) {
      var cleaned = text(name);
      if (!cleaned || isMetaOrSenderName(cleaned)) {
        parseNotes.push("skipped:" + source + ":" + cleaned);
        return false;
      }
      // Never invent ids; names are match inputs only.
      var key = cleaned
        .replace(/[أإآٱ]/g, "ا")
        .replace(/ة/g, "ه")
        .replace(/ى/g, "ي")
        .toLowerCase();
      if (seen[key]) {
        parseNotes.push("dup:" + cleaned);
        return false;
      }
      // Sender is requester, not a target — skip if identical to sender and already have others
      // Always skip exact sender match when we have an explicit sender label.
      if (senderExplicit && key === senderExplicit.replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").toLowerCase()) {
        // Still allow if this name appears as a numbered target BEFORE we decide —
        // for reorder lists the sender often IS also in the list (عبدالرحمن).
        // So: do NOT skip numbered targets that equal sender.
        if (source === "sender_field") {
          parseNotes.push("skipped_sender_field");
          return false;
        }
      }
      seen[key] = true;
      targets.push(cleaned);
      parseNotes.push("ok:" + source + ":" + cleaned);
      return true;
    }

    if (!blockRes.ok) {
      debug.push("block_fail=" + blockRes.reason);
      // Fallback: scan all lines for numbered targets
      lines.forEach(function (line) {
        var parsed = parseNumberedTargetLine(line);
        if (parsed) pushTarget(parsed.name, "line_scan");
      });
    } else {
      debug.push("block_ok=1");
      debug.push("block_preview=" + text(blockRes.block).slice(0, 80));
      var blockLines = String(blockRes.block).split(/\r?\n/);
      // First line may be «١-عبدالرحمن عقلا» immediately after label (same line consumed into block)
      blockLines.forEach(function (line) {
        var parsed = parseNumberedTargetLine(line);
        if (parsed) {
          pushTarget(parsed.name, "numbered");
          return;
        }
        var t = text(normalizeArabicDigits(line));
        if (!t) return;
        // «ترتيب الأبناء عبدالرحمن ثم فايز…» on one line
        t = t.replace(/^ترتيب(?:\s+ال(?:أبناء|اسماء|أسماء))?\s*/i, "");
        if (/ثم|,|،/.test(t)) {
          t.split(/\s*(?:ثم|,|،)\s*/).forEach(function (part) {
            var chunk = text(part);
            var p2 = parseNumberedTargetLine(chunk);
            if (p2 && p2.name) {
              pushTarget(p2.name, "inline_list");
              return;
            }
            chunk = text(
              chunk.replace(/^ترتيب(?:\s+ال(?:أبناء|اسماء|أسماء))?\s*/i, "")
            );
            if (chunk) pushTarget(chunk, "inline_list");
          });
        }
      });
    }

    var operation = detectOperationHint(raw, pathHint, targets);
    debug.push("targets_count=" + targets.length);
    debug.push("operation=" + (operation || "—"));

    var ok = targets.length >= 2;
    var reasons = [];
    if (!ok) {
      if (!blockRes.ok) {
        reasons.push(
          "تعذر قطع كتلة «التصحيح المطلوب» (" + blockRes.reason + ")."
        );
      } else if (targets.length === 0) {
        reasons.push(
          "وُجدت كتلة التصحيح المطلوب لكن لم تُستخرج أسماء مرقّمة. تحقق من الترقيم العربي/الإنجليزي."
        );
      } else {
        reasons.push(
          "استُخرج اسم واحد فقط — يلزم اثنان على الأقل لعملية ترتيب."
        );
      }
      reasons.push("تفاصيل الاستخراج: " + debug.join(" | "));
    }

    return {
      ok: ok,
      operation: operation,
      branch_key: branch,
      path_hint: pathHint,
      sender_name: senderExplicit || sender,
      targets: targets,
      ordered_children: targets.map(function (n, i) {
        return {
          person_id: "",
          name: n,
          match_name: n,
          position: i + 1,
        };
      }),
      extract_debug: debug,
      parse_notes: parseNotes,
      reasons: reasons,
      message_ar: ok
        ? "تم استخراج " + targets.length + " أهداف من الرسالة الخام."
        : reasons[0] || "فشل استخراج أهداف التصحيح من الرسالة الخام.",
    };
  }

  function extractReorderCandidateNames(message) {
    var parsed = parseLegacyCorrectionRecovery(message);
    return parsed.targets || [];
  }

  return {
    normalizeArabicDigits: normalizeArabicDigits,
    extractCorrectionRequiredBlock: extractCorrectionRequiredBlock,
    parseNumberedTargetLine: parseNumberedTargetLine,
    parseLegacyCorrectionRecovery: parseLegacyCorrectionRecovery,
    extractReorderCandidateNames: extractReorderCandidateNames,
  };
});
