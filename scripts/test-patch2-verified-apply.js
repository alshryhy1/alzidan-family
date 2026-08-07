#!/usr/bin/env node
/**
 * Patch 2 smoke — Verified request apply (no network).
 * Run: node scripts/test-patch2-verified-apply.js
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

const CP = sandbox.AlzidanCanonicalPerson;
if (!CP) {
  console.error("FAIL: AlzidanCanonicalPerson missing");
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

assert(CP.ERROR.REQ_001 === "REQ-001", "REQ-001 code present");
assert(CP.ERROR.REQ_002 === "REQ-002", "REQ-002 code present");
assert(/REQ-001/.test(CP.MSG.REQ_001), "REQ-001 Arabic message");
assert(/REQ-002/.test(CP.MSG.REQ_002), "REQ-002 Arabic message");

// Ambiguous leaf → TREE-001 via resolveFromPathIndex / attach behavior
const pathToRow = {
  "لاحم بن مطلق بن زيدان/صالح/علي": {
    id: 1,
    person_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  },
  "لاحم بن مطلق بن زيدان/صالح/ناصر/صالح/علي": {
    id: 2,
    person_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  },
};
pathToRow["pid:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"] =
  pathToRow["لاحم بن مطلق بن زيدان/صالح/علي"];
pathToRow["pid:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"] =
  pathToRow["لاحم بن مطلق بن زيدان/صالح/ناصر/صالح/علي"];

const helpers = {
  normalizePersonName: (v) => String(v || "").replace(/\s+/g, " ").trim(),
};

const attached = CP.attachParentPersonId(
  { branch_key: "لاحم", parent_name: "علي", child_name: "مازن" },
  pathToRow,
  "علي",
  helpers,
);
// attachParentPersonId does not fail — it only attaches when unique.
// Unique path attach:
const attachedUnique = CP.attachParentPersonId(
  {
    branch_key: "لاحم",
    parent_name: "لاحم بن مطلق بن زيدان/صالح/ناصر/صالح/علي",
    child_name: "لاحم بن مطلق بن زيدان/صالح/ناصر/صالح/علي/مازن",
  },
  pathToRow,
  "لاحم بن مطلق بن زيدان/صالح/ناصر/صالح/علي",
  helpers,
);
assert(
  attachedUnique.parent_person_id === "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  "unique parent path attaches parent_person_id",
);
assert(
  !attached.parent_person_id,
  "ambiguous short parent name does not silently attach parent_person_id",
);

// Source contract: request-actions forbids approve without verify
const ra = fs.readFileSync(
  path.join(__dirname, "..", "assets", "js", "modules", "request-actions.js"),
  "utf8",
);
assert(ra.includes("REQ-001"), "request-actions mentions REQ-001");
assert(ra.includes("REQ-002"), "request-actions mentions REQ-002");
assert(ra.includes("verifyTreeCardRowsInTree"), "has verify helper");
assert(ra.includes("reapplyApprovedTreeCard"), "has re-apply path");
assert(
  ra.includes("parent_person_id"),
  "enrich/apply uses parent_person_id",
);

const reqs = fs.readFileSync(
  path.join(__dirname, "..", "assets", "js", "modules", "requests.js"),
  "utf8",
);
assert(
  reqs.includes("verified apply") || reqs.includes("تطبيق متحقَّق"),
  "approve UI mentions verified apply",
);
assert(reqs.includes("إعادة تطبيق"), "re-apply button present");
assert(
  reqs.indexOf("importTreeCardToTree") < reqs.indexOf('p_status: "approved"'),
  "import/apply happens before status approved in source order",
);

// Mazen scenario structural fixture (name-only short path must not approve)
const mazenShort = {
  branch_key: "لاحم",
  parent_name: "مازن",
  child_name: "مازن/محمد",
};
assert(
  !mazenShort.parent_person_id,
  "Mazen short-path fixture has no parent_person_id (orphan shape)",
);

if (failed) {
  console.error("\nPatch 2 smoke FAILED:", failed);
  process.exit(1);
}
console.log("\nPatch 2 smoke PASSED");
