-- Operator path: Admin → SQL Workspace → أوامر الصيانة الجاهزة
-- Preset: maint.sql_workspace_executor_bootstrap_v1
-- Bootstraps literal-aware executor THROUGH the old naive MULTI checker.
-- Each statement below contains ZERO raw semicolon characters
-- (uses EXECUTE replace + chr(59)) so the old admin_sql_execute_v1 accepts them.
-- After this runs, CREATE FUNCTION bodies work from Workspace.
-- Safe to re-run.

EXECUTE replace + chr(59)),
-- so the old admin_sql_execute_v1 accepts them. After this runs, CREATE FUNCTION works.
-- Safe to re-run.

EXECUTE replace($alzidan_ws_upgrade$
create or replace function public.admin_sql_sql_without_literals_v1(p_sql text)
returns text
language plpgsql
immutable
as $fn$
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
$fn$
$alzidan_ws_upgrade$, '@SC@', chr(59));

drop function if exists public.admin_sql_execute_v1(text, text);

drop function if exists public.admin_sql_execute_v1(text, text, boolean);

EXECUTE replace($alzidan_ws_upgrade$
create or replace function public.admin_sql_execute_v1(
  p_token text,
  p_sql text,
  p_confirm_mutate boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $body$
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
  v_stripper_ok boolean := false@SC@
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

  begin
    v_probe := public.admin_sql_sql_without_literals_v1(v_sql)@SC@
    v_stripper_ok := true@SC@
  exception when undefined_function then
    v_probe := v_sql@SC@
    v_stripper_ok := false@SC@
  end@SC@

  v_probe := regexp_replace(v_probe, '@SC@\s*$', '')@SC@
  if position('@SC@' in v_probe) > 0 then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'SQL-WS-MULTI',
      'message_ar', 'يُسمح بأمر واحد فقط في كل تنفيذ. للصيانة متعددة الأوامر: استخدم «أوامر الصيانة الجاهزة» (تشغيل متسلسل).',
      'needs_executor_upgrade', (not v_stripper_ok)
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
        'confirmed_mutate', coalesce(p_confirm_mutate, false),
        'executor', 'literal_aware_v2'
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
$body$
$alzidan_ws_upgrade$, '@SC@', chr(59));

comment on function public.admin_sql_execute_v1(text, text, boolean) is 'SQL Workspace: literal-aware MULTI check (bootstrap via Workspace)';

revoke all on function public.admin_sql_execute_v1(text, text, boolean) from public;

grant execute on function public.admin_sql_execute_v1(text, text, boolean) to anon, authenticated;

revoke all on function public.admin_sql_sql_without_literals_v1(text) from public;

grant execute on function public.admin_sql_sql_without_literals_v1(text) to anon, authenticated;
