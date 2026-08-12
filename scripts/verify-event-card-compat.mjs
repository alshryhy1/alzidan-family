#!/usr/bin/env node
/**
 * Verifies AlzidanEvents.buildFamilyEventRow matches frozen golden outputs.
 * Run: npm run verify:event-card
 */
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const eventsDir = path.join(root, "assets/js/modules/events");
const fixturesPath = path.join(__dirname, "fixtures/event-card-golden.json");

function loadEventsModules() {
  const sandbox = { window: {}, globalThis: {} };
  sandbox.window = sandbox.globalThis;
  const context = vm.createContext(sandbox);
  const files = [
    "event-types.js",
    "event-media.js",
    "event-parser.js",
    "event-builder.js",
    "index.js",
  ];
  for (const file of files) {
    const code = fs.readFileSync(path.join(eventsDir, file), "utf8");
    vm.runInContext(code, context, { filename: file });
  }
  return sandbox.window.AlzidanEvents;
}

function stableRow(row) {
  const copy = { ...row };
  if (copy.created_at) copy.created_at = "FIXED_ISO";
  return copy;
}

function rowsEqual(a, b) {
  return JSON.stringify(stableRow(a)) === JSON.stringify(stableRow(b));
}

const samples = [
  {
    name: "approval_json_envelope_happy",
    row: {
      request_id: "EVN-ABCD-EFGH",
      branch_key: "مزيد",
      name: "مرسل",
      phone: "0500000000",
      created_at: "2026-07-01T10:00:00.000Z",
      message: [
        "طلب نشر مناسبة",
        "",
        "__JSON__:",
        JSON.stringify(
          {
            v: 1,
            kind: "event_card",
            event: {
              type: "birth",
              person: "خالد",
              date_label: "2026-07-01",
              event_date: "",
              details: JSON.stringify({
                v: 1,
                kind: "happy_notice",
                text: "ألف مبروك",
                imageUrl: "https://example.com/a.jpg",
                videoUrl: "",
                showDays: 7,
              }),
            },
            submitter: { name: "مرسل", phone: "0500000000" },
          },
          null,
          2,
        ),
      ].join("\n"),
    },
  },
  {
    name: "approval_text_fallback",
    row: {
      request_id: "EVN-TXT1-TXT2",
      branch_key: "زيدان",
      name: "أحمد",
      phone: "0511111111",
      created_at: "2026-07-02T10:00:00.000Z",
      message: [
        "طلب نشر مناسبة",
        "الفرع: زيدان",
        "نوع المناسبة: زواج",
        "اسم صاحب المناسبة: سعد",
        "التاريخ: 2026-07-02",
        "رابط الصورة: https://example.com/wedding.jpg",
        "النص: مبروك للعروسين",
      ].join("\n"),
    },
  },
  {
    name: "public_form_birth",
    input: {
      source: "public_form",
      requestId: "EVN-PUB1-PUB2",
      branch: "مزيد",
      type: "birth",
      person: "فهد",
      dateLabel: "2026-07-03",
      text: "مبروك المولود",
      place: "الرياض",
      imageUrl: "https://example.com/b.jpg",
      videoUrl: "",
      createdAt: "2026-07-03T10:00:00.000Z",
    },
  },
  {
    name: "delegate_form_sick",
    input: {
      source: "delegate_form",
      category: "sick",
      branch: "مزيد",
      type: "sick",
      person: "عبدالله",
      dateLabel: "2026-07-04",
      eventDate: "2026-07-04",
      place: "hospital",
      hospitalName: "مستشفى الملك",
      hospitalDept: "باطنية",
      contactMethod: "visit",
      contactPhone: "",
      visitDateFrom: "2026-07-05",
      visitDateTo: "2026-07-06",
      visitTimeFrom: "17:00",
      visitTimeTo: "20:00",
      notes: "",
      showDays: 7,
      createdAt: "2026-07-04T10:00:00.000Z",
    },
  },
  {
    name: "delegate_form_death",
    input: {
      source: "delegate_form",
      category: "death",
      branch: "زيدان",
      person: "محمد",
      dateLabel: "2026-07-05",
      eventDate: "2026-07-05",
      prayerPlace: "مسجد الحي",
      prayerTime: "بعد العصر",
      burialPlace: "المقبرة",
      burialTime: "مساءً",
      condolencePlace: "منزل العائلة",
      condolenceTime: "بعد المغرب",
      phones: ["0501234567"],
      notes: "",
      showDays: 7,
      createdAt: "2026-07-05T10:00:00.000Z",
    },
  },
  {
    name: "admin_cms_general",
    input: {
      source: "admin_cms",
      id: 42,
      branch: "لاحم",
      type: "general",
      person: "سالم",
      dateLabel: "2026-07-06",
      eventDate: "2026-07-06",
      text: "مناسبة عامة",
      imageUrl: "https://example.com/g.jpg",
      videoUrl: "",
      oldDetails: { v: 1, kind: "happy_notice", showDays: 5 },
    },
  },
];

function buildSampleInput(sample) {
  if (sample.row) return { source: "approval_request", row: sample.row };
  return sample.input;
}

function generateGolden(E) {
  const golden = {};
  for (const sample of samples) {
    const built = E.buildFamilyEventRow(buildSampleInput(sample));
    golden[sample.name] = stableRow(built);
  }
  return golden;
}

