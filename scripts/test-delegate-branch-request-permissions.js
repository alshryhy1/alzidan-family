#!/usr/bin/env node
/**
 * Static checks: branch delegate accepts tree/correction/memory; card stays admin-only.
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const js = fs.readFileSync(path.join(root, "assets/js/delegate.js"), "utf8");
const createJs = fs.readFileSync(
  path.join(root, "assets/js/modules/home-request-create.js"),
  "utf8"
);
const emailTs = fs.readFileSync(
  path.join(root, "supabase/functions/alzidan-email-notify/index.ts"),
  "utf8"
);
const sql = fs.readFileSync(
  path.join(root, "supabase/sql/COPY-ME-delegate-branch-requests-expand.sql"),
  "utf8"
);

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error("FAIL:", msg);
  } else {
    console.log("OK:", msg);
  }
}

assert(js.includes('intent: "tree"') && /tree_card[\s\S]{0,180}canAct:\s*true/.test(js), "delegate: tree canAct true");
assert(/tree_edit[\s\S]{0,180}canAct:\s*true/.test(js) || /intent: "correction"[\s\S]{0,40}canAct:\s*true/.test(js), "delegate: correction canAct true");
assert(/intent: "memory"[\s\S]{0,60}canAct:\s*true/.test(js), "delegate: memory canAct true");
assert(/intentLabel: "طلب بطاقة", canAct:\s*false/.test(js), "delegate: card canAct false");
assert(js.includes("special_card") && js.includes("return false"), "delegate: special_card filtered out of queue");
assert(js.includes("applyDelegateTreeCardRequest"), "delegate: tree apply helper");
assert(js.includes("طلب البطاقة للإدارة المركزية فقط"), "delegate: UI scope copy");
assert(!js.includes("إضافة الفرد والتصحيح من الإدارة"), "delegate: old green-box copy gone");

assert(
  createJs.includes("memory_card: 1") &&
    createJs.includes("tree_edit: 1") &&
    /var allowed = \{[^}]*memory_card: 1[^}]*\}/.test(createJs) &&
    !/var allowed = \{[^}]*special_card: 1[^}]*\}/.test(createJs) &&
    createJs.includes("notifyAdminOfRequest") &&
    /var adminKinds = \{[^}]*special_card: 1[^}]*\}/.test(createJs),
  "notify allowlist: tree/memory yes, special_card no"
);

assert(emailTs.includes('kind === "tree_edit"'), "email notify: tree_edit routed to delegates");
assert(emailTs.includes("kind_admin_only"), "email notify: admin-only kind skip");
assert(
  (() => {
    const start = emailTs.indexOf("function isBranchNotifyKind");
    const end = emailTs.indexOf("\n}", start);
    const body = start >= 0 && end > start ? emailTs.slice(start, end + 2) : "";
    return (
      body.includes('kind === "tree_edit"') &&
      body.includes('kind === "memory_card"') &&
      !body.includes('kind === "special_card"')
    );
  })(),
  "email notify: special_card not branch-notify kind"
);

assert(sql.includes("'tree_card'"), "SQL expand includes tree_card");
assert(sql.includes("'tree_edit'"), "SQL expand includes tree_edit");
assert(sql.includes("'memory_card'"), "SQL expand includes memory_card");
assert(emailTs.includes("admin_new_request"), "email notify: admin_new_request mode");
assert(emailTs.includes("طلب جديد يحتاج مراجعتك"), "email notify: human Arabic subject");
assert(!emailTs.includes('return map[kind] || kind'), "email notify: no raw kind fallback");

const pushTs = fs.readFileSync(
  path.join(root, "supabase/functions/alzidan-push-notify/index.ts"),
  "utf8"
);
assert(pushTs.includes("admin_new_request"), "push notify: admin_new_request mode");
assert(pushTs.includes("طلب جديد يحتاج مراجعتك"), "push notify: human Arabic title");
assert(pushTs.includes("request_id"), "push notify: request_id in deep link data");
assert(createJs.includes("notifyAdminOfRequest"), "create: notifyAdminOfRequest exported");
assert(js.includes("focusDelegateRequestFromUrl"), "delegate: focus request from URL");
assert(js.includes("desiredRequestIdFromUrl"), "delegate: request_id URL state");

if (failed) {
  console.error("\n" + failed + " check(s) failed");
  process.exit(1);
}
console.log("\nAll delegate branch-request permission checks passed.");
