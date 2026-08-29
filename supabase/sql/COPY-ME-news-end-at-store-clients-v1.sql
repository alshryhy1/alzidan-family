-- Open this file, Select All, paste in Supabase SQL Editor
-- Preset: maint.news_end_at_store_clients_v1
-- Safe to re-run.
-- Must start with UPDATE. Workspace treats WITH as a SELECT and rejects the write.

update public.family_events e
set
  show_at = least(coalesce(e.created_at, now()), now()),
  end_at = greatest(coalesce(e.created_at, now()), now()) + interval '7 days'
where coalesce(e.manual_hidden, false) = false
  and e.created_at > now() - interval '10 days'
  and e.type in (
    'birth',
    'marriage',
    'promotion_notice',
    'graduation_notice',
    'success',
    'achievement',
    'appointment',
    'retirement_notice',
    'certification',
    'new_house',
    'family_news',
    'congratulation',
    'travel',
    'happy',
    'sick',
    'operation',
    'discharge',
    'healing',
    'safety'
  )
  and (
    e.end_at is null
    or e.end_at < now()
  )
returning e.id, e.person, e.type, e.show_at, e.end_at;
