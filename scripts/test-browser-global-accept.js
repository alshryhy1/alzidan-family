#!/usr/bin/env node
/**
 * Browser-like sandbox (no bare `global`) must not throw on Accept import.
 * Regression for: ReferenceError global is not defined → silent قبول failure.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function load(file, sandbox) {
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
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

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  window: {},
  globalThis: {},
  document: {
    getElementById: () => null,
    addEventListener() {},
    querySelector() {
      return null;
    },
  },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
// Intentionally omit `global` — classic browser script environment.

const root = path.join(__dirname, "..");
load(path.join(root, "assets/js/modules/canonical-person.js"), sandbox);
load(
  path.join(root, "assets/js/modules/family-management/family-person-core.js"),
  sandbox,
);
load(path.join(root, "assets/js/modules/tree-engine.js"), sandbox);
load(path.join(root, "assets/js/modules/request-actions.js"), sandbox);

assert(!!sandbox.AlzidanRequestActions, "request-actions loaded");
assert(!!sandbox.window.AlzidanTreeEngine, "tree-engine on window");

const TARGET = "a02b3514-4499-4c13-84d4-c3d3480c52a8";
const fatherPath = "زيدان بن مطلق بن زيدان/فايز/نزال/غازي/هاجس/محمد";
const wantChild = fatherPath + "/عبدالاله";
const db = [
  {
    id: 1,
    person_id: TARGET,
    parent_person_id: "x",
    parent_name: "زيدان بن مطلق بن زيدان/فايز/نزال/غازي/هاجس",
    parent: "زيدان بن مطلق بن زيدان/فايز/نزال/غازي/هاجس",
    child_name: fatherPath,
    name: fatherPath,
    branch_key: "زيدان",
  },
];

let inserted = null;
function makeSb() {
  return {
    from() {
      const api = {
        select() {
          return api;
        },
        eq() {
          return api;
        },
        ilike() {
          return api;
        },
        limit() {
          return api;
        },
        then(res) {
          return Promise.resolve({ data: db.slice(), error: null }).then(res);
        },
        catch(r) {
          return api.then(null, r);
        },
      };
      return api;
    },
    rpc(name, args) {
      if (name === "admin_tree_child_upsert_v1") {
        inserted = args && args.p_row;
        db.push({
          id: 99,
          person_id: "new-child",
          parent_person_id: inserted.parent_person_id,
          parent_name: inserted.parent_name,
          parent: inserted.parent_name,
          child_name: inserted.child_name,
          name: inserted.child_name,
          branch_key: "زيدان",
        });
        return Promise.resolve({ data: { ok: true }, error: null });
      }
      return Promise.resolve({
        data: null,
        error: { message: "unexpected " + name },
      });
    },
  };
}

const row = {
  request_id: "R1",
  status: "pending",
  branch_key: "زيدان",
  kind: "tree_card",
  message:
    "x\n\n__JSON__:\n" +
    JSON.stringify({
      v: 1,
      kind: "tree_card",
      branch_key: "زيدان",
      name: "عبدالاله",
      father: "محمد",
      father_path: fatherPath,
      father_person_id: TARGET,
      parent_person_id: TARGET,
      parent_node_id: fatherPath,
      tree_rows: [
        {
          branch_key: "زيدان",
          parent_name: fatherPath,
          child_name: wantChild,
          parent_person_id: TARGET,
        },
      ],
    }),
};

(async function main() {
  let buildThrew = null;
  let built;
  try {
    built = sandbox.AlzidanRequestActions.buildTreeCardRows(row);
  } catch (e) {
    buildThrew = e;
  }
  assert(!buildThrew, "buildTreeCardRows does not throw without bare global");
  assert(built && built.ok, "buildTreeCardRows ok");
  assert(
    built.rows[0].parent_person_id === TARGET,
    "built row keeps father UUID",
  );

  let importThrew = null;
  let result;
  try {
    result = await sandbox.AlzidanRequestActions.importTreeCardToTree(
      makeSb(),
      "tok",
      row,
    );
  } catch (e) {
    importThrew = e;
  }
  assert(!importThrew, "importTreeCardToTree does not throw without bare global");
  assert(result && result.ok, "importTreeCardToTree ok after browser fix");
  assert(
    inserted && inserted.parent_person_id === TARGET,
    "upsert received parent_person_id",
  );
  assert(
    inserted && inserted.child_name === wantChild,
    "upsert child under هاجس/محمد path",
  );

  if (failed) {
    console.error("\n" + failed + " browser-global accept check(s) failed");
    process.exit(1);
  }
  console.log("\nAll browser-global accept checks passed.");
})().catch(function (e) {
  console.error(e);
  process.exit(1);
});
