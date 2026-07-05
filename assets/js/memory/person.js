(function () {
  let sbClient = null;
  let allItems = [];
  let activeKind = "";

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
    const el = document.getElementById(id);
    if (el) el.textContent = String(value || 0);
  }

  function setMessage(msg) {
    const list = document.getElementById("person-memory-list");
    if (!list) return;
    list.innerHTML = "";
    const div = document.createElement("div");
    div.className = "memory-empty";
    div.textContent = msg;
    list.appendChild(div);
  }

  function mediaLabel(type) {
    if (type === "video") return "فيديو";
    if (type === "audio") return "صوت";
    if (type === "document") return "وثيقة";
    if (type === "story") return "قصة";
    return "صورة";
  }

  function updateHeader(items) {
    const first = items[0] || {};
    const name = text(first.person_name || getParam("person_name") || "شخصية من الذاكرة");
    const branch = text(first.branch_key || "");
    const lineage = text(first.person_lineage || "");

    const title = document.getElementById("person-title");
    const subtitle = document.getElementById("person-subtitle");

    if (title) title.textContent = name;
    if (subtitle) {
      subtitle.textContent = [branch ? "الفرع: " + branch : "", lineage ? "النسب: " + lineage : ""]
        .filter(Boolean)
        .join(" — ") || "توثيق المواد الخاصة بهذه الشخصية.";
    }
  }

  function updateStats(items) {
    let images = 0, videos = 0, audios = 0, stories = 0, docs = 0;

    items.forEach((item) => {
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

    setText("stat-images", images);
    setText("stat-videos", videos);
    setText("stat-audios", audios);
    setText("stat-stories", stories);
    setText("stat-docs", docs);
    setText("stat-total", items.length);
  }

  function renderItem(item) {
    const card = document.createElement("article");
    card.className = "memory-card";

    const title = document.createElement("div");
    title.className = "memory-card-title";
    title.textContent = text(item.title || mediaLabel(item.memory_kind));

    const meta = document.createElement("div");
    meta.className = "memory-card-meta";
    meta.textContent = [
      item.branch_key ? "الفرع: " + item.branch_key : "",
      item.memory_year ? "السنة: " + item.memory_year : "",
      item.memory_kind ? "النوع: " + mediaLabel(item.memory_kind) : ""
    ].filter(Boolean).join(" — ");

    const desc = document.createElement("div");
    desc.className = "memory-card-desc";
    desc.textContent = text(item.description || item.story_text || "");

    card.appendChild(title);
    card.appendChild(meta);
    if (desc.textContent) card.appendChild(desc);

    const media = Array.isArray(item.family_memory_media) ? item.family_memory_media : [];
    media.forEach((m) => {
      if (!m.media_url) return;
      const a = document.createElement("a");
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
    const list = document.getElementById("person-memory-list");
    if (!list) return;

    const rows = allItems.filter((item) => {
      const media = Array.isArray(item.family_memory_media) ? item.family_memory_media : [];
      return !activeKind || item.memory_kind === activeKind || media.some((m) => m.media_type === activeKind);
    });

    list.innerHTML = "";
    if (!rows.length) return setMessage("لا توجد مواد في هذا القسم حالياً.");
    rows.forEach((item) => list.appendChild(renderItem(item)));
  }

  async function loadPerson() {
    const sb = getClient();
    if (!sb) return setMessage("تعذر الاتصال بالخدمة.");

    const personId = text(getParam("person_id"));
    const personName = text(getParam("person_name"));

    if (!personId && !personName) return setMessage("لم يتم تحديد الشخصية.");

    let query = sb
      .from("family_memory_items")
      .select("id,branch_key,person_id,person_name,person_lineage,title,description,story_text,memory_kind,memory_year,is_featured,display_order,created_at,family_memory_media(media_type,media_url,thumbnail_url,caption,display_order)")
      .eq("status", "approved")
      .order("is_featured", { ascending: false })
      .order("display_order", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(200);

    if (personId) query = query.eq("person_id", personId);
    else query = query.ilike("person_name", "%" + personName + "%");

    const { data, error } = await query;
    if (error) return setMessage("تعذر تحميل مواد الشخصية حالياً.");

    allItems = Array.isArray(data) ? data : [];
    updateHeader(allItems);
    updateStats(allItems);

    if (!allItems.length) return setMessage("لا توجد مواد معتمدة لهذه الشخصية حالياً.");
    applyFilter();
  }

  function bindUi() {
    document.querySelectorAll(".memory-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".memory-tab").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        activeKind = text(btn.getAttribute("data-kind"));
        applyFilter();
      });
    });
  }

  function start() {
    bindUi();
    loadPerson().catch(() => setMessage("تعذر تحميل مواد الشخصية."));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
