#!/usr/bin/env node
/**
 * Branch routing for occasion / health / death public forms.
 * Ensures branch_key is required, persisted in message/payload helpers,
 * and unique tree matches resolve to one branch (e.g. حسن → مزيد).
 *
 * Run: npm run verify:event-branch
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

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

function loadEventSubmit() {
  const src = fs.readFileSync(
    path.join(root, "assets/js/event-submit.js"),
    "utf8"
  );
  const sandbox = {
    console,
    document: {
      querySelector: function () {
        return null;
      },
      querySelectorAll: function () {
        return [];
      },
      addEventListener: function () {},
    },
    location: {
      hash: "",
      href: "http://local/",
      origin: "http://local",
      pathname: "/",
    },
    navigator: {},
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    addEventListener: function () {},
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(src, sandbox, { filename: "event-submit.js" });
  return sandbox.window.AlzidanEventSubmitBranch;
}

const API = loadEventSubmit();
assert(!!API, "AlzidanEventSubmitBranch exported");
assert(
  Array.isArray(API.BRANCHES) && API.BRANCHES.indexOf("مزيد") >= 0,
  "BRANCHES includes مزيد"
);

assert(API.normalizeBranchKey("مزيد") === "مزيد", "normalizeBranchKey مزيد");
assert(
  API.normalizeBranchKey("المزيد") === "مزيد",
  "normalizeBranchKey المزيد → مزيد"
);
assert(API.normalizeBranchKey("غير") === "", "invalid branch rejected");
assert(API.isValidBranchKey("لاحم") === true, "isValidBranchKey لاحم");
assert(API.isValidBranchKey("") === false, "empty branch invalid");

assert(
  API.hintBranchFromFullName("حسن خميس المزيد") === "مزيد",
  "hint from full name … المزيد → مزيد (hint only)"
);
assert(
  API.hintBranchFromFullName("اسم بدون فرع") === "",
  "hint without branch token is empty"
);

const hasanRows = [
  {
    person_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    branch_key: "مزيد",
    display_name: "حسن",
    person_lineage: "مزيد بن مطلق بن زيدان/خميس/دليميك/خميس/حسن",
    child_name: "حسن",
  },
];
const hasan = API.resolveBranchFromMatches(hasanRows);
assert(hasan.branch === "مزيد", "حسن tree match → branch مزيد");
assert(
  hasan.personId === "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  "unique match sets personId"
);
assert(hasan.ambiguous === false, "unique match not ambiguous");

const ambiguous = API.resolveBranchFromMatches([
  { branch_key: "مزيد", person_id: "1", display_name: "حسن" },
  { branch_key: "زيدان", person_id: "2", display_name: "حسن" },
]);
assert(ambiguous.branch === "", "ambiguous branches → no auto branch");
assert(ambiguous.ambiguous === true, "ambiguous flag set");

const empty = API.resolveBranchFromMatches([]);
assert(empty.branch === "" && !empty.ambiguous, "empty matches → no branch");

const msg = API.buildEventRequestMessage(
  {
    requestId: "EVN-TEST-0001",
    branch: "مزيد",
    type: "marriage",
    typeLabel: "زواج",
    person: "حسن",
    personId: hasan.personId,
    dateLabel: "1448/01/01",
    place: "",
    imageUrl: "",
    videoUrl: "",
    text: "تجربة",
    phone: "0500000000",
    createdAt: "2026-08-10T00:00:00.000Z",
  },
  "occasion"
);
assert(msg.indexOf("الفرع: مزيد") >= 0, "occasion message includes الفرع: مزيد");
assert(msg.indexOf("__JSON__") >= 0, "message includes JSON envelope");

const deathMsg = API.buildEventRequestMessage(
  {
    requestId: "DTH-TEST-0001",
    branch: "مزيد",
    type: "death",
    typeLabel: "وفاة",
    person: "حسن خميس المزيد",
    personId: "",
    dateLabel: "1448/01/10",
    place: "",
    text: "",
    phone: "0500000000",
    createdAt: "2026-08-10T00:00:00.000Z",
  },
  "death"
);
assert(
  deathMsg.indexOf("الفرع: مزيد") >= 0,
  "death message includes الفرع: مزيد"
);

const healthMsg = API.buildEventRequestMessage(
  {
    requestId: "HLT-TEST-0001",
    branch: "لاحم",
    type: "sick",
    typeLabel: "مريض",
    person: "فلان",
    personId: "",
    dateLabel: "",
    place: "مستشفى",
    text: "",
    phone: "0500000000",
    createdAt: "2026-08-10T00:00:00.000Z",
  },
  "patient"
);
assert(
  healthMsg.indexOf("الفرع: لاحم") >= 0,
  "health message includes الفرع: لاحم"
);

// Static source guards: no DEFAULT_BRANCH hardcode; require branch on submit.
const src = fs.readFileSync(
  path.join(root, "assets/js/event-submit.js"),
  "utf8"
);
assert(src.indexOf("DEFAULT_BRANCH") < 0, "DEFAULT_BRANCH removed from event-submit");
assert(
  src.indexOf("اختر الفرع حتى يصل الطلب لمندوب الفرع الصحيح") >= 0,
  "submit blocks without branch"
);
assert(
  src.indexOf("branch_key: branch") >= 0,
  "approval row / guard payload still sets branch_key"
);

const html = fs.readFileSync(path.join(root, "pages/index.html"), "utf8");
assert(
  (html.match(/data-event-branch/g) || []).length >= 3,
  "index.html has branch select on occasion/patient/death"
);
assert(
  (html.match(/data-event-person-suggest/g) || []).length >= 3,
  "index.html has person suggest mounts"
);

if (failed) {
  console.error("\n" + failed + " failure(s)");
  process.exit(1);
}
console.log("\nAll event-branch routing checks passed.");
