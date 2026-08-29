#!/usr/bin/env node
"use strict";

const path = require("path");
const root = path.join(__dirname, "..");

require(path.join(root, "assets/js/modules/events/event-types.js"));
require(path.join(root, "assets/js/modules/events/event-visibility.js"));
require(path.join(root, "assets/js/modules/events/event-parser.js"));
require(path.join(root, "assets/js/modules/events/event-builder.js"));

const Events = globalThis.AlzidanEvents;

function assert(cond, label) {
  if (!cond) {
    console.error("FAIL:", label);
    process.exitCode = 1;
  } else {
    console.log("OK:", label);
  }
}

assert(!!Events, "AlzidanEvents loaded");
assert(typeof Events.eventTextIsTypeEcho === "function", "eventTextIsTypeEcho");
assert(Events.eventTextIsTypeEcho("birth", "مولود جديد") === true, "type echo hides duplicate body");
assert(Events.eventTextIsTypeEcho("birth", "ألف مبروك المولود") === false, "custom text kept");
assert(Events.newsIncidentDateIsPlausible("2022-06-25", "2026-08-28T14:26:35.000Z") === false, "2022 date not shown on 2026 newborn");
assert(Events.newsIncidentDateIsPlausible("2026-08-25", "2026-08-28T14:26:35.000Z") === true, "birth 3 days before publish is shown");
assert(Events.eventRequestKindLabel("birth") === "تهنئة / خبر", "request kind is news not occasion");
assert(Events.personLabelForType("birth") === "اسم المولود أو الأب", "birth person label");
assert(Events.incidentDateFieldLabel("birth") === "تاريخ الولادة", "birth date label");

const json = {
  v: 1,
  kind: "family_notice",
  mode: "notice",
  family: "news",
  type: "birth",
  typeLabel: "مولود جديد",
  person: "ياسر مالك محمد حمد طعيسان ندى لاحم",
  date_label: "2022-06-25",
  event_date: "2022-06-25",
  text: "مولود جديد",
  submitter_name: "مازن محمد حمد طعيسان نداء لاحم",
  submitter_phone: "+966500247865",
  created_at: "2026-08-28T14:26:35.000Z",
  showDays: 7,
};

const message = [
  "طلب نشر تهنئة / خبر عائلي في تطبيق عائلة الزيدان",
  "رقم الطلب: req-test",
  "الفرع: لاحم",
  "النوع: مولود جديد",
  "التصنيف: خبر/تهنئة (بدون اشتراط موعد حفل)",
  "اسم المولود أو الأب: ياسر مالك محمد حمد طعيسان ندى لاحم",
  "تاريخ الولادة: 2022-06-25",
  "",
  "نص التهنئة / الخبر:",
  "مولود جديد",
  "",
  "بيانات المرسل:",
  "الاسم: مازن محمد حمد طعيسان نداء لاحم",
  "الجوال: +966500247865",
  "التاريخ: ٢٨‏/٨‏/٢٠٢٦، ٥:٢٦:٣٥ مساءً",
  "",
  "__JSON__:",
  JSON.stringify(json),
].join("\n");

const parsed = Events.parseEventCardMessage({ message, name: json.submitter_name });
assert(parsed.type === "birth", "parser type from envelope");
assert(parsed.person.indexOf("ياسر") === 0, "parser person is the newborn/father");
assert(parsed.submitterName.indexOf("مازن") === 0, "parser submitter is not the event person");
assert(parsed.eventDate === "2022-06-25" || parsed.dateLabel === "2022-06-25", "parser keeps stored date");
assert(parsed.text === "مولود جديد", "parser reads envelope text");
assert(Events.eventTextIsTypeEcho(parsed.type, parsed.text) === true, "summary will omit echoed text");
assert(
  Events.newsIncidentDateIsPlausible(parsed.dateLabel || parsed.eventDate, json.created_at) === false,
  "summary will omit implausible birth date",
);

const saved = Events.buildFamilyEventRow({
  source: "admin_cms",
  id: 99,
  branch: "لاحم",
  type: "birth",
  person: "مالك محمد حمد طعيسان نداء لاحم",
  dateLabel: "1448-3-15",
  eventDate: "2026-08-28",
  text: "نبارك للمولود",
  createdAt: "2026-08-28T10:00:00.000Z",
  oldDetails: {
    v: 1,
    kind: "happy_notice",
    showDays: 7,
    end_at: "2022-06-25T20:59:59.000Z",
    show_at: "2022-06-22T00:00:00.000Z",
  },
});
assert(!!saved, "admin cms row builds");
assert(Date.parse(saved.end_at) > Date.now(), "admin save writes future end_at for store clients");
assert(String(saved.details).indexOf("2022-06-25") < 0, "stale 2022 end_at stripped from details");

if (process.exitCode) {
  console.error("\nVerification failed.");
  process.exit(1);
}
console.log("\nNews announcement display checks passed.");
