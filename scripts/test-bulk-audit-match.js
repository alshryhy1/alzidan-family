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
      return parentNamesMatch(parentName, row.parent_name) && childNamesMatch(childName, row.child_name);
    });
  }

  function treeRowChildPath(row) {
    const child = normalizeBatchText(row.child_name || "");
    if (!child) return "";
    if (child.includes("/")) return child;
    const parent = normalizeBatchText(row.parent_name || "");
    return parent ? parent + "/" + child : child;
  }

  return {
    normalizeBatchText,
    batchLeaf,
    batchParentPath,
    parseBatchShortLine,
    parentNamesMatch,
    childNamesMatch,
    treeHasRelation,
    treeRowChildPath,
  };
}

const TreeLineage = loadTreeLineage();
const H = loadAuditHelpers(TreeLineage);
const branch = "زيدان";
const root = branch + " بن مطلق بن زيدان";
const fullParent = root + "/نزال بن فايز/غازي/هاجس/زيدان/مسلم";
const fullChild = fullParent + "/خلف";

const dbFormats = [
  { label: "full paths", parent_name: fullParent, child_name: fullChild },
  { label: "leaf parent+child", parent_name: "مسلم", child_name: "خلف" },
  { label: "full parent + leaf child", parent_name: fullParent, child_name: "خلف" },
  { label: "parent column only", parent: fullParent, parent_name: "", child_name: fullChild },
];

let failed = 0;
dbFormats.forEach((fmt) => {
  const row = {
    branch_key: branch,
    parent_name: fmt.parent_name || fmt.parent || "",
    child_name: fmt.child_name,
  };
  const ok = H.treeHasRelation([row], branch, fullParent, fullChild);
  console.log(`${ok ? "PASS" : "FAIL"}: ${fmt.label}`);
  if (!ok) failed += 1;
});

const short = H.parseBatchShortLine("خلف مسلم دوخي الزيدان");
console.log("short parse:", short);

const treeRows = dbFormats.slice(0, 2).map((fmt) => ({
  branch_key: branch,
  parent_name: fmt.parent_name,
  child_name: fmt.child_name,
}));
const knownByLeaf = new Map();
function remember(pathValue) {
  const p = H.normalizeBatchText(pathValue);
  const leaf = H.batchLeaf(p);
  if (!leaf) return;
  if (!knownByLeaf.has(leaf)) knownByLeaf.set(leaf, []);
  knownByLeaf.get(leaf).push({ path: p });
}
remember(root);
treeRows.forEach((row) => remember(H.treeRowChildPath(row)));

const parentCandidates = knownByLeaf.get(H.normalizeBatchText("مسلم")) || [];
console.log("مسلم candidates:", parentCandidates.map((c) => c.path));

const childPath = (parentCandidates[0] && parentCandidates[0].path ? parentCandidates[0].path : fullParent) + "/خلف";
const existsShort = H.treeHasRelation(treeRows, branch, fullParent, fullChild);
console.log(`${existsShort ? "PASS" : "FAIL"}: short-line target exists`);
if (!existsShort) failed += 1;

process.exit(failed ? 1 : 0);
