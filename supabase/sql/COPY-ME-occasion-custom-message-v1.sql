-- Preset id: maint.occasion_custom_message_v1
-- رد مكتوب («رسالة خاصة») لأنواع الدعوة/الفنجال/الحفل التي كانت حضورًا فقط.
-- الأنواع التي لديها رسالة خاصة مسبقًا لا تُمس.
-- Safe to re-run.

insert into public.occasion_interaction_types as t
  (key, family, applies_to_types, track, label, full_text, allows_message, sort_order, is_active)
values
  (
    'msg_custom',
    'occasion',
    array[
      'feast','gathering','family_meetup','dinner','lunch','general',
      'finjal_asr','finjal_isha','finjal_hawlna','hayya_allah',
      'graduation','promotion','retirement'
    ]::text[],
    null,
    'رسالة خاصة',
    'رسالة خاصة',
    true,
    90,
    true
  )
on conflict (key) do update set
  family = excluded.family,
  applies_to_types = excluded.applies_to_types,
  label = excluded.label,
  full_text = excluded.full_text,
  allows_message = true,
  sort_order = excluded.sort_order,
  is_active = true;
