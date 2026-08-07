#!/usr/bin/env node
/**
 * Read-only Integrity scan (ADR-004).
 * No UPDATE/DELETE. Produces a JSON report of similar integrity issues.
 *
 * Usage:
 *   node scripts/integrity-scan-report.mjs
 *   node scripts/integrity-scan-report.mjs --out=docs/integrity-scan-latest.json
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://wbskjfdqpugnwvrykqcn.supabase.co";

function loadAnonKey() {
  if (process.env.SUPABASE_ANON_KEY) return process.env.SUPABASE_ANON_KEY;
  const cfg = fs.readFileSync(path.join(ROOT, "assets/js/config.js"), "utf8");
  const m = cfg.match(/SUPABASE_ANON_KEY\s*=\s*["']([^"']+)/);
  if (!m) throw new Error("SUPABASE_ANON_KEY not found");
  return m[1];
}

const ANON = loadAnonKey();
const CLOSED_DELETE_IDS = new Set([577, 578, 579, 580, 581, 582, 583, 321, 1730]);
const KEEP_IDS = new Set([1417, 1418, 1419, 1420, 1421, 1422, 1423, 491, 492]);

async function rest(pathname) {
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

async function fetchSpouses() {
  try {
    return await rest(
      `/rest/v1/tree_spouses?select=id,husband_id,husband_person_id,wife_name,branch_key&limit=5000`,
    );
  } catch (e) {
    return { error: String(e.message || e), rows: [] };
  }
}

function leaf(pathStr) {
  const s = String(pathStr || "");
  const i = s.lastIndexOf("/");
  return i >= 0 ? s.slice(i + 1) : s;
}

function childPath(row) {
  return row.child_name || row.name || "";
}

function parentKey(row) {
  return row.parent_name || row.parent || "";
}

function buildReport(children, spousesRaw) {
  const byPerson = new Map();
  for (const c of children) {
    if (c.person_id) byPerson.set(String(c.person_id), c);
  }
  const byId = new Map(children.map((c) => [c.id, c]));

  const missing = [];
  const broken = [];
  for (const c of children) {
    if (!c.parent_person_id) {
      missing.push({
        id: c.id,
        branch_key: c.branch_key,
        child_path: childPath(c),
        parent_key: parentKey(c),
        code: "TREE-003",
        issue: "missing_parent_person_id",
      });
      continue;
    }
    if (!byPerson.has(String(c.parent_person_id))) {
      broken.push({
        id: c.id,
        branch_key: c.branch_key,
        child_path: childPath(c),
        parent_key: parentKey(c),
        parent_person_id: c.parent_person_id,
        code: "TREE-003-broken",
        issue: "broken_parent_person_id",
      });
    }
  }

  const leafMap = new Map();
  for (const c of children) {
    const k = `${c.branch_key || ""}||${leaf(childPath(c))}`;
    if (!leafMap.has(k)) leafMap.set(k, []);
    leafMap.get(k).push(c);
  }
  const ambiguous = [];
  for (const [k, rows] of leafMap) {
    if (rows.length <= 1) continue;
    const [branch_key, leaf_name] = k.split("||");
    const personIds = new Set(rows.map((r) => r.person_id).filter(Boolean));
    ambiguous.push({
      branch_key,
      leaf_name,
      n_rows: rows.length,
      n_distinct_person_id: personIds.size,
      sample_ids: rows.slice(0, 8).map((r) => r.id),
    });
  }
  ambiguous.sort((a, b) => b.n_rows - a.n_rows);

  let spousesBad = [];
  let spousesNote = null;
  if (spousesRaw && spousesRaw.error) {
    spousesNote = spousesRaw.error;
  } else {
    const spouses = Array.isArray(spousesRaw) ? spousesRaw : [];
    for (const s of spouses) {
      if (s.husband_id == null || !byId.has(s.husband_id)) {
        spousesBad.push({
          spouse_id: s.id,
          husband_id: s.husband_id,
          wife_name: s.wife_name,
          branch_key: s.branch_key,
          code: "SPOUSE-001",
        });
      }
    }
  }

  // Short-path candidates (similar class to deleted 321 / 1730) — report only
  const shortPathSuspects = [];
  for (const c of children) {
    const p = childPath(c);
    if (!p) continue;
    const parts = p.split("/").filter(Boolean);
    if (parts.length <= 2 && !KEEP_IDS.has(c.id) && !CLOSED_DELETE_IDS.has(c.id)) {
      shortPathSuspects.push({
        id: c.id,
        branch_key: c.branch_key,
        child_path: p,
        parent_key: parentKey(c),
        parent_person_id: c.parent_person_id || null,
        note: "short_path_review_candidate",
      });
    }
  }

  const closedStillPresent = children
    .filter((c) => CLOSED_DELETE_IDS.has(c.id))
    .map((c) => ({ id: c.id, child_path: childPath(c) }));
  const keepMissing = [...KEEP_IDS].filter((id) => !byId.has(id));

  return {
    generated_at: new Date().toISOString(),
    mode: "read_only",
    policy:
      "No mutation. Closed cleanups 577-583 / 321 / 1730 must not be re-deleted.",
    totals: {
      tree_children: children.length,
      missing_parent_person_id: missing.length,
      broken_parent_person_id: broken.length,
      children_bad_parent_total: missing.length + broken.length,
      ambiguous_leaf_clusters: ambiguous.length,
      spouses_without_husband: spousesBad.length,
      short_path_suspects: shortPathSuspects.length,
    },
    cleanup_gate: {
      closed_delete_ids_still_present: closedStillPresent,
      keep_ids_missing: keepMissing,
      ok: closedStillPresent.length === 0 && keepMissing.length === 0,
    },
    samples: {
      bad_parent: [...missing, ...broken].slice(0, 40),
      ambiguous_leaf_top: ambiguous.slice(0, 20),
      spouses_bad: spousesBad.slice(0, 20),
      short_path_suspects: shortPathSuspects.slice(0, 40),
    },
    spouses_note: spousesNote,
    codes: ["TREE-003", "TREE-001", "SPOUSE-001"],
  };
}

async function main() {
  const outArg = process.argv.find((a) => a.startsWith("--out="));
  const outPath = outArg
    ? path.resolve(ROOT, outArg.slice(6))
    : path.join(ROOT, "docs", "integrity-scan-latest.json");

  console.log("Integrity scan (READ-ONLY)");
  console.log("URL:", SUPABASE_URL);
  const children = await fetchAllChildren();
  const spouses = await fetchSpouses();
  const report = buildReport(children, spouses);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report.totals, null, 2));
  console.log("cleanup_gate:", report.cleanup_gate);
  console.log("Wrote", outPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
