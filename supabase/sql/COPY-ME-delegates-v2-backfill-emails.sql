-- COPY-ME: backfill delegates_v2.email from approved approval_requests
-- Preset id: maint.delegates_v2_backfill_emails_v1
-- Safe to re-run. Only fills empty/null emails — does not overwrite existing.
--
-- This is NOT the branch-requests expand script.
-- For delegate tree_card/tree_edit/memory permissions use instead:
--   supabase/sql/COPY-ME-delegate-branch-requests-expand.sql
--
-- NOTE: starts with UPDATE (not WITH…UPDATE) so admin_sql_classify_v1 /
-- admin_sql_workspace_run_v2 treat it as mutate instead of wrapping as SELECT.

update public.delegates_v2 d
set email = s.email,
    updated_at = now()
from (
  select distinct on (
    public.delegates_v2_norm_branch(r.branch_key),
    public.delegates_v2_norm_phone(r.phone)
  )
    public.delegates_v2_norm_branch(r.branch_key) as branch_key,
    public.delegates_v2_norm_phone(r.phone) as phone,
    public.delegates_v2_norm_email(r.email) as email
  from public.approval_requests r
  where r.status = 'approved'
    and r.kind in ('tree_delegate', 'events_delegate')
    and nullif(public.delegates_v2_norm_email(r.email), '') is not null
  order by
    public.delegates_v2_norm_branch(r.branch_key),
    public.delegates_v2_norm_phone(r.phone),
    r.created_at desc nulls last
) s
where public.delegates_v2_norm_branch(d.branch_key) = s.branch_key
  and public.delegates_v2_norm_phone(d.phone) = s.phone
  and coalesce(d.is_enabled, false) is true
  and nullif(public.delegates_v2_norm_email(d.email), '') is null;

-- تحقق سريع لفرع مزيد
select id, branch_key, phone, email, is_enabled, role_key, updated_at
from public.delegates_v2
where public.delegates_v2_norm_branch(branch_key) = 'مزيد'
order by updated_at desc nulls last;
