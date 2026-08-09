#!/usr/bin/env node
/**
 * Prove حسن under خميس (live مزيد tree) cannot insert via Create.create.
 * Also proves the empty-siblings + different_person_same_name bypass is closed.
 *
 * Run: node scripts/test-hasan-khamis-add-person.js
 */
"use strict";

const fs = require("fs");
const path = require("path");

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
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error("FAIL:", msg);
  } else {
    console.log("OK:", msg);
  }
}

async function rest(tableQuery) {
  const res = await fetch(SUPABASE_URL + "/rest/v1/" + tableQuery, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: "Bearer " + SUPABASE_ANON_KEY,
    },
  });
  if (!res.ok) throw new Error("REST " + res.status + " " + tableQuery);
  return res.json();
}

/** Minimal supabase-like client used by Create.fetchCatalog / create. */
function makeRestClient() {
  return {
    from(table) {
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
        async then(resolve, reject) {
          try {
            let q =
              state.table +
              "?select=" +
              encodeURIComponent(String(state.selectCols).replace(/\s+/g, ""));
            state.filters.forEach(function (f) {
              q += "&" + f.col + "=eq." + encodeURIComponent(String(f.val));
            });
            if (state.limitN) q += "&limit=" + state.limitN;
            const data = await rest(q);
            resolve({ data: data, error: null });
          } catch (e) {
            if (reject) reject(e);
            else resolve({ data: null, error: e });
          }
        },
      };
      return api;
    },
  };
}

