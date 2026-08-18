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

  function isActiveSpouse(status) {
    var value = String(status || "active")
      .trim()
      .toLowerCase();
    return !value || value === "active";
  }

  function wifeIdentityMatches(rowA, rowB) {
    var fieldsA = [rowA && rowA.wife_lineage, rowA && rowA.wife_name].filter(Boolean);
    var fieldsB = [rowB && rowB.wife_lineage, rowB && rowB.wife_name].filter(Boolean);
    if (!fieldsA.length || !fieldsB.length) return false;

    for (var i = 0; i < fieldsA.length; i++) {
      for (var j = 0; j < fieldsB.length; j++) {
        var ka = wifeDuplicateKey(fieldsA[i]);
        var kb = wifeDuplicateKey(fieldsB[j]);
        if (!ka || !kb) continue;
        if (ka === kb) return true;

        var pa = ka.split(" ").filter(Boolean);
        var pb = kb.split(" ").filter(Boolean);
        if (pa.length >= 3 && pb.length >= 3 && pa.slice(0, 3).join(" ") === pb.slice(0, 3).join(" ")) {
          return true;
        }
        if (pa.length >= 3 && pb.length === 2 && pa.slice(0, 2).join(" ") === pb.join(" ")) {
          return true;
        }
        if (pb.length >= 3 && pa.length === 2 && pb.slice(0, 2).join(" ") === pa.join(" ")) {
          return true;
        }
      }
    }
    return false;
  }

  function rowHasWifeIdentity(row) {
    if (!row) return false;
    return [row.wife_lineage, row.wife_name].some(function (value) {
      return wifeDuplicateKey(value).split(" ").filter(Boolean).length >= 2;
    });
  }

  async function loadAllSpouseRows(client) {
    var all = [];
    var pageSize = 1000;
    var offset = 0;
    while (true) {
      var page = await client
        .from("tree_spouses")
        .select("id,husband_id,wife_name,wife_lineage,status")
        .order("id", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (page.error) throw page.error;
      var batch = Array.isArray(page.data) ? page.data : [];
      all = all.concat(batch);
      if (batch.length < pageSize) break;
      offset += pageSize;
    }
    return all;
  }

  function findActiveSpouseMatchesInList(list, husbandId, row, editingSpouseId) {
    return (Array.isArray(list) ? list : []).filter(function (item) {
      if (editingSpouseId && Number(item.id) === Number(editingSpouseId)) return false;
      if (Number(item.husband_id) === Number(husbandId)) return false;
      if (!isActiveSpouse(item.status)) return false;
      return wifeIdentityMatches(row, item);
    });
  }

  async function findActiveSpouseMatchesElsewhere(client, husbandId, row, editingSpouseId) {
    if (!rowHasWifeIdentity(row)) return [];
    var list = await loadAllSpouseRows(client);
    return findActiveSpouseMatchesInList(list, husbandId, row, editingSpouseId);
  }

  async function endActiveSpouseMatchesElsewhere(client, husbandId, row, editingSpouseId) {
    var matches = await findActiveSpouseMatchesElsewhere(client, husbandId, row, editingSpouseId || 0);
    var ended = 0;
    var now = new Date().toISOString();
    for (var i = 0; i < matches.length; i++) {
      var item = matches[i];
      var res = await client
        .from("tree_spouses")
        .update({ status: "divorced", updated_at: now })
        .eq("id", item.id);
      if (!res.error) ended += 1;
    }
    return { ended: ended, matches: matches };
  }

  async function findDuplicateWife(client, husbandId, row, editingSpouseId) {
    if (!rowHasWifeIdentity(row)) return null;

    var list = await loadAllSpouseRows(client);
    return findActiveSpouseMatchesInList(list, husbandId, row, editingSpouseId)[0] || null;
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

  /**
   * Unlink mother rows then delete the spouse. Children stay on the tree.
   */
  async function deleteSpouseById(client, spouseId) {
    var id = Number(spouseId || 0);
    if (!client || !id) {
      return { ok: false, message: "تعذر تحديد الزوجة للحذف." };
    }

    var links = await client.from("tree_mother_links").delete().eq("spouse_id", id);
    if (links.error) {
      return {
        ok: false,
        message: "تعذر فك روابط الأبناء: " + (links.error.message || "خطأ"),
      };
    }

    var del = await client.from("tree_spouses").delete().eq("id", id);
    if (del.error) {
      return {
        ok: false,
        message: "تعذر حذف الزوجة: " + (del.error.message || "خطأ"),
      };
    }

    var check = await client
      .from("tree_spouses")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (check.error) {
      return {
        ok: false,
        message: "تعذر التحقق من الحذف: " + (check.error.message || "خطأ"),
      };
    }
    if (check.data && check.data.id) {
      return {
        ok: false,
        message: "لم يتم حذف الزوجة فعلياً. تحقق من صلاحيات الحذف.",
      };
    }
    return { ok: true, message: "تم حذف الزوجة." };
  }

  function isSonGender(gender) {
    var g = String(gender || "")
      .trim()
      .toLowerCase();
    if (!g) return true;
    return !(
      g === "daughter" ||
      g === "female" ||
      g === "f" ||
      g === "أنثى" ||
      g === "انثى" ||
      g === "ابنة" ||
      g === "بنت"
    );
  }

  function spouseIsFamilyMember(spouse) {
    if (!spouse) return false;
    var value =
      spouse.wife_is_family_member != null
        ? spouse.wife_is_family_member
        : spouse.wifeIsFamilyMember;
    if (value === true || value === 1) return true;
    if (typeof value === "string") {
      var v = value.trim().toLowerCase();
      return v === "true" || v === "yes" || v === "1" || v === "نعم";
    }
    return false;
  }

  async function autoLinkHusbandSonsToSpouse() {
    return { ok: true, linked: 0, skipped: "no_assumptions" };
  }

  window.AlzidanSpousesCore = Object.assign(window.AlzidanSpousesCore || {}, {
    normalizeSearchText: normalizeSearchText,
    matchesOrderedSubstring: matchesOrderedSubstring,
    wifeDuplicateKey: wifeDuplicateKey,
    hasThreePartWifeName: hasThreePartWifeName,
    isActiveSpouse: isActiveSpouse,
    wifeIdentityMatches: wifeIdentityMatches,
    rowHasWifeIdentity: rowHasWifeIdentity,
    findDuplicateWife: findDuplicateWife,
    findActiveSpouseMatchesElsewhere: findActiveSpouseMatchesElsewhere,
    endActiveSpouseMatchesElsewhere: endActiveSpouseMatchesElsewhere,
    loadSpousesByHusband: loadSpousesByHusband,
    deleteSpouseById: deleteSpouseById,
    autoLinkHusbandSonsToSpouse: autoLinkHusbandSonsToSpouse,
    spouseIsFamilyMember: spouseIsFamilyMember,
  });
})();
