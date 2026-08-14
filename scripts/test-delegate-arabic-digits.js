#!/usr/bin/env node
/**
 * Focused proof: screenshot phone ٠٥٥١٨٤٠٠٥٨ must pass PHONE_GATE as E.164.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const intlPath = path.join(root, "assets/js/modules/phone-intl.js");
const jsPath = path.join(root, "assets/js/delegate.js");
const htmlPath = path.join(root, "pages/alzidan-tree.html");
const intl = fs.readFileSync(intlPath, "utf8");
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

assert(html.includes("phone-intl.js"), "alzidan-tree.html loads phone-intl.js");
assert(html.includes('data-phone-intl="login"'), "login phone country picker present");
assert(html.includes('data-phone-intl="request"'), "delegate request phone country picker present");

const start = js.indexOf("function normalizeArabicDigitsToLatin");
const end = js.indexOf("function bindSilentDigitNormalize");
assert(start >= 0 && end > start, "digit helpers + PHONE_GATE present");

const sandbox = { alerts: [], window: {}, globalThis: {} };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.setLoginAlert = function (type, text) {
  sandbox.alerts.push({ type: type, text: text });
};
vm.runInNewContext(intl, sandbox);
const helpersSrc =
  js.slice(start, end) +
  "\n;({ normalizeArabicDigitsToLatin, digitsOnlyLatin, normalizePhone, isValidSaudiMobile, normalizeDelegateSecret, isValidDelegateSecret, readNormalizedPhoneField, rejectUnlessValidSaudiMobile })";
const H = vm.runInNewContext(helpersSrc, sandbox);

const SCREENSHOT = "٠٥٥١٨٤٠٠٥٨";
const EXPECT = "+966551840058";
assert(H.normalizePhone(SCREENSHOT) === EXPECT, "screenshot phone normalizes to " + EXPECT);
assert(H.isValidSaudiMobile(SCREENSHOT) === true, "isValidSaudiMobile(٠٥٥١٨٤٠٠٥٨) === true");
assert(sandbox.AlzidanPhoneIntl.isValidNational("IQ", "7701234567") === true, "Iraq national 7XXXXXXXXX valid");
assert(sandbox.AlzidanPhoneIntl.toE164("IQ", "7701234567") === "+9647701234567", "Iraq E.164");

sandbox.alerts = [];
const gate = H.rejectUnlessValidSaudiMobile(SCREENSHOT, null);
assert(gate.ok === true, "PHONE_GATE ok for screenshot phone");
assert(gate.phone === EXPECT, "PHONE_GATE phone === " + EXPECT);

function simulateLoginValidate(rawPhone, rawSecret, branchKey) {
  sandbox.alerts = [];
  const phone = H.normalizePhone(rawPhone);
  const secret = H.normalizeDelegateSecret(rawSecret);
  const parentsByBranch = { زيدان: 1, مزيد: 1, زايد: 1, لاحم: 1, ملحم: 1 };
  if (!branchKey || !Object.prototype.hasOwnProperty.call(parentsByBranch, branchKey)) {
    sandbox.setLoginAlert("error", "يرجى اختيار الفرع قبل المتابعة.");
    return { stage: "branch", alerts: sandbox.alerts.slice(), phone: phone };
  }
  if (!H.isValidSaudiMobile(phone)) {
    sandbox.setLoginAlert("error", "يرجى إدخال رقم جوال صحيح مع اختيار الدولة.");
    return { stage: "phone", alerts: sandbox.alerts.slice(), phone: phone };
  }
  if (!H.isValidDelegateSecret(secret)) {
    sandbox.setLoginAlert("error", "يرجى إدخال رقم سري (4 أحرف على الأقل).");
    return { stage: "secret", alerts: sandbox.alerts.slice(), phone: phone };
  }
  return { stage: "ok", alerts: sandbox.alerts.slice(), phone: phone, secret: secret };
}

const sim = simulateLoginValidate(SCREENSHOT, "١٢٣٤", "زيدان");
assert(sim.stage === "ok", "full login validate stage=ok for Arabic phone+secret");
assert(sim.phone === EXPECT, "sim phone is E.164");
assert(sim.secret === "1234", "Arabic secret normalized");

const candidates = sandbox.AlzidanPhoneIntl.phoneCandidates(EXPECT);
assert(candidates.includes("0551840058"), "candidates include legacy 05…");
assert(candidates.includes(EXPECT), "candidates include E.164");

process.exit(failed ? 1 : 0);
