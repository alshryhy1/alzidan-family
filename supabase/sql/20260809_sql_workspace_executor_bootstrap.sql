-- Operator path: Admin SQL Workspace maintenance presets
-- Preset: maint.sql_workspace_executor_bootstrap_v1
--
-- Prior 1/9 failure root cause:
--   Statement 1 was top-level EXECUTE replace(...) which SQL treats as a
--   prepared-statement name (error: prepared statement replace does not exist).
--   A corrupted header fragment made it worse.
--
-- Fix for OLD naive MULTI checker (rejects any raw semicolon char anywhere,
--   even inside dollar bodies): CREATE sql stub then UPDATE pg_proc.prosrc
--   via replace(..., chr(59)) so installed bodies get real semicolons.
-- Step 4 (grants) runs after upgrade and may contain semicolons inside dollar quotes.
-- Safe to re-run. No Supabase SQL Editor required.

CREATE OR REPLACE FUNCTION public.admin_sql_sql_without_literals_v1(p_sql text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $alzidan_ws_stub$
  SELECT coalesce(p_sql, '')
$alzidan_ws_stub$;

UPDATE pg_proc SET
  prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql'),
  prosrc = replace($alzidan_ws_prosrc$
declare
  v text := coalesce(p_sql, '')@SC@
  v_out text := ''@SC@
  i int := 1@SC@
  n int@SC@
  ch text@SC@
  tag text@SC@
  endtag text@SC@
  j int@SC@
begin
  n := char_length(v)@SC@
  while i <= n loop
    ch := substr(v, i, 1)@SC@
    if ch = '$' then
      j := i + 1@SC@
      while j <= n and substr(v, j, 1) ~ '[A-Za-z0-9_]' loop
        j := j + 1@SC@
      end loop@SC@
      if j <= n and substr(v, j, 1) = '$' then
        tag := substr(v, i, j - i + 1)@SC@
        endtag := tag@SC@
        i := j + 1@SC@
        v_out := v_out || ' '@SC@
        while i <= n loop
          if substr(v, i, char_length(endtag)) = endtag then
            i := i + char_length(endtag)@SC@
            v_out := v_out || ' '@SC@
            exit@SC@
          end if@SC@
          v_out := v_out || ' '@SC@
          i := i + 1@SC@
        end loop@SC@
        continue@SC@
      end if@SC@
    end if@SC@
    if ch = chr(39) then
      v_out := v_out || ' '@SC@
      i := i + 1@SC@
      while i <= n loop
        if substr(v, i, 1) = chr(39) then
          if i < n and substr(v, i + 1, 1) = chr(39) then
            v_out := v_out || '  '@SC@
            i := i + 2@SC@
            continue@SC@
          end if@SC@
          i := i + 1@SC@
          exit@SC@
        end if@SC@
        v_out := v_out || ' '@SC@
        i := i + 1@SC@
      end loop@SC@
      continue@SC@
    end if@SC@
    if ch = '-' and i < n and substr(v, i + 1, 1) = '-' then
      while i <= n and substr(v, i, 1) <> E'\n' loop
        v_out := v_out || ' '@SC@
        i := i + 1@SC@
      end loop@SC@
      continue@SC@
    end if@SC@
    if ch = '/' and i < n and substr(v, i + 1, 1) = '*' then
      v_out := v_out || '  '@SC@
      i := i + 2@SC@
      while i < n loop
        if substr(v, i, 2) = '*/' then
          v_out := v_out || '  '@SC@
          i := i + 2@SC@
          exit@SC@
        end if@SC@
        v_out := v_out || ' '@SC@
        i := i + 1@SC@
      end loop@SC@
      continue@SC@
    end if@SC@
    v_out := v_out || ch@SC@
    i := i + 1@SC@
  end loop@SC@
  return v_out@SC@
end@SC@
$alzidan_ws_prosrc$, '@SC@', chr(59))
WHERE proname = 'admin_sql_sql_without_literals_v1'
  AND pronamespace = 'public'::regnamespace;

UPDATE pg_proc SET
  prosrc = replace($alzidan_ws_prosrc$
declare
  v_sql text@SC@
  v_cls jsonb@SC@
  v_is_mutating boolean@SC@
  v_is_selectish boolean@SC@
  v_started timestamptz@SC@
  v_elapsed_ms integer@SC@
  v_row_count bigint := 0@SC@
  v_rows jsonb := '[]'::jsonb@SC@
  v_truncated boolean := false@SC@
  v_audit_id bigint@SC@
  v_err_state text@SC@
  v_err_msg text@SC@
  v_limit integer := 500@SC@
  v_probe text@SC@
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed'@SC@
  end if@SC@

  v_sql := btrim(coalesce(p_sql, ''))@SC@
  if v_sql = '' then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'SQL-WS-EMPTY',
      'message_ar', 'أدخل أمر SQL أولاً.'
    )@SC@
  end if@SC@

  v_probe := public.admin_sql_sql_without_literals_v1(v_sql)@SC@
  v_probe := regexp_replace(v_probe, '@SC@\s*$', '')@SC@
  if position('@SC@' in v_probe) > 0 then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'SQL-WS-MULTI',
      'message_ar', 'يُسمح بأمر واحد فقط في كل تنفيذ. للصيانة متعددة الأوامر: استخدم «أوامر الصيانة الجاهزة» (تشغيل متسلسل).'
    )@SC@
  end if@SC@
  v_sql := regexp_replace(v_sql, '@SC@\s*$', '')@SC@

  v_cls := public.admin_sql_classify_v1(v_sql)@SC@
  v_is_mutating := coalesce((v_cls->>'mutating')::boolean, false)@SC@
  v_is_selectish := coalesce((v_cls->>'selectish')::boolean, false)@SC@

  if v_is_mutating and not coalesce(p_confirm_mutate, false) then
    return jsonb_build_object(
      'ok', false,
      'needs_confirm', true,
      'error_code', 'SQL-WS-CONFIRM',
      'message_ar', 'هذا أمر يغيّر البيانات. أكّد التنفيذ للمتابعة.',
      'first_keyword', v_cls->>'first'
    )@SC@
  end if@SC@

  v_started := clock_timestamp()@SC@

  begin
    if v_is_selectish then
      execute
        'select coalesce(jsonb_agg(to_jsonb(q)), ''[]''::jsonb), count(*)::bigint '
        || 'from (select * from (' || v_sql || ') _sql_ws_src limit '
        || (v_limit + 1)::text
        || ') q'
      into v_rows, v_row_count@SC@

      if v_row_count > v_limit then
        v_truncated := true@SC@
        v_row_count := v_limit@SC@
        select coalesce(jsonb_agg(val), '[]'::jsonb)
          into v_rows
        from (
          select value as val
          from jsonb_array_elements(coalesce(v_rows, '[]'::jsonb))
          limit v_limit
        ) s@SC@
      end if@SC@
    else
      execute v_sql@SC@
      get diagnostics v_row_count = row_count@SC@
      v_rows := '[]'::jsonb@SC@
    end if@SC@
  exception when others then
    get stacked diagnostics
      v_err_state = returned_sqlstate,
      v_err_msg = message_text@SC@
    v_elapsed_ms := greatest(
      0,
      (extract(epoch from (clock_timestamp() - v_started)) * 1000)::integer
    )@SC@

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
          'error_code', 'SQL-WS-EXEC'
        )
      )@SC@
    exception when others then
      v_audit_id := null@SC@
    end@SC@

    return jsonb_build_object(
      'ok', false,
      'error_code', 'SQL-WS-EXEC',
      'message_ar', 'تعذّر تنفيذ الأمر. راجع الصياغة أو الصلاحيات ثم أعد المحاولة.',
      'hint_ar', 'تفاصيل تقنية محفوظة في سجل التدقيق فقط.',
      'elapsed_ms', v_elapsed_ms,
      'audit_id', v_audit_id
    )@SC@
  end@SC@

  v_elapsed_ms := greatest(
    0,
    (extract(epoch from (clock_timestamp() - v_started)) * 1000)::integer
  )@SC@

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
        'confirmed_mutate', coalesce(p_confirm_mutate, false)
      )
    )@SC@
  exception when others then
    v_audit_id := null@SC@
  end@SC@

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
    'executor', 'literal_aware_v2'
  )@SC@
