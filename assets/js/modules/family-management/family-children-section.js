(function (root) {
  "use strict";

  var PersonCore = root.AlzidanFamilyPersonCore || {};
  var escapeHtml = PersonCore.escapeHtml || function (v) { return String(v || ""); };
  var setAlert = PersonCore.setAlert || function () {};
  var hideAlert = PersonCore.hideAlert || function () {};
  var bindDeceasedToggle = PersonCore.bindDeceasedToggle || function () {};
  var bindBirthDateSync = PersonCore.bindBirthDateSync || function () {};

  function createChildrenSection(opts) {
    var api = opts && opts.api ? opts.api : {};
    var getSelectedPersonId = opts.getSelectedPersonId || function () { return ""; };
    var onSelectPerson = opts.onSelectPerson || function () {};

    var container = document.createElement("div");
    container.className = "fm-children-section";

    var alertEl = document.createElement("div");
    alertEl.id = "fm-children-alert";
    alertEl.className = "alert fm-section-alert";
    alertEl.style.display = "none";
    container.appendChild(alertEl);

    var listEl = document.createElement("div");
    listEl.id = "fm-children-list";
    listEl.className = "fm-list";
    container.appendChild(listEl);

    var editingKey = "";

    function resolveChildrenForPerson(childId) {
      var state = typeof api.getState === "function" ? api.getState() : {};
      var childrenMap = state && state.children ? state.children : {};
      var norm = typeof api.normalizePersonName === "function"
        ? api.normalizePersonName
        : function (v) { return String(v || "").trim(); };
      var mapKey = typeof PersonCore.resolveChildrenMapKey === "function"
        ? PersonCore.resolveChildrenMapKey(childId, childrenMap, norm)
        : norm(childId || "");
      if (mapKey && Array.isArray(childrenMap[mapKey])) return childrenMap[mapKey];
      return [];
    }

    function resolveDescendantsCount(childId) {
      return resolveChildrenForPerson(childId).length;
    }

    function childDisplayParts(child, parentKey) {
      var parts = [];
      var childId = typeof api.normalizePersonName === "function"
        ? api.normalizePersonName(child && child.name ? child.name : "")
        : String(child && child.name ? child.name : "");
      var branch = typeof api.getBranchKey === "function" ? api.getBranchKey() : "";
      var branchRoot = typeof api.getBranchRootName === "function" ? api.getBranchRootName(branch) : "";
      var display = typeof api.getDisplayNameForNodeId === "function"
        ? api.getDisplayNameForNodeId(childId, branchRoot)
        : childId;
      var forcedSuffix = typeof api.getForcedRahmaSuffix === "function"
        ? api.getForcedRahmaSuffix(childId, branch)
        : "";
      var suffix = forcedSuffix ? forcedSuffix : child && child.deceased ? " (رحمه الله)" : "";
      parts.push((display || childId) + suffix);
      if (child && child.order) parts.push("الترتيب: " + String(child.order));
      parts.push("الأبناء: " + String(resolveDescendantsCount(childId)));
      var isDeceased = !!(child && child.deceased);
      if (!isDeceased) {
        var ageText = typeof api.calculateAge === "function" ? api.calculateAge(child) : "";
        if (ageText) parts.push("العمر: " + ageText);
        var birthParts = [];
        var h = typeof api.normalizePersonName === "function"
          ? api.normalizePersonName(child && child.hdate ? child.hdate : "")
          : String(child && child.hdate ? child.hdate : "");
        var g = typeof api.normalizePersonName === "function"
          ? api.normalizePersonName(child && child.gdate ? child.gdate : "")
          : String(child && child.gdate ? child.gdate : "");
        var y = child && child.year ? String(child.year) : "";
        var hijriLabel = h && typeof api.formatDateISO === "function" ? api.formatDateISO(h) : h;
        if (!hijriLabel && g && typeof api.formatDateISO === "function") hijriLabel = api.formatDateISO(g);
        if (hijriLabel) birthParts.push(hijriLabel);
        if (!hijriLabel && y) birthParts.push("سنة: " + y);
        if (birthParts.length) parts.push("الميلاد: " + birthParts.join(" / "));
        var city = typeof api.normalizePersonName === "function"
          ? api.normalizePersonName(child && child.city ? child.city : "")
          : String(child && child.city ? child.city : "");
        var area = typeof api.normalizePersonName === "function"
          ? api.normalizePersonName(child && child.area ? child.area : "")
          : String(child && child.area ? child.area : "");
        if (city) parts.push("المدينة: " + city);
        if (area) parts.push("الحي: " + area);
      }
      return { parts: parts, childId: childId, parentKey: parentKey };
    }

    function buildInlineEdit(parentKey, child) {
      var isAdmin = api && api.mode === "admin";
      var childId = typeof api.normalizePersonName === "function"
        ? api.normalizePersonName(child && child.name ? child.name : "")
        : String(child && child.name ? child.name : "");
      var wrap = document.createElement("div");
      wrap.className = "fm-inline-edit grid";
      wrap.innerHTML =
        (isAdmin
          ? '<div class="field"><label>person_id (UUID)</label><input type="text" data-fm-edit-person-id dir="ltr" lang="en" placeholder="اختياري — للإدارة فقط" /></div>'
          : "") +
        '<div class="field"><label for="fm-edit-child-name">تعديل الاسم</label><input id="fm-edit-child-name" type="text" data-fm-edit-name placeholder="اسم الابن/الابنة" /></div>' +
        '<div class="field"><label>رقم الجوال</label><input type="tel" data-fm-edit-phone inputmode="numeric" placeholder="05XXXXXXXX" /></div>' +
        '<div class="field"><label>تاريخ الميلاد (هجري)</label><input type="text" data-fm-edit-hijri dir="ltr" lang="en" inputmode="numeric" placeholder="1445-09-01" /></div>' +
        '<div class="field"><label>تاريخ الميلاد (ميلادي)</label><input type="date" data-fm-edit-greg dir="ltr" lang="en" /></div>' +
        '<div class="field"><label>ترتيب الميلاد</label><input type="number" data-fm-edit-order min="1" step="1" inputmode="numeric" /></div>' +
        '<div class="field"><label>المدينة</label><input type="text" data-fm-edit-city /></div>' +
        '<div class="field"><label>الحي / القرية</label><input type="text" data-fm-edit-area /></div>' +
        '<div class="field"><label>الحالة</label><label style="display:flex;align-items:center;gap:8px;min-height:38px;"><input type="checkbox" data-fm-edit-deceased /> متوفى</label></div>' +
        '<div class="fm-toolbar" style="grid-column:1/-1;"><button type="button" class="btn btn-primary btn-small" data-fm-save-edit>حفظ التعديل</button>' +
        '<button type="button" class="btn btn-secondary btn-small" data-fm-cancel-edit>إلغاء</button></div>' +
        '<div class="alert fm-section-alert" data-fm-edit-alert style="display:none;grid-column:1/-1;"></div>';

      var hijriEl = wrap.querySelector("[data-fm-edit-hijri]");
      var gregEl = wrap.querySelector("[data-fm-edit-greg]");
      var deceasedEl = wrap.querySelector("[data-fm-edit-deceased]");
      bindDeceasedToggle(deceasedEl, [
        hijriEl,
        gregEl,
        wrap.querySelector("[data-fm-edit-city]"),
        wrap.querySelector("[data-fm-edit-area]"),
      ]);
      bindBirthDateSync(hijriEl, gregEl, api);

      if (hijriEl) hijriEl.value = String(child && child.hdate ? child.hdate : "");
      if (gregEl) gregEl.value = String(child && child.gdate ? child.gdate : "");
      var orderEl = wrap.querySelector("[data-fm-edit-order]");
      if (orderEl) orderEl.value = child && child.order ? String(child.order) : "";
      var cityEl = wrap.querySelector("[data-fm-edit-city]");
      if (cityEl) cityEl.value = String(child && child.city ? child.city : "");
      var areaEl = wrap.querySelector("[data-fm-edit-area]");
      if (areaEl) areaEl.value = String(child && child.area ? child.area : "");
      if (deceasedEl) deceasedEl.checked = !!(child && child.deceased);

      var nameEl = wrap.querySelector("[data-fm-edit-name]");
      if (nameEl) {
        var branch = typeof api.getBranchKey === "function" ? api.getBranchKey() : "";
        var branchRoot = typeof api.getBranchRootName === "function" ? api.getBranchRootName(branch) : "";
        var displayName = typeof api.getDisplayNameForNodeId === "function"
          ? api.getDisplayNameForNodeId(childId, branchRoot)
          : childId;
        nameEl.value = String(displayName || childId || "");
      }

      var personIdEl = wrap.querySelector("[data-fm-edit-person-id]");
      if (personIdEl) {
        var meta = typeof api.getPersonRowMeta === "function" ? api.getPersonRowMeta(child && child.name ? child.name : "") : null;
        personIdEl.value = String((meta && meta.person_id) || (child && child.personId) || "");
      }

      var phoneEl = wrap.querySelector("[data-fm-edit-phone]");
      if (phoneEl && typeof api.loadMemberPhone === "function") {
        api.loadMemberPhone(parentKey, child).then(function (v) {
          phoneEl.value = v || "";
        }).catch(function () {});
      }

      var editAlert = wrap.querySelector("[data-fm-edit-alert]");
      var descendants = resolveChildrenForPerson(childId);
      if (descendants.length) {
        var branch = typeof api.getBranchKey === "function" ? api.getBranchKey() : "";
        var branchRoot = typeof api.getBranchRootName === "function" ? api.getBranchRootName(branch) : "";
        var descBlock = document.createElement("div");
        descBlock.className = "fm-edit-descendants";
        descBlock.style.gridColumn = "1 / -1";
        var labels = descendants.map(function (desc) {
          var descId = typeof api.normalizePersonName === "function"
            ? api.normalizePersonName(desc && desc.name ? desc.name : "")
            : String(desc && desc.name ? desc.name : "");
          var display = typeof api.getDisplayNameForNodeId === "function"
            ? api.getDisplayNameForNodeId(descId, branchRoot)
            : descId;
          var forcedSuffix = typeof api.getForcedRahmaSuffix === "function"
            ? api.getForcedRahmaSuffix(descId, branch)
            : "";
          var suffix = forcedSuffix ? forcedSuffix : desc && desc.deceased ? " (رحمه الله)" : "";
          return escapeHtml((display || descId) + suffix);
        }).join("، ");
        descBlock.innerHTML =
          '<div class="field">' +
          '<label>أبناء هذا الشخص (' + String(descendants.length) + ")</label>" +
          '<div class="hint" style="margin-bottom:8px;line-height:1.7;">' + labels + "</div>" +
          '<button type="button" class="btn btn-secondary btn-small" data-fm-manage-descendants>عرض وإدارة الأبناء</button>' +
          "</div>";
        var toolbar = wrap.querySelector(".fm-toolbar");
        if (toolbar) wrap.insertBefore(descBlock, toolbar);
        else wrap.appendChild(descBlock);
        descBlock.querySelector("[data-fm-manage-descendants]").addEventListener("click", function () {
          editingKey = "";
          onSelectPerson(childId);
        });
      }

      wrap.querySelector("[data-fm-cancel-edit]").addEventListener("click", function () {
        editingKey = "";
        refresh();
      });
      wrap.querySelector("[data-fm-save-edit]").addEventListener("click", async function () {
        if (typeof api.updateChild !== "function") return;
        var res = await api.updateChild({
          parentId: parentKey,
          childId: childId,
          child: child,
          newName: nameEl ? nameEl.value : "",
          personId: personIdEl ? personIdEl.value : "",
          phone: phoneEl ? phoneEl.value : "",
          hijri: hijriEl ? hijriEl.value : "",
          greg: gregEl ? gregEl.value : "",
          order: orderEl ? orderEl.value : "",
          city: cityEl ? cityEl.value : "",
          area: areaEl ? areaEl.value : "",
          deceased: !!(deceasedEl && deceasedEl.checked),
        });
        if (!res || !res.ok) {
          setAlert(editAlert, "error", (res && res.message) || "تعذر حفظ التعديل.");
          return;
        }
        editingKey = "";
        setAlert(alertEl, "success", res.message || "تم حفظ التعديل.");
        await refresh();
        if (typeof opts.onDataChanged === "function") opts.onDataChanged();
      });

      return wrap;
    }

    function sortChildren(listRaw) {
      var list = Array.isArray(listRaw) ? listRaw.slice() : [];
      function getOrderSortKey(child) {
        var value = parseInt(child && child.order != null ? String(child.order) : "", 10);
        return value > 0 && isFinite(value) ? value : null;
      }
      function getBirthSortKey(child) {
        var g = typeof api.normalizePersonName === "function"
          ? api.normalizePersonName(child && child.gdate ? child.gdate : "")
          : String(child && child.gdate ? child.gdate : "");
        var gp = typeof api.parseISODate === "function" ? api.parseISODate(g) : null;
        if (gp) return gp.y * 10000 + gp.mo * 100 + gp.d;
        var yRaw = child && child.year != null ? String(child.year) : "";
        var y = parseInt(yRaw, 10);
        if (y && isFinite(y)) return y * 10000;
        return null;
      }
      var shouldSort = list.some(function (c) {
        return getOrderSortKey(c) != null || getBirthSortKey(c) != null;
      });
      if (!shouldSort) return list;
      return list.sort(function (a, b) {
        var ao = getOrderSortKey(a);
        var bo = getOrderSortKey(b);
        if (ao != null || bo != null) {
          if (ao == null) return 1;
          if (bo == null) return -1;
          if (ao !== bo) return ao - bo;
        }
        var ak = getBirthSortKey(a);
        var bk = getBirthSortKey(b);
        if (ak == null && bk == null) {
          var an = String(a && a.name ? a.name : "");
          var bn = String(b && b.name ? b.name : "");
          return an.localeCompare(bn, "ar");
        }
        if (ak == null) return 1;
        if (bk == null) return -1;
        if (ak !== bk) return ak - bk;
        return String(a && a.name ? a.name : "").localeCompare(String(b && b.name ? b.name : ""), "ar");
      });
    }

    function refresh() {
      hideAlert(alertEl);
      listEl.innerHTML = "";
      var parentKey = getSelectedPersonId();
      if (!parentKey) {
        listEl.innerHTML = '<div class="hint">اختر شخصاً لعرض أبنائه.</div>';
        return;
      }
      var state = typeof api.getState === "function" ? api.getState() : {};
      var key = typeof api.normalizePersonName === "function" ? api.normalizePersonName(parentKey) : parentKey;
      var list = sortChildren(state && state.children ? state.children[key] : []);
      if (!list.length) {
        listEl.innerHTML = '<div class="hint">لا توجد بيانات مسجلة لهذا الشخص بعد.</div>';
        return;
      }

      list.forEach(function (child) {
        var info = childDisplayParts(child, key);
        var editId = key + "::" + info.childId;
        var row = document.createElement("div");
        row.className = "fm-row";
        row.style.flexDirection = "column";
        row.style.alignItems = "stretch";

        var header = document.createElement("div");
        header.style.display = "flex";
        header.style.justifyContent = "space-between";
        header.style.gap = "8px";
        header.style.flexWrap = "wrap";
        header.innerHTML =
          '<div class="fm-row-main">' + escapeHtml(info.parts.join(" – ")) + "</div>" +
          '<div class="fm-row-actions">' +
          '<button type="button" class="btn btn-secondary btn-small" data-fm-edit-child>تعديل</button>' +
          '<button type="button" class="btn btn-secondary btn-small" data-fm-add-under-child>إضافة أبناء</button>' +
          '<button type="button" class="btn btn-secondary btn-small" data-fm-delete-child>حذف</button>' +
          "</div>";
        row.appendChild(header);

        header.querySelector("[data-fm-edit-child]").addEventListener("click", function () {
          editingKey = editingKey === editId ? "" : editId;
          refresh();
        });
        header.querySelector("[data-fm-add-under-child]").addEventListener("click", function () {
          onSelectPerson(info.childId);
        });
        header.querySelector("[data-fm-delete-child]").addEventListener("click", async function () {
          if (typeof api.deleteChild !== "function") return;
          var res = await api.deleteChild({ parentId: key, childId: info.childId, child: child });
          if (!res || !res.ok) {
            setAlert(alertEl, "error", (res && res.message) || "تعذر الحذف.");
            return;
          }
          setAlert(alertEl, "success", res.message || "تم حذف الاسم.");
          editingKey = "";
          await refresh();
          if (typeof opts.onDataChanged === "function") opts.onDataChanged();
        });

        if (editingKey === editId) {
          row.appendChild(buildInlineEdit(key, child));
        }
        listEl.appendChild(row);
      });
    }

    return {
      el: container,
      refresh: refresh,
      setAlert: function (type, text) { setAlert(alertEl, type, text); },
    };
  }

  root.AlzidanFamilyChildrenSection = { create: createChildrenSection };
})(typeof window !== "undefined" ? window : globalThis);
