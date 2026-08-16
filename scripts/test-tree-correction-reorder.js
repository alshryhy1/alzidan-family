#!/usr/bin/env node
/**
 * reorder_children correction contract regression.
 * Run: node scripts/test-tree-correction-reorder.js
 */
"use strict";

const path = require("path");
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

const parentId = "11111111-1111-1111-1111-111111111111";
const c1 = "22222222-2222-2222-2222-222222222222";
const c2 = "33333333-3333-3333-3333-333333333333";
const c3 = "44444444-4444-4444-4444-444444444444";

const readyPayload = {
  branch_key: "لاحم",
  parent_person_id: parentId,
  parent_name: "محمد",
  ordered_children: [
    { person_id: c1, name: "عبدالرحمن" },
    { person_id: c2, name: "فايز" },
    { person_id: c3, name: "فوزان" },
  ],
  source: "web_rx",
  submitter: { name: "مرسل", phone: "0500000000" },
};

const gate = Contract.assertCreatableReorder(readyPayload);
assert(gate.ok, "ready reorder is creatable");
assert(
  String(gate.message || "").indexOf("__JSON__:") >= 0,
  "serialized message has JSON marker"
);
assert(
  String(gate.message || "").indexOf("reorder_children") >= 0,
  "serialized message includes operation"
);

const parsed = Contract.parseCorrectionMessage(gate.message);
assert(parsed.ok, "parse round-trip ok");
assert(parsed.operation === "reorder_children", "operation preserved");
assert(parsed.ready === true, "ready when all person_ids + parent");

const tree = [
  { person_id: c1, name: "عبدالرحمن", birth_order: 3 },
  { person_id: c2, name: "فايز", birth_order: 1 },
  { person_id: c3, name: "فوزان", birth_order: 2 },
];
const match = Contract.matchChildrenToTree(readyPayload.ordered_children, tree);
assert(match.complete, "match complete by person_id");
assert(
  match.ordered_person_ids.join(",") === [c1, c2, c3].join(","),
  "ordered ids follow request"
);

const preview = Contract.buildReorderPreview(tree, match.ordered_person_ids);
assert(preview.assignments && preview.assignments.length === 3, "assignments cover full group");
assert(
  preview.changes_summary.indexOf("1…") >= 0 ||
    preview.changes_summary.indexOf("صراحة") >= 0,
  "preview states explicit 1..N assignment"
);
assert(
  preview.unchanged.join(" ").indexOf("الجوالات") >= 0 ||
    preview.unchanged_summary.indexOf("جوال") >= 0,
  "preview states phones will not change"
);

const verifyOk = Contract.verifyCanonicalBirthOrder(
  [
    { person_id: c1, name: "عبدالرحمن", birth_order: 1 },
    { person_id: c2, name: "فايز", birth_order: 2 },
    { person_id: c3, name: "فوزان", birth_order: 3 },
  ],
  [c1, c2, c3]
);
assert(verifyOk.ok, "verify passes when birth_order is canonical 1..N");

const verifyFail = Contract.verifyCanonicalBirthOrder(
  [
    { person_id: c1, name: "عبدالرحمن", birth_order: null },
    { person_id: c2, name: "فايز", birth_order: 2 },
    { person_id: c3, name: "فوزان", birth_order: 3 },
  ],
  [c1, c2, c3]
);
assert(!verifyFail.ok, "verify fails when any birth_order missing/wrong");

const amb = Contract.matchChildrenToTree(
  [{ name: "سالم" }, { name: "سالم" }],
  [
    { person_id: c1, name: "سالم" },
    { person_id: c2, name: "سالم" },
  ]
);
assert(!amb.complete, "ambiguous same-name siblings → not complete");
assert(amb.ambiguous.length >= 1, "ambiguous reported");

