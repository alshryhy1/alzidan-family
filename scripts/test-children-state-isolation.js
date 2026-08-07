#!/usr/bin/env node
/**
 * TREE-004 — Children State Isolation + approve parent_person_id-only gate
 * Run: node scripts/test-children-state-isolation.js
 */
"use strict";

const path = require("path");
const fs = require("fs");
const vm = require("vm");

function loadIife(filePath, sandbox) {
  const src = fs.readFileSync(filePath, "utf8");
  vm.runInNewContext(src, sandbox, { filename: filePath });
}

const sandbox = {
  console,
  module: { exports: {} },
  exports: {},
  window: {},
  globalThis: {},
  document: { getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, querySelector() { return null; }, querySelectorAll() { return []; }, appendChild() {}, addEventListener() {} }), body: { appendChild() {} } },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

loadIife(
  path.join(__dirname, "..", "assets/js/modules/canonical-person.js"),
  sandbox,
);
loadIife(
  path.join(
    __dirname,
    "..",
    "assets/js/modules/family-management/family-person-core.js",
  ),
  sandbox,
);

const CP = sandbox.AlzidanCanonicalPerson;
const FM = sandbox.AlzidanFamilyPersonCore;
if (!CP || !FM) {
  console.error("FAIL: modules missing");
  process.exit(1);
}

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error("FAIL:", msg);
  } else {
    console.log("OK:", msg);
  }
}

assert(CP.ERROR.TREE_004 === "TREE-004", "TREE-004 code present");
assert(/TREE-004/.test(CP.MSG.TREE_004), "TREE-004 Arabic message");

const A = "لاحم بن مطلق بن زيدان/صالح/علي";
const B = "لاحم بن مطلق بن زيدان/صالح/ناصر/صالح/علي";
const pidA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const pidB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const childrenMap = {
  [A]: [
    { name: A + "/رضاء", parentPersonId: pidA },
    { name: A + "/نايف", parentPersonId: pidA },
  ],
  [B]: [],
};

const norm = (v) => String(v || "").replace(/\s+/g, " ").trim();

const forA = FM.childrenForSelectedParent(childrenMap, A, {
  normalizePersonName: norm,
  parentPersonId: pidA,
});
assert(forA.list.length === 2, "father A shows only A's children");

const forB = FM.childrenForSelectedParent(childrenMap, B, {
  normalizePersonName: norm,
  parentPersonId: pidB,
});
assert(forB.list.length === 0, "father B does not inherit A's children array");

// Shared array reference must be broken by isolateChildrenMapArrays
const shared = [{ name: "x" }];
const leaky = { [A]: shared, [B]: shared };
FM.isolateChildrenMapArrays(leaky);
assert(leaky[A] !== leaky[B], "isolateChildrenMapArrays breaks shared refs");
leaky[A].push({ name: "y" });
assert(leaky[B].length === 1, "mutating A list does not mutate B list");

const bound = FM.bindParentWriteContext(
  B,
  {
    [B]: { id: 2, person_id: pidB, db_child_name: B },
    ["pid:" + pidB]: { id: 2, person_id: pidB, db_child_name: B },
  },
  { normalizePersonName: norm },
);
assert(bound.parentPersonId === pidB, "bindParentWriteContext uses selected father UUID");

const row = FM.attachBoundParentToRow(
  { branch_key: "لاحم", parent_name: A, child_name: A + "/ولد" },
  bound,
);
assert(row.parent_person_id === pidB, "attachBoundParentToRow forces current father UUID");
assert(row.parent_name === B, "attachBoundParentToRow rewrites parent_name to bound father");

// Approve path source checks
const ra = fs.readFileSync(
  path.join(__dirname, "..", "assets/js/modules/request-actions.js"),
  "utf8",
);
assert(
  ra.includes("countExactParentPersonMatches") &&
    !ra.includes("countDistinctParentMatches"),
  "approve path dropped name/leaf parent matching",
);
assert(
  /parent_person_id only|TREE-004/.test(ra),
  "approve enrich documents parent_person_id-only policy",
);
assert(
  ra.includes("missing_parent_person_id") || ra.includes("TREE-003"),
  "missing parent_person_id fails approve",
);

const panel = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "assets/js/modules/family-management/family-management-panel.js",
  ),
  "utf8",
);
assert(
  panel.includes("addSheet.close") && panel.includes("resetSession"),
  "father change closes add sheet / resets children session",
);

const addSheet = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "assets/js/modules/family-management/family-add-sheet.js",
  ),
  "utf8",
);
assert(
  addSheet.includes("boundPersonId") &&
    addSheet.includes("تغيّر الأب المحدد"),
  "add sheet binds father at open and rejects mid-flight father switch",
);

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nAll TREE-004 isolation checks passed.");
