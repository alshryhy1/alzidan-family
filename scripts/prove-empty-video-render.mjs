#!/usr/bin/env node
/**
 * Prove script: parse EVN-style no-attachment message and render delegate media HTML.
 */
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const eventsDir = path.join(root, "assets/js/modules/events");

const sandbox = { window: {}, globalThis: {} };
sandbox.window = sandbox.globalThis;
const context = vm.createContext(sandbox);
for (const file of ["event-media.js", "event-parser.js"]) {
  vm.runInContext(fs.readFileSync(path.join(eventsDir, file), "utf8"), context, { filename: file });
}
const Events = sandbox.window.AlzidanEvents;

const message = [
  "رقم الطلب: EVN-YV8M-JCPO",
  "اسم صاحب المناسبة: حسن خميس",
  "رابط الصورة: ",
  "رابط الفيديو: ",
  "",
  "النص:",
  "تجربه",
  "",
  "__JSON__:",
  JSON.stringify({
    v: 1,
    kind: "event_card",
    event: {
      type: "gathering",
      person: "حسن خميس",
      details: JSON.stringify({ text: "تجربه", imageUrl: "", videoUrl: "" }),
    },
    submitter: { videoUrl: "", imageUrl: "" },
  }),
].join("\n");

const parsed = Events.parseEventCardMessage(message);
const html = Events.buildRequestMediaPreviewHtml({
  imageUrl: parsed.imageUrl,
  videoUrl: parsed.videoUrl,
});

const out = {
  requestId: "EVN-YV8M-JCPO",
  videoUrl: parsed.videoUrl,
  imageUrl: parsed.imageUrl,
  text: parsed.text,
  renderedHtml: html,
  hasVideoTag: /<video\b/i.test(html),
  isValidVideoUrl_النص: Events.isValidVideoUrl("النص:"),
  oldRegexWouldCapture: (() => {
    const m = message.match(new RegExp("رابط الفيديو" + "\\s*:\\s*([^|\\n]+)", "i"));
    return m ? String(m[1]).replace(/\s+/g, " ").trim() : "";
  })(),
};
console.log(JSON.stringify(out, null, 2));
if (out.hasVideoTag || out.videoUrl) {
  console.error("PROVE FAILED: empty attachment still produced video");
  process.exit(1);
}
console.error("PROVE OK: no videoUrl, no <video>");
