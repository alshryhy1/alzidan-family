
(function(){
const style=document.createElement("style");
style.id="quality-severity-style";
style.textContent=`
.requests-stat-card.sev-critical{
background:#fff2f2!important;
border:2px solid #dc2626!important;
}
.requests-stat-card.sev-critical strong,
.requests-stat-card.sev-critical span{
color:#b91c1c!important;
}

.requests-stat-card.sev-medium{
background:#fffbea!important;
border:2px solid #eab308!important;
}
.requests-stat-card.sev-medium strong,
.requests-stat-card.sev-medium span{
color:#a16207!important;
}

.requests-stat-card.sev-low{
background:#fff7ed!important;
border:2px solid #f97316!important;
}
.requests-stat-card.sev-low strong,
.requests-stat-card.sev-low span{
color:#c2410c!important;
}

.requests-stat-card.sev-ok{
background:#ecfdf5!important;
border:2px solid #16a34a!important;
}
.requests-stat-card.sev-ok strong,
.requests-stat-card.sev-ok span{
color:#166534!important;
}

.batch-list-item.sev-critical{border-right:6px solid #dc2626!important;}
.batch-list-item.sev-medium{border-right:6px solid #eab308!important;}
.batch-list-item.sev-low{border-right:6px solid #f97316!important;}
.batch-list-item.sev-ok{border-right:6px solid #16a34a!important;}
`;
document.head.appendChild(style);
})();

