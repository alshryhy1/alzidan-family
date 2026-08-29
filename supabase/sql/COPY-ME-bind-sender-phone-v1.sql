-- COPY-ME: Preset id: maint.bind_sender_phone_v1
-- Sender phone on a request / occasion is saved on member_profiles and
-- linked to that sender's tree person_id (same number they submitted).
-- Safe to re-run. Backfill covers already-approved cards (e.g. Majed).

-- Parse __JSON__: payload from approval_requests.message / family_events.details
create or replace function public.approval_message_json_v1(p_message text)
returns jsonb
language plpgsql
immutable
as $fn$
declare
  v_raw text := coalesce(p_message, '');
  v_pos int;
  v_json text;
  v_start int;
begin
  v_pos := position('__JSON__:' in v_raw);
  if v_pos > 0 then
    v_json := btrim(substr(v_raw, v_pos + 9));
  else
    v_json := btrim(v_raw);
  end if;
  v_start := position('{' in v_json);
  if v_start > 0 then
    v_json := substr(v_json, v_start);
  end if;
  begin
    return v_json::jsonb;
  exception when others then
    return '{}'::jsonb;
  end;
end;
$fn$;

create or replace function public.member_phone_stored_v1(p_phone text)
returns text
language plpgsql
immutable
as $fn$
declare
  v_norm text;
begin
  if to_regprocedure('public.push_tokens_norm_phone(text)') is not null then
    v_norm := nullif(public.push_tokens_norm_phone(p_phone), '');
    if v_norm is not null then
      return v_norm;
    end if;
  end if;
  v_norm := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  if v_norm like '966%' and char_length(v_norm) >= 12 then
    return '0' || substr(v_norm, 4);
  end if;
  if char_length(v_norm) = 9 and substr(v_norm, 1, 1) = '5' then
    return '0' || v_norm;
  end if;
  return nullif(v_norm, '');
end;
$fn$;

create or replace function public.tree_leaf_name_v1(p_path text)
returns text
language sql
immutable
as $fn$
  select nullif(btrim(regexp_replace(btrim(coalesce(p_path, '')), '^.*/', '')), '');
$fn$;

