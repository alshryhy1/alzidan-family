-- COPY-ME: Preset id: maint.member_relations_journey_audit_v1
-- قراءة فقط. لا ينشئ جداول ولا يغيّر صفوفًا ولا يبني واجهة.
-- v2: زواج الابنة = صف tree_spouses حيث هي الزوجة (husband_id = الزوج).
--     المطابقة بهوية نسب مطبّعة (ة↔ه) لا بـ wife_person_id ولا بـ position خام.
--     الأبناء: mother_links + أبناء صف الزوج في الشجرة، لا spouse_id وحده.

create or replace function public.maint_rel_ar_norm_v1(p text)
returns text
language sql
immutable
as $$
  select lower(btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(coalesce(p, ''), '[\u064B-\u065F\u0670]', '', 'g'),
            'ـ', '', 'g'),
          '[أإآ]', 'ا', 'g'),
        'ة', 'ه', 'g'),
      'ى', 'ي', 'g')
  ));
$$;

create or replace function public.maint_rel_leaf_v1(p text)
returns text
language sql
immutable
as $$
  select public.maint_rel_ar_norm_v1(
    nullif(btrim(regexp_replace(coalesce(p, ''), '^.*/', '')), '')
  );
$$;

create or replace function public.maint_member_relations_journey_audit_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_has_mp boolean := to_regclass('public.member_profiles') is not null;
  v_has_tree boolean := to_regclass('public.tree_children') is not null;
  v_has_mothers boolean := to_regclass('public.tree_mother_links') is not null;
  v_has_spouses boolean := to_regclass('public.tree_spouses') is not null;
  v_has_approval boolean := to_regclass('public.approval_requests') is not null;
  v_has_events boolean := to_regclass('public.family_events') is not null;
  v_has_delegates boolean := to_regclass('public.delegates_v2') is not null;
  v_has_live_gifts boolean := to_regclass('public.live_gifts') is not null;
  v_related jsonb := '[]'::jsonb;
  v_id bigint;
  v_person text;
  v_branch text;
  v_path text;
  v_parent text;
  v_leaf text;
  v_phone_tail text;
  v_login text;
  v_father_id bigint;
  v_segs int;
  v_mother_name text;
  v_mother_family boolean;
  v_mother_conf text;
  v_brothers int := 0;
  v_sisters int := 0;
  v_spouse_id bigint;
  v_husband_id bigint;
  v_husband_path text;
  v_husband_branch text;
  v_wife_family boolean;
  v_wife_name text;
  v_wife_lineage text;
  v_spouse_status text;
  v_match_rule text;
  v_kids int := 0;
  v_kids_by_link int := 0;
  v_kids_by_parent int := 0;
  v_child_leaves text[] := '{}';
  v_npath text;
  v_nleaf text;
  v_nparent_leaf text;
  v_source text;
  v_note text;
