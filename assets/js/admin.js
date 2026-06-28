(function () {
  const SUPABASE_URL = "https://wbskjfdqpugnwvrykqcn.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_JhgwBIXhs6z4yBZOoE2EqA_UlzjzW9c";
  let sbClient = null;
  const sbStatus = document.getElementById("sb-status");
  const adminLockedHint = document.getElementById("admin-locked-hint");
  const adminProtectedInline = null;
  const adminProtectedSections = document.getElementById(
    "admin-protected-sections",
  );
  const alertEl = document.getElementById("alert");
  const adminUsername = document.getElementById("admin-username");
  const adminPassword = document.getElementById("admin-password");
  const adminLoginControls = document.getElementById("admin-login-controls");
  const adminLoginFields = document.getElementById("admin-login-fields");
  const adminCurrentUser = document.getElementById("admin-current-user");
  const adminLoginBtn = document.getElementById("admin-login");
  const adminLogoutBtn = document.getElementById("admin-logout");
  const adminRefreshBtn = document.getElementById("admin-refresh");
  const adminEnableNotifsBtn = document.getElementById("admin-enable-notifs");
  const adminForgotBtn = document.getElementById("admin-forgot");
  const filterKind = document.getElementById("filter-kind");
  const filterStatus = document.getElementById("filter-status");
  const requestSearchInput = document.getElementById("request-search");
  const requestsPageSizeSelect = document.getElementById("requests-page-size");
  const requestsPrevPageBtn = document.getElementById("requests-prev-page");
  const requestsNextPageBtn = document.getElementById("requests-next-page");
  const requestsPageInfo = document.getElementById("requests-page-info");
  const requestsBody = document.getElementById("requests-body");
  let requestsAllRows = [];
  let requestsCurrentPage = 1;
  const ADMIN_TOKEN_KEY = "alzidan_admin_token_v1";
  const ADMIN_TOKEN_SESSION_KEY = "alzidan_admin_token_session_v1";
  let adminToken = "";
  const ADMIN_NOTIF_LAST_KEY = "alzidan_admin_notif_last_pending_v1";
  const ADMIN_EMAIL_LAST_AUDIT_KEY = "alzidan_admin_email_last_audit_v1";
  let lastNotifiedPendingKey = "";
  let lastEmailedAuditKey = "";
  let didInitialPendingSync = false;
  let didInitialAuditSync = false;
  let pendingPollTimer = null;
  const copyTreeSqlBtn = document.getElementById("copy-tree-sql");
  const treeSqlEl = document.getElementById("tree-sql");
  const refreshDelegateAuditBtn = document.getElementById(
    "refresh-delegate-audit",
  );
  const delegatesListEl = document.getElementById("delegates-list");
  const delegateAuditSelect = document.getElementById("delegate-audit-select");
  const delegateAuditStatus = document.getElementById("delegate-audit-status");
  const delegateAuditBody = document.getElementById("delegate-audit-body");
  const delegatePermsStatus = document.getElementById("delegate-perms-status");
  const delegatePermsTreeBtn = document.getElementById("delegate-perms-tree");
  const delegatePermsEventsBtn = document.getElementById(
    "delegate-perms-events",
  );
  const delegatePermsBothBtn = document.getElementById("delegate-perms-both");
  const delegatePermsDisableBtn = document.getElementById(
    "delegate-perms-disable",
  );
  const delegateDeleteBtn = document.getElementById("delegate-delete-btn");
  const copyViewsSqlBtn = document.getElementById("copy-views-sql");
  const viewsSqlEl = document.getElementById("views-sql");
  const refreshViewsStatsBtn = document.getElementById("refresh-views-stats");
  const viewsStatsEl = document.getElementById("views-stats");
  const refreshRequestsStatsBtn = document.getElementById(
    "refresh-requests-stats",
  );
  const requestsStatsEl = document.getElementById("requests-stats");
  const copyDelegatesSqlBtn = document.getElementById("copy-delegates-sql");
  const delegatesSqlEl = document.getElementById("delegates-sql");
  const copyRequestEditSqlBtn = document.getElementById(
    "copy-request-edit-sql",
  );
  const requestEditSqlEl = document.getElementById("request-edit-sql");
  const copyLahmSalehFixSqlBtn = document.getElementById(
    "copy-lahm-saleh-fix-sql",
  );
  const lahmSalehFixSqlEl = document.getElementById("lahm-saleh-fix-sql");
  const delegateAuditDetails = document.getElementById(
    "delegate-audit-details",
  );
  const adminEmailStatus = document.getElementById("admin-email-status");
  const treeImportDownloadBtn = document.getElementById("tree-import-download");
  const treeImportWhatsappBtn = document.getElementById("tree-import-whatsapp");
  const treeImportCopyBtn = document.getElementById("tree-import-copy");
  const treeImportFileEl = document.getElementById("tree-import-file");
  const treeImportRunBtn = document.getElementById("tree-import-run");
  const treeImportTemplateEl = document.getElementById("tree-import-template");
  const treeImportStatusEl = document.getElementById("tree-import-status");
  const waFileEl = document.getElementById("wa-file");
  const waFileBuildBtn = document.getElementById("wa-file-build");
  const waFileCopyBtn = document.getElementById("wa-file-copy");
  const waFileOpenBtn = document.getElementById("wa-file-open");
  const waFileTextEl = document.getElementById("wa-file-text");
  const waFileStatusEl = document.getElementById("wa-file-status");
  const treeCardEditDialog = document.getElementById("tree-card-edit-dialog");
  const treeCardEditForm = document.getElementById("tree-card-edit-form");
  const treeCardEditCancel = document.getElementById("tree-card-edit-cancel");
  const treeCardEditError = document.getElementById("tree-card-edit-error");
  const treeCardRelations = document.getElementById("tree-card-relations");
  const treeCardAddRelation = document.getElementById("tree-card-add-relation");
  let treeCardEditRow = null;
  const sourceTreeBranch = document.getElementById("source-tree-branch");
  const sourceTreeLoad = document.getElementById("source-tree-load");
  const sourceTreeNew = document.getElementById("source-tree-new");
  const sourceTreeList = document.getElementById("source-tree-list");
  const sourceTreeForm = document.getElementById("source-tree-form");
  const sourceTreeId = document.getElementById("source-tree-id");
  const sourceTreePersonId = document.getElementById("source-tree-person-id");
  const sourceTreeParent = document.getElementById("source-tree-parent");
  const sourceTreeName = document.getElementById("source-tree-name");
  const sourceTreeOrder = document.getElementById("source-tree-order");
  const sourceTreeExtraChildren = document.getElementById(
    "source-tree-extra-children",
  );
  const sourceTreeAddExtraChild = document.getElementById(
    "source-tree-add-extra-child",
  );
  const sourceTreeBirthG = document.getElementById("source-tree-birth-g");
  const sourceTreeBirthH = document.getElementById("source-tree-birth-h");
  const sourceTreeAge = document.getElementById("source-tree-age");
  const sourceTreeDeathG = document.getElementById("source-tree-death-g");
  const sourceTreeDeathH = document.getElementById("source-tree-death-h");
  const sourceTreeCity = document.getElementById("source-tree-city");
  const sourceTreeArea = document.getElementById("source-tree-area");
  const sourceTreeDeceased = document.getElementById("source-tree-deceased");
  const sourceTreeDelete = document.getElementById("source-tree-delete");
  const sourceTreeStatus = document.getElementById("source-tree-status");
  let sourceTreeRows = [];
  const eventsSourceLoad = document.getElementById("events-source-load");
  const eventsSourceList = document.getElementById("events-source-list");
  const eventsSourceForm = document.getElementById("events-source-form");
  const eventsSourceId = document.getElementById("events-source-id");
  const eventsSourceBranch = document.getElementById("events-source-branch");
  const eventsSourceType = document.getElementById("events-source-type");
  const eventsSourcePerson = document.getElementById("events-source-person");
  const bannerGeneralForm = document.getElementById("banner-general-form");
  const bannerGeneralBranch = document.getElementById("banner-general-branch");
  const bannerGeneralShowDays = document.getElementById(
    "banner-general-show-days",
  );
  const bannerGeneralText = document.getElementById("banner-general-text");
  const bannerGeneralClear = document.getElementById("banner-general-clear");
  const bannerGeneralStatus = document.getElementById("banner-general-status");
  const bannerMessagesLoad = document.getElementById("banner-messages-load");
  const bannerMessagesNew = document.getElementById("banner-messages-new");
  const bannerMessagesList = document.getElementById("banner-messages-list");
  const bannerMessagesForm = document.getElementById("banner-messages-form");
  const bannerMessagesId = document.getElementById("banner-messages-id");
  const bannerMessagesBranch = document.getElementById(
    "banner-messages-branch",
  );
  const bannerMessagesShowDays = document.getElementById(
    "banner-messages-show-days",
  );
  const bannerMessagesActive = document.getElementById(
    "banner-messages-active",
  );
  const bannerMessagesText = document.getElementById("banner-messages-text");
  const bannerMessagesDelete = document.getElementById(
    "banner-messages-delete",
  );
  const bannerMessagesStatus = document.getElementById(
    "banner-messages-status",
  );
  const adminTickerSpeed = document.getElementById("admin-ticker-speed");
  const adminTickerSpeedSave = document.getElementById(
    "admin-ticker-speed-save",
  );
  const adminTickerMobileSpeed = document.getElementById(
    "admin-ticker-mobile-speed",
  );
  let bannerMessagesRows = [];
  const eventsSourceTitle = document.getElementById("events-source-title");
  const eventsSourceGregorian = document.getElementById(
    "events-source-gregorian",
  );
  const eventsSourceText = document.getElementById("events-source-text");
  const eventsSourceImage = document.getElementById("events-source-image");
  const eventsSourceVideo = document.getElementById("events-source-video");
  const eventsSourceDelete = document.getElementById("events-source-delete");
  const eventsSourceStatus = document.getElementById("events-source-status");
  let eventsSourceRows = [];
  const TREE_SETUP_SQL = `
create table if not exists public.tree_children ( id bigserial primary key, branch_key text not null, parent_name text not null, name text not null, child_name text null, parent text null, person_id uuid null default gen_random_uuid(), parent_person_id uuid null, birth_date_g date null, birth_date_h text null, birth_year int null, birth_order int null, city text null, area text null, is_deceased boolean null default false, deceased boolean null default false, created_at timestamptz not null default now(), created_by uuid null
); alter table public.tree_children add column if not exists id bigserial;
alter table public.tree_children add column if not exists branch_key text;
alter table public.tree_children add column if not exists parent_name text;
alter table public.tree_children add column if not exists name text;
alter table public.tree_children add column if not exists child_name text;
alter table public.tree_children add column if not exists parent text;
alter table public.tree_children add column if not exists person_id uuid;
alter table public.tree_children add column if not exists parent_person_id uuid;
alter table public.tree_children add column if not exists birth_date_g date;
alter table public.tree_children add column if not exists birth_date_h text;
alter table public.tree_children add column if not exists birth_year int;
alter table public.tree_children add column if not exists birth_order int;
alter table public.tree_children add column if not exists death_date_g date;
alter table public.tree_children add column if not exists death_date_h text;
alter table public.tree_children add column if not exists city text;
alter table public.tree_children add column if not exists area text;
alter table public.tree_children add column if not exists is_deceased boolean;
alter table public.tree_children add column if not exists deceased boolean;
alter table public.tree_children add column if not exists created_at timestamptz;
alter table public.tree_children add column if not exists created_by uuid;
alter table public.tree_children alter column person_id set default gen_random_uuid(); update public.tree_children
set person_id = gen_random_uuid()
where person_id is null; update public.tree_children c
set parent_person_id = matches.person_id
from ( select child.id, min(parent.person_id::text)::uuid as person_id from public.tree_children child join public.tree_children parent on parent.branch_key = child.branch_key and coalesce(parent.child_name, parent.name) = coalesce(child.parent_name, child.parent) and parent.person_id is not null where child.parent_person_id is null group by child.id having count(distinct parent.person_id) = 1
) matches
where c.id = matches.id; create unique index if not exists tree_children_person_id_key on public.tree_children (person_id) where person_id is not null; update public.tree_children
set birth_order = case when coalesce(child_name, name) = 'مزيد بن مطلق بن زيدان/صلف/دوخي/سالم/دوخي' then 1 when coalesce(child_name, name) = 'مزيد بن مطلق بن زيدان/صلف/دوخي/سالم/حضيري' then 2 when coalesce(child_name, name) = 'مزيد بن مطلق بن زيدان/صلف/دوخي/سالم/عبدالله' then 3 when coalesce(child_name, name) = 'مزيد بن مطلق بن زيدان/صلف/دوخي/سالم/عبيد' then 4 when coalesce(child_name, name) = 'مزيد بن مطلق بن زيدان/صلف/دوخي/سالم/زيد' then 5 when coalesce(child_name, name) in ( 'مزيد بن مطلق بن زيدان/صلف/دوخي/سالم/مبارك', 'مزيد بن مطلق بن زيدان/صلف/دوخي/سالم/مبارك وزيد' ) then 6 else birth_order
end
where branch_key = 'مزيد' and parent_name = 'مزيد بن مطلق بن زيدان/صلف/دوخي/سالم'; create unique index if not exists tree_children_parent_birth_order_key on public.tree_children (branch_key, parent_name, birth_order) where birth_order is not null; alter table public.tree_children enable row level security; drop policy if exists "tree_children_select_all" on public.tree_children;
create policy "tree_children_select_all" on public.tree_children for select using (true); revoke insert, update, delete on table public.tree_children from anon, authenticated;
grant select on table public.tree_children to anon, authenticated; create or replace function public.tree_delegate_allowed_v1( p_branch_key text, p_phone text, p_email text, p_secret_hash text
) returns boolean
language sql
stable
security definer
set search_path = public
as $$ select exists ( select 1 from public.approval_requests r where r.kind = 'tree_delegate' and regexp_replace(btrim(coalesce(r.branch_key, '')), '\s+', ' ', 'g') = regexp_replace(btrim(coalesce(p_branch_key, '')), '\s+', ' ', 'g') and regexp_replace(btrim(coalesce(r.phone, '')), '\s+', '', 'g') = regexp_replace(btrim(coalesce(p_phone, '')), '\s+', '', 'g') and lower(regexp_replace(btrim(coalesce(r.email, '')), '\s+', '', 'g')) = lower(regexp_replace(btrim(coalesce(p_email, '')), '\s+', '', 'g')) and r.status = 'approved' and nullif(trim(coalesce(r.secret_hash, '')), '') is not null and nullif(trim(coalesce(p_secret_hash, '')), '') is not null and r.secret_hash = p_secret_hash limit 1 )
$$; create or replace function public.tree_audit_log_v1( p_branch_key text, p_phone text, p_email text, p_secret_hash text, p_payload jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_actor_name text; v_req_id text;
begin select r.name into v_actor_name from public.approval_requests r where r.kind = 'tree_delegate' and regexp_replace(btrim(coalesce(r.branch_key, '')), '\s+', ' ', 'g') = regexp_replace(btrim(coalesce(p_branch_key, '')), '\s+', ' ', 'g') and regexp_replace(btrim(coalesce(r.phone, '')), '\s+', '', 'g') = regexp_replace(btrim(coalesce(p_phone, '')), '\s+', '', 'g') and lower(regexp_replace(btrim(coalesce(r.email, '')), '\s+', '', 'g')) = lower(regexp_replace(btrim(coalesce(p_email, '')), '\s+', '', 'g')) and r.status = 'approved' and nullif(trim(coalesce(r.secret_hash, '')), '') is not null and nullif(trim(coalesce(p_secret_hash, '')), '') is not null and r.secret_hash = p_secret_hash order by r.created_at desc limit 1; v_req_id := 'AUD-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4)) || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 5, 4)); insert into public.approval_requests ( request_id, kind, branch_key, name, phone, email, secret_hash, message, status, created_at ) values ( v_req_id, 'tree_audit', p_branch_key, v_actor_name, p_phone, p_email, p_secret_hash, coalesce(p_payload, '{}'::jsonb)::text, 'approved', now() );
exception when others then return;
end;
$$; create or replace function public.tree_children_insert_v1( p_branch_key text, p_parent_name text, p_child_name text, p_phone text, p_email text, p_secret_hash text, p_row jsonb
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_id bigint; v_person_id uuid; v_parent_person_id uuid; v_child_base text; v_deceased boolean; v_birth_order int;
begin if not public.tree_delegate_allowed_v1(p_branch_key, p_phone, p_email, p_secret_hash) then return false; end if; v_deceased := case when p_row ? 'is_deceased' then (p_row->>'is_deceased')::boolean when p_row ? 'deceased' then (p_row->>'deceased')::boolean else null end; v_birth_order := nullif(p_row->>'birth_order', '')::int; v_person_id := nullif(p_row->>'person_id', '')::uuid; v_parent_person_id := nullif(p_row->>'parent_person_id', '')::uuid; v_child_base := nullif(btrim(regexp_replace(coalesce(p_child_name, ''), '^.*/', '')), ''); if v_birth_order is not null and v_birth_order< 1 then raise exception 'birth_order_invalid'; end if; if v_parent_person_id is null then select min(c.person_id::text)::uuid into v_parent_person_id from public.tree_children c where c.branch_key = p_branch_key and coalesce(c.child_name, c.name) = p_parent_name having count(distinct c.person_id) = 1; end if; select c.id into v_id from public.tree_children c where c.branch_key = p_branch_key and ( (v_person_id is not null and c.person_id = v_person_id) or ( v_person_id is null and (c.parent_name = p_parent_name or c.parent = p_parent_name) and (c.name = p_child_name or c.child_name = p_child_name) ) ) order by c.id desc limit 1; if v_person_id is null and exists ( select 1 from public.tree_children c where c.branch_key = p_branch_key and ( ( v_parent_person_id is not null and c.parent_person_id = v_parent_person_id ) or ( v_parent_person_id is null and coalesce(c.parent_name, c.parent) = p_parent_name ) ) and btrim(regexp_replace(coalesce(c.child_name, c.name, ''), '^.*/', '')) = v_child_base ) then raise exception 'child_already_exists'; end if; if v_birth_order is not null and exists ( select 1 from public.tree_children c where c.branch_key = p_branch_key and c.parent_name = p_parent_name and c.birth_order = v_birth_order and (v_id is null or c.id<>v_id) ) then raise exception 'birth_order_conflict'; end if; if v_id is not null then update public.tree_children c set person_id = coalesce(c.person_id, v_person_id, gen_random_uuid()), parent_person_id = coalesce(v_parent_person_id, c.parent_person_id), birth_date_g = nullif(p_row->>'birth_date_g', '')::date, birth_date_h = nullif(p_row->>'birth_date_h', ''), birth_year = nullif(p_row->>'birth_year', '')::int, birth_order = v_birth_order, city = nullif(p_row->>'city', ''), area = nullif(p_row->>'area', ''), is_deceased = coalesce(v_deceased, c.is_deceased), deceased = coalesce(v_deceased, c.deceased) where c.id = v_id; perform public.tree_audit_log_v1( p_branch_key, p_phone, p_email, p_secret_hash, jsonb_build_object( 'v', 1, 'kind', 'tree_audit', 'op', 'upsert_update', 'branch_key', p_branch_key, 'parent_name', p_parent_name, 'child_name', p_child_name, 'row', coalesce(p_row, '{}'::jsonb), 'at', now()::timestamptz ) ); return true; end if; insert into public.tree_children ( branch_key, parent_name, parent, name, child_name, person_id, parent_person_id, birth_date_g, birth_date_h, birth_year, birth_order, city, area, is_deceased, deceased, created_at ) values ( p_branch_key, p_parent_name, p_parent_name, p_child_name, p_child_name, coalesce(v_person_id, gen_random_uuid()), v_parent_person_id, nullif(p_row->>'birth_date_g', '')::date, nullif(p_row->>'birth_date_h', ''), nullif(p_row->>'birth_year', '')::int, v_birth_order, nullif(p_row->>'city', ''), nullif(p_row->>'area', ''), coalesce(v_deceased, false), coalesce(v_deceased, false), coalesce(nullif(p_row->>'created_at', '')::timestamptz, now()) ); perform public.tree_audit_log_v1( p_branch_key, p_phone, p_email, p_secret_hash, jsonb_build_object( 'v', 1, 'kind', 'tree_audit', 'op', 'insert', 'branch_key', p_branch_key, 'parent_name', p_parent_name, 'child_name', p_child_name, 'row', coalesce(p_row, '{}'::jsonb), 'at', now()::timestamptz ) ); return true;
end;
$$; create or replace function public.tree_children_update_v1( p_branch_key text, p_parent_name text, p_child_name text, p_phone text, p_email text, p_secret_hash text, p_patch jsonb
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_deceased boolean; v_birth_order int; v_id bigint;
begin if not public.tree_delegate_allowed_v1(p_branch_key, p_phone, p_email, p_secret_hash) then return false; end if; v_deceased := case when p_patch ? 'is_deceased' then (p_patch->>'is_deceased')::boolean when p_patch ? 'deceased' then (p_patch->>'deceased')::boolean else null end; v_birth_order := case when p_patch ? 'birth_order' then nullif(p_patch->>'birth_order', '')::int else null end; if v_birth_order is not null and v_birth_order< 1 then raise exception 'birth_order_invalid'; end if; select c.id into v_id from public.tree_children c where c.branch_key = p_branch_key and ( ( nullif(p_patch->>'person_id', '') is not null and c.person_id = nullif(p_patch->>'person_id', '')::uuid ) or ( nullif(p_patch->>'person_id', '') is null and (c.parent_name = p_parent_name or c.parent = p_parent_name) and (c.name = p_child_name or c.child_name = p_child_name) ) ) order by c.id desc limit 1; if v_id is null then return false; end if; if p_patch ? 'birth_order' and v_birth_order is not null and exists ( select 1 from public.tree_children c where c.branch_key = p_branch_key and c.parent_name = p_parent_name and c.birth_order = v_birth_order and c.id<>v_id ) then raise exception 'birth_order_conflict'; end if; update public.tree_children c set birth_date_g = case when p_patch ? 'birth_date_g' then nullif(p_patch->>'birth_date_g', '')::date else c.birth_date_g end, birth_date_h = case when p_patch ? 'birth_date_h' then nullif(p_patch->>'birth_date_h', '') else c.birth_date_h end, birth_year = case when p_patch ? 'birth_year' then nullif(p_patch->>'birth_year', '')::int else c.birth_year end, birth_order = case when p_patch ? 'birth_order' then v_birth_order else c.birth_order end, city = case when p_patch ? 'city' then nullif(p_patch->>'city', '') else c.city end, area = case when p_patch ? 'area' then nullif(p_patch->>'area', '') else c.area end, is_deceased = coalesce(v_deceased, c.is_deceased), deceased = coalesce(v_deceased, c.deceased) where c.branch_key = p_branch_key and c.id = v_id; if found then perform public.tree_audit_log_v1( p_branch_key, p_phone, p_email, p_secret_hash, jsonb_build_object( 'v', 1, 'kind', 'tree_audit', 'op', 'update', 'branch_key', p_branch_key, 'parent_name', p_parent_name, 'child_name', p_child_name, 'patch', coalesce(p_patch, '{}'::jsonb), 'at', now()::timestamptz ) ); end if; return found;
end;
$$; create or replace function public.tree_children_delete_v1( p_branch_key text, p_parent_name text, p_child_name text, p_phone text, p_email text, p_secret_hash text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin if not public.tree_delegate_allowed_v1(p_branch_key, p_phone, p_email, p_secret_hash) then return false; end if; delete from public.tree_children c where c.branch_key = p_branch_key and (c.parent_name = p_parent_name or c.parent = p_parent_name) and (c.name = p_child_name or c.child_name = p_child_name); if found then perform public.tree_audit_log_v1( p_branch_key, p_phone, p_email, p_secret_hash, jsonb_build_object( 'v', 1, 'kind', 'tree_audit', 'op', 'delete', 'branch_key', p_branch_key, 'parent_name', p_parent_name, 'child_name', p_child_name, 'at', now()::timestamptz ) ); end if; return found;
end;
$$; create or replace function public.tree_children_delete_by_id_v1( p_branch_key text, p_person_id uuid, p_phone text, p_email text, p_secret_hash text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_parent_name text; v_child_name text;
begin if p_person_id is null then return false; end if; if not public.tree_delegate_allowed_v1(p_branch_key, p_phone, p_email, p_secret_hash) then return false; end if; select c.parent_name, coalesce(c.child_name, c.name) into v_parent_name, v_child_name from public.tree_children c where c.branch_key = p_branch_key and c.person_id = p_person_id limit 1; if v_child_name is null then return false; end if; delete from public.tree_children c where c.branch_key = p_branch_key and c.person_id = p_person_id; if found then perform public.tree_audit_log_v1( p_branch_key, p_phone, p_email, p_secret_hash, jsonb_build_object( 'v', 1, 'kind', 'tree_audit', 'op', 'delete_by_id', 'branch_key', p_branch_key, 'person_id', p_person_id, 'parent_name', v_parent_name, 'child_name', v_child_name, 'at', now()::timestamptz ) ); end if; return found;
end;
$$; drop function if exists public.tree_children_wipe_branch_v1(text, text, text, text); grant execute on function public.tree_delegate_allowed_v1(text, text, text, text) to anon, authenticated;
grant execute on function public.tree_children_insert_v1(text, text, text, text, text, text, jsonb) to anon, authenticated;
grant execute on function public.tree_children_update_v1(text, text, text, text, text, text, jsonb) to anon, authenticated;
grant execute on function public.tree_children_delete_v1(text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.tree_children_delete_by_id_v1(text, uuid, text, text, text) to anon, authenticated;
`.trim();
  if (treeSqlEl) treeSqlEl.value = TREE_SETUP_SQL;
  if (copyTreeSqlBtn) {
    copyTreeSqlBtn.addEventListener("click", async () => {
      const ok = await copyText(TREE_SETUP_SQL);
      showAlert(
        ok ? "success" : "error",
        ok ? "تم نسخ أمر الصيانة." : "تعذر النسخ.",
      );
    });
  }
  const VIEWS_SETUP_SQL = `
create table if not exists public.site_view_counts ( day date not null, path text not null, count bigint not null default 0, primary key (day, path)
); alter table public.site_view_counts enable row level security;
revoke all on table public.site_view_counts from anon, authenticated; create or replace function public.site_track_view_v1(p_path text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_path text;
begin v_path := nullif(trim(coalesce(p_path, '')), ''); if v_path is null then v_path := '/'; end if; insert into public.site_view_counts (day, path, count) values (current_date, v_path, 1) on conflict (day, path) do update set count = public.site_view_counts.count + 1; return true;
end;
$$; create or replace function public.site_view_summary_v1(p_days int default 30)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$ with base as ( select day, path, count from public.site_view_counts where day >= (current_date - greatest(coalesce(p_days, 30), 1) + 1) ), by_day as ( select day, sum(count) as total from base group by day order by day desc ), by_path as ( select path, sum(count) as total from base group by path order by total desc, path asc limit 20 ) select jsonb_build_object( 'total', coalesce((select sum(count) from public.site_view_counts), 0), 'today', coalesce((select sum(count) from public.site_view_counts where day = current_date), 0), 'last_7', coalesce((select sum(count) from public.site_view_counts where day >= current_date - 6), 0), 'days', coalesce((select jsonb_agg(jsonb_build_object('day', day::text, 'total', total)) from by_day), '[]'::jsonb), 'paths', coalesce((select jsonb_agg(jsonb_build_object('path', path, 'total', total)) from by_path), '[]'::jsonb) );
$$; grant execute on function public.site_track_view_v1(text) to anon, authenticated;
grant execute on function public.site_view_summary_v1(int) to anon, authenticated;
`.trim();
  if (viewsSqlEl) viewsSqlEl.value = VIEWS_SETUP_SQL;
  if (copyViewsSqlBtn) {
    copyViewsSqlBtn.addEventListener("click", async () => {
      const ok = await copyText(VIEWS_SETUP_SQL);
      showAlert(
        ok ? "success" : "error",
        ok ? "تم نسخ أمر الصيانة." : "تعذر النسخ.",
      );
    });
  }
  const DELEGATES_SETUP_SQL = `
do $$
begin if exists ( select 1 from information_schema.tables where table_schema = 'public' and table_name = 'approval_requests' ) then begin execute 'alter table public.approval_requests drop constraint if exists kind_check'; execute 'alter table public.approval_requests add constraint kind_check check (kind is null or length(btrim(kind)) >0)'; exception when others then null; end; end if;
end
$$; create table if not exists public.family_events ( id bigserial primary key, branch_key text not null, type text null, person text null, date_label text null, event_date date null, details text null, hospital_name text null, hospital_dept text null, contact_method text null, contact_phone text null, visit_date_from date null, visit_date_to date null, visit_time_from text null, visit_time_to text null, created_at timestamptz not null default now()
); alter table public.tree_children add column if not exists death_date_g date;
alter table public.tree_children add column if not exists death_date_h text;
alter table public.tree_children add column if not exists is_deceased boolean;
alter table public.tree_children add column if not exists deceased boolean; alter table public.family_events add column if not exists id bigserial;
alter table public.family_events add column if not exists branch_key text;
alter table public.family_events add column if not exists type text;
alter table public.family_events add column if not exists person text;
alter table public.family_events add column if not exists date_label text;
alter table public.family_events add column if not exists event_date date;
alter table public.family_events add column if not exists details text;
alter table public.family_events add column if not exists hospital_name text;
alter table public.family_events add column if not exists hospital_dept text;
alter table public.family_events add column if not exists contact_method text;
alter table public.family_events add column if not exists contact_phone text;
alter table public.family_events add column if not exists visit_date_from date;
alter table public.family_events add column if not exists visit_date_to date;
alter table public.family_events add column if not exists visit_time_from text;
alter table public.family_events add column if not exists visit_time_to text;
alter table public.family_events add column if not exists created_at timestamptz; do $$
begin begin execute 'alter table public.family_events alter column event_date type date using nullif(event_date::text, '''')::date'; exception when others then null; end; begin execute 'alter table public.family_events alter column visit_date_from type date using nullif(visit_date_from::text, '''')::date'; exception when others then null; end; begin execute 'alter table public.family_events alter column visit_date_to type date using nullif(visit_date_to::text, '''')::date'; exception when others then null; end; begin execute 'alter table public.family_events alter column created_at type timestamptz using nullif(created_at::text, '''')::timestamptz'; exception when others then null; end;
end
$$; alter table public.family_events enable row level security; drop policy if exists "family_events_select_all" on public.family_events;
create policy "family_events_select_all" on public.family_events for select using (true); revoke insert, update, delete on table public.family_events from anon, authenticated;
grant select on table public.family_events to anon, authenticated; insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ( 'event-media', 'event-media', true, 52428800, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'video/mp4', 'video/quicktime', 'video/webm']
)
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types; drop policy if exists "event_media_public_read" on storage.objects;
create policy "event_media_public_read"
on storage.objects for select
using (bucket_id = 'event-media'); drop policy if exists "event_media_public_insert" on storage.objects;
create policy "event_media_public_insert"
on storage.objects for insert
with check (bucket_id = 'event-media'); drop function if exists public.family_events_insert_v1(text, text, text, text, jsonb);
drop function if exists public.family_events_update_v1(text, text, text, text, text, text, jsonb);
drop function if exists public.family_events_delete_v1(text, text, text, text, text, text); create or replace function public.events_delegate_allowed_v1( p_branch_key text, p_phone text, p_email text, p_secret_hash text
) returns boolean
language sql
stable
security definer
set search_path = public
as $$ select exists ( select 1 from public.approval_requests r where r.kind in ('events_delegate', 'tree_delegate') and regexp_replace(btrim(coalesce(r.branch_key, '')), '\s+', ' ', 'g') = regexp_replace(btrim(coalesce(p_branch_key, '')), '\s+', ' ', 'g') and regexp_replace(btrim(coalesce(r.phone, '')), '\s+', '', 'g') = regexp_replace(btrim(coalesce(p_phone, '')), '\s+', '', 'g') and lower(regexp_replace(btrim(coalesce(r.email, '')), '\s+', '', 'g')) = lower(regexp_replace(btrim(coalesce(p_email, '')), '\s+', '', 'g')) and r.status = 'approved' and nullif(trim(coalesce(r.secret_hash, '')), '') is not null and nullif(trim(coalesce(p_secret_hash, '')), '') is not null and r.secret_hash = p_secret_hash limit 1 )
$$; create or replace function public.check_events_delegate_access( p_branch_key text, p_phone text, p_email text, p_secret_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_row record; v_allowed boolean := false;
begin select r.request_id, r.status into v_row from public.approval_requests r where r.kind in ('events_delegate', 'tree_delegate') and regexp_replace(btrim(coalesce(r.branch_key, '')), '\s+', ' ', 'g') = regexp_replace(btrim(coalesce(p_branch_key, '')), '\s+', ' ', 'g') and regexp_replace(btrim(coalesce(r.phone, '')), '\s+', '', 'g') = regexp_replace(btrim(coalesce(p_phone, '')), '\s+', '', 'g') and lower(regexp_replace(btrim(coalesce(r.email, '')), '\s+', '', 'g')) = lower(regexp_replace(btrim(coalesce(p_email, '')), '\s+', '', 'g')) order by r.created_at desc limit 1; if v_row.request_id is null then return jsonb_build_object('allowed', false, 'status', null, 'request_id', null); end if; if v_row.status = 'approved' then select public.events_delegate_allowed_v1(p_branch_key, p_phone, p_email, p_secret_hash) into v_allowed; end if; return jsonb_build_object('allowed', coalesce(v_allowed, false), 'status', v_row.status, 'request_id', v_row.request_id);
end;
$$; create or replace function public.events_audit_log_v1( p_branch_key text, p_phone text, p_email text, p_secret_hash text, p_payload jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_actor_name text; v_req_id text;
begin select r.name into v_actor_name from public.approval_requests r where r.kind in ('events_delegate', 'tree_delegate') and regexp_replace(btrim(coalesce(r.branch_key, '')), '\s+', ' ', 'g') = regexp_replace(btrim(coalesce(p_branch_key, '')), '\s+', ' ', 'g') and regexp_replace(btrim(coalesce(r.phone, '')), '\s+', '', 'g') = regexp_replace(btrim(coalesce(p_phone, '')), '\s+', '', 'g') and lower(regexp_replace(btrim(coalesce(r.email, '')), '\s+', '', 'g')) = lower(regexp_replace(btrim(coalesce(p_email, '')), '\s+', '', 'g')) and r.status = 'approved' and nullif(trim(coalesce(r.secret_hash, '')), '') is not null and nullif(trim(coalesce(p_secret_hash, '')), '') is not null and r.secret_hash = p_secret_hash order by r.created_at desc limit 1; v_req_id := 'EVA-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4)) || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 5, 4)); insert into public.approval_requests ( request_id, kind, branch_key, name, phone, email, secret_hash, message, status, created_at ) values ( v_req_id, 'events_audit', p_branch_key, v_actor_name, p_phone, p_email, p_secret_hash, coalesce(p_payload, '{}'::jsonb)::text, 'approved', now() );
exception when others then return;
end;
$$; create or replace function public.family_events_insert_v1( p_branch_key text, p_phone text, p_email text, p_secret_hash text, p_row jsonb
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin if not public.events_delegate_allowed_v1(p_branch_key, p_phone, p_email, p_secret_hash) then return false; end if; insert into public.family_events ( branch_key, type, person, date_label, event_date, details, hospital_name, hospital_dept, contact_method, contact_phone, visit_date_from, visit_date_to, visit_time_from, visit_time_to, created_at ) values ( p_branch_key, nullif(p_row->>'type', ''), nullif(p_row->>'person', ''), nullif(p_row->>'date_label', ''), nullif(p_row->>'event_date', '')::date, nullif(p_row->>'details', ''), nullif(p_row->>'hospital_name', ''), nullif(p_row->>'hospital_dept', ''), nullif(p_row->>'contact_method', ''), nullif(p_row->>'contact_phone', ''), nullif(p_row->>'visit_date_from', '')::date, nullif(p_row->>'visit_date_to', '')::date, nullif(p_row->>'visit_time_from', ''), nullif(p_row->>'visit_time_to', ''), coalesce(nullif(p_row->>'created_at', '')::timestamptz, now()) ); perform public.events_audit_log_v1( p_branch_key, p_phone, p_email, p_secret_hash, jsonb_build_object( 'v', 1, 'kind', 'events_audit', 'op', 'insert', 'branch_key', p_branch_key, 'type', coalesce(p_row->>'type', ''), 'person', coalesce(p_row->>'person', ''), 'event_date', coalesce(p_row->>'event_date', ''), 'at', now()::timestamptz ) ); return true;
end;
$$; create or replace function public.family_events_update_v1( p_branch_key text, p_phone text, p_email text, p_secret_hash text, p_pk_col text, p_pk_value text, p_patch jsonb
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_updated boolean := false;
begin if not public.events_delegate_allowed_v1(p_branch_key, p_phone, p_email, p_secret_hash) then return false; end if; if p_pk_col = 'id' then update public.family_events e set type = case when p_patch ? 'type' then nullif(p_patch->>'type', '') else e.type end, person = case when p_patch ? 'person' then nullif(p_patch->>'person', '') else e.person end, date_label = case when p_patch ? 'date_label' then nullif(p_patch->>'date_label', '') else e.date_label end, event_date = case when p_patch ? 'event_date' then nullif(p_patch->>'event_date', '')::date else nullif(e.event_date::text, '')::date end, details = case when p_patch ? 'details' then nullif(p_patch->>'details', '') else e.details end, hospital_name = case when p_patch ? 'hospital_name' then nullif(p_patch->>'hospital_name', '') else e.hospital_name end, hospital_dept = case when p_patch ? 'hospital_dept' then nullif(p_patch->>'hospital_dept', '') else e.hospital_dept end, contact_method = case when p_patch ? 'contact_method' then nullif(p_patch->>'contact_method', '') else e.contact_method end, contact_phone = case when p_patch ? 'contact_phone' then nullif(p_patch->>'contact_phone', '') else e.contact_phone end, visit_date_from = case when p_patch ? 'visit_date_from' then nullif(p_patch->>'visit_date_from', '')::date else nullif(e.visit_date_from::text, '')::date end, visit_date_to = case when p_patch ? 'visit_date_to' then nullif(p_patch->>'visit_date_to', '')::date else nullif(e.visit_date_to::text, '')::date end, visit_time_from = case when p_patch ? 'visit_time_from' then nullif(p_patch->>'visit_time_from', '') else e.visit_time_from end, visit_time_to = case when p_patch ? 'visit_time_to' then nullif(p_patch->>'visit_time_to', '') else e.visit_time_to end where e.id = p_pk_value::bigint; v_updated := found; else update public.family_events e set type = case when p_patch ? 'type' then nullif(p_patch->>'type', '') else e.type end, person = case when p_patch ? 'person' then nullif(p_patch->>'person', '') else e.person end, date_label = case when p_patch ? 'date_label' then nullif(p_patch->>'date_label', '') else e.date_label end, event_date = case when p_patch ? 'event_date' then nullif(p_patch->>'event_date', '')::date else nullif(e.event_date::text, '')::date end, details = case when p_patch ? 'details' then nullif(p_patch->>'details', '') else e.details end, hospital_name = case when p_patch ? 'hospital_name' then nullif(p_patch->>'hospital_name', '') else e.hospital_name end, hospital_dept = case when p_patch ? 'hospital_dept' then nullif(p_patch->>'hospital_dept', '') else e.hospital_dept end, contact_method = case when p_patch ? 'contact_method' then nullif(p_patch->>'contact_method', '') else e.contact_method end, contact_phone = case when p_patch ? 'contact_phone' then nullif(p_patch->>'contact_phone', '') else e.contact_phone end, visit_date_from = case when p_patch ? 'visit_date_from' then nullif(p_patch->>'visit_date_from', '')::date else nullif(e.visit_date_from::text, '')::date end, visit_date_to = case when p_patch ? 'visit_date_to' then nullif(p_patch->>'visit_date_to', '')::date else nullif(e.visit_date_to::text, '')::date end, visit_time_from = case when p_patch ? 'visit_time_from' then nullif(p_patch->>'visit_time_from', '') else e.visit_time_from end, visit_time_to = case when p_patch ? 'visit_time_to' then nullif(p_patch->>'visit_time_to', '') else e.visit_time_to end where e.created_at = p_pk_value::timestamptz and e.branch_key = p_branch_key; v_updated := found; end if; if v_updated then perform public.events_audit_log_v1( p_branch_key, p_phone, p_email, p_secret_hash, jsonb_build_object( 'v', 1, 'kind', 'events_audit', 'op', 'update', 'branch_key', p_branch_key, 'type', coalesce(p_patch->>'type', ''), 'person', coalesce(p_patch->>'person', ''), 'event_date', coalesce(p_patch->>'event_date', ''), 'at', now()::timestamptz ) ); end if; return v_updated;
end;
$$; create or replace function public.family_events_delete_v1( p_branch_key text, p_phone text, p_email text, p_secret_hash text, p_pk_col text, p_pk_value text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_deleted boolean := false;
begin if not public.events_delegate_allowed_v1(p_branch_key, p_phone, p_email, p_secret_hash) then return false; end if; if p_pk_col = 'id' then delete from public.family_events e where e.id = p_pk_value::bigint; v_deleted := found; else delete from public.family_events e where e.created_at = p_pk_value::timestamptz and e.branch_key = p_branch_key; v_deleted := found; end if; if v_deleted then perform public.events_audit_log_v1( p_branch_key, p_phone, p_email, p_secret_hash, jsonb_build_object( 'v', 1, 'kind', 'events_audit', 'op', 'delete', 'branch_key', p_branch_key, 'pk_col', p_pk_col, 'pk_value', p_pk_value, 'at', now()::timestamptz ) ); end if; return v_deleted;
end;
$$; create or replace function public.admin_token_ok_v1(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin perform * from public.admin_list_requests(p_token, null, null, 1); return true;
exception when others then return false;
end;
$$; create or replace function public.admin_create_delegate_request_v1( p_token text, p_kind text, p_branch_key text, p_name text, p_phone text, p_email text, p_secret_hash text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_kind text; v_req_id text; v_now timestamptz := now();
begin if not public.admin_token_ok_v1(p_token) then raise exception 'not allowed'; end if; v_kind := nullif(trim(coalesce(p_kind, '')), ''); if v_kind is null or (v_kind<>'tree_delegate' and v_kind<>'events_delegate') then raise exception 'invalid kind'; end if; v_req_id := (case when v_kind = 'events_delegate' then 'EVT' else 'TRD' end) || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4)) || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 5, 4)); insert into public.approval_requests ( request_id, kind, branch_key, name, phone, email, secret_hash, message, status, created_at ) values ( v_req_id, v_kind, nullif(trim(coalesce(p_branch_key, '')), ''), nullif(trim(coalesce(p_name, '')), ''), nullif(trim(coalesce(p_phone, '')), ''), nullif(lower(trim(coalesce(p_email, ''))), ''), nullif(trim(coalesce(p_secret_hash, '')), ''), jsonb_build_object('v', 1, 'kind', 'admin_grant', 'grant', v_kind, 'at', v_now)::text, 'approved', v_now ); return v_req_id;
end;
$$; create or replace function public.admin_delete_delegate_v1( p_token text, p_branch_key text, p_phone text, p_email text
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare v_deleted bigint := 0;
begin if not public.admin_token_ok_v1(p_token) then raise exception 'not allowed'; end if; delete from public.approval_requests r where r.branch_key = nullif(trim(coalesce(p_branch_key, '')), '') and r.phone = nullif(trim(coalesce(p_phone, '')), '') and r.email = nullif(trim(coalesce(p_email, '')), '') and r.kind in ('tree_delegate', 'events_delegate', 'tree_audit', 'events_audit'); get diagnostics v_deleted = row_count; return v_deleted;
end;
$$; create or replace function public.admin_tree_children_import_v1( p_token text, p_rows jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_row jsonb; v_branch text; v_parent text; v_child text; v_id bigint; v_person_id uuid; v_parent_person_id uuid; v_deceased boolean; v_death_date_g date; v_death_date_h text; v_inserted bigint := 0; v_updated bigint := 0; v_skipped bigint := 0;
begin if not public.admin_token_ok_v1(p_token) then raise exception 'not allowed'; end if; if to_regclass('public.tree_children') is null then raise exception 'tree_children table missing'; end if; if p_rows is null or jsonb_typeof(p_rows)<>'array' then return jsonb_build_object('inserted', 0, 'updated', 0, 'skipped', 0); end if; for v_row in select value from jsonb_array_elements(p_rows) loop v_branch := nullif(btrim(coalesce(v_row->>'branch_key', '')), ''); v_parent := nullif(btrim(coalesce(v_row->>'parent_name', '')), ''); v_child := nullif(btrim(coalesce(v_row->>'child_name', '')), ''); if v_branch is null or v_parent is null or v_child is null then v_skipped := v_skipped + 1; continue; end if; v_deceased := case when v_row ? 'is_deceased' then (v_row->>'is_deceased')::boolean when v_row ? 'deceased' then (v_row->>'deceased')::boolean else false end; v_death_date_g := nullif(v_row->>'death_date_g', '')::date; v_death_date_h := nullif(v_row->>'death_date_h', ''); v_person_id := nullif(v_row->>'person_id', '')::uuid; v_parent_person_id := nullif(v_row->>'parent_person_id', '')::uuid; if v_parent_person_id is null then select min(c.person_id::text)::uuid into v_parent_person_id from public.tree_children c where c.branch_key = v_branch and coalesce(c.child_name, c.name) = v_parent having count(distinct c.person_id) = 1; end if; select c.id into v_id from public.tree_children c where c.branch_key = v_branch and c.parent_name = v_parent and coalesce(c.child_name, c.name) = v_child order by c.id desc limit 1; if v_id is not null then update public.tree_children c set person_id = coalesce(c.person_id, v_person_id, gen_random_uuid()), parent_person_id = coalesce(v_parent_person_id, c.parent_person_id), parent_name = v_parent, parent = v_parent, name = v_child, child_name = v_child, birth_date_g = nullif(v_row->>'birth_date_g', '')::date, birth_date_h = nullif(v_row->>'birth_date_h', ''), birth_year = nullif(v_row->>'birth_year', '')::int, birth_order = nullif(v_row->>'birth_order', '')::int, death_date_g = v_death_date_g, death_date_h = v_death_date_h, city = nullif(v_row->>'city', ''), area = nullif(v_row->>'area', ''), is_deceased = coalesce(v_deceased, false), deceased = coalesce(v_deceased, false) where c.id = v_id; v_updated := v_updated + 1; else insert into public.tree_children ( branch_key, parent_name, parent, name, child_name, person_id, parent_person_id, birth_date_g, birth_date_h, birth_year, birth_order, death_date_g, death_date_h, city, area, is_deceased, deceased, created_at ) values ( v_branch, v_parent, v_parent, v_child, v_child, coalesce(v_person_id, gen_random_uuid()), v_parent_person_id, nullif(v_row->>'birth_date_g', '')::date, nullif(v_row->>'birth_date_h', ''), nullif(v_row->>'birth_year', '')::int, nullif(v_row->>'birth_order', '')::int, v_death_date_g, v_death_date_h, nullif(v_row->>'city', ''), nullif(v_row->>'area', ''), coalesce(v_deceased, false), coalesce(v_deceased, false), coalesce(nullif(v_row->>'created_at', '')::timestamptz, now()) ); v_inserted := v_inserted + 1; end if; end loop; return jsonb_build_object('inserted', v_inserted, 'updated', v_updated, 'skipped', v_skipped);
end;
$$; create or replace function public.admin_tree_child_upsert_v1( p_token text, p_row jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id bigint; v_branch text; v_parent text; v_child text; v_old_parent text; v_old_child text; v_person_id uuid; v_parent_person_id uuid; v_deceased boolean; v_saved_id bigint;
begin if not public.admin_token_ok_v1(p_token) then raise exception 'not allowed'; end if; if to_regclass('public.tree_children') is null then raise exception 'tree_children table missing'; end if; v_id := nullif(p_row->>'id', '')::bigint; v_branch := nullif(btrim(coalesce(p_row->>'branch_key', '')), ''); v_parent := nullif(btrim(coalesce(p_row->>'parent_name', '')), ''); v_child := nullif(btrim(coalesce(p_row->>'child_name', '')), ''); v_person_id := nullif(p_row->>'person_id', '')::uuid; v_parent_person_id := nullif(p_row->>'parent_person_id', '')::uuid; v_deceased := case when p_row ? 'is_deceased' then (p_row->>'is_deceased')::boolean when p_row ? 'deceased' then (p_row->>'deceased')::boolean else false end; if v_branch is null or v_parent is null or v_child is null then raise exception 'missing tree row fields'; end if; if v_parent_person_id is null then select min(c.person_id::text)::uuid into v_parent_person_id from public.tree_children c where c.branch_key = v_branch and coalesce(c.child_name, c.name) = v_parent having count(distinct c.person_id) = 1; end if; if v_id is not null then select coalesce(c.parent_name, c.parent), coalesce(c.child_name, c.name), c.person_id into v_old_parent, v_old_child, v_person_id from public.tree_children c where c.id = v_id and c.branch_key = v_branch limit 1; if v_old_child is null then raise exception 'tree row not found'; end if; update public.tree_children c set parent_name = v_parent, parent = v_parent, child_name = v_child, name = v_child, person_id = coalesce(c.person_id, v_person_id, gen_random_uuid()), parent_person_id = coalesce(v_parent_person_id, c.parent_person_id), birth_date_g = nullif(p_row->>'birth_date_g', '')::date, birth_date_h = nullif(p_row->>'birth_date_h', ''), birth_year = nullif(p_row->>'birth_year', '')::int, birth_order = nullif(p_row->>'birth_order', '')::int, death_date_g = nullif(p_row->>'death_date_g', '')::date, death_date_h = nullif(p_row->>'death_date_h', ''), city = nullif(p_row->>'city', ''), area = nullif(p_row->>'area', ''), is_deceased = coalesce(v_deceased, false), deceased = coalesce(v_deceased, false) where c.id = v_id returning c.id into v_saved_id; if v_old_child<>v_child then update public.tree_children c set parent_name = case when coalesce(c.parent_name, c.parent, '') = v_old_child then v_child when coalesce(c.parent_name, c.parent, '') like v_old_child || '/%' then v_child || substr(coalesce(c.parent_name, c.parent), length(v_old_child) + 1) else c.parent_name end, parent = case when coalesce(c.parent, c.parent_name, '') = v_old_child then v_child when coalesce(c.parent, c.parent_name, '') like v_old_child || '/%' then v_child || substr(coalesce(c.parent, c.parent_name), length(v_old_child) + 1) else c.parent end, child_name = case when coalesce(c.child_name, c.name, '') like v_old_child || '/%' then v_child || substr(coalesce(c.child_name, c.name), length(v_old_child) + 1) else c.child_name end, name = case when coalesce(c.name, c.child_name, '') like v_old_child || '/%' then v_child || substr(coalesce(c.name, c.child_name), length(v_old_child) + 1) else c.name end where c.branch_key = v_branch and c.id<>v_id and ( coalesce(c.parent_name, c.parent, '') = v_old_child or coalesce(c.parent_name, c.parent, '') like v_old_child || '/%' or coalesce(c.child_name, c.name, '') like v_old_child || '/%' ); end if; else insert into public.tree_children ( branch_key, parent_name, parent, child_name, name, person_id, parent_person_id, birth_date_g, birth_date_h, birth_year, birth_order, death_date_g, death_date_h, city, area, is_deceased, deceased, created_at ) values ( v_branch, v_parent, v_parent, v_child, v_child, coalesce(v_person_id, gen_random_uuid()), v_parent_person_id, nullif(p_row->>'birth_date_g', '')::date, nullif(p_row->>'birth_date_h', ''), nullif(p_row->>'birth_year', '')::int, nullif(p_row->>'birth_order', '')::int, nullif(p_row->>'death_date_g', '')::date, nullif(p_row->>'death_date_h', ''), nullif(p_row->>'city', ''), nullif(p_row->>'area', ''), coalesce(v_deceased, false), coalesce(v_deceased, false), now() ) returning id into v_saved_id; end if; return jsonb_build_object('ok', true, 'id', v_saved_id);
end;
$$; create or replace function public.admin_tree_child_delete_subtree_v1( p_token text, p_branch_key text, p_id bigint
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare v_target text; v_deleted bigint := 0;
begin if not public.admin_token_ok_v1(p_token) then raise exception 'not allowed'; end if; select coalesce(c.child_name, c.name) into v_target from public.tree_children c where c.branch_key = p_branch_key and c.id = p_id limit 1; if v_target is null then return 0; end if; delete from public.tree_children c where c.branch_key = p_branch_key and ( c.id = p_id or coalesce(c.parent_name, c.parent, '') = v_target or coalesce(c.parent_name, c.parent, '') like v_target || '/%' or coalesce(c.child_name, c.name, '') = v_target or coalesce(c.child_name, c.name, '') like v_target || '/%' ); get diagnostics v_deleted = row_count; return v_deleted;
end;
$$; grant execute on function public.events_delegate_allowed_v1(text, text, text, text) to anon, authenticated;
grant execute on function public.check_events_delegate_access(text, text, text, text) to anon, authenticated;
grant execute on function public.family_events_insert_v1(text, text, text, text, jsonb) to anon, authenticated;
grant execute on function public.family_events_update_v1(text, text, text, text, text, text, jsonb) to anon, authenticated;
grant execute on function public.family_events_delete_v1(text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.admin_token_ok_v1(text) to anon, authenticated;
grant execute on function public.admin_create_delegate_request_v1(text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.admin_delete_delegate_v1(text, text, text, text) to anon, authenticated; -- حذف طلب إداري : للإدارة فقط عبر التوكن
create or replace function public.admin_delete_request_v1( p_token text, p_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_id bigint;
begin if not public.admin_token_ok_v1(p_token) then return false; end if; v_id := nullif(regexp_replace(coalesce(p_id, ''), '\D', '', 'g'), '')::bigint; if v_id is null then return false; end if; delete from public.approval_requests where id = v_id; return found;
exception when others then return false;
end;
$$; grant execute on function public.admin_delete_request_v1(text, text) to anon, authenticated; grant execute on function public.admin_tree_children_import_v1(text, jsonb) to anon, authenticated;
grant execute on function public.admin_tree_child_upsert_v1(text, jsonb) to anon, authenticated;
grant execute on function public.admin_tree_child_delete_subtree_v1(text, text, bigint) to anon, authenticated; drop function if exists public.admin_publish_event_card_v1(text, text, jsonb);
create or replace function public.admin_publish_event_card_v1( p_token text, p_request_id text, p_row jsonb
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_request_id text;
begin if not public.admin_token_ok_v1(p_token) then raise exception 'not allowed'; end if; v_request_id := nullif(btrim(coalesce(p_request_id, '')), ''); if v_request_id is null or p_row is null or jsonb_typeof(p_row)<>'object' then return false; end if; if exists ( select 1 from public.family_events e where coalesce(e.details, '') like '%' || v_request_id || '%' ) then return true; end if; insert into public.family_events ( branch_key, type, person, date_label, event_date, details, hospital_name, hospital_dept, contact_method, contact_phone, visit_date_from, visit_date_to, visit_time_from, visit_time_to, created_at ) values ( nullif(p_row->>'branch_key', ''), nullif(p_row->>'type', ''), nullif(p_row->>'person', ''), nullif(p_row->>'date_label', ''), nullif(p_row->>'event_date', '')::date, nullif(p_row->>'details', ''), nullif(p_row->>'hospital_name', ''), nullif(p_row->>'hospital_dept', ''), nullif(p_row->>'contact_method', ''), nullif(p_row->>'contact_phone', ''), nullif(p_row->>'visit_date_from', '')::date, nullif(p_row->>'visit_date_to', '')::date, nullif(p_row->>'visit_time_from', ''), nullif(p_row->>'visit_time_to', ''), coalesce(nullif(p_row->>'created_at', '')::timestamptz, now()) ); return true;
end;
$$; revoke all on function public.admin_publish_event_card_v1(text, text, jsonb) from public;
grant execute on function public.admin_publish_event_card_v1(text, text, jsonb) to anon, authenticated; تحديث الخدمة, 'تحديث البيانات';
`.trim();
  const REQUEST_EDIT_SETUP_SQL = `
drop function if exists public.admin_update_request_branch_v1(text, text, text, text);
drop function if exists public.admin_update_request_branch_v1(text, text, text, text, text, jsonb); create or replace function public.admin_update_request_branch_v1( p_token text, p_id text, p_old_branch_key text, p_branch_key text, p_name text, p_phone text, p_email text, p_message text, p_old_tree_rows jsonb, p_new_tree_rows jsonb
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_branch text; v_old_branch text; v_kind text; v_status text; v_row jsonb; v_parent text; v_child text;
begin if not public.admin_token_ok_v1(p_token) then raise exception 'not allowed'; end if; v_branch := nullif(btrim(coalesce(p_branch_key, '')), ''); v_old_branch := nullif(btrim(coalesce(p_old_branch_key, '')), ''); if v_branch is null then raise exception 'branch required'; end if; select kind, status into v_kind, v_status from public.approval_requests where request_id = nullif(btrim(coalesce(p_id, '')), '') or id::text = nullif(btrim(coalesce(p_id, '')), '') limit 1 for update; if v_status is null or v_status not in ('pending', 'approved') then return false; end if; if v_status = 'approved' and v_kind = 'tree_card' and v_old_branch is not null and p_old_tree_rows is not null and jsonb_typeof(p_old_tree_rows) = 'array' then for v_row in select value from jsonb_array_elements(p_old_tree_rows) loop v_parent := nullif(btrim(coalesce(v_row->>'parent_name', '')), ''); v_child := nullif(btrim(coalesce(v_row->>'child_name', '')), ''); if v_parent is null or v_child is null then continue; end if; if v_old_branch<>v_branch or not exists ( select 1 from jsonb_array_elements(coalesce(p_new_tree_rows, '[]'::jsonb)) n where nullif(btrim(coalesce(n->>'parent_name', '')), '') = v_parent and nullif(btrim(coalesce(n->>'child_name', '')), '') = v_child ) then delete from public.tree_children c where c.branch_key = v_old_branch and c.parent_name = v_parent and coalesce(c.child_name, c.name) = v_child; end if; end loop; perform public.admin_tree_children_import_v1( p_token, coalesce(p_new_tree_rows, '[]'::jsonb) ); end if; update public.approval_requests set branch_key = v_branch, name = nullif(btrim(coalesce(p_name, '')), ''), phone = nullif(btrim(coalesce(p_phone, '')), ''), email = nullif(lower(btrim(coalesce(p_email, ''))), ''), message = coalesce(nullif(p_message, ''), message) where status in ('pending', 'approved') and ( request_id = nullif(btrim(coalesce(p_id, '')), '') or id::text = nullif(btrim(coalesce(p_id, '')), '') ); return found;
end;
$$; revoke all on function public.admin_update_request_branch_v1(text, text, text, text, text, text, text, text, jsonb, jsonb) from public;
grant execute on function public.admin_update_request_branch_v1(text, text, text, text, text, text, text, text, jsonb, jsonb) to anon, authenticated;
`.trim();
  const LAHM_SALEH_FIX_SQL = `
begin; delete from public.tree_children c
where c.branch_key = 'لاحم' and ( regexp_replace(coalesce(c.child_name, c.name, ''), '^.*/', '') in ( 'صالح سليمان عواد', 'عواد سليمان صالح' ) or coalesce(c.child_name, c.name, '') in ( 'لاحم بن مطلق بن زيدان/صالح/عواد', 'لاحم بن مطلق بن زيدان/صالح/عواد/سليمان', 'لاحم بن مطلق بن زيدان/صالح/عواد/سليمان/نايف' ) ); update public.tree_children c
set parent_name = case when coalesce(c.parent_name, c.parent, '') in ('لاحم بن مطلق بن زيدان', 'لاحم') and coalesce(c.child_name, c.name, '') in ('سليمان', 'لاحم بن مطلق بن زيدان/سليمان') then 'لاحم بن مطلق بن زيدان/صالح' when coalesce(c.parent_name, c.parent, '') = 'سليمان' then 'لاحم بن مطلق بن زيدان/صالح/سليمان' else replace(coalesce(c.parent_name, c.parent), 'لاحم بن مطلق بن زيدان/سليمان', 'لاحم بن مطلق بن زيدان/صالح/سليمان') end, parent = case when coalesce(c.parent_name, c.parent, '') in ('لاحم بن مطلق بن زيدان', 'لاحم') and coalesce(c.child_name, c.name, '') in ('سليمان', 'لاحم بن مطلق بن زيدان/سليمان') then 'لاحم بن مطلق بن زيدان/صالح' when coalesce(c.parent, c.parent_name, '') = 'سليمان' then 'لاحم بن مطلق بن زيدان/صالح/سليمان' else replace(coalesce(c.parent, c.parent_name), 'لاحم بن مطلق بن زيدان/سليمان', 'لاحم بن مطلق بن زيدان/صالح/سليمان') end, child_name = case when coalesce(c.parent_name, c.parent, '') in ('لاحم بن مطلق بن زيدان', 'لاحم') and coalesce(c.child_name, c.name, '') in ('سليمان', 'لاحم بن مطلق بن زيدان/سليمان') then 'لاحم بن مطلق بن زيدان/صالح/سليمان' else replace(coalesce(c.child_name, c.name), 'لاحم بن مطلق بن زيدان/سليمان', 'لاحم بن مطلق بن زيدان/صالح/سليمان') end, name = case when coalesce(c.parent_name, c.parent, '') in ('لاحم بن مطلق بن زيدان', 'لاحم') and coalesce(c.child_name, c.name, '') in ('سليمان', 'لاحم بن مطلق بن زيدان/سليمان') then 'لاحم بن مطلق بن زيدان/صالح/سليمان' else replace(coalesce(c.name, c.child_name), 'لاحم بن مطلق بن زيدان/سليمان', 'لاحم بن مطلق بن زيدان/صالح/سليمان') end
where c.branch_key = 'لاحم' and ( ( coalesce(c.parent_name, c.parent, '') in ('لاحم بن مطلق بن زيدان', 'لاحم') and coalesce(c.child_name, c.name, '') in ('سليمان', 'لاحم بن مطلق بن زيدان/سليمان') ) or coalesce(c.parent_name, c.parent, '') = 'سليمان' or coalesce(c.parent_name, c.parent, '') like 'لاحم بن مطلق بن زيدان/سليمان/%' or coalesce(c.child_name, c.name, '') like 'لاحم بن مطلق بن زيدان/سليمان/%' ); update public.tree_children c
set parent_name = 'لاحم بن مطلق بن زيدان/صالح/سليمان', parent = 'لاحم بن مطلق بن زيدان/صالح/سليمان', child_name = 'لاحم بن مطلق بن زيدان/صالح/سليمان/عواد', name = 'لاحم بن مطلق بن زيدان/صالح/سليمان/عواد'
where c.branch_key = 'لاحم' and coalesce(c.parent_name, c.parent, '') in ('لاحم بن مطلق بن زيدان/صالح', 'صالح') and coalesce(c.child_name, c.name, '') in ('عواد', 'لاحم بن مطلق بن زيدان/صالح/عواد'); update public.tree_children c
set parent_name = 'لاحم بن مطلق بن زيدان/صالح/سليمان/عواد', parent = 'لاحم بن مطلق بن زيدان/صالح/سليمان/عواد', child_name = 'لاحم بن مطلق بن زيدان/صالح/سليمان/عواد/سليمان', name = 'لاحم بن مطلق بن زيدان/صالح/سليمان/عواد/سليمان'
where c.branch_key = 'لاحم' and coalesce(c.parent_name, c.parent, '') in ('عواد', 'لاحم بن مطلق بن زيدان/صالح/عواد', 'لاحم بن مطلق بن زيدان/صالح/سليمان/عواد') and coalesce(c.child_name, c.name, '') in ('سليمان', 'لاحم بن مطلق بن زيدان/صالح/عواد/سليمان', 'لاحم بن مطلق بن زيدان/صالح/سليمان/عواد/سليمان'); update public.tree_children c
set parent_name = 'لاحم بن مطلق بن زيدان/صالح/سليمان/عواد/سليمان', parent = 'لاحم بن مطلق بن زيدان/صالح/سليمان/عواد/سليمان', child_name = 'لاحم بن مطلق بن زيدان/صالح/سليمان/عواد/سليمان/نايف', name = 'لاحم بن مطلق بن زيدان/صالح/سليمان/عواد/سليمان/نايف'
where c.branch_key = 'لاحم' and coalesce(c.parent_name, c.parent, '') in ('سليمان', 'لاحم بن مطلق بن زيدان/صالح/سليمان', 'لاحم بن مطلق بن زيدان/صالح/عواد/سليمان', 'لاحم بن مطلق بن زيدان/صالح/سليمان/عواد/سليمان') and coalesce(c.child_name, c.name, '') in ('نايف', 'لاحم بن مطلق بن زيدان/صالح/سليمان/نايف', 'لاحم بن مطلق بن زيدان/صالح/عواد/سليمان/نايف', 'لاحم بن مطلق بن زيدان/صالح/سليمان/عواد/سليمان/نايف'); update public.tree_children c
set parent_name = replace( replace( replace(c.parent_name, 'لاحم بن مطلق بن زيدان/صالح/عواد/سليمان/نايف', 'لاحم بن مطلق بن زيدان/صالح/سليمان/عواد/سليمان/نايف'), 'لاحم بن مطلق بن زيدان/صالح سليمان عواد', 'لاحم بن مطلق بن زيدان/صالح/سليمان/عواد' ), 'لاحم بن مطلق بن زيدان/عواد سليمان صالح', 'لاحم بن مطلق بن زيدان/صالح/سليمان/عواد' ), parent = replace( replace( replace(coalesce(c.parent, c.parent_name), 'لاحم بن مطلق بن زيدان/صالح/عواد/سليمان/نايف', 'لاحم بن مطلق بن زيدان/صالح/سليمان/عواد/سليمان/نايف'), 'لاحم بن مطلق بن زيدان/صالح سليمان عواد', 'لاحم بن مطلق بن زيدان/صالح/سليمان/عواد' ), 'لاحم بن مطلق بن زيدان/عواد سليمان صالح', 'لاحم بن مطلق بن زيدان/صالح/سليمان/عواد' ), child_name = replace( replace( replace(coalesce(c.child_name, c.name), 'لاحم بن مطلق بن زيدان/صالح/عواد/سليمان/نايف', 'لاحم بن مطلق بن زيدان/صالح/سليمان/عواد/سليمان/نايف'), 'لاحم بن مطلق بن زيدان/صالح سليمان عواد', 'لاحم بن مطلق بن زيدان/صالح/سليمان/عواد' ), 'لاحم بن مطلق بن زيدان/عواد سليمان صالح', 'لاحم بن مطلق بن زيدان/صالح/سليمان/عواد' ), name = replace( replace( replace(coalesce(c.name, c.child_name), 'لاحم بن مطلق بن زيدان/صالح/عواد/سليمان/نايف', 'لاحم بن مطلق بن زيدان/صالح/سليمان/عواد/سليمان/نايف'), 'لاحم بن مطلق بن زيدان/صالح سليمان عواد', 'لاحم بن مطلق بن زيدان/صالح/سليمان/عواد' ), 'لاحم بن مطلق بن زيدان/عواد سليمان صالح', 'لاحم بن مطلق بن زيدان/صالح/سليمان/عواد' )
where c.branch_key = 'لاحم' and ( coalesce(c.parent_name, c.parent, '') like 'لاحم بن مطلق بن زيدان/صالح/عواد/سليمان/نايف/%' or coalesce(c.child_name, c.name, '') like 'لاحم بن مطلق بن زيدان/صالح/عواد/سليمان/نايف/%' or coalesce(c.parent_name, c.parent, '') like 'لاحم بن مطلق بن زيدان/صالح سليمان عواد/%' or coalesce(c.child_name, c.name, '') like 'لاحم بن مطلق بن زيدان/صالح سليمان عواد/%' or coalesce(c.parent_name, c.parent, '') like 'لاحم بن مطلق بن زيدان/عواد سليمان صالح/%' or coalesce(c.child_name, c.name, '') like 'لاحم بن مطلق بن زيدان/عواد سليمان صالح/%' ); insert into public.tree_children ( branch_key, parent_name, parent, name, child_name, created_at
)
select 'لاحم', x.parent_name, x.parent_name, x.child_name, x.child_name, now()
from ( values ('لاحم بن مطلق بن زيدان', 'صالح'), ('لاحم بن مطلق بن زيدان/صالح', 'لاحم بن مطلق بن زيدان/صالح/سليمان'), ('لاحم بن مطلق بن زيدان/صالح/سليمان', 'لاحم بن مطلق بن زيدان/صالح/سليمان/عواد'), ('لاحم بن مطلق بن زيدان/صالح/سليمان/عواد', 'لاحم بن مطلق بن زيدان/صالح/سليمان/عواد/سليمان'), ('لاحم بن مطلق بن زيدان/صالح/سليمان/عواد/سليمان', 'لاحم بن مطلق بن زيدان/صالح/سليمان/عواد/سليمان/نايف')
) as x(parent_name, child_name)
where not exists ( select 1 from public.tree_children c where c.branch_key = 'لاحم' and c.parent_name = x.parent_name and ( coalesce(c.child_name, c.name) = x.child_name or regexp_replace(coalesce(c.child_name, c.name, ''), '^.*/', '') = regexp_replace(x.child_name, '^.*/', '') )
); update public.tree_children
set person_id = gen_random_uuid()
where branch_key = 'لاحم' and person_id is null; update public.tree_children c
set parent_person_id = matches.person_id
from ( select child.id, min(parent.person_id::text)::uuid as person_id from public.tree_children child join public.tree_children parent on parent.branch_key = child.branch_key and coalesce(parent.child_name, parent.name) = coalesce(child.parent_name, child.parent) and parent.person_id is not null where child.branch_key = 'لاحم' group by child.id having count(distinct parent.person_id) = 1
) matches
where c.id = matches.id; commit;
`.trim();
  if (delegatesSqlEl) delegatesSqlEl.value = DELEGATES_SETUP_SQL;
  if (copyDelegatesSqlBtn) {
    copyDelegatesSqlBtn.addEventListener("click", async () => {
      const ok = await copyText(DELEGATES_SETUP_SQL);
      showAlert(
        ok ? "success" : "error",
        ok ? "تم نسخ أمر الصيانة." : "تعذر النسخ.",
      );
    });
  }
  if (requestEditSqlEl) requestEditSqlEl.value = REQUEST_EDIT_SETUP_SQL;
  if (copyRequestEditSqlBtn) {
    copyRequestEditSqlBtn.addEventListener("click", async () => {
      const ok = await copyText(REQUEST_EDIT_SETUP_SQL);
      showAlert(
        ok ? "success" : "error",
        ok ? "تم نسخ أمر الصيانة تعديل الفرع." : "تعذر النسخ.",
      );
    });
  }
  if (lahmSalehFixSqlEl) lahmSalehFixSqlEl.value = LAHM_SALEH_FIX_SQL;
  if (copyLahmSalehFixSqlBtn) {
    copyLahmSalehFixSqlBtn.addEventListener("click", async () => {
      const ok = await copyText(LAHM_SALEH_FIX_SQL);
      showAlert(
        ok ? "success" : "error",
        ok ? "تم نسخ أمر الصيانة إصلاح صالح." : "تعذر النسخ.",
      );
    });
  }
  try {
    lastNotifiedPendingKey = String(
      localStorage.getItem(ADMIN_NOTIF_LAST_KEY) || "",
    );
  } catch (e) {
    lastNotifiedPendingKey = "";
  }
  try {
    lastEmailedAuditKey = String(
      localStorage.getItem(ADMIN_EMAIL_LAST_AUDIT_KEY) || "",
    );
  } catch (e) {
    lastEmailedAuditKey = "";
  }
  function loadBoolSetting(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return !!fallback;
      return raw === "1";
    } catch (e) {
      return !!fallback;
    }
  }
  function saveBoolSetting(key, v) {
    try {
      localStorage.setItem(key, v ? "1" : "0");
    } catch (e) {}
  }
  function canShowBrowserNotifications() {
    return (
      typeof Notification !== "undefined" &&
      typeof Notification.requestPermission === "function"
    );
  }
  async function ensureBrowserNotificationsEnabled() {
    if (!canShowBrowserNotifications()) return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    const res = await Notification.requestPermission();
    return res === "granted";
  }
  function updateNotifsButtonText() {
    if (!adminEnableNotifsBtn) return;
    if (!getAdminToken()) {
      adminEnableNotifsBtn.textContent = "تفعيل إشعارات الطلبات";
      adminEnableNotifsBtn.disabled = true;
      return;
    }
    if (!canShowBrowserNotifications()) {
      adminEnableNotifsBtn.textContent = "الإشعارات غير مدعومة";
      adminEnableNotifsBtn.disabled = true;
      return;
    }
    if (Notification.permission === "granted") {
      adminEnableNotifsBtn.textContent = "الإشعارات مفعلة";
      adminEnableNotifsBtn.disabled = true;
      return;
    }
    if (Notification.permission === "denied") {
      adminEnableNotifsBtn.textContent = "الإشعارات مرفوضة";
      adminEnableNotifsBtn.disabled = true;
      return;
    }
    adminEnableNotifsBtn.textContent = "تفعيل إشعارات الطلبات";
    adminEnableNotifsBtn.disabled = false;
  }
  function saveLastNotifiedPendingKey(key) {
    const k = String(key || "").trim();
    if (!k) return;
    lastNotifiedPendingKey = k;
    try {
      localStorage.setItem(ADMIN_NOTIF_LAST_KEY, k);
    } catch (e) {}
  }
  function kindLabel(kind) {
    const map = {
      org_role: "صندوق / جمعية",
      tree_delegate: "مندوب الشجرة",
      events_delegate: "مندوب المناسبات",
      member_registration: "تسجيل عضو",
      tree_card: "بطاقة الشجرة",
      tree_audit: "تعديل بيانات الشجرة",
      events_audit: "تعديل الأخبار والمناسبات",
      event_card: "بطاقة مناسبة",
      test_request: "طلب اختبار",
      unknown: "غير معروف",
    };
    const key = String(kind || "").trim();
    return map[key] || key || "غير معروف";
  }
  function showPendingRequestNotification(row) {
    if (!canShowBrowserNotifications()) return;
    if (Notification.permission !== "granted") return;
    if (!row) return;
    const title = "طلب جديد: " + kindLabel(row.kind);
    const parts = [];
    if (row.branch_key) parts.push("الفرع: " + row.branch_key);
    if (row.name) parts.push("الاسم: " + row.name);
    if (row.phone) parts.push("الجوال: " + row.phone);
    if (row.email) parts.push("البريد: " + row.email);
    const body = parts.join("\n");
    try {
      const n = new Notification(title, {
        body,
        tag: "alzidan-admin-req",
        renotify: true,
      });
      n.onclick = () => {
        try {
          window.focus();
        } catch (e) {}
      };
    } catch (e) {}
  }
  function showAlert(type, text) {
    if (!alertEl) return;
    alertEl.className =
      "alert " + (type === "success" ? "alert-success" : "alert-error");
    alertEl.textContent = text || "";
    alertEl.style.display = "block";
  }
  function normalizeEmail(v) {
    return String(v || "")
      .trim()
      .toLowerCase();
  }
  function isLikelyEmail(v) {
    const s = normalizeEmail(v);
    return !!(s && s.includes("@") && s.includes(".") && s.length >= 6);
  }
  function fallbackCopyText(text) {
    const el = document.createElement("textarea");
    el.value = String(text || "");
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.opacity = "0";
    el.style.left = "-9999px";
    document.body.appendChild(el);
    el.select();
    try {
      document.execCommand("copy");
    } catch (e) {}
    document.body.removeChild(el);
  }
  async function copyText(text) {
    const t = String(text || "");
    if (!t) return false;
    try {
      if (
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === "function"
      ) {
        await navigator.clipboard.writeText(t);
        return true;
      }
    } catch (e) {}
    fallbackCopyText(t);
    return true;
  }
  function downloadTextFile(filename, text, mimeType) {
    const name = String(filename || "").trim() || "file.txt";
    const content = String(text || "");
    const type = String(mimeType || "").trim() || "text/plain;charset=utf-8";
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
          function truncateText(t, max) {
    const s = String(t || "");
    const n = Number(max || 0);
    if (!n || s.length <= n) return s;
    return s.slice(0, Math.max(0, n - 20)) + "\n...\n(تم الاختصار)";
  }
  function takeLines(text, maxLines, maxChars) {
    const src = String(text || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
    const lines = src.split("\n");
    const out = [];
    for (let i = 0; i < lines.length && out.length < maxLines; i += 1) {
      const v = String(lines[i] || "");
      if (!v.trim()) continue;
      out.push(v);
      if (maxChars && out.join("\n").length >= maxChars) break;
    }
    return out.join("\n");
  }
      async function shareTreeCsvTemplateFile() {
    const csv = treeCsvTemplateText();
    const file = new File([csv], "alzidan-tree-template.csv", {
      type: "text/csv;charset=utf-8",
    });
    if (!navigator || typeof navigator.share !== "function")
      return { ok: false, reason: "no_share" };
    try {
      if (
        typeof navigator.canShare === "function" &&
        !navigator.canShare({ files: [file] })
      ) {
        return { ok: false, reason: "no_file_share" };
      }
    } catch (e) {
      return { ok: false, reason: "no_file_share" };
    }
    try {
      await navigator.share({
        title: "قالب شجرة العائلة (CSV)",
        text: "قالب CSV لتعبئة شجرة عائلة الزيدان",
        files: [file],
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: "share_failed" };
    }
  }
  function detectCsvDelimiter(line) {
    const s = String(line || "");
    const commas = (s.match(/,/g) || []).length;
    const semis = (s.match(/;/g) || []).length;
    return semis > commas ? ";" : ",";
  }
  function parseCsv(text) {
    const raw = String(text || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
    const lines = raw
      .split("\n")
      .map((l) => l.replace(/^\ufeff/, ""))
      .filter((l) => l.trim().length);
    if (!lines.length) return [];
    const delimiter = detectCsvDelimiter(lines[0]);
    const parseLine = (line) => {
      const out = [];
      let cur = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
          if (ch === '"') {
            if (line[i + 1] === '"') {
              cur += '"';
              i++;
            } else {
              inQuotes = false;
            }
          } else {
            cur += ch;
          }
          continue;
        }
        if (ch === '"') {
          inQuotes = true;
          continue;
        }
        if (ch === delimiter) {
          out.push(cur.trim());
          cur = "";
          continue;
        }
        cur += ch;
      }
      out.push(cur.trim());
      return out;
    };
    const header = parseLine(lines[0]).map((h) =>
      String(h || "")
        .trim()
        .replace(/^\ufeff/, ""),
    );
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = parseLine(lines[i]);
      if (!parts.some((p) => String(p || "").trim())) continue;
      const obj = {};
      header.forEach((k, idx) => {
        if (!k) return;
        obj[k] = parts[idx] != null ? String(parts[idx]) : "";
      });
      rows.push(obj);
    }
    return rows;
  }
  function coerceBool(v) {
    if (v == null) return null;
    const s = String(v || "")
      .trim()
      .toLowerCase();
    if (!s) return null;
    if (
      s === "1" ||
      s === "true" ||
      s === "yes" ||
      s === "y" ||
      s === "نعم" ||
      s === "صح"
    )
      return true;
    if (
      s === "0" ||
      s === "false" ||
      s === "no" ||
      s === "n" ||
      s === "لا" ||
      s === "خطأ"
    )
      return false;
    return null;
  }
  function normalizeArabicDigitsToLatin(v) {
    const s = String(v || "");
    const map = {
      "٠": "0",
      "١": "1",
      "٢": "2",
      "٣": "3",
      "٤": "4",
      "٥": "5",
      "٦": "6",
      "٧": "7",
      "٨": "8",
      "٩": "9",
      "۰": "0",
      "۱": "1",
      "۲": "2",
      "۳": "3",
      "۴": "4",
      "۵": "5",
      "۶": "6",
      "۷": "7",
      "۸": "8",
      "۹": "9",
    };
    return s.replace(/[٠-٩۰-۹]/g, (ch) => map[ch] || ch);
  }
  function pickRowValue(row, keys) {
    const r = row || {};
    for (let i = 0; i < keys.length; i += 1) {
      const k = keys[i];
      if (!k) continue;
      const v = r[k];
      const s = v != null ? String(v).trim() : "";
      if (s) return s;
    }
    return "";
  }
  function toIntOrNull(v) {
    const s = normalizeArabicDigitsToLatin(String(v || "").trim());
    if (!s) return null;
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : null;
  }
  function toIsoDateOrEmpty(v) {
    const raw = normalizeArabicDigitsToLatin(String(v || "").trim());
    if (!raw) return "";
    const cleaned = raw.replace(/[.\s]+/g, "/");
    let y = null;
    let m = null;
    let d = null;
    let mm = cleaned.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (mm) {
      y = toIntOrNull(mm[1]);
      m = toIntOrNull(mm[2]);
      d = toIntOrNull(mm[3]);
    } else {
      mm = cleaned.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
      if (mm) {
        d = toIntOrNull(mm[1]);
        m = toIntOrNull(mm[2]);
        y = toIntOrNull(mm[3]);
      }
    }
    if (!y || !m || !d) return "";
    if (y < 1800 || y > 2100) return "";
    if (m < 1 || m > 12) return "";
    if (d < 1 || d > 31) return "";
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (
      dt.getUTCFullYear() !== y ||
      dt.getUTCMonth() !== m - 1 ||
      dt.getUTCDate() !== d
    )
      return "";
    const yy = String(y).padStart(4, "0");
    const mm2 = String(m).padStart(2, "0");
    const dd2 = String(d).padStart(2, "0");
    return `${yy}-${mm2}-${dd2}`;
  }
  function chunkArray(arr, size) {
    const n = Math.max(1, Number(size || 1));
    const out = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  }
      function formatDateTimeArSaVerbose(v) {
    if (!v) return "";
    let date;
    if (v instanceof Date) date = v;
    else date = new Date(v);
    if (!date || !Number.isFinite(date.getTime())) return String(v || "");
    let s = "";
    try {
      s = date.toLocaleString("ar-SA");
    } catch (e) {
      s = String(v || "");
    }
    s = String(s || "").trim();
    if (!s) return "";
    s = s.replace(/\s*(AM|am)\s*$/, " صباحاً");
    s = s.replace(/\s*(PM|pm)\s*$/, " مساءً");
    s = s.replace(/\s*ص\s*$/, " صباحاً");
    s = s.replace(/\s*م\s*$/, " مساءً");
    return s;
  }
  async function seedAuditEmailKey() {
    const sb = getClient();
    if (!sb) return;
    const token = getAdminToken();
    if (!token) return;
    const fetchOne = async (kind) => {
      const { data, error } = await sb.rpc("admin_list_requests", {
        p_token: token,
        p_status: "approved",
        p_kind: kind,
        p_limit: 1,
      });
      if (error) return null;
      const list = Array.isArray(data) ? data : [];
      return list && list[0] ? list[0] : null;
    };
    const a = await fetchOne("tree_audit");
    const b = await fetchOne("events_audit");
    const pickLatest = (x, y) => {
      if (!x) return y || null;
      if (!y) return x || null;
      const ax = String(x.created_at || "");
      const ay = String(y.created_at || "");
      if (ay > ax) return y;
      if (ay < ax) return x;
      const ix = Number(x.id || 0);
      const iy = Number(y.id || 0);
      return iy > ix ? y : x;
    };
    const latest = pickLatest(a, b);
    if (!latest) return;
    const key =
      String(latest.kind || "") +
      "|" +
      String(latest.request_id || latest.id || latest.created_at || "");
    if (!key) return;
    lastEmailedAuditKey = key;
    didInitialAuditSync = true;
    try {
      localStorage.setItem(ADMIN_EMAIL_LAST_AUDIT_KEY, key);
    } catch (e) {}
  }
  function hideAlert() {
    if (!alertEl) return;
    alertEl.className = "alert";
    alertEl.textContent = "";
    alertEl.style.display = "none";
  }
  function setStatus(text) {
    if (!sbStatus) return;
    sbStatus.textContent = text || "";
  }
  function setProtectedVisibility(isAuthed) {
    const ok = !!isAuthed;
    document.body.classList.toggle("admin-authenticated", ok);
    if (adminCurrentUser) {
      const currentName = String(
        adminUsername && adminUsername.value ? adminUsername.value : "",
      ).trim();
      adminCurrentUser.textContent = ok
        ? "مسجل الدخول: " + (currentName || "الإدارة")
        : "";
    }
    if (adminProtectedInline)
      adminProtectedInline.style.display = ok ? "block" : "none";
    if (adminProtectedSections)
      adminProtectedSections.style.display = ok ? "block" : "none";
    if (adminLockedHint) adminLockedHint.style.display = ok ? "none" : "block";
    if (adminLogoutBtn) adminLogoutBtn.disabled = !ok;
    if (adminRefreshBtn) adminRefreshBtn.disabled = !ok;
    if (adminEnableNotifsBtn) adminEnableNotifsBtn.disabled = !ok;
    if (refreshViewsStatsBtn) refreshViewsStatsBtn.disabled = !ok;
    if (refreshDelegateAuditBtn) refreshDelegateAuditBtn.disabled = !ok;
    if (sourceTreeLoad) sourceTreeLoad.disabled = !ok;
    if (sourceTreeNew) sourceTreeNew.disabled = !ok;
    if (sourceTreeForm)
      Array.from(sourceTreeForm.elements || []).forEach((el) => {
        el.disabled = !ok;
      });
    if (sourceTreeDelete && ok && !(sourceTreeId && sourceTreeId.value))
      sourceTreeDelete.disabled = true;
  }
  function getClient() {
    if (sbClient) return sbClient;

    if (
      window.__alzidanConfig &&
      typeof window.__alzidanConfig.getClient === "function"
    ) {
      const shared = window.__alzidanConfig.getClient();
      if (shared) {
        sbClient = shared;
        window.__alzidanSupabaseClient = shared;
        window.__alzidanالخدمةClient = shared;
        return sbClient;
      }
    }

    if (window.__alzidanSupabaseClient) {
      sbClient = window.__alzidanSupabaseClient;
      window.__alzidanالخدمةClient = sbClient;
      return sbClient;
    }

    if (window.__alzidanالخدمةClient) {
      sbClient = window.__alzidanالخدمةClient;
      window.__alzidanSupabaseClient = sbClient;
      return sbClient;
    }

    const url = String(SUPABASE_URL || "").trim();
    const anonKey = String(SUPABASE_ANON_KEY || "").trim();
    if (!url || !anonKey) return null;
    if (!window.supabase || typeof window.supabase.createClient !== "function")
      return null;

    sbClient = window.supabase.createClient(url, anonKey);
    window.__alzidanSupabaseClient = sbClient;
    window.__alzidanالخدمةClient = sbClient;
    return sbClient;
  }
  function getAdminToken() {
    return String(adminToken || "").trim();
  }
  function setSourceTreeStatus(text) {
    if (sourceTreeStatus) sourceTreeStatus.textContent = String(text || "");
  }
  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
  function getSourceTreeBranch() {
    return (
      normalizeTreeCardText(
        sourceTreeBranch && sourceTreeBranch.value
          ? sourceTreeBranch.value
          : "لاحم",
      ) || "لاحم"
    );
  }
  function sourceTreeRoot(branch) {
    const b = normalizeTreeCardText(branch);
    return b ? b + " بن مطلق بن زيدان" : "";
  }
  function sourceTreeRowPath(row) {
    const rawChild = normalizeTreeCardText(
      row && (row.child_name || row.name) ? row.child_name || row.name : "",
    );
    if (!rawChild) return "";
    if (rawChild.includes("/")) return rawChild;
    const parent = sourceTreeParentPath(row);
    return parent ? parent + "/" + rawChild : rawChild;
  }
  function sourceTreeParentPath(row) {
    return normalizeTreeCardText(
      row && (row.parent_name || row.parent)
        ? row.parent_name || row.parent
        : "",
    );
  }
  function sourceTreeLeaf(path) {
    return relationLeafName(path);
  }
  function sourceTreeSortRows(rows) {
    return (Array.isArray(rows) ? rows.slice() : []).sort((a, b) => {
      const ap = sourceTreeParentPath(a);
      const bp = sourceTreeParentPath(b);
      if (ap !== bp) return ap.localeCompare(bp, "ar");
      const ao = Number(a.birth_order || 0);
      const bo = Number(b.birth_order || 0);
      if (ao && bo && ao !== bo) return ao - bo;
      if (ao && !bo) return -1;
      if (!ao && bo) return 1;
      const ag = String(a.birth_date_g || "");
      const bg = String(b.birth_date_g || "");
      if (ag && bg && ag !== bg) return ag.localeCompare(bg);
      return sourceTreeLeaf(sourceTreeRowPath(a)).localeCompare(
        sourceTreeLeaf(sourceTreeRowPath(b)),
        "ar",
      );
    });
  }
  function sourceTreeParentOfPath(path) {
    const p = normalizeTreeCardText(path || "");
    const idx = p.lastIndexOf("/");
    return idx > 0 ? p.slice(0, idx) : "";
  }
  function sourceTreeDisplayRows() {
    const branch = getSourceTreeBranch();
    const root = sourceTreeRoot(branch);
    const byChildPath = new Map();
    sourceTreeRows.forEach((row) => {
      const child = sourceTreeRowPath(row);
      if (!child) return;
      const existing = byChildPath.get(child);
      if (!existing || (row.id && !existing.id)) byChildPath.set(child, row);
    });
    sourceTreeRows.forEach((row) => {
      let parent = sourceTreeParentPath(row);
      while (parent && parent !== root) {
        if (!byChildPath.has(parent)) {
          const grandParent = sourceTreeParentOfPath(parent) || root;
          byChildPath.set(parent, {
            _virtual: true,
            branch_key: branch,
            parent_name: grandParent,
            parent: grandParent,
            child_name: parent,
            name: parent,
            birth_order: null,
          });
        }
        parent = sourceTreeParentOfPath(parent);
      }
    });
    return sourceTreeSortRows(Array.from(byChildPath.values()));
  }
  function sourceTreeChildrenCount(row) {
    const childPath = sourceTreeRowPath(row);
    const personId = normalizeTreeCardText(
      row && row.person_id ? row.person_id : "",
    );
    return sourceTreeRows.filter((x) => {
      const parentId = normalizeTreeCardText(
        x && x.parent_person_id ? x.parent_person_id : "",
      );
      if (personId && parentId && parentId === personId) return true;
      return sourceTreeParentPath(x) === childPath;
    }).length;
  }
  function refreshSourceTreeParentOptions(selectedValue) {
    if (!sourceTreeParent) return;
    const branch = getSourceTreeBranch();
    const root = sourceTreeRoot(branch);
    const current = normalizeTreeCardText(
      selectedValue || sourceTreeParent.value || root,
    );
    const paths = new Map();
    if (root) paths.set(root, root);
    sourceTreeDisplayRows().forEach((row) => {
      const child = sourceTreeRowPath(row);
      if (child) paths.set(child, child);
    });
    sourceTreeParent.innerHTML = "";
    paths.forEach((path) => {
      const option = document.createElement("option");
      option.value = path;
      option.textContent = relationPathLabel(path);
      sourceTreeParent.appendChild(option);
    });
    if (current && !paths.has(current)) {
      const option = document.createElement("option");
      option.value = current;
      option.textContent = relationPathLabel(current);
      sourceTreeParent.appendChild(option);
    }
    sourceTreeParent.value = current || root || "";
  }
  function resetSourceTreeForm(parentValue) {
    if (sourceTreeId) sourceTreeId.value = "";
    if (sourceTreePersonId) sourceTreePersonId.value = "";
    refreshSourceTreeParentOptions(
      parentValue || sourceTreeRoot(getSourceTreeBranch()),
    );
    if (sourceTreeName) sourceTreeName.value = "";
    if (sourceTreeOrder) sourceTreeOrder.value = "";
    if (sourceTreeBirthG) sourceTreeBirthG.value = "";
    if (sourceTreeBirthH) sourceTreeBirthH.value = "";
    if (sourceTreeAge) sourceTreeAge.value = "";
    if (sourceTreeDeathG) sourceTreeDeathG.value = "";
    if (sourceTreeDeathH) sourceTreeDeathH.value = "";
    if (sourceTreeCity) sourceTreeCity.value = "";
    if (sourceTreeArea) sourceTreeArea.value = "";
    if (sourceTreeDeceased) sourceTreeDeceased.checked = false;
    if (sourceTreeDelete) sourceTreeDelete.disabled = true;
    setSourceTreeStatus("وضع إضافة شخص جديد.");
  }
  function fillSourceTreeForm(row) {
    clearSourceTreeExtraChildren();
    if (!row) return resetSourceTreeForm();
    const parent = sourceTreeParentPath(row);
    const child = sourceTreeRowPath(row);
    if (sourceTreeId) sourceTreeId.value = String(row.id || "");
    if (sourceTreePersonId)
      sourceTreePersonId.value = String(row.person_id || "");
    refreshSourceTreeParentOptions(parent);
    if (sourceTreeName) sourceTreeName.value = sourceTreeLeaf(child);
    if (sourceTreeOrder)
      sourceTreeOrder.value =
        row.birth_order == null ? "" : String(row.birth_order || "");
    if (sourceTreeBirthG)
      sourceTreeBirthG.value = String(row.birth_date_g || "").slice(0, 10);
    if (sourceTreeBirthH)
      sourceTreeBirthH.value = String(row.birth_date_h || "");
    if (sourceTreeDeathG)
      sourceTreeDeathG.value = String(row.death_date_g || "").slice(0, 10);
    if (sourceTreeDeathH)
      sourceTreeDeathH.value = String(row.death_date_h || "");
    if (sourceTreeCity) sourceTreeCity.value = String(row.city || "");
    if (sourceTreeArea) sourceTreeArea.value = String(row.area || "");
    if (sourceTreeDeceased)
      sourceTreeDeceased.checked = !!(row.is_deceased || row.deceased);
    if (sourceTreeDelete) sourceTreeDelete.disabled = !row.id;
    setSourceTreeStatus("تعديل: " + relationPathLabel(child));
  }
  function selectSourceTreeRow(row, itemEl) {
    if (sourceTreeList)
      sourceTreeList
        .querySelectorAll(".source-tree-item")
        .forEach((x) => x.classList.remove("active"));
    if (itemEl) itemEl.classList.add("active");
    fillSourceTreeForm(row);
  }
  function startAddSourceTreeChild(row) {
    const child = sourceTreeRowPath(row);
    resetSourceTreeForm(child || sourceTreeRoot(getSourceTreeBranch()));
    setSourceTreeStatus("إضافة ابن تحت: " + relationPathLabel(child));
    if (sourceTreeName) sourceTreeName.focus();
  }
  function renderSourceTreeList() {
    if (!sourceTreeList) return;
    sourceTreeList.innerHTML = "";
    const rows = sourceTreeDisplayRows();
    if (!rows.length) {
      sourceTreeList.innerHTML =
        '<div class="hint">لا توجد بيانات لهذا الفرع بعد.</div>';
      return;
    }
    rows.forEach((row) => {
      const item = document.createElement("div");
      item.className = "source-tree-item";
      item.dataset.id = String(row.id || "");
      const child = sourceTreeRowPath(row);
      const parent = sourceTreeParentPath(row);
      const childrenCount = sourceTreeChildrenCount(row);
      const isVirtual = !!row._virtual;
      item.innerHTML = `<div class="source-tree-item-title">${escapeHtml(sourceTreeLeaf(child) || child)}</div><div class="source-tree-item-meta">الأب: ${escapeHtml(sourceTreeLeaf(parent) || parent || "-")} · الأبناء: ${childrenCount}${row.birth_order ? " · الترتيب: " + escapeHtml(row.birth_order) : ""}${isVirtual ? " · مستنتج من المسار" : ""}</div><div class="source-tree-item-actions"><button class="btn btn-outline btn-sm" type="button" data-source-tree-edit>تعديل</button><button class="btn btn-primary btn-sm" type="button" data-source-tree-add-child>إضافة ابن</button></div>`;
      const editBtn = item.querySelector("[data-source-tree-edit]");
      const addChildBtn = item.querySelector("[data-source-tree-add-child]");
      if (editBtn)
        editBtn.addEventListener("click", () => selectSourceTreeRow(row, item));
      if (addChildBtn)
        addChildBtn.addEventListener("click", () =>
          startAddSourceTreeChild(row),
        );
      item.addEventListener("dblclick", () => selectSourceTreeRow(row, item));
      sourceTreeList.appendChild(item);
    });
  }
  async function loadSourceTreeRows() {
    const sb = getClient();
    const token = getAdminToken();
    if (!sb || !token) {
      setSourceTreeStatus("سجل الدخول أولًا.");
      return;
    }
    const branch = getSourceTreeBranch();
    setSourceTreeStatus("جاري تحميل الشجرة...");
    const fields = [
      "id,person_id,parent_person_id,branch_key,parent_name,parent,child_name,name,birth_date_g,birth_date_h,birth_year,birth_order,death_date_g,death_date_h,city,area,is_deceased,deceased,created_at",
      "id,person_id,parent_person_id,branch_key,parent_name,parent,child_name,name,birth_date_g,birth_date_h,birth_year,birth_order,city,area,is_deceased,deceased,created_at",
      "id,branch_key,parent_name,parent,child_name,name,birth_date_g,birth_date_h,birth_year,birth_order,city,area,is_deceased,deceased,created_at",
    ];
    let lastError = null;
    for (const f of fields) {
      const { data, error } = await sb
        .from("tree_children")
        .select(f)
        .eq("branch_key", branch)
        .limit(3000);
      if (!error) {
        sourceTreeRows = Array.isArray(data) ? data : [];
        renderSourceTreeList();
        resetSourceTreeForm(sourceTreeRoot(branch));
        setSourceTreeStatus("تم تحميل " + sourceTreeRows.length + " علاقة.");
        return;
      }
      lastError = error;
      const msg = String(error.message || "").toLowerCase();
      if (!(msg.includes("column") && msg.includes("does not exist"))) break;
    }
    sourceTreeRows = [];
    renderSourceTreeList();
    setSourceTreeStatus(
      "تعذر تحميل الشجرة حالياً، حاول لاحقاً أو تواصل مع الإدارة.",
    );
  }
  function sourceTreeCurrentYear() {
    return new Date().getFullYear();
  }
  function normalizeSourceTreeNumber(value) {
    return String(value || "")
      .replace(/[٠-٩۰-۹]/g, (digit) => {
        const code = digit.charCodeAt(0);
        const arabicZero = "٠".charCodeAt(0);
        const persianZero = "۰".charCodeAt(0);
        return String(
          code >= persianZero ? code - persianZero : code - arabicZero,
        );
      })
      .replace(/[^0-9]/g, "");
  }
  function hijriYearToApproxGregorian(hijriYear) {
    const y = Number(hijriYear);
    if (!Number.isFinite(y) || y < 1200 || y > 1700) return null;
    return Math.round(y * 0.970224 + 621.5774);
  }
  function getYearFromDateValue(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const normalized = normalizeSourceTreeNumber(raw);
    const match = normalized.match(/(13|14|15|19|20)\d{2}/);
    if (!match) return null;
    return Number(match[0]);
  }
  function getReferenceYearForApproxAge() {
    const deathGregorianYear = getYearFromDateValue(
      sourceTreeDeathG && sourceTreeDeathG.value ? sourceTreeDeathG.value : "",
    );
    if (deathGregorianYear) return deathGregorianYear;
    const deathHijriYear = getYearFromDateValue(
      sourceTreeDeathH && sourceTreeDeathH.value ? sourceTreeDeathH.value : "",
    );
    const approxGregorian = deathHijriYear
      ? hijriYearToApproxGregorian(deathHijriYear)
      : null;
    if (approxGregorian) return approxGregorian;
    return sourceTreeCurrentYear();
  }
  function birthYearFromApproxAge() {
    const raw = normalizeSourceTreeNumber(
      sourceTreeAge && sourceTreeAge.value ? sourceTreeAge.value : "",
    );
    if (!raw) return "";
    const age = Number(raw);
    if (!Number.isFinite(age) || age < 0 || age > 130) return "";
    const deathHijriYear = getYearFromDateValue(
      sourceTreeDeathH && sourceTreeDeathH.value ? sourceTreeDeathH.value : "",
    );
    if (deathHijriYear) return String(deathHijriYear - age);
    return String(getReferenceYearForApproxAge() - age);
  }
  function approxAgeFromBirthYear(yearValue) {
    const year = Number(normalizeSourceTreeNumber(yearValue));
    if (!Number.isFinite(year) || year < 1800) return "";
    const age = sourceTreeCurrentYear() - year;
    if (!Number.isFinite(age) || age < 0 || age > 130) return "";
    return String(age);
  }
  function clearSourceTreeExtraChildren() {
    if (sourceTreeExtraChildren) sourceTreeExtraChildren.innerHTML = "";
  }
  function nextSourceTreeOrderValue() {
    const first = Number(
      sourceTreeOrder && sourceTreeOrder.value ? sourceTreeOrder.value : 1,
    );
    const base = Number.isFinite(first) && first > 0 ? first : 1;
    const count = sourceTreeExtraChildren
      ? sourceTreeExtraChildren.querySelectorAll("[data-extra-child-row]")
          .length
      : 0;
    return base + count + 1;
  }
  function addSourceTreeExtraChildField(value) {
    if (!sourceTreeExtraChildren) return;
    const row = document.createElement("div");
    row.setAttribute("data-extra-child-row", "1");
    row.style.display = "grid";
    row.style.gridTemplateColumns = "minmax(0, 1fr) 120px auto";
    row.style.gap = "8px";
    row.style.alignItems = "end";
    row.innerHTML =
      '<div class="field"><label>اسم ابن إضافي</label><input data-extra-child-name type="text" placeholder="اسم الابن" value="' +
      escapeHtml(value || "") +
      '" /></div>' +
      '<div class="field"><label>الترتيب</label><input data-extra-child-order type="number" min="1" inputmode="numeric" value="' +
      String(nextSourceTreeOrderValue()) +
      '" /></div>' +
      '<button class="btn btn-outline btn-sm" type="button" data-extra-child-remove>حذف الخانة</button>';
    const remove = row.querySelector("[data-extra-child-remove]");
    if (remove) remove.addEventListener("click", () => row.remove());
    sourceTreeExtraChildren.appendChild(row);
  }
  function getSourceTreeExtraChildrenPayloads(basePayload) {
    if (!sourceTreeExtraChildren || !basePayload) return [];
    const rows = Array.from(
      sourceTreeExtraChildren.querySelectorAll("[data-extra-child-row]"),
    );
    return rows
      .map((row) => {
        const nameEl = row.querySelector("[data-extra-child-name]");
        const orderEl = row.querySelector("[data-extra-child-order]");
        const name = normalizeTreeCardText(
          nameEl && nameEl.value ? nameEl.value : "",
        );
        if (!name) return null;
        const child = name.includes("/")
          ? name
          : basePayload.parent_name + "/" + name;
        return Object.assign({}, basePayload, {
          id: "",
          person_id: "",
          child_name: child,
          birth_order: orderEl && orderEl.value ? String(orderEl.value) : "",
        });
      })
      .filter(Boolean);
  }

  /* BIRTH_DEATH_NORMALIZE_ENGINE_V1 */
  function birthPad2(n) {
    return String(n).padStart(2, "0");
  }

  function normalizeDateDigitsOnly(value) {
    return String(value || "")
      .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
      .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
      .trim();
  }

  function parseGregorianISO(value) {
    if (value instanceof Date && Number.isFinite(value.getTime())) return value;

    const raw = normalizeDateDigitsOnly(value);
    const m = raw.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
    if (!m) return null;

    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);

    if (y < 1800 || y > 2200 || mo < 1 || mo > 12 || d < 1 || d > 31)
      return null;

    const date = new Date(y, mo - 1, d);
    if (!Number.isFinite(date.getTime())) return null;

    if (
      date.getFullYear() !== y ||
      date.getMonth() !== mo - 1 ||
      date.getDate() !== d
    )
      return null;

    return date;
  }

  function gregorianDateToISO(date) {
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return "";
    return (
      date.getFullYear() +
      "-" +
      birthPad2(date.getMonth() + 1) +
      "-" +
      birthPad2(date.getDate())
    );
  }

  function parseHijriParts(value) {
    const raw = normalizeDateDigitsOnly(value);
    const parts = raw.split(/\D+/).filter(Boolean).map(Number);
    if (!parts.length) return null;

    let y = null,
      m = 1,
      d = 1,
      full = false;

    if (parts[0] >= 1200 && parts[0] <= 1700) {
      y = parts[0];
      m = parts[1] || 1;
      d = parts[2] || 1;
      full = parts.length >= 3;
    } else {
      const yi = parts.findIndex((x) => x >= 1200 && x <= 1700);
      if (yi === -1) return null;
      y = parts[yi];
      const before = parts.slice(0, yi);
      if (before.length >= 2) {
        d = before[0];
        m = before[1];
        full = true;
      } else if (before.length === 1) {
        m = before[0];
      }
    }

    if (y < 1200 || y > 1700 || m < 1 || m > 12 || d < 1 || d > 30) return null;
    return { y, m, d, full };
  }

  function hijriToISO(h) {
    if (!h || !h.y) return "";
    return String(h.y) + "-" + birthPad2(h.m || 1) + "-" + birthPad2(h.d || 1);
  }

  function hijriToGregorianISO(value) {
    const h = typeof value === "object" ? value : parseHijriParts(value);
    if (!h || !h.full) return "";

    const jd =
      Math.floor((11 * h.y + 3) / 30) +
      354 * h.y +
      30 * h.m -
      Math.floor((h.m - 1) / 2) +
      h.d +
      1948440 -
      385;

    let l = jd + 68569;
    const n = Math.floor((4 * l) / 146097);
    l = l - Math.floor((146097 * n + 3) / 4);
    const i = Math.floor((4000 * (l + 1)) / 1461001);
    l = l - Math.floor((1461 * i) / 4) + 31;
    const j = Math.floor((80 * l) / 2447);
    const day = l - Math.floor((2447 * j) / 80);
    l = Math.floor(j / 11);
    const month = j + 2 - 12 * l;
    const year = 100 * (n - 49) + i + l;

    return year + "-" + birthPad2(month) + "-" + birthPad2(day);
  }

  function gregorianToHijriISO(value) {
    const date = value instanceof Date ? value : parseGregorianISO(value);
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return "";

    try {
      const parts = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(date);

      const y = parts.find((x) => x.type === "year")?.value;
      const m = parts.find((x) => x.type === "month")?.value;
      const d = parts.find((x) => x.type === "day")?.value;

      if (y && m && d) return y + "-" + m + "-" + d;
    } catch (e) {}

    return "";
  }

  function shiftGregorianYears(date, yearsBack) {
    const d = new Date(date.getTime());
    d.setFullYear(d.getFullYear() - yearsBack);
    return d;
  }

  function normalizeBirthPayload(rawPayload) {
    const payload = Object.assign({}, rawPayload || {});

    function clean(v) {
      return String(v == null ? "" : v).trim();
    }

    let birthG = clean(payload.birth_date_g);
    let birthH = clean(payload.birth_date_h);
    let deathG = clean(payload.death_date_g);
    let deathH = clean(payload.death_date_h);
    const age = Number(
      normalizeDateDigitsOnly(payload._age || "").replace(/[^0-9]/g, ""),
    );
    const isDead = !!(payload.is_deceased || payload.deceased);

    if (deathH && !deathG) {
      const h = parseHijriParts(deathH);
      if (h) {
        deathH = hijriToISO(h);
        deathG = h.full ? hijriToGregorianISO(h) : "";
      }
    }

    if (deathG && !deathH) {
      const d = parseGregorianISO(deathG);
      if (d) {
        deathG = gregorianDateToISO(d);
        deathH = gregorianToHijriISO(d) || "";
      }
    }

    if (birthH && !birthG) {
      const h = parseHijriParts(birthH);
      if (h) {
        birthH = h.full ? hijriToISO(h) : "تقريباً " + String(h.y);
        birthG = h.full ? hijriToGregorianISO(h) : "";
      }
    }

    if (birthG && !birthH) {
      const d = parseGregorianISO(birthG);
      if (d) {
        birthG = gregorianDateToISO(d);
        birthH = gregorianToHijriISO(d) || "";
      }
    }

    if (!birthG && !birthH && Number.isFinite(age) && age > 0 && age <= 130) {
      if (isDead && deathH) {
        const dh = parseHijriParts(deathH);
        if (dh) {
          const bh = {
            y: dh.y - age,
            m: dh.m || 1,
            d: dh.d || 1,
            full: !!dh.full,
          };
          birthH = dh.full ? hijriToISO(bh) : "تقريباً " + String(bh.y);
          birthG = dh.full ? hijriToGregorianISO(bh) : "";
        }
      } else {
        const ref = isDead && deathG ? parseGregorianISO(deathG) : new Date();
        if (ref) {
          const bd = shiftGregorianYears(ref, age);
          birthG = gregorianDateToISO(bd);
          birthH = gregorianToHijriISO(bd) || "";
        }
      }
    }

    payload.birth_date_g = birthG || "";
    payload.birth_date_h = birthH || "";
    payload.death_date_g = deathG || "";
    payload.death_date_h = deathH || "";

    if (birthH) {
      const h = parseHijriParts(birthH);
      payload.birth_year = h && h.y ? String(h.y) : "";
    } else if (birthG) {
      const hText = gregorianToHijriISO(birthG);
      const h = parseHijriParts(hText);
      payload.birth_year = h && h.y ? String(h.y) : "";
    } else {
      payload.birth_year = clean(payload.birth_year);
    }

    delete payload._age;
    return payload;
  }

  function buildSourceTreePayload() {
    const branch = getSourceTreeBranch();
    const parent = normalizeTreeCardText(
      sourceTreeParent && sourceTreeParent.value ? sourceTreeParent.value : "",
    );
    const name = normalizeTreeCardText(
      sourceTreeName && sourceTreeName.value ? sourceTreeName.value : "",
    );

    if (!branch || !parent || !name) return null;

    const child = name.includes("/") ? name : parent + "/" + name;

    const rawPayload = {
      id: sourceTreeId && sourceTreeId.value ? sourceTreeId.value : "",
      person_id:
        sourceTreePersonId && sourceTreePersonId.value
          ? sourceTreePersonId.value
          : "",
      branch_key: branch,
      parent_name: parent,
      child_name: child,
      birth_date_g:
        sourceTreeBirthG && sourceTreeBirthG.value
          ? sourceTreeBirthG.value
          : "",
      birth_date_h:
        sourceTreeBirthH && sourceTreeBirthH.value
          ? normalizeTreeCardText(sourceTreeBirthH.value)
          : "",
      birth_year: "",
      birth_order:
        sourceTreeOrder && sourceTreeOrder.value
          ? String(sourceTreeOrder.value)
          : "",
      death_date_g:
        sourceTreeDeathG && sourceTreeDeathG.value
          ? sourceTreeDeathG.value
          : "",
      death_date_h:
        sourceTreeDeathH && sourceTreeDeathH.value
          ? normalizeTreeCardText(sourceTreeDeathH.value)
          : "",
      city:
        sourceTreeCity && sourceTreeCity.value
          ? normalizeTreeCardText(sourceTreeCity.value)
          : "",
      area:
        sourceTreeArea && sourceTreeArea.value
          ? normalizeTreeCardText(sourceTreeArea.value)
          : "",
      is_deceased: !!(sourceTreeDeceased && sourceTreeDeceased.checked),
      deceased: !!(sourceTreeDeceased && sourceTreeDeceased.checked),
      _age: sourceTreeAge && sourceTreeAge.value ? sourceTreeAge.value : "",
    };

    return normalizeBirthPayload(rawPayload);
  }
  async function saveSourceTreeRow(event) {
    if (event) event.preventDefault();
    const sb = getClient();
    const token = getAdminToken();
    const payload = buildSourceTreePayload();
    if (!sb || !token) return setSourceTreeStatus("سجل الدخول أولًا.");
    if (!payload) return setSourceTreeStatus("أكمل الأب والاسم.");
    const extraPayloads = getSourceTreeExtraChildrenPayloads(payload);
    const payloads = [payload].concat(extraPayloads);
    setSourceTreeStatus("جاري الحفظ...");
    let saved = 0;
    for (const rowPayload of payloads) {
      const { data, error } = await sb.rpc("admin_tree_child_upsert_v1", {
        p_token: token,
        p_row: rowPayload,
      });
      if (error) {
        const rawMsg = JSON.stringify(
          {
            code: error.code || "",
            message: error.message || "",
            details: error.details || "",
            hint: error.hint || "",
          },
          null,
          2,
        );
        try {
          console.error("SOURCE_TREE_SAVE_ERROR", error, rowPayload);
        } catch (_) {}
        setSourceTreeStatus(
          "تعذر الحفظ: " +
            String(rowPayload.child_name || rowPayload.name || "") +
            " — تفاصيل الخطأ: " +
            rawMsg,
        );
        return;
      }
      saved += 1;
    }
    clearSourceTreeExtraChildren();
    setSourceTreeStatus("تم الحفظ. عدد السجلات: " + String(saved));
    await loadSourceTreeRows();
  }
  async function deleteSourceTreeSubtree() {
    const sb = getClient();
    const token = getAdminToken();
    const branch = getSourceTreeBranch();
    const id = Number(
      sourceTreeId && sourceTreeId.value ? sourceTreeId.value : 0,
    );
    const name = normalizeTreeCardText(
      sourceTreeName && sourceTreeName.value ? sourceTreeName.value : "",
    );
    if (!sb || !token) return setSourceTreeStatus("سجل الدخول أولًا.");
    if (!id) return setSourceTreeStatus("اختر شخصًا من القائمة أولًا.");
    const ok = window.confirm(
      "سيتم حذف «" + name + "» وكل من تحته من الشجرة. هل أنت متأكد؟",
    );
    if (!ok) return;
    setSourceTreeStatus("جاري الحذف...");
    const { data, error } = await sb.rpc("admin_tree_child_delete_subtree_v1", {
      p_token: token,
      p_branch_key: branch,
      p_id: id,
    });
    if (error) {
      const msg = formatRpcError(error);
      const missing =
        msg.toLowerCase().includes("could not find the function") ||
        msg.toLowerCase().includes("does not exist") ||
        String(error.code || "").toLowerCase() === "pgrst202";
      setSourceTreeStatus(
        missing
          ? "الدالة غير ظاهرة لـ الخدمة بعد التهيئة. حاول تحديث الصفحة، أو تواصل مع الإدارة." +
              msg
          : "تعذر الحذف: " + msg,
      );
      return;
    }
    setSourceTreeStatus("تم حذف " + String(data || 0) + " سجل.");
    await loadSourceTreeRows();
  }
  function setEventsSourceStatus(message) {
    if (eventsSourceStatus) eventsSourceStatus.textContent = message || "";
  }
  function eventTypeLabel(type) {
    const map = {
      happy: "فرح",
      death: "وفاة",
      sick: "مريض",
      birth: "مولود",
      graduation: "تخرج",
      promotion: "ترقية",
      meeting: "اجتماع",
      other: "أخرى",
    };
    return map[type] || type || "مناسبة";
  }
  function renderEventsSourceList() {
    if (!eventsSourceList) return;
    eventsSourceList.innerHTML = "";
    if (!eventsSourceRows.length) {
      eventsSourceList.innerHTML =
        '<div class="hint">لا توجد أخبار أو مناسبات محملة.</div>';
      return;
    }
    eventsSourceRows.forEach((row) => {
      const card = document.createElement("div");
      card.className = "source-tree-item";
      card.innerHTML =
        "<strong>" +
        escapeHtml(getEventCleanTitle(row)) +
        "</strong>" +
        '<div class="hint">' +
        escapeHtml(eventTypeLabel(row.type)) +
        " · " +
        escapeHtml(row.branch_key || "") +
        " · " +
        escapeHtml(row.created_at ? String(row.created_at).slice(0, 10) : "") +
        "</div>" +
        '<div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">' +
        '<button class="btn btn-outline btn-sm" type="button">تعديل</button>' +
        "</div>";
      const btn = card.querySelector("button");
      if (btn) btn.addEventListener("click", () => fillEventsSourceForm(row));
      eventsSourceList.appendChild(card);
    });
  }
  function parseEventDetailsClean(value) {
    if (!value) return {};
    if (typeof value === "object") return value;
    try {
      const parsed = JSON.parse(String(value));
      return parsed && typeof parsed === "object"
        ? parsed
        : { text: String(value || "") };
    } catch (e) {
      return { text: String(value || "") };
    }
  }
  function getEventCleanText(row) {
    const details = parseEventDetailsClean(row && row.details);
    return String(details.text || details.extra || details.notes || "");
  }
  function getEventCleanTitle(row) {
    const details = parseEventDetailsClean(row && row.details);
    return String(
      details.title || row.person || getEventCleanText(row) || "بدون عنوان",
    );
  }
  function eventSourceTypeLabel(type) {
    const map = {
      birth: "عقيقة مولود",
      marriage: "زواج",
      graduation: "حفل تخرج",
      promotion: "حفل ترقية",
      new_house: "منزل جديد",
      gathering: "اجتماع عائلي",
      general: "مناسبة عامة",
      sick: "مريض",
      operation: "عملية",
      death: "وفاة",
      happy: "فرح",
      meeting: "اجتماع",
      other: "أخرى",
    };
    return map[type] || type || "أخرى";
  }
  function setBannerGeneralStatus(message) {
    if (bannerGeneralStatus) bannerGeneralStatus.textContent = message || "";
  }
  function clampShowDays(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 7;
    if (n < 1) return 1;
    if (n > 7) return 7;
    return Math.round(n);
  }
  async function publishBannerGeneralNews(event) {
    if (event) event.preventDefault();
    const sb = getClient();
    const token = getAdminToken();
    if (!sb || !token) return setBannerGeneralStatus("سجل الدخول أولاً.");
    const text =
      bannerGeneralText && bannerGeneralText.value
        ? bannerGeneralText.value.trim()
        : "";
    const branch =
      bannerGeneralBranch && bannerGeneralBranch.value
        ? bannerGeneralBranch.value
        : "زيدان";
    const showDays = clampShowDays(
      bannerGeneralShowDays && bannerGeneralShowDays.value
        ? bannerGeneralShowDays.value
        : 7,
    );
    if (!text) return setBannerGeneralStatus("اكتب نص الخبر العام أولاً.");
    const details = { v: 1, kind: "general_notice", text, showDays };
    setBannerGeneralStatus("جاري نشر الخبر العام...");
    const { data, error } = await sb.rpc("admin_banner_message_create_v1", {
      p_token: token,
      p_branch_key: branch,
      p_message: text,
      p_show_days: showDays,
    });
    if (error) {
      setBannerGeneralStatus(
        "تعذر نشر الخبر العام، حاول لاحقاً أو تواصل مع الإدارة.",
      );
      return;
    }
    const verify = await sb
      .from("banner_messages")
      .select("id,message,created_at")
      .order("created_at", { ascending: false })
      .limit(1);
    if (bannerGeneralText) bannerGeneralText.value = "";
    if (verify && verify.data && verify.data[0]) {
      setBannerGeneralStatus(
        "تم نشر الخبر العام. آخر سجل: #" +
          verify.data[0].id +
          " — " +
          verify.data[0].message,
      );
    } else {
      setBannerGeneralStatus(
        "تم تنفيذ الطلب، لكن لم أجد سجلاً جديداً في banner_messages.",
      );
    }
    if (typeof loadBannerMessagesRows === "function")
      await loadBannerMessagesRows();
    if (typeof loadEventsSourceRows === "function")
      await loadEventsSourceRows();
  }
  function clearBannerGeneralForm() {
    if (bannerGeneralText) bannerGeneralText.value = "";
    if (bannerGeneralShowDays) bannerGeneralShowDays.value = "7";
    setBannerGeneralStatus("");
  }
  function setBannerMessagesStatus(message) {
    if (bannerMessagesStatus) bannerMessagesStatus.textContent = message || "";
  }
  function resetBannerMessagesForm() {
    if (bannerMessagesId) bannerMessagesId.value = "";
    if (bannerMessagesBranch) bannerMessagesBranch.value = "زيدان";
    if (bannerMessagesShowDays) bannerMessagesShowDays.value = "7";
    if (bannerMessagesActive) bannerMessagesActive.checked = true;
    if (bannerMessagesText) bannerMessagesText.value = "";
    setBannerMessagesStatus("");
  }
  function renderBannerMessagesList() {
    if (!bannerMessagesList) return;
    bannerMessagesList.innerHTML = "";
    if (!bannerMessagesRows.length) {
      bannerMessagesList.innerHTML =
        '<div class="hint">لا توجد أخبار عامة محملة.</div>';
      return;
    }
    bannerMessagesRows.forEach((row) => {
      const card = document.createElement("div");
      card.className = "source-tree-item";
      const title = String(row.message || "بدون نص");
      const shortTitle = title.length > 80 ? title.slice(0, 80) + "..." : title;
      card.innerHTML =
        "<strong>#" +
        escapeHtml(row.id) +
        " — " +
        escapeHtml(shortTitle) +
        "</strong>" +
        '<div class="hint">' +
        escapeHtml(row.branch_key || "") +
        " · " +
        escapeHtml(row.is_active === false ? "غير مفعل" : "مفعل") +
        " · " +
        escapeHtml((row.show_days || 7) + " أيام") +
        " · " +
        escapeHtml(row.created_at ? String(row.created_at).slice(0, 10) : "") +
        "</div>" +
        '<div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">' +
        '<button class="btn btn-outline btn-sm" type="button">تعديل</button>' +
        "</div>";
      const btn = card.querySelector("button");
      if (btn) btn.addEventListener("click", () => fillBannerMessagesForm(row));
      bannerMessagesList.appendChild(card);
    });
  }
  async function loadBannerMessagesRows() {
    const sb = getClient();
    if (!sb)
      return setBannerMessagesStatus(
        "تعذر الاتصال، حاول لاحقاً أو تواصل مع الإدارة..",
      );
    setBannerMessagesStatus("جاري تحميل الأخبار العامة...");
    const { data, error } = await sb
      .from("banner_messages")
      .select("id,branch_key,message,show_days,is_active,created_by,created_at")
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) {
      setBannerMessagesStatus("تعذر التحميل، حاول لاحقاً أو تواصل مع الإدارة.");
      return;
    }
    bannerMessagesRows = Array.isArray(data) ? data : [];
    renderBannerMessagesList();
    setBannerMessagesStatus(
      "تم تحميل " + bannerMessagesRows.length + " خبر عام.",
    );
  }
  function fillBannerMessagesForm(row) {
    if (!row) return;
    if (bannerMessagesId) bannerMessagesId.value = row.id || "";
    if (bannerMessagesBranch)
      bannerMessagesBranch.value = row.branch_key || "زيدان";
    if (bannerMessagesShowDays)
      bannerMessagesShowDays.value = String(clampShowDays(row.show_days || 7));
    if (bannerMessagesActive)
      bannerMessagesActive.checked = row.is_active !== false;
    if (bannerMessagesText) bannerMessagesText.value = row.message || "";
    setBannerMessagesStatus("تعديل الخبر العام رقم #" + (row.id || ""));
  }
  async function saveBannerMessageRow(event) {
    if (event) event.preventDefault();
    const sb = getClient();
    const token = getAdminToken();
    const id = Number(
      bannerMessagesId && bannerMessagesId.value ? bannerMessagesId.value : 0,
    );
    const branch =
      bannerMessagesBranch && bannerMessagesBranch.value
        ? bannerMessagesBranch.value
        : "زيدان";
    const showDays = clampShowDays(
      bannerMessagesShowDays && bannerMessagesShowDays.value
        ? bannerMessagesShowDays.value
        : 7,
    );
    const isActive = bannerMessagesActive
      ? !!bannerMessagesActive.checked
      : true;
    const text =
      bannerMessagesText && bannerMessagesText.value
        ? bannerMessagesText.value.trim()
        : "";
    if (!sb || !token) return setBannerMessagesStatus("سجل الدخول أولاً.");
    if (!id)
      return setBannerMessagesStatus("اختر خبراً عاماً من القائمة أولاً.");
    if (!text) return setBannerMessagesStatus("اكتب نص الخبر العام.");
    setBannerMessagesStatus("جاري حفظ الخبر العام...");
    const { data, error } = await sb.rpc("admin_banner_message_update_v1", {
      p_token: token,
      p_id: id,
      p_branch_key: branch,
      p_message: text,
      p_show_days: showDays,
      p_is_active: isActive,
    });
    if (error) {
      setBannerMessagesStatus("تعذر الحفظ، حاول لاحقاً أو تواصل مع الإدارة.");
      return;
    }
    setBannerMessagesStatus("تم حفظ الخبر العام.");
    await loadBannerMessagesRows();
  }
  async function deleteBannerMessageRow() {
    const sb = getClient();
    const token = getAdminToken();
    const id = Number(
      bannerMessagesId && bannerMessagesId.value ? bannerMessagesId.value : 0,
    );
    if (!sb || !token) return setBannerMessagesStatus("سجل الدخول أولاً.");
    if (!id) return setBannerMessagesStatus("اختر خبراً عاماً أولاً.");
    const ok = window.confirm(
      "سيتم حذف هذا الخبر العام نهائياً. هل أنت متأكد؟",
    );
    if (!ok) return;
    setBannerMessagesStatus("جاري حذف الخبر العام...");
    const { data, error } = await sb.rpc("admin_banner_message_delete_v1", {
      p_token: token,
      p_id: id,
    });
    if (error) {
      setBannerMessagesStatus("تعذر الحذف، حاول لاحقاً أو تواصل مع الإدارة.");
      return;
    }
    resetBannerMessagesForm();
    setBannerMessagesStatus("تم حذف الخبر العام.");
    await loadBannerMessagesRows();
  }
  async function loadTickerSpeedSetting() {
    const sb = getClient();
    if (!sb || !adminTickerSpeed) return;
    const { data, error } = await sb
      .from("site_settings")
      .select("value")
      .eq("key", "ticker_speed_web_seconds")
      .limit(1);
    if (!error && data && data[0] && data[0].value) {
      adminTickerSpeed.value = String(data[0].value);
    }
    const mobileRes = await sb
      .from("site_settings")
      .select("value")
      .eq("key", "ticker_speed_mobile_seconds")
      .limit(1);
    if (
      !mobileRes.error &&
      mobileRes.data &&
      mobileRes.data[0] &&
      mobileRes.data[0].value &&
      adminTickerMobileSpeed
    ) {
      adminTickerMobileSpeed.value = String(mobileRes.data[0].value);
    }
  }
  async function saveTickerSpeedSetting() {
    const sb = getClient();
    const token = getAdminToken();
    const value =
      adminTickerSpeed && adminTickerSpeed.value
        ? adminTickerSpeed.value
        : "50";
    const mobileValue =
      adminTickerMobileSpeed && adminTickerMobileSpeed.value
        ? adminTickerMobileSpeed.value
        : "3";
    if (!sb || !token) return setBannerMessagesStatus("سجل الدخول أولاً.");
    setBannerMessagesStatus("جاري حفظ سرعة الشريط...");
    const { error } = await sb.rpc("admin_site_setting_set_v1", {
      p_token: token,
      p_key: "ticker_speed_web_seconds",
      p_value: value,
    });
    if (error) {
      setBannerMessagesStatus(
        "تعذر حفظ سرعة الويب، حاول لاحقاً أو تواصل مع الإدارة.",
      );
      return;
    }
    const mobileSave = await sb.rpc("admin_site_setting_set_v1", {
      p_token: token,
      p_key: "ticker_speed_mobile_seconds",
      p_value: mobileValue,
    });
    if (mobileSave.error) {
      setBannerMessagesStatus(
        "تعذر حفظ سرعة التطبيق، حاول لاحقاً أو تواصل مع الإدارة.",
      );
      return;
    }
    setBannerMessagesStatus(
      "تم حفظ السرعة: الويب " +
        value +
        " ثانية، التطبيق " +
        mobileValue +
        " ثانية.",
    );
  }
  async function loadEventsSourceRows() {
    const sb = getClient();
    if (!sb)
      return setEventsSourceStatus(
        "تعذر الاتصال، حاول لاحقاً أو تواصل مع الإدارة..",
      );
    setEventsSourceStatus("جاري تحميل الأخبار والمناسبات...");
    const { data, error } = await sb
      .from("family_events")
      .select(
        "id,branch_key,type,person,date_label,event_date,details,hospital_name,hospital_dept,contact_method,contact_phone,visit_date_from,visit_date_to,visit_time_from,visit_time_to,created_at",
      )
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) {
      setEventsSourceStatus("تعذر التحميل، حاول لاحقاً أو تواصل مع الإدارة.");
      return;
    }
    eventsSourceRows = Array.isArray(data) ? data : [];
    renderEventsSourceList();
    setEventsSourceStatus(
      "تم تحميل " + eventsSourceRows.length + " خبر/مناسبة.",
    );
  }
  function fillEventsSourceForm(row) {
    if (!row) return;
    const details = parseEventDetailsClean(row.details);
    if (eventsSourceId) eventsSourceId.value = row.id || "";
    if (eventsSourceBranch)
      eventsSourceBranch.value = row.branch_key || "زيدان";
    if (eventsSourceType) eventsSourceType.value = row.type || "general";
    if (eventsSourcePerson) eventsSourcePerson.value = row.person || "";
    if (eventsSourceTitle) eventsSourceTitle.value = row.date_label || "";
    if (eventsSourceGregorian)
      eventsSourceGregorian.value = row.event_date || "";
    if (eventsSourceText)
      eventsSourceText.value =
        details.text || details.extra || details.notes || "";
    if (eventsSourceImage)
      eventsSourceImage.value =
        details.imageUrl ||
        details.image_url ||
        details.photoUrl ||
        details.photo_url ||
        "";
    if (eventsSourceVideo)
      eventsSourceVideo.value = details.videoUrl || details.video_url || "";
    const adminImageFile = document.getElementById("admin-event-image-file");
    const adminVideoFile = document.getElementById("admin-event-video-file");
    if (adminImageFile) adminImageFile.value = "";
    if (adminVideoFile) adminVideoFile.value = "";
    setEventsSourceStatus(
      "تعديل الخبر: " + (row.person || getEventCleanTitle(row) || row.id),
    );
  }
  function adminEventFileExtFromName(name, fallback) {
    const raw = String(name || "")
      .split("?")[0]
      .trim();
    const m = /\.([a-z0-9]{1,8})$/i.exec(raw);
    return (m ? m[1] : fallback || "bin").toLowerCase();
  }
  function adminEventPublicStorageUrl(path) {
    return (
      String(SUPABASE_URL || "").replace(/\/+$/, "") +
      "/storage/v1/object/public/event-media/" +
      String(path || "")
        .split("/")
        .map(encodeURIComponent)
        .join("/")
    );
  }
  async function uploadAdminEventMedia(sb, file, kind) {
    if (!file) return "";
    const isImage = kind === "image";
    const fallback = isImage ? "jpg" : "mp4";
    const path =
      "admin_" +
      Date.now() +
      "_" +
      Math.random().toString(36).slice(2) +
      "_" +
      kind +
      "." +
      adminEventFileExtFromName(file.name, fallback);
    const { error } = await sb.storage
      .from("event-media")
      .upload(path, file, {
        contentType: file.type || (isImage ? "image/jpeg" : "video/mp4"),
        upsert: false,
      });
    if (error)
      throw new Error(
        "تعذر رفع " +
          (isImage ? "الصورة" : "الفيديو") +
          ": " +
          (error.message || error.error || JSON.stringify(error)),
      );
    return adminEventPublicStorageUrl(path);
  }
  async function enrichAdminEventPayloadWithUploadedMedia(sb, payload) {
    const imageFile = document.getElementById("admin-event-image-file");
    const videoFile = document.getElementById("admin-event-video-file");
    if (!payload || typeof payload !== "object") return payload;
    let details = {};
    try {
      details = payload.details ? JSON.parse(String(payload.details)) : {};
    } catch (e) {
      details = {};
    }
    if (imageFile && imageFile.files && imageFile.files[0])
      details.imageUrl = await uploadAdminEventMedia(
        sb,
        imageFile.files[0],
        "image",
      );
    if (videoFile && videoFile.files && videoFile.files[0])
      details.videoUrl = await uploadAdminEventMedia(
        sb,
        videoFile.files[0],
        "video",
      );
    payload.details = JSON.stringify(details);
    return payload;
  }
  function buildEventsSourcePayload() {
    const id = Number(
      eventsSourceId && eventsSourceId.value ? eventsSourceId.value : 0,
    );
    const selected =
      eventsSourceRows.find((item) => Number(item.id) === id) || {};
    const oldDetails = parseEventDetailsClean(selected.details);
    const text =
      eventsSourceText && eventsSourceText.value
        ? eventsSourceText.value.trim()
        : "";
    const imageUrl =
      eventsSourceImage && eventsSourceImage.value
        ? eventsSourceImage.value.trim()
        : "";
    const videoUrl =
      eventsSourceVideo && eventsSourceVideo.value
        ? eventsSourceVideo.value.trim()
        : "";
    const details = {
      ...oldDetails,
      v: oldDetails.v || 1,
      kind: oldDetails.kind || "happy_notice",
      text,
      imageUrl,
      videoUrl,
      showDays: Number(oldDetails.showDays || 7),
    };
    return {
      id,
      branch_key:
        eventsSourceBranch && eventsSourceBranch.value
          ? eventsSourceBranch.value
          : "",
      type:
        eventsSourceType && eventsSourceType.value
          ? eventsSourceType.value
          : "general",
      person:
        eventsSourcePerson && eventsSourcePerson.value
          ? eventsSourcePerson.value.trim()
          : "",
      date_label:
        eventsSourceTitle && eventsSourceTitle.value
          ? eventsSourceTitle.value.trim()
          : "",
      event_date:
        eventsSourceGregorian && eventsSourceGregorian.value
          ? eventsSourceGregorian.value.trim()
          : "",
      details: JSON.stringify(details),
      contact_phone: "",
      contact_method: "",
    };
  }
  async function saveEventsSourceRow(event) {
    if (event) event.preventDefault();
    const sb = getClient();
    const token = getAdminToken();
    let payload = buildEventsSourcePayload();
    if (!sb || !token) return setEventsSourceStatus("سجل الدخول أولاً.");
    if (!payload) return setEventsSourceStatus("اختر خبراً أو مناسبة أولاً.");
    if (!payload.branch_key || !payload.type || !payload.person)
      return setEventsSourceStatus("اختر الفرع والنوع واكتب اسم الشخص أولاً.");
    setEventsSourceStatus("جاري رفع/تعديل الخبر/المناسبة...");
    try {
      payload = await enrichAdminEventPayloadWithUploadedMedia(sb, payload);
    } catch (e) {
      setEventsSourceStatus(e && e.message ? e.message : "تعذر رفع الوسائط.");
      return;
    }
    let data = null;
    let error = null;
    if (payload && Number(payload.id || 0) > 0) {
      const res = await sb.rpc("admin_family_event_save_v1", {
        p_token: token,
        p_row: payload,
      });
      data = res.data || null;
      error = res.error || null;
    } else {
      const res = await sb.rpc("admin_family_event_insert_v1", {
        p_token: token,
        p_row: payload,
      });
      data = res.data || null;
      error = res.error || null;
      if (!error && data && data.id && eventsSourceId)
        eventsSourceId.value = String(data.id);
    }
    if (error) {
      const msg = formatRpcError(error);
      try {
        console.error("ADMIN_EVENT_SAVE_ERROR", error);
      } catch (_) {}
      setEventsSourceStatus("تعذر الحفظ: " + msg);
      return;
    }
    try {
      const d =
        payload && payload.details ? JSON.parse(String(payload.details)) : {};
      const parts = [];
      if (d.imageUrl) parts.push("الصورة مرفوعة");
      if (d.videoUrl) parts.push("الفيديو مرفوع");
      setEventsSourceStatus(
        "تم حفظ الخبر/المناسبة" +
          (parts.length ? " — " + parts.join(" و ") : "") +
          ".",
      );
    } catch (e) {
      setEventsSourceStatus("تم حفظ الخبر/المناسبة.");
    }
    await loadEventsSourceRows();
    try {
      const d =
        payload && payload.details ? JSON.parse(String(payload.details)) : {};
      const parts = [];
      if (d.imageUrl) parts.push("الصورة مرفوعة");
      if (d.videoUrl) parts.push("الفيديو مرفوع");
      if (parts.length)
        setEventsSourceStatus(
          "تم حفظ الخبر/المناسبة — " + parts.join(" و ") + ".",
        );
    } catch (e) {}
  }
  async function deleteEventsSourceRow() {
    const sb = getClient();
    const token = getAdminToken();
    const id = Number(
      eventsSourceId && eventsSourceId.value ? eventsSourceId.value : 0,
    );
    if (!sb || !token) return setEventsSourceStatus("سجل الدخول أولاً.");
    if (!id) return setEventsSourceStatus("اختر خبراً أو مناسبة أولاً.");
    const ok = window.confirm(
      "سيتم حذف هذا الخبر/المناسبة نهائياً . هل أنت متأكد؟",
    );
    if (!ok) return;
    setEventsSourceStatus("جاري الحذف...");
    const { data, error } = await sb.rpc("admin_family_event_delete_v1", {
      p_token: token,
      p_id: id,
    });
    if (error) {
      const msg = formatRpcError(error);
      setEventsSourceStatus("تعذر الحذف، حاول لاحقاً أو تواصل مع الإدارة.");
      return;
    }
    if (eventsSourceId) eventsSourceId.value = "";
    setEventsSourceStatus("تم حذف الخبر/المناسبة .");
    await loadEventsSourceRows();
  }
  function formatRpcError(error) {
    if (!error) return "تعذر تنفيذ العملية، حاول لاحقاً أو تواصل مع الإدارة.";
    console.warn("Admin operation error:", error);
    return "تعذر تنفيذ العملية، حاول لاحقاً أو تواصل مع الإدارة.";
  }

  function tokenFromRpcResult(data) {
    if (!data) return "";
    if (typeof data === "string") return data.trim();
    if (typeof data === "object")
      return String(data.token || data.session_token || "").trim();
    return "";
  }
  async function refreshAuthStatus() {
    const sb = getClient();
    if (!sb) {
      setStatus("الخدمة غير جاهزة حالياً.");
      setProtectedVisibility(false);
      return null;
    }
    const token = getAdminToken();
    setStatus(token ? "" : "غير مسجل الدخول.");
    setProtectedVisibility(!!token);
    return token ? { token } : null;
  }
  async function pollPendingRequestsForNotifications() {
    const sb = getClient();
    if (!sb) return;
    const token = getAdminToken();
    if (!token) return;
    const { data, error } = await sb.rpc("admin_list_requests", {
      p_token: token,
      p_status: "pending",
      p_kind: null,
      p_limit: 20,
    });
    if (error) return;
    const list = Array.isArray(data) ? data : [];
    const newest = list && list[0] ? list[0] : null;
    if (!newest) {
      if (!didInitialPendingSync) didInitialPendingSync = true;
      return;
    }
    const key = String(
      newest.request_id || newest.id || newest.created_at || "",
    ).trim();
    if (!key) return;
    if (!didInitialPendingSync) {
      didInitialPendingSync = true;
      saveLastNotifiedPendingKey(key);
      return;
    }
    if (key === lastNotifiedPendingKey) return;
    saveLastNotifiedPendingKey(key);
    showPendingRequestNotification(newest);
  }
  async function pollAuditForEmailNotifications() {
    const sb = getClient();
    if (!sb) return;
    const token = getAdminToken();
    if (!token) return;
    const fetchOne = async (kind) => {
      const { data, error } = await sb.rpc("admin_list_requests", {
        p_token: token,
        p_status: "approved",
        p_kind: kind,
        p_limit: 1,
      });
      if (error) return null;
      const list = Array.isArray(data) ? data : [];
      return list && list[0] ? list[0] : null;
    };
    const a = await fetchOne("tree_audit");
    const b = await fetchOne("events_audit");
    const pickLatest = (x, y) => {
      if (!x) return y || null;
      if (!y) return x || null;
      const ax = String(x.created_at || "");
      const ay = String(y.created_at || "");
      if (ay > ax) return y;
      if (ay < ax) return x;
      const ix = Number(x.id || 0);
      const iy = Number(y.id || 0);
      return iy > ix ? y : x;
    };
    const latest = pickLatest(a, b);
    if (!latest) return;
    const key =
      String(latest.kind || "") +
      "|" +
      String(latest.request_id || latest.id || latest.created_at || "");
    if (!key) return;
    if (!didInitialAuditSync) {
      didInitialAuditSync = true;
      if (!lastEmailedAuditKey) {
        lastEmailedAuditKey = key;
        try {
          localStorage.setItem(ADMIN_EMAIL_LAST_AUDIT_KEY, key);
        } catch (e) {}
        return;
      }
    }
    if (key === lastEmailedAuditKey) return;
    lastEmailedAuditKey = key;
    try {
      localStorage.setItem(ADMIN_EMAIL_LAST_AUDIT_KEY, key);
    } catch (e) {}
  }
  function startPendingPolling() {
    if (pendingPollTimer) return;
    pendingPollTimer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      pollPendingRequestsForNotifications().catch(() => {});
      pollAuditForEmailNotifications().catch(() => {});
    }, 20000);
  }
  function stopPendingPolling() {
    if (!pendingPollTimer) return;
    clearInterval(pendingPollTimer);
    pendingPollTimer = null;
  }
  function renderEmpty(text) {
    if (!requestsBody) return;
    requestsBody.innerHTML = "";
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 10;
    td.className = "hint";
    td.textContent = text;
    tr.appendChild(td);
    requestsBody.appendChild(tr);
  }
  function statusLabel(status) {
    if (status === "pending") return "انتظار";
    if (status === "approved") return "قبول";
    if (status === "rejected") return "رفض";
    return status || "";
  }
  function coerceRpcId(v) {
    if (v == null) return "";
    if (typeof v === "number" && Number.isFinite(v)) return v;
    const s = String(v || "").trim();
    if (!s) return "";
    if (/^-?\d+$/.test(s)) return s;
    return s;
  }
  if (adminLoginBtn) {
    adminLoginBtn.addEventListener("click", async () => {
      hideAlert();
      const sb = getClient();
      if (!sb) {
        showAlert("error", "تعذر الاتصال.");
        return;
      }
      const username = String(adminUsername?.value || "").trim();
      const password = String(adminPassword?.value || "").trim();
      if (!username || !password) {
        showAlert("error", "يرجى إدخال اسم المستخدم وكلمة المرور.");
        return;
      }
      const { data, error } = await sb.rpc("admin_login", {
        p_username: username,
        p_password: password,
      });
      if (error) {
        showAlert(
          "error",
          "تعذر تسجيل الدخول حالياً، حاول لاحقاً أو تواصل مع الإدارة.",
        );
        return;
      }
      const token = tokenFromRpcResult(data);
      if (!token) {
        showAlert("error", "اسم المستخدم أو كلمة المرور غير صحيحة.");
        return;
      }
      adminToken = token;
      try {
        sessionStorage.setItem(ADMIN_TOKEN_SESSION_KEY, token);
      } catch (e) {}
      try {
        localStorage.setItem(ADMIN_TOKEN_KEY, token);
      } catch (e) {}
      showAlert("success", "");
      await refreshAuthStatus();
      loadTickerSpeedSetting().catch(() => {});
      if (
      window.AlzidanAdminRequests &&
      typeof window.AlzidanAdminRequests.loadRequests === "function"
    ) {
      if (
        window.AlzidanAdminRequests &&
        typeof window.AlzidanAdminRequests.loadRequests === "function"
      ) {
        await window.AlzidanAdminRequests.loadRequests();
      }
    }
      loadSourceTreeRows().catch(() => {});
      if (
        window.AlzidanRequestsStats &&
        typeof window.AlzidanRequestsStats.loadRequestsStats === "function"
      ) {
        window.AlzidanRequestsStats.loadRequestsStats().catch(() => {});
      }
      if (
        window.AlzidanAdminViews &&
        typeof window.AlzidanAdminViews.loadViewsStats === "function"
      )
        window.AlzidanAdminViews.loadViewsStats().catch(() => {});
      pollPendingRequestsForNotifications().catch(() => {});
      startPendingPolling();
    });
  }
  if (adminLogoutBtn) {
    adminLogoutBtn.addEventListener("click", async () => {
      hideAlert();
      adminToken = "";
      try {
        sessionStorage.removeItem(ADMIN_TOKEN_SESSION_KEY);
      } catch (e) {}
      try {
        localStorage.removeItem(ADMIN_TOKEN_KEY);
      } catch (e) {}
      await refreshAuthStatus();
      if (
      window.AlzidanAdminRequests &&
      typeof window.AlzidanAdminRequests.loadRequests === "function"
    ) {
      if (
        window.AlzidanAdminRequests &&
        typeof window.AlzidanAdminRequests.loadRequests === "function"
      ) {
        await window.AlzidanAdminRequests.loadRequests();
      }
    }
      stopPendingPolling();
    });
  }
  if (adminRefreshBtn) {
    adminRefreshBtn.addEventListener("click", async () => {
      hideAlert();
      await refreshAuthStatus();
      if (
      window.AlzidanAdminRequests &&
      typeof window.AlzidanAdminRequests.loadRequests === "function"
    ) {
      if (
        window.AlzidanAdminRequests &&
        typeof window.AlzidanAdminRequests.loadRequests === "function"
      ) {
        await window.AlzidanAdminRequests.loadRequests();
      }
    }
      loadSourceTreeRows().catch(() => {});
      pollPendingRequestsForNotifications().catch(() => {});
    });
  }
  if (adminEnableNotifsBtn) {
    updateNotifsButtonText();
    adminEnableNotifsBtn.addEventListener("click", async () => {
      const ok = await ensureBrowserNotificationsEnabled();
      updateNotifsButtonText();
      if (!ok) return;
      pollPendingRequestsForNotifications().catch(() => {});
    });
  }
  if (adminForgotBtn) {
    adminForgotBtn.addEventListener("click", () => {
      showAlert(
        "error",
        "إذا نسيت كلمة المرور: تواصل مع مدير النظام لإعادة تعيينها.",
      );
    });
  }
  if (filterKind)
    filterKind.addEventListener("change", () => {
      requestsCurrentPage = 1;
      loadRequests();
    });
  if (filterStatus)
    filterStatus.addEventListener("change", () => {
      requestsCurrentPage = 1;
      loadRequests();
    });
  if (requestSearchInput)
    requestSearchInput.addEventListener("input", () => {
      requestsCurrentPage = 1;
      renderRequestsPage();
    });
  if (requestsPageSizeSelect)
    requestsPageSizeSelect.addEventListener("change", () => {
      requestsCurrentPage = 1;
      renderRequestsPage();
    });
  if (requestsPrevPageBtn)
    requestsPrevPageBtn.addEventListener("click", () => {
      requestsCurrentPage -= 1;
      renderRequestsPage();
    });
  if (requestsNextPageBtn)
    requestsNextPageBtn.addEventListener("click", () => {
      requestsCurrentPage += 1;
      renderRequestsPage();
    });
  if (sourceTreeBranch)
    sourceTreeBranch.addEventListener("change", () =>
      loadSourceTreeRows().catch(() => {}),
    );
  if (sourceTreeLoad)
    sourceTreeLoad.addEventListener("click", () =>
      loadSourceTreeRows().catch(() => {}),
    );
  if (sourceTreeNew)
    sourceTreeNew.addEventListener("click", () => resetSourceTreeForm());
  if (sourceTreeAddExtraChild)
    sourceTreeAddExtraChild.addEventListener("click", () =>
      addSourceTreeExtraChildField(""),
    );
  if (sourceTreeForm)
    sourceTreeForm.addEventListener("submit", saveSourceTreeRow);
  if (sourceTreeDelete)
    sourceTreeDelete.addEventListener("click", () =>
      deleteSourceTreeSubtree().catch(() => {}),
    );
  if (eventsSourceLoad)
    eventsSourceLoad.addEventListener("click", () =>
      loadEventsSourceRows().catch(() => {}),
    );
  if (bannerGeneralForm)
    bannerGeneralForm.addEventListener("submit", publishBannerGeneralNews);
  if (bannerGeneralClear)
    bannerGeneralClear.addEventListener("click", clearBannerGeneralForm);
  if (bannerMessagesLoad)
    bannerMessagesLoad.addEventListener("click", () =>
      loadBannerMessagesRows().catch(() => {}),
    );
  if (bannerMessagesNew)
    bannerMessagesNew.addEventListener("click", resetBannerMessagesForm);
  if (bannerMessagesForm)
    bannerMessagesForm.addEventListener("submit", saveBannerMessageRow);
  if (bannerMessagesDelete)
    bannerMessagesDelete.addEventListener("click", () =>
      deleteBannerMessageRow().catch(() => {}),
    );
  if (adminTickerSpeedSave)
    adminTickerSpeedSave.addEventListener("click", () =>
      saveTickerSpeedSetting().catch(() => {}),
    );
  if (eventsSourceForm)
    eventsSourceForm.addEventListener("submit", saveEventsSourceRow);
  if (eventsSourceDelete)
    eventsSourceDelete.addEventListener("click", () =>
      deleteEventsSourceRow().catch(() => {}),
    );
    window.AlzidanAdminCore = {
    showAlert,
    hideAlert,
    copyText,
    downloadTextFile,
    escapeHtml,
    getClient,
    getAdminToken,
    formatDateTimeArSaVerbose,
    kindLabel,
    coerceRpcId,
    normalizeEmail,
    isLikelyEmail,
    normalizeArabicDigitsToLatin,
    toIntOrNull,
    toIsoDateOrEmpty,
    coerceBool,
    parseCsv,
    pickRowValue,
    truncateText,
    takeLines,
    chunkArray,
  };

  if (window.AlzidanRequestActions && typeof window.AlzidanRequestActions.setReloadRequests === "function") {
    window.AlzidanRequestActions.setReloadRequests(() => window.AlzidanAdminRequests.loadRequests());
  }

  (async function init() {
    try {
      adminToken = String(
        sessionStorage.getItem(ADMIN_TOKEN_SESSION_KEY) ||
          localStorage.getItem(ADMIN_TOKEN_KEY) ||
          "",
      ).trim();
    } catch (e) {
      adminToken = "";
    }
    try {
      localStorage.removeItem(ADMIN_TOKEN_KEY);
    } catch (e) {}
    if (adminUsername && !String(adminUsername.value || "").trim()) {
      adminUsername.value = "alshryhy";
    }
    await refreshAuthStatus();
    if (
      window.AlzidanAdminRequests &&
      typeof window.AlzidanAdminRequests.loadRequests === "function"
    ) {
      if (
        window.AlzidanAdminRequests &&
        typeof window.AlzidanAdminRequests.loadRequests === "function"
      ) {
        await window.AlzidanAdminRequests.loadRequests();
      }
    }
    updateNotifsButtonText();
    if (adminToken) {
      if (
        window.AlzidanRequestsStats &&
        typeof window.AlzidanRequestsStats.loadRequestsStats === "function"
      ) {
        window.AlzidanRequestsStats.loadRequestsStats().catch(() => {});
      }
      if (
        window.AlzidanAdminViews &&
        typeof window.AlzidanAdminViews.loadViewsStats === "function"
      )
        window.AlzidanAdminViews.loadViewsStats().catch(() => {});
      loadSourceTreeRows().catch(() => {});
      if (delegateAuditDetails && delegateAuditDetails.open && window.AlzidanDelegateAudit) {
        window.AlzidanDelegateAudit.loadDelegateAudit().catch(() => {});
      }
      pollPendingRequestsForNotifications().catch(() => {});
      startPendingPolling();
    }
  })();
  if (refreshRequestsStatsBtn)
    refreshRequestsStatsBtn.addEventListener("click", () =>
      window.AlzidanRequestsStats.loadRequestsStats().catch(() => {}),
    );
  if (refreshDelegateAuditBtn)
    refreshDelegateAuditBtn.addEventListener("click", () =>
      window.AlzidanDelegateAudit.loadDelegateAudit().catch(() => {}),
    );
  if (delegatePermsTreeBtn)
    delegatePermsTreeBtn.addEventListener("click", () =>
      window.AlzidanDelegateAudit.applyDelegatePermissions("tree").catch(() => {}),
    );
  if (delegatePermsEventsBtn)
    delegatePermsEventsBtn.addEventListener("click", () =>
      window.AlzidanDelegateAudit.applyDelegatePermissions("events").catch(() => {}),
    );
  if (delegatePermsBothBtn)
    delegatePermsBothBtn.addEventListener("click", () =>
      window.AlzidanDelegateAudit.applyDelegatePermissions("both").catch(() => {}),
    );
  if (delegatePermsDisableBtn)
    delegatePermsDisableBtn.addEventListener("click", () =>
      window.AlzidanDelegateAudit.applyDelegatePermissions("disable").catch(() => {}),
    );
  if (delegateDeleteBtn)
    delegateDeleteBtn.addEventListener("click", () =>
      window.AlzidanDelegateAudit.deleteDelegatePermanently().catch(() => {}),
    );
  if (delegateAuditDetails) {
    delegateAuditDetails.addEventListener("toggle", () => {
      if (delegateAuditDetails.open && getAdminToken()) {
        window.AlzidanDelegateAudit.loadDelegateAudit().catch(() => {});
      }
    });
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      if (getAdminToken()) {
        pollPendingRequestsForNotifications().catch(() => {});
        startPendingPolling();
      }
    } else {
      stopPendingPolling();
    }
  });
})();
window.addEventListener("load", () => {
  try {
    if (typeof loadTickerSpeedSetting === "function")
      loadTickerSpeedSetting().catch(() => {});
  } catch (e) {
    console.warn("تعذر تحميل إعداد سرعة الشريط:", e);
  }
});
