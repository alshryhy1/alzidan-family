#!/usr/bin/env node
/**
 * Dup / Identity Guard — 10 scenarios + double-submit (no network).
 * Run: node scripts/test-dup-identity-guard.js
 */
"use strict";

const path = require("path");
const fs = require("fs");

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

const root = path.join(__dirname, "..");
const guardBox = loadIife(
  path.join(root, "assets/js/modules/dup-identity-guard.js")
);
const Guard =
  guardBox.globalThis.AlzidanDupIdentityGuard || guardBox.module.exports;
if (!Guard) {
  console.error("FAIL: AlzidanDupIdentityGuard not loaded");
  process.exit(1);
}

const createBox = loadIife(
  path.join(root, "assets/js/modules/home-request-create.js")
);
const Create =
  createBox.globalThis.AlzidanHomeRequestCreate || createBox.module.exports;
// Ensure create module sees Guard
createBox.globalThis.AlzidanDupIdentityGuard = Guard;
if (typeof Create.resetLocksForTests === "function") Create.resetLocksForTests();

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

const PARENT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PERSON_X = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const PERSON_Y = "cccccccc-cccc-cccc-cccc-cccccccccccc";

// 1) Add person — existing under same parent → BLOCK
{
  const r = Guard.evaluate(
    "add_person",
    {
      person_name: "محمد",
      parent_person_id: PARENT_A,
      branch_key: "زيدان",
    },
    {
      siblings: [
        {
          leaf: "محمد",
          parent_person_id: PARENT_A,
          person_id: PERSON_X,
        },
      ],
      people: [],
    }
  );
  assert(r.verdict === "block" && r.code === "ADD_PERSON_EXISTS", "1 add_person same parent → block");
}

// 2) Add person — similar name elsewhere → REVIEW (not block)
{
  const r = Guard.evaluate(
    "add_person",
    {
      person_name: "محمد",
      parent_person_id: PARENT_A,
      branch_key: "زيدان",
    },
    {
      siblings: [],
      people: [
        {
          leaf: "محمد",
          parent_person_id: PERSON_Y,
          person_id: PERSON_X,
        },
      ],
    }
  );
  assert(r.verdict === "review" && r.code === "ADD_PERSON_SIMILAR", "2 add_person similar name → review");
}

// 3) Add person — truly new → ALLOW
{
  const r = Guard.evaluate(
    "add_person",
    {
      person_name: "تركي",
      parent_person_id: PARENT_A,
      branch_key: "زيدان",
      different_person_same_name: false,
    },
    { siblings: [{ leaf: "محمد", parent_person_id: PARENT_A }], people: [] }
  );
  assert(r.verdict === "allow", "3 add_person new → allow");
}

// 4) Event — same type + person_id + date → BLOCK
{
  const r = Guard.evaluate(
    "event",
    {
      type: "marriage",
      person_id: PERSON_X,
      person: "محمد",
      date_label: "1447-01-10",
      title: "محمد",
      branch_key: "زيدان",
    },
    {
      events: [
        {
          type: "marriage",
          person_id: PERSON_X,
          person: "محمد",
          date_label: "1447-01-10",
          branch_key: "زيدان",
        },
      ],
    }
  );
  assert(r.verdict === "block" && r.code === "EVENT_SAME", "4 event same entity → block");
}

// 5) Event — same title, different date → ALLOW (not proven same)
{
  const r = Guard.evaluate(
    "event",
    {
      type: "marriage",
      person_id: PERSON_X,
      person: "محمد",
      date_label: "1447-02-01",
      title: "محمد",
      branch_key: "زيدان",
    },
    {
      events: [
        {
          type: "marriage",
          person_id: PERSON_X,
          person: "محمد",
          date_label: "1446-01-10",
          branch_key: "زيدان",
        },
      ],
    }
  );
  assert(
    r.verdict === "allow" || r.verdict === "review",
    "5 event different date → not block (allow/review)"
  );
  assert(r.verdict !== "block", "5b event different date must not block");
}

// 6) Health — same person + same case + place → BLOCK
{
  const r = Guard.evaluate(
    "health",
    {
      type: "sick",
      person_id: PERSON_X,
      person: "محمد",
      hospital_name: "مستشفى الملك فيصل",
      event_date: "2026-08-01",
      branch_key: "زيدان",
    },
    {
      events: [
        {
          type: "sick",
          person_id: PERSON_X,
          person: "محمد",
          hospital_name: "مستشفى الملك فيصل",
          event_date: "2026-08-01",
          branch_key: "زيدان",
        },
      ],
    }
  );
  assert(r.verdict === "block" && r.code === "HEALTH_SAME", "6 health same case → block");
}

