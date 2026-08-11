#!/usr/bin/env node
/**
 * Live + mock create-path tests for event / health / death / memory.
 * Proves Create.create live probes BLOCK same-record and ALLOW unique,
 * plus rapid double-submit ≤1 insert. No production INSERTs (performInsert mock).
 *
 * Run: npm run verify:dup-create-paths
 */
"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const { URL } = require("url");

const root = path.join(__dirname, "..");
const cfg = fs.readFileSync(path.join(root, "assets/js/config.js"), "utf8");
const SUPABASE_URL = (cfg.match(/SUPABASE_URL\s*=\s*"([^"]+)"/) || [])[1];
const SUPABASE_ANON_KEY = (cfg.match(/SUPABASE_ANON_KEY\s*=\s*"([^"]+)"/) || [])[1];

function loadIife(modulePath) {
  const src = fs.readFileSync(modulePath, "utf8");
  const sandbox = { module: { exports: {} }, globalThis: {}, console };
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

const guardBox = loadIife(path.join(root, "assets/js/modules/dup-identity-guard.js"));
const Guard =
  guardBox.globalThis.AlzidanDupIdentityGuard || guardBox.module.exports;
const createBox = loadIife(path.join(root, "assets/js/modules/home-request-create.js"));
createBox.globalThis.AlzidanDupIdentityGuard = Guard;
const Create =
  createBox.globalThis.AlzidanHomeRequestCreate || createBox.module.exports;

let failed = 0;
const results = [];
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    results.push({ ok: false, msg });
    console.error("FAIL:", msg);
  } else {
    results.push({ ok: true, msg });
    console.log("OK:", msg);
  }
}

