#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const delegatePath = path.join(__dirname, "../assets/js/delegate.js");
let s = fs.readFileSync(delegatePath, "utf8");
const lines = s.split("\n");

// 1) Replace old family DOM refs
s = s.replace(
  /const parentSelect = document\.getElementById\("parent-select"\);[\s\S]*?const editChildAlert = document\.getElementById\("edit-child-alert"\); /,
  'const familyManagementRoot = document.getElementById("family-management-root"); let familyMgmtPanel = null; '
);

// 2) Remove child-form UI helpers from line 20 blob
s = s.replace(/function setDeceasedFieldsUiMode[\s\S]*?function applyEditDeceasedUiMode\(\) \{[\s\S]*?\} /, "");
s = s.replace(/let isSyncingBirthDates = false; function syncBirthFromHijri\(\) \{[\s\S]*?if \(childBirthGreg\) \{[\s\S]*?childBirthGreg\.addEventListener\("change"[\s\S]*?\}\); \} /, "");
s = s.replace(/function setChildAlert\(type, text\) \{[\s\S]*?function hideEditChildAlert\(\) \{[\s\S]*?editChildAlert\.className = "alert"; \} /, "");

// 3) Strip removed UI functions from rpc line blob (line 85)
[
  "function renderParentsForBranch(branchKey)",
  "function ensureParentOption(name)",
  "function selectParentForAdding(name)",
  "function closeEditChild()",
  "function openEditChild(parentId, child)",
].forEach((sig) => {
  const start = s.indexOf(sig);
  if (start < 0) return;
  const nextFn = s.indexOf("function ", start + sig.length);
  const nextAsync = s.indexOf("async function ", start + sig.length);
  let end = nextFn;
  if (nextAsync >= 0 && (end < 0 || nextAsync < end)) end = nextAsync;
  if (end < 0) return;
  s = s.slice(0, start) + s.slice(end);
});

// 4) Remove renderChildrenForParent from line 116 blob
{
  const sig = "function renderChildrenForParent(parentName)";
  const start = s.indexOf(sig);
  const next = s.indexOf("function normalizePersonBaseName", start + sig.length);
  if (start >= 0 && next > start) {
    s = s.slice(0, start) + s.slice(next);
  }
}

// 5) Remove lines 86-115 (ensureDelegateAddChildButton block)
{
  const newLines = s.split("\n");
  const startIdx = newLines.findIndex((l) => l.startsWith("function ensureDelegateAddChildButton"));
  const endIdx = newLines.findIndex((l, i) => i > startIdx && l.startsWith("function renderChildrenForParent"));
  if (startIdx >= 0) {
    const cutEnd = endIdx >= 0 ? endIdx : startIdx + 30;
    newLines.splice(startIdx, cutEnd - startIdx);
    s = newLines.join("\n");
  }
}

// 6) Remove wife/child UI block: getSelectedChildSpouseId through before EVENTS_REFRESH_KEY / getDelegateHappyMediaInputs
const blockStart = s.indexOf("function getSelectedChildSpouseId()");
const blockEnd = s.indexOf("const EVENTS_REFRESH_KEY");
if (blockStart >= 0 && blockEnd > blockStart) {
  s = s.slice(0, blockStart) + s.slice(blockEnd);
}

// 7) Remove parentSelect listener in startBranch area
s = s.replace(/\n\s*parentSelect\.addEventListener\("change", \(\) => refreshWivesForSelectedParent\(\)\.catch\(\(\) => \{\}\)\);\n/, "\n");

// 8) Remove trailing child layout timeouts
s = s.replace(/\n\n\nsetTimeout\(ensureDelegateAddChildButton, 300\);\n\nsetTimeout\(refreshDelegateChildCardsLayout, 300\);\nsetInterval\(refreshDelegateChildCardsLayout, 800\);\n?$/, "\n");

// 9) Fix logout handler references
s = s.replace(
  /parentSelect\.value = ""; childrenContainer\.innerHTML = "";/,
  'if (familyMgmtPanel && typeof familyMgmtPanel.destroy === "function") familyMgmtPanel.destroy(); familyMgmtPanel = null; if (window.AlzidanFamilyMgmt && typeof window.AlzidanFamilyMgmt.destroy === "function") window.AlzidanFamilyMgmt.destroy();'
);

// 10) Inject family API + mount before EVENTS_REFRESH_KEY
const familyApi = fs.readFileSync(path.join(__dirname, "delegate-family-api-snippet.js"), "utf8");

const injectAt = s.indexOf("const EVENTS_REFRESH_KEY");
if (injectAt < 0) throw new Error("EVENTS_REFRESH_KEY anchor not found");
s = s.slice(0, injectAt) + familyApi + "\n\n" + s.slice(injectAt);

// 11) Patch startBranch loadChildren callback
s = s.replace(
  /\.then\(\(\) =>\{ renderParentsForBranch\(branchKey\); if \(desiredParentFromUrl\) \{ selectParentForAdding\(desiredParentFromUrl\); \} else \{ const root = getBranchRootName\(branchKey\); if \(root\) \{ ensureParentOption\(root\); parentSelect\.value = root; \} \} renderChildrenForParent\(parentSelect\.value\); refreshWivesForSelectedParent\(\)\.catch\(\(\) => \{\}\); \}\)/,
  `.then(() => {
      mountDelegateFamilyManagement(desiredParentFromUrl || "");
    })`
);

fs.writeFileSync(delegatePath, s);
console.log("Patched delegate.js successfully. New length:", s.length);