const mode = process.argv[2] || "verify";
const E = loadEventsModules();

if (!E || typeof E.buildFamilyEventRow !== "function") {
  console.error("FAIL: AlzidanEvents.buildFamilyEventRow not loaded");
  process.exit(1);
}

if (mode === "write-golden") {
  const golden = generateGolden(E);
  fs.mkdirSync(path.dirname(fixturesPath), { recursive: true });
  fs.writeFileSync(fixturesPath, JSON.stringify(golden, null, 2) + "\n");
  console.log("Wrote golden fixtures:", fixturesPath);
  process.exit(0);
}

let golden = {};
if (fs.existsSync(fixturesPath)) {
  golden = JSON.parse(fs.readFileSync(fixturesPath, "utf8"));
} else {
  console.log("No golden file — generating baseline from current modules...");
  golden = generateGolden(E);
  fs.mkdirSync(path.dirname(fixturesPath), { recursive: true });
  fs.writeFileSync(fixturesPath, JSON.stringify(golden, null, 2) + "\n");
}

let failed = 0;
for (const sample of samples) {
  const built = E.buildFamilyEventRow(buildSampleInput(sample));
  const expected = golden[sample.name];
  if (!expected) {
    console.error("FAIL:", sample.name, "— missing golden entry");
    failed += 1;
    continue;
  }
  if (!rowsEqual(built, expected)) {
    console.error("FAIL:", sample.name);
    console.error(" expected:", JSON.stringify(expected, null, 2));
    console.error("   actual:", JSON.stringify(stableRow(built), null, 2));
    failed += 1;
  } else {
    console.log("OK:", sample.name);
  }
}

const mobileArabicDateRow = {
  request_id: "EVN-MOB1-HASS",
  branch_key: "زيدان",
  name: "حسن",
  phone: "0500000001",
  created_at: "2026-08-12T10:00:00.000Z",
  message: [
    "طلب نشر مناسبة في تطبيق عائلة الزيدان",
    "رقم الطلب: EVN-MOB1-HASS",
    "الفرع: زيدان",
    "النوع: مناسبة عامة",
    "نوع المناسبة: مناسبة عامة",
    "اسم صاحب المناسبة: حسن",
    "صاحب المناسبة: حسن",
    "التاريخ: ١٢ أغسطس ٢٠٢٦",
    "النص: خبر تجريبي",
    "المرسل: حسن",
    "الجوال: 0500000001",
    "__JSON__:",
    JSON.stringify({
      v: 1,
      kind: "event_card",
      source: "mobile_app",
      event: {
        type: "general",
        typeLabel: "مناسبة عامة",
        person: "حسن",
        date_label: "١٢ أغسطس ٢٠٢٦",
        event_date: "١٢ أغسطس ٢٠٢٦",
        details: { v: 1, kind: "happy_notice", text: "خبر تجريبي", showDays: 7 },
      },
      submitter: { name: "حسن", phone: "0500000001" },
    }),
  ].join("\n"),
};

const mobileBuilt = E.buildFamilyEventRow({
  source: "approval_request",
  row: mobileArabicDateRow,
});
if (!mobileBuilt || mobileBuilt.person !== "حسن" || mobileBuilt.type !== "general") {
  console.error("FAIL: mobile_app envelope did not build person/type");
  failed += 1;
} else if (mobileBuilt.event_date !== "") {
  console.error("FAIL: mobile_app free-text event_date must not reach SQL:", mobileBuilt.event_date);
  failed += 1;
} else {
  console.log("OK: mobile_app_arabic_date_cleared");
}

if (typeof E.toSqlDateOrEmpty === "function") {
  const slash = E.toSqlDateOrEmpty("2026/08/12");
  const dmy = E.toSqlDateOrEmpty("12/08/2026");
  const junk = E.toSqlDateOrEmpty("١٢ أغسطس ٢٠٢٦");
  if (slash !== "2026-08-12" || dmy !== "2026-08-12" || junk !== "") {
    console.error("FAIL: toSqlDateOrEmpty", { slash, dmy, junk });
    failed += 1;
  } else {
    console.log("OK: toSqlDateOrEmpty");
  }
} else {
  console.error("FAIL: toSqlDateOrEmpty missing");
  failed += 1;
}

if (typeof E.sanitizeFamilyEventRowForPublish === "function") {
  const sanitized = E.sanitizeFamilyEventRowForPublish({
    branch_key: "زيدان",
    type: "مولود",
    person: "حسن",
    date_label: "2026/08/12",
    event_date: "١٢ أغسطس ٢٠٢٦",
    visit_date_from: "bad",
    created_at: "2026-08-12T10:00:00.000Z",
  });
  if (
    sanitized.event_date !== "2026-08-12" ||
    sanitized.type !== "birth" ||
    sanitized.visit_date_from !== ""
  ) {
    console.error("FAIL: sanitizeFamilyEventRowForPublish", sanitized);
    failed += 1;
  } else {
    console.log("OK: sanitizeFamilyEventRowForPublish");
  }
} else {
  console.error("FAIL: sanitizeFamilyEventRowForPublish missing");
  failed += 1;
}

if (failed) {
  console.error(`\n${failed} sample(s) failed.`);
  process.exit(1);
}

console.log(`\nAll ${samples.length} event-card samples passed.`);
