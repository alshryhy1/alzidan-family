#!/usr/bin/env node
/**
 * Smoke checks for Repair / Integrity scripts (no DB mutation).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function mustContain(file, needles) {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  for (const n of needles) {
    assert.ok(text.includes(n), `${file} missing: ${n}`);
  }
}

mustContain("supabase/sql/20260807_patch_repair_parent_links.sql", [
  "tree_repair_parent_candidates_v1",
  "tree_repair_parent_person_id_apply_v1",
  "tree_norm_arabic_path_v1",
  "p_dry_run",
]);

mustContain("supabase/sql/20260807_integrity_engine_v1.sql", [
  "v_integrity_children_bad_parent",
  "v_integrity_ambiguous_leaf_clusters",
  "v_integrity_spouses_without_husband",
  "admin_integrity_report_v1",
  "admin_integrity_list_v1",
]);

mustContain("scripts/repair-parent-person-id.mjs", [
  "norm_alef_maksura",
  "--apply",
  "SUPABASE_SERVICE_ROLE_KEY",
]);

mustContain("docs/PATCH-REPAIR-REPORT.md", [
  "Migration Version",
  "repaired",
  "deferred",
  "admin_integrity_report_v1",
]);


console.log("verify:repair OK");
