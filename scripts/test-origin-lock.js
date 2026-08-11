#!/usr/bin/env node
/**
 * Origin lock — أصول cannot be edited/deleted.
 * Run: node scripts/test-origin-lock.js
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
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

loadIife(
  path.join(
    __dirname,
    "..",
    "assets/js/modules/family-management/family-person-core.js",
  ),
  sandbox,
);

const Core = sandbox.AlzidanFamilyPersonCore;
if (!Core || typeof Core.isOriginPerson !== "function") {
  console.error("FAIL: AlzidanFamilyPersonCore.isOriginPerson missing");
  process.exit(1);
}

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("OK:", msg);
}

const branch = "مزيد";
const root = "مزيد بن مطلق بن زيدان";
const norm = (v) => String(v || "").replace(/\s+/g, " ").trim();

assert(Core.ORIGIN_LOCK_MSG.indexOf("الأصول") >= 0, "Arabic lock message present");

assert(
  Core.isOriginPerson(root, branch, { normalizePersonName: norm }) === true,
  "branch root is origin",
);
assert(
  Core.isOriginPerson(branch, branch, { normalizePersonName: norm }) === true,
  "branch key is origin",
);
assert(
  Core.isOriginPerson(root + "/صلف", branch, {
    parentId: root,
    normalizePersonName: norm,
  }) === true,
  "صلف under root is origin (path + parent)",
);
assert(
  Core.isOriginPerson("صلف", branch, {
    parentId: root,
    normalizePersonName: norm,
  }) === true,
  "صلف leaf under root parent is origin",
);
assert(
  Core.isOriginPerson("صلف", branch, {
    parentId: branch,
    normalizePersonName: norm,
  }) === true,
  "صلف under branch key parent is origin",
);
assert(
  Core.isOriginPerson(root + "/صلف/دوخي", branch, {
    parentId: root + "/صلف",
    normalizePersonName: norm,
  }) === false,
  "grandchild under صلف is NOT origin",
);
assert(
  Core.isOriginPerson(root + "/صلف/دوخي", branch, {
    normalizePersonName: norm,
  }) === false,
  "path depth > 1 is NOT origin without root parent",
);
assert(
  Core.isOriginPerson(root + "/خميس", branch, {
    parentId: root,
    normalizePersonName: norm,
  }) === true,
  "خميس under root is origin",
);

// pathToRow fallback
assert(
  Core.isOriginPerson(root + "/صلال", branch, {
    pathToRow: {
      [root + "/صلال"]: { db_parent_name: root },
    },
    normalizePersonName: norm,
  }) === true,
  "pathToRow db_parent_name marks origin",
);

console.log("\nAll origin-lock checks passed.");
