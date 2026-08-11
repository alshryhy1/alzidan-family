#!/usr/bin/env node
/**
 * Occasion (مناسبات) duplicate guard — Create.create + live probe mocks.
 * Same-record: type + person (+ person_id when present) + date.
 * Run: npm run verify:occasion-dup
 */
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

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

const guardBox = loadIife(
  path.join(root, "assets/js/modules/dup-identity-guard.js")
);
const Guard =
  guardBox.globalThis.AlzidanDupIdentityGuard || guardBox.module.exports;
const createBox = loadIife(
  path.join(root, "assets/js/modules/home-request-create.js")
);
createBox.globalThis.AlzidanDupIdentityGuard = Guard;
const Create =
  createBox.globalThis.AlzidanHomeRequestCreate || createBox.module.exports;

const trackBox = loadIife(
  path.join(root, "assets/js/modules/my-requests-track.js")
);
const Track =
  trackBox.globalThis.AlzidanRxMyRequests || trackBox.module.exports;

/** Minimal localStorage for track append unit tests. */
function installMemoryStorage(target) {
  const store = Object.create(null);
  target.localStorage = {
    getItem: function (k) {
      return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
    },
    setItem: function (k, v) {
      store[k] = String(v);
    },
    removeItem: function (k) {
      delete store[k];
    },
    clear: function () {
      for (const k of Object.keys(store)) delete store[k];
    },
    _dump: store,
  };
}

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

const PERSON_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const EXISTING = {
  id: 77,
  type: "marriage",
  person: "سعد الزيدان",
  person_id: PERSON_ID,
  date_label: "1447-01-10",
  event_date: "1447-01-10",
  branch_key: "زيدان",
  details: {},
  contact_phone: "0500000001",
};

function makeClient(seedRows) {
  const rows = Array.isArray(seedRows) ? seedRows.slice() : [];
  return {
    from: function (table) {
      const api = {
        select: function () {
          return api;
        },
        eq: function () {
          return api;
        },
        limit: function () {
          return api;
        },
        then: function (resolve, reject) {
          try {
            if (table === "family_events") {
              return Promise.resolve({ data: rows, error: null }).then(
                resolve,
                reject
              );
            }
            if (table === "approval_requests") {
              return Promise.resolve({ data: [], error: null }).then(
                resolve,
                reject
              );
            }
            return Promise.resolve({ data: [], error: null }).then(
              resolve,
              reject
            );
          } catch (e) {
            return Promise.reject(e).then(resolve, reject);
          }
        },
      };
      // Thenable for await client.from(...).select().eq().limit()
      api[Symbol.toStringTag] = "Promise";
      return api;
    },
  };
}

async function runCreate(payload, client, extra) {
  if (typeof Create.resetLocksForTests === "function") Create.resetLocksForTests();
  let inserts = 0;
  const extraOpts = Object.assign({}, extra || {});
  const userPerform = extraOpts.performInsert;
  delete extraOpts.performInsert;
  const created = await Create.create(
    Object.assign(
      {
        type: "event",
        payload: payload,
        client: client,
        skipFetch: true,
        performInsert: async function () {
          inserts += 1;
          if (typeof userPerform === "function") {
            return userPerform.apply(this, arguments);
          }
          return { ok: true, request_id: "MOCK-OCC" };
        },
      },
      extraOpts
    )
  );
  return { created: created, inserts: inserts };
}

