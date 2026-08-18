-- COPY-ME: Preset id: maint.tree_member_photo_v1
-- Personal photo on the tree person (tree_children.photo_url).
-- Member after login sets / changes / clears their own photo. No admin approval.
-- Admin can clear an inappropriate photo by person id.
-- Public tree shows the photo next to the name for visible people.
-- Daughters stay hidden; their photo is for their own login only.
-- Safe to re-run.

alter table public.tree_children add column if not exists photo_url text;

drop function if exists public.tree_member_viewer_v1(text);

create function public.tree_member_viewer_v1(p_phone text)
returns table(
  id bigint,
  child_name text,
  parent_name text,
  branch_key text,
  gender text,
  display_name text,
  photo_url text
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_digits text;
  v_child_id bigint;
  v_display text;
  v_branch text;
begin
  v_digits := nullif(right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 9), '');
  if v_digits is null or char_length(v_digits) < 9 then
    return;
  end if;

  select mp.tree_child_id, mp.display_name, mp.branch_key
    into v_child_id, v_display, v_branch
  from public.member_profiles mp
  where coalesce(mp.status, 'active') = 'active'
    and right(regexp_replace(coalesce(mp.phone, ''), '[^0-9]', '', 'g'), 9) = v_digits
  order by mp.updated_at desc nulls last, mp.id desc
  limit 1;

  if v_child_id is null then
    return;
  end if;

  return query
  select
    c.id,
    coalesce(c.child_name, c.name),
    coalesce(c.parent_name, c.parent),
    coalesce(c.branch_key, v_branch),
    c.gender,
    coalesce(
      nullif(btrim(v_display), ''),
      nullif(btrim(regexp_replace(coalesce(c.child_name, c.name, ''), '^.*/', '')), '')
    ),
    c.photo_url
  from public.tree_children c
  where c.id = v_child_id
  limit 1;
end;
$fn$;

create or replace function public.tree_member_set_photo_v1(p_phone text, p_photo_url text)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_digits text;
  v_child_id bigint;
  v_url text;
begin
  v_digits := nullif(right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 9), '');
  if v_digits is null or char_length(v_digits) < 9 then
    return false;
  end if;

  v_url := nullif(btrim(coalesce(p_photo_url, '')), '');
  if v_url is not null then
    if v_url !~* '^https?://' or char_length(v_url) > 2000 then
      raise exception 'photo_url_invalid';
    end if;
  end if;

  select mp.tree_child_id
    into v_child_id
  from public.member_profiles mp
  where coalesce(mp.status, 'active') = 'active'
    and right(regexp_replace(coalesce(mp.phone, ''), '[^0-9]', '', 'g'), 9) = v_digits
    and mp.tree_child_id is not null
  order by mp.updated_at desc nulls last, mp.id desc
  limit 1;

  if v_child_id is null then
    return false;
  end if;

  update public.tree_children c
  set photo_url = v_url
  where c.id = v_child_id;

  return found;
end;
$fn$;

create or replace function public.admin_tree_child_clear_photo_v1(p_token text, p_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;
  if p_id is null or p_id < 1 then
    return false;
  end if;

  update public.tree_children c
  set photo_url = null
  where c.id = p_id;

  return found;
end;
$fn$;

grant execute on function public.tree_member_viewer_v1(text) to anon, authenticated;
grant execute on function public.tree_member_set_photo_v1(text, text) to anon, authenticated;
revoke all on function public.admin_tree_child_clear_photo_v1(text, bigint) from public;
grant execute on function public.admin_tree_child_clear_photo_v1(text, bigint) to anon, authenticated;

notify pgrst, 'reload schema';

select
  (to_regprocedure('public.tree_member_set_photo_v1(text,text)') is not null) as has_member_set_photo,
  (to_regprocedure('public.admin_tree_child_clear_photo_v1(text,bigint)') is not null) as has_admin_clear_photo;
