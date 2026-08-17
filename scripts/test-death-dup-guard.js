#!/usr/bin/env node
/**
 * Death (وفيات) duplicate guard — Create.create + live probe mocks.
 * Same-record: same person (person_id preferred) already deceased / death event.
 * Run: npm run verify:death-dup
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

const builderBox = loadIife(
  path.join(root, "assets/js/modules/events/event-builder.js")
);
const Events =
  builderBox.globalThis.AlzidanEvents || builderBox.module.exports;

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

const PERSON_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const EXISTING = {
  id: 99,
  type: "death",
  person: "سالم الزيدان",
  person_id: PERSON_ID,
  date_label: "1447-03-01",
  event_date: "1447-03-01",
  branch_key: "زيدان",
  details: {
    kind: "death_notice",
    person_id: PERSON_ID,
    personId: PERSON_ID,
  },
};

function makeClient(opts) {
  const options = opts || {};
  const eventRows = Array.isArray(options.events)
    ? options.events.slice()
    : [];
  const peopleRows = Array.isArray(options.people)
    ? options.people.slice()
    : [];
  const pendingRows = Array.isArray(options.pending)
    ? options.pending.slice()
    : [];
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
              return Promise.resolve({ data: eventRows, error: null }).then(
                resolve,
                reject
              );
            }
            if (table === "tree_children") {
              return Promise.resolve({ data: peopleRows, error: null }).then(
                resolve,
                reject
              );
            }
            if (table === "approval_requests") {
              return Promise.resolve({ data: pendingRows, error: null }).then(
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
        type: "death",
        payload: payload,
        client: client,
        skipFetch: true,
        performInsert: async function () {
          inserts += 1;
          if (typeof userPerform === "function") {
            return userPerform.apply(this, arguments);
          }
          return { ok: true, request_id: "MOCK-DTH" };
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

  console.log("\n=== static: UI death path ===");
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
    /id:\s*"event_death"/.test(rxSrc) && rxSrc.indexOf("إعلان وفاة") >= 0,
    "static: death intent card إعلان وفاة in RX matrix"
  );
  assert(
    /id:\s*"event_death"[\s\S]{0,160}implemented:\s*true/.test(rxSrc),
    "static: death intent implemented (not قريبًا)"
  );
  assert(
    rxSrc.indexOf("renderDeath") >= 0 &&
      rxSrc.indexOf('state.view = "death"') >= 0,
    "static: death intent opens death view"
  );
  {
    const ids = [];
    const re = /id:\s*"([^"]+)"/g;
    let m;
    const blockStart = rxSrc.indexOf("var INTENTS = [");
    const blockEnd = rxSrc.indexOf("];", blockStart);
    const block = rxSrc.slice(blockStart, blockEnd);
    while ((m = re.exec(block))) ids.push(m[1]);
    assert(
      ids.indexOf("event_death") >= 0 &&
        ids.indexOf("parent_change") >= 0 &&
        ids.indexOf("tree_card") >= 0 &&
        ids.indexOf("patient") >= 0,
      "static: INTENTS includes death, parent_change, add person, patient (got " +
        ids.join(",") +
        ")"
    );
  }
  assert(
    indexHtml.indexOf("data-death-submit-form") >= 0 &&
      indexHtml.indexOf("data-rx-death-panel") >= 0,
    "static: death form parked in index.html"
  );
  assert(
    indexHtml.indexOf("اسم المتوفى") >= 0 &&
      indexHtml.indexOf('id="death-submit-date-label"') >= 0 &&
      indexHtml.indexOf('id="death-submit-type"') >= 0,
    "static: death required labels person/date/type"
  );
  assert(
    /request-experience\.js\?v=20260817send1/.test(indexHtml),
    "static: cache-bust request-experience.js?v=20260817send1"
  );
  assert(
    /event-submit\.js\?v=20260817send1/.test(indexHtml),
    "static: cache-bust event-submit.js?v=20260817send1"
  );
  assert(
    eventSubmit.indexOf("data-death-submit-form") >= 0 &&
      eventSubmit.indexOf('bindSubmitForm(form, "death")') >= 0,
    "static: event-submit binds death form"
  );
  assert(
    eventSubmit.indexOf("Create.create") >= 0 &&
      eventSubmit.indexOf("buildDeathEntry") >= 0,
    "static: death submit → Create.create + طلباتي"
  );
  assert(
    hrc.indexOf("findExistingDeathLive") >= 0 &&
      hrc.indexOf("live_db_same_death_pending") >= 0,
    "static: findExistingDeathLive + pending probe"
  );
  assert(
    builderSrc.indexOf("death_notice") >= 0 &&
      /buildFromPublicForm[\s\S]*death_notice/.test(builderSrc),
    "static: public form builds death_notice for death"
  );
  assert(
    trackSrc.indexOf("buildDeathEntry") >= 0 &&
      trackSrc.indexOf("isDeathKind") >= 0,
    "static: track has death helpers"
  );
  assert(
    Guard.MSG.DEATH_SAME.indexOf("هذه الوفاة مسجلة مسبقًا") >= 0,
    "static: DEATH_SAME Arabic message"
  );
  assert(
    Create.mapTypeFromEventPayload({ type: "death" }) === "death" &&
      Create.mapTypeFromEventPayload({ type: "sick" }) === "health" &&
      Create.mapTypeFromEventPayload({ type: "marriage" }) === "event",
    "static: mapTypeFromEventPayload death vs health vs occasion"
  );
  assert(
    actionsSrc.indexOf("unpublishPublishedEventForRequest") >= 0 &&
      actionsSrc.indexOf("publishEventCardRequest") >= 0,
    "static: accept/reject unpublish helpers cover event_card (death)"
  );
  assert(
    /id:\s*"memory_card"[\s\S]{0,120}implemented:\s*true/.test(rxSrc),
    "static: شارك ذكرى implemented"
  );
  assert(
    /id:\s*"tree_edit"[\s\S]{0,160}(implemented:\s*false|closed:\s*true)/.test(rxSrc),
    "static: صحح بيانات implemented"
  );
  assert(
    /id:\s*"special_card"[\s\S]{0,120}implemented:\s*true/.test(rxSrc),
    "static: اطلب بطاقة implemented"
  );
  assert(
    rxSrc.indexOf("نية بشرية") < 0 && rxSrc.indexOf("RX-2") < 0,
    "static: home copy without RX jargon"
  );

  if (Events && typeof Events.buildFamilyEventRow === "function") {
    const deathRow = Events.buildFamilyEventRow({
      source: "public_form",
      requestId: "DTH-TEST-1",
      branch: "زيدان",
      type: "death",
      person: "سالم الزيدان",
      dateLabel: "1448-01-01",
      text: "ملاحظة",
      place: "منزل العائلة",
      phone: "0500000000",
      createdAt: "2026-08-10T00:00:00.000Z",
    });
    assert(deathRow && deathRow.type === "death", "static: builder death type");
    const details =
      typeof deathRow.details === "string"
        ? JSON.parse(deathRow.details)
        : deathRow.details || {};
    assert(
      details.kind === "death_notice",
      "static: builder death_notice kind"
    );
  }

  const clientWithExisting = makeClient({ events: [EXISTING] });
  const emptyClient = makeClient({});

  console.log("\n=== 1) unique death → ALLOW, insert once ===");
  {
    const { created, inserts } = await runCreate(
      {
        type: "death",
        person: "وفاة اختبار فريدة",
        person_id: "",
        date_label: "2099-04-15",
        event_date: "2099-04-15",
        phone: "0511111188",
        branch_key: "زيدان",
      },
      emptyClient
    );
    assert(created.ok === true, "1 unique → ok");
    assert(inserts === 1, "1 unique → inserts=1");
  }

  console.log("\n=== 2) same person_id death event → BLOCK ===");
  {
    const { created, inserts } = await runCreate(
      {
        type: "death",
        person: "أي اسم",
        person_id: PERSON_ID,
        date_label: "1448-01-01",
        event_date: "1448-01-01",
        phone: "0599999988",
        branch_key: "زيدان",
      },
      clientWithExisting
    );
    assert(created.ok === false && created.blocked === true, "2 duplicate → blocked");
    assert(inserts === 0, "2 duplicate → inserts=0");
    const msg = (created.guard && created.guard.message_ar) || "";
    assert(
      msg.indexOf("هذه الوفاة مسجلة مسبقًا") >= 0,
      "2 duplicate → Arabic already-registered message (got: " + msg + ")"
    );
    assert(
      created.guard && created.guard.code === "DEATH_SAME",
      "2 duplicate → DEATH_SAME"
    );
  }

  console.log("\n=== 3) same person name (no person_id) → BLOCK ===");
  {
    const { created, inserts } = await runCreate(
      {
        type: "death",
        person: "سالم الزيدان",
        person_id: "",
        date_label: "1448-09-01",
        branch_key: "زيدان",
        phone: "0500000088",
      },
      clientWithExisting
    );
    assert(created.ok === false && created.blocked === true, "3 name dup → blocked");
    assert(inserts === 0, "3 name dup → inserts=0");
  }

  console.log("\n=== 4) different person → ALLOW ===");
  {
    const { created, inserts } = await runCreate(
      {
        type: "death",
        person: "شخص مختلف للاختبار",
        person_id: "",
        date_label: "1448-09-01",
        branch_key: "زيدان",
        phone: "0500000088",
      },
      clientWithExisting
    );
    assert(created.ok === true, "4 different person → ok");
    assert(inserts === 1, "4 different person → inserts=1");
  }

  console.log("\n=== 5) already deceased on tree → BLOCK ===");
  {
    const treeClient = makeClient({
      people: [
        {
          id: 1,
          person_id: PERSON_ID,
          child_name: "سالم",
          is_deceased: true,
          branch_key: "زيدان",
        },
      ],
      events: [],
    });
    const { created, inserts } = await runCreate(
      {
        type: "death",
        person: "سالم",
        person_id: PERSON_ID,
        branch_key: "زيدان",
        phone: "0500000088",
      },
      treeClient
    );
    assert(created.ok === false && created.blocked === true, "5 tree deceased → blocked");
    assert(inserts === 0, "5 tree deceased → inserts=0");
  }

  console.log("\n=== 6) death ALLOW writes track entry ===");
  {
    installMemoryStorage(trackBox.globalThis);
    const TrackMem =
      trackBox.globalThis.AlzidanRxMyRequests || trackBox.module.exports;
    TrackMem.write([]);
    const { created, inserts } = await runCreate(
      {
        type: "death",
        person: "فهد المتوفى",
        person_id: "",
        date_label: "2099-08-20",
        event_date: "2099-08-20",
        place: "منزل العائلة",
        phone: "0533333388",
        branch_key: "زيدان",
      },
      emptyClient,
      {
        performInsert: async function () {
          const entry = TrackMem.buildDeathEntry({
            requestId: "DTH-TRACK-1",
            person: "فهد المتوفى",
            dateLabel: "2099-08-20",
            place: "منزل العائلة",
            status: "submitted",
            createdAt: "2099-08-20T10:00:00.000Z",
          });
          TrackMem.append(entry);
          return { ok: true, request_id: "DTH-TRACK-1" };
        },
      }
    );
    assert(created.ok === true, "6 create → ok");
    assert(inserts === 1, "6 create → inserts=1");
    const list = TrackMem.read();
    assert(Array.isArray(list) && list.length === 1, "6 track list length=1");
    const row = list[0];
    assert(row.requestId === "DTH-TRACK-1", "6 track requestId");
    assert(row.kind === "event_card", "6 track kind event_card");
    assert(row.intentLabel === "إعلان وفاة", "6 track intentLabel");
    assert(row.person === "فهد المتوفى", "6 track person");
    assert(TrackMem.isDeathKind(row) === true, "6 isDeathKind");
    assert(TrackMem.isOccasionKind(row) === false, "6 not occasion kind");
    assert(TrackMem.isPatientKind(row) === false, "6 not patient kind");
  }

  console.log("\n=== 7) catalog name-only death blocks ===");
  {
    const r = Guard.evaluate(
      "death",
      {
        type: "death",
        person: "سالم الزيدان",
        branch_key: "زيدان",
      },
      {
        events: [
          {
            type: "death",
            person: "سالم الزيدان",
            person_id: "",
            branch_key: "زيدان",
          },
        ],
      }
    );
    assert(
      r.verdict === "block" && r.code === "DEATH_SAME",
      "catalog name death → block"
    );
    assert(
      (r.message_ar || "").indexOf("هذه الوفاة مسجلة مسبقًا") >= 0,
      "catalog block message Arabic"
    );
  }

  console.log("\n=== 8) unpublish path covers death event_card ===");
  {
    assert(
      /unpublishPublishedEventForRequest/.test(actionsSrc),
      "8 unpublish helper present"
    );
    assert(
      actionsSrc.indexOf("event_card") >= 0,
      "8 event_card kind in publish/unpublish path"
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
  console.log("All death dup-guard checks passed.");
  console.log("DB modification: none");
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
