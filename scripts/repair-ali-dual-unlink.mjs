#!/usr/bin/env node
/**
 * TREE-004 unlink — DELETE wrong duplicate tree_children under علي صالح الأحم.
 * Does NOT relink parent_person_id. Does NOT touch ناصر rows.
 *
 *   node scripts/repair-ali-dual-unlink.mjs           # dry-run
 *   node scripts/repair-ali-dual-unlink.mjs --apply   # needs SUPABASE_SERVICE_ROLE_KEY
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "backups", "patch-tree004-ali-unlink-20260807");
const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://wbskjfdqpugnwvrykqcn.supabase.co";
const ANON =
  process.env.SUPABASE_ANON_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  "";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const APPLY = process.argv.includes("--apply");

const PATH_ALAHM = "لاحم بن مطلق بن زيدان/صالح/علي";
const PATH_NASER = "لاحم بن مطلق بن زيدان/صالح/ناصر/صالح/علي";
const DELETE_IDS = [577, 578, 579, 580, 581, 582, 583];
const KEEP_IDS = [1417, 1418, 1419, 1420, 1421, 1422, 1423];

async function rest(pathname, { method = "GET", key, body } = {}) {
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
    throw new Error(`HTTP ${res.status}: ${String(text).slice(0, 400)}`);
  }
  return data;
}

function q(params) {
  return new URLSearchParams(params).toString();
}

async function main() {
  const keyRead = ANON || SERVICE;
  if (!keyRead) {
    console.error("Need SUPABASE_ANON_KEY or EXPO_PUBLIC_SUPABASE_ANON_KEY for read.");
    process.exit(2);
  }

  const planPath = path.join(OUT, "dry-run-delete-plan.json");
  const plan = fs.existsSync(planPath)
    ? JSON.parse(fs.readFileSync(planPath, "utf8"))
    : { delete_row_ids: DELETE_IDS };

  const beforeAlahm = await rest(
    `/rest/v1/tree_children?${q({
      select: "id,child_name,person_id,parent_person_id",
      branch_key: "eq.لاحم",
      parent_name: `eq.${PATH_ALAHM}`,
      order: "id",
    })}`,
    { key: keyRead },
  );
  const beforeNaser = await rest(
    `/rest/v1/tree_children?${q({
      select: "id,child_name,person_id,parent_person_id",
      branch_key: "eq.لاحم",
      parent_name: `eq.${PATH_NASER}`,
      order: "id",
    })}`,
    { key: keyRead },
  );
  const beforeTargets = await rest(
    `/rest/v1/tree_children?${q({
      select: "id,child_name,parent_name,person_id,parent_person_id",
      id: `in.(${DELETE_IDS.join(",")})`,
      order: "id",
    })}`,
    { key: keyRead },
  );

  const report = {
    at: new Date().toISOString(),
    delete_ids: DELETE_IDS,
    keep_ids: KEEP_IDS,
    before: {
      alahm_direct: beforeAlahm,
      naser_direct: beforeNaser,
      targets_present: beforeTargets,
    },
  };
  console.log(JSON.stringify(report, null, 2));

  if (!APPLY) {
    console.log("\nDry-run only. Apply: SUPABASE_SERVICE_ROLE_KEY=… node scripts/repair-ali-dual-unlink.mjs --apply");
    return;
  }
  if (!SERVICE) {
    console.error("SUPABASE_SERVICE_ROLE_KEY required for --apply");
    process.exit(2);
  }

  // Safety: only delete if still under الأحم path prefix
  const deleted = [];
  for (const row of beforeTargets || []) {
    const cn = String(row.child_name || "");
    if (!cn.startsWith(PATH_ALAHM + "/") && row.parent_name !== PATH_ALAHM) {
      console.error("REFUSE delete — not under الأحم path:", row.id, cn);
      process.exit(3);
    }
  }

  for (const id of DELETE_IDS) {
    const still = (beforeTargets || []).find((r) => Number(r.id) === id);
    if (!still) {
      console.log("already absent", id);
      continue;
    }
    await rest(`/rest/v1/tree_children?id=eq.${id}`, {
      method: "DELETE",
      key: SERVICE,
    });
    deleted.push(id);
    console.log("deleted", id, still.child_name);
  }

  const afterAlahm = await rest(
    `/rest/v1/tree_children?${q({
      select: "id,child_name",
      branch_key: "eq.لاحم",
      parent_name: `eq.${PATH_ALAHM}`,
      order: "id",
    })}`,
    { key: SERVICE },
  );
  const afterNaser = await rest(
    `/rest/v1/tree_children?${q({
      select: "id,child_name",
      branch_key: "eq.لاحم",
      parent_name: `eq.${PATH_NASER}`,
      order: "id",
    })}`,
    { key: SERVICE },
  );
  const afterKeep = await rest(
    `/rest/v1/tree_children?${q({
      select: "id,child_name",
      id: `in.(${KEEP_IDS.join(",")})`,
      order: "id",
    })}`,
    { key: SERVICE },
  );

  const result = {
    at: new Date().toISOString(),
    deleted_ids: deleted,
    after_alahm_direct: afterAlahm,
    after_naser_direct: afterNaser,
    naser_keep_present: afterKeep,
    naser_ok: Array.isArray(afterKeep) && afterKeep.length === KEEP_IDS.length,
    alahm_twins_gone: Array.isArray(afterAlahm) && afterAlahm.length === 0,
  };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "apply-result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (!result.naser_ok || !result.alahm_twins_gone) {
    console.error("POST-CHECK FAILED");
    process.exit(4);
  }
  console.log("\nApply OK — wrong الأحم links removed; ناصر intact.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