(function () {
  "use strict";

  const BRANCHES = ["زيدان", "مزيد", "زايد", "لاحم", "ملحم"];

  function getClient() {
    if (window.__alzidanConfig && typeof window.__alzidanConfig.getClient === "function") {
      const shared = window.__alzidanConfig.getClient();
      if (shared) return shared;
    }
    if (window.__alzidanSupabaseClient) return window.__alzidanSupabaseClient;
    if (window.__alzidanالخدمةClient) return window.__alzidanالخدمةClient;
    return null;
  }

  function norm(v) {
    return String(v || "").replace(/\s+/g, " ").trim();
  }

  function leaf(path) {
    const parts = norm(path).split("/").map(norm).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : norm(path);
  }

  function normalizeDigits(v) {
    return String(v || "")
      .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 1632))
      .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 1776));
  }

  function extractYear(v) {
    const s = normalizeDigits(v);
    const m = s.match(/(12|13|14|15|19|20)\d{2}/);
    return m ? Number(m[0]) : null;
  }

  function approxGregorianYear(year) {
    if (!Number.isFinite(year)) return null;
    if (year >= 1200 && year <= 1700) return Math.round((year * 0.970224) + 621.5774);
    return year;
  }

  function rowChild(row) {
    return norm(row.child_name || row.name);
  }

  function rowParent(row) {
    return norm(row.parent_name || row.parent);
  }

  function childLabel(row) {
    return leaf(rowChild(row)) || "اسم غير محدد";
  }

  function issue(rule, severity, row, message) {
    return {
      rule,
      severity,
      branch: norm(row && row.branch_key),
      person: row ? childLabel(row) : "",
      parent: row ? leaf(rowParent(row)) : "",
      rawParent: row ? rowParent(row) : "",
      rawChild: row ? rowChild(row) : "",
      id: row && row.id != null ? String(row.id) : "",
      personId: row && row.person_id ? String(row.person_id) : "",
      message
    };
  }

  const QUALITY_RULES = [
    {
      id: "missing-name",
      label: "بدون اسم",
      severity: "critical",
      canFix: false,
      fixType: null,
      run(rows) {
        return rows.filter(r => !rowChild(r)).map(r => issue(this.label, this.severity, r, "سجل بدون اسم شخص."));
      }
    },
    {
      id: "missing-parent",
      label: "بدون أب/والد",
      severity: "critical",
      canFix: false,
      fixType: null,
      run(rows) {
        return rows.filter(r => !rowParent(r)).map(r => issue(this.label, this.severity, r, "شخص بلا والد/مسار أب."));
      }
    },
    {
      id: "missing-branch",
      label: "بدون فرع",
      severity: "critical",
      canFix: false,
      fixType: null,
      run(rows) {
        return rows.filter(r => !norm(r.branch_key)).map(r => issue(this.label, this.severity, r, "شخص بلا فرع."));
      }
    },
    {
      id: "duplicates",
      label: "تشابه أسماء يحتاج مراجعة",
      severity: "low",
      canFix: false,
      fixType: null,
      run(rows) {
        const groups = new Map();
        const out = [];

        rows.forEach(r => {
          const branch = norm(r.branch_key);
          const parent = rowParent(r);
          const child = rowChild(r);
          if (!branch || !parent || !child) return;

          const key = [branch, parent, child].join("|");
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(r);
        });

        groups.forEach(group => {
          if (group.length < 2) return;

          const personIds = new Set(group.map(r => norm(r.person_id)).filter(Boolean));
          const births = new Set(group.map(r => norm(r.birth_date_g || r.birth_date_h || r.birth_year)).filter(Boolean));

          const isStrongDuplicate =
            (personIds.size === 1 && personIds.size > 0) ||
            (births.size === 1 && births.size > 0);

          const level = isStrongDuplicate ? "medium" : "low";
          const msg = isStrongDuplicate
            ? "تطابق قوي: نفس الاسم والأب ومعه نفس معرّف الشخص أو الميلاد."
            : "تشابه أسماء فقط: نفس الفرع والأب والاسم، ويحتاج مراجعة وليس خطأ مؤكد.";

          group.slice(1).forEach(r => out.push(issue(this.label, level, r, msg)));
        });

        return out;
      }
    },
    {
      id: "birth-none",
      label: "بدون أي ميلاد",
      severity: "medium",
      canFix: false,
      fixType: null,
      run(rows) {
        return rows
          .filter(r => !norm(r.birth_date_g) && !norm(r.birth_date_h) && !norm(r.birth_year))
          .map(r => issue(this.label, this.severity, r, "لا يوجد ميلادي ولا هجري ولا سنة."));
      }
    },
    {
      id: "birth-year-only",
      label: "سنة فقط",
      severity: "low",
      canFix: false,
      fixType: null,
      run(rows) {
        return rows
          .filter(r => !norm(r.birth_date_g) && !norm(r.birth_date_h) && norm(r.birth_year))
          .map(r => issue(this.label, this.severity, r, "يوجد سنة فقط بدون تاريخ هجري/ميلادي."));
      }
    },
    {
      id: "birth-gregorian-only",
      label: "ميلادي فقط",
      severity: "low",
      canFix: false,
      fixType: null,
      run(rows) {
        return rows
          .filter(r => norm(r.birth_date_g) && !norm(r.birth_date_h))
          .map(r => issue(this.label, this.severity, r, "يوجد تاريخ ميلادي بدون هجري."));
      }
    },
    {
      id: "birth-hijri-only",
      label: "هجري فقط",
      severity: "low",
      canFix: false,
      fixType: null,
      run(rows) {
        return rows
          .filter(r => !norm(r.birth_date_g) && norm(r.birth_date_h))
          .map(r => issue(this.label, this.severity, r, "يوجد تاريخ هجري بدون ميلادي."));
      }
    },
    {
      id: "invalid-birth",
      label: "ميلاد غير منطقي",
      severity: "critical",
      canFix: false,
      fixType: null,
      run(rows) {
        const current = new Date().getFullYear();
        return rows.filter(r => {
          const y = extractYear(r.birth_date_g || r.birth_date_h || r.birth_year);
          if (!y) return false;
          const g = approxGregorianYear(y);
          return !g || g < 1850 || g > current;
        }).map(r => issue(this.label, this.severity, r, "تاريخ/سنة الميلاد تحتاج مراجعة."));
      }
    },
    {
      id: "death-before-birth",
      label: "وفاة قبل الميلاد",
      severity: "critical",
      canFix: false,
      fixType: null,
      run(rows) {
        return rows.filter(r => {
          const b = extractYear(r.birth_date_g || r.birth_date_h || r.birth_year);
          const d = extractYear(r.death_date_g || r.death_date_h);
          if (!b || !d) return false;
          const bg = approxGregorianYear(b);
          const dg = approxGregorianYear(d);
          return bg && dg && dg < bg;
        }).map(r => issue(this.label, this.severity, r, "تاريخ الوفاة أقدم من تاريخ الميلاد."));
      }
    },
    {
      id: "father-younger-than-child",
      label: "الأب أصغر من الابن",
      severity: "critical",
      canFix: false,
      fixType: null,
      run(rows) {
        const byChild = new Map();
        rows.forEach(r => {
          const c = rowChild(r);
          if (c) byChild.set(c, r);
        });

        const out = [];
        rows.forEach(r => {
          const parentRow = byChild.get(rowParent(r));
          if (!parentRow) return;

          const py = extractYear(parentRow.birth_date_g || parentRow.birth_date_h || parentRow.birth_year);
          const cy = extractYear(r.birth_date_g || r.birth_date_h || r.birth_year);
          if (!py || !cy) return;

          const pg = approxGregorianYear(py);
          const cg = approxGregorianYear(cy);
          if (pg && cg && pg >= cg) {
            out.push(issue(this.label, this.severity, r, "ميلاد الأب يساوي أو بعد ميلاد الابن."));
          }
        });
        return out;
      }
    },
    {
      id: "missing-city",
      label: "ناقص المدينة",
      severity: "low",
      canFix: false,
      fixType: null,
      run(rows) {
        return rows.filter(r => !norm(r.city)).map(r => issue(this.label, this.severity, r, "لا توجد مدينة."));
      }
    },
    {
      id: "missing-birth-order",
      label: "بدون ترتيب ميلاد",
      severity: "low",
      canFix: false,
      fixType: null,
      run(rows) {
        return rows.filter(r => r.birth_order == null || norm(r.birth_order) === "").map(r => issue(this.label, this.severity, r, "لا يوجد ترتيب ميلاد."));
      }
    },
    {
      id: "invalid-birth-order",
      label: "ترتيب ميلاد غير منطقي",
      severity: "medium",
      canFix: false,
      fixType: null,
      run(rows) {
        return rows.filter(r => {
          if (r.birth_order == null || norm(r.birth_order) === "") return false;
          const n = Number(normalizeDigits(r.birth_order));
          return !Number.isFinite(n) || n < 1 || n > 30;
        }).map(r => issue(this.label, this.severity, r, "ترتيب الميلاد خارج النطاق المتوقع."));
      }
    }
  ];

  function ensureSection() {
    if (document.getElementById("admin-quality-center")) return;

    const host = document.getElementById("admin-protected-sections") || document.querySelector(".page");
    if (!host) return;

    const section = document.createElement("section");
    section.id = "admin-quality-center";
    section.className = "section protected-section admin-only-section";
    section.innerHTML = `
      <div class="section-header">
        <div>
          <div class="section-title">مركز جودة الشجرة</div>
          <div class="hint">محرك فحص إداري لقواعد جودة البيانات. قراءة فقط ولا يغيّر أي بيانات.</div>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button id="quality-refresh-btn" class="btn btn-outline btn-sm" type="button">تشغيل الفحص</button>
          <button id="quality-preview-fix-btn" class="btn btn-outline btn-sm" type="button">معاينة الإصلاح</button>
          <button id="quality-run-fix-btn" class="btn btn-primary btn-sm" type="button" disabled>تنفيذ الإصلاح</button>
        </div>
      </div>
      <div class="card">
        <div id="quality-status" class="hint">اضغط تشغيل الفحص.</div>
        <div id="quality-fix-status" class="hint" style="margin-top:8px;">الإصلاحات الجماعية غير مفعلة بعد.</div>
        <div id="quality-summary" class="requests-stats-cards" style="margin-top:12px;"></div>
        <div class="section-title" style="margin-top:16px;">تفصيل القواعد</div>
        <div id="quality-rules" class="requests-stats-cards" style="margin-top:10px;"></div>
        <div class="section-title" style="margin-top:16px;">أمثلة تحتاج مراجعة</div>
        <div id="quality-issues" class="batch-list"></div>
      </div>
    `;

    const before = document.getElementById("delegate-audit");
    if (before && before.parentNode === host) host.insertBefore(section, before);
    else host.appendChild(section);

    document.getElementById("quality-refresh-btn").addEventListener("click", runQualityCheck);

    const previewBtn = document.getElementById("quality-preview-fix-btn");
    const runFixBtn = document.getElementById("quality-run-fix-btn");
    const fixStatus = document.getElementById("quality-fix-status");

    if (previewBtn) {
      previewBtn.addEventListener("click", () => {
        if (fixStatus) {
          fixStatus.textContent = "المعاينة جاهزة من الواجهة، لكن RPC الإصلاح لم يُفعّل بعد.";
        }
        if (runFixBtn) runFixBtn.disabled = true;
      });
    }

    if (runFixBtn) {
      runFixBtn.addEventListener("click", () => {
        if (fixStatus) {
          fixStatus.textContent = "تنفيذ الإصلاح متوقف حتى إضافة admin_quality_fix_v1.";
        }
      });
    }
  }

  function addCard(grid, label, value, sub, onClick) {
    const card = document.createElement("div");
    card.className = "requests-stat-card";
    if(sub==="حرجة") card.classList.add(value==0?"sev-ok":"sev-critical");
    else if(sub==="متوسطة") card.classList.add(value==0?"sev-ok":"sev-medium");
    else if(sub==="بسيطة") card.classList.add(value==0?"sev-ok":"sev-low");

    if (typeof onClick === "function") {
      card.style.cursor = "pointer";
      card.title = "اضغط لعرض هذه الملاحظات فقط";
      card.addEventListener("click", onClick);
    }

    card.innerHTML = "<strong>" + value + "</strong><span>" + label + (sub ? "<br>" + sub : "") + "</span>";
    grid.appendChild(card);
  }

  function severityLabel(v) {
    if (v === "critical") return "حرجة";
    if (v === "medium") return "متوسطة";
    if (v === "low") return "بسيطة";
    return v || "";
  }

  function addIssue(list, item) {
    const el = document.createElement("div");
    el.className="batch-list-item";
el.classList.add(item.severity==="critical"?"sev-critical":
item.severity==="medium"?"sev-medium":
item.severity==="low"?"sev-low":"sev-ok");
    el.style.display = "flex";
    el.style.justifyContent = "space-between";
    el.style.gap = "10px";
    el.style.alignItems = "center";

    const text = document.createElement("span");
    text.innerHTML =
      "<strong>👤 " + item.person + "</strong>" +
      (item.parent ? " <span>👨 الأب: " + item.parent + "</span>" : "") +
      (item.branch ? " <span>🌳 الفرع: " + item.branch + "</span>" : "") +
      (item.id ? " <span>🆔 " + item.id + "</span>" : "") +
      "<br><span>" + severityLabel(item.severity) + " — " + item.rule + " — " + item.message + "</span>";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-outline btn-sm";
    btn.textContent = "فتح الفرع";
    btn.addEventListener("click", () => {
      const branchSelect = document.getElementById("source-tree-branch");
      const loadBtn = document.getElementById("source-tree-load");
      const sourceSection = document.getElementById("source-tree-list");
      if (branchSelect && item.branch) branchSelect.value = item.branch;
      if (loadBtn) loadBtn.click();

      setTimeout(() => {
        const list = document.getElementById("source-tree-list");
        const wanted = String(item.person || "").trim();
        if (list && wanted) {
          const nodes = Array.from(list.querySelectorAll(".source-tree-item"));
          const hit = nodes.find(n => (n.textContent || "").includes(wanted));
          if (hit) {
            hit.scrollIntoView({ behavior: "smooth", block: "center" });
            hit.style.outline = "3px solid #f97316";
            hit.style.outlineOffset = "3px";
            setTimeout(() => { hit.style.outline = ""; hit.style.outlineOffset = ""; }, 3500);
            const edit = hit.querySelector("[data-source-tree-edit]");
            if (edit) edit.click();
            return;
          }
        }
        if (sourceSection) sourceSection.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 900);
    });

    el.appendChild(text);
    el.appendChild(btn);
    list.appendChild(el);
  }

  function calculateScore(rowsCount, issues) {
    if (!rowsCount) return 0;

    const critical = issues.filter(x => x.severity === "critical").length;
    const medium = issues.filter(x => x.severity === "medium").length;
    const low = issues.filter(x => x.severity === "low").length;

    const criticalPenalty = Math.min(45, critical * 7);
    const mediumPenalty = Math.min(30, Math.round((medium / rowsCount) * 35));
    const lowPenalty = Math.min(15, Math.round((low / rowsCount) * 12));

    return Math.max(0, 100 - criticalPenalty - mediumPenalty - lowPenalty);
  }

  async function loadRows(sb) {
    const fieldSets = [
      "id,person_id,parent_person_id,branch_key,parent_name,parent,child_name,name,birth_date_g,birth_date_h,birth_year,birth_order,death_date_g,death_date_h,city,area,is_deceased,deceased,created_at",
      "id,branch_key,parent_name,parent,child_name,name,birth_date_g,birth_date_h,birth_year,birth_order,city,area,is_deceased,deceased,created_at",
      "id,branch_key,parent_name,parent,child_name,name,birth_date_g,birth_date_h,birth_year,city,area,is_deceased,deceased,created_at"
    ];

    let lastError = null;
    for (const fields of fieldSets) {
      const { data, error } = await sb.from("tree_children").select(fields).limit(5000);
      if (!error) return { rows: Array.isArray(data) ? data : [], error: null };
      lastError = error;
      const msg = String(error.message || "").toLowerCase();
      if (!(msg.includes("column") && msg.includes("does not exist"))) break;
    }

    return { rows: [], error: lastError };
  }

  function runRules(rows) {
    const grouped = [];
    let allIssues = [];

    QUALITY_RULES.forEach(rule => {
      const items = rule.run(rows);
      grouped.push({ rule, items });
      allIssues = allIssues.concat(items);
    });

    return { grouped, allIssues };
  }

  function buildQualitySummary(rows, allIssues) {
    const critical = allIssues.filter(x => x.severity === "critical").length;
    const medium = allIssues.filter(x => x.severity === "medium").length;
    const low = allIssues.filter(x => x.severity === "low").length;
    const score = calculateScore(rows.length, allIssues);

    const branchCounts = new Map();
    rows.forEach(r => {
      const b = norm(r.branch_key);
      if (b) branchCounts.set(b, (branchCounts.get(b) || 0) + 1);
    });

    return { critical, medium, low, score, branchCounts };
  }

  async function runQualityCheck() {
    const sb = getClient();
    const status = document.getElementById("quality-status");
    const summary = document.getElementById("quality-summary");
    const rulesBox = document.getElementById("quality-rules");
    const issuesBox = document.getElementById("quality-issues");

    if (!status || !summary || !rulesBox || !issuesBox) return;

    summary.innerHTML = "";
    rulesBox.innerHTML = "";
    issuesBox.innerHTML = "";

    if (!sb) {
      status.textContent = "تعذر الوصول إلى اتصال Supabase.";
      return;
    }

    status.textContent = "جاري الفحص...";

    const loaded = await loadRows(sb);
    if (loaded.error) {
      status.textContent = "تعذر تحميل بيانات الشجرة: " + (loaded.error.message || "خطأ غير معروف");
      return;
    }

    const rows = loaded.rows;
    const { grouped, allIssues } = runRules(rows);
    const { critical, medium, low, score, branchCounts } = buildQualitySummary(rows, allIssues);

    addCard(summary, "إجمالي السجلات", rows.length);
    addCard(summary, "درجة الجودة", score + "%");
    addCard(summary, "حرجة", critical);
    addCard(summary, "متوسطة", medium);
    addCard(summary, "بسيطة", low);
    addCard(summary, "إجمالي الملاحظات", allIssues.length);

    BRANCHES.forEach(b => addCard(summary, "فرع " + b, branchCounts.get(b) || 0));

    const severityOrder = { critical: 1, medium: 2, low: 3 };
    function renderIssuesFor(title, list) {
      issuesBox.innerHTML = "";
      const head = document.createElement("div");
      head.className = "hint";
      head.style.margin = "0 0 10px";
      head.style.display = "flex";
      head.style.justifyContent = "space-between";
      head.style.gap = "8px";
      head.style.flexWrap = "wrap";

      const titleEl = document.createElement("strong");
      titleEl.textContent = title + " (" + String(list.length) + ")";

      const filters = document.createElement("span");
      filters.style.display = "inline-flex";
      filters.style.gap = "6px";
      filters.style.flexWrap = "wrap";

      [
        ["all", "الكل"],
        ["critical", "حرجة"],
        ["medium", "متوسطة"],
        ["low", "بسيطة"]
      ].forEach(([key, label]) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "btn btn-outline btn-sm";
        b.textContent = label;
        b.addEventListener("click", () => {
          const filtered = key === "all" ? list : list.filter(x => x.severity === key);
          renderIssuesFor(title + " / " + label, filtered);
        });
        filters.appendChild(b);
      });

      head.appendChild(titleEl);
      head.appendChild(filters);
      issuesBox.appendChild(head);

      if (!list.length) {
        const ok = document.createElement("div");
        ok.className = "batch-list-item sev-ok";
        ok.textContent = "سليم: لا توجد ملاحظات لهذه القاعدة.";
        issuesBox.appendChild(ok);
        issuesBox.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }

      list
        .slice()
        .sort((a, b) => {
          const sa = severityOrder[a.severity] || 9;
          const sb = severityOrder[b.severity] || 9;
          if (sa !== sb) return sa - sb;
          return String(a.branch || "").localeCompare(String(b.branch || ""), "ar");
        })
        .slice(0, 120)
        .forEach(x => addIssue(issuesBox, x));

      issuesBox.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    grouped
      .slice()
      .sort((a, b) => {
        const sa = severityOrder[a.rule.severity] || 9;
        const sb = severityOrder[b.rule.severity] || 9;
        if (sa !== sb) return sa - sb;
        return b.items.length - a.items.length;
      })
      .forEach(g => {
        addCard(
          rulesBox,
          g.rule.label,
          g.items.length,
          severityLabel(g.rule.severity),
          () => renderIssuesFor(g.rule.label, g.items)
        );
      });

    renderIssuesFor("كل الملاحظات", allIssues);

    status.textContent = "تم الفحص عبر " + QUALITY_RULES.length + " قواعد. النتائج قراءة فقط ولا تغيّر البيانات.";
  }

  document.addEventListener("DOMContentLoaded", ensureSection);
})();
