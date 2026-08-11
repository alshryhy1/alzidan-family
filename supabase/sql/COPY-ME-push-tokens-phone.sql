-- COPY-ME: push_tokens.phone + register_push_token_v1(p_phone)
-- Run in Supabase SQL editor (wbskjfdqpugnwvrykqcn).
-- Safe/additive: adds optional phone for branch-delegate targeted Expo push.
-- Public family broadcast push path is unchanged (still all enabled tokens).

alter table public.push_tokens
  add column if not exists phone text;

comment on column public.push_tokens.phone is
  'Optional Saudi mobile (05XXXXXXXX) bound for branch-delegate targeted push.';

create index if not exists push_tokens_phone_enabled_idx
  on public.push_tokens (phone)
  where enabled = true and phone is not null and btrim(phone) <> '';

-- Normalize Arabic/Persian/fullwidth digits then keep digits only.
create or replace function public.push_tokens_norm_phone(p text)
returns text
language plpgsql
immutable
as $$
declare
  s text := coalesce(p, '');
  i int;
  ch text;
  code int;
  out text := '';
begin
  for i in 1..char_length(s) loop
    ch := substr(s, i, 1);
    code := ascii(ch);
    if code >= 1632 and code <= 1641 then -- Arabic-Indic ٠-٩
      out := out || chr(code - 1632 + 48);
    elsif code >= 1776 and code <= 1785 then -- Eastern Arabic-Indic ۰-۹
      out := out || chr(code - 1776 + 48);
    elsif code >= 65296 and code <= 65305 then -- Fullwidth ０-９
      out := out || chr(code - 65296 + 48);
    else
      out := out || ch;
    end if;
  end loop;
  out := regexp_replace(out, '\D', '', 'g');
  if out like '00966%' and char_length(out) = 14 and substr(out, 6, 1) = '5' then
    return '0' || substr(out, 6);
  end if;
  if out like '966%' and char_length(out) = 12 and substr(out, 4, 1) = '5' then
    return '0' || substr(out, 4);
  end if;
  if char_length(out) = 9 and substr(out, 1, 1) = '5' then
    return '0' || out;
  end if;
  return out;
end;
$$;

-- Replace 4-arg overload so optional p_phone works without ambiguity.
drop function if exists public.register_push_token_v1(text, text, text, text);
drop function if exists public.register_push_token_v1(text, text, text, text, text);

create or replace function public.register_push_token_v1(
  p_token text,
  p_platform text,
  p_device_name text default null,
  p_app_version text default null,
  p_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text := btrim(coalesce(p_token, ''));
  v_phone text := nullif(public.push_tokens_norm_phone(p_phone), '');
begin
  if v_token = '' then
    return jsonb_build_object('ok', false, 'error', 'missing_token');
  end if;

  insert into public.push_tokens as t (
    token, platform, device_name, app_version, phone, enabled, updated_at
  )
  values (
    v_token,
    nullif(btrim(coalesce(p_platform, '')), ''),
    p_device_name,
    p_app_version,
    v_phone,
    true,
    now()
  )
  on conflict (token) do update set
    platform = excluded.platform,
    device_name = excluded.device_name,
    app_version = excluded.app_version,
    -- Keep prior binding if this registration omits phone.
    phone = coalesce(excluded.phone, t.phone),
    enabled = true,
    updated_at = now();

  return jsonb_build_object('ok', true, 'phone', v_phone);
end;
$$;

revoke all on function public.register_push_token_v1(text, text, text, text, text) from public;
grant execute on function public.register_push_token_v1(text, text, text, text, text) to anon, authenticated;
grant execute on function public.push_tokens_norm_phone(text) to anon, authenticated;
