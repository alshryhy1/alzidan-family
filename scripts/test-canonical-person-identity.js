#!/usr/bin/env node
/**
 * Patch 1 smoke tests — Canonical Person Identity (no network).
 * Run: node scripts/test-canonical-person-identity.js
 */
"use strict";

const path = require("path");
const fs = require("fs");

const modulePath = path.join(__dirname, "..", "assets", "js", "modules", "canonical-person.js");
const src = fs.readFileSync(modulePath, "utf8");
// Evaluate as browser IIFE then read global
const sandbox = { module: { exports: {} }, globalThis: {} };
sandbox.window = sandbox.globalThis;
Function("window", "globalThis", "module", "exports", src + "\n;")(
  sandbox.window,
  sandbox.globalThis,
  sandbox.module,
  sandbox.module.exports,
);
const CP = sandbox.globalThis.AlzidanCanonicalPerson || sandbox.module.exports;
if (!CP) {
  console.error("FAIL: AlzidanCanonicalPerson not loaded");
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

const shortPath = "لاحم بن مطلق بن زيدان/صالح/علي";
const longPath = "لاحم بن مطلق بن زيدان/صالح/ناصر/صالح/علي";
const pathToRow = {
  [shortPath]: {
    id: 101,
    person_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    parent_person_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    db_parent_name: "لاحم بن مطلق بن زيدان/صالح",
    db_child_name: shortPath,
  },
  [longPath]: {
    id: 202,
    person_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    parent_person_id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
    db_parent_name: "لاحم بن مطلق بن زيدان/صالح/ناصر/صالح",
    db_child_name: longPath,
  },
};
pathToRow["pid:" + pathToRow[shortPath].person_id] = pathToRow[shortPath];
pathToRow["pid:" + pathToRow[longPath].person_id] = pathToRow[longPath];

const helpers = {
  normalizePersonName: (v) => String(v || "").replace(/\\s+/g, " ").trim(),
  getLeafStoredNameFromNodeId: (v) => {
    const n = String(v || "").trim();
    return n.includes("/") ? n.split("/").filter(Boolean).slice(-1)[0] : n;
  },
};

// 1) Exact path resolves without confusion
const r1 = CP.resolveFromPathIndex(pathToRow, shortPath, "", helpers);
assert(r1.ok && r1.rowId === 101, "exact short path → row 101 (علي صالح لاحم)");

const r2 = CP.resolveFromPathIndex(pathToRow, longPath, "", helpers);
assert(r2.ok && r2.rowId === 202, "exact long path → row 202 (علي صالح ناصر صالح لاحم)");

// 2) person_id primary
const r3 = CP.resolveFromPathIndex(pathToRow, "", pathToRow[longPath].person_id, helpers);
assert(r3.ok && r3.rowId === 202, "person_id resolves long path person");

// 3) Display / search layers
assert(
  CP.nodePathToDisplayName(longPath) === "علي",
  "display name is leaf علي",
);
assert(
  CP.nodePathToSearchName(longPath) === "علي",
  "search name is leaf علي",
);

// 4) Ambiguous leaf-only must NOT silently pick (index has no leaf-only keys; DB mock)
const mockSb = {
  from() {
    return this;
  },
  select() {
    return this;
  },
  eq(col, val) {
    this._col = col;
    this._val = val;
    return this;
  },
  limit() {
    return this;
  },
  async then(resolve) {
    // Simulate multi-match on leaf "علي"
    if (this._val === "علي") {
      return resolve({
        data: [
          { id: 101, person_id: pathToRow[shortPath].person_id, parent_name: pathToRow[shortPath].db_parent_name, child_name: shortPath, name: shortPath },
          { id: 202, person_id: pathToRow[longPath].person_id, parent_name: pathToRow[longPath].db_parent_name, child_name: longPath, name: longPath },
        ],
        error: null,
      });
    }
    return resolve({ data: [], error: null });
  },
};

(async () => {
  const amb = await CP.resolveTreeRowIdFromDb({
    sb: mockSb,
    branchKey: "لاحم",
    nodePath: "علي",
    helpers,
  });
  assert(!amb.ok && amb.code === "TREE-001", "leaf-only multi-match fails TREE-001 (no silent link)");

  const unique = await CP.resolveTreeRowIdFromDb({
    sb: {
      from() { return this; },
      select() { return this; },
      eq(col, val) { this._val = val; return this; },
      limit() { return this; },
      async then(resolve) {
        if (this._val === shortPath) {
          return resolve({
            data: [{ id: 101, person_id: pathToRow[shortPath].person_id, parent_name: pathToRow[shortPath].db_parent_name, child_name: shortPath, name: shortPath }],
            error: null,
          });
        }
        return resolve({ data: [], error: null });
      },
    },
    branchKey: "لاحم",
    nodePath: shortPath,
    helpers,
  });
  assert(unique.ok && unique.rowId === 101, "unique full path DB match succeeds");

  const attached = CP.attachParentPersonId(
    { branch_key: "لاحم", parent_name: shortPath, child_name: shortPath + "/نور" },
    pathToRow,
    shortPath,
    helpers,
  );
  assert(
    attached.parent_person_id === pathToRow[shortPath].person_id,
    "attachParentPersonId sets parent_person_id from path index",
  );

  // Static guard: write files must not use limit(1) name lookup helper pattern
  const adminSrc = fs.readFileSync(path.join(__dirname, "..", "assets", "js", "admin-family-mgmt.js"), "utf8");
  const delegateSrc = fs.readFileSync(path.join(__dirname, "..", "assets", "js", "delegate.js"), "utf8");
  assert(!/eq\("name", name\)\.limit\(1\)/.test(adminSrc), "admin no longer name+limit(1)");
  assert(!/eq\("name", name\)\.limit\(1\)/.test(delegateSrc), "delegate no longer name+limit(1)");
  assert(!/chosen = hit \|\| q\.data\[0\]/.test(adminSrc), "admin no longer auto-picks q.data[0]");
  assert(adminSrc.includes("AlzidanCanonicalPerson") || adminSrc.includes("resolveTreeRowIdForWrite"), "admin uses canonical resolver");
  assert(delegateSrc.includes("resolveTreeRowIdForWrite"), "delegate uses canonical resolver");

  if (failed) {
    console.error("\n" + failed + " test(s) failed");
    process.exit(1);
  }
  console.log("\nAll Patch 1 identity smoke tests passed.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
