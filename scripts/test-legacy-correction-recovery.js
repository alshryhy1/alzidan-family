#!/usr/bin/env node
/**
 * Legacy correction recovery — Abdularahman Aqla reorder regression.
 * Run: node scripts/test-legacy-correction-recovery.js
 */
"use strict";

const path = require("path");
const Legacy = require(path.join(
  __dirname,
  "..",
  "assets/js/modules/tree-correction-legacy-recovery.js",
));
const Contract = require(path.join(
  __dirname,
  "..",
  "assets/js/modules/tree-correction-contract.js",
));

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error("FAIL:", msg);
  } else {
    console.log("OK:", msg);
  }
}

const RAW = [
  "طلب تصحيح بيانات من تطبيق عائلة الزيدان",
  "الفرع: لاحم",
  "الاسم/المسار: ترتيب الاسماء بالترتيب الصحيح",
  "التصحيح المطلوب: ١-عبدالرحمن عقلا",
  "٢-فايز عقلا",
  "٣-فوزان عقلا",
  "٤-زايد عقلا",
  "٥-سلمان عقلا",
  "٦-فوزي عقلا",
  "٧-فايد عقلا",
  "المرسل: عبدالرحمن عقلا",
].join("\n");

const parsed = Legacy.parseLegacyCorrectionRecovery(RAW);
assert(parsed.ok, "recovery ok on raw admin message");
assert(parsed.operation === "reorder_children", "operation reorder_children");
assert(parsed.branch_key === "لاحم", "branch لاحم");
assert(parsed.targets.length === 7, "exactly 7 targets");
assert(
  parsed.targets.join("|") ===
    [
      "عبدالرحمن عقلا",
      "فايز عقلا",
      "فوزان عقلا",
      "زايد عقلا",
      "سلمان عقلا",
      "فوزي عقلا",
      "فايد عقلا",
    ].join("|"),
  "targets in request order without digit prefixes"
);
assert(
  parsed.sender_name === "عبدالرحمن عقلا",
  "sender is عبدالرحمن عقلا (requester)"
);
assert(
  parsed.targets[0] === "عبدالرحمن عقلا",
  "sender may also appear as first target — still a target from numbered list"
);

// Western digits variant
const WEST = [
  "التصحيح المطلوب:",
  "1-عبدالرحمن عقلا",
  "2-فايز عقلا",
  "3-فوزان عقلا",
].join("\n");
const west = Legacy.parseLegacyCorrectionRecovery(WEST);
assert(west.targets.length === 3, "western digits numbered list");

// Contract delegates
const viaContract = Contract.extractReorderCandidateNames(RAW);
assert(viaContract.length === 7, "contract extractReorderCandidateNames → 7");

const viaParse = Contract.parseLegacyCorrectionRecovery(RAW);
assert(viaParse.ok && viaParse.targets.length === 7, "contract parseLegacy → 7");

// Match under parent after recovery (given-name)
const c = [
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
].map(function (x, i) {
  return "00000000-0000-0000-0000-00000000000" + (i + 1);
});
const tree = [
  { person_id: c[0], name: "عبدالرحمن" },
  { person_id: c[1], name: "فايز" },
  { person_id: c[2], name: "فوزان" },
  { person_id: c[3], name: "زايد" },
  { person_id: c[4], name: "سلمان" },
  { person_id: c[5], name: "فوزي" },
  { person_id: c[6], name: "فايد" },
];
const match = Contract.matchChildrenToTree(
  parsed.ordered_children,
  tree
);
assert(match.complete, "7/7 match under chosen parent");
assert(match.ordered_person_ids.length === 7, "7 ordered ids");

const level = Contract.assessMatchLevel({
  parent_person_id: "parent-uuid",
  match: match,
  requested: parsed.ordered_children,
});
assert(level.level === 1, "match level 1 complete");

// path hint must not become a target
assert(
  parsed.targets.every(function (t) {
    return t.indexOf("ترتيب") < 0;
  }),
  "path hint «ترتيب الاسماء…» is not a target"
);

if (failed) {
  console.error("\n" + failed + " failure(s)");
  process.exit(1);
}
console.log("\nLegacy recovery regression passed.");
