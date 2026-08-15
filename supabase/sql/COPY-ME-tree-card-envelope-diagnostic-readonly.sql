-- COPY-ME: tree_card envelope diagnostic (READ ONLY)
-- Run in Supabase SQL Editor. No UPDATE / No DDL.
-- Purpose: count tree_card rows by marker / visible pattern before any repair.

with base as (
  select
    id,
    request_id,
    status,
    branch_key,
    created_at,
    coalesce(message, '') as message,
    length(coalesce(message, '')) as msg_len,
    position('__JSON__:' in coalesce(message, '')) as json_pos
  from public.approval_requests
  where kind = 'tree_card'
),
classified as (
  select
    b.*,
    case
      when b.msg_len = 0 then 'empty_message'
      when b.json_pos = 0 then 'missing_json'
      when nullif(btrim(substr(b.message, b.json_pos + length('__JSON__:'))), '') is null
        then 'marker_empty'
      when left(btrim(substr(b.message, b.json_pos + length('__JSON__:'))), 1) <> '{'
        then 'malformed_json'
      else 'has_json_object'
    end as envelope_class,
    case
      when b.message like 'طلب: أضف فردًا%' then 'rx_visible'
      when b.message like 'بطاقة إضافة بيانات للشجرة%' then 'card_visible'
      when b.message like '%العائلة (إجباري): زيدان / مزيد%' then 'whatsapp_templateish'
      else 'other_visible'
    end as source_pattern
  from base b
)
select
  count(*) as total_tree_card,
  count(*) filter (where envelope_class = 'empty_message') as empty_message,
  count(*) filter (where envelope_class = 'missing_json') as missing_json,
  count(*) filter (where envelope_class = 'marker_empty') as marker_empty,
  count(*) filter (where envelope_class = 'malformed_json') as malformed_json,
  count(*) filter (where envelope_class = 'has_json_object') as has_json_object,
  count(*) filter (where source_pattern = 'rx_visible') as pattern_rx,
  count(*) filter (where source_pattern = 'card_visible') as pattern_card,
  count(*) filter (where source_pattern = 'whatsapp_templateish') as pattern_templateish,
  count(*) filter (where status = 'pending') as pending_n,
  count(*) filter (where status = 'approved') as approved_n,
  count(*) filter (where status = 'rejected') as rejected_n,
  min(created_at) as oldest,
  max(created_at) as newest
from classified;

-- Optional sample (uncomment):
-- select request_id, status, branch_key, created_at, envelope_class, source_pattern,
--        left(message, 180) as head
-- from classified
-- where envelope_class <> 'has_json_object'
-- order by created_at desc
-- limit 50;

-- Do NOT bulk-UPDATE message from Admin UI or this file.
-- Repair only after reviewing recoverable cases; keep idempotent and no invented person_id.
