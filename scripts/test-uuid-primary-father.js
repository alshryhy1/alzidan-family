#!/usr/bin/env node
"use strict";

/**
 * Regression: valid parent_person_id is primary father evidence.
 * Short-path rows 1738/1739/1740 must leave missing_father; text≠UUID → path_mismatch review.
 */

const path = require("path");
const fs = require("fs");
const vm = require("vm");

function loadModule(rel) {
  const src = fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
  const ctx = {
    window: {},
    console,
    module: { exports: {} },
    exports: {},
  };
  ctx.globalThis = ctx;
  ctx.window = ctx;
  vm.runInNewContext(src, ctx, { filename: rel });
  return ctx.module.exports;
}

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("ok:", msg);
  }
}

const Struct = loadModule("assets/js/modules/integrity-tree-structure-audit.js");

const nadaPid = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const tuaisanPid = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const hamadPid = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const mohammadPid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

// Chain: محمد ← حمد ← طعيسان ← نداء (short self/father paths)
const nada = {
  id: 1700,
  branch_key: "مزيد",
  name: "نداء",
  child_name: "نداء",
  parent: "مزيد",
  parent_name: "مزيد",
  person_id: nadaPid,
};

const tuaisan = {
  id: 1740,
  branch_key: "مزيد",
  name: "طعيسان/نداء",
  child_name: "طعيسان/نداء",
  parent: "طعيسان",
  parent_name: "طعيسان",
  person_id: tuaisanPid,
  parent_person_id: nadaPid,
};

const hamad = {
  id: 1739,
  branch_key: "مزيد",
  name: "حمد/طعيسان",
  child_name: "حمد/طعيسان",
  parent: "حمد",
  parent_name: "حمد",
  person_id: hamadPid,
  parent_person_id: tuaisanPid,
};

const mohammad = {
  id: 1738,
  branch_key: "مزيد",
  name: "محمد/حمد",
  child_name: "محمد/حمد",
  parent: "محمد",
  parent_name: "محمد",
  person_id: mohammadPid,
  parent_person_id: hamadPid,
};

const children = [nada, tuaisan, hamad, mohammad];
const report = Struct.auditTreeStructure(children, []);

const missIds = (report.lists.missing_father || []).map((r) => Number(r.id));
assert(!missIds.includes(1738), "1738 not missing_father (UUID→حمد)");
assert(!missIds.includes(1739), "1739 not missing_father (UUID→طعيسان)");
assert(!missIds.includes(1740), "1740 not missing_father (UUID→نداء)");
assert(
  report.totals.missing_father === 0,
  "chain: missing_father count 0",
);

const pmById = new Map(
  (report.lists.path_mismatch || []).map((r) => [Number(r.id), r]),
);
assert(pmById.has(1738), "1738 text≠UUID → path_mismatch review");
assert(pmById.has(1739), "1739 text≠UUID → path_mismatch review");
assert(pmById.has(1740), "1740 text≠UUID → path_mismatch review");

assert(
  /محمد→حمد/.test(String(pmById.get(1738).relation_via_uuid_ar || "")),
  "1738 relation via UUID محمد→حمد",
);
assert(
  /حمد→طعيسان/.test(String(pmById.get(1739).relation_via_uuid_ar || "")),
  "1739 relation via UUID حمد→طعيسان",
);
assert(
  /طعيسان→نداء/.test(String(pmById.get(1740).relation_via_uuid_ar || "")),
  "1740 relation via UUID طعيسان→نداء",
);
assert(
  /عدم تطابق\/مراجعة/.test(String(pmById.get(1738).reason_ar || "")),
  "1738 reason uses عدم تطابق/مراجعة",
);

// UUID + agreeing text parent → healthy (not missing_father, not path_mismatch)
const fatherOk = {
  id: 10,
  branch_key: "مزيد",
  name: "مزيد بن مطلق بن زيدان/صلف/دوخي",
  child_name: "مزيد بن مطلق بن زيدان/صلف/دوخي",
  parent: "مزيد بن مطلق بن زيدان/صلف",
  parent_name: "مزيد بن مطلق بن زيدان/صلف",
  person_id: "father-ok",
};
const childOk = {
  id: 11,
  branch_key: "مزيد",
  name: "مزيد بن مطلق بن زيدان/صلف/دوخي/سالم",
  child_name: "مزيد بن مطلق بن زيدان/صلف/دوخي/سالم",
  parent: "مزيد بن مطلق بن زيدان/صلف/دوخي",
  parent_name: "مزيد بن مطلق بن زيدان/صلف/دوخي",
  person_id: "child-ok",
  parent_person_id: "father-ok",
};
const okReport = Struct.auditTreeStructure([fatherOk, childOk], []);
assert(
  !(okReport.lists.missing_father || []).some((r) => Number(r.id) === 11),
  "agreeing UUID+text: not missing_father",
);
assert(
  !(okReport.lists.path_mismatch || []).some((r) => Number(r.id) === 11),
  "agreeing UUID+text: not path_mismatch",
);

// Still missing_father when UUID broken AND text absent from tree
const orphan = {
  id: 99,
  branch_key: "مزيد",
  name: "مزيد بن مطلق بن زيدان/صلف/شبح/ولد",
  child_name: "مزيد بن مطلق بن زيدان/صلف/شبح/ولد",
  parent: "مزيد بن مطلق بن زيدان/صلف/شبح",
  parent_name: "مزيد بن مطلق بن زيدان/صلف/شبح",
  person_id: "orphan",
  parent_person_id: "dead-uuid-not-in-index",
};
const missReport = Struct.auditTreeStructure([fatherOk, orphan], []);
assert(
  (missReport.lists.missing_father || []).some((r) => Number(r.id) === 99),
  "broken UUID + missing text father → still missing_father",
);

if (process.exitCode) {
  console.error("\nverify:uuid-primary-father FAILED");
  process.exit(1);
}
console.log("\nverify:uuid-primary-father passed");