function restGet(tableQuery) {
  return new Promise(function (resolve, reject) {
    const u = new URL(SUPABASE_URL + "/rest/v1/" + tableQuery);
    const req = https.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: "GET",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: "Bearer " + SUPABASE_ANON_KEY,
        },
      },
      function (res) {
        let body = "";
        res.on("data", function (c) {
          body += c;
        });
        res.on("end", function () {
          if (res.statusCode >= 400) {
            reject(new Error("REST " + res.statusCode + " " + tableQuery + " " + body.slice(0, 200)));
            return;
          }
          try {
            resolve(JSON.parse(body || "[]"));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

/** Minimal supabase-like client used by Create live probes. */
function makeRestClient(overrides) {
  overrides = overrides || {};
  return {
    from(table) {
      if (overrides.from) {
        const o = overrides.from(table);
        if (o) return o;
      }
      const state = {
        table: table,
        selectCols: "*",
        filters: [],
        limitN: null,
      };
      const api = {
        select(cols) {
          state.selectCols = cols || "*";
          return api;
        },
        eq(col, val) {
          state.filters.push({ col: col, val: val });
          return api;
        },
        in() {
          return api;
        },
        limit(n) {
          state.limitN = n;
          return api;
        },
        then(resolve, reject) {
          let q =
            state.table +
            "?select=" +
            encodeURIComponent(String(state.selectCols).replace(/\s+/g, ""));
          state.filters.forEach(function (f) {
            q += "&" + f.col + "=eq." + encodeURIComponent(String(f.val));
          });
          if (state.limitN) q += "&limit=" + state.limitN;
          restGet(q)
            .then(function (data) {
              resolve({ data: data, error: null });
            })
            .catch(function (e) {
              if (reject) reject(e);
              else resolve({ data: null, error: e });
            });
        },
      };
      return api;
    },
  };
}

function uniqueStamp() {
  return "dup4-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}

async function runCreate(type, payload, client, extra) {
  if (typeof Create.resetLocksForTests === "function") Create.resetLocksForTests();
  let inserts = 0;
  const opts = Object.assign(
    {
      type: type,
      payload: payload,
      client: client,
      skipFetch: true,
      performInsert: async function () {
        inserts += 1;
        return { ok: true, request_id: "MOCK-" + type };
      },
    },
    extra || {}
  );
  const created = await Create.create(opts);
  return { created: created, inserts: inserts };
}

async function assertBlocked(label, type, payload, client) {
  const { created, inserts } = await runCreate(type, payload, client);
  assert(created.ok === false && created.blocked === true, label + " → blocked");
  assert(inserts === 0, label + " → inserts=0");
  const msg = (created.guard && created.guard.message_ar) || "";
  assert(
    msg.indexOf("موجود مسبقًا") >= 0 ||
      msg.indexOf("مسجلة مسبقًا") >= 0 ||
      msg.indexOf("هذه المناسبة مسجلة مسبقًا") >= 0,
    label + " → message already-registered (got: " + msg + ")"
  );
  return created;
}

async function assertAllowed(label, type, payload, client) {
  const { created, inserts } = await runCreate(type, payload, client);
  assert(created.ok === true, label + " → allow (ok)");
  assert(inserts === 1, label + " → inserts=1");
  return created;
}

async function assertDoubleSubmit(label, type, payload, client) {
  if (typeof Create.resetLocksForTests === "function") Create.resetLocksForTests();
  let inserts = 0;
  async function once() {
    return Create.create({
      type: type,
      payload: payload,
      client: client,
      skipFetch: true,
      performInsert: async function () {
        inserts += 1;
        await new Promise(function (r) {
          setTimeout(r, 40);
        });
        return { ok: true };
      },
    });
  }
  const pair = await Promise.all([once(), once()]);
  const okCount = pair.filter(function (x) {
    return x && x.ok;
  }).length;
  const dup = pair.some(function (x) {
    return x && x.doubleSubmit;
  });
  assert(okCount === 1, label + " double-submit → okCount=1");
  assert(dup, label + " double-submit → flagged");
  assert(inserts <= 1, label + " double-submit → inserts≤1 (got " + inserts + ")");
}

function staticUiPaths() {
  const files = [
    ["assets/js/event-submit.js", /Create\.create\s*\(/],
    ["assets/js/delegate-events-mgmt.js", /Create\.create\s*\(/],
    ["assets/js/memory/submit.js", /Create\.create\s*\(/],
  ];
  files.forEach(function (pair) {
    const src = fs.readFileSync(path.join(root, pair[0]), "utf8");
    assert(pair[1].test(src), "static: " + pair[0] + " calls Create.create");
  });
  const mem = fs.readFileSync(path.join(root, "assets/js/memory/submit.js"), "utf8");
  // Must not fall through to unguarded rpc when Create missing
  const rpcIdx = mem.indexOf("memory_submit_item_v1");
  const createIdx = mem.indexOf("Create.create");
  const failClosed = mem.indexOf("حارس الهوية غير محمّل");
  assert(createIdx >= 0 && failClosed >= 0, "static: memory submit fail-closed without Create");
  // Public submit path should not call rpc outside Create (rpc only inside home-request-create)
  assert(
    rpcIdx < 0 || mem.indexOf("client.rpc(\"memory_submit_item_v1\"") < 0,
    "static: memory public path has no direct rpc bypass"
  );
  const hrc = fs.readFileSync(
    path.join(root, "assets/js/modules/home-request-create.js"),
    "utf8"
  );
  assert(
    hrc.indexOf("findExistingEventLive") >= 0 &&
      hrc.indexOf("findExistingHealthLive") >= 0 &&
      hrc.indexOf("findExistingDeathLive") >= 0 &&
      hrc.indexOf("findExistingMemoryLive") >= 0,
    "static: home-request-create exports live probes for 4 types"
  );
  const insertApproval = hrc.indexOf("async function insertApprovalRequest");
  const liveEvent = hrc.indexOf("findExistingEventLive");
  assert(
    liveEvent > 0 && insertApproval > liveEvent,
    "static: live probes defined before insertApprovalRequest"
  );
}

(async function main() {
  if (!Guard || !Create) {
    console.error("modules not loaded");
    process.exit(1);
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error("config.js missing Supabase URL/key");
    process.exit(1);
  }

  console.log("\n=== static UI wiring ===");
  staticUiPaths();

  const client = makeRestClient();
  const stamp = uniqueStamp();

  console.log("\n=== load live fixtures ===");
  const events = await restGet(
    "family_events?select=id,type,person,date_label,event_date,details,branch_key,hospital_name&limit=50"
  );
  const memories = await restGet(
    "family_memory_items?select=id,person_id,person_name,title,memory_kind,memory_date,memory_year,branch_key,status&limit=20"
  );
  const deceased = await restGet(
    "tree_children?select=person_id,child_name,is_deceased,deceased,branch_key&is_deceased=eq.true&limit=3"
  );
  const deathRow = (events || []).find(function (e) {
    return String(e.type) === "death";
  });
  const happyRow = (events || []).find(function (e) {
    return !["death", "sick", "operation", "discharge"].includes(String(e.type));
  });
  const healthRow = (events || []).find(function (e) {
    return ["sick", "operation", "discharge"].includes(String(e.type));
  });
  const memoryRow = (memories || [])[0];
  const deceasedRow = (deceased || [])[0];

  assert(!!deathRow, "fixture: live death family_events row");
  assert(!!memoryRow, "fixture: live memory row");
  assert(!!deceasedRow && !!deceasedRow.person_id, "fixture: live deceased person_id");

  // ---------- EVENT ----------
  console.log("\n=== event (مناسبات) ===");
  // Live "exists": only death-typed family_events row is present — use core fields via type=event probe
  // (family_events table identity). Happy occasions have 0 rows in live DB.
  if (deathRow) {
    await assertBlocked(
      "event exists (live family_events core)",
      "event",
      {
        type: deathRow.type,
        person: deathRow.person,
        person_id: "",
        date_label: deathRow.date_label,
        event_date: deathRow.event_date || "",
        title: deathRow.person + " صياغة مختلفة",
        branch_key: deathRow.branch_key,
      },
      client
    );
  }
  if (happyRow) {
    await assertBlocked(
      "event exists (live happy)",
      "event",
      {
        type: happyRow.type,
        person: happyRow.person,
        date_label: happyRow.date_label,
        event_date: happyRow.event_date || "",
        title: "عنوان مختلف نصًا",
        branch_key: happyRow.branch_key,
      },
      client
    );
  } else {
    console.log("NOTE: no live happy event rows — exists proven via death-typed family_events core match");
  }
  await assertAllowed(
    "event new unique",
    "event",
    {
      type: "marriage",
      person: "شخص اختبار " + stamp,
      person_id: "",
      date_label: "2099-01-01",
      title: "زواج اختبار " + stamp,
      branch_key: "زيدان",
    },
    client
  );
  await assertAllowed(
    "event different record",
    "event",
    {
      type: "gathering",
      person: "آخر " + stamp,
      date_label: "2099-06-15",
      title: "لقاء " + stamp,
      branch_key: "مزيد",
    },
    client
  );
  await assertDoubleSubmit(
    "event",
    "event",
    {
      type: "marriage",
      person: "سرعة " + stamp,
      date_label: "2099-02-02",
      title: "سرعة " + stamp,
      branch_key: "زيدان",
    },
    client
  );

  // ---------- HEALTH ----------
  console.log("\n=== health (مرضى) ===");
  if (healthRow) {
    await assertBlocked(
      "health exists (live)",
      "health",
      {
        type: healthRow.type,
        person: healthRow.person,
        person_id: "",
        hospital_name: healthRow.hospital_name || "مستشفى",
        event_date: healthRow.event_date || healthRow.date_label || "",
        branch_key: healthRow.branch_key,
      },
      client
    );
  } else {
    console.log("NOTE: no live health rows — proving live-probe BLOCK via REST-shaped fixture client");
    const fixturePerson = "مريض اختبار ثابت";
    const fixtureClient = makeRestClient({
      from: function (table) {
        if (table !== "family_events") return null;
        const api = {
          select: function () {
            return api;
          },
          eq: function () {
            return api;
          },
          in: function () {
            return api;
          },
          limit: function () {
            return api;
          },
          then: function (resolve) {
            resolve({
              data: [
                {
                  id: 900001,
                  branch_key: "زيدان",
                  type: "sick",
                  person: fixturePerson,
                  date_label: "2026-08-01",
                  event_date: "2026-08-01",
                  hospital_name: "مستشفى الملك فيصل",
                  details: JSON.stringify({
                    person_id: "",
                    hospitalName: "مستشفى الملك فيصل",
                    homeCity: "",
                    homeArea: "",
                  }),
                },
              ],
              error: null,
            });
          },
        };
        return api;
      },
    });
    await assertBlocked(
      "health exists (fixture live-probe path)",
      "health",
      {
        type: "sick",
        person: fixturePerson,
        hospital_name: "مستشفى الملك فيصل",
        event_date: "2026-08-01",
        branch_key: "زيدان",
      },
      fixtureClient
    );
  }
  await assertAllowed(
    "health new unique",
    "health",
    {
      type: "sick",
      person: "مريض جديد " + stamp,
      hospital_name: "مستشفى " + stamp,
      event_date: "2099-03-03",
      branch_key: "زيدان",
    },
    client
  );
  await assertAllowed(
    "health different record",
    "health",
    {
      type: "operation",
      person: "عملية " + stamp,
      hospital_name: "مجمع " + stamp,
      event_date: "2099-04-04",
      branch_key: "مزيد",
    },
    client
  );
  await assertDoubleSubmit(
    "health",
    "health",
    {
      type: "sick",
      person: "سرعة مرض " + stamp,
      hospital_name: "مشفى سرعة " + stamp,
      event_date: "2099-05-05",
      branch_key: "زيدان",
    },
    client
  );

  // ---------- DEATH ----------
  console.log("\n=== death (وفيات) ===");
  await assertBlocked(
    "death exists (live deceased person_id)",
    "death",
    {
      person_id: deceasedRow.person_id,
      person: "أي اسم",
      branch_key: deceasedRow.branch_key || "",
    },
    client
  );
  if (deathRow) {
    await assertBlocked(
      "death exists (live death event by name)",
      "death",
      {
        person_id: "",
        person: deathRow.person,
        branch_key: deathRow.branch_key,
      },
      client
    );
  }
  await assertAllowed(
    "death new unique (no person_id collision)",
    "death",
    {
      person_id: "",
      person: "وفاة اختبار " + stamp,
      date_label: "2099-07-07",
      branch_key: "زيدان",
    },
    client
  );
  await assertAllowed(
    "death different person",
    "death",
    {
      person_id: "",
      person: "شخص آخر " + stamp,
      branch_key: "مزيد",
    },
    client
  );
  await assertDoubleSubmit(
    "death",
    "death",
    {
      person: "وفاة سرعة " + stamp,
      branch_key: "لاحم",
    },
    client
  );

  // ---------- MEMORY ----------
  console.log("\n=== memory (ذكريات) ===");
  await assertBlocked(
    "memory exists (live)",
    "memory",
    {
      person_id: memoryRow.person_id || "",
      person_name: memoryRow.person_name,
      title: memoryRow.title,
      memory_kind: memoryRow.memory_kind,
      memory_date: memoryRow.memory_date || memoryRow.memory_year || "",
      branch_key: memoryRow.branch_key,
    },
    client
  );
  await assertAllowed(
    "memory new unique",
    "memory",
    {
      person_id: "",
      person_name: "صاحب ذكرى " + stamp,
      title: "عنوان ذكرى " + stamp,
      memory_kind: "general",
      memory_date: "2099-08-08",
      branch_key: "زيدان",
    },
    client
  );
  await assertAllowed(
    "memory different record",
    "memory",
    {
      person_name: "آخر " + stamp,
      title: "ذكرى مختلفة " + stamp,
      memory_kind: "story",
      memory_date: "2099-09-09",
      branch_key: "مزيد",
    },
    client
  );
  await assertDoubleSubmit(
    "memory",
    "memory",
    {
      person_name: "سرعة ذكرى " + stamp,
      title: "سرعة " + stamp,
      memory_kind: "general",
      memory_date: "2099-10-10",
      branch_key: "زيدان",
    },
    client
  );

  console.log("\n--- summary ---");
  console.log("passed:", results.filter((x) => x.ok).length, "/", results.length);
  if (failed) {
    console.error("FAILED:", failed);
    process.exit(1);
  }
  console.log("All dup-identity create-path checks passed.");
  console.log("DB modification: none");
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
