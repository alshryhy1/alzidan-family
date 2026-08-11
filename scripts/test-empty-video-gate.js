#!/usr/bin/env node
/**
 * Ensures empty "رابط الفيديو:" + "النص: تجربه" never yields videoUrl
 * and never emits <video> in the delegate request-detail HTML path.
 *
 * Run: npm run verify:empty-video
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const eventsDir = path.join(root, "assets/js/modules/events");

function loadEvents() {
  const sandbox = { window: {}, globalThis: {} };
  sandbox.window = sandbox.globalThis;
  const context = vm.createContext(sandbox);
  for (const file of ["event-types.js", "event-media.js", "event-parser.js", "event-builder.js", "index.js"]) {
    const code = fs.readFileSync(path.join(eventsDir, file), "utf8");
    vm.runInContext(code, context, { filename: file });
  }
  return sandbox.window.AlzidanEvents;
}

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
    throw new Error(msg);
  }
}

const EMPTY_NO_ATTACH_MSG = [
  "طلب نشر مناسبة في تطبيق عائلة الزيدان",
  "",
  "رقم الطلب: EVN-YV8M-JCPO",
  "الفرع: مزيد",
  "نوع المناسبة: اجتماع عائلي",
  "اسم صاحب المناسبة: حسن خميس",
  "التاريخ: ١٤٤٨-٣-٣",
  "المكان: تجربه",
  "رابط الصورة: ",
  "رابط الفيديو: ",
  "",
  "النص:",
  "تجربه",
  "",
  "بيانات المرسل:",
  "الجوال: +966551840058",
  "",
  "__JSON__:",
  JSON.stringify(
    {
      v: 1,
      kind: "event_card",
      event: {
        branch_key: "مزيد",
        type: "gathering",
        person: "حسن خميس",
        date_label: "١٤٤٨-٣-٣",
        event_date: "",
        details: JSON.stringify({
          v: 1,
          kind: "happy_notice",
          requestId: "EVN-YV8M-JCPO",
          text: "تجربه",
          extra: "تجربه",
          imageUrl: "",
          videoUrl: "",
          showDays: 7,
        }),
      },
      submitter: {
        requestId: "EVN-YV8M-JCPO",
        person: "حسن خميس",
        imageUrl: "",
        videoUrl: "",
        text: "تجربه",
      },
    },
    null,
    2,
  ),
].join("\n");

// Prove the OLD live regex bug still captures "النص:" (why production showed a black player).
const oldMatch = EMPTY_NO_ATTACH_MSG.match(new RegExp("رابط الفيديو" + "\\s*:\\s*([^|\\n]+)", "i"));
const oldCaptured = oldMatch ? String(oldMatch[1] || "").replace(/\s+/g, " ").trim() : "";
assert(oldCaptured === "النص:", "sanity: old regex should capture النص: (got " + JSON.stringify(oldCaptured) + ")");

const Events = loadEvents();
assert(typeof Events.parseEventCardMessage === "function", "parseEventCardMessage missing");
assert(typeof Events.isValidVideoUrl === "function", "isValidVideoUrl missing");
assert(typeof Events.resolveValidVideoUrl === "function", "resolveValidVideoUrl missing");
assert(typeof Events.buildRequestMediaPreviewHtml === "function", "buildRequestMediaPreviewHtml missing");

const parsed = Events.parseEventCardMessage(EMPTY_NO_ATTACH_MSG);
assert(parsed.videoUrl === "", "parser videoUrl must be empty, got " + JSON.stringify(parsed.videoUrl));
assert(parsed.imageUrl === "", "parser imageUrl must be empty, got " + JSON.stringify(parsed.imageUrl));
assert(parsed.text === "تجربه" || (parsed.detailsText && parsed.detailsText.includes("تجربه")), "text should parse");

assert(Events.isValidVideoUrl("") === false, "empty not valid video");
assert(Events.isValidVideoUrl("النص:") === false, "label not valid video");
assert(Events.isValidVideoUrl("   ") === false, "whitespace not valid video");
assert(Events.resolveValidVideoUrl("النص:") === "", "resolve rejects النص:");
assert(Events.resolveValidVideoUrl("") === "", "resolve rejects empty");

const junkHtml = Events.buildRequestMediaPreviewHtml({
  imageUrl: "",
  videoUrl: "النص:",
});
assert(!/<video\b/i.test(junkHtml), "junk videoUrl must not emit <video>, got: " + junkHtml);

const emptyHtml = Events.buildRequestMediaPreviewHtml({
  imageUrl: parsed.imageUrl,
  videoUrl: parsed.videoUrl,
});
assert(emptyHtml === "", "no-attachment preview HTML must be empty");
assert(!/<video\b/i.test(emptyHtml), "no-attachment must not include <video>");

const goodUrl = "https://wbskjfdqpugnwvrykqcn.supabase.co/storage/v1/object/public/event-media/demo.mp4";
assert(Events.isValidVideoUrl(goodUrl) === true, "real storage mp4 should be valid");
const goodHtml = Events.buildRequestMediaPreviewHtml({ videoUrl: goodUrl });
assert(/<video\b/i.test(goodHtml), "valid URL should emit <video>");
assert(goodHtml.includes(goodUrl), "valid URL should appear in src");

// Static check: delegate.js must not use the soft fail-open gate anymore.
const delegateSrc = fs.readFileSync(path.join(root, "assets/js/delegate.js"), "utf8");
assert(
  !/\(\s*!\s*\(\s*EventsMedia\.isValidVideoUrl\s*\)\s*\|\|/.test(delegateSrc),
  "delegate.js still has soft fail-open isValidVideoUrl gate",
);
assert(
  delegateSrc.includes("buildRequestMediaPreviewHtml") || delegateSrc.includes("resolveValidVideoUrl"),
  "delegate.js must hard-gate via resolve/build helpers",
);

const treeHtml = fs.readFileSync(path.join(root, "pages/alzidan-tree.html"), "utf8");
assert(
  /event-media\.js\?v=20260810novid2/.test(treeHtml) &&
    /event-parser\.js\?v=20260810novid2/.test(treeHtml),
  "alzidan-tree.html must cache-bust event-media/parser with novid2",
);
assert(
  /delegate\.js\?v=delegattr1/.test(treeHtml),
  "alzidan-tree.html must cache-bust delegate.js with delegattr1",
);
assert(!/novid1/.test(treeHtml), "alzidan-tree.html must not reference novid1");

console.log("OK: empty-video gate — parser videoUrl='', no <video> for no-attachment; novid2 present.");
