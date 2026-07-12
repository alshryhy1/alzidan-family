(function (global) {
  "use strict";

  var BRANCHES = ["زيدان", "زايد", "مزيد", "لاحم", "ملحم"];
  var MEMORY_MEDIA_MAX_BYTES = 50 * 1024 * 1024;
  var ADMIN_TOKEN_KEY = "alzidan_admin_token_v1";

  var UI_KINDS = [
    { key: "image", label: "صورة" },
    { key: "video", label: "فيديو" },
    { key: "audio", label: "صوت" },
    { key: "story", label: "قصة" },
    { key: "document", label: "وثيقة" }
  ];

  var KIND_MAP = {
    image: "general",
    video: "video",
    audio: "audio",
    story: "story",
    document: "document"
  };

  var ADMIN_KIND_MAP = {
    image: "photo_album",
    video: "video",
    audio: "audio",
    story: "story",
    document: "document"
  };

  function text(v) {
    return String(v || "").replace(/\s+/g, " ").trim();
  }

  function normalizeDigits(v) {
    return String(v || "")
      .replace(/[٠-٩]/g, function (d) {
        return String(d.charCodeAt(0) - 1632);
      })
      .replace(/[۰-۹]/g, function (d) {
        return String(d.charCodeAt(0) - 1776);
      });
  }

  function cleanPhone(v) {
    return normalizeDigits(v).replace(/[^\d]/g, "");
  }

  function getClient() {
    var cfg = global.__alzidanConfig || {};
    if (typeof cfg.getClient === "function") return cfg.getClient();
    if (global.__alzidanSupabaseClient) return global.__alzidanSupabaseClient;
    return null;
  }

  function getAdminToken() {
    try {
      var s = String(sessionStorage.getItem("alzidan_admin_token_session_v1") || "").trim();
      if (s) return s;
      return String(localStorage.getItem(ADMIN_TOKEN_KEY) || "").trim();
    } catch (e) {
      return "";
    }
  }

  function mapUiKind(uiKind, mode) {
    var map = mode === "admin" ? ADMIN_KIND_MAP : KIND_MAP;
    return map[uiKind] || (mode === "admin" ? "photo_album" : "general");
  }

  function makeMemoryRequestId() {
    return (
      "MEM-" +
      Date.now().toString(36).toUpperCase() +
      "-" +
      Math.random().toString(36).slice(2, 6).toUpperCase()
    );
  }

  function publicStorageUrl(path) {
    var cfg = global.__alzidanConfig || {};
    return (
      String(cfg.SUPABASE_URL || "").replace(/\/+$/, "") +
      "/storage/v1/object/public/event-media/" +
      String(path || "")
        .split("/")
        .map(encodeURIComponent)
        .join("/")
    );
  }

  function fileExtFromName(name, fallback) {
    var base = String(name || "").trim();
    var idx = base.lastIndexOf(".");
    if (idx < 0) return fallback;
    var ext = base.slice(idx + 1).toLowerCase().replace(/[^a-z0-9]/g, "");
    return ext || fallback;
  }

  function acceptForKind(kind) {
    if (kind === "image") return "image/*";
    if (kind === "video") return "video/*";
    if (kind === "audio") return "audio/*";
    if (kind === "document") return ".pdf,.doc,.docx,application/pdf";
    return "";
  }

  function mediaDbTypeForKind(kind) {
    if (kind === "video") return "video";
    if (kind === "audio") return "audio";
    if (kind === "document") return "document";
    return "image";
  }

  function requiresFile(kind) {
    return kind === "image" || kind === "video" || kind === "audio" || kind === "document";
  }

  function defaultExtForKind(kind) {
    if (kind === "video") return "mp4";
    if (kind === "audio") return "m4a";
    if (kind === "document") return "pdf";
    return "jpg";
  }

  function defaultMimeForKind(kind) {
    if (kind === "video") return "video/mp4";
    if (kind === "audio") return "audio/mp4";
    if (kind === "document") return "application/pdf";
    return "image/jpeg";
  }

  function formatLineage(raw) {
    var s = text(raw);
    if (!s) return "";
    return s.split("/").map(text).filter(Boolean).join(" / ");
  }

  async function uploadMemoryFile(client, requestId, file, uiKind) {
    if (!file) return "";
    if (file.size > MEMORY_MEDIA_MAX_BYTES) {
      throw new Error("حجم الملف أكبر من 50MB.");
    }
    var kind = text(uiKind) || "image";
    var ext = fileExtFromName(file.name, defaultExtForKind(kind));
    var path =
      "memory-pending/" + String(requestId || makeMemoryRequestId()) + "/" + kind + "-" + Date.now() + "." + ext;
    var contentType = file.type || defaultMimeForKind(kind);
    var res = await client.storage.from("event-media").upload(path, file, {
      contentType: contentType,
      upsert: false
    });
    if (res.error) throw new Error("تعذر رفع الملف: " + (res.error.message || "تحقق من صلاحيات التخزين على Supabase."));
    return publicStorageUrl(path);
  }

  function validatePayload(payload, file, mode, itemId) {
    var uiKind = text(payload.ui_kind) || "image";
    if (!text(payload.branch_key)) return "اختر الفرع.";
    if (!text(payload.person_name)) return "اسم الشخص المرتبط بالذكرى مطلوب.";
    if (!text(payload.title)) return "عنوان الذكرى مطلوب.";

    if (mode === "delegate" || mode === "public") {
      if (!text(payload.submitted_by_name)) return "اسم المرسل مطلوب.";
      if (cleanPhone(payload.submitted_by_phone).length < 9) return "رقم جوال صحيح مطلوب (9 أرقام على الأقل).";
    }

    if (mode === "admin" && !getAdminToken()) {
      return "سجّل الدخول من لوحة الإدارة أولاً.";
    }

    if (payload.memory_kind === "story" && !text(payload.story_text)) return "نص القصة مطلوب.";

    if (requiresFile(uiKind) && !file && !itemId) {
      if (uiKind === "image") return "اختر صورة للرفع.";
      if (uiKind === "video") return "اختر فيديو للرفع.";
      if (uiKind === "audio") return "اختر ملف صوت للرفع.";
      if (uiKind === "document") return "اختر وثيقة للرفع.";
    }
    return "";
  }

  async function submitMemory(raw, file) {
    var client = getClient();
    if (!client) throw new Error("تعذر الاتصال بقاعدة البيانات.");

    var mode = text(raw._mode) || "public";
    var uiKind = text(raw.ui_kind) || "image";
    var memoryKind = mapUiKind(uiKind, mode);
    var payload = {
      ui_kind: uiKind,
      branch_key: text(raw.branch_key),
      person_name: text(raw.person_name),
      person_lineage: text(raw.person_lineage) || null,
      title: text(raw.title),
      description: text(raw.description) || null,
      story_text: text(raw.story_text) || null,
      memory_kind: memoryKind,
      memory_date: text(raw.memory_date) || null,
      memory_year: text(raw.memory_year) || null,
      submitted_by_name: text(raw.submitted_by_name),
      submitted_by_phone: cleanPhone(raw.submitted_by_phone),
      submitted_by_relation: mode === "delegate" ? "delegate" : text(raw.submitted_by_relation) || "public"
    };

    var issue = validatePayload(payload, file, mode, null);
    if (issue) throw new Error(issue);

    var requestId = makeMemoryRequestId();
    var mediaUrl = "";
    if (file) {
      mediaUrl = await uploadMemoryFile(client, requestId, file, uiKind);
    }

    var item = {
      branch_key: payload.branch_key,
      person_id: raw.person_id || null,
      person_name: payload.person_name,
      person_lineage: payload.person_lineage,
      title: payload.title,
      description: payload.description,
      story_text: memoryKind === "story" ? payload.story_text : null,
      memory_kind: payload.memory_kind,
      memory_date: payload.memory_date,
      memory_year: payload.memory_year,
      submitted_by_name: payload.submitted_by_name,
      submitted_by_phone: payload.submitted_by_phone,
      submitted_by_relation: payload.submitted_by_relation,
      is_featured: false,
      display_order: 0,
      tags: []
    };

    var mediaPayload = [];
    if (mediaUrl) {
      mediaPayload.push({
        media_type: mediaDbTypeForKind(uiKind),
        media_url: mediaUrl,
        thumbnail_url: null,
        caption: null,
        display_order: 0
      });
    }

    var res = await client.rpc("memory_submit_item_v1", {
      p_item: item,
      p_media: mediaPayload
    });

    if (res.error) {
      var msg = res.error.message || "";
      if (res.error.code === "PGRST202" || msg.indexOf("memory_submit_item_v1") >= 0 || res.error.status === 404) {
        throw new Error("نفّذ family_memory_delegate_fix.sql على Supabase ثم أعد المحاولة.");
      }
      throw new Error(msg || "تعذر إرسال الذكرى.");
    }

    return { ok: true, id: res.data };
  }

  async function submitAdminMemory(raw, file) {
    var client = getClient();
    var token = getAdminToken();
    if (!client) throw new Error("تعذر الاتصال بقاعدة البيانات.");
    if (!token) throw new Error("سجّل الدخول من لوحة الإدارة أولاً.");

    var uiKind = text(raw.ui_kind) || "image";
    var memoryKind = mapUiKind(uiKind, "admin");
    var itemId = text(raw.item_id) || null;

    var payload = {
      ui_kind: uiKind,
      branch_key: text(raw.branch_key),
      person_name: text(raw.person_name),
      person_lineage: text(raw.person_lineage) || null,
      title: text(raw.title),
      description: text(raw.description) || null,
      story_text: text(raw.story_text) || null,
      memory_kind: memoryKind,
      memory_date: text(raw.memory_date) || null,
      memory_year: text(raw.memory_year) || null
    };

    var issue = validatePayload(payload, file, "admin", itemId);
    if (issue) throw new Error(issue);

    var mediaPayload = [];
    if (file) {
      var url = await uploadMemoryFile(client, makeMemoryRequestId(), file, uiKind);
      mediaPayload.push({
        id: null,
        media_type: mediaDbTypeForKind(uiKind),
        media_url: url,
        thumbnail_url: null,
        caption: null,
        display_order: 0
      });
    }

    var itemPayload = {
      id: itemId,
      branch_key: payload.branch_key,
      person_id: raw.person_id || null,
      person_name: payload.person_name,
      person_lineage: payload.person_lineage,
      title: payload.title,
      description: payload.description,
      story_text: uiKind === "story" ? payload.story_text : null,
      memory_kind: memoryKind,
      memory_date: payload.memory_date,
      memory_year: payload.memory_year,
      location_name: null,
      location_city: null,
      location_area: null,
      tags: [],
      is_featured: false,
      display_order: 0,
      status: "approved"
    };

    var res = await client.rpc("memory_admin_save_item_v1", {
      p_token: token,
      p_item: itemPayload,
      p_media: mediaPayload,
      p_extra_people: []
    });

    if (res.error) throw new Error(res.error.message || "تعذر الحفظ.");
    return { ok: true, id: res.data };
  }

  function branchOptions(selected) {
    return BRANCHES.map(function (b) {
      return '<option value="' + b + '"' + (selected === b ? " selected" : "") + ">" + b + "</option>";
    }).join("");
  }

  function kindOptions() {
    return UI_KINDS.map(function (k) {
      return '<option value="' + k.key + '">' + k.label + "</option>";
    }).join("");
  }

  function uiKindFromMemoryKind(kind) {
    var k = text(kind).toLowerCase();
    if (k === "video") return "video";
    if (k === "audio") return "audio";
    if (k === "document") return "document";
    if (k === "story") return "story";
    if (k === "photo_album" || k === "general") return "image";
    return "image";
  }

  function readForm(root) {
    var read = function (key) {
      var node = root.querySelector('[data-f="' + key + '"]');
      return node ? node.value : "";
    };
    return {
      item_id: text(read("item_id")) || null,
      person_id: text(read("person_id")) || null,
      branch_key: text(read("branch")),
      ui_kind: text(read("ui_kind")) || "image",
      person_name: text(read("person_name")),
      person_lineage: text(read("person_lineage")) || null,
      title: text(read("title")),
      description: text(read("description")) || null,
      story_text: text(read("story_text")) || null,
      memory_date: text(read("memory_date")) || null,
      memory_year: text(read("memory_year")) || null,
      submitted_by_name: text(read("submitted_by_name")),
      submitted_by_phone: text(read("submitted_by_phone")),
      submitted_by_relation: text(read("submitted_by_relation"))
    };
  }

  function writeForm(root, data, opts) {
    opts = opts || {};
    var set = function (key, val) {
      var node = root.querySelector('[data-f="' + key + '"]');
      if (node) node.value = val == null ? "" : String(val);
    };
    set("item_id", data.id || "");
    set("person_id", data.person_id || "");
    if (data.branch_key) set("branch", data.branch_key);
    set("ui_kind", uiKindFromMemoryKind(data.memory_kind));
    set("person_name", data.display_name || data.person_name || "");
    set("person_lineage", data.person_lineage || "");
    set("title", data.title || "");
    set("description", data.description || "");
    set("story_text", data.story_text || "");
    set("memory_date", data.memory_date || "");
    set("memory_year", data.memory_year || "");
    if (opts.refreshKindUi) opts.refreshKindUi();
  }

  function resetFormFields(root, keepPerson, mode) {
    var keepKeys =
      mode === "delegate" || mode === "public"
        ? ["submitted_by_name", "submitted_by_phone", "submitted_by_relation", "branch"]
        : ["branch"];
    if (keepPerson) keepKeys.push("person_name", "person_id", "person_lineage");

    root.querySelectorAll("[data-f]").forEach(function (el) {
      var key = el.getAttribute("data-f");
      if (keepKeys.indexOf(key) >= 0) return;
      if (el.type === "file") el.value = "";
      else el.value = "";
    });
  }

  function setAlert(root, kind, message) {
    var box = root.querySelector("[data-memory-submit-alert]");
    if (!box) return;
    box.className = "memory-submit-alert";
    if (!message) {
      box.style.display = "none";
      box.textContent = "";
      box.removeAttribute("role");
      return;
    }
    box.classList.add(kind === "success" ? "is-success" : "is-error");
    box.textContent = message;
    box.setAttribute("role", "alert");
    box.style.display = "block";
    try {
      box.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (e) {
      box.scrollIntoView(false);
    }
  }

  function updateFileUi(root) {
    var uiKind = root.querySelector('[data-f="ui_kind"]');
    var fileWrap = root.querySelector("[data-file-wrap]");
    var fileInput = root.querySelector('[data-f="media_file"]');
    var fileHint = root.querySelector("[data-file-hint]");
    if (!uiKind || !fileWrap || !fileInput) return;
    var kind = uiKind.value || "image";
    var needsFile = requiresFile(kind);
    fileWrap.style.display = needsFile ? "block" : "none";
    fileInput.accept = acceptForKind(kind);
    if (fileHint && !fileInput.files.length) {
      fileHint.textContent = needsFile ? "لم يُختَر ملف بعد — الحد الأقصى 50MB" : "";
    }
  }

  function clearTreeResults(root) {
    var list = root.querySelector("[data-memory-tree-results]");
    if (!list) return;
    list.innerHTML = "";
    list.style.display = "none";
  }

  function renderSearchResults(root, rows, query, state, callbacks) {
    var list = root.querySelector("[data-memory-tree-results]");
    if (!list) return;
    list.innerHTML = "";
    var hasAny = false;
    var branchEl = root.querySelector('[data-f="branch"]');
    var branch = branchEl ? text(branchEl.value) : "";

    if (query.length >= 2) {
      hasAny = true;
      var useBtn = document.createElement("button");
      useBtn.type = "button";
      useBtn.innerHTML = "<strong>استخدام: " + query + "</strong>";
      useBtn.addEventListener("click", function () {
        state.personId = "";
        state.personLineage = "";
        var nameInput = root.querySelector('[data-f="person_name"]');
        if (nameInput) nameInput.value = query;
        clearTreeResults(root);
        if (callbacks.onPersonPick) callbacks.onPersonPick();
      });
      list.appendChild(useBtn);
    }

    (rows || []).forEach(function (row) {
      hasAny = true;
      var lineage = row.person_lineage || row.full_name || row.person_name || "";
      var displayName = row.display_name || text(lineage.split("/").pop()) || lineage || "-";
      var chain = formatLineage(lineage);
      var btn = document.createElement("button");
      btn.type = "button";
      btn.innerHTML = "<strong>" + displayName + "</strong><br><small>" + (chain || row.branch_key || "") + "</small>";
      btn.addEventListener("click", function () {
        state.personId = text(row.person_id);
        state.personLineage = text(lineage);
        var nameInput = root.querySelector('[data-f="person_name"]');
        var lineageInput = root.querySelector('[data-f="person_lineage"]');
        var pidInput = root.querySelector('[data-f="person_id"]');
        if (nameInput) nameInput.value = displayName;
        if (lineageInput) lineageInput.value = lineage;
        if (pidInput) pidInput.value = state.personId;
        if (branchEl && row.branch_key) branchEl.value = row.branch_key;
        clearTreeResults(root);
        if (callbacks.onPersonPick) callbacks.onPersonPick();
      });
      list.appendChild(btn);
    });

    if (!hasAny) {
      list.innerHTML = '<div class="hint" style="padding:10px">اكتب الاسم ثم اختره أو استخدمه مباشرة.</div>';
    }
    list.style.display = "block";
  }

  async function searchPersonInTree(root, q, state, callbacks) {
    q = text(q);
    if (q.length < 2) {
      clearTreeResults(root);
      return;
    }
    var client = getClient();
    var rows = [];
    var branchEl = root.querySelector('[data-f="branch"]');
    var branch = branchEl ? text(branchEl.value) : "";

    if (client) {
      var rpc = await client.rpc("memory_tree_search_v1", {
        p_query: q,
        p_branch_key: branch || null,
        p_limit: 8
      });
      if (!rpc.error && rpc.data) {
        rows = typeof rpc.data === "string" ? JSON.parse(rpc.data) : rpc.data;
        if (!Array.isArray(rows)) rows = [];
      } else {
        var fb = client
          .from("tree_children")
          .select("person_id,branch_key,child_name,name")
          .or("child_name.ilike.%" + q + "%,name.ilike.%" + q + "%")
          .limit(8);
        if (branch) fb = fb.eq("branch_key", branch);
        var fbRes = await fb;
        if (!fbRes.error && Array.isArray(fbRes.data)) {
          rows = fbRes.data.map(function (r) {
            var lineage = text(r.child_name) || text(r.name);
            return {
              person_id: r.person_id,
              full_name: lineage,
              display_name: text(lineage.split("/").pop()) || lineage,
              person_lineage: lineage,
              branch_key: r.branch_key
            };
          });
        }
      }
    }
    renderSearchResults(root, rows, q, state, callbacks);
  }

  function mount(options) {
    var opts = options || {};
    var root = typeof opts.root === "string" ? document.querySelector(opts.root) : opts.root;
    if (!root) return null;

    var mode = opts.mode === "admin" ? "admin" : opts.mode === "delegate" ? "delegate" : "public";
    var branch = text(opts.branch) || "زيدان";
    var submitterName = text(opts.submitterName);
    var submitterPhone = text(opts.submitterPhone);
    var state = { personId: "", personLineage: "", searchTimer: null };
    var callbacks = {
      onPersonPick: typeof opts.onPersonPick === "function" ? opts.onPersonPick : null,
      onSaved: typeof opts.onSaved === "function" ? opts.onSaved : null
    };

    var titles = {
      admin: "إضافة ذكرى — الإدارة",
      delegate: "إرسال ذكرى للفرع",
      public: "أرسل ذكرى للعائلة"
    };
    var subtitles = {
      admin: "نفس نموذج المندوب — يُحفظ معتمداً. التوقيع: تم الإرسال من الإدارة.",
      delegate: "نفس نموذج الإرسال — التوقيع: اسم المندوب + جواله. تُراجع قبل النشر.",
      public: "ارفع صورة أو فيديو أو صوت — يُراجع قبل النشر في «من الذاكرة»."
    };
    var notes = {
      admin: "✍️ التوقيع تلقائي: تم الإرسال من الإدارة",
      delegate: "✍️ التوقيع: اسم المندوب + رقم جواله",
      public: "تُراجع كل الذكريات من الإدارة قبل النشر في الأرشيف العام."
    };
    var btnLabels = {
      admin: "حفظ في القاعدة",
      delegate: "إرسال للمراجعة",
      public: "إرسال للمراجعة"
    };

    var showTreeSearch = mode === "admin" || mode === "delegate" || mode === "public";
    var personField =
      showTreeSearch
        ? '<div class="memory-submit-field memory-submit-field-full">' +
          '<label>اسم الشخص</label>' +
          '<input data-f="person_name" type="text" placeholder="ابحث في الشجرة أو اكتب الاسم" autocomplete="off" />' +
          '<div data-memory-tree-results class="memory-tree-results"></div>' +
          '<input data-f="person_id" type="hidden" />' +
          "</div>"
        : '<div class="memory-submit-field"><label>اسم الشخص</label><input data-f="person_name" type="text" placeholder="اسم صاحب الذكرى" /></div>';

    var submitterFields = "";
    if (mode === "delegate" || mode === "public") {
      submitterFields =
        '<div class="memory-submit-field"><label>' +
        (mode === "delegate" ? "اسم المندوب" : "اسم المرسل") +
        '</label><input data-f="submitted_by_name" type="text" value="' +
        submitterName.replace(/"/g, "&quot;") +
        '" placeholder="' +
        (mode === "delegate" ? "اسم المندوب" : "اسمك") +
        '" /></div>' +
        '<div class="memory-submit-field"><label>' +
        (mode === "delegate" ? "جوال المندوب" : "جوال المرسل") +
        '</label><input data-f="submitted_by_phone" type="tel" inputmode="tel" dir="ltr" value="' +
        submitterPhone.replace(/"/g, "&quot;") +
        '" placeholder="05xxxxxxxx" /><div class="memory-submit-field-hint">يمكنك كتابة الجوال بالأرقام العربية أو الإنجليزية</div></div>' +
        (mode === "public"
          ? '<div class="memory-submit-field"><label>الصفة</label><input data-f="submitted_by_relation" type="text" placeholder="ابن/ابنة..." /></div>'
          : "");
    }

    root.innerHTML =
      '<div class="memory-submit-card">' +
      '<input data-f="item_id" type="hidden" />' +
      '<div class="memory-submit-header">' +
      '<span class="memory-submit-header-icon" aria-hidden="true">' +
      (mode === "admin" ? "🛡️" : "✉️") +
      "</span><div>" +
      "<h2>" +
      titles[mode] +
      "</h2><p>" +
      subtitles[mode] +
      "</p></div></div>" +
      '<div class="memory-submit-grid">' +
      '<div class="memory-submit-field"><label>الفرع</label><select data-f="branch"' +
      (mode === "delegate" ? " disabled" : "") +
      ">" +
      branchOptions(branch) +
      "</select></div>" +
      '<div class="memory-submit-field"><label>نوع الذكرى</label><select data-f="ui_kind">' +
      kindOptions() +
      "</select></div>" +
      personField +
      '<div class="memory-submit-field"><label>مسار/نسب (اختياري)</label><input data-f="person_lineage" type="text" placeholder="يُعبّأ تلقائياً من الشجرة أو اكتب يدوياً" /></div>' +
      '<div class="memory-submit-field memory-submit-field-full"><label>عنوان الذكرى</label><input data-f="title" type="text" placeholder="عنوان مختصر" /></div>' +
      '<div class="memory-submit-field memory-submit-field-full"><label>وصف مختصر</label><textarea data-f="description" placeholder="وصف اختياري"></textarea></div>' +
      '<div class="memory-submit-field memory-submit-field-full" data-story-wrap style="display:none"><label>نص القصة</label><textarea data-f="story_text" placeholder="اكتب القصة هنا"></textarea></div>' +
      '<div class="memory-submit-field"><label>تاريخ/وصف زمني</label><input data-f="memory_date" type="text" placeholder="مثال: ١٤٠٠/٠٣/١٠" /></div>' +
      '<div class="memory-submit-field"><label>السنة (اختياري)</label><input data-f="memory_year" type="text" placeholder="مثال: ١٩٨٥" /></div>' +
      '<div class="memory-submit-field memory-submit-field-full" data-file-wrap><label data-file-label>الملف</label><div class="memory-file-zone"><input data-f="media_file" type="file" /><div class="hint" data-file-hint>لم يُختَر ملف بعد — الحد الأقصى 50MB</div></div></div>' +
      submitterFields +
      "</div>" +
      '<div data-memory-submit-alert class="memory-submit-alert" aria-live="polite"></div>' +
      '<div class="memory-submit-actions">' +
      (mode === "admin"
        ? '<button type="button" class="btn btn-outline" data-memory-reset-btn>مادة جديدة</button>'
        : "") +
      '<button type="button" class="btn btn-primary" data-memory-submit-btn>' +
      btnLabels[mode] +
      "</button></div>" +
      '<p class="memory-submit-note">' +
      notes[mode] +
      "</p></div>";

    var uiKind = root.querySelector('[data-f="ui_kind"]');
    var storyWrap = root.querySelector("[data-story-wrap]");
    var fileInput = root.querySelector('[data-f="media_file"]');
    var fileHint = root.querySelector("[data-file-hint]");
    var fileLabel = root.querySelector("[data-file-label]");
    var personInput = root.querySelector('[data-f="person_name"]');
    var branchSelect = root.querySelector('[data-f="branch"]');

    function refreshKindUi() {
      if (storyWrap && uiKind) {
        storyWrap.style.display = uiKind.value === "story" ? "block" : "none";
      }
      if (fileLabel && uiKind) {
        var k = uiKind.value;
        fileLabel.textContent =
          k === "video" ? "ملف الفيديو" : k === "audio" ? "ملف الصوت" : k === "document" ? "الوثيقة" : "الصورة";
      }
      updateFileUi(root);
    }

    if (uiKind) uiKind.addEventListener("change", refreshKindUi);
    if (fileInput && fileHint) {
      fileInput.addEventListener("change", function () {
        var f = fileInput.files && fileInput.files[0];
        fileHint.textContent = f ? "✓ تم اختيار: " + f.name : "لم يُختَر ملف بعد — الحد الأقصى 50MB";
      });
    }

    if (personInput && showTreeSearch) {
      personInput.addEventListener("input", function () {
        clearTimeout(state.searchTimer);
        state.searchTimer = setTimeout(function () {
          searchPersonInTree(root, personInput.value, state, callbacks).catch(function () {});
        }, 300);
      });
    }

    if (branchSelect && showTreeSearch) {
      branchSelect.addEventListener("change", function () {
        if (personInput && text(personInput.value).length >= 2) {
          searchPersonInTree(root, personInput.value, state, callbacks).catch(function () {});
        } else {
          clearTreeResults(root);
        }
      });
    }

    refreshKindUi();

    var resetBtn = root.querySelector("[data-memory-reset-btn]");
    if (resetBtn) {
      resetBtn.addEventListener("click", function () {
        resetFormFields(root, true, mode);
        state.personId = "";
        state.personLineage = "";
        setAlert(root, "success", "جاهز لإضافة مادة جديدة.");
        if (callbacks.onPersonPick) callbacks.onPersonPick();
      });
    }

    var btn = root.querySelector("[data-memory-submit-btn]");
    if (btn) {
      btn.addEventListener("click", async function () {
        setAlert(root, "error", "");
        btn.disabled = true;
        btn.textContent = mode === "admin" ? "جاري الحفظ..." : "جاري الرفع...";
        try {
          var form = readForm(root);
          var pickedFile = fileInput && fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
          var raw = {
            _mode: mode,
            item_id: form.item_id,
            person_id: form.person_id || state.personId || null,
            branch_key: mode === "delegate" ? branch : form.branch_key,
            ui_kind: form.ui_kind,
            person_name: form.person_name,
            person_lineage: form.person_lineage || state.personLineage || null,
            title: form.title,
            description: form.description,
            story_text: form.story_text,
            memory_date: form.memory_date,
            memory_year: form.memory_year,
            submitted_by_name: form.submitted_by_name,
            submitted_by_phone: form.submitted_by_phone,
            submitted_by_relation: mode === "delegate" ? "delegate" : form.submitted_by_relation || "public"
          };

          var result =
            mode === "admin" ? await submitAdminMemory(raw, pickedFile) : await submitMemory(raw, pickedFile);

          var successMsg =
            mode === "admin"
              ? "✓ تم الحفظ — التوقيع: تم الإرسال من الإدارة."
              : mode === "delegate"
                ? "✓ تم الإرسال — التوقيع: اسم المندوب + جواله. ستُراجع من الإدارة."
                : "تم رفع الذكرى بنجاح. ستُراجع من الإدارة قبل النشر.";

          setAlert(root, "success", successMsg);

          if (mode === "admin") {
            var idNode = root.querySelector('[data-f="item_id"]');
            if (idNode && result.id != null) idNode.value = String(result.id);
            if (fileInput) fileInput.value = "";
            if (fileHint) fileHint.textContent = "لم يُختَر ملف بعد — الحد الأقصى 50MB";
          } else {
            resetFormFields(root, false, mode);
            if (mode === "delegate") {
              var nameNode = root.querySelector('[data-f="submitted_by_name"]');
              var phoneNode = root.querySelector('[data-f="submitted_by_phone"]');
              if (nameNode) nameNode.value = submitterName;
              if (phoneNode) phoneNode.value = submitterPhone;
            }
            if (fileInput) fileInput.value = "";
            if (fileHint) fileHint.textContent = "لم يُختَر ملف بعد — الحد الأقصى 50MB";
          }

          if (callbacks.onSaved) callbacks.onSaved(result);
        } catch (err) {
          setAlert(root, "error", err && err.message ? err.message : "تعذر الإرسال.");
        } finally {
          btn.disabled = false;
          btn.textContent = btnLabels[mode];
        }
      });
    }

    root.__memorySubmitState = state;
    root.__memorySubmitRefreshKind = refreshKindUi;
    return root;
  }

  function populate(root, item) {
    if (!root || !item) return;
    writeForm(root, item, { refreshKindUi: root.__memorySubmitRefreshKind });
    if (root.__memorySubmitState) {
      root.__memorySubmitState.personId = text(item.person_id);
      root.__memorySubmitState.personLineage = text(item.person_lineage);
    }
  }

  global.AlzidanMemorySubmit = {
    submitMemory: submitMemory,
    submitAdminMemory: submitAdminMemory,
    mount: mount,
    populate: populate,
    readForm: readForm,
    getAdminToken: getAdminToken
  };

  function autoMountPublicForm() {
    var el = document.getElementById("memory-submit-root");
    if (!el || el.getAttribute("data-memory-mounted") === "1") return;
    var mode = text(el.getAttribute("data-mode"));
    if (mode !== "public") return;
    mount({
      root: el,
      mode: "public",
      branch: text(el.getAttribute("data-branch")) || "زيدان",
      submitterName: text(el.getAttribute("data-submitter-name")),
      submitterPhone: text(el.getAttribute("data-submitter-phone"))
    });
    el.setAttribute("data-memory-mounted", "1");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoMountPublicForm);
  } else {
    autoMountPublicForm();
  }
})(window);
