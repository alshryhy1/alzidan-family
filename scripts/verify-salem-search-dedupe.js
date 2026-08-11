#!/usr/bin/env node
/**
 * Prove admin/delegate person search for سالم under صلف/دوخي
 * collapses to ONE option by person_id (no DB writes).
 *
 * Run: node scripts/verify-salem-search-dedupe.js
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

const SALEM_PATH_Y = "مزيد بن مطلق بن زيدان/صلف/دوخي/سالم";
const SALEM_PATH_A = "مزيد بن مطلق بن زيدان/صلف/دوخى/سالم";

function loadPersonCore() {
  const src = fs.readFileSync(
    path.join(
      root,
      "assets/js/modules/family-management/family-person-core.js",
    ),
    "utf8",
  );
  const sandbox = { window: {}, globalThis: {}, console, module: { exports: {} } };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
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
  if (!res.ok) throw new Error("REST " + res.status + " " + qs);
  return res.json();
}

function norm(v) {
  return String(v || "").replace(/\s+/g, " ").trim();
}

function leaf(name) {
  const s = String(name || "").trim();
  if (!s) return "";
  const parts = s.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : s;
}

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error("FAIL:", msg);
  } else {
    console.log("OK:", msg);
  }
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error("Missing Supabase config");
    process.exit(1);
  }
  const FM = loadPersonCore();
  assert(!!FM && typeof FM.dedupePersonOptionsByPersonId === "function", "PersonCore dedupe loaded");
  assert(typeof FM.resolvePersonIdForNodePath === "function", "resolvePersonIdForNodePath loaded");

  const fathers = await rest(
    "tree_children?branch_key=eq." +
      encodeURIComponent("مزيد") +
      "&or=(child_name.eq." +
      encodeURIComponent(SALEM_PATH_Y) +
      ",name.eq." +
      encodeURIComponent(SALEM_PATH_Y) +
      ")&select=id,person_id,parent_person_id,parent_name,child_name,name&limit=5",
  );
  assert(Array.isArray(fathers) && fathers.length === 1, "exactly 1 سالم row under دوخي (ي)");
  const salemPid = String(fathers[0].person_id || "");
  assert(!!salemPid, "Salem person_id: " + salemPid);
  console.log("Salem person_id:", salemPid);

  const altFathers = await rest(
    "tree_children?branch_key=eq." +
      encodeURIComponent("مزيد") +
      "&or=(child_name.eq." +
      encodeURIComponent(SALEM_PATH_A) +
      ",name.eq." +
      encodeURIComponent(SALEM_PATH_A) +
      ")&select=id,person_id,child_name,name&limit=5",
  );
  assert(
    !altFathers.length,
    "no separate tree_children row for دوخى spelling of سالم (got " +
      altFathers.length +
      ")",
  );

  const kids = await rest(
    "tree_children?parent_person_id=eq." +
      encodeURIComponent(salemPid) +
      "&select=id,person_id,parent_person_id,parent_name,child_name,name&order=id.asc",
  );
  assert(kids.length === 6, "6 children under ONE person_id");
  const parentNames = [...new Set(kids.map((r) => r.parent_name))];
  assert(
    parentNames.length >= 2,
    "parent_name spelling split still present: " + parentNames.join(" | "),
  );

  const pathToRow = FM.buildPathToRowIndex(
    fathers.concat(kids),
    norm,
  );
  const childrenMap = {};
  kids.forEach((r) => {
    const parentKey = norm(r.parent_name || "");
    const childName = norm(r.child_name || r.name || "");
    if (!parentKey || !childName) return;
    if (!childrenMap[parentKey]) childrenMap[parentKey] = [];
    childrenMap[parentKey].push({
      name: childName,
      personId: String(r.person_id || ""),
      parentPersonId: String(r.parent_person_id || ""),
    });
  });

  const pidFromY = FM.resolvePersonIdForNodePath(
    SALEM_PATH_Y,
    pathToRow,
    childrenMap,
    norm,
  );
  const pidFromA = FM.resolvePersonIdForNodePath(
    SALEM_PATH_A,
    pathToRow,
    childrenMap,
    norm,
  );
  assert(pidFromY === salemPid, "resolve دوخي/سالم → person_id");
  assert(pidFromA === salemPid, "resolve دوخى/سالم → same person_id");

  const rawOptions = [
    {
      value: SALEM_PATH_Y,
      label: "سالم — مزيد بن مطلق بن زيدان/صلف/دوخي",
      personId: pidFromY,
    },
    {
      value: SALEM_PATH_A,
      label: "سالم — مزيد بن مطلق بن زيدان/صلف/دوخي",
      personId: pidFromA,
    },
    {
      value: "مزيد بن مطلق بن زيدان/صلف/دوخى/سالم/حضيري/سالم",
      label: "سالم — مزيد بن مطلق بن زيدان/صلف/دوخى/سالم/حضيري",
      personId: "af923e02-91fb-4a37-9c41-9f7eb497679d",
    },
  ];

  const deduped = FM.dedupePersonOptionsByPersonId(rawOptions, {
    normalizePersonName: norm,
    pathToRow,
  });
  const salemHits = deduped.filter((o) => {
    const lab = String(o.label || "");
    const val = String(o.value || "");
    return leaf(val) === "سالم" && (lab.includes("صلف") || val.includes("صلف"));
  });
  const fatherHits = salemHits.filter((o) => o.personId === salemPid);
  assert(
    fatherHits.length === 1,
    "search index: 1 entry for father سالم person_id (got " +
      fatherHits.length +
      ")",
  );
  assert(
    fatherHits[0].value === SALEM_PATH_Y,
    "canonical value prefers own row path (دوخي): " + fatherHits[0].value,
  );

  const distinctFatherPids = [
    ...new Set(fatherHits.map((o) => o.personId).filter(Boolean)),
  ];
  assert(
    distinctFatherPids.length === 1,
    "distinct person_ids for father سالم hits: " + distinctFatherPids.length,
  );

  const ui = FM.childrenForSelectedParent(childrenMap, fatherHits[0].value, {
    normalizePersonName: norm,
    parentPersonId: salemPid,
  });
  assert(ui.list.length === 6, "selecting unified سالم → 6 children");

  if (failed) {
    console.error("\n" + failed + " failed");
    process.exit(1);
  }
  console.log(
    "\nProof OK — 1 person_id for سالم دوخي; search dedupes to 1; children 6. No DB writes.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
