#!/usr/bin/env node
/**
 * Static checks for delegates workspace IA reorder (طلبات فرعي).
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const htmlPath = path.join(root, "pages/alzidan-tree.html");
const jsPath = path.join(root, "assets/js/delegate.js");
const cssPath = path.join(root, "assets/css/delegate.css");

const html = fs.readFileSync(htmlPath, "utf8");
const js = fs.readFileSync(jsPath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error("FAIL:", msg);
  } else {
    console.log("OK:", msg);
  }
}

assert(html.includes('id="delegate-event-requests-root"'), "HTML: requests mount root");
assert(html.includes("طلبات الفرع أولًا"), "HTML: subtitle signals requests-first");
assert(html.includes('id="delegate-branch-badge"'), "HTML: branch badge");
assert(html.includes("أدوات الشجرة"), "HTML: secondary tools section");
assert(html.indexOf("delegate-event-requests-root") < html.indexOf("family-management-root"), "HTML: requests before tree tools");
assert(html.includes("delegate.js?v=20260812life3"), "HTML: cache-bust delegate.js");
assert(html.includes("delegate.css?v=20260812life3"), "HTML: cache-bust delegate.css");
assert(html.includes("dw-tool-ico"), "HTML: per-section icons");
assert(html.includes("الذكريات"), "HTML: memories section label");

assert(js.includes("طلبات فرعي"), "JS: primary section title");
assert(js.includes("setDelegateBranchBadge"), "JS: branch badge helper");
assert(js.includes("classifyDelegateBranchRequest"), "JS: intent classifier");
assert(js.includes('data-filter="tree"'), "JS: filter chip إضافة فرد");
assert(js.includes('data-filter="correction"'), "JS: filter chip تصحيح");
assert(js.includes('data-filter="memory"'), "JS: filter chip ذكرى");
assert(js.includes('data-filter="event"'), "JS: filter chip مناسبة");
assert(js.includes('data-filter="health"'), "JS: filter chip حالة صحية");
assert(js.includes('data-filter="death"'), "JS: filter chip وفاة");
assert(js.includes('intent: "tree"') && js.includes("canAct: true"), "JS: tree requests actionable by delegate");
assert(js.includes('intent: "correction"') && js.includes("canAct: true"), "JS: correction actionable");
assert(js.includes('intentLabel: "طلب بطاقة"') && js.includes("canAct: false"), "JS: card remains admin-only");
assert(js.includes("طلب البطاقة للإدارة المركزية فقط"), "JS: scope hint excludes card");
assert(js.includes("قبول (مع جدولة الظهور)") || js.includes("قبول ونشر"), "JS: accept action label for events");
assert(js.includes("applyDelegateTreeCardRequest"), "JS: tree apply on accept");
assert(js.includes("delegate_list_event_requests_v1"), "JS: still uses existing list RPC");
assert(js.includes("delegate_set_approval_request_status_v1"), "JS: still uses existing status RPC");
assert(js.includes("أنت مندوب فرع:"), "JS: branch scope copy");
assert(!js.includes("طلبات المناسبات الواردة من الرئيسية"), "JS: old section title removed");
assert(!js.includes("إضافة الفرد والتصحيح من الإدارة"), "JS: old admin-only tree copy removed");
assert(js.includes("dw-sec-ico"), "JS: requests section icon markup");

assert(css.includes(".delegate-branch-badge"), "CSS: branch badge");
assert(css.includes(".dw-req-row"), "CSS: compact request row");
assert(css.includes(".dw-filter-chip"), "CSS: filter chips");
assert(css.includes(".dw-sec-ico"), "CSS: section icons");

if (failed) {
  console.error("\n" + failed + " check(s) failed");
  process.exit(1);
}
console.log("\nAll delegate workspace reorder checks passed.");
