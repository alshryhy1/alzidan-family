-- Preset id: maint.women_add_pending_now_v1
-- Run from Admin → tools → SQL Workspace (sequential v2). Do not paste in Supabase SQL Editor.
-- Allows pending_family rows (null phone, no tree node) then replaces add_member.

do $fix$
declare
  v_con text;
begin
  begin
    alter table public.member_profiles alter column phone drop not null;
  exception when others then
    null;
  end;
  begin
    alter table public.member_profiles alter column branch_key drop not null;
  exception when others then
    null;
  end;
  begin
    alter table public.member_profiles alter column tree_child_id drop not null;
  exception when others then
    null;
  end;
  begin
    alter table public.member_profiles alter column person_id drop not null;
  exception when others then
    null;
  end;
  begin
    alter table public.member_profiles alter column display_name drop not null;
  exception when others then
    null;
  end;

  for v_con in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.member_profiles'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ~* 'status'
      and pg_get_constraintdef(c.oid) !~* 'pending_family'
  loop
    execute format('alter table public.member_profiles drop constraint %I', v_con);
  end loop;
end;
$fix$;

create or replace function public.women_manager_add_member_v1(
  p_phone text,
  p_full_name text,
  p_member_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $add$
declare
  v_session jsonb;
  v_name text;
  v_fold text;
  v_member_phone text;
  v_digits text;
  v_existing public.member_profiles%rowtype;
  v_keep_id bigint;
  v_err text;
  v_state text;
begin
  if to_regprocedure('public.women_manager_session_v1(text)') is null
     or to_regclass('public.member_profiles') is null then
    return jsonb_build_object('ok', false, 'error', 'sql_missing');
  end if;

  v_session := public.women_manager_session_v1(p_phone);
  if coalesce((v_session->>'enabled')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;

  v_name := nullif(btrim(coalesce(p_full_name, '')), '');
  if v_name is null or char_length(v_name) < 2 then
    return jsonb_build_object('ok', false, 'error', 'bad_name');
  end if;

  if to_regprocedure('public.women_member_name_fold_v1(text)') is not null then
    v_fold := public.women_member_name_fold_v1(v_name);
  else
    v_fold := lower(btrim(v_name));
  end if;

  v_member_phone := nullif(btrim(coalesce(p_member_phone, '')), '');
  if v_member_phone is not null then
    v_digits := right(regexp_replace(v_member_phone, '[^0-9]', '', 'g'), 9);
    if char_length(coalesce(v_digits, '')) < 9 then
      return jsonb_build_object('ok', false, 'error', 'bad_phone');
    end if;
  end if;

  if v_digits is not null then
    select mp.* into v_existing
    from public.member_profiles mp
    where char_length(right(regexp_replace(coalesce(mp.phone, ''), '[^0-9]', '', 'g'), 9)) = 9
      and right(regexp_replace(coalesce(mp.phone, ''), '[^0-9]', '', 'g'), 9) = v_digits
    order by (coalesce(mp.tree_child_id, 0) > 0) desc, mp.id
    limit 1;
    if found then
      if coalesce(v_existing.tree_child_id, 0) > 0 then
        return jsonb_build_object('ok', false, 'error', 'phone_conflict', 'tree_child_id', v_existing.tree_child_id);
      end if;
      if coalesce(v_existing.status, '') = 'pending_family' then
        update public.member_profiles
        set display_name = coalesce(nullif(btrim(coalesce(display_name, '')), ''), v_name),
            phone = v_member_phone,
            status = 'pending_family',
            updated_at = now()
        where id = v_existing.id;
        return jsonb_build_object('ok', true, 'action', 'existing_pending', 'member_id', v_existing.id, 'kind', 'pending');
      end if;
      return jsonb_build_object('ok', false, 'error', 'phone_conflict');
    end if;
  end if;

  begin
    select mp.* into v_existing
    from public.member_profiles mp
    where coalesce(mp.tree_child_id, 0) = 0
      and coalesce(mp.status, '') = 'pending_family'
      and lower(btrim(coalesce(mp.display_name, ''))) is not distinct from lower(btrim(v_name))
    order by mp.id
    limit 1;
  exception when others then
    v_existing := null;
  end;
  if v_existing.id is not null then
    if v_member_phone is not null then
      update public.member_profiles
      set phone = v_member_phone, updated_at = now()
      where id = v_existing.id
        and nullif(btrim(coalesce(phone, '')), '') is null;
    end if;
    return jsonb_build_object('ok', true, 'action', 'existing_pending', 'member_id', v_existing.id, 'kind', 'pending');
  end if;

  begin
    insert into public.member_profiles (phone, display_name, status, created_at, updated_at)
    values (v_member_phone, v_name, 'pending_family', now(), now())
    returning id into v_keep_id;
  exception when others then
    v_err := SQLERRM;
    v_state := SQLSTATE;
    begin
      insert into public.member_profiles (display_name, status)
      values (v_name, 'pending_family')
      returning id into v_keep_id;
    exception when others then
      v_err := SQLERRM;
      v_state := SQLSTATE;
      begin
        insert into public.member_profiles (display_name)
        values (v_name)
        returning id into v_keep_id;
        begin
          update public.member_profiles
          set status = 'pending_family', updated_at = now()
          where id = v_keep_id;
        exception when others then
          null;
        end;
      exception when others then
        return jsonb_build_object(
          'ok', false,
          'error', 'save_failed',
          'sqlstate', SQLSTATE,
          'detail', left(SQLERRM, 180)
        );
      end;
    end;
  end;

  if v_keep_id is null then
    return jsonb_build_object('ok', false, 'error', 'save_failed', 'sqlstate', v_state, 'detail', left(coalesce(v_err, ''), 180));
  end if;

  begin
    update public.member_profiles
    set status = 'pending_family',
        display_name = coalesce(nullif(btrim(coalesce(display_name, '')), ''), v_name),
        updated_at = now()
    where id = v_keep_id;
  exception when others then
    null;
  end;

  return jsonb_build_object('ok', true, 'action', 'created_pending', 'member_id', v_keep_id, 'kind', 'pending');
exception
  when others then
    return jsonb_build_object(
      'ok', false,
      'error', 'save_failed',
      'sqlstate', SQLSTATE,
      'detail', left(SQLERRM, 180)
    );
end;
$add$;

grant execute on function public.women_manager_add_member_v1(text, text, text) to anon, authenticated;
notify pgrst, 'reload schema';
select to_regprocedure('public.women_manager_add_member_v1(text, text, text)') is not null as has_add;
