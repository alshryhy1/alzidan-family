-- =============================================================================
-- LIVE Media Audit — CLOSEOUT (READ ONLY)
-- Run in: Supabase SQL Editor OR Admin → SQL Workspace
-- Safe: SELECT / catalog only. NO DDL. NO DML. NO Migration.
-- Ref: docs/LIVE-SUPABASE-AUDIT-2026-08-15.md
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A) storage.buckets — كل الـbuckets · public/private
-- -----------------------------------------------------------------------------
select
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types,
  created_at,
  updated_at
from storage.buckets
order by name;

-- -----------------------------------------------------------------------------
-- B) pg_policies على storage.objects — SELECT/INSERT/UPDATE/DELETE
-- -----------------------------------------------------------------------------
select
  policyname,
  cmd,                 -- SELECT | INSERT | UPDATE | DELETE | ALL
  roles,               -- {anon}, {authenticated}, {service_role}, ...
  permissive,
  qual::text as using_expression,
  with_check::text as with_check_expression
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
order by cmd, policyname;

-- اختياري: سياسات storage.buckets إن وُجدت
select
  policyname,
  cmd,
  roles,
  qual::text as using_expression,
  with_check::text as with_check_expression
from pg_policies
where schemaname = 'storage'
  and tablename = 'buckets'
order by cmd, policyname;

-- -----------------------------------------------------------------------------
-- C) MED-03 — memory_card في approval_requests مقابل family_memory_items
-- يتطلب صلاحية ترى approval_requests (admin / service_role)، ليس anon.
-- -----------------------------------------------------------------------------

-- C1) عيّنة طلبات ذكرى
select
  id,
  request_id,
  kind,
  status,
  branch_key,
  created_at,
  left(coalesce(message, ''), 180) as message_head
from public.approval_requests
where kind = 'memory_card'
order by created_at desc nulls last
limit 50;

-- C2) إن وُجدت طلبات معتمدة: هل طابقت عنصر ذاكرة معتمد؟
-- (ربط تقريبي عبر request_id داخل الرسالة أو MEM-… في المسارات)
select
  ar.id as approval_id,
  ar.request_id,
  ar.status as approval_status,
  ar.created_at as approval_created_at,
  mi.id as memory_item_id,
  mi.status as memory_status,
  mi.title,
  mi.created_at as memory_created_at
from public.approval_requests ar
left join public.family_memory_items mi
  on mi.id::text = replace(ar.request_id, 'MEM-ITEM-', '')
  or coalesce(ar.message, '') ilike '%' || ar.request_id || '%'
where ar.kind = 'memory_card'
order by ar.created_at desc nulls last
limit 50;

-- C3) عناصر ذاكرة بكل الحالات (لحساب الفجوة)
select status, count(*) as n
from public.family_memory_items
group by status
order by status;

-- C4) media_url لكل العناصر (ليس approved فقط) — لمطابقة orphans لاحقًا
select
  m.id as media_id,
  m.memory_id,
  i.status as item_status,
  m.media_type,
  m.media_url
from public.family_memory_media m
left join public.family_memory_items i on i.id = m.memory_id
order by m.id desc
limit 200;

-- -----------------------------------------------------------------------------
-- D) اختياري — عدد objects في event-media (إن سُمح)
-- -----------------------------------------------------------------------------
select
  count(*) as object_count,
  coalesce(sum((metadata->>'size')::bigint), 0) as bytes_sum_approx
from storage.objects
where bucket_id = 'event-media';
