(function () {
  let sbClient = null;

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

  function setMessage(msg) {
    const list = document.getElementById("memory-list");
    if (!list) return;
    list.innerHTML = "";
    const div = document.createElement("div");
    div.className = "event-meta";
    div.textContent = msg;
    list.appendChild(div);
  }

  function mediaIcon(type) {
    if (type === "video") return "🎥";
    if (type === "audio") return "🎙️";
    if (type === "document") return "📄";
    return "📷";
  }


  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value || 0);
  }

  function updateStats(items) {
    const people = new Set();
    let images = 0, videos = 0, audios = 0, stories = 0, docs = 0;

    items.forEach((item) => {
      const personKey = text(item.person_id || item.person_name);
      if (personKey) people.add(personKey);

      if (item.memory_kind === "image") images++;
      if (item.memory_kind === "video") videos++;
      if (item.memory_kind === "audio") audios++;
      if (item.memory_kind === "story") stories++;
      if (item.memory_kind === "document") docs++;

      const media = Array.isArray(item.family_memory_media) ? item.family_memory_media : [];
      media.forEach((m) => {
        if (m.media_type === "image") images++;
        if (m.media_type === "video") videos++;
        if (m.media_type === "audio") audios++;
        if (m.media_type === "document") docs++;
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
    const wrap = document.getElementById("memory-people");
    if (!wrap) return;
    wrap.innerHTML = "";

    const people = new Map();

    items.forEach((item) => {
      const key = text(item.person_id || item.person_name);
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

      const p = people.get(key);
      if (item.memory_kind === "image") p.images++;
      if (item.memory_kind === "video") p.videos++;
      if (item.memory_kind === "story") p.stories++;

      const media = Array.isArray(item.family_memory_media) ? item.family_memory_media : [];
      media.forEach((m) => {
        if (m.media_type === "image") p.images++;
        if (m.media_type === "video") p.videos++;
      });
    });

    const rows = Array.from(people.values()).slice(0, 12);

    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "event-meta";
      empty.textContent = "لا توجد شخصيات موثقة حالياً.";
      wrap.appendChild(empty);
      return;
    }

    rows.forEach((p) => {
      const card = document.createElement("article");
      card.className = "event-item";

      const title = document.createElement("div");
      title.className = "event-title";
      title.textContent = p.name;

      const meta = document.createElement("div");
      meta.className = "event-meta";
      meta.textContent = [
        p.branch ? "الفرع: " + p.branch : "",
        "صور: " + p.images,
        "فيديو: " + p.videos,
        "قصص: " + p.stories
      ].filter(Boolean).join(" — ");

      const link = document.createElement("a");
      link.className = "btn btn-outline btn-sm";
      link.href = "person.html?" + (p.id ? "person_id=" + encodeURIComponent(p.id) : "person_name=" + encodeURIComponent(p.name));
      link.textContent = "فتح السيرة";

      card.appendChild(title);
      card.appendChild(meta);
      card.appendChild(link);
      wrap.appendChild(card);
    });
  }

  function renderMemory(item) {
    const card = document.createElement("article");
    card.className = "event-item";

    const title = document.createElement("div");
    title.className = "event-title";
    title.textContent = text(item.title || item.person_name || "ذكرى");

    const meta = document.createElement("div");
    meta.className = "event-meta";
    meta.textContent = [
      item.person_name ? "الاسم: " + item.person_name : "",
      item.branch_key ? "الفرع: " + item.branch_key : "",
      item.memory_year ? "السنة: " + item.memory_year : ""
    ].filter(Boolean).join(" — ");

    const desc = document.createElement("div");
    desc.className = "event-meta";
    desc.textContent = text(item.description || item.story_text || "");

    card.appendChild(title);
    card.appendChild(meta);
    if (desc.textContent) card.appendChild(desc);

    const media = Array.isArray(item.family_memory_media) ? item.family_memory_media : [];
    media.forEach((m) => {
      const a = document.createElement("a");
      a.className = "btn btn-outline btn-sm";
      a.href = m.media_url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = mediaIcon(m.media_type) + " — " + (m.caption || "فتح الوسائط");
      card.appendChild(a);
    });

    return card;
  }

  async function loadMemories() {
    const list = document.getElementById("memory-list");
    const subtitle = document.getElementById("memory-subtitle");
    const sb = getClient();
    if (!list) return;
    if (!sb) return setMessage("تعذر الاتصال بالخدمة.");

    const personId = text(getParam("person_id"));
    const personName = text(getParam("person_name"));
    const branch = text(getParam("branch"));

    if (subtitle && (personName || branch)) {
      subtitle.textContent = ["ذكريات", personName, branch ? "فرع " + branch : ""].filter(Boolean).join(" — ");
    }

    let query = sb
      .from("family_memory_items")
      .select("id,branch_key,person_id,person_name,person_lineage,title,description,story_text,memory_kind,memory_year,is_featured,display_order,created_at,family_memory_media(media_type,media_url,thumbnail_url,caption,display_order)")
      .eq("status", "approved")
      .order("is_featured", { ascending: false })
      .order("display_order", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(50);

    if (personId) query = query.eq("person_id", personId);
    else if (personName) query = query.ilike("person_name", "%" + personName + "%");
    else if (branch) query = query.eq("branch_key", branch);

    const { data, error } = await query;
    if (error) return setMessage("تعذر تحميل الذكريات حالياً.");

    const rows = Array.isArray(data) ? data : [];
    updateStats(rows);
    renderPeople(rows);

    if (!rows.length) return setMessage("لا توجد مواد معتمدة في من الذاكرة حالياً.");

    list.innerHTML = "";
    rows.forEach((item) => list.appendChild(renderMemory(item)));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => loadMemories().catch(() => setMessage("تعذر تحميل الذكريات.")));
  } else {
    loadMemories().catch(() => setMessage("تعذر تحميل الذكريات."));
  }
})();
