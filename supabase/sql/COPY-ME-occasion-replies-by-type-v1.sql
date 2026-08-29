-- Preset id: maint.occasion_replies_by_type_v1
-- ردود التفاعل حسب نوع المناسبة/الدعوة — ليست أزرار حضور لكل الأنواع.
-- Safe to re-run.

create or replace function public.occasion_normalize_event_type_v1(p text)
returns text
language plpgsql
immutable
as $$
declare
  v text := lower(nullif(btrim(coalesce(p, '')), ''));
begin
  if v is null then
    return 'general';
  end if;
  v := case v
    when 'اجتماع عائلي' then 'gathering'
    when 'اجتماع' then 'gathering'
    when 'meeting' then 'gathering'
    when 'لقاء عائلي' then 'family_meetup'
    when 'دعوة عائلية' then 'dinner'
    when 'دعوة' then 'dinner'
    when 'invitation' then 'dinner'
    when 'دعوة عشاء' then 'dinner'
    when 'دعوة غداء' then 'lunch'
    when 'وليمة' then 'feast'
    when 'فنجال بعد صلاة العصر' then 'finjal_asr'
    when 'فنجال العصر' then 'finjal_asr'
    when 'فنجال بعد صلاة العشاء' then 'finjal_isha'
    when 'فنجال العشاء' then 'finjal_isha'
    when 'فنجال والم اللي حولنا' then 'finjal_hawlna'
    when 'فنجال والم الي حولنا' then 'finjal_hawlna'
    when 'حيا الله' then 'hayya_allah'
    when 'حياه الله' then 'hayya_allah'
    when 'مناسبة عامة' then 'general'
    when 'other' then 'general'
    when 'حفل زواج' then 'wedding'
    when 'عقد قران' then 'contract'
    when 'خطوبة' then 'marriage'
    when 'engagement' then 'marriage'
    when 'زواج' then 'marriage'
    when 'تهنئة' then 'family_news'
    when 'تهنئة عائلية' then 'family_news'
    when 'congratulation' then 'family_news'
    when 'خبر عائلي' then 'family_news'
    when 'happy' then 'family_news'
    when 'travel' then 'family_news'
    when 'سفر' then 'family_news'
    when 'مولود' then 'birth'
    when 'مولود جديد' then 'birth'
    when 'تخرج' then 'graduation_notice'
    when 'حفل تخرج' then 'graduation'
    when 'ترقية' then 'promotion_notice'
    when 'تهنئة ترقية' then 'promotion_notice'
    when 'حفل ترقية' then 'promotion'
    when 'تقاعد' then 'retirement_notice'
    when 'حفل تقاعد' then 'retirement'
    when 'عقيقة' then 'aqiqa'
    when 'مريض' then 'sick'
    when 'عملية' then 'operation'
    when 'شفاء' then 'healing'
    when 'خروج من المستشفى' then 'discharge'
    when 'خروج من المستشفي' then 'discharge'
    when 'خروج' then 'discharge'
    when 'سلامة' then 'safety'
    when 'وفاة' then 'death'
    when 'إعلان وفاة' then 'death'
    when 'تعزية' then 'condolence'
    else v
  end;
  return v;
end;
$$;

create or replace function public.occasion_interaction_catalog_v1(
  p_event_type text,
  p_family text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text := public.occasion_normalize_event_type_v1(p_event_type);
begin
  return coalesce((
    select jsonb_agg(to_jsonb(t) order by t.sort_order, t.id)
    from public.occasion_interaction_types t
    where t.is_active
      and v_type = any (t.applies_to_types)
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.occasion_interaction_catalog_v1(text, text) from public;
grant execute on function public.occasion_interaction_catalog_v1(text, text) to anon, authenticated, service_role;

-- دعوة قهوة/غداء/اجتماع: حضور فقط — بلا «تفاصيل» أو «سأتواصل»
update public.occasion_interaction_types
set is_active = false
where key in ('inv_details', 'inv_contact');

update public.occasion_interaction_types
set
  label = 'بإذن الله حاضر',
  full_text = 'بإذن الله سأحضر',
  applies_to_types = array[
    'feast','gathering','family_meetup','dinner','lunch','general',
    'wedding','contract','graduation','promotion','retirement','aqiqa',
    'finjal_asr','finjal_isha','finjal_hawlna','hayya_allah'
  ]::text[],
  sort_order = 10,
  is_active = true
where key = 'inv_yes';

update public.occasion_interaction_types
set
  label = 'أعتذر',
  full_text = 'أعتذر عن الحضور',
  applies_to_types = array[
    'feast','gathering','family_meetup','dinner','lunch','general',
    'wedding','contract','graduation','promotion','retirement','aqiqa',
    'finjal_asr','finjal_isha','finjal_hawlna','hayya_allah'
  ]::text[],
  sort_order = 20,
  is_active = true
where key = 'inv_no';

update public.occasion_interaction_types
set
  label = 'إن شاء الله أحاول',
  full_text = 'إن شاء الله أحاول الحضور',
  applies_to_types = array[
    'feast','gathering','family_meetup','dinner','lunch','general',
    'wedding','contract','graduation','promotion','retirement','aqiqa',
    'finjal_asr','finjal_isha','finjal_hawlna','hayya_allah'
  ]::text[],
  sort_order = 30,
  is_active = true
where key = 'inv_maybe';

-- حفل زواج: تهنئة واحدة + حضور. الباقي يزدحم الأزرار.
update public.occasion_interaction_types
set is_active = false
where key in ('w_barak_alaykuma', 'w_jamaa', 'w_mubarak');

update public.occasion_interaction_types
set is_active = true, sort_order = 5
where key = 'w_barak_lakuma';

-- تهاني الأخبار لا تُخلط مع أزرار الحفل (حفل تخرج ≠ خبر تخرج)
update public.occasion_interaction_types t
set applies_to_types = array(
  select x from unnest(coalesce(t.applies_to_types, '{}'::text[])) as x
  where x not in ('promotion', 'graduation', 'retirement')
)
where t.family = 'news'
  and t.is_active
  and t.applies_to_types && array['promotion','graduation','retirement']::text[];

insert into public.occasion_interaction_types as t
  (key, family, applies_to_types, track, label, full_text, allows_message, sort_order, is_active)
values
  (
    'cer_barak',
    'occasion',
    array['graduation','promotion','retirement']::text[],
    null,
    'بارك الله لك',
    'بارك الله لك',
    false,
    5,
    true
  )
on conflict (key) do update set
  family = excluded.family,
  applies_to_types = excluded.applies_to_types,
  label = excluded.label,
  full_text = excluded.full_text,
  allows_message = excluded.allows_message,
  sort_order = excluded.sort_order,
  is_active = true;
