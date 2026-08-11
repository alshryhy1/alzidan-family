-- When an approval request becomes rejected for event kinds,
-- remove published family_events matched by request_id in details
-- (same idempotency key as admin_publish_event_card_v1 / delete-unpublish).
-- Also covers Workflow Engine: admin_workflow_transition_v1 sets legacy status.
-- Implemented as a trigger so we do NOT replace admin_set_request_status_v2.
-- Accept/publish unchanged. Identity fallback lives in
-- admin_unpublish_events_for_request_v1 (JS path).

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
