#!/usr/bin/env node
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

function loadIife(modulePath, extras) {
  const src = fs.readFileSync(modulePath, "utf8");
  const sandbox = Object.assign(
    { module: { exports: {} }, globalThis: {}, console },
    extras || {}
  );
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

const html = fs.readFileSync(path.join(root, "pages/index.html"), "utf8");
assert(/id="death-submit-type"/.test(html), "death form has type select");
assert(
  /<option value="death"[^>]*>إعلان وفاة<\/option>/.test(html),
  "death form has وفاة option"
);
assert(
  /<option value="condolence">تعزية<\/option>/.test(html),
  "death form has تعزية option"
);
assert(/id="patient-submit-type"/.test(html), "patient form has type select");
assert(/value="healing"/.test(html), "patient form has شفاء option");
assert(
  /home-request-create\.js\?v=20260817send1/.test(html),
  "home-request-create cache bust"
);
assert(/event-submit\.js\?v=20260817send1/.test(html), "event-submit cache bust");
assert(
  /request-experience\.js\?v=20260817send1/.test(html),
  "request-experience cache bust"
);

const rx = fs.readFileSync(
  path.join(root, "assets/js/modules/request-experience.js"),
  "utf8"
);
assert(rx.indexOf("function branchSelectOptionsHtml") >= 0, "branch select helper");
assert(rx.indexOf("اختر الفرع") >= 0, "correction forms include empty branch option");
assert(rx.indexOf("resolveUniquePersonHit") >= 0, "unique person resolve on submit");
assert(rx.indexOf("searchPeopleLive") >= 0, "live tree search fallback");

const createSrc = fs.readFileSync(
  path.join(root, "assets/js/modules/home-request-create.js"),
  "utf8"
);
assert(/event_death:\s*1/.test(createSrc), "notify kinds include event_death");
assert(/patient:\s*1/.test(createSrc), "notify kinds include patient");
assert(/type === "condolence"/.test(createSrc), "condolence maps to death guard");

const submitSrc = fs.readFileSync(
  path.join(root, "assets/js/event-submit.js"),
  "utf8"
);
assert(submitSrc.indexOf('if (isDeath && !type)') >= 0, "death defaults type");
assert(submitSrc.indexOf("if (typeEl && deathOpts.length)") >= 0, "do not wipe death options");

const guardBox = loadIife(
  path.join(root, "assets/js/modules/dup-identity-guard.js")
);
const CreateBox = loadIife(
  path.join(root, "assets/js/modules/home-request-create.js")
);
CreateBox.globalThis.AlzidanDupIdentityGuard =
  guardBox.globalThis.AlzidanDupIdentityGuard;
const Create =
  CreateBox.globalThis.AlzidanHomeRequestCreate || CreateBox.module.exports;
assert(
  Create.mapTypeFromEventPayload({ type: "death" }) === "death",
  "mapType death → death"
);
assert(
  Create.mapTypeFromEventPayload({ type: "condolence" }) === "death",
  "mapType condolence → death"
);
assert(
  Create.mapTypeFromEventPayload({ type: "sick" }) === "health",
  "mapType sick → health"
);

if (failed) {
  console.error("\nFailed:", failed);
  process.exit(1);
}
console.log("\nAll home-send fix checks passed.");
