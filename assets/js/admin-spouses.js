
(function () {
  "use strict";

  const ROOTS = {
    "زيدان": "زيدان بن مطلق بن زيدان",
    "مزيد": "مزيد بن مطلق بن زيدان",
    "زايد": "زايد بن مطلق بن زيدان",
    "لاحم": "لاحم بن مطلق بن زيدان",
    "ملحم": "ملحم بن مطلق بن زيدان"
  };

  let treeRows = [];
  let spouses = [];
  let editingSpouseId = 0;
  let managerState = { spouse: null, children: [], linked: new Set() };

  function $(id) { return document.getElementById(id); }
  function clean(v) { return String(v || "").replace(/\s+/g, " ").trim(); }
  function parts(path) { return String(path || "").split("/").map(clean).filter(Boolean); }
  function leaf(path) { const p = parts(path); return p.length ? p[p.length - 1] : clean(path); }
  function esc(v) {
    return String(v || "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  }
  function sb() {
    if (typeof getClient === "function") return getClient();
    if (window.__alzidanSupabaseClient) return window.__alzidanSupabaseClient;
    if (window.supabase && window.SUPABASE_URL && window.SUPABASE_ANON_KEY) {
      return window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    }
    return null;
  }
  function els() {
    return {
      section: $("admin-spouses-manager"),
      branch: $("admin-spouses-branch"),
      load: $("admin-spouses-load"),
      husband: $("admin-spouses-husband"),
      list: $("admin-spouses-list"),
      form: $("admin-spouses-form"),
      name: $("admin-spouses-name"),
      family: $("admin-spouses-family"),
      wifeBranch: $("admin-spouses-branch-key"),
      wifeFamilyName: $("admin-spouses-family-name"),
      order: $("admin-spouses-order"),
      lineage: $("admin-spouses-lineage"),
      status: $("admin-spouses-status")
    };
  }
  function status(msg) {
    const e = els().status;
    if (e) e.textContent = msg || "";
  }
  function selectedBranch() {
    return clean(els().branch && els().branch.value ? els().branch.value : "");
  }
  function selectedHusbandId() {
    return clean(els().husband && els().husband.value ? els().husband.value : "");
  }

  async function loadHusbands() {
    const c = sb(), e = els(), branch = selectedBranch();
    if (!c || !branch) return status("تعذر الاتصال أو الفرع غير محدد.");
    status("جاري تحميل الأزواج...");
    const { data, error } = await c.from("tree_children")
      .select("id,branch_key,parent_name,parent,child_name,name,birth_order")
      .eq("branch_key", branch)
      .limit(20000);
    if (error) return status("تعذر تحميل الشجرة: " + (error.message || "خطأ"));

    treeRows = Array.isArray(data) ? data : [];
    const map = new Map();

    treeRows.forEach(r => {
      const ch = clean(r.child_name || r.name || "");
      if (ch && r.id != null) map.set(String(r.id), { id: r.id, path: ch });
    });

    e.husband.innerHTML = '<option value="">اختر الزوج</option>';
    Array.from(map.values()).sort((a,b)=>leaf(a.path).localeCompare(leaf(b.path),"ar")).forEach(item => {
      const path = item.path;
      const opt = document.createElement("option");
      opt.value = String(item.id);
      opt.dataset.path = item.path;
      const ps = parts(path);
      const parent = ps.length > 1 ? ps[ps.length - 2] : "";
      opt.textContent = leaf(path) + (parent ? " — " + parent : "");
      e.husband.appendChild(opt);
    });

    status("تم تحميل الأزواج.");
    await loadSpouses();
  }

  async function loadSpouses() {
    closeManager();
    const c = sb(), e = els(), husbandId = selectedHusbandId();
    e.list.innerHTML = "";
    if (!c || !husbandId) return;

    const { data, error } = await c.from("tree_spouses")
      .select("id,husband_id,wife_name,wife_is_family_member,wife_branch_key,wife_family_name,wife_lineage,marriage_order,status,confidence")
      .eq("husband_id", Number(husbandId))
      .order("marriage_order", { ascending: true });

    if (error) return status("تعذر تحميل الزوجات: " + (error.message || "خطأ"));
    spouses = Array.isArray(data) ? data : [];

    if (spouses.length) {
      const ids = spouses.map((x) => Number(x.id)).filter(Boolean);
      const counts = new Map();
      if (ids.length) {
        const linked = await c.from("tree_mother_links").select("spouse_id").in("spouse_id", ids).limit(5000);
        if (!linked.error) {
          (Array.isArray(linked.data) ? linked.data : []).forEach((r) => {
            const k = String(r.spouse_id);
            counts.set(k, (counts.get(k) || 0) + 1);
          });
        }
      }
      spouses = spouses.map((x) => ({ ...x, linked_children_count: counts.get(String(x.id)) || 0 }));
    }

    renderSpouses();
  }

  function renderSpouses() {
    const e = els();
    e.list.innerHTML = "";
    if (!spouses.length) {
      e.list.innerHTML = '<div class="hint">لا توجد زوجات مسجلة لهذا الزوج حالياً.</div>';
      return;
    }

    spouses.forEach(row => {
      const card = document.createElement("div");
      card.className = "source-tree-item";
      card.innerHTML =
        '<strong>' + esc(row.wife_name || "بدون اسم") + '</strong>' +
        '<div class="hint">الترتيب: ' + esc(row.marriage_order || "-") +
        ' — الأبناء المرتبطون: ' + esc(row.linked_children_count || 0) + '</div>';

      const actions = document.createElement("div");
      actions.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;";

      const manage = document.createElement("button");
      manage.type = "button";
      manage.className = "btn btn-outline btn-sm";
      manage.textContent = "إدارة أبناء الزوجة";
      manage.onclick = () => openManager(row);

      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "btn btn-outline btn-sm";
      edit.textContent = "تعديل الزوجة";
      edit.onclick = () => fillEdit(row);

      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn btn-outline btn-sm";
      del.style.borderColor = "rgba(239,68,68,.5)";
      del.style.color = "#991b1b";
      del.textContent = "حذف الزوجة";
      del.onclick = () => deleteSpouse(row);

      actions.append(manage, edit, del);
      card.appendChild(actions);
      e.list.appendChild(card);
    });
  }

  function fillEdit(row) {
    const e = els();
    editingSpouseId = Number(row.id || 0);
    e.name.value = row.wife_name || "";
    e.family.value = row.wife_is_family_member === false ? "no" : "yes";
    e.wifeBranch.value = row.wife_branch_key || "";
    if (e.wifeFamilyName) e.wifeFamilyName.value = row.wife_family_name || "";
    e.order.value = row.marriage_order || "";
    e.lineage.value = row.wife_lineage || "";
    updateWifeFieldsVisibility();
    status("عدّل بيانات الزوجة ثم اضغط حفظ الزوجة.");
  }

  function clearForm() {
    const e = els();
    editingSpouseId = 0;
    e.name.value = "";
    e.family.value = "yes";
    e.wifeBranch.value = "";
    if (e.wifeFamilyName) e.wifeFamilyName.value = "";
    e.order.value = "";
    e.lineage.value = "";
    updateWifeFieldsVisibility();
  }

  function wifeDuplicateKey(value) {
    return clean(value)
      .replace(/\b(بن|ابن|بنت)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function hasThreePartWifeName(value) {
    return wifeDuplicateKey(value).split(" ").filter(Boolean).length >= 3;
  }

  async function findDuplicateWife(c, husbandId, row) {
    const candidate = row.wife_lineage && hasThreePartWifeName(row.wife_lineage)
      ? row.wife_lineage
      : row.wife_name;
    if (!hasThreePartWifeName(candidate)) return null;

    const key = wifeDuplicateKey(candidate);
    const { data, error } = await c.from("tree_spouses")
      .select("id,husband_id,wife_name,wife_lineage")
      .limit(1000);

    if (error) throw error;

    return (Array.isArray(data) ? data : []).find((item) => {
      if (editingSpouseId && Number(item.id) === Number(editingSpouseId)) return false;
      if (Number(item.husband_id) === Number(husbandId)) return false;
      const other = item.wife_lineage && hasThreePartWifeName(item.wife_lineage)
        ? item.wife_lineage
        : item.wife_name;
      return hasThreePartWifeName(other) && wifeDuplicateKey(other) === key;
    }) || null;
  }

  function updateWifeFieldsVisibility() {
    const e = els();
    const isOutside = e.family && e.family.value === "no";
    const familyNameField = e.wifeFamilyName ? e.wifeFamilyName.closest(".field") : null;
    const branchField = e.wifeBranch ? e.wifeBranch.closest(".field") : null;

    if (familyNameField) familyNameField.style.display = isOutside ? "" : "none";
    if (branchField) branchField.style.display = isOutside ? "none" : "";

    if (isOutside && e.wifeBranch) e.wifeBranch.value = "";
    if (!isOutside && e.wifeFamilyName) e.wifeFamilyName.value = "";
  }

  async function saveSpouse(ev) {
    ev.preventDefault();
    const c = sb(), e = els(), husbandId = selectedHusbandId();
    if (!c || !husbandId) return status("اختر الزوج أولاً.");

    const row = {
      husband_id: Number(husbandId),
      wife_name: clean(e.name.value),
      wife_is_family_member: e.family.value !== "no",
      wife_branch_key: e.family.value === "no" ? null : (clean(e.wifeBranch.value) || null),
      wife_family_name: e.family.value === "no" ? (clean(e.wifeFamilyName && e.wifeFamilyName.value) || null) : null,
      wife_lineage: clean(e.lineage.value) || null,
      marriage_order: e.order.value ? Number(e.order.value) : null,
      status: "active",
      confidence: "confirmed",
      updated_at: new Date().toISOString()
    };
    if (!row.wife_name) return status("اكتب اسم الزوجة.");

    try {
      const dup = await findDuplicateWife(c, husbandId, row);
      if (dup) {
        return status("هذه الزوجة مسجلة مسبقًا مع زوج آخر. راجع الاسم الثلاثي أو سلسلة النسب قبل الحفظ.");
      }
    } catch (err) {
      return status("تعذر التحقق من تكرار اسم الزوجة، حاول لاحقًا.");
    }

    const res = editingSpouseId
      ? await c.from("tree_spouses").update(row).eq("id", editingSpouseId)
      : await c.from("tree_spouses").insert(row);

    if (res.error) return status("تعذر حفظ الزوجة: " + (res.error.message || "خطأ"));
    clearForm();
    status(editingSpouseId ? "تم تعديل الزوجة." : "تم حفظ الزوجة.");
    await loadSpouses();
  }

  async function deleteSpouse(row) {
    const spouseId = Number(row && row.id ? row.id : 0);
    if (!spouseId) return status("تعذر تحديد الزوجة للحذف.");

    const wifeName = clean(row.wife_name || "");
    if (!confirm("حذف الزوجة: " + (wifeName || spouseId) + " ؟\nسيتم فك روابط أبنائها أولاً.")) return;

    const c = sb();
    if (!c) return status("تعذر الاتصال بقاعدة البيانات.");

    status("جاري حذف الزوجة...");

    const links = await c.from("tree_mother_links")
      .delete()
      .eq("spouse_id", spouseId);

    if (links.error) {
      return status("تعذر فك روابط الأبناء: " + (links.error.message || "خطأ"));
    }

    const del = await c.from("tree_spouses")
      .delete()
      .eq("id", spouseId);

    if (del.error) {
      return status("تعذر حذف الزوجة: " + (del.error.message || "خطأ"));
    }

    const check = await c.from("tree_spouses")
      .select("id")
      .eq("id", spouseId)
      .maybeSingle();

    if (check.error) {
      return status("تعذر التحقق من الحذف: " + (check.error.message || "خطأ"));
    }

    if (check.data && check.data.id) {
      return status("لم يتم حذف الزوجة فعلياً. تحقق من صلاحيات الحذف RLS.");
    }

    spouses = spouses.filter((x) => Number(x.id) !== spouseId);
    renderSpouses();
    closeManager();
    clearForm();
    status("تم حذف الزوجة فعلياً.");
    await loadSpouses();
  }

  async function getHusbandChildren() {
    const c = sb(), e = els(), branch = selectedBranch();
    const opt = e.husband ? e.husband.options[e.husband.selectedIndex] : null;
    const husbandPath = clean(opt && opt.dataset ? opt.dataset.path : "");
    if (!c || !branch || !husbandPath) return [];

    const candidates = [husbandPath, leaf(husbandPath)].filter(Boolean);

    const p1 = await c.from("tree_children")
      .select("id,branch_key,parent_name,parent,child_name,name,birth_order")
      .eq("branch_key", branch)
      .in("parent_name", candidates)
      .limit(500);

    const p2 = await c.from("tree_children")
      .select("id,branch_key,parent_name,parent,child_name,name,birth_order")
      .eq("branch_key", branch)
      .in("parent", candidates)
      .limit(500);

    const merged = new Map();
    (Array.isArray(p1.data) ? p1.data : []).forEach((r) => merged.set(String(r.id), r));
    (Array.isArray(p2.data) ? p2.data : []).forEach((r) => merged.set(String(r.id), r));

    const data = Array.from(merged.values());
    return data.map(r => {
      const p = clean(r.child_name || r.name || "");
      return { id: r.id, name: p, label: leaf(p), order: r.birth_order || "" };
    }).filter(x => x.id != null && x.name);
  }

  async function linkedForSpouse(id) {
    const c = sb();
    const { data, error } = await c.from("tree_mother_links").select("child_id").eq("spouse_id", Number(id)).limit(1000);
    if (error) return new Set();
    return new Set((Array.isArray(data) ? data : []).map(r => String(r.child_id)));
  }

  function managerBox() {
    let box = $("admin-wife-children-manager");
    if (box) return box;
    box = document.createElement("div");
    box.id = "admin-wife-children-manager";
    box.className = "source-tree-item";
    box.style.marginTop = "10px";
    const e = els();
    e.list.parentElement.insertBefore(box, e.list.nextSibling);
    return box;
  }

  async function openManager(row) {
    managerState = {
      spouse: row,
      children: await getHusbandChildren(),
      linked: await linkedForSpouse(row.id)
    };
    renderManager();
  }

  function closeManager() {
    managerState = { spouse: null, children: [], linked: new Set() };
    const box = $("admin-wife-children-manager");
    if (box) { box.innerHTML = ""; box.style.display = "none"; }
  }

  function renderManager() {
    const box = managerBox(), st = managerState;
    if (!st.spouse) return closeManager();
    box.style.display = "block";
    box.innerHTML =
      '<strong>إدارة أبناء الزوجة</strong>' +
      '<div class="hint">الزوجة: ' + esc(st.spouse.wife_name || "") + '</div>' +
      '<div style="margin-top:8px;max-height:240px;overflow:auto;border:1px solid #e5e7eb;border-radius:10px;padding:8px;">' +
      (st.children.length ? st.children.map(ch => {
        const checked = st.linked.has(String(ch.id)) ? " checked" : "";
        return '<label style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #eee;">' +
          '<input type="checkbox" data-admin-wife-child-id="' + esc(ch.id) + '"' + checked + ' />' +
          '<span>' + esc((ch.label || ch.name) + (ch.order ? " — الترتيب: " + ch.order : "")) + '</span></label>';
      }).join("") : '<div class="hint">لا يوجد أبناء لهذا الزوج.</div>') +
      '</div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">' +
      '<button id="admin-save-wife-children-links-btn" class="btn btn-primary btn-sm" type="button">حفظ ربط الأبناء</button>' +
      '<button id="admin-close-wife-children-links-btn" class="btn btn-outline btn-sm" type="button">إغلاق</button></div>';

    $("admin-save-wife-children-links-btn").onclick = saveLinks;
    $("admin-close-wife-children-links-btn").onclick = closeManager;
  }

  async function saveLinks() {
    const c = sb(), st = managerState;
    if (!c || !st.spouse) return;
    const spouseId = Number(st.spouse.id);
    const allIds = st.children.map(x => String(x.id));
    const checked = new Set(Array.from(document.querySelectorAll("[data-admin-wife-child-id]"))
      .filter(x => x.checked).map(x => String(x.getAttribute("data-admin-wife-child-id"))));

    const del = await c.from("tree_mother_links").delete().eq("spouse_id", spouseId);
    if (del.error) return status("تعذر تحديث الربط: " + (del.error.message || "خطأ"));

    const rows = st.children.filter(ch => checked.has(String(ch.id))).map(ch => ({
      child_id: Number(ch.id),
      spouse_id: spouseId,
      mother_name: st.spouse.wife_name || null,
      mother_is_family_member: st.spouse.wife_is_family_member == null ? null : st.spouse.wife_is_family_member,
      mother_branch_key: st.spouse.wife_branch_key || null,
      mother_family_name: st.spouse.wife_family_name || null,
      mother_lineage: st.spouse.wife_lineage || null,
      confidence: "confirmed",
      updated_at: new Date().toISOString()
    }));

    if (rows.length) {
      const ins = await c.from("tree_mother_links").upsert(rows, { onConflict: "child_id" });
      if (ins.error) return status("تعذر حفظ الربط: " + (ins.error.message || "خطأ"));
    }

    status("تم حفظ ربط أبناء الزوجة.");
    closeManager();
    await loadSpouses();
  }

  function bind() {
    const e = els();
    if (!e.section || e.section.dataset.adminSpousesReady === "1") return;
    e.section.dataset.adminSpousesReady = "1";
    if (e.load) e.load.addEventListener("click", loadHusbands);
    if (e.branch) e.branch.addEventListener("change", () => { closeManager(); loadHusbands(); });
    if (e.husband) e.husband.addEventListener("change", loadSpouses);
    if (e.family) e.family.addEventListener("change", updateWifeFieldsVisibility);
    updateWifeFieldsVisibility();
    if (e.form) e.form.addEventListener("submit", saveSpouse);
  }

  document.addEventListener("DOMContentLoaded", bind);
})();
