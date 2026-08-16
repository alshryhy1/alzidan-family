#!/usr/bin/env node
"use strict";

var path = require("path");
var Corr = require(path.join(
  __dirname,
  "..",
  "assets/js/modules/tree-correction-contract.js"
));

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("OK:", msg);
}

var namePayload = {
  operation: "name_correction",
  branch_key: "مزيد",
  person_id: "pid-obeid-child-1",
  person_name: "رائد",
  path: "عبيد/رائد",
  name_old: "رائد",
  name_new: "رايد",
  source: "web_rx",
  submitter: { name: "حسن", phone: "+966551840058" },
};

var gateN = Corr.assertCreatablePersonCorrection(namePayload);
assert(gateN.ok, "name_correction creatable");
assert(
  /"operation": "name_correction"/.test(gateN.message) ||
    /"operation":"name_correction"/.test(gateN.message),
  "serialized name has operation"
);

var badName = Corr.assertCreatablePersonCorrection(
  Object.assign({}, namePayload, { person_id: "", name_new: "رايد بن عبيد" })
);
assert(!badName.ok, "name without person_id / multi-word rejected");

var phonePayload = {
  operation: "phone_correction",
  branch_key: "مزيد",
  person_id: "pid-obeid-child-1",
  person_name: "رائد",
  path: "عبيد/رائد",
  phone_new: "+966551840058",
  source: "web_rx",
};

var gateP = Corr.assertCreatablePersonCorrection(phonePayload);
assert(gateP.ok, "phone_correction creatable");

var parsed = Corr.parseCorrectionMessage(gateP.message);
assert(parsed.ok, "parse phone message ok");
assert(parsed.operation === "phone_correction", "operation phone");

var routedN = Corr.routeRequest({
  kind: "tree_edit",
  message: gateN.message,
});
assert(routedN.route === "name_correction", "router → name_correction");
assert(routedN.open === "name_editor", "opens name editor");
assert(routedN.blockTreeCardApply, "blocks tree_card apply");

var routedP = Corr.routeRequest({
  kind: "tree_edit",
  message: gateP.message,
});
assert(routedP.route === "phone_correction", "router → phone_correction");
assert(routedP.open === "phone_editor", "opens phone editor");

var preview = Corr.buildPersonCorrectionPreview(namePayload);
assert(
  preview.changes && preview.changes.length && preview.unchanged.length,
  "name preview has changes + unchanged"
);


var birthPayload = {
  operation: "birth_date_correction",
  branch_key: "مزيد",
  person_id: "pid-1",
  person_name: "حسن",
  birth_date_new: "1990-05-01",
  source: "web_rx",
};
var gateB = Corr.assertCreatablePersonCorrection(birthPayload);
assert(gateB.ok, "birth_date_correction creatable");
var routedB = Corr.routeRequest({ kind: "tree_edit", message: gateB.message });
assert(routedB.route === "birth_date_correction", "router → birth_date_correction");

var parentPayload = {
  operation: "parent_change",
  branch_key: "مزيد",
  person_id: "pid-child",
  person_name: "حسن",
  new_parent_person_id: "pid-father",
  new_parent_name: "عبيد",
  source: "web_rx",
};
var gatePar = Corr.assertCreatablePersonCorrection(parentPayload);
assert(gatePar.ok, "parent_change creatable");
var routedPar = Corr.routeRequest({ kind: "tree_edit", message: gatePar.message });
assert(routedPar.route === "parent_change", "router → parent_change");
assert(routedPar.blockTreeCardApply, "parent blocks tree_card apply");

console.log("\nAll person correction contract tests passed.");
