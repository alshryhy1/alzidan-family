#!/usr/bin/env node
/**
 * TREE-004 data repair — Ali Saleh dual-father children
 *
 * Context (2026-08-07 live scan):
 *   الأحم  = لاحم…/صالح/علي              person_id 5299acff-… (row 1626)
 *   ناصر   = لاحم…/صالح/ناصر/صالح/علي   person_id 8634e81c-… (row 634)
 *
 * Direct kids under الأحم (577,580,582,583) still point at DEAD parent_person_id
 * 9a3b4a7a-… (no living person). Parallel twin set under ناصر (1417–1423) is healthy.
 *
 * Safe apply (default --apply target):
 *   Relink stale parent_person_id → current الأحم UUID only.
 *
 * Destructive unlink (twins under wrong father):
 *   Requires --delete-ids=… explicitly. Never auto-deletes all of الأحم's kids.
 *
 * Usage:
 *   node scripts/repair-ali-dual-children.mjs
 *   node scripts/repair-ali-dual-children.mjs --snapshot
 *   node scripts/repair-ali-dual-children.mjs --apply
 *   node scripts/repair-ali-dual-children.mjs --apply --delete-ids=577,580
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
const deleteArg = process.argv.find((a) => a.startsWith("--delete-ids="));
const DELETE_IDS = deleteArg
  ? deleteArg
      .slice("--delete-ids=".length)
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0)
  : [];

const PATH_ALAHM = "لاحم بن مطلق بن زيدان/صالح/علي";
const PATH_NASER = "لاحم بن مطلق بن زيدان/صالح/ناصر/صالح/علي";
const STALE_PPID = "9a3b4a7a-5c08-41a9-ad7a-1956dea42bf5";

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
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function q(params) {
  return new URLSearchParams(params).toString();
}

function leaf(pathName) {
  const parts = String(pathName || "")
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

async function main() {
  const fathers = await rest(
    `/rest/v1/tree_children?${q({
      select: "id,child_name,person_id,parent_name,created_at",
      branch_key: "eq.لاحم",
      or: `(child_name.eq.${PATH_ALAHM},child_name.eq.${PATH_NASER})`,
    })}`,
  );
  const alahm = (fathers || []).find((r) => r.child_name === PATH_ALAHM);
  const naser = (fathers || []).find((r) => r.child_name === PATH_NASER);
  if (!alahm || !naser) {
    console.error("FAIL: could not resolve both Ali father rows");
    process.exit(1);
  }

  const kidsA = await rest(
    `/rest/v1/tree_children?${q({
      select: "id,parent_name,child_name,person_id,parent_person_id,created_at",
      branch_key: "eq.لاحم",
      parent_name: `eq.${PATH_ALAHM}`,
      order: "id",
    })}`,
  );
  const kidsB = await rest(
    `/rest/v1/tree_children?${q({
      select: "id,parent_name,child_name,person_id,parent_person_id,created_at",
      branch_key: "eq.لاحم",
      parent_name: `eq.${PATH_NASER}`,
      order: "id",
    })}`,
  );

  const mapA = Object.fromEntries(
    (kidsA || []).map((r) => [leaf(r.child_name), r]),
  );
  const mapB = Object.fromEntries(
    (kidsB || []).map((r) => [leaf(r.child_name), r]),
  );
  const twins = Object.keys(mapA)
    .filter((k) => mapB[k])
    .sort();

  const staleRelink = (kidsA || []).filter(
    (r) =>
      String(r.parent_person_id || "") === STALE_PPID ||
      (r.parent_person_id &&
        r.parent_person_id !== alahm.person_id &&
        !fathers.some((f) => f.person_id === r.parent_person_id)),
  );

  const report = {
    generated_at: new Date().toISOString(),
    fathers: {
      alahm: {
        id: alahm.id,
        path: PATH_ALAHM,
        person_id: alahm.person_id,
      },
      naser: {
        id: naser.id,
        path: PATH_NASER,
        person_id: naser.person_id,
      },
    },
    twins,
    twin_rows: twins.map((name) => ({
      leaf: name,
      under_alahm: mapA[name],
      under_naser: mapB[name],
    })),
    safe_relink_stale_parent_person_id: staleRelink.map((r) => ({
      id: r.id,
      child: leaf(r.child_name),
      old_parent_person_id: r.parent_person_id,
      new_parent_person_id: alahm.person_id,
      action: "update_parent_person_id_only",
    })),
    destructive_delete_candidates_under_alahm: twins.map((name) => ({
      id: mapA[name].id,
      child: name,
      note: "NOT auto-applied — would remove relationship under الأحم; keep ناصر row",
      keep_id: mapB[name].id,
    })),
    policy:
      "Safe apply = relink stale ppid to current الأحم UUID. Twin deletion requires --delete-ids.",
  };

  console.log(JSON.stringify(report, null, 2));

  const outDir = path.join(ROOT, "backups", "patch-tree004-ali-20260807");
  if (SNAPSHOT || APPLY) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, "dry-run.json"),
      JSON.stringify(report, null, 2),
      "utf8",
    );
    fs.writeFileSync(
      path.join(outDir, "kids-alahm.json"),
      JSON.stringify(kidsA, null, 2),
      "utf8",
    );
    fs.writeFileSync(
      path.join(outDir, "kids-naser.json"),
      JSON.stringify(kidsB, null, 2),
      "utf8",
    );
    fs.writeFileSync(
      path.join(outDir, "RESTORE.md"),
      `# Restore — Ali dual children (TREE-004)\n\nSnapshot of direct children under both Ali fathers.\nPrefer upsert by \`id\`. Retain Patch 0 backups.\n`,
      "utf8",
    );
    console.log("Wrote snapshot to", outDir);
  }

  if (!APPLY) {
    console.log(
      "\nDry-run only. Safe apply: --apply (relink stale ppid). Optional deletes: --delete-ids=…",
    );
    return;
  }

  if (!SERVICE) {
    console.error(
      "SUPABASE_SERVICE_ROLE_KEY required for --apply (anon cannot mutate tree_children).",
    );
    process.exit(2);
  }

  let updated = 0;
  for (const row of staleRelink) {
    await rest(`/rest/v1/tree_children?id=eq.${row.id}`, {
      method: "PATCH",
      key: SERVICE,
      body: { parent_person_id: alahm.person_id },
    });
    updated += 1;
    console.log(
      "relinked",
      row.id,
      leaf(row.child_name),
      "→",
      alahm.person_id,
    );
  }

  let deleted = 0;
  for (const id of DELETE_IDS) {
    const target = (kidsA || []).find((r) => Number(r.id) === id);
    if (!target) {
      console.error("skip delete — id not under الأحم direct kids:", id);
      continue;
    }
    await rest(`/rest/v1/tree_children?id=eq.${id}`, {
      method: "DELETE",
      key: SERVICE,
    });
    deleted += 1;
    console.log("deleted under الأحم", id, leaf(target.child_name));
  }

  fs.writeFileSync(
    path.join(outDir, "apply-result.json"),
    JSON.stringify(
      {
        updated_stale_ppid: updated,
        deleted_under_alahm: deleted,
        delete_ids: DELETE_IDS,
        at: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(
    `\nApply done. Relinked ${updated} stale parent_person_id; deleted ${deleted} under الأحم.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
