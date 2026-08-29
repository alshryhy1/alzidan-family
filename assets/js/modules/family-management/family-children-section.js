(function (root) {
  "use strict";

  var PersonCore = root.AlzidanFamilyPersonCore || {};
  var escapeHtml = PersonCore.escapeHtml || function (v) { return String(v || ""); };
  var setAlert = PersonCore.setAlert || function () {};
  var hideAlert = PersonCore.hideAlert || function () {};
  var bindDeceasedToggle = PersonCore.bindDeceasedToggle || function () {};
  var bindDeathDateToggle = PersonCore.bindDeathDateToggle || function () {};
  var bindBirthDateSync = PersonCore.bindBirthDateSync || function () {};
  var bindAgeToBirthDates = PersonCore.bindAgeToBirthDates || function () {};

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

    var pendingEl = document.createElement("div");
    pendingEl.id = "fm-women-pending";
    pendingEl.className = "fm-women-pending";
    pendingEl.style.marginBottom = "18px";
    pendingEl.style.padding = "12px";
    pendingEl.style.border = "1px solid rgba(15, 76, 58, 0.16)";
    pendingEl.style.borderRadius = "12px";
    pendingEl.style.background = "rgba(15, 76, 58, 0.04)";
    container.appendChild(pendingEl);

    var listEl = document.createElement("div");
    listEl.id = "fm-children-list";
    listEl.className = "fm-list";
    container.appendChild(listEl);

    var extEl = document.createElement("div");
    extEl.id = "fm-external-offspring";
    extEl.className = "fm-external-offspring";
    extEl.style.marginTop = "18px";
    extEl.style.paddingTop = "14px";
    extEl.style.borderTop = "1px solid rgba(15, 76, 58, 0.14)";
    container.appendChild(extEl);

    var editingKey = "";
    var editingExtId = "";

    function resolveChildrenForPerson(childId) {
      var state = typeof api.getState === "function" ? api.getState() : {};
      var childrenMap = state && state.children ? state.children : {};
      var norm = typeof api.normalizePersonName === "function"
        ? api.normalizePersonName
        : function (v) { return String(v || "").trim(); };
      // Descendants of a child may use map-key resolve (same person path variants).
      // Selected-father display uses childrenForSelectedParent (parent_person_id union).
      var mapKey = typeof PersonCore.resolveChildrenMapKey === "function"
        ? PersonCore.resolveChildrenMapKey(childId, childrenMap, norm)
        : norm(childId || "");
      if (mapKey && Array.isArray(childrenMap[mapKey])) return childrenMap[mapKey];
      return [];
    }

    function listChildrenForSelectedFather() {
      var parentKey = getSelectedPersonId();
      var state = typeof api.getState === "function" ? api.getState() : {};
      var norm = typeof api.normalizePersonName === "function"
        ? api.normalizePersonName
        : function (v) { return String(v || "").trim(); };
      var parentPersonId = "";
      if (typeof api.getPersonRowMeta === "function") {
        var meta = api.getPersonRowMeta(parentKey);
        parentPersonId = meta && meta.person_id ? String(meta.person_id) : "";
      }
      if (typeof PersonCore.childrenForSelectedParent === "function") {
        return PersonCore.childrenForSelectedParent(state && state.children, parentKey, {
          normalizePersonName: norm,
          parentPersonId: parentPersonId,
        });
      }
      var key = norm(parentKey || "");
      return { key: key, list: state && state.children && Array.isArray(state.children[key]) ? state.children[key].slice() : [] };
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
      if (genderSelectValue(child && child.gender) === "daughter") {
        parts.push("أنثى — محجوبة عن الشجرة العامة");
      }
      parts.push("الأبناء: " + String(resolveDescendantsCount(childId)));
      var isDeceased = !!(child && child.deceased);
      var ageText = typeof api.calculateAge === "function" ? api.calculateAge(child) : "";
      if (ageText) parts.push(isDeceased ? ("العمر عند الوفاة: " + ageText) : ("العمر: " + ageText));
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
      return { parts: parts, childId: childId, parentKey: parentKey };
    }

    function findPersonAsChild(personPath) {
      var state = typeof api.getState === "function" ? api.getState() : {};
      var norm = typeof api.normalizePersonName === "function"
        ? api.normalizePersonName
        : function (v) { return String(v || "").trim(); };
      var id = norm(personPath || "");
      if (!id) return null;
      var children = state && state.children ? state.children : {};
      var parentFromPath = id.indexOf("/") >= 0 ? id.split("/").slice(0, -1).join("/") : "";
      function scanList(list, parentKey) {
        var arr = Array.isArray(list) ? list : [];
        for (var i = 0; i < arr.length; i++) {
          var c = arr[i] || {};
          if (norm(c.name || "") === id) return { parentId: parentKey, child: c };
        }
        return null;
      }
      if (parentFromPath && children[parentFromPath]) {
        var hit = scanList(children[parentFromPath], parentFromPath);
        if (hit) return hit;
      }
      var keys = Object.keys(children);
      for (var k = 0; k < keys.length; k++) {
        var hit2 = scanList(children[keys[k]], keys[k]);
        if (hit2) return hit2;
      }
      if (parentFromPath) {
        var meta = typeof api.getPersonRowMeta === "function" ? api.getPersonRowMeta(id) : null;
        return {
          parentId: parentFromPath,
          child: {
            name: id,
            personId: meta && meta.person_id ? String(meta.person_id) : "",
            parentPersonId: meta && meta.parent_person_id ? String(meta.parent_person_id) : "",
            city: "",
            area: "",
            gender: "",
          },
        };
      }
      return null;
    }

    function genderSelectValue(raw) {
      var g = String(raw || "").trim().toLowerCase();
      if (g === "daughter" || g === "female" || g === "f" || g === "أنثى" || g === "انثى" || g === "ابنة" || g === "بنت") return "daughter";
      if (g === "son" || g === "male" || g === "m" || g === "ذكر" || g === "ابن") return "son";
      return "";
    }

    function genderLabel(raw) {
      var g = genderSelectValue(raw);
      if (g === "daughter") return "أنثى";
      if (g === "son") return "ذكر";
      return "غير محدد";
    }

    function womenManagerStatusLabel(status) {
      if (status === "active") return "مسؤولة نسائية — مفعّلة";
      if (status === "suspended") return "موقوفة";
      return "غير مفعّلة";
    }

    function formatWomenManagerStamp(iso, actor) {
      if (!iso) return "";
      var d = new Date(iso);
      var when = Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString("ar-SA");
      var who = String(actor || "").trim();
      if (who === "admin") who = "الإدارة";
      return who ? ("آخر عملية: " + who + " — " + when) : ("آخر عملية: " + when);
    }

    function mountWomenManagerPanel(wrap, childId, originalGender) {
      var isAdmin = api && api.mode === "admin";
      if (!isAdmin || genderSelectValue(originalGender) !== "daughter") return;
      if (typeof api.getWomenManagerGrant !== "function") return;
      var rowId = typeof api.getTreeChildRowId === "function" ? Number(api.getTreeChildRowId(childId) || 0) : 0;
      var panel = document.createElement("div");
      panel.className = "fm-women-manager";
      panel.style.gridColumn = "1 / -1";
      panel.style.marginTop = "8px";
      panel.style.padding = "12px";
      panel.style.border = "1px solid rgba(15, 76, 58, 0.16)";
      panel.style.borderRadius = "12px";
      panel.style.background = "rgba(15, 76, 58, 0.04)";
      wrap.appendChild(panel);
      var toolbar = wrap.querySelector(".fm-toolbar");
      if (toolbar) wrap.insertBefore(panel, toolbar);

      function render(state) {
        var status = state && state.status ? String(state.status) : "inactive";
        var eligible = !!(state && state.eligible);
        var err = state && state.eligibilityError ? String(state.eligibilityError) : "";
        var msg = state && state.message ? String(state.message) : "";
        var loadErr = state && state.loadError ? String(state.loadError) : "";
        var stamp = formatWomenManagerStamp(state && (state.updatedAt || state.assignedAt), state && state.assignedBy);
        var canAssign = status !== "active";
        var canSuspend = status === "active";
        panel.innerHTML =
          '<div class="section-title" style="font-size:16px;margin:0 0 6px;">صلاحيات الإدارة</div>' +
          '<div class="hint" style="margin:0 0 8px;">دور مستقل (مسؤولة نسائية). ليس كل عضوة أنثى، ولا صلاحية إدارة كاملة. لطلبات الجوال وقسم العضوات في التطبيق شغّلي بطاقاتهما في مساحة SQL.</div>' +
          '<div style="font-weight:800;margin:0 0 8px;">الحالة الحالية: ' + escapeHtml(womenManagerStatusLabel(status)) + "</div>" +
          (stamp ? '<div class="hint" style="margin:0 0 8px;">' + escapeHtml(stamp) + "</div>" : "") +
          (loadErr ? '<div class="hint" style="color:#8a2f2f;margin:0 0 8px;">' + escapeHtml(loadErr) + "</div>" : "") +
          (msg ? '<div class="hint" style="margin:0 0 8px;">' + escapeHtml(msg) + "</div>" : "") +
          (!eligible && err && !loadErr
            ? '<div class="hint" style="margin:0 0 8px;">شرط التعيين: ' +
              escapeHtml(
                err === "no_phone"
                  ? "اربط جوالًا فعالًا بهذه العضوة أولًا."
                  : err === "account_inactive"
                    ? "حساب العضوية غير فعال."
                    : err === "not_daughter"
                      ? "الجنس الموثّق في السجل يجب أن يكون أنثى."
                      : "لا تستوفي شروط التعيين."
              ) +
              "</div>"
            : "") +
          '<div class="fm-row-actions" style="display:flex;gap:8px;flex-wrap:wrap;">' +
          (canAssign
            ? '<button type="button" class="btn btn-primary btn-small" data-wm-assign' +
              (!eligible || !rowId ? " disabled" : "") +
              ">تعيين كمسؤولة نسائية</button>"
            : "") +
          (canSuspend
            ? '<button type="button" class="btn btn-secondary btn-small" data-wm-suspend>إيقاف المسؤولية</button>'
            : "") +
          "</div>";

        var assignBtn = panel.querySelector("[data-wm-assign]");
        var suspendBtn = panel.querySelector("[data-wm-suspend]");
        if (assignBtn) {
          assignBtn.addEventListener("click", async function () {
            if (typeof api.setWomenManagerGrant !== "function") return;
            if (!window.confirm("تعيين هذه العضوة مسؤولة نسائية؟ لن تحصل على صلاحيات الرجال أو الفروع أو المناديب.")) return;
            assignBtn.disabled = true;
            var res = await api.setWomenManagerGrant(rowId, "assign");
            render(Object.assign({}, res, { loadError: res && res.ok ? "" : (res && res.message) || "تعذر التعيين." }));
          });
        }
        if (suspendBtn) {
          suspendBtn.addEventListener("click", async function () {
            if (typeof api.setWomenManagerGrant !== "function") return;
            if (!window.confirm("إيقاف مسؤولية هذه العضوة؟ سيختفي مدخل إدارة النساء من تطبيقها.")) return;
            suspendBtn.disabled = true;
            var res = await api.setWomenManagerGrant(rowId, "suspend");
            render(Object.assign({}, res, { loadError: res && res.ok ? "" : (res && res.message) || "تعذر الإيقاف." }));
          });
        }
      }

      render({ status: "inactive", eligible: false });
      if (!rowId) {
        render({ status: "inactive", eligible: false, loadError: "احفظ سجل العضوة أولًا ثم أعد فتح البطاقة." });
        return;
      }
      api.getWomenManagerGrant(rowId).then(function (res) {
        if (!res || !res.ok) {
          render({ status: "inactive", eligible: false, loadError: (res && res.message) || "تعذر تحميل الصلاحية." });
          return;
        }
        render(res);
      }).catch(function () {
        render({ status: "inactive", eligible: false, loadError: "تعذر تحميل الصلاحية." });
      });
    }

    function familyAdminStatusLabel(status) {
      if (status === "active") return "إدارة العائلة — مفعّلة";
      if (status === "suspended") return "موقوفة";
      return "غير مفعّلة";
    }

    function mountFamilyAdminPanel(wrap, childId) {
      var isAdmin = api && api.mode === "admin";
      if (!isAdmin) return;
      if (typeof api.getFamilyAdminGrant !== "function") return;
      var rowId = typeof api.getTreeChildRowId === "function" ? Number(api.getTreeChildRowId(childId) || 0) : 0;
      var panel = document.createElement("div");
      panel.className = "fm-family-admin";
      panel.style.gridColumn = "1 / -1";
      panel.style.marginTop = "8px";
      panel.style.padding = "12px";
      panel.style.border = "1px solid rgba(15, 76, 58, 0.16)";
      panel.style.borderRadius = "12px";
      panel.style.background = "rgba(15, 76, 58, 0.04)";
      wrap.appendChild(panel);
      var toolbar = wrap.querySelector(".fm-toolbar");
      if (toolbar) wrap.insertBefore(panel, toolbar);

      function render(state) {
        var status = state && state.status ? String(state.status) : "inactive";
        var msg = state && state.message ? String(state.message) : "";
        var loadErr = state && state.loadError ? String(state.loadError) : "";
        var stamp = formatWomenManagerStamp(state && state.assignedAt, state && state.assignedBy);
        var canAssign = status !== "active";
        var canSuspend = status === "active";
        panel.innerHTML =
          '<div class="section-title" style="font-size:16px;margin:0 0 6px;">إدارة العائلة في التطبيق</div>' +
          '<div class="hint" style="margin:0 0 8px;">منح مستقل على جدول الأدوار. الدخول من التطبيق برقم الشخص والجهاز الموثوق، دون رمز الويب. نطاق يومي: أشخاص وجوالات وطلبات وربط الجهاز.</div>' +
          '<div style="font-weight:800;margin:0 0 8px;">الحالة الحالية: ' + escapeHtml(familyAdminStatusLabel(status)) + "</div>" +
          (stamp ? '<div class="hint" style="margin:0 0 8px;">' + escapeHtml(stamp) + "</div>" : "") +
          (loadErr ? '<div class="hint" style="color:#8a2f2f;margin:0 0 8px;">' + escapeHtml(loadErr) + "</div>" : "") +
          (msg ? '<div class="hint" style="margin:0 0 8px;">' + escapeHtml(msg) + "</div>" : "") +
          '<div class="fm-row-actions" style="display:flex;gap:8px;flex-wrap:wrap;">' +
          (canAssign
            ? '<button type="button" class="btn btn-primary btn-small" data-fa-assign' +
              (!rowId ? " disabled" : "") +
              ">منح إدارة العائلة</button>"
            : "") +
          (canSuspend
            ? '<button type="button" class="btn btn-secondary btn-small" data-fa-suspend>إيقاف إدارة العائلة</button>'
            : "") +
          "</div>";

        var assignBtn = panel.querySelector("[data-fa-assign]");
        var suspendBtn = panel.querySelector("[data-fa-suspend]");
        if (assignBtn) {
          assignBtn.addEventListener("click", async function () {
            if (typeof api.setFamilyAdminGrant !== "function") return;
            if (!window.confirm("منح هذا الشخص إدارة العائلة في التطبيق؟ لن يُخزَّن رمز الويب على جهازه.")) return;
            assignBtn.disabled = true;
            var res = await api.setFamilyAdminGrant(rowId, "assign");
            render(Object.assign({}, res, { loadError: res && res.ok ? "" : (res && res.message) || "تعذر المنح." }));
          });
        }
        if (suspendBtn) {
          suspendBtn.addEventListener("click", async function () {
            if (typeof api.setFamilyAdminGrant !== "function") return;
            if (!window.confirm("إيقاف إدارة العائلة؟ سيختفي المدخل من تطبيقه.")) return;
            suspendBtn.disabled = true;
            var res = await api.setFamilyAdminGrant(rowId, "suspend");
            render(Object.assign({}, res, { loadError: res && res.ok ? "" : (res && res.message) || "تعذر الإيقاف." }));
          });
        }
      }

      render({ status: "inactive" });
      if (!rowId) {
        render({ status: "inactive", loadError: "احفظ سجل الشخص أولًا ثم أعد فتح البطاقة." });
        return;
      }
      api.getFamilyAdminGrant(rowId).then(function (res) {
        if (!res || !res.ok) {
          render({ status: "inactive", loadError: (res && res.message) || "تعذر تحميل الصلاحية." });
          return;
        }
        render(res);
      }).catch(function () {
        render({ status: "inactive", loadError: "تعذر تحميل الصلاحية." });
      });
    }

    function buildInlineEdit(parentKey, child, editorOpts) {
      var optsEdit = editorOpts || {};
      var isAdmin = api && api.mode === "admin";
      var childId = typeof api.normalizePersonName === "function"
        ? api.normalizePersonName(child && child.name ? child.name : "")
        : String(child && child.name ? child.name : "");
      var phoneKey = optsEdit.phoneKey || "fm-edit";
      var wrap = document.createElement("div");
      wrap.className = "fm-inline-edit grid";
      var branch = typeof api.getBranchKey === "function" ? api.getBranchKey() : "";
      var branchRoot = typeof api.getBranchRootName === "function" ? api.getBranchRootName(branch) : "";
      var parentDisplay = typeof api.getDisplayNameForNodeId === "function"
        ? api.getDisplayNameForNodeId(parentKey, branchRoot)
        : parentKey;
      wrap.innerHTML =
        (optsEdit.hub
          ? '<div class="hint" style="grid-column:1/-1;margin:0 0 4px;">محرر الشخص المحدد — ليس محرر طلب. الأب يُعرض للقراءة؛ تغيير الأب يتم عبر طلب تصحيح الأب.</div>'
          : "") +
        '<div class="field"><label>الأب / المسار</label><input type="text" data-fm-edit-parent readonly /></div>' +
        (isAdmin
          ? '<div class="field"><label>person_id (UUID)</label><input type="text" data-fm-edit-person-id dir="ltr" lang="en" placeholder="اختياري — للإدارة فقط" /></div>'
          : "") +
        '<div class="field"><label for="fm-edit-child-name">الاسم</label><input id="fm-edit-child-name" type="text" data-fm-edit-name placeholder="اسم الشخص" /></div>' +
        '<div class="field"><label>الجنس</label><select data-fm-edit-gender>' +
        '<option value="">غير محدد</option>' +
        '<option value="son">ذكر</option>' +
        '<option value="daughter">أنثى</option>' +
        "</select></div>" +
        '<div class="field"><label>رقم الجوال</label>' +
        (window.AlzidanPhoneIntl
          ? window.AlzidanPhoneIntl.fieldHtml({
              key: phoneKey,
              nationalAttr: 'data-fm-edit-phone',
              hint: "جوال هذا الشخص — ليس جوال المرسل في طلب تصحيح.",
            })
          : '<input type="tel" data-fm-edit-phone inputmode="numeric" placeholder="5XXXXXXXX" /><div class="hint">اختر الدولة ثم الرقم المحلي</div>') +
        "</div>" +
        '<div class="field"><label>العمر (سنة)</label><input type="text" data-fm-edit-age dir="ltr" inputmode="numeric" placeholder="73" /><div class="hint" style="margin-top:4px;">اكتب العمر رقماً (مثل 73 أو ٧٣) — يُعبَّأ التاريخ الهجري والميلادي تلقائياً</div></div>' +
        '<div class="field"><label>تاريخ الميلاد (هجري)</label><input type="text" data-fm-edit-hijri dir="ltr" lang="en" inputmode="numeric" placeholder="1445-09-01" /></div>' +
        '<div class="field"><label>تاريخ الميلاد (ميلادي)</label><input type="date" data-fm-edit-greg dir="ltr" lang="en" /></div>' +
        '<div class="field"><label>ترتيب الميلاد</label><input type="number" data-fm-edit-order min="1" step="1" inputmode="numeric" /></div>' +
        '<div class="field"><label>المدينة</label><input type="text" data-fm-edit-city /></div>' +
        '<div class="field"><label>الحي / القرية</label><input type="text" data-fm-edit-area /></div>' +
        '<div class="field"><label>الحالة</label><label style="display:flex;align-items:center;gap:8px;min-height:38px;"><input type="checkbox" data-fm-edit-deceased /> متوفى</label></div>' +
        '<div class="field" data-fm-death-field><label>تاريخ الوفاة (هجري)</label><input type="text" data-fm-edit-death-hijri dir="ltr" lang="en" inputmode="numeric" placeholder="1445-09-01" /></div>' +
        '<div class="field" data-fm-death-field><label>تاريخ الوفاة (ميلادي)</label><input type="date" data-fm-edit-death-greg dir="ltr" lang="en" /></div>' +
        '<div class="fm-edit-preview" data-fm-edit-preview style="grid-column:1/-1;"></div>' +
        '<div class="fm-toolbar" style="grid-column:1/-1;"><button type="button" class="btn btn-primary btn-small" data-fm-save-edit>حفظ التعديل</button>' +
        '<button type="button" class="btn btn-secondary btn-small" data-fm-cancel-edit>إلغاء</button></div>' +
        '<div class="alert fm-section-alert" data-fm-edit-alert style="display:none;grid-column:1/-1;"></div>';

      var hijriEl = wrap.querySelector("[data-fm-edit-hijri]");
      var gregEl = wrap.querySelector("[data-fm-edit-greg]");
      var ageEl = wrap.querySelector("[data-fm-edit-age]");
      var deathHijriEl = wrap.querySelector("[data-fm-edit-death-hijri]");
      var deathGregEl = wrap.querySelector("[data-fm-edit-death-greg]");
      var deceasedEl = wrap.querySelector("[data-fm-edit-deceased]");
      bindBirthDateSync(hijriEl, gregEl, api);
      bindBirthDateSync(deathHijriEl, deathGregEl, api);
      var ageBinder = bindAgeToBirthDates(ageEl, hijriEl, gregEl, api, {
        isDeceased: function () {
          return !!(deceasedEl && deceasedEl.checked);
        },
        getDeathGregISO: function () {
          return deathGregEl ? deathGregEl.value : "";
        },
        getDeathHijriISO: function () {
          return deathHijriEl ? deathHijriEl.value : "";
        },
        getAsOfGregISO: function () {
          if (deceasedEl && deceasedEl.checked && deathGregEl && deathGregEl.value) {
            return deathGregEl.value;
          }
          if (
            deceasedEl &&
            deceasedEl.checked &&
            deathHijriEl &&
            deathHijriEl.value &&
            typeof api.hijriToGregorianISO === "function"
          ) {
            return api.hijriToGregorianISO(deathHijriEl.value) || "";
          }
          return "";
        },
        onApplied: refreshAgeHint,
      });
      function syncDeathDateFields() {
        var on = !!(deceasedEl && deceasedEl.checked);
        wrap.querySelectorAll("[data-fm-death-field]").forEach(function (field) {
          field.style.display = on ? "" : "none";
        });
        refreshAgeHint();
      }
      var ageHint = document.createElement("div");
      ageHint.className = "hint";
      ageHint.style.gridColumn = "1 / -1";
      function refreshAgeHint() {
        if (typeof api.calculateAge !== "function") {
          ageHint.style.display = "none";
          return;
        }
        var on = !!(deceasedEl && deceasedEl.checked);
        var age = api.calculateAge({
          deceased: on,
          gdate: gregEl ? gregEl.value : "",
          hdate: hijriEl ? hijriEl.value : "",
          year: hijriEl ? hijriEl.value : "",
          ddate: deathGregEl ? deathGregEl.value : "",
          dhdate: deathHijriEl ? deathHijriEl.value : "",
        });
        if (on) ageHint.textContent = age ? ("العمر عند الوفاة: " + age) : "أدخل الميلاد وتاريخ الوفاة لحساب العمر عند الوفاة.";
        else ageHint.textContent = age ? ("العمر: " + age) : "";
        ageHint.style.display = ageHint.textContent ? "" : "none";
      }

      function toDateInputValue(v) {
        var s = String(v || "").trim().replace(/\//g, "-");
        var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
        if (!m) return "";
        return m[1] + "-" + String(m[2]).padStart(2, "0") + "-" + String(m[3]).padStart(2, "0");
      }
      if (hijriEl) hijriEl.value = String((child && child.hdate) || (child && child.year) || "");
      if (gregEl) gregEl.value = toDateInputValue(child && child.gdate ? child.gdate : "");
      if (deathHijriEl) deathHijriEl.value = String(child && child.dhdate ? child.dhdate : "");
      if (deathGregEl) deathGregEl.value = toDateInputValue(child && child.ddate ? child.ddate : "");
      var orderEl = wrap.querySelector("[data-fm-edit-order]");
      if (orderEl) orderEl.value = child && child.order ? String(child.order) : "";
      var cityEl = wrap.querySelector("[data-fm-edit-city]");
      var parentEl = wrap.querySelector("[data-fm-edit-parent]");
      if (parentEl) parentEl.value = String(parentDisplay || parentKey || "");
      var genderEl = wrap.querySelector("[data-fm-edit-gender]");
      if (genderEl) genderEl.value = genderSelectValue(child && child.gender);
      if (cityEl) cityEl.value = String(child && child.city ? child.city : "");
      var areaEl = wrap.querySelector("[data-fm-edit-area]");
      if (areaEl) areaEl.value = String(child && child.area ? child.area : "");
      if (deceasedEl) {
        deceasedEl.checked = !!(child && child.deceased);
        deceasedEl.addEventListener("change", syncDeathDateFields);
      }
      bindDeathDateToggle(deceasedEl, [deathHijriEl, deathGregEl]);
      var toolbar = wrap.querySelector(".fm-toolbar");
      if (toolbar) wrap.insertBefore(ageHint, toolbar);
      else wrap.appendChild(ageHint);
      [hijriEl, gregEl, deathHijriEl, deathGregEl].forEach(function (el) {
        if (!el) return;
        el.addEventListener("input", refreshAgeHint);
        el.addEventListener("change", refreshAgeHint);
        el.addEventListener("blur", refreshAgeHint);
      });
      syncDeathDateFields();
      if (ageBinder && typeof ageBinder.syncAgeFromDates === "function") {
        ageBinder.syncAgeFromDates();
      }

      var originalName = "";
      var nameEl = wrap.querySelector("[data-fm-edit-name]");
      if (nameEl) {
        var displayName = typeof api.getDisplayNameForNodeId === "function"
          ? api.getDisplayNameForNodeId(childId, branchRoot)
          : childId;
        nameEl.value = String(displayName || childId || "");
        originalName = String(nameEl.value || "");
      }

      var personIdEl = wrap.querySelector("[data-fm-edit-person-id]");
      if (personIdEl) {
        var meta = typeof api.getPersonRowMeta === "function" ? api.getPersonRowMeta(child && child.name ? child.name : "") : null;
        personIdEl.value = String((meta && meta.person_id) || (child && child.personId) || "");
      }

      var phoneEl = wrap.querySelector("[data-fm-edit-phone]");
      var phoneWrap =
        wrap.querySelector('[data-phone-intl="' + phoneKey + '"]') ||
        (phoneEl && phoneEl.closest ? phoneEl.closest("[data-phone-intl]") : null);
      var originalPhone = "";
      if (phoneWrap && window.AlzidanPhoneIntl) window.AlzidanPhoneIntl.bindPhoneIntl(phoneWrap);
      if (phoneEl && typeof api.loadMemberPhone === "function") {
        api.loadMemberPhone(parentKey, child).then(function (v) {
          originalPhone = String(v || "").trim();
          if (phoneWrap && window.AlzidanPhoneIntl) window.AlzidanPhoneIntl.setPhoneIntl(phoneWrap, originalPhone);
          else if (phoneEl) phoneEl.value = originalPhone;
          refreshPreview();
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

      mountWomenManagerPanel(wrap, childId, child && child.gender);
      mountFamilyAdminPanel(wrap, childId);

      var previewEl = wrap.querySelector("[data-fm-edit-preview]");
      var saveBtn = wrap.querySelector("[data-fm-save-edit]");
      var pendingConfirm = false;
      var originalGender = genderSelectValue(child && child.gender);
      var originalHijri = String((child && child.hdate) || (child && child.year) || "");
      var originalGreg = toDateInputValue(child && child.gdate ? child.gdate : "");
      var originalOrder = child && child.order ? String(child.order) : "";
      var originalCity = String(child && child.city ? child.city : "");
      var originalArea = String(child && child.area ? child.area : "");
      var originalDeceased = !!(child && child.deceased);
      var originalDeathHijri = String(child && child.dhdate ? child.dhdate : "");
      var originalDeathGreg = toDateInputValue(child && child.ddate ? child.ddate : "");

      function readDraftPhone() {
        if (phoneWrap && window.AlzidanPhoneIntl) {
          var phoneRead = window.AlzidanPhoneIntl.readE164(phoneWrap, false);
          if (!phoneRead.empty && !phoneRead.ok) return { ok: false, value: "" };
          return { ok: true, value: phoneRead.e164 || "" };
        }
        return { ok: true, value: phoneEl ? String(phoneEl.value || "").trim() : "" };
      }

      function collectDiffs() {
        var lines = [];
        var nextName = nameEl ? String(nameEl.value || "").trim() : "";
        if (nextName !== originalName) {
          lines.push("الاسم: «" + originalName + "» → «" + nextName + "»");
        }
        var nextGender = genderEl ? genderSelectValue(genderEl.value) : "";
        if (nextGender !== originalGender) {
          lines.push("الجنس: «" + genderLabel(originalGender) + "» → «" + genderLabel(nextGender) + "»");
        }
        var phoneDraft = readDraftPhone();
        if (phoneDraft.ok && phoneDraft.value !== originalPhone) {
          lines.push(
            "الجوال: «" +
              (originalPhone || "—") +
              "» → «" +
              (phoneDraft.value || "—") +
              "»"
          );
        }
        var nextHijri = hijriEl ? String(hijriEl.value || "").trim() : "";
        var nextGreg = gregEl ? String(gregEl.value || "").trim() : "";
        if (nextHijri !== originalHijri || nextGreg !== originalGreg) {
          lines.push(
            "الميلاد: «" +
              (originalHijri || originalGreg || "—") +
              "» → «" +
              (nextHijri || nextGreg || "—") +
              "»"
          );
        }
        var nextOrder = orderEl ? String(orderEl.value || "").trim() : "";
        if (nextOrder !== originalOrder) {
          lines.push("ترتيب الميلاد: «" + (originalOrder || "—") + "» → «" + (nextOrder || "—") + "»");
        }
        var nextCity = cityEl ? String(cityEl.value || "").trim() : "";
        if (nextCity !== originalCity) {
          lines.push("المدينة: «" + (originalCity || "—") + "» → «" + (nextCity || "—") + "»");
        }
        var nextArea = areaEl ? String(areaEl.value || "").trim() : "";
        if (nextArea !== originalArea) {
          lines.push("الحي/القرية: «" + (originalArea || "—") + "» → «" + (nextArea || "—") + "»");
        }
        var nextDeceased = !!(deceasedEl && deceasedEl.checked);
        if (nextDeceased !== originalDeceased) {
          lines.push("الحالة: «" + (originalDeceased ? "متوفى" : "حي") + "» → «" + (nextDeceased ? "متوفى" : "حي") + "»");
        }
        var nextDeathHijri = deathHijriEl ? String(deathHijriEl.value || "").trim() : "";
        var nextDeathGreg = deathGregEl ? String(deathGregEl.value || "").trim() : "";
        if (nextDeceased && (nextDeathHijri !== originalDeathHijri || nextDeathGreg !== originalDeathGreg)) {
          lines.push(
            "الوفاة: «" +
              (originalDeathHijri || originalDeathGreg || "—") +
              "» → «" +
              (nextDeathHijri || nextDeathGreg || "—") +
              "»"
          );
        }
        return lines;
      }

      function refreshPreview() {
        pendingConfirm = false;
        if (saveBtn) saveBtn.textContent = "حفظ التعديل";
        if (!previewEl) return;
        var lines = collectDiffs();
        if (!lines.length) {
          previewEl.innerHTML = "<strong>معاينة الحفظ</strong><div class=\"hint\" style=\"margin-top:6px;\">لا توجد تغييرات بعد.</div>";
          return;
        }
        previewEl.innerHTML =
          "<strong>سيُحفظ على هذا الشخص</strong>" +
          '<ul style="margin:6px 0 0;padding-inline-start:18px;">' +
          lines
            .map(function (line) {
              return "<li>" + escapeHtml(line) + "</li>";
            })
            .join("") +
          "</ul>" +
          '<div class="hint" style="margin-top:8px;">الأب/المسار لا يتغير من هنا. جوال المرسل في طلبات التصحيح لا يُكتب على هذا الشخص.</div>';
      }

      wrap.querySelectorAll("input, select, textarea").forEach(function (el) {
        el.addEventListener("input", refreshPreview);
        el.addEventListener("change", refreshPreview);
      });
      refreshPreview();

      wrap.querySelector("[data-fm-cancel-edit]").addEventListener("click", function () {
        if (typeof optsEdit.onCancel === "function") {
          optsEdit.onCancel();
          return;
        }
        editingKey = "";
        refresh();
      });
      wrap.querySelector("[data-fm-save-edit]").addEventListener("click", async function () {
        if (typeof api.updateChild !== "function") return;
        var phoneDraft = readDraftPhone();
        if (!phoneDraft.ok) {
          setAlert(editAlert, "error", "رقم الجوال غير صحيح. اختر الدولة واكتب الرقم المحلي فقط.");
          return;
        }
        var diffs = collectDiffs();
        if (!diffs.length) {
          setAlert(editAlert, "error", "لا توجد تغييرات للحفظ.");
          return;
        }
        if (!pendingConfirm) {
          pendingConfirm = true;
          if (saveBtn) saveBtn.textContent = "تأكيد الحفظ";
          setAlert(editAlert, "success", "راجع المعاينة ثم اضغط تأكيد الحفظ.");
          return;
        }
        var res = await api.updateChild({
          parentId: parentKey,
          childId: childId,
          child: child,
          newName: nameEl ? nameEl.value : "",
          personId: personIdEl ? personIdEl.value : "",
          phone: phoneDraft.value,
          gender: genderEl ? genderEl.value : "",
          hijri: hijriEl ? hijriEl.value : "",
          greg: gregEl ? gregEl.value : "",
          order: orderEl ? orderEl.value : "",
          city: cityEl ? cityEl.value : "",
          area: areaEl ? areaEl.value : "",
          deceased: !!(deceasedEl && deceasedEl.checked),
          deathHijri: deathHijriEl ? deathHijriEl.value : "",
          deathGreg: deathGregEl ? deathGregEl.value : "",
        });
        if (res && res.needsConfirm) {
          var okProceed = typeof window.confirm === "function"
            ? window.confirm((res.message || "اسم قريب من أخ.") + "\n\nهل تريد المتابعة؟")
            : false;
          if (!okProceed) {
            pendingConfirm = false;
            if (saveBtn) saveBtn.textContent = "حفظ التعديل";
            setAlert(editAlert, "error", res.message || "تم إلغاء الحفظ.");
            return;
          }
          res = await api.updateChild({
            parentId: parentKey,
            childId: childId,
            child: child,
            newName: nameEl ? nameEl.value : "",
            personId: personIdEl ? personIdEl.value : "",
            phone: phoneDraft.value,
            gender: genderEl ? genderEl.value : "",
            hijri: hijriEl ? hijriEl.value : "",
            greg: gregEl ? gregEl.value : "",
            order: orderEl ? orderEl.value : "",
            city: cityEl ? cityEl.value : "",
            area: areaEl ? areaEl.value : "",
            deceased: !!(deceasedEl && deceasedEl.checked),
            deathHijri: deathHijriEl ? deathHijriEl.value : "",
            deathGreg: deathGregEl ? deathGregEl.value : "",
            confirmSimilarName: true,
          });
        }
        if (!res || !res.ok) {
          pendingConfirm = false;
          if (saveBtn) saveBtn.textContent = "حفظ التعديل";
          setAlert(editAlert, "error", (res && res.message) || "تعذر حفظ التعديل.");
          return;
        }
        editingKey = "";
        if (typeof optsEdit.onSaved === "function") {
          optsEdit.onSaved(res);
          return;
        }
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


    function motherTreeChildIdFor(key) {
      var id = 0;
      if (typeof api.getTreeChildRowId === "function") {
        id = Number(api.getTreeChildRowId(key) || 0);
      }
      if (!id && typeof api.getPersonRowMeta === "function") {
        var meta = api.getPersonRowMeta(key);
        id = meta && meta.id ? Number(meta.id) : 0;
      }
      return id > 0 ? id : 0;
    }

    async function renderExternalOffspring(key) {
      if (typeof api.listExternalOffspring !== "function") {
        extEl.innerHTML = "";
        extEl.style.display = "none";
        return;
      }
      extEl.style.display = "";
      var motherId = motherTreeChildIdFor(key);
      extEl.innerHTML =
        '<div class="section-title" style="font-size:16px;margin:0 0 6px;">أبناء خارج نطاق العائلة</div>' +
        '<div class="hint" style="margin:0 0 10px;">لا يدخلون الشجرة ولا البحث ولا العدادات. الأب الخارجي نص اختياري وليس فردًا في شجرة الزيدان.</div>';
      if (!motherId) {
        var miss = document.createElement("div");
        miss.className = "hint";
        miss.textContent = "حدد شخصًا له سجل في الشجرة لإضافة أبناء خارج النطاق.";
        extEl.appendChild(miss);
        return;
      }
      var listed = await api.listExternalOffspring(motherId);
      if (!listed || !listed.ok) {
        var err = document.createElement("div");
        err.className = "hint";
        err.textContent = (listed && listed.message) || "تعذر تحميل الأبناء خارج النطاق.";
        extEl.appendChild(err);
        return;
      }
      var rows = Array.isArray(listed.rows) ? listed.rows : [];
      rows.forEach(function (row) {
        var box = document.createElement("div");
        box.className = "fm-row";
        box.style.flexDirection = "column";
        box.style.alignItems = "stretch";
        var parts = [];
        parts.push(String(row.child_name || ""));
        parts.push(genderLabel(row.gender));
        if (row.father_name) parts.push("الأب: " + String(row.father_name));
        box.innerHTML =
          '<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">' +
          '<div class="fm-row-main">' + escapeHtml(parts.join(" – ")) + "</div>" +
          '<div class="fm-row-actions">' +
          '<button type="button" class="btn btn-secondary btn-small" data-fm-ext-edit>تعديل</button>' +
          '<button type="button" class="btn btn-secondary btn-small" data-fm-ext-delete>حذف</button>' +
          "</div></div>";
        var editBtn = box.querySelector("[data-fm-ext-edit]");
        var delBtn = box.querySelector("[data-fm-ext-delete]");
        if (editBtn) {
          editBtn.addEventListener("click", function () {
            editingExtId = String(row.id || "");
            refresh();
          });
        }
        if (delBtn) {
          delBtn.addEventListener("click", async function () {
            if (typeof api.deleteExternalOffspring !== "function") return;
            if (!window.confirm("حذف هذا السجل؟ لن يُمس أبناء البيت في الشجرة.")) return;
            var res = await api.deleteExternalOffspring(row.id);
            if (!res || !res.ok) {
              setAlert(alertEl, "error", (res && res.message) || "تعذر الحذف.");
              return;
            }
            editingExtId = "";
            setAlert(alertEl, "success", res.message || "تم الحذف.");
            await refresh();
          });
        }
        extEl.appendChild(box);
      });
      if (!rows.length) {
        var empty = document.createElement("div");
        empty.className = "hint";
        empty.textContent = "لا يوجد أبناء خارج النطاق مسجّلون لهذه الأم.";
        extEl.appendChild(empty);
      }

      var editingRow = null;
      if (editingExtId) {
        rows.forEach(function (row) {
          if (String(row.id) === String(editingExtId)) editingRow = row;
        });
      }
      var form = document.createElement("div");
      form.className = "grid";
      form.style.marginTop = "10px";
      form.innerHTML =
        '<div class="field"><label>الاسم</label><input type="text" data-fm-ext-name placeholder="اسم الابن أو الابنة" /></div>' +
        '<div class="field"><label>الجنس</label><select data-fm-ext-gender>' +
        '<option value="">غير محدد</option>' +
        '<option value="son">ذكر</option>' +
        '<option value="daughter">أنثى</option>' +
        "</select></div>" +
        '<div class="field"><label>اسم الأب (خارج العائلة، اختياري)</label><input type="text" data-fm-ext-father placeholder="نص فقط — ليس من شجرة الزيدان" /></div>' +
        '<div class="fm-toolbar" style="grid-column:1/-1;">' +
        '<button type="button" class="btn btn-primary btn-small" data-fm-ext-save>' +
        (editingRow ? "حفظ التعديل" : "إضافة") +
        "</button>" +
        (editingRow ? '<button type="button" class="btn btn-secondary btn-small" data-fm-ext-cancel>إلغاء</button>' : "") +
        "</div>";
      var nameEl = form.querySelector("[data-fm-ext-name]");
      var genderEl = form.querySelector("[data-fm-ext-gender]");
      var fatherEl = form.querySelector("[data-fm-ext-father]");
      if (editingRow) {
        if (nameEl) nameEl.value = String(editingRow.child_name || "");
        if (genderEl) genderEl.value = genderSelectValue(editingRow.gender);
        if (fatherEl) fatherEl.value = String(editingRow.father_name || "");
      }
      var saveBtn = form.querySelector("[data-fm-ext-save]");
      if (saveBtn) {
        saveBtn.addEventListener("click", async function () {
          if (typeof api.saveExternalOffspring !== "function") return;
          var res = await api.saveExternalOffspring({
            id: editingRow ? editingRow.id : null,
            mother_tree_child_id: motherId,
            child_name: nameEl ? nameEl.value : "",
            gender: genderEl ? genderEl.value : "",
            father_name: fatherEl ? fatherEl.value : "",
          });
          if (!res || !res.ok) {
            setAlert(alertEl, "error", (res && res.message) || "تعذر الحفظ.");
            return;
          }
          editingExtId = "";
          setAlert(alertEl, "success", res.message || "تم الحفظ.");
          await refresh();
        });
      }
      var cancelBtn = form.querySelector("[data-fm-ext-cancel]");
      if (cancelBtn) {
        cancelBtn.addEventListener("click", function () {
          editingExtId = "";
          refresh();
        });
      }
      extEl.appendChild(form);
    }

    async function refreshWomenPending() {
      if (typeof api.listWomenPending !== "function") {
        pendingEl.innerHTML = "";
        pendingEl.style.display = "none";
        return;
      }
      pendingEl.style.display = "";
      var listed = await api.listWomenPending();
      var rows = listed && listed.ok && Array.isArray(listed.rows) ? listed.rows : [];
      var html =
        '<div class="section-title" style="font-size:16px;margin:0 0 6px;">عضوات بانتظار التثبيت العائلي</div>' +
        '<div class="hint" style="margin:0 0 10px;">إن لم تُضف من التطبيق لأن النسب غير مطابق: عدّل الاسم هنا واختر الأب ثم احفظ كابنة. الدخول الكامل للجوال بعد التثبيت فقط.</div>';
      if (listed && !listed.ok) {
        html += '<div class="hint" style="color:#8a2f2f;">' + escapeHtml(listed.message || "تعذر التحميل.") + "</div>";
        pendingEl.innerHTML = html;
        return;
      }
      if (!rows.length) {
        html += '<div class="hint">لا توجد عضوات بانتظار التثبيت.</div>';
        pendingEl.innerHTML = html;
        return;
      }
      pendingEl.innerHTML = html;
      rows.forEach(function (row) {
        var box = document.createElement("div");
        box.className = "fm-row";
        box.style.flexDirection = "column";
        box.style.alignItems = "stretch";
        box.style.gap = "8px";
        box.style.marginTop = "8px";
        var phoneText = row.phone ? escapeHtml(row.phone) : "بدون جوال";
        var givenName = String(row.displayName || "").trim().split(/\s+/)[0] || "";
        var parentKey = String(getSelectedPersonId() || "").trim();
        var parentLeaf = parentKey
          ? parentKey.slice(Math.max(0, parentKey.lastIndexOf("/") + 1))
          : "";
        box.innerHTML =
          '<div class="fm-row-main" style="font-weight:800;">' +
          escapeHtml(row.displayName || "بدون اسم") +
          "</div>" +
          '<div class="hint" style="margin:0;">' +
          phoneText +
          " — بانتظار التثبيت العائلي</div>" +
          (parentLeaf
            ? '<div class="hint" style="margin:0;">الأب المختار: ' +
              escapeHtml(parentLeaf) +
              " — عدّلي الاسم إن لزم ثم احفظي كابنة.</div>"
            : '<div class="hint" style="color:#8a2f2f;margin:0;">اختر الأب من قائمة الشخص أعلاه ثم احفظ.</div>') +
          '<div class="field"><label>الاسم (يُعدَّل هنا إن كان فيه خطأ)</label>' +
          '<input type="text" data-fm-pending-name /></div>' +
          '<div class="field"><label>بحث الشخص في الشجرة إن كانت موجودة</label>' +
          '<input type="text" data-fm-pending-q placeholder="اسم الأنثى في الشجرة" />' +
          '<div data-fm-pending-hits class="fm-list" style="margin-top:6px;"></div></div>' +
          '<button type="button" class="btn btn-primary btn-small" data-fm-pending-add-place' +
          (parentKey ? "" : " disabled") +
          ">حفظ كابنة للأب المختار</button>" +
          '<button type="button" class="btn btn-secondary btn-small" data-fm-pending-place disabled>تثبيت الربط على شخص موجود</button>';
        var qEl = box.querySelector("[data-fm-pending-q]");
        var nameEl = box.querySelector("[data-fm-pending-name]");
        var hitsEl = box.querySelector("[data-fm-pending-hits]");
        var placeBtn = box.querySelector("[data-fm-pending-place]");
        var addPlaceBtn = box.querySelector("[data-fm-pending-add-place]");
        var chosenId = 0;
        if (nameEl) nameEl.value = String(row.displayName || "");
        if (qEl && givenName) qEl.value = givenName;
        async function runHits() {
          chosenId = 0;
          if (placeBtn) placeBtn.disabled = true;
          if (!hitsEl) return;
          hitsEl.innerHTML = "";
          var q = qEl ? String(qEl.value || "").trim() : "";
          if (q.length < 2 || typeof api.searchWomenPlaceTargets !== "function") return;
          var found = await api.searchWomenPlaceTargets(q);
          if (!found || !found.ok) {
            hitsEl.innerHTML =
              '<div class="hint" style="color:#8a2f2f;">' +
              escapeHtml((found && found.message) || "تعذر البحث.") +
              "</div>";
            return;
          }
          var hits = Array.isArray(found.rows) ? found.rows : [];
          if (!hits.length) {
            hitsEl.innerHTML = '<div class="hint">لا توجد أنثى بهذا الاسم في الشجرة. أضف الابنة من ورقة الإضافة ثم ثبّت.</div>';
            return;
          }
          hits.slice(0, 12).forEach(function (hit) {
            var path = String((hit && hit.path) || "").trim();
            var rid = Number((hit && hit.id) || 0);
            if (!path || !rid) return;
            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = "btn btn-secondary btn-small";
            btn.style.margin = "0 0 4px";
            var branch = String((hit && hit.branchKey) || "").trim();
            btn.textContent = branch ? branch + " — " + path : path;
            btn.addEventListener("click", function () {
              chosenId = rid;
              if (placeBtn) placeBtn.disabled = !rid;
              Array.prototype.forEach.call(hitsEl.querySelectorAll("button"), function (b) {
                b.style.outline = "";
              });
              btn.style.outline = "2px solid rgba(15,76,58,0.45)";
            });
            hitsEl.appendChild(btn);
          });
        }
        if (qEl) {
          qEl.addEventListener("keydown", function (ev) {
            if (ev && ev.key === "Enter") {
              ev.preventDefault();
              runHits();
            }
          });
        }
        if (placeBtn) {
          placeBtn.addEventListener("click", async function () {
            if (typeof api.placeWomenPending !== "function" || !chosenId) return;
            placeBtn.disabled = true;
            var res = await api.placeWomenPending(row.id, chosenId);
            if (!res || !res.ok) {
              setAlert(alertEl, "error", (res && res.message) || "تعذر التثبيت.");
              placeBtn.disabled = false;
              return;
            }
            setAlert(alertEl, "success", res.message || "تم التثبيت.");
            await refresh();
          });
        }
        if (addPlaceBtn) {
          addPlaceBtn.addEventListener("click", async function () {
            var parentNow = String(getSelectedPersonId() || "").trim();
            var parentId = 0;
            if (typeof api.getTreeChildRowId === "function") {
              parentId = Number(api.getTreeChildRowId(parentNow) || 0);
            }
            if (!parentId && typeof api.getPersonRowMeta === "function") {
              var meta = api.getPersonRowMeta(parentNow);
              parentId = meta && meta.id ? Number(meta.id) : 0;
            }
            if (!parentId) {
              setAlert(alertEl, "error", "اختر الأب من قائمة الشخص أعلاه ثم احفظ.");
              return;
            }
            if (typeof api.addWomenPendingUnderParent !== "function") {
              setAlert(alertEl, "error", "شغّل بطاقة إضافة العضوة إذا صح النسب في مساحة SQL.");
              return;
            }
            addPlaceBtn.disabled = true;
            var editedName = nameEl ? String(nameEl.value || "").trim() : String(row.displayName || "");
            var res = await api.addWomenPendingUnderParent(row.id, parentId, editedName);
            if (!res || !res.ok) {
              setAlert(alertEl, "error", (res && res.message) || "تعذر الحفظ.");
              addPlaceBtn.disabled = false;
              return;
            }
            setAlert(alertEl, "success", res.message || "تم الحفظ.");
            await refresh();
          });
        }
        var searchBtn = document.createElement("button");
        searchBtn.type = "button";
        searchBtn.className = "btn btn-secondary btn-small";
        searchBtn.textContent = "بحث";
        searchBtn.addEventListener("click", function () {
          runHits();
        });
        box.querySelector(".field").appendChild(searchBtn);
        pendingEl.appendChild(box);
      });
    }

    async function refresh() {
      hideAlert(alertEl);
      await refreshWomenPending();
      listEl.innerHTML = "";
      var isolated = listChildrenForSelectedFather();
      var key = isolated.key;
      if (!key) {
        listEl.innerHTML = '<div class="hint">اختر شخصاً لعرض أبنائه.</div>';
        extEl.innerHTML = "";
        return;
      }
      var list = sortChildren(isolated.list);
      if (!list.length) {
        listEl.innerHTML = '<div class="hint">لا توجد بيانات مسجلة لهذا الشخص بعد.</div>';
      }

      var branchKey = typeof api.getBranchKey === "function" ? api.getBranchKey() : "";
      var norm =
        typeof api.normalizePersonName === "function"
          ? api.normalizePersonName
          : function (v) { return String(v || "").trim(); };
      var originLockMsg =
        (PersonCore && PersonCore.ORIGIN_LOCK_MSG) ||
        "هذا من الأصول — لا يمكن تعديله أو حذفه.";

      list.forEach(function (child) {
        var info = childDisplayParts(child, key);
        var editId = key + "::" + info.childId;
        var isOrigin = false;
        if (typeof api.isOriginPerson === "function") {
          isOrigin = !!api.isOriginPerson(info.childId, {
            parentId: key,
            personId: child && child.personId ? child.personId : "",
          });
        } else if (PersonCore && typeof PersonCore.isOriginPerson === "function") {
          isOrigin = !!PersonCore.isOriginPerson(info.childId, branchKey, {
            parentId: key,
            personId: child && child.personId ? child.personId : "",
            normalizePersonName: norm,
          });
        }
        var row = document.createElement("div");
        row.className = "fm-row" + (isOrigin ? " fm-origin-locked" : "");
        row.style.flexDirection = "column";
        row.style.alignItems = "stretch";

        var header = document.createElement("div");
        header.style.display = "flex";
        header.style.justifyContent = "space-between";
        header.style.gap = "8px";
        header.style.flexWrap = "wrap";
        var actionsHtml = isOrigin
          ? '<button type="button" class="btn btn-secondary btn-small" data-fm-add-under-child>إضافة أبناء</button>' +
            '<div class="hint fm-origin-lock-hint" style="flex-basis:100%;margin:4px 0 0;">' +
            escapeHtml(originLockMsg) +
            "</div>"
          : '<button type="button" class="btn btn-secondary btn-small" data-fm-edit-child>تعديل</button>' +
            '<button type="button" class="btn btn-secondary btn-small" data-fm-add-under-child>إضافة أبناء</button>' +
            '<button type="button" class="btn btn-secondary btn-small" data-fm-delete-child>حذف</button>';
        header.innerHTML =
          '<div class="fm-row-main">' + escapeHtml(info.parts.join(" – ")) + "</div>" +
          '<div class="fm-row-actions">' + actionsHtml + "</div>";
        row.appendChild(header);

        var editBtn = header.querySelector("[data-fm-edit-child]");
        if (editBtn) {
          editBtn.addEventListener("click", function () {
            editingKey = editingKey === editId ? "" : editId;
            refresh();
          });
        }
        header.querySelector("[data-fm-add-under-child]").addEventListener("click", function () {
          onSelectPerson(info.childId);
        });
        var deleteBtn = header.querySelector("[data-fm-delete-child]");
        if (deleteBtn) {
          deleteBtn.addEventListener("click", async function () {
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
        }

        if (!isOrigin && editingKey === editId) {
          row.appendChild(buildInlineEdit(key, child));
        }
        listEl.appendChild(row);
      });
      await renderExternalOffspring(key);
    }

    function closePersonEditor() {
      if (hubEditorHost) hubEditorHost.innerHTML = "";
      hubEditorHost = null;
    }

    function openPersonEditor(personPath, hostEl) {
      closePersonEditor();
      if (!hostEl) return { ok: false, message: "تعذر فتح المحرر." };
      var found = findPersonAsChild(personPath);
      if (!found) {
        hostEl.innerHTML =
          '<div class="hint">تعذر فتح محرر هذا الشخص من هنا — غالباً لأنه جذر الفرع أو بلا أب في الشجرة.</div>';
        return { ok: false, message: "تعذر تحديد سجل الشخص." };
      }
      hubEditorHost = hostEl;
      editingKey = "";
      hostEl.appendChild(
        buildInlineEdit(found.parentId, found.child, {
          hub: true,
          phoneKey: "fm-person-hub-edit",
          onCancel: closePersonEditor,
          onSaved: function (res) {
            closePersonEditor();
            setAlert(alertEl, "success", (res && res.message) || "تم حفظ التعديل.");
            refresh();
            if (typeof opts.onDataChanged === "function") opts.onDataChanged();
          },
        })
      );
      return { ok: true };
    }

    var hubEditorHost = null;

    function resetSession() {
      editingKey = "";
      editingExtId = "";
      closePersonEditor();
      hideAlert(alertEl);
      refresh();
    }

    refresh();

    return {
      el: container,
      refresh: refresh,
      resetSession: resetSession,
      openPersonEditor: openPersonEditor,
      closePersonEditor: closePersonEditor,
      setAlert: function (type, text) { setAlert(alertEl, type, text); },
    };
  }

  root.AlzidanFamilyChildrenSection = { create: createChildrenSection };
})(typeof window !== "undefined" ? window : globalThis);
