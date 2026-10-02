"use strict";

/**
 * Expected reply keys by event type (client filter).
 * Mirrors assets/js/modules/events/occasion-interactions.js
 */
var RSVP_TYPES = {
  feast: true,
  gathering: true,
  family_meetup: true,
  dinner: true,
  lunch: true,
  general: true,
  finjal_asr: true,
  finjal_isha: true,
  finjal_hawlna: true,
};
var DROP = { inv_details: true, inv_contact: true };

function filterCatalogForType(items, typeKey) {
  var list = (items || []).filter(function (item) {
    if (!item || DROP[item.key]) return false;
    var types = item.applies_to_types;
    if (!Array.isArray(types) || !types.length) return false;
    return types.indexOf(typeKey) >= 0;
  });
  if (RSVP_TYPES[typeKey]) {
    list = list.filter(function (item) {
      return (
        item.key === "inv_yes" ||
        item.key === "inv_no" ||
        item.key === "inv_maybe" ||
        item.allows_message
      );
    });
  }
  return list;
}

var gatheringCatalog = [
  { key: "inv_yes", applies_to_types: ["gathering"] },
  { key: "inv_no", applies_to_types: ["gathering"] },
  { key: "inv_maybe", applies_to_types: ["gathering"] },
  { key: "msg_custom", applies_to_types: ["gathering"], allows_message: true },
  { key: "inv_details", applies_to_types: ["gathering"] },
  { key: "inv_contact", applies_to_types: ["gathering"] },
  { key: "bless_success", applies_to_types: ["promotion_notice"] },
];

var got = filterCatalogForType(gatheringCatalog, "gathering").map(function (x) {
  return x.key;
});
if (got.join(",") !== "inv_yes,inv_no,inv_maybe,msg_custom") {
  console.error("gathering replies", got);
  process.exit(1);
}

var deathCatalog = [
  { key: "d_rahimahullah", applies_to_types: ["death"] },
  { key: "inv_yes", applies_to_types: ["gathering"] },
];
var deathGot = filterCatalogForType(deathCatalog, "death").map(function (x) {
  return x.key;
});
if (deathGot.join(",") !== "d_rahimahullah") {
  console.error("death replies", deathGot);
  process.exit(1);
}

var finjalCatalog = [
  { key: "inv_yes", applies_to_types: ["finjal_asr"] },
  { key: "inv_no", applies_to_types: ["finjal_asr"] },
  { key: "inv_maybe", applies_to_types: ["finjal_asr"] },
  { key: "msg_custom", applies_to_types: ["finjal_asr"], allows_message: true },
  { key: "inv_details", applies_to_types: ["finjal_asr"] },
  { key: "bless_success", applies_to_types: ["promotion_notice"] },
];
var finjalGot = filterCatalogForType(finjalCatalog, "finjal_asr").map(function (x) {
  return x.key;
});
if (finjalGot.join(",") !== "inv_yes,inv_no,inv_maybe,msg_custom") {
  console.error("finjal replies", finjalGot);
  process.exit(1);
}

console.log("ok: gathering/finjal=حاضر/أعتذر/أحاول/رسالة · death=دعاء · no details/contact");
