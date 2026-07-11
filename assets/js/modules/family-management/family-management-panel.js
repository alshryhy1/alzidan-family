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
      '<div class="fm-toolbar"><button type="button" class="btn btn-primary btn-small" data-fm-open-add>+ إضافة</button></div>';
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

    var personSelect = hub.querySelector("#fm-person-select");
    var searchInput = hub.querySelector("#fm-person-search");
    var searchResults = hub.querySelector("#fm-person-search-results");
    var personOptions = [];

    function refreshPersonSelect() {
      var branch = getBranchKey();
      personOptions = buildPersonOptions(api, branch);
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
      var childCount = state && state.children && state.children[key] ? state.children[key].length : 0;
      var childStat = personDataBody.querySelector("[data-fm-stat-children]");
      if (childStat) childStat.textContent = String(childCount);
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
      var n = typeof api.normalizePersonName === "function" ? api.normalizePersonName(name || "") : normalizeText(name);
      if (!n) return;
      if (typeof api.ensurePersonOption === "function") api.ensurePersonOption(n);
      selectedPersonId = n;
      if (personSelect && !(opts && opts.skipSelectSync)) personSelect.value = n;
      if (spousesSection) spousesSection.closeManager();
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

    function filterSearchOptions(term) {
      var q = normalizeText(term);
      if (!q) return [];
      var SpousesCore = root.AlzidanSpousesCore || {};
      return personOptions.filter(function (opt) {
        var label = normalizeText(opt.label || opt.value || "");
        var value = normalizeText(opt.value || "");
        if (SpousesCore && typeof SpousesCore.matchesOrderedSubstring === "function") {
          return SpousesCore.matchesOrderedSubstring(q, label) || SpousesCore.matchesOrderedSubstring(q, value);
        }
        return label.toLowerCase().indexOf(q.toLowerCase()) !== -1;
      }).slice(0, 12);
    }

    function renderSearchResults(items) {
      if (!searchResults) return;
      if (!items.length) {
        searchResults.classList.remove("fm-open");
        searchResults.innerHTML = "";
        return;
      }
      searchResults.innerHTML = items.map(function (opt) {
        return '<div class="fm-search-item" data-fm-search-value="' + escapeHtml(opt.value) + '">' + escapeHtml(opt.label || opt.value) + "</div>";
      }).join("");
      searchResults.classList.add("fm-open");
      searchResults.querySelectorAll(".fm-search-item").forEach(function (el) {
        el.addEventListener("click", function () {
          selectPerson(el.getAttribute("data-fm-search-value") || "");
        });
      });
    }

    if (searchInput) {
      searchInput.addEventListener("input", function () {
        renderSearchResults(filterSearchOptions(searchInput.value));
      });
      searchInput.addEventListener("focus", function () {
        renderSearchResults(filterSearchOptions(searchInput.value));
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
