#!/usr/bin/env node
/**
 * Verify Integrity v2: branch-root children must not appear as 🔴 TREE-003 errors.
 * Asserts ids 491, 670, 1068 are healthy (Root Parent), not errors.
 *
 * Usage: node scripts/verify-integrity-v2.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { classifyAll } from "./lib/integrity-tree003-v2.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://wbskjfdqpugnwvrykqcn.supabase.co";

const MUST_NOT_BE_ERRORS = [
  { id: 491, label: "لاحم/صالح" },
  { id: 670, label: "لاحم/ندا" },
  { id: 1068, label: "لاحم/هليل" },
];

function loadAnonKey() {
  if (process.env.SUPABASE_ANON_KEY) return process.env.SUPABASE_ANON_KEY;
  const cfg = fs.readFileSync(path.join(ROOT, "assets/js/config.js"), "utf8");
  const m = cfg.match(/SUPABASE_ANON_KEY\s*=\s*["']([^"']+)/);
  if (!m) throw new Error("SUPABASE_ANON_KEY not found");
  return m[1];
}

async function rest(pathname) {
  const ANON = loadAnonKey();
  const res = await fetch(`${SUPABASE_URL}${pathname}`, {
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${ANON}`,
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${pathname}: ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : [];
}

async function fetchAllChildren() {
  const page = 1000;
  let from = 0;
  const all = [];
  for (;;) {
    const rows = await rest(
      `/rest/v1/tree_children?select=id,branch_key,child_name,name,parent_name,parent,person_id,parent_person_id&order=id&limit=${page}&offset=${from}`,
    );
    all.push(...rows);
    if (rows.length < page) break;
    from += page;
  }
  return all;
}

async function fetchParents() {
  try {
    return await rest(
      `/rest/v1/tree_parents?select=id,branch_key,name,created_at&limit=5000`,
    );
  } catch {
    return [];
  }
}

async function main() {
  console.log("verify-integrity-v2: classifying TREE-003…");
  const children = await fetchAllChildren();
  const parents = await fetchParents();
  const { healthy, warnings, errors } = classifyAll(children, parents);

  const errorIds = new Set(errors.map((e) => e.id));
  const healthyById = new Map(healthy.map((h) => [h.id, h]));
  const warnById = new Map(warnings.map((w) => [w.id, w]));

  let failed = false;
  for (const item of MUST_NOT_BE_ERRORS) {
    if (errorIds.has(item.id)) {
      console.error(
        `FAIL: id ${item.id} (${item.label}) appears in 🔴 errors — expected healthy Root Parent`,
      );
      failed = true;
      continue;
    }
    const h = healthyById.get(item.id);
    if (!h) {
      const w = warnById.get(item.id);
      console.error(
        `FAIL: id ${item.id} (${item.label}) not healthy` +
          (w ? ` (severity=${w.severity}, reason=${w.reason})` : " (missing row?)"),
      );
      failed = true;
      continue;
    }
    if (h.reason !== "root_parent") {
      console.error(
        `FAIL: id ${item.id} healthy but reason=${h.reason}, expected root_parent`,
      );
      failed = true;
      continue;
    }
    console.log(
      `OK: ${item.id} (${item.label}) → 🟢 ${h.reason_ar}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        healthy: healthy.length,
        warnings: warnings.length,
        errors: errors.length,
        children_bad_parent_total: errors.length,
      },
      null,
      2,
    ),
  );

  if (failed) {
    process.exit(1);
  }
  console.log("verify-integrity-v2: PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
