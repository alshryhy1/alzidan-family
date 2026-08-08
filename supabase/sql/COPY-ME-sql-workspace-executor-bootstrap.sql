-- RETIRED — do not run.
--
-- Former pg_proc bootstrap. Forbidden on Supabase (42501 permission denied).
-- Use instead: COPY-ME-admin-sql-workspace-run-v2.sql
-- Preset: maint.sql_workspace_run_v2

select jsonb_build_object(
  'ok', false,
  'error_code', 'SQL-WS-RETIRED-PG-PROC',
  'message_ar',
    'مسار UPDATE pg_proc مُلغى. ثبّت المنفّذ v2 عبر COPY-ME-admin-sql-workspace-run-v2.sql (CREATE OR REPLACE فقط).'
) as retired;
