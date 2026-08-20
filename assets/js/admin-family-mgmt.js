(() => {
  "use strict";

  const Core = window.AlzidanAdminCore || {};

  const parentsByBranch = {
    "زيدان": ["خميس بن زيدان بن مطلق", "عبدالله بن زيدان بن مطلق"],
    "مزيد": ["خميس", "صلف", "صلال"],
    "زايد": [],
    "لاحم": [],
    "ملحم": [],
  };

  const FORCED_RAHMA_BY_BASE = {
    "صلف": " (رحمة الله)",
    "صلال": " (رحمه الله)",
    "عرفج": " (رحمه الله)",
    "دليميك": " (رحمه الله)",
  };

  const state = {
    branch: null,
    children: {},
    pathToRow: {},
    forcedRahmaByBranch: {},
  };

  let familyMgmtPanel = null;

  const adminFmSection = document.getElementById("admin-family-management-section");

  function getAdminFmLoadBtn() {
    return document.getElementById("admin-fm-load");
  }

  function getAdminFmBranchSelect() {
    return document.getElementById("admin-fm-branch");
  }

  function getAdminFmStatusEl() {
    return document.getElementById("admin-fm-status");
  }

  function getAdminToken() {
    if (window.AlzidanAuth && typeof window.AlzidanAuth.getAdminToken === "function") {
      const fromAuth = String(window.AlzidanAuth.getAdminToken() || "").trim();
      if (fromAuth) return fromAuth;
    }
    if (window.AlzidanAdminCore && typeof window.AlzidanAdminCore.getAdminToken === "function") {
      const fromCore = String(window.AlzidanAdminCore.getAdminToken() || "").trim();
      if (fromCore) return fromCore;
    }
    try {
      return String(sessionStorage.getItem("alzidan_admin_token_session_v1") || "").trim();
    } catch (e) {
      return "";
    }
  }

  function setFmStatus(text) {
    const el = getAdminFmStatusEl();
    if (el) el.textContent = String(text || "");
  }

  function getSupabaseClient() {
    if (typeof Core.getClient === "function") {
      const client = Core.getClient();
      if (client) return client;
    }
    if (window.AlzidanAdminCore && typeof window.AlzidanAdminCore.getClient === "function") {
      const client = window.AlzidanAdminCore.getClient();
      if (client) return client;
    }
    if (window.__alzidanConfig && typeof window.__alzidanConfig.getClient === "function") {
      return window.__alzidanConfig.getClient();
    }
    return null;
  }

  function syncAdminBranchFromSelect() {
    if (!state.branch) {
      state.branch = getAdminFmBranch() || "";
    }
    return state.branch || "";
  }

  /** Login ≠ loaded branch. Search can run from the dropdown before «تحميل الشجرة». */
  async function ensureAdminWriteContext() {
    if (!getAdminToken()) {
      return { ok: false, message: "سجل الدخول أولاً." };
    }
    syncAdminBranchFromSelect();
    if (!state.branch) {
      return { ok: false, message: "اختر الفرع ثم حمّل الشجرة." };
    }
    const hasLoadedRows = Object.values(state.pathToRow || {}).some(function (row) {
      return row && Number(row.id) > 0;
    });
    const hasChildren = !!(state.children && Object.keys(state.children).length);
    if (!hasLoadedRows && !hasChildren) {
      const res = await loadChildrenForBranchAdmin(state.branch, { applyToState: true });
      if (!res.ok) {
        return { ok: false, message: "حمّل الشجرة أولاً من الفرع المحدد ثم أعد الحفظ." };
      }
    }
    return { ok: true };
  }

  function getAdminFamilyRoot() {
    return document.getElementById("admin-family-management-root");
  }

  function ensureFamilyPanelMounted() {
    const root = getAdminFamilyRoot();
    if (!root) {
      setFmStatus("تعذر عرض لوحة إدارة العائلة: عنصر الجذر غير موجود.");
      return false;
    }
    if (!window.AlzidanFamilyMgmt || typeof window.AlzidanFamilyMgmt.mount !== "function") {
      setFmStatus("تعذر عرض لوحة إدارة العائلة: لم تُحمَّل وحدات family-management.");
      return false;
    }
    const hasPanel = !!root.querySelector(".fm-panel");
    if (familyMgmtPanel && hasPanel) {
      return true;
    }
    if (familyMgmtPanel && typeof familyMgmtPanel.destroy === "function") {
      familyMgmtPanel.destroy();
    }
    familyMgmtPanel = null;
    if (typeof window.AlzidanFamilyMgmt.destroy === "function") {
      window.AlzidanFamilyMgmt.destroy();
    }
    familyMgmtPanel = window.AlzidanFamilyMgmt.mount({
      mode: "admin",
      root: root,
      api: buildAdminFamilyApi(),
    });
    return !!familyMgmtPanel;
  }


  function normalizePersonName(v) { const s = String(v || "") .replace(/\s+/g, " ") .trim(); if (!s) return ""; const parts = s.split(" ").map((p) =>p.trim()).filter(Boolean); if (parts.length >= 3 && parts.every((p) =>p.length === 1 && /^[\u0600-\u06FF]$/.test(p))) { return parts.join(""); } return s; }

  function parseTruthyValue(v) { if (v === true) return true; if (v === false || v == null) return false; if (typeof v === "number") return v === 1; const s = String(v).trim().toLowerCase(); if (!s) return false; if (s === "true" || s === "t" || s === "1" || s === "yes" || s === "y" || s === "on") return true; if (s === "نعم" || s === "متوفي" || s === "متوفى" || s === "متوفاة" || s === "متوفاه") return true; return false; }

  function getBranchRootName(branchKey) { const k = normalizePersonName(branchKey); if (!k) return ""; return k + " بن مطلق بن زيدان"; }

  function normalizeParentName(v, branchKey) { const raw = normalizePersonName(v || ""); const cleaned = raw.replace(/^أصل الفرع:\s*/i, "").trim(); if (!cleaned) return ""; if (/بن\s+مطلق\s+بن\s+زيدان/.test(cleaned)) return cleaned; if (Object.prototype.hasOwnProperty.call(parentsByBranch, cleaned)) return cleaned + " بن مطلق بن زيدان"; if (branchKey && normalizePersonName(branchKey) === cleaned) return cleaned + " بن مطلق بن زيدان"; return cleaned; }

  function resolveSelectedParentId(selectedParent, branchKey) { const s = normalizePersonName(selectedParent || ""); if (!s) return ""; if (s.includes("/")) return s; const b = normalizePersonName(branchKey || ""); const branchRoot = b ? getBranchRootName(b) : ""; if (branchRoot && (s === branchRoot || s === b)) return branchRoot; return branchRoot ? (branchRoot + "/" + s) : s; }

  function normalizeArabicDigitsToLatin(value){
    return String(value ?? "")
      .replace(/[٠-٩]/g,function(d){
        return "0123456789"["٠١٢٣٤٥٦٧٨٩".indexOf(d)];
      });
  }

  function parseISODate(v) { const s = String(v || "").trim().replace(/\//g, "-"); const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s); if (!m) return null; const y = parseInt(m[1], 10); const mo = parseInt(m[2], 10); const d = parseInt(m[3], 10); if (!y || !mo || !d) return null; if (mo< 1 || mo >12) return null; if (d< 1 || d >31) return null; return { y, mo, d }; }

  const FAMILY_TREE_CHILDREN_TABLE = "tree_children";

  const umalquraFormatter = (function () {
    try {
      return new Intl.DateTimeFormat("en-US-u-ca-islamic-umalqura", {
        timeZone: "UTC",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
    } catch (e) {
      return null;
    }
  })();

  function umalquraHijriPartsFromDate(date) { if (!umalquraFormatter || !date) return null; const parts = umalquraFormatter.formatToParts(date); const get = (t) => { const p = parts.find((x) => x.type === t); return p ? p.value : ""; }; const y = parseInt(get("year"), 10); const mo = parseInt(get("month"), 10); const d = parseInt(get("day"), 10); if (!y || !mo || !d) return null; return { y, mo, d }; }
  function pad2(v) { return String(v).padStart(2, "0"); }
  function formatISODate(parts) { if (!parts) return ""; const y = String(parts.y || "").padStart(4, "0"); const mo = pad2(parts.mo); const d = pad2(parts.d); if (!y || !mo || !d) return ""; return y + "-" + mo + "-" + d; }
  function ageYearsFromGregorianDate(dateISO, asOfISO) { const parsed = parseISODate(dateISO); if (!parsed) return null; let y; let month; let day; if (asOfISO) { const asOf = parseISODate(String(asOfISO).slice(0, 10)); if (!asOf) return null; y = asOf.y; month = asOf.mo; day = asOf.d; } else { const now = new Date(); y = now.getFullYear(); month = now.getMonth() + 1; day = now.getDate(); } let age = y - parsed.y; if (month < parsed.mo || (month === parsed.mo && day < parsed.d)) age -= 1; if (age < 0 || age > 120) return null; return age; }
  function gregorianToJdn(y, m, d) { const a = Math.floor((14 - m) / 12); const y2 = y + 4800 - a; const m2 = m + 12 * a - 3; return d + Math.floor((153 * m2 + 2) / 5) + 365 * y2 + Math.floor(y2 / 4) - Math.floor(y2 / 100) + Math.floor(y2 / 400) - 32045; }
  function jdnToGregorian(jdn) { const a = jdn + 32044; const b = Math.floor((4 * a + 3) / 146097); const c = a - Math.floor((146097 * b) / 4); const d = Math.floor((4 * c + 3) / 1461); const e = c - Math.floor((1461 * d) / 4); const m = Math.floor((5 * e + 2) / 153); const day = e - Math.floor((153 * m + 2) / 5) + 1; const month = m + 3 - 12 * Math.floor(m / 10); const year = 100 * b + d - 4800 + Math.floor(m / 10); return { y: year, mo: month, d: day }; }
  function parseHijriISO(v) { const s = String(v || "").trim(); const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s); if (!m) return null; const y = parseInt(m[1], 10); const mo = parseInt(m[2], 10); const d = parseInt(m[3], 10); if (!y || !mo || !d) return null; if (mo < 1 || mo > 12) return null; if (d < 1 || d > 30) return null; if (y < 1200 || y > 1700) return null; return { y, mo, d }; }
  function hijriToJdn(y, m, d) { return d + Math.ceil(29.5 * (m - 1)) + (y - 1) * 354 + Math.floor((3 + 11 * y) / 30) + 1948439 - 1; }
  function jdnToHijri(jdn) { const y = Math.floor((30 * (jdn - 1948439) + 10646) / 10631); const firstDay = hijriToJdn(y, 1, 1); let m = Math.min(12, Math.ceil((jdn - firstDay + 1) / 29.5) + 1); if (m < 1) m = 1; if (m > 12) m = 12; let d = jdn - hijriToJdn(y, m, 1) + 1; if (d < 1) { m = Math.max(1, m - 1); d = jdn - hijriToJdn(y, m, 1) + 1; } if (d > 30) d = 30; return { y, mo: m, d }; }
  function ageYearsFromHijriYear(year, asOfISO) { const y = parseInt(String(year || ""), 10); if (!y) return null; if (y < 1200 || y > 1700) return null; const gIso = hijriToGregorianISO(String(y) + "-01-01"); const parsed = parseISODate(gIso); const g = parsed ? { y: parsed.y } : jdnToGregorian(hijriToJdn(y, 1, 1)); const asOf = asOfISO ? parseISODate(String(asOfISO).slice(0, 10)) : null; const currentYear = asOf ? asOf.y : new Date().getFullYear(); const age = currentYear - g.y; if (age < 0 || age > 120) return null; return age; }
  function wrapLTRText(v) { const s = String(v || ""); if (!s) return ""; return "\u200E" + s + "\u200E"; }
  function getLeafBaseNameFromNodeId(nodeId) { const id = normalizePersonName(nodeId || ""); if (!id) return ""; const leaf = id.includes("/") ? (id.split("/").map((p) => normalizePersonName(p)).filter(Boolean).slice(-1)[0] || id) : id; return normalizePersonBaseName(leaf); }

  function formatDateISO(v) { let s = String(v || "").trim(); if (!s) return ""; for (let i = 0; i< 3; i++) { const m = /^\s*[\(（]\s*(.*?)\s*[\)）]\s*$/.exec(s); if (!m) break; s = String(m[1] || "").trim(); if (!s) return ""; } const toLooseIso = (y, mo, d) =>String(parseInt(y, 10)) + "-" + String(parseInt(mo, 10)) + "-" + String(parseInt(d, 10)); const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s); if (slash) { const d = slash[1].padStart(2, "0"); const m = slash[2].padStart(2, "0"); const y = slash[3]; const year = parseInt(y, 10); if (year >= 1200 && year<= 1700) return toLooseIso(y, m, d); const hijriISO = gregorianToHijriISO(y + "-" + m + "-" + d); const h = parseHijriISO(hijriISO); if (h) return toLooseIso(String(h.y), String(h.mo), String(h.d)); return y + "-" + String(parseInt(m, 10)) + "-" + String(parseInt(d, 10)); } const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s); if (iso) { const y = iso[1].padStart(4, "0"); const m = iso[2].padStart(2, "0"); const d = iso[3].padStart(2, "0"); const year = parseInt(y, 10); if (year >= 1200 && year<= 1700) return toLooseIso(y, m, d); const hijriISO = gregorianToHijriISO(y + "-" + m + "-" + d); const h = parseHijriISO(hijriISO); if (h) return toLooseIso(String(h.y), String(h.mo), String(h.d)); return y + "-" + String(parseInt(m, 10)) + "-" + String(parseInt(d, 10)); } return s; }

  function calculateAge(meta) {
    const deceased = !!(meta && meta.deceased);
    const deathGRaw = String((meta && meta.ddate) || "").trim().replace(/\//g, "-");
    const deathG = parseISODate(deathGRaw) ? formatISODate(parseISODate(deathGRaw)) : "";
    const deathH = String((meta && meta.dhdate) || "").trim();
    const asOf = deceased ? (deathG || hijriToGregorianISO(deathH) || "") : "";
    if (deceased && !asOf) return "";
    const gRaw = String((meta && meta.gdate) || "").trim().replace(/\//g, "-");
    const g = parseISODate(gRaw) ? formatISODate(parseISODate(gRaw)) : "";
    const hRaw = String((meta && meta.hdate) || "").trim();
    const hParsed = parseHijriISO(hRaw);
    const yFromH = (hRaw.match(/(\d{4})/) || [])[1] || "";
    const y = String((meta && meta.year) || yFromH || "");
    const asOfArg = asOf || undefined;
    const ageYears = ageYearsFromGregorianDate(g, asOfArg)
      ?? (hParsed ? ageYearsFromGregorianDate(hijriToGregorianISO(hRaw), asOfArg) : null)
      ?? ageYearsFromHijriYear(y, asOfArg);
    if (ageYears == null) return "";
    return String(ageYears) + " سنة";
  }

  function normalizeHijriDateISO(v) { const h = parseHijriISO(v); if (!h) return ""; return formatISODate(h); }

  function normalizeGregorianDateISO(v) { const g = parseISODate(v); if (!g) return ""; return formatISODate(g); }

  function hijriToGregorianISO(hijriISO) { const h = parseHijriISO(hijriISO); if (!h) return ""; const approx = jdnToGregorian(hijriToJdn(h.y, h.mo, h.d)); if (umalquraFormatter && approx) { const base = Date.UTC(approx.y, approx.mo - 1, approx.d, 12, 0, 0); const match = (date) =>{ const got = umalquraHijriPartsFromDate(date); return got && got.y === h.y && got.mo === h.mo && got.d === h.d; }; for (let delta = -10; delta<= 10; delta++) { const date = new Date(base + delta * 86400000); if (!match(date)) continue; return formatISODate({ y: date.getUTCFullYear(), mo: date.getUTCMonth() + 1, d: date.getUTCDate() }); } } return formatISODate(approx); }

  function gregorianToHijriISO(gregISO) { const g = parseISODate(gregISO); if (!g) return ""; if (umalquraFormatter) { const date = new Date(Date.UTC(g.y, g.mo - 1, g.d, 12, 0, 0)); const parts = umalquraHijriPartsFromDate(date); if (parts) return formatISODate(parts); } const jdn = gregorianToJdn(g.y, g.mo, g.d); return formatISODate(jdnToHijri(jdn)); }

  function normalizeBirthYear(v) { const raw = String(v || "").trim(); if (!raw) return null; const n = Number(raw); if (!Number.isFinite(n)) return null; const year = Math.trunc(n); if (year< 1300 || year >1600) return null; return year; }

  function resolveBirthDateFields(hijriRaw, gregRaw) {
    const hijriInput = normalizeArabicDigitsToLatin(String(hijriRaw || "").trim())
      .replace(/تقريبًا|تقريباً|تقريبا|حوالى|حوالي|نحو/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const gregInput = String(gregRaw || "").trim();
    const yearOnly = /^(\d{4})$/.exec(hijriInput);
    if (yearOnly && !gregInput) {
      const year = normalizeBirthYear(yearOnly[1]);
      if (!year) return { ok: false, message: "سنة الميلاد الهجرية غير صحيحة." };
      return { ok: true, hijri: String(year), greg: "", year: year };
    }
    const hijriNorm = hijriInput ? normalizeHijriDateISO(hijriInput) : "";
    const gregNorm = gregInput ? normalizeGregorianDateISO(gregInput) : "";
    if (hijriInput && !hijriNorm) return { ok: false, message: "تاريخ الميلاد (هجري) غير صحيح. الصيغة: YYYY-MM-DD أو السنة فقط مثل 1342" };
    if (gregInput && !gregNorm) return { ok: false, message: "تاريخ الميلاد (ميلادي) غير صحيح." };
    let finalHijri = hijriNorm;
    let finalGreg = gregNorm;
    if (finalHijri && !finalGreg) finalGreg = hijriToGregorianISO(finalHijri);
    if (finalGreg && !finalHijri) finalHijri = gregorianToHijriISO(finalGreg);
    if (finalHijri && !finalGreg) return { ok: false, message: "تعذر تحويل التاريخ الهجري إلى ميلادي." };
    if (finalGreg && !finalHijri) return { ok: false, message: "تعذر تحويل التاريخ الميلادي إلى هجري." };
    return {
      ok: true,
      hijri: finalHijri || "",
      greg: finalGreg || "",
      year: finalHijri ? normalizeBirthYear(finalHijri.slice(0, 4)) : null,
    };
  }

  function formatTreeChildrenDbError(err, action) { const a = action === "save" ? "save" : action === "update" ? "update" : action === "delete" ? "delete" : "load"; const codeRaw = err && err.code != null ? String(err.code) : ""; const msgRaw = err && err.message != null ? String(err.message) : ""; const detailsRaw = err && err.details != null ? String(err.details) : ""; const lowCode = codeRaw.trim().toLowerCase(); const lowMsg = msgRaw.trim().toLowerCase(); const lowDetails = detailsRaw.trim().toLowerCase(); const tableName = "tree_children"; if (lowMsg === "missing key") { if (a === "update" || a === "delete") return "تعذر تنفيذ العملية لأن بيانات الفرع/الأب/الابن غير مكتملة. حدّث الصفحة وحاول مرة أخرى."; } if (lowMsg === "row not found") { if (a === "update") return "تعذر حفظ التعديل لأن السجل غير موجود (قد يكون الاسم تغيّر أو تم حذفه). حدّث الصفحة ثم حاول مرة أخرى."; if (a === "delete") return "تعذر الحذف لأن السجل غير موجود (قد يكون الاسم تغيّر أو تم حذفه). حدّث الصفحة ثم حاول مرة أخرى."; } if (lowMsg === "no_session") { return "يلزم تسجيل دخول المندوب أولاً."; } if (lowMsg === "hash_failed") { return "تعذر التحقق من الرقم السري على هذا الجهاز. جرّب متصفحاً آخر أو حدّث الصفحة."; } if (lowMsg === "not allowed") { return "غير مصرح لك بتنفيذ هذه العملية. تأكد أن طلبك كمندوب تم اعتماده وأن البيانات صحيحة."; } if (lowMsg.includes("birth_order_conflict")) { return "رقم ترتيب الميلاد مستخدم لابن آخر تحت الأب نفسه. اختر رقمًا مختلفًا."; } if (lowMsg.includes("tree_children_parent_birth_order_key")) { return "رقم ترتيب الميلاد مستخدم لابن آخر تحت الأب نفسه. اختر رقمًا مختلفًا."; } if (lowMsg.includes("birth_order_invalid")) { return "ترتيب الميلاد يجب أن يكون رقمًا صحيحًا يبدأ من 1."; } if (lowMsg.includes("child_already_exists")) { return "هذا الاسم مسجل مسبقًا تحت الأب نفسه. يمكن تسجيل الاسم نفسه فقط إذا كان الأب مختلفًا."; } if (lowMsg.includes("no unique or exclusion constraint matching the on conflict specification")) { return "تعذر الحفظ بسبب إعداد قديم في الخدمة يستخدم ON CONFLICT بدون مفتاح فريد. افتح صفحة الإدارة (admin.html) وانسخ أمر الصيانة الخاص بالشجرة ثم نفّذه في الخدمة ليتم تحديث الدوال."; } const isSchemaCache = lowMsg.includes("تحديث الخدمة") || lowMsg.includes("could not find the table") || lowDetails.includes("تحديث الخدمة"); if (isSchemaCache) { const hint = `إذا استمر الخطأ، فالغالب أن دور anon لا يملك صلاحيات على جدول ${tableName} أو أن RLS تمنع الوصول.`; const reloadHint = "انتظر دقيقة ثم حدّث الصفحة، أو نفّذ Reload تحديث الخدمة من إعدادات الخدمة (API)."; if (a === "save" || a === "update" || a === "delete") { return `تعذر تنفيذ العملية لأن الخدمة لم يُحدّث المخطط بعد. ${reloadHint} ${hint}`; } return `تعذر تحميل بيانات الأبناء لأن الخدمة لم يُحدّث المخطط بعد. ${reloadHint} ${hint}`; } const isMissingTable = lowCode === "42p01" || (lowMsg.includes("relation") && lowMsg.includes("does not exist")) || (lowDetails.includes("relation") && lowDetails.includes("does not exist")); if (isMissingTable) { if (a === "save") return `يلزم إنشاء جدول ${tableName} في الخدمة قبل حفظ الأبناء.`; return `يلزم إنشاء جدول ${tableName} في الخدمة لعرض الأبناء.`; } const isRls = lowMsg.includes("row-level security") || lowDetails.includes("row-level security") || lowMsg.includes("violates row-level security"); if (isRls) { if (a === "save") return `تعذر حفظ بيانات الابن بسبب صلاحيات الجدول (RLS). تأكد من سياسة INSERT على جدول ${tableName}.`; if (a === "update") return `تعذر تعديل بيانات الابن بسبب صلاحيات الجدول (RLS). تأكد من سياسة UPDATE على جدول ${tableName}.`; if (a === "delete") return `تعذر حذف بيانات الابن بسبب صلاحيات الجدول (RLS). تأكد من سياسة DELETE على جدول ${tableName}.`; return `تعذر تحميل بيانات الأبناء بسبب صلاحيات الجدول (RLS). تأكد من سياسات SELECT/INSERT/UPDATE/DELETE على جدول ${tableName}.`; } const isPermission = lowMsg.includes("permission denied") || lowDetails.includes("permission denied") || lowCode === "42501"; if (isPermission) { if (a === "save") return `تعذر حفظ بيانات الابن بسبب عدم وجود صلاحية على جدول ${tableName}، حاول لاحقاً أو تواصل مع الإدارة.`; if (a === "update") return `تعذر تعديل بيانات الابن بسبب عدم وجود صلاحية على جدول ${tableName}، حاول لاحقاً أو تواصل مع الإدارة.`; if (a === "delete") return `تعذر حذف بيانات الابن بسبب عدم وجود صلاحية على جدول ${tableName}، حاول لاحقاً أو تواصل مع الإدارة.`; return `تعذر تحميل بيانات الأبناء بسبب عدم وجود صلاحية على جدول ${tableName}.`; } const isSchemaMismatch = lowMsg.includes("column") && lowMsg.includes("does not exist"); if (isSchemaMismatch) { const neededCore = wrapLTRText("branch_key + (parent_name أو parent) + (child_name أو name)"); const optional = wrapLTRText("birth_date_g, birth_date_h, birth_year, birth_order, city, area, is_deceased, created_at"); if (a === "save" || a === "update" || a === "delete") { return `تعذر تنفيذ العملية لأن أعمدة جدول ${tableName} غير مطابقة. المطلوب على الأقل: ${neededCore}. الأعمدة الإضافية اختيارية: ${optional}.`; } return `تعذر تحميل بيانات الأبناء لأن أعمدة جدول ${tableName} غير مطابقة. المطلوب على الأقل: ${neededCore}. الأعمدة الإضافية اختيارية: ${optional}.`; } if (a === "save") return `تعذر حفظ بيانات الابن: ${msgRaw || "خطأ غير معروف"}`; if (a === "update") return `تعذر تعديل بيانات الابن: ${msgRaw || "خطأ غير معروف"}`; if (a === "delete") return `تعذر حذف بيانات الابن: ${msgRaw || "خطأ غير معروف"}`; return `تعذر تحميل بيانات الأبناء: ${msgRaw || "خطأ غير معروف"}`; }

  function isRpcMissingError(err) { const msg = String(err && err.message ? err.message : "").toLowerCase(); const code = String(err && err.code ? err.code : "").toLowerCase(); if (code === "pgrst202") return true; if (msg.includes("could not find the function")) return true; if (msg.includes("function") && msg.includes("does not exist")) return true; if (msg.includes("تحديث الخدمة") && msg.includes("function")) return true; return false; }

  function confirmTypedText(expectedRaw, opts) { const options = opts || {}; const expected = normalizePersonName(expectedRaw || ""); if (!expected) return Promise.resolve(false); const title = String(options.title || "تأكيد").trim() || "تأكيد"; const body = String(options.body || "").trim(); const confirmLabel = String(options.confirmLabel || "تأكيد").trim() || "تأكيد"; const cancelLabel = String(options.cancelLabel || "إلغاء").trim() || "إلغاء"; return new Promise((resolve) =>{ const overlay = document.createElement("div"); overlay.style.position = "fixed"; overlay.style.inset = "0"; overlay.style.background = "rgba(0, 0, 0, 0.55)"; overlay.style.display = "flex"; overlay.style.alignItems = "center"; overlay.style.justifyContent = "center"; overlay.style.zIndex = "99999"; overlay.dir = "rtl"; const card = document.createElement("div"); card.style.width = "min(92vw, 520px)"; card.style.background = "#fff"; card.style.borderRadius = "14px"; card.style.padding = "14px 14px 12px"; card.style.boxShadow = "0 14px 40px rgba(0,0,0,0.25)"; card.style.border = "1px solid rgba(0,0,0,0.08)"; const h = document.createElement("div"); h.textContent = title; h.style.fontWeight = "700"; h.style.fontSize = "16px"; h.style.marginBottom = "8px"; const p = document.createElement("div"); p.style.marginBottom = "10px"; p.style.color = "#374151"; p.style.fontSize = "13px"; p.textContent = body || "اكتب النص التالي لتأكيد العملية:"; const expectedBox = document.createElement("div"); expectedBox.style.background = "#f3f4f6"; expectedBox.style.border = "1px solid #e5e7eb"; expectedBox.style.borderRadius = "10px"; expectedBox.style.padding = "10px 12px"; expectedBox.style.fontWeight = "700"; expectedBox.style.marginBottom = "10px"; expectedBox.style.userSelect = "text"; expectedBox.textContent = expected; const input = document.createElement("input"); input.type = "text"; input.autocomplete = "off"; input.inputMode = "text"; input.style.width = "100%"; input.style.padding = "10px 12px"; input.style.borderRadius = "10px"; input.style.border = "1px solid #d1d5db"; input.style.outline = "none"; input.style.fontSize = "14px"; input.placeholder = "اكتب هنا..."; const actions = document.createElement("div"); actions.style.display = "flex"; actions.style.gap = "8px"; actions.style.marginTop = "12px"; actions.style.justifyContent = "flex-start"; const cancelBtn = document.createElement("button"); cancelBtn.type = "button"; cancelBtn.className = "btn btn-secondary btn-small"; cancelBtn.textContent = cancelLabel; const okBtn = document.createElement("button"); okBtn.type = "button"; okBtn.className = "btn btn-primary btn-small"; okBtn.textContent = confirmLabel; okBtn.disabled = true; const cleanup = (v) =>{ try { document.removeEventListener("keydown", onKeyDown, true); } catch (e) {} try { overlay.remove(); } catch (e) {} resolve(!!v); }; const isMatch = () =>normalizePersonName(input.value || "") === expected; const refresh = () =>{ okBtn.disabled = !isMatch(); }; const onKeyDown = (e) =>{ if (!e) return; if (e.key === "Escape") { e.preventDefault(); cleanup(false); return; } if (e.key === "Enter") { if (isMatch()) { e.preventDefault(); cleanup(true); } } }; overlay.addEventListener("click", (e) =>{ if (e && e.target === overlay) cleanup(false); }); cancelBtn.addEventListener("click", () =>cleanup(false)); okBtn.addEventListener("click", () =>cleanup(true)); input.addEventListener("input", refresh); document.addEventListener("keydown", onKeyDown, true); card.appendChild(h); card.appendChild(p); card.appendChild(expectedBox); card.appendChild(input); actions.appendChild(cancelBtn); actions.appendChild(okBtn); card.appendChild(actions); overlay.appendChild(card); document.body.appendChild(overlay); setTimeout(() =>{ try { input.focus(); input.select(); } catch (e) {} }, 0); }); }

  function getDisplayNameForNodeId(nodeId, branchRoot) { const id = normalizePersonName(nodeId || ""); if (!id) return ""; if (branchRoot && id === branchRoot) return id; const leaf = id.includes("/") ? (id.split("/").map((p) =>normalizePersonName(p)).filter(Boolean).slice(-1)[0] || id) : id; const tokens = tokenizeLineageInput(normalizePersonBaseName(leaf)); return tokens.length ? tokens[0] : leaf; }

  function getForcedRahmaSuffix(nodeId, branchKey) { const base = normalizePersonName(getLeafBaseNameFromNodeId(nodeId)); if (!base) return ""; const suffix = FORCED_RAHMA_BY_BASE[base] || ""; if (!suffix) return ""; const branch = normalizePersonName(branchKey || state.branch || ""); if (!branch) return ""; const byBranch = state.forcedRahmaByBranch && state.forcedRahmaByBranch[branch] ? state.forcedRahmaByBranch[branch] : null; if (!byBranch) return ""; const canonicalId = normalizePersonName(byBranch[base] || ""); if (!canonicalId) return ""; const id = normalizePersonName(nodeId || ""); return id === canonicalId ? suffix : ""; }

  function normalizePersonBaseName(v) { const n = normalizePersonName(v || ""); if (!n) return ""; const m = n.match(/^(.*)\s*\((?:ابن|مواليد)\s+[^)]+\)\s*$/); const core = m && m[1] ? normalizePersonName(m[1]) : n; const parts = core.split("/").map((p) =>normalizePersonName(p)).filter(Boolean); return parts.length ? parts[parts.length - 1] : core; }

  function tokenizeLineageInput(v) { const s = normalizePersonName(v || ""); if (!s) return []; const hasConnector = /(^|\s)(?:بن|ابن|بنت)(\s|$)/.test(s); if (!hasConnector) return [s]; return s .split(/\s+/g) .map((w) =>normalizePersonName(w)) .filter(Boolean) .filter((w) =>!["بن", "ابن", "بنت"].includes(w)); }

  function buildLineagePlanFromTokens(tokens, branchKey, selectedParent) { const t = Array.isArray(tokens) ? tokens.map((x) =>normalizePersonName(x)).filter(Boolean) : []; if (t.length< 2) return null; const branch = normalizePersonName(branchKey || ""); if (branch && t.length >= 3) { const a = normalizePersonName(t[t.length - 3] || ""); const b = normalizePersonName(t[t.length - 2] || ""); const c = normalizePersonName(t[t.length - 1] || ""); if (a === branch && b === "مطلق" && c === "زيدان") { const relative = t.slice(0, -3); if (!relative.length) return null; const branchRoot = getBranchRootName(branch); const chain = relative.reverse(); return { anchorParent: branchRoot, chain }; } } const anchorBranchIndex = branch ? t.lastIndexOf(branch) : -1; if (anchorBranchIndex >= 0) { const relative = t.slice(0, anchorBranchIndex); if (!relative.length) return null; const branchRoot = getBranchRootName(branch); const chain = relative.reverse(); return { anchorParent: branchRoot, chain }; } const selected = normalizePersonName(selectedParent || ""); const selectedBase = normalizePersonBaseName(selected); const last = normalizePersonName(t[t.length - 1] || ""); if (selected && selectedBase && selectedBase === last) { const relative = t.slice(0, -1); if (!relative.length) return null; return { anchorParent: selected, chain: relative.reverse() }; } return null; }

  function getLeafStoredNameFromNodeId(nodeId) { const id = normalizePersonName(nodeId || ""); if (!id) return ""; return id.includes("/") ? (id.split("/").map((p) =>normalizePersonName(p)).filter(Boolean).slice(-1)[0] || id) : id; }

  function getAllBaseNames() { const baseNames = new Set(); Object.keys(state.children || {}).forEach((p) =>{ const b = normalizePersonBaseName(p); if (b) baseNames.add(b); }); Object.values(state.children || {}).forEach((list) =>{ (Array.isArray(list) ? list : []).forEach((c) =>{ const b = normalizePersonBaseName(c && c.name ? c.name : ""); if (b) baseNames.add(b); }); }); return baseNames; }

  function checkSiblingSimilarNameWarning(parentName, childBase, opts) {
    const key = normalizePersonName(parentName || "");
    const existing = state.children[key] || [];
    const FM = window.AlzidanFamilyPersonCore || {};
    if (typeof FM.findSiblingSimilarNameWarning === "function") {
      return FM.findSiblingSimilarNameWarning(
        existing,
        childBase,
        Object.assign(
          {
            normalizePersonName,
            normalizePersonBaseName,
          },
          opts || {},
        ),
      );
    }
    return null;
  }

  function findChildNameByBase(parentName, childBase, opts) {
    const key = normalizePersonName(parentName || "");
    const existing = state.children[key] || [];
    const FM = window.AlzidanFamilyPersonCore || {};
    if (typeof FM.findSiblingNameCollision === "function") {
      return FM.findSiblingNameCollision(existing, childBase, Object.assign({
        normalizePersonName,
        normalizePersonBaseName,
      }, opts || {}));
    }
    const options = opts || {};
    const base = normalizePersonName(childBase || "");
    const excludeChildId = normalizePersonName(options.excludeChildId || "");
    const excludePersonId = normalizePersonName(options.excludePersonId || "");
    const hit = (Array.isArray(existing) ? existing : []).find((c) => {
      if (!c || normalizePersonBaseName(c.name || "") !== base) return false;
      const name = normalizePersonName(c.name || "");
      const pid = normalizePersonName(c.personId || c.person_id || "");
      if (excludeChildId && name === excludeChildId) return false;
      if (excludePersonId && pid && pid === excludePersonId) return false;
      return true;
    });
    return hit && hit.name ? normalizePersonName(hit.name) : "";
  }

  function todayGregorianISO() { const now = new Date(); const y = String(now.getFullYear()).padStart(4, "0"); const m = String(now.getMonth() + 1).padStart(2, "0"); const d = String(now.getDate()).padStart(2, "0"); return y + "-" + m + "-" + d; }

  function groupChildrenRows(rows, branchKey) { const key = normalizePersonName(branchKey || ""); const branchRoot = key ? getBranchRootName(key) : ""; const byParent = {}; const idsByBase = new Map(); const buildChildId = (parentId, baseName) =>{ const p = normalizePersonName(parentId || ""); const b = normalizePersonName(baseName || ""); if (!p || !b) return ""; return p + "/" + b; }; const indexKnownId = (nodeId) =>{ const id = normalizePersonName(nodeId || ""); if (!id) return; const parts = id.split("/").map((p) =>normalizePersonName(p)).filter(Boolean); const base = parts.length ? parts[parts.length - 1] : id; if (!base) return; const existing = idsByBase.get(base); if (existing) { existing.add(id); return; } idsByBase.set(base, new Set([id])); }; const addOrMergeChildById = (parentId, child) =>{ const parent = normalizePersonName(parentId || ""); const name = normalizePersonName(child && child.name ? child.name : ""); if (!parent || !name) return; if (!byParent[parent]) byParent[parent] = []; const list = byParent[parent]; const idx = (Array.isArray(list) ? list : []).findIndex((c) =>normalizePersonName(c && c.name ? c.name : "") === name); const merged = { name, personId: child && child.personId ? String(child.personId) : "", parentPersonId: child && child.parentPersonId ? String(child.parentPersonId) : "", year: child && child.year ? String(child.year) : "", order: child && child.order ? String(child.order) : "", gdate: child && child.gdate ? String(child.gdate) : "", hdate: child && child.hdate ? String(child.hdate) : "", ddate: child && child.ddate ? String(child.ddate) : "", dhdate: child && child.dhdate ? String(child.dhdate) : "", city: child && child.city ? String(child.city) : "", area: child && child.area ? String(child.area) : "", photoUrl: child && child.photoUrl ? String(child.photoUrl) : "", gender: child && child.gender ? String(child.gender) : "", deceased: !!(child && child.deceased) }; if (idx< 0) { list.push(merged); return; } const prev = list[idx]; if (prev) { if (!prev.personId && merged.personId) prev.personId = merged.personId; if (!prev.parentPersonId && merged.parentPersonId) prev.parentPersonId = merged.parentPersonId; if (!prev.year && merged.year) prev.year = merged.year; if (!prev.order && merged.order) prev.order = merged.order; if (!prev.gdate && merged.gdate) prev.gdate = merged.gdate; if (!prev.hdate && merged.hdate) prev.hdate = merged.hdate; if (!prev.ddate && merged.ddate) prev.ddate = merged.ddate; if (!prev.dhdate && merged.dhdate) prev.dhdate = merged.dhdate; if (!prev.city && merged.city) prev.city = merged.city; if (!prev.area && merged.area) prev.area = merged.area; if (!prev.photoUrl && merged.photoUrl) prev.photoUrl = merged.photoUrl; if (!prev.gender && merged.gender) prev.gender = merged.gender; if (!prev.deceased && merged.deceased) prev.deceased = true; } }; const addOrMergeChildAndIndex = (parentId, child) =>{ addOrMergeChildById(parentId, child); const p = normalizePersonName(parentId || ""); if (p) indexKnownId(p); const n = normalizePersonName(child && child.name ? child.name : ""); if (n) indexKnownId(n); }; const ensureParentId = (rawParent, childRaw) =>{ const raw = normalizePersonName(rawParent || ""); if (!raw) return ""; if (raw.includes("/")) return raw; if (branchRoot && (raw === branchRoot || raw === key)) return branchRoot; const pathDerived = (function(){ const childFull = normalizePersonName(childRaw || ""); if (!childFull || !childFull.includes("/")) return ""; const parts = childFull.split("/").map((p) =>normalizePersonName(p)).filter(Boolean); if (parts.length < 2) return ""; const derivedParent = parts.slice(0, -1).join("/"); const derivedLeaf = parts[parts.length - 2] || ""; if (derivedLeaf === raw || normalizePersonBaseName(derivedParent) === raw || derivedParent.endsWith("/" + raw)) return derivedParent; return ""; })(); if (pathDerived) return pathDerived; const candidates = idsByBase.get(raw); if (candidates && candidates.size === 1) return Array.from(candidates)[0]; if (candidates && candidates.size > 1) return raw; if (branchRoot) { const parentId = buildChildId(branchRoot, raw); if (parentId) addOrMergeChildAndIndex(branchRoot, { name: parentId, year: "", gdate: "", hdate: "", city: "", area: "" }); return parentId; } return raw; }; const stripBranchSuffix = (tokens) =>{ const t = Array.isArray(tokens) ? tokens.map((x) =>normalizePersonName(x)).filter(Boolean) : []; if (!key) return t; if (t.length >= 3) { const a = normalizePersonName(t[t.length - 3] || ""); const b = normalizePersonName(t[t.length - 2] || ""); const c = normalizePersonName(t[t.length - 1] || ""); if (a === key && b === "مطلق" && c === "زيدان") return t.slice(0, -3); } if (t.length >= 2) { const b = normalizePersonName(t[t.length - 2] || ""); const c = normalizePersonName(t[t.length - 1] || ""); if (b === key && c === "مطلق") return t.slice(0, -2); } if (t.length >= 1 && normalizePersonName(t[t.length - 1] || "") === key) return t.slice(0, -1); return t; }; const normalizeChildId = (rawChildId, parentId) =>{ const c = normalizePersonName(rawChildId || ""); if (!c || !c.includes("/")) return c; const p = normalizePersonName(parentId || ""); if (!p) return c; if (c === p || c.startsWith(p + "/")) return c; if (branchRoot && (c === branchRoot || c.startsWith(branchRoot + "/"))) return c; const base = p.split("/").map((x) =>normalizePersonName(x)).filter(Boolean).slice(-1)[0] || ""; if (base && c.startsWith(base + "/")) return p + "/" + c.slice((base + "/").length); return c; }; const addChain = (anchorParentId, basesOldestToYoungest, leafMeta) =>{ const anchor = normalizePersonName(anchorParentId || ""); const chain = Array.isArray(basesOldestToYoungest) ? basesOldestToYoungest.map((x) =>normalizePersonName(x)).filter(Boolean) : []; if (!anchor || !chain.length) return; let current = anchor; indexKnownId(current); for (let i = 0; i< chain.length; i++) { const base = chain[i]; const childId = buildChildId(current, base); if (!childId) return; const isLeaf = i === chain.length - 1; addOrMergeChildAndIndex( current, isLeaf ? { ...(leafMeta || {}), name: childId } : { name: childId, year: "", gdate: "", hdate: "", city: "", area: "", created_at: "" } ); current = childId; } }; (Array.isArray(rows) ? rows : []).forEach((r) =>{ let parentRaw = normalizeParentName(r.parent_name || r.parent || "", key); let childRaw = normalizePersonName(r.child_name || r.name || ""); if (!parentRaw || !childRaw) return; const meta = { name: "", personId: normalizePersonName(r.person_id || ""), parentPersonId: normalizePersonName(r.parent_person_id || ""), year: r.birth_year == null ? "" : String(r.birth_year), order: r.birth_order == null ? "" : String(r.birth_order), gdate: normalizePersonName(r.birth_date_g || r.birth_date || ""), hdate: normalizePersonName(r.birth_date_h || ""), ddate: normalizePersonName(String(r.death_date_g || r.death_date || "").slice(0, 10)), dhdate: normalizePersonName(r.death_date_h || ""), city: normalizePersonName(r.city || ""), area: normalizePersonName(r.area || ""), gender: String(r.gender || "").trim(), photoUrl: String(r.photo_url || r.photoUrl || "").trim(), deceased: parseTruthyValue(r.is_deceased) || parseTruthyValue(r.deceased) || parseTruthyValue(r.is_dead) || parseTruthyValue(r.dead) || parseTruthyValue(r.isDead) }; const parentId = ensureParentId(parentRaw, childRaw); if (!parentId) return; if (childRaw.includes("/")) { addOrMergeChildAndIndex(parentId, { ...meta, name: normalizeChildId(childRaw, parentId) }); return; } const rawTokens = tokenizeLineageInput(normalizePersonBaseName(childRaw)); const tokens = stripBranchSuffix(rawTokens); if (!tokens.length) return; const hadBranchSuffix = tokens.length !== rawTokens.length; if (hadBranchSuffix && branchRoot) { const chainOldest = tokens.slice().reverse(); addChain(branchRoot, chainOldest, meta); return; } if (tokens.length >1) { const chainOldest = tokens.slice().reverse(); const parentBase = normalizePersonBaseName(parentId); if (chainOldest.length && parentBase && chainOldest[0] === parentBase) chainOldest.shift(); addChain(parentId, chainOldest, meta); return; } addChain(parentId, [tokens[0]], meta); }); const forcedMap = {}; const forcedBases = Object.keys(FORCED_RAHMA_BY_BASE); if (forcedBases.length) { const pickBestId = (ids) =>{ const list = (Array.isArray(ids) ? ids : []).map((x) =>normalizePersonName(x)).filter(Boolean); if (!list.length) return ""; const root = normalizePersonName(branchRoot); list.sort((a, b) =>{ const aInRoot = root ? (a === root || a.startsWith(root + "/")) : false; const bInRoot = root ? (b === root || b.startsWith(root + "/")) : false; if (aInRoot !== bInRoot) return aInRoot ? -1 : 1; const aDepth = a.split("/").filter(Boolean).length; const bDepth = b.split("/").filter(Boolean).length; if (aDepth !== bDepth) return aDepth - bDepth; if (a.length !== b.length) return a.length - b.length; return a.localeCompare(b, "ar"); }); return list[0] || ""; }; forcedBases.forEach((base) =>{ const b = normalizePersonName(base); if (!b) return; const set = idsByBase.get(b); if (!set || !set.size) return; const picked = pickBestId(Array.from(set)); if (picked) forcedMap[b] = picked; }); } if (key) state.forcedRahmaByBranch[key] = forcedMap; return byParent; }

  const __treeChildrenInflight = new Map(); async function loadChildrenForBranch(branchKey, opts) { const options = opts || {}; const sb = getSupabaseClient(); if (!sb) return { ok: false, reason: "not_configured" }; const key = String(branchKey || "").trim(); if (!key) return { ok: false, reason: "missing_branch" }; const cacheKey = key + "|" + (options.applyToState === true ? "1" : "0"); if (__treeChildrenInflight.has(cacheKey)) return __treeChildrenInflight.get(cacheKey); const __loadPromise = (async () => { const fieldAttempts = [ "id,person_id,parent_person_id,parent_name,parent,child_name,name,gender,photo_url,birth_date_g,birth_date_h,birth_year,birth_order,death_date_g,death_date_h,city,area,is_deceased,deceased,created_at", "parent_name,parent,child_name,name,birth_date_g,birth_date_h,birth_year,birth_order,city,area,is_deceased,deceased,created_at", "parent_name,parent,child_name,name,birth_date_g,birth_date_h,birth_year,city,area,is_deceased,deceased,created_at", "parent_name,child_name,name,birth_date_g,birth_date_h,birth_year,city,area,is_deceased,deceased,created_at", "parent_name,child_name,birth_date_g,birth_date_h,birth_year,city,area,is_deceased,deceased,created_at", "parent_name,name,birth_date_g,birth_date_h,birth_year,city,area,is_deceased,deceased,created_at", "parent,name,birth_date_g,birth_date_h,birth_year,city,area,is_deceased,deceased,created_at", "parent,child_name,birth_date_g,birth_date_h,birth_year,city,area,is_deceased,deceased,created_at", "parent_name,parent,child_name,name,birth_year,city,area,is_deceased,deceased,created_at", "parent_name,child_name,name,birth_year,city,area,is_deceased,deceased,created_at", "parent_name,child_name,birth_year,city,area,is_deceased,deceased,created_at", "parent_name,name,birth_year,city,area,is_deceased,deceased,created_at", "parent,name,birth_year,city,area,is_deceased,deceased,created_at", "parent,child_name,birth_year,city,area,is_deceased,deceased,created_at", "parent_name,parent,child_name,name,birth_date_g,birth_date_h,birth_year,city,area,deceased,created_at", "parent_name,child_name,name,birth_date_g,birth_date_h,birth_year,city,area,deceased,created_at", "parent_name,child_name,birth_date_g,birth_date_h,birth_year,city,area,deceased,created_at", "parent_name,name,birth_date_g,birth_date_h,birth_year,city,area,deceased,created_at", "parent,name,birth_date_g,birth_date_h,birth_year,city,area,deceased,created_at", "parent,child_name,birth_date_g,birth_date_h,birth_year,city,area,deceased,created_at", "parent_name,parent,child_name,name,birth_year,city,area,deceased,created_at", "parent_name,child_name,name,birth_year,city,area,deceased,created_at", "parent_name,child_name,birth_year,city,area,deceased,created_at", "parent_name,name,birth_year,city,area,deceased,created_at", "parent,name,birth_year,city,area,deceased,created_at", "parent,child_name,birth_year,city,area,deceased,created_at", "parent_name,parent,child_name,name,birth_date_g,birth_date_h,birth_year,city,area,created_at", "parent_name,child_name,name,birth_date_g,birth_date_h,birth_year,city,area,created_at", "parent_name,child_name,birth_date_g,birth_date_h,birth_year,city,area,created_at", "parent_name,name,birth_date_g,birth_date_h,birth_year,city,area,created_at", "parent,name,birth_date_g,birth_date_h,birth_year,city,area,created_at", "parent,child_name,birth_date_g,birth_date_h,birth_year,city,area,created_at", "parent_name,parent,child_name,name,birth_year,city,area,created_at", "parent_name,child_name,name,birth_year,city,area,created_at", "parent_name,child_name,birth_year,city,area,created_at", "parent_name,name,birth_year,city,area,created_at", "parent,name,birth_year,city,area,created_at", "parent,child_name,birth_year,city,area,created_at", "parent_name,parent,child_name,name,created_at", "parent_name,child_name,name,created_at", "parent_name,child_name,created_at", "parent_name,name,created_at", "parent,child_name,created_at", "parent,name,created_at", "parent_name,parent,child_name,name", "parent_name,child_name,name", "parent_name,child_name", "parent_name,name", "parent,child_name", "parent,name", "parent_name,parent,child_name,name,gdate,hdate,year,city,area,is_deceased,deceased,created_at", "parent_name,child_name,name,gdate,hdate,year,city,area,is_deceased,deceased,created_at", "parent_name,child_name,gdate,hdate,year,city,area,is_deceased,deceased,created_at", "parent_name,name,gdate,hdate,year,city,area,is_deceased,deceased,created_at", "parent,name,gdate,hdate,year,city,area,is_deceased,deceased,created_at", "parent,child_name,gdate,hdate,year,city,area,is_deceased,deceased,created_at", "parent_name,parent,child_name,name,year,city,area,created_at", "parent_name,child_name,name,year,city,area,created_at", "parent_name,child_name,year,city,area,created_at", "parent_name,name,year,city,area,created_at", "parent,name,year,city,area,created_at", "parent,child_name,year,city,area,created_at" ]; let lastError = null; let deceasedFallbackHint = ""; for (let i = 0; i< fieldAttempts.length; i++) { const usedFields = fieldAttempts[i]; const res = await loadChildrenQuery(sb, key, usedFields); if (!res.error) { const map = groupChildrenRows(res.data, key); const supportsDeceased = usedFields.includes("is_deceased") || usedFields.includes("deceased"); if (options.applyToState === true) { const __FM = (typeof window !== "undefined" && window.AlzidanFamilyPersonCore) ? window.AlzidanFamilyPersonCore : {}; state.children = (typeof __FM.unionChildrenMapByParentPersonId === "function") ? __FM.unionChildrenMapByParentPersonId(map, normalizePersonName) : map; if (typeof __FM.isolateChildrenMapArrays === "function") __FM.isolateChildrenMapArrays(state.children); } return { ok: true, map, rows: Array.isArray(res.data) ? res.data : [], capabilities: { deceased: supportsDeceased, deceased_hint: supportsDeceased ? "" : deceasedFallbackHint } }; } if (!deceasedFallbackHint && (usedFields.includes("is_deceased") || usedFields.includes("deceased"))) { deceasedFallbackHint = classifyTreeChildrenDbError(res.error); } const msg = String(res.error.message || "").toLowerCase(); const isColumnMissing = msg.includes("column") && msg.includes("does not exist"); const isSchemaCacheMissingColumn = msg.includes("تحديث الخدمة") && msg.includes("could not find") && msg.includes("column"); const canRetry = isColumnMissing || isSchemaCacheMissingColumn; if (!canRetry) return { ok: false, reason: "error", error: res.error }; lastError = res.error; } return { ok: false, reason: "error", error: lastError };  })(); __treeChildrenInflight.set(cacheKey, __loadPromise); try { return await __loadPromise; } finally { __treeChildrenInflight.delete(cacheKey); } }

  async function loadChildrenQuery(sb, branchKey, fields) {
    const token = getAdminToken();
    if (token) {
      const listed = await sb.rpc("admin_tree_children_list_v1", {
        p_token: token,
        p_branch_key: branchKey,
      });
      if (!listed.error && Array.isArray(listed.data)) {
        return { data: listed.data, error: null };
      }
      if (listed.error && !isRpcMissingError(listed.error)) {
        return listed;
      }
    }
    const raw = String(fields || "*");
    const parts = raw
      .split(",")
      .map((x) => String(x || "").trim())
      .filter(Boolean)
      .filter((x) => x !== "created_at");
    if (!parts.includes("id")) parts.unshift("id");
    const cleaned = parts.join(",");
    return await sb
      .from(FAMILY_TREE_CHILDREN_TABLE)
      .select(cleaned || "*")
      .eq("branch_key", branchKey)
      .limit(5000);
  }

  function classifyTreeChildrenDbError(err) { const msgRaw = err && err.message != null ? String(err.message) : ""; const detailsRaw = err && err.details != null ? String(err.details) : ""; const lowMsg = msgRaw.trim().toLowerCase(); const lowDetails = detailsRaw.trim().toLowerCase(); const isSchemaCache = lowMsg.includes("تحديث الخدمة") || lowMsg.includes("could not find the table") || lowDetails.includes("تحديث الخدمة"); if (isSchemaCache) return "schema_cache"; const isRls = lowMsg.includes("row-level security") || lowDetails.includes("row-level security") || lowMsg.includes("violates row-level security"); if (isRls) return "rls"; const isPermission = lowMsg.includes("permission denied") || lowDetails.includes("permission denied"); if (isPermission) return "permission"; const isColumnMissing = lowMsg.includes("column") && lowMsg.includes("does not exist"); const isSchemaCacheMissingColumn = lowMsg.includes("تحديث الخدمة") && lowMsg.includes("could not find") && lowMsg.includes("column"); if (isColumnMissing || isSchemaCacheMissingColumn) return "missing_column"; return "other"; }

  async function loadChildrenForBranchAdmin(branchKey, opts) {
    const res = await loadChildrenForBranch(branchKey, opts);
    if (!res.ok) return res;
    state.pathToRow = {};
    const FM = window.AlzidanFamilyPersonCore || {};
    const rows = Array.isArray(res.rows) ? res.rows : [];
    state.pathToRow =
      typeof FM.buildPathToRowIndex === "function"
        ? FM.buildPathToRowIndex(rows, normalizePersonName)
        : {};
    if (opts && opts.applyToState === true && typeof FM.attachTreeRowIdsToChildren === "function") {
      FM.attachTreeRowIdsToChildren(state.children, state.pathToRow, {
        normalizePersonName,
        normalizePersonBaseName,
      });
    }
    return res;
  }

  function findStablePersonId(nodeId) {
    const wanted = normalizePersonName(nodeId || "");
    if (!wanted) return "";
    const meta = state.pathToRow[wanted];
    if (meta && meta.person_id) return normalizePersonName(meta.person_id);
    const lists = Object.values(state.children || {});
    for (let i = 0; i < lists.length; i++) {
      const list = Array.isArray(lists[i]) ? lists[i] : [];
      for (let j = 0; j < list.length; j++) {
        const child = list[j] || {};
        if (normalizePersonName(child.name || "") !== wanted) continue;
        return normalizePersonName(child.personId || "");
      }
    }
    return "";
  }

  function findRowIdForPath(path, childObj, parentId) {
    const FM = window.AlzidanFamilyPersonCore || {};
    if (typeof FM.findTreeRowId === "function") {
      return FM.findTreeRowId(state.pathToRow, path, childObj, {
        normalizePersonName,
        normalizePersonBaseName,
      }, parentId);
    }
    const p = normalizePersonName(path || "");
    const meta = state.pathToRow[p];
    return meta && meta.id ? Number(meta.id) : 0;
  }

  async function resolveAdminTreeRowId(sb, branchKey, childIdForDelete, child, parentId) {
    let rowId = findRowIdForPath(childIdForDelete, child, parentId);
    if (rowId) return { ok: true, rowId, message: "" };
    const personId = normalizePersonName(
      (child && (child.personId || child.person_id)) || "",
    );
    const resolved = await resolveTreeRowIdForWrite(sb, childIdForDelete, {
      personId,
      parentPath: parentId || "",
    });
    if (resolved.ok && resolved.rowId) return { ok: true, rowId: resolved.rowId, message: "" };
    return {
      ok: false,
      rowId: 0,
      message: lastWriteIdentityError(resolved) || "تعذر تحديد السجل.",
      code: resolved.code || "",
    };
  }

  function getPersonRowMeta(path) {
    const p = normalizePersonName(path || "");
    const direct = state.pathToRow[p];
    if (direct && direct.person_id) return direct;
    const FM = window.AlzidanFamilyPersonCore || {};
    if (typeof FM.resolvePersonIdForNodePath === "function") {
      const pid = FM.resolvePersonIdForNodePath(p, state.pathToRow, state.children, normalizePersonName);
      if (pid && state.pathToRow["pid:" + pid]) return state.pathToRow["pid:" + pid];
      if (pid) {
        return {
          id: direct && direct.id ? Number(direct.id) : 0,
          person_id: pid,
          parent_person_id: (direct && direct.parent_person_id) || "",
          db_parent_name: (direct && direct.db_parent_name) || "",
          db_child_name: (direct && direct.db_child_name) || p,
        };
      }
    }
    return direct || { id: 0, person_id: "", parent_person_id: "" };
  }

  async function adminRpcUpsertTreeChild(row) {
    const sb = getSupabaseClient();
    const token = getAdminToken();
    if (!sb || !token) return { ok: false, error: { message: "سجل الدخول أولًا." } };
    let payload = Object.assign({}, row || {});
    if (!payload.branch_key) payload.branch_key = state.branch;
    const parentPath = normalizePersonName(payload.parent_name || payload.parent || "");
    const branchRoot = state.branch ? getBranchRootName(state.branch) : "";
    const isBranchRoot = !!(branchRoot && (parentPath === branchRoot || parentPath === state.branch));
    const FM = window.AlzidanFamilyPersonCore || {};
    if (typeof FM.bindParentWriteContext === "function" && parentPath) {
      const bound = FM.bindParentWriteContext(parentPath, state.pathToRow, canonicalHelpers());
      if (typeof FM.attachBoundParentToRow === "function") {
        payload = FM.attachBoundParentToRow(payload, bound);
      }
    }
    const CP = window.AlzidanCanonicalPerson;
    if (!payload.parent_person_id && CP && typeof CP.attachParentPersonId === "function" && payload.parent_name) {
      payload = CP.attachParentPersonId(payload, state.pathToRow, payload.parent_name, canonicalHelpers());
    } else if (!payload.parent_person_id && payload.parent_name) {
      const meta = getPersonRowMeta(payload.parent_name);
      if (meta && meta.person_id) payload.parent_person_id = meta.person_id;
    }
    const TE = window.AlzidanTreeEngine;
    if (TE && typeof TE.prepareChildWriteRow === "function") {
      const prepared = TE.prepareChildWriteRow(payload, {
        allowBranchRoot: isBranchRoot,
      });
      if (!prepared.ok) {
        return {
          ok: false,
          error: {
            message: prepared.message_ar || TE.MSG_PARENT_NULL_AR || "parent مطلوب",
            code: prepared.code || "TREE-PARENT-NULL",
          },
        };
      }
      payload = prepared.row;
    }
    // TREE-004: refuse name-only writes for non-root parents.
    if (!isBranchRoot && !normalizePersonName(payload.parent_person_id || "")) {
      return {
        ok: false,
        error: {
          message:
            (CP && CP.MSG && CP.MSG.TREE_003) ||
            "تعذر تحديد معرّف الأب (parent_person_id) لهذا المسار (TREE-003).",
          code: "TREE-003",
        },
      };
    }
    const gender = normalizeTreeChildGender(payload.gender);
    if (gender) payload.gender = gender;
    const { data, error } = await sb.rpc("admin_tree_child_upsert_v1", {
      p_token: token,
      p_row: payload,
    });
    if (error) return { ok: false, error };
    if (gender) {
      const childName = normalizePersonName(payload.child_name || payload.name || "");
      const branchKey = normalizePersonName(payload.branch_key || state.branch || "");
      const savedId = data && typeof data === "object" && !Array.isArray(data) ? Number(data.id || 0) : 0;
      let stampedOk = false;
      if (Number.isFinite(savedId) && savedId > 0) {
        const byId = await sb.rpc("admin_tree_child_set_gender_by_id_v1", {
          p_token: token,
          p_id: savedId,
          p_gender: gender,
        });
        if (byId.error && !isRpcMissingError(byId.error)) return { ok: false, error: byId.error };
        if (!byId.error && byId.data === true) stampedOk = true;
      }
      if (!stampedOk && childName && branchKey) {
        const stamped = await sb.rpc("admin_tree_child_set_gender_v1", {
          p_token: token,
          p_branch_key: branchKey,
          p_child_name: childName,
          p_gender: gender,
        });
        if (stamped.error && !isRpcMissingError(stamped.error)) return { ok: false, error: stamped.error };
      }
    }
    return { ok: true, data };
  }

  async function adminRpcDeleteTreeChildOne(branchKey, rowId) {
    const sb = getSupabaseClient();
    const token = getAdminToken();
    if (!sb || !token) return { ok: false, error: { message: "سجل الدخول أولًا." } };
    const id = Number(rowId || 0);
    if (!id) return { ok: false, error: { message: "تعذر تحديد السجل." } };
    const { data, error } = await sb.rpc("admin_tree_child_delete_one_v1", {
      p_token: token,
      p_branch_key: String(branchKey || state.branch || "").trim(),
      p_id: id,
    });
    if (error) return { ok: false, error };
    const deleted = Number(data || 0);
    if (!deleted) return { ok: false, error: { message: "row not found" } };
    return { ok: true, data: deleted };
  }

  async function adminRpcDeleteSubtree(branchKey, rowId) {
    const sb = getSupabaseClient();
    const token = getAdminToken();
    if (!sb || !token) return { ok: false, error: { message: "سجل الدخول أولًا." } };
    const id = Number(rowId || 0);
    if (!id) return { ok: false, error: { message: "تعذر تحديد السجل." } };
    const { data, error } = await sb.rpc("admin_tree_child_delete_subtree_v1", {
      p_token: token,
      p_branch_key: String(branchKey || state.branch || "").trim(),
      p_id: id,
    });
    if (error) return { ok: false, error };
    return { ok: true, data };
  }

  function normalizeMemberPhone(value) {
    if (window.AlzidanPhoneIntl && typeof window.AlzidanPhoneIntl.normalizeMemberPhoneE164 === "function") {
      return window.AlzidanPhoneIntl.normalizeMemberPhoneE164(value);
    }
    const raw = normalizeArabicDigitsToLatin(String(value || "").trim());
    if (!raw) return "";
    let digits = raw.replace(/[^0-9]/g, "");
    if (digits.startsWith("966") && digits.length >= 12) return "+" + digits;
    if (digits.length === 9 && digits.startsWith("5")) return "+966" + digits;
    if (digits.length === 10 && digits.startsWith("05")) return "+966" + digits.slice(1);
    return "";
  }

  async function saveAdminMemberProfile(sb, phone, branchKey, childPath, personId) {
    if (!phone) return { ok: true, skipped: true };
    const branch = String(branchKey || "").trim();
    const path = normalizePersonName(childPath || "");
    let rowId = findRowIdForPath(path);
    let resolvedPersonId = normalizePersonName(personId || "");
    if ((!rowId || !resolvedPersonId) && sb && branch && (path || resolvedPersonId)) {
      let q = sb.from("tree_children").select("id,person_id,child_name").eq("branch_key", branch).limit(1);
      q = resolvedPersonId ? q.eq("person_id", resolvedPersonId) : q.eq("child_name", path);
      const foundRow = await q.maybeSingle();
      if (foundRow.data && foundRow.data.id) {
        rowId = Number(foundRow.data.id);
        resolvedPersonId = normalizePersonName(foundRow.data.person_id || resolvedPersonId);
      }
    }
    if (!branch || !rowId) return { ok: false, error: { message: "تعذر ربط رقم الجوال بسجل الشخص." } };
    const displayName = path.split("/").filter(Boolean).slice(-1)[0] || "";
    const row = {
      phone,
      branch_key: branch,
      tree_child_id: rowId,
      person_id: resolvedPersonId || personId || null,
      display_name: displayName || null,
      status: "active",
      updated_at: new Date().toISOString(),
    };
    let existingId = 0;
    if (rowId) {
      const byChild = await sb.from("member_profiles").select("id").eq("tree_child_id", rowId).limit(1).maybeSingle();
      if (byChild.data && byChild.data.id) existingId = Number(byChild.data.id);
    }
    if (!existingId && (resolvedPersonId || personId)) {
      const byPid = await sb
        .from("member_profiles")
        .select("id")
        .eq("person_id", resolvedPersonId || personId)
        .limit(1)
        .maybeSingle();
      if (byPid.data && byPid.data.id) existingId = Number(byPid.data.id);
    }
    if (!existingId) {
      const byPhone = await sb.from("member_profiles").select("id").eq("phone", phone).limit(1).maybeSingle();
      if (byPhone.error) return { ok: false, error: byPhone.error };
      if (byPhone.data && byPhone.data.id) existingId = Number(byPhone.data.id);
    }
    if (existingId) {
      const { error } = await sb.from("member_profiles").update(row).eq("id", existingId);
      if (error) return { ok: false, error };
      return { ok: true };
    }
    row.created_at = new Date().toISOString();
    const { error } = await sb.from("member_profiles").insert(row);
    if (error) return { ok: false, error };
    return { ok: true };
  }

  async function loadAdminMemberPhone(sb, branchKey, childPath, personId) {
    const phoneQuery = async (filter) => {
      const r = await sb.from("member_profiles").select("phone").match(filter).limit(1).maybeSingle();
      if (r.error || !r.data) return "";
      return String(r.data.phone || "").trim();
    };
    const path = normalizePersonName(childPath || "");
    const rowId = findRowIdForPath(path);
    if (rowId) {
      const p = await phoneQuery({ branch_key: branchKey, tree_child_id: rowId });
      if (p) return p;
    }
    if (personId) {
      const p = await phoneQuery({ branch_key: branchKey, person_id: personId });
      if (p) return p;
    }
    return "";
  }


  function canonicalHelpers() {
    return {
      normalizePersonName,
      normalizePersonBaseName,
      getLeafStoredNameFromNodeId,
    };
  }

  function lastWriteIdentityError(result) {
    if (!result || result.ok) return "";
    return result.message || (window.AlzidanCanonicalPerson && window.AlzidanCanonicalPerson.MSG
      ? window.AlzidanCanonicalPerson.MSG.NOT_FOUND
      : "تعذر تحديد رقم الشخص في قاعدة البيانات.");
  }

  /** Resolve tree_children.id for writes via person_id / Node Path — never ambiguous name pick. */
  async function resolveTreeRowIdForWrite(sb, nodePath, opts) {
    const options = opts || {};
    const CP = window.AlzidanCanonicalPerson;
    if (!CP || typeof CP.resolveTreeRowIdForWrite !== "function") {
      const meta = getPersonRowMeta(nodePath);
      if (meta && meta.id) return { ok: true, rowId: Number(meta.id), personId: meta.person_id || "", code: "", message: "" };
      return { ok: false, rowId: 0, personId: "", code: "SPOUSE-001", message: "وحدة الهوية غير محمّلة." };
    }
    return CP.resolveTreeRowIdForWrite({
      sb,
      branchKey: state.branch,
      nodePath,
      personId: options.personId || "",
      parentPath: options.parentPath || "",
      pathToRow: state.pathToRow,
      helpers: canonicalHelpers(),
    });
  }

  /**
   * Patch 3 — husband for wife/mother writes: selection person_id / row id first.
   * Never name-only getTreePersonIdByName / limit(1).
   */
  async function resolveHusbandForSpouseWrite(sb, selectedPerson) {
    const parentName = resolveSelectedParentId(normalizePersonName(selectedPerson), state.branch);
    if (!parentName) {
      return {
        ok: false,
        rowId: 0,
        personId: "",
        code: "SPOUSE-001",
        message: (window.AlzidanCanonicalPerson && window.AlzidanCanonicalPerson.MSG
          ? window.AlzidanCanonicalPerson.MSG.SPOUSE_001
          : "تعذر حل هوية الزوج للكتابة (SPOUSE-001)."),
      };
    }
    const meta = getPersonRowMeta(parentName);
    const personId =
      normalizePersonName((meta && meta.person_id) || "") ||
      findStablePersonId(parentName) ||
      "";
    const CP = window.AlzidanCanonicalPerson;
    if (CP && typeof CP.resolveHusbandForSpouseWrite === "function") {
      return CP.resolveHusbandForSpouseWrite({
        sb,
        branchKey: state.branch,
        nodePath: parentName,
        personId,
        rowId: meta && meta.id ? Number(meta.id) : 0,
        pathToRow: state.pathToRow,
        helpers: canonicalHelpers(),
      });
    }
    if (meta && meta.id) {
      return { ok: true, rowId: Number(meta.id), personId, code: "", message: "" };
    }
    return resolveTreeRowIdForWrite(sb, parentName, { personId });
  }

  /** @deprecated — returns tree_children.id or null; prefer resolveHusbandForSpouseWrite. */
  async function getTreePersonIdByName(sb, fullName) {
    const resolved = await resolveHusbandForSpouseWrite(sb, fullName);
    if (!resolved.ok || !resolved.rowId) return null;
    return resolved.rowId;
  }
  

  function buildPersonOptionsForFamilyMgmt(branchKey) {
    const branchRoot = getBranchRootName(branchKey);
    const dynamicParents = Object.keys(state.children || {});
    const dynamicChildren = [];
    Object.values(state.children || {}).forEach((list) => {
      (Array.isArray(list) ? list : []).forEach((c) => {
        const n = normalizePersonName(c && c.name ? c.name : "");
        if (n) dynamicChildren.push(n);
      });
    });
    const ids = [...dynamicParents, ...dynamicChildren].map(normalizePersonName).filter(Boolean);
    const baseCounts = new Map();
    ids.forEach((id) => {
      const base = getDisplayNameForNodeId(id, branchRoot);
      if (!base) return;
      baseCounts.set(base, (baseCounts.get(base) || 0) + 1);
    });
    const seen = new Set();
    const options = [];
    const FM = window.AlzidanFamilyPersonCore || {};
    ids.forEach((id) => {
      const n = normalizePersonName(id || "");
      if (!n || seen.has(n)) return;
      seen.add(n);
      const base = getDisplayNameForNodeId(n, branchRoot);
      let label = base;
      if (base && (baseCounts.get(base) || 0) > 1) {
        // Full path for ambiguous same-leaf names — never auto-pick first.
        label = base + " — " + n;
      }
      const personId =
        typeof FM.resolvePersonIdForNodePath === "function"
          ? FM.resolvePersonIdForNodePath(n, state.pathToRow, state.children, normalizePersonName)
          : normalizePersonName((state.pathToRow[n] && state.pathToRow[n].person_id) || "");
      options.push({ value: n, label: label || n, personId: personId || "" });
    });
    if (typeof FM.dedupePersonOptionsByPersonId === "function") {
      return FM.dedupePersonOptionsByPersonId(options, {
        normalizePersonName,
        pathToRow: state.pathToRow,
        resolvePersonId: (path) =>
          typeof FM.resolvePersonIdForNodePath === "function"
            ? FM.resolvePersonIdForNodePath(path, state.pathToRow, state.children, normalizePersonName)
            : "",
      });
    }
    return options;
  }

  /**
   * Typeahead against tree_children (capped). Does not require a full branch dump
   * into the person <select>. Prefer leaf matches over mid-path parent_name hits.
   */
  async function searchPersonsInBranch(term) {
    const q = normalizePersonName(term || "");
    if (!q) return [];
    const FM = window.AlzidanFamilyPersonCore || {};
    const limit =
      typeof FM.PERSON_SEARCH_LIMIT === "number" ? FM.PERSON_SEARCH_LIMIT : 40;
    const branch = normalizePersonName(state.branch || getAdminFmBranch() || "");
    if (branch && !state.branch) state.branch = branch;
    const sb = getSupabaseClient();
    if (!sb || !branch) return [];

    let rows = [];
    try {
      const orFilter =
        typeof FM.buildPersonNameIlikeOrFilter === "function"
          ? FM.buildPersonNameIlikeOrFilter(q)
          : "child_name.ilike.%" + q + "%,name.ilike.%" + q + "%";
      if (!orFilter) return [];
      let fb = sb
        .from(FAMILY_TREE_CHILDREN_TABLE)
        .select("person_id,branch_key,child_name,name,parent_name,parent")
        .or(orFilter)
        .limit(limit);
      fb = fb.eq("branch_key", branch);
      const res = await fb;
      if (!res.error && Array.isArray(res.data)) rows = res.data;
    } catch (_) {
      rows = [];
    }

    if (
      !rows.length &&
      typeof FM.buildPersonSearchOptionsFromRows !== "function"
    ) {
      return [];
    }
    if (typeof FM.buildPersonSearchOptionsFromRows === "function") {
      return FM.buildPersonSearchOptionsFromRows(rows, q, { limit: limit });
    }
    return rows
      .map((r) => {
        const path = normalizePersonName(r.child_name || r.name || "");
        return {
          value: path,
          path: path,
          label: path,
          personId: normalizePersonName(r.person_id || ""),
          person_id: normalizePersonName(r.person_id || ""),
        };
      })
      .filter((o) => !!o.value)
      .slice(0, limit);
  }

  function ensurePersonOptionForFamilyMgmt(path, meta) {
    const n = normalizePersonName(path || "");
    if (!n) return;
    const o = meta || {};
    const personId = normalizePersonName(o.personId || o.person_id || "");
    if (!state.pathToRow) state.pathToRow = {};
    const prev = state.pathToRow[n] || {};
    const row = {
      id: prev.id || 0,
      person_id: personId || prev.person_id || "",
      parent_person_id: prev.parent_person_id || "",
      db_parent_name: prev.db_parent_name || "",
      db_child_name: prev.db_child_name || n,
      photo_url: prev.photo_url || "",
    };
    state.pathToRow[n] = row;
    if (row.person_id) {
      state.pathToRow["pid:" + row.person_id] = row;
    }
  }
  

  function parseWifeFamilyValue(raw) {
    const v = String(raw || "").trim();
    if (v === "true") return true;
    if (v === "false") return false;
    return null;
  }

  function parseWifeMarriageStatus(raw) {
    const v = String(raw || "active").trim().toLowerCase();
    if (v === "divorced" || v === "مطلقة") return "divorced";
    return "active";
  }

  function formatSpouseSaveError(error) {
    const msg = String((error && error.message) || "");
    if (/مسجلة مسبق|زوج آخر|duplicate.*wife/i.test(msg)) {
      return "قاعدة البيانات ما زالت تمنع الزواج الثاني. نفّذ مرة واحدة في Supabase → SQL Editor الملف: supabase/sql/COPY-ME-tree-spouses-divorced-remarriage-v1.sql ثم حدّث الصفحة وأعد الحفظ.";
    }
    return msg || "خطأ غير معروف";
  }

  function spouseRowForRpc(row) {
    const out = Object.assign({}, row || {});
    if (out.updated_at instanceof Date) out.updated_at = out.updated_at.toISOString();
    return out;
  }

  async function formatDuplicateWifeMessage(sb, dup) {
    let suffix = "";
    if (sb && dup && dup.husband_id) {
      try {
        const h = await sb
          .from("tree_children")
          .select("child_name,name")
          .eq("id", Number(dup.husband_id))
          .maybeSingle();
        const path = h && h.data ? String(h.data.child_name || h.data.name || "").trim() : "";
        if (path) {
          const leaf = path.includes("/") ? path.split("/").filter(Boolean).slice(-1)[0] : path;
          suffix = " (مسجلة حالياً مع: " + leaf + ")";
        }
      } catch (e) {}
    }
    return "هذه الزوجة مسجلة نشطة مع زوج آخر" + suffix + ". افتح ذلك الزوج → تعديل الزوجة → غيّر الحالة إلى «مطلقة»، ثم أعد الإضافة هنا.";
  }
  

  function wifeDuplicateKey(value) {
    const SpousesCore = window.AlzidanSpousesCore || {};
    if (SpousesCore && typeof SpousesCore.wifeDuplicateKey === "function") {
      return SpousesCore.wifeDuplicateKey(value);
    }
    return normalizePersonName(value || "")
      .replace(/\b(بن|ابن|بنت)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  

  function hasThreePartWifeName(value) {
    return wifeDuplicateKey(value).split(" ").filter(Boolean).length >= 3;
  }
  

  async function findDuplicateWifeForAdmin(sb, husbandId, row, editingSpouseId) {
    const SpousesCore = window.AlzidanSpousesCore || {};
    if (SpousesCore && typeof SpousesCore.findDuplicateWife === "function") {
      return SpousesCore.findDuplicateWife(sb, husbandId, row, editingSpouseId || 0);
    }
    const candidate = row.wife_lineage && hasThreePartWifeName(row.wife_lineage) ? row.wife_lineage : row.wife_name;
    if (!hasThreePartWifeName(candidate)) return null;
    const key = wifeDuplicateKey(candidate);
    const { data, error } = await sb.from("tree_spouses").select("id,husband_id,wife_name,wife_lineage,status").limit(1000);
    if (error) throw error;
    const SpousesCoreActive = window.AlzidanSpousesCore || {};
    const isActive = SpousesCoreActive && typeof SpousesCoreActive.isActiveSpouse === "function"
      ? SpousesCoreActive.isActiveSpouse.bind(SpousesCoreActive)
      : function (status) {
          const value = String(status || "active").trim().toLowerCase();
          return !value || value === "active";
        };
    return (Array.isArray(data) ? data : []).find((item) => {
      if (editingSpouseId && Number(item.id) === Number(editingSpouseId)) return false;
      if (Number(item.husband_id) === Number(husbandId)) return false;
      if (!isActive(item.status)) return false;
      const other = item.wife_lineage && hasThreePartWifeName(item.wife_lineage) ? item.wife_lineage : item.wife_name;
      return hasThreePartWifeName(other) && wifeDuplicateKey(other) === key;
    }) || null;
  }
  

  async function familyApiLoadWivesForPerson(personName) {
    const sb = getSupabaseClient();
    const SpousesCore = window.AlzidanSpousesCore || {};
    const ctx = await ensureAdminWriteContext();
    if (!ctx.ok) return { data: [], error: { message: ctx.message } };
    if (!sb) return { data: [], error: { message: "تعذر تحميل الزوجات حالياً، حاول لاحقاً." } };
    const husbandResolved = await resolveHusbandForSpouseWrite(sb, personName);
    if (!husbandResolved.ok || !husbandResolved.rowId) {
      if (husbandResolved.code === "TREE-001") {
        return { data: [], error: { message: lastWriteIdentityError(husbandResolved), code: "TREE-001" } };
      }
      return { data: [], error: null };
    }
    const husbandId = husbandResolved.rowId;
    if (SpousesCore && typeof SpousesCore.loadSpousesByHusband === "function") {
      return SpousesCore.loadSpousesByHusband(sb, husbandId);
    }
    const r = await sb
      .from("tree_spouse_summary")
      .select("id,husband_id,wife_name,wife_is_family_member,wife_branch_key,wife_family_name,wife_lineage,marriage_order,status,confidence,linked_children_count")
      .eq("husband_id", husbandId)
      .order("marriage_order", { ascending: true })
      .order("id", { ascending: true });
    if (r.error) return { data: [], error: r.error };
    return { data: Array.isArray(r.data) ? r.data : [], error: null };
  }

  async function insertOrUpdateSpouseRow(sb, row, editingId) {
    const token = getAdminToken();
    if (token && sb && typeof sb.rpc === "function") {
      try {
        const rpc = await sb.rpc("admin_tree_spouse_upsert_v1", {
          p_token: token,
          p_spouse_id: editingId ? Number(editingId) : null,
          p_row: spouseRowForRpc(row),
        });
        if (!rpc.error && rpc.data && rpc.data.ok) {
          return { data: { id: rpc.data.id }, error: null };
        }
        const rpcMsg = String((rpc.error && rpc.error.message) || "");
        if (rpc.error && !/admin_tree_spouse_upsert_v1|could not find the function|schema cache/i.test(rpcMsg)) {
          return { data: null, error: rpc.error };
        }
      } catch (e) {
        // fall through to direct table write
      }
    }
    const withPerson = Object.assign({}, row);
    const withoutPerson = Object.assign({}, row);
    delete withoutPerson.husband_person_id;
    if (editingId) {
      let res = await sb.from("tree_spouses").update(withPerson).eq("id", editingId);
      if (res.error && /husband_person_id/i.test(String(res.error.message || ""))) {
        res = await sb.from("tree_spouses").update(withoutPerson).eq("id", editingId);
      }
      return res;
    }
    let res = await sb.from("tree_spouses").insert(withPerson).select("id").single();
    if (res.error && /husband_person_id/i.test(String(res.error.message || ""))) {
      res = await sb.from("tree_spouses").insert(withoutPerson).select("id").single();
    }
    return res;
  }

  async function prepareWifeRemarriageInsert(sb, husbandId, row) {
    const SpousesCore = window.AlzidanSpousesCore || {};
    if (SpousesCore && typeof SpousesCore.endActiveSpouseMatchesElsewhere === "function") {
      return SpousesCore.endActiveSpouseMatchesElsewhere(sb, husbandId, row, 0);
    }
    return { ended: 0, matches: [] };
  }

  async function familyApiSaveWife(payload) {
    const writeCtx = await ensureAdminWriteContext();
    if (!writeCtx.ok) return writeCtx;
    const sb = getSupabaseClient();
    if (!sb) return { ok: false, message: "تعذر الاتصال بقاعدة البيانات." };
    const husbandResolved = await resolveHusbandForSpouseWrite(sb, payload.personId);
    if (!husbandResolved.ok || !husbandResolved.rowId) {
      return { ok: false, message: lastWriteIdentityError(husbandResolved), code: husbandResolved.code || "SPOUSE-001" };
    }
    const husbandId = husbandResolved.rowId;
    const husbandPersonId = husbandResolved.personId || "";
    const name = normalizePersonName(payload.name || "");
    if (!name) return { ok: false, message: "أدخل اسم الزوجة." };
    const orderRaw = payload.order ? normalizeArabicDigitsToLatin(String(payload.order).trim()) : "";
    const order = orderRaw ? parseInt(orderRaw, 10) : null;
    if (orderRaw && (!order || order < 1 || order > 4)) {
      return { ok: false, message: "ترتيب الزوجة يجب أن يكون من 1 إلى 4." };
    }
    const familyVal = parseWifeFamilyValue(payload.family);
    const row = {
      husband_id: husbandId,
      husband_person_id: husbandPersonId || null,
      wife_name: name,
      wife_is_family_member: familyVal,
      wife_branch_key: familyVal === false ? null : (payload.branch ? String(payload.branch).trim() : null),
      wife_family_name: familyVal === false && payload.familyName ? normalizePersonName(payload.familyName) : null,
      wife_lineage: payload.lineage ? normalizePersonName(payload.lineage) : null,
      marriage_order: order,
      status: parseWifeMarriageStatus(payload.status),
      confidence: "confirmed",
      data_source: "admin",
      updated_at: new Date().toISOString(),
    };
    const editingId = Number(payload.editingSpouseId || 0);
    if (editingId) {
      const res = await insertOrUpdateSpouseRow(sb, row, editingId);
      if (res.error) return { ok: false, message: "تعذر تعديل الزوجة: " + (res.error.message || "خطأ غير معروف") };
      const wantedStatus = parseWifeMarriageStatus(payload.status);
      if (wantedStatus === "divorced") {
        const check = await sb.from("tree_spouses").select("status").eq("id", editingId).maybeSingle();
        const SpousesCore = window.AlzidanSpousesCore || {};
        const stillActive = SpousesCore && typeof SpousesCore.isActiveSpouse === "function"
          ? SpousesCore.isActiveSpouse(check.data && check.data.status)
          : String((check.data && check.data.status) || "active").toLowerCase() === "active";
        if (stillActive) {
          return {
            ok: false,
            message: "لم تُحفظ حالة «مطلقة» في قاعدة البيانات. نفّذ SQL: supabase/sql/COPY-ME-tree-spouses-divorced-remarriage-v1.sql في Supabase ثم أعد المحاولة.",
          };
        }
      }
      let linkNote = "";
      if (familyVal !== false) {
        const SpousesCore = window.AlzidanSpousesCore || {};
        if (SpousesCore.autoLinkHusbandSonsToSpouse) {
          const husbandPath = normalizePersonName(payload.personId || "");
          const branchKey = normalizePersonName(payload.branch || state.branch || "");
          const linkRes = await SpousesCore.autoLinkHusbandSonsToSpouse(sb, {
            spouseId: editingId,
            spouse: Object.assign({ id: editingId }, row),
            husbandPath: husbandPath,
            branchKey: branchKey,
          });
          if (linkRes && !linkRes.ok && linkRes.message) {
            return { ok: false, message: linkRes.message };
          }
          if (linkRes && linkRes.linked > 0) {
            linkNote = " — رُبط " + linkRes.linked + " ابن/أبناء بالأم تلقائياً.";
          }
        }
      }
      return {
        ok: true,
        message:
          (wantedStatus === "divorced" ? "تم تسجيل الزوجة كمطلقة." : "تم تعديل بيانات الزوجة.") +
          linkNote,
      };
    }
    let endedPrior = 0;
    try {
      const endedPrep = await prepareWifeRemarriageInsert(sb, husbandId, row);
      endedPrior = Number(endedPrep && endedPrep.ended) || 0;
      const dup = await findDuplicateWifeForAdmin(sb, husbandId, row, 0);
      if (dup) {
        const retryEnd = await prepareWifeRemarriageInsert(sb, husbandId, row);
        endedPrior += Number(retryEnd && retryEnd.ended) || 0;
        const dupAfter = await findDuplicateWifeForAdmin(sb, husbandId, row, 0);
        if (dupAfter) {
          return {
            ok: false,
            message: await formatDuplicateWifeMessage(sb, dupAfter),
          };
        }
      }
    } catch (err) {
      return { ok: false, message: "تعذر التحقق من تكرار اسم الزوجة، حاول لاحقًا." };
    }
    let r = await insertOrUpdateSpouseRow(sb, row, 0);
    if (r.error && /مسجلة|زوج آخر/i.test(String(r.error.message || ""))) {
      try {
        const retryEnd = await prepareWifeRemarriageInsert(sb, husbandId, row);
        endedPrior += Number(retryEnd && retryEnd.ended) || 0;
      } catch (e) {}
      r = await insertOrUpdateSpouseRow(sb, row, 0);
    }
    if (r.error) return { ok: false, message: "تعذر حفظ الزوجة: " + formatSpouseSaveError(r.error) };
    const savedSpouseId = Number((r.data && r.data.id) || editingId || 0);
    let linkNote = "";
    if (savedSpouseId && familyVal !== false) {
      const SpousesCore = window.AlzidanSpousesCore || {};
      if (SpousesCore.autoLinkHusbandSonsToSpouse) {
        const husbandPath = normalizePersonName(payload.personId || "");
        const branchKey = normalizePersonName(payload.branch || state.branch || "");
        const linkRes = await SpousesCore.autoLinkHusbandSonsToSpouse(sb, {
          spouseId: savedSpouseId,
          spouse: Object.assign({ id: savedSpouseId }, row),
          husbandPath: husbandPath,
          branchKey: branchKey,
        });
        if (linkRes && !linkRes.ok && linkRes.message) {
          return { ok: false, message: linkRes.message };
        }
        if (linkRes && linkRes.linked > 0) {
          linkNote = " — رُبط " + linkRes.linked + " ابن/أبناء بالأم تلقائياً.";
        }
      }
    }
    return {
      ok: true,
      message:
        (endedPrior > 0
          ? "تم حفظ الزوجة (وُسمت " + endedPrior + " زوجية سابقة مطلقة تلقائياً)."
          : "تم حفظ الزوجة.") + linkNote,
    };
  }

  async function familyApiDeleteWife(payload) {
    const writeCtx = await ensureAdminWriteContext();
    if (!writeCtx.ok) return writeCtx;
    const sb = getSupabaseClient();
    if (!sb) return { ok: false, message: "تعذر الاتصال بقاعدة البيانات." };
    const spouse = payload && payload.spouse ? payload.spouse : {};
    const spouseId = Number((payload && payload.spouseId) || spouse.id || 0);
    if (!spouseId) return { ok: false, message: "تعذر تحديد الزوجة للحذف." };

    const personName = normalizePersonName((payload && payload.personId) || "");
    if (personName) {
      const husbandResolved = await resolveHusbandForSpouseWrite(sb, personName);
      if (!husbandResolved.ok || !husbandResolved.rowId) {
        return {
          ok: false,
          message: lastWriteIdentityError(husbandResolved),
          code: husbandResolved.code || "SPOUSE-001",
        };
      }
      const found = await sb
        .from("tree_spouses")
        .select("id,husband_id,wife_name")
        .eq("id", spouseId)
        .maybeSingle();
      if (found.error) {
        return { ok: false, message: "تعذر التحقق من الزوجة." };
      }
      if (!found.data || Number(found.data.husband_id) !== Number(husbandResolved.rowId)) {
        return { ok: false, message: "هذه الزوجة غير مرتبطة بالشخص المحدد." };
      }
    }

    const wifeName = normalizePersonName(
      (payload && payload.wifeName) || spouse.wife_name || "",
    );
    const linked = Number(
      (payload && payload.linkedChildrenCount) || spouse.linked_children_count || 0,
    );
    const extra =
      linked > 0
        ? "\nسيتم فك ربط " + linked + " من الأبناء بهذه الزوجة دون حذفهم من الشجرة."
        : "\nسيتم فك روابط أبنائها أولاً دون حذف الأبناء من الشجرة.";
    if (!window.confirm("حذف الزوجة: " + (wifeName || spouseId) + " ؟" + extra)) {
      return { ok: false, message: "تم الإلغاء." };
    }

    const SpousesCore = window.AlzidanSpousesCore || {};
    if (typeof SpousesCore.deleteSpouseById === "function") {
      return SpousesCore.deleteSpouseById(sb, spouseId);
    }
    const links = await sb.from("tree_mother_links").delete().eq("spouse_id", spouseId);
    if (links.error) {
      return { ok: false, message: "تعذر فك روابط الأبناء: " + (links.error.message || "خطأ") };
    }
    const del = await sb.from("tree_spouses").delete().eq("id", spouseId);
    if (del.error) {
      return { ok: false, message: "تعذر حذف الزوجة: " + (del.error.message || "خطأ") };
    }
    const check = await sb.from("tree_spouses").select("id").eq("id", spouseId).maybeSingle();
    if (check.error) {
      return { ok: false, message: "تعذر التحقق من الحذف: " + (check.error.message || "خطأ") };
    }
    if (check.data && check.data.id) {
      return { ok: false, message: "لم يتم حذف الزوجة فعلياً. تحقق من صلاحيات الحذف." };
    }
    return { ok: true, message: "تم حذف الزوجة." };
  }

  async function familyApiGetParentChildrenForWifeManager(personName) {
    const sb = getSupabaseClient();
    syncAdminBranchFromSelect();
    const parentId = resolveSelectedParentId(normalizePersonName(personName || ""), state.branch);
    if (!sb || !parentId || !state.branch) return [];
    const parentLeaf = getLeafStoredNameFromNodeId(parentId);
    const parentCandidates = [parentId, parentLeaf].filter(Boolean);
    const { data, error } = await sb
      .from("tree_children")
      .select("id,person_id,branch_key,parent_name,parent,child_name,name,birth_order,birth_date_h,birth_date_g,birth_year,death_date_g,death_date_h,city,area,is_deceased,deceased")
      .eq("branch_key", state.branch)
      .in("parent_name", parentCandidates)
      .limit(500);
    if (error) return [];
    return (Array.isArray(data) ? data : []).map((r) => {
      const childPath = normalizePersonName(r.child_name || r.name || "");
      const label = getDisplayNameForNodeId(childPath, state.branch ? getBranchRootName(state.branch) : "") || childPath;
      return {
        id: r.id,
        name: childPath,
        personId: normalizePersonName(r.person_id || ""),
        label,
        order: r.birth_order || "",
        hdate: r.birth_date_h || "",
        gdate: r.birth_date_g || "",
        ddate: String(r.death_date_g || "").slice(0, 10),
        dhdate: r.death_date_h || "",
        year: r.birth_year || "",
        city: r.city || "",
        area: r.area || "",
        deceased: !!(r.is_deceased || r.deceased),
      };
    }).filter((c) => c.id != null && c.name);
  }
  

  async function familyApiLoadLinkedChildrenForSpouse(spouseId) {
    const sb = getSupabaseClient();
    if (!sb || !spouseId) return new Set();
    const { data, error } = await sb.from("tree_mother_links").select("child_id").eq("spouse_id", spouseId).limit(1000);
    if (error) return new Set();
    return new Set((Array.isArray(data) ? data : []).map((r) => String(r.child_id)));
  }
  

  async function familyApiSaveWifeChildrenLinks(payload) {
    const sb = getSupabaseClient();
    const spouse = payload && payload.spouse;
    if (!sb || !spouse || spouse.id == null) return { ok: false, message: "تعذر حفظ الربط." };
    const spouseId = Number(spouse.id);
    const childIds = (payload.children || []).map((c) => String(c.id)).filter(Boolean);
    const checkedIds = new Set((payload.checkedIds || []).map(String));
    if (childIds.length) {
      const del = await sb.from("tree_mother_links").delete().in("child_id", childIds).eq("spouse_id", spouseId);
      if (del.error) return { ok: false, message: "تعذر تحديث الربط: " + (del.error.message || "خطأ غير معروف") };
    }
    const selectedChildren = (payload.children || []).filter((c) => checkedIds.has(String(c.id)));
    if (selectedChildren.length) {
      const rows = selectedChildren.map((child) => ({
        child_id: Number(child.id),
        spouse_id: spouseId,
        mother_name: spouse.wife_name || null,
        mother_is_family_member: spouse.wife_is_family_member == null ? null : spouse.wife_is_family_member,
        mother_branch_key: spouse.wife_branch_key || null,
        mother_family_name: spouse.wife_family_name || null,
        mother_lineage: spouse.wife_lineage || null,
        confidence: "confirmed",
        updated_at: new Date().toISOString(),
      }));
      const ins = await sb.from("tree_mother_links").upsert(rows, { onConflict: "child_id" });
      if (ins.error) return { ok: false, message: "تعذر حفظ ربط الأبناء: " + (ins.error.message || "خطأ غير معروف") };
    }
    return { ok: true };
  }
  

  async function familyApiConfirmLinkAllChildrenToOnlyWife(personName) {
    const writeCtx = await ensureAdminWriteContext();
    if (!writeCtx.ok) return writeCtx;
    const sb = getSupabaseClient();
    if (!sb) return { ok: false, message: "تعذر الاتصال بقاعدة البيانات." };
    const husbandResolved = await resolveHusbandForSpouseWrite(sb, personName);
    if (!husbandResolved.ok || !husbandResolved.rowId) {
      return { ok: false, message: lastWriteIdentityError(husbandResolved), code: husbandResolved.code || "SPOUSE-001" };
    }
    const husbandId = husbandResolved.rowId;
    const ok = window.confirm("تأكيد مهم: سيتم ربط كل أبناء هذا الشخص بزوجته الوحيدة المسجلة. هل أنت متأكد؟");
    if (!ok) return { ok: false, message: "تم الإلغاء." };
    const r = await sb.rpc("confirm_link_all_children_to_only_spouse", { p_husband_id: husbandId });
    if (r.error) return { ok: false, message: r.error.message || "تعذر الربط الجماعي." };
    return { ok: true, count: r.data || 0 };
  }

  async function familyApiLinkChildToSpouse(childId, spouseId) {
    if (!spouseId) return { ok: true, skipped: true };
    const sb = getSupabaseClient();
    if (!sb) return { ok: false, error: { message: "تعذر الاتصال بقاعدة البيانات." } };
    const childPath = normalizePersonName(childId || "");
    const childMeta = getPersonRowMeta(childPath);
    const childPersonUuid =
      normalizePersonName((childMeta && childMeta.person_id) || "") ||
      findStablePersonId(childPath) ||
      "";
    const childResolved = await resolveTreeRowIdForWrite(sb, childPath, {
      personId: childPersonUuid,
    });
    if (!childResolved.ok || !childResolved.rowId) {
      return { ok: false, error: { message: lastWriteIdentityError(childResolved) || "تعذر تحديد رقم الابن في قاعدة البيانات.", code: childResolved.code || "TREE-001" } };
    }
    const childPersonId = childResolved.rowId;
    const spouseRes = await sb
      .from("tree_spouses")
      .select("id,wife_name,wife_is_family_member,wife_branch_key,wife_family_name,wife_lineage")
      .eq("id", Number(spouseId))
      .maybeSingle();
    if (spouseRes.error) return { ok: false, error: spouseRes.error };
    const spouse = spouseRes.data || {};
    if (!spouse.id) return { ok: false, error: { message: "تعذر تحديد الزوجة المختارة." } };
    const row = {
      child_id: Number(childPersonId),
      spouse_id: Number(spouse.id),
      mother_name: spouse.wife_name || null,
      mother_is_family_member: spouse.wife_is_family_member == null ? null : spouse.wife_is_family_member,
      mother_branch_key: spouse.wife_branch_key || null,
      mother_family_name: spouse.wife_family_name || null,
      mother_lineage: spouse.wife_lineage || null,
      confidence: "confirmed",
      updated_at: new Date().toISOString(),
    };
    const ins = await sb.from("tree_mother_links").upsert(row, { onConflict: "child_id" });
    if (ins.error) return { ok: false, error: ins.error };
    return { ok: true };
  }
  

  function normalizeTreeChildGender(value) {
    const g = String(value || "").trim().toLowerCase();
    if (g === "daughter" || g === "female" || g === "f" || g === "أنثى" || g === "انثى" || g === "ابنة" || g === "بنت") return "daughter";
    if (g === "son" || g === "male" || g === "m" || g === "ذكر" || g === "ابن") return "son";
    return "";
  }

  async function familyApiSaveChild(payload) {
    const writeCtx = await ensureAdminWriteContext();
    if (!writeCtx.ok) return writeCtx;
    const selectedParentName = resolveSelectedParentId(normalizePersonName(payload.personId || payload.boundParentPath), state.branch);
    const FM = window.AlzidanFamilyPersonCore || {};
    const bound =
      typeof FM.bindParentWriteContext === "function"
        ? FM.bindParentWriteContext(selectedParentName, state.pathToRow, {
            normalizePersonName,
          })
        : { parentPath: selectedParentName, parentPersonId: "" };
    if (selectedParentName && !bound.parentPersonId) {
      const meta = getPersonRowMeta(selectedParentName);
      if (meta && meta.person_id) bound.parentPersonId = String(meta.person_id);
    }
    const branchRoot = getBranchRootName(state.branch);
    const isBranchRoot = !!(branchRoot && (selectedParentName === branchRoot || selectedParentName === state.branch));
    if (!isBranchRoot && !bound.parentPersonId) {
      return {
        ok: false,
        message:
          "يلزم parent_person_id للأب المحدد قبل إضافة أبناء. أعد اختيار الأب من القائمة (TREE-003).",
        code: "TREE-003",
      };
    }
    const rawName = normalizePersonName(payload.name || "");
    const deceased = !!payload.deceased;
    const hijriInput = deceased ? "" : String(payload.hijri || "").trim();
    const gregInput = deceased ? "" : String(payload.greg || "").trim();
    const hijriNorm = hijriInput ? normalizeHijriDateISO(hijriInput) : "";
    const gregNorm = gregInput ? normalizeGregorianDateISO(gregInput) : "";
    if (hijriInput && !hijriNorm) return { ok: false, message: "تاريخ الميلاد (هجري) غير صحيح. الصيغة: YYYY-MM-DD" };
    if (gregInput && !gregNorm) return { ok: false, message: "تاريخ الميلad (ميلادي) غير صحيح." };
    let finalHijri = hijriNorm;
    let finalGreg = gregNorm;
    if (finalHijri && !finalGreg) finalGreg = hijriToGregorianISO(finalHijri);
    if (finalGreg && !finalHijri) finalHijri = gregorianToHijriISO(finalGreg);
    if (finalHijri && !finalGreg) return { ok: false, message: "تعذر تحويل التاريخ الهجري إلى ميلادي." };
    if (finalGreg && !finalHijri) return { ok: false, message: "تعذر تحويل التاريخ الميلادي إلى هجري." };
    const birthYear = finalHijri ? normalizeBirthYear(finalHijri.slice(0, 4)) : null;
    const birthOrderRaw = payload.order ? normalizeArabicDigitsToLatin(String(payload.order).trim()) : "";
    const birthOrder = birthOrderRaw ? parseInt(birthOrderRaw, 10) : null;
    if (birthOrderRaw && (!birthOrder || birthOrder < 1 || String(birthOrder) !== birthOrderRaw)) {
      return { ok: false, message: "ترتيب الميلاد يجب أن يكون رقمًا صحيحًا يبدأ من 1." };
    }
    const city = deceased ? "" : normalizePersonName(payload.city || "");
    const area = deceased ? "" : normalizePersonName(payload.area || "");
    if (!rawName) return { ok: false, message: "يرجى إدخال اسم الابن." };
    const sb = getSupabaseClient();
    if (!sb) return { ok: false, message: "تعذر الحفظ حالياً، حاول لاحقاً أو تواصل مع الإدارة." };
    const buildChildId = (parentId, baseName) => {
      const p = normalizePersonName(parentId || "");
      const b = normalizePersonName(baseName || "");
      if (!p || !b) return "";
      return p + "/" + b;
    };
    const tokens = tokenizeLineageInput(rawName);
    const lineagePlan = buildLineagePlanFromTokens(tokens, state.branch, selectedParentName);
    const baseNames = getAllBaseNames();
    const nowIso = new Date().toISOString();
  
    const getSiblingPartsFromRawInput = (input, plan) => {
      const v = normalizePersonName(input || "");
      if (!v || !selectedParentName) return [];
      if (plan && plan.anchorParent && Array.isArray(plan.chain) && plan.chain.length) return [];
      const parts = [];
      const pushAll = (arr) => {
        (Array.isArray(arr) ? arr : []).forEach((p) => {
          const n = normalizePersonName(p);
          if (n) parts.push(n);
        });
      };
      if (/[&,،]/.test(v) || v.includes("\n")) pushAll(v.split(/[&,،\n]/g));
      else if (/\s+و\s+/.test(v)) pushAll(v.split(/\s+و\s+/g));
      else if (/\s+/.test(v) && !/\b(بن|ابن|بنت)\b/.test(v)) pushAll(v.split(/\s+/g));
      const uniq = [];
      const seen = new Set();
      parts.forEach((p) => {
        const key = normalizePersonName(p);
        if (!key || seen.has(key)) return;
        seen.add(key);
        uniq.push(key);
      });
      return uniq;
    };
  
    const siblingParts = getSiblingPartsFromRawInput(rawName, lineagePlan);
    if (siblingParts.length > 1) {
      const parentName = selectedParentName;
      if (!parentName) return { ok: false, message: "يرجى اختيار الشخص أولاً لإضافة عدة أسماء كإخوة." };
      let inserted = 0;
      let skipped = 0;
      for (let i = 0; i < siblingParts.length; i++) {
        const part = siblingParts[i];
        const base = normalizePersonBaseName(part);
        if (!base) continue;
        if (normalizePersonBaseName(base) === normalizePersonBaseName(parentName)) {
          return { ok: false, message: "لا يمكن أن يكون اسم الابن مطابقًا لاسم الأب." };
        }
        if (findChildNameByBase(parentName, base)) { skipped += 1; continue; }
        const childId = buildChildId(parentName, base);
        if (!childId) continue;
        const row = {
          branch_key: state.branch,
          parent_name: parentName,
          child_name: childId,
          birth_date_g: finalGreg || null,
          birth_date_h: finalHijri || null,
          birth_year: birthYear,
          birth_order: birthOrder == null ? null : birthOrder + i,
          city: city || null,
          area: area || null,
          is_deceased: deceased,
          gender: normalizeTreeChildGender(payload.gender) || null,
          created_at: nowIso,
        };
        const insertRes = await adminRpcUpsertTreeChild(row);
        if (!insertRes.ok) {
          if (isRpcMissingError(insertRes.error)) return { ok: false, message: "تعذر الحفظ حالياً، حاول لاحقاً أو تواصل مع الإدارة." };
          return { ok: false, message: formatTreeChildrenDbError(insertRes.error, "save") };
        }
        if (!state.children[parentName]) state.children[parentName] = [];
        state.children[parentName].push({ name: childId, year: birthYear ? String(birthYear) : "", order: birthOrder == null ? "" : String(birthOrder + i), gdate: finalGreg || "", hdate: finalHijri || "", city, area, deceased });
        baseNames.add(base);
        inserted += 1;
      }
      const reloadRes = await loadChildrenForBranchAdmin(state.branch, { applyToState: true });
      if (!reloadRes.ok) return { ok: true, message: "تم حفظ الأسماء في قاعدة البيانات، لكن تعذر تحديث العرض الآن.", selectedPersonId: parentName };
      return { ok: true, message: "تم حفظ الأسماء كإخوة. تمت إضافة: " + inserted + "، وتجاهل المكرر: " + skipped, selectedPersonId: parentName };
    }
  
    if (lineagePlan && lineagePlan.anchorParent && lineagePlan.chain && lineagePlan.chain.length) {
      let currentParent = normalizePersonName(lineagePlan.anchorParent);
      let inserted = 0;
      let skipped = 0;
      let youngestFinal = "";
      for (let i = 0; i < lineagePlan.chain.length; i++) {
        const desiredChild = normalizePersonName(lineagePlan.chain[i]);
        const desiredBase = normalizePersonBaseName(desiredChild);
        if (!desiredBase) continue;
        if (desiredBase === normalizePersonBaseName(currentParent)) {
          return { ok: false, message: "لا يمكن أن يكون اسم الابن مطابقًا لاسم الأب." };
        }
        const isYoungest = i === lineagePlan.chain.length - 1;
        const finalChildBase = normalizePersonBaseName(desiredChild);
        const tokensCheck = tokenizeLineageInput(finalChildBase);
        if (isYoungest && tokensCheck.length !== 1) {
          return { ok: false, message: "ممنوع تسجيل الاسم الأخير بأكثر من كلمة. اكتب اسم الابن فقط." };
        }
        const existingChildName = findChildNameByBase(currentParent, finalChildBase);
        if (existingChildName) { skipped += 1; currentParent = existingChildName; youngestFinal = existingChildName; continue; }
        const childId = buildChildId(currentParent, finalChildBase);
        if (!childId) continue;
        const row = {
          branch_key: state.branch,
          parent_name: currentParent,
          child_name: childId,
          birth_date_g: isYoungest ? (finalGreg || null) : null,
          birth_date_h: isYoungest ? (finalHijri || null) : null,
          birth_year: isYoungest ? birthYear : null,
          birth_order: isYoungest ? birthOrder : null,
          city: isYoungest ? (city || null) : null,
          area: isYoungest ? (area || null) : null,
          is_deceased: isYoungest ? deceased : null,
          gender: isYoungest ? (normalizeTreeChildGender(payload.gender) || null) : null,
          created_at: nowIso,
        };
        const insertRes = await adminRpcUpsertTreeChild(row);
        if (!insertRes.ok) {
          if (isRpcMissingError(insertRes.error)) return { ok: false, message: "تعذر الحفظ حالياً، حاول لاحقاً أو تواصل مع الإدارة." };
          return { ok: false, message: formatTreeChildrenDbError(insertRes.error, "save") };
        }
        if (!state.children[currentParent]) state.children[currentParent] = [];
        state.children[currentParent].push({ name: childId, year: isYoungest && birthYear ? String(birthYear) : "", order: isYoungest && birthOrder ? String(birthOrder) : "", gdate: isYoungest ? (finalGreg || "") : "", hdate: isYoungest ? (finalHijri || "") : "", city: isYoungest ? city : "", area: isYoungest ? area : "", deceased: isYoungest ? deceased : false });
        baseNames.add(normalizePersonBaseName(finalChildBase));
        inserted += 1;
        currentParent = childId;
        youngestFinal = childId;
      }
      const reloadRes = await loadChildrenForBranchAdmin(state.branch, { applyToState: true });
      if (!reloadRes.ok) return { ok: true, message: "تم حفظ السلسلة في قاعدة البيانات، لكن تعذر تحديث العرض الآن.", selectedPersonId: youngestFinal || selectedParentName };
      return { ok: true, message: "تم حفظ السلسلة. تمت إضافة: " + inserted + "، وتجاهل المكرر: " + skipped, selectedPersonId: youngestFinal || selectedParentName };
    }
  
    if (!selectedParentName) return { ok: false, message: "يرجى اختيار الشخص أولاً أو اكتب الاسم كسلسلة تنتهي باسم الفرع." };
    const parentName = selectedParentName;
    if (normalizePersonBaseName(rawName) === normalizePersonBaseName(parentName)) {
      return { ok: false, message: "لا يمكن أن يكون اسم الابن مطابقًا لاسم الأب." };
    }
    const tokensCheck = tokenizeLineageInput(rawName);
    if (tokensCheck.length !== 1) return { ok: false, message: "ممنوع تسجيل الاسم الأخير بأكثر من كلمة. اكتب اسم الابن فقط." };
    const inputBase = normalizePersonBaseName(rawName);
    if (!payload.confirmSimilarName) {
      const similarWarn = checkSiblingSimilarNameWarning(parentName, inputBase, {});
      if (similarWarn) {
        return {
          ok: false,
          needsConfirm: true,
          warningKind: similarWarn.kind,
          message: similarWarn.message,
        };
      }
    }
    if (findChildNameByBase(parentName, inputBase)) return { ok: false, message: "اسم الابن مسجل مسبقًا لهذا الأب." };
    const finalName = normalizePersonBaseName(rawName);
    const childId = buildChildId(parentName, finalName);
    if (!childId) return { ok: false, message: "تعذر حفظ الاسم بسبب خطأ في بناء المعرف." };
    const row = {
      branch_key: state.branch,
      parent_name: parentName,
      child_name: childId,
      birth_date_g: finalGreg || null,
      birth_date_h: finalHijri || null,
      birth_year: birthYear,
      birth_order: birthOrder,
      city: city || null,
      area: area || null,
      is_deceased: deceased,
      gender: normalizeTreeChildGender(payload.gender) || null,
      created_at: nowIso,
    };
    const insertRes = await adminRpcUpsertTreeChild(row);
    if (!insertRes.ok) {
      if (isRpcMissingError(insertRes.error)) return { ok: false, message: "تعذر الحفظ حالياً، حاول لاحقاً أو تواصل مع الإدارة." };
      return { ok: false, message: formatTreeChildrenDbError(insertRes.error, "save") };
    }
    const reloadRes = await loadChildrenForBranchAdmin(state.branch, { applyToState: true });
    const rawPhone = String(payload.phone || "").trim();
    const memberPhoneForChild = normalizeMemberPhone(rawPhone);
    if (rawPhone && !memberPhoneForChild) {
      return { ok: false, message: "تم حفظ الابن لكن رقم الجوال غير صحيح. اختر الدولة واكتب الرقم المحلي فقط." };
    }
    if (memberPhoneForChild) {
      const memberProfileRes = await saveAdminMemberProfile(
        sb,
        memberPhoneForChild,
        state.branch,
        childId,
        findStablePersonId(childId),
      );
      if (!memberProfileRes.ok) {
        return { ok: false, message: "تم حفظ الابن لكن تعذر حفظ رقم الجوال. أعد إدخاله من تعديل الابن." };
      }
    }
    const spouseId = payload.spouseId ? Number(payload.spouseId) : null;
    const motherLinkRes = await familyApiLinkChildToSpouse(childId, spouseId);
    if (!motherLinkRes.ok) {
      return { ok: false, message: "تم حفظ الابن لكن تعذر ربط الأم. أعد الربط من إدارة الزوجات." };
    }
    if (!reloadRes.ok) return { ok: true, message: "تم حفظ بيانات الابن في قاعدة البيانات، لكن تعذر تحديث العرض الآن.", selectedPersonId: childId };
    return { ok: true, message: "تم حفظ بيانات الابن في قاعدة البيانات: " + finalName, selectedPersonId: childId };
  }
  

  async function familyApiClearPersonPhoto(personPath) {
    const sb = getSupabaseClient();
    const token = getAdminToken();
    if (!sb || !token) return { ok: false, message: "سجل الدخول أولًا." };
    const meta = getPersonRowMeta(personPath);
    const rowId = meta && meta.id ? Number(meta.id) : 0;
    if (!rowId) return { ok: false, message: "تعذر تحديد سجل الشخص." };
    const { data, error } = await sb.rpc("admin_tree_child_clear_photo_v1", {
      p_token: token,
      p_id: rowId,
    });
    if (error) return { ok: false, message: error.message || "تعذر حذف الصورة." };
    if (data === false) return { ok: false, message: "تعذر حذف الصورة." };
    if (state.pathToRow) {
      Object.keys(state.pathToRow).forEach(function (key) {
        const row = state.pathToRow[key];
        if (row && Number(row.id) === rowId) row.photo_url = "";
      });
    }
    const lists = Object.values(state.children || {});
    lists.forEach(function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (child) {
        if (child && Number(child.rowId) === rowId) child.photoUrl = "";
      });
    });
    return { ok: true, message: "تم حذف صورة الشخص." };
  }

  function originLockMessage() {
    const FM = window.AlzidanFamilyPersonCore || {};
    return FM.ORIGIN_LOCK_MSG || "هذا من الأصول — لا يمكن تعديله أو حذفه.";
  }

  function isOriginNode(nodeId, parentId, personId) {
    const FM = window.AlzidanFamilyPersonCore || {};
    if (typeof FM.isOriginPerson !== "function") return false;
    return !!FM.isOriginPerson(nodeId, state.branch, {
      parentId: parentId || "",
      personId: personId || "",
      pathToRow: state.pathToRow || {},
      normalizePersonName,
    });
  }

  async function familyApiUpdateChild(payload) {
    const writeCtx = await ensureAdminWriteContext();
    if (!writeCtx.ok) return writeCtx;
    const parentId = normalizePersonName(payload.parentId || "");
    const child = payload.child || {};
    const childId = normalizePersonName(payload.childId || child.name || "");
    if (!parentId || !childId) return { ok: false, message: "تعذر تحديد السجل." };
    if (isOriginNode(childId, parentId, child.personId || payload.personId || "")) {
      return { ok: false, message: originLockMessage() };
    }
    const buildChildId = (parent, baseName) => {
      const p = normalizePersonName(parent || "");
      const b = normalizePersonName(baseName || "");
      if (!p || !b) return "";
      return p + "/" + b;
    };
    let finalChildId = childId;
    const currentBase = normalizePersonBaseName(childId);
    const excludePersonId = normalizePersonName(payload.personId || child.personId || "");
    const newNameRaw = String(payload.newName || "").trim();
    if (newNameRaw) {
      const newBase = normalizePersonBaseName(newNameRaw);
      const tokensCheck = tokenizeLineageInput(newNameRaw);
      if (tokensCheck.length !== 1) return { ok: false, message: "ممنوع تسجيل الاسم بأكثر من كلمة. اكتب اسم الابن فقط." };
      if (normalizePersonBaseName(newBase) === normalizePersonBaseName(parentId)) {
        return { ok: false, message: "لا يمكن أن يكون اسم الابن مطابقًا لاسم الأب." };
      }
      // Same leaf name → keep existing path (birth_order / phone / dates only).
      // Do not treat self as a sibling duplicate when parent path spellings differ.
      if (newBase && newBase !== currentBase) {
        if (!payload.confirmSimilarName) {
          const similarWarn = checkSiblingSimilarNameWarning(parentId, newBase, {
            excludeChildId: childId,
            excludePersonId,
          });
          if (similarWarn) {
            return {
              ok: false,
              needsConfirm: true,
              warningKind: similarWarn.kind,
              message: similarWarn.message,
            };
          }
        }
        const existing = findChildNameByBase(parentId, newBase, {
          excludeChildId: childId,
          excludePersonId,
        });
        if (existing) return { ok: false, message: "اسم الابن مسجل مسبقًا لهذا الأب." };
        const built = buildChildId(parentId, newBase);
        if (built) finalChildId = built;
      }
    }
    const deceased = !!payload.deceased;
    const birth = resolveBirthDateFields(payload.hijri, payload.greg);
    if (!birth.ok) return { ok: false, message: birth.message };
    const finalHijri = birth.hijri;
    const finalGreg = birth.greg;
    const deathHijriInput = deceased ? String(payload.deathHijri || "").trim() : "";
    const deathGregInput = deceased ? String(payload.deathGreg || "").trim() : "";
    const deathHijriNorm = deathHijriInput ? normalizeHijriDateISO(deathHijriInput) : "";
    const deathGregNorm = deathGregInput ? normalizeGregorianDateISO(deathGregInput) : "";
    if (deathHijriInput && !deathHijriNorm) return { ok: false, message: "تاريخ الوفاة (هجري) غير صحيح. الصيغة: YYYY-MM-DD" };
    if (deathGregInput && !deathGregNorm) return { ok: false, message: "تاريخ الوفاة (ميلادي) غير صحيح." };
    let finalDeathHijri = deathHijriNorm;
    let finalDeathGreg = deathGregNorm;
    if (finalDeathHijri && !finalDeathGreg) finalDeathGreg = hijriToGregorianISO(finalDeathHijri);
    if (finalDeathGreg && !finalDeathHijri) finalDeathHijri = gregorianToHijriISO(finalDeathGreg);
    if (finalDeathHijri && !finalDeathGreg) return { ok: false, message: "تعذر تحويل تاريخ الوفاة الهجري إلى ميلادي." };
    if (finalDeathGreg && !finalDeathHijri) return { ok: false, message: "تعذر تحويل تاريخ الوفاة الميلادي إلى هجري." };
    const birthYear = birth.year;
    const birthOrderRaw = payload.order ? normalizeArabicDigitsToLatin(String(payload.order).trim()) : "";
    const birthOrder = birthOrderRaw ? parseInt(birthOrderRaw, 10) : null;
    if (birthOrderRaw && (!birthOrder || birthOrder < 1 || String(birthOrder) !== birthOrderRaw)) {
      return { ok: false, message: "ترتيب الميلاد يجب أن يكون رقمًا صحيحًا يبدأ من 1." };
    }
    const city = deceased ? "" : normalizePersonName(payload.city || "");
    const area = deceased ? "" : normalizePersonName(payload.area || "");
    const gender = normalizeTreeChildGender(payload.gender);
    const sb = getSupabaseClient();
    if (!sb) return { ok: false, message: "تعذر الحفظ حالياً، حاول لاحقاً أو تواصل مع الإدارة." };
    const patch = {
      birth_date_g: finalGreg || null,
      birth_date_h: finalHijri || null,
      birth_year: birthYear,
      birth_order: birthOrder,
      death_date_g: finalDeathGreg || null,
      death_date_h: finalDeathHijri || null,
      city: city || null,
      area: area || null,
      is_deceased: deceased,
    };
    const personId = normalizePersonName(payload.personId || child.personId || "");
    const res = await adminRpcUpsertTreeChild(
      Object.assign(
        {
          branch_key: state.branch,
          parent_name: parentId,
          child_name: finalChildId,
          name: finalChildId,
          id: findRowIdForPath(childId, child) || undefined,
        },
        patch,
        personId ? { person_id: personId } : {},
        gender ? { gender: gender } : {},
      ),
    );
    if (!res.ok) {
      if (isRpcMissingError(res.error)) return { ok: false, message: "تعذر تنفيذ التعديل حالياً، حاول لاحقاً أو تواصل مع الإدارة." };
      return { ok: false, message: formatTreeChildrenDbError(res.error, "update") };
    }
    const reloadRes = await loadChildrenForBranchAdmin(state.branch, { applyToState: true });
    const rawEditPhone = String(payload.phone || "").trim();
    const editPhoneValue = normalizeMemberPhone(rawEditPhone);
    if (rawEditPhone && !editPhoneValue) {
      return { ok: false, message: "تم حفظ التعديل لكن رقم الجوال غير صحيح. اختر الدولة واكتب الرقم المحلي فقط." };
    }
    if (editPhoneValue) {
      const memberProfileEditRes = await saveAdminMemberProfile(
        sb,
        editPhoneValue,
        state.branch,
        finalChildId,
        personId || findStablePersonId(finalChildId),
      );
      if (!memberProfileEditRes.ok) {
        return { ok: false, message: "تم حفظ التعديل لكن تعذر حفظ رقم الجوال. أعد إدخاله." };
      }
    }
    if (!reloadRes.ok) return { ok: true, message: "تم حفظ التعديل. تعذر تحديث البيانات من قاعدة البيانات الآن." };
    return { ok: true, message: "تم حفظ التعديل." };
  }
  

  async function familyApiDeleteChild(payload) {
    const writeCtx = await ensureAdminWriteContext();
    if (!writeCtx.ok) return writeCtx;
    const parentId = normalizePersonName(payload.parentId || "");
    const child = payload.child || {};
    const childIdForDelete = normalizePersonName(payload.childId || child.name || "");
    if (!parentId || !childIdForDelete) return { ok: false, message: "تعذر تحديد السجل." };
    if (isOriginNode(childIdForDelete, parentId, child.personId || payload.personId || "")) {
      return { ok: false, message: originLockMessage() };
    }
    const display = getDisplayNameForNodeId(childIdForDelete, state.branch ? getBranchRootName(state.branch) : "");
    const nameToConfirm = normalizePersonName(display || normalizePersonBaseName(childIdForDelete) || childIdForDelete);
    const ok = await confirmTypedText(nameToConfirm, {
      title: "تأكيد حذف الاسم",
      body: "لتأكيد الحذف اكتب الاسم التالي بالضبط:",
      confirmLabel: "تأكيد الحذف",
      cancelLabel: "إلغاء",
    });
    if (!ok) return { ok: false, message: "تم الإلغاء." };
    const sb = getSupabaseClient();
    if (!sb) return { ok: false, message: "تعذر الحذف لأن الربط غير مُعد." };
    const resolvedRow = await resolveAdminTreeRowId(sb, state.branch, childIdForDelete, child, parentId);
    const rowId = resolvedRow && resolvedRow.ok ? resolvedRow.rowId : 0;
    if (!rowId) return { ok: false, message: (resolvedRow && resolvedRow.message) || "تعذر تحديد السجل." };
    const res = await adminRpcDeleteTreeChildOne(state.branch, rowId);
    if (!res.ok) {
      if (isRpcMissingError(res.error)) return { ok: false, message: "تعذر الحذف حالياً، حاول لاحقاً أو تواصل مع الإدارة." };
      return { ok: false, message: formatTreeChildrenDbError(res.error, "delete") };
    }
    await loadChildrenForBranchAdmin(state.branch, { applyToState: true });
    return { ok: true, message: "تم حذف الاسم." };
  }
  

  async function familyApiDeleteSubtree(personPath) {
    const writeCtx = await ensureAdminWriteContext();
    if (!writeCtx.ok) return writeCtx;
    const path = normalizePersonName(personPath || "");
    if (isOriginNode(path, "", "")) {
      return { ok: false, message: originLockMessage() };
    }
    const rowId = findRowIdForPath(path);
    if (!rowId) return { ok: false, message: "تعذر تحديد السجل في قاعدة البيانات." };
    const branchRoot = getBranchRootName(state.branch);
    const display = getDisplayNameForNodeId(path, branchRoot) || path;
    const ok = window.confirm("سيتم حذف «" + display + "» وكل من تحته من الشجرة. هل أنت متأكد؟");
    if (!ok) return { ok: false, message: "تم الإلغاء." };
    const res = await adminRpcDeleteSubtree(state.branch, rowId);
    if (!res.ok) return { ok: false, message: formatTreeChildrenDbError(res.error, "delete") };
    await loadChildrenForBranchAdmin(state.branch, { applyToState: true });
    return { ok: true, message: "تم حذف " + String(res.data || 0) + " سجل." };
  }

  function buildAdminFamilyApi() {
    return {
      mode: "admin",
      getState: () => {
        syncAdminBranchFromSelect();
        return state;
      },
      getBranchKey: () => syncAdminBranchFromSelect(),
      getClient: getSupabaseClient,
      getBranchRootName,
      normalizePersonName,
      resolveSelectedParentId,
      getDisplayNameForNodeId,
      getForcedRahmaSuffix,
      normalizePersonBaseName,
      normalizeHijriDateISO,
      normalizeGregorianDateISO,
      hijriToGregorianISO,
      gregorianToHijriISO,
      normalizeBirthYear,
      normalizeArabicDigitsToLatin,
      parseISODate,
      formatDateISO,
      calculateAge,
      buildPersonOptions: buildPersonOptionsForFamilyMgmt,
      searchPersons: searchPersonsInBranch,
      getDefaultPersonId: (branchKey) => getBranchRootName(branchKey) || "",
      isOriginPerson: (nodeId, opts) => {
        const o = opts || {};
        return isOriginNode(nodeId, o.parentId || o.parentName || "", o.personId || "");
      },
      ensurePersonOption: ensurePersonOptionForFamilyMgmt,
      getPersonRowMeta,
      loadWivesForPerson: familyApiLoadWivesForPerson,
      getParentChildrenForWifeManager: familyApiGetParentChildrenForWifeManager,
      loadLinkedChildrenForSpouse: familyApiLoadLinkedChildrenForSpouse,
      saveWifeChildrenLinks: familyApiSaveWifeChildrenLinks,
      confirmLinkAllChildrenToOnlyWife: familyApiConfirmLinkAllChildrenToOnlyWife,
      saveWife: familyApiSaveWife,
      deleteWife: familyApiDeleteWife,
      saveChild: familyApiSaveChild,
      updateChild: familyApiUpdateChild,
      deleteChild: familyApiDeleteChild,
      deleteSubtree: familyApiDeleteSubtree,
      clearPersonPhoto: familyApiClearPersonPhoto,
      loadMemberPhone: async (parentId, child) => {
        const sb = getSupabaseClient();
        syncAdminBranchFromSelect();
        if (!sb || !state.branch) return "";
        return loadAdminMemberPhone(
          sb,
          state.branch,
          normalizePersonName(child && child.name ? child.name : ""),
          normalizePersonName(child && child.personId ? child.personId : ""),
        );
      },
    };
  }

  function getAdminFmBranch() {
    const el = getAdminFmBranchSelect();
    return normalizePersonName((el && el.value) || "لاحم") || "لاحم";
  }

  async function openPersonInAdminTree(branchKey, personPath) {
    const token = getAdminToken();
    if (!token) {
      setFmStatus("سجل الدخول أولًا.");
      return { ok: false, message: "not_authed" };
    }
    const branch = normalizePersonName(branchKey || "");
    const personId = normalizePersonName(personPath || "");
    if (!branch || !personId) {
      return { ok: false, message: "missing_target" };
    }
    const branchSelect = getAdminFmBranchSelect();
    if (branchSelect) branchSelect.value = branch;
    const section = document.getElementById("admin-family-management-section");
    if (section && typeof section.scrollIntoView === "function") {
      section.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (!ensureFamilyPanelMounted()) {
      return { ok: false, message: "panel_unavailable" };
    }
    await refreshAdminFamilyData(personId);
    return { ok: true };
  }

  async function refreshAdminFamilyData(initialPersonId) {
    const token = getAdminToken();
    if (!token) {
      setFmStatus("سجل الدخول أولًا.");
      return;
    }
    const branch = getAdminFmBranch();
    state.branch = branch;
    setFmStatus("جاري تحميل الشجرة...");

    if (!ensureFamilyPanelMounted()) {
      return;
    }

    const res = await loadChildrenForBranchAdmin(branch, { applyToState: true });
    if (!res.ok) {
      const detail = res.error && res.error.message ? String(res.error.message) : res.reason || "";
      setFmStatus("تعذر تحميل الشجرة حالياً، حاول لاحقاً أو تواصل مع الإدارة." + (detail ? " (" + detail + ")" : ""));
      return;
    }
    setFmStatus("تم تحميل بيانات فرع " + branch + ".");
    if (familyMgmtPanel && typeof familyMgmtPanel.refresh === "function") {
      await familyMgmtPanel.refresh();
    }
    const pick = normalizePersonName(initialPersonId || "");
    if (pick && familyMgmtPanel && typeof familyMgmtPanel.selectPerson === "function") {
      familyMgmtPanel.selectPerson(pick);
    }
  }

  function handleAdminFamilyRefreshError(err) {
    const msg = err && err.message ? String(err.message) : String(err || "خطأ غير معروف");
    setFmStatus("تعذر تحميل لوحة إدارة العائلة: " + msg);
  }

  function mountAdminFamilyManagement(initialPersonId) {
    if (!getAdminToken()) return;
    if (!ensureFamilyPanelMounted()) return;
    // Shell only on login/mount — tree data loads via #admin-fm-load or explicit refresh.
    if (initialPersonId) {
      refreshAdminFamilyData(initialPersonId).catch(handleAdminFamilyRefreshError);
    } else {
      setFmStatus("اختر الفرع ثم اضغط «تحميل الشجرة».");
    }
  }

  function destroyAdminFamilyManagement() {
    if (familyMgmtPanel && typeof familyMgmtPanel.destroy === "function") {
      familyMgmtPanel.destroy();
    }
    familyMgmtPanel = null;
    if (window.AlzidanFamilyMgmt && typeof window.AlzidanFamilyMgmt.destroy === "function") {
      window.AlzidanFamilyMgmt.destroy();
    }
    if (getAdminFamilyRoot()) getAdminFamilyRoot().innerHTML = "";
    state.branch = null;
    state.children = {};
    state.pathToRow = {};
    setFmStatus("");
  }

  function setProtectedVisibility(isAuthed) {
    const ok = !!isAuthed;
    const loadBtn = getAdminFmLoadBtn();
    const branchSelect = getAdminFmBranchSelect();
    if (loadBtn) loadBtn.disabled = !ok;
    if (branchSelect) branchSelect.disabled = !ok;
    if (!ok) {
      destroyAdminFamilyManagement();
    }
    // Do not auto-mount or load tree here — wait for login mount / tree module / load button.
  }

  function bindAdminFamilyEvents() {
    document.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const loadBtn = target.closest("#admin-fm-load");
      if (!loadBtn || loadBtn.disabled) return;
      event.preventDefault();
      refreshAdminFamilyData().catch(handleAdminFamilyRefreshError);
    });
    document.addEventListener("change", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.id !== "admin-fm-branch") return;
      if (!getAdminToken()) return;
      // Only reload when tree data was already loaded for this session.
      if (!state.branch && !Object.keys(state.children || {}).length) return;
      refreshAdminFamilyData().catch(handleAdminFamilyRefreshError);
    });
    document.addEventListener("alzidan:admin-module", (ev) => {
      const id = ev && ev.detail ? ev.detail.id : "";
      if (id !== "tree") return;
      if (!getAdminToken()) return;
      ensureFamilyPanelMounted();
    });
  }

  function bootAdminFamilyMgmt() {
    bindAdminFamilyEvents();
    setProtectedVisibility(!!getAdminToken());
  }

  window.AdminFamilyMgmt = {
    mountAdminFamilyManagement,
    destroyAdminFamilyManagement,
    refreshAdminFamilyData,
    openPersonInAdminTree,
    setProtectedVisibility,
    buildAdminFamilyApi,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootAdminFamilyMgmt, { once: true });
  } else {
    bootAdminFamilyMgmt();
  }
})();
