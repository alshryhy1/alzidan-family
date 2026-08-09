#!/usr/bin/env node
"use strict";

/**
 * Regression: path_mismatch must use Arabic normalize (دوخي↔دوخى, فضى↔فضي).
 * Aligning parent to extracted-with-wrong-spelling orphans the real father row.
 */

const path = require("path");
const fs = require("fs");
const vm = require("vm");

function loadModule(rel, globals) {
  const src = fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
  const ctx = Object.assign(
    { window: {}, console, module: { exports: {} }, exports: {} },
    globals || {},
  );
  ctx.globalThis = ctx;
  ctx.window = ctx;
  vm.runInNewContext(src, ctx, { filename: rel });
  return ctx.module.exports;
}

const Struct = loadModule("assets/js/modules/integrity-tree-structure-audit.js");
const Pipe = loadModule("assets/js/modules/integrity-repair-pipeline.js", {
  AlzidanIntegrityTreeStructure: Struct,
});

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("ok:", msg);
  }
}

const father = {
  id: 994,
  branch_key: "مزيد",
  name: "مزيد بن مطلق بن زيدان/صلف/دوخي/سالم",
  child_name: "مزيد بن مطلق بن زيدان/صلف/دوخي/سالم",
  parent: "مزيد بن مطلق بن زيدان/صلف/دوخي",
  parent_name: "مزيد بن مطلق بن زيدان/صلف/دوخي",
  person_id: "father-uuid",
};

const child1508 = {
  id: 1508,
  branch_key: "مزيد",
  name: "مزيد بن مطلق بن زيدان/صلف/دوخى/سالم/عبيد",
  child_name: "مزيد بن مطلق بن زيدان/صلف/دوخى/سالم/عبيد",
  parent: "مزيد بن مطلق بن زيدان/صلف/دوخي/سالم",
  parent_name: "مزيد بن مطلق بن زيدان/صلف/دوخي/سالم",
  person_id: "child-uuid",
  parent_person_id: "father-uuid",
};

const child1551 = {
  id: 1551,
  branch_key: "زيدان",
  name: "زيدان بن مطلق بن زيدان/فايز/نزال/غازي/فضى/فريح/فضي",
  child_name: "زيدان بن مطلق بن زيدان/فايز/نزال/غازي/فضى/فريح/فضي",
  parent: "زيدان بن مطلق بن زيدان/فايز/نزال/غازي/فضي/فريح",
  parent_name: "زيدان بن مطلق بن زيدان/فايز/نزال/غازي/فضي/فريح",
  person_id: "c1551",
};

const father1551 = {
  id: 9001,
  branch_key: "زيدان",
  name: "زيدان بن مطلق بن زيدان/فايز/نزال/غازي/فضي/فريح",
  child_name: "زيدان بن مطلق بن زيدان/فايز/نزال/غازي/فضي/فريح",
  parent: "زيدان بن مطلق بن زيدان/فايز/نزال/غازي/فضي",
  parent_name: "زيدان بن مطلق بن زيدان/فايز/نزال/غازي/فضي",
  person_id: "f1551",
};

const realMismatch = {
  id: 9999,
  branch_key: "مزيد",
  name: "مزيد بن مطلق بن زيدان/صلف/دوخي/سالم/عبيد/ولد",
  child_name: "مزيد بن مطلق بن زيدان/صلف/دوخي/سالم/عبيد/ولد",
  parent: "مزيد بن مطلق بن زيدان/خميس",
  parent_name: "مزيد بن مطلق بن زيدان/خميس",
  person_id: "mismatch",
};

assert(
  Struct.pathsEqual(
    "مزيد بن مطلق بن زيدان/صلف/دوخى/سالم",
    "مزيد بن مطلق بن زيدان/صلف/دوخي/سالم",
  ),
  "pathsEqual دوخى ↔ دوخي",
);

