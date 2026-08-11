#!/usr/bin/env node
/**
 * Focused proof: screenshot phone ٠٥٥١٨٤٠٠٥٨ must pass login PHONE_GATE.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const jsPath = path.join(root, "assets/js/delegate.js");
const htmlPath = path.join(root, "pages/alzidan-tree.html");
const js = fs.readFileSync(jsPath, "utf8");
const html = fs.readFileSync(htmlPath, "utf8");

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error("FAIL:", msg);
  } else {
    console.log("OK:", msg);
  }
}

const start = js.indexOf("function normalizeArabicDigitsToLatin");
const end = js.indexOf("function bindSilentDigitNormalize");
assert(start >= 0 && end > start, "digit helpers + PHONE_GATE present");

const sandbox = { alerts: [] };
sandbox.setLoginAlert = function (type, text) {
  sandbox.alerts.push({ type: type, text: text });
};
const helpersSrc =
  js.slice(start, end) +
  "\n;({ normalizeArabicDigitsToLatin, digitsOnlyLatin, normalizePhone, isValidSaudiMobile, normalizeDelegateSecret, isValidDelegateSecret, readNormalizedPhoneField, rejectUnlessValidSaudiMobile })";
const H = vm.runInNewContext(helpersSrc, sandbox);

const SCREENSHOT = "٠٥٥١٨٤٠٠٥٨";
assert(H.normalizePhone(SCREENSHOT) === "0551840058", "screenshot phone normalizes to 0551840058");
assert(H.isValidSaudiMobile(SCREENSHOT) === true, "isValidSaudiMobile(٠٥٥١٨٤٠٠٥٨) === true");

sandbox.alerts = [];
const fakeInput = { value: SCREENSHOT };
const gate = H.rejectUnlessValidSaudiMobile(fakeInput.value, fakeInput);
assert(gate.ok === true, "PHONE_GATE ok for screenshot phone");
assert(gate.phone === "0551840058", "PHONE_GATE phone === 0551840058");
assert(fakeInput.value === "0551840058", "field rewritten to Western digits");
assert(
  sandbox.alerts.every(function (a) {
    return a.text !== "يرجى إدخال رقم جوال صحيح.";
  }),
  "login gate does NOT emit phone error for valid Arabic phone"
);

function simulateLoginValidate(rawPhone, rawSecret, branchKey) {
  sandbox.alerts = [];
  const phoneInput = { value: rawPhone };
  const codeInput = { value: rawSecret };
  const phoneGate = H.rejectUnlessValidSaudiMobile(phoneInput.value, phoneInput);
  const phone = phoneGate.phone;
  const secret = H.normalizeDelegateSecret(codeInput.value);
  codeInput.value = secret;
  const parentsByBranch = { زيدان: 1, مزيد: 1, زايد: 1, لاحم: 1, ملحم: 1 };
  if (!branchKey || !Object.prototype.hasOwnProperty.call(parentsByBranch, branchKey)) {
    sandbox.setLoginAlert("error", "يرجى اختيار الفرع قبل المتابعة.");
    return { stage: "branch", alerts: sandbox.alerts.slice(), phoneInput: phoneInput, phone: phone };
  }
  if (!phoneGate.ok) {
    return { stage: "phone", alerts: sandbox.alerts.slice(), phoneInput: phoneInput, phone: phone };
  }
  if (!H.isValidDelegateSecret(secret)) {
    sandbox.setLoginAlert("error", "يرجى إدخال رقم سري (4 أحرف على الأقل).");
    return { stage: "secret", alerts: sandbox.alerts.slice(), phoneInput: phoneInput, phone: phone };
  }
  return { stage: "ok", alerts: sandbox.alerts.slice(), phoneInput: phoneInput, phone: phone, secret: secret };
}

const sim = simulateLoginValidate(SCREENSHOT, "١٢٣٤", "زيدان");
assert(sim.stage === "ok", "full login validate stage=ok for Arabic phone+secret");
assert(
  !sim.alerts.some(function (a) {
    return a.text === "يرجى إدخال رقم جوال صحيح.";
  }),
  "simulated دخول المندوب does not return phone error for ٠٥٥١٨٤٠٠٥٨"
);
assert(sim.phone === "0551840058", "simulated login phone normalized");

const bad = simulateLoginValidate("٠٥٥", "١٢٣٤", "زيدان");
assert(bad.stage === "phone", "short Arabic phone still rejected at phone stage");
assert(
  bad.alerts.some(function (a) {
    return a.text === "يرجى إدخال رقم جوال صحيح.";
  }),
  "short phone still shows the exact error message"
);

assert(js.includes("PHONE_GATE login"), "loginBtn wired to PHONE_GATE");
assert(js.includes("rejectUnlessValidSaudiMobile"), "shared gate helper exists");
assert(
  (js.match(/setLoginAlert\("error", "يرجى إدخال رقم جوال صحيح\."\)/g) || []).length === 1,
  "setLoginAlert phone error only inside helper once"
);
assert(html.includes("delegate.js?v=delegattr1"), "cache-bust delegate.js delegattr1");
assert(html.includes("delegate.css?v=delegattr1"), "cache-bust delegate.css");
assert(html.includes("delegate-head.js?v=delegattr1"), "cache-bust delegate-head");

if (failed) {
  console.error("\n" + failed + " check(s) failed");
  process.exit(1);
}
console.log("\nAll screenshot phone / PHONE_GATE checks passed.");
