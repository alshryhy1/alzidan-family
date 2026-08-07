#!/usr/bin/env node
/**
 * Patch Repair — parent_person_id dry-run / optional apply
 *
 * Dry-run (default): reads tree_children via anon REST, prints candidates.
 * Apply: requires SUPABASE_SERVICE_ROLE_KEY (or DATABASE_URL / SUPABASE_DB_PASSWORD via CLI).
 *
 * Usage:
 *   node scripts/repair-parent-person-id.mjs
 *   node scripts/repair-parent-person-id.mjs --apply
 *   node scripts/repair-parent-person-id.mjs --snapshot
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://wbskjfdqpugnwvrykqcn.supabase.co";
const ANON =
  process.env.SUPABASE_ANON_KEY ||
  "sb_publishable_JhgwBIXhs6z4yBZOoE2EqA_UlzjzW9c";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const APPLY = process.argv.includes("--apply");
const SNAPSHOT = process.argv.includes("--snapshot");

function normArabic(s) {
  return String(s || "")
    .replace(/ى/g, "ي")
    .replace(/[أإآ]/g, "ا")
    .trim() || null;
}

async function rest(pathname, { method = "GET", key = ANON, body } = {}) {
  const res = await fetch(`${SUPABASE_URL}${pathname}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: method === "GET" ? "count=exact" : "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function fetchAllChildren(key = ANON) {
  const rows = [];
  let offset = 0;
  const page = 1000;
  for (;;) {
    const chunk = await rest(
      `/rest/v1/tree_children?select=id,branch_key,parent_name,parent,child_name,name,person_id,parent_person_id&order=id&limit=${page}&offset=${offset}`,
      { key }
    );
    rows.push(...chunk);
    if (chunk.length < page) break;
    offset += page;
  }
  return rows;
}

function computeCandidates(rows) {
  const byPid = new Map();
  const exact = new Map(); // branch|path -> Set(person_id)
  const norm = new Map();

  for (const r of rows) {
    if (r.person_id) byPid.set(r.person_id, r);
    const pathName = (r.child_name || r.name || "").trim();
    const eKey = `${r.branch_key}\0${pathName}`;
    if (!exact.has(eKey)) exact.set(eKey, new Set());
    if (r.person_id) exact.get(eKey).add(r.person_id);
    const nPath = normArabic(pathName);
    if (nPath) {
      const nKey = `${r.branch_key}\0${nPath}`;
      if (!norm.has(nKey)) norm.set(nKey, new Set());
      if (r.person_id) norm.get(nKey).add(r.person_id);
    }
  }

  const unique = (map, key) => {
    const set = map.get(key);
    if (!set || set.size !== 1) return null;
    return [...set][0];
  };

  const candidates = [];
  const deferred = [];

  for (const r of rows) {
    const parentKey = (r.parent_name || r.parent || "").trim();
    const broken =
      r.parent_person_id && !byPid.has(r.parent_person_id);
    const missing = !r.parent_person_id;
    if (!broken && !missing) continue;

    const issue = broken ? "broken_parent_person_id" : "missing_parent_person_id";
    const exactPid = unique(exact, `${r.branch_key}\0${parentKey}`);
    const normPid =
      exactPid ||
      unique(norm, `${r.branch_key}\0${normArabic(parentKey)}`);
    const matchMode = exactPid
      ? "exact_parent_name"
      : normPid
        ? "norm_alef_maksura"
        : null;
    const newPid = exactPid || normPid;

    if (newPid && newPid !== r.parent_person_id) {
      candidates.push({
        child_id: r.id,
        branch_key: r.branch_key,
        child_path: r.child_name || r.name,
        parent_key: parentKey,
        old_parent_person_id: r.parent_person_id,
        new_parent_person_id: newPid,
        match_mode: matchMode,
        issue,
      });
    } else {
      deferred.push({
        child_id: r.id,
        branch_key: r.branch_key,
        parent_key: parentKey,
        issue,
        reason: broken && !newPid ? "unambiguous_parent_not_found" : "root_or_unmatched_or_ambiguous",
      });
    }
  }

  // ambiguous leaf clusters
  const leafCounts = new Map();
  for (const r of rows) {
    const leaf = (r.child_name || r.name || "").split("/").pop();
    const k = `${r.branch_key}\0${leaf}`;
    leafCounts.set(k, (leafCounts.get(k) || 0) + 1);
  }
  let ambiguousClusters = 0;
  for (const n of leafCounts.values()) if (n > 1) ambiguousClusters++;

  return {
    total: rows.length,
    missing: rows.filter((r) => !r.parent_person_id).length,
    broken: rows.filter((r) => r.parent_person_id && !byPid.has(r.parent_person_id)).length,
    candidates,
    deferred,
    ambiguousClusters,
  };
}

async function writeSnapshot(rows) {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const dir = path.join(ROOT, "backups", `patch-repair-${stamp}`);
  const jsonDir = path.join(dir, "json");
  fs.mkdirSync(jsonDir, { recursive: true });
  const file = path.join(jsonDir, "tree_children.json");
  fs.writeFileSync(file, JSON.stringify(rows, null, 2));
  const meta = {
    generated_at: new Date().toISOString(),
    source: "anon_rest",
    table: "tree_children",
    rows: rows.length,
    note: "Fresh snapshot before Patch Repair mutate. Keep patch-0 backup too.",
  };
  fs.mkdirSync(path.join(dir, "meta"), { recursive: true });
  fs.writeFileSync(path.join(dir, "meta", "snapshot.json"), JSON.stringify(meta, null, 2));
  fs.writeFileSync(
    path.join(dir, "RESTORE.md"),
    `# Restore note\n\nJSON snapshot of \`tree_children\` (${rows.length} rows) before Patch Repair.\nPrefer upsert by \`id\` / \`person_id\`. Also retain \`backups/patch-0-20260807/\`.\n`
  );
  return dir;
}

async function applyPatches(candidates) {
  if (!SERVICE) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY required for --apply (anon cannot mutate tree_children)."
    );
  }
  const results = [];
  for (const c of candidates) {
    const updated = await rest(
      `/rest/v1/tree_children?id=eq.${c.child_id}`,
      {
        method: "PATCH",
        key: SERVICE,
        body: { parent_person_id: c.new_parent_person_id },
      }
    );
    results.push({ child_id: c.child_id, updated: Array.isArray(updated) ? updated.length : 1 });
  }
  return results;
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY" : SNAPSHOT ? "SNAPSHOT+DRY-RUN" : "DRY-RUN"}`);
  console.log(`URL: ${SUPABASE_URL}`);

  const rows = await fetchAllChildren(ANON);
  const report = computeCandidates(rows);

  let snapshotDir = null;
  if (SNAPSHOT || APPLY) {
    snapshotDir = await writeSnapshot(rows);
    console.log(`Snapshot: ${snapshotDir}`);
  }

  console.log(
    JSON.stringify(
      {
        total: report.total,
        missing_parent_person_id: report.missing,
        broken_parent_person_id: report.broken,
        repair_candidates: report.candidates.length,
        deferred: report.deferred.length,
        ambiguous_leaf_clusters: report.ambiguousClusters,
        candidates: report.candidates,
        deferred_sample: report.deferred.slice(0, 20),
      },
      null,
      2
    )
  );

  const outDir = path.join(ROOT, "backups", "patch-repair-20260807", "meta");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "dry-run.json"),
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        snapshot_dir: snapshotDir,
        apply: APPLY,
        ...report,
      },
      null,
      2
    )
  );

  if (!APPLY) {
    console.log("\nDry-run only. Re-run with --apply and SUPABASE_SERVICE_ROLE_KEY to mutate.");
    console.log("Or apply SQL: supabase/sql/20260807_patch_repair_parent_links.sql then:");
    console.log("  select public.tree_repair_parent_person_id_apply_v1(true);");
    console.log("  select public.tree_repair_parent_person_id_apply_v1(false);");
    return;
  }

  const applied = await applyPatches(report.candidates);
  console.log(`Applied ${applied.length} row updates.`);
  const after = computeCandidates(await fetchAllChildren(SERVICE || ANON));
  console.log(
    JSON.stringify(
      {
        after_missing: after.missing,
        after_broken: after.broken,
        after_candidates: after.candidates.length,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
