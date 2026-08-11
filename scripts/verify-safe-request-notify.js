#!/usr/bin/env node
/**
 * Mandatory hardening gate:
 * - unknown kinds → null (DO NOT SEND), never raw message fallback
 * - status_changed Arabic structured only
 * - scrubRecordForNotify strips message
 * - edge email/push contain safeRender + block paths
 * - HTML wires safe-request-notify.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("OK:", msg);
  }
}

const safePath = path.join(root, "assets/js/modules/safe-request-notify.js");
const code = fs.readFileSync(safePath, "utf8");
const sandbox = { window: {}, console };
vm.runInNewContext(code, sandbox);
const Safe = sandbox.window.AlzidanSafeRequestNotify;
assert(!!Safe, "AlzidanSafeRequestNotify exported");

const known = Safe.safeRenderOutbound({
  mode: "status_changed",
  kind: "event_card",
  status: "rejected",
  branch_key: "مزيد",
  person: "أحمد",
  audience: "submitter",
});
assert(!!known, "known kind+status renders");
assert(known.body.indexOf("تحديث طلبك في عائلة الزيدان") === 0, "structured Arabic lead");
assert(known.body.indexOf("تم الرفض") >= 0, "rejected status Arabic");
assert(!/__JSON__|events_audit|"v"\s*:/.test(known.body), "no JSON markers in body");

const unknown = Safe.safeRenderOutbound({
  mode: "status_changed",
  kind: "events_audit",
  status: "approved",
  audience: "submitter",
});
assert(unknown === null, "audit kind blocked (null, no send)");

const weird = Safe.safeRenderOutbound({
  mode: "status_changed",
  kind: "totally_unknown_kind_xyz",
  status: "approved",
  audience: "submitter",
});
assert(weird === null, "unknown kind blocked (null, no send)");

const badAudience = Safe.safeRenderOutbound({
  mode: "status_changed",
  kind: "tree_card",
  status: "approved",
  audience: "delegate",
});
assert(badAudience === null, "status notify to delegate blocked");

const scrubbed = Safe.scrubRecordForNotify({
  request_id: "REQ1",
  kind: "event_card",
  branch_key: "مزيد",
  status: "approved",
  email: "a@b.com",
  phone: "0500000000",
  message: '__JSON__:{"v":1,"op":"insert","events_audit":true}',
  name: "أحمد",
});
assert(!("message" in scrubbed) || scrubbed.message == null, "scrub drops message field");
assert(JSON.stringify(scrubbed).indexOf("__JSON__") < 0, "scrub payload has no __JSON__");

const uiLeak = Safe.safeUiDetailText('نص عربي\n__JSON__:{"v":1,"secret_hash":"x"}');
assert(uiLeak.indexOf("__JSON__") < 0, "UI detail strips __JSON__");
assert(uiLeak.indexOf("secret_hash") < 0, "UI detail strips secret_hash");

// Surfaces
const surfaces = [
  "supabase/functions/alzidan-email-notify/index.ts",
  "supabase/functions/alzidan-push-notify/index.ts",
  "assets/js/modules/requests.js",
  "assets/js/modules/home-request-create.js",
  "assets/js/delegate.js",
  "pages/index.html",
  "pages/alzidan-tree.html",
  "pages/admin.html",
  "supabase/sql/COPY-ME-delegate-branch-requests-expand.sql",
];
for (const rel of surfaces) {
  const src = fs.readFileSync(path.join(root, rel), "utf8");
  if (rel.includes("email-notify") || rel.includes("push-notify")) {
    assert(
      src.includes("safeRender") || src.includes("safeRenderOutbound") || src.includes("safeRenderPush"),
      rel + ": has safe renderer"
    );
    assert(
      src.includes("unknown_kind_blocked") ||
        src.includes("unknown_or_internal_kind_blocked") ||
        src.includes("safe_render_blocked"),
      rel + ": blocks unknown kinds"
    );
    assert(!/نص الطلب:/.test(src), rel + ": no raw message dump label");
    assert(src.includes("تحديث طلبك"), rel + ": structured status Arabic");
  } else if (rel.endsWith(".html")) {
    assert(src.includes("safe-request-notify.js?v=20260812safe2"), rel + ": wires safe-request-notify cache-bust");
  } else if (rel.includes("COPY-ME-delegate")) {
    assert(
      src.includes("status in ('pending', 'approved', 'rejected')"),
      "list RPC persists approved/rejected"
    );
  } else {
    assert(
      src.includes("scrubRecordForNotify") || src.includes("AlzidanSafeRequestNotify"),
      rel + ": uses safe notify path"
    );
  }
}

if (process.exitCode) {
  console.error("\nVerification failed.");
  process.exit(1);
}
console.log("\nAll safe-request-notify hardening checks passed.");
