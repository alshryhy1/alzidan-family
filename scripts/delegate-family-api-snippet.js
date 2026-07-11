async function getTreePersonIdByName(sb, fullName) {
  const name = normalizePersonName(fullName || "");
  if (!sb || !name) return null;
  const r = await sb.from("tree_children").select("id,name").eq("name", name).limit(1).maybeSingle();
  if (r.error || !r.data || r.data.id == null) return null;
  return r.data.id;
}

function delegateBirthYearFromAge(ageValue) {
  const raw = normalizeArabicDigitsToLatin(String(ageValue || "").trim());
  if (!raw) return null;
  const age = parseInt(raw, 10);
  if (!Number.isFinite(age) || age < 0 || age > 130) return null;
  const todayH = gregorianToHijriISO(todayGregorianISO());
  const currentHijriYear = todayH ? parseInt(todayH.slice(0, 4), 10) : null;
  if (!Number.isFinite(currentHijriYear)) return null;
  return currentHijriYear - age;
}

function buildPersonOptionsForFamilyMgmt(branchKey) {
  const branchRoot = getBranchRootName(branchKey);
  const dynamicParents = Object.keys(state.children || {});
  const dynamicChildren = [];
  Object.values(state.children || {}).forEach((list) => {
    (Array.isArray(list) ? list : []).forEach((c) => {
      const n = normalizePersonName(c && c.name ? c.name : "");
      if (n) dynamicChildren.push(n);
    });
  });
  const ids = [...dynamicParents, ...dynamicChildren].map(normalizePersonName).filter(Boolean);
  const baseCounts = new Map();
  ids.forEach((id) => {
    const base = getDisplayNameForNodeId(id, branchRoot);
    if (!base) return;
    baseCounts.set(base, (baseCounts.get(base) || 0) + 1);
  });
  const seen = new Set();
  const options = [];
  ids.forEach((id) => {
    const n = normalizePersonName(id || "");
    if (!n || seen.has(n)) return;
    seen.add(n);
    const base = getDisplayNameForNodeId(n, branchRoot);
    let label = base;
    if (base && (baseCounts.get(base) || 0) > 1) {
      const parts = n.split("/").map((p) => normalizePersonName(p)).filter(Boolean);
      parts.pop();
      const parentBase = parts.length ? parts[parts.length - 1] : "";
      if (parentBase) label = base + " — " + parentBase;
    }
    options.push({ value: n, label: label || n });
  });
  return options;
}

function parseWifeFamilyValue(raw) {
  const v = String(raw || "").trim();
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
}

