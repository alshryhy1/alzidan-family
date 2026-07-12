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
    if (window.__alzidanSupabaseClient) {
      sbClient = window.__alzidanSupabaseClient;
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

  function formatLineage(raw) {
    var s = text(raw);
    if (!s) return "";
    return s.split("/").map(text).filter(Boolean).join(" / ");
  }

  function personInitial(name) {
    var n = text(name);
    if (!n) return "؟";
    var parts = n.split(/\s+/);
    return parts[0].charAt(0) || "؟";
  }

  function showLoading(listId) {
    var list = document.getElementById(listId);
    if (!list) return;
    list.innerHTML =
      '<div class="memory-loading" aria-busy="true">' +
      '<div class="memory-skeleton"></div>' +
      '<div class="memory-skeleton"></div>' +
      '<div class="memory-skeleton"></div>' +
      "</div>";
  }

  function setListMessage(msg, icon) {
    var list = document.getElementById("memory-list");
    if (!list) return;
    list.innerHTML = "";
    var div = document.createElement("div");
    div.className = "memory-empty";
    div.innerHTML =
      '<span class="memory-empty-icon" aria-hidden="true">' + (icon || "🕊️") + "</span>" + msg;
    list.appendChild(div);
    setText("memory-list-count", 0);
  }

  function uiKindFromItemKind(kind) {
    var k = text(kind).toLowerCase();
    if (k === "video") return "video";
    if (k === "audio") return "audio";
    if (k === "document") return "document";
    if (k === "story") return "story";
    if (k === "photo_album" || k === "general") return "image";
    return "other";
  }

  function kindLabel(kind) {
    if (kind === "video") return "🎬 فيديو";
    if (kind === "audio") return "🎙️ صوت";
    if (kind === "document") return "📄 وثيقة";
    if (kind === "story") return "📜 قصة";
    if (kind === "image") return "📷 صورة";
    return "📁 مادة";
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
    if (window.AlzidanMemorySource && typeof window.AlzidanMemorySource.format === "function") {
      return window.AlzidanMemorySource.format(item);
    }
    var name = text(item.submitted_by_name);
    var phone = text(item.submitted_by_phone);
    if (!name && !phone) return "تم الإرسال من الإدارة";
    return [name, phone].filter(Boolean).join(" — ");
  }

  function makeBadge(cls, label) {
    var span = document.createElement("span");
    span.className = "memory-badge " + cls;
    span.textContent = label;
    return span;
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
    setText("memory-people-count", people.size);
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
    setText("memory-people-count", rows.length);

    if (!rows.length) {
      var empty = document.createElement("div");
      empty.className = "memory-empty";
      empty.style.gridColumn = "1 / -1";
      empty.innerHTML =
        '<span class="memory-empty-icon" aria-hidden="true">👤</span>لا توجد شخصيات موثقة حاليًا.';
      wrap.appendChild(empty);
      return;
    }

    rows.forEach(function (p) {
      var card = document.createElement("article");
      card.className = "memory-card memory-person-card";

      var top = document.createElement("div");
      top.className = "memory-person-top";

      var avatar = document.createElement("span");
      avatar.className = "memory-person-avatar";
      avatar.textContent = personInitial(p.name);
      avatar.setAttribute("aria-hidden", "true");

      var info = document.createElement("div");

      var title = document.createElement("div");
      title.className = "memory-card-title";
      title.textContent = p.name;

      var meta = document.createElement("div");
      meta.className = "memory-card-meta";
      meta.textContent = p.branch ? "الفرع: " + p.branch : "";

      info.appendChild(title);
      info.appendChild(meta);
      top.appendChild(avatar);
      top.appendChild(info);

      var stats = document.createElement("div");
      stats.className = "memory-person-stats";
      stats.innerHTML =
        '<span class="memory-person-stat">📷 ' + p.images + "</span>" +
        '<span class="memory-person-stat">🎬 ' + p.videos + "</span>" +
        '<span class="memory-person-stat">📜 ' + p.stories + "</span>";

      var link = document.createElement("a");
      link.className = "btn btn-outline btn-small";
      link.href =
        "person.html?" +
        (p.id ? "person_id=" + encodeURIComponent(p.id) : "person_name=" + encodeURIComponent(p.name));
      link.textContent = "فتح صفحة الشخصية";

      var body = document.createElement("div");
      body.className = "memory-card-body";
      body.appendChild(top);
      body.appendChild(stats);
      card.appendChild(body);

      var footer = document.createElement("div");
      footer.className = "memory-card-footer";
      footer.appendChild(link);
      card.appendChild(footer);
      wrap.appendChild(card);
    });
  }

  function firstImageMedia(item) {
    var media = Array.isArray(item.family_memory_media) ? item.family_memory_media : [];
    for (var i = 0; i < media.length; i++) {
      if (media[i].media_url && text(media[i].media_type) === "image") return media[i];
    }
    return null;
  }

  function renderMemory(item) {
    var card = document.createElement("article");
    card.className = "memory-card";

    var kind = uiKindFromItemKind(item.memory_kind);
    var imgMedia = firstImageMedia(item);

    if (imgMedia && imgMedia.media_url) {
      var thumbLink = document.createElement("a");
      thumbLink.href = imgMedia.media_url;
      thumbLink.target = "_blank";
      thumbLink.rel = "noopener noreferrer";
      var thumb = document.createElement("img");
      thumb.className = "memory-thumb";
      thumb.src = imgMedia.thumbnail_url || imgMedia.media_url;
      thumb.alt = text(item.title || item.person_name || "صورة من الذاكرة");
      thumb.loading = "lazy";
      thumbLink.appendChild(thumb);
      card.appendChild(thumbLink);
    }

    var body = document.createElement("div");
    body.className = "memory-card-body";

    var head = document.createElement("div");
    head.className = "memory-card-head";

    var title = document.createElement("h3");
    title.className = "memory-card-title";
    title.textContent = text(item.title || item.person_name || "ذكرى");

    var badges = document.createElement("div");
    badges.className = "memory-card-badges";
    badges.appendChild(makeBadge("memory-badge--kind", kindLabel(kind)));
    if (item.branch_key) badges.appendChild(makeBadge("memory-badge--branch", item.branch_key));
    if (item.memory_year) badges.appendChild(makeBadge("memory-badge--year", item.memory_year));

    head.appendChild(title);
    head.appendChild(badges);

    var meta = document.createElement("div");
    meta.className = "memory-card-meta";
    meta.textContent = item.person_name ? "👤 " + item.person_name : "";

    var lineage = formatLineage(item.person_lineage);
    if (lineage) {
      var lin = document.createElement("div");
      lin.className = "memory-card-lineage";
      lin.textContent = lineage;
      body.appendChild(head);
      body.appendChild(meta);
      body.appendChild(lin);
    } else {
      body.appendChild(head);
      body.appendChild(meta);
    }

    var descText = text(item.description || item.story_text || "");
    if (descText) {
      var desc = document.createElement("div");
      desc.className = "memory-card-desc";
      desc.textContent = descText.length > 180 ? descText.slice(0, 180) + "…" : descText;
      body.appendChild(desc);
    }

    var source = document.createElement("div");
    source.className = "memory-card-source";
    source.textContent = "✍️ " + sourceSignature(item);
    body.appendChild(source);

    card.appendChild(body);

    var media = Array.isArray(item.family_memory_media) ? item.family_memory_media : [];
    var nonImageMedia = media.filter(function (m) {
      return m.media_url && text(m.media_type) !== "image";
    });

    if (nonImageMedia.length) {
      var footer = document.createElement("div");
      footer.className = "memory-card-footer";
      nonImageMedia.forEach(function (m) {
        var a = document.createElement("a");
        a.className = "btn btn-outline btn-small";
        a.href = m.media_url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent =
          mediaIcon(m.media_type) + " " + mediaTypeAr(m.media_type) + " — " + (m.caption || "فتح الوسيط");
        footer.appendChild(a);
      });
      card.appendChild(footer);
    } else if (imgMedia && imgMedia.media_url) {
      var imgFooter = document.createElement("div");
      imgFooter.className = "memory-card-footer";
      var imgBtn = document.createElement("a");
      imgBtn.className = "btn btn-outline btn-small";
      imgBtn.href = imgMedia.media_url;
      imgBtn.target = "_blank";
      imgBtn.rel = "noopener noreferrer";
      imgBtn.textContent = "📷 فتح الصورة";
      imgFooter.appendChild(imgBtn);
      card.appendChild(imgFooter);
    }

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
        var kindHit =
          kind === activeKind || media.some(function (m) { return text(m.media_type) === activeKind; });
        if (!kindHit) return false;
      }

      if (!q) return true;
      var hay = [
        text(item.person_name),
        text(item.title),
        text(item.description),
        text(item.story_text),
        text(item.branch_key),
        text(item.person_lineage)
      ]
        .join(" ")
        .toLowerCase();

      return hay.indexOf(q) >= 0;
    });
  }

  function renderList() {
    var list = document.getElementById("memory-list");
    if (!list) return;

    var rows = filteredItems();
    list.innerHTML = "";
    setText("memory-list-count", rows.length);

    if (!rows.length) {
      setListMessage("لا توجد نتائج مطابقة لخيارات العرض الحالية.", "🔍");
      return;
    }

    rows.forEach(function (item) {
      list.appendChild(renderMemory(item));
    });
  }

  async function loadMemories() {
    showLoading("memory-list");
    showLoading("memory-people");

    var sb = getClient();
    if (!sb) {
      setListMessage("تعذر الاتصال بالخدمة.", "⚠️");
      return;
    }

    var query = sb
      .from("family_memory_items")
      .select(
        "id,branch_key,person_id,person_name,person_lineage,title,description,story_text,memory_kind,memory_date,memory_year,is_featured,display_order,submitted_by_name,submitted_by_phone,submitted_by_relation,created_at,family_memory_media(media_type,media_url,thumbnail_url,caption,display_order)"
      )
      .eq("status", "approved")
      .order("is_featured", { ascending: false })
      .order("display_order", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(120);

    var res = await query;
    if (res.error) {
      console.error(res.error);
      setListMessage("تعذر تحميل الذكريات حاليًا.", "⚠️");
      return;
    }

    allItems = Array.isArray(res.data) ? res.data : [];

    updateStats(allItems);
    renderPeople(allItems);

    if (!allItems.length) {
      setListMessage("لا توجد مواد معتمدة في من الذاكرة حاليًا.", "🕊️");
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
      setListMessage("تعذر تحميل الذكريات.", "⚠️");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
