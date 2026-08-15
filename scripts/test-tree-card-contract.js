#!/usr/bin/env node
/**
 * tree_card canonical contract + full-edit recovery regression.
 * Run: node scripts/test-tree-card-contract.js
 */
"use strict";

const path = require("path");
const Contract = require(path.join(
  __dirname,
  "..",
  "assets/js/modules/tree-card-contract.js",
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

const modernRx = [
  "طلب: أضف فردًا للعائلة",
  "",
  "رقم الطلب: REQ-TEST-1",
  "العائلة: زيدان",
  "الأب / السياق: محمد",
  "الاسم: عبدالمجيد",
  "",
  "__JSON__:",
  JSON.stringify(
    {
      v: 1,
      kind: "tree_card",
      rx: "v1",
      branch_key: "زيدان",
      father: "محمد",
      father_path: "زيدان بن مطلق بن زيدان/فايز/نزال/غازي/هاجس/محمد",
      parent_person_id: "a02b3514-4499-4c13-84d4-c3d3480c52a8",
      parent_node_id: "زيدان بن مطلق بن زيدان/فايز/نزال/غازي/هاجس/محمد",
      name: "عبدالمجيد",
      ancestors: ["هاجس", "غازي"],
      children: [],
      submitter: { name: "مرسل", phone: "0500000000", email: "" },
      created_at: "2026-08-10T00:00:00.000Z",
    },
    null,
    2,
  ),
].join("\n");

const legacyNoJson = [
  "بطاقة إضافة بيانات للشجرة",
  "",
  "رقم الطلب: REQ-OLD-1",
  "العائلة (إجباري): زيدان",
  "الجد 1 (إجباري): هاجس",
  "الأب (إجباري): محمد",
  "الاسم (إجباري): عبدالمجيد",
  "تاريخ الميلاد (اختياري): ",
  "المدينة (اختياري): حائل",
  "الحي/القرية (اختياري): ",
  "",
  "الأبناء (اختياري):",
  "(لا يوجد)",
  "",
  "بيانات المرسل (إجباري):",
  "الاسم: مرسل قديم",
  "الجوال: 0511111111",
  "البريد (اختياري): ",
].join("\n");

const malformed = [
  "بطاقة إضافة بيانات للشجرة",
  "العائلة (إجباري): زيدان",
  "الأب (إجباري): محمد",
  "الاسم (إجباري): سالم",
  "",
  "__JSON__:",
  "{ not json",
].join("\n");

const legacySchema = [
  "بطاقة",
  "__JSON__:",
  JSON.stringify({
    v: 1,
    kind: "tree_card",
    branch_key: "مزيد",
    father: "خميس",
    name: "حسن",
    grandfather: "ساير",
    children: [{ name: "ابن", dob: "" }],
    submitter: { name: "س", phone: "05", email: "" },
  }),
].join("\n");

// 1 modern RX
{
  const p = Contract.parseTreeCardRequestMessage(modernRx, {
    kind: "tree_card",
    request_id: "REQ-TEST-1",
  });
  assert(p.jsonValid, "1 modern: jsonValid");
  assert(p.payload && p.payload.parent_person_id, "1 modern: parent_person_id");
  assert(p.payload.name === "عبدالمجيد", "1 modern: name");
  const q = Contract.assessRequestQuality({
    kind: "tree_card",
    branch_key: "زيدان",
    message: modernRx,
  });
  assert(q && q.level === "complete", "1 modern: quality complete");
}

// 2 old without JSON
{
  const p = Contract.parseTreeCardRequestMessage(legacyNoJson, {
    kind: "tree_card",
    branch_key: "زيدان",
    request_id: "REQ-OLD-1",
  });
  assert(p.ok && p.payload, "2 legacy: opens with payload");
  assert(!p.jsonValid, "2 legacy: not jsonValid");
  assert(p.payload.name === "عبدالمجيد", "2 legacy: recovered name");
  assert(p.payload.father === "محمد", "2 legacy: recovered father");
  assert(p.payload.parent_person_id === "", "2 legacy: no invented person_id");
  assert(
    p.status === "recoverable" || p.status === "needs_review",
    "2 legacy: recoverable/needs_review",
  );
}

// 3 malformed JSON → recovery
{
  const p = Contract.parseTreeCardRequestMessage(malformed, {
    kind: "tree_card",
    branch_key: "زيدان",
  });
  assert(p.ok && p.payload, "3 malformed: payload via recovery");
  assert(p.payload.name === "سالم", "3 malformed: recovered name");
  assert(!p.jsonValid, "3 malformed: jsonValid false");
}

// 4 legacy schema normalize
{
  const p = Contract.parseTreeCardRequestMessage(legacySchema, {
    kind: "tree_card",
  });
  assert(p.jsonValid, "4 legacy schema: jsonValid");
  const n = Contract.normalizeTreeCardPayload(p.payload);
  assert(n.schema === "tree_card.v1", "4 schema stamped");
  assert(Array.isArray(n.children) && n.children.length === 1, "4 children");
  assert(n.parent_person_id === n.father_person_id, "4 parent aliases aligned");
}

// 5 parent_person_id present
{
  const p = Contract.parseTreeCardRequestMessage(modernRx);
  assert(!!p.payload.parent_person_id, "5 parent present");
}

// 6 parent missing — recoverable without inventing
{
  const msg = [
    "بطاقة إضافة بيانات للشجرة",
    "العائلة (إجباري): زيدان",
    "الأب (إجباري): محمد",
    "الاسم (إجباري): زيد",
  ].join("\n");
  const p = Contract.parseTreeCardRequestMessage(msg, { branch_key: "زيدان" });
  assert(p.payload.father === "محمد", "6 father text");
  assert(p.payload.parent_person_id === "", "6 no invented uuid");
}

// 7 ambiguous parent is a validation concern (no auto-pick here)
{
  const v = Contract.validateTreeCardPayload(
    Contract.normalizeTreeCardPayload({
      branch_key: "زيدان",
      name: "س",
      father: "محمد",
    }),
    { requireParentPersonId: true },
  );
  assert(v.level === "needs_review" || !v.ok, "7 requireParentPersonId → review");
}

// 8 missing branch
{
  const v = Contract.validateTreeCardPayload(
    Contract.normalizeTreeCardPayload({ name: "س", father: "م" }),
  );
  assert(v.needs_review.indexOf("branch_key") >= 0, "8 missing branch");
}

// 9 children missing → array
{
  const n = Contract.normalizeTreeCardPayload({
    branch_key: "زيدان",
    name: "س",
    father: "م",
    children: null,
  });
  assert(Array.isArray(n.children) && n.children.length === 0, "9 children array");
}

// 10 tree_rows missing → array
{
  const n = Contract.normalizeTreeCardPayload({
    branch_key: "زيدان",
    name: "س",
    father: "م",
  });
  assert(Array.isArray(n.tree_rows), "10 tree_rows array");
}

// 11/12 pending+approved parse same
{
  const p1 = Contract.parseTreeCardRequestMessage(modernRx, {
    status: "pending",
  });
  const p2 = Contract.parseTreeCardRequestMessage(modernRx, {
    status: "approved",
  });
  assert(p1.payload.name === p2.payload.name, "11/12 status-agnostic parse");
}

// 13 update branch serialize
{
  const p = Contract.parseTreeCardRequestMessage(legacyNoJson, {
    branch_key: "زيدان",
  });
  p.payload.branch_key = "مزيد";
  const msg = Contract.serializeTreeCardRequest(p.payload, {
    request_id: "REQ-OLD-1",
  });
  assert(msg.indexOf("__JSON__:") >= 0, "13 serialized has marker");
  assert(msg.indexOf('"branch_key": "مزيد"') >= 0, "13 branch updated in JSON");
  const again = Contract.parseTreeCardRequestMessage(msg);
  assert(again.jsonValid && again.payload.branch_key === "مزيد", "13 roundtrip");
}

// 14 create gate rejects no json
{
  const gate = Contract.assertCreatableEnvelope(legacyNoJson, {
    kind: "tree_card",
    branch_key: "زيدان",
  });
  assert(!gate.ok, "14 create rejects legacy without JSON");
}

// 15 create gate accepts modern + rewrites canonical
{
  const gate = Contract.assertCreatableEnvelope(modernRx, {
    kind: "tree_card",
    request_id: "REQ-TEST-1",
  });
  assert(gate.ok && gate.message.indexOf("tree_card.v1") >= 0, "15 create ok");
}

// 16 null / 17 empty message
{
  const a = Contract.parseTreeCardRequestMessage(null, { branch_key: "زيدان" });
  const b = Contract.parseTreeCardRequestMessage("", { branch_key: "زيدان" });
  assert(a.ok && a.payload && a.payload.recovery, "16 null → recovery shell");
  assert(b.ok && b.payload && b.payload.recovery, "17 empty → recovery shell");
}

// 18 unicode arabic
{
  const msg =
    "العائلة (إجباري): زيدان\nالأب (إجباري): عبدالله\nالاسم (إجباري): عبدالرحمن\n";
  const p = Contract.parseTreeCardRequestMessage(msg, { branch_key: "زيدان" });
  assert(p.payload.name === "عبدالرحمن", "18 arabic name");
}

// 19 old path format
{
  const msg =
    "__JSON__:\n" +
    JSON.stringify({
      kind: "tree_card",
      branch_key: "زيدان",
      father: "محمد",
      father_path: "هاجس/محمد",
      name: "سعد",
    });
  const p = Contract.parseTreeCardRequestMessage(msg);
  assert(p.payload.father_path === "هاجس/محمد", "19 old path kept");
  assert(p.payload.parent_node_id === "هاجس/محمد", "19 aliased to parent_node_id");
}

// 20 canonical serialize
{
  const msg = Contract.serializeTreeCardRequest(
    {
      branch_key: "زيدان",
      father: "محمد",
      name: "سعد",
      parent_person_id: "uuid-1",
    },
    { request_id: "REQ-C" },
  );
  const p = Contract.parseTreeCardRequestMessage(msg);
  assert(p.jsonValid && p.payload.schema === "tree_card.v1", "20 canonical schema");
  assert(p.payload.father_person_id === "uuid-1", "20 father_person_id mirrored");
}

// Regression: full edit must never silently null on legacy
{
  const p = Contract.parseTreeCardRequestMessage(legacyNoJson, {
    kind: "tree_card",
    branch_key: "زيدان",
    status: "pending",
  });
  assert(!!p.payload, "REGRESSION: legacy full-edit payload non-null");
  assert(p.ok === true, "REGRESSION: parse ok for editor open");
}

// Idempotent serialize
{
  const once = Contract.serializeTreeCardRequest(
    Contract.parseTreeCardRequestMessage(modernRx).payload,
    { request_id: "REQ-TEST-1" },
  );
  const twice = Contract.serializeTreeCardRequest(
    Contract.parseTreeCardRequestMessage(once).payload,
    { request_id: "REQ-TEST-1" },
  );
  const a = Contract.parseTreeCardRequestMessage(once).payload;
  const b = Contract.parseTreeCardRequestMessage(twice).payload;
  assert(a.name === b.name && a.parent_person_id === b.parent_person_id, "idempotent serialize");
}

if (failed) {
  console.error("\n" + failed + " assertion(s) failed");
  process.exit(1);
}
console.log("\nAll tree_card contract tests passed.");
