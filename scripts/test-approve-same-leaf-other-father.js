#!/usr/bin/env node
/**
 * Regression — approve must INSERT عبدالمجيد under هاجس/محمد UUID
 * even when another عبدالمجيد already exists under a different محمد.
 *
 * Simulates: حفظ التصحيح (father UUID stamped) → قبول (importTreeCardToTree).
 * Run: node scripts/test-approve-same-leaf-other-father.js
 */
"use strict";

const path = require("path");
const fs = require("fs");
const vm = require("vm");

function loadIife(filePath, sandbox) {
  const src = fs.readFileSync(filePath, "utf8");
  vm.runInNewContext(src, sandbox, { filename: filePath });
}

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  module: { exports: {} },
  exports: {},
  window: {},
  globalThis: {},
  document: { getElementById: () => null },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.global = sandbox;

loadIife(
  path.join(__dirname, "..", "assets/js/modules/canonical-person.js"),
  sandbox,
);
loadIife(
  path.join(
    __dirname,
    "..",
    "assets/js/modules/family-management/family-person-core.js",
  ),
  sandbox,
);
loadIife(
  path.join(__dirname, "..", "assets/js/modules/request-actions.js"),
  sandbox,
);

const RA = sandbox.AlzidanRequestActions;
const CP = sandbox.AlzidanCanonicalPerson;
const FM = sandbox.AlzidanFamilyPersonCore;

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error("FAIL:", msg);
  } else {
    console.log("OK:", msg);
  }
}

assert(!!RA && !!CP && !!FM, "modules loaded");

const TARGET_MOHAMMED = "a02b3514-4499-4c13-84d4-c3d3480c52a8";
const OTHER_MOHAMMED = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const OTHER_ABD = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const hajisPath = "زيدان بن مطلق بن زيدان/فايز/نزال/غازي/هاجس";
const targetMohammedPath = hajisPath + "/محمد";
const otherMohammedPath = "زيدان بن مطلق بن زيدان/آخر/محمد";
const otherAbdPath = otherMohammedPath + "/عبدالمجيد";
const wantChild = targetMohammedPath + "/عبدالمجيد";

const norm = (v) => String(v || "").replace(/\s+/g, " ").trim();
const leafFn = (p) => {
  const n = norm(p);
  const i = n.lastIndexOf("/");
  return i >= 0 ? n.slice(i + 1) : n;
};

assert(
  CP.parentNamesCompatible(targetMohammedPath, otherMohammedPath, norm, leafFn) ===
    false,
  "…/هاجس/محمد vs …/آخر/محمد are NOT compatible parents",
);
assert(
  CP.parentNamesCompatible("هاجس", hajisPath, norm, leafFn) === true,
  "leaf هاجس still matches full grandfather path",
);

let dbRows = [
  {
    id: 1,
    person_id: TARGET_MOHAMMED,
    parent_person_id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
    parent_name: hajisPath,
    parent: hajisPath,
    child_name: targetMohammedPath,
    name: targetMohammedPath,
    branch_key: "زيدان",
  },
  {
    id: 2,
    person_id: OTHER_MOHAMMED,
    parent_person_id: "",
    parent_name: "زيدان بن مطلق بن زيدان/آخر",
    parent: "زيدان بن مطلق بن زيدان/آخر",
    child_name: otherMohammedPath,
    name: otherMohammedPath,
    branch_key: "زيدان",
  },
  {
    id: 3,
    person_id: OTHER_ABD,
    parent_person_id: OTHER_MOHAMMED,
    parent_name: otherMohammedPath,
    parent: otherMohammedPath,
    child_name: otherAbdPath,
    name: otherAbdPath,
    branch_key: "زيدان",
  },
];

const pathToRow = FM.buildPathToRowIndex(dbRows, norm);

const noReuse = RA.resolveExistingTreeNode(pathToRow, {
  path: wantChild,
  leaf: "عبدالمجيد",
  parentPersonId: TARGET_MOHAMMED,
  parentPath: targetMohammedPath,
});
assert(noReuse.ok && !noReuse.found, "no reuse under هاجس/محمد UUID");

const noReuseByPathOnly = RA.resolveExistingTreeNode(pathToRow, {
  path: wantChild,
  leaf: "عبدالمجيد",
  parentPath: targetMohammedPath,
});
assert(
  noReuseByPathOnly.ok && !noReuseByPathOnly.found,
  "full parent path must not reuse عبدالمجيد under another محمد",
);

const stampedOtherPid = RA.resolveExistingTreeNode(pathToRow, {
  personId: OTHER_ABD,
  path: wantChild,
  leaf: "عبدالمجيد",
  parentPersonId: TARGET_MOHAMMED,
  parentPath: targetMohammedPath,
});
assert(
  stampedOtherPid.ok && !stampedOtherPid.found,
  "stamped person_id from other father must not force reuse",
);

