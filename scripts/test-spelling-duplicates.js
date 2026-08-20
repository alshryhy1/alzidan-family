#!/usr/bin/env node
"use strict";

/**
 * Smoke: Arabic normalize + possible spelling duplicates under same father.
 * Examples from Health Center evidence (أنس/انس, إبراهيم/ابراهيم, …).
 */

const path = require("path");
const fs = require("fs");
const vm = require("vm");

function loadModule(rel) {
  const src = fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
  const ctx = { window: {}, console, module: { exports: {} }, exports: {} };
  ctx.globalThis = ctx;
  vm.runInNewContext(src, ctx, { filename: rel });
  return ctx.module.exports || ctx.window.AlzidanIntegrityTreeStructure;
}

const Struct = loadModule("assets/js/modules/integrity-tree-structure-audit.js");
const n = Struct.normalizeArabicForCompare;

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("ok:", msg);
  }
}

const pairs = [
  ["أنس", "انس"],
  ["إبراهيم", "ابراهيم"],
  ["إلياس", "الياس"],
  ["فضى", "فضي"],
  ["دوخي", "دوخى"],
];

pairs.forEach(([a, b]) => {
  assert(n(a) === n(b) && n(a).length > 0, `normalize ${a} ↔ ${b} → ${n(a)}`);
});

assert(n("محمد") === n("محمد"), "identical stays identical");
assert(n("سعود") !== n("سعيد"), "distinct names stay distinct");

const father = "زيدان بن مطلق بن زيدان/منصور";
const children = [
  {
    id: 1,
    branch_key: "زيدان",
    parent_name: father,
    parent: father,
    name: father + "/أنس",
    child_name: father + "/أنس",
  },
  {
    id: 2,
    branch_key: "زيدان",
    parent_name: father,
    parent: father,
    name: father + "/انس",
    child_name: father + "/انس",
  },
  {
    id: 3,
    branch_key: "زيدان",
    parent_name: father,
    parent: father,
    name: father + "/خالد",
    child_name: father + "/خالد",
  },
  {
    id: 4,
    branch_key: "زيدان",
    parent_name: "زيدان بن مطلق بن زيدان/آخر",
    parent: "زيدان بن مطلق بن زيدان/آخر",
    name: "زيدان بن مطلق بن زيدان/آخر/أنس",
    child_name: "زيدان بن مطلق بن زيدان/آخر/أنس",
  },
];

const found = Struct.findPossibleSpellingDuplicates(children);
assert(found.length === 1, "exactly one pair under منصور (not across fathers)");
assert(found[0].name_a === "أنس" || found[0].name_b === "أنس", "pair includes أنس");
assert(found[0].name_a === "انس" || found[0].name_b === "انس", "pair includes انس");
assert(found[0].status_ar === "يحتاج مراجعة", "status needs review");
assert(found[0].never_auto_merge === true, "never auto-merge flag");
assert(found[0].similarity_pct === 100, "similarity 100 after normalize");

const report = Struct.auditTreeStructure(children, []);
assert(
  report.totals.possible_spelling_duplicates === 1,
  "audit totals include spelling dupes",
);
assert(
  (report.summary_card.possible_spelling_duplicates || 0) === 1,
  "summary card includes spelling dupes",
);
const cat = (report.categories || []).find((c) => c.id === "possible_spelling_duplicates");
assert(cat && cat.count === 1 && cat.priority === "high", "category card high priority");

const nearKids = children.concat([
  {
    id: 5,
    branch_key: "زيدان",
    parent_name: father,
    parent: father,
    name: father + "/خلد",
    child_name: father + "/خلد",
  },
  {
    id: 6,
    branch_key: "زيدان",
    parent_name: father,
    parent: father,
    name: father + "/سعيد",
    child_name: father + "/سعيد",
  },
  {
    id: 7,
    branch_key: "زيدان",
    parent_name: father,
    parent: father,
    name: father + "/سعود",
    child_name: father + "/سعود",
  },
  {
    id: 8,
    branch_key: "زيدان",
    parent_name: father,
    parent: father,
    name: father + "/محد",
    child_name: father + "/محد",
  },
  {
    id: 9,
    branch_key: "زيدان",
    parent_name: father,
    parent: father,
    name: father + "/عبد الرحمن",
    child_name: father + "/عبد الرحمن",
  },
  {
    id: 10,
    branch_key: "زيدان",
    parent_name: father,
    parent: father,
    name: father + "/سعد",
    child_name: father + "/سعد",
  },
]);
const near = Struct.findWrongNameSimilarity(nearKids);
assert(near.length === 1, "exactly one near-miss pair (خالد/خلد)");
assert(
  !near.some(
    (row) =>
      (row.name_a === "سعد" && row.name_b === "سعيد") ||
      (row.name_a === "سعيد" && row.name_b === "سعد"),
  ),
  "سعد/سعيد are distinct brothers, not a name error",
);
assert(
  (near[0].name_a === "خالد" && near[0].name_b === "خلد") ||
    (near[0].name_a === "خلد" && near[0].name_b === "خالد"),
  "near pair is خالد/خلد",
);
assert(near[0].never_auto_merge === true, "near-miss never auto-merge");
const typos = Struct.findSuspiciousNameTypos(nearKids);
assert(
  typos.some((row) => String(row.reason_ar || "").indexOf("محد") >= 0),
  "محد flagged as typo",
);
assert(
  !typos.some((row) => String(row.child_path || "").indexOf("عبد الرحمن") >= 0),
  "عبد الرحمن spacing is not a name error",
);
const report2 = Struct.auditTreeStructure(nearKids, []);
assert(report2.totals.wrong_name_similarity === 1, "audit totals include near-miss");
assert(report2.totals.suspicious_name_typo >= 1, "audit totals include typos");

const PipeSrc = fs.readFileSync(
  path.join(__dirname, "../assets/js/modules/integrity-repair-pipeline.js"),
  "utf8",
);
const pipeCtx = {
  window: { AlzidanIntegrityTreeStructure: Struct },
  console,
  module: { exports: {} },
  exports: {},
};
pipeCtx.globalThis = pipeCtx;
vm.runInNewContext(PipeSrc, pipeCtx, { filename: "integrity-repair-pipeline.js" });
const Pipe = pipeCtx.window.AlzidanIntegrityRepairPipeline;
const analysis = Pipe.analyzeIssue(found[0], { children });
assert(analysis.repair_type === "manual_review_no_merge", "analyze → no merge by default");
const preview = Pipe.previewRepair(analysis, null);
assert(preview.executable === false, "preview not executable by default");
const sql = Pipe.buildExecuteSql(preview, { actor: "test" });
assert(sql.ok === false, "buildExecuteSql refused for spelling dupes by default");

const unify = Pipe.buildUnifyLeafName(found[0], "انس", "أنس", children);
assert(unify.ok, "unify leaf builds");
assert(unify.from_leaf === "انس" && unify.to_leaf === "أنس", "unify direction");
assert(unify.confirm_ar && unify.confirm_ar.affected >= 1, "unify confirm payload");
const merge = Pipe.buildMergePairPreview(found[0], found[0].id_a, children);
assert(merge.ok && merge.survivor_id && merge.loser_id, "merge preview ok");
assert(/تحذير/.test(merge.danger_ar || ""), "merge warns");

if (process.exitCode) {
  console.error("\nSome assertions failed.");
  process.exit(1);
}
console.log("\nAll spelling-duplicate checks passed.");
