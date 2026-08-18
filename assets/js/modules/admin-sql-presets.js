/**
 * SQL Workspace — ready maintenance presets.
 * SQL: prefer inline `sql` on the preset; else fetch `file` (note: *.sql is gitignored).
 * Command lifecycle SSOT: archived (done) > failed > pending.
 * Done presets live in archive only; active list = not-yet-done current state.
 */
(function () {
  "use strict";

  const DONE_KEY = "alzidan_sql_ws_presets_done_v1";
  const FAIL_KEY = "alzidan_sql_ws_presets_fail_v1";

  /** @type {{id:string,title:string,desc:string,file?:string,sql?:string,order:number,bootstrap?:boolean,supabaseOnce?:boolean}[]} */
  const PRESETS = [
    {
      id: "maint.sql_workspace_run_v2",
      title: "تثبيت منفّذ SQL Workspace v2",
      desc:
        "إلزامي أولًا: إن ظهر «يُسمح بأمر واحد فقط» فالصق COPY-ME-admin-sql-workspace-run-v2.sql مرة واحدة في Supabase SQL Editor (CREATE OR REPLACE فقط — بدون pg_proc). بعدها شغّل هذه البطاقة ثم بقية أوامر الصيانة من المساحة.",
      file: "../supabase/sql/COPY-ME-admin-sql-workspace-run-v2.sql",
      sql: `-- SQL Workspace executor v2 — CREATE OR REPLACE / GRANT only.
-- NO pg_catalog writes. NO UPDATE pg_proc. Safe on Supabase (incl. free tier).
--
-- Chicken-egg: paste once in Supabase SQL Editor if the old Workspace executor
-- rejects CREATE FUNCTION (naive ';' check or broken stripper stub).
-- After this lands: Admin → tools → maintenance cards run via
-- admin_sql_workspace_run_v2 forever (Workspace path).
--
-- Preset: maint.sql_workspace_run_v2
-- Safe to re-run.

-- 0) Classifier (dependency of execute_v1 / run_v2)
create or replace function public.admin_sql_classify_v1(p_sql text)
returns jsonb
language plpgsql
immutable
as $fn$
declare
  v_raw text := btrim(coalesce(p_sql, ''));
  v_work text;
  v_first text;
  v_mutating boolean := false;
  v_selectish boolean := false;
  v_block_end int;
begin
  if v_raw = '' then
    return jsonb_build_object('empty', true, 'mutating', false, 'selectish', false, 'first', null);
  end if;

  -- Strip leading line/block comments without regex backtracking.
  -- (Naive '/\\*.*?\\*/' with flag n can statement-timeout on SQL that contains '/' paths.)
  v_work := v_raw;
  loop
    v_work := btrim(v_work);
    if v_work = '' then
      exit;
    end if;
    if substr(v_work, 1, 2) = '--' then
      v_work := regexp_replace(v_work, '^--[^\\n]*\\n?', '');
      continue;
    end if;
    if substr(v_work, 1, 2) = '/*' then
      v_block_end := position('*/' in substr(v_work, 3));
      if v_block_end > 0 then
        -- substr(v_work,3) index + 2 (for '/*') + 2 (for '*/') - 1 = v_block_end + 3
        v_work := substr(v_work, v_block_end + 4);
        continue;
      end if;
      -- Unclosed block comment → treat as empty
      v_work := '';
      exit;
    end if;
    exit;
  end loop;

  v_work := btrim(v_work);
  if v_work = '' then
    return jsonb_build_object('empty', true, 'mutating', false, 'selectish', false, 'first', null);
  end if;
  v_first := upper(substring(v_work from '^\\s*([A-Za-z]+)'));

  v_selectish := v_first in ('SELECT', 'WITH', 'SHOW', 'EXPLAIN', 'VALUES', 'TABLE');
  v_mutating := v_first in (
    'UPDATE', 'DELETE', 'DROP', 'ALTER', 'TRUNCATE', 'CREATE',
    'INSERT', 'REPLACE', 'GRANT', 'REVOKE', 'COMMENT', 'COPY',
    'VACUUM', 'REINDEX', 'CLUSTER', 'SECURITY', 'CALL', 'DO'
  );

  return jsonb_build_object(
    'empty', false,
    'mutating', v_mutating,
    'selectish', v_selectish,
    'first', v_first
  );
end;
$fn$;

-- 1) Literal/comment stripper (fixes identity stub left by retired pg_proc bootstrap)
create or replace function public.admin_sql_sql_without_literals_v1(p_sql text)
returns text
language plpgsql
immutable
as $fn$
declare
  v text := coalesce(p_sql, '');
  v_out text := '';
  i int := 1;
  n int;
  ch text;
  tag text;
  endtag text;
  j int;
begin
  n := char_length(v);
  while i <= n loop
    ch := substr(v, i, 1);
    if ch = '$' then
      j := i + 1;
      while j <= n and substr(v, j, 1) ~ '[A-Za-z0-9_]' loop
        j := j + 1;
      end loop;
      if j <= n and substr(v, j, 1) = '$' then
        tag := substr(v, i, j - i + 1);
        endtag := tag;
        i := j + 1;
        v_out := v_out || ' ';
        while i <= n loop
          if substr(v, i, char_length(endtag)) = endtag then
            i := i + char_length(endtag);
            v_out := v_out || ' ';
            exit;
          end if;
          v_out := v_out || ' ';
          i := i + 1;
        end loop;
        continue;
      end if;
    end if;
    if ch = chr(39) then
      v_out := v_out || ' ';
      i := i + 1;
      while i <= n loop
        if substr(v, i, 1) = chr(39) then
          if i < n and substr(v, i + 1, 1) = chr(39) then
            v_out := v_out || '  ';
            i := i + 2;
            continue;
          end if;
          i := i + 1;
          exit;
        end if;
        v_out := v_out || ' ';
        i := i + 1;
      end loop;
      continue;
    end if;
    if ch = '-' and i < n and substr(v, i + 1, 1) = '-' then
      while i <= n and substr(v, i, 1) <> E'\\n' loop
        v_out := v_out || ' ';
        i := i + 1;
      end loop;
      continue;
    end if;
    if ch = '/' and i < n and substr(v, i + 1, 1) = '*' then
      v_out := v_out || '  ';
      i := i + 2;
      while i < n loop
        if substr(v, i, 2) = '*/' then
          v_out := v_out || '  ';
          i := i + 2;
          exit;
        end if;
        v_out := v_out || ' ';
        i := i + 1;
      end loop;
      continue;
    end if;
    v_out := v_out || ch;
    i := i + 1;
  end loop;
  return v_out;
end;
$fn$;

-- 2) Statement splitter (dollar-quote / string / comment aware)
create or replace function public.admin_sql_split_statements_v1(p_sql text)
returns text[]
language plpgsql
immutable
as $fn$
declare
  v text := coalesce(p_sql, '');
  n int := char_length(v);
  i int := 1;
  ch text;
  buf text := '';
  out_arr text[] := array[]::text[];
  tag text;
  endtag text;
  j int;
  stripped text;
begin
  while i <= n loop
    ch := substr(v, i, 1);

    if ch = '-' and i < n and substr(v, i + 1, 1) = '-' then
      buf := buf || ch;
      i := i + 1;
      while i <= n and substr(v, i, 1) <> E'\\n' loop
        buf := buf || substr(v, i, 1);
        i := i + 1;
      end loop;
      continue;
    end if;

    if ch = '/' and i < n and substr(v, i + 1, 1) = '*' then
      buf := buf || '/*';
      i := i + 2;
      while i < n loop
        if substr(v, i, 2) = '*/' then
          buf := buf || '*/';
          i := i + 2;
          exit;
        end if;
        buf := buf || substr(v, i, 1);
        i := i + 1;
      end loop;
      continue;
    end if;

    if ch = '$' then
      j := i + 1;
      while j <= n and substr(v, j, 1) ~ '[A-Za-z0-9_]' loop
        j := j + 1;
      end loop;
      if j <= n and substr(v, j, 1) = '$' then
        tag := substr(v, i, j - i + 1);
        endtag := tag;
        buf := buf || tag;
        i := j + 1;
        while i <= n loop
          if substr(v, i, char_length(endtag)) = endtag then
            buf := buf || endtag;
            i := i + char_length(endtag);
            exit;
          end if;
          buf := buf || substr(v, i, 1);
          i := i + 1;
        end loop;
        continue;
      end if;
    end if;

    if ch = chr(39) then
      buf := buf || ch;
      i := i + 1;
      while i <= n loop
        buf := buf || substr(v, i, 1);
        if substr(v, i, 1) = chr(39) then
          if i < n and substr(v, i + 1, 1) = chr(39) then
            buf := buf || substr(v, i + 1, 1);
            i := i + 2;
            continue;
          end if;
          i := i + 1;
          exit;
        end if;
        i := i + 1;
      end loop;
      continue;
    end if;

    if ch = ';' then
      stripped := btrim(
        regexp_replace(
          regexp_replace(buf, '/\\*.*?\\*/', '', 'ng'),
          '--[^\\n]*',
          '',
          'n'
        )
      );
      if stripped <> '' then
        out_arr := out_arr || btrim(buf);
      end if;
      buf := '';
      i := i + 1;
      continue;
    end if;

    buf := buf || ch;
    i := i + 1;
  end loop;

  stripped := btrim(
    regexp_replace(
      regexp_replace(buf, '/\\*.*?\\*/', '', 'ng'),
      '--[^\\n]*',
      '',
      'n'
    )
  );
  if stripped <> '' then
    out_arr := out_arr || btrim(buf);
  end if;

  return out_arr;
end;
$fn$;

-- 3) Single-statement executor (literal-aware MULTI check)
create or replace function public.admin_sql_execute_v1(
  p_token text,
  p_sql text,
  p_confirm_mutate boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_sql text;
  v_cls jsonb;
  v_is_mutating boolean;
  v_is_selectish boolean;
  v_started timestamptz;
  v_elapsed_ms integer;
  v_row_count bigint := 0;
  v_rows jsonb := '[]'::jsonb;
  v_truncated boolean := false;
  v_audit_id bigint;
  v_err_state text;
  v_err_msg text;
  v_limit integer := 500;
  v_probe text;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  v_sql := btrim(coalesce(p_sql, ''));
  if v_sql = '' then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'SQL-WS-EMPTY',
      'message_ar', 'أدخل أمر SQL أولاً.'
    );
  end if;

  v_probe := public.admin_sql_sql_without_literals_v1(v_sql);
  v_probe := regexp_replace(v_probe, ';\\s*$', '');
  if position(';' in v_probe) > 0 then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'SQL-WS-MULTI',
      'message_ar', 'يُسمح بأمر واحد فقط في كل تنفيذ. للصيانة متعددة الأوامر: استخدم المنفّذ v2 أو «أوامر الصيانة الجاهزة».'
    );
  end if;
  v_sql := regexp_replace(v_sql, ';\\s*$', '');

  v_cls := public.admin_sql_classify_v1(v_sql);
  v_is_mutating := coalesce((v_cls->>'mutating')::boolean, false);
  v_is_selectish := coalesce((v_cls->>'selectish')::boolean, false);

  if v_is_mutating and not coalesce(p_confirm_mutate, false) then
    return jsonb_build_object(
      'ok', false,
      'needs_confirm', true,
      'error_code', 'SQL-WS-CONFIRM',
      'message_ar', 'هذا أمر يغيّر البيانات. أكّد التنفيذ للمتابعة.',
      'first_keyword', v_cls->>'first'
    );
  end if;

  v_started := clock_timestamp();

  begin
    if v_is_selectish then
      execute
        'select coalesce(jsonb_agg(to_jsonb(q)), ''[]''::jsonb), count(*)::bigint '
        || 'from (select * from (' || v_sql || ') _sql_ws_src limit '
        || (v_limit + 1)::text
        || ') q'
      into v_rows, v_row_count;

      if v_row_count > v_limit then
        v_truncated := true;
        v_row_count := v_limit;
        select coalesce(jsonb_agg(val), '[]'::jsonb)
          into v_rows
        from (
          select value as val
          from jsonb_array_elements(coalesce(v_rows, '[]'::jsonb))
          limit v_limit
        ) s;
      end if;
    else
      execute v_sql;
      get diagnostics v_row_count = row_count;
      v_rows := '[]'::jsonb;
    end if;
  exception when others then
    get stacked diagnostics
      v_err_state = returned_sqlstate,
      v_err_msg = message_text;
    v_elapsed_ms := greatest(
      0,
      (extract(epoch from (clock_timestamp() - v_started)) * 1000)::integer
    );

    begin
      v_audit_id := public.admin_audit_write_v1(
        'admin',
        left(coalesce(p_token, ''), 12),
        'sql.execute',
        'sql_workspace',
        null,
        null,
        jsonb_build_object(
          'ok', false,
          'mutating', v_is_mutating,
          'selectish', v_is_selectish,
          'first_keyword', v_cls->>'first',
          'sql_preview', left(v_sql, 400),
          'elapsed_ms', v_elapsed_ms,
          'sqlstate', v_err_state,
          'error_code', 'SQL-WS-EXEC',
          'executor', 'execute_v1'
        )
      );
    exception when others then
      v_audit_id := null;
    end;

    return jsonb_build_object(
      'ok', false,
      'error_code', 'SQL-WS-EXEC',
      'message_ar', 'تعذّر تنفيذ الأمر. راجع الصياغة أو الصلاحيات ثم أعد المحاولة.',
      'hint_ar', 'تفاصيل تقنية محفوظة في سجل التدقيق فقط.',
      'elapsed_ms', v_elapsed_ms,
      'audit_id', v_audit_id
    );
  end;

  v_elapsed_ms := greatest(
    0,
    (extract(epoch from (clock_timestamp() - v_started)) * 1000)::integer
  );

  begin
    v_audit_id := public.admin_audit_write_v1(
      'admin',
      left(coalesce(p_token, ''), 12),
      'sql.execute',
      'sql_workspace',
      null,
      null,
      jsonb_build_object(
        'ok', true,
        'mutating', v_is_mutating,
        'selectish', v_is_selectish,
        'first_keyword', v_cls->>'first',
        'sql_preview', left(v_sql, 400),
        'row_count', v_row_count,
        'truncated', v_truncated,
        'elapsed_ms', v_elapsed_ms,
        'confirmed_mutate', coalesce(p_confirm_mutate, false),
        'executor', 'execute_v1'
      )
    );
  exception when others then
    v_audit_id := null;
  end;

  return jsonb_build_object(
    'ok', true,
    'is_select', v_is_selectish,
    'is_mutating', v_is_mutating,
    'first_keyword', v_cls->>'first',
    'row_count', v_row_count,
    'truncated', v_truncated,
    'elapsed_ms', v_elapsed_ms,
    'rows', coalesce(v_rows, '[]'::jsonb),
    'audit_id', v_audit_id,
    'message_ar', 'تم التنفيذ',
    'executor', 'execute_v1'
  );
end;
$fn$;

-- 4) Multi-statement Workspace runner (no catalog hacks)
create or replace function public.admin_sql_workspace_run_v2(
  p_token text,
  p_sql text,
  p_confirm_mutate boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_raw text;
  v_stmts text[];
  v_stmt text;
  v_cls jsonb;
  v_any_mutating boolean := false;
  v_started timestamptz;
  v_elapsed_ms integer;
  v_limit integer := 500;
  v_stmt_count integer := 0;
  v_ok_count integer := 0;
  v_row_count bigint := 0;
  v_rows jsonb := '[]'::jsonb;
  v_truncated boolean := false;
  v_is_selectish boolean := false;
  v_is_mutating boolean := false;
  v_first text;
  v_audit_id bigint;
  v_err_state text;
  v_err_msg text;
  v_last_first text;
  i integer;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  v_raw := btrim(coalesce(p_sql, ''));
  if v_raw = '' then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'SQL-WS-EMPTY',
      'message_ar', 'أدخل أمر SQL أولاً.'
    );
  end if;

  v_stmts := public.admin_sql_split_statements_v1(v_raw);
  v_stmt_count := coalesce(array_length(v_stmts, 1), 0);
  if v_stmt_count < 1 then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'SQL-WS-EMPTY',
      'message_ar', 'لم يُعثر على أوامر قابلة للتنفيذ.'
    );
  end if;

  for i in 1..v_stmt_count loop
    v_cls := public.admin_sql_classify_v1(v_stmts[i]);
    if coalesce((v_cls->>'empty')::boolean, false) then
      continue;
    end if;
    if coalesce((v_cls->>'mutating')::boolean, false) then
      v_any_mutating := true;
      exit;
    end if;
  end loop;

  if v_any_mutating and not coalesce(p_confirm_mutate, false) then
    v_cls := public.admin_sql_classify_v1(v_stmts[1]);
    return jsonb_build_object(
      'ok', false,
      'needs_confirm', true,
      'error_code', 'SQL-WS-CONFIRM',
      'message_ar', 'هذا السكربت يغيّر البيانات أو المخطط. أكّد التنفيذ للمتابعة.',
      'first_keyword', v_cls->>'first',
      'statement_count', v_stmt_count
    );
  end if;

  v_started := clock_timestamp();

  for i in 1..v_stmt_count loop
    v_stmt := regexp_replace(btrim(v_stmts[i]), ';\\s*$', '');
    if v_stmt = '' then
      continue;
    end if;

    v_cls := public.admin_sql_classify_v1(v_stmt);
    if coalesce((v_cls->>'empty')::boolean, false) then
      continue;
    end if;
    v_is_mutating := coalesce((v_cls->>'mutating')::boolean, false);
    v_is_selectish := coalesce((v_cls->>'selectish')::boolean, false);
    v_first := v_cls->>'first';
    v_last_first := v_first;
    v_row_count := 0;
    v_rows := '[]'::jsonb;
    v_truncated := false;

    begin
      if v_is_selectish then
        execute
          'select coalesce(jsonb_agg(to_jsonb(q)), ''[]''::jsonb), count(*)::bigint '
          || 'from (select * from (' || v_stmt || ') _sql_ws_src limit '
          || (v_limit + 1)::text
          || ') q'
        into v_rows, v_row_count;

        if v_row_count > v_limit then
          v_truncated := true;
          v_row_count := v_limit;
          select coalesce(jsonb_agg(val), '[]'::jsonb)
            into v_rows
          from (
            select value as val
            from jsonb_array_elements(coalesce(v_rows, '[]'::jsonb))
            limit v_limit
          ) s;
        end if;
      else
        execute v_stmt;
        get diagnostics v_row_count = row_count;
        v_rows := '[]'::jsonb;
      end if;
    exception when others then
      get stacked diagnostics
        v_err_state = returned_sqlstate,
        v_err_msg = message_text;
      v_elapsed_ms := greatest(
        0,
        (extract(epoch from (clock_timestamp() - v_started)) * 1000)::integer
      );

      begin
        v_audit_id := public.admin_audit_write_v1(
          'admin',
          left(coalesce(p_token, ''), 12),
          'sql.execute',
          'sql_workspace',
          null,
          null,
          jsonb_build_object(
            'ok', false,
            'mutating', v_is_mutating,
            'selectish', v_is_selectish,
            'first_keyword', v_first,
            'sql_preview', left(v_stmt, 400),
            'elapsed_ms', v_elapsed_ms,
            'sqlstate', v_err_state,
            'error_code', 'SQL-WS-EXEC',
            'executor', 'workspace_run_v2',
            'statement_index', i,
            'statement_count', v_stmt_count,
            'ok_before_fail', v_ok_count
          )
        );
      exception when others then
        v_audit_id := null;
      end;

      return jsonb_build_object(
        'ok', false,
        'error_code', 'SQL-WS-EXEC',
        'message_ar',
          'تعذّر التنفيذ عند الأمر ' || i::text || ' / ' || v_stmt_count::text
          || '. راجع الصياغة أو الصلاحيات ثم أعد المحاولة.',
        'hint_ar', 'تفاصيل تقنية محفوظة في سجل التدقيق فقط.',
        'elapsed_ms', v_elapsed_ms,
        'audit_id', v_audit_id,
        'statement_index', i,
        'statement_count', v_stmt_count,
        'executor', 'workspace_run_v2'
      );
    end;

    v_ok_count := v_ok_count + 1;
  end loop;

  v_elapsed_ms := greatest(
    0,
    (extract(epoch from (clock_timestamp() - v_started)) * 1000)::integer
  );

  begin
    v_audit_id := public.admin_audit_write_v1(
      'admin',
      left(coalesce(p_token, ''), 12),
      'sql.execute',
      'sql_workspace',
      null,
      null,
      jsonb_build_object(
        'ok', true,
        'mutating', v_any_mutating,
        'selectish', v_is_selectish,
        'first_keyword', v_last_first,
        'sql_preview', left(v_raw, 400),
        'row_count', v_row_count,
        'truncated', v_truncated,
        'elapsed_ms', v_elapsed_ms,
        'confirmed_mutate', coalesce(p_confirm_mutate, false),
        'executor', 'workspace_run_v2',
        'statement_count', v_stmt_count,
        'statements_ok', v_ok_count
      )
    );
  exception when others then
    v_audit_id := null;
  end;

  return jsonb_build_object(
    'ok', true,
    'is_select', v_is_selectish,
    'is_mutating', v_any_mutating,
    'first_keyword', v_last_first,
    'row_count', case when v_is_selectish then v_row_count else v_ok_count end,
    'truncated', v_truncated,
    'elapsed_ms', v_elapsed_ms,
    'rows', coalesce(v_rows, '[]'::jsonb),
    'audit_id', v_audit_id,
    'message_ar', 'تم التنفيذ',
    'executor', 'workspace_run_v2',
    'statement_count', v_stmt_count,
    'statements_ok', v_ok_count
  );
end;
$fn$;

comment on function public.admin_sql_workspace_run_v2(text, text, boolean) is
  'SQL Workspace v2: admin-token gated multi-statement runner. CREATE/REPLACE only — never touches pg_proc.';

comment on function public.admin_sql_split_statements_v1(text) is
  'Split SQL script into statements; respects dollar-quotes, strings, comments.';

revoke all on function public.admin_sql_classify_v1(text) from public;
grant execute on function public.admin_sql_classify_v1(text)
  to anon, authenticated;

revoke all on function public.admin_sql_sql_without_literals_v1(text) from public;
grant execute on function public.admin_sql_sql_without_literals_v1(text)
  to anon, authenticated;

revoke all on function public.admin_sql_split_statements_v1(text) from public;
grant execute on function public.admin_sql_split_statements_v1(text)
  to anon, authenticated;

revoke all on function public.admin_sql_execute_v1(text, text, boolean) from public;
grant execute on function public.admin_sql_execute_v1(text, text, boolean)
  to anon, authenticated;

revoke all on function public.admin_sql_workspace_run_v2(text, text, boolean) from public;
grant execute on function public.admin_sql_workspace_run_v2(text, text, boolean)
  to anon, authenticated;
`,
      order: 10,
      bootstrap: true,
      supabaseOnce: true,
    },
    {
      id: "maint.fix_delegate_portal_path_v1",
      title: "إصلاح دخول المندوب بعد القبول (بوابة 1)",
      desc: "تفعيل/مزامنة delegates_v2 عند اعتماد طلب مندوب + request_id في check_* — مطلوب قبل إعادة اختبار بوابة 1.",
      file: "../supabase/sql/COPY-ME-fix-delegate-portal-path.sql",
      sql: `-- Operator path: Admin → SQL Workspace → أوامر الصيانة الجاهزة
-- Preset id: maint.fix_delegate_portal_path_v1
-- Source of truth file (do not prefer external paste).

-- =============================================================================
-- FIX: Delegate portal path after approve (Gate 1)
-- Safe to re-run.
--
-- Root cause:
--   1) Admin «قبول» updates approval_requests (Legacy) only — does NOT upsert
--      delegates_v2, so login (which prefers v2) is out of sync.
--   2) check_*_delegate_access v2 success omitted request_id; portal JS treated
--      that as verification failure → «تعذر التحقق من بيانات الدخول حاليًا».
--
-- This script:
--   A) Upserts/activates delegates_v2 from an approved tree/events request
--   B) Trigger: any Legacy status→approved for those kinds activates v2
--   C) Fixes check_tree/events_delegate_access to return request_id on v2
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A) Activate / upsert delegates_v2 from one approval_requests row (by pk id)
-- -----------------------------------------------------------------------------
-- NOTE: Prefer COPY-ME-delegates-v2-dual-role-activate.sql / sync-email preset
-- (includes dual-intent message → full_delegate + email sync). Kept in sync here.
create or replace function public.delegates_v2_activate_from_request_pk_v1(
  p_request_pk bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.approval_requests%rowtype;
  v_tree public.approval_requests%rowtype;
  v_events public.approval_requests%rowtype;
  v_branch text;
  v_phone text;
  v_email text;
  v_id uuid;
  v_role text;
  v_enabled boolean;
  v_hash text;
  v_name text;
  v_email_store text;
  v_msg_json jsonb;
  v_roles jsonb;
  v_tree_status text;
  v_events_status text;
  v_tree_rid text;
  v_events_rid text;
  v_dual_from_message boolean := false;
  v_marker int;
  v_json_text text;
begin
  if to_regclass('public.delegates_v2') is null then
    return jsonb_build_object('ok', false, 'reason', 'no_v2_schema');
  end if;

  if p_request_pk is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;

  select * into v_req
  from public.approval_requests
  where id = p_request_pk
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_req.kind is null
     or v_req.kind not in ('tree_delegate', 'events_delegate') then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'not_delegate_kind');
  end if;

  v_branch := public.delegates_v2_norm_branch(v_req.branch_key);
  v_phone := public.delegates_v2_norm_phone(v_req.phone);
  v_email := public.delegates_v2_norm_email(v_req.email);

  if v_branch = '' or v_phone = '' then
    return jsonb_build_object('ok', false, 'reason', 'missing_identity');
  end if;

  select * into v_tree
  from public.approval_requests r
  where r.kind = 'tree_delegate'
    and public.delegates_v2_norm_branch(r.branch_key) = v_branch
    and public.delegates_v2_norm_phone(r.phone) = v_phone
    and (
      v_email = ''
      or public.delegates_v2_norm_email(r.email) = ''
      or public.delegates_v2_norm_email(r.email) = v_email
    )
  order by r.created_at desc nulls last
  limit 1;

  select * into v_events
  from public.approval_requests r
  where r.kind = 'events_delegate'
    and public.delegates_v2_norm_branch(r.branch_key) = v_branch
    and public.delegates_v2_norm_phone(r.phone) = v_phone
    and (
      v_email = ''
      or public.delegates_v2_norm_email(r.email) = ''
      or public.delegates_v2_norm_email(r.email) = v_email
    )
  order by r.created_at desc nulls last
  limit 1;

  v_tree_status := coalesce(v_tree.status, '');
  v_events_status := coalesce(v_events.status, '');
  v_tree_rid := nullif(btrim(coalesce(v_tree.request_id, '')), '');
  v_events_rid := nullif(btrim(coalesce(v_events.request_id, '')), '');

  v_msg_json := null;
  begin
    v_marker := position('__JSON__:' in coalesce(v_req.message, ''));
    if v_marker > 0 then
      v_json_text := btrim(substring(v_req.message from v_marker + length('__JSON__:')));
      if v_json_text <> '' then
        v_msg_json := v_json_text::jsonb;
      end if;
    end if;
  exception when others then
    v_msg_json := null;
  end;

  if coalesce(v_req.status, '') = 'approved' and v_msg_json is not null then
    v_roles := coalesce(v_msg_json->'delegate_roles', '[]'::jsonb);
    if jsonb_typeof(v_roles) = 'array'
       and v_roles @> '["tree_delegate"]'::jsonb
       and v_roles @> '["events_delegate"]'::jsonb then
      v_dual_from_message := true;
      if v_tree_rid is null then
        v_tree_status := 'approved';
        v_tree_rid := nullif(btrim(coalesce(v_req.request_id, '')), '');
      elsif v_tree_status <> 'approved' and v_req.kind = 'tree_delegate' then
        v_tree_status := 'approved';
        v_tree_rid := nullif(btrim(coalesce(v_req.request_id, '')), '');
      end if;
      if v_events_rid is null then
        v_events_status := 'approved';
        v_events_rid := nullif(btrim(coalesce(v_req.request_id, '')), '');
      elsif v_events_status <> 'approved' and v_req.kind = 'events_delegate' then
        v_events_status := 'approved';
        v_events_rid := nullif(btrim(coalesce(v_req.request_id, '')), '');
      end if;
    end if;
  end if;

  v_role := public.delegates_v2_infer_role(v_tree_status, v_events_status);
  v_enabled := (v_tree_status = 'approved' or v_events_status = 'approved');
  v_hash := nullif(btrim(coalesce(
    case
      when v_req.kind = 'tree_delegate' then v_req.secret_hash
      else coalesce(v_events.secret_hash, v_tree.secret_hash, v_req.secret_hash)
    end,
    ''
  )), '');
  if v_hash is null then
    v_hash := nullif(btrim(coalesce(v_tree.secret_hash, v_events.secret_hash, '')), '');
  end if;
  v_name := nullif(btrim(coalesce(v_req.name, v_tree.name, v_events.name, '')), '');
  v_email_store := nullif(lower(btrim(coalesce(
    nullif(btrim(coalesce(v_req.email, '')), ''),
    nullif(btrim(coalesce(v_tree.email, '')), ''),
    nullif(btrim(coalesce(v_events.email, '')), ''),
    ''
  ))), '');

  select d.id into v_id
  from public.delegates_v2 d
  where public.delegates_v2_norm_branch(d.branch_key) = v_branch
    and public.delegates_v2_norm_phone(d.phone) = v_phone
    and (
      v_email = ''
      or public.delegates_v2_norm_email(d.email) = ''
      or public.delegates_v2_norm_email(d.email) = v_email
    )
  order by d.updated_at desc nulls last, d.created_at desc nulls last
  limit 1;

  if v_id is null then
    insert into public.delegates_v2 (
      branch_key, name, phone, email, secret_hash, role_key, is_enabled,
      tree_request_id, events_request_id, updated_at
    ) values (
      nullif(btrim(v_req.branch_key), ''),
      v_name,
      nullif(btrim(v_req.phone), ''),
      v_email_store,
      v_hash,
      v_role,
      v_enabled,
      v_tree_rid,
      v_events_rid,
      now()
    )
    returning id into v_id;
  else
    update public.delegates_v2 d
    set
      name = coalesce(v_name, d.name),
      email = coalesce(v_email_store, d.email),
      secret_hash = coalesce(v_hash, d.secret_hash),
      role_key = v_role,
      is_enabled = v_enabled,
      tree_request_id = coalesce(v_tree_rid, d.tree_request_id),
      events_request_id = coalesce(v_events_rid, d.events_request_id),
      updated_at = now()
    where d.id = v_id;
  end if;

  perform public.admin_audit_write_v1(
    'system',
    'approve_activate',
    'delegate.activate_from_request',
    'delegates_v2',
    v_id::text,
    nullif(btrim(v_req.branch_key), ''),
    jsonb_build_object(
      'request_pk', p_request_pk,
      'request_id', v_req.request_id,
      'kind', v_req.kind,
      'status', v_req.status,
      'role_key', v_role,
      'is_enabled', v_enabled,
      'email', v_email_store,
      'dual_from_message', v_dual_from_message,
      'at', now()
    )
  );

  return jsonb_build_object(
    'ok', true,
    'delegate_id', v_id,
    'role_key', v_role,
    'is_enabled', v_enabled,
    'has_secret', v_hash is not null,
    'dual_from_message', v_dual_from_message,
    'tree_request_id', v_tree_rid,
    'events_request_id', v_events_rid
  );
end;
$$;

-- Admin-token wrapper (callable from requests UI after قبول)
create or replace function public.admin_delegates_v2_activate_from_request_v1(
  p_token text,
  p_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pk bigint;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;
  begin
    v_pk := trim(coalesce(p_id, ''))::bigint;
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'bad_id');
  end;
  return public.delegates_v2_activate_from_request_pk_v1(v_pk);
end;
$$;

-- -----------------------------------------------------------------------------
-- B) Trigger: Legacy approve/reject of delegate kinds keeps delegates_v2 in sync
-- -----------------------------------------------------------------------------
create or replace function public.delegates_v2_approval_requests_sync_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if to_regclass('public.delegates_v2') is null then
    return new;
  end if;

  if new.kind is null
     or new.kind not in ('tree_delegate', 'events_delegate') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status in ('approved', 'rejected') then
      perform public.delegates_v2_activate_from_request_pk_v1(new.id);
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.status is distinct from old.status
       and new.status in ('approved', 'rejected') then
      perform public.delegates_v2_activate_from_request_pk_v1(new.id);
    elsif new.status = 'approved'
      and (
        new.secret_hash is distinct from old.secret_hash
        or new.phone is distinct from old.phone
        or new.branch_key is distinct from old.branch_key
      ) then
      perform public.delegates_v2_activate_from_request_pk_v1(new.id);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_delegates_v2_approval_requests_sync
  on public.approval_requests;

create trigger trg_delegates_v2_approval_requests_sync
after insert or update of status, secret_hash, phone, branch_key
on public.approval_requests
for each row
execute function public.delegates_v2_approval_requests_sync_trg();

-- Backfill: activate any already-approved delegate requests missing/outdated v2
do $$
declare
  r record;
begin
  if to_regclass('public.delegates_v2') is null then
    return;
  end if;
  for r in
    select id
    from public.approval_requests
    where kind in ('tree_delegate', 'events_delegate')
      and status = 'approved'
    order by created_at desc nulls last
    limit 2000
  loop
    perform public.delegates_v2_activate_from_request_pk_v1(r.id);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- C) check_tree_delegate_access — include request_id on v2 success (login key)
-- -----------------------------------------------------------------------------
create or replace function public.check_tree_delegate_access(
  p_branch_key text,
  p_phone text,
  p_email text,
  p_secret_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_check jsonb;
  v_ok text;
  r record;
  v_write jsonb;
  v_req_id text;
  v_phone text;
  v_email text;
begin
  v_check := public.delegate_v2_check_op_v1(
    p_branch_key, p_phone, p_email, p_secret_hash, 'tree.read'
  );
  v_ok := v_check->>'ok';

  if v_ok = 'true' then
    v_write := public.delegate_v2_check_op_v1(
      p_branch_key, p_phone, p_email, p_secret_hash, 'tree.write'
    );
    select
      nullif(btrim(coalesce(d.tree_request_id, d.events_request_id, '')), ''),
      nullif(btrim(coalesce(d.phone, '')), ''),
      nullif(btrim(coalesce(d.email, '')), '')
      into v_req_id, v_phone, v_email
    from public.delegates_v2 d
    where d.id::text = nullif(btrim(coalesce(v_check->>'delegate_id', '')), '')
    limit 1;

    return jsonb_build_object(
      'allowed', true,
      'status', 'approved',
      'source', 'v2',
      'reason', null,
      'delegate_id', v_check->>'delegate_id',
      'role_key', v_check->>'role_key',
      'branch_key', coalesce(v_check->>'branch_key', p_branch_key),
      'request_id', coalesce(v_req_id, v_check->>'delegate_id'),
      'phone', coalesce(v_phone, p_phone),
      'email', coalesce(v_email, p_email),
      'operations', jsonb_build_object(
        'tree.read', true,
        'tree.write', coalesce((v_write->>'ok')::boolean, false)
      )
    );
  end if;

  if v_ok = 'false' then
    return jsonb_build_object(
      'allowed', false,
      'status', case
        when v_check->>'reason' = 'disabled' then 'disabled'
        when v_check->>'reason' = 'bad_secret' then 'approved'
        else coalesce(v_check->>'reason', 'denied')
      end,
      'source', 'v2',
      'reason', v_check->>'reason',
      'operation_key', v_check->>'operation_key',
      'role_key', v_check->>'role_key',
      'delegate_id', v_check->>'delegate_id',
      'request_id', null
    );
  end if;

  -- Legacy path (only when no delegates_v2 row for identity)
  select request_id, status, branch_key, phone, email, secret_hash
  into r
  from public.approval_requests
  where kind = 'tree_delegate'
    and public.delegates_v2_norm_branch(branch_key)
      = public.delegates_v2_norm_branch(p_branch_key)
    and public.delegates_v2_norm_phone(phone)
      = public.delegates_v2_norm_phone(p_phone)
  order by created_at desc
  limit 1;

  if not found then
    -- events-only approved delegates: allow portal login via events.read
    v_check := public.delegate_v2_check_op_v1(
      p_branch_key, p_phone, p_email, p_secret_hash, 'events.read'
    );
    if (v_check->>'ok') = 'true' then
      select
        nullif(btrim(coalesce(d.events_request_id, d.tree_request_id, '')), ''),
        nullif(btrim(coalesce(d.phone, '')), ''),
        nullif(btrim(coalesce(d.email, '')), '')
      into v_req_id, v_phone, v_email
      from public.delegates_v2 d
      where d.id::text = nullif(btrim(coalesce(v_check->>'delegate_id', '')), '')
      limit 1;
      return jsonb_build_object(
        'allowed', true,
        'status', 'approved',
        'source', 'v2',
        'reason', null,
        'delegate_id', v_check->>'delegate_id',
        'role_key', v_check->>'role_key',
        'branch_key', coalesce(v_check->>'branch_key', p_branch_key),
        'request_id', coalesce(v_req_id, v_check->>'delegate_id'),
        'phone', coalesce(v_phone, p_phone),
        'email', coalesce(v_email, p_email),
        'operations', jsonb_build_object('tree.read', false, 'tree.write', false, 'events.read', true)
      );
    end if;

    select ar.request_id, ar.status, ar.branch_key, ar.phone, ar.email, ar.secret_hash
    into r
    from public.approval_requests ar
    where ar.kind = 'events_delegate'
      and public.delegates_v2_norm_branch(ar.branch_key)
        = public.delegates_v2_norm_branch(p_branch_key)
      and public.delegates_v2_norm_phone(ar.phone)
        = public.delegates_v2_norm_phone(p_phone)
    order by ar.created_at desc
    limit 1;

    if not found then
      return jsonb_build_object(
        'allowed', false,
        'status', 'not_found',
        'source', 'legacy',
        'reason', 'not_found'
      );
    end if;
  end if;

  if r.status <> 'approved' then
    return jsonb_build_object(
      'allowed', false,
      'status', r.status,
      'source', 'legacy',
      'reason', r.status,
      'request_id', r.request_id
    );
  end if;

  if coalesce(r.secret_hash, '') <> coalesce(p_secret_hash, '') then
    return jsonb_build_object(
      'allowed', false,
      'status', 'approved',
      'source', 'legacy',
      'reason', 'bad_secret',
      'request_id', r.request_id
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'status', 'approved',
    'source', 'legacy',
    'reason', null,
    'request_id', r.request_id,
    'branch_key', r.branch_key,
    'phone', r.phone,
    'email', r.email,
    'operations', jsonb_build_object('tree.read', true, 'tree.write', true)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- check_events_delegate_access — include request_id on v2 success
-- -----------------------------------------------------------------------------
create or replace function public.check_events_delegate_access(
  p_branch_key text,
  p_phone text,
  p_email text,
  p_secret_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_check jsonb;
  v_ok text;
  v_row record;
  v_allowed boolean := false;
  v_write jsonb;
  v_req_id text;
begin
  v_check := public.delegate_v2_check_op_v1(
    p_branch_key, p_phone, p_email, p_secret_hash, 'events.read'
  );
  v_ok := v_check->>'ok';

  if v_ok = 'true' then
    v_write := public.delegate_v2_check_op_v1(
      p_branch_key, p_phone, p_email, p_secret_hash, 'events.write'
    );
    select nullif(btrim(coalesce(d.events_request_id, d.tree_request_id, '')), '')
    into v_req_id
    from public.delegates_v2 d
    where d.id::text = nullif(btrim(coalesce(v_check->>'delegate_id', '')), '')
    limit 1;

    return jsonb_build_object(
      'allowed', true,
      'status', 'approved',
      'source', 'v2',
      'reason', null,
      'delegate_id', v_check->>'delegate_id',
      'role_key', v_check->>'role_key',
      'request_id', coalesce(v_req_id, v_check->>'delegate_id'),
      'operations', jsonb_build_object(
        'events.read', true,
        'events.write', coalesce((v_write->>'ok')::boolean, false)
      )
    );
  end if;

  if v_ok = 'false' then
    return jsonb_build_object(
      'allowed', false,
      'status', case
        when v_check->>'reason' = 'disabled' then 'disabled'
        when v_check->>'reason' = 'bad_secret' then 'approved'
        else coalesce(v_check->>'reason', 'denied')
      end,
      'source', 'v2',
      'reason', v_check->>'reason',
      'operation_key', v_check->>'operation_key',
      'role_key', v_check->>'role_key',
      'delegate_id', v_check->>'delegate_id',
      'request_id', null
    );
  end if;

  select r.request_id, r.status, r.secret_hash
  into v_row
  from public.approval_requests r
  where r.kind in ('events_delegate', 'tree_delegate')
    and public.delegates_v2_norm_branch(r.branch_key)
      = public.delegates_v2_norm_branch(p_branch_key)
    and public.delegates_v2_norm_phone(r.phone)
      = public.delegates_v2_norm_phone(p_phone)
    and (
      nullif(btrim(coalesce(p_email, '')), '') is null
      or public.delegates_v2_norm_email(r.email)
         = public.delegates_v2_norm_email(p_email)
    )
  order by r.created_at desc
  limit 1;

  if v_row.request_id is null then
    return jsonb_build_object(
      'allowed', false,
      'status', null,
      'source', 'legacy',
      'reason', 'not_found',
      'request_id', null
    );
  end if;

  if v_row.status = 'approved' then
    select public.events_delegate_allowed_legacy_v1(
      p_branch_key, p_phone, p_email, p_secret_hash
    ) into v_allowed;
  end if;

  return jsonb_build_object(
    'allowed', coalesce(v_allowed, false),
    'status', v_row.status,
    'source', 'legacy',
    'reason', case
      when coalesce(v_allowed, false) then null
      when v_row.status = 'approved' then 'bad_secret'
      else v_row.status
    end,
    'request_id', v_row.request_id
  );
end;
$$;

grant execute on function public.delegates_v2_activate_from_request_pk_v1(bigint)
  to anon, authenticated;
grant execute on function public.admin_delegates_v2_activate_from_request_v1(text, text)
  to anon, authenticated;
grant execute on function public.check_tree_delegate_access(text, text, text, text)
  to anon, authenticated;
grant execute on function public.check_events_delegate_access(text, text, text, text)
  to anon, authenticated;
`,
      order: 20,
    },
    {
      id: "maint.delegate_secret_reset_v1",
      title: "طلب إعادة تعيين الرقم السري (واجهة مخصصة)",
      desc: "نية منفصلة delegate_secret_reset + اعتماد/رفض يحدّثون الرقم السري دون كروم Workflow العام.",
      file: "../supabase/sql/COPY-ME-delegate-secret-reset.sql",
      sql: `-- Operator path: Admin → SQL Workspace → أوامر الصيانة الجاهزة
-- Preset id: maint.delegate_secret_reset_v1
-- Source of truth file (do not prefer external paste).

-- Keep this file as source of truth. Prefer Workspace over external paste.
-- =============================================================================
-- FIX: Dedicated delegate secret-reset intent (not generic Workflow chrome)
-- Safe to re-run. Operator path: Admin → SQL Workspace → أوامر الصيانة الجاهزة.
-- Source of truth for preset id: maint.delegate_secret_reset_v1
-- =============================================================================

create or replace function public.delegate_secret_reset_norm_branch(p text)
returns text language sql immutable as $$
  select regexp_replace(btrim(coalesce(p, '')), '\\s+', ' ', 'g');
$$;

create or replace function public.delegate_secret_reset_norm_phone(p text)
returns text language sql immutable as $$
  select regexp_replace(btrim(coalesce(p, '')), '\\s+', '', 'g');
$$;

create or replace function public.delegate_secret_reset_norm_email(p text)
returns text language sql immutable as $$
  select lower(regexp_replace(btrim(coalesce(p, '')), '\\s+', '', 'g'));
$$;

create or replace function public.delegate_secret_reset_submit_v1(
  p_branch_key text,
  p_phone text,
  p_email text,
  p_secret_hash text,
  p_request_id text default null,
  p_message text default null,
  p_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch text := public.delegate_secret_reset_norm_branch(p_branch_key);
  v_phone text := public.delegate_secret_reset_norm_phone(p_phone);
  v_email text := public.delegate_secret_reset_norm_email(p_email);
  v_hash text := nullif(btrim(coalesce(p_secret_hash, '')), '');
  v_req_id text := nullif(btrim(coalesce(p_request_id, '')), '');
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
  v_delegate_name text;
  v_has_identity boolean := false;
  v_pending_id text;
  v_now timestamptz := now();
  v_pk bigint;
  v_deep text;
begin
  if v_branch = '' or v_phone = '' or v_hash is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;

  if to_regclass('public.delegates_v2') is not null then
    select d.name into v_delegate_name
    from public.delegates_v2 d
    where public.delegate_secret_reset_norm_branch(d.branch_key) = v_branch
      and public.delegate_secret_reset_norm_phone(d.phone) = v_phone
      and (
        v_email = ''
        or public.delegate_secret_reset_norm_email(d.email) = ''
        or public.delegate_secret_reset_norm_email(d.email) = v_email
      )
      and coalesce(d.is_enabled, true) = true
    order by d.updated_at desc nulls last
    limit 1;
    if found then
      v_has_identity := true;
    end if;
  end if;

  if not v_has_identity then
    select r.name into v_delegate_name
    from public.approval_requests r
    where r.kind in ('tree_delegate', 'events_delegate')
      and r.status = 'approved'
      and public.delegate_secret_reset_norm_branch(r.branch_key) = v_branch
      and public.delegate_secret_reset_norm_phone(r.phone) = v_phone
      and (
        v_email = ''
        or public.delegate_secret_reset_norm_email(r.email) = ''
        or public.delegate_secret_reset_norm_email(r.email) = v_email
      )
    order by r.created_at desc nulls last
    limit 1;
    if found then
      v_has_identity := true;
    end if;
  end if;

  if not v_has_identity then
    return jsonb_build_object('ok', false, 'reason', 'not_a_delegate');
  end if;

  select r.request_id into v_pending_id
  from public.approval_requests r
  where r.kind = 'delegate_secret_reset'
    and r.status = 'pending'
    and public.delegate_secret_reset_norm_branch(r.branch_key) = v_branch
    and public.delegate_secret_reset_norm_phone(r.phone) = v_phone
  order by r.created_at desc nulls last
  limit 1;

  if v_pending_id is not null then
    return jsonb_build_object(
      'ok', false,
      'reason', 'duplicate_pending',
      'request_id', v_pending_id
    );
  end if;

  if v_req_id is null then
    v_req_id := 'SRS-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4))
      || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 5, 4));
  end if;

  if v_name is null then
    v_name := nullif(btrim(coalesce(v_delegate_name, '')), '');
  end if;

  if v_msg is null then
    v_msg := 'طلب إعادة تعيين الرقم السري للمندوب'
      || E'\\n' || 'رقم الطلب: ' || v_req_id
      || E'\\n' || 'الفرع: ' || v_branch
      || E'\\n' || 'الجوال: ' || v_phone
      || E'\\n' || 'بانتظار الإدارة';
  end if;

  if position('delegate_secret_reset' in v_msg) = 0 then
    v_msg := v_msg || E'\\n__JSON__:' || jsonb_build_object(
      'v', 1,
      'kind', 'delegate_secret_reset',
      'intent', 'secret_reset',
      'at', v_now
    )::text;
  end if;

  v_deep := 'module=requests&request=' || v_req_id;
  begin
    v_deep := public.workflow_deep_link_for_v1(v_req_id);
  exception when others then
    v_deep := 'module=requests&request=' || v_req_id;
  end;

  insert into public.approval_requests (
    request_id, kind, branch_key, name, phone, email, secret_hash,
    message, status, created_at, request_type, wf_state, wf_deep_link, wf_updated_at
  ) values (
    v_req_id,
    'delegate_secret_reset',
    nullif(btrim(p_branch_key), ''),
    v_name,
    nullif(btrim(p_phone), ''),
    nullif(lower(btrim(coalesce(p_email, ''))), ''),
    v_hash,
    v_msg,
    'pending',
    v_now,
    'delegate_secret_reset',
    null,
    v_deep,
    v_now
  )
  returning id into v_pk;

  begin
    if to_regclass('public.workflow_notification_events') is not null then
      insert into public.workflow_notification_events (
        request_id, request_pk, event_key, recipient_hint, channel, payload
      ) values (
        v_req_id, v_pk, 'secret_reset.submitted', 'admin', 'log',
        jsonb_build_object('kind', 'delegate_secret_reset', 'branch_key', v_branch, 'phone', v_phone, 'at', v_now)
      );
    end if;
  exception when others then null;
  end;

  return jsonb_build_object('ok', true, 'request_id', v_req_id, 'id', v_pk, 'name', v_name);
end;
$$;

create or replace function public.admin_delegate_secret_reset_approve_v1(
  p_token text,
  p_id text,
  p_secret_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pk bigint;
  v_req public.approval_requests%rowtype;
  v_hash text;
  v_branch text;
  v_phone text;
  v_email text;
  v_legacy_n int := 0;
  v_v2_n int := 0;
  v_delegate_id uuid;
  v_notify_channel text := 'admin_copy_only';
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  begin
    v_pk := trim(coalesce(p_id, ''))::bigint;
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'bad_id');
  end;

  select * into v_req from public.approval_requests where id = v_pk for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_req.kind is distinct from 'delegate_secret_reset' then
    return jsonb_build_object('ok', false, 'reason', 'wrong_kind');
  end if;
  if v_req.status = 'approved' then
    return jsonb_build_object('ok', true, 'already', true, 'request_id', v_req.request_id, 'notify_channel', v_notify_channel);
  end if;
  if v_req.status is distinct from 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'not_pending', 'status', v_req.status);
  end if;

  v_hash := nullif(btrim(coalesce(p_secret_hash, v_req.secret_hash, '')), '');
  if v_hash is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_secret_hash');
  end if;

  v_branch := public.delegate_secret_reset_norm_branch(v_req.branch_key);
  v_phone := public.delegate_secret_reset_norm_phone(v_req.phone);
  v_email := public.delegate_secret_reset_norm_email(v_req.email);

  update public.approval_requests r
  set secret_hash = v_hash
  where r.kind in ('tree_delegate', 'events_delegate')
    and r.status = 'approved'
    and public.delegate_secret_reset_norm_branch(r.branch_key) = v_branch
    and public.delegate_secret_reset_norm_phone(r.phone) = v_phone
    and (
      v_email = ''
      or public.delegate_secret_reset_norm_email(r.email) = ''
      or public.delegate_secret_reset_norm_email(r.email) = v_email
    );
  get diagnostics v_legacy_n = row_count;

  if to_regclass('public.delegates_v2') is not null then
    update public.delegates_v2 d
    set secret_hash = v_hash, updated_at = now()
    where public.delegate_secret_reset_norm_branch(d.branch_key) = v_branch
      and public.delegate_secret_reset_norm_phone(d.phone) = v_phone
      and (
        v_email = ''
        or public.delegate_secret_reset_norm_email(d.email) = ''
        or public.delegate_secret_reset_norm_email(d.email) = v_email
      );
    get diagnostics v_v2_n = row_count;

    select d.id into v_delegate_id
    from public.delegates_v2 d
    where public.delegate_secret_reset_norm_branch(d.branch_key) = v_branch
      and public.delegate_secret_reset_norm_phone(d.phone) = v_phone
    order by d.updated_at desc nulls last
    limit 1;
  end if;

  if v_legacy_n = 0 and v_v2_n = 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_delegate_target');
  end if;

  update public.approval_requests
  set
    status = 'approved',
    secret_hash = v_hash,
    request_type = 'delegate_secret_reset',
    wf_state = 'done',
    wf_updated_at = now()
  where id = v_pk;

  begin
    perform public.admin_audit_write_v1(
      'admin', 'admin_token', 'delegate.secret_reset_approve', 'approval_request',
      v_req.request_id, nullif(btrim(v_req.branch_key), ''),
      jsonb_build_object('request_pk', v_pk, 'legacy_updated', v_legacy_n, 'v2_updated', v_v2_n, 'delegate_id', v_delegate_id, 'at', now())
    );
  exception when others then null;
  end;

  begin
    if to_regclass('public.workflow_notification_events') is not null then
      insert into public.workflow_notification_events (
        request_id, request_pk, event_key, recipient_hint, channel, payload
      ) values (
        v_req.request_id, v_pk, 'secret_reset.approved', 'submitter', 'log',
        jsonb_build_object('kind', 'delegate_secret_reset', 'legacy_updated', v_legacy_n, 'v2_updated', v_v2_n, 'note', 'no_guaranteed_push_channel', 'at', now())
      );
      v_notify_channel := 'log';
    end if;
  exception when others then
    v_notify_channel := 'admin_copy_only';
  end;

  return jsonb_build_object(
    'ok', true,
    'request_id', v_req.request_id,
    'legacy_updated', v_legacy_n,
    'v2_updated', v_v2_n,
    'delegate_id', v_delegate_id,
    'notify_channel', v_notify_channel,
    'notify_limitation', 'لا قناة إشعار مضمونة للمندوب — انسخ الرقم السري مرة واحدة وأبلغه يدويًا إن لزم.'
  );
end;
$$;

create or replace function public.admin_delegate_secret_reset_reject_v1(
  p_token text,
  p_id text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pk bigint;
  v_req public.approval_requests%rowtype;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  begin
    v_pk := trim(coalesce(p_id, ''))::bigint;
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'bad_id');
  end;

  select * into v_req from public.approval_requests where id = v_pk for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_req.kind is distinct from 'delegate_secret_reset' then
    return jsonb_build_object('ok', false, 'reason', 'wrong_kind');
  end if;
  if v_req.status = 'rejected' then
    return jsonb_build_object('ok', true, 'already', true, 'request_id', v_req.request_id);
  end if;

  update public.approval_requests
  set
    status = 'rejected',
    request_type = 'delegate_secret_reset',
    wf_state = 'rejected',
    wf_updated_at = now(),
    message = case
      when nullif(btrim(coalesce(p_reason, '')), '') is null then message
      else coalesce(message, '') || E'\\nسبب الرفض: ' || btrim(p_reason)
    end
  where id = v_pk;

  begin
    perform public.admin_audit_write_v1(
      'admin', 'admin_token', 'delegate.secret_reset_reject', 'approval_request',
      v_req.request_id, nullif(btrim(v_req.branch_key), ''),
      jsonb_build_object('request_pk', v_pk, 'reason', nullif(btrim(coalesce(p_reason, '')), ''), 'at', now())
    );
  exception when others then null;
  end;

  begin
    if to_regclass('public.workflow_notification_events') is not null then
      insert into public.workflow_notification_events (
        request_id, request_pk, event_key, recipient_hint, channel, payload
      ) values (
        v_req.request_id, v_pk, 'secret_reset.rejected', 'submitter', 'log',
        jsonb_build_object('kind', 'delegate_secret_reset', 'at', now())
      );
    end if;
  exception when others then null;
  end;

  return jsonb_build_object('ok', true, 'request_id', v_req.request_id);
end;
$$;

create or replace function public.admin_workflow_next_states_v1(
  p_token text,
  p_request_ref text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pk bigint;
  v_row public.approval_requests%rowtype;
  v_from text;
  v_next text[];
  v_type text;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  v_pk := public.workflow_resolve_request_pk_v1(p_request_ref);
  if v_pk is null then
    return jsonb_build_object('ok', false, 'code', 'WF-001', 'next', '[]'::jsonb);
  end if;

  select * into v_row from public.approval_requests where id = v_pk;
  v_type := coalesce(nullif(btrim(v_row.request_type), ''), v_row.kind);

  if v_type = 'delegate_secret_reset' or v_row.kind = 'delegate_secret_reset' then
    return jsonb_build_object(
      'ok', true,
      'dedicated_ui', true,
      'intent', 'delegate_secret_reset',
      'label_ar', 'طلب إعادة تعيين الرقم السري',
      'wf_state', coalesce(nullif(btrim(v_row.wf_state), ''), v_row.status),
      'next', '[]'::jsonb,
      'hint_ar', 'استخدم بطاقة إعادة التعيين في جدول الطلبات (اعتماد / رفض) — ليست مسار الشجرة أو المناسبات.'
    );
  end if;

  v_from := coalesce(
    nullif(btrim(v_row.wf_state), ''),
    public.workflow_infer_state_from_legacy_v1(v_row.status)
  );

  v_next := case v_from
    when 'submitted' then array['assigned']
    when 'assigned' then array['in_review']
    when 'in_review' then array['needs_changes', 'approved', 'rejected']
    when 'needs_changes' then array['in_review']
    when 'approved' then array['applied']
    when 'applied' then array['done']
    else array[]::text[]
  end;

  return jsonb_build_object('ok', true, 'wf_state', v_from, 'next', to_jsonb(v_next));
end;
$$;

create or replace function public.admin_workflow_backfill_v1(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int := 0;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  update public.approval_requests r
  set
    wf_state = public.workflow_infer_state_from_legacy_v1(r.status),
    wf_deep_link = coalesce(
      nullif(btrim(r.wf_deep_link), ''),
      public.workflow_deep_link_for_v1(r.request_id)
    ),
    request_type = coalesce(nullif(btrim(r.request_type), ''), r.kind),
    wf_updated_at = coalesce(r.wf_updated_at, now())
  where nullif(btrim(coalesce(r.wf_state, '')), '') is null
    and coalesce(r.kind, '') is distinct from 'delegate_secret_reset'
    and coalesce(r.request_type, '') is distinct from 'delegate_secret_reset';

  get diagnostics v_n = row_count;

  update public.approval_requests r
  set
    request_type = 'delegate_secret_reset',
    wf_deep_link = coalesce(
      nullif(btrim(r.wf_deep_link), ''),
      public.workflow_deep_link_for_v1(r.request_id)
    )
  where r.kind = 'delegate_secret_reset'
    and (
      nullif(btrim(coalesce(r.request_type, '')), '') is null
      or r.request_type is distinct from 'delegate_secret_reset'
    );

  begin
    perform public.admin_audit_write_v1(
      'admin', 'admin_token', 'workflow.backfill', 'approval_request', null, null,
      jsonb_build_object('updated', v_n, 'skipped_kind', 'delegate_secret_reset')
    );
  exception when others then null;
  end;

  return jsonb_build_object('ok', true, 'updated', v_n);
end;
$$;

grant execute on function public.delegate_secret_reset_submit_v1(text, text, text, text, text, text, text)
  to anon, authenticated;
grant execute on function public.admin_delegate_secret_reset_approve_v1(text, text, text)
  to anon, authenticated;
grant execute on function public.admin_delegate_secret_reset_reject_v1(text, text, text)
  to anon, authenticated;
grant execute on function public.admin_workflow_next_states_v1(text, text)
  to anon, authenticated;
grant execute on function public.admin_workflow_backfill_v1(text)
  to anon, authenticated;
`,
      order: 30,
    },
    {
      id: "maint.delegates_v2_dual_role_activate_v1",
      title: "مندوب شجرة+مناسبات → full_delegate",
      desc: "إصلاح تفعيل المندوب عند طلب الصلاحيتين معًا (قراءة delegate_roles من الرسالة). إعادة التفعيل محصورة بهيثم/مزيد/0558516818/REQ-1X7P-WIVV فقط — لا تمس مناديب آخرين.",
      file: "../supabase/sql/COPY-ME-delegates-v2-dual-role-activate.sql",
      sql: `-- =============================================================================
-- COPY-ME: dual tree+events delegate → full_delegate on activate
-- Preset id: maint.delegates_v2_dual_role_activate_v1
-- Safe to re-run.
--
-- Workspace shape (IMPORTANT — keep at 2 statements):
--   1) CREATE OR REPLACE activate function (schema only; no row mutations)
--   2) ONE SELECT: reactivate ONLY هيثم / مزيد / 0558516818 / REQ-1X7P-WIVV
--
-- Scope: command 2 touches THAT identity only (phone AND branch AND request_id).
-- No DO blocks. No loops over other approved delegates.
--
-- Root cause:
--   HTML «إرسال الطلب» inserted ONE approval_requests row with kind=tree_delegate
--   when both roles were checked (delegate_roles only in message JSON).
--   Activate looked only for a sibling kind=events_delegate row → none →
--   events_request_id=null → delegates_v2_infer_role → branch_editor (no events.write).
-- =============================================================================

create or replace function public.delegates_v2_activate_from_request_pk_v1(
  p_request_pk bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $alz_dual$
declare
  v_req public.approval_requests%rowtype;
  v_tree public.approval_requests%rowtype;
  v_events public.approval_requests%rowtype;
  v_branch text;
  v_phone text;
  v_email text;
  v_id uuid;
  v_role text;
  v_enabled boolean;
  v_hash text;
  v_name text;
  v_email_store text;
  v_msg_json jsonb;
  v_roles jsonb;
  v_tree_status text;
  v_events_status text;
  v_tree_rid text;
  v_events_rid text;
  v_dual_from_message boolean := false;
  v_marker int;
  v_json_text text;
begin
  if to_regclass('public.delegates_v2') is null then
    return jsonb_build_object('ok', false, 'reason', 'no_v2_schema');
  end if;

  if p_request_pk is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;

  select * into v_req
  from public.approval_requests
  where id = p_request_pk
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_req.kind is null
     or v_req.kind not in ('tree_delegate', 'events_delegate') then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'not_delegate_kind');
  end if;

  v_branch := public.delegates_v2_norm_branch(v_req.branch_key);
  v_phone := public.delegates_v2_norm_phone(v_req.phone);
  v_email := public.delegates_v2_norm_email(v_req.email);

  if v_branch = '' or v_phone = '' then
    return jsonb_build_object('ok', false, 'reason', 'missing_identity');
  end if;

  -- Latest tree + events rows for same identity (role inference)
  select * into v_tree
  from public.approval_requests r
  where r.kind = 'tree_delegate'
    and public.delegates_v2_norm_branch(r.branch_key) = v_branch
    and public.delegates_v2_norm_phone(r.phone) = v_phone
    and (
      v_email = ''
      or public.delegates_v2_norm_email(r.email) = ''
      or public.delegates_v2_norm_email(r.email) = v_email
    )
  order by r.created_at desc nulls last
  limit 1;

  select * into v_events
  from public.approval_requests r
  where r.kind = 'events_delegate'
    and public.delegates_v2_norm_branch(r.branch_key) = v_branch
    and public.delegates_v2_norm_phone(r.phone) = v_phone
    and (
      v_email = ''
      or public.delegates_v2_norm_email(r.email) = ''
      or public.delegates_v2_norm_email(r.email) = v_email
    )
  order by r.created_at desc nulls last
  limit 1;

  v_tree_status := coalesce(v_tree.status, '');
  v_events_status := coalesce(v_events.status, '');
  v_tree_rid := nullif(btrim(coalesce(v_tree.request_id, '')), '');
  v_events_rid := nullif(btrim(coalesce(v_events.request_id, '')), '');

  -- Dual-intent fallback: one approved row whose message lists both roles,
  -- and the missing kind has no sibling approval_requests row.
  v_msg_json := null;
  v_roles := null;
  begin
    v_marker := position('__JSON__:' in coalesce(v_req.message, ''));
    if v_marker > 0 then
      v_json_text := btrim(substring(v_req.message from v_marker + length('__JSON__:')));
      if v_json_text <> '' then
        v_msg_json := v_json_text::jsonb;
      end if;
    end if;
  exception when others then
    v_msg_json := null;
  end;

  if coalesce(v_req.status, '') = 'approved' and v_msg_json is not null then
    v_roles := coalesce(v_msg_json->'delegate_roles', '[]'::jsonb);
    if jsonb_typeof(v_roles) = 'array'
       and v_roles @> '["tree_delegate"]'::jsonb
       and v_roles @> '["events_delegate"]'::jsonb then
      v_dual_from_message := true;
      if v_tree_rid is null then
        v_tree_status := 'approved';
        v_tree_rid := nullif(btrim(coalesce(v_req.request_id, '')), '');
      elsif v_tree_status <> 'approved' and v_req.kind = 'tree_delegate' then
        v_tree_status := 'approved';
        v_tree_rid := nullif(btrim(coalesce(v_req.request_id, '')), '');
      end if;
      if v_events_rid is null then
        v_events_status := 'approved';
        v_events_rid := nullif(btrim(coalesce(v_req.request_id, '')), '');
      elsif v_events_status <> 'approved' and v_req.kind = 'events_delegate' then
        v_events_status := 'approved';
        v_events_rid := nullif(btrim(coalesce(v_req.request_id, '')), '');
      end if;
    end if;
  end if;

  v_role := public.delegates_v2_infer_role(v_tree_status, v_events_status);
  v_enabled := (
    v_tree_status = 'approved'
    or v_events_status = 'approved'
  );
  v_hash := nullif(btrim(coalesce(
    case
      when v_req.kind = 'tree_delegate' then v_req.secret_hash
      else coalesce(v_events.secret_hash, v_tree.secret_hash, v_req.secret_hash)
    end,
    ''
  )), '');
  if v_hash is null then
    v_hash := nullif(btrim(coalesce(v_tree.secret_hash, v_events.secret_hash, '')), '');
  end if;
  v_name := nullif(btrim(coalesce(v_req.name, v_tree.name, v_events.name, '')), '');
  v_email_store := nullif(lower(btrim(coalesce(
    nullif(btrim(coalesce(v_req.email, '')), ''),
    nullif(btrim(coalesce(v_tree.email, '')), ''),
    nullif(btrim(coalesce(v_events.email, '')), ''),
    ''
  ))), '');

  select d.id into v_id
  from public.delegates_v2 d
  where public.delegates_v2_norm_branch(d.branch_key) = v_branch
    and public.delegates_v2_norm_phone(d.phone) = v_phone
    and (
      v_email = ''
      or public.delegates_v2_norm_email(d.email) = ''
      or public.delegates_v2_norm_email(d.email) = v_email
    )
  order by d.updated_at desc nulls last, d.created_at desc nulls last
  limit 1;

  if v_id is null then
    insert into public.delegates_v2 (
      branch_key, name, phone, email, secret_hash, role_key, is_enabled,
      tree_request_id, events_request_id, updated_at
    ) values (
      nullif(btrim(v_req.branch_key), ''),
      v_name,
      nullif(btrim(v_req.phone), ''),
      v_email_store,
      v_hash,
      v_role,
      v_enabled,
      v_tree_rid,
      v_events_rid,
      now()
    )
    returning id into v_id;
  else
    update public.delegates_v2 d
    set
      name = coalesce(v_name, d.name),
      email = coalesce(v_email_store, d.email),
      secret_hash = coalesce(v_hash, d.secret_hash),
      role_key = v_role,
      is_enabled = v_enabled,
      tree_request_id = coalesce(v_tree_rid, d.tree_request_id),
      events_request_id = coalesce(v_events_rid, d.events_request_id),
      updated_at = now()
    where d.id = v_id;
  end if;

  begin
    perform public.admin_audit_write_v1(
      'system',
      'approve_activate',
      'delegate.activate_from_request',
      'delegates_v2',
      v_id::text,
      nullif(btrim(v_req.branch_key), ''),
      jsonb_build_object(
        'request_pk', p_request_pk,
        'request_id', v_req.request_id,
        'kind', v_req.kind,
        'status', v_req.status,
        'role_key', v_role,
        'is_enabled', v_enabled,
        'email', v_email_store,
        'dual_from_message', v_dual_from_message,
        'at', now()
      )
    );
  exception when others then
    null;
  end;

  return jsonb_build_object(
    'ok', true,
    'delegate_id', v_id,
    'role_key', v_role,
    'is_enabled', v_enabled,
    'has_secret', v_hash is not null,
    'dual_from_message', v_dual_from_message,
    'tree_request_id', v_tree_rid,
    'events_request_id', v_events_rid
  );
end;
$alz_dual$;

-- Haitham-only reactivation (no helper fn, no DO, no mass loop)
select jsonb_build_object(
  'ok', true,
  'scope', 'haitham_only',
  'request_id', 'REQ-1X7P-WIVV',
  'branch', 'مزيد',
  'phone', '0558516818',
  'activate', (
    select public.delegates_v2_activate_from_request_pk_v1(r.id)
    from public.approval_requests r
    where r.request_id = 'REQ-1X7P-WIVV'
      and r.kind in ('tree_delegate', 'events_delegate')
      and public.delegates_v2_norm_phone(r.phone) in ('0558516818', '558516818')
      and public.delegates_v2_norm_branch(r.branch_key) = 'مزيد'
    order by r.created_at desc nulls last
    limit 1
  ),
  'spot_check', (
    select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb)
    from (
      select
        id,
        branch_key,
        phone,
        role_key,
        is_enabled,
        tree_request_id,
        events_request_id,
        updated_at
      from public.delegates_v2
      where public.delegates_v2_norm_phone(phone) in ('0558516818', '558516818')
        and public.delegates_v2_norm_branch(branch_key) = 'مزيد'
      order by updated_at desc nulls last
      limit 5
    ) d
  )
) as repair_result;
`,
      order: 21,
    },
    {
      id: "maint.delegates_v2_sync_email_v1",
      title: "مزامنة بريد المندوب عند الاعتماد (delegates_v2)",
      desc: "عند اعتماد طلب مندوب يُنسخ email من approval_requests إلى delegates_v2 — مطلوب لإشعارات طلبات الفرع. SQL مضمّن — لا يعتمد على fetch لملف gitignored. يشمل أيضًا إصلاح dual tree+events → full_delegate.",
      // Inline SQL (*.sql is gitignored — fetch from localhost may 404 on some trees).
      file: "../supabase/sql/COPY-ME-delegates-v2-sync-email.sql",
      sql: `-- =============================================================================
-- COPY-ME: sync email onto delegates_v2 on approve/update (optional)
-- email column already exists — no ADD COLUMN needed.
-- Safe to re-run. Enables private branch-delegate email notify.
-- =============================================================================

create or replace function public.delegates_v2_activate_from_request_pk_v1(
  p_request_pk bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.approval_requests%rowtype;
  v_tree public.approval_requests%rowtype;
  v_events public.approval_requests%rowtype;
  v_branch text;
  v_phone text;
  v_email text;
  v_id uuid;
  v_role text;
  v_enabled boolean;
  v_hash text;
  v_name text;
  v_email_store text;
  v_msg_json jsonb;
  v_roles jsonb;
  v_tree_status text;
  v_events_status text;
  v_tree_rid text;
  v_events_rid text;
  v_dual_from_message boolean := false;
  v_marker int;
  v_json_text text;
begin
  if to_regclass('public.delegates_v2') is null then
    return jsonb_build_object('ok', false, 'reason', 'no_v2_schema');
  end if;

  if p_request_pk is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;

  select * into v_req
  from public.approval_requests
  where id = p_request_pk
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_req.kind is null
     or v_req.kind not in ('tree_delegate', 'events_delegate') then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'not_delegate_kind');
  end if;

  v_branch := public.delegates_v2_norm_branch(v_req.branch_key);
  v_phone := public.delegates_v2_norm_phone(v_req.phone);
  v_email := public.delegates_v2_norm_email(v_req.email);

  if v_branch = '' or v_phone = '' then
    return jsonb_build_object('ok', false, 'reason', 'missing_identity');
  end if;

  -- Latest tree + events rows for same identity (role inference)
  select * into v_tree
  from public.approval_requests r
  where r.kind = 'tree_delegate'
    and public.delegates_v2_norm_branch(r.branch_key) = v_branch
    and public.delegates_v2_norm_phone(r.phone) = v_phone
    and (
      v_email = ''
      or public.delegates_v2_norm_email(r.email) = ''
      or public.delegates_v2_norm_email(r.email) = v_email
    )
  order by r.created_at desc nulls last
  limit 1;

  select * into v_events
  from public.approval_requests r
  where r.kind = 'events_delegate'
    and public.delegates_v2_norm_branch(r.branch_key) = v_branch
    and public.delegates_v2_norm_phone(r.phone) = v_phone
    and (
      v_email = ''
      or public.delegates_v2_norm_email(r.email) = ''
      or public.delegates_v2_norm_email(r.email) = v_email
    )
  order by r.created_at desc nulls last
  limit 1;

  v_tree_status := coalesce(v_tree.status, '');
  v_events_status := coalesce(v_events.status, '');
  v_tree_rid := nullif(btrim(coalesce(v_tree.request_id, '')), '');
  v_events_rid := nullif(btrim(coalesce(v_events.request_id, '')), '');

  -- Dual-intent fallback: one approved row whose message lists both roles,
  -- and the missing kind has no sibling approval_requests row.
  v_msg_json := null;
  v_roles := null;
  begin
    v_marker := position('__JSON__:' in coalesce(v_req.message, ''));
    if v_marker > 0 then
      v_json_text := btrim(substring(v_req.message from v_marker + length('__JSON__:')));
      if v_json_text <> '' then
        v_msg_json := v_json_text::jsonb;
      end if;
    end if;
  exception when others then
    v_msg_json := null;
  end;

  if coalesce(v_req.status, '') = 'approved' and v_msg_json is not null then
    v_roles := coalesce(v_msg_json->'delegate_roles', '[]'::jsonb);
    if jsonb_typeof(v_roles) = 'array'
       and v_roles @> '["tree_delegate"]'::jsonb
       and v_roles @> '["events_delegate"]'::jsonb then
      v_dual_from_message := true;
      if v_tree_rid is null then
        v_tree_status := 'approved';
        v_tree_rid := nullif(btrim(coalesce(v_req.request_id, '')), '');
      elsif v_tree_status <> 'approved' and v_req.kind = 'tree_delegate' then
        v_tree_status := 'approved';
        v_tree_rid := nullif(btrim(coalesce(v_req.request_id, '')), '');
      end if;
      if v_events_rid is null then
        v_events_status := 'approved';
        v_events_rid := nullif(btrim(coalesce(v_req.request_id, '')), '');
      elsif v_events_status <> 'approved' and v_req.kind = 'events_delegate' then
        v_events_status := 'approved';
        v_events_rid := nullif(btrim(coalesce(v_req.request_id, '')), '');
      end if;
    end if;
  end if;

  v_role := public.delegates_v2_infer_role(v_tree_status, v_events_status);
  v_enabled := (
    v_tree_status = 'approved'
    or v_events_status = 'approved'
  );
  v_hash := nullif(btrim(coalesce(
    case
      when v_req.kind = 'tree_delegate' then v_req.secret_hash
      else coalesce(v_events.secret_hash, v_tree.secret_hash, v_req.secret_hash)
    end,
    ''
  )), '');
  if v_hash is null then
    v_hash := nullif(btrim(coalesce(v_tree.secret_hash, v_events.secret_hash, '')), '');
  end if;
  v_name := nullif(btrim(coalesce(v_req.name, v_tree.name, v_events.name, '')), '');
  v_email_store := nullif(lower(btrim(coalesce(
    nullif(btrim(coalesce(v_req.email, '')), ''),
    nullif(btrim(coalesce(v_tree.email, '')), ''),
    nullif(btrim(coalesce(v_events.email, '')), ''),
    ''
  ))), '');

  select d.id into v_id
  from public.delegates_v2 d
  where public.delegates_v2_norm_branch(d.branch_key) = v_branch
    and public.delegates_v2_norm_phone(d.phone) = v_phone
    and (
      v_email = ''
      or public.delegates_v2_norm_email(d.email) = ''
      or public.delegates_v2_norm_email(d.email) = v_email
    )
  order by d.updated_at desc nulls last, d.created_at desc nulls last
  limit 1;

  if v_id is null then
    insert into public.delegates_v2 (
      branch_key, name, phone, email, secret_hash, role_key, is_enabled,
      tree_request_id, events_request_id, updated_at
    ) values (
      nullif(btrim(v_req.branch_key), ''),
      v_name,
      nullif(btrim(v_req.phone), ''),
      v_email_store,
      v_hash,
      v_role,
      v_enabled,
      v_tree_rid,
      v_events_rid,
      now()
    )
    returning id into v_id;
  else
    update public.delegates_v2 d
    set
      name = coalesce(v_name, d.name),
      email = coalesce(v_email_store, d.email),
      secret_hash = coalesce(v_hash, d.secret_hash),
      role_key = v_role,
      is_enabled = v_enabled,
      tree_request_id = coalesce(v_tree_rid, d.tree_request_id),
      events_request_id = coalesce(v_events_rid, d.events_request_id),
      updated_at = now()
    where d.id = v_id;
  end if;

  perform public.admin_audit_write_v1(
    'system',
    'approve_activate',
    'delegate.activate_from_request',
    'delegates_v2',
    v_id::text,
    nullif(btrim(v_req.branch_key), ''),
    jsonb_build_object(
      'request_pk', p_request_pk,
      'request_id', v_req.request_id,
      'kind', v_req.kind,
      'status', v_req.status,
      'role_key', v_role,
      'is_enabled', v_enabled,
      'email', v_email_store,
      'dual_from_message', v_dual_from_message,
      'at', now()
    )
  );

  return jsonb_build_object(
    'ok', true,
    'delegate_id', v_id,
    'role_key', v_role,
    'is_enabled', v_enabled,
    'has_secret', v_hash is not null,
    'dual_from_message', v_dual_from_message,
    'tree_request_id', v_tree_rid,
    'events_request_id', v_events_rid
  );
end;
$$;

create or replace function public.delegates_v2_approval_requests_sync_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if to_regclass('public.delegates_v2') is null then
    return new;
  end if;

  if new.kind is null
     or new.kind not in ('tree_delegate', 'events_delegate') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status in ('approved', 'rejected') then
      perform public.delegates_v2_activate_from_request_pk_v1(new.id);
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.status is distinct from old.status
       and new.status in ('approved', 'rejected') then
      perform public.delegates_v2_activate_from_request_pk_v1(new.id);
    elsif new.status = 'approved'
      and (
        new.secret_hash is distinct from old.secret_hash
        or new.phone is distinct from old.phone
        or new.branch_key is distinct from old.branch_key
        or new.email is distinct from old.email
      ) then
      perform public.delegates_v2_activate_from_request_pk_v1(new.id);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_delegates_v2_approval_requests_sync
  on public.approval_requests;

create trigger trg_delegates_v2_approval_requests_sync
after insert or update of status, secret_hash, phone, branch_key, email
on public.approval_requests
for each row
execute function public.delegates_v2_approval_requests_sync_trg();
`,
      order: 31,
      supabaseOnce: true,
    },
    {
      id: "maint.delegates_v2_set_enabled_fix_v1",
      title: "إصلاح تفعيل/تعطيل المندوب (لا يُلغى)",
      desc: "يصلح زر تفعيل المندوب المعطّل: يزامن كل طلبات الهوية ويعيد تثبيت is_enabled بعد الـ trigger حتى لا يبقى الحساب معطّلاً.",
      file: "../supabase/sql/COPY-ME-delegates-v2-set-enabled-fix.sql",
      sql: `-- =============================================================================
-- COPY-ME: fix admin_delegates_v2_set_enabled_v1 (تفعيل/تعطيل لا يُلغى)
-- Preset id: maint.delegates_v2_set_enabled_fix_v1
-- Safe to re-run. Schema only — no row mutations in this file.
-- =============================================================================

create or replace function public.admin_delegates_v2_set_enabled_v1(
  p_token text,
  p_id uuid,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.delegates_v2%rowtype;
  v_status text;
  v_branch text;
  v_phone text;
  v_email text;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;
  if p_id is null then
    raise exception 'id required';
  end if;

  select * into v_row from public.delegates_v2 where id = p_id for update;
  if not found then
    raise exception 'delegate not found';
  end if;

  v_status := case when coalesce(p_enabled, false) then 'approved' else 'rejected' end;
  v_branch := regexp_replace(btrim(coalesce(v_row.branch_key, '')), '\\s+', ' ', 'g');
  v_phone := regexp_replace(btrim(coalesce(v_row.phone, '')), '\\s+', '', 'g');
  v_email := lower(regexp_replace(btrim(coalesce(v_row.email, '')), '\\s+', '', 'g'));

  if nullif(btrim(coalesce(v_row.tree_request_id, '')), '') is not null then
    update public.approval_requests
    set status = v_status
    where request_id = v_row.tree_request_id
      and kind = 'tree_delegate';
  end if;

  if nullif(btrim(coalesce(v_row.events_request_id, '')), '') is not null then
    update public.approval_requests
    set status = v_status
    where request_id = v_row.events_request_id
      and kind = 'events_delegate';
  end if;

  if nullif(v_branch, '') is not null and nullif(v_phone, '') is not null then
    update public.approval_requests r
    set status = v_status
    where r.kind in ('tree_delegate', 'events_delegate')
      and regexp_replace(btrim(coalesce(r.branch_key, '')), '\\s+', ' ', 'g') = v_branch
      and regexp_replace(btrim(coalesce(r.phone, '')), '\\s+', '', 'g') = v_phone
      and (
        v_email = ''
        or lower(regexp_replace(btrim(coalesce(r.email, '')), '\\s+', '', 'g')) = ''
        or lower(regexp_replace(btrim(coalesce(r.email, '')), '\\s+', '', 'g')) = v_email
      );
  end if;

  update public.delegates_v2
  set is_enabled = coalesce(p_enabled, false),
      updated_at = now()
  where id = p_id;

  perform public.admin_audit_write_v1(
    'admin', null,
    case when coalesce(p_enabled, false) then 'delegate.enable' else 'delegate.disable' end,
    'delegates_v2', p_id::text, v_row.branch_key,
    jsonb_build_object(
      'enabled', coalesce(p_enabled, false),
      'role_key', v_row.role_key,
      'phone', v_row.phone,
      'email', v_row.email,
      'at', now()
    )
  );

  return jsonb_build_object(
    'ok', true,
    'id', p_id,
    'is_enabled', coalesce(p_enabled, false)
  );
end;
$$;

grant execute on function public.admin_delegates_v2_set_enabled_v1(text, uuid, boolean)
  to anon, authenticated;
`,
      order: 31.5,
      supabaseOnce: true,
    },
    {
      id: "maint.delegates_v2_backfill_emails_v1",
      title: "تعبئة بريد المناديب من طلبات الاعتماد",
      desc: "ينسخ email من approval_requests (معتمد) إلى delegates_v2 عندما يكون بريد المندوب فارغًا — مطلوب إن ظهر البريد في الواجهة فقط دون الحفظ في القاعدة. ليس توسيع صلاحيات طلبات الفرع.",
      file: "../supabase/sql/COPY-ME-delegates-v2-backfill-emails.sql",
      sql: `-- COPY-ME: backfill delegates_v2.email from approved approval_requests
-- Safe to re-run. Only fills empty/null emails — does not overwrite existing.
-- NOTE: must start with UPDATE (not WITH) so SQL Workspace classify treats it as mutate
-- (WITH…UPDATE was mis-read as SELECT and wrapped → fail at statement 1).

update public.delegates_v2 d
set email = s.email,
    updated_at = now()
from (
  select distinct on (
    public.delegates_v2_norm_branch(r.branch_key),
    public.delegates_v2_norm_phone(r.phone)
  )
    public.delegates_v2_norm_branch(r.branch_key) as branch_key,
    public.delegates_v2_norm_phone(r.phone) as phone,
    public.delegates_v2_norm_email(r.email) as email
  from public.approval_requests r
  where r.status = 'approved'
    and r.kind in ('tree_delegate', 'events_delegate')
    and nullif(public.delegates_v2_norm_email(r.email), '') is not null
  order by
    public.delegates_v2_norm_branch(r.branch_key),
    public.delegates_v2_norm_phone(r.phone),
    r.created_at desc nulls last
) s
where public.delegates_v2_norm_branch(d.branch_key) = s.branch_key
  and public.delegates_v2_norm_phone(d.phone) = s.phone
  and coalesce(d.is_enabled, false) is true
  and nullif(public.delegates_v2_norm_email(d.email), '') is null;

-- تحقق سريع لفرع مزيد
select id, branch_key, phone, email, is_enabled, role_key, updated_at
from public.delegates_v2
where public.delegates_v2_norm_branch(branch_key) = 'مزيد'
order by updated_at desc nulls last;
`,
      order: 33,
      supabaseOnce: true,
    },
    {
      id: "maint.delegate_list_branch_requests_v2c",
      title: "إظهار اسم المندوب في الترحيب + تثبيت القائمة",
      desc:
        "يملأ الاسم الفارغ من طلب اعتماد المندوب، ويحسّن إرجاع delegate_name مع قائمة الطلبات. شغّله مرة ثم أعد دخول المندوب.",
      file: "../supabase/sql/COPY-ME-delegate-list-branch-requests-v2.sql",
      sql: `-- COPY-ME: Delegate branch inbox v2b — auth mirrors login (check_*_delegate_access)
-- Preset id: maint.delegate_list_branch_requests_v2b
-- Fixes: auth=false while portal login succeeds (phone/email find mismatch).
-- Safe to re-run.

-- Backfill empty delegates_v2.name from approved delegate requests (same branch+phone).
update public.delegates_v2 d
set
  name = s.req_name,
  updated_at = now()
from (
  select
    public.delegates_v2_norm_branch(r.branch_key) as bkey,
    public.delegates_v2_norm_phone(r.phone) as pkey,
    nullif(btrim(coalesce(r.name, '')), '') as req_name
  from public.approval_requests r
  where r.kind in ('tree_delegate', 'events_delegate')
    and r.status = 'approved'
    and nullif(btrim(coalesce(r.name, '')), '') is not null
) s
where public.delegates_v2_norm_branch(d.branch_key) = s.bkey
  and public.delegates_v2_norm_phone(d.phone) = s.pkey
  and nullif(btrim(coalesce(d.name, '')), '') is null
  and s.req_name is not null;

create or replace function public.delegate_list_branch_requests_v2(
  p_branch_key text,
  p_phone text,
  p_email text,
  p_secret_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch text := public.delegates_v2_norm_branch(p_branch_key);
  v_hash text := nullif(btrim(coalesce(p_secret_hash, '')), '');
  v_email text := public.delegates_v2_norm_email(p_email);
  v_phone_raw text := nullif(btrim(coalesce(p_phone, '')), '');
  v_digits text := public.delegates_v2_norm_phone(p_phone);
  v_auth boolean := false;
  v_name text := null;
  v_rows jsonb := '[]'::jsonb;
  v_count int := 0;
  v_try_phone text;
  v_check jsonb;
  v_del public.delegates_v2%rowtype;
  v_phones text[];
  i int;
begin
  if v_branch is null or v_branch = '' or v_hash is null then
    return jsonb_build_object(
      'ok', true, 'auth', false, 'count', 0, 'delegate_name', null, 'rows', '[]'::jsonb,
      'reason', 'missing_credentials'
    );
  end if;

  -- Same phone variants the portal login tries (E.164 / local / 966).
  v_phones := array[]::text[];
  if v_phone_raw is not null then
    v_phones := array_append(v_phones, v_phone_raw);
  end if;
  if v_digits is not null and v_digits <> '' then
    v_phones := array_append(v_phones, v_digits);
    if length(v_digits) = 9 and left(v_digits, 1) = '5' then
      v_phones := v_phones || array['0' || v_digits, '966' || v_digits, '+966' || v_digits];
    elsif length(v_digits) = 10 and left(v_digits, 2) = '05' then
      v_phones := v_phones || array[substr(v_digits, 2), '966' || substr(v_digits, 2), '+966' || substr(v_digits, 2)];
    elsif length(v_digits) = 12 and left(v_digits, 3) = '966' then
      v_phones := v_phones || array['0' || substr(v_digits, 4), substr(v_digits, 4), '+' || v_digits];
    elsif length(v_digits) = 13 and left(v_digits, 4) = '9665' then
      v_phones := v_phones || array['0' || substr(v_digits, 4), substr(v_digits, 4)];
    end if;
  end if;

  -- Dedupe while preserving order
  select coalesce(array_agg(x order by ord), array[]::text[])
    into v_phones
  from (
    select x, min(ord) as ord
    from unnest(v_phones) with ordinality as u(x, ord)
    where nullif(btrim(x), '') is not null
    group by x
  ) s;

  for i in 1 .. coalesce(array_length(v_phones, 1), 0) loop
    v_try_phone := v_phones[i];

    -- Mirror portal login: check_tree_delegate_access / check_events_delegate_access
    begin
      v_check := public.check_tree_delegate_access(
        p_branch_key, v_try_phone, coalesce(p_email, ''), v_hash
      );
      if coalesce((v_check->>'allowed')::boolean, false) is true then
        v_auth := true;
        exit;
      end if;
    exception when others then
      null;
    end;

    begin
      v_check := public.check_events_delegate_access(
        p_branch_key, v_try_phone, coalesce(p_email, ''), v_hash
      );
      if coalesce((v_check->>'allowed')::boolean, false) is true then
        v_auth := true;
        exit;
      end if;
    exception when others then
      null;
    end;

    -- Soft find (ignore email mismatch): phone+branch+hash
    begin
      select d.*
        into v_del
      from public.delegates_v2 d
      where public.delegates_v2_norm_branch(d.branch_key) = v_branch
        and public.delegates_v2_norm_phone(d.phone) = public.delegates_v2_norm_phone(v_try_phone)
        and nullif(btrim(coalesce(d.secret_hash, '')), '') is not null
        and d.secret_hash = v_hash
        and coalesce(d.is_enabled, false) is true
      order by d.updated_at desc nulls last
      limit 1;
      if found then
        v_auth := true;
        v_name := nullif(btrim(coalesce(v_del.name, '')), '');
        exit;
      end if;
    exception when others then
      null;
    end;
  end loop;

  if not v_auth then
    return jsonb_build_object(
      'ok', true, 'auth', false, 'count', 0, 'delegate_name', null, 'rows', '[]'::jsonb,
      'reason', 'not_allowed',
      'hint', 'login_ok_but_list_auth_failed_try_relogin'
    );
  end if;

  -- Resolve display name aggressively (secret → phone → branch request).
  if v_name is null then
    begin
      select nullif(btrim(coalesce(d.name, '')), '')
        into v_name
      from public.delegates_v2 d
      where public.delegates_v2_norm_branch(d.branch_key) = v_branch
        and d.secret_hash = v_hash
        and coalesce(d.is_enabled, false) is true
      order by d.updated_at desc nulls last
      limit 1;
    exception when others then
      v_name := null;
    end;
  end if;

  if v_name is null then
    begin
      select nullif(btrim(coalesce(d.name, '')), '')
        into v_name
      from public.delegates_v2 d
      where public.delegates_v2_norm_branch(d.branch_key) = v_branch
        and public.delegates_v2_norm_phone(d.phone) = any (
          select public.delegates_v2_norm_phone(x) from unnest(v_phones) as x
        )
        and coalesce(d.is_enabled, false) is true
      order by d.updated_at desc nulls last
      limit 1;
    exception when others then
      v_name := null;
    end;
  end if;

  if v_name is null then
    begin
      select nullif(btrim(coalesce(r.name, '')), '')
        into v_name
      from public.approval_requests r
      where r.kind in ('tree_delegate', 'events_delegate')
        and r.status = 'approved'
        and public.delegates_v2_norm_branch(r.branch_key) = v_branch
        and (
          v_digits = ''
          or public.delegates_v2_norm_phone(r.phone) = v_digits
          or public.delegates_v2_norm_phone(r.phone) = any (
            select public.delegates_v2_norm_phone(x) from unnest(v_phones) as x
          )
        )
      order by r.created_at desc nulls last
      limit 1;
    exception when others then
      v_name := null;
    end;
  end if;

  -- Last resort: latest approved delegate request for this branch (any phone).
  if v_name is null then
    begin
      select nullif(btrim(coalesce(r.name, '')), '')
        into v_name
      from public.approval_requests r
      where r.kind in ('tree_delegate', 'events_delegate')
        and r.status = 'approved'
        and public.delegates_v2_norm_branch(r.branch_key) = v_branch
        and nullif(btrim(coalesce(r.name, '')), '') is not null
      order by r.created_at desc nulls last
      limit 1;
    exception when others then
      v_name := null;
    end;
  end if;

  -- Persist name onto delegates_v2 when missing so next login shows it.
  if v_name is not null then
    begin
      update public.delegates_v2 d
      set name = v_name, updated_at = now()
      where public.delegates_v2_norm_branch(d.branch_key) = v_branch
        and d.secret_hash = v_hash
        and coalesce(d.is_enabled, false) is true
        and nullif(btrim(coalesce(d.name, '')), '') is null;
    exception when others then
      null;
    end;
  end if;

  select coalesce(jsonb_agg(row_payload order by sort_status, created_at desc), '[]'::jsonb)
    into v_rows
  from (
    select
      to_jsonb(r) as row_payload,
      case lower(coalesce(r.status, ''))
        when 'pending' then 0
        when 'approved' then 1
        when 'rejected' then 2
        else 3
      end as sort_status,
      r.created_at
    from public.approval_requests r
    where r.status in ('pending', 'approved', 'rejected')
      and r.kind in (
        'event_card', 'family_event', 'event_request',
        'tree_card', 'tree_edit', 'memory_card'
      )
      and public.delegates_v2_norm_branch(r.branch_key) = v_branch
    order by sort_status, r.created_at desc
    limit 200
  ) q;

  v_count := coalesce(jsonb_array_length(v_rows), 0);

  return jsonb_build_object(
    'ok', true,
    'auth', true,
    'count', v_count,
    'delegate_name', v_name,
    'rows', coalesce(v_rows, '[]'::jsonb),
    'branch', v_branch
  );
end;
$$;

revoke all on function public.delegate_list_branch_requests_v2(text, text, text, text) from public;
grant execute on function public.delegate_list_branch_requests_v2(text, text, text, text) to anon, authenticated;

-- Keep legacy name in sync
create or replace function public.delegate_list_event_requests_v1(
  p_branch_key text,
  p_phone text,
  p_email text,
  p_secret_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wrap jsonb;
begin
  v_wrap := public.delegate_list_branch_requests_v2(
    p_branch_key, p_phone, p_email, p_secret_hash
  );
  return coalesce(v_wrap->'rows', '[]'::jsonb);
end;
$$;

grant execute on function public.delegate_list_event_requests_v1(text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';

select
  (select to_regprocedure('public.delegate_list_branch_requests_v2(text,text,text,text)') is not null)
    as has_list_v2,
  (select pg_get_functiondef('public.delegate_list_branch_requests_v2(text,text,text,text)'::regprocedure)
     like '%check_tree_delegate_access%') as auth_mirrors_login;
`,
      order: 10.3,
      supabaseOnce: true,
    },
    {
      id: "maint.tree_children_change_parent_v1",
      title: "تغيير الأب من المندوب (تصحيح الأب)",
      desc:
        "يثبّت RPC tree_children_change_parent_v1 حتى يستطيع مندوب الفرع حفظ طلبات تصحيح الأب من «طلبات فرعي». شغّله مرة في SQL Workspace ثم أعد تحميل صفحة الشجرة.",
      file: "../supabase/sql/COPY-ME-tree-children-change-parent-v1.sql",
      sql: `-- COPY-ME: run in Supabase SQL Editor / SQL Workspace
-- Preset id: maint.tree_children_change_parent_v1
--
-- Enables branch delegates to apply parent_change corrections.
-- tree_children_update_v1 does NOT write parent_person_id / path fields.
-- This RPC mirrors admin_tree_child_upsert_v1 parent-move + descendant path rewrite.
--
-- Safe to re-run (CREATE OR REPLACE only — no data DELETE).

create or replace function public.tree_children_change_parent_v1(
  p_branch_key text,
  p_person_id uuid,
  p_new_parent_person_id uuid,
  p_phone text,
  p_email text,
  p_secret_hash text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch text := nullif(btrim(coalesce(p_branch_key, '')), '');
  v_id bigint;
  v_old_child text;
  v_old_parent text;
  v_leaf text;
  v_new_parent_path text;
  v_new_child text;
  v_parent_exists boolean := false;
  v_clash boolean := false;
begin
  if p_person_id is null or p_new_parent_person_id is null or v_branch is null then
    return false;
  end if;
  if p_person_id = p_new_parent_person_id then
    raise exception 'parent_change_self';
  end if;
  if not public.tree_delegate_allowed_v1(v_branch, p_phone, p_email, p_secret_hash) then
    return false;
  end if;

  select
    c.id,
    coalesce(c.child_name, c.name),
    coalesce(c.parent_name, c.parent)
  into v_id, v_old_child, v_old_parent
  from public.tree_children c
  where c.branch_key = v_branch
    and c.person_id = p_person_id
  order by c.id desc
  limit 1;

  if v_id is null or v_old_child is null then
    return false;
  end if;

  select coalesce(c.child_name, c.name)
  into v_new_parent_path
  from public.tree_children c
  where c.branch_key = v_branch
    and c.person_id = p_new_parent_person_id
  order by c.id desc
  limit 1;

  if v_new_parent_path is null or btrim(v_new_parent_path) = '' then
    raise exception 'new_parent_not_found';
  end if;
  v_parent_exists := true;

  if v_new_parent_path = v_old_child
     or v_new_parent_path like v_old_child || '/%' then
    raise exception 'parent_change_cycle';
  end if;

  v_leaf := nullif(btrim(regexp_replace(v_old_child, '^.*/', '')), '');
  if v_leaf is null then
    raise exception 'parent_change_leaf_missing';
  end if;

  v_new_child := v_new_parent_path || '/' || v_leaf;

  select exists (
    select 1
    from public.tree_children c
    where c.branch_key = v_branch
      and c.id <> v_id
      and coalesce(c.parent_name, c.parent) = v_new_parent_path
      and nullif(btrim(regexp_replace(coalesce(c.child_name, c.name, ''), '^.*/', '')), '') = v_leaf
  ) into v_clash;
  if v_clash then
    raise exception 'child_already_exists';
  end if;

  update public.tree_children c
  set
    parent_name = v_new_parent_path,
    parent = v_new_parent_path,
    child_name = v_new_child,
    name = v_new_child,
    parent_person_id = p_new_parent_person_id
  where c.id = v_id
    and c.branch_key = v_branch;

  if not found then
    return false;
  end if;

  if v_old_child is distinct from v_new_child then
    update public.tree_children c
    set
      parent_name = case
        when coalesce(c.parent_name, c.parent, '') = v_old_child then v_new_child
        when coalesce(c.parent_name, c.parent, '') like v_old_child || '/%'
          then v_new_child || substr(coalesce(c.parent_name, c.parent), length(v_old_child) + 1)
        else c.parent_name
      end,
      parent = case
        when coalesce(c.parent, c.parent_name, '') = v_old_child then v_new_child
        when coalesce(c.parent, c.parent_name, '') like v_old_child || '/%'
          then v_new_child || substr(coalesce(c.parent, c.parent_name), length(v_old_child) + 1)
        else c.parent
      end,
      child_name = case
        when coalesce(c.child_name, c.name, '') like v_old_child || '/%'
          then v_new_child || substr(coalesce(c.child_name, c.name), length(v_old_child) + 1)
        else c.child_name
      end,
      name = case
        when coalesce(c.name, c.child_name, '') like v_old_child || '/%'
          then v_new_child || substr(coalesce(c.name, c.child_name), length(v_old_child) + 1)
        else c.name
      end
    where c.branch_key = v_branch
      and c.id <> v_id
      and (
        coalesce(c.parent_name, c.parent, '') = v_old_child
        or coalesce(c.parent_name, c.parent, '') like v_old_child || '/%'
        or coalesce(c.child_name, c.name, '') like v_old_child || '/%'
      );
  end if;

  perform public.tree_audit_log_v1(
    v_branch,
    p_phone,
    p_email,
    p_secret_hash,
    jsonb_build_object(
      'v', 1,
      'kind', 'tree_audit',
      'op', 'change_parent',
      'branch_key', v_branch,
      'person_id', p_person_id,
      'old_parent_name', v_old_parent,
      'old_child_name', v_old_child,
      'new_parent_person_id', p_new_parent_person_id,
      'new_parent_name', v_new_parent_path,
      'new_child_name', v_new_child,
      'parent_exists', v_parent_exists,
      'at', now()::timestamptz
    )
  );

  return true;
end;
$$;

revoke all on function public.tree_children_change_parent_v1(text, uuid, uuid, text, text, text) from public;
grant execute on function public.tree_children_change_parent_v1(text, uuid, uuid, text, text, text) to anon, authenticated;

select
  (select to_regprocedure(
    'public.tree_children_change_parent_v1(text,uuid,uuid,text,text,text)'
  ) is not null) as change_parent_rpc_ready;
`,
      order: 10.35,
      supabaseOnce: true,
    },
    {
      id: "maint.tree_children_rename_v1",
      title: "تصحيح الاسم من المندوب",
      desc:
        "يثبّت RPC tree_children_rename_v1 حتى يستطيع مندوب الفرع حفظ طلبات تصحيح الاسم من «طلبات فرعي». شغّله مرة ثم أعد تحميل صفحة الشجرة.",
      file: "../supabase/sql/COPY-ME-tree-children-rename-v1.sql",
      sql: `-- COPY-ME: run in Supabase SQL Editor / SQL Workspace
-- Preset id: maint.tree_children_rename_v1
--
-- Enables branch delegates to apply name_correction.
-- tree_children_update_v1 does NOT rewrite name/child_name/parent paths.
-- Mirrors admin_tree_child_upsert_v1 rename + descendant path rewrite.
--
-- Safe to re-run (CREATE OR REPLACE only — no data DELETE).

create or replace function public.tree_children_rename_v1(
  p_branch_key text,
  p_person_id uuid,
  p_name_new text,
  p_phone text,
  p_email text,
  p_secret_hash text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch text := nullif(btrim(coalesce(p_branch_key, '')), '');
  v_name_new text := nullif(btrim(coalesce(p_name_new, '')), '');
  v_id bigint;
  v_old_child text;
  v_old_parent text;
  v_new_child text;
  v_clash boolean := false;
begin
  if p_person_id is null or v_branch is null or v_name_new is null then
    return false;
  end if;
  if position('/' in v_name_new) > 0 or position(' ' in v_name_new) > 0 then
    raise exception 'name_correction_leaf_invalid';
  end if;
  if not public.tree_delegate_allowed_v1(v_branch, p_phone, p_email, p_secret_hash) then
    return false;
  end if;

  select
    c.id,
    coalesce(c.child_name, c.name),
    coalesce(c.parent_name, c.parent)
  into v_id, v_old_child, v_old_parent
  from public.tree_children c
  where c.branch_key = v_branch
    and c.person_id = p_person_id
  order by c.id desc
  limit 1;

  if v_id is null or v_old_child is null then
    return false;
  end if;

  if v_old_parent is null or btrim(v_old_parent) = '' then
    v_new_child := v_name_new;
  else
    v_new_child := v_old_parent || '/' || v_name_new;
  end if;

  if v_new_child = v_old_child then
    return true;
  end if;

  select exists (
    select 1
    from public.tree_children c
    where c.branch_key = v_branch
      and c.id <> v_id
      and coalesce(c.parent_name, c.parent) = coalesce(v_old_parent, '')
      and nullif(btrim(regexp_replace(coalesce(c.child_name, c.name, ''), '^.*/', '')), '') = v_name_new
  ) into v_clash;
  if v_clash then
    raise exception 'child_already_exists';
  end if;

  update public.tree_children c
  set
    child_name = v_new_child,
    name = v_new_child
  where c.id = v_id
    and c.branch_key = v_branch;

  if not found then
    return false;
  end if;

  update public.tree_children c
  set
    parent_name = case
      when coalesce(c.parent_name, c.parent, '') = v_old_child then v_new_child
      when coalesce(c.parent_name, c.parent, '') like v_old_child || '/%'
        then v_new_child || substr(coalesce(c.parent_name, c.parent), length(v_old_child) + 1)
      else c.parent_name
    end,
    parent = case
      when coalesce(c.parent, c.parent_name, '') = v_old_child then v_new_child
      when coalesce(c.parent, c.parent_name, '') like v_old_child || '/%'
        then v_new_child || substr(coalesce(c.parent, c.parent_name), length(v_old_child) + 1)
      else c.parent
    end,
    child_name = case
      when coalesce(c.child_name, c.name, '') like v_old_child || '/%'
        then v_new_child || substr(coalesce(c.child_name, c.name), length(v_old_child) + 1)
      else c.child_name
    end,
    name = case
      when coalesce(c.name, c.child_name, '') like v_old_child || '/%'
        then v_new_child || substr(coalesce(c.name, c.child_name), length(v_old_child) + 1)
      else c.name
    end
  where c.branch_key = v_branch
    and c.id <> v_id
    and (
      coalesce(c.parent_name, c.parent, '') = v_old_child
      or coalesce(c.parent_name, c.parent, '') like v_old_child || '/%'
      or coalesce(c.child_name, c.name, '') like v_old_child || '/%'
    );

  perform public.tree_audit_log_v1(
    v_branch,
    p_phone,
    p_email,
    p_secret_hash,
    jsonb_build_object(
      'v', 1,
      'kind', 'tree_audit',
      'op', 'rename',
      'branch_key', v_branch,
      'person_id', p_person_id,
      'old_child_name', v_old_child,
      'new_child_name', v_new_child,
      'name_new', v_name_new,
      'at', now()::timestamptz
    )
  );

  return true;
end;
$$;

revoke all on function public.tree_children_rename_v1(text, uuid, text, text, text, text) from public;
grant execute on function public.tree_children_rename_v1(text, uuid, text, text, text, text) to anon, authenticated;

select
  (select to_regprocedure(
    'public.tree_children_rename_v1(text,uuid,text,text,text,text)'
  ) is not null) as rename_rpc_ready;
`,
      order: 10.36,
      supabaseOnce: true,
    },
    {
      id: "maint.tree_children_gender_persist_v1",
      title: "حفظ جنس الابن/الابنة وإخفاء البنات عن العامة",
      desc:
        "يثبّت عمود gender في tree_children ويكتبه عند الحفظ، ويصنّف عقيله تحت خزيم كابنة دون حذفها. الشجرة/البحث العام يخفيان البنات بعد تشغيل الأمر وتحديث الصفحة. الإدارة والمندوب يبقيان يريان السجل.",
      file: "../supabase/sql/COPY-ME-tree-children-gender-persist-v1.sql",
      sql: `-- COPY-ME: run in Supabase SQL Editor / SQL Workspace
-- Preset id: maint.tree_children_gender_persist_v1
--
-- GEN-01 / Person Visibility: الوجود ≠ الظهور.
-- Daughters stay in tree_children (graph). Gender is persisted so the
-- current public tree/search experience can hide them. This is NOT a
-- Visibility Engine rule of (gender = male -> discoverable).
--
-- Safe to re-run (ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE).
-- No DELETE of عقيله or any other row.

alter table public.tree_children add column if not exists gender text;

create or replace function public.tree_child_normalize_gender(p_gender text)
returns text
language sql
immutable
as $$
  select case
    when g in ('daughter', 'female', 'f', 'أنثى', 'انثى', 'ابنة', 'بنت') then 'daughter'
    when g in ('son', 'male', 'm', 'ذكر', 'ابن') then 'son'
    else null
  end
  from (select lower(btrim(coalesce(p_gender, ''))) as g) s;
$$;

grant execute on function public.tree_child_normalize_gender(text) to anon, authenticated;

-- Targeted backfill: عقيله under خزيم only (leaf + ancestor path). Not a global name wipe.
update public.tree_children c
set gender = 'daughter'
where c.gender is distinct from 'daughter'
  and nullif(btrim(regexp_replace(coalesce(c.child_name, c.name, ''), '^.*/', '')), '')
      in ('عقيله', 'عقيلة')
  and (
    coalesce(c.parent_name, c.parent, '') like '%خزيم%'
    or coalesce(c.child_name, c.name, '') like '%خزيم%'
  );

create or replace function public.tree_children_insert_v1(
  p_branch_key text,
  p_parent_name text,
  p_child_name text,
  p_phone text,
  p_email text,
  p_secret_hash text,
  p_row jsonb
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
  v_person_id uuid;
  v_parent_person_id uuid;
  v_child_base text;
  v_deceased boolean;
  v_birth_order int;
  v_gender text;
begin
  if not public.tree_delegate_allowed_v1(p_branch_key, p_phone, p_email, p_secret_hash) then
    return false;
  end if;
  v_deceased := case
    when p_row ? 'is_deceased' then (p_row->>'is_deceased')::boolean
    when p_row ? 'deceased' then (p_row->>'deceased')::boolean
    else null
  end;
  v_gender := public.tree_child_normalize_gender(p_row->>'gender');
  v_birth_order := nullif(p_row->>'birth_order', '')::int;
  v_person_id := nullif(p_row->>'person_id', '')::uuid;
  v_parent_person_id := nullif(p_row->>'parent_person_id', '')::uuid;
  v_child_base := nullif(btrim(regexp_replace(coalesce(p_child_name, ''), '^.*/', '')), '');
  if v_birth_order is not null and v_birth_order < 1 then
    raise exception 'birth_order_invalid';
  end if;
  if v_parent_person_id is null then
    select min(c.person_id::text)::uuid into v_parent_person_id
    from public.tree_children c
    where c.branch_key = p_branch_key
      and coalesce(c.child_name, c.name) = p_parent_name
    having count(distinct c.person_id) = 1;
  end if;
  select c.id into v_id
  from public.tree_children c
  where c.branch_key = p_branch_key
    and (
      (v_person_id is not null and c.person_id = v_person_id)
      or (
        v_person_id is null
        and (c.parent_name = p_parent_name or c.parent = p_parent_name)
        and (c.name = p_child_name or c.child_name = p_child_name)
      )
    )
  order by c.id desc
  limit 1;
  if exists (
    select 1
    from public.tree_children c
    where c.branch_key = p_branch_key
      and (
        (v_parent_person_id is not null and c.parent_person_id = v_parent_person_id)
        or (v_parent_person_id is null and coalesce(c.parent_name, c.parent) = p_parent_name)
      )
      and btrim(regexp_replace(coalesce(c.child_name, c.name, ''), '^.*/', '')) = v_child_base
      and (v_id is null or c.id <> v_id)
      and (v_person_id is null or c.person_id is distinct from v_person_id)
  ) then
    raise exception 'child_already_exists';
  end if;
  if v_birth_order is not null and exists (
    select 1
    from public.tree_children c
    where c.branch_key = p_branch_key
      and c.parent_name = p_parent_name
      and c.birth_order = v_birth_order
      and (v_id is null or c.id <> v_id)
  ) then
    raise exception 'birth_order_conflict';
  end if;
  if v_id is not null then
    update public.tree_children c set
      person_id = coalesce(c.person_id, v_person_id, gen_random_uuid()),
      parent_person_id = coalesce(v_parent_person_id, c.parent_person_id),
      birth_date_g = nullif(p_row->>'birth_date_g', '')::date,
      birth_date_h = nullif(p_row->>'birth_date_h', ''),
      birth_year = nullif(p_row->>'birth_year', '')::int,
      birth_order = v_birth_order,
      city = nullif(p_row->>'city', ''),
      area = nullif(p_row->>'area', ''),
      is_deceased = coalesce(v_deceased, c.is_deceased),
      deceased = coalesce(v_deceased, c.deceased),
      gender = coalesce(v_gender, c.gender)
    where c.id = v_id;
    perform public.tree_audit_log_v1(
      p_branch_key, p_phone, p_email, p_secret_hash,
      jsonb_build_object(
        'v', 1, 'kind', 'tree_audit', 'op', 'upsert_update',
        'branch_key', p_branch_key,
        'parent_name', p_parent_name,
        'child_name', p_child_name,
        'row', coalesce(p_row, '{}'::jsonb),
        'at', now()::timestamptz
      )
    );
    return true;
  end if;
  insert into public.tree_children (
    branch_key, parent_name, parent, name, child_name,
    person_id, parent_person_id,
    birth_date_g, birth_date_h, birth_year, birth_order,
    city, area, is_deceased, deceased, gender, created_at
  ) values (
    p_branch_key, p_parent_name, p_parent_name, p_child_name, p_child_name,
    coalesce(v_person_id, gen_random_uuid()), v_parent_person_id,
    nullif(p_row->>'birth_date_g', '')::date,
    nullif(p_row->>'birth_date_h', ''),
    nullif(p_row->>'birth_year', '')::int,
    v_birth_order,
    nullif(p_row->>'city', ''),
    nullif(p_row->>'area', ''),
    coalesce(v_deceased, false),
    coalesce(v_deceased, false),
    v_gender,
    coalesce(nullif(p_row->>'created_at', '')::timestamptz, now())
  );
  perform public.tree_audit_log_v1(
    p_branch_key, p_phone, p_email, p_secret_hash,
    jsonb_build_object(
      'v', 1, 'kind', 'tree_audit', 'op', 'insert',
      'branch_key', p_branch_key,
      'parent_name', p_parent_name,
      'child_name', p_child_name,
      'row', coalesce(p_row, '{}'::jsonb),
      'at', now()::timestamptz
    )
  );
  return true;
end;
$$;

grant execute on function public.tree_children_insert_v1(text, text, text, text, text, text, jsonb) to anon, authenticated;

create or replace function public.tree_children_update_v1(
  p_branch_key text,
  p_parent_name text,
  p_child_name text,
  p_phone text,
  p_email text,
  p_secret_hash text,
  p_patch jsonb
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deceased boolean;
  v_birth_order int;
  v_id bigint;
  v_gender text;
begin
  if not public.tree_delegate_allowed_v1(p_branch_key, p_phone, p_email, p_secret_hash) then
    return false;
  end if;
  v_deceased := case
    when p_patch ? 'is_deceased' then (p_patch->>'is_deceased')::boolean
    when p_patch ? 'deceased' then (p_patch->>'deceased')::boolean
    else null
  end;
  v_gender := case
    when p_patch ? 'gender' then public.tree_child_normalize_gender(p_patch->>'gender')
    else null
  end;
  v_birth_order := case
    when p_patch ? 'birth_order' then nullif(p_patch->>'birth_order', '')::int
    else null
  end;
  if v_birth_order is not null and v_birth_order < 1 then
    raise exception 'birth_order_invalid';
  end if;
  select c.id into v_id
  from public.tree_children c
  where c.branch_key = p_branch_key
    and (
      (nullif(p_patch->>'person_id', '') is not null and c.person_id = nullif(p_patch->>'person_id', '')::uuid)
      or (
        nullif(p_patch->>'person_id', '') is null
        and (c.parent_name = p_parent_name or c.parent = p_parent_name)
        and (c.name = p_child_name or c.child_name = p_child_name)
      )
    )
  order by c.id desc
  limit 1;
  if v_id is null then
    return false;
  end if;
  if p_patch ? 'birth_order' and v_birth_order is not null and exists (
    select 1
    from public.tree_children c
    where c.branch_key = p_branch_key
      and c.parent_name = p_parent_name
      and c.birth_order = v_birth_order
      and c.id <> v_id
  ) then
    raise exception 'birth_order_conflict';
  end if;
  update public.tree_children c set
    birth_date_g = case when p_patch ? 'birth_date_g' then nullif(p_patch->>'birth_date_g', '')::date else c.birth_date_g end,
    birth_date_h = case when p_patch ? 'birth_date_h' then nullif(p_patch->>'birth_date_h', '') else c.birth_date_h end,
    birth_year = case when p_patch ? 'birth_year' then nullif(p_patch->>'birth_year', '')::int else c.birth_year end,
    birth_order = case when p_patch ? 'birth_order' then v_birth_order else c.birth_order end,
    city = case when p_patch ? 'city' then nullif(p_patch->>'city', '') else c.city end,
    area = case when p_patch ? 'area' then nullif(p_patch->>'area', '') else c.area end,
    is_deceased = coalesce(v_deceased, c.is_deceased),
    deceased = coalesce(v_deceased, c.deceased),
    gender = coalesce(v_gender, c.gender)
  where c.branch_key = p_branch_key and c.id = v_id;
  if found then
    perform public.tree_audit_log_v1(
      p_branch_key, p_phone, p_email, p_secret_hash,
      jsonb_build_object(
        'v', 1, 'kind', 'tree_audit', 'op', 'update',
        'branch_key', p_branch_key,
        'parent_name', p_parent_name,
        'child_name', p_child_name,
        'patch', coalesce(p_patch, '{}'::jsonb),
        'at', now()::timestamptz
      )
    );
  end if;
  return found;
end;
$$;

grant execute on function public.tree_children_update_v1(text, text, text, text, text, text, jsonb) to anon, authenticated;

create or replace function public.admin_tree_child_upsert_v1(p_token text, p_row jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
  v_branch text;
  v_parent text;
  v_child text;
  v_old_parent text;
  v_old_child text;
  v_person_id uuid;
  v_parent_person_id uuid;
  v_deceased boolean;
  v_gender text;
  v_saved_id bigint;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;
  if to_regclass('public.tree_children') is null then
    raise exception 'tree_children table missing';
  end if;
  v_id := nullif(p_row->>'id', '')::bigint;
  v_branch := nullif(btrim(coalesce(p_row->>'branch_key', '')), '');
  v_parent := nullif(btrim(coalesce(p_row->>'parent_name', '')), '');
  v_child := nullif(btrim(coalesce(p_row->>'child_name', '')), '');
  v_person_id := nullif(p_row->>'person_id', '')::uuid;
  v_parent_person_id := nullif(p_row->>'parent_person_id', '')::uuid;
  v_deceased := case
    when p_row ? 'is_deceased' then (p_row->>'is_deceased')::boolean
    when p_row ? 'deceased' then (p_row->>'deceased')::boolean
    else false
  end;
  v_gender := public.tree_child_normalize_gender(p_row->>'gender');
  if v_branch is null or v_parent is null or v_child is null then
    raise exception 'missing tree row fields';
  end if;
  if v_parent_person_id is null then
    select min(c.person_id::text)::uuid into v_parent_person_id
    from public.tree_children c
    where c.branch_key = v_branch
      and coalesce(c.child_name, c.name) = v_parent
    having count(distinct c.person_id) = 1;
  end if;
  if v_id is not null then
    select coalesce(c.parent_name, c.parent), coalesce(c.child_name, c.name), c.person_id
    into v_old_parent, v_old_child, v_person_id
    from public.tree_children c
    where c.id = v_id and c.branch_key = v_branch
    limit 1;
    if v_old_child is null then
      raise exception 'tree row not found';
    end if;
    update public.tree_children c set
      parent_name = v_parent,
      parent = v_parent,
      child_name = v_child,
      name = v_child,
      person_id = coalesce(c.person_id, v_person_id, gen_random_uuid()),
      parent_person_id = coalesce(v_parent_person_id, c.parent_person_id),
      birth_date_g = nullif(p_row->>'birth_date_g', '')::date,
      birth_date_h = nullif(p_row->>'birth_date_h', ''),
      birth_year = nullif(p_row->>'birth_year', '')::int,
      birth_order = nullif(p_row->>'birth_order', '')::int,
      death_date_g = nullif(p_row->>'death_date_g', '')::date,
      death_date_h = nullif(p_row->>'death_date_h', ''),
      city = nullif(p_row->>'city', ''),
      area = nullif(p_row->>'area', ''),
      is_deceased = coalesce(v_deceased, false),
      deceased = coalesce(v_deceased, false),
      gender = coalesce(v_gender, c.gender)
    where c.id = v_id
    returning c.id into v_saved_id;
    if v_old_child <> v_child then
      update public.tree_children c set
        parent_name = case
          when coalesce(c.parent_name, c.parent, '') = v_old_child then v_child
          when coalesce(c.parent_name, c.parent, '') like v_old_child || '/%' then v_child || substr(coalesce(c.parent_name, c.parent), length(v_old_child) + 1)
          else c.parent_name
        end,
        parent = case
          when coalesce(c.parent, c.parent_name, '') = v_old_child then v_child
          when coalesce(c.parent, c.parent_name, '') like v_old_child || '/%' then v_child || substr(coalesce(c.parent, c.parent_name), length(v_old_child) + 1)
          else c.parent
        end,
        child_name = case
          when coalesce(c.child_name, c.name, '') like v_old_child || '/%' then v_child || substr(coalesce(c.child_name, c.name), length(v_old_child) + 1)
          else c.child_name
        end,
        name = case
          when coalesce(c.name, c.child_name, '') like v_old_child || '/%' then v_child || substr(coalesce(c.name, c.child_name), length(v_old_child) + 1)
          else c.name
        end
      where c.branch_key = v_branch
        and c.id <> v_id
        and (
          coalesce(c.parent_name, c.parent, '') = v_old_child
          or coalesce(c.parent_name, c.parent, '') like v_old_child || '/%'
          or coalesce(c.child_name, c.name, '') like v_old_child || '/%'
        );
    end if;
  else
    insert into public.tree_children (
      branch_key, parent_name, parent, child_name, name, person_id, parent_person_id,
      birth_date_g, birth_date_h, birth_year, birth_order, death_date_g, death_date_h,
      city, area, is_deceased, deceased, gender, created_at
    ) values (
      v_branch, v_parent, v_parent, v_child, v_child,
      coalesce(v_person_id, gen_random_uuid()), v_parent_person_id,
      nullif(p_row->>'birth_date_g', '')::date,
      nullif(p_row->>'birth_date_h', ''),
      nullif(p_row->>'birth_year', '')::int,
      nullif(p_row->>'birth_order', '')::int,
      nullif(p_row->>'death_date_g', '')::date,
      nullif(p_row->>'death_date_h', ''),
      nullif(p_row->>'city', ''),
      nullif(p_row->>'area', ''),
      coalesce(v_deceased, false),
      coalesce(v_deceased, false),
      v_gender,
      now()
    ) returning id into v_saved_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_saved_id);
end;
$$;

grant execute on function public.admin_tree_child_upsert_v1(text, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';

select
  (select to_regclass('public.tree_children') is not null) as has_tree_children,
  (
    select count(*) > 0
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tree_children'
      and column_name = 'gender'
  ) as has_gender_column,
  (
    select to_regprocedure('public.tree_child_normalize_gender(text)') is not null
  ) as has_gender_norm,
  (
    select count(*)
    from public.tree_children c
    where c.gender = 'daughter'
      and nullif(btrim(regexp_replace(coalesce(c.child_name, c.name, ''), '^.*/', '')), '')
          in ('عقيله', 'عقيلة')
      and (
        coalesce(c.parent_name, c.parent, '') like '%خزيم%'
        or coalesce(c.child_name, c.name, '') like '%خزيم%'
      )
  ) as aqeelah_khuzaym_daughter_rows;
`,
      order: 10.365,
      supabaseOnce: true,
    },
    {
      id: "maint.tree_child_set_gender_v1",
      title: "ختم جنس الابنة بعد الحفظ وإخفاء المضافة للتو",
      desc:
        "الأمر السابق أخفى عقيله فقط. هذا يختم الجنس بعد كل إضافة ابنة، ويصنّف آخر صف بلا جنس خلال 12 ساعة كابنة دون حذفه. شغّله مرة ثم أعد تحميل الشجرة العامة.",
      file: "../supabase/sql/COPY-ME-tree-child-set-gender-v1.sql",
      sql: `-- COPY-ME: run in Supabase SQL Editor / SQL Workspace
-- Preset id: maint.tree_child_set_gender_v1
--
-- The first gender SQL hid عقيله (backfill). New daughters still appeared
-- because the insert path did not reliably stamp gender.
-- This adds a small dedicated UPDATE RPC and marks the most recent
-- null-gender child added in the last 12 hours as daughter (the leak just created).
--
-- Does not delete anyone. Safe to re-run.

create or replace function public.admin_tree_child_set_gender_v1(
  p_token text,
  p_branch_key text,
  p_child_name text,
  p_gender text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_gender text;
  v_branch text;
  v_child text;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;
  v_gender := public.tree_child_normalize_gender(p_gender);
  v_branch := nullif(btrim(coalesce(p_branch_key, '')), '');
  v_child := nullif(btrim(coalesce(p_child_name, '')), '');
  if v_gender is null or v_branch is null or v_child is null then
    return false;
  end if;
  update public.tree_children c
  set gender = v_gender
  where c.branch_key = v_branch
    and (coalesce(c.child_name, c.name) = v_child or c.name = v_child);
  return found;
end;
$fn$;

grant execute on function public.admin_tree_child_set_gender_v1(text, text, text, text) to anon, authenticated;

create or replace function public.tree_children_set_gender_v1(
  p_branch_key text,
  p_child_name text,
  p_gender text,
  p_phone text,
  p_email text,
  p_secret_hash text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_gender text;
  v_branch text;
  v_child text;
begin
  v_branch := nullif(btrim(coalesce(p_branch_key, '')), '');
  v_child := nullif(btrim(coalesce(p_child_name, '')), '');
  v_gender := public.tree_child_normalize_gender(p_gender);
  if v_branch is null or v_child is null or v_gender is null then
    return false;
  end if;
  if not public.tree_delegate_allowed_v1(v_branch, p_phone, p_email, p_secret_hash) then
    return false;
  end if;
  update public.tree_children c
  set gender = v_gender
  where c.branch_key = v_branch
    and (coalesce(c.child_name, c.name) = v_child or c.name = v_child);
  return found;
end;
$fn$;

grant execute on function public.tree_children_set_gender_v1(text, text, text, text, text, text) to anon, authenticated;

-- Incident: hide the daughter added after the first gender SQL if it is the
-- latest tree_children row from the last 12 hours with gender still null.
update public.tree_children c
set gender = 'daughter'
where c.gender is null
  and c.id = (
    select c2.id
    from public.tree_children c2
    where c2.gender is null
      and c2.created_at >= now() - interval '12 hours'
    order by c2.created_at desc, c2.id desc
    limit 1
  );

notify pgrst, 'reload schema';

select
  c.id,
  c.branch_key,
  c.parent_name,
  c.child_name,
  c.gender,
  c.created_at
from public.tree_children c
where c.created_at >= now() - interval '12 hours'
order by c.created_at desc, c.id desc
limit 20;
`,
      order: 10.366,
      supabaseOnce: true,
    },
    {
      id: "maint.tree_children_public_hide_daughters_v1",
      title: "إخفاء البنات من القراءة العامة (RLS)",
      desc:
        "الأمر السابق ختم الجنس لكن الموقع الحي ما زال يقرأ كل الصفوف. هذا يقيّد SELECT العام فيخدم حتى بدون نشر app.js، ويختم آخر صف بلا جنس بعد إعادة الإضافة، مع دوال قائمة للإدارة/المندوب. شغّله مرة ثم حدّث الصفحة العامة (بدون كاش).",
      file: "../supabase/sql/COPY-ME-tree-children-public-hide-daughters-v1.sql",
      sql: `-- COPY-ME: run in Supabase SQL Editor / SQL Workspace
-- Preset id: maint.tree_children_public_hide_daughters_v1
--
-- الوجود ≠ الظهور. البنات يبقين في tree_children.
-- الموقع العام الحي ما زال يحمّل app.js قديمًا يقرأ كل الصفوف
-- (سياسة SELECT كانت using (true))، لذلك ختم الجنس وحده لا يخفي.
-- هذا يقيّد SELECT العام ويختم آخر صف بلا جنس (الإضافة بعد الحذف).
-- الإدارة/المندوب يقرآن البنات عبر دوال SECURITY DEFINER.
-- لا يحذف أحدًا. آمن لإعادة التشغيل.

alter table public.tree_children add column if not exists gender text;

create or replace function public.tree_child_normalize_gender(p_gender text)
returns text
language sql
immutable
as $$
  select case
    when g in ('daughter', 'female', 'f', 'أنثى', 'انثى', 'ابنة', 'بنت') then 'daughter'
    when g in ('son', 'male', 'm', 'ذكر', 'ابن') then 'son'
    else null
  end
  from (select lower(btrim(coalesce(p_gender, ''))) as g) s;
$$;

grant execute on function public.tree_child_normalize_gender(text) to anon, authenticated;


-- Latest re-add after deleting the previous name: newest null-gender
-- child in the last 12 hours is the daughter that leaked again.
update public.tree_children c
set gender = 'daughter'
where c.gender is null
  and c.id = (
    select c2.id
    from public.tree_children c2
    where c2.gender is null
      and c2.created_at >= now() - interval '12 hours'
    order by c2.created_at desc, c2.id desc
    limit 1
  );

drop policy if exists "tree_children_select_all" on public.tree_children;
drop policy if exists tree_children_select_all on public.tree_children;
drop policy if exists "tree_children_select_public" on public.tree_children;
drop policy if exists tree_children_select_public on public.tree_children;

create policy "tree_children_select_public"
on public.tree_children
for select
to anon, authenticated
using (
  lower(btrim(coalesce(gender, ''))) not in (
    'daughter', 'female', 'f', 'أنثى', 'انثى', 'ابنة', 'بنت'
  )
);

revoke insert, update, delete on table public.tree_children from anon, authenticated;
grant select on table public.tree_children to anon, authenticated;

create or replace function public.admin_tree_children_list_v1(
  p_token text,
  p_branch_key text
)
returns setof public.tree_children
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_branch text;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;
  v_branch := nullif(btrim(coalesce(p_branch_key, '')), '');
  if v_branch is null then
    return;
  end if;
  return query
    select c.*
    from public.tree_children c
    where c.branch_key = v_branch
    order by c.id
    limit 5000;
end;
$fn$;

grant execute on function public.admin_tree_children_list_v1(text, text) to anon, authenticated;

create or replace function public.tree_children_list_v1(
  p_branch_key text,
  p_phone text,
  p_email text,
  p_secret_hash text
)
returns setof public.tree_children
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_branch text;
begin
  v_branch := nullif(btrim(coalesce(p_branch_key, '')), '');
  if v_branch is null then
    return;
  end if;
  if not public.tree_delegate_allowed_v1(v_branch, p_phone, p_email, p_secret_hash) then
    raise exception 'not allowed';
  end if;
  return query
    select c.*
    from public.tree_children c
    where c.branch_key = v_branch
    order by c.id
    limit 5000;
end;
$fn$;

grant execute on function public.tree_children_list_v1(text, text, text, text) to anon, authenticated;

create or replace function public.admin_tree_child_set_gender_by_id_v1(
  p_token text,
  p_id bigint,
  p_gender text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_gender text;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;
  v_gender := public.tree_child_normalize_gender(p_gender);
  if v_gender is null or p_id is null or p_id < 1 then
    return false;
  end if;
  update public.tree_children c
  set gender = v_gender
  where c.id = p_id;
  return found;
end;
$fn$;

grant execute on function public.admin_tree_child_set_gender_by_id_v1(text, bigint, text) to anon, authenticated;

notify pgrst, 'reload schema';

select
  (
    select pol.polname
    from pg_policy pol
    join pg_class rel on rel.oid = pol.polrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'tree_children'
      and pol.polcmd = 'r'
    order by pol.polname
    limit 1
  ) as select_policy,
  (
    select to_regprocedure('public.admin_tree_children_list_v1(text,text)') is not null
  ) as has_admin_list,
  (
    select count(*)
    from public.tree_children c
    where c.gender = 'daughter'
  ) as daughter_rows;

select
  c.id,
  c.branch_key,
  c.parent_name,
  c.child_name,
  c.gender,
  c.created_at
from public.tree_children c
where c.created_at >= now() - interval '12 hours'
order by c.created_at desc, c.id desc
limit 20;
`,
      order: 10.367,
      supabaseOnce: true,
    },
    {
      id: "maint.tree_maternal_kinship_v1",
      title: "نسب الأم: خال وابن خال وابن خالة",
      desc:
        "للقاء الشخصي في التطبيق: يظهر خالك / ابن خالك / ابن خالتك فقط عند ربط الأم المثبت وأنها من العائلة. لا يعرض أسماء البنات للعامة. شغّله مرة ثم أعد فتح التطبيق بحساب عضو.",
      file: "../supabase/sql/COPY-ME-tree-maternal-kinship-v1.sql",
      sql: `-- COPY-ME: run in Supabase SQL Editor / SQL Workspace
-- Preset id: maint.tree_maternal_kinship_v1
--
-- Proven maternal kinship for the mobile encounter:
--   خالك / ابن خالك / ابن خالتك
-- Uses tree_mother_links + family-member wives + hidden daughter rows
-- inside SECURITY DEFINER. Returns only male relative ids (no daughter names).
-- Does not invent. Safe to re-run.

create or replace function public.tree_child_is_daughter_v1(p_gender text)
returns boolean
language sql
immutable
as $$
  select lower(btrim(coalesce(p_gender, ''))) in (
    'daughter', 'female', 'f', 'أنثى', 'انثى', 'ابنة', 'بنت'
  );
$$;

create or replace function public.tree_maternal_kinship_for_viewer_v1(p_viewer_id bigint)
returns table(person_id bigint, label text)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_spouse_id bigint;
  v_lineage text;
  v_wife_name text;
  v_branch text;
  v_mother_id bigint;
  v_mother_path text;
  v_gf_path text;
begin
  if p_viewer_id is null or p_viewer_id < 1 then
    return;
  end if;

  select
    l.spouse_id,
    nullif(btrim(coalesce(s.wife_lineage, l.mother_lineage, '')), ''),
    nullif(btrim(coalesce(s.wife_name, l.mother_name, '')), ''),
    nullif(btrim(coalesce(s.wife_branch_key, l.mother_branch_key, '')), '')
  into v_spouse_id, v_lineage, v_wife_name, v_branch
  from public.tree_mother_links l
  left join public.tree_spouses s on s.id = l.spouse_id
  where l.child_id = p_viewer_id
    and lower(btrim(coalesce(l.confidence, 'confirmed'))) in ('', 'confirmed')
    and coalesce(s.wife_is_family_member, l.mother_is_family_member, false) = true
    and lower(btrim(coalesce(s.status, 'active'))) in ('', 'active')
  order by l.child_id
  limit 1;

  if v_spouse_id is null then
    return;
  end if;

  if v_lineage is not null and position('/' in v_lineage) > 0 then
    select c.id, coalesce(c.child_name, c.name), coalesce(c.parent_name, c.parent)
    into v_mother_id, v_mother_path, v_gf_path
    from public.tree_children c
    where (v_branch is null or c.branch_key = v_branch)
      and (
        lower(btrim(coalesce(c.child_name, c.name, ''))) = lower(btrim(v_lineage))
        or lower(btrim(coalesce(c.name, ''))) = lower(btrim(v_lineage))
      )
    order by c.id
    limit 2;
    if found and v_mother_id is not null then
      if (
        select count(*)
        from public.tree_children c2
        where (v_branch is null or c2.branch_key = v_branch)
          and (
            lower(btrim(coalesce(c2.child_name, c2.name, ''))) = lower(btrim(v_lineage))
            or lower(btrim(coalesce(c2.name, ''))) = lower(btrim(v_lineage))
          )
      ) > 1 then
        return;
      end if;
    else
      v_mother_path := v_lineage;
      v_gf_path := regexp_replace(v_lineage, '/[^/]+$', '');
    end if;
  end if;

  if v_gf_path is null and coalesce(v_wife_name, v_lineage, '') <> '' then
    select c.id, coalesce(c.child_name, c.name), coalesce(c.parent_name, c.parent), c.branch_key
    into v_mother_id, v_mother_path, v_gf_path, v_branch
    from public.tree_children c
    where (v_branch is null or c.branch_key = v_branch)
      and lower(btrim(regexp_replace(coalesce(c.child_name, c.name, ''), '^.*/', '')))
          = lower(btrim(regexp_replace(coalesce(v_wife_name, v_lineage, ''), '^.*/', '')))
    order by c.id
    limit 2;
    if (
      select count(*)
      from public.tree_children c2
      where (v_branch is null or c2.branch_key = v_branch)
        and lower(btrim(regexp_replace(coalesce(c2.child_name, c2.name, ''), '^.*/', '')))
            = lower(btrim(regexp_replace(coalesce(v_wife_name, v_lineage, ''), '^.*/', '')))
    ) <> 1 then
      v_mother_id := null;
      v_gf_path := null;
    end if;
  end if;

  v_gf_path := nullif(btrim(coalesce(v_gf_path, '')), '');
  if v_gf_path is null then
    return;
  end if;

  return query
  with khals as (
    select c.id, coalesce(c.child_name, c.name) as path, c.branch_key
    from public.tree_children c
    where coalesce(c.parent_name, c.parent) = v_gf_path
      and (v_branch is null or c.branch_key = v_branch)
      and not public.tree_child_is_daughter_v1(c.gender)
      and (v_mother_id is null or c.id <> v_mother_id)
      and (
        v_mother_path is null
        or lower(btrim(coalesce(c.child_name, c.name, ''))) <> lower(btrim(v_mother_path))
      )
  ),
  ibn_khal as (
    select s.id
    from public.tree_children s
    join khals k
      on coalesce(s.parent_name, s.parent) = k.path
     and s.branch_key = k.branch_key
    where not public.tree_child_is_daughter_v1(s.gender)
  ),
  sisters as (
    select c.id, coalesce(c.child_name, c.name) as path, c.branch_key,
           lower(btrim(regexp_replace(coalesce(c.child_name, c.name, ''), '^.*/', ''))) as leaf
    from public.tree_children c
    where coalesce(c.parent_name, c.parent) = v_gf_path
      and (v_branch is null or c.branch_key = v_branch)
      and public.tree_child_is_daughter_v1(c.gender)
      and (v_mother_id is null or c.id <> v_mother_id)
      and (
        v_mother_path is null
        or lower(btrim(coalesce(c.child_name, c.name, ''))) <> lower(btrim(v_mother_path))
      )
  ),
  sister_spouses as (
    select distinct s.id as spouse_id
    from sisters sis
    join public.tree_spouses s
      on coalesce(s.wife_is_family_member, false) = true
     and lower(btrim(coalesce(s.status, 'active'))) in ('', 'active')
     and (
       lower(btrim(coalesce(s.wife_lineage, ''))) = lower(btrim(sis.path))
       or (
         position('/' in coalesce(s.wife_lineage, '')) = 0
         and lower(btrim(regexp_replace(coalesce(s.wife_name, s.wife_lineage, ''), '^.*/', ''))) = sis.leaf
         and (s.wife_branch_key is null or s.wife_branch_key = sis.branch_key)
         and (
           select count(*)
           from public.tree_spouses s2
           where coalesce(s2.wife_is_family_member, false) = true
             and lower(btrim(coalesce(s2.status, 'active'))) in ('', 'active')
             and position('/' in coalesce(s2.wife_lineage, '')) = 0
             and lower(btrim(regexp_replace(coalesce(s2.wife_name, s2.wife_lineage, ''), '^.*/', ''))) = sis.leaf
             and (s2.wife_branch_key is null or s2.wife_branch_key = sis.branch_key)
         ) = 1
       )
     )
  ),
  ibn_khala as (
    select c.id
    from public.tree_mother_links l
    join sister_spouses ss on ss.spouse_id = l.spouse_id
    join public.tree_children c on c.id = l.child_id
    where lower(btrim(coalesce(l.confidence, 'confirmed'))) in ('', 'confirmed')
      and not public.tree_child_is_daughter_v1(c.gender)
      and c.id <> p_viewer_id
  )
  select k.id, 'خالك'::text
  from khals k
  union all
  select i.id, 'ابن خالك'::text
  from ibn_khal i
  union all
  select x.id, 'ابن خالتك'::text
  from ibn_khala x;
end;
$fn$;

grant execute on function public.tree_child_is_daughter_v1(text) to anon, authenticated;
grant execute on function public.tree_maternal_kinship_for_viewer_v1(bigint) to anon, authenticated;

notify pgrst, 'reload schema';

select
  (select to_regprocedure('public.tree_maternal_kinship_for_viewer_v1(bigint)') is not null)
    as has_maternal_rpc;
`,
      order: 10.368,
      supabaseOnce: true,
    },
    {
      id: "maint.tree_maternal_kinship_v2",
      title: "نسب الأم للجميع: خال وابن خال وابن خالة",
      desc:
        "عام لكل الأمهات المربوطات من العائلة: يقرأ نسب الأم نصًا أو مسارًا، يوحّد التاء المربوطة، ثم يُظهر خالك / ابن خالك / ابن خالتك في اللقاء الشخصي. شغّله مرة ثم أعد فتح التطبيق.",
      file: "../supabase/sql/COPY-ME-tree-maternal-kinship-v2.sql",
      sql: `-- COPY-ME: run in Supabase SQL Editor / SQL Workspace
-- Preset id: maint.tree_maternal_kinship_v2
--
-- General maternal kinship for ANY family-member mother:
--   خالك / ابن خالك / ابن خالتك
-- Reads confirmed tree_mother_links + wife nasab (text or slash path).
-- Unifies ة/ه and أ/ا. Does not bind to one name. Safe to re-run.

create or replace function public.tree_arabic_norm_v1(p text)
returns text
language sql
immutable
as $$
  select lower(btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(coalesce(p, ''), '[\u064B-\u065F\u0670]', '', 'g'),
            'ـ', '', 'g'),
          '[أإآ]', 'ا', 'g'),
        'ة', 'ه', 'g'),
      'ى', 'ي', 'g')
  ));
$$;

create or replace function public.tree_nasab_tokens_v1(p text)
returns text[]
language sql
immutable
as $$
  select coalesce(
    array_remove(
      string_to_array(
        btrim(
          regexp_replace(
            public.tree_arabic_norm_v1(p),
            '(^|[[:space:]])(بنت|بن|ابن)([[:space:]]|$)',
            ' ',
            'g'
          )
        ),
        ' '
      ),
      ''
    ),
    '{}'::text[]
  );
$$;

create or replace function public.tree_nasab_nth_v1(p text, p_n integer)
returns text
language sql
immutable
as $$
  select nullif((public.tree_nasab_tokens_v1(p))[greatest(p_n, 1)], '');
$$;

create or replace function public.tree_path_leaf_v1(p text)
returns text
language sql
immutable
as $$
  select public.tree_arabic_norm_v1(nullif(btrim(regexp_replace(coalesce(p, ''), '^.*/', '')), ''));
$$;

create or replace function public.tree_child_is_daughter_v1(p_gender text)
returns boolean
language sql
immutable
as $$
  select lower(btrim(coalesce(p_gender, ''))) in (
    'daughter', 'female', 'f', 'أنثى', 'انثى', 'ابنة', 'بنت'
  );
$$;

create or replace function public.tree_maternal_kinship_for_viewer_v1(p_viewer_id bigint)
returns table(person_id bigint, label text)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_spouse_id bigint;
  v_lineage text;
  v_wife_name text;
  v_branch text;
  v_leaf text;
  v_father_leaf text;
  v_mother_id bigint;
  v_mother_path text;
  v_gf_path text;
  v_match_count int;
begin
  if p_viewer_id is null or p_viewer_id < 1 then
    return;
  end if;

  select
    l.spouse_id,
    nullif(btrim(coalesce(s.wife_lineage, l.mother_lineage, '')), ''),
    nullif(btrim(coalesce(s.wife_name, l.mother_name, '')), ''),
    nullif(btrim(coalesce(s.wife_branch_key, l.mother_branch_key, '')), '')
  into v_spouse_id, v_lineage, v_wife_name, v_branch
  from public.tree_mother_links l
  left join public.tree_spouses s on s.id = l.spouse_id
  where l.child_id = p_viewer_id
    and lower(btrim(coalesce(l.confidence, 'confirmed'))) in ('', 'confirmed')
    and coalesce(s.wife_is_family_member, l.mother_is_family_member, false) = true
    and lower(btrim(coalesce(s.status, 'active'))) in ('', 'active')
  order by l.child_id
  limit 1;

  if v_spouse_id is null then
    return;
  end if;

  v_leaf := public.tree_nasab_nth_v1(coalesce(v_wife_name, v_lineage, ''), 1);
  v_father_leaf := public.tree_nasab_nth_v1(coalesce(v_wife_name, v_lineage, ''), 2);

  if v_lineage is not null and position('/' in v_lineage) > 0 then
    select count(*) into v_match_count
    from public.tree_children c
    where (v_branch is null or c.branch_key = v_branch)
      and (
        public.tree_arabic_norm_v1(coalesce(c.child_name, c.name, ''))
          = public.tree_arabic_norm_v1(v_lineage)
        or public.tree_arabic_norm_v1(coalesce(c.name, ''))
          = public.tree_arabic_norm_v1(v_lineage)
      );
    if v_match_count = 1 then
      select c.id, coalesce(c.child_name, c.name), coalesce(c.parent_name, c.parent)
      into v_mother_id, v_mother_path, v_gf_path
      from public.tree_children c
      where (v_branch is null or c.branch_key = v_branch)
        and (
          public.tree_arabic_norm_v1(coalesce(c.child_name, c.name, ''))
            = public.tree_arabic_norm_v1(v_lineage)
          or public.tree_arabic_norm_v1(coalesce(c.name, ''))
            = public.tree_arabic_norm_v1(v_lineage)
        )
      limit 1;
    elsif v_match_count = 0 then
      v_mother_path := v_lineage;
      v_gf_path := regexp_replace(v_lineage, '/[^/]+$', '');
    end if;
  end if;

  if v_gf_path is null and v_leaf is not null then
    select count(*) into v_match_count
    from public.tree_children c
    where (v_branch is null or c.branch_key = v_branch)
      and public.tree_path_leaf_v1(coalesce(c.child_name, c.name)) = v_leaf
      and (
        v_father_leaf is null
        or public.tree_path_leaf_v1(coalesce(c.parent_name, c.parent)) = v_father_leaf
        or (
          select count(*)
          from public.tree_children c2
          where (v_branch is null or c2.branch_key = v_branch)
            and public.tree_path_leaf_v1(coalesce(c2.child_name, c2.name)) = v_leaf
        ) = 1
      );

    if v_match_count = 1 then
      select c.id, coalesce(c.child_name, c.name), coalesce(c.parent_name, c.parent), c.branch_key
      into v_mother_id, v_mother_path, v_gf_path, v_branch
      from public.tree_children c
      where (v_branch is null or c.branch_key = v_branch)
        and public.tree_path_leaf_v1(coalesce(c.child_name, c.name)) = v_leaf
        and (
          v_father_leaf is null
          or public.tree_path_leaf_v1(coalesce(c.parent_name, c.parent)) = v_father_leaf
          or (
            select count(*)
            from public.tree_children c2
            where (v_branch is null or c2.branch_key = v_branch)
              and public.tree_path_leaf_v1(coalesce(c2.child_name, c2.name)) = v_leaf
          ) = 1
        )
      limit 1;
    end if;
  end if;

  v_gf_path := nullif(btrim(coalesce(v_gf_path, '')), '');
  if v_gf_path is null then
    return;
  end if;

  return query
  with khals as (
    select c.id, coalesce(c.child_name, c.name) as path, c.branch_key
    from public.tree_children c
    where coalesce(c.parent_name, c.parent) = v_gf_path
      and (v_branch is null or c.branch_key = v_branch)
      and not public.tree_child_is_daughter_v1(c.gender)
      and (v_mother_id is null or c.id <> v_mother_id)
      and (
        v_mother_path is null
        or public.tree_arabic_norm_v1(coalesce(c.child_name, c.name, ''))
             <> public.tree_arabic_norm_v1(v_mother_path)
      )
  ),
  ibn_khal as (
    select s.id
    from public.tree_children s
    join khals k
      on coalesce(s.parent_name, s.parent) = k.path
     and s.branch_key = k.branch_key
    where not public.tree_child_is_daughter_v1(s.gender)
  ),
  sisters as (
    select c.id, coalesce(c.child_name, c.name) as path, c.branch_key,
           public.tree_path_leaf_v1(coalesce(c.child_name, c.name)) as leaf
    from public.tree_children c
    where coalesce(c.parent_name, c.parent) = v_gf_path
      and (v_branch is null or c.branch_key = v_branch)
      and public.tree_child_is_daughter_v1(c.gender)
      and (v_mother_id is null or c.id <> v_mother_id)
      and (
        v_mother_path is null
        or public.tree_arabic_norm_v1(coalesce(c.child_name, c.name, ''))
             <> public.tree_arabic_norm_v1(v_mother_path)
      )
  ),
  sister_spouses as (
    select distinct s.id as spouse_id
    from sisters sis
    join public.tree_spouses s
      on coalesce(s.wife_is_family_member, false) = true
     and lower(btrim(coalesce(s.status, 'active'))) in ('', 'active')
     and (
       public.tree_arabic_norm_v1(coalesce(s.wife_lineage, '')) = public.tree_arabic_norm_v1(sis.path)
       or public.tree_nasab_nth_v1(coalesce(s.wife_name, s.wife_lineage, ''), 1) = sis.leaf
     )
     and (
       select count(*)
       from public.tree_spouses s2
       where coalesce(s2.wife_is_family_member, false) = true
         and lower(btrim(coalesce(s2.status, 'active'))) in ('', 'active')
         and (
           public.tree_arabic_norm_v1(coalesce(s2.wife_lineage, '')) = public.tree_arabic_norm_v1(sis.path)
           or public.tree_nasab_nth_v1(coalesce(s2.wife_name, s2.wife_lineage, ''), 1) = sis.leaf
         )
     ) = 1
  ),
  ibn_khala as (
    select c.id
    from public.tree_mother_links l
    join sister_spouses ss on ss.spouse_id = l.spouse_id
    join public.tree_children c on c.id = l.child_id
    where lower(btrim(coalesce(l.confidence, 'confirmed'))) in ('', 'confirmed')
      and not public.tree_child_is_daughter_v1(c.gender)
      and c.id <> p_viewer_id
  )
  select k.id, 'خالك'::text
  from khals k
  union all
  select i.id, 'ابن خالك'::text
  from ibn_khal i
  union all
  select x.id, 'ابن خالتك'::text
  from ibn_khala x;
end;
$fn$;

grant execute on function public.tree_arabic_norm_v1(text) to anon, authenticated;
grant execute on function public.tree_nasab_tokens_v1(text) to anon, authenticated;
grant execute on function public.tree_nasab_nth_v1(text, integer) to anon, authenticated;
grant execute on function public.tree_path_leaf_v1(text) to anon, authenticated;
grant execute on function public.tree_child_is_daughter_v1(text) to anon, authenticated;
grant execute on function public.tree_maternal_kinship_for_viewer_v1(bigint) to anon, authenticated;

notify pgrst, 'reload schema';

select
  (select to_regprocedure('public.tree_maternal_kinship_for_viewer_v1(bigint)') is not null)
    as has_maternal_rpc;
`,
      order: 10.369,
      supabaseOnce: true,
    },
    {
      id: "maint.tree_kinship_for_person_v1",
      title: "قرابة الشخص: عمك، ابن عمك، ابنك، ابن الأخ، ابن الأخت",
      desc:
        "للبنت المسجّلة أيضاً: عمك وابن أخيك وابن أختك من صفها المخفي، دون إظهار اسمها للعامة. شغّله مرة ثم Hard Refresh للشجرة.",
      file: "../supabase/sql/COPY-ME-tree-kinship-for-person-v1.sql",
      sql: "-- COPY-ME: Preset id: maint.tree_kinship_for_person_v1\n-- Proven male relatives for ANY person (security definer; daughters stay hidden):\n--   أخ من أمك / حفيدك / حفيدك من ابنتك / ابن أخيك / ابن أختك / عمك / ابن عمك / ابنك\n-- Also: tree_member_viewer_v1(phone) loads the member's own tree row (including\n-- daughters) so a registered daughter gets عمك / ابن أخيك from her father path.\n-- Safe to re-run. Small CREATE OR REPLACE.\n\ncreate or replace function public.tree_member_viewer_v1(p_phone text)\nreturns table(\n  id bigint,\n  child_name text,\n  parent_name text,\n  branch_key text,\n  gender text,\n  display_name text,\n  photo_url text\n)\nlanguage plpgsql\nstable\nsecurity definer\nset search_path = public\nas $fn$\ndeclare\n  v_digits text;\n  v_child_id bigint;\n  v_display text;\n  v_branch text;\nbegin\n  v_digits := nullif(right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 9), '');\n  if v_digits is null or char_length(v_digits) < 9 then\n    return;\n  end if;\n\n  select mp.tree_child_id, mp.display_name, mp.branch_key\n    into v_child_id, v_display, v_branch\n  from public.member_profiles mp\n  where coalesce(mp.status, 'active') = 'active'\n    and right(regexp_replace(coalesce(mp.phone, ''), '[^0-9]', '', 'g'), 9) = v_digits\n  order by mp.updated_at desc nulls last, mp.id desc\n  limit 1;\n\n  if v_child_id is null then\n    return;\n  end if;\n\n  return query\n  select\n    c.id,\n    coalesce(c.child_name, c.name),\n    coalesce(c.parent_name, c.parent),\n    coalesce(c.branch_key, v_branch),\n    c.gender,\n    coalesce(\n      nullif(btrim(v_display), ''),\n      nullif(btrim(regexp_replace(coalesce(c.child_name, c.name, ''), '^.*/', '')), '')\n    ),\n    c.photo_url\n  from public.tree_children c\n  where c.id = v_child_id\n  limit 1;\nend;\n$fn$;\n\ncreate or replace function public.tree_wife_nasab_text_v1(p_name text, p_lineage text)\nreturns text\nlanguage sql\nimmutable\nas $$\n  select coalesce(\n    case\n      when coalesce(cardinality(public.tree_nasab_tokens_v1(p_lineage)), 0)\n         >= coalesce(cardinality(public.tree_nasab_tokens_v1(p_name)), 0)\n      then nullif(btrim(coalesce(p_lineage, '')), '')\n      else nullif(btrim(coalesce(p_name, '')), '')\n    end,\n    nullif(btrim(coalesce(p_name, '')), ''),\n    nullif(btrim(coalesce(p_lineage, '')), '')\n  );\n$$;\n\ngrant execute on function public.tree_wife_nasab_text_v1(text, text) to anon, authenticated;\n\ncreate or replace function public.tree_kinship_for_person_v1(p_person_id bigint)\nreturns table(person_id bigint, label text)\nlanguage plpgsql\nstable\nsecurity definer\nset search_path = public\nas $fn$\ndeclare\n  v_path text;\n  v_parent text;\n  v_branch text;\n  v_gf_path text;\n  v_father_leaf text;\n  v_spouse_id bigint;\n  v_lineage text;\n  v_wife_name text;\nbegin\n  if p_person_id is null or p_person_id < 1 then\n    return;\n  end if;\n\n  select\n    coalesce(c.child_name, c.name),\n    coalesce(c.parent_name, c.parent),\n    c.branch_key\n  into v_path, v_parent, v_branch\n  from public.tree_children c\n  where c.id = p_person_id\n  limit 1;\n\n  if v_path is null then\n    return;\n  end if;\n\n  v_path := nullif(btrim(v_path), '');\n  v_parent := nullif(btrim(coalesce(v_parent, '')), '');\n  if v_parent is null and v_path is not null and position('/' in v_path) > 0 then\n    v_parent := regexp_replace(v_path, '/[^/]+$', '');\n  elsif v_parent is not null and v_path is not null and position('/' in v_path) = 0 then\n    v_path := v_parent || '/' || public.tree_path_leaf_v1(v_path);\n  end if;\n  v_gf_path := case\n    when v_parent is not null and position('/' in v_parent) > 0\n      then regexp_replace(v_parent, '/[^/]+$', '')\n    else null\n  end;\n  v_father_leaf := public.tree_path_leaf_v1(v_parent);\n\n  select\n    l.spouse_id,\n    nullif(btrim(coalesce(s.wife_lineage, l.mother_lineage, '')), ''),\n    nullif(btrim(coalesce(s.wife_name, l.mother_name, '')), '')\n  into v_spouse_id, v_lineage, v_wife_name\n  from public.tree_mother_links l\n  left join public.tree_spouses s on s.id = l.spouse_id\n  where l.child_id = p_person_id\n    and lower(btrim(coalesce(l.confidence, 'confirmed'))) in ('', 'confirmed')\n  order by l.child_id\n  limit 1;\n\n  return query\n  with matching_mother_spouses as (\n    select s.id\n    from public.tree_spouses s\n    where v_spouse_id is not null\n      and coalesce(s.wife_is_family_member, false) = true\n      and (\n        s.id = v_spouse_id\n        or public.tree_mother_spouses_share_identity_v1(\n          v_lineage, v_wife_name, s.wife_lineage, s.wife_name\n        )\n      )\n  ),\n  maternal_brothers as (\n    select distinct l.child_id as id\n    from public.tree_mother_links l\n    join matching_mother_spouses ms on ms.id = l.spouse_id\n    join public.tree_children c on c.id = l.child_id\n    join public.tree_children me on me.id = p_person_id\n    where lower(btrim(coalesce(l.confidence, 'confirmed'))) in ('', 'confirmed')\n      and not public.tree_child_is_daughter_v1(c.gender)\n      and l.child_id <> p_person_id\n      and public.tree_arabic_norm_v1(coalesce(c.parent_name, c.parent, ''))\n        is distinct from public.tree_arabic_norm_v1(coalesce(me.parent_name, me.parent, ''))\n  ),\n  sons as (\n    select c.id, coalesce(c.child_name, c.name) as path, c.branch_key\n    from public.tree_children c\n    where public.tree_arabic_norm_v1(coalesce(c.parent_name, c.parent, ''))\n        = public.tree_arabic_norm_v1(v_path)\n      and not public.tree_child_is_daughter_v1(c.gender)\n  ),\n  grandsons_sons as (\n    select g.id\n    from public.tree_children g\n    join sons s on coalesce(g.parent_name, g.parent) = s.path and g.branch_key = s.branch_key\n    where not public.tree_child_is_daughter_v1(g.gender)\n  ),\n  daughters as (\n    select c.id, coalesce(c.child_name, c.name) as path, c.branch_key,\n           public.tree_path_leaf_v1(coalesce(c.child_name, c.name)) as leaf\n    from public.tree_children c\n    where public.tree_arabic_norm_v1(coalesce(c.parent_name, c.parent, ''))\n        = public.tree_arabic_norm_v1(v_path)\n      and public.tree_child_is_daughter_v1(c.gender)\n  ),\n  daughter_spouses as (\n    select distinct s.id as spouse_id\n    from daughters d\n    join public.tree_spouses s\n      on coalesce(s.wife_is_family_member, false) = true\n     and (\n       public.tree_arabic_norm_v1(coalesce(s.wife_lineage, '')) = public.tree_arabic_norm_v1(d.path)\n       or (\n         public.tree_nasab_nth_v1(public.tree_wife_nasab_text_v1(s.wife_name, s.wife_lineage), 1) = d.leaf\n         and public.tree_nasab_nth_v1(public.tree_wife_nasab_text_v1(s.wife_name, s.wife_lineage), 2) is not null\n         and public.tree_nasab_nth_v1(public.tree_wife_nasab_text_v1(s.wife_name, s.wife_lineage), 2)\n           = public.tree_path_leaf_v1(v_path)\n       )\n     )\n  ),\n  grandsons_daughters as (\n    select distinct c.id\n    from public.tree_mother_links l\n    join daughter_spouses ds on ds.spouse_id = l.spouse_id\n    join public.tree_children c on c.id = l.child_id\n    where lower(btrim(coalesce(l.confidence, 'confirmed'))) in ('', 'confirmed')\n      and not public.tree_child_is_daughter_v1(c.gender)\n  ),\n  brothers as (\n    select c.id, coalesce(c.child_name, c.name) as path, c.branch_key\n    from public.tree_children c\n    where v_parent is not null\n      and public.tree_arabic_norm_v1(coalesce(c.parent_name, c.parent, ''))\n        = public.tree_arabic_norm_v1(v_parent)\n      and (v_branch is null or c.branch_key = v_branch)\n      and c.id <> p_person_id\n      and not public.tree_child_is_daughter_v1(c.gender)\n  ),\n  nephews_brothers as (\n    select n.id\n    from public.tree_children n\n    join brothers b on coalesce(n.parent_name, n.parent) = b.path and n.branch_key = b.branch_key\n    where not public.tree_child_is_daughter_v1(n.gender)\n  ),\n  sisters as (\n    select c.id, coalesce(c.child_name, c.name) as path, c.branch_key,\n           public.tree_path_leaf_v1(coalesce(c.child_name, c.name)) as leaf\n    from public.tree_children c\n    where v_parent is not null\n      and public.tree_arabic_norm_v1(coalesce(c.parent_name, c.parent, ''))\n        = public.tree_arabic_norm_v1(v_parent)\n      and (v_branch is null or c.branch_key = v_branch)\n      and c.id <> p_person_id\n      and public.tree_child_is_daughter_v1(c.gender)\n  ),\n  sister_spouses as (\n    select distinct s.id as spouse_id\n    from sisters sis\n    join public.tree_spouses s\n      on coalesce(s.wife_is_family_member, false) = true\n     and (\n       public.tree_arabic_norm_v1(coalesce(s.wife_lineage, '')) = public.tree_arabic_norm_v1(sis.path)\n       or (\n         public.tree_nasab_nth_v1(public.tree_wife_nasab_text_v1(s.wife_name, s.wife_lineage), 1) = sis.leaf\n         and v_father_leaf is not null\n         and public.tree_nasab_nth_v1(public.tree_wife_nasab_text_v1(s.wife_name, s.wife_lineage), 2) = v_father_leaf\n       )\n       or (\n         public.tree_nasab_nth_v1(public.tree_wife_nasab_text_v1(s.wife_name, s.wife_lineage), 1) = sis.leaf\n         and public.tree_arabic_norm_v1(regexp_replace(coalesce(s.wife_lineage, ''), '/[^/]+$', ''))\n           = public.tree_arabic_norm_v1(v_parent)\n       )\n       or (\n         public.tree_nasab_nth_v1(public.tree_wife_nasab_text_v1(s.wife_name, s.wife_lineage), 1) = sis.leaf\n         and (\n           select count(*)\n           from public.tree_spouses s2\n           where coalesce(s2.wife_is_family_member, false) = true\n             and public.tree_nasab_nth_v1(public.tree_wife_nasab_text_v1(s2.wife_name, s2.wife_lineage), 1) = sis.leaf\n         ) = 1\n       )\n     )\n    union\n    select s.id\n    from public.tree_spouses s\n    where coalesce(s.wife_is_family_member, false) = true\n      and v_parent is not null\n      and position('/' in coalesce(s.wife_lineage, '')) > 0\n      and public.tree_arabic_norm_v1(regexp_replace(s.wife_lineage, '/[^/]+$', ''))\n        = public.tree_arabic_norm_v1(v_parent)\n      and public.tree_arabic_norm_v1(s.wife_lineage)\n        is distinct from public.tree_arabic_norm_v1(v_path)\n  ),\n  nephews_sisters as (\n    select distinct c.id\n    from public.tree_mother_links l\n    join sister_spouses ss on ss.spouse_id = l.spouse_id\n    join public.tree_children c on c.id = l.child_id\n    where lower(btrim(coalesce(l.confidence, 'confirmed'))) in ('', 'confirmed')\n      and not public.tree_child_is_daughter_v1(c.gender)\n      and c.id <> p_person_id\n  )\n  select mb.id, 'أخ من أمك'::text from maternal_brothers mb\n  union all\n  select gs.id, 'حفيدك'::text from grandsons_sons gs\n  union all\n  select gd.id, 'حفيدك من ابنتك'::text from grandsons_daughters gd\n  union all\n  select nb.id, 'ابن أخيك'::text from nephews_brothers nb\n  union all\n  select ns.id, 'ابن أختك'::text from nephews_sisters ns\n  union all\n  select u.id, 'عمك'::text from (\n    select c.id\n    from public.tree_children c\n    where v_gf_path is not null\n      and public.tree_arabic_norm_v1(coalesce(c.parent_name, c.parent, ''))\n        = public.tree_arabic_norm_v1(v_gf_path)\n      and (v_branch is null or c.branch_key = v_branch)\n      and public.tree_arabic_norm_v1(coalesce(c.child_name, c.name, ''))\n            is distinct from public.tree_arabic_norm_v1(v_parent)\n      and not public.tree_child_is_daughter_v1(c.gender)\n  ) u\n  union all\n  select us.id, 'ابن عمك'::text from (\n    select n.id\n    from public.tree_children n\n    join public.tree_children u\n      on coalesce(n.parent_name, n.parent) = coalesce(u.child_name, u.name)\n     and n.branch_key = u.branch_key\n    where v_gf_path is not null\n      and public.tree_arabic_norm_v1(coalesce(u.parent_name, u.parent, ''))\n        = public.tree_arabic_norm_v1(v_gf_path)\n      and (v_branch is null or u.branch_key = v_branch)\n      and public.tree_arabic_norm_v1(coalesce(u.child_name, u.name, ''))\n            is distinct from public.tree_arabic_norm_v1(v_parent)\n      and not public.tree_child_is_daughter_v1(u.gender)\n      and not public.tree_child_is_daughter_v1(n.gender)\n  ) us\n  union all\n  select os.id, 'ابنك'::text from (\n    select distinct c.id\n    from public.tree_spouses s\n    join public.tree_mother_links l on l.spouse_id = s.id\n    join public.tree_children c on c.id = l.child_id\n    where coalesce(s.wife_is_family_member, false) = true\n      and lower(btrim(coalesce(l.confidence, 'confirmed'))) in ('', 'confirmed')\n      and not public.tree_child_is_daughter_v1(c.gender)\n      and (\n        public.tree_arabic_norm_v1(coalesce(s.wife_lineage, '')) = public.tree_arabic_norm_v1(v_path)\n        or (\n          public.tree_nasab_nth_v1(public.tree_wife_nasab_text_v1(s.wife_name, s.wife_lineage), 1) = public.tree_path_leaf_v1(v_path)\n          and public.tree_nasab_nth_v1(public.tree_wife_nasab_text_v1(s.wife_name, s.wife_lineage), 2)\n            = public.tree_path_leaf_v1(v_parent)\n        )\n      )\n  ) os;\nend;\n$fn$;\n\ngrant execute on function public.tree_member_viewer_v1(text) to anon, authenticated;\ngrant execute on function public.tree_kinship_for_person_v1(bigint) to anon, authenticated;\nnotify pgrst, 'reload schema';\nselect\n  (to_regprocedure('public.tree_kinship_for_person_v1(bigint)') is not null) as has_kinship_rpc,\n  (to_regprocedure('public.tree_member_viewer_v1(text)') is not null) as has_member_viewer_rpc;\n",
      order: 10.3691,
      supabaseOnce: true,
    },
    {
      id: "maint.tree_member_photo_v1",
      title: "صورة العضو: إضافة وتغيير وحذف",
      desc: "عمود photo_url على الشجرة. العضو يضيف/يغيّر/يحذف صورته بعد الدخول بلا موافقة. الإدارة تحذف الصورة المخالفة. شغّله مرة ثم Hard Refresh.",
      file: "../supabase/sql/COPY-ME-tree-member-photo-v1.sql",
      sql: "-- COPY-ME: Preset id: maint.tree_member_photo_v1\n-- Personal photo on the tree person (tree_children.photo_url).\n-- Member after login sets / changes / clears their own photo. No admin approval.\n-- Admin can clear an inappropriate photo by person id.\n-- Public tree shows the photo next to the name for visible people.\n-- Daughters stay hidden; their photo is for their own login only.\n-- Safe to re-run.\n\nalter table public.tree_children add column if not exists photo_url text;\n\ndrop function if exists public.tree_member_viewer_v1(text);\n\ncreate function public.tree_member_viewer_v1(p_phone text)\nreturns table(\n  id bigint,\n  child_name text,\n  parent_name text,\n  branch_key text,\n  gender text,\n  display_name text,\n  photo_url text\n)\nlanguage plpgsql\nstable\nsecurity definer\nset search_path = public\nas $fn$\ndeclare\n  v_digits text;\n  v_child_id bigint;\n  v_display text;\n  v_branch text;\nbegin\n  v_digits := nullif(right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 9), '');\n  if v_digits is null or char_length(v_digits) < 9 then\n    return;\n  end if;\n\n  select mp.tree_child_id, mp.display_name, mp.branch_key\n    into v_child_id, v_display, v_branch\n  from public.member_profiles mp\n  where coalesce(mp.status, 'active') = 'active'\n    and right(regexp_replace(coalesce(mp.phone, ''), '[^0-9]', '', 'g'), 9) = v_digits\n  order by mp.updated_at desc nulls last, mp.id desc\n  limit 1;\n\n  if v_child_id is null then\n    return;\n  end if;\n\n  return query\n  select\n    c.id,\n    coalesce(c.child_name, c.name),\n    coalesce(c.parent_name, c.parent),\n    coalesce(c.branch_key, v_branch),\n    c.gender,\n    coalesce(\n      nullif(btrim(v_display), ''),\n      nullif(btrim(regexp_replace(coalesce(c.child_name, c.name, ''), '^.*/', '')), '')\n    ),\n    c.photo_url\n  from public.tree_children c\n  where c.id = v_child_id\n  limit 1;\nend;\n$fn$;\n\ncreate or replace function public.tree_member_set_photo_v1(p_phone text, p_photo_url text)\nreturns boolean\nlanguage plpgsql\nsecurity definer\nset search_path = public\nas $fn$\ndeclare\n  v_digits text;\n  v_child_id bigint;\n  v_url text;\nbegin\n  v_digits := nullif(right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 9), '');\n  if v_digits is null or char_length(v_digits) < 9 then\n    return false;\n  end if;\n\n  v_url := nullif(btrim(coalesce(p_photo_url, '')), '');\n  if v_url is not null then\n    if v_url !~* '^https?://' or char_length(v_url) > 2000 then\n      raise exception 'photo_url_invalid';\n    end if;\n  end if;\n\n  select mp.tree_child_id\n    into v_child_id\n  from public.member_profiles mp\n  where coalesce(mp.status, 'active') = 'active'\n    and right(regexp_replace(coalesce(mp.phone, ''), '[^0-9]', '', 'g'), 9) = v_digits\n    and mp.tree_child_id is not null\n  order by mp.updated_at desc nulls last, mp.id desc\n  limit 1;\n\n  if v_child_id is null then\n    return false;\n  end if;\n\n  update public.tree_children c\n  set photo_url = v_url\n  where c.id = v_child_id;\n\n  return found;\nend;\n$fn$;\n\ncreate or replace function public.admin_tree_child_clear_photo_v1(p_token text, p_id bigint)\nreturns boolean\nlanguage plpgsql\nsecurity definer\nset search_path = public\nas $fn$\nbegin\n  if not public.admin_token_ok_v1(p_token) then\n    raise exception 'not allowed';\n  end if;\n  if p_id is null or p_id < 1 then\n    return false;\n  end if;\n\n  update public.tree_children c\n  set photo_url = null\n  where c.id = p_id;\n\n  return found;\nend;\n$fn$;\n\ngrant execute on function public.tree_member_viewer_v1(text) to anon, authenticated;\ngrant execute on function public.tree_member_set_photo_v1(text, text) to anon, authenticated;\nrevoke all on function public.admin_tree_child_clear_photo_v1(text, bigint) from public;\ngrant execute on function public.admin_tree_child_clear_photo_v1(text, bigint) to anon, authenticated;\n\nnotify pgrst, 'reload schema';\n\nselect\n  (to_regprocedure('public.tree_member_set_photo_v1(text,text)') is not null) as has_member_set_photo,\n  (to_regprocedure('public.admin_tree_child_clear_photo_v1(text,bigint)') is not null) as has_admin_clear_photo;\n",
      order: 10.36911,
      supabaseOnce: true,
    },
    {
      id: "maint.tree_mother_identity_strict_v1",
      title: "منع خلط الأمهات المتشابهات بالاسم الأول",
      desc: "لا تُعدّ زوجتان أماً واحدة لمجرد تطابق الاسم الأول. يطابق النسب أو الاسم الثنائي فأعلى فقط.",
      file: "../supabase/sql/COPY-ME-tree-mother-identity-strict-v1.sql",
      sql: `-- Preset id: maint.tree_mother_identity_strict_v1
create or replace function public.tree_mother_spouses_share_identity_v1(
  p_lineage_a text, p_name_a text, p_lineage_b text, p_name_b text
) returns boolean language sql immutable as $$
  select (
    coalesce(nullif(btrim(p_lineage_a), ''), nullif(btrim(p_name_a), '')) is not null
    and coalesce(nullif(btrim(p_lineage_b), ''), nullif(btrim(p_name_b), '')) is not null
  ) and (
    (nullif(btrim(p_lineage_a), '') is not null and nullif(btrim(p_lineage_b), '') is not null
      and public.tree_arabic_norm_v1(p_lineage_a) = public.tree_arabic_norm_v1(p_lineage_b))
    or (nullif(btrim(p_name_a), '') is not null and nullif(btrim(p_name_b), '') is not null
      and public.tree_arabic_norm_v1(p_name_a) = public.tree_arabic_norm_v1(p_name_b)
      and cardinality(public.tree_nasab_tokens_v1(p_name_a)) >= 2
      and cardinality(public.tree_nasab_tokens_v1(p_name_b)) >= 2)
    or (
      public.tree_nasab_nth_v1(coalesce(p_name_a, p_lineage_a, ''), 1) is not null
      and public.tree_nasab_nth_v1(coalesce(p_name_a, p_lineage_a, ''), 2) is not null
      and public.tree_nasab_nth_v1(coalesce(p_name_b, p_lineage_b, ''), 1) is not null
      and public.tree_nasab_nth_v1(coalesce(p_name_b, p_lineage_b, ''), 2) is not null
      and public.tree_nasab_nth_v1(coalesce(p_name_a, p_lineage_a, ''), 1)
        = public.tree_nasab_nth_v1(coalesce(p_name_b, p_lineage_b, ''), 1)
      and public.tree_nasab_nth_v1(coalesce(p_name_a, p_lineage_a, ''), 2)
        = public.tree_nasab_nth_v1(coalesce(p_name_b, p_lineage_b, ''), 2)
    )
  );
$$;
grant execute on function public.tree_mother_spouses_share_identity_v1(text, text, text, text) to anon, authenticated;
notify pgrst, 'reload schema';
select true as mother_identity_strict;`,
      order: 10.3692,
      supabaseOnce: true,
    },
    {
      id: "maint.tree_maternal_kinship_v4",
      title: "إظهار أخ من الأم حتى بعد الطلاق",
      desc:
        "أمر صغير: الأم تبقى أماً بعد الطلاق أو الزواج الثاني. يُظهر أخ من أمك / خالك / ابن خالك / ابن خالتك. شغّله مرة ثم Hard Refresh للشجرة العامة.",
      file: "../supabase/sql/COPY-ME-tree-maternal-kinship-v4.sql",
      sql: "-- COPY-ME: run in Supabase SQL Editor / SQL Workspace\n-- Preset id: maint.tree_maternal_kinship_v4\n--\n-- Patch: motherhood survives divorce/remarriage.\n--   أخ من أمك / خالك / ابن خالك / ابن خالتك\n-- Small CREATE OR REPLACE — will not timeout.\n-- Safe to re-run.\n\ncreate or replace function public.tree_arabic_norm_v1(p text)\nreturns text\nlanguage sql\nimmutable\nas $$\n  select lower(btrim(\n    regexp_replace(\n      regexp_replace(\n        regexp_replace(\n          regexp_replace(\n            regexp_replace(coalesce(p, ''), '[\\u064B-\\u065F\\u0670]', '', 'g'),\n            'ـ', '', 'g'),\n          '[أإآ]', 'ا', 'g'),\n        'ة', 'ه', 'g'),\n      'ى', 'ي', 'g')\n  ));\n$$;\n\ncreate or replace function public.tree_nasab_tokens_v1(p text)\nreturns text[]\nlanguage sql\nimmutable\nas $$\n  select coalesce(\n    array_remove(\n      string_to_array(\n        btrim(\n          regexp_replace(\n            public.tree_arabic_norm_v1(p),\n            '(^|[[:space:]])(بنت|بن|ابن)([[:space:]]|$)',\n            ' ',\n            'g'\n          )\n        ),\n        ' '\n      ),\n      ''\n    ),\n    '{}'::text[]\n  );\n$$;\n\ncreate or replace function public.tree_nasab_nth_v1(p text, p_n integer)\nreturns text\nlanguage sql\nimmutable\nas $$\n  select nullif((public.tree_nasab_tokens_v1(p))[greatest(p_n, 1)], '');\n$$;\n\ncreate or replace function public.tree_path_leaf_v1(p text)\nreturns text\nlanguage sql\nimmutable\nas $$\n  select public.tree_arabic_norm_v1(nullif(btrim(regexp_replace(coalesce(p, ''), '^.*/', '')), ''));\n$$;\n\ncreate or replace function public.tree_child_is_daughter_v1(p_gender text)\nreturns boolean\nlanguage sql\nimmutable\nas $$\n  select lower(btrim(coalesce(p_gender, ''))) in (\n    'daughter', 'female', 'f', 'أنثى', 'انثى', 'ابنة', 'بنت'\n  );\n$$;\n\ncreate or replace function public.tree_mother_spouses_share_identity_v1(\n  p_lineage_a text,\n  p_name_a text,\n  p_lineage_b text,\n  p_name_b text\n)\nreturns boolean\nlanguage sql\nimmutable\nas $$\n  select\n    (\n      coalesce(nullif(btrim(p_lineage_a), ''), nullif(btrim(p_name_a), '')) is not null\n      and coalesce(nullif(btrim(p_lineage_b), ''), nullif(btrim(p_name_b), '')) is not null\n    )\n    and (\n      (\n        nullif(btrim(p_lineage_a), '') is not null\n        and nullif(btrim(p_lineage_b), '') is not null\n        and public.tree_arabic_norm_v1(p_lineage_a) = public.tree_arabic_norm_v1(p_lineage_b)\n      )\n      or (\n        nullif(btrim(p_name_a), '') is not null\n        and nullif(btrim(p_name_b), '') is not null\n        and public.tree_arabic_norm_v1(p_name_a) = public.tree_arabic_norm_v1(p_name_b)\n      )\n      or (\n        public.tree_nasab_nth_v1(coalesce(p_name_a, p_lineage_a, ''), 1) is not null\n        and public.tree_nasab_nth_v1(coalesce(p_name_a, p_lineage_a, ''), 1)\n          = public.tree_nasab_nth_v1(coalesce(p_name_b, p_lineage_b, ''), 1)\n      )\n      or (\n        public.tree_nasab_nth_v1(coalesce(p_name_a, p_lineage_a, ''), 1) is not null\n        and public.tree_nasab_nth_v1(coalesce(p_name_a, p_lineage_a, ''), 2) is not null\n        and public.tree_nasab_nth_v1(coalesce(p_name_b, p_lineage_b, ''), 1) is not null\n        and public.tree_nasab_nth_v1(coalesce(p_name_b, p_lineage_b, ''), 2) is not null\n        and public.tree_nasab_nth_v1(coalesce(p_name_a, p_lineage_a, ''), 1)\n          = public.tree_nasab_nth_v1(coalesce(p_name_b, p_lineage_b, ''), 1)\n        and public.tree_nasab_nth_v1(coalesce(p_name_a, p_lineage_a, ''), 2)\n          = public.tree_nasab_nth_v1(coalesce(p_name_b, p_lineage_b, ''), 2)\n      )\n    );\n$$;\n\ncreate or replace function public.tree_maternal_kinship_for_viewer_v1(p_viewer_id bigint)\nreturns table(person_id bigint, label text)\nlanguage plpgsql\nstable\nsecurity definer\nset search_path = public\nas $fn$\ndeclare\n  v_spouse_id bigint;\n  v_lineage text;\n  v_wife_name text;\n  v_branch text;\n  v_leaf text;\n  v_father_leaf text;\n  v_mother_id bigint;\n  v_mother_path text;\n  v_gf_path text;\n  v_match_count int;\nbegin\n  if p_viewer_id is null or p_viewer_id < 1 then\n    return;\n  end if;\n\n  select\n    l.spouse_id,\n    nullif(btrim(coalesce(s.wife_lineage, l.mother_lineage, '')), ''),\n    nullif(btrim(coalesce(s.wife_name, l.mother_name, '')), ''),\n    nullif(btrim(coalesce(s.wife_branch_key, l.mother_branch_key, '')), '')\n  into v_spouse_id, v_lineage, v_wife_name, v_branch\n  from public.tree_mother_links l\n  left join public.tree_spouses s on s.id = l.spouse_id\n  where l.child_id = p_viewer_id\n    and lower(btrim(coalesce(l.confidence, 'confirmed'))) in ('', 'confirmed')\n    and coalesce(s.wife_is_family_member, l.mother_is_family_member, false) = true\n  order by l.child_id\n  limit 1;\n\n  if v_spouse_id is null then\n    return;\n  end if;\n\n  v_leaf := public.tree_nasab_nth_v1(coalesce(v_wife_name, v_lineage, ''), 1);\n  v_father_leaf := public.tree_nasab_nth_v1(coalesce(v_wife_name, v_lineage, ''), 2);\n\n  if v_lineage is not null and position('/' in v_lineage) > 0 then\n    select count(*) into v_match_count\n    from public.tree_children c\n    where (v_branch is null or c.branch_key = v_branch)\n      and (\n        public.tree_arabic_norm_v1(coalesce(c.child_name, c.name, ''))\n          = public.tree_arabic_norm_v1(v_lineage)\n        or public.tree_arabic_norm_v1(coalesce(c.name, ''))\n          = public.tree_arabic_norm_v1(v_lineage)\n      );\n    if v_match_count = 1 then\n      select c.id, coalesce(c.child_name, c.name), coalesce(c.parent_name, c.parent)\n      into v_mother_id, v_mother_path, v_gf_path\n      from public.tree_children c\n      where (v_branch is null or c.branch_key = v_branch)\n        and (\n          public.tree_arabic_norm_v1(coalesce(c.child_name, c.name, ''))\n            = public.tree_arabic_norm_v1(v_lineage)\n          or public.tree_arabic_norm_v1(coalesce(c.name, ''))\n            = public.tree_arabic_norm_v1(v_lineage)\n        )\n      limit 1;\n    elsif v_match_count = 0 then\n      v_mother_path := v_lineage;\n      v_gf_path := regexp_replace(v_lineage, '/[^/]+$', '');\n    end if;\n  end if;\n\n  if v_gf_path is null and v_leaf is not null then\n    select count(*) into v_match_count\n    from public.tree_children c\n    where (v_branch is null or c.branch_key = v_branch)\n      and public.tree_path_leaf_v1(coalesce(c.child_name, c.name)) = v_leaf\n      and (\n        v_father_leaf is null\n        or public.tree_path_leaf_v1(coalesce(c.parent_name, c.parent)) = v_father_leaf\n        or (\n          select count(*)\n          from public.tree_children c2\n          where (v_branch is null or c2.branch_key = v_branch)\n            and public.tree_path_leaf_v1(coalesce(c2.child_name, c2.name)) = v_leaf\n        ) = 1\n      );\n\n    if v_match_count = 1 then\n      select c.id, coalesce(c.child_name, c.name), coalesce(c.parent_name, c.parent), c.branch_key\n      into v_mother_id, v_mother_path, v_gf_path, v_branch\n      from public.tree_children c\n      where (v_branch is null or c.branch_key = v_branch)\n        and public.tree_path_leaf_v1(coalesce(c.child_name, c.name)) = v_leaf\n        and (\n          v_father_leaf is null\n          or public.tree_path_leaf_v1(coalesce(c.parent_name, c.parent)) = v_father_leaf\n          or (\n            select count(*)\n            from public.tree_children c2\n            where (v_branch is null or c2.branch_key = v_branch)\n              and public.tree_path_leaf_v1(coalesce(c2.child_name, c2.name)) = v_leaf\n          ) = 1\n        )\n      limit 1;\n    end if;\n  end if;\n\n  v_gf_path := nullif(btrim(coalesce(v_gf_path, '')), '');\n\n  return query\n  with matching_spouses as (\n    select s.id\n    from public.tree_spouses s\n    where coalesce(s.wife_is_family_member, false) = true\n      and (\n        s.id = v_spouse_id\n        or public.tree_mother_spouses_share_identity_v1(\n          v_lineage,\n          v_wife_name,\n          s.wife_lineage,\n          s.wife_name\n        )\n      )\n  ),\n  maternal_brothers as (\n    select distinct l.child_id as id\n    from public.tree_mother_links l\n    join matching_spouses ms on ms.id = l.spouse_id\n    join public.tree_children c on c.id = l.child_id\n    where lower(btrim(coalesce(l.confidence, 'confirmed'))) in ('', 'confirmed')\n      and not public.tree_child_is_daughter_v1(c.gender)\n      and l.child_id <> p_viewer_id\n  ),\n  khals as (\n    select c.id, coalesce(c.child_name, c.name) as path, c.branch_key\n    from public.tree_children c\n    where v_gf_path is not null\n      and coalesce(c.parent_name, c.parent) = v_gf_path\n      and (v_branch is null or c.branch_key = v_branch)\n      and not public.tree_child_is_daughter_v1(c.gender)\n      and (v_mother_id is null or c.id <> v_mother_id)\n      and (\n        v_mother_path is null\n        or public.tree_arabic_norm_v1(coalesce(c.child_name, c.name, ''))\n             <> public.tree_arabic_norm_v1(v_mother_path)\n      )\n  ),\n  ibn_khal as (\n    select s.id\n    from public.tree_children s\n    join khals k\n      on coalesce(s.parent_name, s.parent) = k.path\n     and s.branch_key = k.branch_key\n    where not public.tree_child_is_daughter_v1(s.gender)\n  ),\n  sisters as (\n    select c.id, coalesce(c.child_name, c.name) as path, c.branch_key,\n           public.tree_path_leaf_v1(coalesce(c.child_name, c.name)) as leaf\n    from public.tree_children c\n    where v_gf_path is not null\n      and coalesce(c.parent_name, c.parent) = v_gf_path\n      and (v_branch is null or c.branch_key = v_branch)\n      and public.tree_child_is_daughter_v1(c.gender)\n      and (v_mother_id is null or c.id <> v_mother_id)\n      and (\n        v_mother_path is null\n        or public.tree_arabic_norm_v1(coalesce(c.child_name, c.name, ''))\n             <> public.tree_arabic_norm_v1(v_mother_path)\n      )\n  ),\n  sister_spouses as (\n    select distinct s.id as spouse_id\n    from sisters sis\n    join public.tree_spouses s\n      on coalesce(s.wife_is_family_member, false) = true\n     and (\n       public.tree_arabic_norm_v1(coalesce(s.wife_lineage, '')) = public.tree_arabic_norm_v1(sis.path)\n       or public.tree_nasab_nth_v1(coalesce(s.wife_name, s.wife_lineage, ''), 1) = sis.leaf\n     )\n     and (\n       select count(*)\n       from public.tree_spouses s2\n       where coalesce(s2.wife_is_family_member, false) = true\n         and (\n           public.tree_arabic_norm_v1(coalesce(s2.wife_lineage, '')) = public.tree_arabic_norm_v1(sis.path)\n           or public.tree_nasab_nth_v1(coalesce(s2.wife_name, s2.wife_lineage, ''), 1) = sis.leaf\n         )\n     ) = 1\n  ),\n  ibn_khala as (\n    select c.id\n    from public.tree_mother_links l\n    join sister_spouses ss on ss.spouse_id = l.spouse_id\n    join public.tree_children c on c.id = l.child_id\n    where lower(btrim(coalesce(l.confidence, 'confirmed'))) in ('', 'confirmed')\n      and not public.tree_child_is_daughter_v1(c.gender)\n      and c.id <> p_viewer_id\n  )\n  select mb.id, 'أخ من أمك'::text\n  from maternal_brothers mb\n  union all\n  select k.id, 'خالك'::text\n  from khals k\n  union all\n  select i.id, 'ابن خالك'::text\n  from ibn_khal i\n  union all\n  select x.id, 'ابن خالتك'::text\n  from ibn_khala x;\nend;\n$fn$;\n\ngrant execute on function public.tree_arabic_norm_v1(text) to anon, authenticated;\ngrant execute on function public.tree_nasab_tokens_v1(text) to anon, authenticated;\ngrant execute on function public.tree_nasab_nth_v1(text, integer) to anon, authenticated;\ngrant execute on function public.tree_path_leaf_v1(text) to anon, authenticated;\ngrant execute on function public.tree_child_is_daughter_v1(text) to anon, authenticated;\ngrant execute on function public.tree_mother_spouses_share_identity_v1(text, text, text, text) to anon, authenticated;\ngrant execute on function public.tree_maternal_kinship_for_viewer_v1(bigint) to anon, authenticated;\n\nnotify pgrst, 'reload schema';\n\nselect\n  (select to_regprocedure('public.tree_maternal_kinship_for_viewer_v1(bigint)') is not null)\n    as has_maternal_rpc;\n",
      order: 10.3693,
      supabaseOnce: true,
    },
    {
      id: "maint.tree_kinship_and_remarriage_bundle_v1",
      title: "حزمة نهائية: نسب الأم + ربط الأبناء + الزواج بعد الطلاق",
      desc:
        "أمر واحد لكل العلاقات المشابهة: نسب الأم (أخ من أمك/خال/ابن خال/ابن خالة) + ربط أبناء الأزواج بزوجات العائلة + حفظ الزوجة بعد الطلاق. الصقه مرة في Supabase أو شغّله من هنا ثم Hard Refresh.",
      file: "../supabase/sql/COPY-ME-tree-kinship-and-remarriage-bundle-v1.sql",
      sql: "-- COPY-ME: الصق مرة واحدة في Supabase → SQL Editor ثم Run\n-- Preset id: maint.tree_kinship_and_remarriage_bundle_v1\n--\n-- حزمة نهائية عامة (آمنة للتكرار):\n--   1) الزواج بعد الطلاق (حارس التكرار للنشيطات فقط + RPC الحفظ)\n--   2) نسب الأم: أخ من أمك / خالك / ابن خالك / ابن خالتك لأي أم من العائلة\n--   3) ربط جماعي: أبناء كل زوج بزوجته المسجّلة من العائلة\n--\n-- بعد التنفيذ: Hard Refresh لصفحة الإدارة والشجرة العامة.\n\n-- ============================================================\n-- 1) الزواج بعد الطلاق\n-- ============================================================\n\n-- Allow remarriage after divorce — spouse duplicate guard (active marriages only)\n-- Apply in Supabase SQL editor if inserts fail with:\n-- «هذه الزوجة مسجلة مسبقًا مع زوج آخر...» even after marking prior marriage as divorced.\n\ncreate or replace function public.tree_spouses_wife_identity_key_v1(p_text text)\nreturns text\nlanguage sql\nimmutable\nas $$\n  select nullif(\n    btrim(\n      regexp_replace(\n        regexp_replace(coalesce(p_text, ''), '\\m(بن|ابن|بنت)\\M', ' ', 'g'),\n        '\\s+',\n        ' ',\n        'g'\n      )\n    ),\n    ''\n  );\n$$;\n\ncreate or replace function public.tree_spouses_wife_identity_matches_v1(\n  p_a_name text,\n  p_a_lineage text,\n  p_b_name text,\n  p_b_lineage text\n) returns boolean\nlanguage plpgsql\nimmutable\nas $$\ndeclare\n  fa text[];\n  fb text[];\n  ka text;\n  kb text;\n  pa text[];\n  pb text[];\n  x text;\n  y text;\nbegin\n  fa := array_remove(array[p_a_lineage, p_a_name], null);\n  fb := array_remove(array[p_b_lineage, p_b_name], null);\n  if coalesce(array_length(fa, 1), 0) = 0 or coalesce(array_length(fb, 1), 0) = 0 then\n    return false;\n  end if;\n\n  foreach x in array fa loop\n    ka := public.tree_spouses_wife_identity_key_v1(x);\n    if ka is null then\n      continue;\n    end if;\n    pa := regexp_split_to_array(ka, '\\s+');\n    foreach y in array fb loop\n      kb := public.tree_spouses_wife_identity_key_v1(y);\n      if kb is null then\n        continue;\n      end if;\n      if ka = kb then\n        return true;\n      end if;\n      pb := regexp_split_to_array(kb, '\\s+');\n      if coalesce(array_length(pa, 1), 0) >= 3\n         and coalesce(array_length(pb, 1), 0) >= 3\n         and array_to_string(pa[1:3], ' ') = array_to_string(pb[1:3], ' ') then\n        return true;\n      end if;\n      if coalesce(array_length(pa, 1), 0) >= 3\n         and coalesce(array_length(pb, 1), 0) = 2\n         and array_to_string(pa[1:2], ' ') = array_to_string(pb, ' ') then\n        return true;\n      end if;\n      if coalesce(array_length(pb, 1), 0) >= 3\n         and coalesce(array_length(pa, 1), 0) = 2\n         and array_to_string(pb[1:2], ' ') = array_to_string(pa, ' ') then\n        return true;\n      end if;\n    end loop;\n  end loop;\n\n  return false;\nend;\n$$;\n\ncreate or replace function public.tree_spouses_guard_duplicate_wife_v1()\nreturns trigger\nlanguage plpgsql\nas $$\ndeclare\n  v_other public.tree_spouses%rowtype;\nbegin\n  if lower(btrim(coalesce(new.status, 'active'))) not in ('', 'active') then\n    return new;\n  end if;\n\n  for v_other in\n    select s.*\n    from public.tree_spouses s\n    where s.id is distinct from new.id\n      and s.husband_id is distinct from new.husband_id\n      and lower(btrim(coalesce(s.status, 'active'))) in ('', 'active')\n  loop\n    if public.tree_spouses_wife_identity_matches_v1(\n      new.wife_name,\n      new.wife_lineage,\n      v_other.wife_name,\n      v_other.wife_lineage\n    ) then\n      raise exception using\n        message = 'هذه الزوجة مسجلة نشطة مع زوج آخر. افتح الزوج السابق → تعديل الزوجة → غيّر الحالة إلى «مطلقة»، ثم أعد الإضافة.';\n    end if;\n  end loop;\n\n  return new;\nend;\n$$;\n\ndrop trigger if exists tree_spouses_duplicate_wife_guard on public.tree_spouses;\ndrop trigger if exists tree_spouses_guard_duplicate_wife on public.tree_spouses;\n\ncreate trigger tree_spouses_guard_duplicate_wife\n  before insert or update of wife_name, wife_lineage, status, husband_id\n  on public.tree_spouses\n  for each row\n  execute function public.tree_spouses_guard_duplicate_wife_v1();\n\n-- Admin RPC: bypass legacy duplicate triggers + end prior active marriages on remarriage.\ncreate or replace function public.admin_tree_spouse_upsert_v1(\n  p_token text,\n  p_spouse_id bigint,\n  p_row jsonb\n) returns jsonb\nlanguage plpgsql\nsecurity definer\nset search_path = public\nas $$\ndeclare\n  v_id bigint;\n  v_husband_id bigint;\n  v_other record;\n  v_status text;\n  v_family boolean;\nbegin\n  if not public.admin_token_ok_v1(p_token) then\n    raise exception 'not allowed';\n  end if;\n  if to_regclass('public.tree_spouses') is null then\n    raise exception 'tree_spouses table missing';\n  end if;\n\n  v_husband_id := nullif(p_row->>'husband_id', '')::bigint;\n  if v_husband_id is null then\n    raise exception 'missing husband_id';\n  end if;\n\n  v_status := lower(btrim(coalesce(p_row->>'status', 'active')));\n  if v_status not in ('', 'active', 'divorced', 'مطلقة') then\n    v_status := 'active';\n  end if;\n  if v_status in ('', 'active') then\n    v_status := 'active';\n  else\n    v_status := 'divorced';\n  end if;\n\n  if p_row ? 'wife_is_family_member' then\n    if jsonb_typeof(p_row->'wife_is_family_member') = 'boolean' then\n      v_family := (p_row->>'wife_is_family_member')::boolean;\n    elsif lower(btrim(coalesce(p_row->>'wife_is_family_member', ''))) in ('true', 't', '1', 'yes', 'نعم') then\n      v_family := true;\n    elsif lower(btrim(coalesce(p_row->>'wife_is_family_member', ''))) in ('false', 'f', '0', 'no', 'لا') then\n      v_family := false;\n    else\n      v_family := null;\n    end if;\n  else\n    v_family := null;\n  end if;\n\n  for v_other in\n    select s.*\n    from public.tree_spouses s\n    where s.id is distinct from coalesce(p_spouse_id, 0)\n      and s.husband_id is distinct from v_husband_id\n      and lower(btrim(coalesce(s.status, 'active'))) in ('', 'active')\n  loop\n    if public.tree_spouses_wife_identity_matches_v1(\n      p_row->>'wife_name',\n      p_row->>'wife_lineage',\n      v_other.wife_name,\n      v_other.wife_lineage\n    ) then\n      update public.tree_spouses\n      set status = 'divorced', updated_at = now()\n      where id = v_other.id;\n    end if;\n  end loop;\n\n  alter table public.tree_spouses disable trigger user;\n\n  if p_spouse_id is not null and p_spouse_id > 0 then\n    update public.tree_spouses s\n    set\n      husband_id = v_husband_id,\n      husband_person_id = nullif(p_row->>'husband_person_id', '')::uuid,\n      wife_name = nullif(btrim(coalesce(p_row->>'wife_name', '')), ''),\n      wife_is_family_member = v_family,\n      wife_branch_key = nullif(btrim(coalesce(p_row->>'wife_branch_key', '')), ''),\n      wife_family_name = nullif(btrim(coalesce(p_row->>'wife_family_name', '')), ''),\n      wife_lineage = nullif(btrim(coalesce(p_row->>'wife_lineage', '')), ''),\n      marriage_order = nullif(p_row->>'marriage_order', '')::int,\n      status = v_status,\n      confidence = nullif(btrim(coalesce(p_row->>'confidence', 'confirmed')), ''),\n      data_source = nullif(btrim(coalesce(p_row->>'data_source', 'admin')), ''),\n      updated_at = coalesce(nullif(p_row->>'updated_at', '')::timestamptz, now())\n    where s.id = p_spouse_id\n    returning s.id into v_id;\n  else\n    insert into public.tree_spouses (\n      husband_id,\n      husband_person_id,\n      wife_name,\n      wife_is_family_member,\n      wife_branch_key,\n      wife_family_name,\n      wife_lineage,\n      marriage_order,\n      status,\n      confidence,\n      data_source,\n      updated_at\n    ) values (\n      v_husband_id,\n      nullif(p_row->>'husband_person_id', '')::uuid,\n      nullif(btrim(coalesce(p_row->>'wife_name', '')), ''),\n      v_family,\n      nullif(btrim(coalesce(p_row->>'wife_branch_key', '')), ''),\n      nullif(btrim(coalesce(p_row->>'wife_family_name', '')), ''),\n      nullif(btrim(coalesce(p_row->>'wife_lineage', '')), ''),\n      nullif(p_row->>'marriage_order', '')::int,\n      v_status,\n      nullif(btrim(coalesce(p_row->>'confidence', 'confirmed')), ''),\n      nullif(btrim(coalesce(p_row->>'data_source', 'admin')), ''),\n      coalesce(nullif(p_row->>'updated_at', '')::timestamptz, now())\n    )\n    returning id into v_id;\n  end if;\n\n  alter table public.tree_spouses enable trigger user;\n\n  if v_id is null then\n    raise exception 'spouse upsert failed';\n  end if;\n\n  return jsonb_build_object('ok', true, 'id', v_id);\nexception\n  when others then\n    begin\n      alter table public.tree_spouses enable trigger user;\n    exception\n      when others then null;\n    end;\n    raise;\nend;\n$$;\n\nrevoke all on function public.admin_tree_spouse_upsert_v1(text, bigint, jsonb) from public;\ngrant execute on function public.admin_tree_spouse_upsert_v1(text, bigint, jsonb) to anon, authenticated;\n\n-- ============================================================\n-- 2) نسب الأم الكامل\n-- ============================================================\n\n-- COPY-ME: run in Supabase SQL Editor / SQL Workspace\n-- Preset id: maint.tree_maternal_kinship_v3\n--\n-- General maternal kinship for ANY family-member mother:\n--   أخ من أمك / خالك / ابن خالك / ابن خالتك\n-- Matches mother identity across different spouse rows (different husbands).\n-- Safe to re-run.\n\ncreate or replace function public.tree_arabic_norm_v1(p text)\nreturns text\nlanguage sql\nimmutable\nas $$\n  select lower(btrim(\n    regexp_replace(\n      regexp_replace(\n        regexp_replace(\n          regexp_replace(\n            regexp_replace(coalesce(p, ''), '[\\u064B-\\u065F\\u0670]', '', 'g'),\n            'ـ', '', 'g'),\n          '[أإآ]', 'ا', 'g'),\n        'ة', 'ه', 'g'),\n      'ى', 'ي', 'g')\n  ));\n$$;\n\ncreate or replace function public.tree_nasab_tokens_v1(p text)\nreturns text[]\nlanguage sql\nimmutable\nas $$\n  select coalesce(\n    array_remove(\n      string_to_array(\n        btrim(\n          regexp_replace(\n            public.tree_arabic_norm_v1(p),\n            '(^|[[:space:]])(بنت|بن|ابن)([[:space:]]|$)',\n            ' ',\n            'g'\n          )\n        ),\n        ' '\n      ),\n      ''\n    ),\n    '{}'::text[]\n  );\n$$;\n\ncreate or replace function public.tree_nasab_nth_v1(p text, p_n integer)\nreturns text\nlanguage sql\nimmutable\nas $$\n  select nullif((public.tree_nasab_tokens_v1(p))[greatest(p_n, 1)], '');\n$$;\n\ncreate or replace function public.tree_path_leaf_v1(p text)\nreturns text\nlanguage sql\nimmutable\nas $$\n  select public.tree_arabic_norm_v1(nullif(btrim(regexp_replace(coalesce(p, ''), '^.*/', '')), ''));\n$$;\n\ncreate or replace function public.tree_child_is_daughter_v1(p_gender text)\nreturns boolean\nlanguage sql\nimmutable\nas $$\n  select lower(btrim(coalesce(p_gender, ''))) in (\n    'daughter', 'female', 'f', 'أنثى', 'انثى', 'ابنة', 'بنت'\n  );\n$$;\n\ncreate or replace function public.tree_mother_spouses_share_identity_v1(\n  p_lineage_a text,\n  p_name_a text,\n  p_lineage_b text,\n  p_name_b text\n)\nreturns boolean\nlanguage sql\nimmutable\nas $$\n  select\n    (\n      coalesce(nullif(btrim(p_lineage_a), ''), nullif(btrim(p_name_a), '')) is not null\n      and coalesce(nullif(btrim(p_lineage_b), ''), nullif(btrim(p_name_b), '')) is not null\n    )\n    and (\n      (\n        nullif(btrim(p_lineage_a), '') is not null\n        and nullif(btrim(p_lineage_b), '') is not null\n        and public.tree_arabic_norm_v1(p_lineage_a) = public.tree_arabic_norm_v1(p_lineage_b)\n      )\n      or (\n        nullif(btrim(p_name_a), '') is not null\n        and nullif(btrim(p_name_b), '') is not null\n        and public.tree_arabic_norm_v1(p_name_a) = public.tree_arabic_norm_v1(p_name_b)\n      )\n      or (\n        public.tree_nasab_nth_v1(coalesce(p_name_a, p_lineage_a, ''), 1) is not null\n        and public.tree_nasab_nth_v1(coalesce(p_name_a, p_lineage_a, ''), 1)\n          = public.tree_nasab_nth_v1(coalesce(p_name_b, p_lineage_b, ''), 1)\n      )\n      or (\n        public.tree_nasab_nth_v1(coalesce(p_name_a, p_lineage_a, ''), 1) is not null\n        and public.tree_nasab_nth_v1(coalesce(p_name_a, p_lineage_a, ''), 2) is not null\n        and public.tree_nasab_nth_v1(coalesce(p_name_b, p_lineage_b, ''), 1) is not null\n        and public.tree_nasab_nth_v1(coalesce(p_name_b, p_lineage_b, ''), 2) is not null\n        and public.tree_nasab_nth_v1(coalesce(p_name_a, p_lineage_a, ''), 1)\n          = public.tree_nasab_nth_v1(coalesce(p_name_b, p_lineage_b, ''), 1)\n        and public.tree_nasab_nth_v1(coalesce(p_name_a, p_lineage_a, ''), 2)\n          = public.tree_nasab_nth_v1(coalesce(p_name_b, p_lineage_b, ''), 2)\n      )\n    );\n$$;\n\ncreate or replace function public.tree_maternal_kinship_for_viewer_v1(p_viewer_id bigint)\nreturns table(person_id bigint, label text)\nlanguage plpgsql\nstable\nsecurity definer\nset search_path = public\nas $fn$\ndeclare\n  v_spouse_id bigint;\n  v_lineage text;\n  v_wife_name text;\n  v_branch text;\n  v_leaf text;\n  v_father_leaf text;\n  v_mother_id bigint;\n  v_mother_path text;\n  v_gf_path text;\n  v_match_count int;\nbegin\n  if p_viewer_id is null or p_viewer_id < 1 then\n    return;\n  end if;\n\n  select\n    l.spouse_id,\n    nullif(btrim(coalesce(s.wife_lineage, l.mother_lineage, '')), ''),\n    nullif(btrim(coalesce(s.wife_name, l.mother_name, '')), ''),\n    nullif(btrim(coalesce(s.wife_branch_key, l.mother_branch_key, '')), '')\n  into v_spouse_id, v_lineage, v_wife_name, v_branch\n  from public.tree_mother_links l\n  left join public.tree_spouses s on s.id = l.spouse_id\n  where l.child_id = p_viewer_id\n    and lower(btrim(coalesce(l.confidence, 'confirmed'))) in ('', 'confirmed')\n    and coalesce(s.wife_is_family_member, l.mother_is_family_member, false) = true\n    and lower(btrim(coalesce(s.status, 'active'))) in ('', 'active')\n  order by l.child_id\n  limit 1;\n\n  if v_spouse_id is null then\n    return;\n  end if;\n\n  v_leaf := public.tree_nasab_nth_v1(coalesce(v_wife_name, v_lineage, ''), 1);\n  v_father_leaf := public.tree_nasab_nth_v1(coalesce(v_wife_name, v_lineage, ''), 2);\n\n  if v_lineage is not null and position('/' in v_lineage) > 0 then\n    select count(*) into v_match_count\n    from public.tree_children c\n    where (v_branch is null or c.branch_key = v_branch)\n      and (\n        public.tree_arabic_norm_v1(coalesce(c.child_name, c.name, ''))\n          = public.tree_arabic_norm_v1(v_lineage)\n        or public.tree_arabic_norm_v1(coalesce(c.name, ''))\n          = public.tree_arabic_norm_v1(v_lineage)\n      );\n    if v_match_count = 1 then\n      select c.id, coalesce(c.child_name, c.name), coalesce(c.parent_name, c.parent)\n      into v_mother_id, v_mother_path, v_gf_path\n      from public.tree_children c\n      where (v_branch is null or c.branch_key = v_branch)\n        and (\n          public.tree_arabic_norm_v1(coalesce(c.child_name, c.name, ''))\n            = public.tree_arabic_norm_v1(v_lineage)\n          or public.tree_arabic_norm_v1(coalesce(c.name, ''))\n            = public.tree_arabic_norm_v1(v_lineage)\n        )\n      limit 1;\n    elsif v_match_count = 0 then\n      v_mother_path := v_lineage;\n      v_gf_path := regexp_replace(v_lineage, '/[^/]+$', '');\n    end if;\n  end if;\n\n  if v_gf_path is null and v_leaf is not null then\n    select count(*) into v_match_count\n    from public.tree_children c\n    where (v_branch is null or c.branch_key = v_branch)\n      and public.tree_path_leaf_v1(coalesce(c.child_name, c.name)) = v_leaf\n      and (\n        v_father_leaf is null\n        or public.tree_path_leaf_v1(coalesce(c.parent_name, c.parent)) = v_father_leaf\n        or (\n          select count(*)\n          from public.tree_children c2\n          where (v_branch is null or c2.branch_key = v_branch)\n            and public.tree_path_leaf_v1(coalesce(c2.child_name, c2.name)) = v_leaf\n        ) = 1\n      );\n\n    if v_match_count = 1 then\n      select c.id, coalesce(c.child_name, c.name), coalesce(c.parent_name, c.parent), c.branch_key\n      into v_mother_id, v_mother_path, v_gf_path, v_branch\n      from public.tree_children c\n      where (v_branch is null or c.branch_key = v_branch)\n        and public.tree_path_leaf_v1(coalesce(c.child_name, c.name)) = v_leaf\n        and (\n          v_father_leaf is null\n          or public.tree_path_leaf_v1(coalesce(c.parent_name, c.parent)) = v_father_leaf\n          or (\n            select count(*)\n            from public.tree_children c2\n            where (v_branch is null or c2.branch_key = v_branch)\n              and public.tree_path_leaf_v1(coalesce(c2.child_name, c2.name)) = v_leaf\n          ) = 1\n        )\n      limit 1;\n    end if;\n  end if;\n\n  v_gf_path := nullif(btrim(coalesce(v_gf_path, '')), '');\n\n  return query\n  with matching_spouses as (\n    select s.id\n    from public.tree_spouses s\n    where coalesce(s.wife_is_family_member, false) = true\n      and lower(btrim(coalesce(s.status, 'active'))) in ('', 'active')\n      and (\n        s.id = v_spouse_id\n        or public.tree_mother_spouses_share_identity_v1(\n          v_lineage,\n          v_wife_name,\n          s.wife_lineage,\n          s.wife_name\n        )\n      )\n  ),\n  maternal_brothers as (\n    select distinct l.child_id as id\n    from public.tree_mother_links l\n    join matching_spouses ms on ms.id = l.spouse_id\n    join public.tree_children c on c.id = l.child_id\n    where lower(btrim(coalesce(l.confidence, 'confirmed'))) in ('', 'confirmed')\n      and not public.tree_child_is_daughter_v1(c.gender)\n      and l.child_id <> p_viewer_id\n  ),\n  khals as (\n    select c.id, coalesce(c.child_name, c.name) as path, c.branch_key\n    from public.tree_children c\n    where v_gf_path is not null\n      and coalesce(c.parent_name, c.parent) = v_gf_path\n      and (v_branch is null or c.branch_key = v_branch)\n      and not public.tree_child_is_daughter_v1(c.gender)\n      and (v_mother_id is null or c.id <> v_mother_id)\n      and (\n        v_mother_path is null\n        or public.tree_arabic_norm_v1(coalesce(c.child_name, c.name, ''))\n             <> public.tree_arabic_norm_v1(v_mother_path)\n      )\n  ),\n  ibn_khal as (\n    select s.id\n    from public.tree_children s\n    join khals k\n      on coalesce(s.parent_name, s.parent) = k.path\n     and s.branch_key = k.branch_key\n    where not public.tree_child_is_daughter_v1(s.gender)\n  ),\n  sisters as (\n    select c.id, coalesce(c.child_name, c.name) as path, c.branch_key,\n           public.tree_path_leaf_v1(coalesce(c.child_name, c.name)) as leaf\n    from public.tree_children c\n    where v_gf_path is not null\n      and coalesce(c.parent_name, c.parent) = v_gf_path\n      and (v_branch is null or c.branch_key = v_branch)\n      and public.tree_child_is_daughter_v1(c.gender)\n      and (v_mother_id is null or c.id <> v_mother_id)\n      and (\n        v_mother_path is null\n        or public.tree_arabic_norm_v1(coalesce(c.child_name, c.name, ''))\n             <> public.tree_arabic_norm_v1(v_mother_path)\n      )\n  ),\n  sister_spouses as (\n    select distinct s.id as spouse_id\n    from sisters sis\n    join public.tree_spouses s\n      on coalesce(s.wife_is_family_member, false) = true\n     and lower(btrim(coalesce(s.status, 'active'))) in ('', 'active')\n     and (\n       public.tree_arabic_norm_v1(coalesce(s.wife_lineage, '')) = public.tree_arabic_norm_v1(sis.path)\n       or public.tree_nasab_nth_v1(coalesce(s.wife_name, s.wife_lineage, ''), 1) = sis.leaf\n     )\n     and (\n       select count(*)\n       from public.tree_spouses s2\n       where coalesce(s2.wife_is_family_member, false) = true\n         and lower(btrim(coalesce(s2.status, 'active'))) in ('', 'active')\n         and (\n           public.tree_arabic_norm_v1(coalesce(s2.wife_lineage, '')) = public.tree_arabic_norm_v1(sis.path)\n           or public.tree_nasab_nth_v1(coalesce(s2.wife_name, s2.wife_lineage, ''), 1) = sis.leaf\n         )\n     ) = 1\n  ),\n  ibn_khala as (\n    select c.id\n    from public.tree_mother_links l\n    join sister_spouses ss on ss.spouse_id = l.spouse_id\n    join public.tree_children c on c.id = l.child_id\n    where lower(btrim(coalesce(l.confidence, 'confirmed'))) in ('', 'confirmed')\n      and not public.tree_child_is_daughter_v1(c.gender)\n      and c.id <> p_viewer_id\n  )\n  select mb.id, 'أخ من أمك'::text\n  from maternal_brothers mb\n  union all\n  select k.id, 'خالك'::text\n  from khals k\n  union all\n  select i.id, 'ابن خالك'::text\n  from ibn_khal i\n  union all\n  select x.id, 'ابن خالتك'::text\n  from ibn_khala x;\nend;\n$fn$;\n\ngrant execute on function public.tree_arabic_norm_v1(text) to anon, authenticated;\ngrant execute on function public.tree_nasab_tokens_v1(text) to anon, authenticated;\ngrant execute on function public.tree_nasab_nth_v1(text, integer) to anon, authenticated;\ngrant execute on function public.tree_path_leaf_v1(text) to anon, authenticated;\ngrant execute on function public.tree_child_is_daughter_v1(text) to anon, authenticated;\ngrant execute on function public.tree_mother_spouses_share_identity_v1(text, text, text, text) to anon, authenticated;\ngrant execute on function public.tree_maternal_kinship_for_viewer_v1(bigint) to anon, authenticated;\n\nnotify pgrst, 'reload schema';\n\nselect\n  (select to_regprocedure('public.tree_maternal_kinship_for_viewer_v1(bigint)') is not null)\n    as has_maternal_rpc;\n\n-- ============================================================\n-- 3) ربط جماعي للأبناء الموجودين\n-- ============================================================\n\n-- COPY-ME: run once in Supabase SQL Editor\n-- Preset id: maint.tree_mother_links_backfill_v1\n--\n-- Backfill tree_mother_links for ALL active family-member wives:\n-- links every son of the husband to the mother's spouse row.\n-- Safe to re-run (upsert on child_id).\n\ninsert into public.tree_mother_links (\n  child_id,\n  spouse_id,\n  mother_name,\n  mother_is_family_member,\n  mother_branch_key,\n  mother_family_name,\n  mother_lineage,\n  confidence,\n  updated_at\n)\nselect\n  c.id as child_id,\n  s.id as spouse_id,\n  s.wife_name,\n  s.wife_is_family_member,\n  s.wife_branch_key,\n  s.wife_family_name,\n  s.wife_lineage,\n  'confirmed',\n  now()\nfrom public.tree_spouses s\njoin public.tree_children h on h.id = s.husband_id\njoin public.tree_children c\n  on c.branch_key = h.branch_key\n and (\n   coalesce(c.parent_name, c.parent) = coalesce(h.child_name, h.name)\n   or coalesce(c.parent_name, c.parent) = public.tree_path_leaf_v1(coalesce(h.child_name, h.name))\n )\nwhere coalesce(s.wife_is_family_member, false) = true\n  and lower(btrim(coalesce(s.status, 'active'))) in ('', 'active')\n  and not public.tree_child_is_daughter_v1(c.gender)\non conflict (child_id) do update set\n  spouse_id = excluded.spouse_id,\n  mother_name = excluded.mother_name,\n  mother_is_family_member = excluded.mother_is_family_member,\n  mother_branch_key = excluded.mother_branch_key,\n  mother_family_name = excluded.mother_family_name,\n  mother_lineage = excluded.mother_lineage,\n  confidence = excluded.confidence,\n  updated_at = excluded.updated_at;\n\nselect count(*) as mother_links_total from public.tree_mother_links;\n",
      order: 10.3694,
      supabaseOnce: true,
    },
    {
      id: "maint.tree_maternal_kinship_v3",
      title: "نسب الأم الكامل: أخ من الأم + خال + ابن خال + ابن خالة",
      desc:
        "حل عام لكل الأمهات المربوطات: يطابق هوية الأم عبر زيجات مختلفة (أزواج مختلفون) ويُظهر أخ من أمك / خالك / ابن خالك / ابن خالتك. شغّله مرة ثم Hard Refresh.",
      file: "../supabase/sql/COPY-ME-tree-maternal-kinship-v3.sql",
      sql: `-- Preset id: maint.tree_maternal_kinship_v3
-- Run the full script from: supabase/sql/COPY-ME-tree-maternal-kinship-v3.sql
select (select to_regprocedure('public.tree_maternal_kinship_for_viewer_v1(bigint)') is not null) as has_maternal_rpc;`,
      order: 10.3695,
      supabaseOnce: true,
    },
    {
      id: "maint.tree_mother_links_backfill_v1",
      title: "ربط جماعي: كل أبناء الأزواج بزوجات العائلة",
      desc:
        "يربط أبناء الزوج بزوجته من العائلة فقط إذا كانت زوجته الوحيدة المسجّلة. لا يخلط أبناء زوجتين. شغّله مرة بعد تسجيل الزوجات ثم Hard Refresh.",
      file: "../supabase/sql/COPY-ME-tree-mother-links-backfill-v1.sql",
      sql: `-- COPY-ME: run once in Supabase SQL Editor
-- Preset id: maint.tree_mother_links_backfill_v1
--
-- Links sons to a family-member wife ONLY when that husband has exactly
-- one active wife. Does not assume motherhood when there are two wives.
-- Safe to re-run (upsert on child_id).

insert into public.tree_mother_links (
  child_id,
  spouse_id,
  mother_name,
  mother_is_family_member,
  mother_branch_key,
  mother_family_name,
  mother_lineage,
  confidence,
  updated_at
)
select
  c.id as child_id,
  s.id as spouse_id,
  s.wife_name,
  s.wife_is_family_member,
  s.wife_branch_key,
  s.wife_family_name,
  s.wife_lineage,
  'confirmed',
  now()
from public.tree_spouses s
join public.tree_children h on h.id = s.husband_id
join public.tree_children c
  on c.branch_key = h.branch_key
 and (
   coalesce(c.parent_name, c.parent) = coalesce(h.child_name, h.name)
   or coalesce(c.parent_name, c.parent) = public.tree_path_leaf_v1(coalesce(h.child_name, h.name))
 )
where coalesce(s.wife_is_family_member, false) = true
  and lower(btrim(coalesce(s.status, 'active'))) in ('', 'active')
  and not public.tree_child_is_daughter_v1(c.gender)
  and (
    select count(*)
    from public.tree_spouses s2
    where s2.husband_id = s.husband_id
      and lower(btrim(coalesce(s2.status, 'active'))) in ('', 'active')
  ) = 1
on conflict (child_id) do update set
  spouse_id = excluded.spouse_id,
  mother_name = excluded.mother_name,
  mother_is_family_member = excluded.mother_is_family_member,
  mother_branch_key = excluded.mother_branch_key,
  mother_family_name = excluded.mother_family_name,
  mother_lineage = excluded.mother_lineage,
  confidence = excluded.confidence,
  updated_at = excluded.updated_at;

select count(*) as mother_links_total from public.tree_mother_links;
`,
      order: 10.3696,
      supabaseOnce: true,
    },
    {
      id: "maint.tree_spouses_divorced_remarriage_v1",
      title: "الزواج الثاني بعد الطلاق — إصلاح حفظ الزوجة",
      desc:
        "يستبدل حارس التكرار القديم ليمنع فقط الزوجات «النشطة»، ويضيف RPC admin_tree_spouse_upsert_v1. شغّله مرة إذا ظهر «مسجلة مع زوج آخر» رغم أن الحالة مطلقة.",
      file: "../supabase/sql/COPY-ME-tree-spouses-divorced-remarriage-v1.sql",
      order: 10.375,
      supabaseOnce: true,
    },
    {
      id: "maint.delegate_set_status_tree_inbox_v1",
      title: "إصلاح رفض/قبول طلبات الشجرة عند المندوب",
      desc:
        "يصلح «تعذر رفض/قبول الطلب» لتصحيح الأب/الاسم والجوال. القائمة كانت تظهر الطلبات بينما تحديث الحالة يرفض بصلاحية write فقط. شغّله مرة ثم أعد المحاولة من طلبات فرعي.",
      file: "../supabase/sql/COPY-ME-delegate-set-status-tree-inbox.sql",
      sql: `-- COPY-ME: run in Supabase SQL Editor / SQL Workspace
-- Preset id: maint.delegate_set_status_tree_inbox_v1
--
-- Fixes: «تعذر رفض الطلب» for tree_edit / tree_card / memory while the same
-- requests appear in «طلبات فرعي».
--
-- Root cause: list uses tree/events can_read, but status change required
-- tree_delegate_allowed_v1 (tree.write only). Events-read or tree-read
-- delegates saw buttons but RPC returned false.
--
-- Also aligns branch match with delegates_v2_norm_branch (same as list v2).
-- Safe to re-run.

drop function if exists public.delegate_set_approval_request_status_v1(text, bigint, text);
drop function if exists public.delegate_set_approval_request_status_v1(text, bigint, text, text, text, text);

create or replace function public.delegate_set_approval_request_status_v1(
  p_branch_key text,
  p_request_id bigint,
  p_status text,
  p_phone text default null,
  p_email text default null,
  p_secret_hash text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.approval_requests%rowtype;
  v_status text;
  v_kind text;
  v_auth_ok boolean := false;
  v_stamp text;
  v_msg text;
  v_reviewer text;
  v_branch text := public.delegates_v2_norm_branch(p_branch_key);
begin
  v_status := case
    when lower(btrim(coalesce(p_status, ''))) = 'approved' then 'approved'
    when lower(btrim(coalesce(p_status, ''))) = 'rejected' then 'rejected'
    else null
  end;
  if v_status is null or p_request_id is null or v_branch is null or v_branch = '' then
    return false;
  end if;

  select * into v_row
  from public.approval_requests r
  where r.id = p_request_id
    and r.status = 'pending'
    and r.kind in (
      'event_card',
      'family_event',
      'event_request',
      'tree_card',
      'tree_edit',
      'memory_card'
    )
    and public.delegates_v2_norm_branch(r.branch_key) = v_branch
  limit 1;

  if v_row.id is null then
    return false;
  end if;

  v_kind := coalesce(v_row.kind, '');

  if p_phone is not null or p_email is not null or p_secret_hash is not null then
    if v_kind in ('event_card', 'family_event', 'event_request') then
      v_auth_ok :=
        public.events_delegate_allowed_v1(p_branch_key, p_phone, p_email, p_secret_hash)
        or public.events_delegate_can_read_v1(p_branch_key, p_phone, p_email, p_secret_hash);
    elsif v_kind in ('tree_card', 'tree_edit', 'memory_card') then
      v_auth_ok :=
        public.tree_delegate_allowed_v1(p_branch_key, p_phone, p_email, p_secret_hash)
        or public.tree_delegate_can_read_v1(p_branch_key, p_phone, p_email, p_secret_hash)
        or public.events_delegate_can_read_v1(p_branch_key, p_phone, p_email, p_secret_hash);
    else
      return false;
    end if;

    if not v_auth_ok then
      return false;
    end if;
  end if;

  v_reviewer := null;
  begin
    select nullif(btrim(coalesce(d.name, '')), '')
      into v_reviewer
    from public.delegates_v2 d
    where public.delegates_v2_norm_branch(d.branch_key) = v_branch
      and (
        nullif(btrim(coalesce(p_phone, '')), '') is null
        or public.delegates_v2_norm_phone(d.phone)
           = public.delegates_v2_norm_phone(p_phone)
      )
      and coalesce(d.is_enabled, false) is true
    order by d.updated_at desc nulls last
    limit 1;
  exception when others then
    v_reviewer := null;
  end;

  if v_reviewer is not null then
    v_stamp := E'\n---\nتمت مراجعة الطلب بواسطة المندوب: ' || v_reviewer || '.';
  elsif nullif(btrim(coalesce(p_phone, '')), '') is not null
     or nullif(btrim(coalesce(p_email, '')), '') is not null then
    v_stamp := E'\n---\nتمت مراجعة الطلب بواسطة مندوب الفرع.';
  else
    v_stamp := E'\n---\nتمت مراجعة الطلب بواسطة أحد المراجعين المعتمدين.';
  end if;

  v_msg := coalesce(v_row.message, '');
  if position('تمت مراجعة الطلب بواسطة' in v_msg) = 0 then
    v_msg := v_msg || v_stamp;
  end if;

  update public.approval_requests
  set
    status = v_status,
    message = v_msg
  where id = p_request_id
    and status = 'pending';

  return found;
end;
$$;

revoke all on function public.delegate_set_approval_request_status_v1(text, bigint, text, text, text, text) from public;
grant execute on function public.delegate_set_approval_request_status_v1(text, bigint, text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';

select
  (select to_regprocedure(
    'public.delegate_set_approval_request_status_v1(text,bigint,text,text,text,text)'
  ) is not null) as set_status_ready,
  (
    select pg_get_functiondef(
      'public.delegate_set_approval_request_status_v1(text,bigint,text,text,text,text)'::regprocedure
    ) like '%tree_delegate_can_read_v1%'
  ) as inbox_allows_tree_read;
`,
      order: 10.37,
      supabaseOnce: true,
    },
    {
      id: "maint.delegate_set_status_tree_inbox_v2",
      title: "إصلاح رفض/قبول v2 (نفس مصادقة القائمة)",
      desc:
        "v1 لم تكفِ: القائمة تنجح بمتغيرات الجوال بينما الرفض يفشل. هذه البطاقة تجعل قبول/رفض الطلب يستخدم نفس بوابة المصادقة التي تفتح «طلبات فرعي». شغّلها مرة ثم حدّث الصفحة وأعد رفض/قبول.",
      file: "../supabase/sql/COPY-ME-delegate-set-status-tree-inbox-v2.sql",
      sql: `-- COPY-ME: maint.delegate_set_status_tree_inbox_v2
-- Align set-status auth with list/login (phone variants + check_* + secret soft-find).

create or replace function public.delegate_inbox_actor_ok_v1(
  p_branch_key text,
  p_phone text,
  p_email text,
  p_secret_hash text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_branch text := public.delegates_v2_norm_branch(p_branch_key);
  v_hash text := nullif(btrim(coalesce(p_secret_hash, '')), '');
  v_phone_raw text := nullif(btrim(coalesce(p_phone, '')), '');
  v_digits text := public.delegates_v2_norm_phone(p_phone);
  v_phones text[];
  v_try_phone text;
  v_check jsonb;
  i int;
begin
  if v_branch is null or v_branch = '' or v_hash is null then
    return false;
  end if;

  v_phones := array[]::text[];
  if v_phone_raw is not null then
    v_phones := array_append(v_phones, v_phone_raw);
  end if;
  if v_digits is not null and v_digits <> '' then
    v_phones := array_append(v_phones, v_digits);
    if length(v_digits) = 9 and left(v_digits, 1) = '5' then
      v_phones := v_phones || array['0' || v_digits, '966' || v_digits, '+966' || v_digits];
    elsif length(v_digits) = 10 and left(v_digits, 2) = '05' then
      v_phones := v_phones || array[substr(v_digits, 2), '966' || substr(v_digits, 2), '+966' || substr(v_digits, 2)];
    elsif length(v_digits) >= 12 and left(v_digits, 3) = '966' then
      v_phones := v_phones || array['0' || substr(v_digits, 4), substr(v_digits, 4), '+' || v_digits];
    end if;
  end if;

  select coalesce(array_agg(x order by ord), array[]::text[])
    into v_phones
  from (
    select x, min(ord) as ord
    from unnest(v_phones) with ordinality as u(x, ord)
    where nullif(btrim(x), '') is not null
    group by x
  ) s;

  for i in 1 .. coalesce(array_length(v_phones, 1), 0) loop
    v_try_phone := v_phones[i];

    begin
      v_check := public.check_tree_delegate_access(
        p_branch_key, v_try_phone, coalesce(p_email, ''), v_hash
      );
      if coalesce((v_check->>'allowed')::boolean, false) is true then
        return true;
      end if;
    exception when others then null;
    end;

    begin
      v_check := public.check_events_delegate_access(
        p_branch_key, v_try_phone, coalesce(p_email, ''), v_hash
      );
      if coalesce((v_check->>'allowed')::boolean, false) is true then
        return true;
      end if;
    exception when others then null;
    end;

    begin
      if exists (
        select 1 from public.delegates_v2 d
        where public.delegates_v2_norm_branch(d.branch_key) = v_branch
          and public.delegates_v2_norm_phone(d.phone)
            = public.delegates_v2_norm_phone(v_try_phone)
          and nullif(btrim(coalesce(d.secret_hash, '')), '') is not null
          and d.secret_hash = v_hash
          and coalesce(d.is_enabled, false) is true
      ) then
        return true;
      end if;
    exception when others then null;
    end;
  end loop;

  begin
    if exists (
      select 1 from public.delegates_v2 d
      where public.delegates_v2_norm_branch(d.branch_key) = v_branch
        and d.secret_hash = v_hash
        and coalesce(d.is_enabled, false) is true
    ) then
      return true;
    end if;
  exception when others then null;
  end;

  return false;
end;
$$;

revoke all on function public.delegate_inbox_actor_ok_v1(text, text, text, text) from public;
grant execute on function public.delegate_inbox_actor_ok_v1(text, text, text, text) to anon, authenticated;

drop function if exists public.delegate_set_approval_request_status_v1(text, bigint, text);
drop function if exists public.delegate_set_approval_request_status_v1(text, bigint, text, text, text, text);

create or replace function public.delegate_set_approval_request_status_v1(
  p_branch_key text,
  p_request_id bigint,
  p_status text,
  p_phone text default null,
  p_email text default null,
  p_secret_hash text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.approval_requests%rowtype;
  v_status text;
  v_stamp text;
  v_msg text;
  v_reviewer text;
  v_branch text := public.delegates_v2_norm_branch(p_branch_key);
begin
  v_status := case
    when lower(btrim(coalesce(p_status, ''))) = 'approved' then 'approved'
    when lower(btrim(coalesce(p_status, ''))) = 'rejected' then 'rejected'
    else null
  end;
  if v_status is null or p_request_id is null or v_branch is null or v_branch = '' then
    return false;
  end if;

  select * into v_row
  from public.approval_requests r
  where r.id = p_request_id
    and r.status = 'pending'
    and r.kind in (
      'event_card', 'family_event', 'event_request',
      'tree_card', 'tree_edit', 'memory_card'
    )
    and public.delegates_v2_norm_branch(r.branch_key) = v_branch
  limit 1;

  if v_row.id is null then
    return false;
  end if;

  if p_phone is not null or p_email is not null or p_secret_hash is not null then
    if not public.delegate_inbox_actor_ok_v1(
      p_branch_key, p_phone, p_email, p_secret_hash
    ) then
      return false;
    end if;
  end if;

  v_reviewer := null;
  begin
    select nullif(btrim(coalesce(d.name, '')), '') into v_reviewer
    from public.delegates_v2 d
    where public.delegates_v2_norm_branch(d.branch_key) = v_branch
      and d.secret_hash = nullif(btrim(coalesce(p_secret_hash, '')), '')
      and coalesce(d.is_enabled, false) is true
    order by d.updated_at desc nulls last
    limit 1;
  exception when others then v_reviewer := null;
  end;

  if v_reviewer is not null then
    v_stamp := E'\n---\nتمت مراجعة الطلب بواسطة المندوب: ' || v_reviewer || '.';
  else
    v_stamp := E'\n---\nتمت مراجعة الطلب بواسطة مندوب الفرع.';
  end if;

  v_msg := coalesce(v_row.message, '');
  if position('تمت مراجعة الطلب بواسطة' in v_msg) = 0 then
    v_msg := v_msg || v_stamp;
  end if;

  update public.approval_requests
  set status = v_status, message = v_msg
  where id = p_request_id and status = 'pending';

  return found;
end;
$$;

revoke all on function public.delegate_set_approval_request_status_v1(text, bigint, text, text, text, text) from public;
grant execute on function public.delegate_set_approval_request_status_v1(text, bigint, text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';

select
  (select to_regprocedure('public.delegate_inbox_actor_ok_v1(text,text,text,text)') is not null)
    as actor_ok_ready,
  (
    select pg_get_functiondef(
      'public.delegate_set_approval_request_status_v1(text,bigint,text,text,text,text)'::regprocedure
    ) like '%delegate_inbox_actor_ok_v1%'
  ) as set_status_uses_list_auth;
`,
      order: 10.38,
      supabaseOnce: true,
    },
    {
      id: "maint.delegate_branch_requests_expand_v3",
      title: "إلزامي: إظهار التصحيحات وطلبات الشجرة عند المندوب",
      desc:
        "هذا الأمر الذي يُظهر تصحيح الأب/الاسم/الجوال في «طلبات فرعي». ليس منفّذ Workspace وليس dual_role. يعيد بناء delegate_list لتشمل tree_edit + tree_card + memory. شغّله ثم بطاقة التحقق. إن بقي الأرشيف يقول إن v2 منفّذ فتجاهله — نفّذ هذه البطاقة v3.",
      file: "../supabase/sql/COPY-ME-delegate-branch-requests-expand.sql",
      sql: `-- COPY-ME: Expand branch-delegate request queue beyond events + keep history.
-- Preset id: maint.delegate_branch_requests_expand_v3
-- (v1 may be archived as «منفذ» while live body was still pending-only —
--  the old probe only checked to_regprocedure IS NOT NULL.)
-- Run manually in Supabase SQL Editor / SQL Workspace. Do NOT auto-execute from the app.
--
-- Goal (Request Lifecycle v2):
--   Branch delegate can list + approve/reject branch requests for:
--     event_card / family_event / event_request
--     tree_card  (إضافة فرد)
--     tree_edit  (تصحيح)
--     memory_card (ذكرى — إن وُجدت في approval_requests)
--   Explicitly EXCLUDED (central admin only):
--     special_card (البطاقة / طلب بطاقة)
--     tree_delegate / events_delegate / delegate_secret_reset / …
--     events_audit / tree_audit (internal audit rows — never in inbox)
--
-- CRITICAL: list returns pending + approved + rejected so handled items
-- do NOT disappear from «طلبات فرعي».
--
-- Enriched payload (jsonb array): approval_requests fields + schedule/publish
-- fields joined from family_events when published (show_at, show_before_days,
-- event_date, end_at, manual_hidden, published, event_id) + reviewed_by when
-- stamped on the message.
-- Visibility state is computed on read by the client (no cron).
--
-- Auth:
--   List: tree OR events can_read (same gate as portal login read path)
--   Status change:
--     event kinds  → events_delegate_allowed_v1
--     tree/memory  → tree_delegate_allowed_v1
--   On status change: append internal review stamp with delegate display name.

drop function if exists public.delegate_list_event_requests_v1(text, text, text, text);

create or replace function public.delegate_list_event_requests_v1(
  p_branch_key text,
  p_phone text,
  p_email text,
  p_secret_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_out jsonb := '[]'::jsonb;
begin
  -- Read gate (not write/allowed): login uses can_read; list must match.
  if not (
    public.tree_delegate_can_read_v1(p_branch_key, p_phone, p_email, p_secret_hash)
    or public.events_delegate_can_read_v1(p_branch_key, p_phone, p_email, p_secret_hash)
  ) then
    return v_out;
  end if;

  select coalesce(jsonb_agg(row_payload order by sort_status, created_at desc), '[]'::jsonb)
  into v_out
  from (
    select
      (
        to_jsonb(r)
        || jsonb_build_object(
          'show_at', e.show_at,
          'show_before_days', e.show_before_days,
          'event_date', e.event_date,
          'end_at', e.end_at,
          'manual_hidden', e.manual_hidden,
          'published', (e.id is not null),
          'event_id', e.id,
          'date_label', e.date_label,
          'event_type', e.type,
          'reviewed_by', nullif(
            btrim(
              coalesce(
                (regexp_match(
                  coalesce(r.message, ''),
                  'تمت مراجعة الطلب بواسطة المندوب:\s*([^\n\r]+)'
                ))[1],
                (regexp_match(
                  coalesce(r.message, ''),
                  'تمت مراجعة الطلب بواسطة\s*([^\n\r.]+)'
                ))[1],
                ''
              )
            ),
            ''
          )
        )
      ) as row_payload,
      case lower(coalesce(r.status, ''))
        when 'pending' then 0
        when 'approved' then 1
        when 'rejected' then 2
        else 3
      end as sort_status,
      r.created_at
    from public.approval_requests r
    left join lateral (
      select fe.*
      from public.family_events fe
      where nullif(btrim(coalesce(r.request_id, '')), '') is not null
        and (
          coalesce(fe.details, '') like '%' || r.request_id || '%'
        )
        and regexp_replace(btrim(coalesce(fe.branch_key, '')), '\s+', ' ', 'g')
          = regexp_replace(btrim(coalesce(r.branch_key, '')), '\s+', ' ', 'g')
      order by fe.id desc
      limit 1
    ) e on true
    where r.status in ('pending', 'approved', 'rejected')
      and r.kind in (
        'event_card',
        'family_event',
        'event_request',
        'tree_card',
        'tree_edit',
        'memory_card'
      )
      -- special_card + audit kinds intentionally excluded
      and regexp_replace(btrim(coalesce(r.branch_key, '')), '\s+', ' ', 'g')
        = regexp_replace(btrim(coalesce(p_branch_key, '')), '\s+', ' ', 'g')
    order by sort_status, r.created_at desc
    limit 200
  ) q;

  return coalesce(v_out, '[]'::jsonb);
end;
$$;

drop function if exists public.delegate_set_approval_request_status_v1(text, bigint, text);
drop function if exists public.delegate_set_approval_request_status_v1(text, bigint, text, text, text, text);

create or replace function public.delegate_set_approval_request_status_v1(
  p_branch_key text,
  p_request_id bigint,
  p_status text,
  p_phone text default null,
  p_email text default null,
  p_secret_hash text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.approval_requests%rowtype;
  v_status text;
  v_kind text;
  v_auth_ok boolean := false;
  v_stamp text;
  v_msg text;
  v_reviewer text;
begin
  v_status := case
    when lower(btrim(coalesce(p_status, ''))) = 'approved' then 'approved'
    when lower(btrim(coalesce(p_status, ''))) = 'rejected' then 'rejected'
    else null
  end;
  if v_status is null then
    return false;
  end if;

  select * into v_row
  from public.approval_requests r
  where r.id = p_request_id
    and r.status = 'pending'
    and r.kind in (
      'event_card',
      'family_event',
      'event_request',
      'tree_card',
      'tree_edit',
      'memory_card'
    )
    and regexp_replace(btrim(coalesce(r.branch_key, '')), '\s+', ' ', 'g')
      = regexp_replace(btrim(coalesce(p_branch_key, '')), '\s+', ' ', 'g')
  limit 1;

  if v_row.id is null then
    return false;
  end if;

  v_kind := coalesce(v_row.kind, '');

  if p_phone is not null or p_email is not null or p_secret_hash is not null then
    if v_kind in ('event_card', 'family_event', 'event_request') then
      v_auth_ok := public.events_delegate_allowed_v1(
        p_branch_key, p_phone, p_email, p_secret_hash
      );
    elsif v_kind in ('tree_card', 'tree_edit', 'memory_card') then
      v_auth_ok := public.tree_delegate_allowed_v1(
        p_branch_key, p_phone, p_email, p_secret_hash
      );
    else
      return false;
    end if;

    if not v_auth_ok then
      return false;
    end if;
  end if;

  -- Prefer display name from delegates_v2 (security definer path).
  v_reviewer := null;
  begin
    select nullif(btrim(coalesce(d.name, '')), '')
      into v_reviewer
    from public.delegates_v2 d
    where public.delegates_v2_norm_branch(d.branch_key)
        = public.delegates_v2_norm_branch(p_branch_key)
      and (
        nullif(btrim(coalesce(p_phone, '')), '') is null
        or public.delegates_v2_norm_phone(d.phone)
           = public.delegates_v2_norm_phone(p_phone)
      )
      and coalesce(d.is_enabled, false) is true
    order by d.updated_at desc nulls last
    limit 1;
  exception when others then
    v_reviewer := null;
  end;

  if v_reviewer is not null then
    v_stamp := E'\n---\nتمت مراجعة الطلب بواسطة المندوب: ' || v_reviewer || '.';
  elsif nullif(btrim(coalesce(p_phone, '')), '') is not null
     or nullif(btrim(coalesce(p_email, '')), '') is not null then
    v_stamp := E'\n---\nتمت مراجعة الطلب بواسطة مندوب الفرع.';
  else
    v_stamp := E'\n---\nتمت مراجعة الطلب بواسطة أحد المراجعين المعتمدين.';
  end if;

  v_msg := coalesce(v_row.message, '');
  if position('تمت مراجعة الطلب بواسطة' in v_msg) = 0 then
    v_msg := v_msg || v_stamp;
  end if;

  update public.approval_requests
  set
    status = v_status,
    message = v_msg
  where id = p_request_id;

  return found;
end;
$$;

grant execute on function public.delegate_list_event_requests_v1(text, text, text, text) to anon, authenticated;
grant execute on function public.delegate_set_approval_request_status_v1(text, bigint, text, text, text, text) to anon, authenticated;

-- Smoke: prove BODY is lifecycle v2 (not merely that the name exists).
select
  (select to_regprocedure('public.delegate_list_event_requests_v1(text,text,text,text)') is not null) as has_list,
  (select to_regprocedure('public.delegate_set_approval_request_status_v1(text,bigint,text,text,text,text)') is not null) as has_set,
  (
    select coalesce(pg_get_functiondef('public.delegate_list_event_requests_v1(text,text,text,text)'::regprocedure), '')
      like '%pending%'
     and coalesce(pg_get_functiondef('public.delegate_list_event_requests_v1(text,text,text,text)'::regprocedure), '')
      like '%approved%'
     and coalesce(pg_get_functiondef('public.delegate_list_event_requests_v1(text,text,text,text)'::regprocedure), '')
      like '%rejected%'
     and coalesce(pg_get_functiondef('public.delegate_list_event_requests_v1(text,text,text,text)'::regprocedure), '')
      like '%show_at%'
     and coalesce(pg_get_functiondef('public.delegate_list_event_requests_v1(text,text,text,text)'::regprocedure), '')
      like '%jsonb_agg%'
  ) as list_body_is_lifecycle_v2,
  (
    select pg_typeof(public.delegate_list_event_requests_v1('__probe__', '', '', ''))::text
  ) as list_return_type;
`,
      order: 11,
      supabaseOnce: true,
    },
    {
      id: "maint.delegates_v2_update_email_v1",
      title: "تحديث بريد المندوب من مساحة العمل",
      desc: "RPC: delegates_v2_update_email_v1 — المندوب المعتمد يحفظ/يحدّث email عبر الجوال+الفرع+الرقم السري (ليس مفتاح دخول).",
      file: "../supabase/sql/COPY-ME-delegates-v2-update-email.sql",
      sql: `-- COPY-ME: delegates_v2_update_email_v1
-- Auth: branch + phone + secret_hash (email is notify-only, not login).

create or replace function public.delegates_v2_update_email_v1(
  p_branch_key text,
  p_phone text,
  p_secret_hash text,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch text;
  v_phone text;
  v_hash text := nullif(btrim(coalesce(p_secret_hash, '')), '');
  v_email text;
  v_row public.delegates_v2%rowtype;
  v_legacy_n integer := 0;
begin
  if to_regclass('public.delegates_v2') is null then
    return jsonb_build_object('ok', false, 'reason', 'no_v2_schema');
  end if;

  v_branch := public.delegates_v2_norm_branch(p_branch_key);
  v_phone := public.delegates_v2_norm_phone(p_phone);
  v_email := public.delegates_v2_norm_email(p_email);

  if v_branch = '' or v_phone = '' or v_hash is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;

  if v_email = ''
     or position('@' in v_email) = 0
     or position('.' in v_email) = 0
     or char_length(v_email) < 6 then
    return jsonb_build_object('ok', false, 'reason', 'bad_email');
  end if;

  select d.*
  into v_row
  from public.delegates_v2 d
  where public.delegates_v2_norm_branch(d.branch_key) = v_branch
    and public.delegates_v2_norm_phone(d.phone) = v_phone
    and nullif(btrim(coalesce(d.secret_hash, '')), '') is not null
    and d.secret_hash = v_hash
  order by d.updated_at desc nulls last, d.created_at desc nulls last
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if coalesce(v_row.is_enabled, false) is not true then
    return jsonb_build_object('ok', false, 'reason', 'disabled', 'delegate_id', v_row.id);
  end if;

  update public.delegates_v2 d
  set email = v_email,
      updated_at = now()
  where d.id = v_row.id;

  update public.approval_requests r
  set email = v_email
  where r.kind in ('tree_delegate', 'events_delegate')
    and r.status = 'approved'
    and public.delegates_v2_norm_branch(r.branch_key) = v_branch
    and public.delegates_v2_norm_phone(r.phone) = v_phone;

  get diagnostics v_legacy_n = row_count;

  return jsonb_build_object(
    'ok', true,
    'delegate_id', v_row.id,
    'branch_key', v_branch,
    'phone', v_phone,
    'email', v_email,
    'legacy_updated', v_legacy_n
  );
end;
$$;

revoke all on function public.delegates_v2_update_email_v1(text, text, text, text) from public;
grant execute on function public.delegates_v2_update_email_v1(text, text, text, text) to anon, authenticated;
`,
      order: 32,
      supabaseOnce: true,
    },
    {
      id: "maint.repair_null_parent_columns_dry_run_v1",
      title: "معاينة parent/child_name الفارغ (dry-run)",
      desc: "قراءة فقط: يعرض الصفوف ذات parent أو child_name فارغ ومقترح الملء. شغّله أولًا قبل APPLY. ليس إصلاحًا تلقائيًا.",
      file: "../supabase/sql/COPY-ME-repair-null-parent-columns-dry-run.sql",
      sql: `-- =============================================================================
-- COPY-ME: Dry-run — صفوف parent / child_name الفارغ (قراءة فقط)
-- Preset: maint.repair_null_parent_columns_dry_run_v1
-- سياسة: لا تشغيل تلقائي من Health Center (R-7). راجع الصفوف ثم شغّل APPLY منفصلًا.
-- ملاحظة Workspace: أمر SELECT واحد فقط — بلا /* */ (تصنيف المنفّذ يعلّق عليها).
-- =============================================================================

SELECT
  id,
  branch_key,
  parent,
  parent_name,
  child_name,
  name,
  coalesce(
    nullif(btrim(parent_name), ''),
    CASE
      WHEN position('/' in coalesce(name, child_name, '')) > 0
        THEN regexp_replace(coalesce(name, child_name), '/[^/]+$', '')
      ELSE NULL
    END
  ) AS proposed_parent,
  parent_person_id
FROM public.tree_children
WHERE nullif(btrim(coalesce(parent, '')), '') IS NULL
   OR nullif(btrim(coalesce(child_name, '')), '') IS NULL
ORDER BY branch_key, id
LIMIT 200;
`,
      order: 40,
    },
    {
      id: "maint.repair_null_parent_columns_apply_v1",
      title: "تطبيق ملء parent/child_name (APPLY)",
      desc: "كتابة: املأ parent من parent_name أو مسار name بعد نجاح dry-run وموافقة صريحة. لا Auto Repair من مركز الصحة.",
      file: "../supabase/sql/COPY-ME-repair-null-parent-columns-apply.sql",
      sql: `-- =============================================================================
-- COPY-ME: APPLY — ملء parent / child_name الفارغ (كتابة)
-- Preset: maint.repair_null_parent_columns_apply_v1
-- سياسة: شغّل فقط بعد نجاح dry-run وموافقة صريحة. ليس Auto Repair.
-- Safe to re-run. لا يحذف صفوفًا.
-- ملاحظة Workspace: بلا تعليقات كتلية /* */ — أوامر صريحة فقط.
-- =============================================================================

UPDATE public.tree_children c
SET
  parent = coalesce(
    nullif(btrim(c.parent), ''),
    nullif(btrim(c.parent_name), ''),
    CASE
      WHEN position('/' in coalesce(c.name, c.child_name, '')) > 0
        THEN regexp_replace(coalesce(c.name, c.child_name), '/[^/]+$', '')
      ELSE NULL
    END
  ),
  parent_name = coalesce(
    nullif(btrim(c.parent_name), ''),
    nullif(btrim(c.parent), ''),
    CASE
      WHEN position('/' in coalesce(c.name, c.child_name, '')) > 0
        THEN regexp_replace(coalesce(c.name, c.child_name), '/[^/]+$', '')
      ELSE c.parent_name
    END
  ),
  child_name = coalesce(nullif(btrim(c.child_name), ''), nullif(btrim(c.name), '')),
  name = coalesce(nullif(btrim(c.name), ''), nullif(btrim(c.child_name), ''))
WHERE nullif(btrim(coalesce(c.parent, '')), '') IS NULL
   OR nullif(btrim(coalesce(c.child_name, '')), '') IS NULL;

SELECT count(*) AS still_null_parent
FROM public.tree_children
WHERE nullif(btrim(coalesce(parent, '')), '') IS NULL;
`,
      order: 41,
    },
    {
      id: "maint.link_uuid_nada_tuaisan_hamad_mohammad_dry_run_v1",
      title: "ربط UUID سلسلة نداء-طعيسان-حمد-محمد (1738-1740) — معاينة",
      desc: "SELECT واحد آمن لـ Workspace: اسم الأب وperson_id لـ 1738/1739/1740. إن لم يُحل نداء بفرادة يظهر المرشحون دون APPLY.",
      file: "../supabase/sql/COPY-ME-link-uuid-nada-tuaisan-hamad-mohammad-dry-run.sql",
      sql: `-- =============================================================================
-- COPY-ME: معاينة ربط UUID — سلسلة نداء→طعيسان→حمد→محمد (ids 1738-1740 فقط)
-- Preset: maint.link_uuid_nada_tuaisan_hamad_mohammad_dry_run_v1
-- قراءة فقط.

SELECT
  c.id AS child_id,
  coalesce(c.name, c.child_name) AS child_name_path,
  coalesce(nullif(btrim(c.parent), ''), nullif(btrim(c.parent_name), '')) AS child_parent_text,
  c.person_id AS child_person_id,
  c.parent_person_id AS child_parent_person_id_now,
  CASE c.id
    WHEN 1738 THEN '1738 → person_id(1739)'
    WHEN 1739 THEN '1739 → person_id(1740)'
    WHEN 1740 THEN '1740 → person_id(نداء الفريد)'
  END AS intended_link,
  CASE c.id
    WHEN 1738 THEN 1739::bigint
    WHEN 1739 THEN 1740::bigint
    WHEN 1740 THEN (
      SELECT min(f.id)
      FROM public.tree_children f
      WHERE f.branch_key = c.branch_key
        AND f.id <> c.id
        AND f.person_id IS NOT NULL
        AND coalesce(nullif(btrim(f.name), ''), nullif(btrim(f.child_name), ''))
          = coalesce(nullif(btrim(c.parent), ''), nullif(btrim(c.parent_name), ''))
      HAVING count(DISTINCT f.person_id) = 1
    )
  END AS proposed_father_id,
  CASE c.id
    WHEN 1738 THEN (SELECT coalesce(f.name, f.child_name) FROM public.tree_children f WHERE f.id = 1739)
    WHEN 1739 THEN (SELECT coalesce(f.name, f.child_name) FROM public.tree_children f WHERE f.id = 1740)
    WHEN 1740 THEN (
      SELECT min(coalesce(f.name, f.child_name))
      FROM public.tree_children f
      WHERE f.branch_key = c.branch_key
        AND f.id <> c.id
        AND f.person_id IS NOT NULL
        AND coalesce(nullif(btrim(f.name), ''), nullif(btrim(f.child_name), ''))
          = coalesce(nullif(btrim(c.parent), ''), nullif(btrim(c.parent_name), ''))
      HAVING count(DISTINCT f.person_id) = 1
    )
  END AS proposed_father_name,
  CASE c.id
    WHEN 1738 THEN (SELECT f.person_id FROM public.tree_children f WHERE f.id = 1739)
    WHEN 1739 THEN (SELECT f.person_id FROM public.tree_children f WHERE f.id = 1740)
    WHEN 1740 THEN (
      SELECT min(f.person_id::text)::uuid
      FROM public.tree_children f
      WHERE f.branch_key = c.branch_key
        AND f.id <> c.id
        AND f.person_id IS NOT NULL
        AND coalesce(nullif(btrim(f.name), ''), nullif(btrim(f.child_name), ''))
          = coalesce(nullif(btrim(c.parent), ''), nullif(btrim(c.parent_name), ''))
      HAVING count(DISTINCT f.person_id) = 1
    )
  END AS proposed_father_person_id,
  CASE
    WHEN c.id = 1738 AND (SELECT person_id FROM public.tree_children WHERE id = 1739) IS NOT NULL THEN 'ready'
    WHEN c.id = 1739 AND (SELECT person_id FROM public.tree_children WHERE id = 1740) IS NOT NULL THEN 'ready'
    WHEN c.id = 1740 AND (
      SELECT count(DISTINCT f.person_id)
      FROM public.tree_children f
      WHERE f.branch_key = c.branch_key AND f.id <> c.id AND f.person_id IS NOT NULL
        AND coalesce(nullif(btrim(f.name), ''), nullif(btrim(f.child_name), ''))
          = coalesce(nullif(btrim(c.parent), ''), nullif(btrim(c.parent_name), ''))
    ) = 1 THEN 'ready_exact_unique'
    WHEN c.id = 1740 AND (
      SELECT count(*)
      FROM public.tree_children f
      WHERE f.branch_key = c.branch_key AND f.id <> c.id AND f.person_id IS NOT NULL
        AND coalesce(nullif(btrim(f.name), ''), nullif(btrim(f.child_name), ''))
          = coalesce(nullif(btrim(c.parent), ''), nullif(btrim(c.parent_name), ''))
    ) = 0 THEN 'stop_no_exact_match'
    WHEN c.id = 1740 THEN 'stop_ambiguous_exact'
    ELSE 'blocked'
  END AS apply_status
FROM public.tree_children c
WHERE c.id IN (1738, 1739, 1740)
ORDER BY c.id;
`,
      order: 50,
    },
    {
      id: "maint.link_uuid_nada_tuaisan_hamad_mohammad_apply_v1",
      title: "ربط UUID سلسلة نداء-طعيسان-حمد-محمد (1738-1740) — APPLY",
      desc: "UPDATE واحد لـ parent_person_id فقط (بلا CTE). 1740 بشرط نداء فريد. أعد المعاينة بعد النجاح. لا Auto Repair.",
      file: "../supabase/sql/COPY-ME-link-uuid-nada-tuaisan-hamad-mohammad-apply.sql",
      sql: `-- =============================================================================
-- COPY-ME: APPLY ربط UUID — سلسلة نداء→طعيسان→حمد→محمد (ids 1738-1740 فقط)
-- Preset: maint.link_uuid_nada_tuaisan_hamad_mohammad_apply_v1
-- عنوان البطاقة: ربط UUID سلسلة نداء-طعيسان-حمد-محمد (1738-1740) — APPLY
-- يكتب parent_person_id فقط. لا يغيّر name أو parent. لا ينشئ أو يحذف.
-- 1738→1739 و 1739→1740 إن وُجد person_id للأب.
-- 1740→نداء فقط عند تطابق نصي فريد لـ parent مع name أو child_name في نفس الفرع.
-- أمر UPDATE واحد — بدون تعليقات كتلية — مناسب لـ execute_v1.
-- بعد النجاح أعد المعاينة للتحقق.
-- =============================================================================

UPDATE public.tree_children c
SET parent_person_id = t.father_person_id
FROM (
  SELECT
    1738::bigint AS child_id,
    f.person_id AS father_person_id
  FROM public.tree_children f
  WHERE f.id = 1739
    AND f.person_id IS NOT NULL
  UNION ALL
  SELECT
    1739::bigint,
    f.person_id
  FROM public.tree_children f
  WHERE f.id = 1740
    AND f.person_id IS NOT NULL
  UNION ALL
  SELECT
    child.id,
    min(f.person_id::text)::uuid
  FROM public.tree_children child
  JOIN public.tree_children f
    ON f.branch_key = child.branch_key
   AND f.id <> child.id
   AND f.person_id IS NOT NULL
   AND coalesce(nullif(btrim(f.name), ''), nullif(btrim(f.child_name), ''))
     = coalesce(nullif(btrim(child.parent), ''), nullif(btrim(child.parent_name), ''))
  WHERE child.id = 1740
    AND coalesce(nullif(btrim(child.parent), ''), nullif(btrim(child.parent_name), '')) IS NOT NULL
  GROUP BY child.id
  HAVING count(DISTINCT f.person_id) = 1
) t
WHERE c.id = t.child_id
  AND c.id IN (1738, 1739, 1740)
  AND c.parent_person_id IS DISTINCT FROM t.father_person_id;
`,
      order: 51,
    },
    {
      id: "maint.event_schedule_visibility_probe_v1",
      title: "تحقق: جدولة/توسيع الجسم/دفع (قراءة فقط)",
      desc: "SELECT واحد: أعمدة الجدولة + list_body_is_lifecycle_v2 (يجب true — وجود الدالة وحده لا يكفي) + تفعيل مزدوج + دفع. لا يغيّر بيانات.",
      sql: `-- VERIFY ONLY (read): schedule columns + REAL list-body lifecycle check
-- Old probe only checked to_regprocedure IS NOT NULL — that stayed true for pending-only.
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'family_events'
      and column_name in ('show_before_days', 'show_at', 'end_at', 'manual_hidden')) as family_event_schedule_cols,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'banner_messages'
      and column_name in ('show_start', 'show_end', 'is_permanent')) as banner_schedule_cols,
  (select to_regprocedure('public.delegate_list_event_requests_v1(text,text,text,text)') is not null) as has_delegate_list_fn,
  (
    select coalesce(pg_get_functiondef('public.delegate_list_event_requests_v1(text,text,text,text)'::regprocedure), '')
      like '%pending%'
     and coalesce(pg_get_functiondef('public.delegate_list_event_requests_v1(text,text,text,text)'::regprocedure), '')
      like '%approved%'
     and coalesce(pg_get_functiondef('public.delegate_list_event_requests_v1(text,text,text,text)'::regprocedure), '')
      like '%rejected%'
     and coalesce(pg_get_functiondef('public.delegate_list_event_requests_v1(text,text,text,text)'::regprocedure), '')
      like '%show_at%'
     and coalesce(pg_get_functiondef('public.delegate_list_event_requests_v1(text,text,text,text)'::regprocedure), '')
      not like '%r.status = ''pending''%'
  ) as list_body_is_lifecycle_v2,
  (select to_regprocedure('public.delegates_v2_activate_from_request_pk_v1(bigint)') is not null) as has_dual_role_activate,
  (select to_regclass('public.push_send_dedupe') is not null) as has_push_send_dedupe,
  (select exists(
      select 1 from information_schema.columns
      where table_schema='public' and table_name='push_tokens' and column_name='phone'
   )) as has_push_tokens_phone;
`,
      order: 54.5,
    },
    {
      id: "maint.public_my_request_statuses_v1",
      title: "طلباتي: مزامنة حالة الطلب للمقدّم",
      desc:
        "مطلوب لواجهة الرئيسية «طلباتي»: دالة SECURITY DEFINER تُرجع request_id + status + سبب رفض آمن من الرسالة. بدونها تبقى الطلبات بانتظار رغم القبول/الرفض. آمن لإعادة التشغيل.",
      sql: `-- Homepage «طلباتي» live status sync for submitters.
-- anon cannot SELECT approval_requests under RLS.
-- No reject_reason column — reason extracted from message lines only.

create or replace function public.public_my_request_statuses_v1(p_ids text[])
returns table(request_id text, status text, reject_reason text)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_ids text[];
begin
  select coalesce(array_agg(distinct upper(btrim(x))), array[]::text[])
    into v_ids
  from unnest(coalesce(p_ids, array[]::text[])) as t(x)
  where nullif(btrim(x), '') is not null;

  if v_ids is null or cardinality(v_ids) = 0 then
    return;
  end if;

  return query
  select
    r.request_id::text,
    lower(btrim(coalesce(r.status, '')))::text as status,
    coalesce(
      nullif(
        btrim(
          substring(
            regexp_replace(coalesce(r.message, ''), E'\\s*__JSON__[\\s\\S]*$', '', 'n')
            from E'(?m)^(?:سبب الرفض|السبب|سبب)\\s*:\\s*(.+)$'
          )
        ),
        ''
      ),
      ''
    )::text as reject_reason
  from public.approval_requests r
  where upper(btrim(coalesce(r.request_id, ''))) = any (v_ids)
  limit 50;
end;
$fn$;

revoke all on function public.public_my_request_statuses_v1(text[]) from public;
grant execute on function public.public_my_request_statuses_v1(text[]) to anon, authenticated;

select
  (to_regprocedure('public.public_my_request_statuses_v1(text[])') is not null)
    as has_public_my_request_statuses_v1;
`,
      order: 54.6,
    },
    {
      id: "maint.public_my_requests_by_phone_v1",
      title: "طلباتي: جلب طلبات العضو برقم الجوال",
      desc:
        "بعد تسجيل الدخول من ملفي: دالة SECURITY DEFINER تُرجع طلبات هذا الجوال (إضافة/تصحيح/مناسبة/ذكرى) دون قراءة الجدول مباشرة. تطابق آخر 9 أرقام. الصق مرة في محرر SQL.",
      sql: `-- Homepage «طلباتي» for a member logged in by phone.
-- anon cannot SELECT approval_requests under RLS.
-- Matches last 9 digits. Does not return message.

create or replace function public.public_my_requests_by_phone_v1(p_phone text)
returns table(
  request_id text,
  kind text,
  status text,
  created_at timestamptz,
  reject_reason text
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_tail text;
begin
  v_tail := right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 9);
  if v_tail is null or length(v_tail) < 9 then
    return;
  end if;

  return query
  select
    r.request_id::text,
    btrim(coalesce(r.kind, ''))::text as kind,
    lower(btrim(coalesce(r.status, '')))::text as status,
    r.created_at,
    coalesce(
      nullif(
        btrim(
          substring(
            regexp_replace(coalesce(r.message, ''), E'\\s*__JSON__[\\s\\S]*$', '', 'n')
            from E'(?m)^(?:سبب الرفض|السبب|سبب)\\s*:\\s*(.+)$'
          )
        ),
        ''
      ),
      ''
    )::text as reject_reason
  from public.approval_requests r
  where r.kind in (
      'event_card',
      'family_event',
      'event_request',
      'tree_card',
      'tree_edit',
      'memory_card'
    )
    and r.status in ('pending', 'approved', 'rejected', 'submitted')
    and right(regexp_replace(coalesce(r.phone, ''), '[^0-9]', '', 'g'), 9) = v_tail
  order by r.created_at desc
  limit 20;
end;
$fn$;

revoke all on function public.public_my_requests_by_phone_v1(text) from public;
grant execute on function public.public_my_requests_by_phone_v1(text) to anon, authenticated;

select
  (to_regprocedure('public.public_my_requests_by_phone_v1(text)') is not null)
    as has_public_my_requests_by_phone_v1;
`,
      order: 54.65,
    },
    {
      id: "maint.event_schedule_visibility_v1",
      title: "جدولة ظهور المناسبات والأخبار",
      desc:
        "آمن لإعادة التشغيل: أعمدة الجدولة + تحديث دوال النشر/الحفظ/إدراج المندوب. SQL مضمّن (لا يعتمد على fetch لملف gitignored). إن ظهرت الأعمدة فقط بدون سلوك الجدولة فأعد تشغيل هذه البطاقة.",
      file: "../supabase/sql/COPY-ME-event-schedule-visibility.sql",
      sql: `-- =============================================================================
-- COPY-ME: event schedule visibility + banner time window
-- Preset id: maint.event_schedule_visibility_v1
-- Safe to re-run (IF NOT EXISTS / CREATE OR REPLACE).
--
-- What this does:
--   1) family_events: show_before_days, show_at, end_at, manual_hidden
--   2) banner_messages: show_start, show_end, is_permanent
--   3) Update admin publish/save RPCs to persist schedule fields (optional columns)
--
-- Visibility is computed on read by the app (no cron required).
-- Soft-hide only — never deletes rows for expiry.
-- =============================================================================

-- 1) family_events schedule columns
alter table public.family_events
  add column if not exists show_before_days int;

alter table public.family_events
  add column if not exists show_at timestamptz;

alter table public.family_events
  add column if not exists end_at timestamptz;

alter table public.family_events
  add column if not exists manual_hidden boolean default false;

comment on column public.family_events.show_before_days is
  'Days before event_date when public visibility starts (default 3). Overridden by show_at.';
comment on column public.family_events.show_at is
  'Optional absolute timestamp when the event becomes publicly visible.';
comment on column public.family_events.end_at is
  'Optional absolute timestamp when public visibility ends (soft-hide).';
comment on column public.family_events.manual_hidden is
  'Admin/delegate early soft-hide; row kept in DB.';

-- Backfill defaults for dated happy rows missing schedule (do not mass-touch delegates)
update public.family_events e
set show_before_days = coalesce(e.show_before_days, 3)
where e.show_before_days is null
  and e.event_date is not null
  and lower(coalesce(e.type, '')) not in ('death', 'sick', 'operation', 'discharge');

-- 2) banner_messages time window
alter table public.banner_messages
  add column if not exists show_start timestamptz;

alter table public.banner_messages
  add column if not exists show_end timestamptz;

alter table public.banner_messages
  add column if not exists is_permanent boolean default false;

comment on column public.banner_messages.show_start is
  'When the banner becomes visible (null = use created_at legacy window).';
comment on column public.banner_messages.show_end is
  'When the banner soft-hides (null + is_permanent=true = permanent).';
comment on column public.banner_messages.is_permanent is
  'If true, ignore show_end and keep visible until is_active=false.';

-- Seed show_start from created_at where missing (preserve current behaviour)
update public.banner_messages b
set show_start = coalesce(b.show_start, b.created_at)
where b.show_start is null;

update public.banner_messages b
set show_end = coalesce(
  b.show_end,
  b.created_at + make_interval(days => greatest(1, least(coalesce(b.show_days, 7), 7)))
)
where b.show_end is null
  and coalesce(b.is_permanent, false) = false
  and b.created_at is not null;

-- 3) admin_publish_event_card_v1 — persist schedule columns when present
create or replace function public.admin_publish_event_card_v1(
  p_token text,
  p_request_id text,
  p_row jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id text;
  v_details text;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  v_request_id := nullif(btrim(coalesce(p_request_id, '')), '');
  if v_request_id is null or p_row is null or jsonb_typeof(p_row) <> 'object' then
    return false;
  end if;

  if exists (
    select 1
    from public.family_events e
    where coalesce(e.details, '') like '%' || v_request_id || '%'
  ) then
    return true;
  end if;

  v_details := nullif(p_row->>'details', '');

  insert into public.family_events (
    branch_key,
    type,
    person,
    date_label,
    event_date,
    details,
    hospital_name,
    hospital_dept,
    contact_method,
    contact_phone,
    visit_date_from,
    visit_date_to,
    visit_time_from,
    visit_time_to,
    created_at,
    show_before_days,
    show_at,
    end_at,
    manual_hidden
  )
  values (
    nullif(p_row->>'branch_key', ''),
    nullif(p_row->>'type', ''),
    nullif(p_row->>'person', ''),
    nullif(p_row->>'date_label', ''),
    case
      when btrim(coalesce(p_row->>'event_date', '')) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        and substring(btrim(p_row->>'event_date') from 1 for 4)::int between 1800 and 2100
      then btrim(p_row->>'event_date')::date
      else null
    end,
    v_details,
    nullif(p_row->>'hospital_name', ''),
    nullif(p_row->>'hospital_dept', ''),
    nullif(p_row->>'contact_method', ''),
    nullif(p_row->>'contact_phone', ''),
    case
      when btrim(coalesce(p_row->>'visit_date_from', '')) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      then btrim(p_row->>'visit_date_from')::date
      else null
    end,
    case
      when btrim(coalesce(p_row->>'visit_date_to', '')) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      then btrim(p_row->>'visit_date_to')::date
      else null
    end,
    nullif(p_row->>'visit_time_from', ''),
    nullif(p_row->>'visit_time_to', ''),
    coalesce(nullif(p_row->>'created_at', '')::timestamptz, now()),
    coalesce(
      nullif(p_row->>'show_before_days', '')::int,
      3
    ),
    nullif(p_row->>'show_at', '')::timestamptz,
    nullif(p_row->>'end_at', '')::timestamptz,
    coalesce((p_row->>'manual_hidden')::boolean, false)
  );

  return true;
end;
$$;

revoke all on function public.admin_publish_event_card_v1(text, text, jsonb) from public;
grant execute on function public.admin_publish_event_card_v1(text, text, jsonb) to anon, authenticated;

-- 4) admin_family_event_insert/save — keep schedule fields
create or replace function public.admin_family_event_insert_v1(
  p_token text,
  p_row jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  if p_row is null or jsonb_typeof(p_row) <> 'object' then
    return jsonb_build_object('ok', false);
  end if;

  if nullif(btrim(coalesce(p_row->>'branch_key', '')), '') is null
     or nullif(btrim(coalesce(p_row->>'type', '')), '') is null
     or nullif(btrim(coalesce(p_row->>'person', '')), '') is null then
    return jsonb_build_object('ok', false);
  end if;

  insert into public.family_events (
    branch_key,
    type,
    person,
    date_label,
    event_date,
    details,
    hospital_name,
    hospital_dept,
    contact_method,
    contact_phone,
    visit_date_from,
    visit_date_to,
    visit_time_from,
    visit_time_to,
    created_at,
    show_before_days,
    show_at,
    end_at,
    manual_hidden
  )
  values (
    nullif(btrim(p_row->>'branch_key'), ''),
    nullif(btrim(p_row->>'type'), ''),
    nullif(btrim(p_row->>'person'), ''),
    nullif(btrim(p_row->>'date_label'), ''),
    nullif(btrim(p_row->>'event_date'), '')::date,
    nullif(p_row->>'details', ''),
    nullif(btrim(p_row->>'hospital_name'), ''),
    nullif(btrim(p_row->>'hospital_dept'), ''),
    nullif(btrim(p_row->>'contact_method'), ''),
    nullif(btrim(p_row->>'contact_phone'), ''),
    nullif(btrim(p_row->>'visit_date_from'), '')::date,
    nullif(btrim(p_row->>'visit_date_to'), '')::date,
    nullif(btrim(p_row->>'visit_time_from'), ''),
    nullif(btrim(p_row->>'visit_time_to'), ''),
    coalesce(nullif(btrim(p_row->>'created_at'), '')::timestamptz, now()),
    coalesce(nullif(btrim(p_row->>'show_before_days'), '')::int, 3),
    nullif(btrim(p_row->>'show_at'), '')::timestamptz,
    nullif(btrim(p_row->>'end_at'), '')::timestamptz,
    coalesce((p_row->>'manual_hidden')::boolean, false)
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.admin_family_event_save_v1(
  p_token text,
  p_row jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
  v_updated boolean := false;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  if p_row is null or jsonb_typeof(p_row) <> 'object' then
    return jsonb_build_object('ok', false);
  end if;

  v_id := nullif(btrim(coalesce(p_row->>'id', '')), '')::bigint;
  if v_id is null then
    return jsonb_build_object('ok', false);
  end if;

  if nullif(btrim(coalesce(p_row->>'branch_key', '')), '') is null
     or nullif(btrim(coalesce(p_row->>'type', '')), '') is null
     or nullif(btrim(coalesce(p_row->>'person', '')), '') is null then
    return jsonb_build_object('ok', false, 'id', v_id);
  end if;

  update public.family_events e
  set
    branch_key = nullif(btrim(p_row->>'branch_key'), ''),
    type = nullif(btrim(p_row->>'type'), ''),
    person = nullif(btrim(p_row->>'person'), ''),
    date_label = nullif(btrim(p_row->>'date_label'), ''),
    event_date = nullif(btrim(p_row->>'event_date'), '')::date,
    details = nullif(p_row->>'details', ''),
    hospital_name = nullif(btrim(p_row->>'hospital_name'), ''),
    hospital_dept = nullif(btrim(p_row->>'hospital_dept'), ''),
    contact_method = nullif(btrim(p_row->>'contact_method'), ''),
    contact_phone = nullif(btrim(p_row->>'contact_phone'), ''),
    visit_date_from = nullif(btrim(p_row->>'visit_date_from'), '')::date,
    visit_date_to = nullif(btrim(p_row->>'visit_date_to'), '')::date,
    visit_time_from = nullif(btrim(p_row->>'visit_time_from'), ''),
    visit_time_to = nullif(btrim(p_row->>'visit_time_to'), ''),
    show_before_days = coalesce(
      nullif(btrim(p_row->>'show_before_days'), '')::int,
      e.show_before_days,
      3
    ),
    show_at = coalesce(
      nullif(btrim(p_row->>'show_at'), '')::timestamptz,
      e.show_at
    ),
    end_at = coalesce(
      nullif(btrim(p_row->>'end_at'), '')::timestamptz,
      e.end_at
    ),
    manual_hidden = coalesce(
      (p_row->>'manual_hidden')::boolean,
      e.manual_hidden,
      false
    )
  where e.id = v_id;

  v_updated := found;
  return jsonb_build_object('ok', v_updated, 'id', v_id);
end;
$$;

grant execute on function public.admin_family_event_insert_v1(text, jsonb) to anon, authenticated;
grant execute on function public.admin_family_event_save_v1(text, jsonb) to anon, authenticated;

-- 5) banner update RPC — accept show_start / show_end / is_permanent
create or replace function public.admin_banner_message_update_v1(
  p_token text,
  p_id bigint,
  p_branch_key text,
  p_message text,
  p_show_days int,
  p_is_active boolean,
  p_created_at timestamptz default null,
  p_show_start timestamptz default null,
  p_show_end timestamptz default null,
  p_is_permanent boolean default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  update public.banner_messages b
  set
    branch_key = nullif(trim(coalesce(p_branch_key, '')), ''),
    message = nullif(trim(coalesce(p_message, '')), ''),
    show_days = greatest(1, least(coalesce(p_show_days, b.show_days, 7), 7)),
    is_active = coalesce(p_is_active, b.is_active, true),
    created_at = coalesce(p_created_at, b.created_at),
    show_start = coalesce(p_show_start, p_created_at, b.show_start, b.created_at),
    show_end = case
      when coalesce(p_is_permanent, b.is_permanent, false) then null
      else coalesce(p_show_end, b.show_end)
    end,
    is_permanent = coalesce(p_is_permanent, b.is_permanent, false)
  where b.id = p_id;

  return found;
end;
$$;

grant execute on function public.admin_banner_message_update_v1(
  text, bigint, text, text, int, boolean, timestamptz, timestamptz, timestamptz, boolean
) to anon, authenticated;

-- Optional: keep older 7-arg signature working via overload wrapper
create or replace function public.admin_banner_message_update_v1(
  p_token text,
  p_id bigint,
  p_branch_key text,
  p_message text,
  p_show_days int,
  p_is_active boolean,
  p_created_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.admin_banner_message_update_v1(
    p_token,
    p_id,
    p_branch_key,
    p_message,
    p_show_days,
    p_is_active,
    p_created_at,
    p_created_at,
    null,
    null
  );
end;
$$;

grant execute on function public.admin_banner_message_update_v1(
  text, bigint, text, text, int, boolean, timestamptz
) to anon, authenticated;

-- 5) Delegate insert path — persist schedule so approve ≠ immediate public show
create or replace function public.family_events_insert_v1(
  p_branch_key text,
  p_phone text,
  p_email text,
  p_secret_hash text,
  p_row jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.events_delegate_allowed_v1(p_branch_key, p_phone, p_email, p_secret_hash) then
    return false;
  end if;

  insert into public.family_events (
    branch_key,
    type,
    person,
    date_label,
    event_date,
    details,
    hospital_name,
    hospital_dept,
    contact_method,
    contact_phone,
    visit_date_from,
    visit_date_to,
    visit_time_from,
    visit_time_to,
    created_at,
    show_before_days,
    show_at,
    end_at,
    manual_hidden
  )
  values (
    p_branch_key,
    nullif(p_row->>'type', ''),
    nullif(p_row->>'person', ''),
    nullif(p_row->>'date_label', ''),
    nullif(p_row->>'event_date', '')::date,
    nullif(p_row->>'details', ''),
    nullif(p_row->>'hospital_name', ''),
    nullif(p_row->>'hospital_dept', ''),
    nullif(p_row->>'contact_method', ''),
    nullif(p_row->>'contact_phone', ''),
    nullif(p_row->>'visit_date_from', '')::date,
    nullif(p_row->>'visit_date_to', '')::date,
    nullif(p_row->>'visit_time_from', ''),
    nullif(p_row->>'visit_time_to', ''),
    coalesce(nullif(p_row->>'created_at', '')::timestamptz, now()),
    coalesce(nullif(p_row->>'show_before_days', '')::int, 3),
    nullif(p_row->>'show_at', '')::timestamptz,
    nullif(p_row->>'end_at', '')::timestamptz,
    coalesce((p_row->>'manual_hidden')::boolean, false)
  );

  -- Internal audit only — edge notify MUST skip events_audit kinds.
  perform public.events_audit_log_v1(
    p_branch_key,
    p_phone,
    p_email,
    p_secret_hash,
    jsonb_build_object(
      'v', 1,
      'kind', 'events_audit',
      'op', 'insert',
      'branch_key', p_branch_key,
      'type', coalesce(p_row->>'type', ''),
      'person', coalesce(p_row->>'person', ''),
      'event_date', coalesce(p_row->>'event_date', ''),
      'at', now()::timestamptz
    )
  );

  return true;
end;
$$;

grant execute on function public.family_events_insert_v1(text, text, text, text, jsonb) to anon, authenticated;

-- Smoke select (workspace-friendly final statement)
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'family_events'
      and column_name in ('show_before_days', 'show_at', 'end_at', 'manual_hidden')) as family_event_schedule_cols,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'banner_messages'
      and column_name in ('show_start', 'show_end', 'is_permanent')) as banner_schedule_cols;
`,
      order: 55,
    },
    {
      id: "maint.admin_delete_request_unpublish_event_v1",
      title: "حذف الطلب يلغي نشر المناسبة (family_events)",
      desc:
        "CREATE OR REPLACE لـ admin_delete_request_v1: عند حذف event_card يُحذف صف family_events المطابق لـ request_id. لا يمس tree_card. بدون silent exception.",
      file: "../supabase/sql/COPY-ME-admin-delete-request-unpublish-event.sql",
      sql: `-- Extends admin_delete_request_v1 so deleting an event_card request
-- also removes the published family_events row (public ticker / المناسبات).
-- Resolves p_id as approval_requests.id (digits-only) OR request_id (EVN-*).
-- Never strip digits from EVN-* (e.g. EVN-A6HR-PLQ8 must not become id=68).
-- No silent exception swallow — real errors surface to the admin UI.

create or replace function public.admin_delete_request_v1(
  p_token text,
  p_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_raw text := nullif(btrim(coalesce(p_id, '')), '');
  v_id bigint := null;
  v_kind text := null;
  v_request_id text := null;
begin
  if not public.admin_token_ok_v1(p_token) then
    return false;
  end if;

  if v_raw is null then
    return false;
  end if;

  -- Pure digits = approval_requests.id.
  if v_raw ~ '^[0-9]+$' then
    v_id := v_raw::bigint;
    select r.kind, r.request_id
      into v_kind, v_request_id
    from public.approval_requests r
    where r.id = v_id
    limit 1;
  else
    -- EVN-* / OCC-* / any non-pure-numeric token → request_id lookup.
    select r.id, r.kind, r.request_id
      into v_id, v_kind, v_request_id
    from public.approval_requests r
    where r.request_id = v_raw
    limit 1;
  end if;

  if v_id is null then
    return false;
  end if;

  if v_kind in ('event_card', 'family_event', 'event_request')
     and nullif(btrim(coalesce(v_request_id, '')), '') is not null then
    delete from public.family_events e
    where coalesce(e.details, '') like '%' || v_request_id || '%';
  end if;

  delete from public.approval_requests where id = v_id;
  return found;
end;
$$;

revoke all on function public.admin_delete_request_v1(text, text) from public;
grant execute on function public.admin_delete_request_v1(text, text) to anon, authenticated;
`,
      order: 60,
      supabaseOnce: true,
    },
    {
      id: "maint.admin_family_event_delete_unlink_request_v1",
      title: "حذف المناسبة يلغي طلب المندوب",
      desc:
        "إلزامي: admin_family_event_delete_v1 + family_events_delete_v1. حذف المناسبة من الإدارة أو لوحة المندوب يُزيل أيضاً طلب event_card من «طلبات فرعي». شغّله مرة ثم أعد الحذف.",
      file: "../supabase/sql/COPY-ME-admin-family-event-delete-unlink-request.sql",
      sql: `-- COPY-ME: run in Supabase SQL Editor / SQL Workspace
-- Preset id: maint.admin_family_event_delete_unlink_request_v1
--
-- Admin delete of a family_events row must also remove the linked
-- approval_requests (event_card / family_event / event_request) so the item
-- disappears from homepage AND delegate «طلبات فرعي» (not left as «منشور»).
-- Also replaces family_events_delete_v1 so delegate panel delete unlinks the same way.
--
-- Safe to re-run (CREATE OR REPLACE only — no data DELETE).

create or replace function public.admin_family_event_delete_v1(
  p_token text,
  p_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_details text;
  v_request_id text := null;
  v_deleted boolean := false;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  if p_id is null or p_id <= 0 then
    return false;
  end if;

  select e.details
    into v_details
  from public.family_events e
  where e.id = p_id
  limit 1;

  if not found then
    return false;
  end if;

  -- Extract requestId / request_id from details JSON when present.
  begin
    if nullif(btrim(coalesce(v_details, '')), '') is not null then
      v_request_id := nullif(btrim(coalesce(
        (v_details::jsonb)->>'requestId',
        (v_details::jsonb)->>'request_id',
        ((v_details::jsonb)->'event')->>'requestId',
        ((v_details::jsonb)->'event')->>'request_id',
        ''
      )), '');
    end if;
  exception
    when others then
      v_request_id := null;
  end;

  -- Fallback: requestId embedded as text in details.
  if v_request_id is null and nullif(btrim(coalesce(v_details, '')), '') is not null then
    v_request_id := nullif(
      btrim(
        coalesce(
          (regexp_match(v_details, '("requestId"|"request_id")\\s*:\\s*"([^"]+)"'))[2],
          (regexp_match(v_details, '(EVN-[A-Z0-9]+-[A-Z0-9]+)'))[1],
          ''
        )
      ),
      ''
    );
  end if;

  delete from public.family_events e where e.id = p_id;
  v_deleted := found;

  if not v_deleted then
    return false;
  end if;

  -- Remove linked approval request so delegate inbox/history stops showing it
  -- as an active published/approved event card.
  if v_request_id is not null then
    delete from public.approval_requests r
    where r.request_id = v_request_id
      and r.kind in ('event_card', 'family_event', 'event_request');
  end if;

  return true;
end;
$$;

revoke all on function public.admin_family_event_delete_v1(text, bigint) from public;
grant execute on function public.admin_family_event_delete_v1(text, bigint) to anon, authenticated;

comment on function public.admin_family_event_delete_v1(text, bigint) is
  'Admin hard-delete family_events by id and unlink matching event approval_requests.';

-- Harden admin_delete_request_v1: unpublish family_events then delete request.
-- No silent exception swallow — real errors surface (Arabic-mapped in UI).
-- Extends admin_delete_request_v1 so deleting an event_card request
-- also removes the published family_events row (public ticker / المناسبات).
-- Resolves p_id as approval_requests.id (digits-only) OR request_id (EVN-*).
-- Never strip digits from EVN-* (e.g. EVN-A6HR-PLQ8 must not become id=68).
-- No silent exception swallow — real errors surface to the admin UI.

create or replace function public.admin_delete_request_v1(
  p_token text,
  p_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_raw text := nullif(btrim(coalesce(p_id, '')), '');
  v_id bigint := null;
  v_kind text := null;
  v_request_id text := null;
begin
  if not public.admin_token_ok_v1(p_token) then
    return false;
  end if;

  if v_raw is null then
    return false;
  end if;

  -- Pure digits = approval_requests.id.
  if v_raw ~ '^[0-9]+$' then
    v_id := v_raw::bigint;
    select r.kind, r.request_id
      into v_kind, v_request_id
    from public.approval_requests r
    where r.id = v_id
    limit 1;
  else
    -- EVN-* / OCC-* / any non-pure-numeric token → request_id lookup.
    select r.id, r.kind, r.request_id
      into v_id, v_kind, v_request_id
    from public.approval_requests r
    where r.request_id = v_raw
    limit 1;
  end if;

  if v_id is null then
    return false;
  end if;

  if v_kind in ('event_card', 'family_event', 'event_request')
     and nullif(btrim(coalesce(v_request_id, '')), '') is not null then
    delete from public.family_events e
    where coalesce(e.details, '') like '%' || v_request_id || '%';
  end if;

  delete from public.approval_requests where id = v_id;
  return found;
end;
$$;

revoke all on function public.admin_delete_request_v1(text, text) from public;
grant execute on function public.admin_delete_request_v1(text, text) to anon, authenticated;


-- =============================================================================
-- Delegate delete: family_events_delete_v1 also unlinks approval_requests
-- so «طلبات فرعي» لا تبقى بعد حذف المناسبة من لوحة المندوب.
-- Branch-scoped delete by id (was previously unscoped).
-- =============================================================================

create or replace function public.family_events_delete_v1(
  p_branch_key text,
  p_phone text,
  p_email text,
  p_secret_hash text,
  p_pk_col text,
  p_pk_value text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted boolean := false;
  v_details text := null;
  v_request_id text := null;
  v_branch text := regexp_replace(btrim(coalesce(p_branch_key, '')), '\\s+', ' ', 'g');
begin
  if not public.events_delegate_allowed_v1(p_branch_key, p_phone, p_email, p_secret_hash) then
    return false;
  end if;

  if nullif(btrim(coalesce(p_pk_col, '')), '') is null
     or nullif(btrim(coalesce(p_pk_value, '')), '') is null then
    return false;
  end if;

  if p_pk_col = 'id' then
    select e.details into v_details
    from public.family_events e
    where e.id = p_pk_value::bigint
      and regexp_replace(btrim(coalesce(e.branch_key, '')), '\\s+', ' ', 'g') = v_branch
    limit 1;
  else
    select e.details into v_details
    from public.family_events e
    where e.created_at = p_pk_value::timestamptz
      and regexp_replace(btrim(coalesce(e.branch_key, '')), '\\s+', ' ', 'g') = v_branch
    limit 1;
  end if;

  begin
    if nullif(btrim(coalesce(v_details, '')), '') is not null then
      v_request_id := nullif(btrim(coalesce(
        (v_details::jsonb)->>'requestId',
        (v_details::jsonb)->>'request_id',
        ((v_details::jsonb)->'event')->>'requestId',
        ((v_details::jsonb)->'event')->>'request_id',
        ''
      )), '');
    end if;
  exception
    when others then
      v_request_id := null;
  end;

  if v_request_id is null and nullif(btrim(coalesce(v_details, '')), '') is not null then
    v_request_id := nullif(
      btrim(
        coalesce(
          (regexp_match(v_details, '("requestId"|"request_id")\\s*:\\s*"([^"]+)"'))[2],
          (regexp_match(v_details, '(EVN-[A-Z0-9]+-[A-Z0-9]+)'))[1],
          ''
        )
      ),
      ''
    );
  end if;

  if p_pk_col = 'id' then
    delete from public.family_events e
    where e.id = p_pk_value::bigint
      and regexp_replace(btrim(coalesce(e.branch_key, '')), '\\s+', ' ', 'g') = v_branch;
    v_deleted := found;
  else
    delete from public.family_events e
    where e.created_at = p_pk_value::timestamptz
      and regexp_replace(btrim(coalesce(e.branch_key, '')), '\\s+', ' ', 'g') = v_branch;
    v_deleted := found;
  end if;

  if not v_deleted then
    return false;
  end if;

  if v_request_id is not null then
    delete from public.approval_requests r
    where r.request_id = v_request_id
      and r.kind in ('event_card', 'family_event', 'event_request')
      and regexp_replace(btrim(coalesce(r.branch_key, '')), '\\s+', ' ', 'g') = v_branch;
  end if;

  perform public.events_audit_log_v1(
    p_branch_key,
    p_phone,
    p_email,
    p_secret_hash,
    jsonb_build_object(
      'v', 1,
      'kind', 'events_audit',
      'op', 'delete',
      'branch_key', p_branch_key,
      'pk_col', p_pk_col,
      'pk_value', p_pk_value,
      'request_id', v_request_id,
      'at', now()::timestamptz
    )
  );

  return true;
end;
$$;

grant execute on function public.family_events_delete_v1(text, text, text, text, text, text) to anon, authenticated;

comment on function public.family_events_delete_v1(text, text, text, text, text, text) is
  'Delegate hard-delete family_events (branch-scoped) and unlink matching event approval_requests.';

select
  (select to_regprocedure('public.admin_family_event_delete_v1(text,bigint)') is not null)
    as has_family_event_delete,
  (select pg_get_functiondef('public.admin_family_event_delete_v1(text,bigint)'::regprocedure)
     like '%approval_requests%') as delete_unlinks_requests,
  (select to_regprocedure('public.family_events_delete_v1(text,text,text,text,text,text)') is not null)
    as has_delegate_family_event_delete,
  (select pg_get_functiondef('public.family_events_delete_v1(text,text,text,text,text,text)'::regprocedure)
     like '%approval_requests%') as delegate_delete_unlinks_requests,
  (select to_regprocedure('public.admin_delete_request_v1(text,text)') is not null)
    as has_delete_request;
`,
      order: 60.5,
      supabaseOnce: true,
    },
    {
      id: "maint.cleanup_orphan_approved_event_requests_v1",
      title: "تنظيف طلبات مناسبات يتيمة (مقبولة بلا نشر)",
      desc:
        "APPLY: يحذف approval_requests بحالة approved لنوع مناسبة ولم يعد لها صف في family_events (بقايا بعد حذف تجريبي من اللوحة). لا يمس pending/rejected ولا الشجرة.",
      file: "../supabase/sql/COPY-ME-cleanup-orphan-approved-event-requests.sql",
      sql: `-- APPLY: cleanup orphan approved event requests
-- Preset: maint.cleanup_orphan_approved_event_requests_v1

delete from public.approval_requests r
where r.kind in ('event_card', 'family_event', 'event_request')
  and lower(coalesce(r.status, '')) = 'approved'
  and nullif(btrim(coalesce(r.request_id, '')), '') is not null
  and not exists (
    select 1 from public.family_events e
    where coalesce(e.details, '') like '%' || r.request_id || '%'
  );

select
  (
    select count(*)::int
    from public.approval_requests r
    where r.kind in ('event_card', 'family_event', 'event_request')
      and lower(coalesce(r.status, '')) = 'approved'
      and nullif(btrim(coalesce(r.request_id, '')), '') is not null
      and not exists (
        select 1 from public.family_events e
        where coalesce(e.details, '') like '%' || r.request_id || '%'
      )
  ) as remaining_orphan_approved_event_requests;
`,
      order: 60.6,
      supabaseOnce: true,
    },
    {
      id: "maint.admin_reject_request_unpublish_event_v1",
      title: "رفض الطلب يلغي نشر المناسبة (family_events)",
      desc:
        "Trigger: عند status=rejected لـ event_card/family_event/event_request يُحذف صف family_events المطابق لـ request_id (يشمل محرك السير). لا يستبدل admin_set_request_status_v2. الصق مرة في Supabase SQL Editor.",
      file: "../supabase/sql/COPY-ME-admin-reject-request-unpublish-event.sql",
      sql: `-- COPY-ME: run in Supabase SQL Editor (once)
-- عند رفض طلب مناسبة (event_card / family_event / event_request):
-- يُحذف صف family_events المطابق لـ request_id من details (الشريط + المناسبات).
-- Trigger آمن — لا يستبدل admin_set_request_status_v2.
-- يعمل أيضاً عندما يضبط محرك السير status=rejected عبر admin_workflow_transition_v1.
-- الواجهة أيضاً تلغي النشر من JS (unpublishPublishedEventForRequest) + RPC
-- COPY-ME-admin-unpublish-events-for-request-v1.sql (هوية type+person+date كاحتياط).

create or replace function public.trg_approval_request_reject_unpublish_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.status = 'rejected'
     and NEW.kind in ('event_card', 'family_event', 'event_request')
     and nullif(btrim(coalesce(NEW.request_id, '')), '') is not null
     and (
       TG_OP = 'INSERT'
       or OLD.status is distinct from NEW.status
     ) then
    -- Exact same match as admin_delete_request_v1
    delete from public.family_events e
    where coalesce(e.details, '') like '%' || NEW.request_id || '%';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_approval_request_reject_unpublish_event
  on public.approval_requests;

create trigger trg_approval_request_reject_unpublish_event
  after insert or update of status on public.approval_requests
  for each row
  execute function public.trg_approval_request_reject_unpublish_event();
`,
      order: 61,
      supabaseOnce: true,
    },
    {
      id: "maint.admin_unpublish_events_for_request_v1",
      title: "RPC إلغاء نشر مناسبة لطلب (رفض/حذف)",
      desc:
        "admin_unpublish_events_for_request_v1: حذف family_events بـ request_id أو type+person+date من الواجهة/محرك السير بدون الاعتماد على SELECT فقط. الصق مرة في Supabase SQL Editor.",
      file: "../supabase/sql/COPY-ME-admin-unpublish-events-for-request-v1.sql",
      sql: `-- COPY-ME: run once in Supabase SQL Editor
-- RPC لإلغاء نشر family_events عند رفض/حذف طلب مناسبة.

-- Admin: unpublish family_events for an approval request (reject / delete helpers).
-- Security definer — does not rely on client SELECT + like quirks.
-- Match: request_id inside details, else type+person+date identity.
-- event_date cast to text (column may be date) — btrim(date) used to abort the RPC.

create or replace function public.admin_unpublish_events_for_request_v1(
  p_token text,
  p_request_id text default null,
  p_person text default null,
  p_type text default null,
  p_date text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rid text := nullif(btrim(coalesce(p_request_id, '')), '');
  v_person text := nullif(btrim(coalesce(p_person, '')), '');
  v_type text := nullif(btrim(coalesce(p_type, '')), '');
  v_date text := nullif(btrim(coalesce(p_date, '')), '');
  v_deleted int := 0;
begin
  if not public.admin_token_ok_v1(p_token) then
    return jsonb_build_object('ok', false, 'code', 'AUTH', 'deleted', 0);
  end if;

  -- Exact same match as admin_delete_request_v1 (delete path that already works).
  if v_rid is not null then
    delete from public.family_events e
    where coalesce(e.details, '') like '%' || v_rid || '%';
    get diagnostics v_deleted = row_count;
  end if;

  if v_deleted = 0 and v_person is not null and v_type is not null and v_date is not null then
    delete from public.family_events e
    where e.type = v_type
      and e.person = v_person
      and (
        coalesce(nullif(btrim(e.event_date::text), ''), '') = v_date
        or coalesce(nullif(btrim(coalesce(e.date_label, '')), ''), '') = v_date
      );
    get diagnostics v_deleted = row_count;
  end if;

  return jsonb_build_object('ok', true, 'deleted', coalesce(v_deleted, 0));
end;
$$;

revoke all on function public.admin_unpublish_events_for_request_v1(text, text, text, text, text) from public;
grant execute on function public.admin_unpublish_events_for_request_v1(text, text, text, text, text) to anon, authenticated;

comment on function public.admin_unpublish_events_for_request_v1(text, text, text, text, text) is
  'Reject/delete helper: remove published family_events by request_id in details or type+person+date.';
`,
      order: 61.5,
      supabaseOnce: true,
    },
    {
      id: "maint.cleanup_evn_lk9x_rqui_v1",
      title: "تنظيف طلب EVN-LK9X-RQUI (حسن خميس)",
      desc:
        "APPLY: يحذف طلب EVN-LK9X-RQUI من approval_requests وأي family_events مرتبط. بعد التشغيل: Hard Refresh لجدول الطلبات.",
      file: "../supabase/sql/COPY-ME-cleanup-evn-lk9x-rqui.sql",
      sql: `-- APPLY: remove stuck request EVN-LK9X-RQUI (حسن خميس / مزيد / بطاقة مناسبة)
-- Preset: maint.cleanup_evn_lk9x_rqui_v1
-- Safe scope: this request_id only (+ matching family_events details).

delete from public.family_events e
where coalesce(e.details, '') like '%EVN-LK9X-RQUI%';

delete from public.approval_requests r
where r.request_id = 'EVN-LK9X-RQUI'
  and r.kind in ('event_card', 'family_event', 'event_request');

select
  (select count(*)::int
     from public.approval_requests r
    where r.request_id = 'EVN-LK9X-RQUI') as remaining_requests,
  (select count(*)::int
     from public.family_events e
    where coalesce(e.details, '') like '%EVN-LK9X-RQUI%') as remaining_family_events;
`,
      order: 61.6,
      supabaseOnce: true,
    },
    {
      id: "maint.cleanup_stuck_gathering_hasan_dry_run_v1",
      title: "معاينة مناسبة حسن/اجتماع عالقة في family_events",
      desc: "قراءة فقط: orphan gathering لحسن (تاريخ/تجربه/EVN/هاتف). شغّله قبل APPLY أو احذف من «إدارة الأخبار والمناسبات».",
      file: "../supabase/sql/COPY-ME-cleanup-stuck-gathering-hasan-dry-run.sql",
      sql: `-- DRY-RUN only (SELECT). Find stuck «حسن / اجتماع عائلي» rows left in family_events
-- after deleting the approval request from الطلبات without unpublishing.
-- Prefer UI: Admin → إدارة الأخبار والمناسبات → تحميل → اختر حسن/اجتماع → حذف.
-- Then run APPLY only if the row remains (deletes newest match only).

select
  e.id,
  e.branch_key,
  e.type,
  e.person,
  e.date_label,
  e.event_date,
  e.contact_phone,
  e.created_at,
  left(coalesce(e.details, ''), 220) as details_preview
from public.family_events e
where e.type = 'gathering'
  and e.person ilike '%حسن%'
  and (
    coalesce(e.date_label, '') like '%١٤٤٨-٣-٣%'
    or coalesce(e.date_label, '') like '%1448-3-3%'
    or coalesce(e.details, '') ilike '%تجربه%'
    or coalesce(e.details, '') ilike '%تجربة%'
    or coalesce(e.details, '') ilike '%EVN-%'
    or coalesce(e.contact_phone, '') like '%551840058%'
  )
order by e.created_at desc
limit 20;
`,
      order: 62,
    },
    {
      id: "maint.cleanup_stuck_gathering_hasan_apply_v1",
      title: "حذف مناسبة حسن/اجتماع العالقة (APPLY)",
      desc: "DELETE صف واحد فقط (أحدث مطابقة). يفضّل الحذف من لوحة المناسبات (admin_family_event_delete_v1). لا يمس الشجرة ولا الطلبات.",
      file: "../supabase/sql/COPY-ME-cleanup-stuck-gathering-hasan-apply.sql",
      sql: `-- APPLY: hard-delete ONE stuck gathering row for حسن (اجتماع عائلي) — newest match only.
-- 1) Run COPY-ME-cleanup-stuck-gathering-hasan-dry-run.sql and confirm the top id
--    (live orphan seen: id=42, date_label=١٤٤٨-٣-٣, details text=تجربه, requestId EVN-HTWF-NWTM).
-- 2) Prefer UI if the row still appears: Admin → إدارة الأخبار والمناسبات → حذف
--    (uses admin_family_event_delete_v1). No need to touch الطلبات (already gone).
-- 3) This DELETE targets a single id via subquery LIMIT 1 — not a mass delete.
-- 4) Does not touch tree_children / add-person / approval_requests.

delete from public.family_events e
where e.id = (
  select x.id
  from public.family_events x
  where x.type = 'gathering'
    and x.person ilike '%حسن%'
    and (
      coalesce(x.date_label, '') like '%١٤٤٨-٣-٣%'
      or coalesce(x.date_label, '') like '%1448-3-3%'
      or coalesce(x.details, '') ilike '%تجربه%'
      or coalesce(x.details, '') ilike '%تجربة%'
      or coalesce(x.details, '') ilike '%EVN-%'
      or coalesce(x.contact_phone, '') like '%551840058%'
    )
  order by x.created_at desc
  limit 1
)
returning e.id, e.type, e.person, e.date_label, e.event_date, e.created_at;
`,
      order: 63,
    },
    {
      id: "maint.push_tokens_phone_v1",
      title: "ربط جوال المندوب بإشعارات التطبيق (push_tokens.phone)",
      desc:
        "آمن/إضافي: عمود push_tokens.phone + تطبيع الجوال + register_push_token_v1 مع p_phone اختياري لاستهداف إشعارات المندوب. بث العائلة العام دون تغيير. SQL مضمّن — لا يعتمد على fetch لملف gitignored.",
      // Inline SQL (*.sql is gitignored — fetch from localhost may 404 on some trees).
      file: "../supabase/sql/COPY-ME-push-tokens-phone.sql",
      sql: `-- COPY-ME: push_tokens.phone + register_push_token_v1(p_phone)
-- Run in Supabase SQL editor (wbskjfdqpugnwvrykqcn).
-- Safe/additive: adds optional phone for branch-delegate targeted Expo push.
-- Public family broadcast push path is unchanged (still all enabled tokens).

alter table public.push_tokens
  add column if not exists phone text;

comment on column public.push_tokens.phone is
  'Optional Saudi mobile (05XXXXXXXX) bound for branch-delegate targeted push.';

create index if not exists push_tokens_phone_enabled_idx
  on public.push_tokens (phone)
  where enabled = true and phone is not null and btrim(phone) <> '';

-- Normalize Arabic/Persian/fullwidth digits then keep digits only.
create or replace function public.push_tokens_norm_phone(p text)
returns text
language plpgsql
immutable
as $$
declare
  s text := coalesce(p, '');
  i int;
  ch text;
  code int;
  out text := '';
begin
  for i in 1..char_length(s) loop
    ch := substr(s, i, 1);
    code := ascii(ch);
    if code >= 1632 and code <= 1641 then -- Arabic-Indic ٠-٩
      out := out || chr(code - 1632 + 48);
    elsif code >= 1776 and code <= 1785 then -- Eastern Arabic-Indic ۰-۹
      out := out || chr(code - 1776 + 48);
    elsif code >= 65296 and code <= 65305 then -- Fullwidth ０-９
      out := out || chr(code - 65296 + 48);
    else
      out := out || ch;
    end if;
  end loop;
  out := regexp_replace(out, '\\D', '', 'g');
  if out like '00966%' and char_length(out) = 14 and substr(out, 6, 1) = '5' then
    return '0' || substr(out, 6);
  end if;
  if out like '966%' and char_length(out) = 12 and substr(out, 4, 1) = '5' then
    return '0' || substr(out, 4);
  end if;
  if char_length(out) = 9 and substr(out, 1, 1) = '5' then
    return '0' || out;
  end if;
  return out;
end;
$$;

-- Replace 4-arg overload so optional p_phone works without ambiguity.
drop function if exists public.register_push_token_v1(text, text, text, text);
drop function if exists public.register_push_token_v1(text, text, text, text, text);

create or replace function public.register_push_token_v1(
  p_token text,
  p_platform text,
  p_device_name text default null,
  p_app_version text default null,
  p_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text := btrim(coalesce(p_token, ''));
  v_phone text := nullif(public.push_tokens_norm_phone(p_phone), '');
begin
  if v_token = '' then
    return jsonb_build_object('ok', false, 'error', 'missing_token');
  end if;

  insert into public.push_tokens as t (
    token, platform, device_name, app_version, phone, enabled, updated_at
  )
  values (
    v_token,
    nullif(btrim(coalesce(p_platform, '')), ''),
    p_device_name,
    p_app_version,
    v_phone,
    true,
    now()
  )
  on conflict (token) do update set
    platform = excluded.platform,
    device_name = excluded.device_name,
    app_version = excluded.app_version,
    -- Keep prior binding if this registration omits phone.
    phone = coalesce(excluded.phone, t.phone),
    enabled = true,
    updated_at = now();

  return jsonb_build_object('ok', true, 'phone', v_phone);
end;
$$;

revoke all on function public.register_push_token_v1(text, text, text, text, text) from public;
grant execute on function public.register_push_token_v1(text, text, text, text, text) to anon, authenticated;
grant execute on function public.push_tokens_norm_phone(text) to anon, authenticated;
`,
      order: 12,
      supabaseOnce: true,
    },
    {
      id: "maint.public_app_login_by_phone_v1",
      title: "دخول التطبيق بالجوال للعضو أو المندوب (ربط الإشعار)",
      desc:
        "آمن/إضافي: RPC public_app_login_by_phone_v1 يقبل رقم عضو أو مندوب مفعّل لربط الجهاز بإشعارات طلبات الفرع بعد التسجيل.",
      file: "../supabase/sql/COPY-ME-public-app-login-by-phone.sql",
      sql: `-- COPY-ME: public_app_login_by_phone_v1
create or replace function public.public_app_login_by_phone_v1(p_phone text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_phone text := nullif(public.push_tokens_norm_phone(p_phone), '');
  v_member public.member_profiles%rowtype;
  v_delegate public.delegates_v2%rowtype;
  v_has_member boolean := false;
  v_has_delegate boolean := false;
  v_role text := 'none';
begin
  if v_phone is null or char_length(v_phone) < 9 then
    return jsonb_build_object('ok', false, 'error', 'bad_phone');
  end if;

  if to_regclass('public.member_profiles') is not null then
    select m.*
      into v_member
    from public.member_profiles m
    where public.push_tokens_norm_phone(m.phone) = v_phone
    order by m.id desc
    limit 1;
    v_has_member := found;
  end if;

  if to_regclass('public.delegates_v2') is not null then
    select d.*
      into v_delegate
    from public.delegates_v2 d
    where coalesce(d.is_enabled, true) = true
      and public.push_tokens_norm_phone(d.phone) = v_phone
    order by d.updated_at desc nulls last, d.created_at desc nulls last
    limit 1;
    v_has_delegate := found;
  end if;

  if not v_has_member and not v_has_delegate then
    return jsonb_build_object('ok', false, 'error', 'not_found', 'phone', v_phone);
  end if;

  if v_has_member and v_has_delegate then
    v_role := 'both';
  elsif v_has_delegate then
    v_role := 'delegate';
  else
    v_role := 'member';
  end if;

  return jsonb_build_object(
    'ok', true,
    'role', v_role,
    'phone', v_phone,
    'member_id', case when v_has_member then v_member.id else null end,
    'tree_child_id', case when v_has_member then v_member.tree_child_id else null end,
    'person_id', case when v_has_member then v_member.person_id else null end,
    'branch_key', coalesce(
      nullif(btrim(coalesce(case when v_has_member then v_member.branch_key else null end, '')), ''),
      nullif(btrim(coalesce(case when v_has_delegate then v_delegate.branch_key else null end, '')), '')
    ),
    'display_name', coalesce(
      nullif(btrim(coalesce(case when v_has_member then v_member.display_name else null end, '')), ''),
      nullif(btrim(coalesce(case when v_has_delegate then v_delegate.name else null end, '')), ''),
      'مندوب الفرع'
    ),
    'delegate_id', case when v_has_delegate then v_delegate.id else null end,
    'delegate_role_key', case when v_has_delegate then v_delegate.role_key else null end,
    'is_delegate', v_has_delegate,
    'is_member', v_has_member
  );
end;
$$;

revoke all on function public.public_app_login_by_phone_v1(text) from public;
grant execute on function public.public_app_login_by_phone_v1(text) to anon, authenticated;
`,
      order: 12.5,
      supabaseOnce: true,
    },
    {
      id: "maint.push_send_dedupe_v1",
      title: "منع تكرار إشعار نفس الطلب لنفس الجهاز (push_send_dedupe)",
      desc:
        "آمن/إضافي: جدول push_send_dedupe لمنع إرسال Expo مكرر لنفس event_key+token. الدالة تستخدم ذاكرة مؤقتة حتى بدون الجدول.",
      file: "../supabase/sql/COPY-ME-push-send-dedupe.sql",
      sql: `-- COPY-ME: push_send_dedupe (event_key + token)
-- Run in Supabase SQL editor (wbskjfdqpugnwvrykqcn).
-- Safe/additive. Edge function also keeps an in-memory fallback.

create table if not exists public.push_send_dedupe (
  event_key text not null,
  token text not null,
  created_at timestamptz not null default now(),
  primary key (event_key, token)
);

comment on table public.push_send_dedupe is
  'Prevents duplicate Expo push for the same event_key + device token.';

create index if not exists push_send_dedupe_created_at_idx
  on public.push_send_dedupe (created_at);

alter table public.push_send_dedupe enable row level security;

revoke all on table public.push_send_dedupe from anon, authenticated;
`,
      order: 13,
      supabaseOnce: true,
    },
    {
      id: "maint.occasion_sender_name_father_v1",
      title: "تفاعل المناسبات: اسم المهنّئ + اسم الأب",
      desc:
        "يعرض في صندوق «وصلك من العائلة» اسم المرسل مع اسم أبيه من الشجرة (حسن خميس وليس حسن فقط) لتفادي التشابه. يحدّث دوال الإرسال والصندوق ويعبّئ الأسماء الحالية.",
      file: "../supabase/sql/COPY-ME-occasion-sender-name-father-v1.sql",
      sql: `-- Patch: sender display = اسم + أب (not first name only)
-- Run in Supabase SQL editor once.

create or replace function public.short_name_with_father_v1(p_full text)
returns text
language plpgsql
immutable
set search_path = public
as $fn$
declare
  v text := nullif(btrim(regexp_replace(coalesce(p_full, ''), '\\s+', ' ', 'g')), '');
  segs text[];
  leaf text;
  parent text;
  toks text[] := array[]::text[];
  w text;
  leaf_toks text[];
  parent_toks text[];
begin
  if v is null then
    return null;
  end if;

  if position('/' in v) > 0 then
    segs := array_remove(string_to_array(v, '/'), '');
    if coalesce(cardinality(segs), 0) >= 2 then
      leaf := nullif(btrim(segs[cardinality(segs)]), '');
      parent := nullif(btrim(segs[cardinality(segs) - 1]), '');
      leaf_toks := array[]::text[];
      parent_toks := array[]::text[];
      foreach w in array regexp_split_to_array(coalesce(leaf, ''), '\\s+') loop
        if w <> '' and w not in ('بن', 'ابن', 'بنت') then
          leaf_toks := array_append(leaf_toks, w);
        end if;
      end loop;
      foreach w in array regexp_split_to_array(coalesce(parent, ''), '\\s+') loop
        if w <> '' and w not in ('بن', 'ابن', 'بنت') then
          parent_toks := array_append(parent_toks, w);
        end if;
      end loop;
      if coalesce(cardinality(leaf_toks), 0) >= 1 and coalesce(cardinality(parent_toks), 0) >= 1 then
        return leaf_toks[1] || ' ' || parent_toks[1];
      end if;
    elsif coalesce(cardinality(segs), 0) = 1 then
      v := nullif(btrim(segs[1]), '');
    end if;
  end if;

  foreach w in array regexp_split_to_array(coalesce(v, ''), '\\s+') loop
    if w <> '' and w not in ('بن', 'ابن', 'بنت') then
      toks := array_append(toks, w);
    end if;
  end loop;

  if coalesce(cardinality(toks), 0) >= 2 then
    return toks[1] || ' ' || toks[2];
  end if;
  if coalesce(cardinality(toks), 0) = 1 then
    return toks[1];
  end if;
  return null;
end;
$fn$;

create or replace function public.member_name_with_father_from_phone_v1(p_phone text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_mp public.member_profiles%rowtype;
  v_child text;
  v_parent text;
  v_out text;
  v_child_first text;
  v_parent_first text;
begin
  if v_phone is null then
    return null;
  end if;

  select * into v_mp
  from public.member_profiles mp
  where mp.status = 'active'
    and public.phones_match_v1(mp.phone, v_phone)
  order by mp.updated_at desc nulls last
  limit 1;

  if not found then
    return null;
  end if;

  -- 1) من بطاقة الشجرة: اسم الابن + اسم الأب
  if v_mp.tree_child_id is not null then
    select nullif(btrim(coalesce(c.child_name, c.name, '')), ''),
           nullif(btrim(coalesce(c.parent_name, c.parent, '')), '')
      into v_child, v_parent
    from public.tree_children c
    where c.id = v_mp.tree_child_id
    limit 1;

    if v_child is not null and position('/' in v_child) > 0 then
      v_out := public.short_name_with_father_v1(v_child);
      if v_out is not null and position(' ' in v_out) > 0 then
        return v_out;
      end if;
    end if;

    v_child_first := public.short_name_with_father_v1(v_child);
    -- short on single name returns one token
    if v_child_first is not null and position(' ' in v_child_first) > 0 then
      return v_child_first;
    end if;
    v_parent_first := public.short_name_with_father_v1(v_parent);
    if v_child_first is not null and v_parent_first is not null then
      -- take first token of each
      return split_part(v_child_first, ' ', 1) || ' ' || split_part(v_parent_first, ' ', 1);
    end if;
  end if;

  -- 2) من الاسم المعروض: حسن بن خميس بن دليميك → حسن خميس
  v_out := public.short_name_with_father_v1(v_mp.display_name);
  if v_out is not null then
    return v_out;
  end if;

  return nullif(btrim(coalesce(v_mp.display_name, '')), '');
end;
$fn$;

revoke all on function public.short_name_with_father_v1(text) from public;
grant execute on function public.short_name_with_father_v1(text) to anon, authenticated, service_role;
revoke all on function public.member_name_with_father_from_phone_v1(text) from public;
grant execute on function public.member_name_with_father_from_phone_v1(text) to anon, authenticated, service_role;

-- Submit: always prefer اسم+أب from tree/profile
create or replace function public.occasion_interaction_submit_v1(
  p_occasion_id bigint,
  p_interaction_type_key text,
  p_sender_phone text,
  p_sender_name text default null,
  p_message text default null,
  p_recipient_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_phone text := nullif(btrim(coalesce(p_sender_phone, '')), '');
  v_key text := nullif(btrim(coalesce(p_interaction_type_key, '')), '');
  v_type public.occasion_interaction_types%rowtype;
  v_event public.family_events%rowtype;
  v_recipient_id bigint;
  v_member_id bigint;
  v_sender_name text := nullif(btrim(coalesce(p_sender_name, '')), '');
  v_resolved text;
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
  v_id bigint;
begin
  if p_occasion_id is null or v_phone is null or v_key is null then
    return jsonb_build_object('ok', false, 'error', 'missing_fields');
  end if;

  select * into v_event from public.family_events where id = p_occasion_id limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'occasion_not_found');
  end if;

  select * into v_type from public.occasion_interaction_types
  where key = v_key and is_active limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_interaction_type');
  end if;

  if cardinality(v_type.applies_to_types) > 0
     and not (lower(coalesce(v_event.type, '')) = any (v_type.applies_to_types)) then
    return jsonb_build_object('ok', false, 'error', 'type_mismatch');
  end if;

  perform public.occasion_ensure_default_recipients_v1(p_occasion_id);

  v_recipient_id := p_recipient_id;
  if v_recipient_id is null then
    if v_type.track = 'deceased' then
      select r.id into v_recipient_id
      from public.occasion_recipients r
      where r.occasion_id = p_occasion_id and r.recipient_role = 'deceased' and r.is_active
      order by r.id limit 1;
    else
      select r.id into v_recipient_id
      from public.occasion_recipients r
      where r.occasion_id = p_occasion_id
        and r.is_active
        and r.recipient_role is distinct from 'deceased'
      order by r.id
      limit 1;
    end if;
  end if;

  select mp.id into v_member_id
  from public.member_profiles mp
  where mp.status = 'active'
    and public.phones_match_v1(mp.phone, v_phone)
  order by mp.updated_at desc nulls last
  limit 1;

  v_resolved := public.member_name_with_father_from_phone_v1(v_phone);
  if v_resolved is not null and position(' ' in v_resolved) > 0 then
    v_sender_name := v_resolved;
  elsif v_sender_name is null or position(' ' in v_sender_name) = 0 then
    v_sender_name := coalesce(v_resolved, v_sender_name);
  end if;

  if v_type.allows_message is not true then
    v_message := null;
  elsif v_message is not null and char_length(v_message) > 500 then
    v_message := left(v_message, 500);
  end if;

  insert into public.occasion_interactions as oi (
    occasion_id, interaction_type_key, sender_phone, sender_name,
    sender_member_id, recipient_id, message, created_at, updated_at
  ) values (
    p_occasion_id, v_key, v_phone, v_sender_name,
    v_member_id, v_recipient_id, v_message, now(), now()
  )
  on conflict (occasion_id, sender_phone)
  do update set
    interaction_type_key = excluded.interaction_type_key,
    sender_name = coalesce(excluded.sender_name, oi.sender_name),
    sender_member_id = coalesce(excluded.sender_member_id, oi.sender_member_id),
    recipient_id = coalesce(excluded.recipient_id, oi.recipient_id),
    message = excluded.message,
    updated_at = now()
  returning id into v_id;

  return jsonb_build_object(
    'ok', true,
    'id', v_id,
    'recipient_id', v_recipient_id,
    'sender_name', v_sender_name
  );
end;
$fn$;

revoke all on function public.occasion_interaction_submit_v1(bigint, text, text, text, text, bigint) from public;
grant execute on function public.occasion_interaction_submit_v1(bigint, text, text, text, text, bigint) to anon, authenticated, service_role;

-- Inbox: always show اسم+أب for sender (resolve from phone if stored name is short)
create or replace function public.occasion_inbox_for_phone_v1(p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_member_person uuid;
begin
  if v_phone is null then
    return jsonb_build_object('ok', false, 'error', 'missing_phone', 'items', '[]'::jsonb);
  end if;

  select mp.person_id into v_member_person
  from public.member_profiles mp
  where mp.status = 'active' and public.phones_match_v1(mp.phone, v_phone)
  order by mp.updated_at desc nulls last
  limit 1;

  return jsonb_build_object(
    'ok', true,
    'items', coalesce((
      select jsonb_agg(x order by (x->>'latest_at') desc)
      from (
        select jsonb_build_object(
          'occasion_id', e.id,
          'occasion_type', e.type,
          'occasion_person', e.person,
          'branch_key', e.branch_key,
          'recipient_id', r.id,
          'recipient_role', r.recipient_role,
          'recipient_name', r.recipient_name,
          'total', count(i.*)::int,
          'by_type', coalesce((
            select jsonb_object_agg(sub.interaction_type_key, sub.cnt)
            from (
              select i2.interaction_type_key, count(*)::int as cnt
              from public.occasion_interactions i2
              where i2.recipient_id = r.id
              group by i2.interaction_type_key
            ) sub
          ), '{}'::jsonb),
          'latest_at', max(i.updated_at),
          'messages', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', m.id,
              'sender_name', coalesce(
                nullif(public.member_name_with_father_from_phone_v1(m.sender_phone), ''),
                nullif(public.short_name_with_father_v1(m.sender_name), ''),
                nullif(m.sender_name, ''),
                'فرد من العائلة'
              ),
              'interaction_type_key', m.interaction_type_key,
              'label', t.label,
              'full_text', t.full_text,
              'message', m.message,
              'created_at', m.created_at
            ) order by m.created_at desc)
            from public.occasion_interactions m
            left join public.occasion_interaction_types t on t.key = m.interaction_type_key
            where m.recipient_id = r.id
            limit 50
          ), '[]'::jsonb)
        ) as x
        from public.occasion_recipients r
        join public.family_events e on e.id = r.occasion_id
        join public.occasion_interactions i on i.recipient_id = r.id
        where r.is_active
          and r.recipient_role is distinct from 'deceased'
          and (
            (r.recipient_phone is not null and public.phones_match_v1(r.recipient_phone, v_phone))
            or (v_member_person is not null and r.recipient_person_id = v_member_person)
          )
        group by e.id, r.id
      ) q
    ), '[]'::jsonb)
  );
end;
$fn$;

revoke all on function public.occasion_inbox_for_phone_v1(text) from public;
grant execute on function public.occasion_inbox_for_phone_v1(text) to anon, authenticated, service_role;

-- Backfill stored names
update public.occasion_interactions i
set sender_name = coalesce(
  public.member_name_with_father_from_phone_v1(i.sender_phone),
  public.short_name_with_father_v1(i.sender_name),
  i.sender_name
),
updated_at = now()
where i.sender_phone is not null;
`,
      order: 55.5,
    },
    {
      id: "maint.occasion_recipient_phone_link_v1",
      title: "تفاعل المناسبات: ربط جوال المستلم لكل المناسبات",
      desc:
        "يجعل التهاني والتعازي والدعاء تصل لصندوق المستلم مثل ترقية مزيد: يربط recipient_phone / person_id من بطاقة المناسبة ويعبّئ المستلمين لكل المناسبات الحالية.",
      file: "../supabase/sql/COPY-ME-occasion-recipient-phone-link-v1.sql",
      sql: `-- Occasion interactions: link recipient phone from family_events for ALL types
-- (same delivery path as Mazeed promotion — inbox matches phone or person_id)

create or replace function public.occasion_ensure_default_recipients_v1(p_occasion_id bigint)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row public.family_events%rowtype;
  v_person text;
  v_person_id uuid;
  v_phone text;
  v_details jsonb;
  v_type text;
  v_inserted int := 0;
  v_role text;
  v_phones text[];
begin
  if p_occasion_id is null then
    return 0;
  end if;
  select * into v_row from public.family_events where id = p_occasion_id limit 1;
  if not found then
    return 0;
  end if;

  v_person := nullif(btrim(coalesce(v_row.person, '')), '');
  v_type := lower(nullif(btrim(coalesce(v_row.type, '')), ''));
  v_phone := nullif(btrim(coalesce(v_row.contact_phone, '')), '');

  begin
    v_details := case
      when v_row.details is null or btrim(v_row.details) = '' then '{}'::jsonb
      when left(btrim(v_row.details), 1) = '{' then v_row.details::jsonb
      else '{}'::jsonb
    end;
  exception when others then
    v_details := '{}'::jsonb;
  end;

  begin
    v_person_id := nullif(coalesce(v_details->>'person_id', v_details->>'personId'), '')::uuid;
  exception when others then
    v_person_id := null;
  end;

  if v_phone is null then
    v_phone := nullif(btrim(coalesce(
      v_details->>'contact_phone',
      v_details->>'phone',
      v_details->>'submitter_phone',
      ''
    )), '');
  end if;

  -- Death details often store phones array
  if v_phone is null then
    begin
      select array_agg(nullif(btrim(x), '') ) filter (where nullif(btrim(x), '') is not null)
        into v_phones
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(v_details->'phones') = 'array' then v_details->'phones'
          else '[]'::jsonb
        end
      ) as t(x);
      if v_phones is not null and cardinality(v_phones) > 0 then
        v_phone := v_phones[1];
      end if;
    exception when others then
      null;
    end;
  end if;

  -- Resolve person_id from member_profiles by phone when missing
  if v_person_id is null and v_phone is not null then
    begin
      select mp.person_id into v_person_id
      from public.member_profiles mp
      where mp.person_id is not null
        and public.phones_match_v1(mp.phone, v_phone)
      order by mp.id desc
      limit 1;
    exception when others then
      v_person_id := null;
    end;
  end if;

  if v_type in ('death', 'condolence') then
    v_role := 'bereaved';
  elsif v_type in ('sick', 'operation', 'healing', 'discharge', 'safety') then
    v_role := 'patient';
  elsif v_type in (
    'wedding', 'contract', 'dinner', 'lunch', 'feast', 'gathering',
    'family_meetup', 'general', 'aqiqa', 'graduation', 'promotion', 'retirement'
  ) then
    v_role := 'host';
  else
    v_role := 'honoree';
  end if;

  if v_person is null then
    return 0;
  end if;

  if not exists (
    select 1 from public.occasion_recipients r
    where r.occasion_id = p_occasion_id
      and r.is_active
      and lower(r.recipient_name) = lower(v_person)
      and r.recipient_role is distinct from 'deceased'
  ) then
    insert into public.occasion_recipients (
      occasion_id, recipient_role, recipient_name, recipient_phone, recipient_person_id
    ) values (
      p_occasion_id, v_role, v_person, v_phone, v_person_id
    );
    v_inserted := 1;
  else
    update public.occasion_recipients r
    set
      recipient_phone = coalesce(r.recipient_phone, v_phone),
      recipient_person_id = coalesce(r.recipient_person_id, v_person_id)
    where r.occasion_id = p_occasion_id
      and r.is_active
      and lower(r.recipient_name) = lower(v_person)
      and r.recipient_role is distinct from 'deceased';
  end if;

  if v_type in ('death', 'condolence') then
    if not exists (
      select 1 from public.occasion_recipients r
      where r.occasion_id = p_occasion_id
        and r.recipient_role = 'deceased'
        and r.is_active
    ) then
      insert into public.occasion_recipients (
        occasion_id, recipient_role, recipient_name, recipient_person_id
      ) values (
        p_occasion_id, 'deceased', v_person, v_person_id
      );
      v_inserted := v_inserted + 1;
    end if;
  end if;

  return v_inserted;
end;
$fn$;

revoke all on function public.occasion_ensure_default_recipients_v1(bigint) from public;
grant execute on function public.occasion_ensure_default_recipients_v1(bigint) to anon, authenticated, service_role;

-- Backfill recipients for all published occasions (phone + person_id when available)
do $fn$
declare
  r record;
begin
  for r in
    select e.id
    from public.family_events e
    order by e.id
  loop
    perform public.occasion_ensure_default_recipients_v1(r.id);
  end loop;
end;
$fn$;

-- Extra: fill phone from contact_phone when still empty (non-deceased)
update public.occasion_recipients r
set recipient_phone = nullif(btrim(e.contact_phone), '')
from public.family_events e
where e.id = r.occasion_id
  and r.is_active
  and r.recipient_role is distinct from 'deceased'
  and r.recipient_phone is null
  and nullif(btrim(coalesce(e.contact_phone, '')), '') is not null;
`,
      order: 55.6,
    },
  ];

  function loadDone() {
    try {
      const raw = localStorage.getItem(DONE_KEY);
      const obj = raw ? JSON.parse(raw) : {};
      return obj && typeof obj === "object" ? obj : {};
    } catch (_) {
      return {};
    }
  }

  function saveDone(map) {
    try {
      localStorage.setItem(DONE_KEY, JSON.stringify(map || {}));
    } catch (_) {}
  }

  function loadFail() {
    try {
      const raw = localStorage.getItem(FAIL_KEY);
      const obj = raw ? JSON.parse(raw) : {};
      return obj && typeof obj === "object" ? obj : {};
    } catch (_) {
      return {};
    }
  }

  function saveFail(map) {
    try {
      localStorage.setItem(FAIL_KEY, JSON.stringify(map || {}));
    } catch (_) {}
  }

  /**
   * Single source of truth for a maintenance command:
   * archived (done) > failed > pending. Attempt history must not override.
   */
  function commandState(id) {
    if (isDone(id)) return "archived";
    if (getFail(id)) return "failed";
    return "pending";
  }

  function markDone(id, meta) {
    const map = loadDone();
    map[id] = Object.assign(
      { at: new Date().toISOString(), ok: true, archived: true },
      meta || {},
    );
    saveDone(map);
    // Success supersedes every prior fail flag for this command.
    const fails = loadFail();
    if (fails[id]) {
      delete fails[id];
      saveFail(fails);
    }
  }

  function markFail(id, meta) {
    // Never paint "failed" over an archived success.
    if (isDone(id)) return;
    const map = loadFail();
    map[id] = Object.assign(
      { at: new Date().toISOString(), ok: false },
      meta || {},
    );
    saveFail(map);
  }

  function clearDone(id) {
    const map = loadDone();
    delete map[id];
    saveDone(map);
  }

  function clearFail(id) {
    const map = loadFail();
    delete map[id];
    saveFail(map);
  }

  function isDone(id) {
    const row = loadDone()[id];
    return !!(row && row.ok);
  }

  function getFail(id) {
    if (isDone(id)) return null;
    return loadFail()[id] || null;
  }

  function listActivePresets() {
    return (PRESETS || [])
      .slice()
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .filter((p) => !isDone(p.id));
  }

  function listArchivedPresets() {
    const done = loadDone();
    return (PRESETS || [])
      .slice()
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .filter((p) => !!(done[p.id] && done[p.id].ok))
      .map((p) => ({
        preset: p,
        meta: done[p.id],
      }));
  }

  /**
   * Split SQL script into statements; respect $tag$ … $tag$ and quotes.
   */
  function splitSqlStatements(sql) {
    const src = String(sql || "");
    const out = [];
    let buf = "";
    let i = 0;
    const n = src.length;

    while (i < n) {
      const ch = src[i];

      if (ch === "-" && src[i + 1] === "-") {
        buf += ch;
        i++;
        while (i < n && src[i] !== "\n") {
          buf += src[i];
          i++;
        }
        continue;
      }

      if (ch === "/" && src[i + 1] === "*") {
        buf += "/*";
        i += 2;
        while (i < n - 1) {
          if (src[i] === "*" && src[i + 1] === "/") {
            buf += "*/";
            i += 2;
            break;
          }
          buf += src[i];
          i++;
        }
        continue;
      }

      if (ch === "$") {
        let j = i + 1;
        while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
        if (j < n && src[j] === "$") {
          const tag = src.slice(i, j + 1);
          buf += tag;
          i = j + 1;
          while (i <= n - tag.length) {
            if (src.slice(i, i + tag.length) === tag) {
              buf += tag;
              i += tag.length;
              break;
            }
            buf += src[i];
            i++;
          }
          continue;
        }
      }

      if (ch === "'") {
        buf += ch;
        i++;
        while (i < n) {
          buf += src[i];
          if (src[i] === "'") {
            if (src[i + 1] === "'") {
              buf += src[i + 1];
              i += 2;
              continue;
            }
            i++;
            break;
          }
          i++;
        }
        continue;
      }

      if (ch === ";") {
        const stmt = buf.trim();
        if (stmt) {
          const stripped = stmt
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/--[^\n]*/g, "")
            .trim();
          if (stripped) out.push(stmt);
        }
        buf = "";
        i++;
        continue;
      }

      buf += ch;
      i++;
    }

    const tail = buf.trim();
    if (tail) {
      const stripped = tail
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/--[^\n]*/g, "")
        .trim();
      if (stripped) out.push(tail);
    }
    return out;
  }

  /**
   * Resolve SQL for a preset. Prefers inline `sql` (reliable), else fetch `file`.
   * @param {string|{file?:string,sql?:string}} presetOrFile
   */
  async function fetchPresetSql(presetOrFile) {
    if (presetOrFile && typeof presetOrFile === "object") {
      const inline = String(presetOrFile.sql || "").trim();
      if (inline) return String(presetOrFile.sql);
      if (presetOrFile.file) return fetchPresetSql(presetOrFile.file);
      throw new Error("لا يوجد SQL مضمّن ولا مسار ملف لهذا الأمر الجاهز.");
    }
    const file = String(presetOrFile || "");
    if (!file) throw new Error("مسار ملف SQL فارغ.");
    const url = new URL(file, window.location.href).toString();
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(
        "تعذّر تحميل ملف SQL (" + res.status + "). تأكد أن مجلد supabase منشور مع الموقع.",
      );
    }
    return await res.text();
  }

  window.AlzidanSqlPresets = {
    PRESETS,
    splitSqlStatements,
    fetchPresetSql,
    loadDone,
    loadFail,
    markDone,
    markFail,
    clearDone,
    clearFail,
    isDone,
    getFail,
    commandState,
    listActivePresets,
    listArchivedPresets,
    DONE_KEY,
    FAIL_KEY,
  };
})();
