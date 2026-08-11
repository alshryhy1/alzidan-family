-- COPY-ME: run once in Supabase SQL Editor
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
