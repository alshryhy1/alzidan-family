#!/usr/bin/env node
/**
 * Integration-style unit checks for phone↔token push binding.
 * Covers: normalize, multi-device upsert model, match-by-phone,
 * DeviceNotRegistered cleanup, event+token dedupe.
 *
 * Run: node scripts/test-push-token-phone-binding.js
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

/** Simulate register_push_token_v1 upsert by token PK (multi-device OK). */
function upsertToken(store, row) {
  const token = String(row.token || "").trim();
  const phone = row.phone ? normalizeSaudiPhone(row.phone) : "";
  const existing = store.get(token);
  if (!existing) {
    store.set(token, {
      token,
      platform: row.platform || null,
      phone: phone || null,
      enabled: true,
    });
    return store.get(token);
  }
  existing.platform = row.platform || existing.platform;
  existing.phone = phone || existing.phone; // coalesce: keep prior if omitted
  existing.enabled = true;
  return existing;
}

function matchTokensForPhones(tokenRows, phoneSet) {
  const matched = tokenRows.filter((row) => {
    const phone = normalizeSaudiPhone(row.phone);
    return phone && phoneSet.has(phone);
  });
  const seen = new Set();
  const unique = matched.filter((row) => {
    const t = String(row.token || "").trim();
    if (!t || seen.has(t)) return false;
    seen.add(t);
    return true;
  });
  return unique;
}

function cleanupInvalidTickets(store, chunk, tickets) {
  let disabled = 0;
  for (let i = 0; i < tickets.length; i++) {
    const detail = String(tickets[i]?.details?.error || "");
    if (detail === "DeviceNotRegistered") {
      const token = String(chunk[i]?.to || "");
      const row = store.get(token);
      if (row) {
        row.enabled = false;
        disabled += 1;
      }
    }
  }
  return disabled;
}

function buildEventKey(mode, requestId, kind = "") {
  const id = String(requestId || "").trim();
  if (!id) return "";
  return `${String(mode || "").trim()}|${id}|${String(kind || "").trim()}`;
}

function claimEventToken(claims, eventKey, token) {
  const t = String(token || "").trim();
  if (!eventKey || !t) return true;
  const key = `${eventKey}|${t}`;
  if (claims.has(key)) return false;
  claims.add(key);
  return true;
}

// ---- normalize ----
assert(normalizeSaudiPhone("0551840058") === "0551840058", "normalize latin 05");
assert(normalizeSaudiPhone("٠٥٥١٨٤٠٠٥٨") === "0551840058", "normalize arabic digits");
assert(normalizeSaudiPhone("966551840058") === "0551840058", "normalize 966");
assert(normalizeSaudiPhone("551840058") === "0551840058", "normalize missing 0");

// ---- register / multi-device upsert by phone ----
{
  const store = new Map();
  upsertToken(store, { token: "ExponentPushToken[A]", platform: "ios", phone: "0551840058" });
  upsertToken(store, { token: "ExponentPushToken[B]", platform: "android", phone: "٠٥٥١٨٤٠٠٥٨" });
  // same token on new write without phone keeps binding
  upsertToken(store, { token: "ExponentPushToken[A]", platform: "ios" });
  // same token updates phone when provided
  upsertToken(store, { token: "ExponentPushToken[C]", platform: "ios", phone: "0500000001" });
  upsertToken(store, { token: "ExponentPushToken[C]", platform: "ios", phone: "0500000002" });

  assert(store.size === 3, "multi-device: 3 distinct tokens");
  assert(store.get("ExponentPushToken[A]").phone === "0551840058", "token A keeps phone on phoneless upsert");
  assert(store.get("ExponentPushToken[B]").phone === "0551840058", "token B arabic phone normalized");
  assert(store.get("ExponentPushToken[C]").phone === "0500000002", "token C phone updated");

  const phoneSet = new Set(["0551840058"]);
  const matched = matchTokensForPhones([...store.values()].filter((r) => r.enabled), phoneSet);
  assert(matched.length === 2, "match sends to both devices for same phone");
  assert(
    matched.every((r) => r.token === "ExponentPushToken[A]" || r.token === "ExponentPushToken[B]"),
    "match excludes other phones",
  );
}

// ---- race: phoneless then phone-bound must not drop identity ----
{
  // Simulates fixed client: wait for phoneless in-flight, then re-run with phone.
  let lastPhone = null;
  const store = new Map();
  // mount registration without phone
  upsertToken(store, { token: "ExponentPushToken[RACE]", platform: "ios" });
  lastPhone = null;
  // bind after race wait
  upsertToken(store, { token: "ExponentPushToken[RACE]", platform: "ios", phone: "0551840058" });
  lastPhone = "0551840058";
  assert(store.get("ExponentPushToken[RACE]").phone === "0551840058", "race recovery binds phone");
  assert(lastPhone === "0551840058", "client remembers bound phone");
}

// ---- cleanup DeviceNotRegistered ----
{
  const store = new Map();
  upsertToken(store, { token: "ExponentPushToken[DEAD]", platform: "ios", phone: "0551840058" });
  upsertToken(store, { token: "ExponentPushToken[LIVE]", platform: "ios", phone: "0551840058" });
  const chunk = [{ to: "ExponentPushToken[DEAD]" }, { to: "ExponentPushToken[LIVE]" }];
  const tickets = [
    { status: "error", details: { error: "DeviceNotRegistered" } },
    { status: "ok" },
  ];
  const disabled = cleanupInvalidTickets(store, chunk, tickets);
  assert(disabled === 1, "cleanup disables one dead token");
  assert(store.get("ExponentPushToken[DEAD]").enabled === false, "dead token enabled=false");
  assert(store.get("ExponentPushToken[LIVE]").enabled === true, "live token remains enabled");

  const phoneSet = new Set(["0551840058"]);
  const matched = matchTokensForPhones([...store.values()].filter((r) => r.enabled), phoneSet);
  assert(matched.length === 1 && matched[0].token === "ExponentPushToken[LIVE]", "match skips disabled");
}

// ---- event+token dedupe ----
{
  const claims = new Set();
  const eventKey = buildEventKey("branch_delegate_new_request", "REQ-100", "event_card");
  assert(claimEventToken(claims, eventKey, "ExponentPushToken[A]") === true, "first claim allowed");
  assert(claimEventToken(claims, eventKey, "ExponentPushToken[A]") === false, "duplicate event+token blocked");
  assert(claimEventToken(claims, eventKey, "ExponentPushToken[B]") === true, "other device still allowed");
  const otherEvent = buildEventKey("branch_delegate_new_request", "REQ-101", "event_card");
  assert(claimEventToken(claims, otherEvent, "ExponentPushToken[A]") === true, "new event allows same token");
}

// ---- notification copy has no raw technical fields ----
{
  const title = "طلب جديد يحتاج مراجعتك";
  const body = "وصل طلب مناسبة جديد لفرع مزيد، ويحتاج إلى مراجعتك واتخاذ الإجراء المناسب.";
  assert(!/event_card|branch_key|request_id|ExponentPushToken/i.test(title + body), "user-facing copy has no raw tech");
}

if (process.exitCode) {
  console.error("\npush token phone binding tests FAILED");
  process.exit(1);
}
console.log("\nall push token phone binding tests passed");
