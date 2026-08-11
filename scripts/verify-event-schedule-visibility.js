#!/usr/bin/env node
/**
 * Verify event date reject + schedule lifecycle + submitter status chips.
 */
"use strict";

const path = require("path");
const root = path.join(__dirname, "..");

require(path.join(root, "assets/js/modules/events/event-visibility.js"));
require(path.join(root, "assets/js/modules/user-facing-request-messages.js"));

const vis = globalThis.AlzidanEventVisibility;
const msg = globalThis.AlzidanUserFacingRequestMessages;

function assert(cond, label) {
  if (!cond) {
    console.error("FAIL:", label);
    process.exitCode = 1;
  } else {
    console.log("OK:", label);
  }
}

function dayOffsetIso(daysFromToday) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + daysFromToday);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

assert(!!vis, "AlzidanEventVisibility loaded");
assert(!!msg, "AlzidanUserFacingRequestMessages loaded");

// 1) Date reject for past happy occasions
const past = vis.validateEventDateForSubmit(dayOffsetIso(-2), {
  category: "happy",
  required: true,
});
assert(past.ok === false, "past happy date rejected");
assert(
  String(past.reason || "").indexOf("منته") >= 0,
  "past date Arabic reason"
);

const todayOk = vis.validateEventDateForSubmit(dayOffsetIso(0), {
  category: "happy",
  required: true,
});
assert(todayOk.ok === true, "today happy date accepted");

const futureOk = vis.validateEventDateForSubmit(dayOffsetIso(10), {
  category: "happy",
  required: true,
});
assert(futureOk.ok === true, "future happy date accepted for review");

const deathPastOk = vis.validateEventDateForSubmit(dayOffsetIso(-1), {
  category: "death",
});
assert(deathPastOk.ok === true, "death past date allowed");

// 2) Schedule: future event not public until show window
const farFuture = {
  type: "marriage",
  event_date: dayOffsetIso(20),
  created_at: new Date().toISOString(),
  details: JSON.stringify({
    v: 1,
    kind: "happy_notice",
    show_before_days: 3,
  }),
};
assert(
  vis.deriveEventLifecycleState(farFuture) === "scheduled",
  "future event scheduled (not public)"
);
assert(
  vis.isFamilyEventPubliclyVisible(farFuture) === false,
  "scheduled event hidden from public"
);

const soon = {
  type: "marriage",
  event_date: dayOffsetIso(2),
  created_at: new Date().toISOString(),
  details: JSON.stringify({
    v: 1,
    kind: "happy_notice",
    show_before_days: 3,
  }),
};
assert(
  vis.deriveEventLifecycleState(soon) === "visible",
  "event within 3-day window is visible"
);
assert(vis.isFamilyEventPubliclyVisible(soon) === true, "near event public");

const ended = {
  type: "marriage",
  event_date: dayOffsetIso(-1),
  created_at: new Date().toISOString(),
  details: JSON.stringify({
    v: 1,
    kind: "happy_notice",
    show_before_days: 3,
  }),
};
assert(vis.deriveEventLifecycleState(ended) === "ended", "past event ended");
assert(vis.isFamilyEventPubliclyVisible(ended) === false, "ended not public");

const hidden = {
  type: "marriage",
  event_date: dayOffsetIso(1),
  details: JSON.stringify({
    v: 1,
    kind: "happy_notice",
    show_before_days: 3,
    manual_hidden: true,
  }),
};
assert(vis.deriveEventLifecycleState(hidden) === "hidden", "manual soft-hide");
assert(vis.isFamilyEventPubliclyVisible(hidden) === false, "manual hide not public");

// Explicit show_at override
const customShow = {
  type: "gathering",
  event_date: dayOffsetIso(30),
  details: JSON.stringify({
    v: 1,
    kind: "happy_notice",
    show_at: new Date(Date.now() - 60 * 1000).toISOString(),
    end_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  }),
};
assert(
  vis.deriveEventLifecycleState(customShow) === "visible",
  "show_at override makes visible early"
);

// 3) Submitter status chips
const pendingChip = vis.deriveSubmitterRequestStatus({
  status: "pending",
  kind: "event_card",
});
assert(pendingChip.label === "بانتظار المراجعة", "pending chip");

const rejectedChip = vis.deriveSubmitterRequestStatus({
  status: "rejected",
  kind: "event_card",
});
assert(rejectedChip.label === "مرفوض", "rejected chip");