const audit = Struct.auditTreeStructure(
  [father, child1508, father1551, child1551, realMismatch],
  [],
);
const pmIds = (audit.lists.path_mismatch || []).map((r) => Number(r.id));
assert(!pmIds.includes(1508), "1508 spelling-only must leave path_mismatch");
assert(!pmIds.includes(1551), "1551 فضى/فضي must leave path_mismatch");
assert(pmIds.includes(9999), "real wrong parent still path_mismatch");

const miss = Struct.auditTreeStructure([father, child1508], []);
const missIds = (miss.lists.missing_father || []).map((r) => Number(r.id));
assert(!missIds.includes(1508), "1508 not missing_father (parent ي = father row)");
assert(
  miss.totals.path_mismatch === 0,
  "1508 alone: zero path_mismatch after normalize",
);

const issue = {
  id: 1508,
  category: "path_mismatch",
  branch_key: "مزيد",
  child_path: child1508.name,
  parent: child1508.parent,
  parent_name: child1508.parent_name,
  stored_parent: child1508.parent_name,
  extracted_parent: "مزيد بن مطلق بن زيدان/صلف/دوخى/سالم",
};
const analysis = Pipe.analyzeIssue(issue, { children: [father, child1508] });
assert(
  analysis.repair_type === "spelling_equivalent_no_write",
  "spell-only → no write repair",
);
assert(!analysis.proposed, "spell-only proposes nothing on parent");
assert(analysis.would_flip_only === false, "spell-only must not flip-only");
assert(
  /إملائي فقط/.test(String(analysis.resolved_message_ar || "")),
  "spell-only Arabic resolved message",
);
const preview = Pipe.previewRepair(analysis);
assert(preview.executable === false, "spell-only not executable");
assert(preview.would_flip_only === false, "preview not flip-only");
assert(
  preview.after && preview.after.unchanged,
  "spell-only After shows unchanged parent (not empty)",
);
const built = Pipe.buildExecuteSql(preview, { actor: "test" });
assert(built.ok === false, "spell-only blocks SQL");
assert(/إملائي فقط/.test(String(built.message_ar || "")), "SQL block uses resolved msg");

const align = Pipe.buildAlignNamePathSpelling(issue, [father, child1508]);
assert(align && align.ok, "optional align name path available");
assert(
  align.child_path.indexOf("دوخي") >= 0 && align.child_path.indexOf("/عبيد") >= 0,
  "align rewrites ancestor spelling only",
);
const adopted = Pipe.adoptAlignNamePathSpelling(analysis);
assert(adopted.ok, "adopt align path");
const alignPreview = Pipe.previewRepair(adopted.analysis);
assert(alignPreview.executable === true, "align path executable");
const alignSql = Pipe.buildExecuteSql(alignPreview, { actor: "test" });
assert(alignSql.ok === true, "align path builds SQL");
assert(/child_name/.test(alignSql.sql), "align SQL updates name");
assert(!/parent =/.test(alignSql.sql.split("SET")[1].split("WHERE")[0]), "align SQL does not set parent");

const realIssue = {
  id: 9999,
  category: "path_mismatch",
  branch_key: "مزيد",
  child_path: realMismatch.name,
  parent: realMismatch.parent,
  parent_name: realMismatch.parent_name,
  stored_parent: realMismatch.parent_name,
  extracted_parent: Struct.extractParentFromName(realMismatch.name),
};
const realAnalysis = Pipe.analyzeIssue(realIssue, {
  children: [father, child1508, realMismatch],
});
assert(!!realAnalysis.proposed, "real mismatch still proposes");
assert(
  realAnalysis.proposed.parent === realAnalysis.proposed.parent_name,
  "proposed dual columns match",
);
const realSql = Pipe.buildExecuteSql(Pipe.previewRepair(realAnalysis), {
  actor: "test",
});
assert(realSql.ok === true, "real mismatch builds SQL");
assert(
  realSql.sql.indexOf("WHERE id = 9999") >= 0,
  "SQL targets row id",
);

if (!process.exitCode) console.log("verify:path-mismatch-normalize OK");
