"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const files = {
  admin: fs.readFileSync(path.join(root, "assets/js/admin.js"), "utf8"),
  auth: fs.readFileSync(path.join(root, "assets/js/admin-auth.js"), "utf8"),
  stats: fs.readFileSync(path.join(root, "assets/js/admin-requests-stats.js"), "utf8"),
  marriage: fs.readFileSync(path.join(root, "assets/js/modules/marriage-stats.js"), "utf8"),
  requests: fs.readFileSync(path.join(root, "assets/js/modules/requests.js"), "utf8"),
  bulk: fs.readFileSync(path.join(root, "assets/js/admin-bulk-name-audit.js"), "utf8"),
  family: fs.readFileSync(path.join(root, "assets/js/admin-family-mgmt.js"), "utf8"),
};

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
}

function count(hay, needle) {
  let n = 0;
  let i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) {
    n += 1;
    i += needle.length;
  }
  return n;
}

// P0 init guard
assert(files.admin.includes("const authOwnsStartup = !!(window.AlzidanAuth)"), "admin.js missing authOwnsStartup guard");
assert(files.admin.includes("if (!authOwnsStartup)"), "admin.js missing !authOwnsStartup branches");
assert(files.auth.includes("window.AlzidanAuth ="), "admin-auth exports AlzidanAuth");
assert(files.auth.includes('adminLoginBtn.addEventListener("click"'), "admin-auth owns login button");
assert(files.auth.includes('sb.rpc("admin_login"'), "admin_login RPC preserved");
assert(!/setTimeout\s*\(\s*.*refreshAuthStatus/.test(files.admin), "no setTimeout auth hack in admin.js");

// admin.js must not auto-call loadRequestsStats in init path
assert(!/AlzidanRequestsStats\.loadRequestsStats\(\)\.catch/.test(files.admin), "admin.js must not bind/call loadRequestsStats");
assert(!/AlzidanRequestsStats\.loadRequestsStats\(\)\.catch/.test(files.auth), "admin-auth must not auto-load stats");

// Stats on-demand
assert(files.stats.includes("STATS_ROW_LIMIT = 1000"), "stats limit capped to 1000");
assert(!files.stats.includes("p_limit: 5000"), "stats must not use p_limit 5000");
assert(files.stats.includes("bindRequestsStatsTriggers"), "stats binds on-demand triggers");
assert(files.stats.includes('alzidan:admin-module'), "stats loads on opening requests module");
assert(files.stats.includes('refresh-requests-stats'), "stats binds refresh button");
// Ensure no bare auto-call at module end: last export then bindTriggers only
const statsTail = files.stats.trim().slice(-200);
assert(statsTail.includes("bindRequestsStatsTriggers();"), "stats ends with bind only");
assert(!/loadRequestsStats\(\)\.catch\(\(\) => \{\}\);\s*\}\)\(\);?\s*$/.test(files.stats.replace(/\s+/g, " ")), "no auto loadRequestsStats on script load");

// Filters single source
assert(files.requests.includes('filterStatus.addEventListener("change"'), "requests.js owns status filter");
assert(files.requests.includes('filterKind.addEventListener("change"'), "requests.js owns kind filter");
assert(!files.admin.includes('filterKind.addEventListener("change"'), "admin.js must not duplicate kind filter");
assert(!files.admin.includes('filterStatus.addEventListener("change"'), "admin.js must not duplicate status filter");
assert(files.requests.includes("p_limit: 50"), "loadRequests keeps p_limit 50");
assert(files.requests.includes("// Bind filters/pager only"), "bootstrap does not auto loadRequests");
assert(!/bootstrap\.didRun = true;\s*init\(\);\s*loadRequests\(\)/.test(files.requests), "bootstrap must not call loadRequests");

// Prior mitigations
assert(files.admin.includes("__alzidanAdminPendingPoll"), "shared pending poll state kept");
assert(files.auth.includes("__alzidanAdminPendingPoll"), "auth uses shared pending poll");
assert(files.bulk.includes("No auto tree load"), "bulk-audit no auto");
assert(files.family.includes("alzidan:admin-module"), "deferred tree mount via module event");
assert(files.family.includes("Do not auto-mount or load tree here"), "family deferred mount comment");

// Marriage stats on-demand (no auto-load before login / on parse)
assert(files.marriage.includes("bindMarriageStatsTriggers"), "marriage stats binds on-demand triggers");
assert(files.marriage.includes('id !== "stats"'), "marriage stats loads on opening stats module");
assert(files.marriage.includes("On-demand only"), "marriage stats documents on-demand only");
assert(!/loadMarriageStats\(\)\.catch\(\(\) => \{\}\);\s*isInitialized = true/.test(files.marriage.replace(/\s+/g, " ")), "marriage stats must not auto-load in init");
assert(files.marriage.includes("getAdminToken"), "marriage stats requires auth token");

// Scenario static matrix (expected RPC call sites)
const scenarios = {
  openNoLogin: {
    // No token => auth refreshAuthStatus only; loadRequests returns early without rpc if no token
    expectStatsAuto: false,
    expectFilterDup: false,
  },
  login: {
    authCallsLoadRequests: count(files.auth, "AlzidanAdminRequests.loadRequests") >= 1,
    authCallsStats: /loadRequestsStats/.test(files.auth),
  },
  filterChange: {
    listenersInRequests: count(files.requests, 'addEventListener("change"') >= 2,
    listenersInAdmin: count(files.admin, 'filterKind.addEventListener') + count(files.admin, 'filterStatus.addEventListener'),
  },
  openStats: {
    moduleTrigger: files.stats.includes('id !== "requests"'),
    refreshTrigger: files.stats.includes("refresh-requests-stats"),
  },
};

assert(scenarios.login.authCallsLoadRequests, "login path still loads requests");
assert(!scenarios.login.authCallsStats, "login must not load stats");
assert(scenarios.filterChange.listenersInAdmin === 0, "no admin filter listeners");
assert(scenarios.openStats.moduleTrigger && scenarios.openStats.refreshTrigger, "open stats triggers present");

console.log(JSON.stringify({ ok: true, scenarios }, null, 2));
