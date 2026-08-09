#!/usr/bin/env node
"use strict";

/**
 * Generalized «يحتاج ربط UUID» diagnosis + UUID-only repair proposal.
 * Covers ALL such rows (path/Tree Engine resolution — not one-off 1738–1740).
 */

const path = require("path");
const fs = require("fs");
const vm = require("vm");

function loadModule(rel) {
  const src = fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
  const ctx = {
    window: {},
    console,
    module: { exports: {} },
    exports: {},
  };
  ctx.globalThis = ctx;
  ctx.window = ctx;
  vm.runInNewContext(src, ctx, { filename: rel });
  return ctx.module.exports || ctx.window.AlzidanIntegrityTreeStructure || ctx;
}

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("ok:", msg);
  }
}

const Struct = loadModule("assets/js/modules/integrity-tree-structure-audit.js");
const Tree003Src = fs.readFileSync(
  path.join(__dirname, "..", "assets/js/modules/integrity-tree003-v2.js"),
  "utf8",
);
const PipeSrc = fs.readFileSync(
  path.join(__dirname, "..", "assets/js/modules/integrity-repair-pipeline.js"),
  "utf8",
);
const EngineSrc = fs.readFileSync(
  path.join(__dirname, "..", "assets/js/modules/tree-engine.js"),
  "utf8",
);

const shared = {
  console,
  module: { exports: {} },
  exports: {},
};
shared.globalThis = shared;
shared.window = shared;
shared.AlzidanIntegrityTreeStructure = Struct;
vm.runInNewContext(EngineSrc, shared, { filename: "tree-engine.js" });
vm.runInNewContext(Tree003Src, shared, { filename: "integrity-tree003-v2.js" });
vm.runInNewContext(PipeSrc, shared, { filename: "integrity-repair-pipeline.js" });

const Tree003 = shared.AlzidanIntegrityTree003V2;
const Pipe = shared.AlzidanIntegrityRepairPipeline;
const Engine = shared.AlzidanTreeEngine;

const fatherPid = "ffffffff-1111-1111-1111-111111111111";
const childPid = "cccccccc-2222-2222-2222-222222222222";
const otherMohammadPid = "mmmmmmmm-3333-3333-3333-333333333333";

const father = {
  id: 100,
  branch_key: "مزيد",
  name: "مزيد بن مطلق بن زيدان/صلف/دوخي",
  child_name: "مزيد بن مطلق بن زيدان/صلف/دوخي",
  parent: "مزيد بن مطلق بن زيدان/صلف",
  parent_name: "مزيد بن مطلق بن زيدان/صلف",
  person_id: fatherPid,
};

const childNeedsUuid = {
  id: 200,
  branch_key: "مزيد",
  name: "مزيد بن مطلق بن زيدان/صلف/دوخي/سالم",
  child_name: "مزيد بن مطلق بن زيدان/صلف/دوخي/سالم",
  parent: "مزيد بن مطلق بن زيدان/صلف/دوخي",
  parent_name: "مزيد بن مطلق بن زيدان/صلف/دوخي",
  person_id: childPid,
  parent_person_id: null,
};

const mohammadA = {
  id: 301,
  branch_key: "مزيد",
  name: "مزيد بن مطلق بن زيدان/صلف/محمد",
  child_name: "مزيد بن مطلق بن زيدان/صلف/محمد",
  parent: "مزيد بن مطلق بن زيدان/صلف",
  parent_name: "مزيد بن مطلق بن زيدان/صلف",
  person_id: otherMohammadPid,
};

const mohammadB = {
  id: 302,
  branch_key: "مزيد",
  name: "مزيد بن مطلق بن زيدان/زيد/محمد",
  child_name: "مزيد بن مطلق بن زيدان/زيد/محمد",
  parent: "مزيد بن مطلق بن زيدان/زيد",
  parent_name: "مزيد بن مطلق بن زيدان/زيد",
  person_id: "bbbbbbbb-4444-4444-4444-444444444444",
};

