#!/usr/bin/env node
/**
 * Smoke — tree_card import reuses existing father (no duplicate ancestors).
 * Run: node scripts/test-tree-import-reuse.js
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
  setTimeout,
  clearTimeout,
  module: { exports: {} },
  exports: {},
  window: {},
  globalThis: {},
  document: {
    getElementById: () => null,
  },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

loadIife(
  path.join(__dirname, "..", "assets", "js", "modules", "canonical-person.js"),
  sandbox,
);
loadIife(
  path.join(__dirname, "..", "assets", "js", "modules", "request-actions.js"),
  sandbox,
);

const RA = sandbox.AlzidanRequestActions;
const CP = sandbox.AlzidanCanonicalPerson;

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error("FAIL:", msg);
  } else {
    console.log("OK:", msg);
  }
}

assert(!!RA, "AlzidanRequestActions loaded");
assert(typeof RA.resolveExistingTreeNode === "function", "resolveExistingTreeNode exported");
assert(typeof RA.alignChildPathUnderParent === "function", "alignChildPathUnderParent exported");

const habibPid = "11111111-1111-1111-1111-111111111111";
const ghaziPid = "22222222-2222-2222-2222-222222222222";
const habibPath =
  "زايد بن مطلق بن زيدان/محمد/غازي/فايز/زيدان/حبيب";
const ghaziPath = "زايد بن مطلق بن زيدان/محمد/غازي";

const pathToRow = {};
pathToRow[habibPath] = {
  id: 10,
  person_id: habibPid,
  parent_person_id: "33333333-3333-3333-3333-333333333333",
  db_parent_name: "زايد بن مطلق بن زيدان/محمد/غازي/فايز/زيدان",
  db_child_name: habibPath,
};
pathToRow["pid:" + habibPid] = pathToRow[habibPath];
pathToRow[ghaziPath] = {
  id: 5,
  person_id: ghaziPid,
  parent_person_id: "44444444-4444-4444-4444-444444444444",
  db_parent_name: "زايد بن مطلق بن زيدان/محمد",
  db_child_name: ghaziPath,
};
pathToRow["pid:" + ghaziPid] = pathToRow[ghaziPath];

// Existing حبيب by leaf under branch
const byLeaf = RA.resolveExistingTreeNode(pathToRow, {
  path: "حبيب",
  leaf: "حبيب",
});
assert(byLeaf.ok && byLeaf.found, "existing حبيب resolved by leaf");
assert(
  byLeaf.meta && byLeaf.meta.person_id === habibPid,
  "resolved حبيب keeps canonical person_id",
);

// Legacy stamped father_person_id on wrong ancestor edge must NOT win
const wrongStamp = RA.resolveExistingTreeNode(pathToRow, {
  personId: habibPid,
  path: ghaziPath,
  leaf: "غازي",
});
assert(
  wrongStamp.ok && wrongStamp.found && wrongStamp.meta.person_id === ghaziPid,
  "stamped father_person_id ignored when path is غازي",
);

// Ambiguous leaf → TREE-001
const ambIndex = Object.assign({}, pathToRow);
ambIndex["زايد بن مطلق بن زيدان/آخر/حبيب"] = {
  id: 99,
  person_id: "99999999-9999-9999-9999-999999999999",
  parent_person_id: "",
  db_parent_name: "زايد بن مطلق بن زيدان/آخر",
  db_child_name: "زايد بن مطلق بن زيدان/آخر/حبيب",
};
const amb = RA.resolveExistingTreeNode(ambIndex, { path: "حبيب", leaf: "حبيب" });
assert(!amb.ok && amb.code === "TREE-001", "ambiguous حبيب → TREE-001");

// enrich binds to existing father path
const enriched = RA.enrichOneTreeCardRow(
  {
    branch_key: "زايد",
    parent_name: "حبيب",
    child_name: "محمد",
    parent_person_id: habibPid,
  },
  pathToRow,
);
assert(enriched.ok, "enrich father حبيب ok");
assert(
  enriched.row.parent_name === habibPath,
  "enrich rewrites parent_name to canonical حبيب path",
);
assert(
  enriched.row.parent_person_id === habibPid,
  "enrich keeps حبيب person_id",
);

const aligned = RA.alignChildPathUnderParent(habibPath, "محمد");
assert(
  aligned === habibPath + "/محمد",
  "new son path aligned under existing حبيب",
);

// Source contracts
const raSrc = fs.readFileSync(
  path.join(__dirname, "..", "assets", "js", "modules", "request-actions.js"),
  "utf8",
);
assert(
  raSrc.includes("موجود مسبقاً") || raSrc.includes("resolveExistingTreeNode"),
  "import path mentions reuse / skip existing",
);
assert(
  !/item && item\.parent_person_id\) \|\| fatherPersonId/.test(raSrc),
  "buildTreeCardRows no longer stamps fatherPersonId on every edge",
);

const sql = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "supabase",
    "sql",
    "20260808_tree_import_reuse_existing.sql",
  ),
  "utf8",
);
assert(sql.includes("TREE-001"), "SQL raises TREE-001 on ambiguous parent");
assert(
  sql.includes("admin_tree_children_import_v1"),
  "SQL replaces admin_tree_children_import_v1",
);

assert(CP.ERROR.TREE_001 === "TREE-001", "TREE-001 code still present");

if (failed) {
  console.error("\nTree import reuse smoke FAILED:", failed);
  process.exit(1);
}
console.log("\nTree import reuse smoke PASSED");
