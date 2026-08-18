-- COPY-ME: small patch — Preset id: maint.tree_mother_identity_strict_v1
-- Stop treating two wives as the same mother just because the first name matches.

create or replace function public.tree_mother_spouses_share_identity_v1(
  p_lineage_a text,
  p_name_a text,
  p_lineage_b text,
  p_name_b text
)
returns boolean
language sql
immutable
as $$
  select
    (
      coalesce(nullif(btrim(p_lineage_a), ''), nullif(btrim(p_name_a), '')) is not null
      and coalesce(nullif(btrim(p_lineage_b), ''), nullif(btrim(p_name_b), '')) is not null
    )
    and (
      (
        nullif(btrim(p_lineage_a), '') is not null
        and nullif(btrim(p_lineage_b), '') is not null
        and public.tree_arabic_norm_v1(p_lineage_a) = public.tree_arabic_norm_v1(p_lineage_b)
      )
      or (
        nullif(btrim(p_name_a), '') is not null
        and nullif(btrim(p_name_b), '') is not null
        and public.tree_arabic_norm_v1(p_name_a) = public.tree_arabic_norm_v1(p_name_b)
        and cardinality(public.tree_nasab_tokens_v1(p_name_a)) >= 2
        and cardinality(public.tree_nasab_tokens_v1(p_name_b)) >= 2
      )
      or (
        public.tree_nasab_nth_v1(coalesce(p_name_a, p_lineage_a, ''), 1) is not null
        and public.tree_nasab_nth_v1(coalesce(p_name_a, p_lineage_a, ''), 2) is not null
        and public.tree_nasab_nth_v1(coalesce(p_name_b, p_lineage_b, ''), 1) is not null
        and public.tree_nasab_nth_v1(coalesce(p_name_b, p_lineage_b, ''), 2) is not null
        and public.tree_nasab_nth_v1(coalesce(p_name_a, p_lineage_a, ''), 1)
          = public.tree_nasab_nth_v1(coalesce(p_name_b, p_lineage_b, ''), 1)
        and public.tree_nasab_nth_v1(coalesce(p_name_a, p_lineage_a, ''), 2)
          = public.tree_nasab_nth_v1(coalesce(p_name_b, p_lineage_b, ''), 2)
      )
    );
$$;

grant execute on function public.tree_mother_spouses_share_identity_v1(text, text, text, text) to anon, authenticated;
notify pgrst, 'reload schema';
select true as mother_identity_strict;
