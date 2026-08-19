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

var cityPayload = {
  operation: "city_correction",
  branch_key: "مزيد",
  person_id: "pid-1",
  person_name: "حسن",
  city_new: "الرياض",
  area_new: "النسيم",
  source: "web_rx",
};
var gateC = Corr.assertCreatablePersonCorrection(cityPayload);
assert(gateC.ok, "city_correction creatable");
var routedC = Corr.routeRequest({ kind: "tree_edit", message: gateC.message });
assert(routedC.route === "city_correction", "router → city_correction");
assert(routedC.open === "city_editor", "opens city editor");
assert(routedC.blockTreeCardApply, "city blocks tree_card apply");
var prevC = Corr.buildPersonCorrectionPreview(cityPayload);
assert(prevC.changes && prevC.changes.length >= 1, "city preview has changes");

var badCity = Corr.assertCreatablePersonCorrection(
  Object.assign({}, cityPayload, { city_new: "", area_new: "" })
);
assert(!badCity.ok, "city without city/area rejected");

var identityPayload = {
  operation: "name_correction",
  branch_key: "مزيد",
  person_id: "pid-abdulrahman",
  person_name: "عبدالرحمن",
  path: "حسن/عبدالرحمن",
  name_old: "عبدالرحمن",
  name_new: "عبدالله",
  source: "web_rx",
  submitter: { name: "حسن", phone: "+966534000000" },
  phone: "+966534000000",
};
var requesterRow = { name: "حسن", phone: "+966534000000", branch_key: "مزيد" };
var nIdent = Corr.normalizePersonCorrectionPayload(identityPayload, requesterRow);
assert(!nIdent.phone_new, "name_correction does not copy requester phone onto phone_new");
assert(nIdent.target_phone === "", "name_correction target_phone empty");
assert(nIdent.requester_phone === "+966534000000", "requester_phone kept");
assert(nIdent.person_name === "عبدالرحمن", "target person_name is عبدالرحمن not حسن");
assert(nIdent.target_person && nIdent.target_person.person_id === "pid-abdulrahman", "target_person identity");

var gateIdent = Corr.assertCreatablePersonCorrection(identityPayload, requesterRow);
assert(gateIdent.ok, "name_correction still creatable with requester row.phone");
assert(!/"phone_new": "\+966534000000"/.test(gateIdent.message), "serialized JSON must not set phone_new from row.phone");
assert(/جوال المرسل/.test(gateIdent.message), "serialized labels requester phone separately");

var poisoned = Corr.normalizePersonCorrectionPayload({
  operation: "name_correction",
  branch_key: "مزيد",
  person_id: "pid-abdulrahman",
  person_name: "عبدالرحمن",
  name_new: "عبدالله",
  phone: "+966534000000",
});
assert(!poisoned.phone_new, "src.phone is never phone_new");

var phoneSplit = Corr.normalizePersonCorrectionPayload(
  {
    operation: "phone_correction",
    branch_key: "مزيد",
    person_id: "pid-abdulrahman",
    person_name: "عبدالرحمن",
    phone_new: "+966555111222",
    submitter: { name: "حسن", phone: "+966534000000" },
  },
  { phone: "+966534000000", name: "حسن" }
);
assert(phoneSplit.phone_new === "+966555111222", "phone_correction keeps target phone_new");
assert(phoneSplit.target_phone === "+966555111222", "target_phone aliases phone_new");
assert(phoneSplit.requester_phone === "+966534000000", "requester_phone distinct from target");

var selfEdit = Corr.normalizePersonCorrectionPayload({
  operation: "name_correction",
  branch_key: "مزيد",
  person_id: "pid-hassan",
  person_name: "حسن",
  name_new: "حسين",
  requester_person_id: "pid-hassan",
  submitter: { name: "حسن", phone: "+966534000000", person_id: "pid-hassan" },
});
assert(selfEdit.self_edit === true, "self_edit when target === requester");
assert(!selfEdit.phone_new, "self name_correction still does not apply requester phone");

console.log("\nAll person correction contract tests passed.");
