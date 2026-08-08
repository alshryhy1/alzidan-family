/**
 * Admin Redesign Phase 1 — module shell / router
 * Progressive: keeps existing section DOM + auth/RPC; shows one module at a time.
 */
(function () {
  const STORAGE_KEY = "alzidan_admin_module_v1";

  /** @type {Array<{id:string,title:string,desc:string,icon:string,sections:string[],priority?:boolean,stub?:boolean,phase?:number,group?:string}>} */
  const MODULES = [
    {
      id: "hub",
      title: "لوحة التحكم",
      desc: "مركز الدخول السريع لكل موديولات الإدارة",
      icon: "⌂",
      sections: ["admin-module-hub"],
      priority: true,
      group: "core",
    },
    {
      id: "requests",
      title: "الطلبات",
      desc: "اعتماد ورفض الطلبات وإحصاء المناديب — Workflow واضح",
      icon: "☑",
      sections: ["admin-requests-section", "requests-stats-section"],
      priority: true,
      group: "ops",
    },
    {
      id: "tree",
      title: "الشجرة",
      desc: "إدارة الأشخاص والزوجات والأبناء وإدخال الأسماء الجماعي",
      icon: "🌳",
      sections: ["admin-family-management-section", "bulk-name-audit-section"],
      priority: true,
      group: "data",
    },
    {
      id: "members",
      title: "الأعضاء",
      desc: "جودة بيانات الأعضاء ومراجعة الشجرة",
      icon: "👤",
      sections: ["admin-quality-center"],
      group: "data",
    },
    {
      id: "events",
      title: "المناسبات",
      desc: "الأخبار والمناسبات وشريط الأخبار العامة",
      icon: "📅",
      sections: ["events-source-manager", "banner-messages-manager"],
      group: "content",
    },
    {
      id: "memories",
      title: "الذكريات",
      desc: "مراجعة طابور الذكريات الواردة",
      icon: "🕯",
      sections: ["admin-memory-section"],
      group: "content",
    },
    {
      id: "delegates",
      title: "المندوبون",
      desc: "Delegates v2 — أدوار، فروع، تفعيل/تعطيل، سجل تدقيق",
      icon: "🛡",
      sections: ["admin-module-delegates"],
      phase: 2,
      group: "ops",
    },
    {
      id: "health",
      title: "مركز الصحة",
      desc: "تقرير سلامة البيانات (قراءة فقط)",
      icon: "❤",
      sections: ["health-center-section"],
      priority: true,
      group: "integrity",
    },
    {
      id: "audit",
      title: "مركز السجل",
      desc: "سجل تعديلات المناديب والصلاحيات الحالية",
      icon: "📜",
      sections: ["delegate-audit"],
      group: "integrity",
    },
    {
      id: "special-cards",
      title: "البطاقات الخاصة",
      desc: "إنشاء وإدارة بطاقات المناسبات الخاصة",
      icon: "✦",
      sections: ["special-cards-manager"],
      priority: true,
      group: "content",
    },
    {
      id: "polls",
      title: "التصويت",
      desc: "إدارة مواضيع التصويت العام",
      icon: "📊",
      sections: ["polls-manager"],
      group: "content",
    },
    {
      id: "stats",
      title: "الإحصاءات",
      desc: "زيارات الموقع والتطبيق وإحصائيات المصاهرة",
      icon: "↗",
      sections: ["views-stats-section", "marriage-stats-section"],
      group: "ops",
    },
    {
      id: "tools",
      title: "أدوات الصيانة",
      desc: "مساحة عمل SQL · استيراد · واتساب · مراجعة الشجرة",
      icon: "⚙",
      sections: [
        "sql-workspace-section",
        "batch-tree-sql-section",
        "tree-import-section",
        "file-whatsapp-section",
        "admin-review-shortcut",
      ],
      group: "tools",
    },
  ];

  const SECTION_MODULE = Object.create(null);
  MODULES.forEach((mod) => {
    (mod.sections || []).forEach((sid) => {
      SECTION_MODULE[sid] = mod.id;
    });
  });

  let currentModule = "hub";
  let shellBuilt = false;

  function isAuthed() {
    return document.body.classList.contains("admin-authenticated");
  }

  function readStoredModule() {
    try {
      const v = String(sessionStorage.getItem(STORAGE_KEY) || "").trim();
      if (MODULES.some((m) => m.id === v)) return v;
    } catch (_) {}
    return "hub";
  }

  function storeModule(id) {
    try {
      sessionStorage.setItem(STORAGE_KEY, id);
    } catch (_) {}
  }

  function ensureSectionTags() {
    MODULES.forEach((mod) => {
      (mod.sections || []).forEach((sid) => {
        const el = document.getElementById(sid);
        if (!el) return;
        el.setAttribute("data-admin-module", mod.id);
      });
    });

    // Visit stats historically had no id — patched in HTML; fallback by title
    const views = document.getElementById("views-stats-section");
    if (views) views.setAttribute("data-admin-module", "stats");

    const quality = document.getElementById("admin-quality-center");
    if (quality) quality.setAttribute("data-admin-module", "members");
  }

  function buildSidebar() {
    if (shellBuilt) return;
    const page = document.querySelector(".page");
    if (!page) return;

    const aside = document.createElement("aside");
    aside.id = "admin-shell-sidebar";
    aside.setAttribute("aria-label", "موديولات الإدارة");
    aside.innerHTML =
      '<div class="admin-shell-brand"><strong>مراكز الإدارة</strong><span>المرحلة 1 مكتملة الأساس · المرحلة 2 جارية</span></div>' +
      '<nav class="admin-shell-nav" id="admin-shell-nav"></nav>';

    const login = document.getElementById("admin-login-section");
    const header = page.querySelector("header");
    const anchor = login || header;
    if (anchor && anchor.nextSibling) {
      page.insertBefore(aside, anchor.nextSibling);
    } else if (anchor) {
      anchor.insertAdjacentElement("afterend", aside);
    } else {
      page.insertBefore(aside, page.firstChild);
    }

    const nav = aside.querySelector("#admin-shell-nav");
    MODULES.forEach((mod) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "admin-shell-nav-btn";
      btn.dataset.module = mod.id;
      btn.innerHTML =
        '<span class="mod-ico" aria-hidden="true">' +
        mod.icon +
        "</span><span>" +
        mod.title +
        "</span>" +
        (mod.stub
          ? '<span class="mod-badge">قريبًا</span>'
          : "");
      btn.addEventListener("click", () => navigate(mod.id));
      nav.appendChild(btn);
    });

    // Mobile toggle in header nav
    if (header) {
      const navEl = header.querySelector("nav");
      if (navEl && !document.getElementById("admin-shell-menu-btn")) {
        const toggle = document.createElement("button");
        toggle.id = "admin-shell-menu-btn";
        toggle.type = "button";
        toggle.className = "btn btn-outline btn-sm admin-shell-mobile-toggle";
        toggle.textContent = "الموديولات";
        toggle.addEventListener("click", () => {
          document.body.classList.toggle("admin-shell-nav-open");
        });
        navEl.insertBefore(toggle, navEl.firstChild);
      }
      // Replace old in-page anchors with module jumps
      navEl.querySelectorAll("a[href^='#']").forEach((a) => {
        const href = a.getAttribute("href") || "";
        if (href.includes("memory")) {
          a.addEventListener("click", (e) => {
            e.preventDefault();
            navigate("memories");
          });
        } else if (href.includes("health")) {
          a.addEventListener("click", (e) => {
            e.preventDefault();
            navigate("health");
          });
        } else if (href.includes("polls")) {
          a.addEventListener("click", (e) => {
            e.preventDefault();
            navigate("polls");
          });
        }
      });
    }

    ensureHubPanel();
    ensureDelegatesHost();
    shellBuilt = true;
  }

  function ensureHubPanel() {
    if (document.getElementById("admin-module-hub")) return;
    const host =
      document.getElementById("admin-protected-sections") ||
      document.querySelector(".page");
    if (!host) return;

    const section = document.createElement("section");
    section.id = "admin-module-hub";
    section.className = "section admin-only-section";
    section.setAttribute("data-admin-module", "hub");

    const priority = MODULES.filter((m) => m.id !== "hub");
    const cards = priority
      .map((m) => {
        return (
          '<button type="button" class="admin-hub-card' +
          (m.stub ? " is-stub" : "") +
          '" data-go-module="' +
          m.id +
          '">' +
          '<div class="hub-ico" aria-hidden="true">' +
          m.icon +
          "</div><strong>" +
          m.title +
          "</strong><span>" +
          m.desc +
          "</span>" +
          '<div class="hub-meta">' +
          (m.stub
            ? "قريبًا"
            : m.phase === 2
              ? "المرحلة 2 — افتح"
              : "افتح الموديول") +
          "</div></button>"
        );
      })
      .join("");

    section.innerHTML =
      '<div class="admin-hub-hero">' +
      "<h1>لوحة تحكم عائلة الزيدان</h1>" +
      "<p>اختر مركزًا مستقلًا. أساس المرحلة 1 جاهز؛ موديول المندوبين يعمل الآن ضمن Delegates v2.</p>" +
      '<div class="admin-workflow-strip">' +
      '<span class="admin-workflow-chip">١ مراجعة</span>' +
      '<span class="admin-workflow-chip">٢ اعتماد</span>' +
      '<span class="admin-workflow-chip">٣ تطبيق متحقَّق</span>' +
      '<span class="admin-workflow-chip">٤ سجل / صحة</span>' +
      "</div></div>" +
      '<div class="admin-hub-grid">' +
      cards +
      "</div>";

    section.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-go-module]");
      if (!btn) return;
      navigate(btn.getAttribute("data-go-module"));
    });

    const firstSection = host.querySelector("section");
    if (firstSection) host.insertBefore(section, firstSection);
    else host.appendChild(section);
  }

  function ensureDelegatesHost() {
    // Host section only — UI filled by modules/admin-delegates-v2.js (Phase 2)
    if (document.getElementById("admin-module-delegates")) return;
    const host =
      document.getElementById("admin-protected-sections") ||
      document.querySelector(".page");
    if (!host) return;

    const section = document.createElement("section");
    section.id = "admin-module-delegates";
    section.className = "section admin-only-section";
    section.setAttribute("data-admin-module", "delegates");
    section.innerHTML =
      '<div class="section-header"><div>' +
      '<div class="section-title">المندوبون — Delegates v2</div>' +
      '<div class="hint">جاري تجهيز الواجهة…</div>' +
      "</div></div>";
    host.appendChild(section);
  }

  function applyVisibility() {
    ensureSectionTags();
    const authed = isAuthed();
    document.body.classList.toggle("admin-shell-ready", true);

    if (!authed) {
      document.querySelectorAll("section[data-admin-module]").forEach((sec) => {
        sec.classList.remove("admin-module-off");
      });
      document.body.classList.remove("admin-shell-nav-open");
      return;
    }

    const mod = MODULES.find((m) => m.id === currentModule) || MODULES[0];
    const activeIds = new Set(mod.sections || []);

    document.querySelectorAll("section[data-admin-module]").forEach((sec) => {
      const mid = sec.getAttribute("data-admin-module");
      const on = mid === mod.id || activeIds.has(sec.id);
      sec.classList.toggle("admin-module-off", !on);
    });

    // Untagged sections inside protected area: hide when shell routing
    document
      .querySelectorAll("#admin-protected-sections > section:not([data-admin-module])")
      .forEach((sec) => {
        // keep dialogs alone; hide unknown sprawl into tools if maintenance
        if (sec.hasAttribute("data-maintenance") || sec.classList.contains("extra-tools-section")) {
          sec.classList.toggle("admin-module-off", mod.id !== "tools");
          sec.setAttribute("data-admin-module", "tools");
        } else {
          sec.classList.add("admin-module-off");
        }
      });

    // Reveal maintenance blocks only inside Tools module
    document.querySelectorAll("section[data-admin-module=\"tools\"]").forEach((sec) => {
      if (mod.id === "tools") {
        if (sec.style && sec.style.getPropertyValue("display") === "none") {
          sec.dataset.shellPrevDisplay = "none";
          sec.style.removeProperty("display");
        }
        sec.classList.remove("admin-module-off");
      } else if (sec.dataset.shellPrevDisplay === "none") {
        sec.style.setProperty("display", "none", "important");
      }
    });

    document.querySelectorAll(".admin-shell-nav-btn").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.module === mod.id);
    });
  }

  function navigate(moduleId, opts) {
    const id = String(moduleId || "hub").trim();
    if (!MODULES.some((m) => m.id === id)) return;
    currentModule = id;
    storeModule(id);
    if (!(opts && opts.skipHash)) {
      try {
        const url = new URL(window.location.href);
        url.hash = "module=" + id;
        history.replaceState(null, "", url.pathname + url.search + url.hash);
      } catch (_) {}
    }
    applyVisibility();
    document.body.classList.remove("admin-shell-nav-open");
    window.scrollTo({ top: 0, behavior: "smooth" });
    document.dispatchEvent(
      new CustomEvent("alzidan:admin-module", { detail: { id: currentModule } }),
    );
  }

  function moduleFromHash() {
    const h = String(window.location.hash || "").replace(/^#/, "");
    if (h.startsWith("module=")) {
      const id = decodeURIComponent(h.slice(7));
      if (MODULES.some((m) => m.id === id)) return id;
    }
    // Legacy deep links
    if (h.includes("memory")) return "memories";
    if (h.includes("health")) return "health";
    if (h.includes("polls")) return "polls";
    if (h.includes("special-cards")) return "special-cards";
    if (h.includes("admin-family") || h.includes("family")) return "tree";
    if (h.includes("requests")) return "requests";
    return "";
  }

  function syncFromAuth() {
    buildSidebar();
    if (isAuthed()) {
      const fromHash = moduleFromHash();
      currentModule = fromHash || readStoredModule() || "hub";
    }
    applyVisibility();
  }

  function boot() {
    buildSidebar();
    currentModule = moduleFromHash() || readStoredModule() || "hub";
    syncFromAuth();

    const obs = new MutationObserver(() => syncFromAuth());
    obs.observe(document.body, { attributes: true, attributeFilter: ["class"] });

    window.addEventListener("hashchange", () => {
      const id = moduleFromHash();
      if (id) navigate(id, { skipHash: true });
    });

    // Quality center is injected late — retag when it appears
    const protectedHost = document.getElementById("admin-protected-sections");
    if (protectedHost) {
      const childObs = new MutationObserver(() => {
        ensureSectionTags();
        applyVisibility();
      });
      childObs.observe(protectedHost, { childList: true });
    }

    window.AlzidanAdminShell = {
      modules: MODULES,
      navigate,
      getCurrent: () => currentModule,
      refresh: applyVisibility,
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
