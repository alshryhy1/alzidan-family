#!/usr/bin/env node
"use strict";

/**
 * Live-shape fixtures:
 * - 1508: name/parent both use دوخى; father row 994 uses دوخي → not path_mismatch;
 *   forced path_mismatch analyze → spelling_equivalent (never empty After).
 * - 1602: truncated name سالم/عبيد/أحمد with valid parent→1508 → align name under father;
 *   never empty After / never flip-only dead end.
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

const father994 = {
  id: 994,
  branch_key: "مزيد",
  name: "مزيد بن مطلق بن زيدان/صلف/دوخي/سالم",
  child_name: "مزيد بن مطلق بن زيدان/صلف/دوخي/سالم",
  parent: "مزيد بن مطلق بن زيدان/صلف/دوخي",
  parent_name: "مزيد بن مطلق بن زيدان/صلف/دوخي",
  person_id: "51af1e12-40fb-40ff-96bf-e411b85138be",
};

const child1508 = {
  id: 1508,
  branch_key: "مزيد",
  name: "مزيد بن مطلق بن زيدان/صلف/دوخى/سالم/عبيد",
  child_name: "مزيد بن مطلق بن زيدان/صلف/دوخى/سالم/عبيد",
  parent: "مزيد بن مطلق بن زيدان/صلف/دوخى/سالم",
  parent_name: "مزيد بن مطلق بن زيدان/صلف/دوخى/سالم",
  person_id: "5fdff518-2769-4854-984c-fddc2bb31e79",
  parent_person_id: "51af1e12-40fb-40ff-96bf-e411b85138be",
};

const child1602 = {
  id: 1602,
  branch_key: "مزيد",
  name: "سالم/عبيد/أحمد",
  child_name: "سالم/عبيد/أحمد",
  parent: "مزيد بن مطلق بن زيدان/صلف/دوخى/سالم/عبيد",
  parent_name: "مزيد بن مطلق بن زيدان/صلف/دوخى/سالم/عبيد",
  person_id: "54ce8852-4f69-44ba-a6ae-085bb7560acd",
  parent_person_id: "5fdff518-2769-4854-984c-fddc2bb31e79",
};

const children = [father994, child1508, child1602];
const audit = Struct.auditTreeStructure(children, []);
const pmIds = (audit.lists.path_mismatch || []).map((r) => Number(r.id));
assert(!pmIds.includes(1508), "live 1508 leaves path_mismatch");
assert(pmIds.includes(1602), "live 1602 stays path_mismatch (truncated name)");
assert(
  !(audit.lists.missing_father || []).some((r) => Number(r.id) === 1508),
  "live 1508 not missing_father",
);

const forced1508 = {
  id: 1508,
  category: "path_mismatch",
  branch_key: "مزيد",
  child_path: child1508.name,
  parent: child1508.parent,
  parent_name: child1508.parent_name,
  stored_parent: child1508.parent_name,
  extracted_parent: Struct.extractParentFromName(child1508.name),
  parent_person_id: child1508.parent_person_id,
};
const a1508 = Pipe.analyzeIssue(forced1508, { children });
assert(
  a1508.repair_type === "spelling_equivalent_no_write",
  "forced 1508 → spelling_equivalent_no_write",
);
const p1508 = Pipe.previewRepair(a1508);
assert(p1508.after && p1508.after.unchanged, "1508 After not empty");
assert(p1508.after.parent, "1508 After keeps parent");
assert(p1508.would_flip_only === false, "1508 not flip-only");
assert(p1508.executable === false, "1508 spelling not SQL-executable");

const issue1602 = (audit.lists.path_mismatch || []).find(
  (r) => Number(r.id) === 1602,
);
assert(!!issue1602, "1602 issue present");
const a1602 = Pipe.analyzeIssue(issue1602, { children });
assert(
  a1602.repair_type === "align_name_to_parent_path",
  "1602 → align_name_to_parent_path",
);
assert(!!a1602.proposed, "1602 proposes name fix");
assert(
  a1602.proposed.child_path ===
    "مزيد بن مطلق بن زيدان/صلف/دوخى/سالم/عبيد/أحمد",
  "1602 new name under stored father",
);
assert(a1602.proposed.keep_parent === true, "1602 keeps parent");
assert(a1602.would_flip_only === false, "1602 not flip-only");

const p1602 = Pipe.previewRepair(a1602);
assert(p1602.after && p1602.after.child_path, "1602 After not empty");
assert(p1602.executable === true, "1602 executable");
assert(p1602.would_flip_only === false, "1602 preview not flip");
const sql1602 = Pipe.buildExecuteSql(p1602, { actor: "test" });
assert(sql1602.ok === true, "1602 builds SQL");
assert(/child_name/.test(sql1602.sql), "1602 SQL updates name");
assert(
  !/parent =/.test(sql1602.sql.split("SET")[1].split("WHERE")[0]),
  "1602 SQL does not set parent",
);
assert(/WHERE id = 1602/.test(sql1602.sql), "1602 SQL targets id");

// Classic spelling-only (name دوخى / parent دوخي) still no-write
const classicChild = {
  id: 1508,
  branch_key: "مزيد",
  name: "مزيد بن مطلق بن زيدان/صلف/دوخى/سالم/عبيد",
  child_name: "مزيد بن مطلق بن زيدان/صلف/دوخى/سالم/عبيد",
  parent: "مزيد بن مطلق بن زيدان/صلف/دوخي/سالم",
  parent_name: "مزيد بن مطلق بن زيدان/صلف/دوخي/سالم",
  person_id: "5fdff518-2769-4854-984c-fddc2bb31e79",
  parent_person_id: father994.person_id,
};
const classic = {
  id: 1508,
  category: "path_mismatch",
  branch_key: "مزيد",
  child_path: classicChild.name,
  parent: classicChild.parent,
  parent_name: classicChild.parent_name,
  stored_parent: classicChild.parent_name,
  extracted_parent: Struct.extractParentFromName(classicChild.name),
  parent_person_id: classicChild.parent_person_id,
};
const aClassic = Pipe.analyzeIssue(classic, {
  children: [father994, classicChild],
});
assert(
  aClassic.repair_type === "spelling_equivalent_no_write",
  "classic دوخى/دوخي → no write",
);
assert(
  aClassic.optional_align_name_path && aClassic.optional_align_name_path.ok,
  "classic offers optional unify spelling",
);

if (!process.exitCode) console.log("verify:live-1508-1602-path-fix OK");
