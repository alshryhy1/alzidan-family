#!/usr/bin/env node
/**
 * Static checks: deleting event_card request unpublishes family_events.
 * Run: node scripts/test-unpublish-event-on-request-delete.js
 */
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

function loadIife(modulePath) {
  const src = fs.readFileSync(modulePath, "utf8");
  const sandbox = { module: { exports: {} }, globalThis: {}, console };
  sandbox.window = sandbox.globalThis;
  Function("window", "globalThis", "module", "exports", "console", src + "\n;")(
    sandbox.window,
    sandbox.globalThis,
    sandbox.module,
    sandbox.module.exports,
    console
  );
  return sandbox;
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
assert(
  actionsSrc.includes("familyEventMatchesPublishIdentity"),
  "identity fallback matcher present"
);

const requestsSrc = fs.readFileSync(
  path.join(root, "assets/js/modules/requests.js"),
  "utf8"
);
assert(
  requestsSrc.includes("unpublishPublishedEventForRequest"),
  "requests.js delete calls unpublish before admin_delete_request_v1"
);
assert(
  /p_status:\s*"rejected"/.test(requestsSrc) &&
    requestsSrc.indexOf("unpublishPublishedEventForRequest") !==
      requestsSrc.lastIndexOf("unpublishPublishedEventForRequest"),
  "requests.js also unpublishes on reject (not only delete)"
);

const sqlPath = path.join(
  root,
  "supabase/sql/20260809_admin_delete_request_unpublish_event.sql"
);
assert(fs.existsSync(sqlPath), "RPC migration SQL exists");
const sql = fs.readFileSync(sqlPath, "utf8");
assert(
  sql.includes("delete from public.family_events"),
  "RPC deletes family_events for event kinds"
);
assert(
  sql.includes("event_card"),
  "RPC scopes to event_card kinds"
);
assert(
  !/tree_card/.test(sql.split("family_events")[0]),
  "RPC does not mention tree_card in delete path preamble"
);

const adminSrc = fs.readFileSync(
  path.join(root, "assets/js/admin.js"),
  "utf8"
);
assert(
  adminSrc.includes("v_kind in ('event_card', 'family_event', 'event_request')"),
  "admin SETUP SQL embeds unpublish-on-delete RPC"
);
assert(
  adminSrc.includes('data !== true') &&
    adminSrc.includes("admin_family_event_delete_v1"),
  "المناسبات delete checks RPC success"
);

// Runtime: pure matchers via loading request-actions needs DOM ids — extract via eval of helpers only.
const box = { window: { AlzidanAdminCore: {}, AlzidanDupIdentityGuard: null, AlzidanEvents: {} }, document: { getElementById: () => null } };
box.window.document = box.document;
box.globalThis = box.window;
// Minimal stub: request-actions touches DOM at load — provide getElementById nulls.
Function(
  "window",
  "document",
  "globalThis",
  actionsSrc.replace(/^\(\(\) => \{/, "(function () {") + "\n;"
)(box.window, box.document, box.window);

const RA = box.window.AlzidanRequestActions;
assert(!!RA, "AlzidanRequestActions mounted");
assert(RA.isEventPublishRequestKind("event_card") === true, "event_card is publish kind");
assert(RA.isEventPublishRequestKind("tree_card") === false, "tree_card not publish kind");
assert(
  RA.familyEventDetailsMatchRequestId(
    JSON.stringify({ requestId: "OCC-ABC-123" }),
    "OCC-ABC-123"
  ),
  "details match requestId JSON"
);
assert(
  RA.familyEventMatchesPublishIdentity(
    { type: "gathering", person: "حسن", event_date: "2026-08-01", date_label: "" },
    { type: "gathering", person: "حسن", date: "2026-08-01" }
  ),
  "identity match gathering/حسن/date"
);
assert(
  !RA.familyEventMatchesPublishIdentity(
    { type: "gathering", person: "حسن", event_date: "2026-08-01" },
    { type: "gathering", person: "محمد", date: "2026-08-01" }
  ),
  "identity mismatch on person"
);

async function mockUnpublish() {
  const deleted = [];
  const rows = [
    {
      id: 99,
      type: "gathering",
      person: "حسن",
      event_date: "2026-08-01",
      details: JSON.stringify({ requestId: "OCC-TEST-1", kind: "happy_notice" }),
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
      // Simulate missing primary RPC so client fallback (family_event_delete) runs.
      if (name === "admin_unpublish_events_for_request_v1") {
        return {
          data: null,
          error: { message: "Could not find the function in the schema cache" },
        };
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
    request_id: "OCC-TEST-1",
    name: "حسن",
  });
  assert(out.ok === true && out.deleted === 1, "unpublish deletes 1 matched row");
  assert(deleted[0] === 99, "delete rpc called with family_events id");

  const treeOut = await RA.unpublishPublishedEventForRequest(sb, "tok", {
    kind: "tree_card",
    request_id: "TREE-1",
  });
  assert(treeOut.skipped === true && treeOut.deleted === 0, "tree_card skipped");
}

mockUnpublish()
  .then(() => {
    if (failed) {
      console.error("\n" + failed + " failure(s)");
      process.exit(1);
    }
    console.log("\nAll unpublish-on-delete checks passed.");
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
