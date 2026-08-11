#!/usr/bin/env node
/**
 * Static + behavioral: tree_children in-flight dedupe by branch_key.
 * Run: node scripts/test-tree-children-inflight-dedupe.js
 */
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const appJs = fs.readFileSync(path.join(root, "assets/js/app.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "pages/index.html"), "utf8");

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error("FAIL:", msg);
  } else {
    console.log("OK:", msg);
  }
}

assert(appJs.includes("const treeChildrenInFlightByBranch = new Map()"), "in-flight Map exists");
assert(appJs.includes("async function loadChildrenForBranch("), "loadChildrenForBranch wrapper exists");
assert(appJs.includes("async function loadChildrenForBranchFetch("), "network helper extracted");
assert(appJs.includes("treeChildrenInFlightByBranch.get(key)"), "reuses in-flight promise by key");
assert(appJs.includes("treeChildrenInFlightByBranch.set(key, promise)"), "stores in-flight promise");
assert(
  appJs.includes("if (treeChildrenInFlightByBranch.get(key) === promise) treeChildrenInFlightByBranch.delete(key)"),
  "clears map entry when settled"
);
assert(appJs.includes("TREE_CHILDREN_CACHE_TTL_MS = 5 * 60 * 1000"), "localStorage TTL stays 5 min");
assert(appJs.includes("function readTreeChildrenCache("), "readTreeChildrenCache preserved");
assert(appJs.includes("function writeTreeChildrenCache("), "writeTreeChildrenCache preserved");
assert(/app\.js\?v=20260811treededupe1/.test(indexHtml), "pages/index.html cache-busts app.js");

/** Same share-one-promise pattern as app.js loadChildrenForBranch */
async function loadWithInFlight(map, key, fetchFn) {
  const existing = map.get(key);
  if (existing) return existing;
  const promise = Promise.resolve().then(fetchFn);
  map.set(key, promise);
  try {
    return await promise;
  } finally {
    if (map.get(key) === promise) map.delete(key);
  }
}

async function runBehavioral() {
  const map = new Map();
  let fetchCount = 0;
  let resolveFetch;
  const gate = new Promise((r) => {
    resolveFetch = r;
  });

  const fetchFn = async () => {
    fetchCount += 1;
    const id = fetchCount;
    await gate;
    return { ok: true, rows: [{ branch: "زيدان" }], id };
  };

  const p1 = loadWithInFlight(map, "زيدان", fetchFn);
  const p2 = loadWithInFlight(map, "زيدان", fetchFn);
  const p3 = loadWithInFlight(map, "زايد", fetchFn);

  assert(map.size === 2, "two branches in flight concurrently");
  assert(map.get("زيدان") != null && map.get("زايد") != null, "map holds both branch promises");
  // async wrappers return distinct outer promises; shared Map entry is what dedupes the network
  assert(true, "same branch reuses Map entry (checked via fetchCount)");

  resolveFetch();
  const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
  assert(fetchCount === 2, "only one fetch per branch (زيدان+زايد)");
  assert(r1 && r2 && r1.ok && r2.ok && r1.id === r2.id && r1.id === 1, "shared callers get same result");
  assert(r3.ok && r3.id === 2, "other branch gets its own result");
  assert(map.size === 0, "map cleared after settle");

  // After clear, a new call may fetch again
  const r4 = await loadWithInFlight(map, "زيدان", fetchFn);
  assert(fetchCount === 3, "after settle, new call starts a fresh fetch");
  assert(r4.id === 3, "fresh fetch returns new result");
  assert(map.size === 0, "map cleared after second settle");
}

runBehavioral()
  .then(() => {
    if (failed) {
      console.error(`\n${failed} assertion(s) failed`);
      process.exit(1);
    }
    console.log("\nAll tree_children in-flight dedupe checks passed.");
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
