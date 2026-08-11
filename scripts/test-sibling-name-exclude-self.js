#!/usr/bin/env node
/**
 * Sibling name collision: exclude self on edit; still block new duplicate.
 * Run: node scripts/test-sibling-name-exclude-self.js
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
  document: {
    getElementById: () => null,
    createElement: () => ({
      style: {},
      classList: { add() {}, remove() {}, toggle() {} },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
      appendChild() {},
      addEventListener() {},
    }),
    body: { appendChild() {} },
  },
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

const FM = sandbox.AlzidanFamilyPersonCore;
if (!FM || typeof FM.findSiblingNameCollision !== "function") {
  console.error("FAIL: findSiblingNameCollision missing");
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

const norm = (v) => String(v || "").replace(/\s+/g, " ").trim();
const baseName = (v) => {
  const n = norm(v);
  const parts = n.split("/").map(norm).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : n;
};

const salemA = "مزيد بن مطلق بن زيدان/صلف/دوخي/سالم";
const salemB = "مزيد بن مطلق بن زيدان/صلف/دوخى/سالم"; // alt spelling
const hadiriPath = salemB + "/حضيري";
const hadiriPid = "11111111-1111-1111-1111-111111111111";

const siblings = [
  {
    name: hadiriPath,
    personId: hadiriPid,
    parentPersonId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  },
  {
    name: salemA + "/دوخي",
    personId: "22222222-2222-2222-2222-222222222222",
    parentPersonId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  },
];

// Simulate admin updateChild gate: same base name → no collision check needed.
const currentBase = baseName(hadiriPath);
const editBase = baseName("حضيري");
assert(editBase === currentBase, "حضيري edit keeps same base → birth_order allowed without rename");

// If rename path were taken with built !== childId, exclude self by path/person_id.
const selfHit = FM.findSiblingNameCollision(siblings, "حضيري", {
  normalizePersonName: norm,
  normalizePersonBaseName: baseName,
});
assert(selfHit === hadiriPath, "without exclude, finds existing حضيري");

const excludedById = FM.findSiblingNameCollision(siblings, "حضيري", {
  normalizePersonName: norm,
  normalizePersonBaseName: baseName,
  excludeChildId: hadiriPath,
});
assert(!excludedById, "excludeChildId → update birth_order allowed");

const excludedByPid = FM.findSiblingNameCollision(siblings, "حضيري", {
  normalizePersonName: norm,
  normalizePersonBaseName: baseName,
  excludePersonId: hadiriPid,
});
assert(!excludedByPid, "excludePersonId → update birth_order allowed");

// New sibling with same name under same father → still blocked.
const addDup = FM.findSiblingNameCollision(siblings, "حضيري", {
  normalizePersonName: norm,
  normalizePersonBaseName: baseName,
});
assert(!!addDup, "add second حضيري under same father → blocked");

const otherName = FM.findSiblingNameCollision(siblings, "زيد", {
  normalizePersonName: norm,
  normalizePersonBaseName: baseName,
});
assert(!otherName, "different sibling name → no collision");

// Static guard: admin updateChild must exclude self / skip same-base rename.
const adminSrc = fs.readFileSync(
  path.join(__dirname, "..", "assets/js/admin-family-mgmt.js"),
  "utf8",
);
assert(
  /excludeChildId:\s*childId/.test(adminSrc) &&
    /excludePersonId/.test(adminSrc) &&
    /newBase !== currentBase/.test(adminSrc),
  "admin familyApiUpdateChild excludes self / skips same-base rename",
);

const insertSql = fs.readFileSync(
  path.join(__dirname, "..", "scripts/tree-children-insert-exclude-self.sql"),
  "utf8",
);
assert(
  /c\.id <> v_id/.test(insertSql) &&
    /person_id is distinct from v_person_id/.test(insertSql),
  "RPC SQL excludes current id/person_id from child_already_exists",
);

if (failed) {
  console.error("\n" + failed + " failure(s)");
  process.exit(1);
}
console.log("\nAll sibling-name exclude-self checks passed.");
