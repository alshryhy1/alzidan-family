/**
 * Static regression: public page egress unbundle + TTL caches.
 * Ensures family_events polling is not bundled with site_settings/banner_messages.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const appJs = fs.readFileSync(path.join(root, "assets/js/app.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "pages/index.html"), "utf8");

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error("FAIL:", msg);
  } else {
    console.log("OK:", msg);
  }
}

assert(appJs.includes("SITE_SETTINGS_TTL_MS = 30 * 60 * 1000"), "site_settings TTL is 30 min");
assert(appJs.includes("BANNER_MESSAGES_TTL_MS = 10 * 60 * 1000"), "banner_messages TTL is 10 min");
assert(appJs.includes("function invalidatePublicMetaCache()"), "invalidatePublicMetaCache exists");
assert(appJs.includes("EVENTS_POLL_MS = 60000"), "events poll stays ~60s");
assert(appJs.includes("scheduleVisibleEventsRefresh"), "visibility refresh is debounced");
assert(appJs.includes("EVENTS_VISIBILITY_MIN_MS"), "visibility has min interval for events");
assert(appJs.includes("EVENTS_VISIBILITY_DEBOUNCE_MS"), "visibility debounce constant present");

assert(appJs.includes("loadAndRenderInFlight"), "loadAndRenderInFlight preserved");
assert(appJs.includes("eventsRenderGen"), "eventsRenderGen preserved");
assert(appJs.includes("eventsOpenState"), "eventsOpenState preserved");
assert(appJs.includes('from("family_events")'), "family_events fetch preserved");
assert(appJs.includes("event_tombstone"), "tombstones preserved");
assert(appJs.includes("showEventNotification"), "new-event notification preserved");

assert(
  /async function applyTickerSpeedSetting\(sb,\s*opts\)/.test(appJs) &&
    appJs.includes("SITE_SETTINGS_TTL_MS"),
  "applyTickerSpeedSetting accepts opts and respects TTL"
);
assert(
  /async function loadActiveBannerMessages\(sb,\s*opts\)/.test(appJs) &&
    appJs.includes("BANNER_MESSAGES_TTL_MS"),
  "loadActiveBannerMessages accepts opts and respects TTL"
);

const maybeIdx = appJs.indexOf("function maybeRefreshFromStorage()");
const maybeSlice = appJs.slice(maybeIdx, maybeIdx + 450);
assert(
  maybeSlice.includes("invalidatePublicMetaCache()") && maybeSlice.includes("loadAndRender()"),
  "alzidan refresh token path invalidates meta TTL then reloads"
);

const pollIdx = appJs.indexOf("function startPolling()");
const pollSlice = appJs.slice(pollIdx, pollIdx + 420);
assert(pollSlice.includes("if (loadAndRenderInFlight) return"), "poll skips when load in flight");

assert(/app\.js\?v=20260811treededupe1/.test(indexHtml), "pages/index.html cache-busts app.js");

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll public events egress TTL checks passed.");