end@SC@
$alzidan_ws_prosrc$, '@SC@', chr(59))
WHERE proname = 'admin_sql_execute_v1'
  AND pronamespace = 'public'::regnamespace
  AND pg_get_function_identity_arguments(oid) = 'p_token text, p_sql text, p_confirm_mutate boolean';

DO $alzidan_ws_grants$
BEGIN
  BEGIN
    REVOKE ALL ON FUNCTION public.admin_sql_execute_v1(text, text, boolean) FROM public;
  EXCEPTION WHEN undefined_object OR invalid_grant_operation THEN
    NULL;
  END;
  BEGIN
    GRANT EXECUTE ON FUNCTION public.admin_sql_execute_v1(text, text, boolean) TO anon, authenticated;
  EXCEPTION WHEN undefined_object THEN
    NULL;
  END;
  BEGIN
    REVOKE ALL ON FUNCTION public.admin_sql_sql_without_literals_v1(text) FROM public;
  EXCEPTION WHEN undefined_object OR invalid_grant_operation THEN
    NULL;
  END;
  BEGIN
    GRANT EXECUTE ON FUNCTION public.admin_sql_sql_without_literals_v1(text) TO anon, authenticated;
  EXCEPTION WHEN undefined_object THEN
    NULL;
  END;
END
$alzidan_ws_grants$;
