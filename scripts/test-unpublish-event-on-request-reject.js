#!/usr/bin/env node
/**
 * Static + mock checks: rejecting event_card unpublishes family_events.
 * Run: node scripts/test-unpublish-event-on-request-reject.js
 * Also covered lightly by verify:unpublish-on-delete helpers.
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

const actionsSrc = fs.readFileSync(
  path.join(root, "assets/js/modules/request-actions.js"),
  "utf8"
);
assert(
  actionsSrc.includes("unpublishPublishedEventForRequest"),
  "request-actions exports unpublish helper"
);
assert(
  actionsSrc.includes("admin_family_event_delete_v1"),
  "unpublish uses admin_family_event_delete_v1"
);

const requestsSrc = fs.readFileSync(
  path.join(root, "assets/js/modules/requests.js"),
  "utf8"
);
assert(
  requestsSrc.includes("unpublishPublishedEventForRequest"),
  "requests.js references unpublish helper"
);
assert(
  /p_status:\s*"rejected"/.test(requestsSrc),
  "reject path still calls admin_set_request_status_v2"
);

// Reject handler must call unpublish before status RPC (order check).
const rejectClickIdx = requestsSrc.indexOf('rejectBtn.addEventListener("click"');
assert(rejectClickIdx >= 0, "reject button has click handler");
const rejectSlice = requestsSrc.slice(rejectClickIdx, rejectClickIdx + 4500);
const unpubIdx = rejectSlice.indexOf("unpublishPublishedEventForRequest");
const statusIdx = rejectSlice.indexOf('p_status: "rejected"');
assert(unpubIdx >= 0, "reject handler calls unpublish");
assert(
  statusIdx > unpubIdx,
  "reject unpublishes before admin_set_request_status_v2"
);
assert(
  !/isSecretResetRequest[\s\S]{0,200}unpublishPublishedEventForRequest/.test(
    rejectSlice.slice(0, unpubIdx + 80)
  ),
  "unpublish is on general reject path (not only secret-reset early return)"
);

const sqlPath = path.join(
  root,
  "supabase/sql/20260809_admin_reject_request_unpublish_event.sql"
);
assert(fs.existsSync(sqlPath), "reject-unpublish SQL exists");
const sql = fs.readFileSync(sqlPath, "utf8");
assert(
  sql.includes("delete from public.family_events"),
  "trigger deletes family_events on reject"
);
assert(
  sql.includes("event_card"),
  "trigger scopes to event_card kinds"
);
assert(
  sql.includes("trg_approval_request_reject_unpublish_event"),
  "trigger function name present"
);

const copyMe = path.join(
  root,
  "supabase/sql/COPY-ME-admin-reject-request-unpublish-event.sql"
);
assert(fs.existsSync(copyMe), "COPY-ME reject-unpublish exists");

const presetsSrc = fs.readFileSync(
  path.join(root, "assets/js/modules/admin-sql-presets.js"),
  "utf8"
);
assert(
  presetsSrc.includes("maint.admin_reject_request_unpublish_event_v1"),
  "admin SQL preset lists reject-unpublish"
);

const adminSrc = fs.readFileSync(
  path.join(root, "assets/js/admin.js"),
  "utf8"
);
assert(
  adminSrc.includes("trg_approval_request_reject_unpublish_event"),
  "admin SETUP SQL embeds reject-unpublish trigger"
);

const adminHtml = fs.readFileSync(
  path.join(root, "pages/admin.html"),
  "utf8"
);
assert(
  /modules\/requests\.js\?v=20260809rej2/.test(adminHtml) ||
    /modules\/requests\.js\?v=/.test(adminHtml),
  "admin.html cache-busts requests.js"
);
assert(
  /modules\/request-actions\.js\?v=20260809rej2/.test(adminHtml) ||
    /modules\/request-actions\.js\?v=/.test(adminHtml),
  "admin.html cache-busts request-actions.js"
);


const wfSrc = fs.readFileSync(
  path.join(root, "assets/js/modules/admin-workflow-panel.js"),
  "utf8"
);
assert(
  wfSrc.includes("unpublishPublishedEventForWorkflowReject") ||
    wfSrc.includes("unpublishPublishedEventForRequest"),
  "workflow panel rejects call unpublish"
);
assert(
  /toState === ["']rejected["']/.test(wfSrc) &&
    wfSrc.includes("unpublishPublishedEventFor"),
  "workflow reject path wires unpublish"
);

const unpubRpc = path.join(
  root,
  "supabase/sql/COPY-ME-admin-unpublish-events-for-request-v1.sql"
);
assert(fs.existsSync(unpubRpc), "COPY-ME unpublish RPC exists");
assert(
  fs.readFileSync(unpubRpc, "utf8").includes("admin_unpublish_events_for_request_v1"),
  "unpublish RPC SQL defines function"
);

assert(
  actionsSrc.includes("admin_unpublish_events_for_request_v1"),
  "request-actions prefers unpublish RPC"
);

// Runtime mock: reject-shaped row deletes matched family_events.
const box = {
  window: {
    AlzidanAdminCore: {},
    AlzidanDupIdentityGuard: null,
    AlzidanEvents: {},
  },
  document: { getElementById: () => null },
};
box.window.document = box.document;
box.globalThis = box.window;
Function(
  "window",
  "document",
  "globalThis",
  actionsSrc.replace(/^\(\(\) => \{/, "(function () {") + "\n;"
)(box.window, box.document, box.window);

const RA = box.window.AlzidanRequestActions;
assert(!!RA, "AlzidanRequestActions mounted");

async function mockRejectUnpublish() {
  const deleted = [];
  const rows = [
    {
      id: 42,
      type: "death",
      person: "فلان",
      event_date: "2026-08-08",
      details: JSON.stringify({ requestId: "OCC-REJ-1", kind: "death_notice" }),
    },
  ];
  const sb = {
    from() {
      return {
        select() {
          return {
            like() {
              return {
                limit: async () => ({ data: rows, error: null }),
              };
            },
            eq() {
              return {
                limit: async () => ({ data: rows, error: null }),
              };
            },
          };
        },
      };
    },
    rpc: async (name, args) => {
      if (name === "admin_unpublish_events_for_request_v1") {
        if (String(args.p_request_id || "") === "OCC-REJ-1") {
          deleted.push("rpc:" + args.p_request_id);
          return { data: { ok: true, deleted: 1 }, error: null };
        }
        return { data: { ok: true, deleted: 0 }, error: null };
      }
      if (name === "admin_family_event_delete_v1") {
        deleted.push(args.p_id);
        return { data: true, error: null };
      }
      return { data: null, error: { message: "unexpected rpc " + name } };
    },
  };
  const out = await RA.unpublishPublishedEventForRequest(sb, "tok", {
    kind: "event_card",
    request_id: "OCC-REJ-1",
    name: "فلان",
  });
  assert(out.ok === true && out.deleted === 1, "reject-path unpublish deletes 1");
  assert(deleted[0] === "rpc:OCC-REJ-1", "primary path uses admin_unpublish_events_for_request_v1");

  // Fallback when unpublish RPC missing from schema cache
  const deleted2 = [];
  const sbFallback = {
    from: sb.from,
    rpc: async (name, args) => {
      if (name === "admin_unpublish_events_for_request_v1") {
        return {
          data: null,
          error: { message: "Could not find the function in the schema cache" },
        };
      }
      if (name === "admin_family_event_delete_v1") {
        deleted2.push(args.p_id);
        return { data: true, error: null };
      }
      return { data: null, error: { message: "unexpected rpc " + name } };
    },
  };
  const out2 = await RA.unpublishPublishedEventForRequest(sbFallback, "tok", {
    kind: "event_card",
    request_id: "OCC-REJ-1",
    name: "فلان",
  });
  assert(out2.ok === true && out2.deleted === 1, "fallback unpublish deletes 1");
  assert(deleted2[0] === 42, "fallback uses admin_family_event_delete_v1");
}

mockRejectUnpublish()
  .then(() => {
    if (failed) {
      console.error("\n" + failed + " failure(s)");
      process.exit(1);
    }
    console.log("\nAll unpublish-on-reject checks passed.");
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
