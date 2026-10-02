-- Preset id: maint.occasion_health_replies_by_type_v1
-- ردود الصحة حسب الحالة: مرض ≠ شفاء ≠ سلامة. بلا «لا بأس طهور» على السلامة.
-- Safe to re-run.

update public.occasion_interaction_types
set
  applies_to_types = array['sick', 'operation']::text[],
  is_active = true
where key = 'heal_ask';

update public.occasion_interaction_types
set
  applies_to_types = array['sick', 'operation']::text[],
  is_active = true
where key = 'heal_tahoor';

update public.occasion_interaction_types
set
  applies_to_types = array['sick', 'operation', 'healing', 'discharge']::text[],
  is_active = true
where key = 'heal_shifa';

update public.occasion_interaction_types
set
  applies_to_types = array['sick', 'operation', 'healing', 'discharge']::text[],
  is_active = true
where key = 'heal_duat';

update public.occasion_interaction_types
set
  applies_to_types = array['sick', 'operation', 'healing', 'discharge', 'safety']::text[],
  is_active = true
where key = 'heal_tamam';

update public.occasion_interaction_types
set
  applies_to_types = array['sick', 'operation', 'healing', 'discharge', 'safety']::text[],
  is_active = true
where key = 'msg_health';

insert into public.occasion_interaction_types as t
  (key, family, applies_to_types, track, label, full_text, allows_message, sort_order, is_active)
values
  (
    'heal_salama',
    'health',
    array['healing', 'discharge', 'safety']::text[],
    null,
    'الحمد لله على السلامة',
    'الحمد لله على السلامة',
    false,
    6,
    true
  ),
  (
    'heal_dawam',
    'health',
    array['healing', 'discharge', 'safety']::text[],
    null,
    'أسأل الله دوام العافية',
    'أسأل الله له دوام العافية',
    false,
    12,
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

select
  key,
  label,
  applies_to_types
from public.occasion_interaction_types
where family = 'health'
  and is_active
order by sort_order, key;
