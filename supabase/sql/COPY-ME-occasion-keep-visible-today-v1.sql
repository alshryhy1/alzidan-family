-- Open this file, Select All, paste in Supabase SQL Editor

-- Keep today's invitation on the public board. Inbox replies stay as they are.
-- Fixes a stale end_at/show_at that hid the card while «شاركوك دعوتك» still showed.

with calc as (
  select
    e.id,
    coalesce(e.event_date, (now() at time zone 'Asia/Riyadh')::date) as v_day,
    (
      (
        coalesce(e.event_date, (now() at time zone 'Asia/Riyadh')::date) - coalesce(e.show_before_days, 3)
      )::timestamp at time zone 'Asia/Riyadh'
    ) as v_show,
    (
      (
        (coalesce(e.event_date, (now() at time zone 'Asia/Riyadh')::date) + 1)::timestamp
        at time zone 'Asia/Riyadh'
      ) - interval '1 second'
    ) as v_end
  from public.family_events e
  where coalesce(e.details, '') like '%EVAPP-MT0LKSNK-TCRR%'
)
update public.family_events e
set
  manual_hidden = false,
  show_before_days = coalesce(e.show_before_days, 3),
  show_at = c.v_show,
  end_at = c.v_end,
  event_date = c.v_day,
  details = (
    case
      when e.details is not null and left(btrim(e.details), 1) = '{' then e.details::jsonb
      else '{}'::jsonb
    end || jsonb_build_object(
      'show_at', c.v_show,
      'end_at', c.v_end,
      'show_before_days', coalesce(e.show_before_days, 3),
      'manual_hidden', false
    )
  )::text
from calc c
where e.id = c.id;