const correctionPayload = {
  v: 1,
  kind: "tree_card",
  branch_key: "زيدان",
  name: "عبدالمجيد",
  father: "محمد",
  father_path: targetMohammedPath,
  father_person_id: TARGET_MOHAMMED,
  parent_person_id: TARGET_MOHAMMED,
  selected_parent_person_id: TARGET_MOHAMMED,
  parent_node_id: targetMohammedPath,
  ancestors: ["هاجس", "غازي", "نزال", "فايز"],
  tree_rows: [
    {
      branch_key: "زيدان",
      parent_name: targetMohammedPath,
      child_name: wantChild,
      parent_person_id: TARGET_MOHAMMED,
    },
  ],
};
const built = RA.buildTreeCardRows({
  message:
    "طلب\n\n__JSON__:\n" + JSON.stringify(correctionPayload, null, 2),
  branch_key: "زيدان",
});
assert(built.ok && built.rows.length === 1, "buildTreeCardRows after save");
assert(
  built.rows[0].parent_person_id === TARGET_MOHAMMED,
  "built son edge carries a02b3514… parent_person_id",
);

const rpcCalls = [];
function makeSelectApi(initialFilters) {
  const state = { filters: Object.assign({}, initialFilters || {}), limitN: 5000 };
  const api = {
    select() {
      return api;
    },
    eq(k, v) {
      state.filters[k] = v;
      return api;
    },
    limit(n) {
      state.limitN = n;
      let data = dbRows.slice();
      Object.keys(state.filters).forEach((k) => {
        data = data.filter((r) => String(r[k] || "") === String(state.filters[k]));
      });
      return Promise.resolve({ data: data.slice(0, state.limitN), error: null });
    },
  };
  return api;
}

const fakeSb = {
  from(table) {
    assert(table === "tree_children", "only tree_children queried");
    return {
      select() {
        return makeSelectApi({});
      },
    };
  },
  rpc(name, args) {
    rpcCalls.push({ name, args });
    if (name === "admin_tree_child_upsert_v1") {
      const row = args.p_row || {};
      const id = dbRows.length + 1;
      const inserted = {
        id,
        person_id: "new-abd-" + id,
        parent_person_id: row.parent_person_id,
        parent_name: row.parent_name,
        parent: row.parent_name,
        child_name: row.child_name,
        name: row.child_name,
        branch_key: row.branch_key,
      };
      dbRows.push(inserted);
      return Promise.resolve({ data: { ok: true, id }, error: null });
    }
    if (name === "admin_tree_children_import_v1") {
      return Promise.resolve({
        data: null,
        error: { message: "import should not be primary for this case" },
      });
    }
    return Promise.resolve({
      data: null,
      error: { message: "unexpected rpc " + name },
    });
  },
};

const reqRow = {
  request_id: "REQ-ABD-HAJIS",
  branch_key: "زيدان",
  status: "pending",
  kind: "tree_card",
  message:
    "طلب إضافة\n\n__JSON__:\n" + JSON.stringify(correctionPayload, null, 2),
};

RA.importTreeCardToTree(fakeSb, "token", reqRow)
  .then((result) => {
    assert(result.ok, "importTreeCardToTree ok: " + (result.message || result.code || ""));
    assert(result.inserted >= 1, "inserted >= 1 (new child row)");
    assert(
      rpcCalls.some((c) => c.name === "admin_tree_child_upsert_v1"),
      "approve write uses admin_tree_child_upsert_v1",
    );
    const upsertRow =
      rpcCalls.find((c) => c.name === "admin_tree_child_upsert_v1") &&
      rpcCalls.find((c) => c.name === "admin_tree_child_upsert_v1").args.p_row;
    assert(
      upsertRow && upsertRow.parent_person_id === TARGET_MOHAMMED,
      "upsert parent_person_id is a02b3514-4499-4c13-84d4-c3d3480c52a8",
    );
    assert(
      upsertRow && upsertRow.parent_name === targetMohammedPath,
      "upsert parent_name is …/هاجس/محمد",
    );
    assert(
      upsertRow && String(upsertRow.child_name).endsWith("/عبدالمجيد"),
      "upsert child_name ends with /عبدالمجيد",
    );

    const underTarget = dbRows.filter(
      (r) =>
        String(r.parent_person_id) === TARGET_MOHAMMED &&
        String(r.child_name || "").endsWith("/عبدالمجيد"),
    );
    assert(underTarget.length === 1, "DB has عبدالمجيد under target محمد UUID");
    assert(
      underTarget[0].parent_name === targetMohammedPath,
      "new row path parent is …/هاجس/محمد",
    );
    assert(
      dbRows.find((r) => r.id === 3).parent_person_id === OTHER_MOHAMMED,
      "other-branch عبدالمجيد row left untouched",
    );

    // TREE-003 still enforced for missing father UUID
    const noFather = RA.buildTreeCardRows({
      message:
        "طلب\n\n__JSON__:\n" +
        JSON.stringify(
          {
            v: 1,
            kind: "tree_card",
            branch_key: "زيدان",
            name: "عبدالمجيد",
            father: "محمد",
            tree_rows: [
              {
                parent_name: "محمد",
                child_name: "عبدالمجيد",
              },
            ],
          },
          null,
          2,
        ),
      branch_key: "زيدان",
    });
    assert(
      !noFather.ok && noFather.code === "TREE-003",
      "TREE-003 still blocks missing parent_person_id",
    );

    if (failed) {
      console.error("\nApprove same-leaf other-father FAILED:", failed);
      process.exit(1);
    }
    console.log("\nApprove same-leaf other-father PASSED");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