begin
  select coalesce(jsonb_agg(c.relname order by c.relname), '[]'::jsonb)
    into v_related
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'v', 'm', 'p')
    and c.relname ~* '(tree|child|member|spouse|mother|nasab|person|approval|family_event|delegate|live_gift|live_session)';

  v_source := case
    when v_has_live_gifts and not v_has_tree then 'ليس مصدر شجرة العائلة (جداول بث حي)'
    when v_has_tree then 'مصدر شجرة العائلة'
    when v_has_approval or v_has_events or v_has_delegates then 'مصدر عائلة بلا جدول tree_children'
    else 'مصدر بلا جداول الشجرة المعروفة'
  end;

  if v_has_mp and v_has_tree then
    execute $q$
      select c.id, c.person_id::text, c.branch_key,
             coalesce(c.child_name, c.name),
             coalesce(c.parent_name, to_jsonb(c)->>'parent'),
             right(regexp_replace(coalesce(mp.phone, ''), '\D', '', 'g'), 4)
      from public.member_profiles mp
      join public.tree_children c on c.id = mp.tree_child_id
      where coalesce(mp.status, 'active') = 'active'
        and nullif(btrim(coalesce(mp.phone, '')), '') is not null
        and mp.tree_child_id is not null
        and lower(btrim(coalesce(c.gender, ''))) in
            ('daughter', 'female', 'f', 'أنثى', 'انثى', 'ابنة', 'بنت')
      order by mp.id desc
      limit 1
    $q$ into v_id, v_person, v_branch, v_path, v_parent, v_phone_tail;
    if v_id is not null then
      v_login := 'موجودة ومؤكدة';
    end if;
  end if;

  if v_id is null and v_has_tree then
    execute $q$
      select c.id, c.person_id::text, c.branch_key,
             coalesce(c.child_name, c.name),
             coalesce(c.parent_name, to_jsonb(c)->>'parent')
      from public.tree_children c
      where lower(btrim(coalesce(c.gender, ''))) in
            ('daughter', 'female', 'f', 'أنثى', 'انثى', 'ابنة', 'بنت')
      order by c.id desc
      limit 1
    $q$ into v_id, v_person, v_branch, v_path, v_parent;
    v_login := case
      when not v_has_mp then 'غير موجودة'
      else 'موجودة لكن غير مربوطة'
    end;
    v_phone_tail := null;
  end if;

  if not v_has_tree then
    v_note := case
      when v_has_live_gifts then
        'جدول tree_children غير موجود هنا. هذا المصدر يظهر جداول بث حي — شغّل البطاقة من إدارة عائلة الزيدان (alzidan.org) لا من مشروع آخر.'
      else
        'جدول tree_children غير موجود في هذا المصدر. لا إنشاء جداول من هذا الأمر.'
    end;
    return jsonb_build_object(
      'ok', true,
      'rows', 0,
      'audit_revision', 'v2-spouse-identity-norm',
      'has_member_profiles', v_has_mp,
      'has_tree_children', v_has_tree,
      'has_tree_mother_links', v_has_mothers,
      'has_tree_spouses', v_has_spouses,
      'has_approval_requests', v_has_approval,
      'has_family_events', v_has_events,
      'has_delegates_v2', v_has_delegates,
      'has_live_gifts', v_has_live_gifts,
      'source', v_source,
      'related_tables', v_related,
      'note', v_note
    );
  end if;

  if v_id is null then
    return jsonb_build_object(
      'ok', true,
      'audit_revision', 'v2-spouse-identity-norm',
      'has_member_profiles', v_has_mp,
      'has_tree_children', v_has_tree,
      'source', v_source,
      'related_tables', v_related,
      'rows', 0,
      'note', 'لا صف ابنة/أنثى في الشجرة لاختبار الرحلة'
    );
  end if;

  v_leaf := nullif(btrim(regexp_replace(coalesce(v_path, ''), '^.*/', '')), '');
  v_segs := coalesce(cardinality(array_remove(string_to_array(btrim(coalesce(v_path, '')), '/'), '')), 0);
  v_npath := public.maint_rel_ar_norm_v1(v_path);
  v_nleaf := public.maint_rel_leaf_v1(v_path);
  v_nparent_leaf := public.maint_rel_leaf_v1(v_parent);

  if nullif(btrim(coalesce(v_parent, '')), '') is not null then
    execute $q$
      select f.id
      from public.tree_children f
      where f.branch_key is not distinct from $1
        and coalesce(f.child_name, f.name) = $2
      order by f.id
      limit 1
    $q$ into v_father_id using v_branch, v_parent;

    execute $q$
      select
        count(*) filter (
          where lower(btrim(coalesce(s.gender, ''))) not in
            ('daughter', 'female', 'f', 'أنثى', 'انثى', 'ابنة', 'بنت')
        ),
        count(*) filter (
          where lower(btrim(coalesce(s.gender, ''))) in
            ('daughter', 'female', 'f', 'أنثى', 'انثى', 'ابنة', 'بنت')
        )
      from public.tree_children s
      where s.id is distinct from $1
        and s.branch_key is not distinct from $2
        and coalesce(s.parent_name, to_jsonb(s)->>'parent') = $3
    $q$ into v_brothers, v_sisters using v_id, v_branch, v_parent;
  end if;

  if v_has_mothers then
    execute $q$
      select l.mother_name, coalesce(l.mother_is_family_member, false), l.confidence
      from public.tree_mother_links l
      where l.child_id = $1
      order by l.child_id
      limit 1
    $q$ into v_mother_name, v_mother_family, v_mother_conf using v_id;
  end if;

  if v_has_spouses then
    execute $q$
      select
        sp.id,
        sp.husband_id,
        coalesce(sp.wife_is_family_member, false),
        coalesce(sp.wife_name, ''),
        coalesce(sp.wife_lineage, ''),
        coalesce(sp.status, 'active'),
        case
          when $4 is not null
           and nullif(to_jsonb(sp)->>'wife_person_id', '') = $4
            then 'wife_person_id'
          when public.maint_rel_ar_norm_v1(sp.wife_lineage) = $1
            then 'wife_lineage_eq_path'
          when replace(public.maint_rel_ar_norm_v1(sp.wife_lineage), '/', ' ')
             = replace($1, '/', ' ')
            then 'wife_lineage_eq_path_spaces'
          when public.maint_rel_leaf_v1(coalesce(sp.wife_lineage, sp.wife_name)) = $2
           and $3 is not null
           and position(
                 $3 in replace(
                   public.maint_rel_ar_norm_v1(
                     coalesce(sp.wife_lineage, '') || ' ' || coalesce(sp.wife_name, '')
                   ),
                   '/',
                   ' '
                 )
               ) > 0
            then 'leaf_plus_father'
          when public.maint_rel_leaf_v1(sp.wife_name) = $2
           and $3 is not null
           and public.maint_rel_ar_norm_v1(sp.wife_branch_key)
             = public.maint_rel_ar_norm_v1($5)
            then 'wife_name_leaf_same_branch'
          else 'matched'
        end
      from public.tree_spouses sp
      where
        (
          $4 is not null
          and nullif(to_jsonb(sp)->>'wife_person_id', '') = $4
        )
        or public.maint_rel_ar_norm_v1(sp.wife_lineage) = $1
        or replace(public.maint_rel_ar_norm_v1(sp.wife_lineage), '/', ' ')
           = replace($1, '/', ' ')
        or (
          public.maint_rel_leaf_v1(coalesce(sp.wife_lineage, sp.wife_name)) = $2
          and $3 is not null
          and position(
                $3 in replace(
                  public.maint_rel_ar_norm_v1(
                    coalesce(sp.wife_lineage, '') || ' ' || coalesce(sp.wife_name, '')
                  ),
                  '/',
                  ' '
                )
              ) > 0
        )
        or (
          public.maint_rel_leaf_v1(sp.wife_name) = $2
          and $3 is not null
          and public.maint_rel_ar_norm_v1(sp.wife_branch_key)
            = public.maint_rel_ar_norm_v1($5)
        )
      order by
        case when lower(btrim(coalesce(sp.status, 'active'))) in ('', 'active') then 0 else 1 end,
        sp.id
      limit 1
    $q$ into
      v_spouse_id, v_husband_id, v_wife_family, v_wife_name, v_wife_lineage,
      v_spouse_status, v_match_rule
    using v_npath, v_nleaf, v_nparent_leaf, v_person, v_branch;
  end if;

  if v_husband_id is not null then
    execute $q$
      select coalesce(h.child_name, h.name), h.branch_key
      from public.tree_children h
      where h.id = $1
      limit 1
    $q$ into v_husband_path, v_husband_branch using v_husband_id;
  end if;

  if v_has_mothers then
    execute $q$
      select coalesce(array_agg(distinct public.maint_rel_leaf_v1(coalesce(c.child_name, c.name))
                                order by public.maint_rel_leaf_v1(coalesce(c.child_name, c.name))), '{}'),
             count(distinct l.child_id)
      from public.tree_mother_links l
      left join public.tree_children c on c.id = l.child_id
      where
        ($1 is not null and l.spouse_id = $1)
        or public.maint_rel_ar_norm_v1(l.mother_lineage) = $2
        or (
          public.maint_rel_leaf_v1(coalesce(l.mother_name, l.mother_lineage)) = $3
          and $4 is not null
          and position(
                $4 in replace(
                  public.maint_rel_ar_norm_v1(
                    coalesce(l.mother_lineage, '') || ' ' || coalesce(l.mother_name, '')
                  ),
                  '/',
                  ' '
                )
              ) > 0
        )
    $q$ into v_child_leaves, v_kids_by_link
    using v_spouse_id, v_npath, v_nleaf, v_nparent_leaf;
  end if;

  if v_husband_id is not null and v_husband_path is not null then
    execute $q$
      select count(*)
      from public.tree_children c
      where c.id is distinct from $1
        and c.branch_key is not distinct from $2
        and (
          coalesce(c.parent_name, to_jsonb(c)->>'parent') = $3
          or public.maint_rel_ar_norm_v1(coalesce(c.parent_name, to_jsonb(c)->>'parent'))
             = public.maint_rel_ar_norm_v1($3)
        )
    $q$ into v_kids_by_parent using v_id, v_husband_branch, v_husband_path;

    execute $q$
      select coalesce(
        $1 || array_agg(public.maint_rel_leaf_v1(coalesce(c.child_name, c.name)) order by c.id),
        $1
      )
      from public.tree_children c
      where c.id is distinct from $2
        and c.branch_key is not distinct from $3
        and (
          coalesce(c.parent_name, to_jsonb(c)->>'parent') = $4
          or public.maint_rel_ar_norm_v1(coalesce(c.parent_name, to_jsonb(c)->>'parent'))
             = public.maint_rel_ar_norm_v1($4)
        )
    $q$ into v_child_leaves using v_child_leaves, v_id, v_husband_branch, v_husband_path;
  end if;

  v_kids := greatest(coalesce(v_kids_by_link, 0), coalesce(v_kids_by_parent, 0));
  if v_child_leaves is not null then
    select coalesce(array_agg(distinct x), '{}') into v_child_leaves
    from unnest(v_child_leaves) as x
    where nullif(btrim(coalesce(x, '')), '') is not null;
  end if;

  if not v_has_mp then
    v_login := coalesce(v_login, 'غير موجودة');
  end if;

  return jsonb_build_object(
    'ok', true,
    'audit_revision', 'v2-spouse-identity-norm',
    'previous_miss', jsonb_build_object(
      'why', 'الاستعلام السابق طلب wife_person_id (غالبًا غير موجود)، وطابق المسار/الاسم بلا تطبيع ة↔ه، وفلتر status=active فقط، وعدّ الأبناء فقط عبر mother_links.spouse_id بعد فشل صف الزواج',
      'do_not_use_v1_for_build', true
    ),
    'has_member_profiles', v_has_mp,
    'has_tree_children', v_has_tree,
    'source', v_source,
    'related_tables', v_related,
    'tree_child_id', v_id,
    'branch_key', v_branch,
    'phone_last4', v_phone_tail,
    'leaf_name', v_leaf,
    'spouse_capture', jsonb_build_object(
      'spouse_id', v_spouse_id,
      'husband_id', v_husband_id,
      'husband_path', v_husband_path,
      'husband_branch', v_husband_branch,
      'wife_name', v_wife_name,
      'wife_lineage', v_wife_lineage,
      'wife_is_family_member', v_wife_family,
      'status', v_spouse_status,
      'match_rule', v_match_rule
    ),
    'children_capture', jsonb_build_object(
      'by_mother_links', coalesce(v_kids_by_link, 0),
      'by_husband_parent', coalesce(v_kids_by_parent, 0),
      'leaves', to_jsonb(coalesce(v_child_leaves, '{}'))
    ),
    'journey', jsonb_build_array(
      jsonb_build_object(
        'ring', 'دخول بجوال',
        'status', v_login,
        'note', case
          when not v_has_mp then 'جدول member_profiles غير موجود في المصدر'
          when v_phone_tail is not null then 'جوال مربوط'
          else 'صف شجرة بلا دخول'
        end
      ),
      jsonb_build_object('ring', 'أنا (صف الشجرة)', 'status', 'موجودة ومؤكدة', 'note', coalesce(v_path, '')),
      jsonb_build_object(
        'ring', 'أبي',
        'status', case
          when nullif(btrim(coalesce(v_parent, '')), '') is null then 'غير موجودة'
          when v_father_id is not null then 'موجودة ومؤكدة'
          else 'موجودة لكن غير مربوطة'
        end,
        'note', coalesce(v_parent, '')
      ),
      jsonb_build_object(
        'ring', 'جدي / فرعي',
        'status', case
          when v_segs >= 3 then 'موجودة ومؤكدة'
          when v_segs >= 2 then 'موجودة لكن غير مربوطة'
          else 'غير موجودة'
        end,
        'note', coalesce(v_branch, '') || ' · أجزاء المسار ' || v_segs::text
      ),
      jsonb_build_object(
        'ring', 'أمي',
        'status', case
          when not v_has_mothers then 'غير موجودة'
          when v_mother_name is null and v_mother_family is not true then 'غير موجودة'
          when v_mother_family = true
           and lower(btrim(coalesce(v_mother_conf, 'confirmed'))) in ('', 'confirmed')
            then 'موجودة ومؤكدة'
          else 'موجودة لكن غير مربوطة'
        end,
        'note', coalesce(v_mother_name, '')
      ),
      jsonb_build_object(
        'ring', 'إخوتي الذكور',
        'status', case when v_brothers > 0 then 'موجودة ومؤكدة' else 'غير موجودة' end,
        'note', v_brothers::text || ' أخ'
      ),
      jsonb_build_object(
        'ring', 'أخواتي',
        'status', case when v_sisters > 0 then 'موجودة ومؤكدة' else 'غير موجودة' end,
        'note', v_sisters::text || ' أخت في الشجرة (مخفيات عن العامة)'
      ),
      jsonb_build_object(
        'ring', 'زواجي',
        'status', case
          when not v_has_spouses then 'غير موجودة'
          when v_spouse_id is null then 'غير موجودة'
          when v_husband_id is not null then 'موجودة ومؤكدة'
          else 'موجودة لكن غير مربوطة'
        end,
        'note', coalesce(
          nullif(btrim(coalesce(v_husband_path, '')), ''),
          v_wife_name,
          v_wife_lineage,
          ''
        ) || coalesce(' · ' || v_match_rule, '')
      ),
      jsonb_build_object(
        'ring', 'أسرتي / أبنائي',
        'status', case
          when v_kids > 0 then 'موجودة ومؤكدة'
          when v_spouse_id is not null then 'موجودة لكن غير مربوطة'
          else 'غير موجودة'
        end,
        'note', coalesce(v_kids_by_link, 0)::text || ' من أمومة · '
             || coalesce(v_kids_by_parent, 0)::text || ' تحت صف الزوج'
      )
    )
  );
end;
$fn$;

revoke all on function public.maint_rel_ar_norm_v1(text) from public;
revoke all on function public.maint_rel_leaf_v1(text) from public;
revoke all on function public.maint_member_relations_journey_audit_v1() from public;
grant execute on function public.maint_rel_ar_norm_v1(text) to authenticated;
grant execute on function public.maint_rel_leaf_v1(text) to authenticated;
grant execute on function public.maint_member_relations_journey_audit_v1() to authenticated;

select public.maint_member_relations_journey_audit_v1() as journey;
