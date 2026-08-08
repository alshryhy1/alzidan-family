-- NOTE: Operator upgrade path is 20260809_sql_workspace_executor_bootstrap.sql
-- (zero-semicolon CREATE stub + UPDATE pg_proc via Workspace). This file is the
-- readable source of the stripper/executor bodies.
-- Preset id: maint.sql_workspace_literal_aware_v1

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

drop function if exists public.admin_sql_execute_v1(text, text);
drop function if exists public.admin_sql_execute_v1(text, text, boolean);

create or replace function public.admin_sql_execute_v1(
  p_token text,
  p_sql text,
  p_confirm_mutate boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
      'message_ar', 'يُسمح بأمر واحد فقط في كل تنفيذ. للصيانة متعددة الأوامر: استخدم «أوامر الصيانة الجاهزة» (تشغيل متسلسل).'
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
          'error_code', 'SQL-WS-EXEC'
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
        'confirmed_mutate', coalesce(p_confirm_mutate, false)
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
    'message_ar', 'تم التنفيذ'
  );
end;
$$;

comment on function public.admin_sql_execute_v1(text, text, boolean) is
  'SQL Workspace: admin-token gated execute + audit. Literals-aware multi check.';

revoke all on function public.admin_sql_execute_v1(text, text, boolean) from public;
grant execute on function public.admin_sql_execute_v1(text, text, boolean)
  to anon, authenticated;

revoke all on function public.admin_sql_sql_without_literals_v1(text) from public;
grant execute on function public.admin_sql_sql_without_literals_v1(text)
  to anon, authenticated;