-- Bind a sender phone onto one tree person. Never steal a phone already
-- linked to a different person_id. Same number in two formats (0500… vs 500…)
-- is merged onto the unique phone row — never copied onto a second row.
create or replace function public.bind_sender_phone_to_person_v1(
  p_phone text,
  p_person_id text,
  p_tree_child_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_phone text := public.member_phone_stored_v1(p_phone);
  v_digits text;
  v_pid text := nullif(btrim(coalesce(p_person_id, '')), '');
  v_child public.tree_children%rowtype;
  v_keep_id bigint := null;
  v_phone_row_id bigint := null;
  v_person_row_id bigint := null;
  v_other_pid text;
  v_leaf text;
begin
  if to_regclass('public.member_profiles') is null then
    return jsonb_build_object('ok', false, 'error', 'no_member_profiles');
  end if;
  if v_phone is null or char_length(regexp_replace(v_phone, '\D', '', 'g')) < 9 then
    return jsonb_build_object('ok', false, 'error', 'bad_phone');
  end if;
  v_digits := right(regexp_replace(v_phone, '\D', '', 'g'), 9);

  if p_tree_child_id is not null then
    select * into v_child from public.tree_children where id = p_tree_child_id limit 1;
  end if;
  if v_child.id is null and v_pid is not null then
    select * into v_child
    from public.tree_children c
    where c.person_id is not null
      and c.person_id::text = v_pid
    order by c.id desc
    limit 1;
  end if;
  if v_child.id is null then
    return jsonb_build_object('ok', false, 'error', 'person_not_found', 'person_id', v_pid);
  end if;
  v_pid := nullif(btrim(coalesce(v_child.person_id::text, v_pid, '')), '');
  v_leaf := public.tree_leaf_name_v1(
    coalesce(
      nullif(btrim(coalesce(v_child.child_name, '')), ''),
      nullif(btrim(coalesce(to_jsonb(v_child)->>'name', '')), '')
    )
  );

  select mp.id into v_phone_row_id
  from public.member_profiles mp
  where mp.phone = v_phone
  order by mp.id
  limit 1;
  if v_phone_row_id is null and char_length(coalesce(v_digits, '')) = 9 then
    select mp.id into v_phone_row_id
    from public.member_profiles mp
    where right(regexp_replace(coalesce(mp.phone, ''), '\D', '', 'g'), 9) = v_digits
    order by (mp.phone = v_phone) desc, mp.id desc
    limit 1;
  end if;

  select mp.id into v_person_row_id
  from public.member_profiles mp
  where mp.tree_child_id = v_child.id
     or (
       v_pid is not null
       and mp.person_id is not null
       and mp.person_id::text = v_pid
     )
  order by (mp.tree_child_id is not distinct from v_child.id) desc, mp.id desc
  limit 1;

  if v_phone_row_id is not null then
    select nullif(btrim(coalesce(mp.person_id::text, '')), '')
      into v_other_pid
    from public.member_profiles mp
    where mp.id = v_phone_row_id;
    if v_other_pid is not null and v_pid is not null and v_other_pid <> v_pid then
      return jsonb_build_object(
        'ok', false,
        'error', 'phone_conflict',
        'other_person_id', v_other_pid,
        'phone', v_phone
      );
    end if;
  end if;

  -- Prefer the row that already owns the unique phone value.
  v_keep_id := coalesce(v_phone_row_id, v_person_row_id);

  if v_keep_id is not null then
    update public.member_profiles set
      phone = v_phone,
      branch_key = coalesce(nullif(btrim(coalesce(v_child.branch_key, '')), ''), branch_key),
      tree_child_id = v_child.id,
      person_id = v_child.person_id,
      display_name = coalesce(nullif(btrim(coalesce(display_name, '')), ''), v_leaf),
      status = coalesce(nullif(btrim(coalesce(status, '')), ''), 'active'),
      updated_at = now()
    where id = v_keep_id;

    begin
      delete from public.member_profiles mp
      where mp.id <> v_keep_id
        and (
          (
            char_length(v_digits) = 9
            and right(regexp_replace(coalesce(mp.phone, ''), '\D', '', 'g'), 9) = v_digits
          )
          or (
            mp.tree_child_id = v_child.id
            and (
              nullif(btrim(coalesce(mp.phone, '')), '') is null
              or (
                char_length(v_digits) = 9
                and right(regexp_replace(coalesce(mp.phone, ''), '\D', '', 'g'), 9) = v_digits
              )
            )
          )
        );
    exception when others then
      null;
    end;

    return jsonb_build_object(
      'ok', true,
      'action', 'updated',
      'member_id', v_keep_id,
      'person_id', v_pid,
      'tree_child_id', v_child.id,
      'phone', v_phone
    );
  end if;

  insert into public.member_profiles (
    phone, branch_key, tree_child_id, person_id, display_name, status, created_at, updated_at
  ) values (
    v_phone,
    v_child.branch_key,
    v_child.id,
    v_child.person_id,
    v_leaf,
    'active',
    now(),
    now()
  )
  on conflict (phone) do update set
    branch_key = coalesce(nullif(btrim(coalesce(excluded.branch_key, '')), ''), public.member_profiles.branch_key),
    tree_child_id = coalesce(excluded.tree_child_id, public.member_profiles.tree_child_id),
    person_id = coalesce(excluded.person_id, public.member_profiles.person_id),
    display_name = coalesce(nullif(btrim(coalesce(excluded.display_name, '')), ''), public.member_profiles.display_name),
    status = coalesce(nullif(btrim(coalesce(excluded.status, '')), ''), public.member_profiles.status, 'active'),
    updated_at = now()
  returning id into v_keep_id;

  return jsonb_build_object(
    'ok', true,
    'action', 'inserted',
    'member_id', v_keep_id,
    'person_id', v_pid,
    'tree_child_id', v_child.id,
    'phone', v_phone
  );
end;
$fn$;

-- Unique tree person by branch + leaf, optional full path hint.
-- p_allow_unique: when false, only exact path matches (never guess among same-name people).
drop function if exists public.tree_resolve_person_by_leaf_v1(text, text, text);
drop function if exists public.tree_resolve_person_by_leaf_v1(text, text, text, boolean);
create or replace function public.tree_resolve_person_by_leaf_v1(
  p_branch text,
  p_leaf text,
  p_path_hint text default null,
  p_allow_unique boolean default true
)
returns bigint
language plpgsql
stable
as $fn$
declare
  v_branch text := nullif(btrim(coalesce(p_branch, '')), '');
  v_leaf text := public.tree_leaf_name_v1(p_leaf);
  v_hint text := nullif(btrim(coalesce(p_path_hint, '')), '');
  v_id bigint;
  v_n int := 0;
begin
  if v_leaf is null then
    return null;
  end if;
  if v_hint is not null then
    select c.id into v_id
    from public.tree_children c
    where (v_branch is null or c.branch_key = v_branch)
      and btrim(coalesce(c.child_name, to_jsonb(c)->>'name', '')) = v_hint
    order by c.id desc
    limit 1;
    if found then
      return v_id;
    end if;
    select c.id into v_id
    from public.tree_children c
    where (v_branch is null or c.branch_key = v_branch)
      and btrim(coalesce(c.child_name, to_jsonb(c)->>'name', '')) = v_hint || '/' || v_leaf
    order by c.id desc
    limit 1;
    if found then
      return v_id;
    end if;
  end if;

  if not coalesce(p_allow_unique, true) then
    return null;
  end if;

  select count(*)::int, min(c.id)
    into v_n, v_id
  from public.tree_children c
  where (v_branch is null or c.branch_key = v_branch)
    and public.tree_leaf_name_v1(coalesce(c.child_name, to_jsonb(c)->>'name')) = v_leaf;

  if v_n = 1 then
    return v_id;
  end if;
  return null;
end;
$fn$;

-- Fold Arabic for name match (self-contained; same rules as member_phone_fold_ar_v1).
create or replace function public.member_phone_fold_ar_v1(p text)
returns text
language sql
immutable
as $$
  select nullif(btrim(regexp_replace(
    replace(replace(replace(replace(replace(replace(replace(replace(
      regexp_replace(coalesce(p, ''), '[\u064B-\u065F\u0670\u0640]', '', 'g'),
      'أ', 'ا'), 'إ', 'ا'), 'آ', 'ا'), 'ٱ', 'ا'),
      'ى', 'ي'), 'ة', 'ه'), 'ؤ', 'و'), 'ئ', 'ي')
  , '\s+', ' ', 'g')), '');
$$;

-- Sender "أحمد محمد حمد…" → tree leaf أحمد under that nasab.
-- Space names: given name first. Path names: leaf last.
create or replace function public.tree_resolve_person_by_sender_name_v1(
  p_branch text,
  p_name text
)
returns bigint
language plpgsql
stable
as $fn$
declare
  v_branch text := nullif(btrim(coalesce(p_branch, '')), '');
  v_raw text := nullif(btrim(coalesce(p_name, '')), '');
  v_tokens text[];
  v_leaf text;
  v_need int;
  v_n int := 0;
  v_id bigint;
  v_is_path boolean;
begin
  if v_raw is null then
    return null;
  end if;
  v_is_path := position('/' in v_raw) > 0;
  select coalesce(array(
    select t from (
      select public.member_phone_fold_ar_v1(x) as t
      from unnest(
        regexp_split_to_array(
          replace(v_raw, '/', ' '),
          '\s+'
        )
      ) as x
    ) s
    where t is not null
      and t not in ('بن', 'ابن', 'ال')
      and (v_branch is null or t is distinct from public.member_phone_fold_ar_v1(v_branch))
  ), '{}'::text[]) into v_tokens;
  if coalesce(array_length(v_tokens, 1), 0) < 1 then
    return null;
  end if;

  if v_is_path then
    v_leaf := v_tokens[array_length(v_tokens, 1)];
    return public.tree_resolve_person_by_leaf_v1(v_branch, v_leaf, v_raw, true);
  end if;

  v_leaf := v_tokens[1];
  -- Most specific first (up to 4 tokens), then relax. A later token that
  -- does not match the path (نداء vs ندا) must not wipe a unique triple.
  v_need := least(coalesce(array_length(v_tokens, 1), 0), 4);

  while v_need >= 1 loop
    select count(*)::int, min(s.id)
      into v_n, v_id
    from (
      select
        c.id,
        public.member_phone_fold_ar_v1(
          nullif(btrim(regexp_replace(
            btrim(coalesce(c.child_name, to_jsonb(c)->>'name', '')),
            '^.*/',
            ''
          )), '')
        ) as leaf,
        public.member_phone_fold_ar_v1(
          replace(
            case
              when position('/' in coalesce(c.child_name, to_jsonb(c)->>'name', '')) > 0
                then coalesce(c.child_name, to_jsonb(c)->>'name', '')
              else btrim(coalesce(c.parent_name, '') || '/' || coalesce(c.child_name, to_jsonb(c)->>'name', ''), '/')
            end,
            '/',
            ' '
          )
        ) as hay
      from public.tree_children c
      where v_branch is null or btrim(coalesce(c.branch_key, '')) = v_branch
    ) s
    where s.leaf = v_leaf
      and (v_need < 2 or position(v_tokens[2] in coalesce(s.hay, '')) > 0)
      and (v_need < 3 or position(v_tokens[3] in coalesce(s.hay, '')) > 0)
      and (v_need < 4 or position(v_tokens[4] in coalesce(s.hay, '')) > 0);

    if v_n = 1 then
      return v_id;
    end if;
    if v_n = 0 then
      v_need := v_need - 1;
    else
      return null;
    end if;
  end loop;
  return null;
end;
$fn$;

create or replace function public.bind_approval_request_sender_phone_v1(p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row public.approval_requests%rowtype;
  v_payload jsonb := '{}'::jsonb;
  v_phone text;
  v_kind text;
  v_branch text;
  v_leaf text;
  v_submitter text;
  v_path text;
  v_child_id bigint;
  v_pid text;
begin
  if p_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_id');
  end if;
  select * into v_row from public.approval_requests where id = p_id limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'request_not_found');
  end if;
  if btrim(coalesce(v_row.kind, '')) in ('member_registration', 'member_phone_register')
     or position('MEMBER_PHONE_REGISTER_V1' in coalesce(v_row.message, '')) > 0 then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'member_phone_register');
  end if;

  v_payload := public.approval_message_json_v1(v_row.message);
  v_kind := nullif(btrim(coalesce(v_row.kind, '')), '');
  v_branch := nullif(btrim(coalesce(v_row.branch_key, v_payload->>'branch_key', '')), '');
  v_phone := coalesce(
    nullif(btrim(coalesce(v_row.phone, '')), ''),
    nullif(btrim(coalesce(v_payload#>>'{submitter,phone}', '')), ''),
    nullif(btrim(coalesce(v_payload->>'submitter_phone', '')), '')
  );
  v_submitter := coalesce(
    nullif(btrim(coalesce(v_payload#>>'{submitter,name}', '')), ''),
    nullif(btrim(coalesce(v_payload->>'submitter_name', '')), ''),
    nullif(btrim(coalesce(v_row.name, '')), '')
  );
  v_leaf := coalesce(
    nullif(btrim(coalesce(v_payload->>'name', '')), ''),
    public.tree_leaf_name_v1(v_payload->>'child_name')
  );
  v_path := coalesce(
    nullif(btrim(coalesce(v_payload->>'father_path', '')), ''),
    nullif(btrim(coalesce(v_payload->>'parent_path', '')), '')
  );
  if v_path is not null and v_leaf is not null and position('/' || v_leaf in '/' || v_path) <= 0 then
    v_path := v_path || '/' || v_leaf;
  elsif v_leaf is not null then
    v_path := coalesce(v_path, v_leaf);
  end if;

  -- Tree card: sender is the person on the card when names match (or submitter empty).
  -- Pending add: exact path only (the person may not exist yet). After accept: unique leaf ok.
  if v_kind = 'tree_card' then
    if v_submitter is not null and v_leaf is not null
       and v_submitter <> v_leaf
       and position(v_leaf in v_submitter) = 0
       and position(v_submitter in v_leaf) = 0 then
      v_child_id := public.tree_resolve_person_by_leaf_v1(
        v_branch,
        v_submitter,
        null,
        v_row.status in ('approved', 'accepted')
      );
    else
      v_child_id := public.tree_resolve_person_by_leaf_v1(
        v_branch,
        v_leaf,
        v_path,
        v_row.status in ('approved', 'accepted')
      );
    end if;
  else
    -- News / occasion: sender's given name first, not the full nasab as a leaf.
    v_child_id := public.tree_resolve_person_by_sender_name_v1(
      v_branch,
      coalesce(v_submitter, v_leaf)
    );
    if v_child_id is null then
      begin
        v_pid := nullif(btrim(coalesce(
          v_payload->>'person_id',
          v_payload->>'personId',
          v_payload#>>'{submitter,person_id}',
          ''
        )), '');
      exception when others then
        v_pid := null;
      end;
    end if;
  end if;

  if v_child_id is null and v_pid is not null then
    return public.bind_sender_phone_to_person_v1(v_phone, v_pid, null);
  end if;
  if v_child_id is null then
    return jsonb_build_object(
      'ok', false,
      'error', 'person_unresolved',
      'request_id', v_row.request_id,
      'kind', v_kind
    );
  end if;
  return public.bind_sender_phone_to_person_v1(v_phone, null, v_child_id);
end;
$fn$;

create or replace function public.bind_family_event_sender_phone_v1(p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row public.family_events%rowtype;
  v_details jsonb := '{}'::jsonb;
  v_phone text;
  v_name text;
  v_branch text;
  v_child_id bigint;
  v_pid text;
  v_req text;
  v_ar_id bigint;
begin
  if p_id is null or to_regclass('public.family_events') is null then
    return jsonb_build_object('ok', false, 'error', 'bad_id');
  end if;
  select * into v_row from public.family_events where id = p_id limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'event_not_found');
  end if;
  begin
    if v_row.details is not null then
      v_details := v_row.details::jsonb;
    end if;
  exception when others then
    v_details := '{}'::jsonb;
  end;
  v_phone := coalesce(
    nullif(btrim(coalesce(v_row.source_phone, '')), ''),
    nullif(btrim(coalesce(v_details->>'submitter_phone', '')), ''),
    nullif(btrim(coalesce(v_details->>'source_phone', '')), ''),
    nullif(btrim(coalesce(v_row.contact_phone, '')), '')
  );
  v_name := coalesce(
    nullif(btrim(coalesce(v_details->>'submitter_name', '')), ''),
    nullif(btrim(coalesce(v_details#>>'{submitter,name}', '')), '')
  );
  v_branch := nullif(btrim(coalesce(v_row.branch_key, '')), '');
  v_req := nullif(btrim(coalesce(
    v_details->>'requestId',
    v_details->>'request_id',
    ''
  )), '');
  if v_req is not null then
    select ar.id into v_ar_id
    from public.approval_requests ar
    where ar.request_id = v_req
    order by ar.id desc
    limit 1;
    if v_ar_id is not null then
      return public.bind_approval_request_sender_phone_v1(v_ar_id);
    end if;
  end if;
  -- Only bind to the occasion person when the sender is that same person.
  if v_name is null or v_name = btrim(coalesce(v_row.person, '')) then
    begin
      v_pid := nullif(btrim(coalesce(v_details->>'person_id', v_details->>'personId', '')), '');
    exception when others then
      v_pid := null;
    end;
    if v_pid is not null then
      return public.bind_sender_phone_to_person_v1(v_phone, v_pid, null);
    end if;
    if v_name is null then
      v_name := nullif(btrim(coalesce(v_row.person, '')), '');
    end if;
  end if;
  v_child_id := public.tree_resolve_person_by_sender_name_v1(v_branch, v_name);
  if v_child_id is null then
    return jsonb_build_object('ok', false, 'error', 'person_unresolved');
  end if;
  return public.bind_sender_phone_to_person_v1(v_phone, null, v_child_id);
end;
$fn$;

create or replace function public.trg_approval_request_bind_sender_phone()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if nullif(btrim(coalesce(NEW.phone, '')), '') is null then
    return NEW;
  end if;
  if btrim(coalesce(NEW.kind, '')) in ('member_registration', 'member_phone_register')
     or position('MEMBER_PHONE_REGISTER_V1' in coalesce(NEW.message, '')) > 0 then
    return NEW;
  end if;
  begin
    perform public.bind_approval_request_sender_phone_v1(NEW.id);
  exception when others then
    null;
  end;
  return NEW;
end;
$fn$;

drop trigger if exists trg_approval_request_bind_sender_phone on public.approval_requests;
create trigger trg_approval_request_bind_sender_phone
after insert or update of phone, status, message, kind, branch_key, name
on public.approval_requests
for each row
execute function public.trg_approval_request_bind_sender_phone();

create or replace function public.trg_family_event_bind_sender_phone()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  begin
    perform public.bind_family_event_sender_phone_v1(NEW.id);
  exception when others then
    null;
  end;
  return NEW;
end;
$fn$;

drop trigger if exists trg_family_event_bind_sender_phone on public.family_events;
create trigger trg_family_event_bind_sender_phone
after insert or update of source_phone, contact_phone, details, person, branch_key
on public.family_events
for each row
execute function public.trg_family_event_bind_sender_phone();

-- Backfill already-accepted requests and member-published occasions.
create or replace function public.backfill_approval_request_sender_phones_v1()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  r record;
  v_ok int := 0;
  v_skip int := 0;
  v_res jsonb;
begin
  for r in
    select id
    from public.approval_requests
    where nullif(btrim(coalesce(phone, '')), '') is not null
      and coalesce(status, '') not in ('rejected', 'deleted', 'cancelled')
      and coalesce(kind, '') not in ('member_registration', 'member_phone_register')
      and position('MEMBER_PHONE_REGISTER_V1' in coalesce(message, '')) = 0
    order by id
  loop
    begin
      v_res := public.bind_approval_request_sender_phone_v1(r.id);
    exception when others then
      v_res := jsonb_build_object('ok', false, 'error', SQLERRM);
    end;
    if coalesce(v_res->>'ok', '') = 'true' then
      v_ok := v_ok + 1;
    else
      v_skip := v_skip + 1;
    end if;
  end loop;
  if to_regclass('public.family_events') is not null then
    for r in
      select id from public.family_events
      where coalesce(source_phone, contact_phone, '') <> ''
         or position('requestId' in coalesce(details, '')) > 0
         or position('submitter_phone' in coalesce(details, '')) > 0
      order by id
    loop
      begin
        v_res := public.bind_family_event_sender_phone_v1(r.id);
      exception when others then
        v_res := jsonb_build_object('ok', false, 'error', SQLERRM);
      end;
      if coalesce(v_res->>'ok', '') = 'true' then
        v_ok := v_ok + 1;
      else
        v_skip := v_skip + 1;
      end if;
    end loop;
  end if;
  return jsonb_build_object('ok', true, 'bound', v_ok, 'skipped', v_skip);
end;
$fn$;

revoke all on function public.bind_sender_phone_to_person_v1(text, text, bigint) from public;
revoke all on function public.bind_approval_request_sender_phone_v1(bigint) from public;
revoke all on function public.bind_family_event_sender_phone_v1(bigint) from public;
revoke all on function public.backfill_approval_request_sender_phones_v1() from public;
grant execute on function public.bind_sender_phone_to_person_v1(text, text, bigint) to authenticated;
grant execute on function public.bind_approval_request_sender_phone_v1(bigint) to authenticated;
grant execute on function public.bind_family_event_sender_phone_v1(bigint) to authenticated;
grant execute on function public.backfill_approval_request_sender_phones_v1() to authenticated;

select public.backfill_approval_request_sender_phones_v1();
