#!/usr/bin/env node
/**
 * Patch 3 smoke — Spouse resolve via person_id (no network).
 * Run: node scripts/test-patch3-spouses.js
 */
"use strict";

const path = require("path");
const fs = require("fs");

const modulePath = path.join(__dirname, "..", "assets", "js", "modules", "canonical-person.js");
const src = fs.readFileSync(modulePath, "utf8");
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
  },
  [longPath]: {
    id: 202,
    person_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  },
};
pathToRow["pid:" + pathToRow[shortPath].person_id] = pathToRow[shortPath];
pathToRow["pid:" + pathToRow[longPath].person_id] = pathToRow[longPath];

const helpers = {
  normalizePersonName: (v) => String(v || "").replace(/\s+/g, " ").trim(),
  getLeafStoredNameFromNodeId: (v) => {
    const n = String(v || "").trim();
    return n.includes("/") ? n.split("/").filter(Boolean).slice(-1)[0] : n;
  },
};

(async () => {
  assert(typeof CP.resolveHusbandForSpouseWrite === "function", "resolveHusbandForSpouseWrite exported");

  // Selected husband with row id — no name search
  const byRow = await CP.resolveHusbandForSpouseWrite({
    nodePath: shortPath,
    personId: pathToRow[shortPath].person_id,
    rowId: 101,
    pathToRow,
    helpers,
  });
  assert(byRow.ok && byRow.rowId === 101, "selection rowId resolves husband without name search");

  // person_id from selection index
  const byPid = await CP.resolveHusbandForSpouseWrite({
    nodePath: "",
    personId: pathToRow[longPath].person_id,
    rowId: 0,
    pathToRow,
    helpers,
    sb: null,
    branchKey: "لاحم",
  });
  assert(byPid.ok && byPid.rowId === 202, "person_id from pathToRow resolves husband");

  // Ambiguous leaf → TREE-001 (mock DB)
  const mockSb = {
    from() { return this; },
    select() { return this; },
    eq(col, val) { this._val = val; return this; },
    limit() { return this; },
    async then(resolve) {
      if (this._val === "علي") {
        return resolve({
          data: [
            { id: 101, person_id: pathToRow[shortPath].person_id, parent_name: "x", child_name: shortPath, name: shortPath },
            { id: 202, person_id: pathToRow[longPath].person_id, parent_name: "y", child_name: longPath, name: longPath },
          ],
          error: null,
        });
      }
      return resolve({ data: [], error: null });
    },
  };
  const amb = await CP.resolveHusbandForSpouseWrite({
    sb: mockSb,
    branchKey: "لاحم",
    nodePath: "علي",
    personId: "",
    rowId: 0,
    pathToRow: {},
    helpers,
  });
  assert(!amb.ok && amb.code === "TREE-001", "ambiguous husband name → TREE-001 (no silent link)");

  // Static guards on write files
  const adminSrc = fs.readFileSync(path.join(__dirname, "..", "assets", "js", "admin-family-mgmt.js"), "utf8");
  const delegateSrc = fs.readFileSync(path.join(__dirname, "..", "assets", "js", "delegate.js"), "utf8");
  assert(adminSrc.includes("resolveHusbandForSpouseWrite"), "admin uses resolveHusbandForSpouseWrite");
  assert(delegateSrc.includes("resolveHusbandForSpouseWrite"), "delegate uses resolveHusbandForSpouseWrite");
  assert(adminSrc.includes("husband_person_id"), "admin writes husband_person_id foundation");
  assert(delegateSrc.includes("husband_person_id"), "delegate writes husband_person_id foundation");
  assert(!/eq\("name", name\)\.limit\(1\)/.test(adminSrc), "admin no name+limit(1)");
  assert(!/eq\("name", name\)\.limit\(1\)/.test(delegateSrc), "delegate no name+limit(1)");
  assert(CP.MSG.SPOUSE_001.includes("SPOUSE-001"), "SPOUSE-001 Arabic message present");

  if (failed) {
    console.error("\n" + failed + " test(s) failed");
    process.exit(1);
  }
  console.log("\nAll Patch 3 spouse smoke tests passed.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
