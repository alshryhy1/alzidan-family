(function () {
  "use strict";

  var submitRoot = null;

  var KIND_LABELS = {
    image: "صورة",
    video: "فيديو",
    audio: "صوت",
    story: "قصة",
    document: "وثيقة"
  };

  function el(id) {
    return document.getElementById(id);
  }

  function text(v) {
    return String(v || "").replace(/\s+/g, " ").trim();
  }

  function getClient() {
    if (window.__alzidanConfig && typeof window.__alzidanConfig.getClient === "function") {
      return window.__alzidanConfig.getClient();
    }
    return window.__alzidanSupabaseClient || null;
  }

  function getAdminToken() {
    if (window.AlzidanMemorySubmit && typeof window.AlzidanMemorySubmit.getAdminToken === "function") {
      return window.AlzidanMemorySubmit.getAdminToken();
    }
    return "";
  }

  function setStatus(message, isError) {
    var box = el("memory-status");
    if (!box) return;
    box.textContent = message || "";
    box.className = isError ? "is-error" : "";
  }

  function updateAuthHint() {
    var box = el("memory-auth-hint");
    if (!box) return;
    box.textContent = getAdminToken()
      ? "✓ مسجل الدخول — الحفظ مباشرة. التوقيع: تم الإرسال من الإدارة."
      : "⚠ سجّل الدخول من لوحة الإدارة أولاً ثم عد لهذه الصفحة.";
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

  async function loadItems() {
    var list = el("memory-items-list");
    if (!list || !submitRoot) return;

    var form =
      window.AlzidanMemorySubmit && typeof window.AlzidanMemorySubmit.readForm === "function"
        ? window.AlzidanMemorySubmit.readForm(submitRoot)
        : {};
    var personName = text(form.person_name);
    var branch = text(form.branch_key);
    var token = getAdminToken();
    var client = getClient();

    if (!personName) {
      list.innerHTML = '<p class="hint">اكتب اسم الشخص لعرض مواده.</p>';
      return;
    }

    if (!token || !client) {
      list.innerHTML = '<p class="hint">سجّل الدخول من لوحة الإدارة لعرض المواد.</p>';
      return;
    }

    var res = await client.rpc("memory_admin_list_person_v1", {
      p_token: token,
      p_person_id: form.person_id || null,
      p_person_name: personName,
      p_branch_key: branch || null,
      p_limit: 50
    });

    if (res.error) {
      list.innerHTML = '<p class="hint">تعذر التحميل — نفّذ family_memory_DEPLOY_ALL.sql على Supabase.</p>';
      return;
    }

    var items = res.data;
    if (typeof items === "string") {
      try {
        items = JSON.parse(items);
      } catch (e) {
        items = [];
      }
    }
    if (!Array.isArray(items) || !items.length) {
      list.innerHTML = '<p class="hint">لا توجد مواد لهذا الشخص بعد.</p>';
      return;
    }

    list.innerHTML = "";
    items.forEach(function (it) {
      var row = document.createElement("div");
      row.className = "memory-item-row";
      var kindKey = uiKindFromMemoryKind(it.memory_kind);
      var source =
        window.AlzidanMemorySource && typeof window.AlzidanMemorySource.format === "function"
          ? window.AlzidanMemorySource.format(it)
          : "تم الإرسال من الإدارة";

      row.innerHTML =
        "<h4>" +
        (it.title || "بدون عنوان") +
        "</h4>" +
        "<p>" +
        (KIND_LABELS[kindKey] || it.memory_kind) +
        " • " +
        (it.status || "") +
        "</p>" +
        "<p class='hint' style='margin-top:4px'>" +
        source +
        "</p>";

      var actions = document.createElement("div");
      actions.className = "memory-item-actions";

      var editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.textContent = "تعديل";
      editBtn.addEventListener("click", function () {
        fillForm(it);
      });

      actions.appendChild(editBtn);
      row.appendChild(actions);
      list.appendChild(row);
    });
  }

  function fillForm(item) {
    if (!submitRoot || !window.AlzidanMemorySubmit) return;
    window.AlzidanMemorySubmit.populate(submitRoot, item);
    setStatus("تم تحميل المادة للتعديل.", false);
  }

  async function deleteMemory() {
    if (!submitRoot || !window.AlzidanMemorySubmit) return;
    var form = window.AlzidanMemorySubmit.readForm(submitRoot);
    var id = text(form.item_id);
    var token = getAdminToken();
    var client = getClient();

    if (!id) {
      setStatus("اختر مادة للحذف (اضغط تعديل من القائمة).", true);
      return;
    }
    if (!token || !client) {
      setStatus("سجّل الدخول أولاً.", true);
      return;
    }
    if (!window.confirm("حذف هذه الذكرى نهائياً؟")) return;

    var res = await client.rpc("memory_admin_delete_item_v1", {
      p_token: token,
      p_id: Number(id)
    });

    if (res.error) {
      setStatus("تعذر الحذف.", true);
      return;
    }

    window.AlzidanMemorySubmit.populate(submitRoot, {
      branch_key: form.branch_key,
      person_name: form.person_name,
      person_id: form.person_id,
      person_lineage: form.person_lineage
    });
    var idNode = submitRoot.querySelector('[data-f="item_id"]');
    if (idNode) idNode.value = "";
    await loadItems();
    setStatus("تم الحذف.", false);
  }

  function mountForm() {
    if (!window.AlzidanMemorySubmit) return;
    submitRoot = window.AlzidanMemorySubmit.mount({
      root: "#memory-submit-root",
      mode: "admin",
      onPersonPick: function () {
        loadItems().catch(function () {});
      },
      onSaved: function () {
        loadItems().catch(function () {});
      }
    });
  }

  function bindEvents() {
    if (el("memory-delete")) {
      el("memory-delete").addEventListener("click", function () {
        deleteMemory().catch(function () {});
      });
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    mountForm();
    bindEvents();
    updateAuthHint();
    setStatus(getAdminToken() ? "جاهز — نفس منطق المندوب، التوقيع من الإدارة." : "سجّل الدخول من لوحة الإدارة أولاً.", !getAdminToken());
  });
})();