const ambiguousChild = {
  id: 303,
  branch_key: "مزيد",
  name: "ولد/محمد",
  child_name: "ولد/محمد",
  parent: "محمد",
  parent_name: "محمد",
  person_id: "aaaaaaaa-5555-5555-5555-555555555555",
  parent_person_id: null,
};

const orphan = {
  id: 400,
  branch_key: "مزيد",
  name: "مزيد بن مطلق بن زيدان/صلف/شبح/ولد",
  child_name: "مزيد بن مطلق بن زيدان/صلف/شبح/ولد",
  parent: "مزيد بن مطلق بن زيدان/صلف/شبح",
  parent_name: "مزيد بن مطلق بن زيدان/صلف/شبح",
  person_id: "orphan-pid",
  parent_person_id: null,
};

// --- Structure helper: path strip preferred ---
const res = Struct.resolveExpectedFatherForUuidLink(childNeedsUuid, [
  father,
  childNeedsUuid,
]);
assert(res.status === "found", "helper finds father for needs-UUID child");
assert(res.person_id === fatherPid, "helper returns father person_id");
assert(
  /دوخي$/.test(res.expected_parent_path),
  "helper expected path ends with دوخي",
);
assert(res.method === "name_path_strip", "prefers name path strip");

// --- TREE-003 classify: needs UUID when father exists ---
const report = Tree003.classifyAll([father, childNeedsUuid], []);
const warn200 = (report.warnings || []).find((w) => Number(w.id) === 200);
assert(!!warn200, "id 200 in UUID warnings");
assert(warn200.reason_ar === "يحتاج ربط UUID", "200 reason يحتاج ربط UUID");
assert(
  warn200.father_person_id_to_link === fatherPid,
  "200 attaches father_person_id_to_link",
);
assert(
  Number(warn200.found_father_id) === 100,
  "200 found_father_id is father row",
);

// --- Missing father → review, NOT uuid warn ---
const missReport = Tree003.classifyAll([father, orphan], []);
assert(
  !(missReport.warnings || []).some((w) => Number(w.id) === 400),
  "orphan not in UUID warnings",
);
const rev400 = (missReport.reviews || []).find((r) => Number(r.id) === 400);
assert(!!rev400, "orphan in reviews");
assert(rev400.reason_ar === "الأب غير موجود", "orphan «الأب غير موجود»");

// --- Ambiguous leaf محمد → review, no auto link ---
const ambReport = Tree003.classifyAll(
  [mohammadA, mohammadB, ambiguousChild],
  [],
);
assert(
  !(ambReport.warnings || []).some((w) => Number(w.id) === 303),
  "ambiguous not UUID-warn",
);
const rev303 = (ambReport.reviews || []).find((r) => Number(r.id) === 303);
assert(!!rev303, "ambiguous in reviews");
assert(/غامض/.test(rev303.reason_ar || ""), "ambiguous Arabic reason");

// --- 1738–1740 style: valid UUID → not missing / not UUID-warn ---
const nadaPid = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const tuaisanPid = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const hamadPid = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const mohammadPid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const nada = {
  id: 1700,
  branch_key: "مزيد",
  name: "نداء",
  child_name: "نداء",
  parent: "مزيد",
  parent_name: "مزيد",
  person_id: nadaPid,
};
const tuaisan = {
  id: 1740,
  branch_key: "مزيد",
  name: "طعيسان/نداء",
  child_name: "طعيسان/نداء",
  parent: "طعيسان",
  parent_name: "طعيسان",
  person_id: tuaisanPid,
  parent_person_id: nadaPid,
};
const hamad = {
  id: 1739,
  branch_key: "مزيد",
  name: "حمد/طعيسان",
  child_name: "حمد/طعيسان",
  parent: "حمد",
  parent_name: "حمد",
  person_id: hamadPid,
  parent_person_id: tuaisanPid,
};
const mohammad = {
  id: 1738,
  branch_key: "مزيد",
  name: "محمد/حمد",
  child_name: "محمد/حمد",
  parent: "محمد",
  parent_name: "محمد",
  person_id: mohammadPid,
  parent_person_id: hamadPid,
};
const chain = [nada, tuaisan, hamad, mohammad];
const chain003 = Tree003.classifyAll(chain, []);
assert(
  !(chain003.warnings || []).some((w) => [1738, 1739, 1740].includes(Number(w.id))),
  "1738–1740 not UUID-warn when linked",
);
assert(
  !(chain003.reviews || []).some((r) => [1738, 1739, 1740].includes(Number(r.id))),
  "1738–1740 not «أب غير موجود» when UUID valid",
);
const structChain = Struct.auditTreeStructure(chain, []);
assert(
  !(structChain.lists.missing_father || []).some((r) =>
    [1738, 1739, 1740].includes(Number(r.id)),
  ),
  "structure: 1738–1740 not missing_father",
);

