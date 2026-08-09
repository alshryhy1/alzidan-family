/**
 * Request Experience (RX) — visitor intent-first entry.
 * Slice RX-1: hub + أضف فردًا end-to-end → approval_requests (no tree_* writes).
 * Spec: docs/REQUEST-EXPERIENCE-UX-v1.md (adopted 2026-08-09).
 */
(function () {
  "use strict";

  var BRANCHES = ["زيدان", "مزيد", "زايد", "لاحم", "ملحم"];
  var CACHE_PREFIX = "alzidan_tree_children_cache_v1:";
  var TRACK_KEY = "alzidan_rx_my_requests_v1";

  var INTENTS = [
    {
      id: "tree_card",
      label: "أضف فردًا للعائلة",
      blurb: "أرسل بيانات شخص جديد للمراجعة — دون حفظ في الشجرة الآن.",
      implemented: true,
    },
    {
      id: "tree_edit",
      label: "صحح بيانات شخص",
      blurb: "اختيار شخص موجود وتصحيح حقول محددة.",
      implemented: false,
      slice: "RX-2",
    },
    {
      id: "event_death",
      label: "أعلن وفاة",
      blurb: "إعلان وفاة مع تأكيد الشخص والتاريخ.",
      implemented: false,
      slice: "RX-3",
    },
    {
      id: "event_marriage",
      label: "أعلن زواج",
      blurb: "إعلان زواج بين طرفين مع التاريخ.",
      implemented: false,
      slice: "RX-4",
    },
    {
      id: "memory_card",
      label: "شارك ذكرى",
      blurb: "نص أو وسائط لذكرى عائلية.",
      implemented: false,
      slice: "RX-5",
    },
    {
      id: "special_card",
      label: "اطلب بطاقة",
      blurb: "طلب بطاقة خاصة حسب النوع المعتمد.",
      implemented: false,
      slice: "RX-6",
    },
  ];

  var STATUS_VISITOR = {
    pending: "تم الإرسال",
    submitted: "تم الإرسال",
    assigned: "وصل للمندوب",
    in_review: "تحت المراجعة",
    needs_changes: "نحتاج معلومة إضافية منك",
    approved: "تم قبول طلبك",
    applied: "تمت إضافة البيانات",
    done: "اكتمل",
    rejected: "لم يُقبل",
  };

  var root = document.querySelector("[data-rx-root]");
  if (!root) return;

  var state = {
    view: "home",
    intentId: "",
    facts: {
      personName: "",
      gender: "",
      birthDate: "",
      submitterName: "",
      submitterPhone: "",
      submitterEmail: "",
      parentQuery: "",
    },
    parentCandidates: [],
    selectedParent: null,
    parentConfirmed: false,
    lastRequestId: "",
    lastStatusLabel: "",
    busy: false,
    error: "",
  };

  function text(v) {
    return String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  }

  function escapeHtml(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function normalizePersonName(v) {
    var s = text(v);
    if (!s) return "";
    var parts = s.split(" ").map(text).filter(Boolean);
    if (
      parts.length >= 3 &&
      parts.every(function (p) {
        return p.length === 1 && /^[\u0600-\u06FF]$/.test(p);
      })
    ) {
      return parts.join("");
    }
    return s;
  }

  function normalizeSearchText(v) {
    return normalizePersonName(v || "")
      .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
      .replace(/[أإآ]/g, "ا")
      .replace(/ى/g, "ي")
      .replace(/ؤ/g, "و")
      .replace(/ئ/g, "ي")
      .replace(/ة/g, "ه")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function normalizePhone(v) {
    return String(v || "")
      .replace(/[٠-٩]/g, function (d) {
        return String(d.charCodeAt(0) - 1632);
      })
      .replace(/[۰-۹]/g, function (d) {
        return String(d.charCodeAt(0) - 1776);
      })
      .replace(/[^\d+]/g, "")
      .trim();
  }

  function normalizeEmail(v) {
    return text(v).toLowerCase();
  }

  function isLikelyEmail(v) {
    var s = normalizeEmail(v);
    return !!(s && s.indexOf("@") >= 0 && s.indexOf(".") >= 0 && s.length >= 6);
  }

  function makeRequestId() {
    var part1 = Math.random().toString(36).slice(2, 6).toUpperCase();
    var part2 = Math.random().toString(36).slice(2, 6).toUpperCase();
    return "REQ-" + part1 + "-" + part2;
  }

  function getClient() {
    if (window.__alzidanConfig && typeof window.__alzidanConfig.getClient === "function") {
      return window.__alzidanConfig.getClient();
    }
    return window.__alzidanSupabaseClient || window.__alzidanالخدمةClient || null;
  }

  function getBranchRootName(branchKey) {
    var k = normalizePersonName(branchKey);
    return k ? k + " بن مطلق بن زيدان" : "";
  }

  function getDisplayNameForNodeId(nodeId, branchRoot) {
    var id = normalizePersonName(nodeId || "");
    if (!id) return "";
    if (branchRoot && id === branchRoot) return id;
    var leaf = id.indexOf("/") >= 0 ? id.split("/").map(normalizePersonName).filter(Boolean).slice(-1)[0] || id : id;
    return leaf;
  }

  function pathLabelFromNodeId(nodeId, branchRoot) {
    var id = normalizePersonName(nodeId || "");
    if (!id) return "";
    var rootName = normalizePersonName(branchRoot || "");
    var parts = id.split("/").map(normalizePersonName).filter(Boolean);
    if (!parts.length) return "";
    return parts
      .map(function (p, idx) {
        if (idx === 0 && rootName && p === rootName) return getDisplayNameForNodeId(p, rootName);
        return getDisplayNameForNodeId(p, rootName);
      })
      .filter(Boolean)
      .join(" / ");
  }

  function readBranchCache(branchKey) {
    try {
      var raw = localStorage.getItem(CACHE_PREFIX + normalizePersonName(branchKey));
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.rows)) return null;
      return parsed.rows;
    } catch (e) {
      return null;
    }
  }

  function collectItemsForBranch(branchKey, rows) {
    var key = normalizePersonName(branchKey);
    var rootName = getBranchRootName(key);
    var byId = new Map();
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      var child =
        normalizePersonName(r.child_name || r.name || "") ||
        normalizePersonName(r.person_id || "");
      var parent = normalizePersonName(r.parent_name || r.parent || "");
      if (!child) return;
      var id = child.indexOf("/") >= 0 ? child : parent && parent.indexOf("/") >= 0 ? parent + "/" + child : child;
      if (!id || id === rootName) return;
      if (byId.has(id)) return;
      var leaf = getDisplayNameForNodeId(id, rootName);
      var path = pathLabelFromNodeId(id, rootName);
      byId.set(id, {
        branch: key,
        id: id,
        leaf: leaf,
        path: path,
        personId: normalizePersonName(r.person_id || ""),
        searchText: normalizeSearchText([leaf, path, id, key].join(" ")),
      });
      if (parent && parent.indexOf("/") >= 0 && !byId.has(parent) && parent !== rootName) {
        var pLeaf = getDisplayNameForNodeId(parent, rootName);
        var pPath = pathLabelFromNodeId(parent, rootName);
        byId.set(parent, {
          branch: key,
          id: parent,
          leaf: pLeaf,
          path: pPath,
          personId: normalizePersonName(r.parent_person_id || ""),
          searchText: normalizeSearchText([pLeaf, pPath, parent, key].join(" ")),
        });
      }
    });
    return Array.from(byId.values());
  }

  async function loadBranchRows(branchKey) {
    var cached = readBranchCache(branchKey);
    if (cached && cached.length) return cached;
    var sb = getClient();
    if (!sb) return [];
    try {
      var res = await sb
        .from("tree_children")
        .select("person_id,parent_person_id,parent_name,parent,child_name,name")
        .eq("branch_key", branchKey)
        .limit(2000);
      if (res.error) return [];
      return Array.isArray(res.data) ? res.data : [];
    } catch (e) {
      return [];
    }
  }

  async function searchParents(query) {
    var q = normalizeSearchText(query);
    if (q.length < 2) return [];
    var all = [];
    for (var i = 0; i < BRANCHES.length; i++) {
      var rows = await loadBranchRows(BRANCHES[i]);
      all = all.concat(collectItemsForBranch(BRANCHES[i], rows));
    }
    var scored = all
      .map(function (item) {
        var leaf = normalizeSearchText(item.leaf);
        var path = normalizeSearchText(item.path);
        var score = 0;
        if (leaf === q) score = 100;
        else if (leaf.indexOf(q) === 0) score = 80;
        else if (leaf.indexOf(q) >= 0) score = 60;
        else if (path.indexOf(q) >= 0) score = 40;
        else if (item.searchText.indexOf(q) >= 0) score = 20;
        return { item: item, score: score };
      })
      .filter(function (x) {
        return x.score > 0;
      })
      .sort(function (a, b) {
        return b.score - a.score || a.item.leaf.localeCompare(b.item.leaf, "ar");
      })
      .slice(0, 12)
      .map(function (x) {
        return x.item;
      });
    return scored;
  }

  function ancestorsFromParent(parent) {
    if (!parent || !parent.id) return [];
    var rootName = getBranchRootName(parent.branch);
    var parts = normalizePersonName(parent.id)
      .split("/")
      .map(normalizePersonName)
      .filter(Boolean);
    if (parts.length <= 1) return [];
    var middle = parts.slice(0, -1);
    if (rootName && middle[0] === rootName) middle = middle.slice(1);
    return middle
      .map(function (p) {
        return getDisplayNameForNodeId(p, rootName);
      })
      .reverse();
  }

  function genderLabel(g) {
    if (g === "male") return "ذكر";
    if (g === "female") return "أنثى";
    return "";
  }

  function intentById(id) {
    for (var i = 0; i < INTENTS.length; i++) {
      if (INTENTS[i].id === id) return INTENTS[i];
    }
    return null;
  }

  function readTracked() {
    try {
      var raw = localStorage.getItem(TRACK_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function writeTracked(list) {
    try {
      localStorage.setItem(TRACK_KEY, JSON.stringify((list || []).slice(0, 20)));
    } catch (e) {}
  }

  function trackLocal(entry) {
    var list = readTracked().filter(function (x) {
      return x && x.requestId !== entry.requestId;
    });
    list.unshift(entry);
    writeTracked(list);
  }

  function statusLabel(status) {
    var s = text(status).toLowerCase();
    return STATUS_VISITOR[s] || "تم الإرسال";
  }

  function setError(msg) {
    state.error = text(msg);
  }

  function clearError() {
    state.error = "";
  }

  function goHome() {
    state.view = "home";
    state.intentId = "";
    state.selectedParent = null;
    state.parentConfirmed = false;
    state.parentCandidates = [];
    state.error = "";
    render();
  }

  function render() {
    if (state.view === "home") renderHome();
    else if (state.view === "intent") renderIntentPreview();
    else if (state.view === "facts") renderFacts();
    else if (state.view === "confirm") renderConfirm();
    else if (state.view === "review") renderReview();
    else if (state.view === "done") renderDone();
    else if (state.view === "scaffold") renderScaffold();
    else renderHome();
  }

  function shell(title, bodyHtml, opts) {
    opts = opts || {};
    var back =
      opts.showBack !== false
        ? '<button type="button" class="btn btn-outline btn-sm" data-rx-back>رجوع</button>'
        : "";
    root.innerHTML =
      '<div class="rx-shell">' +
      '<div class="rx-shell-head">' +
      "<div>" +
      '<div class="rx-kicker">طلب للمراجعة</div>' +
      '<h2 class="rx-title">' +
      escapeHtml(title) +
      "</h2>" +
      (opts.sub
        ? '<p class="rx-sub">' + escapeHtml(opts.sub) + "</p>"
        : "") +
      "</div>" +
      back +
      "</div>" +
      (state.error
        ? '<div class="rx-alert rx-alert-error" role="alert">' +
          escapeHtml(state.error) +
          "</div>"
        : "") +
      '<div class="rx-body">' +
      bodyHtml +
      "</div>" +
      "</div>";
    var backBtn = root.querySelector("[data-rx-back]");
    if (backBtn) {
      backBtn.addEventListener("click", function () {
        clearError();
        if (state.view === "intent" || state.view === "scaffold" || state.view === "done") {
          goHome();
        } else if (state.view === "facts") {
          state.view = "intent";
          render();
        } else if (state.view === "confirm") {
          state.view = "facts";
          state.parentConfirmed = false;
          render();
        } else if (state.view === "review") {
          state.view = "confirm";
          render();
        } else {
          goHome();
        }
      });
    }
  }

  function renderHome() {
    var cards = INTENTS.map(function (intent) {
      return (
        '<button type="button" class="rx-intent-card" data-rx-intent="' +
        escapeHtml(intent.id) +
        '">' +
        '<span class="rx-intent-label">' +
        escapeHtml(intent.label) +
        "</span>" +
        '<span class="rx-intent-blurb">' +
        escapeHtml(intent.blurb) +
        "</span>" +
        (!intent.implemented
          ? '<span class="rx-intent-badge">قريبًا · ' +
            escapeHtml(intent.slice || "") +
            "</span>"
          : "") +
        "</button>"
      );
    }).join("");

    var tracked = readTracked();
    var trackHtml =
      tracked.length === 0
        ? '<p class="rx-muted">لا طلبات محلّية بعد. بعد الإرسال تظهر هنا بحالة الشحن البشرية.</p>'
        : '<ul class="rx-track-list">' +
          tracked
            .slice(0, 8)
            .map(function (row) {
              return (
                "<li>" +
                "<strong>" +
                escapeHtml(row.intentLabel || "طلب") +
                "</strong>" +
                '<span class="rx-track-status">' +
                escapeHtml(statusLabel(row.status)) +
                "</span>" +
                '<span class="rx-muted">' +
                escapeHtml(row.summary || row.requestId || "") +
                "</span>" +
                "</li>"
              );
            })
            .join("") +
          "</ul>";

    shell(
      "ماذا تريد أن تفعل؟",
      '<div class="rx-intent-grid">' +
        cards +
        "</div>" +
        '<div class="rx-track">' +
        "<h3>طلباتي</h3>" +
        '<p class="rx-muted">حالات الشحن: تم الإرسال → وصل للمندوب → تحت المراجعة → …</p>' +
        trackHtml +
        "</div>",
      {
        showBack: false,
        sub: "اختر نية بشرية. «ابدأ الآن» يدخل المسار فقط — ولا يغيّر الشجرة.",
      }
    );

    root.querySelectorAll("[data-rx-intent]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        clearError();
        var id = btn.getAttribute("data-rx-intent");
        var intent = intentById(id);
        if (!intent) return;
        state.intentId = id;
        if (!intent.implemented) {
          state.view = "scaffold";
        } else {
          state.view = "intent";
        }
        render();
      });
    });
  }

  function renderIntentPreview() {
    var intent = intentById(state.intentId);
    if (!intent) {
      goHome();
      return;
    }
    shell(
      intent.label,
      '<p class="rx-lead">' +
        escapeHtml(intent.blurb) +
        "</p>" +
        '<p class="rx-note">لن تُحفظ البيانات في الشجرة من هذه الشاشة. بعد المراجعة فقط تُضاف عبر مسار الاعتماد.</p>' +
        '<div class="rx-actions">' +
        '<button type="button" class="btn btn-primary" data-rx-start>ابدأ الآن</button>' +
        '<button type="button" class="btn btn-outline" data-rx-cancel>إلغاء</button>' +
        "</div>",
      { sub: "دخول المسار فقط — ليس إرسالًا." }
    );
    root.querySelector("[data-rx-start]").addEventListener("click", function () {
      clearError();
      state.view = "facts";
      state.selectedParent = null;
      state.parentConfirmed = false;
      state.parentCandidates = [];
      render();
    });
    root.querySelector("[data-rx-cancel]").addEventListener("click", goHome);
  }

  function renderScaffold() {
    var intent = intentById(state.intentId);
    shell(
      intent ? intent.label : "نية",
      '<p class="rx-lead">هذه النية معتمدة في فهرس RX v1، وتنفيذ مسارها الكامل يأتي في الشريحة <strong>' +
        escapeHtml((intent && intent.slice) || "") +
        "</strong>.</p>" +
        '<p class="rx-note">الهيكل جاهز من الرئيسية (نية أولًا). لا شاشات زوجة/أبناء/ميلاد في v1.</p>' +
        '<div class="rx-actions">' +
        '<button type="button" class="btn btn-primary" data-rx-home>العودة للنوايا</button>' +
        "</div>",
      { sub: "Scaffold — الشريحة الحالية RX-1 تغطي «أضف فردًا» فقط." }
    );
    root.querySelector("[data-rx-home]").addEventListener("click", goHome);
  }

  function renderFacts() {
    var f = state.facts;
    var results =
      state.parentCandidates.length === 0
        ? state.facts.parentQuery.length >= 2
          ? '<p class="rx-muted">لا نتائج مطابقة — جرّب اسمًا أوضح أو سياقًا أطول.</p>'
          : '<p class="rx-muted">اكتب حرفين على الأقل للبحث عن الشخص الذي سيُضاف تحته.</p>'
        : '<ul class="rx-search-results">' +
          state.parentCandidates
            .map(function (item, idx) {
              return (
                '<li><button type="button" class="rx-search-item" data-rx-pick="' +
                idx +
                '">' +
                "<strong>" +
                escapeHtml(item.leaf) +
                "</strong>" +
                '<span class="rx-muted">الفرع: ' +
                escapeHtml(item.branch) +
                "</span>" +
                '<span class="rx-path">' +
                escapeHtml(item.path) +
                "</span>" +
                "</button></li>"
              );
            })
            .join("") +
          "</ul>";

    var selected = state.selectedParent
      ? '<div class="rx-selected">' +
        "<strong>السياق المختار:</strong> " +
        escapeHtml(state.selectedParent.leaf) +
        '<div class="rx-path">' +
        escapeHtml(state.selectedParent.path) +
        "</div></div>"
      : "";

    shell(
      "حقائق قصيرة",
      '<form class="rx-form" data-rx-facts-form>' +
        '<label class="rx-field"><span>اسم الشخص</span>' +
        '<input name="personName" required value="' +
        escapeHtml(f.personName) +
        '" autocomplete="off" /></label>' +
        '<label class="rx-field"><span>الجنس</span>' +
        '<select name="gender" required>' +
        '<option value="">اختر</option>' +
        '<option value="male"' +
        (f.gender === "male" ? " selected" : "") +
        ">ذكر</option>" +
        '<option value="female"' +
        (f.gender === "female" ? " selected" : "") +
        ">أنثى</option>" +
        "</select></label>" +
        '<label class="rx-field"><span>تاريخ الميلاد (اختياري)</span>' +
        '<input name="birthDate" type="date" value="' +
        escapeHtml(f.birthDate) +
        '" /></label>' +
        '<fieldset class="rx-fieldset">' +
        "<legend>تحت من في العائلة؟</legend>" +
        '<p class="rx-muted">ابحث بالاسم ثم أكّد المسار. عند أكثر من احتمال اختر بوضوح — لا تخمين.</p>' +
        '<label class="rx-field"><span>بحث عن الأب / السياق</span>' +
        '<input name="parentQuery" value="' +
        escapeHtml(f.parentQuery) +
        '" autocomplete="off" placeholder="مثال: محمد بن خالد" /></label>' +
        '<button type="button" class="btn btn-outline btn-sm" data-rx-search>ابحث</button>' +
        results +
        selected +
        "</fieldset>" +
        '<fieldset class="rx-fieldset"><legend>بيانات المرسل</legend>' +
        '<label class="rx-field"><span>اسمك</span>' +
        '<input name="submitterName" required value="' +
        escapeHtml(f.submitterName) +
        '" autocomplete="name" /></label>' +
        '<label class="rx-field"><span>رقم الجوال</span>' +
        '<input name="submitterPhone" required type="tel" inputmode="tel" value="' +
        escapeHtml(f.submitterPhone) +
        '" placeholder="05xxxxxxxx" autocomplete="tel" /></label>' +
        '<label class="rx-field"><span>البريد (اختياري)</span>' +
        '<input name="submitterEmail" type="email" value="' +
        escapeHtml(f.submitterEmail) +
        '" autocomplete="email" /></label>' +
        "</fieldset>" +
        '<div class="rx-actions">' +
        '<button type="submit" class="btn btn-primary">متابعة لتأكيد السياق</button>' +
        "</div>" +
        "</form>",
      { sub: "أقل حقول لازمة — ثم تأكيد بشري للمسار." }
    );

    var form = root.querySelector("[data-rx-facts-form]");
    var searchBtn = root.querySelector("[data-rx-search]");

    function readForm() {
      var fd = new FormData(form);
      state.facts.personName = text(fd.get("personName"));
      state.facts.gender = text(fd.get("gender"));
      state.facts.birthDate = text(fd.get("birthDate"));
      state.facts.parentQuery = text(fd.get("parentQuery"));
      state.facts.submitterName = text(fd.get("submitterName"));
      state.facts.submitterPhone = normalizePhone(fd.get("submitterPhone"));
      state.facts.submitterEmail = text(fd.get("submitterEmail"));
    }

    searchBtn.addEventListener("click", async function () {
      clearError();
      readForm();
      if (state.facts.parentQuery.length < 2) {
        setError("اكتب حرفين على الأقل للبحث.");
        render();
        return;
      }
      searchBtn.disabled = true;
      searchBtn.textContent = "جاري البحث…";
      try {
        state.parentCandidates = await searchParents(state.facts.parentQuery);
        state.selectedParent = null;
        state.parentConfirmed = false;
      } finally {
        render();
      }
    });

    root.querySelectorAll("[data-rx-pick]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var idx = Number(btn.getAttribute("data-rx-pick"));
        state.selectedParent = state.parentCandidates[idx] || null;
        state.parentConfirmed = false;
        clearError();
        render();
      });
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      clearError();
      readForm();
      if (!state.facts.personName || !state.facts.gender) {
        setError("يرجى إدخال الاسم والجنس.");
        render();
        return;
      }
      if (!state.selectedParent) {
        setError("اختر من نتائج البحث الشخص الذي سيُضاف تحته، ثم تابع.");
        render();
        return;
      }
      if (!state.facts.submitterName || state.facts.submitterPhone.length < 9) {
        setError("يرجى إدخال اسم المرسل ورقم جوال صحيح.");
        render();
        return;
      }
      if (state.facts.submitterEmail && !isLikelyEmail(state.facts.submitterEmail)) {
        setError("يرجى إدخال بريد صحيح أو تركه فارغًا.");
        render();
        return;
      }
      state.view = "confirm";
      render();
    });
  }

  function renderConfirm() {
    var p = state.selectedParent;
    if (!p) {
      state.view = "facts";
      render();
      return;
    }
    shell(
      "تأكيد الشخص / السياق",
      '<div class="rx-confirm-card">' +
        "<p>سيُضاف الشخص تحت:</p>" +
        "<h3>" +
        escapeHtml(p.leaf) +
        "</h3>" +
        '<p class="rx-path"><strong>المسار:</strong> ' +
        escapeHtml(p.path) +
        "</p>" +
        '<p class="rx-muted">الفرع: ' +
        escapeHtml(p.branch) +
        "</p>" +
        "<p>هل هذا الشخص المقصود؟</p>" +
        '<div class="rx-actions">' +
        '<button type="button" class="btn btn-primary" data-rx-confirm-yes>نعم، هذا هو المقصود</button>' +
        '<button type="button" class="btn btn-outline" data-rx-confirm-other>اختيار شخص آخر</button>' +
        "</div>" +
        "</div>",
      { sub: "تأكيد بشري إلزامي — خاصة عند تشابه الأسماء." }
    );
    root.querySelector("[data-rx-confirm-yes]").addEventListener("click", function () {
      state.parentConfirmed = true;
      state.view = "review";
      clearError();
      render();
    });
    root.querySelector("[data-rx-confirm-other]").addEventListener("click", function () {
      state.selectedParent = null;
      state.parentConfirmed = false;
      state.view = "facts";
      clearError();
      render();
    });
  }

  function renderReview() {
    if (!state.selectedParent || !state.parentConfirmed) {
      state.view = "confirm";
      render();
      return;
    }
    var f = state.facts;
    var p = state.selectedParent;
    shell(
      "راجع قبل الإرسال",
      '<div class="rx-review">' +
        "<dl>" +
        "<div><dt>الاسم</dt><dd>" +
        escapeHtml(f.personName) +
        "</dd></div>" +
        "<div><dt>الجنس</dt><dd>" +
        escapeHtml(genderLabel(f.gender)) +
        "</dd></div>" +
        "<div><dt>الأب / السياق</dt><dd>" +
        escapeHtml(p.leaf) +
        "</dd></div>" +
        "<div><dt>المسار</dt><dd>" +
        escapeHtml(p.path) +
        "</dd></div>" +
        "<div><dt>تاريخ الميلاد</dt><dd>" +
        escapeHtml(f.birthDate || "—") +
        "</dd></div>" +
        "<div><dt>المرسل</dt><dd>" +
        escapeHtml(f.submitterName) +
        " · " +
        escapeHtml(f.submitterPhone) +
        "</dd></div>" +
        "</dl>" +
        '<p class="rx-note">سيتم إرسال هذه المعلومات للمراجعة (لن تُحفظ في الشجرة الآن).</p>' +
        '<div class="rx-actions">' +
        '<button type="button" class="btn btn-primary" data-rx-submit' +
        (state.busy ? " disabled" : "") +
        ">أرسل الطلب للمراجعة</button>" +
        '<button type="button" class="btn btn-outline" data-rx-edit>تعديل</button>' +
        "</div>" +
        "</div>",
      { sub: "الإرسال الوحيد إلى مسار المراجعة." }
    );
    root.querySelector("[data-rx-edit]").addEventListener("click", function () {
      state.view = "facts";
      clearError();
      render();
    });
    root.querySelector("[data-rx-submit]").addEventListener("click", function () {
      submitAddPerson();
    });
  }

  function buildTreeCardMessage(payload) {
    var ancestors = Array.isArray(payload.ancestors) ? payload.ancestors : [];
    var lines = [];
    lines.push("طلب: أضف فردًا للعائلة");
    lines.push("");
    lines.push("رقم الطلب: " + payload.requestId);
    lines.push("العائلة: " + (payload.branch || ""));
    if (ancestors.length) {
      lines.push("سلسلة السياق:");
      ancestors.forEach(function (v, idx) {
        lines.push("  " + String(idx + 1) + "- " + (v || ""));
      });
    }
    lines.push("الأب / السياق: " + (payload.father || ""));
    if (payload.parentPath) lines.push("المسار: " + payload.parentPath);
    lines.push("الاسم: " + (payload.personName || ""));
    lines.push("الجنس: " + (payload.genderLabel || ""));
    lines.push("تاريخ الميلاد (اختياري): " + (payload.personDob || ""));
    lines.push("");
    lines.push("بيانات المرسل:");
    lines.push("الاسم: " + (payload.submitterName || ""));
    lines.push("الجوال: " + (payload.submitterPhone || ""));
    lines.push("البريد (اختياري): " + (payload.submitterEmail || ""));
    lines.push("التاريخ: " + new Date(payload.createdAt).toLocaleString("ar-SA"));
    lines.push("");
    lines.push("__JSON__:");
    lines.push(
      JSON.stringify(
        {
          v: 1,
          kind: "tree_card",
          rx: "v1",
          branch_key: payload.branch,
          grandfather: ancestors[0] || "",
          ancestors: ancestors,
          father: payload.father,
          father_path: payload.parentNodeId || payload.parentPath || "",
          father_person_id: payload.parentPersonId || "",
          parent_person_id: payload.parentPersonId || "",
          parent_path: payload.parentPath || "",
          parent_node_id: payload.parentNodeId || "",
          name: payload.personName,
          gender: payload.gender || "",
          birth_date_g: payload.personDob,
          city: "",
          area: "",
          children: [],
          submitter: {
            name: payload.submitterName,
            phone: payload.submitterPhone,
            email: payload.submitterEmail,
          },
          created_at: payload.createdAt,
        },
        null,
        2
      )
    );
    return lines.join("\n");
  }

  async function submitAddPerson() {
    if (state.busy) return;
    clearError();
    if (!state.selectedParent || !state.parentConfirmed) {
      setError("يلزم تأكيد السياق قبل الإرسال.");
      state.view = "confirm";
      render();
      return;
    }
    var sb = getClient();
    if (!sb) {
      setError("تعذر الإرسال لأن الربط غير مُعد.");
      render();
      return;
    }
    state.busy = true;
    render();
    var f = state.facts;
    var p = state.selectedParent;
    var parentPersonId = text(p.personId || "");
    if (!parentPersonId) {
      state.busy = false;
      setError(
        "تعذر تحديد هوية الأب في الشجرة. أعد اختيار السياق من نتائج البحث ثم أكّد المسار."
      );
      state.view = "confirm";
      render();
      return;
    }
    var ancestors = ancestorsFromParent(p);
    var payload = {
      requestId: makeRequestId(),
      createdAt: new Date().toISOString(),
      branch: p.branch,
      father: p.leaf,
      parentPath: p.path,
      parentNodeId: p.id,
      parentPersonId: parentPersonId,
      ancestors: ancestors,
      personName: f.personName,
      gender: f.gender,
      genderLabel: genderLabel(f.gender),
      personDob: f.birthDate || "",
      submitterName: f.submitterName,
      submitterPhone: f.submitterPhone,
      submitterEmail: f.submitterEmail ? normalizeEmail(f.submitterEmail) : "",
    };
    var msg = buildTreeCardMessage(payload);
    var row = {
      request_id: payload.requestId,
      kind: "tree_card",
      branch_key: payload.branch,
      name: payload.submitterName,
      phone: payload.submitterPhone,
      email: payload.submitterEmail || null,
      message: msg,
      status: "pending",
      created_at: payload.createdAt,
    };
    try {
      var res = await sb.from("approval_requests").insert(row);
      if (res.error) {
        state.busy = false;
        setError("تعذر إرسال الطلب حاليًا، حاول لاحقًا.");
        render();
        return;
      }
      try {
        await sb.functions.invoke("alzidan-email-notify", {
          body: { mode: "new_request", record: row },
        });
      } catch (notifyError) {}
      trackLocal({
        requestId: payload.requestId,
        intentLabel: "أضف فردًا للعائلة",
        status: "submitted",
        summary: payload.personName + " تحت " + payload.father,
        createdAt: payload.createdAt,
      });
      state.lastRequestId = payload.requestId;
      state.lastStatusLabel = statusLabel("submitted");
      state.busy = false;
      state.view = "done";
      clearError();
      render();
    } catch (e) {
      state.busy = false;
      setError("تعذر إرسال الطلب حاليًا، حاول لاحقًا.");
      render();
    }
  }

  function renderDone() {
    shell(
      "تم الإرسال",
      '<div class="rx-done">' +
        '<p class="rx-lead">وصل طلبك لمسار المراجعة.</p>' +
        '<p><strong>الحالة:</strong> ' +
        escapeHtml(state.lastStatusLabel || "تم الإرسال") +
        "</p>" +
        '<p class="rx-muted">مرجع المتابعة (ثانوي): ' +
        escapeHtml(state.lastRequestId) +
        "</p>" +
        '<p class="rx-note">لن تُحفظ البيانات في الشجرة حتى اعتماد الطلب وتطبيقه.</p>' +
        '<div class="rx-actions">' +
        '<button type="button" class="btn btn-primary" data-rx-home>طلب آخر</button>' +
        "</div>" +
        "</div>",
      { showBack: false, sub: "تتبع إنساني — لغة الشحن من رحلة القرار." }
    );
    root.querySelector("[data-rx-home]").addEventListener("click", function () {
      state.facts = {
        personName: "",
        gender: "",
        birthDate: "",
        submitterName: "",
        submitterPhone: "",
        submitterEmail: "",
        parentQuery: "",
      };
      goHome();
    });
  }

  render();
})();
