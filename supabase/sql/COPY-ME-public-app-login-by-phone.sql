-- COPY-ME: public_app_login_by_phone_v1
-- Run in Supabase SQL editor (wbskjfdqpugnwvrykqcn).
-- Safe/additive: allows family app login by phone for member_profiles OR enabled delegates_v2.
-- Used so delegates can bind push_tokens.phone after they register/login in the app.

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
