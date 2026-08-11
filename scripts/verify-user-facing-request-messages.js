#!/usr/bin/env node
/**
 * Verify unified Arabic user-facing request messages (no English/Edge leaks).
 */
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const mapperPath = path.join(
  root,
  "assets/js/modules/user-facing-request-messages.js"
);

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("OK:", msg);
  }
}

const code = fs.readFileSync(mapperPath, "utf8");
assert(code.includes("userFacingRequestMessage"), "mapper exports userFacingRequestMessage");
assert(code.includes("تم إرسال طلبك بنجاح، وهو الآن قيد المراجعة."), "submit success copy");
assert(code.includes("طلبك بانتظار المراجعة"), "pending copy");
assert(code.includes("تمت الموافقة على طلبك"), "approved content copy");
assert(code.includes("تم رفض طلبك"), "rejected copy");
assert(
  code.includes(
    "تم حفظ طلبك بنجاح، لكن تعذر إرسال الإشعار البريد الإلكتروني حاليًا. لا حاجة لإعادة إرسال الطلب."
  ) ||
    code.includes(
      "تم حفظ طلبك بنجاح، لكن تعذر إرسال إشعار البريد الإلكتروني حاليًا. لا حاجة لإعادة إرسال الطلب."
    ),
  "notify-failure copy"
);

// Load mapper in isolation
const api = require(mapperPath);

const pending = api.userFacingRequestMessage("tree_card", "pending");
assert(
  pending.indexOf("طلبك بانتظار المراجعة") === 0,
  "pending state message"
);

const approved = api.userFacingRequestMessage("tree_delegate", "approved");
assert(approved.indexOf("تم قبول طلبك بنجاح.") === 0, "approved privilege lead");
assert(
  approved.indexOf("يمكنك الآن استخدام الصلاحية التي تم قبولها.") >= 0,
  "approved privilege clarification"
);

const contentApproved = api.userFacingRequestMessage("event_card", "approved", {
  includeClarification: false,
});
assert(
  contentApproved.indexOf("تمت الموافقة على طلبك") === 0,
  "content approved lead"
);
assert(contentApproved.indexOf("المندوب") < 0, "content never says المندوب");

const rejected = api.userFacingRequestMessage("event_card", "rejected", {
  reason: "البيانات غير مكتملة",
});
assert(rejected.indexOf("تم رفض طلبك") === 0, "rejected lead");
assert(rejected.indexOf("البيانات غير مكتملة") >= 0, "safe Arabic reason kept");

const rejectedTech = api.userFacingRequestMessage("event_card", "rejected", {
  reason: "Failed to send a request to the Edge Function",
});
assert(
  rejectedTech === "تم رفض طلبك." || rejectedTech.indexOf("تم رفض طلبك") === 0,
  "technical rejection reason scrubbed"
);

const scrubbed = api.mapTechnicalErrorToArabic(
  "Failed to send a request to the Edge Function",
  "تعذر إرسال الطلب حاليًا. حاول مرة أخرى لاحقًا."
);
assert(!/Failed to|Edge Function/i.test(scrubbed), "edge error scrubbed from UI");
assert(/[\u0600-\u06FF]/.test(scrubbed), "scrubbed error is Arabic");

const notifyFail = api.composeSubmitSuccess({ notifyFailed: true });
assert(notifyFail.requestOk === true, "notify failure ≠ request failure (requestOk)");
assert(notifyFail.notifyOk === false, "notify failure flagged");
assert(
  notifyFail.notifyNote.indexOf("لا حاجة لإعادة إرسال الطلب") >= 0,
  "notify soft note present"
);
assert(
  notifyFail.primary.indexOf("تم إرسال طلبك بنجاح") >= 0,
  "primary remains success"
);

// Surfaces include mapper + scrubbing
const surfaces = [
  "assets/js/modules/request-experience.js",
  "assets/js/event-submit.js",
  "assets/js/memory/submit.js",
  "assets/js/delegate.js",
  "pages/index.html",
  "supabase/functions/alzidan-email-notify/index.ts",
  "supabase/functions/alzidan-push-notify/index.ts",
];
for (const rel of surfaces) {
  const full = path.join(root, rel);
  const src = fs.readFileSync(full, "utf8");
  if (rel.endsWith("index.html")) {
    assert(
      src.includes("safe-request-notify.js?v=20260812safe2") &&
      src.includes("user-facing-request-messages.js?v=20260812safe2"),
      "index.html cache-bust includes safe notify + mapper"
    );
  } else if (rel.includes("email-notify")) {
    assert(src.includes("تحديث طلبك") || src.includes("تمت الموافقة على طلبك"), "email status Arabic");
    assert(src.includes("تم الرفض") || src.includes("تم رفض طلبك"), "email reject Arabic");
    assert(!src.includes("نص الطلب:"), "email no longer dumps raw request message to user");
  } else if (rel.includes("push-notify")) {
    assert(src.includes('mode === "status_changed"'), "push status_changed mode");
    assert(src.includes("تحديث طلبك") || src.includes("تمت الموافقة على طلبك"), "push status Arabic");
  } else if (rel.includes("request-experience") || rel.includes("event-submit")) {
    assert(
      !/notifyWarn\s*=\s*String\(\s*branchNotify\.emailError/.test(src),
      rel + ": no raw emailError in notifyWarn"
    );
    assert(
      src.includes("NOTIFY_FAILURE_AFTER_SAVE") ||
        src.includes("لا حاجة لإعادة إرسال الطلب"),
      rel + ": soft notify-failure Arabic"
    );
  } else if (rel.includes("delegate.js")) {
    assert(
      src.includes("تم إرسال طلبك بنجاح، وهو الآن قيد المراجعة"),
      "delegate public submit success Arabic"
    );
  }
}

// Mobile mirrors
const mobileRoot = path.join(root, "..", "alzidan-family-mobile");
const mobileUtil = path.join(
  mobileRoot,
  "src/utils/userFacingRequestMessages.ts"
);
if (fs.existsSync(mobileUtil)) {
  const m = fs.readFileSync(mobileUtil, "utf8");
  assert(
    m.includes("تم إرسال طلبك بنجاح، وهو الآن قيد المراجعة."),
    "mobile SUBMIT_SUCCESS"
  );
  assert(m.includes("تمت الموافقة على طلبك"), "mobile APPROVED content");
  assert(m.includes("userFacingSubmitError"), "mobile error scrubber");
} else {
  console.log("SKIP: mobile util missing at", mobileUtil);
}

if (process.exitCode) {
  console.error("\nVerification failed.");
  process.exit(1);
}
console.log("\nAll user-facing request message checks passed.");
