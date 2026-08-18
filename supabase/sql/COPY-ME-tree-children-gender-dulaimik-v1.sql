-- COPY-ME: Supabase → SQL Editor → Run
-- Preset id: maint.tree_children_gender_dulaimik_v1
--
-- الوجود ≠ الظهور. لا حذف.
-- الصفوف تحت خميس بن دليميك حُفظت بلا ختم ابنة، فالقراءة العامة
-- (تطبيق المتجر) أظهرتها. هذا يختم الجنس ويعيد سياسة SELECT العامة.
-- آمن لإعادة التشغيل.

alter table public.tree_children add column if not exists gender text;

create or replace function public.tree_child_normalize_gender(p_gender text)
returns text
language sql
immutable
as $$
  select case
    when g in ('daughter', 'female', 'f', 'أنثى', 'انثى', 'ابنة', 'بنت') then 'daughter'
    when g in ('son', 'male', 'm', 'ذكر', 'ابن') then 'son'
    else null
  end
  from (select lower(btrim(coalesce(p_gender, ''))) as g) s;
$$;

grant execute on function public.tree_child_normalize_gender(text) to anon, authenticated;

update public.tree_children c
set gender = 'daughter'
where c.gender is distinct from 'daughter'
  and nullif(btrim(regexp_replace(coalesce(c.child_name, c.name, ''), '^.*/', '')), '')
      in ('هله', 'هلة', 'حصه', 'حصة', 'فاطمة', 'وضحاء')
  and (
    coalesce(c.parent_name, c.parent, '') like '%دليميك%'
    or coalesce(c.child_name, c.name, '') like '%دليميك%'
  );

alter table public.tree_children enable row level security;

drop policy if exists "tree_children_select_all" on public.tree_children;
drop policy if exists tree_children_select_all on public.tree_children;
drop policy if exists "tree_children_select_public" on public.tree_children;
drop policy if exists tree_children_select_public on public.tree_children;

create policy "tree_children_select_public"
on public.tree_children
for select
to anon, authenticated
using (
  lower(btrim(coalesce(gender, ''))) not in (
    'daughter', 'female', 'f', 'أنثى', 'انثى', 'ابنة', 'بنت'
  )
);

revoke insert, update, delete on table public.tree_children from anon, authenticated;
grant select on table public.tree_children to anon, authenticated;

notify pgrst, 'reload schema';

select
  c.id,
  c.branch_key,
  c.parent_name,
  c.child_name,
  c.gender
from public.tree_children c
where coalesce(c.parent_name, c.parent, '') like '%دليميك%'
   or coalesce(c.child_name, c.name, '') like '%دليميك%'
order by c.id;
