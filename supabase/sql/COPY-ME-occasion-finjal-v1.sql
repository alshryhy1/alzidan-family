-- Preset id: maint.occasion_finjal_v1
-- فنجال بعد العصر / العشاء / والم اللي حولنا / حيا الله — ردود حضور مثل الدعوة.
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

update public.occasion_interaction_types
set
  applies_to_types = array[
    'feast','gathering','family_meetup','dinner','lunch','general',
    'wedding','contract','graduation','promotion','retirement','aqiqa',
    'finjal_asr','finjal_isha','finjal_hawlna','hayya_allah'
  ]::text[],
  is_active = true
where key in ('inv_yes', 'inv_no', 'inv_maybe');
