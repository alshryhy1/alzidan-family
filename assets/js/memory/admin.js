(function () {
  "use strict";

  var sb = null;
  var searchTimer = null;
  var selectedPerson = null;
  var localPeople = [];
  var localItems = [];
  var localMedia = [];
  var localExtraPeople = [];

  function el(id) {
    return document.getElementById(id);
  }

  function getClient() {
    if (sb) return sb;

    if (window.__alzidanConfig && typeof window.__alzidanConfig.getClient === "function") {
      sb = window.__alzidanConfig.getClient();
      return sb;
    }

    if (window.__alzidanالخدمةClient) {
      sb = window.__alzidanالخدمةClient;
      return sb;
    }

    return null;
  }

  function text(v) {
    return String(v || "").replace(/\s+/g, " ").trim();
  }

  function num(v, fallback) {
    var n = Number(v);
    return Number.isFinite(n) ? n : (fallback || 0);
  }

  function personKey(p) {
    var pid = text(p && p.person_id);
    var name = text(p && p.person_name).toLowerCase();
    return pid ? ("id:" + pid) : ("name:" + name);
  }

  function setStatus(targetId, message, isError) {
    var node = el(targetId);
    if (!node) return;
    node.textContent = String(message || "");
    node.style.color = isError ? "#991b1b" : "#065f46";
  }

  function setSourceHint() {
    var type = text(el("memory-source-type") && el("memory-source-type").value);
    var hint = el("memory-source-hint");
    if (!hint) return;

    if (type === "delegate") {
      hint.textContent = "مصدر مندوب: الاسم والجوال إلزاميان في مرحلة الحفظ الفعلي.";
      hint.style.color = "#92400e";
      return;
    }

    hint.textContent = "مصدر إدارة: يمكن إبقاء الاسم والجوال فارغين أو تعبئتهما حسب السياسة.";
    hint.style.color = "#1d4ed8";
  }

  function updateStoryTextState() {
    var kind = text(el("memory-item-type") && el("memory-item-type").value);
    var story = el("memory-item-story-text");
    if (!story) return;

    var isStory = kind === "story";
    story.disabled = !isStory;
    if (!isStory) story.value = "";
  }

  function updateSelectedPersonSummary() {
    var summary = el("memory-selected-person-summary");
    if (!summary) return;

    if (!selectedPerson) {
      summary.textContent = "لم يتم اختيار شخص بعد.";
      return;
    }

    var parts = [
      selectedPerson.person_name || "-",
      selectedPerson.branch_key ? ("الفرع: " + selectedPerson.branch_key) : "الفرع: غير محدد",
      selectedPerson.person_id ? ("المعرف: " + selectedPerson.person_id) : "المعرف: غير متوفر"
    ];

    summary.textContent = parts.join(" | ");
  }

  function clearTreeResults() {
    var list = el("memory-tree-results");
    if (!list) return;
    list.innerHTML = "";
    list.style.display = "none";
  }

  function choosePersonFromSearch(p) {
    selectedPerson = {
      person_id: text(p && p.person_id),
      person_name: text(p && p.person_name),
      branch_key: text(p && p.branch_key),
      person_lineage: text(p && p.person_lineage)
    };

    addOrUpdateLocalPerson(selectedPerson);
    renderPeople();
    syncPersonFields();
    updateSelectedPersonSummary();
    syncPersonSelect();
    clearTreeResults();

    loadItemsForSelectedPerson().catch(function (err) {
      console.error(err);
      setStatus("memory-item-status", "تعذر تحميل مواد الشخصية.", true);
    });

    setStatus("memory-admin-status", "تم اختيار الشخص من نتائج الشجرة عبر RPC.", false);
  }

  async function searchTreeRpc(q) {
    var list = el("memory-tree-results");
    if (!list) return;

    q = text(q);
    if (q.length < 2) {
      clearTreeResults();
      return;
    }

    var client = getClient();
    if (!client) {
      setStatus("memory-admin-status", "تعذر تهيئة عميل Supabase للبحث.", true);
      return;
    }

    var result = await client.rpc("memory_tree_search_v1", {
      p_query: q,
      p_limit: 10
    });

    if (result.error) {
      console.error(result.error);
      setStatus("memory-admin-status", "تعذر البحث في الشجرة حاليًا.", true);
      list.innerHTML = "<div class=\"hint\" style=\"padding:10px\">حدث خطأ أثناء البحث.</div>";
      list.style.display = "block";
      return;
    }

    var rows = Array.isArray(result.data) ? result.data : [];

    if (!rows.length) {
      list.innerHTML = "<div class=\"hint\" style=\"padding:10px\">لا توجد نتائج مطابقة.</div>";
      list.style.display = "block";
      return;
    }

    list.innerHTML = "";

    rows.forEach(function (row) {
      var p = {
        person_id: text(row.person_id),
        person_name: text(row.full_name),
        branch_key: text(row.branch_key),
        person_lineage: text(row.full_name)
      };

      var item = document.createElement("button");
      item.type = "button";
      item.className = "source-tree-item";
      item.innerHTML =
        "<strong>" + (p.person_name || "-") + "</strong><br>" +
        "<small>" + (p.branch_key || "غير محدد") + (row.birth_year ? " • " + String(row.birth_year) : "") + "</small>";

      item.addEventListener("click", function () {
        choosePersonFromSearch(p);
      });

      list.appendChild(item);
    });

    list.style.display = "block";
  }

  function addOrUpdateLocalPerson(p) {
    if (!p || !text(p.person_name)) return;

    var key = personKey(p);
    var found = false;

    localPeople = localPeople.map(function (x) {
      if (personKey(x) !== key) return x;
      found = true;
      return {
        person_id: text(p.person_id) || text(x.person_id),
        person_name: text(p.person_name) || text(x.person_name),
        branch_key: text(p.branch_key) || text(x.branch_key),
        person_lineage: text(p.person_lineage) || text(x.person_lineage)
      };
    });

    if (!found) {
      localPeople.push({
        person_id: text(p.person_id),
        person_name: text(p.person_name),
        branch_key: text(p.branch_key),
        person_lineage: text(p.person_lineage)
      });
    }

    localPeople.sort(function (a, b) {
      return text(a.person_name).localeCompare(text(b.person_name), "ar");
    });
  }

  function renderPeople() {
    var list = el("memory-list");
    var select = el("memory-item-profile");

    if (!list) return;

    if (!localPeople.length) {
      list.innerHTML = "لا توجد شخصيات معتمدة محليًا حتى الآن.";
      if (select) select.innerHTML = '<option value="">اختر شخصية أولاً</option>';
      return;
    }

    list.innerHTML = "";
    if (select) select.innerHTML = '<option value="">اختر شخصية أولاً</option>';

    localPeople.forEach(function (p) {
      var key = personKey(p);
      var card = document.createElement("div");
      card.className = "memory-list-card";
      card.innerHTML =
        "<h4>" + (p.person_name || "-") + "</h4>" +
        "<p>" + (p.branch_key || "غير محدد") + "</p>";

      var actions = document.createElement("div");
      actions.className = "memory-list-actions";

      var pick = document.createElement("button");
      pick.type = "button";
      pick.textContent = "اختيار";
      pick.addEventListener("click", function () {
        selectedPerson = {
          person_id: text(p.person_id),
          person_name: text(p.person_name),
          branch_key: text(p.branch_key),
          person_lineage: text(p.person_lineage)
        };
        syncPersonFields();
        updateSelectedPersonSummary();
        syncPersonSelect();
        setStatus("memory-admin-status", "تم اختيار الشخصية من القائمة المحلية.", false);
      });

      actions.appendChild(pick);
      card.appendChild(actions);
      list.appendChild(card);

      if (select) {
        var opt = document.createElement("option");
        opt.value = key;
        opt.textContent = p.person_name || "-";
        select.appendChild(opt);
      }
    });

    syncPersonSelect();
  }

  function syncPersonFields() {
    var p = selectedPerson || {};
    var hidden = el("memory-profile-id");
    var personId = el("memory-person-id");
    var personName = el("memory-person-name");
    var branch = el("memory-person-branch");
    var lineage = el("memory-person-lineage");

    if (hidden) hidden.value = selectedPerson ? personKey(selectedPerson) : "";
    if (personId) personId.value = p.person_id || "";
    if (personName) personName.value = p.person_name || "";
    if (branch) branch.value = p.branch_key || "";
    if (lineage) lineage.value = p.person_lineage || "";
  }

  function syncPersonSelect() {
    var select = el("memory-item-profile");
    if (!select) return;

    if (!selectedPerson) {
      select.value = "";
      return;
    }

    select.value = personKey(selectedPerson);
  }

  function clearPersonForm() {
    selectedPerson = null;
    syncPersonFields();
    clearTreeResults();
    updateSelectedPersonSummary();
    syncPersonSelect();
    setStatus("memory-admin-status", "تم تفريغ نموذج اختيار الشخص.", false);
  }

  function saveSelectedPersonLocal() {
    var p = {
      person_id: text(el("memory-person-id") && el("memory-person-id").value),
      person_name: text(el("memory-person-name") && el("memory-person-name").value),
      branch_key: text(el("memory-person-branch") && el("memory-person-branch").value),
      person_lineage: text(el("memory-person-lineage") && el("memory-person-lineage").value)
    };

    if (!p.person_name) {
      setStatus("memory-admin-status", "الاسم مطلوب لاعتماد الشخص.", true);
      return;
    }

    selectedPerson = p;
    addOrUpdateLocalPerson(p);
    renderPeople();
    updateSelectedPersonSummary();

    loadItemsForSelectedPerson().catch(function (err) {
      console.error(err);
      setStatus("memory-item-status", "تعذر تحميل مواد الشخصية.", true);
    });

    setStatus("memory-admin-status", "تم اعتماد الشخص محليًا لمرحلة التصميم.", false);
  }

  function resetMediaFields() {
    var ids = [
      "memory-media-url",
      "memory-media-thumbnail",
      "memory-media-caption"
    ];

    ids.forEach(function (id) {
      var node = el(id);
      if (node) node.value = "";
    });

    var t = el("memory-media-type");
    if (t) t.value = "image";

    var o = el("memory-media-order");
    if (o) o.value = "0";
  }

  function renderMediaList() {
    var list = el("memory-media-list");
    if (!list) return;

    if (!localMedia.length) {
      list.innerHTML = "<div class=\"hint\">لا توجد وسائط مضافة بعد.</div>";
      return;
    }

    list.innerHTML = "";

    localMedia.forEach(function (m, idx) {
      var row = document.createElement("div");
      row.className = "memory-list-card";
      row.innerHTML =
        "<h4>" + (m.media_type || "-") + " | ترتيب: " + String(m.display_order || 0) + "</h4>" +
        "<p>" + (m.media_url || "") + (m._db_id ? " | محفوظ" : " | محلي") + "</p>";

      var actions = document.createElement("div");
      actions.className = "memory-list-actions";

      var del = document.createElement("button");
      del.type = "button";
      del.textContent = "حذف";
      del.addEventListener("click", function () {
        deleteMediaAtIndex(idx).catch(function (err) {
          console.error(err);
          setStatus("memory-item-status", "حدث خطأ غير متوقع أثناء حذف الوسيط.", true);
        });
      });

      actions.appendChild(del);
      row.appendChild(actions);
      list.appendChild(row);
    });
  }

  function addMediaLocal() {
    var row = {
      _db_id: null,
      media_type: text(el("memory-media-type") && el("memory-media-type").value) || "image",
      media_url: text(el("memory-media-url") && el("memory-media-url").value),
      thumbnail_url: text(el("memory-media-thumbnail") && el("memory-media-thumbnail").value) || null,
      caption: text(el("memory-media-caption") && el("memory-media-caption").value) || null,
      display_order: num(el("memory-media-order") && el("memory-media-order").value, 0)
    };

    if (!row.media_url) {
      setStatus("memory-item-status", "رابط الوسيط مطلوب قبل إضافته للقائمة.", true);
      return;
    }

    localMedia.push(row);
    localMedia.sort(function (a, b) { return num(a.display_order, 0) - num(b.display_order, 0); });
    renderMediaList();
    resetMediaFields();
    setStatus("memory-item-status", "تمت إضافة وسيط للقائمة المحلية.", false);
  }

  async function loadMediaForItem(memoryId) {
    var client = getClient();
    if (!client || !memoryId) {
      localMedia = [];
      renderMediaList();
      return;
    }

    var res = await client
      .from("family_memory_media")
      .select("id,memory_id,media_type,media_url,thumbnail_url,caption,display_order,created_at")
      .eq("memory_id", memoryId)
      .order("display_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (res.error) {
      console.error(res.error);
      setStatus("memory-item-status", "تعذر تحميل الوسائط للمادة (تحقق من RLS).", true);
      return;
    }

    localMedia = (Array.isArray(res.data) ? res.data : []).map(function (m) {
      return {
        _db_id: m.id,
        media_type: m.media_type,
        media_url: m.media_url,
        thumbnail_url: m.thumbnail_url,
        caption: m.caption,
        display_order: num(m.display_order, 0)
      };
    });

    renderMediaList();
  }

  async function syncMediaForItem(memoryId) {
    var client = getClient();
    if (!client || !memoryId) return false;

    var existingRes = await client
      .from("family_memory_media")
      .select("id,display_order")
      .eq("memory_id", memoryId);

    if (existingRes.error) {
      console.error(existingRes.error);
      setStatus("memory-item-status", "تعذر قراءة وسائط المادة قبل المزامنة (تحقق من RLS).", true);
      return false;
    }

    var existing = Array.isArray(existingRes.data) ? existingRes.data : [];
    var existingByOrder = {};
    existing.forEach(function (r) {
      var k = String(num(r.display_order, 0));
      if (!existingByOrder[k]) existingByOrder[k] = [];
      existingByOrder[k].push(r);
    });

    var keptIds = {};

    for (var i = 0; i < localMedia.length; i += 1) {
      var m = localMedia[i] || {};
      var payload = {
        memory_id: memoryId,
        media_type: text(m.media_type) || "image",
        media_url: text(m.media_url),
        thumbnail_url: text(m.thumbnail_url) || null,
        caption: text(m.caption) || null,
        display_order: num(m.display_order, 0)
      };

      if (!payload.media_url) continue;

      var upRes;
      var targetId = text(m._db_id);

      if (!targetId) {
        var bucketKey = String(payload.display_order);
        var bucket = existingByOrder[bucketKey] || [];
        while (bucket.length && keptIds[String(bucket[0].id)]) {
          bucket.shift();
        }
        if (bucket.length) {
          targetId = String(bucket[0].id);
        }
      }

      if (targetId) {
        upRes = await client
          .from("family_memory_media")
          .update(payload)
          .eq("id", targetId)
          .select("id")
          .single();
      } else {
        payload.created_at = new Date().toISOString();
        upRes = await client
          .from("family_memory_media")
          .insert(payload)
          .select("id")
          .single();
      }

      if (upRes.error || !upRes.data || !upRes.data.id) {
        console.error(upRes.error || upRes);
        setStatus("memory-item-status", "تعذر حفظ بعض الوسائط في family_memory_media (تحقق من RLS).", true);
        return false;
      }

      var savedId = String(upRes.data.id);
      keptIds[savedId] = true;
      localMedia[i]._db_id = savedId;
    }

    var staleIds = existing
      .map(function (r) { return String(r.id); })
      .filter(function (id) { return !keptIds[id]; });

    if (staleIds.length) {
      var delRes = await client
        .from("family_memory_media")
        .delete()
        .in("id", staleIds);

      if (delRes.error) {
        console.error(delRes.error);
        setStatus("memory-item-status", "تم حفظ المادة لكن تعذر حذف وسائط قديمة (تحقق من RLS).", true);
        return false;
      }
    }

    return true;
  }

  async function deleteMediaAtIndex(idx) {
    var row = localMedia[idx];
    if (!row) return;

    var dbId = text(row._db_id);
    if (!dbId) {
      localMedia.splice(idx, 1);
      renderMediaList();
      return;
    }

    var client = getClient();
    if (!client) {
      setStatus("memory-item-status", "تعذر تهيئة عميل Supabase لحذف الوسيط.", true);
      return;
    }

    var ok = window.confirm("سيتم حذف الوسيط من family_memory_media. متابعة؟");
    if (!ok) return;

    var res = await client
      .from("family_memory_media")
      .delete()
      .eq("id", dbId);

    if (res.error) {
      console.error(res.error);
      setStatus("memory-item-status", "تعذر حذف الوسيط من family_memory_media (تحقق من RLS).", true);
      return;
    }

    localMedia.splice(idx, 1);
    renderMediaList();
    setStatus("memory-item-status", "تم حذف الوسيط.", false);
  }

  function resetExtraPersonFields() {
    var ids = [
      "memory-extra-person-id",
      "memory-extra-person-name",
      "memory-extra-person-lineage",
      "memory-extra-person-note"
    ];

    ids.forEach(function (id) {
      var node = el(id);
      if (node) node.value = "";
    });
  }

  function renderExtraPeopleList() {
    var list = el("memory-extra-people-list");
    if (!list) return;

    if (!localExtraPeople.length) {
      list.innerHTML = "<div class=\"hint\">لا يوجد أشخاص إضافيون بعد.</div>";
      return;
    }

    list.innerHTML = "";

    localExtraPeople.forEach(function (p, idx) {
      var row = document.createElement("div");
      row.className = "memory-list-card";
      row.innerHTML =
        "<h4>" + (p.person_name || "-") + "</h4>" +
        "<p>" + (p.relation_note || "بدون ملاحظة") + (p._db_id ? " | محفوظ" : " | محلي") + "</p>";

      var actions = document.createElement("div");
      actions.className = "memory-list-actions";

      var del = document.createElement("button");
      del.type = "button";
      del.textContent = "حذف";
      del.addEventListener("click", function () {
        deleteExtraPersonAtIndex(idx).catch(function (err) {
          console.error(err);
          setStatus("memory-item-status", "حدث خطأ غير متوقع أثناء حذف الشخص الإضافي.", true);
        });
      });

      actions.appendChild(del);
      row.appendChild(actions);
      list.appendChild(row);
    });
  }

  function addExtraPersonLocal() {
    var row = {
      _db_id: null,
      person_id: text(el("memory-extra-person-id") && el("memory-extra-person-id").value) || null,
      person_name: text(el("memory-extra-person-name") && el("memory-extra-person-name").value),
      person_lineage: text(el("memory-extra-person-lineage") && el("memory-extra-person-lineage").value) || null,
      relation_note: text(el("memory-extra-person-note") && el("memory-extra-person-note").value) || null
    };

    if (!row.person_name) {
      setStatus("memory-item-status", "اسم الشخص الإضافي مطلوب.", true);
      return;
    }

    localExtraPeople.push(row);
    renderExtraPeopleList();
    resetExtraPersonFields();
    setStatus("memory-item-status", "تمت إضافة شخص إضافي للقائمة المحلية.", false);
  }

  async function loadExtraPeopleForItem(memoryId) {
    var client = getClient();
    if (!client || !memoryId) {
      localExtraPeople = [];
      renderExtraPeopleList();
      return;
    }

    var res = await client
      .from("family_memory_people")
      .select("id,memory_id,person_id,person_name,person_lineage,relation_note,created_at")
      .eq("memory_id", memoryId)
      .order("created_at", { ascending: true });

    if (res.error) {
      console.error(res.error);
      setStatus("memory-item-status", "تعذر تحميل الأشخاص الإضافيين (تحقق من RLS).", true);
      return;
    }

    localExtraPeople = (Array.isArray(res.data) ? res.data : []).map(function (p) {
      return {
        _db_id: p.id,
        person_id: p.person_id,
        person_name: p.person_name,
        person_lineage: p.person_lineage,
        relation_note: p.relation_note
      };
    });

    renderExtraPeopleList();
  }

  async function syncExtraPeopleForItem(memoryId) {
    var client = getClient();
    if (!client || !memoryId) return false;

    var existingRes = await client
      .from("family_memory_people")
      .select("id")
      .eq("memory_id", memoryId);

    if (existingRes.error) {
      console.error(existingRes.error);
      setStatus("memory-item-status", "تعذر قراءة الأشخاص الإضافيين قبل المزامنة (تحقق من RLS).", true);
      return false;
    }

    var existingIds = (Array.isArray(existingRes.data) ? existingRes.data : []).map(function (r) {
      return String(r.id);
    });

    var keptIds = {};

    for (var i = 0; i < localExtraPeople.length; i += 1) {
      var p = localExtraPeople[i] || {};
      var payload = {
        memory_id: memoryId,
        person_id: text(p.person_id) || null,
        person_name: text(p.person_name),
        person_lineage: text(p.person_lineage) || null,
        relation_note: text(p.relation_note) || null
      };

      if (!payload.person_name) continue;

      var upRes;
      var targetId = text(p._db_id);
      if (targetId) {
        upRes = await client
          .from("family_memory_people")
          .update(payload)
          .eq("id", targetId)
          .select("id")
          .single();
      } else {
        payload.created_at = new Date().toISOString();
        upRes = await client
          .from("family_memory_people")
          .insert(payload)
          .select("id")
          .single();
      }

      if (upRes.error || !upRes.data || !upRes.data.id) {
        console.error(upRes.error || upRes);
        setStatus("memory-item-status", "تعذر حفظ بعض الأشخاص الإضافيين في family_memory_people (تحقق من RLS).", true);
        return false;
      }

      var savedId = String(upRes.data.id);
      keptIds[savedId] = true;
      localExtraPeople[i]._db_id = savedId;
    }

    var staleIds = existingIds.filter(function (id) { return !keptIds[id]; });
    if (staleIds.length) {
      var delRes = await client
        .from("family_memory_people")
        .delete()
        .in("id", staleIds);

      if (delRes.error) {
        console.error(delRes.error);
        setStatus("memory-item-status", "تم حفظ المادة لكن تعذر حذف بعض الأشخاص الإضافيين القدامى (تحقق من RLS).", true);
        return false;
      }
    }

    return true;
  }

  async function deleteExtraPersonAtIndex(idx) {
    var row = localExtraPeople[idx];
    if (!row) return;

    var dbId = text(row._db_id);
    if (!dbId) {
      localExtraPeople.splice(idx, 1);
      renderExtraPeopleList();
      return;
    }

    var client = getClient();
    if (!client) {
      setStatus("memory-item-status", "تعذر تهيئة عميل Supabase لحذف الشخص الإضافي.", true);
      return;
    }

    var ok = window.confirm("سيتم حذف الشخص الإضافي من family_memory_people. متابعة؟");
    if (!ok) return;

    var res = await client
      .from("family_memory_people")
      .delete()
      .eq("id", dbId);

    if (res.error) {
      console.error(res.error);
      setStatus("memory-item-status", "تعذر حذف الشخص الإضافي من family_memory_people (تحقق من RLS).", true);
      return;
    }

    localExtraPeople.splice(idx, 1);
    renderExtraPeopleList();
    setStatus("memory-item-status", "تم حذف الشخص الإضافي.", false);
  }

  function collectCurrentItemDraft() {
    var statusVal = text(el("memory-item-status-select") && el("memory-item-status-select").value) || "pending";
    if (["pending", "approved", "rejected", "archived"].indexOf(statusVal) === -1) statusVal = "pending";

    var tagsRaw = text(el("memory-item-tags") && el("memory-item-tags").value);
    var tags = tagsRaw
      ? tagsRaw.split(",").map(function (x) { return text(x); }).filter(Boolean)
      : [];

    var uiType = text(el("memory-item-type") && el("memory-item-type").value) || "image";
    var kindMap = {
      image: "photo_album",
      video: "video",
      audio: "audio",
      document: "document",
      article: "general",
      story: "story"
    };

    return {
      id: text(el("memory-item-id") && el("memory-item-id").value) || null,
      person_ref: selectedPerson ? personKey(selectedPerson) : "",
      person_id: text(selectedPerson && selectedPerson.person_id) || null,
      person_name: text(selectedPerson && selectedPerson.person_name) || null,
      branch_key: text(selectedPerson && selectedPerson.branch_key) || null,
      person_lineage: text(selectedPerson && selectedPerson.person_lineage) || null,
      title: text(el("memory-item-title") && el("memory-item-title").value),
      description: text(el("memory-item-description") && el("memory-item-description").value) || null,
      story_text: text(el("memory-item-story-text") && el("memory-item-story-text").value) || null,
      memory_kind: kindMap[uiType] || "general",
      memory_date: text(el("memory-item-date") && el("memory-item-date").value) || null,
      memory_year: text(el("memory-item-year") && el("memory-item-year").value) || null,
      location_name: text(el("memory-item-location-name") && el("memory-item-location-name").value) || null,
      location_city: text(el("memory-item-location-city") && el("memory-item-location-city").value) || null,
      location_area: text(el("memory-item-location-area") && el("memory-item-location-area").value) || null,
      tags: tags,
      is_featured: text(el("memory-item-featured") && el("memory-item-featured").value) === "true",
      display_order: num(el("memory-item-order") && el("memory-item-order").value, 0),
      status: statusVal,
      source_type: text(el("memory-source-type") && el("memory-source-type").value) || "admin",
      submitted_by_name: text(el("memory-source-name") && el("memory-source-name").value) || null,
      submitted_by_phone: text(el("memory-source-phone") && el("memory-source-phone").value) || null,
      submitted_by_relation: text(el("memory-source-relation") && el("memory-source-relation").value) || null,
      media: localMedia.slice(),
      extra_people: localExtraPeople.slice()
    };
  }

  function validateDraft(draft) {
    if (!selectedPerson || !text(selectedPerson.person_name)) {
      return "اختيار الشخص الأساسي إلزامي قبل حفظ المادة.";
    }

    if (!draft.title) {
      return "عنوان المادة مطلوب.";
    }

    if (!draft.memory_kind) {
      return "نوع المادة مطلوب.";
    }

    if (draft.memory_kind === "story" && !text(draft.story_text)) {
      return "نص القصة مطلوب عندما يكون نوع المادة قصة.";
    }

    if (draft.source_type === "delegate") {
      if (!text(draft.submitted_by_name) || !text(draft.submitted_by_phone)) {
        return "عند اختيار مصدر مندوب يجب تعبئة اسم المرسل وجواله.";
      }
    }

    return "";
  }

  function memoryKindToUiType(kind) {
    var k = text(kind).toLowerCase();
    if (k === "video") return "video";
    if (k === "audio") return "audio";
    if (k === "document") return "document";
    if (k === "story") return "story";
    if (k === "general") return "article";
    return "image";
  }

  function fillItemFormFromDb(item) {
    var set = function (id, val) {
      var n = el(id);
      if (!n) return;
      n.value = val == null ? "" : String(val);
    };

    set("memory-item-id", item.id);
    set("memory-item-title", item.title);
    set("memory-item-description", item.description);
    set("memory-item-story-text", item.story_text);
    set("memory-item-date", item.memory_date);
    set("memory-item-year", item.memory_year);
    set("memory-item-location-name", item.location_name);
    set("memory-item-location-city", item.location_city);
    set("memory-item-location-area", item.location_area);
    set("memory-item-order", item.display_order || 0);
    set("memory-item-tags", Array.isArray(item.tags) ? item.tags.join(", ") : "");
    set("memory-item-featured", item.is_featured ? "true" : "false");
    set("memory-item-status-select", item.status || "pending");
    set("memory-source-name", item.submitted_by_name || "");
    set("memory-source-phone", item.submitted_by_phone || "");
    set("memory-source-relation", item.submitted_by_relation || "");

    var sourceType = (item.submitted_by_name || item.submitted_by_phone) ? "delegate" : "admin";
    set("memory-source-type", sourceType);
    set("memory-item-type", memoryKindToUiType(item.memory_kind));

    updateStoryTextState();
    setSourceHint();
    setStatus("memory-item-status", "تم تحميل المادة للتعديل.", false);

    loadMediaForItem(item.id).catch(function (err) {
      console.error(err);
      setStatus("memory-item-status", "تعذر تحميل وسائط المادة.", true);
    });

    loadExtraPeopleForItem(item.id).catch(function (err) {
      console.error(err);
      setStatus("memory-item-status", "تعذر تحميل الأشخاص الإضافيين.", true);
    });
  }

  function renderItemListLocal() {
    var list = el("memory-items-list");
    if (!list) return;

    if (!localItems.length) {
      list.innerHTML = selectedPerson ? "لا توجد مواد لهذا الشخص بعد." : "اختر شخصية أولاً لعرض موادها.";
      return;
    }

    list.innerHTML = "";

    localItems.forEach(function (it, idx) {
      var card = document.createElement("div");
      card.className = "memory-list-card";
      card.innerHTML =
        "<h4>" + (it.title || "بدون عنوان") + "</h4>" +
        "<p>" + (it.person_name || "-") + " | " + (it.memory_kind || "-") + " | " + (it.status || "pending") + "</p>";

      var actions = document.createElement("div");
      actions.className = "memory-list-actions";

      var edit = document.createElement("button");
      edit.type = "button";
      edit.textContent = "تعديل";
      edit.addEventListener("click", function () {
        fillItemFormFromDb(it);
      });

      var del = document.createElement("button");
      del.type = "button";
      del.textContent = "حذف";
      del.addEventListener("click", function () {
        var itemId = it && it.id ? String(it.id) : "";
        if (!itemId) {
          localItems.splice(idx, 1);
          renderItemListLocal();
          return;
        }

        var btn = el("memory-item-id");
        if (btn) btn.value = itemId;
        setStatus("memory-item-status", "اختر زر حذف المادة الرئيسي لتأكيد الحذف من القاعدة.", false);
      });

      actions.appendChild(edit);
      actions.appendChild(del);
      card.appendChild(actions);
      list.appendChild(card);
    });
  }

  async function loadItemsForSelectedPerson() {
    var client = getClient();
    if (!client) {
      setStatus("memory-item-status", "تعذر تهيئة عميل Supabase.", true);
      return;
    }

    if (!selectedPerson || !text(selectedPerson.person_name)) {
      localItems = [];
      renderItemListLocal();
      return;
    }

    var q = client
      .from("family_memory_items")
      .select("id,branch_key,person_id,person_name,person_lineage,title,description,story_text,memory_kind,memory_date,memory_year,location_name,location_city,location_area,tags,is_featured,display_order,submitted_by_name,submitted_by_phone,submitted_by_relation,status,created_at,updated_at")
      .order("display_order", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(500);

    if (text(selectedPerson.person_id)) {
      q = q.eq("person_id", text(selectedPerson.person_id));
    } else {
      q = q.eq("person_name", text(selectedPerson.person_name));
    }

    var res = await q;
    if (res.error) {
      console.error(res.error);
      setStatus("memory-item-status", "تعذر تحميل مواد الشخص (تحقق من RLS).", true);
      return;
    }

    localItems = Array.isArray(res.data) ? res.data : [];
    renderItemListLocal();
  }

  function clearItemForm() {
    var ids = [
      "memory-item-id",
      "memory-item-title",
      "memory-item-description",
      "memory-item-story-text",
      "memory-item-date",
      "memory-item-year",
      "memory-item-location-name",
      "memory-item-location-city",
      "memory-item-location-area",
      "memory-item-tags",
      "memory-item-file-url",
      "memory-item-thumbnail",
      "memory-source-name",
      "memory-source-phone",
      "memory-source-relation"
    ];

    ids.forEach(function (id) {
      var node = el(id);
      if (node) node.value = "";
    });

    var type = el("memory-item-type");
    if (type) type.value = "image";

    var order = el("memory-item-order");
    if (order) order.value = "0";

    var featured = el("memory-item-featured");
    if (featured) featured.value = "false";

    var status = el("memory-item-status-select");
    if (status) status.value = "pending";

    var source = el("memory-source-type");
    if (source) source.value = "admin";

    localMedia = [];
    localExtraPeople = [];

    resetMediaFields();
    resetExtraPersonFields();
    renderMediaList();
    renderExtraPeopleList();
    updateStoryTextState();
    setSourceHint();

    setStatus("memory-item-status", "تم تهيئة نموذج المادة.", false);
  }

  async function saveItemToDatabase() {
    var client = getClient();
    if (!client) {
      setStatus("memory-item-status", "تعذر تهيئة عميل Supabase.", true);
      return;
    }

    var draft = collectCurrentItemDraft();
    var issue = validateDraft(draft);

    if (issue) {
      setStatus("memory-item-status", issue, true);
      return;
    }

    var payload = {
      branch_key: draft.branch_key || "غير محدد",
      person_id: draft.person_id || null,
      person_name: draft.person_name || "",
      person_lineage: draft.person_lineage || null,
      title: draft.title,
      description: draft.description,
      story_text: draft.memory_kind === "story" ? draft.story_text : null,
      memory_kind: draft.memory_kind,
      memory_date: draft.memory_date,
      memory_year: draft.memory_year,
      location_name: draft.location_name,
      location_city: draft.location_city,
      location_area: draft.location_area,
      tags: draft.tags || [],
      is_featured: !!draft.is_featured,
      display_order: draft.display_order,
      submitted_by_name: draft.submitted_by_name,
      submitted_by_phone: draft.submitted_by_phone,
      submitted_by_relation: draft.submitted_by_relation,
      status: draft.status,
      updated_at: new Date().toISOString()
    };

    var res;
    var isEdit = !!draft.id;
    if (isEdit) {
      res = await client
        .from("family_memory_items")
        .update(payload)
        .eq("id", draft.id)
        .select("id")
        .single();
    } else {
      payload.created_at = new Date().toISOString();
      res = await client
        .from("family_memory_items")
        .insert(payload)
        .select("id")
        .single();
    }

    if (res.error) {
      console.error(res.error);
      setStatus("memory-item-status", "تعذر حفظ المادة في family_memory_items (تحقق من RLS).", true);
      return;
    }

    var idNode = el("memory-item-id");
    var memoryId = idNode && idNode.value ? String(idNode.value) : "";
    if (res.data && res.data.id) {
      memoryId = String(res.data.id);
      if (idNode) idNode.value = memoryId;
    }

    var mediaOk = await syncMediaForItem(memoryId);
    if (!mediaOk) {
      await loadItemsForSelectedPerson();
      await loadMediaForItem(memoryId);
      setStatus("memory-item-status", "تم حفظ المادة لكن فشل حفظ/مزامنة بعض الوسائط (تحقق من RLS).", true);
      return;
    }

    var peopleOk = await syncExtraPeopleForItem(memoryId);
    if (!peopleOk) {
      await loadItemsForSelectedPerson();
      await loadMediaForItem(memoryId);
      await loadExtraPeopleForItem(memoryId);
      setStatus("memory-item-status", "تم حفظ المادة والوسائط لكن فشل حفظ/مزامنة بعض الأشخاص الإضافيين (تحقق من RLS).", true);
      return;
    }

    setStatus("memory-item-status", isEdit ? "تم تحديث المادة والوسائط والأشخاص الإضافيين بنجاح." : "تم حفظ المادة والوسائط والأشخاص الإضافيين بنجاح.", false);
    await loadItemsForSelectedPerson();
    await loadMediaForItem(memoryId);
    await loadExtraPeopleForItem(memoryId);
  }

  async function deleteItemFromDatabase() {
    var client = getClient();
    if (!client) {
      setStatus("memory-item-status", "تعذر تهيئة عميل Supabase.", true);
      return;
    }

    var id = text(el("memory-item-id") && el("memory-item-id").value);
    if (!id) {
      setStatus("memory-item-status", "اختر مادة أولاً ثم احذفها.", true);
      return;
    }

    var ok = window.confirm("سيتم حذف المادة من family_memory_items. هل أنت متأكد؟");
    if (!ok) return;

    var res = await client
      .from("family_memory_items")
      .delete()
      .eq("id", id);

    if (res.error) {
      console.error(res.error);
      setStatus("memory-item-status", "تعذر حذف المادة (تحقق من RLS).", true);
      return;
    }

    clearItemForm();
    await loadItemsForSelectedPerson();
    setStatus("memory-item-status", "تم حذف المادة بنجاح.", false);
  }

  function bindPanels() {
    var tabs = Array.prototype.slice.call(document.querySelectorAll(".memory-admin-tab"));
    var panels = Array.prototype.slice.call(document.querySelectorAll(".memory-admin-panel"));

    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        var target = text(tab.getAttribute("data-memory-panel"));
        tabs.forEach(function (t) { t.classList.remove("is-active"); });
        panels.forEach(function (p) { p.classList.remove("is-active"); });
        tab.classList.add("is-active");
        var panel = document.querySelector('.memory-admin-panel[data-memory-panel="' + target + '"]');
        if (panel) panel.classList.add("is-active");
      });
    });
  }

  function bindEvents() {
    var personName = el("memory-person-name");
    if (personName) {
      personName.addEventListener("input", function () {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () {
          searchTreeRpc(personName.value).catch(function (err) {
            console.error(err);
            setStatus("memory-admin-status", "تعذر تنفيذ البحث في الشجرة.", true);
          });
        }, 250);
      });
    }

    var savePerson = el("memory-person-save");
    if (savePerson) {
      savePerson.addEventListener("click", function () {
        saveSelectedPersonLocal();
      });
    }

    var newPerson = el("memory-person-new");
    if (newPerson) newPerson.addEventListener("click", clearPersonForm);

    var deletePerson = el("memory-person-delete");
    if (deletePerson) {
      deletePerson.addEventListener("click", function () {
        clearPersonForm();
        setStatus("memory-admin-status", "تم إلغاء الاختيار الحالي.", false);
      });
    }

    var typeSelect = el("memory-item-type");
    if (typeSelect) typeSelect.addEventListener("change", updateStoryTextState);

    var sourceType = el("memory-source-type");
    if (sourceType) sourceType.addEventListener("change", setSourceHint);

    var addMediaBtn = el("memory-media-add");
    if (addMediaBtn) addMediaBtn.addEventListener("click", addMediaLocal);

    var clearMediaBtn = el("memory-media-clear");
    if (clearMediaBtn) clearMediaBtn.addEventListener("click", resetMediaFields);

    var addExtraPersonBtn = el("memory-extra-person-add");
    if (addExtraPersonBtn) addExtraPersonBtn.addEventListener("click", addExtraPersonLocal);

    var clearExtraPersonBtn = el("memory-extra-person-clear");
    if (clearExtraPersonBtn) clearExtraPersonBtn.addEventListener("click", resetExtraPersonFields);

    var newItem = el("memory-item-new");
    if (newItem) newItem.addEventListener("click", clearItemForm);

    var saveItem = el("memory-item-save");
    if (saveItem) {
      saveItem.addEventListener("click", function () {
        saveItemToDatabase().catch(function (err) {
          console.error(err);
          setStatus("memory-item-status", "حدث خطأ غير متوقع أثناء الحفظ.", true);
        });
      });
    }

    var deleteItem = el("memory-item-delete");
    if (deleteItem) {
      deleteItem.addEventListener("click", function () {
        deleteItemFromDatabase().catch(function (err) {
          console.error(err);
          setStatus("memory-item-status", "حدث خطأ غير متوقع أثناء الحذف.", true);
        });
      });
    }

    var personSelect = el("memory-item-profile");
    if (personSelect) {
      personSelect.addEventListener("change", function () {
        var key = text(personSelect.value);
        var hit = localPeople.find(function (p) { return personKey(p) === key; }) || null;
        selectedPerson = hit;
        syncPersonFields();
        updateSelectedPersonSummary();

        loadItemsForSelectedPerson().catch(function (err) {
          console.error(err);
          setStatus("memory-item-status", "تعذر تحميل مواد الشخصية.", true);
        });
      });
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    bindPanels();
    bindEvents();

    updateStoryTextState();
    setSourceHint();
    clearTreeResults();
    updateSelectedPersonSummary();
    renderPeople();
    renderMediaList();
    renderExtraPeopleList();
    renderItemListLocal();

    setStatus("memory-admin-status", "المرحلة 2 جاهزة: تم تفعيل البحث عبر memory_tree_search_v1 مع اختيار الشخص محليًا.", false);
    setStatus("memory-item-status", "المرحلة 3: حفظ المواد في family_memory_items مفعل.", false);
  });
})();
