-- Public SELECT-only RLS for special_cards (mobile / web home).
-- Admin writes continue via SECURITY DEFINER RPCs
--   (admin_special_cards_save_v1 / delete_v1 / list_v1).
--
-- Date window (start_date / end_date):
--   * NULL / blank → no constraint
--   * Gregorian ISO year 19xx/20xx → compare vs CURRENT_DATE
--   * Hijri / non-parseable (e.g. 1448-02-24) → no constraint
--     so broken date compares never hide an active card.
--
-- No INSERT / UPDATE / DELETE policies for anon|authenticated.

alter table public.special_cards enable row level security;

create or replace function public.special_cards_public_date_bound_ok(
  p_value text,
  p_kind text
)
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  v text;
  d date;
begin
  v := nullif(btrim(coalesce(p_value, '')), '');
  if v is null then
    return true;
  end if;

  -- Only apply window for Gregorian-looking ISO dates (matches mobile isGregorianDateKey).
  if v !~ '^(19|20)[0-9]{2}-[0-9]{2}-[0-9]{2}$' then
    return true;
  end if;

  begin
    d := v::date;
  exception
    when others then
      -- Invalid calendar date that still matched the regex → do not hide.
      return true;
  end;

  if lower(coalesce(p_kind, '')) = 'start' then
    return d <= current_date;
  end if;

  -- end (default)
  return d >= current_date;
end;
$$;

comment on function public.special_cards_public_date_bound_ok(text, text) is
  'RLS helper: null/Hijri/non-Gregorian → allow; Gregorian ISO → start<=today / end>=today.';

revoke all on function public.special_cards_public_date_bound_ok(text, text) from public;
grant execute on function public.special_cards_public_date_bound_ok(text, text) to anon, authenticated, service_role;

-- Replace naive window that hid Hijri dates (e.g. end_date 1448-03-01 < today).
drop policy if exists "special_cards_public_select" on public.special_cards;
drop policy if exists special_cards_public_select on public.special_cards;
drop policy if exists "special_cards_public_select_active" on public.special_cards;
drop policy if exists special_cards_public_select_active on public.special_cards;

create policy "special_cards_public_select_active"
on public.special_cards
for select
to anon, authenticated
using (
  coalesce(is_active, false) = true
  and public.special_cards_public_date_bound_ok(start_date::text, 'start')
  and public.special_cards_public_date_bound_ok(end_date::text, 'end')
);

-- Public may SELECT only. Writes go through SECURITY DEFINER admin RPCs.
grant select on table public.special_cards to anon, authenticated;
revoke insert, update, delete, truncate on table public.special_cards from anon, authenticated;
