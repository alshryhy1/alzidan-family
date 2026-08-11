#!/usr/bin/env node
/**
 * Patients (مرضى) duplicate guard — Create.create + live probe mocks.
 * Same-record: health type + person + (hospital|date).
 * Run: npm run verify:patient-dup
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

const PERSON_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const EXISTING = {
  id: 88,
  type: "sick",
  person: "خالد الزيدان",
  person_id: PERSON_ID,
  date_label: "1447-02-01",
  event_date: "1447-02-01",
  branch_key: "زيدان",
  hospital_name: "مستشفى الملك فيصل",
  details: {
    kind: "health_notice",
    hospitalName: "مستشفى الملك فيصل",
  },
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
        type: "health",
        payload: payload,
        client: client,
        skipFetch: true,
        performInsert: async function () {
          inserts += 1;
          if (typeof userPerform === "function") {
            return userPerform.apply(this, arguments);
          }
          return { ok: true, request_id: "MOCK-HLT" };
        },
      },
      extraOpts
    )
  );
  return { created: created, inserts: inserts };
}

(async function main() {
  if (!Guard || !Create || !Track) {
    console.error("modules not loaded", {
      Guard: !!Guard,
      Create: !!Create,
      Track: !!Track,
    });
    process.exit(1);
  }

  console.log("\n=== static: UI patient path ===");
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
  const rxSrc = fs.readFileSync(
    path.join(root, "assets/js/modules/request-experience.js"),
    "utf8"
  );
  const trackSrc = fs.readFileSync(
    path.join(root, "assets/js/modules/my-requests-track.js"),
    "utf8"
  );
  const builderSrc = fs.readFileSync(
    path.join(root, "assets/js/modules/events/event-builder.js"),
    "utf8"
  );
  const actionsSrc = fs.readFileSync(
    path.join(root, "assets/js/modules/request-actions.js"),
    "utf8"
  );

  assert(
    /id:\s*"patient"/.test(rxSrc) && rxSrc.indexOf("حالة صحية") >= 0,
    "static: patient intent card حالة صحية in RX matrix"
  );
  assert(
    rxSrc.indexOf("implemented: true") >= 0 &&
      /id:\s*"patient"[\s\S]{0,120}implemented:\s*true/.test(rxSrc),
    "static: patient intent implemented (not قريبًا)"
  );
  assert(
    rxSrc.indexOf("renderPatient") >= 0 &&
      rxSrc.indexOf('state.view = "patient"') >= 0,
    "static: patient intent opens patient view"
  );
  // Exact matrix order: add → correct → occasion → memory → card → health → death
  {
    const ids = [];
    const re = /id:\s*"([^"]+)"/g;
    let m;
    const blockStart = rxSrc.indexOf("var INTENTS = [");
    const blockEnd = rxSrc.indexOf("];", blockStart);
    const block = rxSrc.slice(blockStart, blockEnd);
    while ((m = re.exec(block))) ids.push(m[1]);
    assert(
      ids.join(",") ===
        "tree_card,tree_edit,occasion,memory_card,special_card,patient,event_death",
      "static: INTENTS order exact (got " + ids.join(",") + ")"
    );
  }
  assert(
    indexHtml.indexOf("data-patient-submit-form") >= 0 &&
      indexHtml.indexOf("data-rx-patient-panel") >= 0,
    "static: patient form parked in index.html"
  );
  assert(
    indexHtml.indexOf('value="sick"') >= 0 &&
      indexHtml.indexOf('value="operation"') >= 0 &&
      indexHtml.indexOf('value="discharge"') >= 0,
    "static: health type options present"
  );
  assert(
    indexHtml.indexOf("request-experience.js?v=20260810home2") >= 0,
    "static: cache-bust request-experience.js?v=20260810home2"
  );
  assert(
    indexHtml.indexOf("event-submit.js?v=20260810home2") >= 0,
    "static: cache-bust event-submit.js?v=20260810home2"
  );
  assert(
    eventSubmit.indexOf("data-patient-submit-form") >= 0 &&
      eventSubmit.indexOf('bindSubmitForm(form, "patient")') >= 0,
    "static: event-submit binds patient form"
  );
  assert(
    eventSubmit.indexOf("Create.create") >= 0 &&
      eventSubmit.indexOf("buildPatientEntry") >= 0,
    "static: patient submit → Create.create + طلباتي"
  );
  assert(
    hrc.indexOf("findExistingHealthLive") >= 0,
    "static: findExistingHealthLive present"
  );
  assert(
    builderSrc.indexOf("health_notice") >= 0 &&
      builderSrc.indexOf('source === "public_form"') >= 0 &&
      /buildFromPublicForm[\s\S]*health_notice/.test(builderSrc),
    "static: public form builds health_notice for sick types"
  );
  assert(
    trackSrc.indexOf("buildPatientEntry") >= 0 &&
      trackSrc.indexOf("isPatientKind") >= 0,
    "static: track has patient helpers"
  );
  assert(
    Guard.MSG.HEALTH_SAME.indexOf("هذه الحالة مسجلة مسبقًا") >= 0,
    "static: HEALTH_SAME Arabic message"
  );
  assert(
    Create.mapTypeFromEventPayload({ type: "sick" }) === "health" &&
      Create.mapTypeFromEventPayload({ type: "operation" }) === "health" &&
      Create.mapTypeFromEventPayload({ type: "marriage" }) === "event",
    "static: mapTypeFromEventPayload health vs occasion"
  );
  assert(
    actionsSrc.indexOf("unpublishPublishedEventForRequest") >= 0 &&
      actionsSrc.indexOf("publishEventCardRequest") >= 0,
    "static: accept/reject unpublish helpers cover event_card (health)"
  );
  assert(
    rxSrc.indexOf("أعلن زواج") < 0,
    "static: no standalone أعلن زواج matrix card"
  );

  const clientWithExisting = makeClient([EXISTING]);
  const emptyClient = makeClient([]);

  console.log("\n=== 1) unique patient → ALLOW, insert once ===");
  {
    const { created, inserts } = await runCreate(
      {
        type: "sick",
        person: "نورة الاختبار الصحي",
        person_id: "",
        date_label: "2099-04-15",
        event_date: "2099-04-15",
        hospital_name: "مستشفى فريد",
        phone: "0511111188",
      },
      emptyClient
    );
    assert(created.ok === true, "1 unique → ok");
    assert(inserts === 1, "1 unique → inserts=1");
  }

  console.log("\n=== 2) same person+type+hospital/date → BLOCK ===");
  {
    const { created, inserts } = await runCreate(
      {
        type: "sick",
        person: "خالد الزيدان",
        person_id: PERSON_ID,
        date_label: "1447-02-01",
        event_date: "1447-02-01",
        hospital_name: "مستشفى الملك فيصل",
        phone: "0599999988",
      },
      clientWithExisting
    );
    assert(created.ok === false && created.blocked === true, "2 duplicate → blocked");
    assert(inserts === 0, "2 duplicate → inserts=0");
    const msg = (created.guard && created.guard.message_ar) || "";
    assert(
      msg.indexOf("هذه الحالة مسجلة مسبقًا") >= 0 ||
        msg.indexOf("مسجلة مسبقًا") >= 0,
      "2 duplicate → Arabic already-registered message (got: " + msg + ")"
    );
    assert(
      created.guard && created.guard.code === "HEALTH_SAME",
      "2 duplicate → HEALTH_SAME"
    );
  }

  console.log("\n=== 3) same person, different type → ALLOW ===");
  {
    const { created, inserts } = await runCreate(
      {
        type: "operation",
        person: "خالد الزيدان",
        person_id: PERSON_ID,
        date_label: "1447-02-01",
        event_date: "1447-02-01",
        hospital_name: "مستشفى الملك فيصل",
        phone: "0500000088",
      },
      clientWithExisting
    );
    assert(created.ok === true, "3 different type → ok");
    assert(inserts === 1, "3 different type → inserts=1");
  }

  console.log("\n=== 4) same person+type, different date+hospital → ALLOW ===");
  {
    const { created, inserts } = await runCreate(
      {
        type: "sick",
        person: "خالد الزيدان",
        person_id: PERSON_ID,
        date_label: "1448-09-01",
        event_date: "1448-09-01",
        hospital_name: "مستشفى آخر",
        phone: "0500000088",
      },
      clientWithExisting
    );
    assert(created.ok === true, "4 different core → ok");
    assert(inserts === 1, "4 different core → inserts=1");
  }

  console.log("\n=== 5) patient ALLOW writes track entry ===");
  {
    installMemoryStorage(trackBox.globalThis);
    const TrackMem =
      trackBox.globalThis.AlzidanRxMyRequests || trackBox.module.exports;
    TrackMem.write([]);
    const { created, inserts } = await runCreate(
      {
        type: "discharge",
        person: "فهد الصحي",
        person_id: "",
        date_label: "2099-08-20",
        event_date: "2099-08-20",
        hospital_name: "مستشفى الاختبار",
        phone: "0533333388",
      },
      emptyClient,
      {
        performInsert: async function () {
          const entry = TrackMem.buildPatientEntry({
            requestId: "HLT-TRACK-1",
            person: "فهد الصحي",
            typeLabel: "خروج من المستشفى",
            type: "discharge",
            dateLabel: "2099-08-20",
            hospital: "مستشفى الاختبار",
            status: "submitted",
            createdAt: "2099-08-20T10:00:00.000Z",
          });
          TrackMem.append(entry);
          return { ok: true, request_id: "HLT-TRACK-1" };
        },
      }
    );
    assert(created.ok === true, "5 create → ok");
    assert(inserts === 1, "5 create → inserts=1");
    const list = TrackMem.read();
    assert(Array.isArray(list) && list.length === 1, "5 track list length=1");
    const row = list[0];
    assert(row.requestId === "HLT-TRACK-1", "5 track requestId");
    assert(row.kind === "event_card", "5 track kind event_card");
    assert(row.intentLabel === "حالة صحية", "5 track intentLabel");
    assert(row.person === "فهد الصحي", "5 track person");
    assert(TrackMem.isPatientKind(row) === true, "5 isPatientKind");
    assert(TrackMem.isOccasionKind(row) === false, "5 not occasion kind");
  }

  console.log("\n=== 6) catalog name-only same core blocks ===");
  {
    const r = Guard.evaluate(
      "health",
      {
        type: "sick",
        person: "خالد الزيدان",
        hospital_name: "مستشفى الملك فيصل",
        date_label: "1447-02-01",
      },
      {
        events: [
          {
            type: "sick",
            person: "خالد الزيدان",
            hospital_name: "مستشفى الملك فيصل",
            date_label: "1447-02-01",
          },
        ],
      }
    );
    assert(
      r.verdict === "block" && r.code === "HEALTH_SAME",
      "catalog name+type+(place|date) → block"
    );
  }

  console.log("\n=== 7) unpublish path covers health event_card ===");
  {
    assert(
      /unpublishPublishedEventForRequest/.test(actionsSrc),
      "7 unpublish helper present"
    );
    assert(
      /isEventPublishRequestKind/.test(actionsSrc) ||
        actionsSrc.indexOf("event_card") >= 0,
      "7 event_card kind in publish/unpublish path"
    );
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
  console.log("All patient dup-guard checks passed.");
  console.log("DB modification: none");
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
