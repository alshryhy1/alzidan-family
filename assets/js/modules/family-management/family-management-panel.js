(function (root) {
  "use strict";

  var PersonCore = root.AlzidanFamilyPersonCore || {};
  var SpousesSection = root.AlzidanFamilySpousesSection || {};
  var ChildrenSection = root.AlzidanFamilyChildrenSection || {};
  var AddSheet = root.AlzidanFamilyAddSheet || {};
  var escapeHtml = PersonCore.escapeHtml || function (v) { return String(v || ""); };
  var normalizeText = PersonCore.normalizeText || function (v) { return String(v || "").trim(); };

  var mounted = null;

  function buildPersonOptions(api, branchKey) {
    if (typeof api.buildPersonOptions === "function") {
      return api.buildPersonOptions(branchKey);
    }
    return [];
  }

  function createPanel(opts) {
    var mode = opts && opts.mode ? opts.mode : "delegate";
    var rootEl = opts && opts.root ? opts.root : null;
    var api = opts && opts.api ? opts.api : {};
    if (!rootEl) return null;

    rootEl.innerHTML = "";
    var panel = document.createElement("div");
    panel.className = "fm-panel";
    rootEl.appendChild(panel);

    var selectedPersonId = "";

    function getSelectedPersonId() {
      return selectedPersonId;
    }

    function getBranchKey() {
      var state = typeof api.getState === "function" ? api.getState() : {};
      return state && state.branch ? state.branch : "";
    }

    var hub = document.createElement("div");
    hub.className = "fm-person-hub";
    hub.innerHTML =
      '<div class="field fm-search-wrap">' +
      '<label for="fm-person-search">بحث عن شخص</label>' +
      '<input id="fm-person-search" type="search" placeholder="ابحث بالاسم..." autocomplete="off" />' +
      '<div id="fm-person-search-results" class="fm-search-results"></div>' +
      "</div>" +
      '<div class="field">' +
      '<label for="fm-person-select">الشخص</label>' +
      '<select id="fm-person-select"><option value="">اختر شخصاً</option></select>' +
      "</div>";
    panel.appendChild(hub);

    var personCard = document.createElement("div");
    personCard.className = "fm-person-card";
    personCard.innerHTML =
      '<div><div class="fm-person-card-title" data-fm-person-title>—</div><div class="fm-person-card-meta" data-fm-person-meta></div></div>' +
      '<div class="fm-toolbar"><button type="button" class="btn btn-primary btn-small" data-fm-open-add>+ إضافة</button>' +
      (mode === "admin"
        ? '<button type="button" class="btn btn-secondary btn-small" data-fm-delete-subtree style="border-color:rgba(239,68,68,0.5);color:#991b1b;">حذف الشجرة الفرعية</button>'
        : "") +
      "</div>";
    panel.appendChild(personCard);

    function makeAccordion(title, bodyEl) {
      var details = document.createElement("details");
      details.className = "fm-accordion";
      details.open = true;
      details.innerHTML =
        '<summary><span>' + escapeHtml(title) + '</span><span class="fm-accordion-chevron" aria-hidden="true">›</span></summary>';
      var body = document.createElement("div");
      body.className = "fm-accordion-body";
      body.appendChild(bodyEl);
      details.appendChild(body);
      return details;
    }

    var personDataBody = document.createElement("div");
    personDataBody.className = "fm-person-data-grid";
    personDataBody.innerHTML =
      '<div class="fm-stat"><div class="fm-stat-label">الزوجات</div><div class="fm-stat-value" data-fm-stat-wives>0</div></div>' +
      '<div class="fm-stat"><div class="fm-stat-label">الأبناء</div><div class="fm-stat-value" data-fm-stat-children>0</div></div>' +
      '<div class="fm-stat"><div class="fm-stat-label">معرّف الشخص</div><div class="fm-stat-value" style="font-size:13px;" data-fm-stat-id>—</div></div>';

    var spousesSection = typeof SpousesSection.create === "function"
      ? SpousesSection.create({
          api: api,
          getSelectedPersonId: getSelectedPersonId,
          onRefreshChildren: refreshChildren,
          onEditWife: function (row) {
            addSheet.open("wife", { wifeRow: row, wives: spousesSection.getWivesRows() });
          },
        })
      : null;

    var childrenSection = typeof ChildrenSection.create === "function"
      ? ChildrenSection.create({
          api: api,
          getSelectedPersonId: getSelectedPersonId,
          onSelectPerson: selectPerson,
          onDataChanged: refreshAll,
        })
      : null;

    panel.appendChild(makeAccordion("بيانات الشخص", personDataBody));
    if (spousesSection && spousesSection.el) panel.appendChild(makeAccordion("الزوجات", spousesSection.el));
    if (childrenSection && childrenSection.el) panel.appendChild(makeAccordion("الأبناء", childrenSection.el));

    var addSheet = typeof AddSheet.create === "function"
      ? AddSheet.create({
          api: api,
          getSelectedPersonId: getSelectedPersonId,
          onSaved: function (payload) {
            refreshAll(payload);
            if (payload && payload.message && childrenSection && typeof childrenSection.setAlert === "function") {
              childrenSection.setAlert("success", payload.message);
            }
          },
        })
      : { open: function () {}, close: function () {}, destroy: function () {} };

    personCard.querySelector("[data-fm-open-add]").addEventListener("click", function () {
      if (!selectedPersonId) return;
      addSheet.open("son", { wives: spousesSection ? spousesSection.getWivesRows() : [] });
    });

    var deleteSubtreeBtn = personCard.querySelector("[data-fm-delete-subtree]");
    if (deleteSubtreeBtn) {
      deleteSubtreeBtn.addEventListener("click", async function () {
        if (!selectedPersonId || typeof api.deleteSubtree !== "function") return;
        if (typeof api.isOriginPerson === "function" && api.isOriginPerson(selectedPersonId)) {
          if (childrenSection && typeof childrenSection.setAlert === "function") {
            childrenSection.setAlert(
              "error",
              (PersonCore && PersonCore.ORIGIN_LOCK_MSG) ||
                "هذا من الأصول — لا يمكن تعديله أو حذفه.",
            );
          }
          return;
        }
        var res = await api.deleteSubtree(selectedPersonId);
        if (!res || !res.ok) {
          if (childrenSection && typeof childrenSection.setAlert === "function") {
            childrenSection.setAlert("error", (res && res.message) || "تعذر حذف الشجرة الفرعية.");
          }
          return;
        }
        await refreshAll({ message: res.message, personId: getBranchKey() && typeof api.getDefaultPersonId === "function" ? api.getDefaultPersonId(getBranchKey()) : "" });
        if (childrenSection && typeof childrenSection.setAlert === "function") {
          childrenSection.setAlert("success", res.message || "تم حذف الشجرة الفرعية.");
        }
      });
    }

    var personSelect = hub.querySelector("#fm-person-select");
    var searchInput = hub.querySelector("#fm-person-search");
    var searchResults = hub.querySelector("#fm-person-search-results");
    var personOptions = [];

    function refreshPersonSelect() {
      var branch = getBranchKey();
      // Do not dump thousands of names into the <select> — typeahead is the finder.
      // Keep only the branch root + currently selected person for quick re-pick.
      var rootId =
        typeof api.getDefaultPersonId === "function" ? api.getDefaultPersonId(branch) : "";
      var allOpts = buildPersonOptions(api, branch);
      var byValue = Object.create(null);
      (Array.isArray(allOpts) ? allOpts : []).forEach(function (opt) {
        if (opt && opt.value) byValue[opt.value] = opt;
      });
      personOptions = [];
      if (rootId && byValue[rootId]) personOptions.push(byValue[rootId]);
      else if (rootId) personOptions.push({ value: rootId, label: rootId, personId: "" });
      if (selectedPersonId && selectedPersonId !== rootId) {
        if (byValue[selectedPersonId]) personOptions.push(byValue[selectedPersonId]);
        else personOptions.push({ value: selectedPersonId, label: selectedPersonId, personId: "" });
      }
      if (!personSelect) return;
      var prev = selectedPersonId;
      personSelect.innerHTML = '<option value="">اختر شخصاً</option>';
      personOptions.forEach(function (opt) {
        var el = document.createElement("option");
        el.value = opt.value;
        el.textContent = opt.label || opt.value;
        personSelect.appendChild(el);
      });
      if (prev && personOptions.some(function (o) { return o.value === prev; })) {
        personSelect.value = prev;
      } else if (typeof api.getDefaultPersonId === "function") {
        var def = api.getDefaultPersonId(branch);
        if (def) selectPerson(def, { skipSelectSync: false });
      }
    }

    function updatePersonCard() {
      var branch = getBranchKey();
      var branchRoot = typeof api.getBranchRootName === "function" ? api.getBranchRootName(branch) : "";
      var display = selectedPersonId && typeof api.getDisplayNameForNodeId === "function"
        ? api.getDisplayNameForNodeId(selectedPersonId, branchRoot)
        : selectedPersonId || "—";
      var titleEl = personCard.querySelector("[data-fm-person-title]");
      if (titleEl) titleEl.textContent = display || "—";
      var metaEl = personCard.querySelector("[data-fm-person-meta]");
      if (metaEl) metaEl.textContent = selectedPersonId ? "محور إدارة العائلة" : "اختر شخصاً من القائمة أو البحث";
      var idEl = personDataBody.querySelector("[data-fm-stat-id]");
      if (idEl) idEl.textContent = selectedPersonId || "—";
      var wivesCount = spousesSection ? spousesSection.getWivesRows().length : 0;
      var wivesStat = personDataBody.querySelector("[data-fm-stat-wives]");
      if (wivesStat) wivesStat.textContent = String(wivesCount);
      var state = typeof api.getState === "function" ? api.getState() : {};
      var key = typeof api.normalizePersonName === "function" ? api.normalizePersonName(selectedPersonId) : selectedPersonId;
      var childCount = 0;
      if (state && state.children && key) {
        var norm = typeof api.normalizePersonName === "function"
          ? api.normalizePersonName
          : function (v) { return String(v || "").trim(); };
        var parentPersonId = "";
        if (typeof api.getPersonRowMeta === "function") {
          var meta = api.getPersonRowMeta(key);
          parentPersonId = meta && meta.person_id ? String(meta.person_id) : "";
        }
        if (typeof PersonCore.childrenForSelectedParent === "function") {
          childCount = PersonCore.childrenForSelectedParent(state.children, key, {
            normalizePersonName: norm,
            parentPersonId: parentPersonId,
          }).list.length;
        } else if (Array.isArray(state.children[key])) {
          childCount = state.children[key].length;
        }
      }
      var childStat = personDataBody.querySelector("[data-fm-stat-children]");
      if (childStat) childStat.textContent = String(childCount);
      var selectedIsOrigin = false;
      if (selectedPersonId && typeof api.isOriginPerson === "function") {
        selectedIsOrigin = !!api.isOriginPerson(selectedPersonId);
      } else if (
        selectedPersonId &&
        PersonCore &&
        typeof PersonCore.isOriginPerson === "function"
      ) {
        selectedIsOrigin = !!PersonCore.isOriginPerson(selectedPersonId, branch, {
          normalizePersonName:
            typeof api.normalizePersonName === "function"
              ? api.normalizePersonName
              : normalizeText,
          pathToRow: state && state.pathToRow ? state.pathToRow : null,
        });
      }
      if (deleteSubtreeBtn) {
        deleteSubtreeBtn.style.display = selectedIsOrigin ? "none" : "";
        deleteSubtreeBtn.disabled = !!selectedIsOrigin;
        deleteSubtreeBtn.title = selectedIsOrigin
          ? (PersonCore && PersonCore.ORIGIN_LOCK_MSG) ||
            "هذا من الأصول — لا يمكن تعديله أو حذفه."
          : "";
      }
      var originHintEl = personCard.querySelector("[data-fm-origin-hint]");
      if (!originHintEl) {
        originHintEl = document.createElement("div");
        originHintEl.className = "hint fm-origin-lock-hint";
        originHintEl.setAttribute("data-fm-origin-hint", "1");
        originHintEl.style.display = "none";
        personCard.appendChild(originHintEl);
      }
      if (selectedIsOrigin) {
        originHintEl.textContent =
          (PersonCore && PersonCore.ORIGIN_LOCK_MSG) ||
          "هذا من الأصول — لا يمكن تعديله أو حذفه.";
        originHintEl.style.display = "block";
      } else {
        originHintEl.textContent = "";
        originHintEl.style.display = "none";
      }
    }

    function refreshChildren() {
      if (childrenSection) childrenSection.refresh();
      updatePersonCard();
    }

    async function refreshSpouses() {
      if (spousesSection) await spousesSection.refresh();
      updatePersonCard();
      addSheet.populateWifeOptions(spousesSection ? spousesSection.getWivesRows() : []);
    }

    async function refreshAll(payload) {
      refreshPersonSelect();
      if (spousesSection) spousesSection.closeManager();
      await refreshSpouses();
      refreshChildren();
      if (payload && payload.personId && typeof payload.personId === "string") {
        selectPerson(payload.personId);
      }
      if (typeof api.onPanelRefreshed === "function") api.onPanelRefreshed(selectedPersonId);
    }

    function selectPerson(name, opts) {
      var o = opts || {};
      var normFn = typeof api.normalizePersonName === "function" ? api.normalizePersonName : normalizeText;
      var n = normFn(name || "");
      if (!n) return;
      var selectedPid = normFn(o.personId || o.person_id || "");
      // Collapse spelling-variant parent keys onto the person's own path via person_id.
      if (PersonCore && typeof PersonCore.resolvePersonIdForNodePath === "function") {
        var st = typeof api.getState === "function" ? api.getState() : {};
        var pid =
          selectedPid ||
          PersonCore.resolvePersonIdForNodePath(
            n,
            (st && st.pathToRow) || {},
            (st && st.children) || {},
            normFn,
          );
        if (pid && typeof PersonCore.canonicalNodePathForPerson === "function") {
          var canon = PersonCore.canonicalNodePathForPerson(
            pid,
            (st && st.pathToRow) || {},
            n,
            normFn,
          );
          if (canon) n = canon;
        }
        if (pid) selectedPid = pid;
      }
      var prev = selectedPersonId;
      if (typeof api.ensurePersonOption === "function") {
        api.ensurePersonOption(n, {
          personId: selectedPid,
          label: o.label || "",
        });
      }
      // Keep the select usable without dumping the whole branch into <option>s.
      if (personSelect && selectedPid) {
        var hasOpt = false;
        for (var oi = 0; oi < personSelect.options.length; oi++) {
          if (personSelect.options[oi].value === n) {
            hasOpt = true;
            break;
          }
        }
        if (!hasOpt) {
          var elOpt = document.createElement("option");
          elOpt.value = n;
          elOpt.textContent = o.label || n;
          personSelect.appendChild(elOpt);
          personOptions.push({
            value: n,
            label: o.label || n,
            personId: selectedPid,
          });
        }
      }
      selectedPersonId = n;
      if (personSelect && !o.skipSelectSync) personSelect.value = n;
      // TREE-004: father change must drop prior add/edit session — never reuse children draft.
      if (prev && prev !== n) {
        if (addSheet && typeof addSheet.close === "function") addSheet.close();
        if (childrenSection && typeof childrenSection.resetSession === "function") {
          childrenSection.resetSession();
        }
        if (spousesSection) spousesSection.closeManager();
      } else if (spousesSection) {
        spousesSection.closeManager();
      }
      refreshSpouses();
      refreshChildren();
      updatePersonCard();
      if (searchInput) searchInput.value = "";
      if (searchResults) {
        searchResults.classList.remove("fm-open");
        searchResults.innerHTML = "";
      }
    }

    if (personSelect) {
      personSelect.addEventListener("change", function () {
        selectPerson(personSelect.value, { skipSelectSync: true });
      });
    }

    var searchTimer = null;
    var searchSeq = 0;
    var SEARCH_DEBOUNCE_MS = 220;

    function filterLocalPersonOptions(term) {
      var q = normalizeText(term);
      if (!q) return [];
      var SpousesCore = root.AlzidanSpousesCore || {};
      var limit =
        (PersonCore && PersonCore.PERSON_SEARCH_LIMIT) || 40;
      var hits = personOptions.filter(function (opt) {
        var label = normalizeText(opt.label || opt.value || "");
        var value = normalizeText(opt.value || "");
        var leaf =
          (PersonCore && typeof PersonCore.personLeafName === "function"
            ? PersonCore.personLeafName(value)
            : "") || label;
        if (SpousesCore && typeof SpousesCore.matchesOrderedSubstring === "function") {
          return (
            SpousesCore.matchesOrderedSubstring(q, leaf) ||
            SpousesCore.matchesOrderedSubstring(q, label) ||
            SpousesCore.matchesOrderedSubstring(q, value)
          );
        }
        return label.toLowerCase().indexOf(q.toLowerCase()) !== -1;
      });
      if (PersonCore && typeof PersonCore.buildPersonSearchOptionsFromRows === "function") {
        return PersonCore.buildPersonSearchOptionsFromRows(
          hits.map(function (opt) {
            return {
              child_name: opt.value,
              name: opt.value,
              person_id: opt.personId || opt.person_id || "",
            };
          }),
          q,
          { limit: limit },
        );
      }
      return hits.slice(0, limit);
    }

    function renderSearchResults(items) {
      if (!searchResults) return;
      if (!items || !items.length) {
        searchResults.classList.remove("fm-open");
        searchResults.innerHTML = "";
        return;
      }
      searchResults.innerHTML = items.map(function (opt) {
        return (
          '<div class="fm-search-item" role="option" data-fm-search-value="' +
          escapeHtml(opt.value || opt.path || "") +
          '" data-fm-search-pid="' +
          escapeHtml(opt.personId || opt.person_id || "") +
          '" data-fm-search-label="' +
          escapeHtml(opt.label || opt.value || "") +
          '">' +
          escapeHtml(opt.label || opt.value) +
          "</div>"
        );
      }).join("");
      searchResults.classList.add("fm-open");
      searchResults.querySelectorAll(".fm-search-item").forEach(function (el) {
        el.addEventListener("click", function () {
          selectPerson(el.getAttribute("data-fm-search-value") || "", {
            personId: el.getAttribute("data-fm-search-pid") || "",
            label: el.getAttribute("data-fm-search-label") || "",
          });
        });
      });
    }

    async function runPersonSearch(term) {
      var q = normalizeText(term);
      if (!q) {
        renderSearchResults([]);
        return;
      }
      var seq = ++searchSeq;
      var items = [];
      if (typeof api.searchPersons === "function") {
        try {
          items = await api.searchPersons(q);
        } catch (_) {
          items = [];
        }
      }
      if (seq !== searchSeq) return;
      if (!Array.isArray(items) || !items.length) {
        items = filterLocalPersonOptions(q);
      }
      if (seq !== searchSeq) return;
      renderSearchResults(items);
    }

    if (searchInput) {
      searchInput.addEventListener("input", function () {
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(function () {
          runPersonSearch(searchInput.value);
        }, SEARCH_DEBOUNCE_MS);
      });
      searchInput.addEventListener("focus", function () {
        if (normalizeText(searchInput.value)) {
          runPersonSearch(searchInput.value);
        }
      });
    }

    document.addEventListener("click", function (e) {
      if (!searchResults || !hub.contains(e.target)) {
        if (searchResults) searchResults.classList.remove("fm-open");
      }
    });

    return {
      mode: mode,
      refresh: refreshAll,
      selectPerson: selectPerson,
      destroy: function () {
        addSheet.destroy();
        rootEl.innerHTML = "";
      },
    };
  }

  root.AlzidanFamilyMgmt = {
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
