(() => {
  const Core = window.AlzidanAdminCore || {};
  const getClient = typeof Core.getClient === "function" ? Core.getClient : () => null;

  const normalizeTreeCardText =
    (window.TreeLineage && window.TreeLineage.normalizeTreeCardText) ||
    function (v) {
      return String(v || "").replace(/\s+/g, " ").trim();
    };
  const relationLeafName =
    (window.TreeLineage && window.TreeLineage.relationLeafName) ||
    function (path) {
      const parts = String(path || "")
        .split("/")
        .map(normalizeTreeCardText)
        .filter(Boolean);
      return parts.length ? parts[parts.length - 1] : "";
    };
  const relationPathLabel =
    (window.TreeLineage && window.TreeLineage.relationPathLabel) ||
    function (path) {
      return String(path || "")
        .split("/")
        .map(normalizeTreeCardText)
        .filter(Boolean)
        .join(" ← ");
    };

  const sourceTreeBranch = document.getElementById("source-tree-branch");
  const sourceTreeLoad = document.getElementById("source-tree-load");
  const sourceTreeNew = document.getElementById("source-tree-new");
  const sourceTreeList = document.getElementById("source-tree-list");
  const sourceTreeForm = document.getElementById("source-tree-form");
  const sourceTreeId = document.getElementById("source-tree-id");
  const sourceTreePersonId = document.getElementById("source-tree-person-id");
  const sourceTreeParent = document.getElementById("source-tree-parent");
  const sourceTreeName = document.getElementById("source-tree-name");
  const sourceTreeOrder = document.getElementById("source-tree-order");
  const sourceTreeExtraChildren = document.getElementById(
    "source-tree-extra-children",
  );
  const sourceTreeAddExtraChild = document.getElementById(
    "source-tree-add-extra-child",
  );
  const sourceTreeBirthG = document.getElementById("source-tree-birth-g");
  const sourceTreeBirthH = document.getElementById("source-tree-birth-h");
  const sourceTreeAge = document.getElementById("source-tree-age");
  const sourceTreeDeathG = document.getElementById("source-tree-death-g");
  const sourceTreeDeathH = document.getElementById("source-tree-death-h");
  const sourceTreeCity = document.getElementById("source-tree-city");
  const sourceTreeArea = document.getElementById("source-tree-area");
  const sourceTreeDeceased = document.getElementById("source-tree-deceased");
  const sourceTreeDelete = document.getElementById("source-tree-delete");
  const sourceTreeStatus = document.getElementById("source-tree-status");
  let sourceTreeRows = [];

  function getAdminToken() {
    return window.AlzidanAuth && typeof window.AlzidanAuth.getAdminToken === "function"
      ? String(window.AlzidanAuth.getAdminToken() || "").trim()
      : "";
  }

  function setSourceTreeStatus(text) {
    if (sourceTreeStatus) sourceTreeStatus.textContent = String(text || "");
  }

  const escapeHtml = Core.escapeHtml;

  function getSourceTreeBranch() {
    return (
      normalizeTreeCardText(
        sourceTreeBranch && sourceTreeBranch.value
          ? sourceTreeBranch.value
          : "لاحم",
      ) || "لاحم"
    );
  }

  function sourceTreeRoot(branch) {
    const b = normalizeTreeCardText(branch);
    return b ? b + " بن مطلق بن زيدان" : "";
  }

  function sourceTreeRowPath(row) {
    const rawChild = normalizeTreeCardText(
      row && (row.child_name || row.name) ? row.child_name || row.name : "",
    );
    if (!rawChild) return "";
    if (rawChild.includes("/")) return rawChild;
    const parent = sourceTreeParentPath(row);
    return parent ? parent + "/" + rawChild : rawChild;
  }

  function sourceTreeParentPath(row) {
    return normalizeTreeCardText(
      row && (row.parent_name || row.parent)
        ? row.parent_name || row.parent
        : "",
    );
  }

  function sourceTreeLeaf(path) {
    return relationLeafName(path);
  }

  function sourceTreeSortRows(rows) {
    return (Array.isArray(rows) ? rows.slice() : []).sort((a, b) => {
      const ap = sourceTreeParentPath(a);
      const bp = sourceTreeParentPath(b);
      if (ap !== bp) return ap.localeCompare(bp, "ar");
      const ao = Number(a.birth_order || 0);
      const bo = Number(b.birth_order || 0);
      if (ao && bo && ao !== bo) return ao - bo;
      if (ao && !bo) return -1;
      if (!ao && bo) return 1;
      const ag = String(a.birth_date_g || "");
      const bg = String(b.birth_date_g || "");
      if (ag && bg && ag !== bg) return ag.localeCompare(bg);
      return sourceTreeLeaf(sourceTreeRowPath(a)).localeCompare(
        sourceTreeLeaf(sourceTreeRowPath(b)),
        "ar",
      );
    });
  }

  function sourceTreeParentOfPath(path) {
    const p = normalizeTreeCardText(path || "");
    const idx = p.lastIndexOf("/");
    return idx > 0 ? p.slice(0, idx) : "";
  }

  function sourceTreeDisplayRows() {
    const byChildPath = new Map();

    sourceTreeRows.forEach((row) => {
      const child = sourceTreeRowPath(row);
      if (!child) return;

      const existing = byChildPath.get(child);
      if (!existing || (row.id && !existing.id)) {
        byChildPath.set(child, row);
      }
    });

    return sourceTreeSortRows(Array.from(byChildPath.values()));
  }

  function sourceTreeChildrenCount(row) {
    const childPath = sourceTreeRowPath(row);
    const personId = normalizeTreeCardText(
      row && row.person_id ? row.person_id : "",
    );
    return sourceTreeRows.filter((x) => {
      const parentId = normalizeTreeCardText(
        x && x.parent_person_id ? x.parent_person_id : "",
      );
      if (personId && parentId && parentId === personId) return true;
      return sourceTreeParentPath(x) === childPath;
    }).length;
  }

  function refreshSourceTreeParentOptions(selectedValue) {
    if (!sourceTreeParent) return;
    const branch = getSourceTreeBranch();
    const root = sourceTreeRoot(branch);
    const current = normalizeTreeCardText(
      selectedValue || sourceTreeParent.value || root,
    );
    const paths = new Map();
    if (root) paths.set(root, root);
    sourceTreeDisplayRows().forEach((row) => {
      const child = sourceTreeRowPath(row);
      if (child) paths.set(child, child);
    });
    sourceTreeParent.innerHTML = "";
    paths.forEach((path) => {
      const option = document.createElement("option");
      option.value = path;
      option.textContent = relationPathLabel(path);
      sourceTreeParent.appendChild(option);
    });
    if (current && !paths.has(current)) {
      const option = document.createElement("option");
      option.value = current;
      option.textContent = relationPathLabel(current);
      sourceTreeParent.appendChild(option);
    }
    sourceTreeParent.value = current || root || "";
  }

  function resetSourceTreeForm(parentValue) {
    clearSourceTreeExtraChildren();
    if (sourceTreeId) sourceTreeId.value = "";
    if (sourceTreePersonId) sourceTreePersonId.value = "";
    const parent = parentValue || sourceTreeRoot(getSourceTreeBranch());
    refreshSourceTreeParentOptions(parent);
    addSourceTreeExtraChildField("", 1, {
      _cardTitle: "الشخص",
      parent_name: parent,
      parent: parent,
      birth_order: 1,
    });
    if (sourceTreeDelete) sourceTreeDelete.disabled = true;
    setSourceTreeStatus("وضع إضافة شخص جديد.");
  }

  function fillSourceTreeForm(row) {
    clearSourceTreeExtraChildren();
    if (!row) return resetSourceTreeForm();
    const parent = sourceTreeParentPath(row);
    const child = sourceTreeRowPath(row);
    if (sourceTreeId) sourceTreeId.value = String(row.id || "");
    if (sourceTreePersonId) sourceTreePersonId.value = String(row.person_id || "");
    refreshSourceTreeParentOptions(parent);
    if (sourceTreeExtraChildren) sourceTreeExtraChildren.dataset.currentPersonPath = child;

    const mainRow = Object.assign({}, row, { _cardTitle: "الشخص" });
    addSourceTreeExtraChildField(sourceTreeLeaf(child), row.birth_order || 1, mainRow);

    sourceTreeDirectChildren(row).forEach((childRow, index) => {
      addSourceTreeExtraChildField(
        sourceTreeLeaf(sourceTreeRowPath(childRow)),
        childRow.birth_order || index + 1,
        Object.assign({}, childRow, {
          _cardTitle: "الابن " + String(index + 1),
        }),
      );
    });

    if (sourceTreeDelete) sourceTreeDelete.disabled = !row.id;
    setSourceTreeStatus("تعديل: " + relationPathLabel(child));
  }

  function selectSourceTreeRow(row, itemEl) {
    if (sourceTreeList)
      sourceTreeList
        .querySelectorAll(".source-tree-item")
        .forEach((x) => x.classList.remove("active"));
    if (itemEl) itemEl.classList.add("active");
    fillSourceTreeForm(row);
  }

  function startAddSourceTreeChild(row) {
    const child = sourceTreeRowPath(row);
    resetSourceTreeForm(child || sourceTreeRoot(getSourceTreeBranch()));
    setSourceTreeStatus("إضافة ابن تحت: " + relationPathLabel(child));
    if (sourceTreeName) sourceTreeName.focus();
  }

  function renderSourceTreeList() {
    if (!sourceTreeList) return;
    sourceTreeList.innerHTML = "";
    const rows = sourceTreeDisplayRows();
    if (!rows.length) {
      sourceTreeList.innerHTML =
        '<div class="hint">لا توجد بيانات لهذا الفرع بعد.</div>';
      return;
    }
    rows.forEach((row) => {
      const item = document.createElement("div");
      item.className = "source-tree-item";
      item.dataset.id = String(row.id || "");
      const child = sourceTreeRowPath(row);
      const parent = sourceTreeParentPath(row);
      const childrenCount = sourceTreeChildrenCount(row);
      const isVirtual = !!row._virtual;
      item.innerHTML = `<div class="source-tree-item-title">${escapeHtml(sourceTreeLeaf(child) || child)}</div><div class="source-tree-item-meta">الأب: ${escapeHtml(sourceTreeLeaf(parent) || parent || "-")} · الأبناء: ${childrenCount}${row.birth_order ? " · الترتيب: " + escapeHtml(row.birth_order) : ""}${isVirtual ? " · مستنتج من المسار" : ""}</div><div class="source-tree-item-actions"><button class="btn btn-outline btn-sm" type="button" data-source-tree-edit>تعديل</button><button class="btn btn-primary btn-sm" type="button" data-source-tree-add-child>إضافة ابن</button></div>`;
      const editBtn = item.querySelector("[data-source-tree-edit]");
      const addChildBtn = item.querySelector("[data-source-tree-add-child]");
      if (editBtn)
        editBtn.addEventListener("click", () => selectSourceTreeRow(row, item));
      if (addChildBtn)
        addChildBtn.addEventListener("click", () => startAddSourceTreeChild(row));
      item.addEventListener("dblclick", () => selectSourceTreeRow(row, item));
      sourceTreeList.appendChild(item);
    });
  }

  async function loadSourceTreeRows() {
    const sb = getClient();
    const token = getAdminToken();
    if (!sb || !token) {
      setSourceTreeStatus("سجل الدخول أولًا.");
      return;
    }
    const branch = getSourceTreeBranch();
    setSourceTreeStatus("جاري تحميل الشجرة...");
    const fields = [
      "id,person_id,parent_person_id,branch_key,parent_name,parent,child_name,name,birth_date_g,birth_date_h,birth_year,birth_order,death_date_g,death_date_h,city,area,is_deceased,deceased,created_at",
      "id,person_id,parent_person_id,branch_key,parent_name,parent,child_name,name,birth_date_g,birth_date_h,birth_year,birth_order,city,area,is_deceased,deceased,created_at",
      "id,branch_key,parent_name,parent,child_name,name,birth_date_g,birth_date_h,birth_year,birth_order,city,area,is_deceased,deceased,created_at",
    ];
    let lastError = null;
    for (const f of fields) {
      const { data, error } = await sb
        .from("tree_children")
        .select(f)
        .eq("branch_key", branch)
        .limit(3000);
      if (!error) {
        sourceTreeRows = Array.isArray(data) ? data : [];
        renderSourceTreeList();
        resetSourceTreeForm(sourceTreeRoot(branch));
        setSourceTreeStatus("تم تحميل " + sourceTreeRows.length + " علاقة.");
        return;
      }
      lastError = error;
      const msg = String(error.message || "").toLowerCase();
      if (!(msg.includes("column") && msg.includes("does not exist"))) break;
    }
    sourceTreeRows = [];
    renderSourceTreeList();
    setSourceTreeStatus(
      "تعذر تحميل الشجرة حالياً، حاول لاحقاً أو تواصل مع الإدارة.",
    );
  }

  function sourceTreeCurrentYear() {
    return new Date().getFullYear();
  }

  function normalizeSourceTreeNumber(value) {
    return String(value || "")
      .replace(/[٠-٩۰-۹]/g, (digit) => {
        const code = digit.charCodeAt(0);
        const arabicZero = "٠".charCodeAt(0);
        const persianZero = "۰".charCodeAt(0);
        return String(
          code >= persianZero ? code - persianZero : code - arabicZero,
        );
      })
      .replace(/[^0-9]/g, "");
  }

  function hijriYearToApproxGregorian(hijriYear) {
    const y = Number(hijriYear);
    if (!Number.isFinite(y) || y < 1200 || y > 1700) return null;
    return Math.round(y * 0.970224 + 621.5774);
  }

  function getYearFromDateValue(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const normalized = normalizeSourceTreeNumber(raw);
    const match = normalized.match(/(13|14|15|19|20)\d{2}/);
    if (!match) return null;
    return Number(match[0]);
  }

  function getReferenceYearForApproxAge() {
    const deathGregorianYear = getYearFromDateValue(
      sourceTreeDeathG && sourceTreeDeathG.value ? sourceTreeDeathG.value : "",
    );
    if (deathGregorianYear) return deathGregorianYear;
    const deathHijriYear = getYearFromDateValue(
      sourceTreeDeathH && sourceTreeDeathH.value ? sourceTreeDeathH.value : "",
    );
    const approxGregorian = deathHijriYear
      ? hijriYearToApproxGregorian(deathHijriYear)
      : null;
    if (approxGregorian) return approxGregorian;
    return sourceTreeCurrentYear();
  }

  function birthYearFromApproxAge() {
    const raw = normalizeSourceTreeNumber(
      sourceTreeAge && sourceTreeAge.value ? sourceTreeAge.value : "",
    );
    if (!raw) return "";
    const age = Number(raw);
    if (!Number.isFinite(age) || age < 0 || age > 130) return "";
    const deathHijriYear = getYearFromDateValue(
      sourceTreeDeathH && sourceTreeDeathH.value ? sourceTreeDeathH.value : "",
    );
    if (deathHijriYear) return String(deathHijriYear - age);
    return String(getReferenceYearForApproxAge() - age);
  }

  function approxAgeFromBirthYear(yearValue) {
    const year = Number(normalizeSourceTreeNumber(yearValue));
    if (!Number.isFinite(year) || year < 1800) return "";
    const age = sourceTreeCurrentYear() - year;
    if (!Number.isFinite(age) || age < 0 || age > 130) return "";
    return String(age);
  }

  function clearSourceTreeExtraChildren() {
    if (sourceTreeExtraChildren) sourceTreeExtraChildren.innerHTML = "";
  }

  function nextSourceTreeOrderValue() {
    const first = Number(
      sourceTreeOrder && sourceTreeOrder.value ? sourceTreeOrder.value : 1,
    );
    const base = Number.isFinite(first) && first > 0 ? first : 1;
    const count = sourceTreeExtraChildren
      ? sourceTreeExtraChildren.querySelectorAll("[data-extra-child-row]")
          .length
      : 0;
    return base + count + 1;
  }

  function addSourceTreeExtraChildField(value, forcedOrder, existingRow) {
    if (!sourceTreeExtraChildren) return null;

    const data = existingRow || {};
    const nextOrder =
      forcedOrder || data.birth_order ||
      (sourceTreeExtraChildren.querySelectorAll("[data-extra-child-row]").length + 1);
    const row = document.createElement("div");
    row.setAttribute("data-extra-child-row", "1");
    row.dataset.id = String(data.id || "");
    row.dataset.personId = String(data.person_id || "");
    row.dataset.parentPersonId = String(data.parent_person_id || "");
    row.dataset.parentName = String(
      sourceTreeParentPath(data) ||
        (data._cardTitle === "الشخص"
          ? ""
          : sourceTreeExtraChildren && sourceTreeExtraChildren.dataset.currentPersonPath
          ? sourceTreeExtraChildren.dataset.currentPersonPath
          : "") ||
        "",
    );
    row.dataset.cardRole = data._cardTitle === "الشخص" ? "person" : "child";
    row.style.cssText =
      "grid-column:1/-1;border:1px solid #d8e8df;border-radius:16px;padding:14px;margin:8px 0;background:#fff;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;";

    const titleText = data._cardTitle || ("الابن " + String(nextOrder));
    row.innerHTML =
      '<div data-child-card-title style="grid-column:1/-1;font-weight:800;color:#064e3b;">' +
      escapeHtml(titleText) +
      '</div>' +
      '<div class="field"><label>الاسم</label><input data-extra-child-name type="text" placeholder="اسم الابن" value="' +
      escapeHtml(value || sourceTreeLeaf(sourceTreeRowPath(data)) || "") +
      '"></div>' +
      '<div class="field"><label>رقم الجوال</label><input data-extra-child-phone type="tel" inputmode="numeric" placeholder="05XXXXXXXX" value="' +
      escapeHtml(data.phone || "") +
      '"></div>' +
      '<div class="field"><label>الترتيب</label><input data-extra-child-order type="number" min="1" inputmode="numeric" value="' +
      escapeHtml(nextOrder == null ? "" : String(nextOrder)) +
      '"></div>' +
      '<div class="field"><label>تاريخ الميلاد ميلادي</label><input data-extra-child-birth-g type="date" value="' +
      escapeHtml(String(data.birth_date_g || "").slice(0, 10)) +
      '"></div>' +
      '<div class="field"><label>تاريخ الميلاد هجري</label><input data-extra-child-birth-h type="text" placeholder="مثال: 1392/08/10" value="' +
      escapeHtml(data.birth_date_h || "") +
      '"></div>' +
      '<div class="field"><label>العمر التقريبي</label><input data-extra-child-age type="number" min="0" max="130" inputmode="numeric" placeholder="مثال: 63"></div>' +
      '<div class="field"><label>تاريخ الوفاة ميلادي</label><input data-extra-child-death-g type="date" value="' +
      escapeHtml(String(data.death_date_g || "").slice(0, 10)) +
      '"></div>' +
      '<div class="field"><label>تاريخ الوفاة هجري</label><input data-extra-child-death-h type="text" placeholder="اختياري" value="' +
      escapeHtml(data.death_date_h || "") +
      '"></div>' +
      '<div class="field"><label>المدينة</label><input data-extra-child-city type="text" value="' +
      escapeHtml(data.city || "") +
      '"></div>' +
      '<div class="field"><label>الحي/القرية</label><input data-extra-child-area type="text" value="' +
      escapeHtml(data.area || "") +
      '"></div>' +
      '<label style="grid-column:1/-1;display:flex;align-items:center;gap:8px;margin:4px 0;"><input data-extra-child-deceased type="checkbox"' +
      ((data.is_deceased || data.deceased) ? " checked" : "") +
      '> <span>متوفى / رحمه الله</span></label>' +
      '<div style="grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap;"><button class="btn btn-primary btn-sm" type="button" data-extra-child-save>حفظ هذه البطاقة</button><button class="btn btn-outline btn-sm" type="button" data-extra-child-remove>حذف هذه البطاقة</button></div>';

    const save = row.querySelector("[data-extra-child-save]");
    if (save) save.addEventListener("click", () => saveSourceTreeCard(row).catch(() => {}));

    const remove = row.querySelector("[data-extra-child-remove]");
    if (remove) remove.addEventListener("click", () => deleteSourceTreeCard(row).catch(() => {}));

    sourceTreeExtraChildren.appendChild(row);
    renumberSourceTreeChildCards();
    return row;
  }

  function renumberSourceTreeChildCards() {
    if (!sourceTreeExtraChildren) return;
    Array.from(sourceTreeExtraChildren.querySelectorAll("[data-extra-child-row]")).forEach((row, i) => {
      const title = row.querySelector("[data-child-card-title]");
      const order = row.querySelector("[data-extra-child-order]");
      if (row.dataset.cardRole === "person") {
        if (title) title.textContent = "الشخص";
        return;
      }
      const n = Array.from(sourceTreeExtraChildren.querySelectorAll("[data-extra-child-row]")).filter((x) => x.dataset.cardRole !== "person").indexOf(row) + 1;
      if (title) title.textContent = "الابن " + n;
      if (order && !order.value) order.value = String(n);
    });
  }

  function ensureSourceTreeFirstChildRow() {
    if (!sourceTreeExtraChildren) return;
    if (!sourceTreeExtraChildren.querySelector("[data-extra-child-row]")) {
      addSourceTreeExtraChildField("", 1);
    }
  }

  function hideSourceTreeLegacyChildFields() {
    return;
    [
      "source-tree-name",
      "source-tree-order",
      "source-tree-birth-g",
      "source-tree-birth-h",
      "source-tree-age",
      "source-tree-death-g",
      "source-tree-death-h",
      "source-tree-city",
      "source-tree-area",
    ].forEach((id) => {
      const el = document.getElementById(id);
      const wrap = el ? el.closest(".field") : null;
      if (wrap) wrap.style.display = "none";
    });
    if (sourceTreeDeceased) {
      const wrap = sourceTreeDeceased.closest("label");
      if (wrap) wrap.style.display = "none";
    }
  }

  function getSourceTreeExtraChildrenPayloads(basePayload) {
    if (!sourceTreeExtraChildren || !basePayload) return [];

    return Array.from(sourceTreeExtraChildren.querySelectorAll("[data-extra-child-row]"))
      .slice(1)
      .map((row) => buildPayloadFromCardRow(row))
      .filter(Boolean);
  }

  function birthPad2(n) {
    return String(n).padStart(2, "0");
  }

  function normalizeDateDigitsOnly(value) {
    return String(value || "")
      .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
      .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
      .trim();
  }

  function parseGregorianISO(value) {
    if (value instanceof Date && Number.isFinite(value.getTime())) return value;

    const raw = normalizeDateDigitsOnly(value);
    const m = raw.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
    if (!m) return null;

    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);

    if (y < 1800 || y > 2200 || mo < 1 || mo > 12 || d < 1 || d > 31)
      return null;

    const date = new Date(y, mo - 1, d);
    if (!Number.isFinite(date.getTime())) return null;

    if (
      date.getFullYear() !== y ||
      date.getMonth() !== mo - 1 ||
      date.getDate() !== d
    )
      return null;

    return date;
  }

  function gregorianDateToISO(date) {
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return "";
    return (
      date.getFullYear() +
      "-" +
      birthPad2(date.getMonth() + 1) +
      "-" +
      birthPad2(date.getDate())
    );
  }

  function parseHijriParts(value) {
    const raw = normalizeDateDigitsOnly(value);
    const parts = raw.split(/\D+/).filter(Boolean).map(Number);
    if (!parts.length) return null;

    let y = null,
      m = 1,
      d = 1,
      full = false;

    if (parts[0] >= 1200 && parts[0] <= 1700) {
      y = parts[0];
      m = parts[1] || 1;
      d = parts[2] || 1;
      full = parts.length >= 3;
    } else {
      const yi = parts.findIndex((x) => x >= 1200 && x <= 1700);
      if (yi === -1) return null;
      y = parts[yi];
      const before = parts.slice(0, yi);
      if (before.length >= 2) {
        d = before[0];
        m = before[1];
        full = true;
      } else if (before.length === 1) {
        m = before[0];
      }
    }

    if (y < 1200 || y > 1700 || m < 1 || m > 12 || d < 1 || d > 30) return null;
    return { y, m, d, full };
  }

  function hijriToISO(h) {
    if (!h || !h.y) return "";
    return String(h.y) + "-" + birthPad2(h.m || 1) + "-" + birthPad2(h.d || 1);
  }

  function hijriToGregorianISO(value) {
    const h = typeof value === "object" ? value : parseHijriParts(value);
    if (!h || !h.full) return "";

    const jd =
      Math.floor((11 * h.y + 3) / 30) +
      354 * h.y +
      30 * h.m -
      Math.floor((h.m - 1) / 2) +
      h.d +
      1948440 -
      385;

    let l = jd + 68569;
    const n = Math.floor((4 * l) / 146097);
    l = l - Math.floor((146097 * n + 3) / 4);
    const i = Math.floor((4000 * (l + 1)) / 1461001);
    l = l - Math.floor((1461 * i) / 4) + 31;
    const j = Math.floor((80 * l) / 2447);
    const day = l - Math.floor((2447 * j) / 80);
    l = Math.floor(j / 11);
    const month = j + 2 - 12 * l;
    const year = 100 * (n - 49) + i + l;

    return year + "-" + birthPad2(month) + "-" + birthPad2(day);
  }

  function gregorianToHijriISO(value) {
    const date = value instanceof Date ? value : parseGregorianISO(value);
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return "";

    try {
      const parts = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(date);

      const y = parts.find((x) => x.type === "year")?.value;
      const m = parts.find((x) => x.type === "month")?.value;
      const d = parts.find((x) => x.type === "day")?.value;

      if (y && m && d) return y + "-" + m + "-" + d;
    } catch (e) {}

    return "";
  }

  function shiftGregorianYears(date, yearsBack) {
    const d = new Date(date.getTime());
    d.setFullYear(d.getFullYear() - yearsBack);
    return d;
  }

  function normalizeBirthPayload(rawPayload) {
    const payload = Object.assign({}, rawPayload || {});

    function clean(v) {
      return String(v == null ? "" : v).trim();
    }

    let birthG = clean(payload.birth_date_g);
    let birthH = clean(payload.birth_date_h);
    let deathG = clean(payload.death_date_g);
    let deathH = clean(payload.death_date_h);
    const age = Number(
      normalizeDateDigitsOnly(payload._age || "").replace(/[^0-9]/g, ""),
    );
    const isDead = !!(payload.is_deceased || payload.deceased);

    if (deathH && !deathG) {
      const h = parseHijriParts(deathH);
      if (h) {
        deathH = hijriToISO(h);
        deathG = h.full ? hijriToGregorianISO(h) : "";
      }
    }

    if (deathG && !deathH) {
      const d = parseGregorianISO(deathG);
      if (d) {
        deathG = gregorianDateToISO(d);
        deathH = gregorianToHijriISO(d) || "";
      }
    }

    if (birthH && !birthG) {
      const h = parseHijriParts(birthH);
      if (h) {
        birthH = h.full ? hijriToISO(h) : "تقريباً " + String(h.y);
        birthG = h.full ? hijriToGregorianISO(h) : "";
      }
    }

    if (birthG && !birthH) {
      const d = parseGregorianISO(birthG);
      if (d) {
        birthG = gregorianDateToISO(d);
        birthH = gregorianToHijriISO(d) || "";
      }
    }

    if (!birthG && !birthH && Number.isFinite(age) && age > 0 && age <= 130) {
      if (isDead && deathH) {
        const dh = parseHijriParts(deathH);
        if (dh) {
          const bh = {
            y: dh.y - age,
            m: dh.m || 1,
            d: dh.d || 1,
            full: !!dh.full,
          };
          birthH = dh.full ? hijriToISO(bh) : "تقريباً " + String(bh.y);
          birthG = dh.full ? hijriToGregorianISO(bh) : "";
        }
      } else {
        const ref = isDead && deathG ? parseGregorianISO(deathG) : new Date();
        if (ref) {
          const bd = shiftGregorianYears(ref, age);
          birthG = gregorianDateToISO(bd);
          birthH = gregorianToHijriISO(bd) || "";
        }
      }
    }

    payload.birth_date_g = birthG || "";
    payload.birth_date_h = birthH || "";
    payload.death_date_g = deathG || "";
    payload.death_date_h = deathH || "";

    if (birthH) {
      const h = parseHijriParts(birthH);
      payload.birth_year = h && h.y ? String(h.y) : "";
    } else if (birthG) {
      const hText = gregorianToHijriISO(birthG);
      const h = parseHijriParts(hText);
      payload.birth_year = h && h.y ? String(h.y) : "";
    } else {
      payload.birth_year = clean(payload.birth_year);
    }

    delete payload._age;
    return payload;
  }

  function buildSourceTreePayload() {
    const branch = getSourceTreeBranch();
    const parent = normalizeTreeCardText(
      sourceTreeParent && sourceTreeParent.value ? sourceTreeParent.value : "",
    );
    if (!branch || !parent) return null;

    ensureSourceTreeFirstChildRow();

    const firstRow = sourceTreeExtraChildren
      ? sourceTreeExtraChildren.querySelector("[data-extra-child-row]")
      : null;

    const basePayload = {
      id: sourceTreeId && sourceTreeId.value ? sourceTreeId.value : "",
      person_id:
        sourceTreePersonId && sourceTreePersonId.value
          ? sourceTreePersonId.value
          : "",
      branch_key: branch,
      parent_name: parent,
    };

    return sourceTreePayloadFromChildCard(firstRow, basePayload);
  }

  function sourceTreePayloadFromChildCard(row, basePayload) {
    if (!row || !basePayload) return null;

    const val = (sel) => {
      const el = row.querySelector(sel);
      return el ? normalizeTreeCardText(el.value || "") : "";
    };
    const checked = (sel) => {
      const el = row.querySelector(sel);
      return !!(el && el.checked);
    };

    const name = val("[data-extra-child-name]");
    if (!name) return null;

    const child = name.includes("/") ? name : basePayload.parent_name + "/" + name;
    const rawPayload = Object.assign({}, basePayload, {
      child_name: child,
      name: child,
      birth_date_g: val("[data-extra-child-birth-g]"),
      birth_date_h: val("[data-extra-child-birth-h]"),
      birth_year: "",
      birth_order: val("[data-extra-child-order]"),
      death_date_g: val("[data-extra-child-death-g]"),
      death_date_h: val("[data-extra-child-death-h]"),
      city: val("[data-extra-child-city]"),
      area: val("[data-extra-child-area]"),
      is_deceased: checked("[data-extra-child-deceased]"),
      deceased: checked("[data-extra-child-deceased]"),
      _age: val("[data-extra-child-age]"),
    });

    return normalizeBirthPayload(rawPayload);
  }

  function sourceTreeDirectChildren(row) {
    const target = normalizeTreeCardText(sourceTreeRowPath(row));
    const targetPersonId = String((row && row.person_id) || "");
    if (!target && !targetPersonId) return [];

    return sourceTreeRows
      .filter((x) => {
        if (String(x.id || "") === String((row && row.id) || "")) return false;

        const parentPath = normalizeTreeCardText(sourceTreeParentPath(x));
        const childPath = normalizeTreeCardText(sourceTreeRowPath(x));

        if (targetPersonId && String(x.parent_person_id || "") === targetPersonId) return true;
        if (parentPath === target) return true;

        if (childPath.indexOf(target + "/") === 0) {
          const rest = childPath.slice((target + "/").length);
          return rest && !rest.includes("/");
        }

        return false;
      })
      .sort((a, b) => {
        const ao = Number(a.birth_order || 0);
        const bo = Number(b.birth_order || 0);
        if (ao && bo && ao !== bo) return ao - bo;
        if (ao && !bo) return -1;
        if (!ao && bo) return 1;
        return String(sourceTreeRowPath(a)).localeCompare(String(sourceTreeRowPath(b)), "ar");
      });
  }

  function buildPayloadFromCardRow(cardRow) {
    if (!cardRow) return null;
    const branch = getSourceTreeBranch();
    const parent = normalizeTreeCardText(
      cardRow.dataset.parentName || (sourceTreeParent && sourceTreeParent.value ? sourceTreeParent.value : ""),
    );
    const basePayload = {
      id: cardRow.dataset.id || "",
      person_id: cardRow.dataset.personId || "",
      parent_person_id: cardRow.dataset.parentPersonId || "",
      branch_key: branch,
      parent_name: parent,
    };
    return sourceTreePayloadFromChildCard(cardRow, basePayload);
  }

  async function reloadSourceTreeRowsKeepPlace() {
    const y = window.scrollY || window.pageYOffset || 0;
    const activeId = sourceTreeId && sourceTreeId.value ? String(sourceTreeId.value) : "";
    const activePersonId = sourceTreePersonId && sourceTreePersonId.value ? String(sourceTreePersonId.value) : "";
    await loadSourceTreeRows();
    if (activeId || activePersonId) {
      const found = sourceTreeRows.find((x) =>
        (activeId && String(x.id || "") === activeId) ||
        (activePersonId && String(x.person_id || "") === activePersonId),
      );
      if (found) fillSourceTreeForm(found);
    }
    window.scrollTo(0, y);
  }

  function normalizeMemberPhoneForAdmin(v) {
    return String(v || "").replace(/[^\d]/g, "").trim();
  }

  async function upsertMemberProfileFromTreeCard(cardRow, payload, savedId) {
    const phoneInput = cardRow ? cardRow.querySelector("[data-extra-child-phone]") : null;
    const phone = normalizeMemberPhoneForAdmin(phoneInput ? phoneInput.value : "");
    if (!phone) return { ok: true, skipped: true };

    const sb = getClient();
    if (!sb) return { ok: false, error: { message: "no supabase client" } };

    const branchKey = String(payload && payload.branch_key ? payload.branch_key : "").trim();
    const personId = String(payload && payload.person_id ? payload.person_id : "").trim();
    const treeChildId = savedId || (payload && payload.id ? payload.id : null);
    const childName = String(payload && (payload.child_name || payload.name) ? (payload.child_name || payload.name) : "").trim();
    const displayName = childName
      .split("/")
      .map((x) => String(x || "").trim())
      .filter(Boolean)
      .slice(-1)[0] || "";

    if (!branchKey || !treeChildId) return { ok: false, error: { message: "missing member profile keys" } };

    const row = {
      phone,
      branch_key: branchKey,
      tree_child_id: treeChildId,
      person_id: personId || null,
      display_name: displayName || null,
      status: "active",
      updated_at: new Date().toISOString(),
    };

    const found = await sb
      .from("member_profiles")
      .select("id")
      .eq("phone", phone)
      .limit(1)
      .maybeSingle();

    if (found.error) return { ok: false, error: found.error };

    if (found.data && found.data.id) {
      const { error } = await sb
        .from("member_profiles")
        .update(row)
        .eq("id", found.data.id);
      if (error) return { ok: false, error };
      return { ok: true };
    }

    row.created_at = new Date().toISOString();

    const { error } = await sb
      .from("member_profiles")
      .insert(row);

    if (error) return { ok: false, error };
    return { ok: true };
  }

  async function saveSourceTreeCard(cardRow) {
    const sb = getClient();
    const token = getAdminToken();
    if (!sb || !token) return setSourceTreeStatus("سجل الدخول أولًا.");
    const payload = buildPayloadFromCardRow(cardRow);
    if (!payload) return setSourceTreeStatus("أكمل بيانات البطاقة.");
    setSourceTreeStatus("جاري حفظ البطاقة...");
    const { data, error } = await sb.rpc("admin_tree_child_upsert_v1", {
      p_token: token,
      p_row: payload,
    });
    if (error) return setSourceTreeStatus("تعذر حفظ البطاقة: " + formatRpcError(error));
    const memberRes = await upsertMemberProfileFromTreeCard(cardRow, payload, data && data.id ? data.id : payload.id);
    if (!memberRes.ok) {
      setSourceTreeStatus(
        "تم حفظ البطاقة، لكن تعذر حفظ رقم الجوال: " +
          ((memberRes.error && memberRes.error.message) || "خطأ غير معروف"),
      );
      await reloadSourceTreeRowsKeepPlace();
      return;
    }

    setSourceTreeStatus("تم حفظ البطاقة.");
    await reloadSourceTreeRowsKeepPlace();
  }

  async function deleteSourceTreeCard(cardRow) {
    const sb = getClient();
    const token = getAdminToken();
    const branch = getSourceTreeBranch();
    const id = Number(cardRow && cardRow.dataset.id ? cardRow.dataset.id : 0);
    const payload = buildPayloadFromCardRow(cardRow);
    const label = payload ? sourceTreeLeaf(payload.child_name || payload.name || "") : "هذه البطاقة";

    if (!sb || !token) return setSourceTreeStatus("سجل الدخول أولًا.");

    if (!id) {
      cardRow.remove();
      renumberSourceTreeChildCards();
      return setSourceTreeStatus("تم حذف البطاقة غير المحفوظة.");
    }

    if (!window.confirm("حذف سجل «" + label + "» فقط؟")) return;

    setSourceTreeStatus("جاري حذف السجل فقط...");

    const { data, error } = await sb.rpc("admin_tree_child_delete_one_v1", {
      p_token: token,
      p_branch_key: branch,
      p_id: id,
    });

    if (error) {
      const msg = formatRpcError(error);
      const missing =
        msg.includes("admin_tree_child_delete_one_v1") ||
        msg.includes("Could not find the function") ||
        msg.includes("schema cache");

      if (missing) {
        setSourceTreeStatus("الدالة admin_tree_child_delete_one_v1 غير موجودة في القاعدة. نفّذ سكربت التهيئة/SQL أولاً.");
      } else {
        setSourceTreeStatus("تعذر حذف السجل فقط: " + msg);
      }
      return;
    }

    cardRow.remove();
    renumberSourceTreeChildCards();
    setSourceTreeStatus("تم حذف السجل فقط. لم يتم حذف الأبناء. عدد المحذوف: " + String(data || 0));
    await reloadSourceTreeRowsKeepPlace();
  }

  async function saveSourceTreeRow(event) {
    if (event) event.preventDefault();
    const sb = getClient();
    const token = getAdminToken();
    const payload = buildSourceTreePayload();
    if (!sb || !token) return setSourceTreeStatus("سجل الدخول أولًا.");
    if (!payload) return setSourceTreeStatus("أكمل الأب والاسم.");
    const extraPayloads = getSourceTreeExtraChildrenPayloads(payload);
    const payloads = [payload].concat(extraPayloads);
    setSourceTreeStatus("جاري الحفظ...");
    let saved = 0;
    for (const rowPayload of payloads) {
      const { data, error } = await sb.rpc("admin_tree_child_upsert_v1", {
        p_token: token,
        p_row: rowPayload,
      });
      if (error) {
        const rawMsg = JSON.stringify(
          {
            code: error.code || "",
            message: error.message || "",
            details: error.details || "",
            hint: error.hint || "",
          },
          null,
          2,
        );
        try {
          console.error("SOURCE_TREE_SAVE_ERROR", error, rowPayload);
        } catch (_) {}
        setSourceTreeStatus(
          "تعذر الحفظ: " +
            String(rowPayload.child_name || rowPayload.name || "") +
            " — تفاصيل الخطأ: " +
            rawMsg,
        );
        return;
      }
      saved += 1;
    }
    clearSourceTreeExtraChildren();
    setSourceTreeStatus("تم الحفظ. عدد السجلات: " + String(saved));
    await reloadSourceTreeRowsKeepPlace();
  }

  async function deleteSourceTreeSubtree() {
    const sb = getClient();
    const token = getAdminToken();
    const branch = getSourceTreeBranch();
    const id = Number(sourceTreeId && sourceTreeId.value ? sourceTreeId.value : 0);
    const firstCard = sourceTreeExtraChildren ? sourceTreeExtraChildren.querySelector("[data-extra-child-row]") : null;
    const firstPayload = firstCard ? buildPayloadFromCardRow(firstCard) : null;
    const name = firstPayload ? sourceTreeLeaf(firstPayload.child_name || firstPayload.name || "") : "";
    if (!sb || !token) return setSourceTreeStatus("سجل الدخول أولًا.");
    if (!id) return setSourceTreeStatus("اختر شخصًا من القائمة أولًا.");
    const ok = window.confirm(
      "سيتم حذف «" + name + "» وكل من تحته من الشجرة. هل أنت متأكد؟",
    );
    if (!ok) return;
    setSourceTreeStatus("جاري الحذف...");
    const { data, error } = await sb.rpc("admin_tree_child_delete_subtree_v1", {
      p_token: token,
      p_branch_key: branch,
      p_id: id,
    });
    if (error) {
      const msg = formatRpcError(error);
      const missing =
        msg.toLowerCase().includes("could not find the function") ||
        msg.toLowerCase().includes("does not exist") ||
        String(error.code || "").toLowerCase() === "pgrst202";
      setSourceTreeStatus(
        missing
          ? "الدالة غير ظاهرة لـ الخدمة بعد التهيئة. حاول تحديث الصفحة، أو تواصل مع الإدارة." +
              msg
          : "تعذر الحذف: " + msg,
      );
      return;
    }
    setSourceTreeStatus("تم حذف " + String(data || 0) + " سجل.");
    await reloadSourceTreeRowsKeepPlace();
  }

  function setProtectedVisibility(isAuthed) {
    const ok = !!isAuthed;
    if (sourceTreeLoad) sourceTreeLoad.disabled = !ok;
    if (sourceTreeNew) sourceTreeNew.disabled = !ok;
    if (sourceTreeForm)
      Array.from(sourceTreeForm.elements || []).forEach((el) => {
        el.disabled = !ok;
      });
    if (sourceTreeDelete && ok && !(sourceTreeId && sourceTreeId.value))
      sourceTreeDelete.disabled = true;
  }

  function bindSourceTreeEvents() {
    if (sourceTreeBranch)
      sourceTreeBranch.addEventListener("change", () => {
        loadSourceTreeRows().catch(() => {});
      });
    if (sourceTreeLoad)
      sourceTreeLoad.addEventListener("click", () => {
        loadSourceTreeRows().catch(() => {});
      });
    if (sourceTreeNew)
      sourceTreeNew.addEventListener("click", () => resetSourceTreeForm());
    if (sourceTreeAddExtraChild)
      sourceTreeAddExtraChild.addEventListener("click", () =>
        addSourceTreeExtraChildField(""),
      );
    if (sourceTreeForm)
      sourceTreeForm.addEventListener("submit", saveSourceTreeRow);
    if (sourceTreeDelete)
      sourceTreeDelete.addEventListener("click", () =>
        deleteSourceTreeSubtree().catch(() => {}),
      );
  }

  function formatRpcError(error) {
    if (!error) return "تعذر تنفيذ العملية، حاول لاحقاً أو تواصل مع الإدارة.";
    console.warn("Admin operation error:", error);
    return "تعذر تنفيذ العملية، حاول لاحقاً أو تواصل مع الإدارة.";
  }

  function initSourceTreeModule() {
    bindSourceTreeEvents();
    setProtectedVisibility(!!getAdminToken());
  }

  window.AdminSourceTree = {
    loadSourceTreeRows,
    setProtectedVisibility,
  };
  window.loadSourceTreeRows = loadSourceTreeRows;

  initSourceTreeModule();
})();
