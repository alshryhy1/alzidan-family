-- Admin CMS: list all special_cards (bypasses RLS that hides rows from anon SELECT).
-- Required after ADMIN-RPC-001: save/delete already use security-definer RPCs, but
-- loadSpecialCardsRows used sb.from("special_cards") which returns [] under RLS.
-- Run once in Supabase SQL Editor, then reload admin.

drop function if exists public.admin_special_cards_list_v1(text);
drop function if exists public.admin_special_cards_list_v1(text, integer);

create or replace function public.admin_special_cards_list_v1(
  p_token text,
  p_limit integer default 300
)
returns setof public.special_cards
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 300), 500));

  return query
  select sc.*
  from public.special_cards sc
  order by sc.priority desc nulls last,
           sc.sequence_order asc nulls last,
           sc.created_at desc nulls last
  limit v_limit;
end;
$$;

grant execute on function public.admin_special_cards_list_v1(text, integer) to anon, authenticated;