function wifeDuplicateKey(value) {
  const SpousesCore = window.AlzidanSpousesCore || {};
  if (SpousesCore && typeof SpousesCore.wifeDuplicateKey === "function") {
    return SpousesCore.wifeDuplicateKey(value);
  }
  return normalizePersonName(value || "")
    .replace(/\b(بن|ابن|بنت)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasThreePartWifeName(value) {
  return wifeDuplicateKey(value).split(" ").filter(Boolean).length >= 3;
}

async function findDuplicateWifeForDelegate(sb, husbandId, row, editingSpouseId) {
  const SpousesCore = window.AlzidanSpousesCore || {};
  if (SpousesCore && typeof SpousesCore.findDuplicateWife === "function") {
    return SpousesCore.findDuplicateWife(sb, husbandId, row, editingSpouseId || 0);
  }
  const candidate = row.wife_lineage && hasThreePartWifeName(row.wife_lineage) ? row.wife_lineage : row.wife_name;
  if (!hasThreePartWifeName(candidate)) return null;
  const key = wifeDuplicateKey(candidate);
  const { data, error } = await sb.from("tree_spouses").select("id,husband_id,wife_name,wife_lineage").limit(1000);
  if (error) throw error;
  return (Array.isArray(data) ? data : []).find((item) => {
    if (editingSpouseId && Number(item.id) === Number(editingSpouseId)) return false;
    if (Number(item.husband_id) === Number(husbandId)) return false;
    const other = item.wife_lineage && hasThreePartWifeName(item.wife_lineage) ? item.wife_lineage : item.wife_name;
    return hasThreePartWifeName(other) && wifeDuplicateKey(other) === key;
  }) || null;
}

async function familyApiLoadWivesForPerson(personName) {
  const sb = getالخدمةClient();
  const SpousesCore = window.AlzidanSpousesCore || {};
  if (!sb || !state.branch) return { data: [], error: { message: "no branch" } };
  const parentName = resolveSelectedParentId(normalizePersonName(personName), state.branch);
  if (!parentName) return { data: [], error: null };
  const husbandId = await getTreePersonIdByName(sb, parentName);
  if (!husbandId) return { data: [], error: null };
  if (SpousesCore && typeof SpousesCore.loadSpousesByHusband === "function") {
    return SpousesCore.loadSpousesByHusband(sb, husbandId);
  }
  const r = await sb
    .from("tree_spouse_summary")
    .select("id,husband_id,wife_name,wife_is_family_member,wife_branch_key,wife_family_name,wife_lineage,marriage_order,status,confidence,linked_children_count")
    .eq("husband_id", husbandId)
    .order("marriage_order", { ascending: true })
    .order("id", { ascending: true });
  if (r.error) return { data: [], error: r.error };
  return { data: Array.isArray(r.data) ? r.data : [], error: null };
}

async function familyApiGetParentChildrenForWifeManager(personName) {
  const sb = getالخدمةClient();
  const parentId = resolveSelectedParentId(normalizePersonName(personName || ""), state.branch);
  if (!sb || !parentId || !state.branch) return [];
  const parentLeaf = getLeafStoredNameFromNodeId(parentId);
  const parentCandidates = [parentId, parentLeaf].filter(Boolean);
  const { data, error } = await sb
    .from("tree_children")
    .select("id,branch_key,parent_name,parent,child_name,name,birth_order,birth_date_h,birth_date_g,birth_year")
    .eq("branch_key", state.branch)
    .in("parent_name", parentCandidates)
    .limit(500);
  if (error) return [];
  return (Array.isArray(data) ? data : []).map((r) => {
    const childPath = normalizePersonName(r.child_name || r.name || "");
    const label = getDisplayNameForNodeId(childPath, state.branch ? getBranchRootName(state.branch) : "") || childPath;
    return {
      id: r.id,
      name: childPath,
      label,
      order: r.birth_order || "",
      hdate: r.birth_date_h || "",
      gdate: r.birth_date_g || "",
      year: r.birth_year || "",
    };
  }).filter((c) => c.id != null && c.name);
}

async function familyApiLoadLinkedChildrenForSpouse(spouseId) {
  const sb = getالخدمةClient();
  if (!sb || !spouseId) return new Set();
  const { data, error } = await sb.from("tree_mother_links").select("child_id").eq("spouse_id", spouseId).limit(1000);
  if (error) return new Set();
  return new Set((Array.isArray(data) ? data : []).map((r) => String(r.child_id)));
}

async function familyApiSaveWifeChildrenLinks(payload) {
  const sb = getالخدمةClient();
  const spouse = payload && payload.spouse;
  if (!sb || !spouse || spouse.id == null) return { ok: false, message: "تعذر حفظ الربط." };
  const spouseId = Number(spouse.id);
  const childIds = (payload.children || []).map((c) => String(c.id)).filter(Boolean);
  const checkedIds = new Set((payload.checkedIds || []).map(String));
  if (childIds.length) {
    const del = await sb.from("tree_mother_links").delete().in("child_id", childIds).eq("spouse_id", spouseId);
    if (del.error) return { ok: false, message: "تعذر تحديث الربط: " + (del.error.message || "خطأ غير معروف") };
  }
  const selectedChildren = (payload.children || []).filter((c) => checkedIds.has(String(c.id)));
  if (selectedChildren.length) {
    const rows = selectedChildren.map((child) => ({
      child_id: Number(child.id),
      spouse_id: spouseId,
      mother_name: spouse.wife_name || null,
      mother_is_family_member: spouse.wife_is_family_member == null ? null : spouse.wife_is_family_member,
      mother_branch_key: spouse.wife_branch_key || null,
      mother_family_name: spouse.wife_family_name || null,
      mother_lineage: spouse.wife_lineage || null,
      confidence: "confirmed",
      updated_at: new Date().toISOString(),
    }));
    const ins = await sb.from("tree_mother_links").upsert(rows, { onConflict: "child_id" });
    if (ins.error) return { ok: false, message: "تعذر حفظ ربط الأبناء: " + (ins.error.message || "خطأ غير معروف") };
  }
  return { ok: true };
}

async function familyApiConfirmLinkAllChildrenToOnlyWife(personName) {
  if (!state.branch) return { ok: false, message: "يلزم تسجيل دخول المندوب أولاً." };
  const sb = getالخدمةClient();
  const parentName = resolveSelectedParentId(normalizePersonName(personName), state.branch);
  if (!sb || !parentName) return { ok: false, message: "اختر الشخص أولاً." };
  const husbandId = await getTreePersonIdByName(sb, parentName);
  if (!husbandId) return { ok: false, message: "تعذر تحديد رقم الشخص." };
  const ok = window.confirm("تأكيد مهم: سيتم ربط كل أبناء هذا الشخص بزوجته الوحيدة المسجلة. هل أنت متأكد؟");
  if (!ok) return { ok: false, message: "تم الإلغاء." };
  const r = await sb.rpc("confirm_link_all_children_to_only_spouse", { p_husband_id: husbandId });
  if (r.error) return { ok: false, message: r.error.message || "تعذr الربط الجماعي." };
  return { ok: true, count: r.data || 0 };
}

async function familyApiSaveWife(payload) {
  if (!state.branch) return { ok: false, message: "يلزم تسجيل دخول المندوب أولاً." };
  const sb = getالخدمةClient();
  if (!sb) return { ok: false, message: "تعذر الاتصال بقاعدة البيانات." };
  const parentName = resolveSelectedParentId(normalizePersonName(payload.personId), state.branch);
  if (!parentName) return { ok: false, message: "اختر الشخص أولاً." };
  const husbandId = await getTreePersonIdByName(sb, parentName);
  if (!husbandId) return { ok: false, message: "تعذر تحديد رقم الشخص في قاعدة البيانات." };
  const name = normalizePersonName(payload.name || "");
  if (!name) return { ok: false, message: "أدخل اسم الزوجة." };
  const orderRaw = payload.order ? normalizeArabicDigitsToLatin(String(payload.order).trim()) : "";
  const order = orderRaw ? parseInt(orderRaw, 10) : null;
  if (orderRaw && (!order || order < 1 || order > 4)) {
    return { ok: false, message: "ترtيب الزوجة يجب أن يكون من 1 إلى 4." };
  }
  const familyVal = parseWifeFamilyValue(payload.family);
  const row = {
    husband_id: husbandId,
    wife_name: name,
    wife_is_family_member: familyVal,
    wife_branch_key: familyVal === false ? null : (payload.branch ? String(payload.branch).trim() : null),
    wife_family_name: familyVal === false && payload.familyName ? normalizePersonName(payload.familyName) : null,
    wife_lineage: payload.lineage ? normalizePersonName(payload.lineage) : null,
    marriage_order: order,
    status: "active",
    confidence: "confirmed",
    data_source: "delegate",
    updated_at: new Date().toISOString(),
  };
  const editingId = Number(payload.editingSpouseId || 0);
  if (editingId) {
    const { error } = await sb.from("tree_spouses").update(row).eq("id", editingId);
    if (error) return { ok: false, message: "تعذر تعديل الزوجة: " + (error.message || "خطأ غير معروف") };
    return { ok: true, message: "تم تعديل بيانات الزوجة." };
  }
  try {
    const dup = await findDuplicateWifeForDelegate(sb, husbandId, row, 0);
    if (dup) {
      return { ok: false, message: "هذه الزوجة مسجلة مسبقًا مع زوج آخر. راجع الاسم الثلاثي أو سلسلة النسب قبل الحفظ." };
    }
  } catch (err) {
    return { ok: false, message: "تعذر التحقق من تكرار اسم الزوجة، حاول لاحقًا." };
  }
  const r = await sb.from("tree_spouses").insert(row).select("id").single();
  if (r.error) return { ok: false, message: "تعذر حفظ الزوجة: " + (r.error.message || "خطأ غير معروف") };
  return { ok: true, message: "تم حفظ الزوجة." };
}

async function familyApiLinkChildToSpouse(childId, spouseId) {
  if (!spouseId) return { ok: true, skipped: true };
  const sb = getالخدمةClient();
  if (!sb) return { ok: false, error: { message: "تعذر الاتصال بقاعدة البيانات." } };
  const childPersonId = await getTreePersonIdByName(sb, childId);
  if (!childPersonId) return { ok: false, error: { message: "تعذر تحديد رقم الابن في قاعدة البيانات." } };
  const spouseRes = await sb
    .from("tree_spouses")
    .select("id,wife_name,wife_is_family_member,wife_branch_key,wife_family_name,wife_lineage")
    .eq("id", Number(spouseId))
    .maybeSingle();
  if (spouseRes.error) return { ok: false, error: spouseRes.error };
  const spouse = spouseRes.data || {};
  if (!spouse.id) return { ok: false, error: { message: "تعذr تحديد الزوجة المختارة." } };
  const row = {
    child_id: Number(childPersonId),
    spouse_id: Number(spouse.id),
    mother_name: spouse.wife_name || null,
    mother_is_family_member: spouse.wife_is_family_member == null ? null : spouse.wife_is_family_member,
    mother_branch_key: spouse.wife_branch_key || null,
    mother_family_name: spouse.wife_family_name || null,
    mother_lineage: spouse.wife_lineage || null,
    confidence: "confirmed",
    updated_at: new Date().toISOString(),
  };
  const ins = await sb.from("tree_mother_links").upsert(row, { onConflict: "child_id" });
  if (ins.error) return { ok: false, error: ins.error };
  return { ok: true };
}

async function familyApiSaveChild(payload) {
  if (!state.branch) return { ok: false, message: "يلزم تسجيل دخول المندوب أولاً." };
  const selectedParentName = resolveSelectedParentId(normalizePersonName(payload.personId), state.branch);
  const rawName = normalizePersonName(payload.name || "");
  const deceased = !!payload.deceased;
  const hijriInput = deceased ? "" : String(payload.hijri || "").trim();
  const gregInput = deceased ? "" : String(payload.greg || "").trim();
  const hijriNorm = hijriInput ? normalizeHijriDateISO(hijriInput) : "";
  const gregNorm = gregInput ? normalizeGregorianDateISO(gregInput) : "";
  if (hijriInput && !hijriNorm) return { ok: false, message: "تاريخ الميلاد (هجري) غير صحيح. الصيغة: YYYY-MM-DD" };
  if (gregInput && !gregNorm) return { ok: false, message: "تاريخ الميلad (ميلادي) غير صحيح." };
  let finalHijri = hijriNorm;
  let finalGreg = gregNorm;
  if (finalHijri && !finalGreg) finalGreg = hijriToGregorianISO(finalHijri);
  if (finalGreg && !finalHijri) finalHijri = gregorianToHijriISO(finalGreg);
  if (finalHijri && !finalGreg) return { ok: false, message: "تعذر تحويل التاريخ الهجري إلى ميلادي." };
  if (finalGreg && !finalHijri) return { ok: false, message: "تعذر تحويل التاريخ الميلادي إلى هجري." };
  const birthYear = finalHijri ? normalizeBirthYear(finalHijri.slice(0, 4)) : null;
  const birthOrderRaw = payload.order ? normalizeArabicDigitsToLatin(String(payload.order).trim()) : "";
  const birthOrder = birthOrderRaw ? parseInt(birthOrderRaw, 10) : null;
  if (birthOrderRaw && (!birthOrder || birthOrder < 1 || String(birthOrder) !== birthOrderRaw)) {
    return { ok: false, message: "ترتيب الميلاد يجب أن يكون رقمًا صحيحًا يبدأ من 1." };
  }
  const city = deceased ? "" : normalizePersonName(payload.city || "");
  const area = deceased ? "" : normalizePersonName(payload.area || "");
  if (!rawName) return { ok: false, message: "يرجى إدخال اسم الابن." };
  const sb = getالخدمةClient();
  if (!sb) return { ok: false, message: "تعذر الحفظ حالياً، حاول لاحقاً أو تواصل مع الإدارة." };
  const buildChildId = (parentId, baseName) => {
    const p = normalizePersonName(parentId || "");
    const b = normalizePersonName(baseName || "");
    if (!p || !b) return "";
    return p + "/" + b;
  };
  const tokens = tokenizeLineageInput(rawName);
  const lineagePlan = buildLineagePlanFromTokens(tokens, state.branch, selectedParentName);
  const baseNames = getAllBaseNames();
  const nowIso = new Date().toISOString();

  const getSiblingPartsFromRawInput = (input, plan) => {
    const v = normalizePersonName(input || "");
    if (!v || !selectedParentName) return [];
    if (plan && plan.anchorParent && Array.isArray(plan.chain) && plan.chain.length) return [];
    const parts = [];
    const pushAll = (arr) => {
      (Array.isArray(arr) ? arr : []).forEach((p) => {
        const n = normalizePersonName(p);
        if (n) parts.push(n);
      });
    };
    if (/[&,،]/.test(v) || v.includes("\n")) pushAll(v.split(/[&,،\n]/g));
    else if (/\s+و\s+/.test(v)) pushAll(v.split(/\s+و\s+/g));
    else if (/\s+/.test(v) && !/\b(بن|ابن|بنت)\b/.test(v)) pushAll(v.split(/\s+/g));
    const uniq = [];
    const seen = new Set();
    parts.forEach((p) => {
      const key = normalizePersonName(p);
      if (!key || seen.has(key)) return;
      seen.add(key);
      uniq.push(key);
    });
    return uniq;
  };

  const siblingParts = getSiblingPartsFromRawInput(rawName, lineagePlan);
  if (siblingParts.length > 1) {
    const parentName = selectedParentName;
    if (!parentName) return { ok: false, message: "يرجى اختيار الشخص أولاً لإضافة عدة أسماء كإخوة." };
    let inserted = 0;
    let skipped = 0;
    for (let i = 0; i < siblingParts.length; i++) {
      const part = siblingParts[i];
      const base = normalizePersonBaseName(part);
      if (!base) continue;
      if (normalizePersonBaseName(base) === normalizePersonBaseName(parentName)) {
        return { ok: false, message: "لا يمكن أن يكون اسم الابن مطابقًا لاسم الأب." };
      }
      if (findChildNameByBase(parentName, base)) { skipped += 1; continue; }
      const childId = buildChildId(parentName, base);
      if (!childId) continue;
      const row = {
        branch_key: state.branch,
        parent_name: parentName,
        child_name: childId,
        birth_date_g: finalGreg || null,
        birth_date_h: finalHijri || null,
        birth_year: birthYear,
        birth_order: birthOrder == null ? null : birthOrder + i,
        city: city || null,
        area: area || null,
        is_deceased: deceased,
        created_at: nowIso,
      };
      const insertRes = await rpcInsertTreeChildRow(sb, row);
      if (!insertRes.ok) {
        if (isRpcMissingError(insertRes.error)) return { ok: false, message: "تعذر الحفظ حالياً، حاول لاحقاً أو تواصل مع الإدارة." };
        return { ok: false, message: formatTreeChildrenDbError(insertRes.error, "save") };
      }
      if (!state.children[parentName]) state.children[parentName] = [];
      state.children[parentName].push({ name: childId, year: birthYear ? String(birthYear) : "", order: birthOrder == null ? "" : String(birthOrder + i), gdate: finalGreg || "", hdate: finalHijri || "", city, area, deceased });
      baseNames.add(base);
      inserted += 1;
    }
    const reloadRes = await loadChildrenForBranch(state.branch, { applyToState: true });
    if (!reloadRes.ok) return { ok: true, message: "تم حفظ الأسماء في قاعدة البيانات، لكن تعذر تحديث العرض الآن.", selectedPersonId: parentName };
    return { ok: true, message: "تم حفظ الأسماء كإخوة. تمت إضافة: " + inserted + "، وتجاهل المكرر: " + skipped, selectedPersonId: parentName };
  }

  if (lineagePlan && lineagePlan.anchorParent && lineagePlan.chain && lineagePlan.chain.length) {
    let currentParent = normalizePersonName(lineagePlan.anchorParent);
    let inserted = 0;
    let skipped = 0;
    let youngestFinal = "";
    for (let i = 0; i < lineagePlan.chain.length; i++) {
      const desiredChild = normalizePersonName(lineagePlan.chain[i]);
      const desiredBase = normalizePersonBaseName(desiredChild);
      if (!desiredBase) continue;
      if (desiredBase === normalizePersonBaseName(currentParent)) {
        return { ok: false, message: "لا يمكن أن يكون اسم الابن مطابقًا لاسم الأب." };
      }
      const isYoungest = i === lineagePlan.chain.length - 1;
      const finalChildBase = normalizePersonBaseName(desiredChild);
      const tokensCheck = tokenizeLineageInput(finalChildBase);
      if (isYoungest && tokensCheck.length !== 1) {
        return { ok: false, message: "ممنوع تسجيل الاسم الأخير بأكثر من كلمة. اكتب اسم الابن فقط." };
      }
      const existingChildName = findChildNameByBase(currentParent, finalChildBase);
      if (existingChildName) { skipped += 1; currentParent = existingChildName; youngestFinal = existingChildName; continue; }
      const childId = buildChildId(currentParent, finalChildBase);
      if (!childId) continue;
      const row = {
        branch_key: state.branch,
        parent_name: currentParent,
        child_name: childId,
        birth_date_g: isYoungest ? (finalGreg || null) : null,
        birth_date_h: isYoungest ? (finalHijri || null) : null,
        birth_year: isYoungest ? birthYear : null,
        birth_order: isYoungest ? birthOrder : null,
        city: isYoungest ? (city || null) : null,
        area: isYoungest ? (area || null) : null,
        is_deceased: isYoungest ? deceased : null,
        created_at: nowIso,
      };
      const insertRes = await rpcInsertTreeChildRow(sb, row);
      if (!insertRes.ok) {
        if (isRpcMissingError(insertRes.error)) return { ok: false, message: "تعذر الحفظ حالياً، حاول لاحقاً أو تواصل مع الإدارة." };
        return { ok: false, message: formatTreeChildrenDbError(insertRes.error, "save") };
      }
      if (!state.children[currentParent]) state.children[currentParent] = [];
      state.children[currentParent].push({ name: childId, year: isYoungest && birthYear ? String(birthYear) : "", order: isYoungest && birthOrder ? String(birthOrder) : "", gdate: isYoungest ? (finalGreg || "") : "", hdate: isYoungest ? (finalHijri || "") : "", city: isYoungest ? city : "", area: isYoungest ? area : "", deceased: isYoungest ? deceased : false });
      baseNames.add(normalizePersonBaseName(finalChildBase));
      inserted += 1;
      currentParent = childId;
      youngestFinal = childId;
    }
    const reloadRes = await loadChildrenForBranch(state.branch, { applyToState: true });
    if (!reloadRes.ok) return { ok: true, message: "تم حفظ السلسلة في قاعدة البيانات، لكن تعذر تحديث العرض الآن.", selectedPersonId: youngestFinal || selectedParentName };
    return { ok: true, message: "تم حفظ السلسلة. تمت إضافة: " + inserted + "، وتجاهل المكرر: " + skipped, selectedPersonId: youngestFinal || selectedParentName };
  }

  if (!selectedParentName) return { ok: false, message: "يرجى اختيار الشخص أولاً أو اكتب الاسم كسلسلة تنتهي باسم الفرع." };
  const parentName = selectedParentName;
  if (normalizePersonBaseName(rawName) === normalizePersonBaseName(parentName)) {
    return { ok: false, message: "لا يمكن أن يكون اسم الابن مطابقًا لاسم الأب." };
  }
  const tokensCheck = tokenizeLineageInput(rawName);
  if (tokensCheck.length !== 1) return { ok: false, message: "ممنوع تسجيل الاسم الأخير بأكثر من كلمة. اكتب اسم الابن فقط." };
  const inputBase = normalizePersonBaseName(rawName);
  if (findChildNameByBase(parentName, inputBase)) return { ok: false, message: "اسم الابن مسجل مسبقًا لهذا الأب." };
  const finalName = normalizePersonBaseName(rawName);
  const childId = buildChildId(parentName, finalName);
  if (!childId) return { ok: false, message: "تعذر حفظ الاسم بسبب خطأ في بناء المعرف." };
  const row = {
    branch_key: state.branch,
    parent_name: parentName,
    child_name: childId,
    birth_date_g: finalGreg || null,
    birth_date_h: finalHijri || null,
    birth_year: birthYear,
    birth_order: birthOrder,
    city: city || null,
    area: area || null,
    is_deceased: deceased,
    created_at: nowIso,
  };
  const insertRes = await rpcInsertTreeChildRow(sb, row);
  if (!insertRes.ok) {
    if (isRpcMissingError(insertRes.error)) return { ok: false, message: "تعذر الحفظ حالياً، حاول لاحقاً أو تواصل مع الإدارة." };
    return { ok: false, message: formatTreeChildrenDbError(insertRes.error, "save") };
  }
  const memberPhoneForChild = normalizeMemberPhoneForDelegate(payload.phone || "");
  const memberProfileRes = await saveDelegateMemberProfile(sb, memberPhoneForChild, state.branch, childId, "");
  if (!memberProfileRes.ok) {
    return { ok: false, message: "تم حفظ الابن لكن تعذر حفظ رقم الجوال: " + ((memberProfileRes.error && memberProfileRes.error.message) || "خطأ غير معروف") };
  }
  const spouseId = payload.spouseId ? Number(payload.spouseId) : null;
  const motherLinkRes = await familyApiLinkChildToSpouse(childId, spouseId);
  if (!motherLinkRes.ok) {
    return { ok: false, message: "تم حفظ الابن لكن تعذر ربط الأم: " + ((motherLinkRes.error && motherLinkRes.error.message) || "خطأ غير معروف") };
  }
  const reloadRes = await loadChildrenForBranch(state.branch, { applyToState: true });
  if (!reloadRes.ok) return { ok: true, message: "تم حفظ بيانات الابن في قاعدة البيانات، لكن تعذر تحديث العرض الآن.", selectedPersonId: childId };
  return { ok: true, message: "تم حفظ بيانات الابن في قاعدة البيانات: " + finalName, selectedPersonId: childId };
}

async function familyApiUpdateChild(payload) {
  if (!state.branch) return { ok: false, message: "يلزم تسجيل دخول المندوب أولاً." };
  const parentId = normalizePersonName(payload.parentId || "");
  const child = payload.child || {};
  const childId = normalizePersonName(child.name || "");
  if (!parentId || !childId) return { ok: false, message: "تعذر تحديد السجل." };
  const deceased = !!payload.deceased;
  const hijriInput = deceased ? "" : String(payload.hijri || "").trim();
  const gregInput = deceased ? "" : String(payload.greg || "").trim();
  const hijriNorm = hijriInput ? normalizeHijriDateISO(hijriInput) : "";
  const gregNorm = gregInput ? normalizeGregorianDateISO(gregInput) : "";
  if (hijriInput && !hijriNorm) return { ok: false, message: "تاريخ الميلاد (هجري) غير صحيح. الصيغة: YYYY-MM-DD" };
  if (gregInput && !gregNorm) return { ok: false, message: "تاريخ الميلاد (ميلادي) غير صحيح." };
  let finalHijri = hijriNorm;
  let finalGreg = gregNorm;
  if (finalHijri && !finalGreg) finalGreg = hijriToGregorianISO(finalHijri);
  if (finalGreg && !finalHijri) finalHijri = gregorianToHijriISO(finalGreg);
  if (finalHijri && !finalGreg) return { ok: false, message: "تعذر تحويل التاريخ الهجري إلى ميلادي." };
  if (finalGreg && !finalHijri) return { ok: false, message: "تعذر تحويل التاريخ الميلادي إلى هجري." };
  const birthYear = finalHijri ? normalizeBirthYear(finalHijri.slice(0, 4)) : null;
  const birthOrderRaw = payload.order ? normalizeArabicDigitsToLatin(String(payload.order).trim()) : "";
  const birthOrder = birthOrderRaw ? parseInt(birthOrderRaw, 10) : null;
  if (birthOrderRaw && (!birthOrder || birthOrder < 1 || String(birthOrder) !== birthOrderRaw)) {
    return { ok: false, message: "ترتيب الميلاد يجب أن يكون رقمًا صحيحًا يبدأ من 1." };
  }
  const city = deceased ? "" : normalizePersonName(payload.city || "");
  const area = deceased ? "" : normalizePersonName(payload.area || "");
  const sb = getالخدمةClient();
  if (!sb) return { ok: false, message: "تعذر الحفظ حالياً، حاول لاحقاً أو تواصل مع الإدارة." };
  const patch = {
    birth_date_g: finalGreg || null,
    birth_date_h: finalHijri || null,
    birth_year: birthYear,
    birth_order: birthOrder,
    city: city || null,
    area: area || null,
    is_deceased: deceased,
  };
  const personId = normalizePersonName(child.personId || "");
  const res = await rpcUpdateTreeChildRow(sb, state.branch, parentId, childId, patch, personId);
  if (!res.ok) {
    if (isRpcMissingError(res.error)) return { ok: false, message: "تعذr تنفيذ التعديل حالياً، حاول لاحقاً أو تواصل مع الإدارة." };
    return { ok: false, message: formatTreeChildrenDbError(res.error, "update") };
  }
  const editPhoneValue = normalizeMemberPhoneForDelegate(payload.phone || "");
  const memberProfileEditRes = await saveDelegateMemberProfile(sb, editPhoneValue, state.branch, childId, personId);
  if (!memberProfileEditRes.ok) {
    return { ok: false, message: "تم حفظ التعديل لكن تعذر حفظ رقم الجوال: " + ((memberProfileEditRes.error && memberProfileEditRes.error.message) || "خطأ غير معروف") };
  }
  const reloadRes = await loadChildrenForBranch(state.branch, { applyToState: true });
  if (!reloadRes.ok) return { ok: true, message: "تم حفظ التعديل. تعذر تحديث البيانات من قاعدة البيانات الآن." };
  return { ok: true, message: res.degraded ? "تم حفظ التعديل، لكن تعذر حفظ حالة متوفى في الخدمة لأن عمود الوفاة غير متاح." : "تم حفظ التعديل." };
}

async function familyApiDeleteChild(payload) {
  if (!state.branch) return { ok: false, message: "يلزم تسجيل دخول المندوب أولاً." };
  const parentId = normalizePersonName(payload.parentId || "");
  const child = payload.child || {};
  const childIdForDelete = normalizePersonName(child.name || "");
  const display = getDisplayNameForNodeId(childIdForDelete, state.branch ? getBranchRootName(state.branch) : "");
  const nameToConfirm = normalizePersonName(display || normalizePersonBaseName(childIdForDelete) || childIdForDelete);
  const ok = await confirmTypedText(nameToConfirm, {
    title: "تأكيد حذف الاسم",
    body: "لتأكيد الحذف اكتب الاسم التالي بالضبط:",
    confirmLabel: "تأكيد الحذف",
    cancelLabel: "إلغاء",
  });
  if (!ok) return { ok: false, message: "تم الإلغاء." };
  const sb = getالخدمةClient();
  if (!sb) return { ok: false, message: "تعذر الحذف لأن الربط غير مُعد." };
  const res = await rpcDeleteTreeChildRow(sb, state.branch, parentId, childIdForDelete, normalizePersonName(child.personId || ""));
  if (!res.ok) {
    if (isRpcMissingError(res.error)) return { ok: false, message: "تعذر الحذف حالياً، حاول لاحقاً أو تواصل مع الإدارة." };
    return { ok: false, message: formatTreeChildrenDbError(res.error, "delete") };
  }
  await loadChildrenForBranch(state.branch, { applyToState: true });
  return { ok: true, message: "تم حذف الاسم." };
}

function buildDelegateFamilyApi() {
  return {
    getState: () => state,
    getBranchKey: () => state.branch,
    getClient: getالخدمةClient,
    getBranchRootName,
    normalizePersonName,
    resolveSelectedParentId,
    getDisplayNameForNodeId,
    getForcedRahmaSuffix,
    normalizePersonBaseName,
    normalizeHijriDateISO,
    normalizeGregorianDateISO,
    hijriToGregorianISO,
    gregorianToHijriISO,
    normalizeBirthYear,
    normalizeArabicDigitsToLatin,
    parseISODate,
    formatDateISO,
    calculateAge,
    buildPersonOptions: buildPersonOptionsForFamilyMgmt,
    getDefaultPersonId: (branchKey) => {
      const root = getBranchRootName(branchKey);
      return root || "";
    },
    ensurePersonOption: () => {},
    loadWivesForPerson: familyApiLoadWivesForPerson,
    getParentChildrenForWifeManager: familyApiGetParentChildrenForWifeManager,
    loadLinkedChildrenForSpouse: familyApiLoadLinkedChildrenForSpouse,
    saveWifeChildrenLinks: familyApiSaveWifeChildrenLinks,
    confirmLinkAllChildrenToOnlyWife: familyApiConfirmLinkAllChildrenToOnlyWife,
    saveWife: familyApiSaveWife,
    saveChild: familyApiSaveChild,
    updateChild: familyApiUpdateChild,
    deleteChild: familyApiDeleteChild,
    loadMemberPhone: async (parentId, child) => {
      const sb = getالخدمةClient();
      if (!sb || !state.branch) return "";
      return loadDelegateMemberPhone(sb, state.branch, normalizePersonName(child && child.name ? child.name : ""), normalizePersonName(child && child.personId ? child.personId : ""));
    },
  };
}

function mountDelegateFamilyManagement(initialPersonId) {
  if (!familyManagementRoot || !window.AlzidanFamilyMgmt || typeof window.AlzidanFamilyMgmt.mount !== "function") return;
  familyMgmtPanel = window.AlzidanFamilyMgmt.mount({
    mode: "delegate",
    root: familyManagementRoot,
    api: buildDelegateFamilyApi(),
  });
  if (familyMgmtPanel && typeof familyMgmtPanel.refresh === "function") {
    familyMgmtPanel.refresh().then(() => {
      const pick = normalizePersonName(initialPersonId || "");
      if (pick && familyMgmtPanel.selectPerson) familyMgmtPanel.selectPerson(pick);
    }).catch(() => {});
  }
}