// 7) Health — same person, different case type → ALLOW
{
  const r = Guard.evaluate(
    "health",
    {
      type: "operation",
      person_id: PERSON_X,
      person: "محمد",
      hospital_name: "مستشفى الملك فيصل",
      branch_key: "زيدان",
    },
    {
      events: [
        {
          type: "sick",
          person_id: PERSON_X,
          person: "محمد",
          hospital_name: "مستشفى الملك فيصل",
          branch_key: "زيدان",
        },
      ],
    }
  );
  assert(r.verdict === "allow", "7 health different case type → allow");
}

// 8) Death — same person_id already deceased → BLOCK
{
  const r = Guard.evaluate(
    "death",
    { person_id: PERSON_X, person: "محمد" },
    {
      people: [{ person_id: PERSON_X, leaf: "محمد", is_deceased: true }],
      events: [],
    }
  );
  assert(r.verdict === "block" && r.code === "DEATH_SAME", "8 death same person_id → block");
}

// 8b) Death — name spelling only → REVIEW not BLOCK
{
  const r = Guard.evaluate(
    "death",
    { person: "محمد", person_id: "" },
    {
      people: [],
      events: [{ type: "death", person: "محمد", person_id: "" }],
    }
  );
  assert(r.verdict === "review", "8b death name-only → review (not block)");
}

// 9) Memory — same person + title (+ date) → BLOCK
{
  const r = Guard.evaluate(
    "memory",
    {
      person_id: PERSON_X,
      title: "صورة العيد",
      memory_kind: "general",
      memory_date: "2020-01-01",
    },
    {
      memories: [
        {
          person_id: PERSON_X,
          title: "صورة العيد",
          memory_kind: "general",
          memory_date: "2020-01-01",
        },
      ],
    }
  );
  assert(r.verdict === "block" && r.code === "MEMORY_SAME", "9 memory same → block");
}

// 10) Memory — different title same person → ALLOW
{
  const r = Guard.evaluate(
    "memory",
    {
      person_id: PERSON_X,
      title: "رحلة البر",
      memory_kind: "general",
      memory_date: "2021-01-01",
    },
    {
      memories: [
        {
          person_id: PERSON_X,
          title: "صورة العيد",
          memory_kind: "general",
          memory_date: "2020-01-01",
        },
      ],
    }
  );
  assert(r.verdict === "allow", "10 memory different title → allow");
}

// Double submit via create entry
{
  Create.resetLocksForTests();
  const payload = {
    person_name: "نواف",
    parent_person_id: PARENT_A,
    branch_key: "زيدان",
  };
  const catalog = { siblings: [], people: [] };
  let inserts = 0;
  async function runOnce() {
    return Create.create({
      type: "add_person",
      payload: payload,
      catalog: catalog,
      skipFetch: true,
      performInsert: async function () {
        inserts += 1;
        // keep lock until settle
        await new Promise(function (r) {
          setTimeout(r, 30);
        });
        return { request_id: "REQ-TEST" };
      },
    });
  }
  Promise.all([runOnce(), runOnce()])
    .then(function (pair) {
      const okCount = pair.filter(function (x) {
        return x && x.ok;
      }).length;
      const blockedDup = pair.some(function (x) {
        return x && x.doubleSubmit;
      });
      assert(okCount === 1, "double-submit: exactly one create succeeds");
      assert(blockedDup, "double-submit: second call flagged doubleSubmit");
      assert(inserts === 1, "double-submit: insert ran once");

      // Name alone never enough for death block (already 8b)
      // Affirmed different same name allows after review
      const afterAck = Guard.evaluate(
        "add_person",
        {
          person_name: "محمد",
          parent_person_id: PARENT_A,
          different_person_same_name: true,
        },
        {
          siblings: [],
          people: [{ leaf: "محمد", parent_person_id: PERSON_Y, person_id: PERSON_X }],
        }
      );
      assert(afterAck.verdict === "allow", "similar name + acknowledge different → allow");

      console.log("\n--- summary ---");
      console.log("passed:", results.filter((x) => x.ok).length, "/", results.length);
      if (failed) {
        console.error("FAILED:", failed);
        process.exit(1);
      }
      console.log("All dup-identity-guard checks passed.");
    })
    .catch(function (err) {
      console.error(err);
      process.exit(1);
    });
}
