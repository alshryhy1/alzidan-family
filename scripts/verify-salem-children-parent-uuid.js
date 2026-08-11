#!/usr/bin/env node
/**
 * Prove Salem (سالم دوخي) UI children = all tree_children where
 * parent_person_id = Salem.person_id (6 leaves including عبيد + حضيري).
 *
 * Run: node scripts/verify-salem-children-parent-uuid.js
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

const SALEM_PATH = "مزيد بن مطلق بن زيدان/صلف/دوخي/سالم";
const EXPECTED = ["زيد", "مبارك", "دوخي", "عبدالله", "عبيد", "حضيري"];

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

function leaf(name) {
  const s = String(name || "").trim();
  if (!s) return "";
  const parts = s.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : s;
}

function norm(v) {
  return String(v || "").replace(/\s+/g, " ").trim();
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
  assert(!!FM && typeof FM.childrenForSelectedParent === "function", "PersonCore loaded");

  const fathers = await rest(
    "tree_children?branch_key=eq." +
      encodeURIComponent("مزيد") +
      "&or=(child_name.eq." +
      encodeURIComponent(SALEM_PATH) +
      ",name.eq." +
      encodeURIComponent(SALEM_PATH) +
      ")&select=id,person_id,child_name,name&limit=5",
  );
  assert(Array.isArray(fathers) && fathers.length >= 1, "Salem row found");
  const salemPid = String(fathers[0].person_id || "");
  assert(!!salemPid, "Salem person_id present: " + salemPid);
  console.log("Salem person_id:", salemPid);

  const rows = await rest(
    "tree_children?parent_person_id=eq." +
      encodeURIComponent(salemPid) +
      "&select=id,person_id,parent_person_id,parent_name,child_name,name,birth_order&order=id.asc",
  );
  assert(rows.length === 6, "REST parent_person_id count === 6 (got " + rows.length + ")");
  const restLeaves = rows.map((r) => leaf(r.child_name || r.name)).sort();
  assert(
    EXPECTED.slice().sort().every((n) => restLeaves.includes(n)),
    "REST leaves include عبيد + حضيري: " + restLeaves.join("، "),
  );
  const parentNames = [...new Set(rows.map((r) => r.parent_name))];
  assert(
    parentNames.length >= 2,
    "DB still has parent_name spelling split (display bug precondition): " +
      parentNames.join(" | "),
  );

  // Simulate in-memory map as groupChildrenRows would key by parent_name
  const childrenMap = {};
  rows.forEach((r) => {
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
  const pathOnly = Array.isArray(childrenMap[SALEM_PATH])
    ? childrenMap[SALEM_PATH].length
    : 0;
  assert(pathOnly === 4, "path-key alone still has 4 (proves old bug shape)");

  const ui = FM.childrenForSelectedParent(childrenMap, SALEM_PATH, {
    normalizePersonName: norm,
    parentPersonId: salemPid,
  });
  assert(ui.list.length === 6, "UI childrenForSelectedParent → 6 (got " + ui.list.length + ")");
  const uiLeaves = ui.list.map((c) => leaf(c.name));
  assert(
    EXPECTED.every((n) => uiLeaves.includes(n)),
    "UI leaves: " + uiLeaves.join("، "),
  );

  if (typeof FM.unionChildrenMapByParentPersonId === "function") {
    const united = FM.unionChildrenMapByParentPersonId(
      JSON.parse(JSON.stringify(childrenMap)),
      norm,
    );
    assert(
      (united[SALEM_PATH] || []).length === 6,
      "unionChildrenMapByParentPersonId puts 6 under canonical Salem path",
    );
  }

  if (failed) {
    console.error("\n" + failed + " failed");
    process.exit(1);
  }
  console.log("\nProof OK — Salem shows 6 children via parent_person_id (no DB writes).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
