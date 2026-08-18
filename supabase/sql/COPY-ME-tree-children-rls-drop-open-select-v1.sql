-- COPY-ME: Supabase → SQL Editor → Run
-- Preset id: maint.tree_children_rls_drop_open_select_v1
--
-- الختم نجح، لكن التطبيق العام ما زال يراهن لأن سياسات SELECT
-- المتعددة في Postgres تُجمع بـ OR. إن بقيت سياسة using (true)
-- فالحجب لا يعمل. هذا يسقط كل سياسات SELECT ويبقي حجب المصدر فقط.
-- لا حذف. لا تغيير جنس. آمن لإعادة التشغيل.

alter table public.tree_children enable row level security;

do $$
declare
  r record;
begin
  for r in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'tree_children'
  loop
    execute format('drop policy if exists %I on public.tree_children', r.policyname);
  end loop;
end
$$;

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
grant select on public.tree_children to anon, authenticated;

notify pgrst, 'reload schema';

select
  pol.polname as policy,
  pol.polcmd as cmd,
  pg_get_expr(pol.polqual, pol.polrelid) as using_expr
from pg_policy pol
join pg_class cls on cls.oid = pol.polrelid
join pg_namespace nsp on nsp.oid = cls.relnamespace
where nsp.nspname = 'public'
  and cls.relname = 'tree_children'
order by pol.polname;

select
  c.relrowsecurity as rls_on
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'tree_children';
