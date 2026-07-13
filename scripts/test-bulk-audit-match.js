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
  const canonicalizeBranchKey = TreeLineage.canonicalizeBranchKey;

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

  function seedKnownByLeaf(knownByLeaf, branch, treeRows) {
    const root = branch + " بن مطلق بن زيدان";
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

    return { remember: rememberPathSegments, bumpSeq: () => { seq += 1; return seq; } };
  }

  function dryRunAnalyze(lines, defaultBranch, treeRows) {
    const knownByBranch = new Map();
    const seedHelpersByBranch = new Map();
    let currentBranchContext = defaultBranch;

    function ensureBranchContext(branchKey) {
      const key = normalizeBatchText(branchKey) || defaultBranch;
      if (!knownByBranch.has(key)) {
        const knownByLeaf = new Map();
        const helpers = seedKnownByLeaf(knownByLeaf, key, treeRows);
        knownByBranch.set(key, knownByLeaf);
        seedHelpersByBranch.set(key, helpers);
      }
      return {
        branchKey: key,
        knownByLeaf: knownByBranch.get(key),
        remember: seedHelpersByBranch.get(key).remember,
        bumpSeq: seedHelpersByBranch.get(key).bumpSeq,
      };
    }

    function resolveParentPath(knownByLeaf, father, grandfather) {
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
      const full = parseBatchFullLineage(line, currentBranchContext || defaultBranch);
      if (full && full.relations && full.relations.length) {
        const branchKey = normalizeBatchText(full.branchKey) || currentBranchContext || defaultBranch;
        currentBranchContext = branchKey;
        const root = branchKey + " بن مطلق بن زيدان";
        let parent = root;
        for (let i = 1; i < full.lineage.length; i += 1) {
          const leaf = normalizeBatchText(full.lineage[i]);
          if (!leaf) continue;
          const child = parent + "/" + leaf;
          ensureBranchContext(branchKey).remember(child);
          parent = child;
        }
        const targetParent = batchParentPath(parent);
        const exists = treeHasRelation(treeRows, branchKey, targetParent, parent);
        results.push({
          line,
          type: "A",
          branch: branchKey,
          childPath: parent,
          parentPath: targetParent,
          exists,
        });
        return;
      }

      const short = parseBatchShortLine(line);
      const branchKey = currentBranchContext || defaultBranch;
      if (!short || !short.name || !short.father) {
        results.push({ line, type: "?", branch: branchKey, error: "unparsed" });
        return;
      }

      const ctx = ensureBranchContext(branchKey);
      const parentPath = resolveParentPath(ctx.knownByLeaf, short.father, short.grandfather);
      if (!parentPath) {
        results.push({
          line,
          type: "B",
          branch: branchKey,
          child: short.name,
          father: short.father,
          grandfather: short.grandfather,
          error: "parent not found",
        });
        return;
      }

      const childPath = parentPath + "/" + normalizeBatchText(short.name);
      ctx.remember(childPath);
      const exists = treeHasRelation(treeRows, branchKey, parentPath, childPath);
      results.push({
        line,
        type: "B",
        branch: branchKey,
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
    canonicalizeBranchKey,
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
  "فايز عقla مطr الزيدان",
];

const MIXED_BRANCH_LINES = [
  "عقلا بن مطر بن عقلاء بن نويران بن لاحم بن مطلق بن زيدان بن ناصر بن مفلح الشريهي",
  "عبدالرحمن عقلا مطر الزيدان",
  "ساير بن جاسر بن خضير بن جاسر بن ملحم بن مطلق بن زيدان بن ناصر بن مفلح الشريهي",
  "خالد ساير جاسر الزيدان",
  "فهد بن سالم بن مزيد بن مطلق بن زيدان",
  "راشد فهد سالم الزيدان",
];

const branch = "لاحم";
const root = branch + " بن مطلق بن زيدان";
const mlhmRoot = "ملحم بن مطلق بن زيدان";
const mzidRoot = "مزيد بن مطلق بن زيدان";

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
  {
    branch_key: "ملحم",
    parent_name: mlhmRoot + "/جاسر/خضير/جاسر",
    child_name: mlhmRoot + "/جاسر/خضير/جاسر/ساير",
  },
  {
    branch_key: "مزيد",
    parent_name: mzidRoot + "/سالم",
    child_name: mzidRoot + "/سالم/فهد",
  },
];

let failed = 0;

console.log("=== preprocessBatchLines (skip الاسم, numbers, dupes) ===");
const noisy = ["الاسم", "٦٦٩", USER_FIRST_FIVE[1], USER_FIRST_FIVE[1], "• test"];
const cleaned = H.preprocessBatchLines(noisy);
console.log("in:", noisy.length, "out:", cleaned.length, cleaned);

console.log("\n=== Branch detection from بن chain ===");
[
  ["لاحم chain", "عقلا بن نويران بن لاحم بن مطلق بن زيدان", "لاحم"],
  ["ملحم chain", "ساير بن جاسر بن ملحم بن مطلق بن زيدان", "ملحم"],
  ["مزيد chain", "فهد بن سالم بن مزيد بن مطلق بن زيدان", "مزيد"],
  ["زيدان chain", "علي بن زيدان بن مطلق بن زيدان", "زيدان"],
].forEach(([label, line, expected]) => {
  const full = H.parseBatchFullLineage(line, "زيدان");
  const got = full && full.branchKey ? full.branchKey : "";
  const ok = got === expected;
  console.log(`${ok ? "PASS" : "FAIL"}: ${label} → ${got || "(none)"}`);
  if (!ok) failed += 1;
});

console.log("\n=== canonicalizeBranchKey aliases ===");
[
  ["لاحm", "لاحم"],
  ["mlحم", "ملحم"],
  ["mzيد", "مزيد"],
].forEach(([input, expected]) => {
  const got = H.canonicalizeBranchKey(input);
  const ok = got === expected;
  console.log(`${ok ? "PASS" : "FAIL"}: ${input} → ${got || "(none)"}`);
  if (!ok) failed += 1;
});

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

console.log("\n=== First 5 user lines dry-run (default: لاحم) ===");
const results = H.dryRunAnalyze(USER_FIRST_FIVE, branch, mockTreeRows);
results.forEach((r, i) => {
  const status = r.error
    ? `REVIEW (${r.error})`
    : r.exists
      ? "موجود"
      : "جاهز للإضافة";
  console.log(`${i + 1}. [${r.type}] فرع:${r.branch} ${status}`);
  console.log(`   in:  ${r.line}`);
  if (r.childPath) console.log(`   out: ${r.childPath}`);
});

const expectedExists = [true, true, true, true, true];
results.forEach((r, i) => {
  if (r.error || r.exists !== expectedExists[i] || r.branch !== branch) {
    console.log(`FAIL line ${i + 1}: branch=${r.branch}, expected exists=${expectedExists[i]}, got exists=${r.exists}, error=${r.error || ""}`);
    failed += 1;
  } else {
    console.log(`PASS line ${i + 1}`);
  }
});

console.log("\n=== Mixed branch list dry-run ===");
const mixed = H.dryRunAnalyze(MIXED_BRANCH_LINES, "زيدان", mockTreeRows);
const expectedMixed = [
  { branch: "لاحم", exists: true },
  { branch: "لاحم", exists: true },
  { branch: "ملحم", exists: true },
  { branch: "ملحم", exists: false },
  { branch: "مزيد", exists: true },
  { branch: "مزيد", exists: false },
];
mixed.forEach((r, i) => {
  const exp = expectedMixed[i] || {};
  const ok = r.branch === exp.branch && r.exists === exp.exists && !r.error;
  console.log(`${ok ? "PASS" : "FAIL"} line ${i + 1}: فرع=${r.branch} exists=${r.exists} (${r.line.slice(0, 40)}...)`);
  if (!ok) failed += 1;
});

console.log("\n=== Partial chain (Type C) ===");
const partial = H.parseBatchFullLineage(
  "غدير بن فهيد بن عقلا بن نويران بن لاحم بن مطلق",
  branch,
);
console.log(partial ? "PASS: partial chain parsed → " + partial.path + " branch=" + partial.branchKey : "FAIL: partial chain");
if (!partial || partial.branchKey !== "لاحم") failed += 1;

console.log("\n=== Short line parse ===");
const abd = H.parseBatchShortLine("عبد الوهاب عبدالرحمن عقلا");
console.log("عبد الوهاب:", abd);
if (!abd || abd.name !== "عبدالوهاب") failed += 1;

process.exit(failed ? 1 : 0);
