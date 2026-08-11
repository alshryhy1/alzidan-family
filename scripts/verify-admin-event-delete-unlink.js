#!/usr/bin/env node
/**
 * Static checks: admin family_event delete unlinks approval_requests
 * and unpublish-on-delete no longer blocks when RPC returns deleted=0.
 * Run: node scripts/verify-admin-event-delete-unlink.js
 */
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error("FAIL:", msg);
  } else {
    console.log("OK:", msg);
  }
}

const unlinkSql = fs.readFileSync(
  path.join(root, "supabase/sql/COPY-ME-admin-family-event-delete-unlink-request.sql"),
  "utf8"
);
assert(
  /admin_family_event_delete_v1/.test(unlinkSql) &&
    /delete from public\.approval_requests/.test(unlinkSql),
  "COPY-ME unlink deletes linked approval_requests"
);
assert(
  /admin_delete_request_v1/.test(unlinkSql) &&
    !/exception\s+when others then\s+return false/i.test(unlinkSql),
  "admin_delete_request_v1 has no silent exception swallow"
);

const cleanupSql = fs.readFileSync(
  path.join(root, "supabase/sql/COPY-ME-cleanup-orphan-approved-event-requests.sql"),
  "utf8"
);
assert(
  /delete from public\.approval_requests/.test(cleanupSql) &&
    /not exists/.test(cleanupSql),
  "orphan cleanup SQL present"
);

const rpcSql = fs.readFileSync(
  path.join(root, "supabase/sql/admin_family_events_rpc.sql"),
  "utf8"
);
assert(
  /delete from public\.approval_requests/.test(rpcSql),
  "admin_family_events_rpc.sql unlinks requests on delete"
);

const actions = fs.readFileSync(
  path.join(root, "assets/js/modules/request-actions.js"),
  "utf8"
);
assert(
  /Trust security-definer RPC even when deleted=0/.test(actions) ||
    /return \{ ok: true, deleted, via: "rpc" \}/.test(actions),
  "unpublish trusts RPC ok even when deleted=0"
);
assert(
  !/deleted=0: fall through to client path/.test(actions),
  "no fallthrough-on-deleted=0 that blocked deletes via RLS"
);

const adminJs = fs.readFileSync(path.join(root, "assets/js/admin.js"), "utf8");
assert(
  /formatDeleteEventError/.test(adminJs),
  "admin delete uses Arabic formatDeleteEventError"
);
assert(
  /not allowed|لا توجد صلاحية/.test(adminJs) &&
    /formatDeleteEventError/.test(adminJs),
  "delete errors mapped to Arabic"
);
assert(
  !/exception when others then return false;\s*end;\s*\$\$; grant execute on function public\.admin_delete_request_v1/.test(
    adminJs
  ),
  "SETUP SQL admin_delete_request_v1 no silent exception"
);

const vis = fs.readFileSync(
  path.join(root, "assets/js/modules/events/event-visibility.js"),
  "utf8"
);
assert(
  /listSaysUnpublished/.test(vis) || /published === false/.test(vis),
  "visibility does not claim منشور when published=false"
);

const presets = fs.readFileSync(
  path.join(root, "assets/js/modules/admin-sql-presets.js"),
  "utf8"
);
assert(
  presets.includes("maint.admin_family_event_delete_unlink_request_v1"),
  "presets include unlink maint card"
);
assert(
  presets.includes("maint.cleanup_orphan_approved_event_requests_v1"),
  "presets include orphan cleanup card"
);
assert(
  /approval_requests/.test(
    presets.slice(
      presets.indexOf("maint.admin_family_event_delete_unlink_request_v1"),
      presets.indexOf("maint.cleanup_orphan_approved_event_requests_v1")
    )
  ),
  "unlink preset inlines SQL with approval_requests"
);

const workspace = fs.readFileSync(
  path.join(root, "assets/js/modules/admin-sql-workspace.js"),
  "utf8"
);
assert(
  workspace.includes("maint.admin_family_event_delete_unlink_request_v1"),
  "workspace mirrors unlink preset"
);

const adminHtml = fs.readFileSync(path.join(root, "pages/admin.html"), "utf8");
assert(
  /admin\.js\?v=20260812del2/.test(adminHtml) &&
    /admin-sql-presets\.js\?v=20260812del2/.test(adminHtml) &&
    /requests\.js\?v=20260812del2/.test(adminHtml),
  "admin.html cache-bust del2"
);

const requestsJs = fs.readFileSync(
  path.join(root, "assets/js/modules/requests.js"),
  "utf8"
);
assert(
  /Best-effort unpublish/i.test(requestsJs) &&
    /admin_delete_request_v1/.test(requestsJs),
  "delete does not hard-block on unpublish failure"
);
assert(/تعذر حذف الطلب/.test(requestsJs), "delete surfaces Arabic errors");

const deleteSql = fs.readFileSync(
  path.join(root, "supabase/sql/COPY-ME-admin-delete-request-unpublish-event.sql"),
  "utf8"
);
assert(
  /request_id = v_raw/.test(deleteSql) && /\^\[0-9\]\+\$/.test(deleteSql),
  "admin_delete_request_v1 resolves EVN request_id without digit-strip"
);
assert(
  !/exception\s+when others then\s+return false/i.test(deleteSql),
  "delete SQL has no silent exception"
);

const unpubSqlFile = fs.readFileSync(
  path.join(root, "supabase/sql/COPY-ME-admin-unpublish-events-for-request-v1.sql"),
  "utf8"
);
assert(/event_date::text/.test(unpubSqlFile), "unpublish casts event_date to text");
assert(
  fs.existsSync(path.join(root, "supabase/sql/COPY-ME-cleanup-evn-lk9x-rqui.sql")),
  "EVN-LK9X-RQUI cleanup SQL exists"
);

if (failed) {
  console.error("\n" + failed + " check(s) failed");
  process.exit(1);
}
console.log("\nAll checks passed.");
