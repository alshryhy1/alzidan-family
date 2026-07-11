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

  function parseISODate(v) { const s = String(v || "").trim(); const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); if (!m) return null; const y = parseInt(m[1], 10); const mo = parseInt(m[2], 10); const d = parseInt(m[3], 10); if (!y || !mo || !d) return null; if (mo< 1 || mo >12) return null; if (d< 1 || d >31) return null; return { y, mo, d }; }

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
  function ageYearsFromGregorianDate(dateISO) { const parsed = parseISODate(dateISO); if (!parsed) return null; const now = new Date(); let age = now.getFullYear() - parsed.y; const month = now.getMonth() + 1; const day = now.getDate(); if (month < parsed.mo || (month === parsed.mo && day < parsed.d)) age -= 1; if (age < 0 || age > 120) return null; return age; }
  function gregorianToJdn(y, m, d) { const a = Math.floor((14 - m) / 12); const y2 = y + 4800 - a; const m2 = m + 12 * a - 3; return d + Math.floor((153 * m2 + 2) / 5) + 365 * y2 + Math.floor(y2 / 4) - Math.floor(y2 / 100) + Math.floor(y2 / 400) - 32045; }
  function jdnToGregorian(jdn) { const a = jdn + 32044; const b = Math.floor((4 * a + 3) / 146097); const c = a - Math.floor((146097 * b) / 4); const d = Math.floor((4 * c + 3) / 1461); const e = c - Math.floor((1461 * d) / 4); const m = Math.floor((5 * e + 2) / 153); const day = e - Math.floor((153 * m + 2) / 5) + 1; const month = m + 3 - 12 * Math.floor(m / 10); const year = 100 * b + d - 4800 + Math.floor(m / 10); return { y: year, mo: month, d: day }; }
  function parseHijriISO(v) { const s = String(v || "").trim(); const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s); if (!m) return null; const y = parseInt(m[1], 10); const mo = parseInt(m[2], 10); const d = parseInt(m[3], 10); if (!y || !mo || !d) return null; if (mo < 1 || mo > 12) return null; if (d < 1 || d > 30) return null; if (y < 1200 || y > 1700) return null; return { y, mo, d }; }
  function hijriToJdn(y, m, d) { return d + Math.ceil(29.5 * (m - 1)) + (y - 1) * 354 + Math.floor((3 + 11 * y) / 30) + 1948439 - 1; }
  function jdnToHijri(jdn) { const y = Math.floor((30 * (jdn - 1948439) + 10646) / 10631); const firstDay = hijriToJdn(y, 1, 1); let m = Math.min(12, Math.ceil((jdn - firstDay + 1) / 29.5) + 1); if (m < 1) m = 1; if (m > 12) m = 12; let d = jdn - hijriToJdn(y, m, 1) + 1; if (d < 1) { m = Math.max(1, m - 1); d = jdn - hijriToJdn(y, m, 1) + 1; } if (d > 30) d = 30; return { y, mo: m, d }; }
  function ageYearsFromHijriYear(year) { const y = parseInt(String(year || ""), 10); if (!y) return null; if (y < 1200 || y > 1700) return null; const gIso = hijriToGregorianISO(String(y) + "-01-01"); const parsed = parseISODate(gIso); const g = parsed ? { y: parsed.y } : jdnToGregorian(hijriToJdn(y, 1, 1)); const currentYear = new Date().getFullYear(); const age = currentYear - g.y; if (age < 0 || age > 120) return null; return age; }
  function wrapLTRText(v) { const s = String(v || ""); if (!s) return ""; return "\u200E" + s + "\u200E"; }
  function getLeafBaseNameFromNodeId(nodeId) { const id = normalizePersonName(nodeId || ""); if (!id) return ""; const leaf = id.includes("/") ? (id.split("/").map((p) => normalizePersonName(p)).filter(Boolean).slice(-1)[0] || id) : id; return normalizePersonBaseName(leaf); }

  function formatDateISO(v) { let s = String(v || "").trim(); if (!s) return ""; for (let i = 0; i< 3; i++) { const m = /^\s*[\(（]\s*(.*?)\s*[\)）]\s*$/.exec(s); if (!m) break; s = String(m[1] || "").trim(); if (!s) return ""; } const toLooseIso = (y, mo, d) =>String(parseInt(y, 10)) + "-" + String(parseInt(mo, 10)) + "-" + String(parseInt(d, 10)); const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s); if (slash) { const d = slash[1].padStart(2, "0"); const m = slash[2].padStart(2, "0"); const y = slash[3]; const year = parseInt(y, 10); if (year >= 1200 && year<= 1700) return toLooseIso(y, m, d); const hijriISO = gregorianToHijriISO(y + "-" + m + "-" + d); const h = parseHijriISO(hijriISO); if (h) return toLooseIso(String(h.y), String(h.mo), String(h.d)); return y + "-" + String(parseInt(m, 10)) + "-" + String(parseInt(d, 10)); } const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s); if (iso) { const y = iso[1].padStart(4, "0"); const m = iso[2].padStart(2, "0"); const d = iso[3].padStart(2, "0"); const year = parseInt(y, 10); if (year >= 1200 && year<= 1700) return toLooseIso(y, m, d); const hijriISO = gregorianToHijriISO(y + "-" + m + "-" + d); const h = parseHijriISO(hijriISO); if (h) return toLooseIso(String(h.y), String(h.mo), String(h.d)); return y + "-" + String(parseInt(m, 10)) + "-" + String(parseInt(d, 10)); } return s; }

  function calculateAge(meta) { const g = meta && meta.gdate ? String(meta.gdate) : ""; const h = meta && meta.hdate ? String(meta.hdate) : ""; const y = meta && meta.year != null ? String(meta.year) : ""; const ageYears = ageYearsFromGregorianDate(g) ?? ageYearsFromGregorianDate(hijriToGregorianISO(h)) ?? ageYearsFromHijriYear(y); if (ageYears == null) return ""; return String(ageYears) + " سنة"; }

  function normalizeHijriDateISO(v) { const h = parseHijriISO(v); if (!h) return ""; return formatISODate(h); }

  function normalizeGregorianDateISO(v) { const g = parseISODate(v); if (!g) return ""; return formatISODate(g); }

  function hijriToGregorianISO(hijriISO) { const h = parseHijriISO(hijriISO); if (!h) return ""; const approx = jdnToGregorian(hijriToJdn(h.y, h.mo, h.d)); if (umalquraFormatter && approx) { const base = Date.UTC(approx.y, approx.mo - 1, approx.d, 12, 0, 0); const match = (date) =>{ const got = umalquraHijriPartsFromDate(date); return got && got.y === h.y && got.mo === h.mo && got.d === h.d; }; for (let delta = -10; delta<= 10; delta++) { const date = new Date(base + delta * 86400000); if (!match(date)) continue; return formatISODate({ y: date.getUTCFullYear(), mo: date.getUTCMonth() + 1, d: date.getUTCDate() }); } } return formatISODate(approx); }

  function gregorianToHijriISO(gregISO) { const g = parseISODate(gregISO); if (!g) return ""; if (umalquraFormatter) { const date = new Date(Date.UTC(g.y, g.mo - 1, g.d, 12, 0, 0)); const parts = umalquraHijriPartsFromDate(date); if (parts) return formatISODate(parts); } const jdn = gregorianToJdn(g.y, g.mo, g.d); return formatISODate(jdnToHijri(jdn)); }

  function normalizeBirthYear(v) { const raw = String(v || "").trim(); if (!raw) return null; const n = Number(raw); if (!Number.isFinite(n)) return null; const year = Math.trunc(n); if (year< 1300 || year >1600) return null; return year; }

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

  function findChildNameByBase(parentName, childBase) { const key = normalizePersonName(parentName || ""); const base = normalizePersonName(childBase || ""); const existing = state.children[key] || []; const hit = (Array.isArray(existing) ? existing : []).find((c) =>normalizePersonBaseName(c && c.name ? c.name : "") === base); return hit && hit.name ? normalizePersonName(hit.name) : ""; }

  function todayGregorianISO() { const now = new Date(); const y = String(now.getFullYear()).padStart(4, "0"); const m = String(now.getMonth() + 1).padStart(2, "0"); const d = String(now.getDate()).padStart(2, "0"); return y + "-" + m + "-" + d; }

  function groupChildrenRows(rows, branchKey) { const key = normalizePersonName(branchKey || ""); const branchRoot = key ? getBranchRootName(key) : ""; const byParent = {}; const idsByBase = new Map(); const buildChildId = (parentId, baseName) =>{ const p = normalizePersonName(parentId || ""); const b = normalizePersonName(baseName || ""); if (!p || !b) return ""; return p + "/" + b; }; const indexKnownId = (nodeId) =>{ const id = normalizePersonName(nodeId || ""); if (!id) return; const parts = id.split("/").map((p) =>normalizePersonName(p)).filter(Boolean); const base = parts.length ? parts[parts.length - 1] : id; if (!base) return; const existing = idsByBase.get(base); if (existing) { existing.add(id); return; } idsByBase.set(base, new Set([id])); }; const addOrMergeChildById = (parentId, child) =>{ const parent = normalizePersonName(parentId || ""); const name = normalizePersonName(child && child.name ? child.name : ""); if (!parent || !name) return; if (!byParent[parent]) byParent[parent] = []; const list = byParent[parent]; const idx = (Array.isArray(list) ? list : []).findIndex((c) =>normalizePersonName(c && c.name ? c.name : "") === name); const merged = { name, personId: child && child.personId ? String(child.personId) : "", parentPersonId: child && child.parentPersonId ? String(child.parentPersonId) : "", year: child && child.year ? String(child.year) : "", order: child && child.order ? String(child.order) : "", gdate: child && child.gdate ? String(child.gdate) : "", hdate: child && child.hdate ? String(child.hdate) : "", city: child && child.city ? String(child.city) : "", area: child && child.area ? String(child.area) : "", deceased: !!(child && child.deceased) }; if (idx< 0) { list.push(merged); return; } const prev = list[idx]; if (prev) { if (!prev.personId && merged.personId) prev.personId = merged.personId; if (!prev.parentPersonId && merged.parentPersonId) prev.parentPersonId = merged.parentPersonId; if (!prev.year && merged.year) prev.year = merged.year; if (!prev.order && merged.order) prev.order = merged.order; if (!prev.gdate && merged.gdate) prev.gdate = merged.gdate; if (!prev.hdate && merged.hdate) prev.hdate = merged.hdate; if (!prev.city && merged.city) prev.city = merged.city; if (!prev.area && merged.area) prev.area = merged.area; if (!prev.deceased && merged.deceased) prev.deceased = true; } }; const addOrMergeChildAndIndex = (parentId, child) =>{ addOrMergeChildById(parentId, child); const p = normalizePersonName(parentId || ""); if (p) indexKnownId(p); const n = normalizePersonName(child && child.name ? child.name : ""); if (n) indexKnownId(n); }; const ensureParentId = (rawParent) =>{ const raw = normalizePersonName(rawParent || ""); if (!raw) return ""; if (raw.includes("/")) return raw; if (branchRoot && (raw === branchRoot || raw === key)) return branchRoot; const candidates = idsByBase.get(raw); if (candidates && candidates.size === 1) return Array.from(candidates)[0]; if (branchRoot) { const parentId = buildChildId(branchRoot, raw); if (parentId) addOrMergeChildAndIndex(branchRoot, { name: parentId, year: "", gdate: "", hdate: "", city: "", area: "" }); return parentId; } return raw; }; const stripBranchSuffix = (tokens) =>{ const t = Array.isArray(tokens) ? tokens.map((x) =>normalizePersonName(x)).filter(Boolean) : []; if (!key) return t; if (t.length >= 3) { const a = normalizePersonName(t[t.length - 3] || ""); const b = normalizePersonName(t[t.length - 2] || ""); const c = normalizePersonName(t[t.length - 1] || ""); if (a === key && b === "مطلق" && c === "زيدان") return t.slice(0, -3); } if (t.length >= 2) { const b = normalizePersonName(t[t.length - 2] || ""); const c = normalizePersonName(t[t.length - 1] || ""); if (b === key && c === "مطلق") return t.slice(0, -2); } if (t.length >= 1 && normalizePersonName(t[t.length - 1] || "") === key) return t.slice(0, -1); return t; }; const normalizeChildId = (rawChildId, parentId) =>{ const c = normalizePersonName(rawChildId || ""); if (!c || !c.includes("/")) return c; const p = normalizePersonName(parentId || ""); if (!p) return c; if (c === p || c.startsWith(p + "/")) return c; if (branchRoot && (c === branchRoot || c.startsWith(branchRoot + "/"))) return c; const base = p.split("/").map((x) =>normalizePersonName(x)).filter(Boolean).slice(-1)[0] || ""; if (base && c.startsWith(base + "/")) return p + "/" + c.slice((base + "/").length); return c; }; const addChain = (anchorParentId, basesOldestToYoungest, leafMeta) =>{ const anchor = normalizePersonName(anchorParentId || ""); const chain = Array.isArray(basesOldestToYoungest) ? basesOldestToYoungest.map((x) =>normalizePersonName(x)).filter(Boolean) : []; if (!anchor || !chain.length) return; let current = anchor; indexKnownId(current); for (let i = 0; i< chain.length; i++) { const base = chain[i]; const childId = buildChildId(current, base); if (!childId) return; const isLeaf = i === chain.length - 1; addOrMergeChildAndIndex( current, isLeaf ? { ...(leafMeta || {}), name: childId } : { name: childId, year: "", gdate: "", hdate: "", city: "", area: "", created_at: "" } ); current = childId; } }; (Array.isArray(rows) ? rows : []).forEach((r) =>{ let parentRaw = normalizeParentName(r.parent_name || r.parent || "", key); let childRaw = normalizePersonName(r.child_name || r.name || ""); if (!parentRaw || !childRaw) return; const meta = { name: "", personId: normalizePersonName(r.person_id || ""), parentPersonId: normalizePersonName(r.parent_person_id || ""), year: r.birth_year == null ? "" : String(r.birth_year), order: r.birth_order == null ? "" : String(r.birth_order), gdate: normalizePersonName(r.birth_date_g || r.birth_date || ""), hdate: normalizePersonName(r.birth_date_h || ""), city: normalizePersonName(r.city || ""), area: normalizePersonName(r.area || ""), deceased: parseTruthyValue(r.is_deceased) || parseTruthyValue(r.deceased) || parseTruthyValue(r.is_dead) || parseTruthyValue(r.dead) || parseTruthyValue(r.isDead) }; const parentId = ensureParentId(parentRaw); if (!parentId) return; if (childRaw.includes("/")) { addOrMergeChildAndIndex(parentId, { ...meta, name: normalizeChildId(childRaw, parentId) }); return; } const rawTokens = tokenizeLineageInput(normalizePersonBaseName(childRaw)); const tokens = stripBranchSuffix(rawTokens); if (!tokens.length) return; const hadBranchSuffix = tokens.length !== rawTokens.length; if (hadBranchSuffix && branchRoot) { const chainOldest = tokens.slice().reverse(); addChain(branchRoot, chainOldest, meta); return; } if (tokens.length >1) { const chainOldest = tokens.slice().reverse(); const parentBase = normalizePersonBaseName(parentId); if (chainOldest.length && parentBase && chainOldest[0] === parentBase) chainOldest.shift(); addChain(parentId, chainOldest, meta); return; } addChain(parentId, [tokens[0]], meta); }); const forcedMap = {}; const forcedBases = Object.keys(FORCED_RAHMA_BY_BASE); if (forcedBases.length) { const pickBestId = (ids) =>{ const list = (Array.isArray(ids) ? ids : []).map((x) =>normalizePersonName(x)).filter(Boolean); if (!list.length) return ""; const root = normalizePersonName(branchRoot); list.sort((a, b) =>{ const aInRoot = root ? (a === root || a.startsWith(root + "/")) : false; const bInRoot = root ? (b === root || b.startsWith(root + "/")) : false; if (aInRoot !== bInRoot) return aInRoot ? -1 : 1; const aDepth = a.split("/").filter(Boolean).length; const bDepth = b.split("/").filter(Boolean).length; if (aDepth !== bDepth) return aDepth - bDepth; if (a.length !== b.length) return a.length - b.length; return a.localeCompare(b, "ar"); }); return list[0] || ""; }; forcedBases.forEach((base) =>{ const b = normalizePersonName(base); if (!b) return; const set = idsByBase.get(b); if (!set || !set.size) return; const picked = pickBestId(Array.from(set)); if (picked) forcedMap[b] = picked; }); } if (key) state.forcedRahmaByBranch[key] = forcedMap; return byParent; }

  async function loadChildrenForBranch(branchKey, opts) { const options = opts || {}; const sb = getSupabaseClient(); if (!sb) return { ok: false, reason: "not_configured" }; const key = String(branchKey || "").trim(); if (!key) return { ok: false, reason: "missing_branch" }; const fieldAttempts = [ "person_id,parent_person_id,parent_name,parent,child_name,name,birth_date_g,birth_date_h,birth_year,birth_order,city,area,is_deceased,deceased,created_at", "parent_name,parent,child_name,name,birth_date_g,birth_date_h,birth_year,birth_order,city,area,is_deceased,deceased,created_at", "parent_name,parent,child_name,name,birth_date_g,birth_date_h,birth_year,city,area,is_deceased,deceased,created_at", "parent_name,child_name,name,birth_date_g,birth_date_h,birth_year,city,area,is_deceased,deceased,created_at", "parent_name,child_name,birth_date_g,birth_date_h,birth_year,city,area,is_deceased,deceased,created_at", "parent_name,name,birth_date_g,birth_date_h,birth_year,city,area,is_deceased,deceased,created_at", "parent,name,birth_date_g,birth_date_h,birth_year,city,area,is_deceased,deceased,created_at", "parent,child_name,birth_date_g,birth_date_h,birth_year,city,area,is_deceased,deceased,created_at", "parent_name,parent,child_name,name,birth_year,city,area,is_deceased,deceased,created_at", "parent_name,child_name,name,birth_year,city,area,is_deceased,deceased,created_at", "parent_name,child_name,birth_year,city,area,is_deceased,deceased,created_at", "parent_name,name,birth_year,city,area,is_deceased,deceased,created_at", "parent,name,birth_year,city,area,is_deceased,deceased,created_at", "parent,child_name,birth_year,city,area,is_deceased,deceased,created_at", "parent_name,parent,child_name,name,birth_date_g,birth_date_h,birth_year,city,area,deceased,created_at", "parent_name,child_name,name,birth_date_g,birth_date_h,birth_year,city,area,deceased,created_at", "parent_name,child_name,birth_date_g,birth_date_h,birth_year,city,area,deceased,created_at", "parent_name,name,birth_date_g,birth_date_h,birth_year,city,area,deceased,created_at", "parent,name,birth_date_g,birth_date_h,birth_year,city,area,deceased,created_at", "parent,child_name,birth_date_g,birth_date_h,birth_year,city,area,deceased,created_at", "parent_name,parent,child_name,name,birth_year,city,area,deceased,created_at", "parent_name,child_name,name,birth_year,city,area,deceased,created_at", "parent_name,child_name,birth_year,city,area,deceased,created_at", "parent_name,name,birth_year,city,area,deceased,created_at", "parent,name,birth_year,city,area,deceased,created_at", "parent,child_name,birth_year,city,area,deceased,created_at", "parent_name,parent,child_name,name,birth_date_g,birth_date_h,birth_year,city,area,created_at", "parent_name,child_name,name,birth_date_g,birth_date_h,birth_year,city,area,created_at", "parent_name,child_name,birth_date_g,birth_date_h,birth_year,city,area,created_at", "parent_name,name,birth_date_g,birth_date_h,birth_year,city,area,created_at", "parent,name,birth_date_g,birth_date_h,birth_year,city,area,created_at", "parent,child_name,birth_date_g,birth_date_h,birth_year,city,area,created_at", "parent_name,parent,child_name,name,birth_year,city,area,created_at", "parent_name,child_name,name,birth_year,city,area,created_at", "parent_name,child_name,birth_year,city,area,created_at", "parent_name,name,birth_year,city,area,created_at", "parent,name,birth_year,city,area,created_at", "parent,child_name,birth_year,city,area,created_at", "parent_name,parent,child_name,name,created_at", "parent_name,child_name,name,created_at", "parent_name,child_name,created_at", "parent_name,name,created_at", "parent,child_name,created_at", "parent,name,created_at", "parent_name,parent,child_name,name", "parent_name,child_name,name", "parent_name,child_name", "parent_name,name", "parent,child_name", "parent,name", "parent_name,parent,child_name,name,gdate,hdate,year,city,area,is_deceased,deceased,created_at", "parent_name,child_name,name,gdate,hdate,year,city,area,is_deceased,deceased,created_at", "parent_name,child_name,gdate,hdate,year,city,area,is_deceased,deceased,created_at", "parent_name,name,gdate,hdate,year,city,area,is_deceased,deceased,created_at", "parent,name,gdate,hdate,year,city,area,is_deceased,deceased,created_at", "parent,child_name,gdate,hdate,year,city,area,is_deceased,deceased,created_at", "parent_name,parent,child_name,name,year,city,area,created_at", "parent_name,child_name,name,year,city,area,created_at", "parent_name,child_name,year,city,area,created_at", "parent_name,name,year,city,area,created_at", "parent,name,year,city,area,created_at", "parent,child_name,year,city,area,created_at" ]; let lastError = null; let deceasedFallbackHint = ""; for (let i = 0; i< fieldAttempts.length; i++) { const usedFields = fieldAttempts[i]; const res = await loadChildrenQuery(sb, key, usedFields); if (!res.error) { const map = groupChildrenRows(res.data, key); const supportsDeceased = usedFields.includes("is_deceased") || usedFields.includes("deceased"); if (options.applyToState === true) state.children = map; return { ok: true, map, capabilities: { deceased: supportsDeceased, deceased_hint: supportsDeceased ? "" : deceasedFallbackHint } }; } if (!deceasedFallbackHint && (usedFields.includes("is_deceased") || usedFields.includes("deceased"))) { deceasedFallbackHint = classifyTreeChildrenDbError(res.error); } const msg = String(res.error.message || "").toLowerCase(); const isColumnMissing = msg.includes("column") && msg.includes("does not exist"); const isSchemaCacheMissingColumn = msg.includes("تحديث الخدمة") && msg.includes("could not find") && msg.includes("column"); const canRetry = isColumnMissing || isSchemaCacheMissingColumn; if (!canRetry) return { ok: false, reason: "error", error: res.error }; lastError = res.error; } return { ok: false, reason: "error", error: lastError }; }

  async function loadChildrenQuery(sb, branchKey, fields) { const raw = String(fields || "*"); const cleaned = raw .split(",") .map((x) =>String(x || "").trim()) .filter(Boolean) .filter((x) =>x !== "created_at") .join(","); return await sb .from(FAMILY_TREE_CHILDREN_TABLE) .select(cleaned || "*") .eq("branch_key", branchKey) .limit(2000); }

  function classifyTreeChildrenDbError(err) { const msgRaw = err && err.message != null ? String(err.message) : ""; const detailsRaw = err && err.details != null ? String(err.details) : ""; const lowMsg = msgRaw.trim().toLowerCase(); const lowDetails = detailsRaw.trim().toLowerCase(); const isSchemaCache = lowMsg.includes("تحديث الخدمة") || lowMsg.includes("could not find the table") || lowDetails.includes("تحديث الخدمة"); if (isSchemaCache) return "schema_cache"; const isRls = lowMsg.includes("row-level security") || lowDetails.includes("row-level security") || lowMsg.includes("violates row-level security"); if (isRls) return "rls"; const isPermission = lowMsg.includes("permission denied") || lowDetails.includes("permission denied"); if (isPermission) return "permission"; const isColumnMissing = lowMsg.includes("column") && lowMsg.includes("does not exist"); const isSchemaCacheMissingColumn = lowMsg.includes("تحديث الخدمة") && lowMsg.includes("could not find") && lowMsg.includes("column"); if (isColumnMissing || isSchemaCacheMissingColumn) return "missing_column"; return "other"; }

  async function loadChildrenForBranchAdmin(branchKey, opts) {
    const res = await loadChildrenForBranch(branchKey, opts);
    if (!res.ok) return res;
    const sb = getSupabaseClient();
    const key = String(branchKey || "").trim();
    state.pathToRow = {};
    if (sb && key) {
      const fields = [
        "id,person_id,parent_person_id,branch_key,parent_name,parent,child_name,name",
        "id,branch_key,parent_name,parent,child_name,name",
      ];
      for (const f of fields) {
        const q = await sb.from("tree_children").select(f).eq("branch_key", key).limit(5000);
        if (!q.error && Array.isArray(q.data)) {
          q.data.forEach((row) => {
            const childPath = normalizePersonName(row.child_name || row.name || "");
            if (childPath && row.id != null) {
              state.pathToRow[childPath] = {
                id: Number(row.id),
                person_id: row.person_id ? String(row.person_id) : "",
                parent_person_id: row.parent_person_id ? String(row.parent_person_id) : "",
              };
            }
          });
          break;
        }
      }
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

  function findRowIdForPath(path) {
    const p = normalizePersonName(path || "");
    const meta = state.pathToRow[p];
    return meta && meta.id ? Number(meta.id) : 0;
  }

  function getPersonRowMeta(path) {
    const p = normalizePersonName(path || "");
    return state.pathToRow[p] || { id: 0, person_id: "", parent_person_id: "" };
  }

  async function adminRpcUpsertTreeChild(row) {
    const sb = getSupabaseClient();
    const token = getAdminToken();
    if (!sb || !token) return { ok: false, error: { message: "سجل الدخول أولًا." } };
    const payload = Object.assign({}, row || {});
    if (!payload.branch_key) payload.branch_key = state.branch;
    const { data, error } = await sb.rpc("admin_tree_child_upsert_v1", {
      p_token: token,
      p_row: payload,
    });
    if (error) return { ok: false, error };
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
    return { ok: true, data };
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
    const raw = normalizeArabicDigitsToLatin(String(value || "").trim());
    if (!raw) return "";
    let digits = raw.replace(/[^0-9]/g, "");
    if (digits.startsWith("966")) digits = "0" + digits.slice(3);
    if (digits.length === 9 && digits.startsWith("5")) digits = "0" + digits;
    return digits.length === 10 && digits.startsWith("05") ? digits : "";
  }

  async function saveAdminMemberProfile(sb, phone, branchKey, childPath, personId) {
    if (!phone) return { ok: true, skipped: true };
    const branch = String(branchKey || "").trim();
    const path = normalizePersonName(childPath || "");
    const rowId = findRowIdForPath(path);
    if (!branch || !rowId) return { ok: false, error: { message: "missing member profile keys" } };
    const displayName = path.split("/").filter(Boolean).slice(-1)[0] || "";
    const row = {
      phone,
      branch_key: branch,
      tree_child_id: rowId,
      person_id: personId || null,
      display_name: displayName || null,
      status: "active",
      updated_at: new Date().toISOString(),
    };
    const found = await sb.from("member_profiles").select("id").eq("phone", phone).limit(1).maybeSingle();
    if (found.error) return { ok: false, error: found.error };
    if (found.data && found.data.id) {
      const { error } = await sb.from("member_profiles").update(row).eq("id", found.data.id);
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


  async function getTreePersonIdByName(sb, fullName) {
    const name = normalizePersonName(fullName || "");
    if (!sb || !name || !state.branch) return null;
    const byChild = await sb
      .from("tree_children")
      .select("id")
      .eq("branch_key", state.branch)
      .eq("child_name", name)
      .limit(1)
      .maybeSingle();
    if (!byChild.error && byChild.data && byChild.data.id != null) return byChild.data.id;
    const byName = await sb
      .from("tree_children")
      .select("id")
      .eq("branch_key", state.branch)
      .eq("name", name)
      .limit(1)
      .maybeSingle();
    if (!byName.error && byName.data && byName.data.id != null) return byName.data.id;
    return null;
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
    ids.forEach((id) => {
      const n = normalizePersonName(id || "");
      if (!n || seen.has(n)) return;
      seen.add(n);
      const base = getDisplayNameForNodeId(n, branchRoot);
      let label = base;
      if (base && (baseCounts.get(base) || 0) > 1) {
        const parts = n.split("/").map((p) => normalizePersonName(p)).filter(Boolean);
        parts.pop();
        const parentBase = parts.length ? parts[parts.length - 1] : "";
        if (parentBase) label = base + " — " + parentBase;
      }
      options.push({ value: n, label: label || n });
    });
    return options;
  }
  

  function parseWifeFamilyValue(raw) {
    const v = String(raw || "").trim();
    if (v === "true") return true;
    if (v === "false") return false;
    return null;
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
    const { data, error } = await sb.from("tree_spouses").select("id,husband_id,wife_name,wife_lineage").limit(1000);
    if (error) throw error;
    return (Array.isArray(data) ? data : []).find((item) => {
      if (editingSpouseId && Number(item.id) === Number(editingSpouseId)) return false;
      if (Number(item.husband_id) === Number(husbandId)) return false;
      const other = item.wife_lineage && hasThreePartWifeName(item.wife_lineage) ? item.wife_lineage : item.wife_name;
      return hasThreePartWifeName(other) && wifeDuplicateKey(other) === key;
    }) || null;
  }
  

  async function familyApiLoadWivesForPerson(personName) {
    const sb = getSupabaseClient();
    const SpousesCore = window.AlzidanSpousesCore || {};
    if (!sb || !state.branch) return { data: [], error: { message: "no branch" } };
    const parentName = resolveSelectedParentId(normalizePersonName(personName), state.branch);
    if (!parentName) return { data: [], error: null };
    const husbandId = await getTreePersonIdByName(sb, parentName);
    if (!husbandId) return { data: [], error: null };
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

  async function familyApiSaveWife(payload) {
    if (!state.branch) return { ok: false, message: "سجل الدخول أولًا." };
    const sb = getSupabaseClient();
    if (!sb) return { ok: false, message: "تعذر الاتصال بقاعدة البيانات." };
    const parentName = resolveSelectedParentId(normalizePersonName(payload.personId), state.branch);
    if (!parentName) return { ok: false, message: "اختر الشخص أولاً." };
    const husbandId = await getTreePersonIdByName(sb, parentName);
    if (!husbandId) return { ok: false, message: "تعذر تحديد رقم الشخص في قاعدة البيانات." };
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
      wife_name: name,
      wife_is_family_member: familyVal,
      wife_branch_key: familyVal === false ? null : (payload.branch ? String(payload.branch).trim() : null),
      wife_family_name: familyVal === false && payload.familyName ? normalizePersonName(payload.familyName) : null,
      wife_lineage: payload.lineage ? normalizePersonName(payload.lineage) : null,
      marriage_order: order,
      status: "active",
      confidence: "confirmed",
      data_source: "admin",
      updated_at: new Date().toISOString(),
    };
    const editingId = Number(payload.editingSpouseId || 0);
    if (editingId) {
      const { error } = await sb.from("tree_spouses").update(row).eq("id", editingId);
      if (error) return { ok: false, message: "تعذر تعديل الزوجة: " + (error.message || "خطأ غير معروف") };
      return { ok: true, message: "تم تعديل بيانات الزوجة." };
    }
    try {
      const dup = await findDuplicateWifeForAdmin(sb, husbandId, row, 0);
      if (dup) {
        return { ok: false, message: "هذه الزوجة مسجلة مسبقًا مع زوج آخر. راجع الاسم الثلاثي أو سلسلة النسب قبل الحفظ." };
      }
    } catch (err) {
      return { ok: false, message: "تعذr التحقق من تكرار اسم الزوجة، حاول لاحقًا." };
    }
    const r = await sb.from("tree_spouses").insert(row).select("id").single();
    if (r.error) return { ok: false, message: "تعذr حفظ الزوجة: " + (r.error.message || "خطأ غير معروف") };
    return { ok: true, message: "تم حفظ الزوجة." };
  }

  async function familyApiGetParentChildrenForWifeManager(personName) {
    const sb = getSupabaseClient();
    const parentId = resolveSelectedParentId(normalizePersonName(personName || ""), state.branch);
    if (!sb || !parentId || !state.branch) return [];
    const parentLeaf = getLeafStoredNameFromNodeId(parentId);
    const parentCandidates = [parentId, parentLeaf].filter(Boolean);
    const { data, error } = await sb
      .from("tree_children")
      .select("id,branch_key,parent_name,parent,child_name,name,birth_order,birth_date_h,birth_date_g,birth_year")
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
        label,
        order: r.birth_order || "",
        hdate: r.birth_date_h || "",
        gdate: r.birth_date_g || "",
        year: r.birth_year || "",
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
    if (!state.branch) return { ok: false, message: "سجل الدخول أولًا." };
    const sb = getSupabaseClient();
    const parentName = resolveSelectedParentId(normalizePersonName(personName), state.branch);
    if (!sb || !parentName) return { ok: false, message: "اختر الشخص أولاً." };
    const husbandId = await getTreePersonIdByName(sb, parentName);
    if (!husbandId) return { ok: false, message: "تعذر تحديد رقم الشخص." };
    const ok = window.confirm("تأكيد مهم: سيتم ربط كل أبناء هذا الشخص بزوجته الوحيدة المسجلة. هل أنت متأكد؟");
    if (!ok) return { ok: false, message: "تم الإلغاء." };
    const r = await sb.rpc("confirm_link_all_children_to_only_spouse", { p_husband_id: husbandId });
    if (r.error) return { ok: false, message: r.error.message || "تعذr الربط الجماعي." };
    return { ok: true, count: r.data || 0 };
  }

  async function familyApiLinkChildToSpouse(childId, spouseId) {
    if (!spouseId) return { ok: true, skipped: true };
    const sb = getSupabaseClient();
    if (!sb) return { ok: false, error: { message: "تعذر الاتصال بقاعدة البيانات." } };
    const childPersonId = await getTreePersonIdByName(sb, childId);
    if (!childPersonId) return { ok: false, error: { message: "تعذر تحديد رقم الابن في قاعدة البيانات." } };
    const spouseRes = await sb
      .from("tree_spouses")
      .select("id,wife_name,wife_is_family_member,wife_branch_key,wife_family_name,wife_lineage")
      .eq("id", Number(spouseId))
      .maybeSingle();
    if (spouseRes.error) return { ok: false, error: spouseRes.error };
    const spouse = spouseRes.data || {};
    if (!spouse.id) return { ok: false, error: { message: "تعذr تحديد الزوجة المختارة." } };
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
  

  async function familyApiSaveChild(payload) {
    if (!state.branch) return { ok: false, message: "سجل الدخول أولًا." };
    const selectedParentName = resolveSelectedParentId(normalizePersonName(payload.personId), state.branch);
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
      created_at: nowIso,
    };
    const insertRes = await adminRpcUpsertTreeChild(row);
    if (!insertRes.ok) {
      if (isRpcMissingError(insertRes.error)) return { ok: false, message: "تعذر الحفظ حالياً، حاول لاحقاً أو تواصل مع الإدارة." };
      return { ok: false, message: formatTreeChildrenDbError(insertRes.error, "save") };
    }
    const memberPhoneForChild = normalizeMemberPhone(payload.phone || "");
    const memberProfileRes = await saveAdminMemberProfile(sb, memberPhoneForChild, state.branch, childId, "");
    if (!memberProfileRes.ok) {
      return { ok: false, message: "تم حفظ الابن لكن تعذر حفظ رقم الجوال: " + ((memberProfileRes.error && memberProfileRes.error.message) || "خطأ غير معروف") };
    }
    const spouseId = payload.spouseId ? Number(payload.spouseId) : null;
    const motherLinkRes = await familyApiLinkChildToSpouse(childId, spouseId);
    if (!motherLinkRes.ok) {
      return { ok: false, message: "تم حفظ الابن لكن تعذر ربط الأم: " + ((motherLinkRes.error && motherLinkRes.error.message) || "خطأ غير معروف") };
    }
    const reloadRes = await loadChildrenForBranchAdmin(state.branch, { applyToState: true });
    if (!reloadRes.ok) return { ok: true, message: "تم حفظ بيانات الابن في قاعدة البيانات، لكن تعذر تحديث العرض الآن.", selectedPersonId: childId };
    return { ok: true, message: "تم حفظ بيانات الابن في قاعدة البيانات: " + finalName, selectedPersonId: childId };
  }
  

  async function familyApiUpdateChild(payload) {
    if (!state.branch) return { ok: false, message: "سجل الدخول أولًا." };
    const parentId = normalizePersonName(payload.parentId || "");
    const child = payload.child || {};
    const childId = normalizePersonName(child.name || "");
    if (!parentId || !childId) return { ok: false, message: "تعذر تحديد السجل." };
    const deceased = !!payload.deceased;
    const hijriInput = deceased ? "" : String(payload.hijri || "").trim();
    const gregInput = deceased ? "" : String(payload.greg || "").trim();
    const hijriNorm = hijriInput ? normalizeHijriDateISO(hijriInput) : "";
    const gregNorm = gregInput ? normalizeGregorianDateISO(gregInput) : "";
    if (hijriInput && !hijriNorm) return { ok: false, message: "تاريخ الميلاد (هجري) غير صحيح. الصيغة: YYYY-MM-DD" };
    if (gregInput && !gregNorm) return { ok: false, message: "تاريخ الميلاد (ميلادي) غير صحيح." };
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
    const sb = getSupabaseClient();
    if (!sb) return { ok: false, message: "تعذر الحفظ حالياً، حاول لاحقاً أو تواصل مع الإدارة." };
    const patch = {
      birth_date_g: finalGreg || null,
      birth_date_h: finalHijri || null,
      birth_year: birthYear,
      birth_order: birthOrder,
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
          child_name: childId,
          name: childId,
          id: findRowIdForPath(childId) || undefined,
        },
        patch,
        personId ? { person_id: personId } : {},
      ),
    );
    if (!res.ok) {
      if (isRpcMissingError(res.error)) return { ok: false, message: "تعذر تنفيذ التعديل حالياً، حاول لاحقاً أو تواصل مع الإدارة." };
      return { ok: false, message: formatTreeChildrenDbError(res.error, "update") };
    }
    const editPhoneValue = normalizeMemberPhone(payload.phone || "");
    const memberProfileEditRes = await saveAdminMemberProfile(sb, editPhoneValue, state.branch, childId, personId);
    if (!memberProfileEditRes.ok) {
      return { ok: false, message: "تم حفظ التعديل لكن تعذر حفظ رقم الجوال: " + ((memberProfileEditRes.error && memberProfileEditRes.error.message) || "خطأ غير معروف") };
    }
    const reloadRes = await loadChildrenForBranchAdmin(state.branch, { applyToState: true });
    if (!reloadRes.ok) return { ok: true, message: "تم حفظ التعديل. تعذر تحديث البيانات من قاعدة البيانات الآن." };
    return { ok: true, message: "تم حفظ التعديل." };
  }
  

  async function familyApiDeleteChild(payload) {
    if (!state.branch) return { ok: false, message: "سجل الدخول أولًا." };
    const parentId = normalizePersonName(payload.parentId || "");
    const child = payload.child || {};
    const childIdForDelete = normalizePersonName(child.name || "");
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
    const res = await adminRpcDeleteTreeChildOne(state.branch, findRowIdForPath(childIdForDelete));
    if (!res.ok) {
      if (isRpcMissingError(res.error)) return { ok: false, message: "تعذر الحذف حالياً، حاول لاحقاً أو تواصل مع الإدارة." };
      return { ok: false, message: formatTreeChildrenDbError(res.error, "delete") };
    }
    await loadChildrenForBranchAdmin(state.branch, { applyToState: true });
    return { ok: true, message: "تم حذف الاسم." };
  }
  

  async function familyApiDeleteSubtree(personPath) {
    if (!state.branch) return { ok: false, message: "سجل الدخول أولًا." };
    const path = normalizePersonName(personPath || "");
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
      getState: () => state,
      getBranchKey: () => state.branch,
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
      getDefaultPersonId: (branchKey) => getBranchRootName(branchKey) || "",
      ensurePersonOption: () => {},
      getPersonRowMeta,
      loadWivesForPerson: familyApiLoadWivesForPerson,
      getParentChildrenForWifeManager: familyApiGetParentChildrenForWifeManager,
      loadLinkedChildrenForSpouse: familyApiLoadLinkedChildrenForSpouse,
      saveWifeChildrenLinks: familyApiSaveWifeChildrenLinks,
      confirmLinkAllChildrenToOnlyWife: familyApiConfirmLinkAllChildrenToOnlyWife,
      saveWife: familyApiSaveWife,
      saveChild: familyApiSaveChild,
      updateChild: familyApiUpdateChild,
      deleteChild: familyApiDeleteChild,
      deleteSubtree: familyApiDeleteSubtree,
      loadMemberPhone: async (parentId, child) => {
        const sb = getSupabaseClient();
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
    ensureFamilyPanelMounted();
    refreshAdminFamilyData(initialPersonId).catch(handleAdminFamilyRefreshError);
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
      return;
    }
    ensureFamilyPanelMounted();
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
      refreshAdminFamilyData().catch(handleAdminFamilyRefreshError);
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
    setProtectedVisibility,
    buildAdminFamilyApi,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootAdminFamilyMgmt, { once: true });
  } else {
    bootAdminFamilyMgmt();
  }
})();
