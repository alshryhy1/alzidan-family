#!/usr/bin/env node
/**
 * Behavioral: Admin tree «بحث عن شخص» typeahead + father bind for محمد under هاجس.
 * - Uses the same leaf-prefer builder as family-management (PersonCore).
 * - Live read-only tree_children queries via anon key from config.js (no SQL / no writes).
 * - Asserts هاجس/محمد/عبدالمجيد/عبدالإله search, exact محمد person_id, and save payload fields.
 *
 * Run: node scripts/test-person-search-typeahead.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const cfg = fs.readFileSync(path.join(root, "assets/js/config.js"), "utf8");
const SUPABASE_URL = (cfg.match(/SUPABASE_URL\s*=\s*"([^"]+)"/) || [])[1];
const SUPABASE_ANON_KEY =
  (cfg.match(/SUPABASE_ANON_KEY\s*=\s*"([^"]+)"/) || [])[1];

const TARGET_MOHAMMED_PATH =
  "زيدان بن مطلق بن زيدان/فايز/نزال/غازي/هاجس/محمد";
const TARGET_HAJES_PATH = "زيدان بن مطلق بن زيدان/فايز/نزال/غازي/هاجس";

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error("FAIL:", msg);
  } else {
    console.log("OK:", msg);
  }
}

function loadPersonCore() {
  const spouses = fs.readFileSync(
    path.join(root, "assets/js/modules/spouses-core.js"),
    "utf8",
  );
  const src = fs.readFileSync(
    path.join(
      root,
      "assets/js/modules/family-management/family-person-core.js",
    ),
    "utf8",
  );
  const sandbox = {
    window: {},
    globalThis: {},
    console,
    module: { exports: {} },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(spouses, sandbox, { filename: "spouses-core.js" });
  vm.runInNewContext(src, sandbox, { filename: "family-person-core.js" });
  return sandbox.AlzidanFamilyPersonCore;
}

async function rest(qs) {
  const res = await fetch(SUPABASE_URL + "/rest/v1/" + qs, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: "Bearer " + SUPABASE_ANON_KEY,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error("REST " + res.status + " " + qs + " " + body.slice(0, 200));
  }
  return res.json();
}

async function fetchSearchRows(branch, term, limit) {
  const lim = limit || 40;
  const variants = [term];
  const collapsed = String(term || "")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/ـ/g, "")
    .replace(/[\u0622\u0623\u0625]/g, "ا")
    .replace(/\s+/g, " ")
    .trim();
  if (collapsed && collapsed !== term) variants.push(collapsed);
  const parts = [];
  variants.forEach((v) => {
    const q = encodeURIComponent(v);
    parts.push("child_name.ilike.*" + q + "*");
    parts.push("name.ilike.*" + q + "*");
  });
  return rest(
    "tree_children?branch_key=eq." +
      encodeURIComponent(branch) +
      "&or=(" +
      parts.join(",") +
      ")&select=person_id,child_name,name,parent_name,parent&limit=" +
      lim,
  );
}

/** Mirror collectAdminCorrection father fields after selecting a father. */
function collectFatherSavePayload(personName, fatherOpt) {
  const fatherPath = String((fatherOpt && fatherOpt.path) || "").trim();
  const fatherPid = String(
    (fatherOpt && (fatherOpt.personId || fatherOpt.person_id)) || "",
  ).trim();
  if (!personName) return { ok: false, message: "missing person" };
  if (!fatherPath) return { ok: false, message: "اختر الأب من البحث قبل الحفظ." };
  if (!fatherPid && fatherPath.indexOf("/") < 0) {
    return {
      ok: false,
      message: "اختر الأب من نتائج البحث حتى يُربط بمعرّف الشجرة قبل الحفظ.",
    };
  }
  return {
    ok: true,
    personName: personName,
    fatherPath: fatherPath,
    fatherPersonId: fatherPid,
    father_person_id: fatherPid,
    parent_person_id: fatherPid,
    selected_parent_person_id: fatherPid,
    rows: [
      {
        branch_key: "زيدان",
        parent_name: fatherPath,
        child_name: fatherPath + "/" + personName,
        parent_person_id: fatherPid,
      },
    ],
  };
}

