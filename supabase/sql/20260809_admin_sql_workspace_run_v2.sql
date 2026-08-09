-- SQL Workspace executor v2 — CREATE OR REPLACE / GRANT only.
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
  -- (Naive '/\*.*?\*/' with flag n can statement-timeout on SQL that contains '/' paths.)
  v_work := v_raw;
  loop
    v_work := btrim(v_work);
    if v_work = '' then
      exit;
    end if;
    if substr(v_work, 1, 2) = '--' then
      v_work := regexp_replace(v_work, '^--[^\n]*\n?', '');
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
  v_first := upper(substring(v_work from '^\s*([A-Za-z]+)'));

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
      while i <= n and substr(v, i, 1) <> E'\n' loop
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
      while i <= n and substr(v, i, 1) <> E'\n' loop
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
          regexp_replace(buf, '/\*.*?\*/', '', 'ng'),
          '--[^\n]*',
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
      regexp_replace(buf, '/\*.*?\*/', '', 'ng'),
      '--[^\n]*',
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
  v_probe := regexp_replace(v_probe, ';\s*$', '');
  if position(';' in v_probe) > 0 then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'SQL-WS-MULTI',
      'message_ar', 'يُسمح بأمر واحد فقط في كل تنفيذ. للصيانة متعددة الأوامر: استخدم المنفّذ v2 أو «أوامر الصيانة الجاهزة».'
    );
  end if;
  v_sql := regexp_replace(v_sql, ';\s*$', '');

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
    v_stmt := regexp_replace(btrim(v_stmts[i]), ';\s*$', '');
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
