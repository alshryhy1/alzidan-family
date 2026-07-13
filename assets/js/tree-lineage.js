(function () {
  "use strict";

  function normalizeArabicDigitsToLatin(value) {
    return String(value || "")
      .replace(/[٠-٩]/g, function (digit) { return String(digit.charCodeAt(0) - 1632); })
      .replace(/[۰-۹]/g, function (digit) { return String(digit.charCodeAt(0) - 1776); });
  }

  function normalizeBatchText(v) {
    return normalizeArabicDigitsToLatin(String(v || ""))
      .replace(/[\u064B-\u065F\u0670]/g, "")
      .replace(/[إأآ]/g, "أ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function cleanBatchLine(v) {
    var s = normalizeBatchText(v);
    s = s.replace(/^(?:أرسلت من الـ iPhone|الاسم)\s*/i, "").trim();
    s = s.replace(/^[•·\-–—*،]+\s*/, "").trim();
    s = s.replace(/^[\d\s/\\.\-:،,؛\])(\[]+/, "").trim();
    s = s.replace(/\b(?:الزيدان|الشريهي|الشريهى|الشريه)\b/g, "").trim();
    s = s.replace(/\s+/g, " ").trim();
    return s;
  }

  function isBatchNoiseLine(line) {
    var s = cleanBatchLine(line);
    if (!s || s === "الاسم") return true;
    if (/^[\d\s/\\.\-:،,؛\])(\[]+$/.test(s)) return true;
    return false;
  }

  function preprocessBatchLines(rawLines) {
    var out = [];
    var prev = "";
    (Array.isArray(rawLines) ? rawLines : []).forEach(function (line) {
      if (isBatchNoiseLine(line)) return;
      var cleaned = cleanBatchLine(line);
      if (!cleaned || cleaned === prev) return;
      prev = cleaned;
      out.push(cleaned);
    });
    return out;
  }

  function batchJoinAbd(words, start) {
    var list = Array.isArray(words) ? words : [];
    var first = normalizeBatchText(list[start] || "");
    if (!first) return { value: "", next: start };
    if (first === "عبد" && list[start + 1]) {
      return { value: normalizeBatchText("عبد" + String(list[start + 1] || "")), next: start + 2 };
    }
    return { value: first, next: start + 1 };
  }

  function batchLeaf(path) {
    var s = normalizeBatchText(path);
    if (!s) return "";
    if (s.includes("/")) return s.split("/").filter(Boolean).slice(-1)[0] || s;
    var rootMatch = s.match(/^(.+?)\s+بن\s+مطلق\s+بن\s+زيدان$/);
    return rootMatch ? normalizeBatchText(rootMatch[1]) : s;
  }

  function batchParentPath(path) {
    var s = normalizeBatchText(path);
    if (!s || !s.includes("/")) return "";
    var parts = s.split("/").filter(Boolean);
    parts.pop();
    return parts.join("/");
  }

  function stripLineageTailToken(token) {
    return normalizeBatchText(String(token || ""))
      .replace(/\b(?:ناصر|مفلح|مطلق|زيدان|زيد\b)\w*\b\s*$/g, "")
      .trim();
  }

  function findBranchPartIndex(parts, branchKey) {
    var key = normalizeBatchText(branchKey);
    if (!key) return -1;
    for (var i = 0; i < parts.length; i += 1) {
      var part = normalizeBatchText(parts[i] || "");
      if (!part) continue;
      if (part === key || part.indexOf(key) === 0) return i;
    }
    return -1;
  }

  function parseBatchFullLineage(line, branch) {
    var raw = cleanBatchLine(line);
    if (!raw || !/\s+بن\s+/.test(raw)) return null;

    var parts = raw
      .split(/\s+بن\s+/g)
      .map(function (p) {
        return stripLineageTailToken(cleanBatchLine(p));
      })
      .filter(Boolean);

    var branchKey = normalizeBatchText(branch);
    var branchIndex = findBranchPartIndex(parts, branchKey);
    if (branchIndex < 0) return null;

    var lineage = parts.slice(0, branchIndex + 1).reverse();
    if (!lineage.length || normalizeBatchText(lineage[0]) !== branchKey) {
      lineage[0] = branchKey;
    }
    if (lineage.length < 2) return null;

    var parent = branchKey + " بن مطلق بن زيدان";
    var relations = [];

    for (var i = 1; i < lineage.length; i += 1) {
      var leaf = normalizeBatchText(lineage[i]);
      if (!leaf) continue;
      var child = parent + "/" + leaf;
      relations.push({ parent: parent, child: child, source: raw });
      parent = child;
    }

    return { path: parent, relations: relations, lineage: lineage, source: raw, isContext: true };
  }

  function parseBatchShortLine(line) {
    var raw = cleanBatchLine(line);
    if (!raw || raw === "الاسم") return null;
    if (/\s+بن\s+/.test(raw)) return null;

    var words = raw.split(/\s+/g).map(normalizeBatchText).filter(Boolean);
    while (words.length && /^(?:ال)?زيد(?:ان)?$/i.test(words[words.length - 1])) {
      words.pop();
    }
    if (words.length < 2 || words.length > 4) return null;

    var pos = 0;
    var namePart = batchJoinAbd(words, pos);
    var name = namePart.value;
    pos = namePart.next;

    var fatherPart = batchJoinAbd(words, pos);
    var father = fatherPart.value;
    pos = fatherPart.next;

    var grandfatherPart = batchJoinAbd(words, pos);
    var grandfather = grandfatherPart.value;

    if (!name || !father) return null;
    return { raw: raw, name: name, father: father, grandfather: grandfather };
  }

  function normalizeTreeCardText(v) {
    return String(v || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function relationLeafName(path) {
    var parts = String(path || "").split("/").map(normalizeTreeCardText).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : "";
  }

  function relationPathLabel(path) {
    return String(path || "")
      .split("/")
      .map(normalizeTreeCardText)
      .filter(Boolean)
      .join(" ← ");
  }

  window.TreeLineage = {
    normalizeBatchText: normalizeBatchText,
    cleanBatchLine: cleanBatchLine,
    isBatchNoiseLine: isBatchNoiseLine,
    preprocessBatchLines: preprocessBatchLines,
    batchJoinAbd: batchJoinAbd,
    batchLeaf: batchLeaf,
    batchParentPath: batchParentPath,
    parseBatchFullLineage: parseBatchFullLineage,
    parseBatchShortLine: parseBatchShortLine,
    normalizeTreeCardText: normalizeTreeCardText,
    relationLeafName: relationLeafName,
    relationPathLabel: relationPathLabel
  };
})();
