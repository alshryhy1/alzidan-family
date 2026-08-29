-- COPY-ME: Preset id: maint.member_phone_register_v2
-- طلب تسجيل الجوال ليس تصحيحاً ولا مناسبة ولا بطاقة شجرة.
-- لا ربط تلقائي بالاسم. لا دخول قبل أن تسجّل الإدارة/المندوب الرقم على شخص بالاسم والأيدي.

create or replace function public.is_member_phone_register_request_v1(p_kind text, p_message text)
returns boolean
language sql
immutable
as $$
  select
    btrim(coalesce(p_kind, '')) in ('member_registration', 'member_phone_register')
    or position('MEMBER_PHONE_REGISTER_V1' in coalesce(p_message, '')) > 0
$$;

create or replace function public.trg_approval_request_register_phone()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if nullif(btrim(coalesce(NEW.phone, '')), '') is null then
    return NEW;
  end if;
  if public.is_member_phone_register_request_v1(NEW.kind, NEW.message) then
    return NEW;
  end if;
  begin
    perform public.register_sender_phone_v1(
      NEW.phone,
      coalesce(NEW.name, ''),
      NEW.branch_key,
      null
    );
  exception when others then
    null;
  end;
  begin
    if to_regprocedure('public.bind_approval_request_sender_phone_v1(bigint)') is not null then
      perform public.bind_approval_request_sender_phone_v1(NEW.id);
    end if;
  exception when others then
    null;
  end;
  return NEW;
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
  if public.is_member_phone_register_request_v1(NEW.kind, NEW.message) then
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

alter table public.approval_requests drop constraint if exists kind_check;
alter table public.approval_requests add constraint kind_check check (
  kind is null or length(btrim(kind)) > 0
);

drop trigger if exists trg_approval_request_register_phone on public.approval_requests;
drop trigger if exists trg_approval_request_bind_sender_phone on public.approval_requests;
create trigger trg_approval_request_register_phone
after insert or update of phone, status, message, kind, branch_key, name
on public.approval_requests
for each row
execute function public.trg_approval_request_register_phone();

drop trigger if exists trg_member_phone_register_require_tree_name on public.approval_requests;

-- Legacy rows were inserted as tree_edit; isolate them.
update public.approval_requests
set kind = 'member_phone_register'
where public.is_member_phone_register_request_v1(kind, message)
  and btrim(coalesce(kind, '')) is distinct from 'member_phone_register';

-- Undo logins created automatically from a still-pending register request.
delete from public.member_profiles mp
where exists (
  select 1
  from public.approval_requests r
  where r.status = 'pending'
    and public.is_member_phone_register_request_v1(r.kind, r.message)
    and nullif(btrim(coalesce(r.phone, '')), '') is not null
    and char_length(right(regexp_replace(coalesce(r.phone, ''), '\D', '', 'g'), 9)) = 9
    and right(regexp_replace(coalesce(mp.phone, ''), '\D', '', 'g'), 9)
      = right(regexp_replace(coalesce(r.phone, ''), '\D', '', 'g'), 9)
);

-- Gate: register-phone requests only if the triple name exists in that branch.
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

create or replace function public.member_phone_register_name_in_tree_v1(p_branch text, p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_branch text := nullif(btrim(coalesce(p_branch, '')), '');
  v_tokens text[];
begin
  if v_branch is null then
    return false;
  end if;
  select coalesce(array(
    select t from (
      select public.member_phone_fold_ar_v1(x) as t
      from unnest(regexp_split_to_array(btrim(coalesce(p_name, '')), '\s+')) as x
    ) s
    where t is not null and t not in ('بن', 'ابن')
    limit 3
  ), '{}'::text[]) into v_tokens;
  if coalesce(array_length(v_tokens, 1), 0) < 3 then
    return false;
  end if;

  return exists (
    select 1
    from (
      select
        public.member_phone_fold_ar_v1(
          replace(
            case
              when position('/' in coalesce(c.child_name, c.name, '')) > 0
                then coalesce(c.child_name, c.name, '')
              else btrim(coalesce(c.parent_name, '') || '/' || coalesce(c.child_name, c.name, ''), '/')
            end,
            '/',
            ' '
          )
        ) as hay,
        public.member_phone_fold_ar_v1(
          nullif(btrim(regexp_replace(
            btrim(coalesce(c.child_name, c.name, '')),
            '^.*/',
            ''
          )), '')
        ) as leaf
      from public.tree_children c
      where btrim(coalesce(c.branch_key, '')) = v_branch
    ) s
    where s.leaf = v_tokens[1]
      and position(v_tokens[1] in coalesce(s.hay, '')) > 0
      and position(v_tokens[2] in coalesce(s.hay, '')) > 0
      and position(v_tokens[3] in coalesce(s.hay, '')) > 0
  );
end;
$fn$;

create or replace function public.trg_member_phone_register_require_tree_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not public.is_member_phone_register_request_v1(NEW.kind, NEW.message) then
    return NEW;
  end if;
  if public.member_phone_register_name_in_tree_v1(NEW.branch_key, NEW.name) then
    return NEW;
  end if;
  raise exception 'الاسم الثلاثي غير موجود في هذا الفرع';
end;
$fn$;

drop trigger if exists trg_member_phone_register_require_tree_name on public.approval_requests;
create trigger trg_member_phone_register_require_tree_name
before insert or update of kind, name, branch_key, message
on public.approval_requests
for each row
execute function public.trg_member_phone_register_require_tree_name();

revoke all on function public.member_phone_register_name_in_tree_v1(text, text) from public;
grant execute on function public.member_phone_register_name_in_tree_v1(text, text) to anon, authenticated;