const scheduledChip = vis.deriveSubmitterRequestStatus(
  { status: "approved", kind: "event_card" },
  farFuture
);
assert(scheduledChip.label === "مجدول للظهور", "scheduled chip after approve");

const visibleChip = vis.deriveSubmitterRequestStatus(
  { status: "approved", kind: "event_card" },
  soon
);
assert(visibleChip.label === "ظاهر الآن", "visible chip");

const endedChip = vis.deriveSubmitterRequestStatus(
  { status: "approved", kind: "event_card" },
  ended
);
assert(endedChip.label === "منتهٍ", "ended chip");

const treeApproved = vis.deriveSubmitterRequestStatus({
  status: "approved",
  kind: "tree_card",
});
assert(treeApproved.label === "تمت الموافقة", "tree approved chip");

// 3b) Reviewer lifecycle labels (delegate/admin) — accept ≠ publish
assert(typeof vis.deriveReviewerRequestStatus === "function", "reviewer helper");
const reviewerPending = vis.deriveReviewerRequestStatus({
  status: "pending",
  kind: "event_card",
});
assert(reviewerPending.label === "بانتظار الإجراء", "reviewer pending");

const reviewerRejected = vis.deriveReviewerRequestStatus({
  status: "rejected",
  kind: "event_card",
});
assert(reviewerRejected.label === "تم الرفض", "reviewer rejected");

const reviewerScheduled = vis.deriveReviewerRequestStatus(
  { status: "approved", kind: "event_card", published: true },
  farFuture
);
assert(
  String(reviewerScheduled.label || "").indexOf("مقبول — مجدول") === 0,
  "reviewer scheduled after accept"
);

const reviewerVisible = vis.deriveReviewerRequestStatus(
  { status: "approved", kind: "event_card", published: true },
  soon
);
assert(
  reviewerVisible.label === "مقبول — منشور / ظاهر الآن",
  "reviewer visible/published"
);

const reviewerEnded = vis.deriveReviewerRequestStatus(
  { status: "approved", kind: "event_card", published: true },
  ended
);
assert(reviewerEnded.label === "مقبول — منتهٍ", "reviewer ended");

const sch = vis.buildScheduleFields({
  event_date: dayOffsetIso(20),
  show_before_days: 3,
});
assert(!!sch.show_at, "buildScheduleFields writes show_at from event_date");
assert(sch.show_before_days === 3, "default show_before_days = 3");

// 4) Messaging: content ≠ delegate
const contentApproved = msg.userFacingRequestMessage("event_card", "approved", {
  includeClarification: false,
});
assert(
  contentApproved.indexOf("تمت الموافقة على طلبك") === 0,
  "content approve copy"
);
assert(contentApproved.indexOf("المندوب") < 0, "content approve never says المندوب");

const privilegeApproved = msg.userFacingRequestMessage(
  "tree_delegate",
  "approved",
  { includeClarification: false }
);
assert(
  privilegeApproved.indexOf("تم قبول طلبك بنجاح") === 0,
  "delegate privilege keep distinct accept copy"
);

const pendingMsg = msg.userFacingRequestMessage("event_card", "pending");
assert(pendingMsg.indexOf("طلبك بانتظار المراجعة") === 0, "pending copy");

const rejectedMsg = msg.userFacingRequestMessage("event_card", "rejected");
assert(rejectedMsg.indexOf("تم رفض طلبك") === 0, "reject copy");

// 5) Banner time window
assert(
  vis.isBannerPubliclyVisible({
    is_active: true,
    show_start: new Date(Date.now() - 1000).toISOString(),
    show_end: new Date(Date.now() + 86400000).toISOString(),
  }) === true,
  "banner in window visible"
);
assert(
  vis.isBannerPubliclyVisible({
    is_active: true,
    show_start: new Date(Date.now() - 86400000).toISOString(),
    show_end: new Date(Date.now() - 1000).toISOString(),
  }) === false,
  "banner after end soft-hidden"
);
assert(
  vis.isBannerPubliclyVisible({
    is_active: false,
    show_start: new Date(Date.now() - 1000).toISOString(),
    is_permanent: true,
  }) === false,
  "banner manual inactive hidden"
);
assert(
  vis.isBannerPubliclyVisible({
    is_active: true,
    show_start: new Date(Date.now() - 1000).toISOString(),
    is_permanent: true,
  }) === true,
  "permanent banner visible"
);

if (process.exitCode) {
  console.error("\nVerification failed.");
  process.exit(1);
}
console.log("\nAll event schedule / messaging checks passed.");
