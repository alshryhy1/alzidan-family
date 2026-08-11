-- COPY-ME: run in Supabase SQL Editor (once)
-- عند رفض طلب مناسبة (event_card / family_event / event_request):
-- يُحذف صف family_events المطابق لـ request_id من details (الشريط + المناسبات).
-- Trigger آمن — لا يستبدل admin_set_request_status_v2.
-- يعمل أيضاً عندما يضبط محرك السير status=rejected عبر admin_workflow_transition_v1.
-- الواجهة أيضاً تلغي النشر من JS (unpublishPublishedEventForRequest) + RPC
-- COPY-ME-admin-unpublish-events-for-request-v1.sql (هوية type+person+date كاحتياط).

create or replace function public.trg_approval_request_reject_unpublish_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.status = 'rejected'
     and NEW.kind in ('event_card', 'family_event', 'event_request')
     and nullif(btrim(coalesce(NEW.request_id, '')), '') is not null
     and (
       TG_OP = 'INSERT'
       or OLD.status is distinct from NEW.status
     ) then
    -- Exact same match as admin_delete_request_v1
    delete from public.family_events e
    where coalesce(e.details, '') like '%' || NEW.request_id || '%';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_approval_request_reject_unpublish_event
  on public.approval_requests;

create trigger trg_approval_request_reject_unpublish_event
  after insert or update of status on public.approval_requests
  for each row
  execute function public.trg_approval_request_reject_unpublish_event();
