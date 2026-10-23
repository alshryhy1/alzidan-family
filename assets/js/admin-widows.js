(() => {
  "use strict";

  const BRANCHES = ["زيدان", "مزيد", "زايد", "لاحم", "ملحم"];
  const MINOR_AGE = 18;
  let rowsCache = [];
  let loading = false;
  let bound = false;

  function getAdminToken() {
    if (window.AlzidanAuth && typeof window.AlzidanAuth.getAdminToken === "function") {
      return String(window.AlzidanAuth.getAdminToken() || "").trim();
    }
    return "";
  }

  function getClient() {
    if (window.AlzidanAdminCore && typeof window.AlzidanAdminCore.getClient === "function") {
      return window.AlzidanAdminCore.getClient();
    }
    if (window.__alzidanConfig && typeof window.__alzidanConfig.getClient === "function") {
      return window.__alzidanConfig.getClient();
    }
    return window.__alzidanSupabaseClient || null;
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function isActiveSpouse(status) {
    const SpousesCore = window.AlzidanSpousesCore || {};
    if (typeof SpousesCore.isActiveSpouse === "function") {
      return SpousesCore.isActiveSpouse(status);
    }
    const value = String(status || "active").trim().toLowerCase();
    return !value || value === "active";
  }

  function parseTruthy(v) {
    if (v === true || v === 1) return true;
    if (v === false || v == null || v === 0) return false;
    const s = String(v).trim().toLowerCase();
    return (
      s === "true" ||
      s === "t" ||
      s === "1" ||
      s === "yes" ||
      s === "نعم" ||
      s === "متوفي" ||
      s === "متوفى" ||
      s === "متوفاة"
    );
  }

  function isDeceasedRow(row) {
    if (!row) return false;
    return (
      parseTruthy(row.is_deceased) ||
      parseTruthy(row.deceased) ||
      parseTruthy(row.is_dead) ||
      parseTruthy(row.dead) ||
      !!String(row.death_date_g || row.death_date || "").trim() ||
      !!String(row.death_date_h || "").trim()
    );
  }

  function leafName(path) {
    const parts = String(path || "")
      .split("/")
      .map((p) => p.trim())
      .filter(Boolean);
    return parts.length ? parts[parts.length - 1] : String(path || "").trim();
  }

  function currentHijriYear() {
    try {
      return Number(
        new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { year: "numeric" })
          .format(new Date())
          .replace(/\D/g, ""),
      );
    } catch (e) {
      return 1447;
    }
  }

  function ageFromChild(child) {
    const g = String(child.birth_date_g || child.birth_date || "").trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(g)) {
      const born = new Date(g.slice(0, 10) + "T00:00:00");
      if (!Number.isNaN(born.getTime())) {
        const now = new Date();
        let age = now.getFullYear() - born.getFullYear();
        const m = now.getMonth() - born.getMonth();
        if (m < 0 || (m === 0 && now.getDate() < born.getDate())) age -= 1;
        if (age >= 0 && age <= 120) return age;
      }
    }
    const hRaw = String(child.birth_date_h || "").trim();
    const hMatch = hRaw.match(/(\d{3,4})/);
    const hYear = hMatch ? Number(hMatch[1]) : Number(child.birth_year || 0) || 0;
    if (hYear >= 1200 && hYear <= 1600) {
      const age = currentHijriYear() - hYear;
      if (age >= 0 && age <= 120) return age;
    }
    return null;
  }

  function phoneDigits(phone) {
    return String(phone || "").replace(/\D/g, "");
  }

  function whatsAppUrl(phone) {
    let d = phoneDigits(phone);
    if (!d) return "";
    if (d.length === 9 && d.startsWith("5")) d = "966" + d;
    if (d.startsWith("0") && d.length === 10) d = "966" + d.slice(1);
    return "https://wa.me/" + d;
  }

  function formatPhoneDisplay(phone) {
    const d = phoneDigits(phone);
    if (!d) return "—";
    if (window.AlzidanPhoneIntl && typeof window.AlzidanPhoneIntl.canonicalizePhone === "function") {
      return window.AlzidanPhoneIntl.canonicalizePhone(phone) || phone || "—";
    }
    return phone || "—";
  }

  function setStatus(text, isError) {
    const el = document.getElementById("admin-widows-status");
    if (!el) return;
    el.textContent = text || "";
    el.style.color = isError ? "#991b1b" : "";
  }

  function setCount(n, shown) {
    const el = document.getElementById("admin-widows-count");
    if (!el) return;
    if (shown != null && shown !== n) {
      el.textContent = "أرامل مسجّلات: " + String(n) + " · المعروض: " + String(shown);
    } else {
      el.textContent = "أرامل مسجّلات: " + String(n);
    }
  }

  function readFilters() {
    return {
      branch: String((document.getElementById("admin-widows-branch") || {}).value || "").trim(),
      phone: String((document.getElementById("admin-widows-phone-filter") || {}).value || "all").trim(),
      minors: String((document.getElementById("admin-widows-minors-filter") || {}).value || "all").trim(),
      q: String((document.getElementById("admin-widows-search") || {}).value || "").trim(),
    };
  }

  function foldAr(value) {
    return String(value || "")
      .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
      .replace(/[أإآٱ]/g, "ا")
      .replace(/ى/g, "ي")
      .replace(/ة/g, "ه")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function applyFilters(rows) {
    const f = readFilters();
    const q = foldAr(f.q);
    return rows.filter((row) => {
      if (f.branch && row.branchKey !== f.branch) return false;
      if (f.phone === "with" && !row.hasPhone) return false;
      if (f.phone === "without" && row.hasPhone) return false;
      if (f.minors === "yes" && !row.hasMinors) return false;
      if (f.minors === "no" && row.hasMinors) return false;
      if (q) {
        const hay = foldAr(
          [row.wifeName, row.husbandName, row.branchKey, row.phone, row.wifeFamilyName].join(" "),
        );
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function renderTable(rows) {
    const body = document.getElementById("admin-widows-body");
    if (!body) return;
    const list = applyFilters(rows);
    setCount(rows.length, list.length);
    if (!list.length) {
      body.innerHTML =
        '<tr><td colspan="7" class="hint">لا توجد أرامل مطابقة للفلتر الحالي.</td></tr>';
      return;
    }
    body.innerHTML = list
      .map((row) => {
        const wa = whatsAppUrl(row.phone);
        const phoneCell = row.hasPhone
          ? esc(formatPhoneDisplay(row.phone)) +
            (wa
              ? ' <a class="btn btn-outline btn-sm" href="' +
                esc(wa) +
                '" target="_blank" rel="noopener">واتساب</a>'
              : "")
          : '<span class="hint">بلا جوال</span>';
        return (
          "<tr>" +
          "<td>" +
          esc(row.wifeName || "—") +
          "</td>" +
          "<td dir=\"ltr\">" +
          phoneCell +
          "</td>" +
          "<td>" +
          esc(row.husbandName || "—") +
          "</td>" +
          "<td>" +
          esc(row.branchKey || "—") +
          "</td>" +
          "<td>" +
          esc(String(row.linkedChildren)) +
          (row.hasMinors ? ' <span class="hint">· قُصّر</span>' : "") +
          "</td>" +
          "<td>" +
          esc(row.wifeIsFamily === true ? "من العائلة" : row.wifeIsFamily === false ? "خارجية" : "—") +
          "</td>" +
          "<td class=\"hint\">#" +
          esc(String(row.spouseId)) +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  async function fetchAllPages(queryBuilder, pageSize) {
    const size = pageSize || 1000;
    let from = 0;
    const out = [];
    for (;;) {
      const { data, error } = await queryBuilder.range(from, from + size - 1);
      if (error) throw error;
      const chunk = Array.isArray(data) ? data : [];
      out.push.apply(out, chunk);
      if (chunk.length < size) break;
      from += size;
      if (from > 20000) break;
    }
    return out;
  }

  async function loadWidows() {
    if (loading) return;
    if (!getAdminToken()) {
      setStatus("سجّل دخول الإدارة أولاً.", true);
      setCount(0);
      rowsCache = [];
      renderTable([]);
      return;
    }
    const sb = getClient();
    if (!sb) {
      setStatus("تعذر الاتصال بقاعدة البيانات.", true);
      return;
    }

    loading = true;
    setStatus("جاري تحميل الأرامل…");
    try {
      let spouses;
      try {
        spouses = await fetchAllPages(
          sb
            .from("tree_spouses")
            .select(
              "id,husband_id,wife_name,wife_phone,wife_branch_key,wife_family_name,wife_is_family_member,marriage_order,status",
            )
            .order("id", { ascending: true }),
        );
      } catch (e1) {
        spouses = await fetchAllPages(
          sb
            .from("tree_spouses")
            .select(
              "id,husband_id,wife_name,wife_branch_key,wife_family_name,wife_is_family_member,marriage_order,status",
            )
            .order("id", { ascending: true }),
        );
      }

      const active = (spouses || []).filter((s) => isActiveSpouse(s.status) && Number(s.husband_id));
      const husbandIds = Array.from(
        new Set(active.map((s) => Number(s.husband_id)).filter((id) => id > 0)),
      );

      const husbands = new Map();
      for (let i = 0; i < husbandIds.length; i += 200) {
        const slice = husbandIds.slice(i, i + 200);
        let res = await sb
          .from("tree_children")
          .select(
            "id,branch_key,child_name,name,is_deceased,deceased,death_date_g,death_date_h,death_date",
          )
          .in("id", slice);
        if (res.error) {
          res = await sb
            .from("tree_children")
            .select("id,branch_key,child_name,name,is_deceased,deceased")
            .in("id", slice);
        }
        if (res.error) throw res.error;
        (res.data || []).forEach((h) => husbands.set(Number(h.id), h));
      }

      const widowSpouses = active.filter((s) => {
        const h = husbands.get(Number(s.husband_id));
        return h && isDeceasedRow(h);
      });

      const spouseIds = widowSpouses.map((s) => Number(s.id)).filter(Boolean);
      const linksBySpouse = new Map();
      const allChildIds = new Set();
      for (let i = 0; i < spouseIds.length; i += 200) {
        const slice = spouseIds.slice(i, i + 200);
        const linked = await sb.from("tree_mother_links").select("spouse_id,child_id").in("spouse_id", slice);
        if (linked.error) throw linked.error;
        (linked.data || []).forEach((r) => {
          const sid = Number(r.spouse_id);
          const cid = Number(r.child_id);
          if (!sid || !cid) return;
          if (!linksBySpouse.has(sid)) linksBySpouse.set(sid, []);
          linksBySpouse.get(sid).push(cid);
          allChildIds.add(cid);
        });
      }

      const childMeta = new Map();
      const childIdList = Array.from(allChildIds);
      for (let i = 0; i < childIdList.length; i += 200) {
        const slice = childIdList.slice(i, i + 200);
        let res = await sb
          .from("tree_children")
          .select("id,birth_date_g,birth_date_h,birth_year,is_deceased,deceased")
          .in("id", slice);
        if (res.error) {
          res = await sb.from("tree_children").select("id,birth_year,is_deceased,deceased").in("id", slice);
        }
        if (!res.error) {
          (res.data || []).forEach((c) => childMeta.set(Number(c.id), c));
        }
      }

      rowsCache = widowSpouses
        .map((s) => {
          const h = husbands.get(Number(s.husband_id)) || {};
          const kids = linksBySpouse.get(Number(s.id)) || [];
          let hasMinors = false;
          kids.forEach((cid) => {
            const c = childMeta.get(cid);
            if (!c || isDeceasedRow(c)) return;
            const age = ageFromChild(c);
            if (age != null && age < MINOR_AGE) hasMinors = true;
          });
          const phone = String(s.wife_phone || "").trim();
          const husbandPath = String(h.child_name || h.name || "").trim();
          return {
            spouseId: Number(s.id),
            wifeName: String(s.wife_name || "").trim(),
            phone: phone,
            hasPhone: phoneDigits(phone).length >= 9,
            husbandName: leafName(husbandPath) || husbandPath || "—",
            husbandPath: husbandPath,
            branchKey: String(h.branch_key || s.wife_branch_key || "").trim(),
            linkedChildren: kids.length,
            hasMinors: hasMinors,
            wifeIsFamily: s.wife_is_family_member,
            wifeFamilyName: String(s.wife_family_name || "").trim(),
          };
        })
        .sort((a, b) => {
          const br = String(a.branchKey).localeCompare(String(b.branchKey), "ar");
          if (br) return br;
          return String(a.wifeName).localeCompare(String(b.wifeName), "ar");
        });

      renderTable(rowsCache);
      setStatus(
        rowsCache.length
          ? "تعريف الأرملة: زوجة نشطة وزوجها متوفى في الشجرة. لا تُحسب المطلقة ولا من تزوّجت لاحقاً بسجل نشط آخر."
          : "لا توجد أرامل وفق التعريف الحالي.",
      );
    } catch (error) {
      console.error(error);
      setStatus("تعذر التحميل: " + (error && error.message ? error.message : "خطأ"), true);
      rowsCache = [];
      renderTable([]);
    } finally {
      loading = false;
    }
  }

  function isSectionOpen() {
    const section = document.getElementById("admin-widows-section");
    if (!section) return false;
    if (section.classList.contains("admin-module-off")) return false;
    if (section.hasAttribute("hidden")) return false;
    return true;
  }

  function bind() {
    if (bound) return;
    bound = true;
    const reload = document.getElementById("admin-widows-reload");
    if (reload) reload.addEventListener("click", () => loadWidows().catch(() => {}));
    ["admin-widows-branch", "admin-widows-phone-filter", "admin-widows-minors-filter"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("change", () => renderTable(rowsCache));
    });
    const search = document.getElementById("admin-widows-search");
    if (search) {
      search.addEventListener("input", () => renderTable(rowsCache));
    }
    document.addEventListener("alzidan:admin-module", (ev) => {
      const id = ev && ev.detail ? String(ev.detail.id || "") : "";
      if (id === "giving" && getAdminToken() && isSectionOpen()) {
        loadWidows().catch(() => {});
      }
    });
  }

  function fillBranchSelect() {
    const sel = document.getElementById("admin-widows-branch");
    if (!sel || sel.options.length > 1) return;
    BRANCHES.forEach((b) => {
      const opt = document.createElement("option");
      opt.value = b;
      opt.textContent = b;
      sel.appendChild(opt);
    });
  }

  function init() {
    if (!document.getElementById("admin-widows-section")) return;
    fillBranchSelect();
    bind();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.AlzidanAdminWidows = { load: loadWidows };
})();