(async function main() {
  if (!Guard || !Create || !Track) {
    console.error("modules not loaded", { Guard: !!Guard, Create: !!Create, Track: !!Track });
    process.exit(1);
  }

  console.log("\n=== static: UI submit path ===");
  const eventSubmit = fs.readFileSync(
    path.join(root, "assets/js/event-submit.js"),
    "utf8"
  );
  const hrc = fs.readFileSync(
    path.join(root, "assets/js/modules/home-request-create.js"),
    "utf8"
  );
  const indexHtml = fs.readFileSync(
    path.join(root, "pages/index.html"),
    "utf8"
  );
  assert(/Create\.create\s*\(/.test(eventSubmit), "static: event-submit → Create.create");
  assert(
    hrc.indexOf("findExistingEventLive") >= 0,
    "static: findExistingEventLive present"
  );
  assert(
    /await\s+Create\.create\s*\(/.test(eventSubmit),
    "static: event-submit awaits Create.create before insert"
  );
  assert(
    eventSubmit.indexOf("mode: \"approval\"") >= 0 ||
      eventSubmit.indexOf("mode: 'approval'") >= 0,
    "static: public occasion path uses approval mode"
  );
  assert(
    /name="person"[\s\S]*required/.test(indexHtml) &&
      /name="phone"[\s\S]*required/.test(indexHtml) &&
      /name="type"[\s\S]*required/.test(indexHtml) &&
      /name="dateLabel"[\s\S]*required/.test(indexHtml),
    "static: required fields person/phone/type/date in UI"
  );
  const formStart = indexHtml.indexOf("data-event-submit-form");
  const formEnd = indexHtml.indexOf("</form>", formStart);
  const formHtml = indexHtml.slice(formStart, formEnd);
  assert(
    !/name="text"[\s\S]*required/.test(formHtml),
    "static: نص المناسبة optional (not required)"
  );
  assert(
    formHtml.indexOf("اسم المرسل") < 0 &&
      formHtml.indexOf('name="submitterName"') < 0,
    "static: crowded submitter-name field removed from occasion form"
  );
  assert(formHtml.indexOf('name="secret"') < 0, "static: no secret field");
  assert(formHtml.indexOf('name="email"') < 0, "static: no email field");
  assert(formHtml.indexOf('name="branch"') >= 0, "static: branch field present for routing");
  assert(formHtml.indexOf('name="imageUrl"') < 0, "static: no image URL field");
  assert(
    formHtml.indexOf("+ إضافة مناسبة") >= 0 ||
      indexHtml.indexOf("+ إضافة مناسبة") >= 0,
    "static: + إضافة مناسبة card present"
  );
  assert(
    Guard.MSG.EVENT_SAME.indexOf("هذه المناسبة مسجلة مسبقًا") >= 0,
    "static: EVENT_SAME Arabic message"
  );

  const trackSrc = fs.readFileSync(
    path.join(root, "assets/js/modules/my-requests-track.js"),
    "utf8"
  );
  const rxSrc = fs.readFileSync(
    path.join(root, "assets/js/modules/request-experience.js"),
    "utf8"
  );
  assert(
    trackSrc.indexOf('alzidan_rx_my_requests_v1') >= 0,
    "static: track store key alzidan_rx_my_requests_v1"
  );
  assert(
    eventSubmit.indexOf("AlzidanRxMyRequests") >= 0 &&
      eventSubmit.indexOf("buildOccasionEntry") >= 0 &&
      eventSubmit.indexOf("Track.append") >= 0,
    "static: event-submit appends occasion to طلباتي track"
  );
  assert(
    rxSrc.indexOf("trackLocal") >= 0 &&
      rxSrc.indexOf("أضف فردًا للعائلة") >= 0 &&
      (rxSrc.indexOf("buildAddPersonEntry") >= 0 ||
        rxSrc.indexOf("alzidan_rx_my_requests_v1") >= 0),
    "static: add-person track path still present in request-experience"
  );
  assert(
    rxSrc.indexOf("isTrackOccasion") >= 0 ||
      rxSrc.indexOf("isOccasionKind") >= 0,
    "static: request-experience recognizes occasion track kind"
  );
  assert(
    rxSrc.indexOf("إضافة مناسبة") >= 0 ||
      trackSrc.indexOf("إضافة مناسبة") >= 0,
    "static: occasion intent label إضافة مناسبة"
  );
  assert(
    rxSrc.indexOf("أعلن زواج") < 0 && rxSrc.indexOf("event_marriage") < 0,
    "static: no standalone أعلن زواج matrix card"
  );
  assert(
    /id:\s*"occasion"/.test(rxSrc) && rxSrc.indexOf("renderOccasion") >= 0,
    "static: occasion intent opens RX occasion view"
  );
  assert(
    indexHtml.indexOf("my-requests-track.js") >= 0,
    "static: my-requests-track.js loaded on index"
  );
  assert(
    indexHtml.indexOf("my-requests-track.js") <
      indexHtml.indexOf("event-submit.js"),
    "static: track module loads before event-submit"
  );

  const clientWithExisting = makeClient([EXISTING]);
  const emptyClient = makeClient([]);

  console.log("\n=== 1) unique occasion → ALLOW, insert once ===");
  {
    const { created, inserts } = await runCreate(
      {
        type: "graduation",
        person: "نورة الاختبار",
        person_id: "",
        date_label: "2099-01-15",
        event_date: "2099-01-15",
        phone: "0511111111",
      },
      emptyClient
    );
    assert(created.ok === true, "1 unique → ok");
    assert(inserts === 1, "1 unique → inserts=1");
  }

  console.log("\n=== 2) same person+type+date → BLOCK, inserts=0 ===");
  {
    const { created, inserts } = await runCreate(
      {
        type: "marriage",
        person: "سعد الزيدان",
        person_id: PERSON_ID,
        date_label: "1447-01-10",
        event_date: "1447-01-10",
        phone: "0599999999",
        title: "صياغة مختلفة للعنوان",
      },
      clientWithExisting
    );
    assert(created.ok === false && created.blocked === true, "2 duplicate → blocked");
    assert(inserts === 0, "2 duplicate → inserts=0");
    const msg = (created.guard && created.guard.message_ar) || "";
    assert(
      msg.indexOf("هذه المناسبة مسجلة مسبقًا") >= 0 ||
        msg.indexOf("مسجلة مسبقًا") >= 0,
      "2 duplicate → Arabic already-registered message (got: " + msg + ")"
    );
    assert(
      created.guard && created.guard.code === "EVENT_SAME",
      "2 duplicate → EVENT_SAME"
    );
  }

  console.log("\n=== 3) same person+type, different date → ALLOW ===");
  {
    const { created, inserts } = await runCreate(
      {
        type: "marriage",
        person: "سعد الزيدان",
        person_id: PERSON_ID,
        date_label: "1448-06-01",
        event_date: "1448-06-01",
        phone: "0500000001",
      },
      clientWithExisting
    );
    assert(created.ok === true, "3 different date → ok");
    assert(inserts === 1, "3 different date → inserts=1");
  }

  console.log("\n=== 4) same person+date, different type → ALLOW ===");
  {
    const { created, inserts } = await runCreate(
      {
        type: "birth",
        person: "سعد الزيدان",
        person_id: PERSON_ID,
        date_label: "1447-01-10",
        event_date: "1447-01-10",
        phone: "0500000001",
      },
      clientWithExisting
    );
    assert(created.ok === true, "4 different type → ok");
    assert(inserts === 1, "4 different type → inserts=1");
  }

  console.log("\n=== 5) double-submit rapid → inserts ≤ 1 ===");
  {
    if (typeof Create.resetLocksForTests === "function") Create.resetLocksForTests();
    let inserts = 0;
    const payload = {
      type: "engagement",
      person: "سرعة المناسبات",
      person_id: "",
      date_label: "2099-03-03",
      event_date: "2099-03-03",
      phone: "0522222222",
    };
    async function once() {
      return Create.create({
        type: "event",
        payload: payload,
        client: emptyClient,
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
    assert(okCount === 1, "5 double-submit → okCount=1");
    assert(dup, "5 double-submit → flagged");
    assert(inserts <= 1, "5 double-submit → inserts≤1 (got " + inserts + ")");
  }

  console.log("\n=== 6) occasion ALLOW writes track entry shape ===");
  {
    installMemoryStorage(trackBox.globalThis);
    // Re-bind Track API against memory storage (loadIife already assigned once).
    const TrackMem =
      trackBox.globalThis.AlzidanRxMyRequests || trackBox.module.exports;
    TrackMem.write([]);
    const { created, inserts } = await runCreate(
      {
        type: "marriage",
        person: "فهد التتبع",
        person_id: "",
        date_label: "2099-08-01",
        event_date: "2099-08-01",
        phone: "0533333333",
      },
      emptyClient,
      {
        performInsert: async function () {
          // mimic event-submit track wiring after successful create
          const entry = TrackMem.buildOccasionEntry({
            requestId: "OCC-TRACK-1",
            person: "فهد التتبع",
            typeLabel: "زواج",
            type: "marriage",
            dateLabel: "2099-08-01",
            status: "submitted",
            createdAt: "2099-08-01T10:00:00.000Z",
          });
          TrackMem.append(entry);
          return { ok: true, request_id: "OCC-TRACK-1" };
        },
      }
    );
    assert(created.ok === true, "6 create → ok");
    assert(inserts === 1, "6 create → inserts=1");
    const list = TrackMem.read();
    assert(Array.isArray(list) && list.length === 1, "6 track list length=1");
    const row = list[0];
    assert(row.requestId === "OCC-TRACK-1", "6 track requestId");
    assert(row.kind === "event_card", "6 track kind event_card");
    assert(row.intentLabel === "إضافة مناسبة", "6 track intentLabel");
    assert(row.person === "فهد التتبع", "6 track person");
    assert(row.eventType === "زواج", "6 track eventType");
    assert(row.dateLabel === "2099-08-01", "6 track dateLabel");
    assert(
      row.status === "submitted" || row.status === "pending",
      "6 track status"
    );
    assert(TrackMem.isOccasionKind(row) === true, "6 isOccasionKind(row)");
    assert(TrackMem.isAddPersonKind(row) === false, "6 not add-person kind");
  }

  console.log("\n=== 7) duplicate still BLOCKS and does not require track write ===");
  {
    installMemoryStorage(trackBox.globalThis);
    const TrackMem =
      trackBox.globalThis.AlzidanRxMyRequests || trackBox.module.exports;
    TrackMem.write([]);
    let trackAppends = 0;
    const { created, inserts } = await runCreate(
      {
        type: "marriage",
        person: "سعد الزيدان",
        person_id: PERSON_ID,
        date_label: "1447-01-10",
        event_date: "1447-01-10",
        phone: "0599999999",
      },
      clientWithExisting,
      {
        performInsert: async function () {
          trackAppends += 1;
          TrackMem.append(
            TrackMem.buildOccasionEntry({
              requestId: "SHOULD-NOT",
              person: "سعد الزيدان",
              typeLabel: "زواج",
              dateLabel: "1447-01-10",
            })
          );
          return { ok: true, request_id: "SHOULD-NOT" };
        },
      }
    );
    assert(created.ok === false && created.blocked === true, "7 dup → blocked");
    assert(inserts === 0, "7 dup → inserts=0");
    assert(trackAppends === 0, "7 dup → performInsert/track not called");
    assert(TrackMem.read().length === 0, "7 dup → track empty");
  }

  console.log("\n=== 8) track render helpers recognize occasion vs add-person ===");
  {
    const occ = Track.buildOccasionEntry({
      requestId: "R-OCC",
      person: "نورة",
      typeLabel: "تخرج",
      dateLabel: "1447-02-02",
    });
    const add = Track.buildAddPersonEntry({
      requestId: "R-ADD",
      personName: "حسن",
      father: "خميس",
    });
    assert(Track.isOccasionKind(occ), "8 occasion kind");
    assert(!Track.isOccasionKind(add), "8 add-person not occasion");
    assert(Track.isAddPersonKind(add), "8 add-person kind");
    assert(occ.summary.indexOf("صاحب المناسبة:") >= 0, "8 occasion summary owner");
    assert(occ.summary.indexOf("النوع:") >= 0, "8 occasion summary type");
    assert(occ.summary.indexOf("التاريخ:") >= 0, "8 occasion summary date");
    assert(add.summary.indexOf(" تحت ") >= 0, "8 add-person summary shape");
  }

  console.log("\n=== catalog evaluate: name-only same core blocks ===");
  {
    const r = Guard.evaluate(
      "event",
      {
        type: "marriage",
        person: "سعد الزيدان",
        date_label: "1447-01-10",
        phone: "0512345678",
      },
      {
        events: [
          {
            type: "marriage",
            person: "سعد الزيدان",
            date_label: "1447-01-10",
          },
        ],
      }
    );
    assert(r.verdict === "block" && r.code === "EVENT_SAME", "catalog name+type+date → block");
  }

  console.log("\n--- summary ---");
  console.log(
    "passed:",
    results.filter((x) => x.ok).length,
    "/",
    results.length
  );
  if (failed) {
    console.error("FAILED:", failed);
    process.exit(1);
  }
  console.log("All occasion dup-guard checks passed.");
  console.log("DB modification: none");
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
