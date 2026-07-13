#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadTreeLineage() {
  const src = fs.readFileSync(path.join(__dirname, "../assets/js/tree-lineage.js"), "utf8");
  const ctx = { window: {}, console };
  vm.runInNewContext(src, ctx);
  return ctx.window.TreeLineage;
}

function loadAuditHelpers(TreeLineage) {
  const normalizeBatchText = TreeLineage.normalizeBatchText;
  const batchLeaf = TreeLineage.batchLeaf;
  const batchParentPath = TreeLineage.batchParentPath;
  const parseBatchShortLine = TreeLineage.parseBatchShortLine;
  const parseBatchFullLineage = TreeLineage.parseBatchFullLineage;
  const preprocessBatchLines = TreeLineage.preprocessBatchLines;

  function normalizeArabicDigitsToLatin(value) {
    return String(value || "")
      .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632))
      .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 1776));
  }

  function normalizeForCompare(value) {
    let s = normalizeArabicDigitsToLatin(String(value || ""));
    s = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    s = s.replace(/[إأآ]/g, "ا");
    s = s.replace(/[ى]/g, "ي");
    s = s.replace(/ة/g, "ه");
    s = s.replace(/\s+/g, " ").trim();
    return s;
  }

  function leafLookupKey(name) {
    return normalizeForCompare(normalizeBatchText(name));
  }

  function parentNamesMatch(expectedParent, dbParent) {
    const expected = normalizeForCompare(normalizeBatchText(expectedParent));
    const stored = normalizeForCompare(normalizeBatchText(dbParent));
    if (!expected || !stored) return true;
    const expectedLeaf = normalizeForCompare(batchLeaf(expectedParent));
    const storedLeaf = normalizeForCompare(batchLeaf(dbParent));
    if (stored === expected || stored === expectedLeaf || expected === storedLeaf) return true;
    if (expected.endsWith("/" + stored) || expected.endsWith("/" + storedLeaf)) return true;
    if (stored.endsWith("/" + expectedLeaf)) return true;
    return false;
  }

  function childNamesMatch(expectedChild, dbChild) {
    const expected = normalizeForCompare(normalizeBatchText(expectedChild));
    const stored = normalizeForCompare(normalizeBatchText(dbChild));
    if (!expected || !stored) return false;
    if (stored === expected) return true;
    const expectedLeaf = normalizeForCompare(batchLeaf(expectedChild));
    const storedLeaf = normalizeForCompare(batchLeaf(dbChild));
    if (stored === expectedLeaf || storedLeaf === expected) return true;
    if (stored.endsWith("/" + expectedLeaf) || expected.endsWith("/" + storedLeaf)) return true;
    if (expected.endsWith("/" + stored) || expected.endsWith(stored)) return true;
    return false;
  }

  function treeHasRelation(treeRows, branchKey, parentName, childName) {
    const branchNorm = normalizeForCompare(branchKey);
    return treeRows.some((row) => {
      if (normalizeForCompare(row.branch_key) !== branchNorm) return false;
      const dbParent = row.parent_name || row.parent || "";
      const dbChild = row.child_name || row.name || "";
      return parentNamesMatch(parentName, dbParent) && childNamesMatch(childName, dbChild);
    });
  }

  function treeRowChildPath(row) {
    const child = normalizeBatchText(row.child_name || row.name || "");
    if (!child) return "";
    if (child.includes("/")) return child;
    const parent = normalizeBatchText(row.parent_name || row.parent || "");
    return parent ? parent + "/" + child : child;
  }

  function dryRunAnalyze(lines, branch, treeRows) {
    const root = branch + " بن مطلق بن زيدان";
    const knownByLeaf = new Map();
    let seq = 0;

    function remember(path) {
      const p = normalizeBatchText(path);
      const leafKey = leafLookupKey(batchLeaf(p));
      if (!leafKey) return;
      if (!knownByLeaf.has(leafKey)) knownByLeaf.set(leafKey, []);
      knownByLeaf.get(leafKey).push({ path: p, seq: (seq += 1) });
    }

    function rememberPathSegments(path) {
      const p = normalizeBatchText(path);
      if (!p) return;
      if (!p.includes("/")) {
        remember(p);
        return;
      }
      const parts = p.split("/").filter(Boolean);
      let built = parts[0];
      remember(built);
      for (let i = 1; i < parts.length; i += 1) {
        built = built + "/" + parts[i];
        remember(built);
      }
    }

    remember(root);
    treeRows.forEach((row) => {
      if (normalizeForCompare(row.branch_key) !== normalizeForCompare(branch)) return;
      if (row.parent_name) rememberPathSegments(row.parent_name);
      rememberPathSegments(treeRowChildPath(row));
    });

    function resolveParentPath(father, grandfather) {
      const fatherKey = leafLookupKey(father);
      let candidates = (knownByLeaf.get(fatherKey) || []).slice();
      const gf = normalizeBatchText(grandfather);
      if (gf) {
        const gfKey = leafLookupKey(gf);
        const filtered = candidates.filter(
          (c) => leafLookupKey(batchLeaf(batchParentPath(c.path))) === gfKey,
        );
        if (filtered.length) candidates = filtered;
      }
      candidates.sort((a, b) => b.seq - a.seq);
      return candidates.length ? candidates[0].path : "";
    }

    const results = [];
    preprocessBatchLines(lines).forEach((line) => {
      const full = parseBatchFullLineage(line, branch);
      if (full && full.relations && full.relations.length) {
        let parent = root;
        for (let i = 1; i < full.lineage.length; i += 1) {
          const leaf = normalizeBatchText(full.lineage[i]);
          if (!leaf) continue;
          const child = parent + "/" + leaf;
          rememberPathSegments(child);
          parent = child;
        }
        const targetParent = batchParentPath(parent);
        const exists = treeHasRelation(treeRows, branch, targetParent, parent);
        results.push({
          line,
          type: "A",
          childPath: parent,
          parentPath: targetParent,
          exists,
        });
        return;
      }

      const short = parseBatchShortLine(line);
      if (!short || !short.name || !short.father) {
        results.push({ line, type: "?", error: "unparsed" });
        return;
      }

      const parentPath = resolveParentPath(short.father, short.grandfather);
      if (!parentPath) {
        results.push({
          line,
          type: "B",
          child: short.name,
          father: short.father,
          grandfather: short.grandfather,
          error: "parent not found",
        });
        return;
      }

      const childPath = parentPath + "/" + normalizeBatchText(short.name);
      rememberPathSegments(childPath);
      const exists = treeHasRelation(treeRows, branch, parentPath, childPath);
      results.push({
        line,
        type: "B",
        childPath,
        parentPath,
        exists,
      });
    });

    return results;
  }

  return {
    normalizeBatchText,
    batchLeaf,
    batchParentPath,
    parseBatchShortLine,
    parseBatchFullLineage,
    preprocessBatchLines,
    parentNamesMatch,
    childNamesMatch,
    treeHasRelation,
    treeRowChildPath,
    dryRunAnalyze,
  };
}

