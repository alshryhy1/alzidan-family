/**
 * Smoke: mobile «الأقسام» returns to hub; drawer host escapes .page clipping.
 * Run: node scripts/test-admin-shell-mobile-sections.js
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const shellJs = fs.readFileSync(path.join(root, "assets/js/admin-shell.js"), "utf8");
const mobileCss = fs.readFileSync(path.join(root, "assets/css/admin-mobile.css"), "utf8");
const shellCss = fs.readFileSync(path.join(root, "assets/css/admin-shell.css"), "utf8");
const adminHtml = fs.readFileSync(path.join(root, "pages/admin.html"), "utf8");

const checks = [
  {
    name: "mobile أقسام tap navigates to hub when not on hub",
    ok: /currentModule !== "hub"/.test(shellJs) && /navigate\("hub"\)/.test(shellJs),
  },
  {
    name: "placeShellChrome moves drawer to document.body on narrow",
    ok: /function placeShellChrome/.test(shellJs) && /document\.body\.appendChild\(aside\)/.test(shellJs),
  },
  {
    name: "module navigation uses pushState for browser back",
    ok: /history\.pushState/.test(shellJs) && /popstate/.test(shellJs),
  },
  {
    name: "admin-mobile does not clip .page overflow-x when shell ready",
    ok:
      /admin-authenticated \.page \{[\s\S]*?overflow-x:\s*visible\s*!important/.test(mobileCss) &&
      !/admin-authenticated,\s*\n\s*body\.admin-shell-ready\.admin-authenticated \.page \{[\s\S]*?overflow-x:\s*hidden\s*!important/.test(
        mobileCss,
      ),
  },
  {
    name: "mobile drawer z-index above sticky header",
    ok: /z-index:\s*120/.test(shellCss) && /z-index:\s*110/.test(shellCss),
  },
  {
    name: "cache-bust bumped for shell assets",
    ok:
      /admin-shell\.css\?v=20261007sec1/.test(adminHtml) &&
      /admin-mobile\.css\?v=20261007sec1/.test(adminHtml) &&
      /admin-shell\.js\?v=20261007sec1/.test(adminHtml),
  },
];

let failed = 0;
for (const c of checks) {
  if (c.ok) {
    console.log("ok  ", c.name);
  } else {
    failed += 1;
    console.error("FAIL", c.name);
  }
}

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall admin-shell mobile sections checks passed");
