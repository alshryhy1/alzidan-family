(function () {
  var sbClient = null;
  var allItems = [];
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

  function setText(id, value) {
    var node = document.getElementById(id);
    if (node) node.textContent = String(value || 0);
  }

  function setListMessage(msg) {
    var list = document.getElementById("memory-list");
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

  function mediaIcon(type) {
    if (type === "video") return "🎥";
    if (type === "audio") return "🎙️";
    if (type === "document") return "📄";
    return "📷";
  }

  function mediaTypeAr(type) {
    if (type === "video") return "فيديو";
    if (type === "audio") return "صوت";
    if (type === "document") return "وثيقة";
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

  function updateStats(items) {
    var people = new Set();
    var images = 0;
    var videos = 0;
    var audios = 0;
    var stories = 0;
    var docs = 0;

    items.forEach(function (item) {
      var personKey = text(item.person_id || item.person_name);
      if (personKey) people.add(personKey);

      var kind = uiKindFromItemKind(item.memory_kind);
      if (kind === "image") images += 1;
      if (kind === "video") videos += 1;
      if (kind === "audio") audios += 1;
      if (kind === "story") stories += 1;
      if (kind === "document") docs += 1;

      var media = Array.isArray(item.family_memory_media) ? item.family_memory_media : [];
      media.forEach(function (m) {
        if (m.media_type === "image") images += 1;
        if (m.media_type === "video") videos += 1;
        if (m.media_type === "audio") audios += 1;
        if (m.media_type === "document") docs += 1;
      });
    });

    setText("stat-people", people.size);
    setText("stat-images", images);
    setText("stat-videos", videos);
    setText("stat-audios", audios);
    setText("stat-stories", stories);
    setText("stat-docs", docs);
  }

  function renderPeople(items) {
    var wrap = document.getElementById("memory-people");
    if (!wrap) return;
    wrap.innerHTML = "";

    var people = new Map();

    items.forEach(function (item) {
      var key = text(item.person_id || item.person_name);
      if (!key) return;

      if (!people.has(key)) {
        people.set(key, {
          id: item.person_id || "",
          name: item.person_name || "شخصية موثقة",
          branch: item.branch_key || "",
          images: 0,
          videos: 0,
          stories: 0
        });
      }

      var p = people.get(key);
      var kind = uiKindFromItemKind(item.memory_kind);
      if (kind === "image") p.images += 1;
      if (kind === "video") p.videos += 1;
      if (kind === "story") p.stories += 1;
    });

    var rows = Array.from(people.values()).slice(0, 12);

    if (!rows.length) {
      var empty = document.createElement("div");
      empty.className = "memory-empty";
      empty.textContent = "لا توجد شخصيات موثقة حاليًا.";
      wrap.appendChild(empty);
      return;
    }

    rows.forEach(function (p) {
      var card = document.createElement("article");
      card.className = "memory-card";

      var title = document.createElement("div");
      title.className = "memory-card-title";
      title.textContent = p.name;

      var meta = document.createElement("div");
      meta.className = "memory-card-meta";
      meta.textContent = [
        p.branch ? "الفرع: " + p.branch : "",
        "صور: " + p.images,
        "فيديو: " + p.videos,
        "قصص: " + p.stories
      ].filter(Boolean).join(" — ");

      var link = document.createElement("a");
      link.className = "btn btn-outline btn-small";
      link.href = "person.html?" + (p.id ? "person_id=" + encodeURIComponent(p.id) : "person_name=" + encodeURIComponent(p.name));
      link.textContent = "فتح صفحة الشخصية";

      card.appendChild(title);
      card.appendChild(meta);
      card.appendChild(link);
      wrap.appendChild(card);
    });
  }

  function renderMemory(item) {
    var card = document.createElement("article");
    card.className = "memory-card";

    var title = document.createElement("div");
    title.className = "memory-card-title";
    title.textContent = text(item.title || item.person_name || "ذكرى");

    var meta = document.createElement("div");
    meta.className = "memory-card-meta";
    meta.textContent = [
      item.person_name ? "الاسم: " + item.person_name : "",
      item.branch_key ? "الفرع: " + item.branch_key : "",
      item.memory_year ? "السنة: " + item.memory_year : "",
      item.memory_date ? "التاريخ: " + item.memory_date : ""
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

    var media = Array.isArray(item.family_memory_media) ? item.family_memory_media : [];
    media.forEach(function (m) {
      if (!m.media_url) return;
      var a = document.createElement("a");
      a.className = "btn btn-outline btn-small";
      a.href = m.media_url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = mediaIcon(m.media_type) + " " + mediaTypeAr(m.media_type) + " — " + (m.caption || "فتح الوسيط");
      card.appendChild(a);
    });

    return card;
  }

  function filteredItems() {
    var branch = text(document.getElementById("memory-branch") && document.getElementById("memory-branch").value);
    var q = text(document.getElementById("memory-search") && document.getElementById("memory-search").value).toLowerCase();

    return allItems.filter(function (item) {
      if (branch && text(item.branch_key) !== branch) return false;

      if (activeKind) {
        var kind = uiKindFromItemKind(item.memory_kind);
        var media = Array.isArray(item.family_memory_media) ? item.family_memory_media : [];
        var kindHit = kind === activeKind || media.some(function (m) { return text(m.media_type) === activeKind; });
        if (!kindHit) return false;
      }

      if (!q) return true;
      var hay = [
        text(item.person_name),
        text(item.title),
        text(item.description),
        text(item.story_text),
        text(item.branch_key)
      ].join(" ").toLowerCase();

      return hay.indexOf(q) >= 0;
    });
  }

  function renderList() {
    var list = document.getElementById("memory-list");
    if (!list) return;

    var rows = filteredItems();
    list.innerHTML = "";

    if (!rows.length) {
      setListMessage("لا توجد نتائج مطابقة لخيارات العرض الحالية.");
      return;
    }

    rows.forEach(function (item) {
      list.appendChild(renderMemory(item));
    });
  }

  async function loadMemories() {
    var sb = getClient();
    if (!sb) {
      setListMessage("تعذر الاتصال بالخدمة.");
      return;
    }

    var query = sb
      .from("family_memory_items")
      .select("id,branch_key,person_id,person_name,person_lineage,title,description,story_text,memory_kind,memory_date,memory_year,is_featured,display_order,submitted_by_name,submitted_by_phone,submitted_by_relation,created_at,family_memory_media(media_type,media_url,thumbnail_url,caption,display_order)")
      .eq("status", "approved")
      .order("is_featured", { ascending: false })
      .order("display_order", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(120);

    var res = await query;
    if (res.error) {
      console.error(res.error);
      setListMessage("تعذر تحميل الذكريات حاليًا.");
      return;
    }

    allItems = Array.isArray(res.data) ? res.data : [];

    updateStats(allItems);
    renderPeople(allItems);

    if (!allItems.length) {
      setListMessage("لا توجد مواد معتمدة في من الذاكرة حاليًا.");
      return;
    }

    renderList();
  }

  function bindUi() {
    var filters = Array.prototype.slice.call(document.querySelectorAll(".memory-filter"));
    filters.forEach(function (btn) {
      btn.addEventListener("click", function () {
        filters.forEach(function (x) { x.classList.remove("is-active"); });
        btn.classList.add("is-active");
        activeKind = text(btn.getAttribute("data-kind"));
        renderList();
      });
    });

    var refresh = document.getElementById("memory-refresh");
    if (refresh) refresh.addEventListener("click", renderList);

    var search = document.getElementById("memory-search");
    if (search) search.addEventListener("input", renderList);

    var branch = document.getElementById("memory-branch");
    if (branch) branch.addEventListener("change", renderList);
  }

  function start() {
    bindUi();
    loadMemories().catch(function () {
      setListMessage("تعذر تحميل الذكريات.");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
