#!/usr/bin/env node
/**
 * Static + pure checks for homepage «طلباتي» status sync / buckets.
 */
"use strict";

var fs = require("fs");
var path = require("path");

var root = path.join(__dirname, "..");
var rxPath = path.join(root, "assets/js/modules/request-experience.js");
var sqlPath = path.join(
  root,
  "supabase/sql/COPY-ME-public-my-request-statuses.sql"
);
var indexPath = path.join(root, "pages/index.html");

var passed = 0;
var failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed += 1;
    console.log("ok  - " + msg);
  } else {
    failed += 1;
    console.error("FAIL - " + msg);
  }
}

function normalizeTrackStatus(raw) {
  var s = String(raw == null ? "" : raw)
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!s) return "pending";
  if (
    s === "rejected" ||
    s === "denied" ||
    s.indexOf("رفض") >= 0 ||
    s.indexOf("مرفوض") >= 0
  ) {
    return "rejected";
  }
  if (
    s === "approved" ||
    s === "applied" ||
    s === "done" ||
    s === "accepted" ||
    s === "scheduled" ||
    s === "visible" ||
    s === "ended" ||
    s === "deferred" ||
    s.indexOf("قبول") >= 0 ||
    s.indexOf("موافق") >= 0 ||
    s.indexOf("معتمد") >= 0
  ) {
    return "approved";
  }
  if (
    s === "pending" ||
    s === "submitted" ||
    s === "assigned" ||
    s === "in_review" ||
    s === "needs_changes" ||
    s.indexOf("انتظار") >= 0 ||
    s.indexOf("مراجعة") >= 0
  ) {
    return "pending";
  }
  return "pending";
}

var rx = fs.readFileSync(rxPath, "utf8");
var indexHtml = fs.readFileSync(indexPath, "utf8");
var sql = fs.readFileSync(sqlPath, "utf8");

assert(
  rx.indexOf("public_my_request_statuses_v1") >= 0,
  "request-experience calls public_my_request_statuses_v1"
);
assert(
  rx.indexOf("fetchLiveRequestStatuses") >= 0,
  "request-experience has fetchLiveRequestStatuses"
);
assert(
  rx.indexOf("select_empty") >= 0,
  "RLS empty select is not treated as hard-delete"
);
assert(
  rx.indexOf("normalizeTrackStatus") >= 0,
  "normalizeTrackStatus present"
);
assert(
  /det\.open\)\s*scheduleTrackReconcile\(true\)/.test(rx) ||
    rx.indexOf("if (det.open) scheduleTrackReconcile(true)") >= 0,
  "reconcile forced when طلباتي details opens"
);
assert(
  rx.indexOf("visibilitychange") >= 0 && rx.indexOf("bindTrackRefreshHooks") >= 0,
  "visibility/focus refresh hooks present"
);
assert(
  rx.indexOf("rpc_missing") >= 0,
  "detects missing RPC distinctly from RLS empty"
);
assert(
  fs
    .readFileSync(
      path.join(root, "assets/js/modules/admin-sql-presets.js"),
      "utf8"
    )
    .indexOf("maint.public_my_request_statuses_v1") >= 0,
  "maint preset public_my_request_statuses_v1 present"
);
assert(
  !/r\.reject_reason/.test(
    fs.readFileSync(
      path.join(root, "supabase/sql/COPY-ME-public-my-request-statuses.sql"),
      "utf8"
    )
  ),
  "SQL does not reference missing reject_reason column"
);
assert(
  indexHtml.indexOf("request-experience.js?v=20260812myreq6") >= 0,
  "cache-bust myreq6 on request-experience.js"
);
assert(
  indexHtml.indexOf("request-experience.css?v=20260812myreq6") >= 0,
  "cache-bust myreq6 on request-experience.css"
);

assert(normalizeTrackStatus("rejected") === "rejected", "rejected → rejected");
assert(normalizeTrackStatus("تم الرفض") === "rejected", "تم الرفض → rejected");
assert(normalizeTrackStatus("approved") === "approved", "approved → approved");
assert(normalizeTrackStatus("تم القبول") === "approved", "تم القبول → approved");
assert(normalizeTrackStatus("submitted") === "pending", "submitted → pending");
assert(
  normalizeTrackStatus("بانتظار الإجراء") === "pending",
  "بانتظار الإجراء → pending"
);
assert(
  normalizeTrackStatus("EVN-J3LF-7HRZ") === "pending",
  "unknown token stays pending (not approved)"
);

// EVN scenario: local mirror stale submitted, live rejected
assert(
  normalizeTrackStatus("submitted") === "pending" &&
    normalizeTrackStatus("rejected") === "rejected",
  "EVN stale submitted stays pending until live rejected remaps bucket"
);

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
