(function () {
  "use strict";

  function normalize(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function normalizeSearchText(value) {
    return normalize(value)
      .toLowerCase()
      .replace(/[\u064B-\u065F\u0670]/g, "")
      .replace(/ـ/g, "")
      .replace(/[\u0622\u0623\u0625]/g, "ا")
      .replace(/\s+/g, " ")
      .trim();
  }

  function matchesOrderedSubstring(query, target) {
    var q = normalizeSearchText(query);
    if (!q) return true;
    var t = normalizeSearchText(target);
    if (!t) return false;

    // Match contiguous sequence as typed (e.g. "ح" -> "حس" narrows down).
    if (t.indexOf(q) !== -1) return true;

    // Also allow matching across spaces when users type without spaces.
    var qNoSpace = q.replace(/\s+/g, "");
    var tNoSpace = t.replace(/\s+/g, "");
    return !!qNoSpace && tNoSpace.indexOf(qNoSpace) !== -1;
  }

  function wifeDuplicateKey(value) {
    return normalize(value)
      .replace(/\b(بن|ابن|بنت)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function hasThreePartWifeName(value) {
    return wifeDuplicateKey(value).split(" ").filter(Boolean).length >= 3;
  }

  async function findDuplicateWife(client, husbandId, row, editingSpouseId) {
    const candidate = row && row.wife_lineage && hasThreePartWifeName(row.wife_lineage)
      ? row.wife_lineage
      : (row && row.wife_name ? row.wife_name : "");

    if (!hasThreePartWifeName(candidate)) return null;

    const key = wifeDuplicateKey(candidate);
    const { data, error } = await client
      .from("tree_spouses")
      .select("id,husband_id,wife_name,wife_lineage")
      .limit(1000);

    if (error) throw error;

    const list = Array.isArray(data) ? data : [];
    return list.find(function (item) {
      if (editingSpouseId && Number(item.id) === Number(editingSpouseId)) return false;
      if (Number(item.husband_id) === Number(husbandId)) return false;
      const other = item.wife_lineage && hasThreePartWifeName(item.wife_lineage)
        ? item.wife_lineage
        : item.wife_name;
      return hasThreePartWifeName(other) && wifeDuplicateKey(other) === key;
    }) || null;
  }

  async function loadSpousesByHusband(client, husbandId) {
    const hid = Number(husbandId || 0);
    if (!hid) return { data: [], error: null };

    const base = await client
      .from("tree_spouses")
      .select("id,husband_id,wife_name,wife_is_family_member,wife_branch_key,wife_family_name,wife_lineage,marriage_order,status,confidence")
      .eq("husband_id", hid)
      .order("marriage_order", { ascending: true })
      .order("id", { ascending: true });

    if (base.error) return { data: [], error: base.error };

    var spouses = Array.isArray(base.data) ? base.data : [];
    if (!spouses.length) return { data: [], error: null };

    const ids = spouses.map(function (x) { return Number(x.id); }).filter(Boolean);
    const counts = new Map();

    if (ids.length) {
      const linked = await client
        .from("tree_mother_links")
        .select("spouse_id")
        .in("spouse_id", ids)
        .limit(5000);

      if (linked.error) return { data: spouses, error: null };

      (Array.isArray(linked.data) ? linked.data : []).forEach(function (r) {
        const k = String(r.spouse_id);
        counts.set(k, (counts.get(k) || 0) + 1);
      });
    }

    spouses = spouses.map(function (x) {
      return Object.assign({}, x, {
        linked_children_count: counts.get(String(x.id)) || 0,
      });
    });

    return { data: spouses, error: null };
  }

  window.AlzidanSpousesCore = Object.assign(window.AlzidanSpousesCore || {}, {
    normalizeSearchText: normalizeSearchText,
    matchesOrderedSubstring: matchesOrderedSubstring,
    wifeDuplicateKey: wifeDuplicateKey,
    hasThreePartWifeName: hasThreePartWifeName,
    findDuplicateWife: findDuplicateWife,
    loadSpousesByHusband: loadSpousesByHusband,
  });
})();
