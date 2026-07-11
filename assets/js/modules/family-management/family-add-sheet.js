(function (root) {
  "use strict";

  var PersonCore = root.AlzidanFamilyPersonCore || {};
  var setAlert = PersonCore.setAlert || function () {};
  var hideAlert = PersonCore.hideAlert || function () {};
  var bindDeceasedToggle = PersonCore.bindDeceasedToggle || function () {};
  var bindBirthDateSync = PersonCore.bindBirthDateSync || function () {};

  function createAddSheet(opts) {
    var api = opts && opts.api ? opts.api : {};
    var getSelectedPersonId = opts.getSelectedPersonId || function () { return ""; };
    var onSaved = opts.onSaved || function () {};

    var backdrop = document.createElement("div");
    backdrop.className = "fm-add-sheet-backdrop";
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");

    var sheet = document.createElement("div");
    sheet.className = "fm-add-sheet";
    sheet.innerHTML =
      '<div class="fm-sheet-header">' +
      '<div class="fm-sheet-title">إضافة</div>' +
      '<button type="button" class="btn btn-secondary btn-small" data-fm-close-sheet>إغلاق</button>' +
      "</div>" +
      '<div class="fm-type-tabs">' +
      '<button type="button" class="fm-type-tab fm-active" data-fm-type="wife">زوجة</button>' +
      '<button type="button" class="fm-type-tab" data-fm-type="son">ابن</button>' +
      '<button type="button" class="fm-type-tab" data-fm-type="daughter">ابنة</button>' +
      "</div>" +
      '<div class="alert fm-section-alert" data-fm-sheet-alert style="display:none;"></div>' +
      '<div data-fm-form-wife class="grid">' +
      '<div class="field"><label>اسم الزوجة</label><input type="text" data-fm-wife-name placeholder="مثال: عقيلة بنت خزيم..." /></div>' +
      '<div class="field"><label>هل الزوجة من العائلة؟</label><select data-fm-wife-family><option value="">غير معروف</option><option value="true">نعم</option><option value="false">لا</option></select></div>' +
      '<div class="field" data-fm-wife-family-name-field><label>اسم العائلة الخارجية</label><input type="text" data-fm-wife-family-name placeholder="مثال: الشمري" /></div>' +
      '<div class="field" data-fm-wife-branch-field><label>فرع الزوجة</label><select data-fm-wife-branch><option value="">غير محدد</option><option value="زايد">زايد</option><option value="زيدان">زيدان</option><option value="لاحم">لاحم</option><option value="مزيد">مزيد</option><option value="ملحم">ملحم</option></select></div>' +
      '<div class="field"><label>ترتيب الزوجة</label><input type="number" data-fm-wife-order min="1" max="4" step="1" inputmode="numeric" placeholder="1 إلى 4" /></div>' +
      '<div class="field" style="grid-column:1/-1;"><label>سلسلة نسب الزوجة</label><input type="text" data-fm-wife-lineage placeholder="مثال: عقيلة بنت خزيم بن ملقاط..." /></div>' +
      "</div>" +
      '<div data-fm-form-child class="grid" style="display:none;">' +
      '<div class="field" style="grid-column:1/-1;"><label>اسم الابن/الابنة</label><input type="text" data-fm-child-name placeholder="الاسم الكامل أو اسم واحد" /></div>' +
      '<div class="field"><label>رقم الجوال</label><input type="tel" data-fm-child-phone inputmode="numeric" placeholder="05XXXXXXXX" /></div>' +
      '<div class="field"><label>ربط الأم (اختياري)</label><select data-fm-child-wife><option value="">بدون ربط أم الآن</option></select></div>' +
      '<div class="field"><label>تاريخ الميلاد (هجري)</label><input type="text" data-fm-child-hijri dir="ltr" lang="en" inputmode="numeric" placeholder="1445-09-01" /></div>' +
      '<div class="field"><label>تاريخ الميلاد (ميلادي)</label><input type="date" data-fm-child-greg dir="ltr" lang="en" /></div>' +
      '<div class="field"><label>ترتيب الميلاد</label><input type="number" data-fm-child-order min="1" step="1" inputmode="numeric" placeholder="مثال: 1" /></div>' +
      '<div class="field"><label>المدينة</label><input type="text" data-fm-child-city /></div>' +
      '<div class="field"><label>الحي / القرية</label><input type="text" data-fm-child-area /></div>' +
      '<div class="field"><label>الحالة</label><label style="display:flex;align-items:center;gap:8px;min-height:38px;"><input type="checkbox" data-fm-child-deceased /> متوفى</label></div>' +
      "</div>" +
      '<div class="fm-toolbar" style="margin-top:12px;">' +
      '<button type="button" class="btn btn-primary" data-fm-save-sheet>حفظ</button>' +
      '<button type="button" class="btn btn-secondary" data-fm-close-sheet2>إلغاء</button>' +
      "</div>";

    backdrop.appendChild(sheet);
    document.body.appendChild(backdrop);

    var alertEl = sheet.querySelector("[data-fm-sheet-alert]");
    var currentType = "wife";
    var editingWifeId = null;

    var wifeForm = sheet.querySelector("[data-fm-form-wife]");
    var childForm = sheet.querySelector("[data-fm-form-child]");
    var wifeFamilySelect = sheet.querySelector("[data-fm-wife-family]");
    var wifeFamilyNameField = sheet.querySelector("[data-fm-wife-family-name-field]");
    var wifeBranchField = sheet.querySelector("[data-fm-wife-branch-field]");

    var childDeceased = sheet.querySelector("[data-fm-child-deceased]");
    var childHijri = sheet.querySelector("[data-fm-child-hijri]");
    var childGreg = sheet.querySelector("[data-fm-child-greg]");
    var childCity = sheet.querySelector("[data-fm-child-city]");
    var childArea = sheet.querySelector("[data-fm-child-area]");
    bindDeceasedToggle(childDeceased, [childHijri, childGreg, childCity, childArea]);
    bindBirthDateSync(childHijri, childGreg, api);

    function updateWifeFieldsVisibility() {
      var v = wifeFamilySelect ? String(wifeFamilySelect.value || "").trim() : "";
      var isOutside = v === "false";
      if (wifeFamilyNameField) wifeFamilyNameField.style.display = isOutside ? "" : "none";
      if (wifeBranchField) wifeBranchField.style.display = isOutside ? "none" : "";
      if (isOutside) {
        var branchEl = sheet.querySelector("[data-fm-wife-branch]");
        if (branchEl) branchEl.value = "";
      } else {
        var famNameEl = sheet.querySelector("[data-fm-wife-family-name]");
        if (famNameEl) famNameEl.value = "";
      }
    }

    if (wifeFamilySelect) wifeFamilySelect.addEventListener("change", updateWifeFieldsVisibility);
    updateWifeFieldsVisibility();

    function setType(type) {
      currentType = type === "daughter" ? "daughter" : type === "son" ? "son" : "wife";
      sheet.querySelectorAll(".fm-type-tab").forEach(function (btn) {
        btn.classList.toggle("fm-active", btn.getAttribute("data-fm-type") === currentType);
      });
      if (wifeForm) wifeForm.style.display = currentType === "wife" ? "" : "none";
      if (childForm) childForm.style.display = currentType === "wife" ? "none" : "";
      hideAlert(alertEl);
    }

    sheet.querySelectorAll(".fm-type-tab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setType(btn.getAttribute("data-fm-type") || "wife");
      });
    });

    function close() {
      backdrop.classList.remove("fm-open");
      editingWifeId = null;
      hideAlert(alertEl);
    }

    function open(type, payload) {
      hideAlert(alertEl);
      setType(type || "wife");
      if (payload && payload.wifeRow) {
        editingWifeId = payload.wifeRow.id;
        var row = payload.wifeRow;
        var nameEl = sheet.querySelector("[data-fm-wife-name]");
        if (nameEl) nameEl.value = row.wife_name || "";
        if (wifeFamilySelect) {
          wifeFamilySelect.value = row.wife_is_family_member === false ? "false" : row.wife_is_family_member === true ? "true" : "";
        }
        var branchEl = sheet.querySelector("[data-fm-wife-branch]");
        if (branchEl) branchEl.value = row.wife_branch_key || "";
        var famNameEl = sheet.querySelector("[data-fm-wife-family-name]");
        if (famNameEl) famNameEl.value = row.wife_family_name || "";
        var orderEl = sheet.querySelector("[data-fm-wife-order]");
        if (orderEl) orderEl.value = row.marriage_order || "";
        var lineageEl = sheet.querySelector("[data-fm-wife-lineage]");
        if (lineageEl) lineageEl.value = row.wife_lineage || "";
        updateWifeFieldsVisibility();
        setAlert(alertEl, "success", "عدّل بيانات الزوجة ثم اضغط حفظ.");
      } else {
        editingWifeId = null;
        sheet.querySelectorAll("input,select,textarea").forEach(function (el) {
          if (el.type === "checkbox") el.checked = false;
          else if (el.tagName === "SELECT") el.selectedIndex = 0;
          else el.value = "";
        });
        updateWifeFieldsVisibility();
      }
      populateWifeOptions(payload && payload.wives ? payload.wives : []);
      backdrop.classList.add("fm-open");
    }

    function populateWifeOptions(rows) {
      var select = sheet.querySelector("[data-fm-child-wife]");
      if (!select) return;
      select.innerHTML = '<option value="">بدون ربط أم الآن</option>';
      (Array.isArray(rows) ? rows : []).forEach(function (row) {
        if (row.id == null) return;
        var opt = document.createElement("option");
        opt.value = String(row.id);
        var label = typeof api.normalizePersonName === "function"
          ? api.normalizePersonName(row.wife_name || "")
          : String(row.wife_name || "");
        opt.textContent = label || ("زوجة رقم " + String(row.id));
        select.appendChild(opt);
      });
    }

    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) close();
    });
    sheet.querySelector("[data-fm-close-sheet]").addEventListener("click", close);
    sheet.querySelector("[data-fm-close-sheet2]").addEventListener("click", close);

    sheet.querySelector("[data-fm-save-sheet]").addEventListener("click", async function () {
      hideAlert(alertEl);
      var personId = getSelectedPersonId();
      if (!personId) {
        setAlert(alertEl, "error", "اختر الشخص أولاً.");
        return;
      }

      if (currentType === "wife") {
        if (typeof api.saveWife !== "function") return;
        var res = await api.saveWife({
          personId: personId,
          editingSpouseId: editingWifeId,
          name: sheet.querySelector("[data-fm-wife-name]").value,
          family: wifeFamilySelect ? wifeFamilySelect.value : "",
          branch: sheet.querySelector("[data-fm-wife-branch]").value,
          familyName: sheet.querySelector("[data-fm-wife-family-name]").value,
          order: sheet.querySelector("[data-fm-wife-order]").value,
          lineage: sheet.querySelector("[data-fm-wife-lineage]").value,
        });
        if (!res || !res.ok) {
          setAlert(alertEl, "error", (res && res.message) || "تعذر حفظ الزوجة.");
          return;
        }
        setAlert(alertEl, "success", res.message || "تم حفظ الزوجة.");
        onSaved({ kind: "wife" });
        close();
        return;
      }

      if (typeof api.saveChild !== "function") return;
      var childRes = await api.saveChild({
        personId: personId,
        gender: currentType === "daughter" ? "daughter" : "son",
        name: sheet.querySelector("[data-fm-child-name]").value,
        phone: sheet.querySelector("[data-fm-child-phone]").value,
        spouseId: sheet.querySelector("[data-fm-child-wife]").value,
        hijri: childHijri ? childHijri.value : "",
        greg: childGreg ? childGreg.value : "",
        order: sheet.querySelector("[data-fm-child-order]").value,
        city: childCity ? childCity.value : "",
        area: childArea ? childArea.value : "",
        deceased: !!(childDeceased && childDeceased.checked),
      });
      if (!childRes || !childRes.ok) {
        setAlert(alertEl, "error", (childRes && childRes.message) || "تعذر حفظ الابن.");
        return;
      }
      onSaved({ kind: "child", personId: childRes.selectedPersonId || personId, message: childRes.message || "" });
      close();
    });

    return {
      open: open,
      close: close,
      populateWifeOptions: populateWifeOptions,
      destroy: function () {
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      },
    };
  }

  root.AlzidanFamilyAddSheet = { create: createAddSheet };
})(typeof window !== "undefined" ? window : globalThis);
