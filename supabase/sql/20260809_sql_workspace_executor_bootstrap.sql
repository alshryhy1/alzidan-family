-- RETIRED — do not run.
--
-- This file previously used UPDATE pg_proc to inject function bodies without
-- raw ';' characters. Supabase forbids catalog writes even as postgres:
--   ERROR: 42501: permission denied for table pg_proc
--
-- Replacement (CREATE OR REPLACE / GRANT only):
--   supabase/sql/COPY-ME-admin-sql-workspace-run-v2.sql
--   supabase/sql/20260809_admin_sql_workspace_run_v2.sql
-- Preset: maint.sql_workspace_run_v2
--
-- Paste the replacement once in Supabase SQL Editor if Workspace cannot yet
-- CREATE FUNCTION; afterwards use Admin → tools → maintenance cards forever.

select jsonb_build_object(
  'ok', false,
  'error_code', 'SQL-WS-RETIRED-PG-PROC',
  'message_ar',
    'مسار UPDATE pg_proc مُلغى. ثبّت المنفّذ v2 عبر COPY-ME-admin-sql-workspace-run-v2.sql (CREATE OR REPLACE فقط).'
) as retired;
