#!/usr/bin/env node
/**
 * Local unit checks for Saudi phone normalize used by delegate push binding.
 * Run: node scripts/test-push-phone-normalize.js
 */

function normalizeSaudiPhone(value) {
  let s = String(value ?? "");
  const map = {
    "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
    "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
    "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
    "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
  };
  s = s.replace(/[٠-٩۰-۹]/g, (ch) => map[ch] || ch);
  let digits = s.replace(/[^0-9]/g, "");
  if (!digits) return "";
  if (digits.startsWith("00966") && digits.length === 14 && digits.charAt(5) === "5") {
    return "0" + digits.slice(5);
  }
  if (digits.startsWith("966") && digits.length === 12 && digits.charAt(3) === "5") {
    return "0" + digits.slice(3);
  }
  if (digits.charAt(0) === "5" && digits.length === 9) {
    return "0" + digits;
  }
  if (digits.startsWith("05") && digits.length === 10) {
    return digits;
  }
  return digits;
}

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("OK:", msg);
  }
}

assert(normalizeSaudiPhone("0551840058") === "0551840058", "latin 05");
assert(normalizeSaudiPhone("٠٥٥١٨٤٠٠٥٨") === "0551840058", "arabic digits");
assert(normalizeSaudiPhone("551840058") === "0551840058", "missing leading 0");
assert(normalizeSaudiPhone("966551840058") === "0551840058", "966 country");
assert(normalizeSaudiPhone("00966551840058") === "0551840058", "00966");

const delegatePhones = new Set(["0551840058"]);
const tokenPhone = normalizeSaudiPhone("٠٥٥١٨٤٠٠٥٨");
assert(delegatePhones.has(tokenPhone), "token phone matches delegate set");

if (process.exitCode) {
  console.error("push phone normalize tests failed");
  process.exit(1);
}
console.log("all push phone normalize tests passed");
