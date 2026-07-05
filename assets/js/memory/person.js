(function () {
  var sbClient = null;
  var allItems = [];
  var allReactions = [];
  var activeKind = "";

  function getClient() {
    if (sbClient) return sbClient;
    if (window.__alzidanConfig && typeof window.__alzidanConfig.getClient === "function") {
      sbClient = window.__alzidanConfig.getClient();
      return sbClient;
    }
    if (window.__alzidanالخدمةClient) {
      sbClient = window.__alzidanالخدمةClient;
      return sbClient;
    }
    return null;
  }

  function text(v) {
    return String(v || "").replace(/\s+/g, " ").trim();
  }

  function getParam(name) {
    try {
      return new URLSearchParams(window.location.search || "").get(name) || "";
    } catch (e) {
      return "";
    }
  }

  function setText(id, value) {
    var node = document.getElementById(id);
    if (node) node.textContent = String(value || 0);
  }

  function setMessage(msg) {
    var list = document.getElementById("person-memory-list");
    if (!list) return;
    list.innerHTML = "";
    var div = document.createElement("div");
    div.className = "memory-empty";
    div.textContent = msg;
    list.appendChild(div);
  }

  function uiKindFromItemKind(kind) {
    var k = text(kind).toLowerCase();
    if (k === "video") return "video";
    if (k === "audio") return "audio";
    if (k === "document") return "document";
    if (k === "story") return "story";
    if (k === "photo_album") return "image";
    return "other";
  }

  function mediaLabel(type) {
    if (type === "video") return "فيديو";
    if (type === "audio") return "صوت";
    if (type === "document") return "وثيقة";
    if (type === "story") return "قصة";
    return "صورة";
  }

  function sourceSignature(item) {
    var name = text(item.submitted_by_name);
    var phone = text(item.submitted_by_phone);
    if (!name && !phone) return "أُرسلت من الإدارة";

    var parts = ["أُرسلت بواسطة المندوب"];
    if (name) parts.push("الاسم: " + name);
    if (phone) parts.push("الجوال: " + phone);
    return parts.join(" — ");
  }

  function updateHeader(items) {
    var first = items[0] || {};
    var name = text(first.person_name || getParam("person_name") || "شخصية من الذاكرة");
    var branch = text(first.branch_key || "");
    var lineage = text(first.person_lineage || "");

    var title = document.getElementById("person-title");
    var subtitle = document.getElementById("person-subtitle");

    if (title) title.textContent = name;
    if (subtitle) {
      subtitle.textContent = [
        branch ? "الفرع: " + branch : "",
        lineage ? "النسب: " + lineage : ""
      ].filter(Boolean).join(" — ") || "توثيق المواد الخاصة بهذه الشخصية.";
    }
  }

  function updateStats(items) {
    var images = 0;
    var videos = 0;
    var audios = 0;
    var stories = 0;
    var docs = 0;

    items.forEach(function (item) {
      var k = uiKindFromItemKind(item.memory_kind);
      if (k === "image") images += 1;
      if (k === "video") videos += 1;
      if (k === "audio") audios += 1;
      if (k === "story") stories += 1;
      if (k === "document") docs += 1;

      var media = Array.isArray(item.family_memory_media) ? item.family_memory_media : [];
      media.forEach(function (m) {
        if (m.media_type === "image") images += 1;
        if (m.media_type === "video") videos += 1;
        if (m.media_type === "audio") audios += 1;
        if (m.media_type === "document") docs += 1;
      });
    });

    setText("stat-images", images);
    setText("stat-videos", videos);
    setText("stat-audios", audios);
    setText("stat-stories", stories);
    setText("stat-docs", docs);
    setText("stat-total", items.length);
  }

  function renderReaction(reaction) {
    var card = document.createElement("article");
    card.className = "memory-card";

    var title = document.createElement("div");
    title.className = "memory-card-title";
    title.textContent = reaction.reaction_type === "dua" ? "دعاء" : "تعليق";

    var meta = document.createElement("div");
    meta.className = "memory-card-meta";
    meta.textContent = [
      reaction.sender_name ? "الاسم: " + reaction.sender_name : "",
      reaction.sender_phone ? "الجوال: " + reaction.sender_phone : "",
      reaction.memory_title ? "على مادة: " + reaction.memory_title : ""
    ].filter(Boolean).join(" — ");

    var body = document.createElement("div");
    body.className = "memory-card-desc";
    body.textContent = text(reaction.text || "");

    card.appendChild(title);
    card.appendChild(meta);
    if (body.textContent) card.appendChild(body);
    return card;
  }

  function renderItem(item) {
    var card = document.createElement("article");
    card.className = "memory-card";

    var title = document.createElement("div");
    title.className = "memory-card-title";
    title.textContent = text(item.title || mediaLabel(item.memory_kind));

    var meta = document.createElement("div");
    meta.className = "memory-card-meta";
    meta.textContent = [
      item.branch_key ? "الفرع: " + item.branch_key : "",
      item.memory_year ? "السنة: " + item.memory_year : "",
      item.memory_date ? "التاريخ: " + item.memory_date : "",
      item.memory_kind ? "النوع: " + mediaLabel(uiKindFromItemKind(item.memory_kind)) : ""
    ].filter(Boolean).join(" — ");

    var desc = document.createElement("div");
    desc.className = "memory-card-desc";
    desc.textContent = text(item.description || item.story_text || "");

    var source = document.createElement("div");
    source.className = "memory-card-meta";
    source.textContent = sourceSignature(item);

    card.appendChild(title);
    card.appendChild(meta);
    if (desc.textContent) card.appendChild(desc);
    card.appendChild(source);

    var extras = Array.isArray(item.family_memory_people) ? item.family_memory_people : [];
    if (extras.length) {
      var extra = document.createElement("div");
      extra.className = "memory-card-meta";
      extra.textContent = "أشخاص إضافيون: " + extras.map(function (p) { return text(p.person_name); }).filter(Boolean).join("، ");
      card.appendChild(extra);
    }

    var media = Array.isArray(item.family_memory_media) ? item.family_memory_media : [];
    media.forEach(function (m) {
      if (!m.media_url) return;
      var a = document.createElement("a");
      a.className = "btn btn-outline btn-small";
      a.href = m.media_url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = mediaLabel(m.media_type) + " — " + text(m.caption || "فتح الوسائط");
      card.appendChild(a);
    });

    return card;
  }

  function applyFilter() {
    var list = document.getElementById("person-memory-list");
    if (!list) return;
    list.innerHTML = "";

    if (activeKind === "reaction") {
      if (!allReactions.length) {
        setMessage("لا توجد أدعية/تعليقات معتمدة لهذه الشخصية حاليًا.");
        return;
      }

      allReactions.forEach(function (r) {
        list.appendChild(renderReaction(r));
      });
      return;
    }

    var rows = allItems.filter(function (item) {
      if (!activeKind) return true;
      var media = Array.isArray(item.family_memory_media) ? item.family_memory_media : [];
      var kind = uiKindFromItemKind(item.memory_kind);
      return kind === activeKind || media.some(function (m) { return text(m.media_type) === activeKind; });
    });

    if (!rows.length) {
      setMessage("لا توجد مواد في هذا القسم حاليًا.");
      return;
    }

    rows.forEach(function (item) {
      list.appendChild(renderItem(item));
    });
  }

  async function loadPerson() {
    var sb = getClient();
    if (!sb) {
      setMessage("تعذر الاتصال بالخدمة.");
      return;
    }

    var personId = text(getParam("person_id"));
    var personName = text(getParam("person_name"));
    if (!personId && !personName) {
      setMessage("لم يتم تحديد الشخصية.");
      return;
    }

    var query = sb
      .from("family_memory_items")
      .select("id,branch_key,person_id,person_name,person_lineage,title,description,story_text,memory_kind,memory_date,memory_year,display_order,submitted_by_name,submitted_by_phone,submitted_by_relation,created_at")
      .eq("status", "approved")
      .order("display_order", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(300);

    if (personId) query = query.eq("person_id", personId);
    else query = query.ilike("person_name", "%" + personName + "%");

    var itemRes = await query;
    if (itemRes.error) {
      console.error(itemRes.error);
      setMessage("تعذر تحميل مواد الشخصية حاليًا.");
      return;
    }

    allItems = Array.isArray(itemRes.data) ? itemRes.data : [];
    updateHeader(allItems);
    updateStats(allItems);

    if (!allItems.length) {
      setMessage("لا توجد مواد معتمدة لهذه الشخصية حاليًا.");
      return;
    }

    var ids = allItems.map(function (x) { return x.id; }).filter(Boolean);

    var mediaRes = await sb
      .from("family_memory_media")
      .select("id,memory_id,media_type,media_url,thumbnail_url,caption,display_order")
      .in("memory_id", ids)
      .order("display_order", { ascending: true });

    var peopleRes = await sb
      .from("family_memory_people")
      .select("id,memory_id,person_id,person_name,person_lineage,relation_note")
      .in("memory_id", ids);

    var reactionsRes = await sb
      .from("family_memory_reactions")
      .select("id,memory_id,reaction_type,sender_name,sender_phone,text,created_at")
      .eq("status", "approved")
      .in("memory_id", ids)
      .order("created_at", { ascending: false });

    var mediaByMemory = {};
    if (!mediaRes.error) {
      (mediaRes.data || []).forEach(function (m) {
        if (!mediaByMemory[m.memory_id]) mediaByMemory[m.memory_id] = [];
        mediaByMemory[m.memory_id].push(m);
      });
    }

    var peopleByMemory = {};
    if (!peopleRes.error) {
      (peopleRes.data || []).forEach(function (p) {
        if (!peopleByMemory[p.memory_id]) peopleByMemory[p.memory_id] = [];
        peopleByMemory[p.memory_id].push(p);
      });
    }

    allItems = allItems.map(function (item) {
      item.family_memory_media = mediaByMemory[item.id] || [];
      item.family_memory_people = peopleByMemory[item.id] || [];
      return item;
    });

    var titleByMemory = {};
    allItems.forEach(function (item) {
      titleByMemory[item.id] = text(item.title || "مادة");
    });

    allReactions = (reactionsRes.error ? [] : (reactionsRes.data || [])).map(function (r) {
      r.memory_title = titleByMemory[r.memory_id] || "مادة";
      return r;
    });

    applyFilter();
  }

  function bindUi() {
    var tabs = Array.prototype.slice.call(document.querySelectorAll(".memory-tab"));
    tabs.forEach(function (btn) {
      btn.addEventListener("click", function () {
        tabs.forEach(function (x) { x.classList.remove("is-active"); });
        btn.classList.add("is-active");
        activeKind = text(btn.getAttribute("data-kind"));
        applyFilter();
      });
    });
  }

  function start() {
    bindUi();
    loadPerson().catch(function () {
      setMessage("تعذر تحميل مواد الشخصية.");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
