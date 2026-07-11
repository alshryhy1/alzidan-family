(function (root) {
  "use strict";

  var FormCore = root.AlzidanEventFormCore || {};
  var Events = root.AlzidanEvents || {};
  var normalizeText = FormCore.normalizeText || function (v) {
    return String(v || "").trim();
  };

  var mounted = null;

  function escapeHtml(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function optionsHtml(options, selected) {
    return (Array.isArray(options) ? options : [])
      .map(function (opt) {
        var sel = String(opt.value) === String(selected || "") ? " selected" : "";
        return '<option value="' + escapeHtml(opt.value) + '"' + sel + ">" + escapeHtml(opt.label) + "</option>";
      })
      .join("");
  }

  function createPanel(opts) {
    var mode = opts && opts.mode ? opts.mode : "delegate";
    var rootEl = opts && opts.root ? opts.root : null;
    var api = opts && opts.api ? opts.api : {};
    if (!rootEl) return null;

    rootEl.innerHTML = "";
    var panel = document.createElement("div");
    panel.className = "em-panel";
    rootEl.appendChild(panel);

    var category = "happy";
    var editingId = null;

    var tabs = document.createElement("div");
    tabs.className = "em-category-tabs";
    tabs.innerHTML =
      '<button type="button" class="em-category-tab em-active" data-category="happy">أفراح</button>' +
      '<button type="button" class="em-category-tab" data-category="sick">مرضى</button>' +
      '<button type="button" class="em-category-tab" data-category="death">وفيات</button>';
    panel.appendChild(tabs);

    var formWrap = document.createElement("div");
    formWrap.className = "em-form-wrap";
    panel.appendChild(formWrap);

    var alertEl = document.createElement("div");
    alertEl.className = "alert em-section-alert";
    alertEl.style.display = "none";
    panel.appendChild(alertEl);

    var actions = document.createElement("div");
    actions.className = "em-toolbar";
    actions.style.display = "flex";
    actions.style.gap = "8px";
    actions.style.flexWrap = "wrap";
    actions.innerHTML =
      '<button type="button" class="btn btn-primary btn-small" data-em-save>إضافة</button>' +
      '<button type="button" class="btn btn-secondary btn-small" data-em-cancel style="display:none;">إلغاء التعديل</button>';
    panel.appendChild(actions);

    var listTitle = document.createElement("div");
    listTitle.className = "section-title";
    listTitle.style.marginTop = "12px";
    listTitle.textContent = "آخر المناسبات";
    panel.appendChild(listTitle);

    var listEl = document.createElement("div");
    listEl.className = "em-list";
    panel.appendChild(listEl);

    var saveBtn = actions.querySelector("[data-em-save]");
    var cancelBtn = actions.querySelector("[data-em-cancel]");

    function setAlert(type, text) {
      if (!text) {
        alertEl.style.display = "none";
        alertEl.textContent = "";
        alertEl.className = "alert em-section-alert";
        return;
      }
      alertEl.className = "alert em-section-alert " + (type === "success" ? "alert-success" : "alert-error");
      alertEl.textContent = text;
      alertEl.style.display = "block";
    }

    function renderForm() {
      var happyTypes = FormCore.HAPPY_TYPE_OPTIONS || [];
      var sickTypes = FormCore.SICK_TYPE_OPTIONS || [];
      var vis = FormCore.VISIBILITY_OPTIONS || [];
      if (category === "happy") {
        formWrap.innerHTML =
          '<div class="em-form-grid">' +
          '<div class="field"><label>نوع المناسبة</label><select data-em-type><option value="">اختر نوع المناسبة</option>' +
          optionsHtml(happyTypes) +
          "</select></div>" +
          '<div class="field"><label>اسم الشخص</label><input data-em-person type="text" placeholder="الاسم الكامل" /></div>' +
          '<div class="field"><label>تاريخ المناسبة</label><input data-em-date type="text" dir="ltr" placeholder="1448-01-11 أو 2026-06-24" /></div>' +
          '<div class="field"><label>مدة العرض</label><select data-em-show-days>' +
          optionsHtml(vis, "7") +
          "</select></div></div>" +
          '<div class="field"><label>تفاصيل (اختياري)</label><textarea data-em-text rows="2"></textarea></div>' +
          '<div class="em-media-grid">' +
          '<div class="field"><label>رابط صورة</label><input data-em-image-url type="url" dir="ltr" placeholder="https://..." /></div>' +
          '<div class="field"><label>رفع صورة</label><input data-em-image-file type="file" accept="image/*" /></div>' +
          '<div class="field"><label>رابط فيديو</label><input data-em-video-url type="url" dir="ltr" placeholder="https://..." /></div>' +
          '<div class="field"><label>رفع فيديو</label><input data-em-video-file type="file" accept="video/mp4,video/quicktime,video/webm" /></div>' +
          "</div>";
        return;
      }
      if (category === "sick") {
        formWrap.innerHTML =
          '<div class="em-form-grid">' +
          '<div class="field"><label>الحالة</label><select data-em-type>' +
          optionsHtml(sickTypes, "sick") +
          "</select></div>" +
          '<div class="field"><label>اسم الشخص</label><input data-em-person type="text" /></div>' +
          '<div class="field"><label>التاريخ</label><input data-em-date type="text" dir="ltr" /></div>' +
          '<div class="field"><label>مدة العرض</label><select data-em-show-days>' +
          optionsHtml(vis, "7") +
          "</select></div>" +
          '<div class="field"><label>المكان</label><select data-em-place><option value="hospital">مستشفى</option><option value="home">منزل</option></select></div>' +
          "</div>" +
          '<div class="em-form-grid" data-em-hospital-fields>' +
          '<div class="field"><label>المستشفى</label><input data-em-hospital-name type="text" /></div>' +
          '<div class="field"><label>القسم</label><input data-em-hospital-dept type="text" /></div></div>' +
          '<div class="em-form-grid" data-em-home-fields style="display:none;">' +
          '<div class="field"><label>المدينة</label><input data-em-home-city type="text" /></div>' +
          '<div class="field"><label>الحي</label><input data-em-home-area type="text" /></div></div>' +
          '<div class="field"><label>ملاحظات</label><textarea data-em-notes rows="2"></textarea></div>';
        var placeEl = formWrap.querySelector("[data-em-place]");
        var hospitalFields = formWrap.querySelector("[data-em-hospital-fields]");
        var homeFields = formWrap.querySelector("[data-em-home-fields]");
        if (placeEl) {
          placeEl.addEventListener("change", function () {
            var home = placeEl.value === "home";
            if (hospitalFields) hospitalFields.style.display = home ? "none" : "";
            if (homeFields) homeFields.style.display = home ? "" : "none";
          });
        }
        return;
      }
      formWrap.innerHTML =
        '<div class="em-form-grid">' +
        '<div class="field"><label>اسم المتوفى</label><input data-em-person type="text" /></div>' +
        '<div class="field"><label>تاريخ الوفاة</label><input data-em-date type="text" dir="ltr" /></div>' +
        '<div class="field"><label>مدة العرض</label><select data-em-show-days>' +
        optionsHtml(vis, "7") +
        "</select></div></div>" +
        '<div class="em-form-grid">' +
        '<div class="field"><label>مكان الصلاة</label><input data-em-prayer-place type="text" /></div>' +
        '<div class="field"><label>وقت الصلاة</label><input data-em-prayer-time type="text" /></div>' +
        '<div class="field"><label>مكان الدفن</label><input data-em-burial-place type="text" /></div>' +
        '<div class="field"><label>وقت الدفن</label><input data-em-burial-time type="text" /></div>' +
        '<div class="field"><label>مكان العزاء</label><input data-em-condolence-place type="text" /></div>' +
        '<div class="field"><label>وقت العزاء</label><input data-em-condolence-time type="text" /></div></div>' +
        '<div class="field"><label>أرقام التواصل (سطر لكل رقم)</label><textarea data-em-phones rows="2"></textarea></div>' +
        '<div class="field"><label>ملاحظات</label><textarea data-em-notes rows="2"></textarea></div>';
    }

    function readValues() {
      var branch =
        typeof api.getBranchKey === "function" ? normalizeText(api.getBranchKey()) : "";
      var q = function (sel) {
        return formWrap.querySelector(sel);
      };
      var values = {
        branch: branch,
        type: q("[data-em-type]") ? q("[data-em-type]").value : "",
        person: q("[data-em-person]") ? q("[data-em-person]").value : "",
        dateLabel: q("[data-em-date]") ? q("[data-em-date]").value : "",
        eventDate: "",
        showDays: q("[data-em-show-days]") ? q("[data-em-show-days]").value : "7",
      };
      if (category === "happy") {
        values.text = q("[data-em-text]") ? q("[data-em-text]").value : "";
        values.imageUrl = q("[data-em-image-url]") ? q("[data-em-image-url]").value : "";
        values.videoUrl = q("[data-em-video-url]") ? q("[data-em-video-url]").value : "";
        values.imageFile = q("[data-em-image-file]") && q("[data-em-image-file]").files
          ? q("[data-em-image-file]").files[0]
          : null;
        values.videoFile = q("[data-em-video-file]") && q("[data-em-video-file]").files
          ? q("[data-em-video-file]").files[0]
          : null;
      } else if (category === "sick") {
        values.place = q("[data-em-place]") ? q("[data-em-place]").value : "hospital";
        values.hospitalName = q("[data-em-hospital-name]") ? q("[data-em-hospital-name]").value : "";
        values.hospitalDept = q("[data-em-hospital-dept]") ? q("[data-em-hospital-dept]").value : "";
        values.homeCity = q("[data-em-home-city]") ? q("[data-em-home-city]").value : "";
        values.homeArea = q("[data-em-home-area]") ? q("[data-em-home-area]").value : "";
        values.notes = q("[data-em-notes]") ? q("[data-em-notes]").value : "";
      } else {
        values.prayerPlace = q("[data-em-prayer-place]") ? q("[data-em-prayer-place]").value : "";
        values.prayerTime = q("[data-em-prayer-time]") ? q("[data-em-prayer-time]").value : "";
        values.burialPlace = q("[data-em-burial-place]") ? q("[data-em-burial-place]").value : "";
        values.burialTime = q("[data-em-burial-time]") ? q("[data-em-burial-time]").value : "";
        values.condolencePlace = q("[data-em-condolence-place]") ? q("[data-em-condolence-place]").value : "";
        values.condolenceTime = q("[data-em-condolence-time]") ? q("[data-em-condolence-time]").value : "";
        values.phones = q("[data-em-phones]")
          ? String(q("[data-em-phones]").value || "")
              .split(/\n/)
              .map(normalizeText)
              .filter(Boolean)
          : [];
        values.notes = q("[data-em-notes]") ? q("[data-em-notes]").value : "";
      }
      return values;
    }

    function resetForm() {
      editingId = null;
      if (saveBtn) saveBtn.textContent = "إضافة";
      if (cancelBtn) cancelBtn.style.display = "none";
      renderForm();
      setAlert("", "");
    }

    async function refreshList() {
      if (typeof api.loadRecentEvents !== "function") {
        listEl.innerHTML = '<div class="hint">—</div>';
        return;
      }
      var items = await api.loadRecentEvents(category);
      if (!Array.isArray(items) || !items.length) {
        listEl.innerHTML = '<div class="hint">لا توجد مناسبات مسجلة بعد.</div>';
        return;
      }
      listEl.innerHTML = items
        .map(function (item) {
          var label =
            typeof Events.eventTypeArabicLabel === "function" && typeof Events.normalizeEventType === "function"
              ? Events.eventTypeArabicLabel(Events.normalizeEventType(item.type))
              : item.type || "";
          return (
            '<div class="em-list-item" data-em-item-id="' +
            escapeHtml(String(item.id || "")) +
            '">' +
            "<strong>" +
            escapeHtml(item.person || "—") +
            "</strong>" +
            (label ? " — " + escapeHtml(label) : "") +
            '<div class="em-list-item-actions">' +
            '<button type="button" class="btn btn-secondary btn-small" data-em-edit>تعديل</button>' +
            '<button type="button" class="btn btn-secondary btn-small" data-em-delete>حذف</button>' +
            "</div></div>"
          );
        })
        .join("");
      listEl.querySelectorAll("[data-em-edit]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var wrap = btn.closest("[data-em-item-id]");
          var id = wrap ? wrap.getAttribute("data-em-item-id") : "";
          if (typeof api.loadEventForEdit === "function") {
            api.loadEventForEdit(id).then(function (row) {
              if (!row) return;
              editingId = id;
              if (saveBtn) saveBtn.textContent = "حفظ التعديل";
              if (cancelBtn) cancelBtn.style.display = "";
              if (typeof api.fillFormFromRow === "function") api.fillFormFromRow(formWrap, category, row);
            });
          }
        });
      });
      listEl.querySelectorAll("[data-em-delete]").forEach(function (btn) {
        btn.addEventListener("click", async function () {
          var wrap = btn.closest("[data-em-item-id]");
          var id = wrap ? wrap.getAttribute("data-em-item-id") : "";
          if (!id || typeof api.deleteEvent !== "function") return;
          var res = await api.deleteEvent(id);
          if (!res || !res.ok) {
            setAlert("error", (res && res.message) || "تعذر الحذف.");
            return;
          }
          setAlert("success", res.message || "تم الحذف.");
          await refreshList();
        });
      });
    }

    tabs.querySelectorAll(".em-category-tab").forEach(function (tabBtn) {
      tabBtn.addEventListener("click", function () {
        category = tabBtn.getAttribute("data-category") || "happy";
        tabs.querySelectorAll(".em-category-tab").forEach(function (b) {
          b.classList.toggle("em-active", b === tabBtn);
        });
        resetForm();
        refreshList();
      });
    });

    if (saveBtn) {
      saveBtn.addEventListener("click", async function () {
        if (typeof api.saveEvent !== "function") return;
        var res = await api.saveEvent({
          category: category,
          editingId: editingId,
          values: readValues(),
        });
        if (!res || !res.ok) {
          setAlert("error", (res && res.message) || "تعذر الحفظ.");
          return;
        }
        setAlert("success", res.message || "تم الحفظ.");
        resetForm();
        await refreshList();
      });
    }
    if (cancelBtn) cancelBtn.addEventListener("click", resetForm);

    renderForm();
    refreshList();

    return {
      mode: mode,
      getCategory: function () {
        return category;
      },
      refreshList: refreshList,
      resetForm: resetForm,
      destroy: function () {
        rootEl.innerHTML = "";
      },
    };
  }

  root.AlzidanEventsMgmt = {
    mount: function (opts) {
      if (mounted) mounted.destroy();
      mounted = createPanel(opts || {});
      return mounted;
    },
    destroy: function () {
      if (mounted) {
        mounted.destroy();
        mounted = null;
      }
    },
    getPanel: function () {
      return mounted;
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
