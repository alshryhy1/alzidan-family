#!/usr/bin/env node
/**
 * Spouse duplicate check — allow remarriage after divorce.
 * Run: node scripts/test-spouses-duplicate.js
 */
"use strict";

const path = require("path");
const fs = require("fs");

const modulePath = path.join(__dirname, "..", "assets", "js", "modules", "spouses-core.js");
const src = fs.readFileSync(modulePath, "utf8");
const sandbox = { window: {}, module: { exports: {} } };
Function("window", src + "\n;")(sandbox.window);
const SC = sandbox.window.AlzidanSpousesCore;
if (!SC) {
  console.error("FAIL: AlzidanSpousesCore not loaded");
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

const wifeLineage = "فاطمة بنت أحمد بن محمد";
const wifeKey = SC.wifeDuplicateKey(wifeLineage);

const mockRows = [
  {
    id: 1,
    husband_id: 10,
    wife_name: wifeLineage,
    wife_lineage: wifeLineage,
    status: "divorced",
  },
  {
    id: 2,
    husband_id: 20,
    wife_name: "زوجة أخرى",
    wife_lineage: "زوجة أخرى بنت x بن y",
    status: "active",
  },
];

const mockClient = {
  _mode: "select",
  _patch: null,
  from() {
    return this;
  },
  select() {
    this._mode = "select";
    return this;
  },
  order() {
    return this;
  },
  range(from, to) {
    return Promise.resolve({ data: mockRows.slice(from, to + 1), error: null });
  },
  update(patch) {
    this._mode = "update";
    this._patch = patch;
    return this;
  },
  eq(col, val) {
    if (this._mode === "update" && col === "id") {
      const row = mockRows.find(function (r) { return Number(r.id) === Number(val); });
      if (row && this._patch) Object.assign(row, this._patch);
      return Promise.resolve({ data: null, error: null });
    }
    return this;
  },
};

(async () => {
  assert(typeof SC.isActiveSpouse === "function", "isActiveSpouse exported");
  assert(SC.isActiveSpouse("active") === true, "active spouse");
  assert(SC.isActiveSpouse("") === true, "empty status treated as active");
  assert(SC.isActiveSpouse("divorced") === false, "divorced spouse inactive");

  assert(
    SC.wifeIdentityMatches(
      { wife_name: "حبيبه عبدالعزيز", wife_lineage: null },
      { wife_name: "حبيبه عبدالعزيز", wife_lineage: "حبيبه عبدالعزيز عيد صالح الاحم" },
    ),
    "short wife_name matches full lineage",
  );

  const dupBlocked = await SC.findDuplicateWife(mockClient, 30, {
    wife_name: wifeLineage,
    wife_lineage: wifeLineage,
  }, 0);
  assert(dupBlocked === null, "divorced prior marriage does not block new husband");

  mockRows[0].status = "active";
  const dupActive = await SC.findDuplicateWife(mockClient, 30, {
    wife_name: wifeLineage,
    wife_lineage: wifeLineage,
  }, 0);
  assert(dupActive && Number(dupActive.husband_id) === 10, "active prior marriage still blocks");

  mockRows[0].status = "active";
  const ended = await SC.endActiveSpouseMatchesElsewhere(mockClient, 30, {
    wife_name: wifeLineage,
    wife_lineage: wifeLineage,
  }, 0);
  assert(ended.ended === 1, "endActive marks prior marriage divorced");
  assert(mockRows[0].status === "divorced", "row status updated to divorced");
  const afterEnd = await SC.findDuplicateWife(mockClient, 30, {
    wife_name: wifeLineage,
    wife_lineage: wifeLineage,
  }, 0);
  assert(afterEnd === null, "after endActive insert allowed");

  const dupSameHusband = await SC.findDuplicateWife(mockClient, 10, {
    wife_name: wifeLineage,
    wife_lineage: wifeLineage,
  }, 0);
  assert(dupSameHusband === null, "same husband is not a duplicate");

  assert(wifeKey.split(" ").filter(Boolean).length >= 3, "fixture has three-part name");

  if (failed) {
    console.error("\n" + failed + " test(s) failed");
    process.exit(1);
  }
  console.log("\nAll spouse duplicate tests passed.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
