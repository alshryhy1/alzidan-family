(function (root) {
  "use strict";

  var PersonCore = root.AlzidanFamilyPersonCore || {};
  var escapeHtml = PersonCore.escapeHtml || function (v) { return String(v || ""); };
  var setAlert = PersonCore.setAlert || function () {};
  var hideAlert = PersonCore.hideAlert || function () {};
  var normalizeText = PersonCore.normalizeText || function (v) { return String(v || "").trim(); };

  function createSpousesSection(opts) {
    var api = opts && opts.api ? opts.api : {};
    var getSelectedPersonId = opts.getSelectedPersonId || function () { return ""; };
    var onRefreshChildren = opts.onRefreshChildren || function () {};

    var container = document.createElement("div");
    container.className = "fm-spouses-section";

    var searchWrap = document.createElement("div");
    searchWrap.className = "field";
    searchWrap.innerHTML =
      '<label for="fm-wives-search">بحث الزوجات</label>' +
      '<input id="fm-wives-search" type="search" placeholder="ابحث باسم الزوجة" />';
    container.appendChild(searchWrap);

    var toolbar = document.createElement("div");
    toolbar.className = "fm-toolbar";
    toolbar.style.marginTop = "8px";
    toolbar.innerHTML =
      '<button type="button" class="btn btn-secondary btn-small" id="fm-link-all-wife-children">كل أبناء هذا الشخص من الزوجة الوحيدة</button>';
    container.appendChild(toolbar);

    var alertEl = document.createElement("div");
    alertEl.id = "fm-wives-alert";
    alertEl.className = "alert fm-section-alert";
    alertEl.style.display = "none";
    container.appendChild(alertEl);

    var listEl = document.createElement("div");
    listEl.id = "fm-wives-list";
    listEl.className = "fm-list";
    container.appendChild(listEl);

    var managerEl = document.createElement("div");
    managerEl.id = "fm-wife-children-manager";
    managerEl.className = "fm-wife-children-manager";
    managerEl.style.display = "none";
    container.appendChild(managerEl);

    var wivesRows = [];
    var managerState = { spouse: null, children: [], linked: new Set() };

    function getSearchTerm() {
      var input = container.querySelector("#fm-wives-search");
      return normalizeText(input && input.value ? input.value : "");
    }

    function filterRows(rows) {
      var list = Array.isArray(rows) ? rows : [];
      var term = getSearchTerm();
      if (!term) return list;
      var SpousesCore = root.AlzidanSpousesCore || {};
      return list.filter(function (row) {
        var wifeName = typeof api.normalizePersonName === "function"
          ? api.normalizePersonName(row && row.wife_name ? row.wife_name : "")
          : normalizeText(row && row.wife_name ? row.wife_name : "");
        if (SpousesCore && typeof SpousesCore.matchesOrderedSubstring === "function") {
          return SpousesCore.matchesOrderedSubstring(term, wifeName);
        }
        return wifeName.toLowerCase().indexOf(term.toLowerCase()) !== -1;
      });
    }

    function renderManager() {
      var spouse = managerState.spouse;
      if (!spouse) {
        managerEl.innerHTML = "";
        managerEl.style.display = "none";
        return;
      }

      var children = managerState.children || [];
      var linked = managerState.linked || new Set();

      managerEl.style.display = "block";
      managerEl.innerHTML =
        '<div class="section-title">إدارة أبناء الزوجة</div>' +
        '<div class="hint">الزوجة: ' + escapeHtml(spouse.wife_name || "بدون اسم") + '</div>' +
        '<div class="hint">حدد الأبناء التابعين لهذه الزوجة فقط.</div>' +
        '<div class="fm-wife-children-list">' +
        (children.length
          ? children.map(function (child) {
              var checked = linked.has(String(child.id)) ? " checked" : "";
              return (
                '<label class="fm-wife-child-check">' +
                '<input type="checkbox" data-fm-wife-child-id="' + String(child.id) + '"' + checked + " />" +
                "<span>" +
                escapeHtml((child.label || child.name) + (child.order ? " — الترتيب: " + child.order : "")) +
                "</span></label>"
              );
            }).join("")
          : '<div class="hint">لا يوجد أبناء لهذا الشخص يمكن ربطهم.</div>') +
        "</div>" +
        '<div class="fm-toolbar" style="margin-top:8px;">' +
        '<button type="button" class="btn btn-primary btn-small" id="fm-save-wife-children-links">حفظ ربط الأبناء</button>' +
        '<button type="button" class="btn btn-secondary btn-small" id="fm-cancel-wife-children-links">إغلاق</button>' +
        "</div>";

      var saveBtn = managerEl.querySelector("#fm-save-wife-children-links");
      var cancelBtn = managerEl.querySelector("#fm-cancel-wife-children-links");
      if (cancelBtn) {
        cancelBtn.addEventListener("click", function () {
          managerState = { spouse: null, children: [], linked: new Set() };
          renderManager();
        });
      }
      if (saveBtn) saveBtn.addEventListener("click", saveWifeChildrenLinks);
    }

    async function openWifeChildrenManager(spouseRow) {
      if (typeof api.getParentChildrenForWifeManager !== "function") return;
      var spouseId = spouseRow && spouseRow.id != null ? Number(spouseRow.id) : 0;
      if (!spouseId) {
        setAlert(alertEl, "error", "تعذر تحديد الزوجة.");
        return;
      }
      var personId = getSelectedPersonId();
      var children = await api.getParentChildrenForWifeManager(personId);
      var linked = typeof api.loadLinkedChildrenForSpouse === "function"
        ? await api.loadLinkedChildrenForSpouse(spouseId)
        : new Set();
      managerState = { spouse: spouseRow, children: children, linked: linked };
      renderManager();
    }

    async function saveWifeChildrenLinks() {
      if (typeof api.saveWifeChildrenLinks !== "function") return;
      var res = await api.saveWifeChildrenLinks({
        spouse: managerState.spouse,
        children: managerState.children,
        checkedIds: Array.from(managerEl.querySelectorAll("[data-fm-wife-child-id]"))
          .filter(function (el) { return el.checked; })
          .map(function (el) { return String(el.getAttribute("data-fm-wife-child-id") || "").trim(); })
          .filter(Boolean),
      });
      if (!res || !res.ok) {
        setAlert(alertEl, "error", (res && res.message) || "تعذر حفظ الربط.");
        return;
      }
      setAlert(alertEl, "success", "تم حفظ ربط أبناء الزوجة.");
      managerState = { spouse: null, children: [], linked: new Set() };
      renderManager();
      await refresh();
      onRefreshChildren();
    }

    function renderRows(rows) {
      var list = filterRows(rows);
      listEl.innerHTML = "";
      if (!Array.isArray(rows) || !rows.length) {
        listEl.innerHTML = '<div class="hint">لا توجد زوجات مسجلة لهذا الشخص حالياً.</div>';
        return;
      }
      if (!list.length) {
        listEl.innerHTML = '<div class="hint">لا توجد نتائج مطابقة لبحث الزوجات.</div>';
        return;
      }

      list.forEach(function (row) {
        var wifeText = typeof api.normalizePersonName === "function"
          ? api.normalizePersonName(row.wife_name || "")
          : normalizeText(row.wife_name || "");
        var item = document.createElement("div");
        item.className = "fm-row";
        item.innerHTML =
          '<div class="fm-row-main"><strong>' + escapeHtml(wifeText || "بدون اسم") + "</strong>" +
          '<div class="hint">الترتيب: ' + escapeHtml(String(row.marriage_order || "غير محدد")) +
          " — الأبناء المرتبطون: " + escapeHtml(String(row.linked_children_count || 0)) + "</div></div>" +
          '<div class="fm-row-actions">' +
          '<button type="button" class="btn btn-secondary btn-small" data-fm-manage-wife>إدارة أبناء الزوجة</button>' +
          '<button type="button" class="btn btn-secondary btn-small" data-fm-edit-wife>تعديل الزوجة</button>' +
          "</div>";

        item.querySelector("[data-fm-manage-wife]").addEventListener("click", function () {
          openWifeChildrenManager(row);
        });
        item.querySelector("[data-fm-edit-wife]").addEventListener("click", function () {
          if (typeof opts.onEditWife === "function") opts.onEditWife(row);
        });
        listEl.appendChild(item);
      });
    }

    async function refresh() {
      hideAlert(alertEl);
      var personId = getSelectedPersonId();
      if (!personId) {
        wivesRows = [];
        renderRows([]);
        return;
      }
      if (typeof api.loadWivesForPerson !== "function") return;
      var loaded = await api.loadWivesForPerson(personId);
      if (loaded && loaded.error) {
        setAlert(alertEl, "error", "تعذر تحميل الزوجات: " + (loaded.error.message || "خطأ غير معروف"));
        return;
      }
      wivesRows = loaded && Array.isArray(loaded.data) ? loaded.data : [];
      renderRows(wivesRows);
    }

    async function confirmLinkAll() {
      var personId = getSelectedPersonId();
      if (!personId) {
        setAlert(alertEl, "error", "اختر الشخص أولاً.");
        return;
      }
      if (typeof api.confirmLinkAllChildrenToOnlyWife !== "function") return;
      var res = await api.confirmLinkAllChildrenToOnlyWife(personId);
      if (!res || !res.ok) {
        setAlert(alertEl, "error", (res && res.message) || "تعذر الربط الجماعي.");
        return;
      }
      setAlert(alertEl, "success", "تم الربط الجماعي. العدد: " + String(res.count || 0));
      await refresh();
      onRefreshChildren();
    }

    var searchInput = container.querySelector("#fm-wives-search");
    if (searchInput) {
      searchInput.addEventListener("input", function () {
        renderRows(wivesRows);
      });
    }

    var linkAllBtn = container.querySelector("#fm-link-all-wife-children");
    if (linkAllBtn) linkAllBtn.addEventListener("click", confirmLinkAll);

    return {
      el: container,
      refresh: refresh,
      closeManager: function () {
        managerState = { spouse: null, children: [], linked: new Set() };
        renderManager();
      },
      getWivesRows: function () { return wivesRows.slice(); },
    };
  }

  root.AlzidanFamilySpousesSection = { create: createSpousesSection };
})(typeof window !== "undefined" ? window : globalThis);
