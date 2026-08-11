#!/usr/bin/env node
/**
 * Prove add-person same-father gate is a direct parent_person_id lookup
 * (not sibling-catalog success/failure, not name special-cases).
 *
 * Live under خميس:
 * 1) حسن → Create.create BLOCK, inserts=0, ADD_PERSON_EXISTS
 * 2) حسين → same BLOCK (proves general matching)
 * 3) brand-new unique name → ALLOW, inserts=1
 *
 * Also static-assert RX short-circuits same-father to exists/block
 * and does not send same-father hits to identity «different person» path.
 *
 * Run: npm run verify:hasan-khamis
 * Alias: npm run verify:under-father
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

function leafOf(row) {
  return String(row.child_name || row.name || "")
    .split("/")
    .filter(Boolean)
    .pop();
}

async function assertCreateBlocked(label, personName, parentPid, parentPath, branch) {
  if (typeof Create.resetLocksForTests === "function") Create.resetLocksForTests();
  let inserts = 0;
  const created = await Create.create({
    type: "add_person",
    payload: {
      person_name: personName,
      parent_person_id: parentPid,
      parent_path: parentPath,
      branch_key: branch,
      different_person_same_name: true,
    },
    client: makeRestClient(),
    catalog: { siblings: [], people: [] },
    skipFetch: true,
    acknowledgeReview: true,
    performInsert: async function () {
      inserts += 1;
      return { request_id: "SHOULD-NOT" };
    },
  });
  assert(
    created.ok === false && created.blocked === true,
    label + " block: " + personName + " تحت خميس"
  );
  assert(inserts === 0, label + " no INSERT / no new REQ for " + personName);
  assert(
    created.guard && created.guard.code === "ADD_PERSON_EXISTS",
    label + " code ADD_PERSON_EXISTS"
  );
}

(async function main() {
  if (!Guard || !Create) {
    console.error("modules not loaded");
    process.exit(1);
  }
  if (typeof Create.resetLocksForTests === "function") Create.resetLocksForTests();

  const PARENT_PATH = "مزيد بن مطلق بن زيدان/خميس/دليميك/خميس";
  const BRANCH = "مزيد";

  // Normalize must keep حسن and حسين distinct (no special-case collapse).
  assert(
    Guard.normalizeArabic("حسن") !== Guard.normalizeArabic("حسين"),
    "normalizeArabic: حسن ≠ حسين"
  );
  assert(
    Guard.normalizeArabic("حسن") === Guard.normalizeArabic("حسن"),
    "normalizeArabic: حسن matches itself"
  );
  assert(
    Guard.normalizeArabic("حسين") === Guard.normalizeArabic("حسين"),
    "normalizeArabic: حسين matches itself"
  );

  const childRows = await rest(
    "tree_children?select=person_id,parent_person_id,parent_name,child_name,name,branch_key" +
      "&branch_key=eq." +
      encodeURIComponent(BRANCH) +
      "&parent_name=eq." +
      encodeURIComponent(PARENT_PATH) +
      "&limit=50"
  );
  const hasan = (childRows || []).find(function (r) {
    return leafOf(r) === "حسن";
  });
  const hussein = (childRows || []).find(function (r) {
    return leafOf(r) === "حسين";
  });
  assert(!!hasan && !!hasan.parent_person_id, "live: حسن exists under خميس with parent_person_id");
  assert(
    !!hussein && !!hussein.parent_person_id,
    "live: حسين exists under خميس with parent_person_id"
  );
  const parentPid = hasan.parent_person_id;
  assert(
    String(hussein.parent_person_id) === String(parentPid),
    "live: حسن and حسين share the same parent_person_id under خميس"
  );
  const hasanPid = hasan.person_id;
  const husseinPid = hussein.person_id;

  // A) Direct live lookup finds each name under parent_person_id
  {
    const client = makeRestClient();
    const hitHasan = await Create.findExistingChildLive(client, {
      person_name: "حسن",
      parent_person_id: parentPid,
    });
    assert(!!hitHasan, "findExistingChildLive finds حسن under parent_person_id");
    assert(
      hitHasan && String(hitHasan.person_id || "") === String(hasanPid || ""),
      "live hit person_id matches حسن"
    );

    const hitHussein = await Create.findExistingChildLive(client, {
      person_name: "حسين",
      parent_person_id: parentPid,
    });
    assert(!!hitHussein, "findExistingChildLive finds حسين under parent_person_id");
    assert(
      hitHussein && String(hitHussein.person_id || "") === String(husseinPid || ""),
      "live hit person_id matches حسين"
    );

    // Cross-name must not match
    assert(
      !(
        hitHasan &&
        hitHussein &&
        String(hitHasan.person_id) === String(hitHussein.person_id)
      ),
      "حسن and حسين are distinct person_ids under خميس"
    );
  }

  // B) Known person_id under same father also hits
  if (hasanPid) {
    const client = makeRestClient();
    const hit = await Create.findExistingChildLive(client, {
      person_name: "أي اسم",
      person_id: hasanPid,
      parent_person_id: parentPid,
    });
    assert(!!hit, "findExistingChildLive matches by person_id under father");
  }

  // C) حسن: Create.create blocked even with empty siblings + «شخص آخر» + skipFetch
  await assertCreateBlocked("TEST1", "حسن", parentPid, PARENT_PATH, BRANCH);

  // D) حسين: same general BLOCK (not حسن-only)
  await assertCreateBlocked("TEST2", "حسين", parentPid, PARENT_PATH, BRANCH);

  // E) New person under خميس allowed (direct gate finds nothing)
  {
    if (typeof Create.resetLocksForTests === "function") Create.resetLocksForTests();
    const unique = "اسم_اختبار_غير_موجود_" + Date.now();
    let inserts = 0;
    const miss = await Create.findExistingChildLive(makeRestClient(), {
      person_name: unique,
      parent_person_id: parentPid,
    });
    assert(miss === null, "TEST3 live check: new name not under خميس");

    const created = await Create.create({
      type: "add_person",
      payload: {
        person_name: unique,
        parent_person_id: parentPid,
        parent_path: PARENT_PATH,
        branch_key: BRANCH,
      },
      client: makeRestClient(),
      catalog: { siblings: [], people: [] },
      skipFetch: true,
      performInsert: async function () {
        inserts += 1;
        return { request_id: "REQ-OK-NEW" };
      },
    });
    assert(created.ok === true, "TEST3 allow: new person under خميس");
    assert(inserts === 1, "TEST3 INSERT once for new person");
  }

  // F) Static: RX short-circuits same-father before identity «different person» path
  {
    const rx = fs.readFileSync(
      path.join(root, "assets/js/modules/request-experience.js"),
      "utf8"
    );
    const hrc = fs.readFileSync(
      path.join(root, "assets/js/modules/home-request-create.js"),
      "utf8"
    );
    const fnStart = rx.indexOf("async function submitAddPerson");
    const fnBody = rx.slice(fnStart, fnStart + 16000);
    assert(fnStart >= 0, "submitAddPerson exists");
    assert(/await\s+Create\.create\s*\(/.test(fnBody), "submitAddPerson → Create.create");
    assert(
      rx.indexOf("async function decideAfterNameCheck") >= 0 &&
        rx.indexOf("async function blockIfExistsUnderSelectedFather") >= 0 &&
        rx.indexOf("function partitionIdentityCollisions") >= 0,
      "RX: same-father helpers (block / decide / partition) exist"
    );
    assert(
      /decideAfterNameCheck\s*\(/.test(fnBody),
      "submitAddPerson calls decideAfterNameCheck before identity/insert"
    );
    const decideStart = rx.indexOf("async function decideAfterNameCheck");
    const decideBody = rx.slice(decideStart, decideStart + 2500);
    assert(
      decideBody.indexOf("blockIfExistsUnderSelectedFather") >= 0 &&
        decideBody.indexOf('return "exists"') >= 0 &&
        decideBody.indexOf("partitionIdentityCollisions") >= 0,
      "decideAfterNameCheck: live same-father → exists before identity"
    );
    assert(
      decideBody.indexOf('return "identity"') >
        decideBody.indexOf("partitionIdentityCollisions"),
      "identity path only after same-father partition"
    );
    assert(
      hrc.indexOf("findExistingChildLive") >= 0 &&
        hrc.indexOf('eq("parent_person_id", parentPid)') >= 0,
      "Create: direct parent_person_id live check"
    );
    const liveAt = hrc.indexOf("findExistingChildLive(client, payload)");
    const insertAt = hrc.indexOf("insertApprovalRequest");
    assert(
      liveAt >= 0 && insertAt >= 0 && liveAt < insertAt,
      "live child check appears before insertApprovalRequest"
    );
    // No hardcoded test names in the general matching helpers
    const helperSlice = rx.slice(
      rx.indexOf("async function blockIfExistsUnderSelectedFather"),
      rx.indexOf("function isAlreadyChildUnderParent")
    );
    assert(
      helperSlice.indexOf("حسن") < 0 && helperSlice.indexOf("حسين") < 0,
      "RX same-father helpers have no hardcoded حسن/حسين"
    );
  }

  console.log("\n--- summary ---");
  if (failed) {
    console.error("FAILED:", failed);
    process.exit(1);
  }
  console.log(
    "All under-father checks passed (حسن block, حسين block, new name allow)."
  );
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