// --- Repair pipeline: propose UUID-only SQL for ALL such rows ---
const issue = Object.assign({}, warn200, {
  category: "TREE-003-warn",
  category_ar: "يحتاج ربط UUID",
  stored_parent: childNeedsUuid.parent_name,
  parent: childNeedsUuid.parent,
  parent_name: childNeedsUuid.parent_name,
});
const analysis = Pipe.analyzeIssue(issue, {
  children: [father, childNeedsUuid],
});
assert(analysis.repair_type === "link_parent_uuid", "repair_type link_parent_uuid");
assert(analysis.can_auto_propose === true, "can auto propose when father found");
assert(
  analysis.proposed && analysis.proposed.parent_person_id === fatherPid,
  "proposed parent_person_id = father",
);
assert(
  analysis.proposed.parent === childNeedsUuid.parent ||
    analysis.proposed.keep_names === true,
  "names kept / keep_names",
);
assert(
  analysis.found_father_id === 100,
  "analysis found_father_id",
);
assert(
  analysis.father_person_id_to_link === fatherPid,
  "analysis father_person_id_to_link",
);

const preview = Pipe.previewRepair(analysis, null);
assert(preview.executable === true, "preview executable");
assert(preview.uuid_only === true, "preview uuid_only");
const built = Pipe.buildExecuteSql(preview, { actor: "test", reason: "uuid link" });
assert(built.ok === true, "buildExecuteSql ok");
assert(
  /SET\s*\n?\s*parent_person_id\s*=/i.test(built.sql) ||
    /SET\n\s*parent_person_id\s*=/.test(built.sql),
  "SQL sets parent_person_id",
);
assert(!/\bparent\s*=/.test(built.sql.replace(/parent_person_id/g, "")), "SQL does not set parent");
assert(!/\bchild_name\s*=/.test(built.sql), "SQL does not set child_name");
assert(!/\bname\s*=/.test(built.sql), "SQL does not set name");
assert(built.sql.indexOf("WHERE id = 200") >= 0, "SQL targets id 200");

// Engine preview also resolves
const eng = Engine.previewLinkParentUuid(childNeedsUuid, null, [
  father,
  childNeedsUuid,
]);
assert(eng.ok === true, "TreeEngine previewLinkParentUuid ok");
assert(eng.after.parent_person_id === fatherPid, "engine links father uuid");

// Missing father → no repair propose
const missIssue = {
  id: 400,
  branch_key: "مزيد",
  child_path: orphan.child_name,
  parent_key: orphan.parent,
  stored_parent: orphan.parent,
  parent: orphan.parent,
  parent_name: orphan.parent_name,
  category: "TREE-003-warn",
  code: "TREE-003-warn",
  issue: "needs_uuid_link",
};
const missAnalysis = Pipe.analyzeIssue(missIssue, { children: [father, orphan] });
assert(
  missAnalysis.can_auto_propose === false,
  "missing father: no auto propose",
);
assert(
  missAnalysis.repair_type === "manual_review" || !missAnalysis.proposed,
  "missing father: no UUID propose",
);
assert(
  (missAnalysis.decision_logic_ar || []).some((l) => /غير موجود/.test(l)),
  "missing father decision mentions غير موجود",
);

if (process.exitCode) {
  console.error("\nverify:uuid-link-diagnosis FAILED");
  process.exit(1);
}
console.log("\nverify:uuid-link-diagnosis passed");
