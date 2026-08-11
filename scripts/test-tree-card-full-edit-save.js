#!/usr/bin/env node
/**
 * Regression: Full Edit («تعديل كامل») → «حفظ التصحيح» for pending tree_card.
 *
 * Proves:
 * 1) With father UUID bound, save calls admin_update_request_branch_v1 with
 *    name + father_person_id / parent_person_id stamped (no tree_children insert).
 * 2) Auto-resolve fail/seed must NOT clear a father the admin already selected
 *    (race that broke Save after «تغيير الأب»).
 *
 * Run: node scripts/test-tree-card-full-edit-save.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const TARGET_PID = "a02b3514-4499-4c13-84d4-c3d3480c52a8";
const TARGET_PATH = "زيدان بن مطلق بن زيدان/فايز/نزال/غازي/هاجس/محمد";

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error("FAIL:", msg);
  } else {
    console.log("OK:", msg);
  }
}

function makeDom() {
  const elements = {};
  function el(tag, attrs) {
    attrs = attrs || {};
    const o = {
      tagName: String(tag || "div").toUpperCase(),
      id: attrs.id || "",
      name: attrs.name || "",
      value: attrs.value || "",
      placeholder: "",
      style: { display: "" },
      classList: {
        add: function () {},
        remove: function () {},
        contains: function () {
          return false;
        },
      },
      innerHTML: "",
      textContent: "",
      open: false,
      _listeners: {},
      addEventListener: function (t, fn) {
        (this._listeners[t] = this._listeners[t] || []).push(fn);
      },
      dispatchEvent: function (ev) {
        (this._listeners[ev.type] || []).forEach(function (f) {
          f(ev);
        });
        return true;
      },
      querySelector: function (sel) {
        if (sel === 'button[type="submit"]') return el("button");
        if (sel === "#edit-card-person-name") return fields.personName;
        return null;
      },
      querySelectorAll: function () {
        return [];
      },
      getAttribute: function () {
        return null;
      },
      setAttribute: function () {},
      focus: function () {
        this.dispatchEvent({ type: "focus", preventDefault: function () {} });
      },
      showModal: function () {
        this.open = true;
      },
      close: function () {
        this.open = false;
      },
      contains: function () {
        return false;
      },
    };
    if (attrs.id) elements[attrs.id] = o;
    return o;
  }
  const fields = {};
  function field(name, id, v) {
    const e = el("input", { id: id, name: name });
    e.value = v || "";
    fields[name] = e;
    elements[id] = e;
    return e;
  }
  const idMap = {
    branch: "edit-card-branch",
    personName: "edit-card-person-name",
    fatherPath: "edit-card-father-path",
    fatherPersonId: "edit-card-father-person-id",
    fatherLabel: "edit-card-father-label",
    grandfather1: "edit-card-gf1",
    grandfather2: "edit-card-gf2",
    grandfather3: "edit-card-gf3",
    grandfather4: "edit-card-gf4",
    birthDate: "edit-card-dob",
    city: "edit-card-city",
    area: "edit-card-area",
    submitterName: "edit-card-submitter-name",
    submitterPhone: "edit-card-submitter-phone",
    submitterEmail: "edit-card-submitter-email",
    fatherSearch: "edit-card-father-search",
  };
  Object.keys(idMap).forEach(function (n) {
    let v = "";
    if (n === "branch") v = "زيدان";
    if (n === "personName") v = "عبدالاله";
    if (n === "submitterName") v = "مرسل";
    if (n === "submitterPhone") v = "0500000000";
    field(n, idMap[n], v);
  });
  const form = el("form", { id: "tree-card-edit-form" });
  form.elements = fields;
  elements["tree-card-edit-form"] = form;
  elements["tree-card-edit-dialog"] = el("dialog", {
    id: "tree-card-edit-dialog",
  });
  elements["tree-card-edit-error"] = el("div", { id: "tree-card-edit-error" });
  elements["tree-card-edit-cancel"] = el("button", {
    id: "tree-card-edit-cancel",
  });
  elements["edit-card-father-current"] = el("div", {
    id: "edit-card-father-current",
  });
  elements["edit-card-father-results"] = el("div", {
    id: "edit-card-father-results",
  });
  elements["edit-card-father-search-wrap"] = el("div", {
    id: "edit-card-father-search-wrap",
  });
  elements["edit-card-father-change"] = el("button", {
    id: "edit-card-father-change",
  });
  elements["edit-card-father-clear"] = el("button", {
    id: "edit-card-father-clear",
  });
  elements["edit-card-original-review"] = el("div", {
    id: "edit-card-original-review",
  });
  return {
    document: {
      getElementById: function (id) {
        return elements[id] || null;
      },
      addEventListener: function () {},
      createElement: function (t) {
        return el(t);
      },
      querySelector: function () {
        return null;
      },
    },
    fields: fields,
    form: form,
  };
}

function loadModule(dom, mockSb) {
  const windowObj = {
    document: dom.document,
    console: console,
    AlzidanAdminCore: {
      showAlert: function () {},
      getClient: function () {
        return mockSb;
      },
      getAdminToken: function () {
        return "tok";
      },
      formatDateTimeArSaVerbose: function (d) {
        return String(d || "");
      },
      coerceRpcId: function (v) {
        return String(v || "");
      },
      isLikelyEmail: function () {
        return true;
      },
      normalizeEmail: function (v) {
        return String(v || "")
          .trim()
          .toLowerCase();
      },
    },
    AlzidanFamilyPersonCore: {
      buildPersonNameIlikeOrFilter: function (q) {
        return "child_name.ilike.%" + q + "%";
      },
      arabicSearchQueryVariants: function (q) {
        return [String(q || "").trim()].filter(Boolean);
      },
    },
    Event: function (t) {
      this.type = t;
      this.preventDefault = function () {};
    },
  };
  windowObj.window = windowObj;
  const sandbox = {
    window: windowObj,
    document: dom.document,
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    module: { exports: {} },
    exports: {},
    globalThis: windowObj,
    global: windowObj,
    Event: windowObj.Event,
  };
  vm.runInNewContext(
    fs.readFileSync(
      path.join(__dirname, "..", "assets/js/modules/request-actions.js"),
      "utf8",
    ),
    sandbox,
    { filename: "request-actions.js" },
  );
  return windowObj.AlzidanRequestActions;
}

function makeSb(rpcCalls, opts) {
  opts = opts || {};
  const delayMs = opts.autoResolveDelayMs || 0;
  const emptyForAuto = opts.emptyForAutoResolve !== false;
  return {
    from: function () {
      const b = {
        _eq: {},
        select: function () {
          return this;
        },
        eq: function (k, v) {
          this._eq[k] = v;
          return this;
        },
        or: function () {
          return this;
        },
        limit: function () {
          return this;
        },
        then: function (ok, bad) {
          const self = this;
          const run = function () {
            const pid = self._eq.person_id;
            const child = self._eq.child_name;
            const name = self._eq.name;
            if (pid === TARGET_PID || child === TARGET_PATH || name === TARGET_PATH) {
              return {
                data: [
                  {
                    person_id: TARGET_PID,
                    child_name: TARGET_PATH,
                    name: TARGET_PATH,
                    branch_key: "زيدان",
                    parent_name: "زيدان بن مطلق بن زيدان/فايز/نزال/غازي/هاجس",
                  },
                ],
                error: null,
              };
            }
            // Empty → auto-resolve fails for text-only father (race test).
            if (emptyForAuto) return { data: [], error: null };
            return { data: [], error: null };
          };
          if (delayMs > 0) {
            return new Promise(function (resolve) {
              setTimeout(function () {
                resolve(run());
              }, delayMs);
            }).then(ok, bad);
          }
          return Promise.resolve(run()).then(ok, bad);
        },
      };
      return b;
    },
    rpc: function (name, args) {
      rpcCalls.push({ name: name, args: args });
      return Promise.resolve({ data: true, error: null });
    },
  };
}

function sleep(ms) {
  return new Promise(function (r) {
    setTimeout(r, ms);
  });
}

async function testHappySave() {
  const rpcCalls = [];
  const dom = makeDom();
  const sb = makeSb(rpcCalls, { autoResolveDelayMs: 0 });
  // Force verify path to see TARGET by answering person_id lookups.
  const RA = loadModule(dom, sb);
  const payload = {
    v: 1,
    kind: "tree_card",
    branch_key: "زيدان",
    name: "عبدالاله",
    father: "محمد",
    submitter: { name: "مرسل", phone: "0500000000", email: "" },
    created_at: new Date().toISOString(),
  };
  const row = {
    id: "req-1",
    request_id: "req-1",
    status: "pending",
    kind: "tree_card",
    branch_key: "زيدان",
    message: "بطاقة\n\n__JSON__:\n" + JSON.stringify(payload),
  };
  RA.openTreeCardEditor(row);
  await sleep(30);
  dom.fields.fatherPath.value = TARGET_PATH;
  dom.fields.fatherPersonId.value = TARGET_PID;
  dom.fields.fatherLabel.value = "محمد";
  dom.fields.personName.value = "عبدالاله";
  await dom.form._listeners.submit[0]({
    preventDefault: function () {},
    type: "submit",
  });
  if (!rpcCalls.length) {
    console.error(
      "happy save error UI:",
      dom.document.getElementById("tree-card-edit-error").textContent,
      "pid=",
      dom.fields.fatherPersonId.value,
      "path=",
      dom.fields.fatherPath.value,
    );
  }
  assert(rpcCalls.length === 1, "happy: RPC called once");
  if (!rpcCalls[0]) return;
  assert(
    rpcCalls[0].name === "admin_update_request_branch_v1",
    "happy: correct RPC name",
  );
  const msg = rpcCalls[0].args.p_message || "";
  const json = JSON.parse(msg.slice(msg.indexOf("__JSON__:") + 9).trim());
  assert(json.name === "عبدالاله", "happy: payload.name");
  assert(
    json.father_person_id === TARGET_PID,
    "happy: payload.father_person_id",
  );
  assert(
    json.parent_person_id === TARGET_PID,
    "happy: payload.parent_person_id",
  );
  assert(
    json.tree_rows &&
      json.tree_rows[0] &&
      json.tree_rows[0].parent_person_id === TARGET_PID,
    "happy: tree_rows parent_person_id",
  );
  assert(
    Array.isArray(rpcCalls[0].args.p_new_tree_rows) &&
      rpcCalls[0].args.p_new_tree_rows[0].parent_person_id === TARGET_PID,
    "happy: p_new_tree_rows stamped",
  );
  assert(
    Array.isArray(rpcCalls[0].args.p_old_tree_rows) &&
      rpcCalls[0].args.p_old_tree_rows.length === 0,
    "happy: pending skips old tree rows (no TREE-003 block)",
  );
}

async function testAutoResolveDoesNotClearManualPick() {
  const rpcCalls = [];
  const dom = makeDom();
  // Slow empty lookups → auto-resolve fails after admin already picked.
  const sb = makeSb(rpcCalls, { autoResolveDelayMs: 80 });
  const RA = loadModule(dom, sb);
  const payload = {
    v: 1,
    kind: "tree_card",
    branch_key: "زيدان",
    name: "عبدالاله",
    father: "محمد",
    submitter: { name: "مرسل", phone: "0500000000", email: "" },
    created_at: new Date().toISOString(),
  };
  const row = {
    id: "req-2",
    request_id: "req-2",
    status: "pending",
    kind: "tree_card",
    branch_key: "زيدان",
    message: "بطاقة\n\n__JSON__:\n" + JSON.stringify(payload),
  };
  RA.openTreeCardEditor(row);
  // Admin picks father while auto-resolve is still in flight.
  dom.fields.fatherPath.value = TARGET_PATH;
  dom.fields.fatherPersonId.value = TARGET_PID;
  dom.fields.fatherLabel.value = "محمد";
  await sleep(200);
  assert(
    dom.fields.fatherPersonId.value === TARGET_PID,
    "race: manual father UUID survived auto-resolve completion",
  );
  assert(
    dom.fields.fatherPath.value === TARGET_PATH,
    "race: manual father path survived auto-resolve completion",
  );
  // Simulated old bug: seeding via input would clear — ensure focus does not.
  const search = dom.document.getElementById("edit-card-father-search");
  search.value = "محمد";
  search.focus();
  assert(
    dom.fields.fatherPersonId.value === TARGET_PID,
    "race: focus/re-query does not clear bound father",
  );
  await dom.form._listeners.submit[0]({
    preventDefault: function () {},
    type: "submit",
  });
  const saveCalls = rpcCalls.filter(function (c) {
    return c.name === "admin_update_request_branch_v1";
  });
  if (saveCalls.length !== 1) {
    console.error(
      "race save error UI:",
      dom.document.getElementById("tree-card-edit-error").textContent,
      "pid=",
      dom.fields.fatherPersonId.value,
      "path=",
      dom.fields.fatherPath.value,
      "rpcN=",
      rpcCalls.map(function (c) {
        return c.name;
      }),
    );
  }
  assert(saveCalls.length === 1, "race: save still calls RPC");
  if (!saveCalls[0]) return;
  const msg = saveCalls[0].args.p_message || "";
  const json = JSON.parse(msg.slice(msg.indexOf("__JSON__:") + 9).trim());
  assert(
    json.father_person_id === TARGET_PID && json.name === "عبدالاله",
    "race: saved payload keeps UUID + name",
  );
}

async function main() {
  assert(
    fs.existsSync(
      path.join(__dirname, "..", "assets/js/modules/request-actions.js"),
    ),
    "request-actions.js present",
  );
  await testHappySave();
  await testAutoResolveDoesNotClearManualPick();
  if (failed) {
    console.error("\n" + failed + " assertion(s) failed");
    process.exit(1);
  }
  console.log("\nAll tree-card full-edit save checks passed.");
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