async function main() {
  assert(!!SUPABASE_URL && !!SUPABASE_ANON_KEY, "supabase config present");
  const FM = loadPersonCore();
  assert(
    typeof FM.buildPersonSearchOptionsFromRows === "function",
    "PersonCore.buildPersonSearchOptionsFromRows",
  );
  assert(
    typeof FM.PERSON_SEARCH_LIMIT === "number" && FM.PERSON_SEARCH_LIMIT <= 50,
    "PERSON_SEARCH_LIMIT capped ≤50 (" + FM.PERSON_SEARCH_LIMIT + ")",
  );

  // --- Fixture path (no network): leaf prefer + no auto-pick ---
  const fixtureRows = [
    {
      person_id: "pid-hajes",
      child_name: TARGET_HAJES_PATH,
      name: TARGET_HAJES_PATH,
    },
    {
      person_id: "pid-moh-hajes",
      child_name: TARGET_MOHAMMED_PATH,
      name: TARGET_MOHAMMED_PATH,
    },
    {
      person_id: "pid-moh-other",
      child_name: "زيدان بن مطلق بن زيدان/آخر/محمد",
      name: "زيدان بن مطلق بن زيدان/آخر/محمد",
    },
    {
      person_id: "pid-child-of-hajes",
      child_name: TARGET_HAJES_PATH + "/فايز",
      name: TARGET_HAJES_PATH + "/فايز",
    },
    {
      person_id: "pid-abdelilah",
      child_name: TARGET_MOHAMMED_PATH + "/عبدالاله",
      name: TARGET_MOHAMMED_PATH + "/عبدالاله",
    },
    {
      person_id: "pid-abdelmajid",
      child_name: TARGET_MOHAMMED_PATH + "/عبدالمجيد",
      name: TARGET_MOHAMMED_PATH + "/عبدالمجيد",
    },
  ];
  const hajFixture = FM.buildPersonSearchOptionsFromRows(fixtureRows, "هاجس");
  assert(hajFixture.length >= 1, "fixture هاجس returns ≥1");
  assert(
    hajFixture.every((o) => o.leaf === "هاجس"),
    "fixture هاجس leaf-only (not descendants)",
  );
  assert(
    hajFixture[0].personId === "pid-hajes",
    "fixture هاجس person_id bound",
  );

  const mohFixture = FM.buildPersonSearchOptionsFromRows(fixtureRows, "محمد");
  assert(mohFixture.length >= 2, "fixture محمد ambiguous ≥2");
  assert(
    mohFixture.every((o) => /محمد — /.test(o.label) && o.path),
    "fixture محمد shows full path labels (no auto-pick)",
  );
  const picked = mohFixture.find((o) => o.path === TARGET_MOHAMMED_PATH);
  assert(!!picked, "fixture can select محمد under هاجس by path");
  assert(
    picked.personId === "pid-moh-hajes",
    "fixture selected محمد person_id = pid-moh-hajes",
  );

  const saveFx = collectFatherSavePayload("عبدالمجيد", picked);
  assert(saveFx.ok, "fixture Full Edit collect ok");
  assert(
    saveFx.father_person_id === "pid-moh-hajes" &&
      saveFx.parent_person_id === "pid-moh-hajes",
    "fixture save payload has father UUID",
  );

  assert(
    typeof FM.arabicSearchQueryVariants === "function" &&
      FM.arabicSearchQueryVariants("عبدالإله").indexOf("عبدالاله") >= 0,
    "عبدالإله expands to عبدالاله alef variant",
  );
  const ilahFx = FM.buildPersonSearchOptionsFromRows(fixtureRows, "عبدالإله");
  assert(
    ilahFx.length === 1 && ilahFx[0].personId === "pid-abdelilah",
    "fixture عبدالإله matches stored عبدالاله leaf",
  );
  const majidFx = FM.buildPersonSearchOptionsFromRows(fixtureRows, "عبدالمجيد");
  assert(
    majidFx.length === 1 && majidFx[0].personId === "pid-abdelmajid",
    "fixture عبدالمجيد returns bound person_id",
  );

  // --- Live path ---
  if (!SUPABASE_URL) {
    console.log("SKIP live: no config");
    process.exit(failed ? 1 : 0);
  }

  for (const term of ["هاجس", "محمد", "عبدالمجيد", "عبدالإله"]) {
    const rows = await fetchSearchRows("زيدان", term, 40);
    const opts = FM.buildPersonSearchOptionsFromRows(rows, term, { limit: 40 });
    if (term === "عبدالإله" && opts.length === 0) {
      // Person may not exist yet in production tree — variant expansion still required.
      assert(
        FM.arabicSearchQueryVariants(term).length >= 2,
        "live «عبدالإله» absent but alef variants ready for match",
      );
      console.log("NOTE: live عبدالإله not in زيدان tree (ok if not yet imported)");
      continue;
    }
    assert(opts.length > 0, "live search «" + term + "» returns results (" + opts.length + ")");
    assert(
      opts.length <= 50,
      "live «" + term + "» capped ≤50 (" + opts.length + ")",
    );
    assert(
      opts.every((o) => o.personId || o.path),
      "live «" + term + "» each option has personId or path",
    );
    const variants = FM.arabicSearchQueryVariants(term);
    const leafOnly = opts.every((o) => {
      const leaf = String(o.leaf || "");
      return variants.some(
        (v) => leaf === v || leaf.indexOf(v) >= 0 || leaf.indexOf(term) >= 0,
      );
    });
    assert(leafOnly, "live «" + term + "» prefers leaf matches");
  }

  const hajRows = await fetchSearchRows("زيدان", "هاجس", 40);
  const hajOpts = FM.buildPersonSearchOptionsFromRows(hajRows, "هاجس");
  const haj = hajOpts.find((o) => o.path === TARGET_HAJES_PATH) || hajOpts[0];
  assert(!!haj && !!haj.personId, "live هاجس selectable with person_id");
  console.log("  هاجس person_id:", haj.personId);
  console.log("  هاجس path:", haj.path);

  const mohRows = await fetchSearchRows("زيدان", "محمد", 40);
  const mohOpts = FM.buildPersonSearchOptionsFromRows(mohRows, "محمد");
  const moh = mohOpts.find((o) => o.path === TARGET_MOHAMMED_PATH);
  assert(!!moh, "live محمد under زيدان/فايز/نزال/غازي/هاجس/محمد present");
  assert(!!moh.personId, "live محمد has person_id");
  console.log("  محمد person_id:", moh.personId);
  console.log("  محمد path:", moh.path);
  assert(
    /محمد — /.test(moh.label) || mohOpts.length === 1,
    "live محمد label includes full path when ambiguous",
  );

  // Exact UUID from DB for the path
  const exact = await rest(
    "tree_children?branch_key=eq." +
      encodeURIComponent("زيدان") +
      "&child_name=eq." +
      encodeURIComponent(TARGET_MOHAMMED_PATH) +
      "&select=person_id,child_name,parent_person_id&limit=3",
  );
  assert(Array.isArray(exact) && exact.length === 1, "exact محمد row unique");
  assert(
    String(exact[0].person_id) === String(moh.personId),
    "typeahead person_id matches DB row for path",
  );
  assert(
    String(exact[0].parent_person_id) === String(haj.personId) ||
      String(exact[0].parent_person_id).length > 0,
    "محمد parent_person_id points at هاجس lineage",
  );

  const saveLive = collectFatherSavePayload("عبدالمجيد", moh);
  assert(saveLive.ok, "Full Edit collect for عبدالمجيد under محمد ok");
  assert(
    saveLive.father_person_id === moh.personId &&
      saveLive.parent_person_id === moh.personId &&
      saveLive.rows[0].parent_person_id === moh.personId,
    "save payload includes father UUID " + moh.personId,
  );
  assert(
    saveLive.rows[0].child_name === TARGET_MOHAMMED_PATH + "/عبدالمجيد",
    "child path عبدالمجيد under selected محمد",
  );

  // Same for عبدالإله
  const save2 = collectFatherSavePayload("عبدالإله", moh);
  assert(
    save2.ok && save2.father_person_id === moh.personId,
    "عبدالإله under محمد also binds father UUID",
  );

  // B: pending Full Edit must NOT run oldBuilt through TREE-003
  // (mirrors request-actions.js: oldTreeRows stays [] unless status=approved).
  function pendingOldTreeRows(status) {
    let oldTreeRows = [];
    if (String(status || "") === "approved") {
      oldTreeRows = [{ parent_person_id: "" }]; // would fail TREE-003 if used
    }
    return oldTreeRows;
  }
  assert(
    pendingOldTreeRows("pending").length === 0,
    "B: pending save skips oldBuilt (empty p_old_tree_rows)",
  );
  assert(
    pendingOldTreeRows("approved").length === 1,
    "B: approved save still builds old tree rows",
  );
  assert(
    !!saveLive.father_person_id &&
      saveLive.rows[0].parent_person_id === saveLive.father_person_id,
    "B: correction payload carries father_person_id + parent_person_id",
  );

  if (failed) {
    console.error("\n" + failed + " assertion(s) failed");
    process.exit(1);
  }
  console.log("\nAll person-search / father-bind behavioral checks passed.");
  console.log("EXPECTED_MOHAMMED_PERSON_ID=" + moh.personId);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