// Given-name under confirmed parent: "عبدالرحمن عقلا" → leaf عبدالرحمن
const given = Contract.matchChildrenToTree(
  [
    { name: "عبدالرحمن عقلا" },
    { name: "فايز عقلا" },
    { name: "فوزان عقلا" },
  ],
  [
    { person_id: c1, name: "عبدالرحمن", birth_order: 2 },
    { person_id: c2, name: "فايز", birth_order: 1 },
    { person_id: c3, name: "فوزان", birth_order: 3 },
  ]
);
assert(given.complete, "unique given-name under parent matches");
assert(
  given.ordered_person_ids.join(",") === [c1, c2, c3].join(","),
  "given-name order follows request"
);

const extracted = Contract.extractReorderCandidateNames(
  [
    "طلب تصحيح بيانات من تطبيق عائلة الزيدان",
    "الفرع: لاحم",
    "التصحيح المطلوب: ترتيب الأبناء عبدالرحمن عقلا ثم فايز عقلا ثم فوزان عقلا ثم زايد عقلا ثم سلمان عقلا ثم فوزي عقلا ثم فايد عقلا",
  ].join("\n")
);
assert(extracted.length === 7, "extract 7 names from legacy correction text");
assert(extracted[0].indexOf("عبدالرحمن") >= 0, "first extracted is عبدالرحمن…");

const level2 = Contract.assessMatchLevel({
  parent_person_id: "",
  requested: extracted.map(function (n) {
    return { name: n };
  }),
  match: { matched: [], ambiguous: [], unmatched: [] },
});
assert(level2.level === 2, "no parent → level 2 pending_parent");

const previewBlocked = Contract.buildReorderPreview([], [], { ready: false });
assert(
  previewBlocked.changes_summary.indexOf("غير محسوب") >= 0,
  "preview blocked before match"
);

const nameOnly = Contract.validateReorderPayload({
  branch_key: "لاحم",
  parent_person_id: parentId,
  ordered_children: [{ name: "أ" }, { name: "ب" }],
});
assert(nameOnly.review_state === "needs_review", "names without ids → needs_review");
assert(nameOnly.creatable === true, "still creatable for admin matching");

const legacyRow = {
  kind: "tree_card",
  branch_key: "لاحم",
  message:
    "طلب تصحيح بيانات من تطبيق عائلة الزيدان\n" +
    "الاسم/المسار: لاحم/...\n" +
    "التصحيح المطلوب: ترتيب الأبناء عبدالرحمن ثم فايز ثم فوزان",
};
const legacy = Contract.classifyLegacyCorrection(legacyRow);
assert(legacy.safeReview === true, "legacy misclassified tree_card → safe review");
assert(legacy.isMisclassifiedTreeCard === true, "flagged as misclassified tree_card");
assert(legacy.route === "safe_review", "route safe_review");

const routedLegacy = Contract.routeRequest(legacyRow);
assert(routedLegacy.blockTreeCardApply === true, "blocks tree_card apply");
assert(routedLegacy.blockTreeCardEditor === true, "blocks tree_card editor");

const routedReady = Contract.routeRequest({
  kind: "tree_edit",
  branch_key: "لاحم",
  message: gate.message,
});
assert(routedReady.route === "reorder_children", "router → reorder_children");
assert(routedReady.open === "reorder_editor", "opens reorder editor");

const quality = Contract.assessReorderQuality({
  kind: "tree_edit",
  message: gate.message,
});
assert(quality && quality.key === "complete", "quality complete when ready");

const legacyQuality = Contract.assessReorderQuality(legacyRow);
assert(
  legacyQuality && legacyQuality.key === "review",
  "legacy quality needs review"
);

// No invent person_id from name alone when zero tree hits
const miss = Contract.matchChildrenToTree(
  [{ name: "غيرموجود" }],
  [{ person_id: c1, name: "عبدالرحمن" }]
);
assert(!miss.complete && miss.unmatched.length === 1, "unmatched name → no invent");

if (failed) {
  console.error("\n" + failed + " failure(s)");
  process.exit(1);
}
console.log("\nAll reorder_children contract tests passed.");