const TreeLineage = loadTreeLineage();
const H = loadAuditHelpers(TreeLineage);

const USER_FIRST_FIVE = [
  "عقلا بن مطر بن عقلاء بن نويران بن لاحم بن مطلق بن زيدان بن ناصر بن مفلح الشريهي",
  "عبدالرحمن عقلا مطر الزيدان",
  "عبدالله عبدالرحمن عقلا",
  "عبد الوهاب عبدالرحمن عقلا",
  "فايز عقلا مطر الزيدان",
];

const branch = "لاحم";
const root = branch + " بن مطلق بن زيدان";

// Simulated DB rows (full paths as stored in tree_children)
const mockTreeRows = [
  {
    branch_key: branch,
    parent_name: root + "/نويران/عقلاء/مطر",
    child_name: root + "/نويران/عقلاء/مطر/عقلا",
  },
  {
    branch_key: branch,
    parent_name: root + "/نويران/عقلاء/مطر/عقلا",
    child_name: root + "/نويران/عقلاء/مطر/عقلا/عبدالرحمن",
  },
  {
    branch_key: branch,
    parent_name: root + "/نويران/عقلاء/مطر/عقلا/عبدالرحمن",
    child_name: root + "/نويران/عقلاء/مطر/عقلا/عبدالرحمن/عبدالله",
  },
  {
    branch_key: branch,
    parent_name: root + "/نويران/عقلاء/مطر/عقلا/عبدالرحمن",
    child_name: root + "/نويران/عقلاء/مطر/عقلا/عبدالرحمن/عبدالوهاب",
  },
  {
    branch_key: branch,
    parent_name: root + "/نويران/عقلاء/مطر/عقلا",
    child_name: root + "/نويران/عقلاء/مطر/عقلا/فايز",
  },
];

let failed = 0;

console.log("=== preprocessBatchLines (skip الاسم, numbers, dupes) ===");
const noisy = ["الاسم", "٦٦٩", USER_FIRST_FIVE[1], USER_FIRST_FIVE[1], "• test"];
const cleaned = H.preprocessBatchLines(noisy);
console.log("in:", noisy.length, "out:", cleaned.length, cleaned);

console.log("\n=== DB format matching ===");
const fullParent = root + "/نويران/عقلاء/مطر/عقلا";
const fullChild = fullParent + "/عبدالرحمن";
[
  { label: "full paths", parent_name: fullParent, child_name: fullChild },
  { label: "leaf parent+child", parent_name: "عقلا", child_name: "عبدالرحمن" },
].forEach((fmt) => {
  const row = { branch_key: branch, ...fmt };
  const ok = H.treeHasRelation([row], branch, fullParent, fullChild);
  console.log(`${ok ? "PASS" : "FAIL"}: ${fmt.label}`);
  if (!ok) failed += 1;
});

console.log("\n=== First 5 user lines dry-run (branch: لاحم) ===");
const results = H.dryRunAnalyze(USER_FIRST_FIVE, branch, mockTreeRows);
results.forEach((r, i) => {
  const status = r.error
    ? `REVIEW (${r.error})`
    : r.exists
      ? "موجود"
      : "جاهز للإضافة";
  console.log(`${i + 1}. [${r.type}] ${status}`);
  console.log(`   in:  ${r.line}`);
  if (r.childPath) console.log(`   out: ${r.childPath}`);
  if (r.parentPath) console.log(`   parent: ${r.parentPath}`);
});

const expectedExists = [true, true, true, true, true];
results.forEach((r, i) => {
  if (r.error || r.exists !== expectedExists[i]) {
    console.log(`FAIL line ${i + 1}: expected exists=${expectedExists[i]}, got exists=${r.exists}, error=${r.error || ""}`);
    failed += 1;
  } else {
    console.log(`PASS line ${i + 1}`);
  }
});

console.log("\n=== Partial chain (Type C) ===");
const partial = H.parseBatchFullLineage(
  "غدير بن فهيد بن عقلا بن نويران بن لاحم بن مطلق",
  branch,
);
console.log(partial ? "PASS: partial chain parsed → " + partial.path : "FAIL: partial chain");
if (!partial) failed += 1;

console.log("\n=== Short line parse ===");
const abd = H.parseBatchShortLine("عبد الوهاب عبدالرحمن عقلا");
console.log("عبد الوهاب:", abd);
if (!abd || abd.name !== "عبدالوهاب") failed += 1;

process.exit(failed ? 1 : 0);
