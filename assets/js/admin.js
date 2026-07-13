
function reloadAdminRequestsSafe() {
  if (window.AlzidanAdminRequests && typeof window.AlzidanAdminRequests.loadRequests === "function") {
    return window.AlzidanAdminRequests.loadRequests();
  }
  return Promise.resolve();
}


const normalizeTreeCardText = (window.TreeLineage && window.TreeLineage.normalizeTreeCardText) || function (v) {
  return String(v || "").replace(/\s+/g, " ").trim();
};
const relationLeafName = (window.TreeLineage && window.TreeLineage.relationLeafName) || function (path) {
  const parts = String(path || "").split("/").map(normalizeTreeCardText).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
};
const relationPathLabel = (window.TreeLineage && window.TreeLineage.relationPathLabel) || function (path) {
  return String(path || "").split("/").map(normalizeTreeCardText).filter(Boolean).join(" ← ");
};

(function () {
  const SUPABASE_URL = "https://wbskjfdqpugnwvrykqcn.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_JhgwBIXhs6z4yBZOoE2EqA_UlzjzW9c";
  let sbClient = null;
  const Core = window.AlzidanAdminCore || {};
  const normalizeEmail = Core.normalizeEmail;
  const isLikelyEmail = Core.isLikelyEmail;
  const fallbackCopyText = Core.fallbackCopyText;
  const copyText = Core.copyText;
  const downloadTextFile = Core.downloadTextFile;
  const truncateText = Core.truncateText;
  const takeLines = Core.takeLines;
  const coerceBool = Core.coerceBool;
  const normalizeArabicDigitsToLatin = Core.normalizeArabicDigitsToLatin;
  const pickRowValue = Core.pickRowValue;
  const toIntOrNull = Core.toIntOrNull;
  const toIsoDateOrEmpty = Core.toIsoDateOrEmpty;
  const coerceRpcId = Core.coerceRpcId;
  const kindLabel = Core.kindLabel;
  const statusLabel = Core.statusLabel;
  const formatDateTimeArSaVerbose = Core.formatDateTimeArSaVerbose;
  const tokenFromRpcResult = Core.tokenFromRpcResult;
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
  const eventsSourceLoad = document.getElementById("events-source-load");
  const eventsSourceNew = document.getElementById("events-source-new");
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

  const specialCardsLoad = document.getElementById("special-cards-load");
  const specialCardsNew = document.getElementById("special-cards-new");
  const specialCardsList = document.getElementById("special-cards-list");
  const specialCardsForm = document.getElementById("special-cards-form");
  const specialCardsId = document.getElementById("special-cards-id");
  const specialCardsType = document.getElementById("special-cards-type");
  const specialCardsTheme = document.getElementById("special-cards-theme");
  const specialCardsNameEffect = document.getElementById("special-cards-name-effect");
  const specialCardsTitleColor = document.getElementById("special-cards-title-color");
  const specialCardsSubtitleColor = document.getElementById("special-cards-subtitle-color");
  const specialCardsPersonColor = document.getElementById("special-cards-person-color");
  const specialCardsMetaColor = document.getElementById("special-cards-meta-color");
  const specialCardsMessageColor = document.getElementById("special-cards-message-color");
  const specialCardsTitle = document.getElementById("special-cards-title");
  const specialCardsSubtitle = document.getElementById("special-cards-subtitle");
  const specialCardsPerson = document.getElementById("special-cards-person");
  const specialCardsSecondaryPerson = document.getElementById("special-cards-secondary-person");
  const specialCardsEventDate = document.getElementById("special-cards-event-date");
  const specialCardsEventDateHijri = document.getElementById("special-cards-event-date-hijri");
  const specialCardsLocation = document.getElementById("special-cards-location");
  const specialCardsDegree = document.getElementById("special-cards-degree");
  const specialCardsUniversity = document.getElementById("special-cards-university");
  const specialCardsImageFile = document.getElementById("special-cards-image-file");
  const specialCardsImageUrl = document.getElementById("special-cards-image-url");
  const specialCardsBackgroundFile = document.getElementById("special-cards-background-file");
  const specialCardsBackgroundUrl = document.getElementById("special-cards-background-url");
  const specialCardsGroupKey = document.getElementById("special-cards-group-key");
  const specialCardsGroupTitle = document.getElementById("special-cards-group-title");
  const specialCardsPriority = document.getElementById("special-cards-priority");
  const specialCardsSequence = document.getElementById("special-cards-sequence");
  const specialCardsDisplayMode = document.getElementById("special-cards-display-mode");
  const specialCardsMaxSession = document.getElementById("special-cards-max-session");
  const specialCardsStartDate = document.getElementById("special-cards-start-date");
  const specialCardsEndDate = document.getElementById("special-cards-end-date");
  const specialCardsMessage = document.getElementById("special-cards-message");
  const specialCardsActive = document.getElementById("special-cards-active");
  const specialCardsOnceDay = document.getElementById("special-cards-once-day");
  const specialCardsShare = document.getElementById("special-cards-share");
  const specialCardsSave = document.getElementById("special-cards-save");
  const specialCardsGroupCard = document.getElementById("special-cards-group-card");
  const specialCardsDelete = document.getElementById("special-cards-delete");
  const specialCardsStatus = document.getElementById("special-cards-status");
  let specialCardsRows = [];

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
$$; create or replace function public.admin_tree_child_delete_one_v1( p_token text, p_branch_key text, p_id bigint
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare v_deleted bigint := 0;
begin
  if not public.admin_token_ok_v1(p_token) then
    raise exception 'not allowed';
  end if;

  delete from public.tree_children c
  where c.branch_key = p_branch_key
    and c.id = p_id;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
grant execute on function public.admin_tree_child_delete_one_v1(text, text, bigint) to anon, authenticated;
 create or replace function public.admin_tree_child_delete_subtree_v1( p_token text, p_branch_key text, p_id bigint
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
drop function if exists public.delegate_list_event_requests_v1(text, text, text, text);
create or replace function public.delegate_list_event_requests_v1( p_branch_key text, p_phone text, p_email text, p_secret_hash text
) returns setof public.approval_requests
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    public.tree_delegate_allowed_v1(p_branch_key, p_phone, p_email, p_secret_hash)
    or public.events_delegate_allowed_v1(p_branch_key, p_phone, p_email, p_secret_hash)
  ) then
    return;
  end if;
  return query
    select r.*
    from public.approval_requests r
    where r.status = 'pending'
      and r.kind in ('event_card', 'family_event', 'event_request')
      and regexp_replace(btrim(coalesce(r.branch_key, '')), '\s+', ' ', 'g')
        = regexp_replace(btrim(coalesce(p_branch_key, '')), '\s+', ' ', 'g')
    order by r.created_at desc
    limit 100;
end;
$$;
grant execute on function public.delegate_list_event_requests_v1(text, text, text, text) to anon, authenticated;
drop function if exists public.delegate_set_approval_request_status_v1(text, bigint, text);
drop function if exists public.delegate_set_approval_request_status_v1(text, bigint, text, text, text, text);
create or replace function public.delegate_set_approval_request_status_v1( p_branch_key text, p_request_id bigint, p_status text, p_phone text default null, p_email text default null, p_secret_hash text default null
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.approval_requests%rowtype; v_status text;
begin
  if p_phone is not null or p_email is not null or p_secret_hash is not null then
    if not ( public.tree_delegate_allowed_v1(p_branch_key, p_phone, p_email, p_secret_hash) or public.events_delegate_allowed_v1(p_branch_key, p_phone, p_email, p_secret_hash) ) then return false; end if;
  end if;
  v_status := case when lower(btrim(coalesce(p_status, ''))) = 'approved' then 'approved' when lower(btrim(coalesce(p_status, ''))) = 'rejected' then 'rejected' else null end;
  if v_status is null then return false; end if;
  select * into v_row from public.approval_requests r where r.id = p_request_id and r.status = 'pending' and r.kind in ('event_card', 'family_event', 'event_request') and regexp_replace(btrim(coalesce(r.branch_key, '')), '\s+', ' ', 'g') = regexp_replace(btrim(coalesce(p_branch_key, '')), '\s+', ' ', 'g') limit 1;
  if v_row.id is null then return false; end if;
  update public.approval_requests set status = v_status where id = p_request_id;
  return found;
end;
$$;
grant execute on function public.delegate_set_approval_request_status_v1(text, bigint, text, text, text, text) to anon, authenticated;
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
  function chunkArray(arr, size) {
    const n = Math.max(1, Number(size || 1));
    const out = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
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
    if (
      window.AdminFamilyMgmt &&
      typeof window.AdminFamilyMgmt.setProtectedVisibility === "function"
    ) {
      window.AdminFamilyMgmt.setProtectedVisibility(ok);
    }
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
    if (
      window.AlzidanAuth &&
      typeof window.AlzidanAuth.getAdminToken === "function"
    ) {
      return String(window.AlzidanAuth.getAdminToken() || "").trim();
    }
    return String(adminToken || "").trim();
  }
  function setEventsSourceStatus(message) {
    if (eventsSourceStatus) eventsSourceStatus.textContent = message || "";
  }
  function eventTypeLabel(type) {
    const Events = window.AlzidanEvents || {};
    if (typeof Events.eventTypeArabicLabel === "function") {
      return Events.eventTypeArabicLabel(type);
    }
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
    return map[type] || "مناسبة عامة";
  }
  function eventSourceTypeLabel(type) {
    return eventTypeLabel(type);
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

  function setSpecialCardsStatus(message) {
    if (specialCardsStatus) specialCardsStatus.textContent = message || "";
  }

  function specialCardTypeLabel(type) {
    const map = {
      graduation: "تخرج",
      wedding: "زواج",
      birth: "مولود",
      promotion: "ترقية",
      new_house: "منزل جديد",
      honor: "تكريم",
      announcement: "إعلان",
      engagement: "خطوبة",
      excellence: "إنجاز",
      retirement: "تقاعد",
      appreciation: "شكر وتقدير",
    };
    return map[type] || type || "بطاقة";
  }


  function specialCardIcon(type) {
    const map = {
      graduation: "🎓",
      wedding: "💍",
      birth: "👶",
      promotion: "⭐",
      new_house: "🏠",
      honor: "🏅",
      announcement: "📣",
      engagement: "💐",
      excellence: "🏆",
      retirement: "🕊️",
      appreciation: "👏",
    };
    return map[type] || "✨";
  }

  function specialCardNameEffect() {
    return specialCardsNameEffect && specialCardsNameEffect.value
      ? String(specialCardsNameEffect.value).trim()
      : "none";
  }

  function normalizeHexColor(value) {
    const text = String(value || "").trim();
    return /^#[0-9a-fA-F]{6}$/.test(text) ? text.toLowerCase() : "";
  }

  function normalizeArabicDigits(value) {
    return String(value || "")
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632))
      .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776));
  }

  function normalizeHijriInput(value) {
    const raw = normalizeArabicDigits(value)
      .replace(/\s+/g, "")
      .replace(/[^0-9\\\/-]/g, "")
      .replace(/\\/g, "/")
      .trim();
    if (!raw) return "";

    const iso = raw.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
    if (iso) {
      const y = iso[1];
      const m = String(Number(iso[2])).padStart(2, "0");
      const d = String(Number(iso[3])).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }

    const dmy = raw.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
    if (dmy) {
      const d = String(Number(dmy[1])).padStart(2, "0");
      const m = String(Number(dmy[2])).padStart(2, "0");
      const y = dmy[3];
      return `${y}-${m}-${d}`;
    }

    return "";
  }

  function buildSpecialCardTemplateKey(type, effect, colorMap) {
    const base = "luxury_" + String(type || "graduation").trim();
    const fx = String(effect || "none").trim();
    const parts = [base];
    if (fx && fx !== "none") parts.push("fx_" + fx);

    const colors = colorMap || {};
    const title = normalizeHexColor(colors.titleColor);
    const subtitle = normalizeHexColor(colors.subtitleColor);
    const person = normalizeHexColor(colors.personColor);
    const meta = normalizeHexColor(colors.metaColor);
    const message = normalizeHexColor(colors.messageColor);

    if (title) parts.push("ttl_" + title.slice(1));
    if (subtitle) parts.push("sub_" + subtitle.slice(1));
    if (person) parts.push("nam_" + person.slice(1));
    if (meta) parts.push("meta_" + meta.slice(1));
    if (message) parts.push("msg_" + message.slice(1));

    return parts.join("__");
  }

  function parseSpecialCardTemplateMeta(value) {
    const text = String(value || "").trim();
    const meta = {
      effect: "none",
      titleColor: "",
      subtitleColor: "",
      personColor: "",
      metaColor: "",
      messageColor: "",
    };

    const fx = text.match(/__fx_(pulse-ornament|pulse|ornament|none)(?:__|$)/);
    if (fx) meta.effect = fx[1];

    const readColor = (key) => {
      const match = text.match(new RegExp("__" + key + "_([0-9a-fA-F]{6})(?:__|$)"));
      return match ? ("#" + match[1].toLowerCase()) : "";
    };

    meta.titleColor = readColor("ttl");
    meta.subtitleColor = readColor("sub");
    meta.personColor = readColor("nam");
    meta.metaColor = readColor("meta");
    meta.messageColor = readColor("msg");

    return meta;
  }

  function buildSpecialCardVisualMetaUrl(effect, colorMap) {
    const params = new URLSearchParams();
    const fx = String(effect || 'none').trim();
    if (fx && fx !== 'none') params.set('fx', fx);

    const colors = colorMap || {};
    const title = normalizeHexColor(colors.titleColor);
    const subtitle = normalizeHexColor(colors.subtitleColor);
    const person = normalizeHexColor(colors.personColor);
    const meta = normalizeHexColor(colors.metaColor);
    const message = normalizeHexColor(colors.messageColor);

    if (title) params.set('ttl', title.slice(1));
    if (subtitle) params.set('sub', subtitle.slice(1));
    if (person) params.set('nam', person.slice(1));
    if (meta) params.set('meta', meta.slice(1));
    if (message) params.set('msg', message.slice(1));

    const query = params.toString();
    return query ? ('meta://special-card?' + query) : '';
  }

  function parseSpecialCardVisualMetaUrl(value) {
    const text = String(value || '').trim();
    const empty = {
      effect: 'none',
      titleColor: '',
      subtitleColor: '',
      personColor: '',
      metaColor: '',
      messageColor: '',
    };
    if (!text.startsWith('meta://special-card?')) return empty;

    const query = text.slice('meta://special-card?'.length);
    const params = new URLSearchParams(query);
    const readColor = (key) => {
      const raw = String(params.get(key) || '').trim();
      return /^[0-9a-fA-F]{6}$/.test(raw) ? ('#' + raw.toLowerCase()) : '';
    };

    return {
      effect: String(params.get('fx') || 'none').trim() || 'none',
      titleColor: readColor('ttl'),
      subtitleColor: readColor('sub'),
      personColor: readColor('nam'),
      metaColor: readColor('meta'),
      messageColor: readColor('msg'),
    };
  }

  function specialCardThemePalette(theme) {
    const themes = {
      navy: {
        bgFrom: "#07111f",
        bgTo: "#10233f",
        accent: "#d7b56d",
        title: "#f8fafc",
        subtitle: "#dbeafe",
        meta: "#cbd5e1",
        message: "#f1f5f9",
      },
      gold: {
        bgFrom: "#19120a",
        bgTo: "#3a2814",
        accent: "#d7b56d",
        title: "#fff7db",
        subtitle: "#f5e7bf",
        meta: "#e7d8ad",
        message: "#fff1c8",
      },
      green: {
        bgFrom: "#071a12",
        bgTo: "#123d2b",
        accent: "#9ae6b4",
        title: "#ecfdf5",
        subtitle: "#bbf7d0",
        meta: "#86efac",
        message: "#dcfce7",
      },
      rose: {
        bgFrom: "#231018",
        bgTo: "#4a1d2d",
        accent: "#f3c7d3",
        title: "#fff1f5",
        subtitle: "#fecdd3",
        meta: "#fda4af",
        message: "#ffe4e6",
      },
      sapphire: {
        bgFrom: "#0a1530",
        bgTo: "#17366b",
        accent: "#7dd3fc",
        title: "#e0f2fe",
        subtitle: "#bae6fd",
        meta: "#93c5fd",
        message: "#f0f9ff",
      },
      sunset: {
        bgFrom: "#2a1208",
        bgTo: "#7c2d12",
        accent: "#fdba74",
        title: "#fff7ed",
        subtitle: "#fed7aa",
        meta: "#fdba74",
        message: "#ffedd5",
      },
      plum: {
        bgFrom: "#22102d",
        bgTo: "#4c1d95",
        accent: "#c4b5fd",
        title: "#f5f3ff",
        subtitle: "#ddd6fe",
        meta: "#c4b5fd",
        message: "#ede9fe",
      },
      emerald_luxe: {
        bgFrom: "#061510",
        bgTo: "#0f3b2e",
        accent: "#d1fae5",
        title: "#f0fdf4",
        subtitle: "#bbf7d0",
        meta: "#86efac",
        message: "#dcfce7",
      },
      ruby_royal: {
        bgFrom: "#24070e",
        bgTo: "#6b1024",
        accent: "#fecdd3",
        title: "#fff1f2",
        subtitle: "#fda4af",
        meta: "#fda4af",
        message: "#ffe4e6",
      },
      obsidian_pearl: {
        bgFrom: "#09090b",
        bgTo: "#27272a",
        accent: "#f5f5f4",
        title: "#fafaf9",
        subtitle: "#e7e5e4",
        meta: "#d6d3d1",
        message: "#f5f5f4",
      },
      desert_lux: {
        bgFrom: "#2b1d12",
        bgTo: "#8b5e34",
        accent: "#fde68a",
        title: "#fffbeb",
        subtitle: "#fcd34d",
        meta: "#fbbf24",
        message: "#fef3c7",
      },
    };
    return themes[String(theme || 'navy').trim()] || themes.navy;
  }

  function syncSpecialCardColorInputsFromTheme(force) {
    const palette = specialCardThemePalette(specialCardsTheme ? specialCardsTheme.value : 'navy');
    const apply = (input, value) => {
      if (!input) return;
      if (force || input.dataset.colorChosen !== '1') input.value = value;
    };
    apply(specialCardsTitleColor, palette.title);
    apply(specialCardsSubtitleColor, palette.subtitle);
    apply(specialCardsPersonColor, palette.accent);
    apply(specialCardsMetaColor, palette.meta);
    apply(specialCardsMessageColor, palette.message);
  }

  function ensureSpecialCardPreviewEffectStyles() {
    if (document.getElementById("special-card-preview-effects-style")) return;
    const style = document.createElement("style");
    style.id = "special-card-preview-effects-style";
    style.textContent =
      "@keyframes alzidanSpecialNamePulse{" +
      "0%,100%{transform:scale(1);text-shadow:0 0 0 rgba(255,255,255,0),0 0 0 rgba(0,0,0,0);filter:drop-shadow(0 0 0 rgba(255,255,255,0));}" +
      "50%{transform:scale(1.085);text-shadow:0 0 18px currentColor,0 0 34px rgba(255,255,255,.28);filter:drop-shadow(0 0 14px currentColor);}" +
      "}" +
      "@keyframes alzidanSpecialOrnamentGlow{" +
      "0%,100%{opacity:.88;transform:translateY(0) scale(1);filter:drop-shadow(0 0 0 rgba(255,255,255,0));}" +
      "50%{opacity:1;transform:translateY(-1px) scale(1.06);filter:drop-shadow(0 0 10px currentColor);}" +
      "}" +
      ".special-card-decorated-text{display:inline-flex;align-items:center;justify-content:center;gap:14px;position:relative;transition:all .25s ease;line-height:1.35;font-weight:900;max-width:100%;text-align:center;overflow-wrap:anywhere;}" +
      ".special-card-decorated-text.is-title{gap:16px;letter-spacing:.01em;}" +
      ".special-card-decorated-text.is-name{gap:14px;}" +
      ".special-card-decorated-text.is-pulse{animation:alzidanSpecialNamePulse 2.2s ease-in-out infinite;transform-origin:center;will-change:transform;}" +
      ".special-card-decorated-text.is-ornament,.special-card-decorated-text.is-pulse-ornament{text-shadow:0 2px 10px rgba(0,0,0,.18),0 0 24px rgba(255,255,255,.14);}" +
      ".special-card-decorated-text.is-pulse-ornament{animation:alzidanSpecialNamePulse 2.2s ease-in-out infinite;}" +
      ".special-card-decorated-main{display:inline-block;max-width:100%;overflow-wrap:anywhere;}" +
      ".special-card-ornament-group{display:inline-flex;align-items:center;gap:6px;opacity:.98;animation:alzidanSpecialOrnamentGlow 3.2s ease-in-out infinite;}" +
      ".special-card-ornament-line{display:inline-block;width:34px;height:1.5px;border-radius:999px;background:currentColor;box-shadow:0 0 10px currentColor;opacity:.92;}" +
      ".special-card-decorated-text.is-title .special-card-ornament-line{width:46px;height:2px;}" +
      ".special-card-ornament-dot{display:inline-block;width:7px;height:7px;border-radius:999px;background:currentColor;box-shadow:0 0 12px currentColor;opacity:.98;}" +
      ".special-card-ornament-gem{display:inline-flex;align-items:center;justify-content:center;font-size:.72em;line-height:1;min-width:16px;text-shadow:0 0 10px currentColor;}";
    document.head.appendChild(style);
  }

  function buildSpecialCardOrnamentGroup() {
    const group = document.createElement("span");
    group.className = "special-card-ornament-group";

    const lineA = document.createElement("span");
    lineA.className = "special-card-ornament-line";
    const dotA = document.createElement("span");
    dotA.className = "special-card-ornament-dot";
    const gem = document.createElement("span");
    gem.className = "special-card-ornament-gem";
    gem.textContent = "✦";
    const dotB = document.createElement("span");
    dotB.className = "special-card-ornament-dot";
    const lineB = document.createElement("span");
    lineB.className = "special-card-ornament-line";

    group.append(lineA, dotA, gem, dotB, lineB);
    return group;
  }

  function renderSpecialCardPreviewDecoratedText(el, text, effect, color, variant) {
    if (!el) return;

    el.textContent = "";
    el.className = "";
    el.classList.add("special-card-decorated-text");
    el.classList.add(variant === "title" ? "is-title" : "is-name");
    if (effect === "pulse") el.classList.add("is-pulse");
    if (effect === "ornament") el.classList.add("is-ornament");
    if (effect === "pulse-ornament") el.classList.add("is-pulse-ornament");
    el.style.color = color || "";

    const withOrnaments = effect === "ornament" || effect === "pulse-ornament";
    if (withOrnaments) el.appendChild(buildSpecialCardOrnamentGroup());

    const center = document.createElement("span");
    center.className = "special-card-decorated-main";
    center.textContent = text;
    el.appendChild(center);

    if (withOrnaments) el.appendChild(buildSpecialCardOrnamentGroup());
  }

  function getSpecialCardColorOverride(input) {
    if (!input) return "";
    return normalizeHexColor(input.value);
  }

  function updateSpecialCardPreview() {
    const box = document.getElementById("special-cards-preview");
    if (!box) return;
    ensureSpecialCardPreviewEffectStyles();
    syncSpecialCardColorInputsFromTheme(false);

    const type = specialCardsType ? specialCardsType.value : "graduation";
    const theme = specialCardsTheme ? specialCardsTheme.value : "navy";
    const title = specialCardsTitle && specialCardsTitle.value.trim()
      ? specialCardsTitle.value.trim()
      : "مبروك التخرج";
    const subtitle = specialCardsSubtitle && specialCardsSubtitle.value.trim()
      ? specialCardsSubtitle.value.trim()
      : "";
    const person = specialCardsPerson && specialCardsPerson.value.trim()
      ? specialCardsPerson.value.trim()
      : "اسم الشخص";
    const secondary = specialCardsSecondaryPerson && specialCardsSecondaryPerson.value.trim()
      ? specialCardsSecondaryPerson.value.trim()
      : "";
    const date = specialCardsEventDate && specialCardsEventDate.value
      ? specialCardsEventDate.value
      : "";
    const dateHijri = specialCardsEventDateHijri && specialCardsEventDateHijri.value
      ? normalizeHijriInput(specialCardsEventDateHijri.value)
      : "";
    const location = specialCardsLocation && specialCardsLocation.value.trim()
      ? specialCardsLocation.value.trim()
      : "";
    const message = specialCardsMessage && specialCardsMessage.value.trim()
      ? specialCardsMessage.value.trim()
      : "";
    const customTitleColor = getSpecialCardColorOverride(specialCardsTitleColor);
    const customSubtitleColor = getSpecialCardColorOverride(specialCardsSubtitleColor);
    const customPersonColor = getSpecialCardColorOverride(specialCardsPersonColor);
    const customMetaColor = getSpecialCardColorOverride(specialCardsMetaColor);
    const customMessageColor = getSpecialCardColorOverride(specialCardsMessageColor);
    const nameEffect = specialCardNameEffect();

    const colorsSet = specialCardThemePalette(theme);
    const accent = colorsSet.accent;

    box.style.background = "linear-gradient(160deg," + colorsSet.bgFrom + "," + colorsSet.bgTo + ")";
    box.style.borderColor = accent;

    const badge = document.getElementById("special-cards-preview-badge");
    const titleEl = document.getElementById("special-cards-preview-title");
    const subtitleEl = document.getElementById("special-cards-preview-subtitle");
    const personEl = document.getElementById("special-cards-preview-person");
    const secondaryEl = document.getElementById("special-cards-preview-secondary");
    const dateEl = document.getElementById("special-cards-preview-date");
    const locationEl = document.getElementById("special-cards-preview-location");
    const messageEl = document.getElementById("special-cards-preview-message");
    const imageEl = document.getElementById("special-cards-preview-image");

    if (badge) {
      badge.textContent = specialCardIcon(type) + " " + specialCardTypeLabel(type);
      badge.style.color = accent;
      badge.style.borderColor = accent;
    }
    if (titleEl) {
      titleEl.className = "";
      titleEl.textContent = title;
      titleEl.style.color = customTitleColor || colorsSet.title;
    }
    if (subtitleEl) subtitleEl.textContent = subtitle;
    if (subtitleEl) subtitleEl.style.color = customSubtitleColor || colorsSet.subtitle;
    if (personEl) {
      renderSpecialCardPreviewDecoratedText(personEl, person, nameEffect, customPersonColor || accent, "name");
    }
    if (secondaryEl) {
      secondaryEl.textContent = secondary;
      secondaryEl.style.color = customSubtitleColor || colorsSet.subtitle;
    }
    if (dateEl) {
      dateEl.textContent = dateHijri || date;
      dateEl.style.color = customMetaColor || colorsSet.meta;
    }
    if (locationEl) {
      locationEl.textContent = location ? "📍 " + location : "";
      locationEl.style.color = customMetaColor || colorsSet.meta;
    }
    if (messageEl) {
      messageEl.textContent = message;
      messageEl.style.color = customMessageColor || colorsSet.message;
    }

    if (imageEl) {
      const file = specialCardsImageFile && specialCardsImageFile.files ? specialCardsImageFile.files[0] : null;
      const url = specialCardsImageUrl && specialCardsImageUrl.value.trim()
        ? specialCardsImageUrl.value.trim()
        : "";
      if (file) {
        imageEl.src = URL.createObjectURL(file);
        imageEl.style.display = "block";
      } else if (url) {
        imageEl.src = url;
        imageEl.style.display = "block";
      } else {
        imageEl.removeAttribute("src");
        imageEl.style.display = "none";
      }
      imageEl.style.borderColor = accent;
    }

    const backgroundFile = specialCardsBackgroundFile && specialCardsBackgroundFile.files
      ? specialCardsBackgroundFile.files[0]
      : null;
    const backgroundUrl = specialCardsBackgroundUrl && specialCardsBackgroundUrl.value.trim()
      ? specialCardsBackgroundUrl.value.trim()
      : "";

    if (backgroundFile) {
      const bgUrl = URL.createObjectURL(backgroundFile);
      box.style.background =
        "linear-gradient(rgba(7,17,31,.72), rgba(7,17,31,.72)), url('" +
        bgUrl +
        "') center/cover";
    } else if (backgroundUrl) {
      box.style.background =
        "linear-gradient(rgba(7,17,31,.72), rgba(7,17,31,.72)), url('" +
        backgroundUrl +
        "') center/cover";
    }
  }

  function bindSpecialCardPreviewInputs() {
    const fields = [
      specialCardsType,
      specialCardsTheme,
      specialCardsNameEffect,
      specialCardsTitleColor,
      specialCardsSubtitleColor,
      specialCardsPersonColor,
      specialCardsMetaColor,
      specialCardsMessageColor,
      specialCardsTitle,
      specialCardsSubtitle,
      specialCardsPerson,
      specialCardsSecondaryPerson,
      specialCardsEventDate,
      specialCardsEventDateHijri,
      specialCardsLocation,
      specialCardsDegree,
      specialCardsUniversity,
      specialCardsImageFile,
      specialCardsImageUrl,
      specialCardsBackgroundFile,
      specialCardsBackgroundUrl,
      specialCardsGroupKey,
      specialCardsGroupTitle,
      specialCardsPriority,
      specialCardsSequence,
      specialCardsDisplayMode,
      specialCardsMaxSession,
      specialCardsStartDate,
      specialCardsEndDate,
      specialCardsMessage,
    ];

    fields.forEach((field) => {
      if (!field) return;
      if (field.type === "color") {
        field.addEventListener("input", () => {
          field.dataset.colorChosen = "1";
        });
        field.addEventListener("change", () => {
          field.dataset.colorChosen = "1";
        });
      }
      field.addEventListener("input", updateSpecialCardPreview);
      field.addEventListener("change", updateSpecialCardPreview);
    });

    updateSpecialCardPreview();
  }

  function resetSpecialCardsForm() {
    if (specialCardsId) specialCardsId.value = "";
    if (specialCardsType) specialCardsType.value = "graduation";
    if (specialCardsTheme) specialCardsTheme.value = "navy";
    if (specialCardsNameEffect) specialCardsNameEffect.value = "none";
    syncSpecialCardColorInputsFromTheme(true);
    if (specialCardsTitleColor) {
      specialCardsTitleColor.value = specialCardThemePalette('navy').title;
      delete specialCardsTitleColor.dataset.colorChosen;
    }
    if (specialCardsSubtitleColor) {
      specialCardsSubtitleColor.value = specialCardThemePalette('navy').subtitle;
      delete specialCardsSubtitleColor.dataset.colorChosen;
    }
    if (specialCardsPersonColor) {
      specialCardsPersonColor.value = specialCardThemePalette('navy').accent;
      delete specialCardsPersonColor.dataset.colorChosen;
    }
    if (specialCardsMetaColor) {
      specialCardsMetaColor.value = specialCardThemePalette('navy').meta;
      delete specialCardsMetaColor.dataset.colorChosen;
    }
    if (specialCardsMessageColor) {
      specialCardsMessageColor.value = specialCardThemePalette('navy').message;
      delete specialCardsMessageColor.dataset.colorChosen;
    }
    if (specialCardsTitle) specialCardsTitle.value = "مبروك التخرج";
    if (specialCardsSubtitle) specialCardsSubtitle.value = "";
    if (specialCardsPerson) specialCardsPerson.value = "";
    if (specialCardsSecondaryPerson) specialCardsSecondaryPerson.value = "";
    if (specialCardsEventDate) specialCardsEventDate.value = "";
    if (specialCardsEventDateHijri) specialCardsEventDateHijri.value = "";
    if (specialCardsLocation) specialCardsLocation.value = "";
    if (specialCardsDegree) specialCardsDegree.value = "";
    if (specialCardsUniversity) specialCardsUniversity.value = "";
    if (specialCardsImageUrl) specialCardsImageUrl.value = "";
    if (specialCardsBackgroundUrl) specialCardsBackgroundUrl.value = "";
    if (specialCardsGroupKey) specialCardsGroupKey.value = "";
    if (specialCardsGroupTitle) specialCardsGroupTitle.value = "";
    if (specialCardsPriority) specialCardsPriority.value = "0";
    if (specialCardsSequence) specialCardsSequence.value = "0";
    if (specialCardsDisplayMode) specialCardsDisplayMode.value = "manual";
    if (specialCardsMaxSession) specialCardsMaxSession.value = "1";
    if (specialCardsStartDate) specialCardsStartDate.value = "";
    if (specialCardsEndDate) specialCardsEndDate.value = "";
    if (specialCardsMessage) specialCardsMessage.value = "";
    if (specialCardsActive) specialCardsActive.checked = true;
    if (specialCardsOnceDay) specialCardsOnceDay.checked = true;
    if (specialCardsShare) specialCardsShare.checked = true;
    if (specialCardsSave) specialCardsSave.checked = true;
    if (specialCardsGroupCard) specialCardsGroupCard.checked = false;
    setSpecialCardsStatus("");
    updateSpecialCardPreview();
  }

  function renderSpecialCardsList() {
    if (!specialCardsList) return;
    specialCardsList.innerHTML = "";
    if (!specialCardsRows.length) {
      specialCardsList.innerHTML = '<div class="hint">لا توجد بطاقات خاصة محملة.</div>';
      return;
    }

    specialCardsRows.forEach((row) => {
      const card = document.createElement("div");
      card.className = "source-tree-item";
      const activeText = row.is_active === false ? "غير مفعلة" : "مفعلة";
      card.innerHTML =
        "<strong>#" +
        escapeHtml(row.id) +
        " — " +
        escapeHtml(row.title || specialCardTypeLabel(row.type)) +
        "</strong>" +
        '<div class="hint">' +
        escapeHtml(specialCardTypeLabel(row.type)) +
        " · " +
        escapeHtml(row.person_name || "") +
        " · " +
        escapeHtml(activeText) +
        " · أولوية " +
        escapeHtml(row.priority ?? 0) +
        " · ترتيب " +
        escapeHtml(row.sequence_order ?? 0) +
        "</div>" +
        '<div class="hint">' +
        escapeHtml(row.group_title || row.group_key || "بدون مجموعة") +
        "</div>" +
        '<div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">' +
        '<button class="btn btn-outline btn-sm" type="button">تعديل</button>' +
        "</div>";
      const btn = card.querySelector("button");
      if (btn) btn.addEventListener("click", () => fillSpecialCardsForm(row));
      specialCardsList.appendChild(card);
    });
  }

  async function loadSpecialCardsRows() {
    const sb = getClient();
    if (!sb) return setSpecialCardsStatus("تعذر الاتصال بقاعدة البيانات.");
    setSpecialCardsStatus("جاري تحميل البطاقات الخاصة...");
    const { data, error } = await sb
      .from("special_cards")
      .select("*")
      .order("priority", { ascending: false })
      .order("sequence_order", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(300);

    if (error) {
      setSpecialCardsStatus("تعذر تحميل البطاقات الخاصة.");
      return;
    }

    specialCardsRows = Array.isArray(data) ? data : [];
    renderSpecialCardsList();
    setSpecialCardsStatus("تم تحميل " + specialCardsRows.length + " بطاقة خاصة.");
  }

  function fillSpecialCardsForm(row) {
    if (!row) return;
    if (specialCardsId) specialCardsId.value = row.id || "";
    if (specialCardsType) specialCardsType.value = row.type || "graduation";
    if (specialCardsTheme) specialCardsTheme.value = row.theme || "navy";
    syncSpecialCardColorInputsFromTheme(true);
    const templateMeta = parseSpecialCardTemplateMeta(row.template_key);
    const visualMeta = parseSpecialCardVisualMetaUrl(row.audio_url);
    const mergedMeta = {
      effect: visualMeta.effect !== 'none' ? visualMeta.effect : templateMeta.effect,
      titleColor: visualMeta.titleColor || templateMeta.titleColor,
      subtitleColor: visualMeta.subtitleColor || templateMeta.subtitleColor,
      personColor: visualMeta.personColor || templateMeta.personColor,
      metaColor: visualMeta.metaColor || templateMeta.metaColor,
      messageColor: visualMeta.messageColor || templateMeta.messageColor,
    };
    if (specialCardsNameEffect) {
      specialCardsNameEffect.value = mergedMeta.effect;
    }
    if (specialCardsTitleColor) {
      specialCardsTitleColor.value = mergedMeta.titleColor || "#000000";
      if (mergedMeta.titleColor) specialCardsTitleColor.dataset.colorChosen = "1";
      else delete specialCardsTitleColor.dataset.colorChosen;
    }
    if (specialCardsSubtitleColor) {
      specialCardsSubtitleColor.value = mergedMeta.subtitleColor || "#000000";
      if (mergedMeta.subtitleColor) specialCardsSubtitleColor.dataset.colorChosen = "1";
      else delete specialCardsSubtitleColor.dataset.colorChosen;
    }
    if (specialCardsPersonColor) {
      specialCardsPersonColor.value = mergedMeta.personColor || "#000000";
      if (mergedMeta.personColor) specialCardsPersonColor.dataset.colorChosen = "1";
      else delete specialCardsPersonColor.dataset.colorChosen;
    }
    if (specialCardsMetaColor) {
      specialCardsMetaColor.value = mergedMeta.metaColor || "#000000";
      if (mergedMeta.metaColor) specialCardsMetaColor.dataset.colorChosen = "1";
      else delete specialCardsMetaColor.dataset.colorChosen;
    }
    if (specialCardsMessageColor) {
      specialCardsMessageColor.value = mergedMeta.messageColor || "#000000";
      if (mergedMeta.messageColor) specialCardsMessageColor.dataset.colorChosen = "1";
      else delete specialCardsMessageColor.dataset.colorChosen;
    }
    if (specialCardsTitle) specialCardsTitle.value = row.title || "";
    if (specialCardsSubtitle) specialCardsSubtitle.value = row.subtitle || "";
    if (specialCardsPerson) specialCardsPerson.value = row.person_name || "";
    if (specialCardsSecondaryPerson) specialCardsSecondaryPerson.value = row.secondary_person || "";
    if (specialCardsEventDate) specialCardsEventDate.value = row.event_date || "";
    if (specialCardsEventDateHijri) {
      const stored = String(row.event_date || "").trim();
      specialCardsEventDateHijri.value = /^14\d{2}-\d{2}-\d{2}$/.test(stored) ? stored : "";
    }
    if (specialCardsLocation) specialCardsLocation.value = row.location || "";
    if (specialCardsDegree) specialCardsDegree.value = row.degree_name || "";
    if (specialCardsUniversity) specialCardsUniversity.value = row.university || "";
    if (specialCardsImageUrl) specialCardsImageUrl.value = row.image_url || "";
    if (specialCardsBackgroundUrl) specialCardsBackgroundUrl.value = row.background_url || "";
    if (specialCardsGroupKey) specialCardsGroupKey.value = row.group_key || "";
    if (specialCardsGroupTitle) specialCardsGroupTitle.value = row.group_title || "";
    if (specialCardsPriority) specialCardsPriority.value = String(row.priority ?? 0);
    if (specialCardsSequence) specialCardsSequence.value = String(row.sequence_order ?? 0);
    if (specialCardsDisplayMode) specialCardsDisplayMode.value = row.display_mode || "manual";
    if (specialCardsMaxSession) specialCardsMaxSession.value = String(row.max_per_session ?? 1);
    if (specialCardsStartDate) specialCardsStartDate.value = row.start_date || "";
    if (specialCardsEndDate) specialCardsEndDate.value = row.end_date || "";
    if (specialCardsMessage) specialCardsMessage.value = row.message || "";
    if (specialCardsActive) specialCardsActive.checked = row.is_active !== false;
    if (specialCardsOnceDay) specialCardsOnceDay.checked = row.show_once_per_day !== false;
    if (specialCardsShare) specialCardsShare.checked = row.allow_share !== false;
    if (specialCardsSave) specialCardsSave.checked = row.allow_save !== false;
    if (specialCardsGroupCard) specialCardsGroupCard.checked = !!row.is_group_card;
    setSpecialCardsStatus("تعديل البطاقة رقم #" + (row.id || ""));
    updateSpecialCardPreview();
  }

  function collectSpecialCardPayload() {
    const titleColor = getSpecialCardColorOverride(specialCardsTitleColor);
    const subtitleColor = getSpecialCardColorOverride(specialCardsSubtitleColor);
    const personColor = getSpecialCardColorOverride(specialCardsPersonColor);
    const metaColor = getSpecialCardColorOverride(specialCardsMetaColor);
    const messageColor = getSpecialCardColorOverride(specialCardsMessageColor);
    const nameEffect = specialCardNameEffect();

    return {
      type: specialCardsType ? specialCardsType.value : "graduation",
      title: specialCardsTitle ? specialCardsTitle.value.trim() : "",
      subtitle: specialCardsSubtitle ? specialCardsSubtitle.value.trim() : "",
      person_name: specialCardsPerson ? specialCardsPerson.value.trim() : "",
      secondary_person: specialCardsSecondaryPerson ? specialCardsSecondaryPerson.value.trim() : "",
      degree_name: specialCardsDegree ? specialCardsDegree.value.trim() : "",
      university: specialCardsUniversity ? specialCardsUniversity.value.trim() : "",
      event_date: (() => {
        const hijri = specialCardsEventDateHijri
          ? normalizeHijriInput(specialCardsEventDateHijri.value)
          : "";
        if (hijri) return hijri;
        return specialCardsEventDate ? specialCardsEventDate.value : "";
      })(),
      location: specialCardsLocation ? specialCardsLocation.value.trim() : "",
      message: specialCardsMessage ? specialCardsMessage.value.trim() : "",
      image_url: specialCardsImageUrl ? specialCardsImageUrl.value.trim() : "",
      background_url: specialCardsBackgroundUrl ? specialCardsBackgroundUrl.value.trim() : "",
      theme: specialCardsTheme ? specialCardsTheme.value : "navy",
      button_text: "دخول",
      priority: specialCardsPriority ? specialCardsPriority.value : "0",
      display_seconds: "7",
      show_once_per_day: specialCardsOnceDay ? !!specialCardsOnceDay.checked : true,
      allow_share: specialCardsShare ? !!specialCardsShare.checked : true,
      allow_save: specialCardsSave ? !!specialCardsSave.checked : true,
      template_key: buildSpecialCardTemplateKey(
        specialCardsType ? specialCardsType.value : "graduation",
        nameEffect,
        {
          titleColor,
          subtitleColor,
          personColor,
          metaColor,
          messageColor,
        },
      ),
      audio_url: buildSpecialCardVisualMetaUrl(nameEffect, {
        titleColor,
        subtitleColor,
        personColor,
        metaColor,
        messageColor,
      }),
      group_key: specialCardsGroupKey ? specialCardsGroupKey.value.trim() : "",
      group_title: specialCardsGroupTitle ? specialCardsGroupTitle.value.trim() : "",
      sequence_order: specialCardsSequence ? specialCardsSequence.value : "0",
      max_per_session: specialCardsMaxSession ? specialCardsMaxSession.value : "1",
      display_mode: specialCardsDisplayMode ? specialCardsDisplayMode.value : "manual",
      is_group_card: specialCardsGroupCard ? !!specialCardsGroupCard.checked : false,
      start_date: specialCardsStartDate ? specialCardsStartDate.value : "",
      end_date: specialCardsEndDate ? specialCardsEndDate.value : "",
      is_active: specialCardsActive ? !!specialCardsActive.checked : true,
    };
  }

  async function saveSpecialCardRow(event) {
    if (event) event.preventDefault();
    const sb = getClient();
    const token = getAdminToken();
    if (!sb || !token) return setSpecialCardsStatus("سجل الدخول أولاً.");

    if (specialCardsImageFile && specialCardsImageFile.files && specialCardsImageFile.files[0]) {
      setSpecialCardsStatus("جاري رفع صورة الشخص...");
      const uploadedImageUrl = await uploadAdminEventMedia(sb, specialCardsImageFile.files[0], "special-card-photo");
      if (specialCardsImageUrl) specialCardsImageUrl.value = uploadedImageUrl;
    }

    if (specialCardsBackgroundFile && specialCardsBackgroundFile.files && specialCardsBackgroundFile.files[0]) {
      setSpecialCardsStatus("جاري رفع خلفية البطاقة...");
      const uploadedBackgroundUrl = await uploadAdminEventMedia(sb, specialCardsBackgroundFile.files[0], "special-card-background");
      if (specialCardsBackgroundUrl) specialCardsBackgroundUrl.value = uploadedBackgroundUrl;
    }

    const payload = collectSpecialCardPayload();
    if (!payload.title) return setSpecialCardsStatus("اكتب عنوان البطاقة.");
    if (!payload.person_name) return setSpecialCardsStatus("اكتب اسم الشخص.");

    const id = Number(specialCardsId && specialCardsId.value ? specialCardsId.value : 0);
    setSpecialCardsStatus("جاري حفظ البطاقة الخاصة...");

    const { data, error } = await sb.rpc("admin_special_cards_save_v1", {
      p_token: token,
      p_id: id,
      p_row: payload,
    });

    if (error) {
      setSpecialCardsStatus(
        "تعذر حفظ البطاقة الخاصة: " +
          String(error.message || error.details || error.hint || "خطأ غير معروف"),
      );
      return;
    }

    if (data == null || data === false) {
      setSpecialCardsStatus("لم يتم حفظ البطاقة الخاصة. تحقق من دالة الحفظ في القاعدة.");
      return;
    }

    if (specialCardsId) specialCardsId.value = String(data || id || "");
    setSpecialCardsStatus("تم حفظ البطاقة الخاصة.");
    await loadSpecialCardsRows();
  }

  async function deleteSpecialCardRow() {
    const sb = getClient();
    const token = getAdminToken();
    const id = Number(specialCardsId && specialCardsId.value ? specialCardsId.value : 0);
    if (!sb || !token) return setSpecialCardsStatus("سجل الدخول أولاً.");
    if (!id) return setSpecialCardsStatus("اختر بطاقة أولاً.");
    if (!window.confirm("سيتم حذف هذه البطاقة نهائياً. هل أنت متأكد؟")) return;

    setSpecialCardsStatus("جاري حذف البطاقة الخاصة...");
    const { error } = await sb.rpc("admin_special_cards_delete_v1", {
      p_token: token,
      p_id: id,
    });

    if (error) {
      setSpecialCardsStatus(
        "تعذر حذف البطاقة الخاصة: " +
          String(error.message || error.details || error.hint || "خطأ غير معروف"),
      );
      return;
    }

    resetSpecialCardsForm();
    setSpecialCardsStatus("تم حذف البطاقة الخاصة.");
    await loadSpecialCardsRows();
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
    if (!text) return setBannerMessagesStatus("اكتب نص الخبر العام.");
    setBannerMessagesStatus(id ? "جاري حفظ الخبر العام..." : "جاري إنشاء الخبر العام...");

    const { data, error } = id
      ? await sb.rpc("admin_banner_message_update_v1", {
          p_token: token,
          p_id: id,
          p_branch_key: branch,
          p_message: text,
          p_show_days: showDays,
          p_is_active: isActive,
        })
      : await sb.rpc("admin_banner_message_create_v1", {
          p_token: token,
          p_branch_key: branch,
          p_message: text,
          p_show_days: showDays,
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
  function resetEventsSourceForm() {
    if (eventsSourceId) eventsSourceId.value = "";
    if (eventsSourceBranch) eventsSourceBranch.value = "زيدان";
    if (eventsSourceType) eventsSourceType.value = "birth";
    if (eventsSourcePerson) eventsSourcePerson.value = "";
    if (eventsSourceTitle) eventsSourceTitle.value = "";
    if (eventsSourceGregorian) eventsSourceGregorian.value = "";
    if (eventsSourceText) eventsSourceText.value = "";
    if (eventsSourceImage) eventsSourceImage.value = "";
    if (eventsSourceVideo) eventsSourceVideo.value = "";
    const adminImageFile = document.getElementById("admin-event-image-file");
    const adminVideoFile = document.getElementById("admin-event-video-file");
    if (adminImageFile) adminImageFile.value = "";
    if (adminVideoFile) adminVideoFile.value = "";
    setEventsSourceStatus("إضافة خبر / مناسبة جديد — املأ البيانات ثم اضغط حفظ.");
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
    const Events = window.AlzidanEvents || {};
    if (typeof Events.buildFamilyEventRow !== "function") return null;
    return Events.buildFamilyEventRow({
      source: "admin_cms",
      id,
      branch:
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
      dateLabel:
        eventsSourceTitle && eventsSourceTitle.value
          ? eventsSourceTitle.value.trim()
          : "",
      eventDate:
        eventsSourceGregorian && eventsSourceGregorian.value
          ? eventsSourceGregorian.value.trim()
          : "",
      text:
        eventsSourceText && eventsSourceText.value
          ? eventsSourceText.value.trim()
          : "",
      imageUrl:
        eventsSourceImage && eventsSourceImage.value
          ? eventsSourceImage.value.trim()
          : "",
      videoUrl:
        eventsSourceVideo && eventsSourceVideo.value
          ? eventsSourceVideo.value.trim()
          : "",
      oldDetails,
    });
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
    const saveOk =
      data === true ||
      data === null ||
      data === undefined ||
      (data && typeof data === "object" && data.ok !== false) ||
      (typeof data === "number" && data > 0);
    if (!saveOk) {
      setEventsSourceStatus(
        "تعذر الحفظ: لم يتم العثور على المناسبة أو رُفضت العملية.",
      );
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
      const isNewEvent = !(payload && Number(payload.id || 0) > 0);
      if (isNewEvent) {
        try {
          await sb.functions.invoke("alzidan-push-notify", {
            body: {
              type: payload.type || "",
              person: payload.person || "",
              branch_key: payload.branch_key || "",
              details: payload.details || "",
            },
          });
        } catch (_) {}
      }
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
    const code = String(error.code || "").trim();
    const msg = String(error.message || error.details || error.hint || "").trim();
    if (
      code === "42883" ||
      /Could not find the function|function .* does not exist/i.test(msg)
    ) {
      return "دالة الحفظ غير منشورة في القاعدة. نفّذ ملف supabase/sql/admin_family_events_rpc.sql في Supabase.";
    }
    if (msg) return msg.length > 160 ? msg.slice(0, 160) + "…" : msg;
    return "تعذر تنفيذ العملية، حاول لاحقاً أو تواصل مع الإدارة.";
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


  if (filterKind)
    filterKind.addEventListener("change", () => {
      requestsCurrentPage = 1;
      reloadAdminRequestsSafe();
    });
  if (filterStatus)
    filterStatus.addEventListener("change", () => {
      requestsCurrentPage = 1;
      reloadAdminRequestsSafe();
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
  if (eventsSourceLoad)
    eventsSourceLoad.addEventListener("click", () =>
      loadEventsSourceRows().catch(() => {}),
    );
  if (eventsSourceNew)
    eventsSourceNew.addEventListener("click", resetEventsSourceForm);
  if (bannerGeneralForm)
    bannerGeneralForm.addEventListener("submit", publishBannerGeneralNews);
  if (bannerGeneralClear)
    bannerGeneralClear.addEventListener("click", clearBannerGeneralForm);
  bindSpecialCardPreviewInputs();
  if (specialCardsLoad)
    specialCardsLoad.addEventListener("click", () =>
      loadSpecialCardsRows().catch(() => {}),
    );
  if (specialCardsNew)
    specialCardsNew.addEventListener("click", resetSpecialCardsForm);
  if (specialCardsForm)
    specialCardsForm.addEventListener("submit", saveSpecialCardRow);
  if (specialCardsDelete)
    specialCardsDelete.addEventListener("click", () =>
      deleteSpecialCardRow().catch(() => {}),
    );

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
    window.AlzidanAdminCore = Object.assign(window.AlzidanAdminCore || {}, {
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
  });

  if (window.AlzidanRequestActions && typeof window.AlzidanRequestActions.setReloadRequests === "function") {
    window.AlzidanRequestActions.setReloadRequests(() => window.AlzidanAdminRequests.loadRequests());
  }

  window.loadTickerSpeedSetting = loadTickerSpeedSetting;

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
      if (
        window.AlzidanAdminPolls &&
        typeof window.AlzidanAdminPolls.loadPollsRows === "function"
      )
        window.AlzidanAdminPolls.loadPollsRows().catch(() => {});
      if (
        window.AdminFamilyMgmt &&
        typeof window.AdminFamilyMgmt.mountAdminFamilyManagement === "function"
      ) {
        window.AdminFamilyMgmt.mountAdminFamilyManagement();
      }
      if (delegateAuditDetails && delegateAuditDetails.open && window.AlzidanDelegateAudit) {
        window.AlzidanDelegateAudit.loadDelegateAudit().catch(() => {});
      }
      if (
        window.AlzidanAdminMemoryQueueModule &&
        typeof window.AlzidanAdminMemoryQueueModule.loadMemoryQueue === "function"
      ) {
        window.AlzidanAdminMemoryQueueModule.loadMemoryQueue().catch(() => {});
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