(async function main() {
  if (!Guard || !Create) {
    console.error("modules not loaded");
    process.exit(1);
  }
  if (typeof Create.resetLocksForTests === "function") Create.resetLocksForTests();

  const PARENT_PATH = "مزيد بن مطلق بن زيدان/خميس/دليميك/خميس";
  const PARENT_PATH_SPACED = "مزيد بن مطلق بن زيدان / خميس / دليميك / خميس";
  const BRANCH = "مزيد";

  // Live: resolve the real خميس father + حسن child (same shape as UI sibling fetch).
  const hasanRows = await rest(
    "tree_children?select=person_id,parent_person_id,parent_name,child_name,name,branch_key" +
      "&branch_key=eq." +
      encodeURIComponent(BRANCH) +
      "&parent_name=eq." +
      encodeURIComponent(PARENT_PATH) +
      "&limit=50"
  );
  const leaves = (Array.isArray(hasanRows) ? hasanRows : []).map(function (r) {
    return String(r.child_name || r.name || "")
      .split("/")
      .filter(Boolean)
      .pop();
  });
  assert(leaves.indexOf("حسن") >= 0, "live siblings under خميس include حسن");
  const hasan = (hasanRows || []).find(function (r) {
    const leaf = String(r.child_name || r.name || "")
      .split("/")
      .filter(Boolean)
      .pop();
    return leaf === "حسن";
  });
  assert(!!hasan && !!hasan.parent_person_id, "حسن row has parent_person_id");
  const parentPid = hasan.parent_person_id;
  const hasanPid = hasan.person_id;

  // 1) Bypass that previously allowed: empty siblings + people has same-parent child + diffName
  {
    const r = Guard.evaluate(
      "add_person",
      {
        person_name: "حسن",
        parent_person_id: parentPid,
        parent_path: PARENT_PATH_SPACED,
        branch_key: BRANCH,
        different_person_same_name: true,
      },
      {
        siblings: [],
        people: [
          {
            leaf: "حسن",
            person_id: hasanPid,
            parent_person_id: parentPid,
            parent_path: PARENT_PATH,
            parent_name: PARENT_PATH,
          },
        ],
      }
    );
    assert(
      r.verdict === "block" && r.code === "ADD_PERSON_EXISTS",
      "bypass closed: empty siblings + people same parent + diffName → block"
    );
  }

  // 2) Live catalog via Create.fetchCatalog (same as real submit skipFetch:false)
  {
    const client = makeRestClient();
    const cat = await Create.fetchCatalog(
      "add_person",
      {
        parent_person_id: parentPid,
        parent_path: PARENT_PATH_SPACED,
        branch_key: BRANCH,
      },
      client
    );
    const sibLeaves = (cat.siblings || []).map(function (s) {
      return s.leaf;
    });
    assert(sibLeaves.indexOf("حسن") >= 0, "fetchCatalog siblings include حسن for خميس");

    const ev = Guard.evaluate(
      "add_person",
      {
        person_name: "حسن",
        parent_person_id: parentPid,
        parent_path: PARENT_PATH,
        branch_key: BRANCH,
        different_person_same_name: true,
      },
      cat
    );
    assert(ev.verdict === "block", "evaluate live catalog → block حسن under خميس");
  }

  // 3) Create.create must NOT insert (real home path contract)
  {
    if (typeof Create.resetLocksForTests === "function") Create.resetLocksForTests();
    let inserts = 0;
    const client = makeRestClient();
    const created = await Create.create({
      type: "add_person",
      payload: {
        person_name: "حسن",
        parent_person_id: parentPid,
        parent_path: PARENT_PATH,
        branch_key: BRANCH,
        different_person_same_name: true,
      },
      client: client,
      skipFetch: false,
      acknowledgeReview: true,
      performInsert: async function () {
        inserts += 1;
        return { request_id: "SHOULD-NOT" };
      },
    });
    assert(created.ok === false && created.blocked === true, "Create.create blocks حسن/خميس");
    assert(inserts === 0, "no INSERT for حسن under خميس");
    assert(
      created.guard && created.guard.code === "ADD_PERSON_EXISTS",
      "block code ADD_PERSON_EXISTS"
    );
  }

  // 4) Double-submit: one create only (new person under same parent)
  {
    if (typeof Create.resetLocksForTests === "function") Create.resetLocksForTests();
    let inserts = 0;
    const payload = {
      person_name: "اسم_اختبار_فريد_" + Date.now(),
      parent_person_id: parentPid,
      parent_path: PARENT_PATH,
      branch_key: BRANCH,
    };
    async function once() {
      return Create.create({
        type: "add_person",
        payload: payload,
        catalog: { siblings: [], people: [] },
        skipFetch: true,
        performInsert: async function () {
          inserts += 1;
          await new Promise(function (r) {
            setTimeout(r, 40);
          });
          return { request_id: "REQ-TEST" };
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
    assert(okCount === 1, "double-submit: exactly one create succeeds");
    assert(dup, "double-submit: second flagged");
    assert(inserts === 1, "double-submit: insert once");
  }

  // 5) Code-path proof: submitAddPerson calls hard gate + Create.create (static)
  {
    const rx = fs.readFileSync(
      path.join(root, "assets/js/modules/request-experience.js"),
      "utf8"
    );
    assert(rx.indexOf("async function submitAddPerson") >= 0, "submitAddPerson exists");
    assert(
      /data-rx-submit[\s\S]*submitAddPerson\(/.test(rx),
      "data-rx-submit handler calls submitAddPerson"
    );
    const fnStart = rx.indexOf("async function submitAddPerson");
    const fnBody = rx.slice(fnStart, fnStart + 12000);
    assert(
      fnBody.indexOf("refreshChildrenUnderParent") >= 0 &&
        /await\s+Create\.create\s*\(/.test(fnBody),
      "submitAddPerson: findExistingChildUnderParent + Create.create before insert"
    );
    const gateAt = fnBody.indexOf("refreshChildrenUnderParent");
    const liveAt = fnBody.indexOf("liveChildExistsUnderParentPid");
    const insertAt = fnBody.search(/await\s+Create\.create\s*\(/);
    assert(
      gateAt >= 0 && insertAt >= 0 && gateAt < insertAt,
      "hard sibling gate runs before Create.create"
    );
    assert(
      liveAt >= 0 && liveAt < insertAt,
      "submitAddPerson live parent_person_id gate before Create.create"
    );
    assert(
      fs
        .readFileSync(path.join(root, "assets/js/modules/home-request-create.js"), "utf8")
        .indexOf('from("approval_requests").insert') >= 0,
      "INSERT site: home-request-create insertApprovalRequest"
    );
    const app = fs.readFileSync(path.join(root, "assets/js/app.js"), "utf8");
    const a = app.indexOf('const form = document.querySelector("[data-tree-card-form]")');
    const b = app.indexOf("FAMILY_TREE_CHILDREN_TABLE", a);
    const chunk = app.slice(a, b > a ? b : a + 20000);
    assert(chunk.indexOf("AlzidanHomeRequestCreate") >= 0, "legacy tree-card uses AlzidanHomeRequestCreate");
    assert(chunk.indexOf("Create.create") >= 0, "legacy tree-card calls Create.create");
    assert(
      chunk.indexOf('from("approval_requests").insert') < 0,
      "legacy tree-card has no bare approval_requests.insert"
    );
  }

  console.log("\n--- summary ---");
  if (failed) {
    console.error("FAILED:", failed);
    process.exit(1);
  }
  console.log("All حسن/خميس add-person checks passed.");
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
