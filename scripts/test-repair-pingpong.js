#!/usr/bin/env node
"use strict";

/**
 * Regression: missing_father ↔ path_mismatch must not thrash.
 * Truth Before Speed — unified repair uses canonical living father only.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function load(rel) {
  const src = fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
  const ctx = { window: {}, console, module: { exports: {} }, exports: {} };
  ctx.globalThis = ctx;
  vm.runInNewContext(src, ctx, { filename: rel });
  return ctx;
}

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("ok:", msg);
  }
}

const structCtx = load("assets/js/modules/integrity-tree-structure-audit.js");
const Struct = structCtx.window.AlzidanIntegrityTreeStructure;
const pipeCtx = load("assets/js/modules/integrity-repair-pipeline.js");
pipeCtx.window.AlzidanIntegrityTreeStructure = Struct;
const Pipe = pipeCtx.window.AlzidanIntegrityRepairPipeline;
const engCtx = load("assets/js/modules/tree-engine.js");
engCtx.window.AlzidanIntegrityTreeStructure = Struct;
const Engine = engCtx.window.AlzidanTreeEngine;

const fatherPath = "مزيد بن مطلق بن زيدان/صلف/دوخي";
const extractSpell = "مزيد بن مطلق بن زيدان/صلف/دوخى";
const fatherPid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const unclePid = "cccccccc-cccc-cccc-cccc-cccccccccccc";

const fatherRow = {
  id: 1,
  branch_key: "مزيد",
  name: fatherPath,
  child_name: fatherPath,
  parent: "مزيد بن مطلق بن زيدان/صلف",
  parent_name: "مزيد بن مطلق بن زيدان/صلف",
  person_id: fatherPid,
};

const uncleRow = {
  id: 2,
  branch_key: "مزيد",
  name: fatherPath + "/أخ",
  child_name: fatherPath + "/أخ",
  parent: fatherPath,
  parent_name: fatherPath,
  person_id: unclePid,
};

// 1) دوخي/دوخى spelling: leave BOTH buckets
{
  const row = {
    id: 1508,
    branch_key: "مزيد",
    name: extractSpell + "/مسلم",
    child_name: extractSpell + "/مسلم",
    parent: extractSpell,
    parent_name: extractSpell,
    person_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  };
  const report = Struct.auditTreeStructure([fatherRow, row], []);
  assert(
    report.lists.missing_father.filter((r) => r.id === 1508).length === 0,
    "1508-style spelling: not missing_father",
  );
  assert(
    report.lists.path_mismatch.filter((r) => r.id === 1508).length === 0,
    "1508-style spelling: not path_mismatch",
  );
}

// 2) path_mismatch → propose canonical father (not raw extract)
{
  const row = {
    id: 1508,
    branch_key: "مزيد",
    name: extractSpell + "/مسلم",
    child_name: extractSpell + "/مسلم",
    parent: fatherPath + "/أخ",
    parent_name: fatherPath + "/أخ",
    person_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    parent_person_id: unclePid,
  };
  const children = [fatherRow, uncleRow, row];
  const report = Struct.auditTreeStructure(children, []);
  const issue = report.lists.path_mismatch.find((r) => r.id === 1508);
  assert(!!issue, "genuine path mismatch flagged");
  const analysis = Pipe.analyzeIssue(issue, { children });
  assert(
    analysis.proposed && analysis.proposed.parent === fatherPath,
    "path repair uses canonical father spelling دوخي",
  );
  assert(
    analysis.proposed.parent_person_id === fatherPid,
    "path repair links father person_id",
  );
  const preview = Pipe.previewRepair(analysis, null);
  assert(preview.executable === true, "canonical path repair executable");
  assert(preview.clears_missing_father === true, "clears missing_father flag");
  assert(preview.clears_path_mismatch === true, "clears path_mismatch flag");
  assert(preview.would_flip_only === false, "does not flip-only");
}

// 3) path extract with no living father, but stored parent is living →
//    rewrite name under stored father (1602-style) — never empty After / flip thrash
{
  const orphanExtract = "مزيد بن مطلق بن زيدان/صلف/يتيم_لا_يوجد";
  const row = {
    id: 1509,
    branch_key: "مزيد",
    name: orphanExtract + "/مسلم",
    child_name: orphanExtract + "/مسلم",
    parent: fatherPath,
    parent_name: fatherPath,
    person_id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
    parent_person_id: fatherPid,
  };
  const children = [fatherRow, row];
  const report = Struct.auditTreeStructure(children, []);
  const issue = report.lists.path_mismatch.find((r) => r.id === 1509);
  assert(!!issue, "orphan-extract path mismatch flagged");
  const analysis = Pipe.analyzeIssue(issue, { children });
  assert(
    analysis.repair_type === "align_name_to_parent_path",
    "orphan extract + living stored → align name under parent",
  );
  assert(
    analysis.proposed &&
      analysis.proposed.child_path === fatherPath + "/مسلم",
    "proposes name under canonical stored father",
  );
  assert(analysis.proposed.keep_parent === true, "keeps parent fields");
  const preview = Pipe.previewRepair(analysis, null);
  assert(preview.executable === true, "name-under-parent executable");
  assert(preview.would_flip_only === false, "not flip-only thrash");
  assert(preview.after && preview.after.child_path, "After not empty");
  const sql = Pipe.buildExecuteSql(preview, { actor: "test" });
  assert(sql.ok === true, "buildExecuteSql for name-under-parent");
  assert(/child_name/.test(sql.sql), "SQL updates name");
}

// 4) missing_father with extract matching living father → unified auto propose
{
  const row = {
    id: 1510,
    branch_key: "مزيد",
    name: fatherPath + "/مسلم",
    child_name: fatherPath + "/مسلم",
    parent: "أب_وهمي",
    parent_name: "أب_وهمي",
    person_id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
  };
  const children = [fatherRow, uncleRow, row];
  const report = Struct.auditTreeStructure(children, []);
  const issue = report.lists.missing_father.find((r) => r.id === 1510);
  assert(!!issue, "missing_father flagged for phantom parent");
  const analysis = Pipe.analyzeIssue(issue, { children });
  assert(analysis.can_auto_propose === true, "missing_father auto when extract resolves");
  assert(
    analysis.proposed && analysis.proposed.parent === fatherPath,
    "missing_father proposes canonical extract father",
  );
  const preview = Pipe.previewRepair(analysis, null);
  assert(preview.executable === true, "unified missing_father executable");

  const bad = Pipe.previewRepair(analysis, {
    id: 2,
    person_id: unclePid,
    child_path: fatherPath + "/أخ",
  });
  assert(bad.would_flip_only === true, "wrong suggestion blocked as flip");
  assert(bad.executable === false, "wrong suggestion not executable");
  assert(
    String(bad.block_message_ar || "").indexOf("فئة أخرى") >= 0,
    "wrong suggestion shows Arabic block",
  );

  const fixed = Object.assign({}, row, {
    parent: fatherPath,
    parent_name: fatherPath,
    parent_person_id: fatherPid,
  });
  const after = Struct.auditTreeStructure([fatherRow, uncleRow, fixed], []);
  assert(
    after.lists.missing_father.filter((r) => r.id === 1510).length === 0,
    "after unified fix: leave missing_father",
  );
  assert(
    after.lists.path_mismatch.filter((r) => r.id === 1510).length === 0,
    "after unified fix: leave path_mismatch",
  );
}

// 5) Tree Engine 1508-style generator uses canonical when children given
{
  const row = {
    branch_key: "مزيد",
    name: extractSpell + "/مسلم",
    child_name: extractSpell + "/مسلم",
    parent: null,
    parent_name: null,
  };
  const blocked = Engine.previewFillParentFromName(row, []);
  assert(blocked.ok === false, "engine blocks fill when no father in empty list");
  const ok = Engine.previewFillParentFromName(row, [fatherRow]);
  assert(ok.ok === true, "engine fill ok with father present");
  assert(ok.after.parent === fatherPath, "engine uses canonical دوخي not دوخى");
  assert(ok.after.parent_person_id === fatherPid, "engine sets parent_person_id");
}

if (process.exitCode) {
  console.error("\nSome ping-pong assertions failed.");
  process.exit(1);
}
console.log("\nAll repair ping-pong checks passed.");
