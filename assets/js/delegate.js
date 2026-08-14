const parentsByBranch = { "زيدان": ["خميس بن زيدان بن مطلق", "عبدالله بن زيدان بن مطلق"], "مزيد": ["خميس", "صلف", "صلال"], "زايد": [], "لاحم": [], "ملحم": [] }; const state = { branch: null, children: {}, pathToRow: {}, happyEvents: [], sickEvents: [], deaths: [], forcedRahmaByBranch: {} }; let desiredParentFromUrl = ""; let desiredFocusFromUrl = ""; let desiredRequestIdFromUrl = ""; const FORCED_RAHMA_BY_BASE = { "صلف": " (رحمة الله)", "صلال": " (رحمه الله)", "عرفج": " (رحمه الله)", "دليميك": " (رحمه الله)" }; const treeCard = document.getElementById("tree-card"); const treeTitleEl = document.getElementById("tree-title"); const treeBranchSelect = document.getElementById("tree-branch"); const treeList = document.getElementById("tree-list"); const openDelegateBtn = document.getElementById("open-delegate"); const loginCard = document.getElementById("login-card"); const loginBtn = document.getElementById("login-btn"); const forgotBtn = document.getElementById("forgot-btn");
const requestDelegateBtn = document.getElementById("request-delegate-btn");
const delegateRequestCard = document.getElementById("delegate-request-card");
const delegateRequestName = document.getElementById("delegate-request-name");
const delegateRequestPhone = document.getElementById("delegate-request-phone"); const delegateRequestEmail = document.getElementById("delegate-request-email");
const delegateRequestBranch = document.getElementById("delegate-request-branch");
const delegateRequestTree = document.getElementById("delegate-request-tree");
const delegateRequestEvents = document.getElementById("delegate-request-events");
const delegateRequestSecret = document.getElementById("delegate-request-secret");
const delegateRequestSecret2 = document.getElementById("delegate-request-secret2");
const sendDelegateRequestBtn = document.getElementById("send-delegate-request-btn"); const loginAlert = document.getElementById("login-alert"); const branchSelectLogin = document.getElementById("branch"); const phoneInput = document.getElementById("phone"); const emailInput = document.getElementById("email"); const codeInput = document.getElementById("code"); const dashboardCard = document.getElementById("dashboard-card"); const branchTitle = document.getElementById("branch-title"); const eventsCard = document.getElementById("events-card"); const familyManagementRoot = document.getElementById("family-management-root"); let familyMgmtPanel = null; const logoutBtn = document.getElementById("logout-btn"); const eventsManagementRoot = document.getElementById("events-management-root"); let eventsMgmtPanel = null; const memoryCard = document.getElementById("memory-card"); let memorySubmitMounted = false;
function normalizeArabicDigitsToLatin(value) {
  if (window.AlzidanPhoneIntl && typeof window.AlzidanPhoneIntl.normalizeArabicDigitsToLatin === "function") {
    return window.AlzidanPhoneIntl.normalizeArabicDigitsToLatin(value);
  }
  var map = {
    "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
    "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
    "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
    "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
    "０": "0", "１": "1", "２": "2", "３": "3", "４": "4",
    "５": "5", "６": "6", "７": "7", "８": "8", "９": "9"
  };
  return String(value == null ? "" : value).replace(/[٠-٩۰-۹０-９]/g, function (ch) {
    if (map[ch]) return map[ch];
    var code = ch.charCodeAt(0);
    if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
    if (code >= 0x06F0 && code <= 0x06F9) return String(code - 0x06F0);
    if (code >= 0xFF10 && code <= 0xFF19) return String(code - 0xFF10);
    return ch;
  });
}

function digitsOnlyLatin(v) {
  if (window.AlzidanPhoneIntl && typeof window.AlzidanPhoneIntl.digitsOnly === "function") {
    return window.AlzidanPhoneIntl.digitsOnly(v);
  }
  return normalizeArabicDigitsToLatin(String(v || ""))
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/[^0-9]/g, "");
}

/** Canonical storage: E.164 (+966… / +964…). Legacy 05… still accepted as input. */
function normalizePhone(v) {
  if (window.AlzidanPhoneIntl && typeof window.AlzidanPhoneIntl.canonicalizePhone === "function") {
    var e164 = window.AlzidanPhoneIntl.canonicalizePhone(v);
    if (e164) return e164;
  }
  var digits = digitsOnlyLatin(v).trim();
  if (!digits) return "";
  if (digits.indexOf("00966") === 0 && digits.length === 14 && digits.charAt(5) === "5") {
    return "+966" + digits.slice(5);
  }
  if (digits.indexOf("966") === 0 && digits.length === 12 && digits.charAt(3) === "5") {
    return "+966" + digits.slice(3);
  }
  if (digits.charAt(0) === "5" && digits.length === 9) {
    return "+966" + digits;
  }
  if (digits.indexOf("05") === 0 && digits.length === 10) {
    return "+966" + digits.slice(1);
  }
  return digits;
}

function isValidSaudiMobile(v) {
  if (window.AlzidanPhoneIntl && typeof window.AlzidanPhoneIntl.isValidPhone === "function") {
    return window.AlzidanPhoneIntl.isValidPhone(v);
  }
  return /^\+9665[0-9]{8}$/.test(normalizePhone(v)) || /^05[0-9]{8}$/.test(String(v || "").replace(/\D/g, ""));
}

function normalizeDelegateSecret(value) {
  return normalizeArabicDigitsToLatin(String(value || ""))
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .trim();
}

function isValidDelegateSecret(v) {
  return normalizeDelegateSecret(v).length >= 4;
}

function readLoginPhone() {
  var wrap = document.querySelector('[data-phone-intl="login"]');
  if (wrap && window.AlzidanPhoneIntl && typeof window.AlzidanPhoneIntl.readPhoneIntl === "function") {
    return window.AlzidanPhoneIntl.readPhoneIntl(wrap);
  }
  var phone = normalizePhone(phoneInput ? phoneInput.value : "");
  return { ok: isValidSaudiMobile(phone), countryId: "SA", national: "", e164: phone, phone: phone };
}

function readRequestPhone() {
  var wrap = document.querySelector('[data-phone-intl="request"]');
  if (wrap && window.AlzidanPhoneIntl && typeof window.AlzidanPhoneIntl.readPhoneIntl === "function") {
    return window.AlzidanPhoneIntl.readPhoneIntl(wrap);
  }
  var phone = normalizePhone(delegateRequestPhone ? delegateRequestPhone.value : "");
  return { ok: isValidSaudiMobile(phone), countryId: "SA", national: "", e164: phone, phone: phone };
}

/** Read phone from an input, rewrite field to Western digits, return normalized E.164. */
function readNormalizedPhoneField(el) {
  var wrap = el && el.closest ? el.closest("[data-phone-intl]") : null;
  if (wrap && window.AlzidanPhoneIntl && typeof window.AlzidanPhoneIntl.readPhoneIntl === "function") {
    return window.AlzidanPhoneIntl.readPhoneIntl(wrap).e164 || "";
  }
  var raw = el ? String(el.value || "") : "";
  var phone = normalizePhone(raw);
  if (el) {
    var shown = phone || digitsOnlyLatin(raw);
    if (String(el.value || "") !== shown) el.value = shown;
  }
  return phone;
}

/**
 * PHONE_GATE: single validation used by login / forgot / request paths.
 * Must normalize Arabic digits BEFORE the «يرجى إدخال رقم جوال صحيح.» alert.
 */
function rejectUnlessValidSaudiMobile(rawOrNormalized, rewriteEl) {
  var phone = normalizePhone(rawOrNormalized);
  if (rewriteEl && rewriteEl.closest && rewriteEl.closest("[data-phone-intl]") && window.AlzidanPhoneIntl) {
    // Country+national UI: do not dump E.164 into the national box.
  } else if (rewriteEl) {
    var shown = phone || digitsOnlyLatin(rawOrNormalized);
    if (String(rewriteEl.value || "") !== shown) rewriteEl.value = shown;
  }
  if (isValidSaudiMobile(phone)) return { ok: true, phone: phone };
  setLoginAlert("error", "يرجى إدخال رقم جوال صحيح مع اختيار الدولة.");
  return { ok: false, phone: phone };
}

function bindSilentDigitNormalize(el, mode) {
  if (!el || el.dataset.digitNormalizeBound === "1") return;
  // phone-intl fields handle their own scrubbing
  if (el.getAttribute && el.getAttribute("data-phone-national") != null) return;
  if (el.closest && el.closest("[data-phone-intl]")) return;
  el.dataset.digitNormalizeBound = "1";
  // type=tel can drop Arabic-Indic digits on some mobile browsers before JS runs.
  if (mode === "phone" && el.tagName === "INPUT" && String(el.type || "").toLowerCase() === "tel") {
    try {
      el.type = "text";
      el.setAttribute("inputmode", "numeric");
      el.setAttribute("autocomplete", "tel");
    } catch (e) {}
  }
  const applyDigitsOnly = function () {
    const cur = String(el.value || "");
    const next = normalizeArabicDigitsToLatin(cur).replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "");
    if (next !== cur) el.value = next;
  };
  // Live rewrite phone to Western digits so validate/debug see the same value.
  const applyPhoneLive = function () {
    const cur = String(el.value || "");
    const next = digitsOnlyLatin(cur);
    if (next !== cur) el.value = next;
  };
  const applyPhone = function () {
    const next = normalizePhone(el.value || "");
    if (next) {
      if (next !== String(el.value || "")) el.value = next;
    } else {
      applyPhoneLive();
    }
  };
  const onInput = mode === "phone" ? applyPhoneLive : applyDigitsOnly;
  const onBlur = mode === "phone" ? applyPhone : applyDigitsOnly;
  el.addEventListener("input", onInput);
  el.addEventListener("paste", function () {
    setTimeout(mode === "phone" ? applyPhone : applyDigitsOnly, 0);
  });
  el.addEventListener("blur", onBlur);
}

try {
  window.AlzidanDelegateDigits = {
    normalizeArabicDigitsToLatin: normalizeArabicDigitsToLatin,
    digitsOnlyLatin: digitsOnlyLatin,
    normalizePhone: normalizePhone,
    isValidSaudiMobile: isValidSaudiMobile,
    normalizeDelegateSecret: normalizeDelegateSecret,
    isValidDelegateSecret: isValidDelegateSecret,
    readNormalizedPhoneField: readNormalizedPhoneField,
    rejectUnlessValidSaudiMobile: rejectUnlessValidSaudiMobile
  };
} catch (e) {}

(function initDelegatePhoneIntlUi() {
  function run() {
    try {
      if (!window.AlzidanPhoneIntl) return;
      var nodes = document.querySelectorAll("[data-phone-intl]");
      for (var i = 0; i < nodes.length; i++) {
        window.AlzidanPhoneIntl.bindPhoneIntl(nodes[i]);
      }
    } catch (e) {}
  }
  run();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    setTimeout(run, 0);
  }
})();

function normalizePersonName(v) { const s = String(v || "") .replace(/\s+/g, " ") .trim(); if (!s) return ""; const parts = s.split(" ").map((p) =>p.trim()).filter(Boolean); if (parts.length >= 3 && parts.every((p) =>p.length === 1 && /^[\u0600-\u06FF]$/.test(p))) { return parts.join(""); } return s; } function parseTruthyValue(v) { if (v === true) return true; if (v === false || v == null) return false; if (typeof v === "number") return v === 1; const s = String(v).trim().toLowerCase(); if (!s) return false; if (s === "true" || s === "t" || s === "1" || s === "yes" || s === "y" || s === "on") return true; if (s === "نعم" || s === "متوفي" || s === "متوفى" || s === "متوفاة" || s === "متوفاه") return true; return false; } function getBranchRootName(branchKey) { const k = normalizePersonName(branchKey); if (!k) return ""; return k + " بن مطلق بن زيدان"; } function normalizeParentName(v, branchKey) { const raw = normalizePersonName(v || ""); const cleaned = raw.replace(/^أصل الفرع:\s*/i, "").trim(); if (!cleaned) return ""; if (/بن\s+مطلق\s+بن\s+زيدان/.test(cleaned)) return cleaned; if (Object.prototype.hasOwnProperty.call(parentsByBranch, cleaned)) return cleaned + " بن مطلق بن زيدان"; if (branchKey && normalizePersonName(branchKey) === cleaned) return cleaned + " بن مطلق بن زيدان"; return cleaned; } function resolveSelectedParentId(selectedParent, branchKey) { const s = normalizePersonName(selectedParent || ""); if (!s) return ""; if (s.includes("/")) return s; const b = normalizePersonName(branchKey || ""); const branchRoot = b ? getBranchRootName(b) : ""; if (branchRoot && (s === branchRoot || s === b)) return branchRoot; return branchRoot ? (branchRoot + "/" + s) : s; } function applyView(view) { const v = view === "delegate" ? "delegate" : "tree"; if (treeCard) treeCard.style.display = v === "tree" ? "block" : "none"; if (loginCard) loginCard.style.display = v === "delegate" ? "block" : "none"; if (dashboardCard) dashboardCard.style.display = "none"; if (eventsCard) eventsCard.style.display = "none"; if (memoryCard) memoryCard.style.display = "none"; } function renderPublicTree(branchKey, opts) { if (!treeList) return; treeList.innerHTML = ""; const key = String(branchKey || "").trim(); if (!key || !Object.prototype.hasOwnProperty.call(parentsByBranch, key)) { const empty = document.createElement("div"); empty.className = "hint"; empty.textContent = "اختر الفرع لعرض الشجرة."; treeList.appendChild(empty); if (treeTitleEl) treeTitleEl.textContent = "شجرة العائلة"; return; } const requestedFocus = normalizePersonName(opts && opts.focus ? String(opts.focus) : ""); if (treeTitleEl) treeTitleEl.textContent = "شجرة فرع " + key + " بن مطلق بن زيدان"; const staticParents = parentsByBranch[key] || []; const loading = document.createElement("div"); loading.className = "hint"; loading.textContent = "جاري تحميل بيانات الأبناء..."; treeList.appendChild(loading); loadChildrenForBranch(key, { applyToState: false }) .then((res) =>{ treeList.innerHTML = ""; if (!res.ok) { const err = document.createElement("div"); err.className = "alert alert-error"; if (res.reason === "not_configured") err.textContent = "تعذر تحميل البيانات لأن الربط غير مُعد."; else err.textContent = formatTreeChildrenDbError(res.error, "load"); treeList.appendChild(err); return; } if (res.capabilities && res.capabilities.deceased === false) { const warn = document.createElement("div"); warn.className = "alert alert-error"; const hint = res.capabilities && res.capabilities.deceased_hint ? String(res.capabilities.deceased_hint) : ""; if (hint === "schema_cache") { warn.textContent = "تعذر تحميل حالة الوفاة لأن الخدمة لم يُحدّث المخطط بعد. انتظر دقيقة ثم حدّث الصفحة، أو نفّذ Reload تحديث الخدمة من لوحة الخدمة."; } else if (hint === "rls") { warn.textContent = "تعذر تحميل حالة الوفاة لأن RLS تمنع القراءة من جدول tree_children. فعّل سياسة SELECT لدور anon ثم أعد المحاولة."; } else if (hint === "permission") { warn.textContent = "تعذر تحميل حالة الوفاة لأن دور anon لا يملك صلاحية SELECT على جدول tree_children. امنح الصلاحية ثم أعد المحاولة."; } else { warn.textContent = "تعذر تحميل حالة الوفاة (رحمه الله) من الخدمة. تحقق من الأعمدة/الصلاحيات ثم أعد المحاولة."; } treeList.appendChild(warn); } const byParent = res.map || {}; const branchRoot = getBranchRootName(key); const staticParentIds = []; const metaById = new Map(); Object.values(byParent || {}).forEach((list) =>{ const items = Array.isArray(list) ? list : []; items.forEach((c) =>{ const id = normalizePersonName(c && c.name ? c.name : ""); if (!id) return; const prev = metaById.get(id); if (!prev) { metaById.set(id, { ...(c || {}), name: id }); return; } const merged = { ...(prev || {}), name: id }; if (!merged.year && c && c.year) merged.year = String(c.year); if (!merged.gdate && c && c.gdate) merged.gdate = String(c.gdate); if (!merged.hdate && c && c.hdate) merged.hdate = String(c.hdate); if (!merged.city && c && c.city) merged.city = String(c.city); if (!merged.area && c && c.area) merged.area = String(c.area); if (!merged.deceased && c && c.deceased) merged.deceased = true; metaById.set(id, merged); }); }); const parentsFromData = Object.keys(byParent || {}).map(normalizePersonName).filter(Boolean); const allNodes = new Set(parentsFromData); const inDegree = new Map(); parentsFromData.forEach((p) =>inDegree.set(p, 0)); parentsFromData.forEach((p) =>{ const list = byParent[p] || []; (Array.isArray(list) ? list : []).forEach((c) =>{ const cn = normalizePersonName(c && c.name ? c.name : ""); if (!cn) return; allNodes.add(cn); inDegree.set(cn, (inDegree.get(cn) || 0) + 1); if (!inDegree.has(p)) inDegree.set(p, 0); }); }); const roots = []; const seenRoots = new Set(); const pushRoot = (n) =>{ const k = normalizePersonName(n); if (!k || seenRoots.has(k)) return; seenRoots.add(k); roots.push(k); }; if (branchRoot) pushRoot(branchRoot); parentsFromData.forEach((p) =>{ if ((inDegree.get(p) || 0) === 0) pushRoot(p); }); if (!roots.length) parentsFromData.forEach(pushRoot); if (!roots.length) { const empty = document.createElement("div"); empty.className = "hint"; empty.textContent = "لا توجد أسماء مسجلة في هذا الفرع بعد."; treeList.appendChild(empty); return; } const nodeExistsInTree = (nodeId) =>{ const n = normalizePersonName(nodeId); if (!n) return false; if (Object.prototype.hasOwnProperty.call(byParent, n)) return true; const lists = Object.values(byParent || {}); for (let i = 0; i< lists.length; i++) { const list = Array.isArray(lists[i]) ? lists[i] : []; for (let j = 0; j< list.length; j++) { const cid = normalizePersonName(list[j] && list[j].name ? list[j].name : ""); if (cid === n) return true; } } return false; }; const focusId = requestedFocus && nodeExistsInTree(requestedFocus) ? requestedFocus : ""; if (focusId && treeTitleEl) { const focusDisplay = getDisplayNameForNodeId(focusId, branchRoot); const focusIsBranchRoot = branchRoot && normalizePersonName(focusId) === normalizePersonName(branchRoot); const focusSuffix = focusIsBranchRoot ? " (رحمهم الله)" : getForcedRahmaSuffix(focusId, key); treeTitleEl.textContent = "شجرة " + focusDisplay + focusSuffix; } if (focusId) { const backWrap = document.createElement("div"); backWrap.style.marginBottom = "10px"; const backLink = document.createElement("a"); backLink.className = "btn btn-secondary btn-small"; backLink.href = "alzidan-tree.html?branch=" + encodeURIComponent(key); backLink.textContent = "عرض الفرع كامل"; backWrap.appendChild(backLink); treeList.appendChild(backWrap); } const makeAddLink = (personName) =>{ const a = document.createElement("a"); a.className = "btn btn-secondary btn-small"; a.textContent = "إضافة أبناء"; a.href = "alzidan-tree.html?view=delegate&branch=" + encodeURIComponent(key) + "&parent=" + encodeURIComponent(personName); return a; }; const renderNode = (nodeId, meta, depth, pathSet, mountEl) =>{ const person = normalizePersonName(nodeId); if (!person) return; const mount = mountEl || treeList; const depthPx = Math.min(56, Math.max(0, depth) * 18); const hasCycle = pathSet && pathSet.has(person); const children = byParent[person] || []; const canExpand = !hasCycle && Array.isArray(children) && children.length; const effectiveMeta = meta || metaById.get(person) || null; const host = canExpand ? document.createElement("details") : null; if (host) { host.className = "tree-node"; if (depthPx) host.style.marginRight = depthPx + "px"; if (depth === 0 && focusId && person === focusId) host.open = true; } const headerRow = document.createElement("div"); headerRow.className = "parent-row"; if (!host && depthPx) headerRow.style.marginRight = depthPx + "px"; headerRow.style.cursor = "pointer"; headerRow.addEventListener("click", (e) =>{ if (e && typeof e.preventDefault === "function") e.preventDefault(); if (e && typeof e.stopPropagation === "function") e.stopPropagation(); if (e && e.target && typeof e.target.closest === "function") { if (e.target.closest("a,button")) return; } window.location.href = "alzidan-tree.html?branch=" + encodeURIComponent(key) + "&focus=" + encodeURIComponent(person); }); const title = document.createElement("div"); title.className = "parent-name"; const displayName = getDisplayNameForNodeId(person, branchRoot); const isBranchRootNode = branchRoot && normalizePersonName(person) === normalizePersonName(branchRoot); const forcedSuffix = getForcedRahmaSuffix(person, key); const suffix = isBranchRootNode ? " (رحمهم الله)" : forcedSuffix ? forcedSuffix : (effectiveMeta && effectiveMeta.deceased) ? " (رحمه الله)" : ""; title.textContent = displayName + suffix; headerRow.appendChild(title); const actions = document.createElement("div"); actions.style.display = "inline-flex"; actions.style.alignItems = "center"; actions.style.gap = "6px"; const isDeceased = !!(effectiveMeta && effectiveMeta.deceased); if (!isDeceased) { const badge = document.createElement("span"); badge.className = "badge"; const ageText = calculateAge(effectiveMeta || {}); const parts = []; if (ageText) parts.push("العمر: " + ageText); parts.push("الأبناء: " + String(Array.isArray(children) ? children.length : 0)); badge.textContent = parts.join(" – "); actions.appendChild(badge); } actions.appendChild(makeAddLink(person)); headerRow.appendChild(actions); if (canExpand) { const summary = document.createElement("summary"); summary.appendChild(headerRow); host.appendChild(summary); const childrenWrap = document.createElement("div"); childrenWrap.className = "tree-node-children"; host.appendChild(childrenWrap); const nextPath = new Set(pathSet ? Array.from(pathSet) : []); nextPath.add(person); children.forEach((child) =>{ const childId = normalizePersonName(child && child.name ? child.name : ""); if (!childId) return; renderNode(childId, child, depth + 1, nextPath, childrenWrap); }); mount.appendChild(host); } else { mount.appendChild(headerRow); } }; const visited = new Set(); const orderedRoots = focusId ? [focusId] : roots; orderedRoots.forEach((r) =>{ const k = normalizePersonName(r); if (!k || visited.has(k)) return; visited.add(k); renderNode(k, null, 0, new Set(), treeList); }); if (!focusId) { parentsFromData.forEach((p) =>{ const k = normalizePersonName(p); if (!k || visited.has(k)) return; visited.add(k); renderNode(k, null, 0, new Set(), treeList); }); staticParentIds.forEach((p) =>{ const k = normalizePersonName(p); if (!k || visited.has(k)) return; visited.add(k); renderNode(k, null, 0, new Set(), treeList); }); } }) .catch(() =>{ treeList.innerHTML = ""; const err = document.createElement("div"); err.className = "alert alert-error"; err.textContent = "تعذر تحميل بيانات الأبناء."; treeList.appendChild(err); }); } (function initViewFromUrl() { const params = new URLSearchParams(window.location.search); const view = params.get("view") || "tree"; const branchKey = params.get("branch") || ""; desiredParentFromUrl = String(params.get("parent") || "").trim(); desiredFocusFromUrl = String(params.get("focus") || params.get("f") || "").trim(); desiredRequestIdFromUrl = String(params.get("request_id") || params.get("requestId") || "").trim(); applyView(view); if (treeBranchSelect && branchKey) { if (Object.prototype.hasOwnProperty.call(parentsByBranch, branchKey)) { treeBranchSelect.value = branchKey; } } renderPublicTree(treeBranchSelect ? treeBranchSelect.value : "", { focus: desiredFocusFromUrl }); if (branchSelectLogin && branchKey) { if (Object.prototype.hasOwnProperty.call(parentsByBranch, branchKey)) { branchSelectLogin.value = branchKey; } } })(); if (treeBranchSelect) { treeBranchSelect.addEventListener("change", () =>{ const key = String(treeBranchSelect.value || "").trim(); desiredFocusFromUrl = ""; renderPublicTree(key, { focus: "" }); }); } if (openDelegateBtn) { openDelegateBtn.addEventListener("click", () =>{ applyView("delegate"); if (loginCard && typeof loginCard.scrollIntoView === "function") { loginCard.scrollIntoView({ behavior: "smooth", block: "start" }); } }); } function normalizeEmail(v) { return String(v || "").trim().toLowerCase(); }
function isLikelyEmail(v) {
  const s = normalizeEmail(v);
  return !!(s && s.includes("@") && s.includes(".") && s.length >= 6);
} const DELEGATE_SESSION_KEY = "alzidan_delegate_session_v1"; let delegateRuntimeAuth = null; function loadDelegateSession() { return delegateRuntimeAuth; } function saveDelegateSession(branchKey, phone, email, secretHash, name) { const branch = String(branchKey || "").trim(); const hash = String(secretHash || "").trim(); if (!branch || !hash) { delegateRuntimeAuth = null; return; } delegateRuntimeAuth = { branch, phone: normalizePhone(phone), email: normalizeEmail(email), secretHash: hash, name: String(name || "").replace(/\s+/g, " ").trim() }; } function clearDelegateSession() { delegateRuntimeAuth = null; try { localStorage.removeItem(DELEGATE_SESSION_KEY); } catch (e) {} try { sessionStorage.removeItem(DELEGATE_SESSION_KEY); } catch (e) {} } const SUPABASE_URL = "https://wbskjfdqpugnwvrykqcn.supabase.co"; const SUPABASE_ANON_KEY = "sb_publishable_JhgwBIXhs6z4yBZOoE2EqA_UlzjzW9c"; const FAMILY_TREE_CHILDREN_TABLE = "tree_children"; let sbClient = null; function getالخدمةClient() { if (sbClient) return sbClient; const url = String(SUPABASE_URL || "").trim(); const anonKey = String(SUPABASE_ANON_KEY || "").trim(); if (!url || !anonKey) return null; if (!window.supabase || typeof window.supabase.createClient !== "function") return null; sbClient = window.supabase.createClient(url, anonKey); return sbClient; } async function sha256Hex(text) { try { if (!window.crypto || !window.crypto.subtle) return null; const enc = new TextEncoder(); const buf = await window.crypto.subtle.digest("SHA-256", enc.encode(String(text || ""))); return Array.from(new Uint8Array(buf)) .map((b) =>b.toString(16).padStart(2, "0")) .join(""); } catch (e) { return null; } } function makeRequestId() { const part1 = Math.random().toString(36).slice(2, 6).toUpperCase(); const part2 = Math.random().toString(36).slice(2, 6).toUpperCase(); return "REQ-" + part1 + "-" + part2; } function duplicateFieldsText(fields) { const f = Array.isArray(fields) ? fields : []; const hasPhone = f.includes("phone"); const hasEmail = f.includes("email"); if (hasPhone && hasEmail) return "الجوال والإيميل مسجلين مسبقًا"; if (hasPhone) return "رقم الجوال مسجل مسبقًا"; if (hasEmail) return "الإيميل مسجل مسبقًا"; return "البيانات مسجلة مسبقًا"; } function phoneCandidates(phone) { if (window.AlzidanPhoneIntl && typeof window.AlzidanPhoneIntl.phoneCandidates === "function") { return window.AlzidanPhoneIntl.phoneCandidates(phone); } const raw = normalizePhone(phone); if (!raw) return []; const digits = raw.replace(/[^0-9]/g, ""); if (!digits) return []; const set = new Set([digits, raw]); const add966 = (nine) =>{ if (!nine || nine.length !== 9) return; set.add("0" + nine); set.add(nine); set.add("966" + nine); set.add("+966" + nine); }; if (digits.startsWith("0") && digits.length === 10 && digits[1] === "5") { add966(digits.slice(1)); } else if (digits.startsWith("966") && digits.length === 12 && digits[3] === "5") { add966(digits.slice(3)); } else if (digits.startsWith("5") && digits.length === 9) { add966(digits); } return Array.from(set).filter(Boolean); } function fallbackCopyText(text) { const el = document.createElement("textarea"); el.value = text; el.setAttribute("readonly", ""); el.style.position = "fixed"; el.style.opacity = "0"; el.style.left = "-9999px"; document.body.appendChild(el); el.select(); try { document.execCommand("copy"); } catch (e) {} document.body.removeChild(el); } async function copyText(text) { try { if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") { await navigator.clipboard.writeText(text); return true; } } catch (e) {} fallbackCopyText(text); return true; } const NOTIFY_EMAIL_TO = "info@alzidan.org"; function maybeOpenEmailDraft(subject, body) {
  try {
    const text = [String(subject || "").trim(), String(body || "").trim()].filter(Boolean).join("\\n\\n");
    if (text) copyText(text).catch(() => {});
  } catch (e) {}
  return false;
} function setLoginAlert(type, text) { if (!loginAlert) return; loginAlert.className = "alert " + (type === "success" ? "alert-success" : "alert-error"); loginAlert.textContent = text; loginAlert.style.display = "block"; } function hideLoginAlert() { if (!loginAlert) return; loginAlert.style.display = "none"; loginAlert.textContent = ""; loginAlert.className = "alert"; } function buildDelegateRequestMessage(payload) { const lines = []; lines.push("طلب دخول لشجرة العائلة (مندوب فرع)"); lines.push("رقم الطلب: " + payload.requestId); lines.push("الفرع: " + (payload.branch || "")); lines.push("الجوال: " + (payload.phone || "")); lines.push("الايميل: " + (payload.email || "")); lines.push("الرقم السري: " + (payload.secret || "")); lines.push("التاريخ: " + new Date(payload.createdAt).toLocaleString("ar-SA")); return lines.join("\n"); } function parseISODate(v) { const s = String(v || "").trim(); const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); if (!m) return null; const y = parseInt(m[1], 10); const mo = parseInt(m[2], 10); const d = parseInt(m[3], 10); if (!y || !mo || !d) return null; if (mo< 1 || mo >12) return null; if (d< 1 || d >31) return null; return { y, mo, d }; } const umalquraFormatter = (function () { try { return new Intl.DateTimeFormat("en-US-u-ca-islamic-umalqura", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }); } catch (e) { return null; } })(); function umalquraHijriPartsFromDate(date) { if (!umalquraFormatter || !date) return null; const parts = umalquraFormatter.formatToParts(date); const get = (t) =>{ const p = parts.find((x) =>x.type === t); return p ? p.value : ""; }; const y = parseInt(get("year"), 10); const mo = parseInt(get("month"), 10); const d = parseInt(get("day"), 10); if (!y || !mo || !d) return null; return { y, mo, d }; } function pad2(v) { return String(v).padStart(2, "0"); } function formatISODate(parts) { if (!parts) return ""; const y = String(parts.y || "").padStart(4, "0"); const mo = pad2(parts.mo); const d = pad2(parts.d); if (!y || !mo || !d) return ""; return y + "-" + mo + "-" + d; } function ageYearsFromGregorianDate(dateISO) { const parsed = parseISODate(dateISO); if (!parsed) return null; const now = new Date(); let age = now.getFullYear() - parsed.y; const month = now.getMonth() + 1; const day = now.getDate(); if (month< parsed.mo || (month === parsed.mo && day< parsed.d)) age -= 1; if (age< 0 || age >120) return null; return age; } function gregorianToJdn(y, m, d) { const a = Math.floor((14 - m) / 12); const y2 = y + 4800 - a; const m2 = m + 12 * a - 3; return ( d + Math.floor((153 * m2 + 2) / 5) + 365 * y2 + Math.floor(y2 / 4) - Math.floor(y2 / 100) + Math.floor(y2 / 400) - 32045 ); } function jdnToGregorian(jdn) { const a = jdn + 32044; const b = Math.floor((4 * a + 3) / 146097); const c = a - Math.floor((146097 * b) / 4); const d = Math.floor((4 * c + 3) / 1461); const e = c - Math.floor((1461 * d) / 4); const m = Math.floor((5 * e + 2) / 153); const day = e - Math.floor((153 * m + 2) / 5) + 1; const month = m + 3 - 12 * Math.floor(m / 10); const year = 100 * b + d - 4800 + Math.floor(m / 10); return { y: year, mo: month, d: day }; } function parseHijriISO(v) { const s = String(v || "").trim(); const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s); if (!m) return null; const y = parseInt(m[1], 10); const mo = parseInt(m[2], 10); const d = parseInt(m[3], 10); if (!y || !mo || !d) return null; if (mo< 1 || mo >12) return null; if (d< 1 || d >30) return null; if (y< 1200 || y >1700) return null; return { y, mo, d }; } function hijriToJdn(y, m, d) { return ( d + Math.ceil(29.5 * (m - 1)) + (y - 1) * 354 + Math.floor((3 + 11 * y) / 30) + 1948439 - 1 ); } function jdnToHijri(jdn) { const y = Math.floor((30 * (jdn - 1948439) + 10646) / 10631); const firstDay = hijriToJdn(y, 1, 1); let m = Math.min(12, Math.ceil((jdn - firstDay + 1) / 29.5) + 1); if (m< 1) m = 1; if (m >12) m = 12; let d = jdn - hijriToJdn(y, m, 1) + 1; if (d< 1) { m = Math.max(1, m - 1); d = jdn - hijriToJdn(y, m, 1) + 1; } if (d >30) d = 30; return { y, mo: m, d }; } function hijriToGregorianISO(hijriISO) { const h = parseHijriISO(hijriISO); if (!h) return ""; const approx = jdnToGregorian(hijriToJdn(h.y, h.mo, h.d)); if (umalquraFormatter && approx) { const base = Date.UTC(approx.y, approx.mo - 1, approx.d, 12, 0, 0); const match = (date) =>{ const got = umalquraHijriPartsFromDate(date); return got && got.y === h.y && got.mo === h.mo && got.d === h.d; }; for (let delta = -10; delta<= 10; delta++) { const date = new Date(base + delta * 86400000); if (!match(date)) continue; return formatISODate({ y: date.getUTCFullYear(), mo: date.getUTCMonth() + 1, d: date.getUTCDate() }); } } return formatISODate(approx); } function gregorianToHijriISO(gregISO) { const g = parseISODate(gregISO); if (!g) return ""; if (umalquraFormatter) { const date = new Date(Date.UTC(g.y, g.mo - 1, g.d, 12, 0, 0)); const parts = umalquraHijriPartsFromDate(date); if (parts) return formatISODate(parts); } const jdn = gregorianToJdn(g.y, g.mo, g.d); return formatISODate(jdnToHijri(jdn)); } function normalizeHijriDateISO(v) { const h = parseHijriISO(v); if (!h) return ""; return formatISODate(h); } function normalizeGregorianDateISO(v) { const g = parseISODate(v); if (!g) return ""; return formatISODate(g); } function ageYearsFromHijriYear(year) { const y = parseInt(String(year || ""), 10); if (!y) return null; if (y< 1200 || y >1700) return null; const gIso = hijriToGregorianISO(String(y) + "-01-01"); const parsed = parseISODate(gIso); const g = parsed ? { y: parsed.y } : jdnToGregorian(hijriToJdn(y, 1, 1)); const currentYear = new Date().getFullYear(); const age = currentYear - g.y; if (age< 0 || age >120) return null; return age; } function calculateAge(meta) { const g = meta && meta.gdate ? String(meta.gdate) : ""; const h = meta && meta.hdate ? String(meta.hdate) : ""; const y = meta && meta.year != null ? String(meta.year) : ""; const ageYears = ageYearsFromGregorianDate(g) ?? ageYearsFromGregorianDate(hijriToGregorianISO(h)) ?? ageYearsFromHijriYear(y); if (ageYears == null) return ""; return String(ageYears) + " سنة"; } function normalizeBirthYear(v) { const raw = String(v || "").trim(); if (!raw) return null; const n = Number(raw); if (!Number.isFinite(n)) return null; const year = Math.trunc(n); if (year< 1300 || year >1600) return null; return year; } function formatTreeChildrenDbError(err, action) { if (err && (err.detail || err.arabic) && typeof (err.detail || err.arabic) === "string" && String(err.message || "").toLowerCase().includes("not allowed")) { return String(err.detail || err.arabic); } const a = action === "save" ? "save" : action === "update" ? "update" : action === "delete" ? "delete" : "load"; const codeRaw = err && err.code != null ? String(err.code) : ""; const msgRaw = err && err.message != null ? String(err.message) : ""; const detailsRaw = err && err.details != null ? String(err.details) : ""; const lowCode = codeRaw.trim().toLowerCase(); const lowMsg = msgRaw.trim().toLowerCase(); const lowDetails = detailsRaw.trim().toLowerCase(); const tableName = "tree_children"; if (lowMsg === "missing key") { if (a === "update" || a === "delete") return "تعذر تنفيذ العملية لأن بيانات الفرع/الأب/الابن غير مكتملة. حدّث الصفحة وحاول مرة أخرى."; } if (lowMsg === "row not found") { if (a === "update") return "تعذر حفظ التعديل لأن السجل غير موجود (قد يكون الاسم تغيّر أو تم حذفه). حدّث الصفحة ثم حاول مرة أخرى."; if (a === "delete") return "تعذر الحذف لأن السجل غير موجود (قد يكون الاسم تغيّر أو تم حذفه). حدّث الصفحة ثم حاول مرة أخرى."; } if (lowMsg === "no_session") { return "يلزم تسجيل دخول المندوب أولاً."; } if (lowMsg === "hash_failed") { return "تعذر التحقق من الرقم السري على هذا الجهاز. جرّب متصفحاً آخر أو حدّث الصفحة."; } if (lowMsg === "not allowed" || lowMsg === "disabled" || lowMsg === "no_permission" || lowMsg === "bad_secret") {
    if (lowMsg === "disabled" || (err && String(err.reason || "").toLowerCase() === "disabled")) {
      return "حساب المندوب معطّل. تواصل مع الإدارة لإعادة التفعيل.";
    }
    if (lowMsg === "no_permission" || (err && String(err.reason || "").toLowerCase() === "no_permission")) {
      return "دورك الحالي لا يسمح بهذه العملية على الشجرة. اطلب من الإدارة تعديل الصلاحية.";
    }
    if (lowMsg === "bad_secret" || (err && String(err.reason || "").toLowerCase() === "bad_secret")) {
      return "بيانات الدخول لا تطابق اعتماد المندوب. سجّل الخروج ثم الدخول مجددًا.";
    }
    const reason = err && err.reason != null ? String(err.reason).toLowerCase() : "";
    if (reason === "disabled") return "حساب المندوب معطّل. تواصل مع الإدارة لإعادة التفعيل.";
    if (reason === "no_permission") return "دورك الحالي لا يسمح بهذه العملية على الشجرة. اطلب من الإدارة تعديل الصلاحية.";
    if (reason === "bad_secret") return "بيانات الدخول لا تطابق اعتماد المندوب. سجّل الخروج ثم الدخول مجددًا.";
    return "غير مصرح لك بتنفيذ هذه العملية. تأكد أن طلبك كمندوب تم اعتماده وأن الصلاحية مفعّلة.";
  } if (lowMsg.includes("birth_order_conflict")) { return "رقم ترتيب الميلاد مستخدم لابن آخر تحت الأب نفسه. اختر رقمًا مختلفًا."; } if (lowMsg.includes("tree_children_parent_birth_order_key")) { return "رقم ترتيب الميلاد مستخدم لابن آخر تحت الأب نفسه. اختر رقمًا مختلفًا."; } if (lowMsg.includes("birth_order_invalid")) { return "ترتيب الميلاد يجب أن يكون رقمًا صحيحًا يبدأ من 1."; } if (lowMsg.includes("child_already_exists")) { return "هذا الاسم مسجل مسبقًا تحت الأب نفسه. يمكن تسجيل الاسم نفسه فقط إذا كان الأب مختلفًا."; } if (lowMsg.includes("no unique or exclusion constraint matching the on conflict specification")) { return "تعذر الحفظ بسبب إعداد قديم في الخدمة يستخدم ON CONFLICT بدون مفتاح فريد. افتح صفحة الإدارة (admin.html) وانسخ أمر الصيانة الخاص بالشجرة ثم نفّذه في الخدمة ليتم تحديث الدوال."; } const isSchemaCache = lowMsg.includes("تحديث الخدمة") || lowMsg.includes("could not find the table") || lowDetails.includes("تحديث الخدمة"); if (isSchemaCache) { const hint = `إذا استمر الخطأ، فالغالب أن دور anon لا يملك صلاحيات على جدول ${tableName} أو أن RLS تمنع الوصول.`; const reloadHint = "انتظر دقيقة ثم حدّث الصفحة، أو نفّذ Reload تحديث الخدمة من إعدادات الخدمة (API)."; if (a === "save" || a === "update" || a === "delete") { return `تعذر تنفيذ العملية لأن الخدمة لم يُحدّث المخطط بعد. ${reloadHint} ${hint}`; } return `تعذر تحميل بيانات الأبناء لأن الخدمة لم يُحدّث المخطط بعد. ${reloadHint} ${hint}`; } const isMissingTable = lowCode === "42p01" || (lowMsg.includes("relation") && lowMsg.includes("does not exist")) || (lowDetails.includes("relation") && lowDetails.includes("does not exist")); if (isMissingTable) { if (a === "save") return `يلزم إنشاء جدول ${tableName} في الخدمة قبل حفظ الأبناء.`; return `يلزم إنشاء جدول ${tableName} في الخدمة لعرض الأبناء.`; } const isRls = lowMsg.includes("row-level security") || lowDetails.includes("row-level security") || lowMsg.includes("violates row-level security"); if (isRls) { if (a === "save") return `تعذر حفظ بيانات الابن بسبب صلاحيات الجدول (RLS). تأكد من سياسة INSERT على جدول ${tableName}.`; if (a === "update") return `تعذر تعديل بيانات الابن بسبب صلاحيات الجدول (RLS). تأكد من سياسة UPDATE على جدول ${tableName}.`; if (a === "delete") return `تعذر حذف بيانات الابن بسبب صلاحيات الجدول (RLS). تأكد من سياسة DELETE على جدول ${tableName}.`; return `تعذر تحميل بيانات الأبناء بسبب صلاحيات الجدول (RLS). تأكد من سياسات SELECT/INSERT/UPDATE/DELETE على جدول ${tableName}.`; } const isPermission = lowMsg.includes("permission denied") || lowDetails.includes("permission denied") || lowCode === "42501"; if (isPermission) { if (a === "save") return `تعذر حفظ بيانات الابن بسبب عدم وجود صلاحية على جدول ${tableName}، حاول لاحقاً أو تواصل مع الإدارة.`; if (a === "update") return `تعذر تعديل بيانات الابن بسبب عدم وجود صلاحية على جدول ${tableName}، حاول لاحقاً أو تواصل مع الإدارة.`; if (a === "delete") return `تعذر حذف بيانات الابن بسبب عدم وجود صلاحية على جدول ${tableName}، حاول لاحقاً أو تواصل مع الإدارة.`; return `تعذر تحميل بيانات الأبناء بسبب عدم وجود صلاحية على جدول ${tableName}.`; } const isSchemaMismatch = lowMsg.includes("column") && lowMsg.includes("does not exist"); if (isSchemaMismatch) { const neededCore = wrapLTRText("branch_key + (parent_name أو parent) + (child_name أو name)"); const optional = wrapLTRText("birth_date_g, birth_date_h, birth_year, birth_order, city, area, is_deceased, created_at"); if (a === "save" || a === "update" || a === "delete") { return `تعذر تنفيذ العملية لأن أعمدة جدول ${tableName} غير مطابقة. المطلوب على الأقل: ${neededCore}. الأعمدة الإضافية اختيارية: ${optional}.`; } return `تعذر تحميل بيانات الأبناء لأن أعمدة جدول ${tableName} غير مطابقة. المطلوب على الأقل: ${neededCore}. الأعمدة الإضافية اختيارية: ${optional}.`; } if (a === "save") return `تعذر حفظ بيانات الابن: ${msgRaw || "خطأ غير معروف"}`; if (a === "update") return `تعذر تعديل بيانات الابن: ${msgRaw || "خطأ غير معروف"}`; if (a === "delete") return `تعذر حذف بيانات الابن: ${msgRaw || "خطأ غير معروف"}`; return `تعذر تحميل بيانات الأبناء: ${msgRaw || "خطأ غير معروف"}`; } function classifyTreeChildrenDbError(err) { const msgRaw = err && err.message != null ? String(err.message) : ""; const detailsRaw = err && err.details != null ? String(err.details) : ""; const lowMsg = msgRaw.trim().toLowerCase(); const lowDetails = detailsRaw.trim().toLowerCase(); const isSchemaCache = lowMsg.includes("تحديث الخدمة") || lowMsg.includes("could not find the table") || lowDetails.includes("تحديث الخدمة"); if (isSchemaCache) return "schema_cache"; const isRls = lowMsg.includes("row-level security") || lowDetails.includes("row-level security") || lowMsg.includes("violates row-level security"); if (isRls) return "rls"; const isPermission = lowMsg.includes("permission denied") || lowDetails.includes("permission denied"); if (isPermission) return "permission"; const isColumnMissing = lowMsg.includes("column") && lowMsg.includes("does not exist"); const isSchemaCacheMissingColumn = lowMsg.includes("تحديث الخدمة") && lowMsg.includes("could not find") && lowMsg.includes("column"); if (isColumnMissing || isSchemaCacheMissingColumn) return "missing_column"; return "other"; } function groupChildrenRows(rows, branchKey) { const key = normalizePersonName(branchKey || ""); const branchRoot = key ? getBranchRootName(key) : ""; const byParent = {}; const idsByBase = new Map(); const buildChildId = (parentId, baseName) =>{ const p = normalizePersonName(parentId || ""); const b = normalizePersonName(baseName || ""); if (!p || !b) return ""; return p + "/" + b; }; const indexKnownId = (nodeId) =>{ const id = normalizePersonName(nodeId || ""); if (!id) return; const parts = id.split("/").map((p) =>normalizePersonName(p)).filter(Boolean); const base = parts.length ? parts[parts.length - 1] : id; if (!base) return; const existing = idsByBase.get(base); if (existing) { existing.add(id); return; } idsByBase.set(base, new Set([id])); }; const addOrMergeChildById = (parentId, child) =>{ const parent = normalizePersonName(parentId || ""); const name = normalizePersonName(child && child.name ? child.name : ""); if (!parent || !name) return; if (!byParent[parent]) byParent[parent] = []; const list = byParent[parent]; const idx = (Array.isArray(list) ? list : []).findIndex((c) =>normalizePersonName(c && c.name ? c.name : "") === name); const merged = { name, personId: child && child.personId ? String(child.personId) : "", parentPersonId: child && child.parentPersonId ? String(child.parentPersonId) : "", year: child && child.year ? String(child.year) : "", order: child && child.order ? String(child.order) : "", gdate: child && child.gdate ? String(child.gdate) : "", hdate: child && child.hdate ? String(child.hdate) : "", city: child && child.city ? String(child.city) : "", area: child && child.area ? String(child.area) : "", deceased: !!(child && child.deceased) }; if (idx< 0) { list.push(merged); return; } const prev = list[idx]; if (prev) { if (!prev.personId && merged.personId) prev.personId = merged.personId; if (!prev.parentPersonId && merged.parentPersonId) prev.parentPersonId = merged.parentPersonId; if (!prev.year && merged.year) prev.year = merged.year; if (!prev.order && merged.order) prev.order = merged.order; if (!prev.gdate && merged.gdate) prev.gdate = merged.gdate; if (!prev.hdate && merged.hdate) prev.hdate = merged.hdate; if (!prev.city && merged.city) prev.city = merged.city; if (!prev.area && merged.area) prev.area = merged.area; if (!prev.deceased && merged.deceased) prev.deceased = true; } }; const addOrMergeChildAndIndex = (parentId, child) =>{ addOrMergeChildById(parentId, child); const p = normalizePersonName(parentId || ""); if (p) indexKnownId(p); const n = normalizePersonName(child && child.name ? child.name : ""); if (n) indexKnownId(n); }; const ensureParentId = (rawParent, childRaw) =>{ const raw = normalizePersonName(rawParent || ""); if (!raw) return ""; if (raw.includes("/")) return raw; if (branchRoot && (raw === branchRoot || raw === key)) return branchRoot; const pathDerived = (function(){ const childFull = normalizePersonName(childRaw || ""); if (!childFull || !childFull.includes("/")) return ""; const parts = childFull.split("/").map((p) =>normalizePersonName(p)).filter(Boolean); if (parts.length < 2) return ""; const derivedParent = parts.slice(0, -1).join("/"); const derivedLeaf = parts[parts.length - 2] || ""; if (derivedLeaf === raw || normalizePersonBaseName(derivedParent) === raw || derivedParent.endsWith("/" + raw)) return derivedParent; return ""; })(); if (pathDerived) return pathDerived; const candidates = idsByBase.get(raw); if (candidates && candidates.size === 1) return Array.from(candidates)[0]; if (candidates && candidates.size > 1) return raw; if (branchRoot) { const parentId = buildChildId(branchRoot, raw); if (parentId) addOrMergeChildAndIndex(branchRoot, { name: parentId, year: "", gdate: "", hdate: "", city: "", area: "" }); return parentId; } return raw; }; const stripBranchSuffix = (tokens) =>{ const t = Array.isArray(tokens) ? tokens.map((x) =>normalizePersonName(x)).filter(Boolean) : []; if (!key) return t; if (t.length >= 3) { const a = normalizePersonName(t[t.length - 3] || ""); const b = normalizePersonName(t[t.length - 2] || ""); const c = normalizePersonName(t[t.length - 1] || ""); if (a === key && b === "مطلق" && c === "زيدان") return t.slice(0, -3); } if (t.length >= 2) { const b = normalizePersonName(t[t.length - 2] || ""); const c = normalizePersonName(t[t.length - 1] || ""); if (b === key && c === "مطلق") return t.slice(0, -2); } if (t.length >= 1 && normalizePersonName(t[t.length - 1] || "") === key) return t.slice(0, -1); return t; }; const normalizeChildId = (rawChildId, parentId) =>{ const c = normalizePersonName(rawChildId || ""); if (!c || !c.includes("/")) return c; const p = normalizePersonName(parentId || ""); if (!p) return c; if (c === p || c.startsWith(p + "/")) return c; if (branchRoot && (c === branchRoot || c.startsWith(branchRoot + "/"))) return c; const base = p.split("/").map((x) =>normalizePersonName(x)).filter(Boolean).slice(-1)[0] || ""; if (base && c.startsWith(base + "/")) return p + "/" + c.slice((base + "/").length); return c; }; const addChain = (anchorParentId, basesOldestToYoungest, leafMeta) =>{ const anchor = normalizePersonName(anchorParentId || ""); const chain = Array.isArray(basesOldestToYoungest) ? basesOldestToYoungest.map((x) =>normalizePersonName(x)).filter(Boolean) : []; if (!anchor || !chain.length) return; let current = anchor; indexKnownId(current); for (let i = 0; i< chain.length; i++) { const base = chain[i]; const childId = buildChildId(current, base); if (!childId) return; const isLeaf = i === chain.length - 1; addOrMergeChildAndIndex( current, isLeaf ? { ...(leafMeta || {}), name: childId } : { name: childId, year: "", gdate: "", hdate: "", city: "", area: "", created_at: "" } ); current = childId; } }; (Array.isArray(rows) ? rows : []).forEach((r) =>{ let parentRaw = normalizeParentName(r.parent_name || r.parent || "", key); let childRaw = normalizePersonName(r.child_name || r.name || ""); if (!parentRaw || !childRaw) return; const meta = { name: "", personId: normalizePersonName(r.person_id || ""), parentPersonId: normalizePersonName(r.parent_person_id || ""), year: r.birth_year == null ? "" : String(r.birth_year), order: r.birth_order == null ? "" : String(r.birth_order), gdate: normalizePersonName(r.birth_date_g || r.birth_date || ""), hdate: normalizePersonName(r.birth_date_h || ""), city: normalizePersonName(r.city || ""), area: normalizePersonName(r.area || ""), deceased: parseTruthyValue(r.is_deceased) || parseTruthyValue(r.deceased) || parseTruthyValue(r.is_dead) || parseTruthyValue(r.dead) || parseTruthyValue(r.isDead) }; const parentId = ensureParentId(parentRaw, childRaw); if (!parentId) return; if (childRaw.includes("/")) { addOrMergeChildAndIndex(parentId, { ...meta, name: normalizeChildId(childRaw, parentId) }); return; } const rawTokens = tokenizeLineageInput(normalizePersonBaseName(childRaw)); const tokens = stripBranchSuffix(rawTokens); if (!tokens.length) return; const hadBranchSuffix = tokens.length !== rawTokens.length; if (hadBranchSuffix && branchRoot) { const chainOldest = tokens.slice().reverse(); addChain(branchRoot, chainOldest, meta); return; } if (tokens.length >1) { const chainOldest = tokens.slice().reverse(); const parentBase = normalizePersonBaseName(parentId); if (chainOldest.length && parentBase && chainOldest[0] === parentBase) chainOldest.shift(); addChain(parentId, chainOldest, meta); return; } addChain(parentId, [tokens[0]], meta); }); const forcedMap = {}; const forcedBases = Object.keys(FORCED_RAHMA_BY_BASE); if (forcedBases.length) { const pickBestId = (ids) =>{ const list = (Array.isArray(ids) ? ids : []).map((x) =>normalizePersonName(x)).filter(Boolean); if (!list.length) return ""; const root = normalizePersonName(branchRoot); list.sort((a, b) =>{ const aInRoot = root ? (a === root || a.startsWith(root + "/")) : false; const bInRoot = root ? (b === root || b.startsWith(root + "/")) : false; if (aInRoot !== bInRoot) return aInRoot ? -1 : 1; const aDepth = a.split("/").filter(Boolean).length; const bDepth = b.split("/").filter(Boolean).length; if (aDepth !== bDepth) return aDepth - bDepth; if (a.length !== b.length) return a.length - b.length; return a.localeCompare(b, "ar"); }); return list[0] || ""; }; forcedBases.forEach((base) =>{ const b = normalizePersonName(base); if (!b) return; const set = idsByBase.get(b); if (!set || !set.size) return; const picked = pickBestId(Array.from(set)); if (picked) forcedMap[b] = picked; }); } if (key) state.forcedRahmaByBranch[key] = forcedMap; return byParent; } async function loadChildrenQuery(sb, branchKey, fields) { const raw = String(fields || "*"); const parts = raw .split(",") .map((x) =>String(x || "").trim()) .filter(Boolean) .filter((x) =>x !== "created_at"); if (!parts.includes("id")) parts.unshift("id"); const cleaned = parts.join(","); return await sb .from(FAMILY_TREE_CHILDREN_TABLE) .select(cleaned || "*") .eq("branch_key", branchKey) .limit(5000); } const __treeChildrenInflight = new Map(); async function loadChildrenForBranch(branchKey, opts) { const options = opts || {}; const sb = getالخدمةClient(); if (!sb) return { ok: false, reason: "not_configured" }; const key = String(branchKey || "").trim(); if (!key) return { ok: false, reason: "missing_branch" }; const cacheKey = key + "|" + (options.applyToState === true ? "1" : "0"); if (__treeChildrenInflight.has(cacheKey)) return __treeChildrenInflight.get(cacheKey); const __loadPromise = (async () => { const fieldAttempts = [ "id,person_id,parent_person_id,parent_name,parent,child_name,name,birth_date_g,birth_date_h,birth_year,birth_order,city,area,is_deceased,deceased,created_at", "parent_name,parent,child_name,name,birth_date_g,birth_date_h,birth_year,birth_order,city,area,is_deceased,deceased,created_at", "parent_name,parent,child_name,name,birth_date_g,birth_date_h,birth_year,city,area,is_deceased,deceased,created_at", "parent_name,child_name,name,birth_date_g,birth_date_h,birth_year,city,area,is_deceased,deceased,created_at", "parent_name,child_name,birth_date_g,birth_date_h,birth_year,city,area,is_deceased,deceased,created_at", "parent_name,name,birth_date_g,birth_date_h,birth_year,city,area,is_deceased,deceased,created_at", "parent,name,birth_date_g,birth_date_h,birth_year,city,area,is_deceased,deceased,created_at", "parent,child_name,birth_date_g,birth_date_h,birth_year,city,area,is_deceased,deceased,created_at", "parent_name,parent,child_name,name,birth_year,city,area,is_deceased,deceased,created_at", "parent_name,child_name,name,birth_year,city,area,is_deceased,deceased,created_at", "parent_name,child_name,birth_year,city,area,is_deceased,deceased,created_at", "parent_name,name,birth_year,city,area,is_deceased,deceased,created_at", "parent,name,birth_year,city,area,is_deceased,deceased,created_at", "parent,child_name,birth_year,city,area,is_deceased,deceased,created_at", "parent_name,parent,child_name,name,birth_date_g,birth_date_h,birth_year,city,area,deceased,created_at", "parent_name,child_name,name,birth_date_g,birth_date_h,birth_year,city,area,deceased,created_at", "parent_name,child_name,birth_date_g,birth_date_h,birth_year,city,area,deceased,created_at", "parent_name,name,birth_date_g,birth_date_h,birth_year,city,area,deceased,created_at", "parent,name,birth_date_g,birth_date_h,birth_year,city,area,deceased,created_at", "parent,child_name,birth_date_g,birth_date_h,birth_year,city,area,deceased,created_at", "parent_name,parent,child_name,name,birth_year,city,area,deceased,created_at", "parent_name,child_name,name,birth_year,city,area,deceased,created_at", "parent_name,child_name,birth_year,city,area,deceased,created_at", "parent_name,name,birth_year,city,area,deceased,created_at", "parent,name,birth_year,city,area,deceased,created_at", "parent,child_name,birth_year,city,area,deceased,created_at", "parent_name,parent,child_name,name,birth_date_g,birth_date_h,birth_year,city,area,created_at", "parent_name,child_name,name,birth_date_g,birth_date_h,birth_year,city,area,created_at", "parent_name,child_name,birth_date_g,birth_date_h,birth_year,city,area,created_at", "parent_name,name,birth_date_g,birth_date_h,birth_year,city,area,created_at", "parent,name,birth_date_g,birth_date_h,birth_year,city,area,created_at", "parent,child_name,birth_date_g,birth_date_h,birth_year,city,area,created_at", "parent_name,parent,child_name,name,birth_year,city,area,created_at", "parent_name,child_name,name,birth_year,city,area,created_at", "parent_name,child_name,birth_year,city,area,created_at", "parent_name,name,birth_year,city,area,created_at", "parent,name,birth_year,city,area,created_at", "parent,child_name,birth_year,city,area,created_at", "parent_name,parent,child_name,name,created_at", "parent_name,child_name,name,created_at", "parent_name,child_name,created_at", "parent_name,name,created_at", "parent,child_name,created_at", "parent,name,created_at", "parent_name,parent,child_name,name", "parent_name,child_name,name", "parent_name,child_name", "parent_name,name", "parent,child_name", "parent,name", "parent_name,parent,child_name,name,gdate,hdate,year,city,area,is_deceased,deceased,created_at", "parent_name,child_name,name,gdate,hdate,year,city,area,is_deceased,deceased,created_at", "parent_name,child_name,gdate,hdate,year,city,area,is_deceased,deceased,created_at", "parent_name,name,gdate,hdate,year,city,area,is_deceased,deceased,created_at", "parent,name,gdate,hdate,year,city,area,is_deceased,deceased,created_at", "parent,child_name,gdate,hdate,year,city,area,is_deceased,deceased,created_at", "parent_name,parent,child_name,name,year,city,area,created_at", "parent_name,child_name,name,year,city,area,created_at", "parent_name,child_name,year,city,area,created_at", "parent_name,name,year,city,area,created_at", "parent,name,year,city,area,created_at", "parent,child_name,year,city,area,created_at" ]; let lastError = null; let deceasedFallbackHint = ""; for (let i = 0; i< fieldAttempts.length; i++) { const usedFields = fieldAttempts[i]; const res = await loadChildrenQuery(sb, key, usedFields); if (!res.error) { const map = groupChildrenRows(res.data, key); const supportsDeceased = usedFields.includes("is_deceased") || usedFields.includes("deceased"); if (options.applyToState === true) { const __FM = (typeof window !== "undefined" && window.AlzidanFamilyPersonCore) ? window.AlzidanFamilyPersonCore : {}; state.children = (typeof __FM.unionChildrenMapByParentPersonId === "function") ? __FM.unionChildrenMapByParentPersonId(map, normalizePersonName) : map; if (typeof __FM.isolateChildrenMapArrays === "function") __FM.isolateChildrenMapArrays(state.children); } return { ok: true, map, rows: Array.isArray(res.data) ? res.data : [], capabilities: { deceased: supportsDeceased, deceased_hint: supportsDeceased ? "" : deceasedFallbackHint } }; } if (!deceasedFallbackHint && (usedFields.includes("is_deceased") || usedFields.includes("deceased"))) { deceasedFallbackHint = classifyTreeChildrenDbError(res.error); } const msg = String(res.error.message || "").toLowerCase(); const isColumnMissing = msg.includes("column") && msg.includes("does not exist"); const isSchemaCacheMissingColumn = msg.includes("تحديث الخدمة") && msg.includes("could not find") && msg.includes("column"); const canRetry = isColumnMissing || isSchemaCacheMissingColumn; if (!canRetry) return { ok: false, reason: "error", error: res.error }; lastError = res.error; } return { ok: false, reason: "error", error: lastError };  })(); __treeChildrenInflight.set(cacheKey, __loadPromise); try { return await __loadPromise; } finally { __treeChildrenInflight.delete(cacheKey); } } async function insertTreeChildRow(sb, row) { const attempts = []; const deceasedValue = row && (row.is_deceased != null ? row.is_deceased : row.deceased); const full = { branch_key: row.branch_key, parent_name: row.parent_name, child_name: row.child_name, birth_date_g: row.birth_date_g, birth_date_h: row.birth_date_h, birth_year: row.birth_year, city: row.city, area: row.area }; const fullDeceased = { ...full, is_deceased: deceasedValue }; const fullDeceasedAlt = { ...full, deceased: deceasedValue }; const noDates = { branch_key: row.branch_key, parent_name: row.parent_name, child_name: row.child_name, birth_year: row.birth_year, city: row.city, area: row.area }; const noDatesDeceased = { ...noDates, is_deceased: deceasedValue }; const noDatesDeceasedAlt = { ...noDates, deceased: deceasedValue }; const fullName = { branch_key: row.branch_key, parent_name: row.parent_name, name: row.child_name, birth_date_g: row.birth_date_g, birth_date_h: row.birth_date_h, birth_year: row.birth_year, city: row.city, area: row.area }; const fullNameDeceased = { ...fullName, is_deceased: deceasedValue }; const fullNameDeceasedAlt = { ...fullName, deceased: deceasedValue }; const noDatesName = { branch_key: row.branch_key, parent_name: row.parent_name, name: row.child_name, birth_year: row.birth_year, city: row.city, area: row.area }; const noDatesNameDeceased = { ...noDatesName, is_deceased: deceasedValue }; const noDatesNameDeceasedAlt = { ...noDatesName, deceased: deceasedValue }; const fullParent = { branch_key: row.branch_key, parent: row.parent_name, name: row.child_name, birth_date_g: row.birth_date_g, birth_date_h: row.birth_date_h, birth_year: row.birth_year, city: row.city, area: row.area }; const fullParentDeceased = { ...fullParent, is_deceased: deceasedValue }; const fullParentDeceasedAlt = { ...fullParent, deceased: deceasedValue }; const noDatesParent = { branch_key: row.branch_key, parent: row.parent_name, name: row.child_name, birth_year: row.birth_year, city: row.city, area: row.area }; const noDatesParentDeceased = { ...noDatesParent, is_deceased: deceasedValue }; const noDatesParentDeceasedAlt = { ...noDatesParent, deceased: deceasedValue }; attempts.push({ row: fullDeceased }); attempts.push({ row: fullDeceasedAlt }); attempts.push({ row: full }); attempts.push({ row: noDatesDeceased }); attempts.push({ row: noDatesDeceasedAlt }); attempts.push({ row: noDates }); attempts.push({ row: fullNameDeceased }); attempts.push({ row: fullNameDeceasedAlt }); attempts.push({ row: fullName }); attempts.push({ row: noDatesNameDeceased }); attempts.push({ row: noDatesNameDeceasedAlt }); attempts.push({ row: noDatesName }); attempts.push({ row: fullParentDeceased }); attempts.push({ row: fullParentDeceasedAlt }); attempts.push({ row: fullParent }); attempts.push({ row: noDatesParentDeceased }); attempts.push({ row: noDatesParentDeceasedAlt }); attempts.push({ row: noDatesParent }); for (let i = 0; i< attempts.length; i++) { const { error } = await sb.from(FAMILY_TREE_CHILDREN_TABLE).insert(attempts[i].row); if (!error) { const used = attempts[i].row || {}; const degraded = deceasedValue != null && used.is_deceased == null && used.deceased == null; return { ok: true, degraded }; } const msg = String(error.message || "").toLowerCase(); const isColumnMissing = msg.includes("column") && msg.includes("does not exist"); const isSchemaCacheMissingColumn = msg.includes("تحديث الخدمة") && msg.includes("could not find") && msg.includes("column"); const isNotNullName = msg.includes('column "name"') && msg.includes("null value"); const isNotNullChildName = msg.includes('column "child_name"') && msg.includes("null value"); if (!isColumnMissing && !isSchemaCacheMissingColumn && !isNotNullName && !isNotNullChildName) return { ok: false, error }; if (i === attempts.length - 1) return { ok: false, error }; } return { ok: false, error: { message: "unknown insert error" } }; } async function updateTreeChildRow(sb, branchKey, parentId, childId, patch) { const attempts = []; const key = normalizePersonName(branchKey || ""); const parent = normalizePersonName(parentId || ""); const id = normalizePersonName(childId || ""); if (!key || !parent || !id) return { ok: false, error: { message: "missing key" } }; const p = patch || {}; const updateBase = { birth_date_g: p.birth_date_g, birth_date_h: p.birth_date_h, birth_year: p.birth_year, city: p.city, area: p.area }; const deceasedValue = p && (p.is_deceased != null ? p.is_deceased : p.deceased); const updateWithDeceased = { ...updateBase, is_deceased: deceasedValue }; const updateWithDeceasedAlt = { ...updateBase, deceased: deceasedValue }; const parentCols = ["parent_name", "parent"]; const childCols = ["child_name", "name"]; const updateRows = [updateWithDeceased, updateWithDeceasedAlt, updateBase]; parentCols.forEach((parentCol) =>{ childCols.forEach((childCol) =>{ updateRows.forEach((updateRow) =>{ attempts.push({ parentCol, childCol, updateRow }); }); }); }); for (let i = 0; i< attempts.length; i++) { const a = attempts[i]; const { data, error } = await sb .from(FAMILY_TREE_CHILDREN_TABLE) .update(a.updateRow) .eq("branch_key", key) .eq(a.parentCol, parent) .eq(a.childCol, id) .select(a.childCol); if (!error && Array.isArray(data) && data.length) { const used = a.updateRow || {}; const degraded = deceasedValue != null && used.is_deceased == null && used.deceased == null; return { ok: true, degraded }; } if (!error && Array.isArray(data) && data.length === 0) { if (i === attempts.length - 1) return { ok: false, error: { message: "row not found" } }; continue; } const msg = String(error.message || "").toLowerCase(); const isColumnMissing = msg.includes("column") && msg.includes("does not exist"); const isSchemaCacheMissingColumn = msg.includes("تحديث الخدمة") && msg.includes("could not find") && msg.includes("column"); const canRetry = isColumnMissing || isSchemaCacheMissingColumn; if (!canRetry) return { ok: false, error }; if (i === attempts.length - 1) return { ok: false, error }; } return { ok: false, error: { message: "unknown update error" } }; } async function deleteTreeChildRow(sb, branchKey, parentId, childId) { const attempts = []; const key = normalizePersonName(branchKey || ""); const parent = normalizePersonName(parentId || ""); const id = normalizePersonName(childId || ""); if (!key || !parent || !id) return { ok: false, error: { message: "missing key" } }; const parentCols = ["parent_name", "parent"]; const childCols = ["child_name", "name"]; parentCols.forEach((parentCol) =>{ childCols.forEach((childCol) =>{ attempts.push({ parentCol, childCol }); }); }); for (let i = 0; i< attempts.length; i++) { const a = attempts[i]; const { data, error } = await sb .from(FAMILY_TREE_CHILDREN_TABLE) .delete() .eq("branch_key", key) .eq(a.parentCol, parent) .eq(a.childCol, id) .select(a.childCol); if (!error && Array.isArray(data) && data.length) return { ok: true }; if (!error && Array.isArray(data) && data.length === 0) { if (i === attempts.length - 1) return { ok: false, error: { message: "row not found" } }; continue; } const msg = String(error.message || "").toLowerCase(); const isColumnMissing = msg.includes("column") && msg.includes("does not exist"); const isSchemaCacheMissingColumn = msg.includes("تحديث الخدمة") && msg.includes("could not find") && msg.includes("column"); const canRetry = isColumnMissing || isSchemaCacheMissingColumn; if (!canRetry) return { ok: false, error }; if (i === attempts.length - 1) return { ok: false, error }; } return { ok: false, error: { message: "unknown delete error" } }; } function isRpcMissingError(err) { const msg = String(err && err.message ? err.message : "").toLowerCase(); const code = String(err && err.code ? err.code : "").toLowerCase(); if (code === "pgrst202") return true; if (msg.includes("could not find the function")) return true; if (msg.includes("function") && msg.includes("does not exist")) return true; if (msg.includes("تحديث الخدمة") && msg.includes("function")) return true; return false; } function isCaseTypesTextAndDateMismatchError(err) { const msg = String(err && err.message ? err.message : "").toLowerCase(); const details = String(err && err.details ? err.details : "").toLowerCase(); const low = (msg + " " + details).trim(); return low.includes("case types") && low.includes("text") && low.includes("date") && low.includes("cannot be matched"); } function confirmTypedText(expectedRaw, opts) { const options = opts || {}; const expected = normalizePersonName(expectedRaw || ""); if (!expected) return Promise.resolve(false); const title = String(options.title || "تأكيد").trim() || "تأكيد"; const body = String(options.body || "").trim(); const confirmLabel = String(options.confirmLabel || "تأكيد").trim() || "تأكيد"; const cancelLabel = String(options.cancelLabel || "إلغاء").trim() || "إلغاء"; return new Promise((resolve) =>{ const overlay = document.createElement("div"); overlay.style.position = "fixed"; overlay.style.inset = "0"; overlay.style.background = "rgba(0, 0, 0, 0.55)"; overlay.style.display = "flex"; overlay.style.alignItems = "center"; overlay.style.justifyContent = "center"; overlay.style.zIndex = "99999"; overlay.dir = "rtl"; const card = document.createElement("div"); card.style.width = "min(92vw, 520px)"; card.style.background = "#fff"; card.style.borderRadius = "14px"; card.style.padding = "14px 14px 12px"; card.style.boxShadow = "0 14px 40px rgba(0,0,0,0.25)"; card.style.border = "1px solid rgba(0,0,0,0.08)"; const h = document.createElement("div"); h.textContent = title; h.style.fontWeight = "700"; h.style.fontSize = "16px"; h.style.marginBottom = "8px"; const p = document.createElement("div"); p.style.marginBottom = "10px"; p.style.color = "#374151"; p.style.fontSize = "13px"; p.textContent = body || "اكتب النص التالي لتأكيد العملية:"; const expectedBox = document.createElement("div"); expectedBox.style.background = "#f3f4f6"; expectedBox.style.border = "1px solid #e5e7eb"; expectedBox.style.borderRadius = "10px"; expectedBox.style.padding = "10px 12px"; expectedBox.style.fontWeight = "700"; expectedBox.style.marginBottom = "10px"; expectedBox.style.userSelect = "text"; expectedBox.textContent = expected; const input = document.createElement("input"); input.type = "text"; input.autocomplete = "off"; input.inputMode = "text"; input.style.width = "100%"; input.style.padding = "10px 12px"; input.style.borderRadius = "10px"; input.style.border = "1px solid #d1d5db"; input.style.outline = "none"; input.style.fontSize = "14px"; input.placeholder = "اكتب هنا..."; const actions = document.createElement("div"); actions.style.display = "flex"; actions.style.gap = "8px"; actions.style.marginTop = "12px"; actions.style.justifyContent = "flex-start"; const cancelBtn = document.createElement("button"); cancelBtn.type = "button"; cancelBtn.className = "btn btn-secondary btn-small"; cancelBtn.textContent = cancelLabel; const okBtn = document.createElement("button"); okBtn.type = "button"; okBtn.className = "btn btn-primary btn-small"; okBtn.textContent = confirmLabel; okBtn.disabled = true; const cleanup = (v) =>{ try { document.removeEventListener("keydown", onKeyDown, true); } catch (e) {} try { overlay.remove(); } catch (e) {} resolve(!!v); }; const isMatch = () =>normalizePersonName(input.value || "") === expected; const refresh = () =>{ okBtn.disabled = !isMatch(); }; const onKeyDown = (e) =>{ if (!e) return; if (e.key === "Escape") { e.preventDefault(); cleanup(false); return; } if (e.key === "Enter") { if (isMatch()) { e.preventDefault(); cleanup(true); } } }; overlay.addEventListener("click", (e) =>{ if (e && e.target === overlay) cleanup(false); }); cancelBtn.addEventListener("click", () =>cleanup(false)); okBtn.addEventListener("click", () =>cleanup(true)); input.addEventListener("input", refresh); document.addEventListener("keydown", onKeyDown, true); card.appendChild(h); card.appendChild(p); card.appendChild(expectedBox); card.appendChild(input); actions.appendChild(cancelBtn); actions.appendChild(okBtn); card.appendChild(actions); overlay.appendChild(card); document.body.appendChild(overlay); setTimeout(() =>{ try { input.focus(); input.select(); } catch (e) {} }, 0); }); } function isOnConflictConstraintError(err) { const msg = String(err && err.message ? err.message : "").toLowerCase(); return msg.includes("no unique or exclusion constraint matching the on conflict specification"); }
function formatDelegateDeniedError(info, domain) {
  const d = domain === "events" ? "events" : "tree";
  const data = info && typeof info === "object" ? info : {};
  const reason = String(data.reason || data.status || "").trim().toLowerCase();
  const role = String(data.role_key || "").trim();
  const op = String(data.operation_key || "").trim();
  const rid = String(data.request_id || data.requestId || "").trim();
  if (reason === "disabled") {
    return "حساب المندوب معطّل. تواصل مع الإدارة لإعادة التفعيل.";
  }
  if (reason === "no_permission") {
    if (d === "events") {
      return role
        ? ("دورك (" + role + ") لا يسمح بالكتابة على المناسبات. اطلب من الإدارة تعديل الصلاحية.")
        : "دورك الحالي لا يسمح بالكتابة على المناسبات. اطلب من الإدارة تعديل الصلاحية.";
    }
    return role
      ? ("دورك (" + role + ") لا يسمح بالكتابة على الشجرة. اطلب من الإدارة تعديل الصلاحية.")
      : "دورك الحالي لا يسمح بالكتابة على الشجرة. اطلب من الإدارة تعديل الصلاحية.";
  }
  if (reason === "bad_secret" || reason === "approved") {
    return "الصلاحية موجودة لكن بيانات الدخول لا تطابق الاعتماد. سجّل الخروج ثم الدخول مجددًا.";
  }
  if (reason === "pending") {
    return rid
      ? ("طلب المندوب قيد المراجعة (رقم الطلب: " + rid + ").")
      : "طلب المندوب قيد المراجعة.";
  }
  if (reason === "rejected") {
    return rid
      ? ("تم رفض طلب المندوب (رقم الطلب: " + rid + ").")
      : "تم رفض طلب المندوب.";
  }
  if (reason === "not_found") {
    return d === "events"
      ? "لا توجد صلاحية مناسبات معتمدة لهذه البيانات."
      : "لا توجد صلاحية شجرة معتمدة لهذه البيانات.";
  }
  if (op) {
    return "غير مصرح بتنفيذ العملية (" + op + ").";
  }
  return d === "events"
    ? "غير مصرح لك بتنفيذ هذه العملية على المناسبات."
    : "غير مصرح لك بتنفيذ هذه العملية على الشجرة.";
}

async function getDelegateRpcAuth() { const session = loadDelegateSession(); if (!session) return { ok: false, reason: "no_session" }; const secretHash = String(session.secretHash || "").trim(); if (!secretHash) return { ok: false, reason: "hash_failed" }; return { ok: true, branch: session.branch, phone: session.phone, email: session.email, secretHash }; }
function normalizeMemberPhoneForDelegate(v) {
  if (window.AlzidanPhoneIntl && typeof window.AlzidanPhoneIntl.normalizeMemberPhoneE164 === "function") {
    return window.AlzidanPhoneIntl.normalizeMemberPhoneE164(v);
  }
  var digits = normalizeArabicDigitsToLatin(String(v || "")).replace(/[^\d]/g, "").trim();
  if (!digits) return "";
  if (digits.indexOf("966") === 0 && digits.length >= 12) return "+" + digits;
  if (digits.length === 9 && digits.charAt(0) === "5") return "+966" + digits;
  if (digits.length === 10 && digits.indexOf("05") === 0) return "+966" + digits.slice(1);
  return "";
}

async function findTreeRowForMemberProfile(sb, branchKey, childId, personId) {
  const branch = normalizePersonName(branchKey || "");
  const child = normalizePersonName(childId || "");
  const pid = normalizePersonName(personId || "");
  if (!sb || !branch || (!child && !pid)) return null;

  const selectCols = "id,branch_key,person_id,child_name,name";
  if (pid) {
    const byPid = await sb.from("tree_children").select(selectCols).eq("branch_key", branch).eq("person_id", pid).limit(1).maybeSingle();
    if (!byPid.error && byPid.data) return byPid.data;
  }
  if (child) {
    const byPath = await sb.from("tree_children").select(selectCols).eq("branch_key", branch).eq("child_name", child).limit(1).maybeSingle();
    if (!byPath.error && byPath.data) return byPath.data;
    const leaf = child.includes("/") ? child.split("/").map(normalizePersonName).filter(Boolean).slice(-1)[0] : child;
    if (leaf && leaf !== child) {
      const byLeaf = await sb.from("tree_children").select(selectCols).eq("branch_key", branch).eq("child_name", leaf).limit(1).maybeSingle();
      if (!byLeaf.error && byLeaf.data) return byLeaf.data;
    }
  }
  return null;
}

async function saveDelegateMemberProfile(sb, phoneRaw, branchKey, childId, personId) {
  const phone = normalizeMemberPhoneForDelegate(phoneRaw);
  if (!phone) return { ok: true, skipped: true };

  const treeRow = await findTreeRowForMemberProfile(sb, branchKey, childId, personId);
  if (!treeRow || !treeRow.id) return { ok: false, error: { message: "لم أجد سجل الشخص بعد حفظ الشجرة." } };

  const childName = String(treeRow.child_name || treeRow.name || childId || "").trim();
  const displayName = childName.split("/").map((x) => String(x || "").trim()).filter(Boolean).slice(-1)[0] || "";

  const row = {
    phone,
    branch_key: String(treeRow.branch_key || branchKey || "").trim(),
    tree_child_id: treeRow.id,
    person_id: treeRow.person_id || personId || null,
    display_name: displayName || null,
    status: "active",
    updated_at: new Date().toISOString()
  };

  let existingId = 0;
  const byChild = await sb.from("member_profiles").select("id").eq("tree_child_id", treeRow.id).limit(1).maybeSingle();
  if (byChild.data && byChild.data.id) existingId = Number(byChild.data.id);
  if (!existingId && row.person_id) {
    const byPid = await sb.from("member_profiles").select("id").eq("person_id", row.person_id).limit(1).maybeSingle();
    if (byPid.data && byPid.data.id) existingId = Number(byPid.data.id);
  }
  if (!existingId) {
    const found = await sb.from("member_profiles").select("id").eq("phone", phone).limit(1).maybeSingle();
    if (found.error) return { ok: false, error: found.error };
    if (found.data && found.data.id) existingId = Number(found.data.id);
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

async function loadDelegateMemberPhone(sb, branchKey, childId, personId) {
  const treeRow = await findTreeRowForMemberProfile(sb, branchKey, childId, personId);
  if (!treeRow || !treeRow.id) return "";
  const { data, error } = await sb.from("member_profiles").select("phone").eq("tree_child_id", treeRow.id).limit(1).maybeSingle();
  if (error || !data) return "";
  return normalizeMemberPhoneForDelegate(data.phone || "");
}

function findStablePersonId(nodeId) { const wanted = normalizePersonName(nodeId || ""); if (!wanted) return ""; const meta = state.pathToRow && state.pathToRow[wanted] ? state.pathToRow[wanted] : null; if (meta && meta.person_id) return normalizePersonName(meta.person_id); if (meta && state.pathToRow["pid:" + normalizePersonName(meta.person_id)]) return normalizePersonName(meta.person_id); const lists = Object.values(state.children || {}); for (let i = 0; i< lists.length; i++) { const list = Array.isArray(lists[i]) ? lists[i] : []; for (let j = 0; j< list.length; j++) { const child = list[j] || {}; if (normalizePersonName(child.name || "") !== wanted) continue; return normalizePersonName(child.personId || ""); } } return ""; } async function rpcInsertTreeChildRow(sb, row) { const auth = await getDelegateRpcAuth(); if (!auth.ok) return { ok: false, error: { message: auth.reason } }; const r = row || {}; const key = normalizePersonName(r.branch_key || ""); const parentFull = normalizePersonName(r.parent_name || r.parent || ""); const childFull = normalizePersonName(r.child_name || r.name || ""); if (!key || !parentFull || !childFull) return { ok: false, error: { message: "missing key" } }; let parentPersonId = normalizePersonName(r.parent_person_id || "") || findStablePersonId(parentFull); if (!parentPersonId && window.AlzidanCanonicalPerson && typeof window.AlzidanCanonicalPerson.attachParentPersonId === "function") { const attached = window.AlzidanCanonicalPerson.attachParentPersonId(r, state.pathToRow, parentFull, canonicalHelpers()); parentPersonId = normalizePersonName(attached.parent_person_id || ""); } const rpcRow = Object.assign({}, r, { parent_name: parentFull, parent: parentFull, child_name: childFull, name: childFull }); if (parentPersonId) rpcRow.parent_person_id = parentPersonId; const { data, error } = await sb.rpc("tree_children_insert_v1", { p_branch_key: key, p_parent_name: parentFull, p_child_name: childFull, p_phone: auth.phone, p_email: auth.email, p_secret_hash: auth.secretHash, p_row: rpcRow }); if (error) { if (isOnConflictConstraintError(error)) { return { ok: false, error }; } return { ok: false, error }; } if (data === true) return { ok: true }; try { const info = await sb.rpc("check_tree_delegate_access", { p_branch_key: key, p_phone: auth.phone, p_email: auth.email, p_secret_hash: auth.secretHash }); const denied = (!info.error && info.data && typeof info.data === "object") ? info.data : {}; return { ok: false, error: { message: "not allowed", reason: denied.reason || denied.status || "not allowed", role_key: denied.role_key || null, operation_key: denied.operation_key || "tree.write", detail: formatDelegateDeniedError(denied, "tree") } }; } catch (e) { return { ok: false, error: { message: "not allowed" } }; } } async function rpcUpdateTreeChildRow(sb, branchKey, parentId, childId, patch, personId) { const auth = await getDelegateRpcAuth(); if (!auth.ok) return { ok: false, error: { message: auth.reason } }; const key = normalizePersonName(branchKey || ""); const parentStored = getLeafStoredNameFromNodeId(parentId || ""); const childStored = getLeafStoredNameFromNodeId(childId || ""); if (!key || !parentStored || !childStored) return { ok: false, error: { message: "missing key" } }; const stablePersonId = normalizePersonName(personId || "") || findStablePersonId(childId); const rpcPatch = stablePersonId ? { ...(patch || {}), person_id: stablePersonId } : (patch || {}); const call = async (parentName, childName) =>await sb.rpc("tree_children_update_v1", { p_branch_key: key, p_parent_name: parentName, p_child_name: childName, p_phone: auth.phone, p_email: auth.email, p_secret_hash: auth.secretHash, p_patch: rpcPatch }); const first = await call(parentStored, childStored); if (first.error) return { ok: false, error: first.error }; if (first.data === true) return { ok: true }; const parentBase = getLeafBaseNameFromNodeId(parentId || ""); const childBase = getLeafBaseNameFromNodeId(childId || ""); if ((parentBase && childBase && (parentBase !== parentStored || childBase !== childStored))) { const second = await call(parentBase, childBase); if (second.error) return { ok: false, error: second.error }; if (second.data === true) return { ok: true }; } const info = await sb.rpc("check_tree_delegate_access", { p_branch_key: key, p_phone: auth.phone, p_email: auth.email, p_secret_hash: auth.secretHash }); if (!info.error && info.data && typeof info.data === "object" && info.data.allowed === true) { return { ok: false, error: { message: "row not found" } }; } const denied = (!info.error && info.data && typeof info.data === "object") ? info.data : {}; return { ok: false, error: { message: "not allowed", reason: denied.reason || denied.status || "not allowed", role_key: denied.role_key || null, operation_key: denied.operation_key || "tree.write", detail: formatDelegateDeniedError(denied, "tree") } }; } async function rpcDeleteTreeChildRow(sb, branchKey, parentId, childId, personId) { const auth = await getDelegateRpcAuth(); if (!auth.ok) return { ok: false, error: { message: auth.reason } }; const key = normalizePersonName(branchKey || ""); const parentFull = normalizePersonName(parentId || ""); const childFull = normalizePersonName(childId || ""); if (!key || !parentFull || !childFull) return { ok: false, error: { message: "missing key" } }; const stablePersonId = normalizePersonName(personId || "") || findStablePersonId(childId); if (stablePersonId) { const byId = await sb.rpc("tree_children_delete_by_id_v1", { p_branch_key: key, p_person_id: stablePersonId, p_phone: auth.phone, p_email: auth.email, p_secret_hash: auth.secretHash }); if (!byId.error && byId.data === true) return { ok: true }; if (byId.error && !isRpcMissingError(byId.error)) return { ok: false, error: byId.error }; } const FM = window.AlzidanFamilyPersonCore || {}; const rowMeta = typeof FM.findTreeRowMeta === "function" ? FM.findTreeRowMeta(state.pathToRow || {}, childId, null, { normalizePersonName: normalizePersonName, normalizePersonBaseName: normalizePersonBaseName }, parentId) : null; const deleteAttempts = typeof FM.buildDeleteNameAttempts === "function" ? FM.buildDeleteNameAttempts(parentId, childId, { normalizePersonName: normalizePersonName, getLeafStoredNameFromNodeId: getLeafStoredNameFromNodeId, normalizePersonBaseName: normalizePersonBaseName, rowMeta: rowMeta }) : [[getLeafStoredNameFromNodeId(parentId || ""), getLeafStoredNameFromNodeId(childId || "")]]; const call = async (parentName, childName) =>await sb.rpc("tree_children_delete_v1", { p_branch_key: key, p_parent_name: parentName, p_child_name: childName, p_phone: auth.phone, p_email: auth.email, p_secret_hash: auth.secretHash }); for (let i = 0; i< deleteAttempts.length; i++) { const pair = deleteAttempts[i] || []; const parentName = pair[0]; const childName = pair[1]; if (!parentName || !childName) continue; const res = await call(parentName, childName); if (res.error) return { ok: false, error: res.error }; if (res.data === true) return { ok: true }; } const info = await sb.rpc("check_tree_delegate_access", { p_branch_key: key, p_phone: auth.phone, p_email: auth.email, p_secret_hash: auth.secretHash }); if (!info.error && info.data && typeof info.data === "object" && info.data.allowed === true) { return { ok: false, error: { message: "row not found" } }; } const denied = (!info.error && info.data && typeof info.data === "object") ? info.data : {}; return { ok: false, error: { message: "not allowed", reason: denied.reason || denied.status || "not allowed", role_key: denied.role_key || null, operation_key: denied.operation_key || "tree.write", detail: formatDelegateDeniedError(denied, "tree") } }; } async function rpcInsertFamilyEventRow(sb, row) { const auth = await getDelegateRpcAuth(); if (!auth.ok) return { ok: false, error: { message: auth.reason } }; const key = normalizePersonName(state.branch || auth.branch || ""); if (!key) return { ok: false, error: { message: "missing branch" } }; const { data, error } = await sb.rpc("family_events_insert_v1", { p_branch_key: key, p_phone: auth.phone, p_email: auth.email, p_secret_hash: auth.secretHash, p_row: row || {} }); if (error) return { ok: false, error }; if (data === true) return { ok: true }; try { const info = await sb.rpc("check_events_delegate_access", { p_branch_key: key, p_phone: auth.phone, p_email: auth.email, p_secret_hash: auth.secretHash }); if (!info.error && info.data && typeof info.data === "object") { const denied = info.data; const arabicMsg = formatDelegateDeniedError(denied, "events"); return { ok: false, error: { message: arabicMsg || "not allowed", detail: "events_access", status: denied.status || null, requestId: denied.request_id || null, reason: denied.reason || denied.status || null, role_key: denied.role_key || null, operation_key: denied.operation_key || "events.write", arabic: arabicMsg } }; } } catch (e) {} return { ok: false, error: { message: "not allowed", reason: "not allowed" } }; } async function rpcUpdateFamilyEventRow(sb, pk, patch) { const auth = await getDelegateRpcAuth(); if (!auth.ok) return { ok: false, error: { message: auth.reason } }; const key = normalizePersonName(state.branch || auth.branch || ""); if (!key) return { ok: false, error: { message: "missing branch" } }; if (!pk || !pk.col || pk.value == null) return { ok: false, error: { message: "missing pk" } }; const { data, error } = await sb.rpc("family_events_update_v1", { p_branch_key: key, p_phone: auth.phone, p_email: auth.email, p_secret_hash: auth.secretHash, p_pk_col: String(pk.col), p_pk_value: String(pk.value), p_patch: patch || {} }); if (error) return { ok: false, error }; if (data === true) return { ok: true }; try { const info = await sb.rpc("check_events_delegate_access", { p_branch_key: key, p_phone: auth.phone, p_email: auth.email, p_secret_hash: auth.secretHash }); if (!info.error && info.data && typeof info.data === "object") { const denied = info.data; const arabicMsg = formatDelegateDeniedError(denied, "events"); return { ok: false, error: { message: arabicMsg || "not allowed", detail: "events_access", status: denied.status || null, requestId: denied.request_id || null, reason: denied.reason || denied.status || null, role_key: denied.role_key || null, operation_key: denied.operation_key || "events.write", arabic: arabicMsg } }; } } catch (e) {} return { ok: false, error: { message: "not allowed", reason: "not allowed" } }; } async function rpcDeleteFamilyEventRow(sb, pk) { const auth = await getDelegateRpcAuth(); if (!auth.ok) return { ok: false, error: { message: auth.reason } }; const key = normalizePersonName(state.branch || auth.branch || ""); if (!key) return { ok: false, error: { message: "missing branch" } }; if (!pk || !pk.col || pk.value == null) return { ok: false, error: { message: "missing pk" } }; const { data, error } = await sb.rpc("family_events_delete_v1", { p_branch_key: key, p_phone: auth.phone, p_email: auth.email, p_secret_hash: auth.secretHash, p_pk_col: String(pk.col), p_pk_value: String(pk.value) }); if (error) return { ok: false, error }; if (data === true) return { ok: true }; try { const info = await sb.rpc("check_events_delegate_access", { p_branch_key: key, p_phone: auth.phone, p_email: auth.email, p_secret_hash: auth.secretHash }); if (!info.error && info.data && typeof info.data === "object") { const denied = info.data; const arabicMsg = formatDelegateDeniedError(denied, "events"); return { ok: false, error: { message: arabicMsg || "not allowed", detail: "events_access", status: denied.status || null, requestId: denied.request_id || null, reason: denied.reason || denied.status || null, role_key: denied.role_key || null, operation_key: denied.operation_key || "events.write", arabic: arabicMsg } }; } } catch (e) {} return { ok: false, error: { message: "not allowed", reason: "not allowed" } }; } function normalizePersonBaseName(v) { const n = normalizePersonName(v || ""); if (!n) return ""; const m = n.match(/^(.*)\s*\((?:ابن|مواليد)\s+[^)]+\)\s*$/); const core = m && m[1] ? normalizePersonName(m[1]) : n; const parts = core.split("/").map((p) =>normalizePersonName(p)).filter(Boolean); return parts.length ? parts[parts.length - 1] : core; } function tokenizeLineageInput(v) { const s = normalizePersonName(v || ""); if (!s) return []; const hasConnector = /(^|\s)(?:بن|ابن|بنت)(\s|$)/.test(s); if (!hasConnector) return [s]; return s .split(/\s+/g) .map((w) =>normalizePersonName(w)) .filter(Boolean) .filter((w) =>!["بن", "ابن", "بنت"].includes(w)); } function getDisplayNameForNodeId(nodeId, branchRoot) { const id = normalizePersonName(nodeId || ""); if (!id) return ""; if (branchRoot && id === branchRoot) return id; const leaf = id.includes("/") ? (id.split("/").map((p) =>normalizePersonName(p)).filter(Boolean).slice(-1)[0] || id) : id; const tokens = tokenizeLineageInput(normalizePersonBaseName(leaf)); return tokens.length ? tokens[0] : leaf; } function getLeafBaseNameFromNodeId(nodeId) { const id = normalizePersonName(nodeId || ""); if (!id) return ""; const leaf = id.includes("/") ? (id.split("/").map((p) =>normalizePersonName(p)).filter(Boolean).slice(-1)[0] || id) : id; return normalizePersonBaseName(leaf); } function getLeafStoredNameFromNodeId(nodeId) { const id = normalizePersonName(nodeId || ""); if (!id) return ""; return id.includes("/") ? (id.split("/").map((p) =>normalizePersonName(p)).filter(Boolean).slice(-1)[0] || id) : id; } function getForcedRahmaSuffix(nodeId, branchKey) { const base = normalizePersonName(getLeafBaseNameFromNodeId(nodeId)); if (!base) return ""; const suffix = FORCED_RAHMA_BY_BASE[base] || ""; if (!suffix) return ""; const branch = normalizePersonName(branchKey || state.branch || ""); if (!branch) return ""; const byBranch = state.forcedRahmaByBranch && state.forcedRahmaByBranch[branch] ? state.forcedRahmaByBranch[branch] : null; if (!byBranch) return ""; const canonicalId = normalizePersonName(byBranch[base] || ""); if (!canonicalId) return ""; const id = normalizePersonName(nodeId || ""); return id === canonicalId ? suffix : ""; } function buildLineagePlanFromTokens(tokens, branchKey, selectedParent) { const t = Array.isArray(tokens) ? tokens.map((x) =>normalizePersonName(x)).filter(Boolean) : []; if (t.length< 2) return null; const branch = normalizePersonName(branchKey || ""); if (branch && t.length >= 3) { const a = normalizePersonName(t[t.length - 3] || ""); const b = normalizePersonName(t[t.length - 2] || ""); const c = normalizePersonName(t[t.length - 1] || ""); if (a === branch && b === "مطلق" && c === "زيدان") { const relative = t.slice(0, -3); if (!relative.length) return null; const branchRoot = getBranchRootName(branch); const chain = relative.reverse(); return { anchorParent: branchRoot, chain }; } } const anchorBranchIndex = branch ? t.lastIndexOf(branch) : -1; if (anchorBranchIndex >= 0) { const relative = t.slice(0, anchorBranchIndex); if (!relative.length) return null; const branchRoot = getBranchRootName(branch); const chain = relative.reverse(); return { anchorParent: branchRoot, chain }; } const selected = normalizePersonName(selectedParent || ""); const selectedBase = normalizePersonBaseName(selected); const last = normalizePersonName(t[t.length - 1] || ""); if (selected && selectedBase && selectedBase === last) { const relative = t.slice(0, -1); if (!relative.length) return null; return { anchorParent: selected, chain: relative.reverse() }; } return null; } function getParentShortNameForDisambiguation(parentName) { const n = normalizePersonName(parentName || ""); const cleaned = n.replace(/^أصل الفرع:\s*/i, "").trim(); if (!cleaned) return ""; const first = cleaned.split(" ")[0]; return first || cleaned; } function getAllBaseNames() { const baseNames = new Set(); Object.keys(state.children || {}).forEach((p) =>{ const b = normalizePersonBaseName(p); if (b) baseNames.add(b); }); Object.values(state.children || {}).forEach((list) =>{ (Array.isArray(list) ? list : []).forEach((c) =>{ const b = normalizePersonBaseName(c && c.name ? c.name : ""); if (b) baseNames.add(b); }); }); return baseNames; } function computeUniqueChildName(parentName, desiredName, birthYear, baseNames) { const name = normalizePersonName(desiredName || ""); const inputBase = normalizePersonBaseName(name); if (!inputBase) return ""; if (!baseNames || !baseNames.has(inputBase)) return name; const parentShort = getParentShortNameForDisambiguation(parentName); const tag = birthYear ? ("مواليد " + birthYear) : ("ابن " + (parentShort || parentName)); let candidate = inputBase + " (" + tag + ")"; let i = 2; while (baseNames.has(normalizePersonBaseName(candidate))) { candidate = inputBase + " (" + tag + " " + String(i) + ")"; i += 1; } return candidate; } function findChildNameByBase(parentName, childBase, opts) {
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
} function pickText(arr) { if (!arr || !arr.length) return ""; return arr[Math.floor(Math.random() * arr.length)]; } function formatDateISO(v) { let s = String(v || "").trim(); if (!s) return ""; for (let i = 0; i< 3; i++) { const m = /^\s*[\(（]\s*(.*?)\s*[\)）]\s*$/.exec(s); if (!m) break; s = String(m[1] || "").trim(); if (!s) return ""; } const toLooseIso = (y, mo, d) =>String(parseInt(y, 10)) + "-" + String(parseInt(mo, 10)) + "-" + String(parseInt(d, 10)); const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s); if (slash) { const d = slash[1].padStart(2, "0"); const m = slash[2].padStart(2, "0"); const y = slash[3]; const year = parseInt(y, 10); if (year >= 1200 && year<= 1700) return toLooseIso(y, m, d); const hijriISO = gregorianToHijriISO(y + "-" + m + "-" + d); const h = parseHijriISO(hijriISO); if (h) return toLooseIso(String(h.y), String(h.mo), String(h.d)); return y + "-" + String(parseInt(m, 10)) + "-" + String(parseInt(d, 10)); } const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s); if (iso) { const y = iso[1].padStart(4, "0"); const m = iso[2].padStart(2, "0"); const d = iso[3].padStart(2, "0"); const year = parseInt(y, 10); if (year >= 1200 && year<= 1700) return toLooseIso(y, m, d); const hijriISO = gregorianToHijriISO(y + "-" + m + "-" + d); const h = parseHijriISO(hijriISO); if (h) return toLooseIso(String(h.y), String(h.mo), String(h.d)); return y + "-" + String(parseInt(m, 10)) + "-" + String(parseInt(d, 10)); } return s; } function todayGregorianISO() { const now = new Date(); const y = String(now.getFullYear()).padStart(4, "0"); const m = String(now.getMonth() + 1).padStart(2, "0"); const d = String(now.getDate()).padStart(2, "0"); return y + "-" + m + "-" + d; } function wrapLTRText(v) { const s = String(v || ""); if (!s) return ""; return "\u200E" + s + "\u200E"; } function formatTime12Ar(v) { const s = String(v || "").trim(); if (!s) return ""; const normalized = s.replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632)).replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 1776)); const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(normalized); if (!m) return s; let h = parseInt(m[1], 10); const minute = parseInt(m[2], 10); if (!Number.isFinite(h) || h < 0 || h > 23) return s; if (!Number.isFinite(minute) || minute < 0 || minute > 59) return s; const suffix = h >= 12 ? "م" : "ص"; h = h % 12; if (h === 0) h = 12; const ar = (n, pad) => { const t = pad ? String(n).padStart(2, "0") : String(n); return t.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]); }; if (minute === 0) return ar(h, false) + " " + suffix; return ar(h, false) + ":" + ar(minute, true) + " " + suffix; } function formatEventText(event) { const name = event.person || ""; if (event.type === "birth") { return pickText([ "ألف مبروك لـ " + name + " بمولود جديد، جعله الله من مواليد السعادة.", "نبارك لـ " + name + " قدوم المولود، وجعله الله قرة عين لوالديه.", "نبارك لـ " + name + " المولود الجديد، اللهم أنبته نباتًا حسنًا." ]); } if (event.type === "engagement") { return pickText([ "نبارك لـ " + name + " الخطوبة، ونسأل الله تمام الفرح.", "ألف مبروك لـ " + name + " الخطوبة، عقبال ليلة العمر.", "نبارك لـ " + name + " الخطوبة، وجمع الله بين القلوب على خير." ]); } if (event.type === "contract") { return pickText([ "نبارك لـ " + name + " عقد القران، ونسأل الله لهما البركة والتوفيق.", "ألف مبروك لـ " + name + " عقد القران، جعله الله عقدًا مباركًا.", "نبارك لـ " + name + " عقد القران، ونسأل الله حياةً سعيدة." ]); } if (event.type === "marriage") { return pickText([ "نبارك لـ " + name + " الزواج، ونسأل الله لهما السعادة والهناء.", "ألف مبروك لـ " + name + " الزواج، عسى الفرح يدوم.", "نبارك لـ " + name + " الزواج، وجمع الله بينهما على خير." ]); } if (event.type === "graduation") { return pickText([ "نبارك لـ " + name + " التخرّج، ومنها للأعلى بإذن الله.", "ألف مبروك لـ " + name + " التخرّج، نجاح يرفع الرأس.", "نبارك لـ " + name + " التخرّج، وعقبال المنصب الأعلى." ]); } if (event.type === "success") { return pickText([ "نبارك لـ " + name + " النجاح والتفوق، عقبال أعلى المراتب.", "ألف مبروك لـ " + name + " التفوق، هذا ثمرة الجد والاجتهاد.", "نبارك لـ " + name + " النجاح، جعلها فاتحة خير." ]); } if (event.type === "promotion") { return pickText([ "نبارك لـ " + name + " الترقية/الوظيفة الجديدة، الله يبارك لك ويوفقك.", "ألف مبروك لـ " + name + " الترقية، تستاهل كل خير.", "نبارك لـ " + name + " الوظيفة الجديدة، ومنها للأعلى." ]); } if (event.type === "new_house") { return pickText([ "نبارك لـ " + name + " المنزل الجديد، جعله الله منزلًا مباركًا عامرًا بالطاعة.", "ألف مبروك لـ " + name + " المنزل الجديد، عسى السعادة تملأ أركانه.", "نبارك لـ " + name + " البيت الجديد، جعله الله دار فرح وراحة." ]); } if (event.type === "travel") { return pickText([ "نتمنى لـ " + name + " سفرًا موفقًا وعودة سالمة.", "في حفظ الله يا " + name + "، سفر سعيد وعودة قريبة.", "نسأل الله التوفيق لـ " + name + " في السفر والسلامة في الرجوع." ]); } if (event.type === "gathering") { return pickText([ "دعوة لاجتماع عائلي — حضوركم يسعدنا ويزيد اللمة بهجة.", "لقاء عائلي قريب — اللمة تجمعنا على خير ومحبة.", "اجتماع عائلي — موعد يجمع القلوب ويقوّي صلة الرحم." ]); } if (event.type === "death") { return "عزاء: " + name + " — عظم الله أجركم وأحسن الله عزاءكم."; } if (event.type === "sick") { return "نسأل الله الشفاء العاجل لـ " + name + "، لا بأس طهور إن شاء الله."; } if (event.type === "operation") { return "نسأل الله الشفاء لـ " + name + " بعد العملية، ونسألكم الدعاء له."; } if (event.type === "discharge") { return pickText([ "الحمد لله على سلامة " + name + " وخروجه من المستشفى، طهور إن شاء الله.", "ألف الحمد لله على سلامة " + name + "، نسأل الله أن يتمم عليه الصحة والعافية.", "الحمد لله على سلامة " + name + "، ونسأل الله أن يجعل ما أصابه كفارة." ]); } return name ? name : ""; } function showAlert(el, kind, text) { if (!el) return; el.textContent = String(text || ""); el.className = "alert " + (kind === "success" ? "alert-success" : "alert-error"); el.style.display = "block"; } function showAlertAndFocus(el, kind, text) { showAlert(el, kind, text); try { if (el && typeof el.scrollIntoView === "function") { el.scrollIntoView({ block: "start", behavior: "smooth" }); } } catch (e) {} } function hideAlert(el) { if (!el) return; el.style.display = "none"; } function getEventPk(row) { if (row && row.id != null) return { col: "id", value: row.id }; if (row && row.created_at != null) return { col: "created_at", value: row.created_at }; return null; } function getEventPkKeys(row) { const keys = []; if (row && row.id != null) keys.push("id:" + String(row.id)); if (row && row.created_at != null) keys.push("created_at:" + String(row.created_at)); return keys; } function getEventPkRefs(row) { const refs = []; if (row && row.id != null) refs.push({ col: "id", value: row.id }); if (row && row.created_at != null) refs.push({ col: "created_at", value: row.created_at }); return refs; } function addEnvelopePkRefsToSet(refOrRefs, set) { if (!set) return; const addOne = (ref) =>{ if (!ref || !ref.col || ref.value == null) return; set.add(String(ref.col) + ":" + String(ref.value)); }; if (Array.isArray(refOrRefs)) { refOrRefs.forEach((r) =>addOne(r)); return; } addOne(refOrRefs); } function parseHealthDetails(eventRow) { const parsed = safeParseJson(eventRow && eventRow.details != null ? eventRow.details : null); if (parsed && typeof parsed === "object" && parsed.kind === "health_notice" && parsed.v === 1) { return { place: String(parsed.place || "hospital").trim() === "home" ? "home" : "hospital", homeCity: String(parsed.homeCity || "").trim(), homeArea: String(parsed.homeArea || "").trim(), notes: String(parsed.notes || "").trim(), hospitalName: String(parsed.hospitalName || "").trim(), hospitalDept: String(parsed.hospitalDept || "").trim() }; } const raw = String(eventRow && eventRow.details != null ? eventRow.details : "").trim(); return { place: "hospital", homeCity: "", homeArea: "", notes: raw, hospitalName: "", hospitalDept: "" }; } function updateSickContactModeVisibility() { if (!sickContactMethod || !sickVisitBlock || !sickContactBlock) return; const mode = sickContactMethod.value; const isVisit = mode === "visit"; sickVisitBlock.style.display = isVisit ? "block" : "none"; sickContactBlock.style.display = isVisit ? "none" : "block"; if (isVisit) { if (sickContactPhone) sickContactPhone.value = ""; syncVisitTimeHidden(sickVisitTimeFromHour, sickVisitTimeFromMinute, sickVisitTimeFromPeriod, sickVisitTimeFrom); syncVisitTimeHidden(sickVisitTimeToHour, sickVisitTimeToMinute, sickVisitTimeToPeriod, sickVisitTimeTo); } else { if (sickVisitDateFrom) sickVisitDateFrom.value = ""; if (sickVisitDateTo) sickVisitDateTo.value = ""; if (sickVisitTimeFrom) sickVisitTimeFrom.value = ""; if (sickVisitTimeTo) sickVisitTimeTo.value = ""; if (sickVisitTimeFromHour) sickVisitTimeFromHour.value = ""; if (sickVisitTimeFromMinute) sickVisitTimeFromMinute.value = ""; if (sickVisitTimeFromPeriod) sickVisitTimeFromPeriod.value = ""; if (sickVisitTimeToHour) sickVisitTimeToHour.value = ""; if (sickVisitTimeToMinute) sickVisitTimeToMinute.value = ""; if (sickVisitTimeToPeriod) sickVisitTimeToPeriod.value = ""; } } function updateSickPlaceVisibility() { if (!sickPlace || !sickHospitalFields || !sickHomeFields) return; const place = sickPlace.value === "home" ? "home" : "hospital"; const isHome = place === "home"; sickHospitalFields.style.display = isHome ? "none" : "block"; sickHomeFields.style.display = isHome ? "block" : "none"; if (isHome) { if (sickHospitalName) sickHospitalName.value = ""; if (sickHospitalDept) sickHospitalDept.value = ""; } else { if (sickHomeCity) sickHomeCity.value = ""; if (sickHomeArea) sickHomeArea.value = ""; } } function buildVisitTimeValue(hourEl, minuteEl, periodEl) { const hourRaw = String(hourEl && hourEl.value != null ? hourEl.value : "").trim(); const minuteRaw = String(minuteEl && minuteEl.value != null ? minuteEl.value : "").trim(); const periodRaw = String(periodEl && periodEl.value != null ? periodEl.value : "").trim().toLowerCase(); if (!hourRaw || !minuteRaw || !periodRaw) return ""; const hour12 = parseInt(hourRaw, 10); const minute = parseInt(minuteRaw, 10); if (!Number.isFinite(hour12) || hour12< 1 || hour12 >12) return ""; if (!Number.isFinite(minute) || minute< 0 || minute >59) return ""; if (periodRaw !== "am" && periodRaw !== "pm") return ""; let hour24 = hour12 % 12; if (periodRaw === "pm") hour24 += 12; return String(hour24).padStart(2, "0") + ":" + String(minute).padStart(2, "0"); } function syncVisitTimeHidden(hourEl, minuteEl, periodEl, hiddenEl) { if (!hiddenEl) return; hiddenEl.value = buildVisitTimeValue(hourEl, minuteEl, periodEl); } function setVisitTimeSelectorsFromValue(hourEl, minuteEl, periodEl, timeValue) { const s = String(timeValue || "").trim(); if (!hourEl || !minuteEl || !periodEl) return; if (!s) { hourEl.value = ""; minuteEl.value = ""; periodEl.value = ""; return; } const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s); if (!m) return; const hour24 = parseInt(m[1], 10); const minute = parseInt(m[2], 10); if (!Number.isFinite(hour24) || hour24< 0 || hour24 >23) return; if (!Number.isFinite(minute) || minute< 0 || minute >59) return; const period = hour24 >= 12 ? "pm" : "am"; const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12; hourEl.value = String(hour12); minuteEl.value = String(minute).padStart(2, "0"); periodEl.value = period; } function buildVisitMeta(event) { const contactMethodValue = event.contactMethod || event.contact_method || ""; const contactPhoneValue = event.contactPhone || event.contact_phone || ""; const visitDateFromValue = event.visitDateFromLabel || event.visit_date_from || ""; const visitDateToValue = event.visitDateToLabel || event.visit_date_to || ""; const visitTimeFromValue = event.visitTimeFrom || event.visit_time_from || ""; const visitTimeToValue = event.visitTimeTo || event.visit_time_to || ""; if (contactMethodValue === "visit") { const dateFrom = visitDateFromValue || ""; const dateTo = visitDateToValue || ""; const timeFrom = visitTimeFromValue || ""; const timeTo = visitTimeToValue || ""; const visitParts = []; if (dateFrom || dateTo) { const fromLabel = dateFrom ? formatDateISO(dateFrom) : ""; const toLabel = dateTo ? formatDateISO(dateTo) : ""; if (fromLabel && toLabel) visitParts.push("من " + wrapLTRText(fromLabel) + " إلى " + wrapLTRText(toLabel)); else if (fromLabel) visitParts.push("من " + wrapLTRText(fromLabel)); else if (toLabel) visitParts.push("إلى " + wrapLTRText(toLabel)); } if (timeFrom || timeTo) { const fromLabel = timeFrom ? formatTime12Ar(timeFrom) : ""; const toLabel = timeTo ? formatTime12Ar(timeTo) : ""; if (fromLabel && toLabel) visitParts.push("من " + fromLabel + " إلى " + toLabel); else if (fromLabel) visitParts.push("من " + fromLabel); else visitParts.push("إلى " + toLabel); } return visitParts.length ? ("الزيارة: " + visitParts.join(" – ")) : ""; } if (contactMethodValue === "call") { return contactPhoneValue ? ("التواصل: اتصال – الجوال: " + contactPhoneValue) : "التواصل: اتصال"; } if (contactMethodValue === "whatsapp") { return contactPhoneValue ? ("التواصل: واتساب – الجوال: " + contactPhoneValue) : "التواصل: واتساب"; } return ""; } function isDelegateIncomingEventRequest(row) {
  const kind = String(row && row.kind ? row.kind : "").trim();
  const msg = String(row && row.message ? row.message : "");
  // البطاقة / special_card — الإدارة المركزية فقط
  if (kind === "special_card") return false;
  if (
    kind === "event_card" ||
    kind === "family_event" ||
    kind === "event_request" ||
    kind === "tree_card" ||
    kind === "tree_edit" ||
    kind === "memory_card" ||
    kind === "add_person" ||
    kind === "memory"
  ) {
    return true;
  }
  if (kind === "tree_delegate" || kind === "events_delegate" || kind === "delegate_secret_reset") {
    return false;
  }
  if (/اطلب بطاقة|طلب بطاقة|بطاقة خاصة/.test(msg) && !/أضف فرد|إضافة فرد|صحح بيانات|ذكرى/.test(msg)) {
    return false;
  }
  return /مناسبة|مولود|زواج|خطوبة|تخرج|ترقية|اجتماع|خبر|وفاة|مريض|عملية|أضف فرد|إضافة فرد|فردًا للعائلة|صحح بيانات|تصحيح|ذكرى/.test(
    msg
  );
}

let delegateBranchRequestsCache = [];
let delegateBranchRequestsFilter = "all";
let delegateBranchRequestsStatusFilter = "all";
let delegateBranchRequestsSearch = "";
let delegateSessionTodayStats = { dayKey: "", approved: 0, rejected: 0 };

function getDelegateIncomingEventRequestsRoot() {
  return document.getElementById("delegate-event-requests-root");
}

function toArabicDigitsDisplay(v) {
  return String(v == null ? "" : v).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);
}

function delegateLocalDayKey(d) {
  const n = d instanceof Date ? d : new Date();
  return (
    String(n.getFullYear()) +
    "-" +
    String(n.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(n.getDate()).padStart(2, "0")
  );
}

function isSameLocalCalendarDay(iso, now) {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const ref = now instanceof Date ? now : new Date();
  return (
    d.getFullYear() === ref.getFullYear() &&
    d.getMonth() === ref.getMonth() &&
    d.getDate() === ref.getDate()
  );
}

function ensureDelegateSessionTodayStats() {
  const key = delegateLocalDayKey(new Date());
  if (delegateSessionTodayStats.dayKey !== key) {
    delegateSessionTodayStats = { dayKey: key, approved: 0, rejected: 0 };
  }
  return delegateSessionTodayStats;
}

function bumpDelegateSessionTodayStat(kind) {
  const stats = ensureDelegateSessionTodayStats();
  if (kind === "approved") stats.approved += 1;
  if (kind === "rejected") stats.rejected += 1;
}

function formatRelativeTimeAr(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return "الآن";
  if (mins < 60) {
    return "منذ " + toArabicDigitsDisplay(mins) + (mins === 1 ? " دقيقة" : " دقيقة");
  }
  const hours = Math.round(mins / 60);
  if (hours < 24) {
    if (hours === 1) return "منذ ساعة";
    if (hours === 2) return "منذ ساعتين";
    if (hours >= 3 && hours <= 10) return "منذ " + toArabicDigitsDisplay(hours) + " ساعات";
    return "منذ " + toArabicDigitsDisplay(hours) + " ساعة";
  }
  const days = Math.round(hours / 24);
  if (days === 1) return "منذ يوم";
  if (days === 2) return "منذ يومين";
  if (days >= 3 && days <= 10) return "منذ " + toArabicDigitsDisplay(days) + " أيام";
  return "منذ " + toArabicDigitsDisplay(days) + " يومًا";
}

function formatTodayLabelAr() {
  try {
    return new Date().toLocaleDateString("ar-SA", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  } catch (e) {
    return "";
  }
}

function computeDelegateSummaryCounts(rows) {
  const now = new Date();
  const stats = ensureDelegateSessionTodayStats();
  let pending = 0;
  let approvedToday = 0;
  let rejected = 0;
  (Array.isArray(rows) ? rows : []).forEach((req) => {
    const st = normalizeRequestStatusKey(req && req.status);
    if (st === "pending") {
      pending += 1;
      return;
    }
    const ts = (req && (req.updated_at || req.created_at)) || "";
    if (st === "approved" && isSameLocalCalendarDay(ts, now)) approvedToday += 1;
    if (st === "rejected") {
      if (isSameLocalCalendarDay(ts, now) || !ts) rejected += 1;
    }
  });
  approvedToday = Math.max(approvedToday, stats.approved || 0);
  rejected = Math.max(rejected, stats.rejected || 0);
  return { pending, approvedToday, rejected };
}

function paintDelegateWelcomeAndSummary(branchKey, rows) {
  const key = normalizePersonName(branchKey || state.branch || "");
  const session = loadDelegateSession();
  const personName = String((session && session.name) || "").replace(/\s+/g, " ").trim();
  if (branchTitle) {
    if (personName) {
      branchTitle.textContent = "مرحبًا، " + personName;
    } else {
      branchTitle.textContent = key ? ("مرحبًا، مندوب " + key) : "مرحبًا، مندوب —";
    }
  }
  const counts = computeDelegateSummaryCounts(rows);
  const sub = document.getElementById("delegate-welcome-sub");
  if (sub) {
    const todayLabel = formatTodayLabelAr();
    const parts = [];
    if (key) parts.push("مندوب فرع: " + key);
    if (todayLabel) parts.push(todayLabel);
    if (counts.pending > 0) {
      parts.push(
        toArabicDigitsDisplay(counts.pending) +
          (counts.pending === 1 ? " طلب بانتظار الإجراء" : " طلبات بانتظار الإجراء")
      );
    } else {
      parts.push("لا طلبات بانتظار الإجراء الآن");
    }
    sub.textContent = parts.join(" · ");
  }
  const summaryCard = document.getElementById("delegate-summary-card");
  if (summaryCard) {
    summaryCard.hidden = false;
    const pendingEl = summaryCard.querySelector('[data-summary="pending"]');
    const approvedEl = summaryCard.querySelector('[data-summary="approved-today"]');
    const rejectedEl = summaryCard.querySelector('[data-summary="rejected"]');
    if (pendingEl) pendingEl.textContent = toArabicDigitsDisplay(counts.pending);
    if (approvedEl) approvedEl.textContent = toArabicDigitsDisplay(counts.approvedToday);
    if (rejectedEl) rejectedEl.textContent = toArabicDigitsDisplay(counts.rejected);
  }
}

async function refreshDelegateProfileName(branchKey) {
  const session = loadDelegateSession();
  if (!session) return "";
  if (session.name) {
    paintDelegateWelcomeAndSummary(branchKey || session.branch, delegateBranchRequestsCache);
    return session.name;
  }
  const sb = getالخدمةClient();
  const branch = normalizePersonName(branchKey || session.branch || "");
  const phone = normalizePhone(session.phone || "");
  const secretHash = String(session.secretHash || "").trim();
  if (!sb || !branch || !phone || !secretHash) return "";
  try {
    // delegates_v2 is RLS-blocked for anon SELECT — use security-definer find RPC.
    const { data, error } = await sb.rpc("delegates_v2_find_v1", {
      p_branch_key: branch,
      p_phone: phone,
      p_email: session.email || "",
      p_secret_hash: secretHash,
    });
    if (error) return "";
    const row = data && typeof data === "object" ? data : null;
    const name = String((row && row.name) || "").replace(/\s+/g, " ").trim();
    if (name) {
      saveDelegateSession(session.branch, session.phone, session.email, session.secretHash, name);
      paintDelegateWelcomeAndSummary(branch, delegateBranchRequestsCache);
    }
    return name;
  } catch (_) {
    return "";
  }
}

function setDelegateBranchBadge(branchKey) {
  const el = document.getElementById("delegate-branch-badge");
  if (!el) return;
  const key = normalizePersonName(branchKey || state.branch || "");
  el.textContent = key
    ? ("أنت مندوب فرع: " + key + " · فرعك فقط · الهوية: الجوال المسجّل")
    : "أنت مندوب فرع: —";
  paintDelegateWelcomeAndSummary(key, delegateBranchRequestsCache);
}

async function refreshDelegateLastActivity(branchKey) {
  const el = document.getElementById("delegate-last-activity");
  if (!el) return;
  const branch = normalizePersonName(branchKey || state.branch || "");
  const sb = getالخدمةClient();
  if (!branch || !sb) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  try {
    const { data, error } = await sb
      .from("family_events")
      .select("id,type,person,details,created_at,event_date")
      .eq("branch_key", branch)
      .order("created_at", { ascending: false })
      .limit(30);
    if (error || !Array.isArray(data) || !data.length) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    const Events = window.AlzidanEvents || {};
    let latest = null;
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const env = typeof parseEventEnvelope === "function" ? parseEventEnvelope(row) : null;
      if (env && env.kind === "event_tombstone") continue;
      latest = row;
      break;
    }
    if (!latest) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    const typeRaw = String(latest.type || "").trim();
    const typeLabel =
      typeof Events.eventTypeArabicLabel === "function" && typeof Events.normalizeEventType === "function"
        ? Events.eventTypeArabicLabel(Events.normalizeEventType(typeRaw))
        : typeRaw || "مناسبة";
    const person = String(latest.person || "").trim();
    const title = person ? typeLabel + " — " + person : typeLabel;
    const when = formatRelativeTimeAr(latest.created_at || latest.event_date);
    let handledBy = "";
    try {
      const det = String(latest.details || "");
      const m =
        /تمت مراجعة الطلب بواسطة المندوب:\s*([^\n\r."]+)/.exec(det) ||
        /"reviewed_by"\s*:\s*"([^"]+)"/.exec(det);
      if (m && m[1]) handledBy = String(m[1]).replace(/\s+/g, " ").trim();
    } catch (_) {}
    el.hidden = false;
    el.innerHTML =
      "آخر ما نُشر: <strong>" +
      escapeHtml(title) +
      "</strong>" +
      (when ? " — " + escapeHtml(when) : "") +
      (handledBy ? " — بواسطة " + escapeHtml(handledBy) : "");
  } catch (e) {
    el.hidden = true;
    el.textContent = "";
  }
}

function ensureDelegateIncomingEventRequestsCard() {
  let card = document.getElementById("delegate-event-requests-card");
  const mountRoot = getDelegateIncomingEventRequestsRoot();

  if (card) {
    if (mountRoot && card.parentNode !== mountRoot) {
      mountRoot.appendChild(card);
    }
    return card;
  }

  if (!mountRoot && !eventsCard) return null;

  card = document.createElement("section");
  card.id = "delegate-event-requests-card";
  card.className = "delegate-branch-requests";
  card.innerHTML =
    '<div class="dw-sec-head">' +
    '<span class="dw-sec-ico" aria-hidden="true">' +
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h5"/></svg>' +
    "</span>" +
    '<div class="dw-sec-copy">' +
    '<div class="section-title">طلبات فرعي</div>' +
    '<div class="hint">صف مختصر — وسّع للتفاصيل والإجراء. الطلبات مرتبطة بجوالك وفرعك.</div>' +
    "</div></div>" +
    '<div class="dw-filter-label">النوع</div>' +
    '<div class="dw-filter-row" id="delegate-req-filters" role="toolbar" aria-label="تصفية النوع">' +
    '<button type="button" class="dw-filter-chip is-active" data-filter="all">الكل <span class="dw-count" data-count="all">0</span></button>' +
    '<button type="button" class="dw-filter-chip" data-filter="tree">إضافة فرد <span class="dw-count" data-count="tree">0</span></button>' +
    '<button type="button" class="dw-filter-chip" data-filter="correction">تصحيح <span class="dw-count" data-count="correction">0</span></button>' +
    '<button type="button" class="dw-filter-chip" data-filter="memory">ذكرى <span class="dw-count" data-count="memory">0</span></button>' +
    '<button type="button" class="dw-filter-chip" data-filter="event">مناسبة <span class="dw-count" data-count="event">0</span></button>' +
    '<button type="button" class="dw-filter-chip" data-filter="health">حالة صحية <span class="dw-count" data-count="health">0</span></button>' +
    '<button type="button" class="dw-filter-chip" data-filter="death">وفاة <span class="dw-count" data-count="death">0</span></button>' +
    "</div>" +
    '<div class="dw-filter-label">الحالة</div>' +
    '<div class="dw-filter-row" id="delegate-req-status-filters" role="toolbar" aria-label="تصفية الحالة">' +
    '<button type="button" class="dw-filter-chip dw-filter-chip--status is-active" data-status-filter="all">كل الطلبات <span class="dw-count" data-status-count="all">0</span></button>' +
    '<button type="button" class="dw-filter-chip dw-filter-chip--status" data-status-filter="pending">بانتظار الإجراء <span class="dw-count" data-status-count="pending">0</span></button>' +
    '<button type="button" class="dw-filter-chip dw-filter-chip--status" data-status-filter="approved">تم القبول <span class="dw-count" data-status-count="approved">0</span></button>' +
    '<button type="button" class="dw-filter-chip dw-filter-chip--status" data-status-filter="rejected">تم الرفض <span class="dw-count" data-status-count="rejected">0</span></button>' +
    "</div>" +
    '<div class="dw-req-toolbar">' +
    '<div class="dw-req-search field">' +
    '<label for="delegate-req-search" class="visually-hidden" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);">بحث</label>' +
    '<input id="delegate-req-search" type="search" placeholder="بحث بالاسم أو رقم الطلب أو الجوال" autocomplete="off" dir="rtl" />' +
    "</div>" +
    '<button id="delegate-event-requests-refresh" class="btn btn-secondary btn-small" type="button">تحديث</button>' +
    "</div>" +
    '<div id="delegate-event-requests-alert" class="alert" style="display:none;"></div>' +
    '<div id="delegate-event-requests-list" class="dw-req-list"></div>' +
    '<div class="dw-scope-hint">يقبل المندوب طلبات فرعه: إضافة فرد · تصحيح · ذكرى · مناسبات · صحة · وفيات. طلب البطاقة للإدارة المركزية فقط.</div>' +
    '<div id="delegate-tree-admin-note" class="dw-admin-note" style="display:none;">طلب «البطاقة» يُراجع من الإدارة المركزية — ليس ضمن صلاحية قبول المندوب.</div>';

  if (mountRoot) {
    mountRoot.appendChild(card);
  } else if (eventsCard) {
    eventsCard.appendChild(card);
  }

  const refresh = card.querySelector("#delegate-event-requests-refresh");
  if (refresh) refresh.addEventListener("click", () => loadDelegateIncomingEventRequests(state.branch));

  const filters = card.querySelector("#delegate-req-filters");
  if (filters && !filters.dataset.bound) {
    filters.dataset.bound = "1";
    filters.addEventListener("click", (e) => {
      const btn = e.target && e.target.closest ? e.target.closest("[data-filter]") : null;
      if (!btn) return;
      delegateBranchRequestsFilter = String(btn.getAttribute("data-filter") || "all");
      filters.querySelectorAll(".dw-filter-chip").forEach((el) => {
        el.classList.toggle("is-active", el.getAttribute("data-filter") === delegateBranchRequestsFilter);
      });
      paintDelegateBranchRequestsList();
    });
  }

  const statusFilters = card.querySelector("#delegate-req-status-filters");
  if (statusFilters && !statusFilters.dataset.bound) {
    statusFilters.dataset.bound = "1";
    statusFilters.addEventListener("click", (e) => {
      const btn = e.target && e.target.closest ? e.target.closest("[data-status-filter]") : null;
      if (!btn) return;
      delegateBranchRequestsStatusFilter = String(btn.getAttribute("data-status-filter") || "all");
      statusFilters.querySelectorAll(".dw-filter-chip").forEach((el) => {
        el.classList.toggle(
          "is-active",
          el.getAttribute("data-status-filter") === delegateBranchRequestsStatusFilter
        );
      });
      paintDelegateBranchRequestsList();
    });
  }

  const searchInput = card.querySelector("#delegate-req-search");
  if (searchInput && !searchInput.dataset.bound) {
    searchInput.dataset.bound = "1";
    searchInput.addEventListener("input", () => {
      delegateBranchRequestsSearch = String(searchInput.value || "");
      paintDelegateBranchRequestsList();
    });
  }

  return card;
}

async function rpcSetDelegateApprovalRequestStatus(sb, branchKey, requestId, status) {
  const auth = await getDelegateRpcAuth();
  if (!auth.ok) return { ok: false, error: { message: auth.reason || "no_session" } };
  const branch = normalizePersonName(branchKey || auth.branch || state.branch || "");
  const reqId = Number(requestId);
  const st = String(status || "").trim();
  if (!branch || !Number.isFinite(reqId)) {
    return { ok: false, error: { message: "missing params" } };
  }

  const withAuth = await sb.rpc("delegate_set_approval_request_status_v1", {
    p_branch_key: branch,
    p_request_id: reqId,
    p_status: st,
    p_phone: auth.phone,
    p_email: auth.email,
    p_secret_hash: auth.secretHash,
  });
  if (!withAuth.error) {
    return { ok: withAuth.data === true, data: withAuth.data, error: withAuth.data === false ? { message: "not allowed" } : null };
  }
  if (!isRpcMissingError(withAuth.error)) {
    return { ok: false, error: withAuth.error };
  }

  const legacy = await sb.rpc("delegate_set_approval_request_status_v1", {
    p_branch_key: branch,
    p_request_id: reqId,
    p_status: st,
  });
  if (legacy.error) return { ok: false, error: legacy.error };
  return { ok: legacy.data === true, data: legacy.data, error: legacy.data === false ? { message: "not allowed" } : null };
}

const Core = window.AlzidanAdminCore || {};
const escapeHtml =
  typeof Core.escapeHtml === "function"
    ? Core.escapeHtml
    : function (value) {
        return String(value == null ? "" : value)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");
      };

function parseDelegateRequestMessageTitle(row) {
  const Safe = window.AlzidanSafeRequestNotify || null;
  let msg = String(row && row.message ? row.message : "");
  const jsonIdx = msg.indexOf("__JSON__");
  if (jsonIdx >= 0) msg = msg.slice(0, jsonIdx);
  if (Safe && typeof Safe.safeUiDetailText === "function") {
    // Keep structured Arabic lines for title extraction; drop banned blobs.
    const scrubbed = Safe.safeUiDetailText(msg);
    if (scrubbed) msg = scrubbed.replace(/\s*·\s*/g, "\n");
  }
  const lines = msg.split(/\n/g).map((x) => String(x || "").trim()).filter(Boolean);
  const nameLine = lines.find((x) => /^اسم الشخص:|^الاسم:|^اسم المناسبة:|^الشخص:/.test(x));
  const typeLine = lines.find((x) => /^نوع المناسبة:|^النوع:/.test(x));
  const dateLine = lines.find((x) => /^تاريخ المناسبة:|^التاريخ:/.test(x));
  return {
    title: (typeLine ? typeLine.replace(/^نوع المناسبة:\s*|^النوع:\s*/, "") + " — " : "") +
      (nameLine ? nameLine.replace(/^اسم الشخص:\s*|^الاسم:\s*|^اسم المناسبة:\s*|^الشخص:\s*/, "") : (row && row.name ? row.name : "طلب مناسبة")),
    date: dateLine ? dateLine.replace(/^تاريخ المناسبة:\s*|^التاريخ:\s*/, "") : ""
  };
}

function extractTreeCardJsonFromMessage(msg) {
  const raw = String(msg || "");
  const marker = raw.indexOf("__JSON__:");
  if (marker < 0) return null;
  const jsonText = raw.slice(marker + "__JSON__:".length).trim();
  if (!jsonText) return null;
  try {
    const parsed = JSON.parse(jsonText);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (e) {
    return null;
  }
}

function classifyDelegateBranchRequest(req) {
  const Events = window.AlzidanEvents || {};
  const kind = String(req && req.kind ? req.kind : "").trim();
  const msg = String(req && req.message ? req.message : "");

  // البطاقة — إدارة مركزية فقط
  if (
    kind === "special_card" ||
    (/اطلب بطاقة|طلب بطاقة|بطاقة خاصة/.test(msg) &&
      !/أضف فرد|إضافة فرد|tree_card/.test(kind + msg))
  ) {
    return { intent: "card", intentLabel: "طلب بطاقة", canAct: false };
  }

  if (
    kind === "tree_card" ||
    kind === "add_person" ||
    /أضف فرد|إضافة فرد|فردًا للعائلة/.test(msg)
  ) {
    return { intent: "tree", intentLabel: "إضافة فرد", canAct: true };
  }

  if (
    kind === "tree_edit" ||
    /صحح بيانات|طلب: صحح|تصحيح بيانات/.test(msg)
  ) {
    return { intent: "correction", intentLabel: "تصحيح", canAct: true };
  }

  if (kind === "memory_card" || kind === "memory" || /شارك ذكرى|طلب ذكرى|^ذكرى/.test(msg)) {
    return { intent: "memory", intentLabel: "ذكرى", canAct: true };
  }

  const cardMsg = typeof Events.parseEventCardMessage === "function" ? Events.parseEventCardMessage(msg) : {};
  const typeRaw = cardMsg.type || "";
  const type =
    typeof Events.normalizeEventType === "function" ? Events.normalizeEventType(typeRaw) : String(typeRaw || "").trim().toLowerCase();
  const category =
    typeof Events.eventCategoryFromType === "function" ? Events.eventCategoryFromType(type) : "";
  if (type === "death" || category === "death" || /إعلان وفاة|^وفاة|عزاء/.test(msg)) {
    return { intent: "death", intentLabel: "إعلان وفاة", canAct: true, parsed: cardMsg, type };
  }
  if (
    type === "sick" ||
    type === "operation" ||
    type === "discharge" ||
    category === "sick" ||
    /حالة صحية|مريض|عملية|خروج من المستشفى/.test(msg)
  ) {
    return { intent: "health", intentLabel: "حالة صحية", canAct: true, parsed: cardMsg, type };
  }
  return { intent: "event", intentLabel: "مناسبة", canAct: true, parsed: cardMsg, type };
}

async function applyDelegateTreeCardRequest(sb, req) {
  const payload = extractTreeCardJsonFromMessage(req && req.message);
  if (!payload) {
    return { ok: false, message: "تعذر قراءة بيانات إضافة الفرد من الطلب." };
  }
  const branch = normalizePersonName(payload.branch_key || (req && req.branch_key) || state.branch || "");
  const personName = normalizePersonName(payload.name || "");
  const fatherPath = normalizePersonName(
    payload.father_path ||
      payload.parent_path ||
      payload.parent_node_id ||
      payload.father_node_id ||
      ""
  );
  const fatherLeaf = normalizePersonName(payload.father || "");
  const parentFull = fatherPath || fatherLeaf;
  if (!branch || !personName || !parentFull) {
    return { ok: false, message: "بيانات الأب أو الاسم ناقصة — أكمل من أدوات الشجرة أو ارفض الطلب." };
  }
  const childFull = parentFull.indexOf("/") >= 0 || parentFull === personName
    ? (parentFull.endsWith("/" + personName) ? parentFull : parentFull + "/" + personName)
    : parentFull + "/" + personName;
  const insertRes = await rpcInsertTreeChildRow(sb, {
    branch_key: branch,
    parent_name: parentFull,
    parent: parentFull,
    child_name: childFull,
    name: childFull,
    parent_person_id: normalizePersonName(
      payload.father_person_id || payload.parent_person_id || ""
    ),
    gender: payload.gender || "",
    birth_date_g: payload.birth_date_g || "",
    city: payload.city || "",
    area: payload.area || "",
  });
  if (!insertRes || !insertRes.ok) {
    return {
      ok: false,
      message:
        "تعذر إضافة الفرد للشجرة: " +
        ((insertRes && insertRes.error && insertRes.error.message) ||
          (insertRes && insertRes.error && insertRes.error.detail) ||
          "تحقق من صلاحية الشجرة أو اكتمال بيانات الأب."),
    };
  }
  return { ok: true };
}

function statusLabelAr(status, requestRow) {
  const Vis = window.AlzidanEventVisibility || null;
  if (requestRow && Vis && typeof Vis.deriveReviewerRequestStatus === "function") {
    const derived = Vis.deriveReviewerRequestStatus(requestRow, null);
    if (derived && derived.label) return derived.label;
  }
  const s = String(status || "pending").trim().toLowerCase();
  if (s === "approved") return "تم القبول";
  if (s === "rejected") return "تم الرفض";
  return "بانتظار الإجراء";
}


function extractReviewedByFromRequest(req) {
  if (!req) return "";
  const direct = String(req.reviewed_by || req.reviewer_name || "").replace(/\s+/g, " ").trim();
  if (direct && direct !== "مندوب الفرع" && !/^أحد المراجعين/.test(direct)) return direct;
  const msg = String(req.message || "");
  let m = /تمت مراجعة الطلب بواسطة المندوب:\s*([^\n\r.]+)/.exec(msg);
  if (m && m[1]) return String(m[1]).replace(/\s+/g, " ").trim();
  m = /تمت مراجعة الطلب بواسطة\s*([^\n\r.]+)/.exec(msg);
  if (m && m[1]) {
    const who = String(m[1]).replace(/\s+/g, " ").trim();
    if (who && who !== "مندوب الفرع" && !/^أحد المراجعين/.test(who)) return who;
  }
  return direct || "";
}

function normalizeRequestStatusKey(status) {
  const s = String(status || "pending").trim().toLowerCase();
  if (s === "approved" || s === "accepted") return "approved";
  if (s === "rejected" || s === "declined") return "rejected";
  return "pending";
}

function reviewerStatusChipKey(requestRow) {
  const Vis = window.AlzidanEventVisibility || null;
  const base = normalizeRequestStatusKey(requestRow && requestRow.status);
  if (base !== "approved") return base;
  if (Vis && typeof Vis.deriveReviewerRequestStatus === "function") {
    const derived = Vis.deriveReviewerRequestStatus(requestRow, null);
    const k = String((derived && derived.key) || "").toLowerCase();
    if (k === "scheduled" || k === "visible" || k === "ended") return k;
  }
  return "approved";
}

function normalizeDelegateListPayload(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.requests)) return data.requests;
  if (data && Array.isArray(data.rows)) return data.rows;
  if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data);
      return normalizeDelegateListPayload(parsed);
    } catch (_) {
      return [];
    }
  }
  return [];
}

function toAsciiDigitsLocal(v) {
  return String(v == null ? "" : v)
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 1776));
}

function normalizeDelegateRequestSearch(v) {
  return toAsciiDigitsLocal(v).replace(/\s+/g, " ").trim().toLowerCase();
}

function delegateRequestMatchesSearch(req, query) {
  const q = normalizeDelegateRequestSearch(query);
  if (!q) return true;
  const classified = classifyDelegateBranchRequest(req);
  const cardMsg = classified.parsed || {};
  const hay = [
    req && req.name,
    req && req.request_id,
    req && req.id,
    req && req.phone,
    cardMsg.person,
    cardMsg.submitterPhone,
    cardMsg.submitterName,
    classified.intentLabel,
  ]
    .map((x) => normalizeDelegateRequestSearch(x))
    .filter(Boolean)
    .join(" ");
  return hay.indexOf(q) !== -1;
}

function updateDelegateRequestFilterCounts(rows) {
  const card = document.getElementById("delegate-event-requests-card");
  if (!card) return;
  const counts = { all: 0, tree: 0, correction: 0, memory: 0, event: 0, health: 0, death: 0, card: 0 };
  const statusCounts = { all: 0, pending: 0, approved: 0, rejected: 0 };
  (Array.isArray(rows) ? rows : []).forEach((req) => {
    const c = classifyDelegateBranchRequest(req);
    counts.all += 1;
    if (counts[c.intent] != null) counts[c.intent] += 1;
    const st = normalizeRequestStatusKey(req && req.status);
    statusCounts.all += 1;
    if (statusCounts[st] != null) statusCounts[st] += 1;
  });
  Object.keys(counts).forEach((key) => {
    const el = card.querySelector('[data-count="' + key + '"]');
    if (el) el.textContent = toArabicDigitsDisplay(counts[key]);
  });
  Object.keys(statusCounts).forEach((key) => {
    const el = card.querySelector('[data-status-count="' + key + '"]');
    if (el) el.textContent = toArabicDigitsDisplay(statusCounts[key]);
  });
  paintDelegateWelcomeAndSummary(state.branch, rows);
  const note = card.querySelector("#delegate-tree-admin-note");
  if (note) {
    // Show only when browsing card-like empty states or when card filter is active.
    const showCardNote = delegateBranchRequestsFilter === "card";
    note.style.display = showCardNote ? "block" : "none";
    note.textContent =
      "طلب «البطاقة» للإدارة المركزية فقط — لا يظهر ولا يُقبل من مساحة المندوب.";
  }
}

function paintDelegateBranchRequestsList() {
  const card = ensureDelegateIncomingEventRequestsCard();
  if (!card) return;
  const list = card.querySelector("#delegate-event-requests-list");
  if (!list) return;
  const Events = window.AlzidanEvents || {};
  const all = Array.isArray(delegateBranchRequestsCache) ? delegateBranchRequestsCache : [];
  updateDelegateRequestFilterCounts(all);
  const filtered = all.filter((req) => {
    if (delegateBranchRequestsFilter !== "all") {
      if (classifyDelegateBranchRequest(req).intent !== delegateBranchRequestsFilter) return false;
    }
    if (delegateBranchRequestsStatusFilter !== "all") {
      if (normalizeRequestStatusKey(req && req.status) !== delegateBranchRequestsStatusFilter) return false;
    }
    if (!delegateRequestMatchesSearch(req, delegateBranchRequestsSearch)) return false;
    return true;
  });

  if (!filtered.length) {
    const emptyByFilter = {
      all: "لا توجد طلبات لفرعك الآن.",
      tree: "لا توجد طلبات إضافة فرد.",
      correction: "لا توجد طلبات تصحيح.",
      memory: "لا توجد طلبات ذكرى.",
      event: "لا توجد طلبات مناسبة.",
      health: "لا توجد طلبات حالة صحية.",
      death: "لا توجد طلبات وفاة.",
      card: "طلبات البطاقة لا تُعرض هنا — للإدارة المركزية فقط.",
    };
    let emptyMsg = emptyByFilter[delegateBranchRequestsFilter] || emptyByFilter.all;
    if (normalizeDelegateRequestSearch(delegateBranchRequestsSearch)) {
      emptyMsg = "لا نتائج مطابقة للبحث الحالي.";
    } else if (delegateBranchRequestsStatusFilter === "pending") {
      emptyMsg = "لا توجد طلبات بانتظار المراجعة ضمن التصفية الحالية.";
    } else if (delegateBranchRequestsStatusFilter === "approved") {
      emptyMsg = "لا توجد طلبات مقبولة ضمن التصفية الحالية.";
    } else if (delegateBranchRequestsStatusFilter === "rejected") {
      emptyMsg = "لا توجد طلبات مرفوضة ضمن التصفية الحالية.";
    }
    list.innerHTML = '<div class="dw-empty">' + escapeHtml(emptyMsg) + "</div>";
    return;
  }

  list.innerHTML = "";
  filtered.forEach((req) => {
    const classified = classifyDelegateBranchRequest(req);
    const cardMsg = classified.parsed || {};
    const parsed = {
      details: cardMsg.detailsText || cardMsg.text || "",
      type: cardMsg.type || classified.type || "",
      person: cardMsg.person || "",
      dateLabel: cardMsg.dateLabel || "",
      eventDate: cardMsg.eventDate || "",
      imageUrl: cardMsg.imageUrl || "",
      videoUrl: cardMsg.videoUrl || "",
      submitterName: cardMsg.submitterName || "",
      submitterPhone: cardMsg.submitterPhone || "",
      submitterEmail: cardMsg.submitterEmail || "",
    };
    const typeLabel =
      typeof Events.eventTypeArabicLabel === "function" && typeof Events.normalizeEventType === "function" && parsed.type
        ? Events.eventTypeArabicLabel(Events.normalizeEventType(parsed.type))
        : classified.intentLabel;
    const displayName = req.name || parsed.person || "طلب";
    const branchKey = normalizePersonName(req.branch_key || state.branch || "");
    const dateStr = req.created_at ? new Date(req.created_at).toLocaleDateString("ar-SA") : "";
    const statusKey = normalizeRequestStatusKey(req.status);
    const chipKey = reviewerStatusChipKey(req);
    const statusText = statusLabelAr(req.status, req);
    const VisUi = window.AlzidanEventVisibility || null;
    const rejectReason =
      statusKey === "rejected" && VisUi && typeof VisUi.extractRejectReasonForUi === "function"
        ? VisUi.extractRejectReasonForUi(req)
        : "";
    const item = document.createElement("details");
    item.className = "dw-req-row";
    item.setAttribute("data-intent", classified.intent || "event");
    item.setAttribute("data-lifecycle-status", statusKey);
    item.setAttribute("data-visibility", chipKey);
    if (req.request_id) item.setAttribute("data-request-id", String(req.request_id));
    if (req.id != null) item.setAttribute("data-request-row-id", String(req.id));
    item.innerHTML =
      '<summary class="dw-req-summary">' +
      '<div class="dw-req-main">' +
      '<span class="dw-req-type" data-intent="' +
      escapeHtml(classified.intent) +
      '">' +
      escapeHtml(classified.intentLabel) +
      "</span>" +
      '<span class="dw-req-name">' +
      escapeHtml(displayName) +
      "</span>" +
      '<div class="dw-req-meta">' +
      (branchKey ? "<span>الفرع: " + escapeHtml(branchKey) + "</span>" : "") +
      (dateStr ? "<span>" + escapeHtml(dateStr) + "</span>" : "") +
      (typeLabel && classified.intent === "event" ? "<span>" + escapeHtml(typeLabel) + "</span>" : "") +
      "</div></div>" +
      '<span class="dw-req-status" data-status="' +
      escapeHtml(chipKey) +
      '" title="' +
      escapeHtml(statusText) +
      '">' +
      escapeHtml(statusText) +
      "</span></summary>" +
      '<div class="dw-req-body">' +
      '<div class="dw-req-facts">' +
      (parsed.person ? "<div>الاسم: <strong>" + escapeHtml(parsed.person) + "</strong></div>" : "") +
      (typeLabel ? "<div>التفصيل: <strong>" + escapeHtml(typeLabel) + "</strong></div>" : "") +
      (parsed.dateLabel ? "<div>التاريخ: " + escapeHtml(parsed.dateLabel) + "</div>" : "") +
      (statusKey === "approved" && (req.show_at || req.event_date || req.published)
        ? "<div class=\"dw-req-vis\">" +
          escapeHtml(statusText) +
          (req.published === true || req.event_id
            ? " · محفوظة في المناسبات"
            : "") +
          "</div>"
        : "") +
      (rejectReason
        ? "<div class=\"dw-req-reject-reason\">سبب الرفض: " + escapeHtml(rejectReason) + "</div>"
        : "") +
      (function () {
        const Safe = window.AlzidanSafeRequestNotify || null;
        const detailRaw = parsed.details || "";
        const detailSafe =
          Safe && typeof Safe.safeUiDetailText === "function"
            ? Safe.safeUiDetailText(detailRaw)
            : /__JSON__|[{}\[\]]|events_audit/i.test(detailRaw)
              ? ""
              : String(detailRaw || "").trim().slice(0, 280);
        return detailSafe ? "<div>" + escapeHtml(detailSafe) + "</div>" : "";
      })() +
      (parsed.submitterName || parsed.submitterPhone || req.phone
        ? "<div>المرسل: " +
          escapeHtml(parsed.submitterName || "") +
          (parsed.submitterPhone || req.phone
            ? " · " + escapeHtml(parsed.submitterPhone || req.phone)
            : "") +
          "</div>"
        : "") +
      (function () {
        const who = extractReviewedByFromRequest(req);
        if (!who || statusKey === "pending") return "";
        return "<div>الإجراء: " + escapeHtml(who) + " · " + escapeHtml(statusText) + "</div>";
      })() +
      (req.request_id
        ? '<div class="hint">مرجع: ' + escapeHtml(String(req.request_id)) + "</div>"
        : "") +
      "</div>" +
      (function () {
        const EventsMedia = window.AlzidanEvents || {};
        // Hard gate only — never emit <video> unless resolveValidVideoUrl/isValidVideoUrl passes.
        // Soft "!(fn) || fn(url)" previously failed open when the media module was missing/cached-old.
        if (typeof EventsMedia.buildRequestMediaPreviewHtml === "function") {
          return EventsMedia.buildRequestMediaPreviewHtml(
            { imageUrl: parsed.imageUrl, videoUrl: parsed.videoUrl },
            escapeHtml,
          );
        }
        const safeImage =
          typeof EventsMedia.resolveValidImageUrl === "function"
            ? EventsMedia.resolveValidImageUrl(parsed.imageUrl)
            : typeof EventsMedia.isValidImageUrl === "function" &&
                EventsMedia.isValidImageUrl(parsed.imageUrl)
              ? String(parsed.imageUrl || "").trim()
              : "";
        const safeVideo =
          typeof EventsMedia.resolveValidVideoUrl === "function"
            ? EventsMedia.resolveValidVideoUrl(parsed.videoUrl)
            : typeof EventsMedia.isValidVideoUrl === "function" &&
                EventsMedia.isValidVideoUrl(parsed.videoUrl)
              ? String(parsed.videoUrl || "").trim()
              : "";
        return (
          (safeImage
            ? '<div style="margin-top:8px;"><img src="' +
              escapeHtml(safeImage) +
              '" alt="" style="max-width:100%;border-radius:12px;" loading="lazy" /></div>'
            : "") +
          (safeVideo
            ? '<div style="margin-top:8px;"><video src="' +
              escapeHtml(safeVideo) +
              '" controls preload="metadata" style="max-width:100%;border-radius:12px;"></video></div>'
            : "")
        );
      })() +
      '<div class="req-inline-alert" style="margin-top:6px;"></div>' +
      (classified.canAct && statusKey === "pending"
        ? '<div class="dw-req-actions">' +
          '<button class="btn btn-primary btn-small btn-pub-req" type="button">' +
          (classified.intent === "event"
            ? "قبول (مع جدولة الظهور)"
            : classified.intent === "health" || classified.intent === "death"
              ? "قبول وحفظ"
              : "قبول") +
          "</button>" +
          '<button class="btn btn-outline btn-small btn-rej-req" type="button" style="border-color:#dc2626;color:#dc2626;">رفض</button>' +
          "</div>"
        : classified.canAct
          ? '<div class="hint" style="margin-top:8px;">لا إجراء — الطلب ' + escapeHtml(statusText) + '.</div>'
          : '<div class="dw-admin-note">طلب البطاقة يُراجع من الإدارة المركزية — لا إجراء قبول/رفض هنا.</div>') +
      "</div>";

    if (classified.canAct && statusKey === "pending") {
      const inlineAlert = item.querySelector(".req-inline-alert");
      const pubBtn = item.querySelector(".btn-pub-req");
      const rejBtn = item.querySelector(".btn-rej-req");
      function lock(on) {
        if (pubBtn) pubBtn.disabled = on;
        if (rejBtn) rejBtn.disabled = on;
      }
      async function notifySubmitterOnly(sbClient, decisionStatus) {
        try {
          const Safe = window.AlzidanSafeRequestNotify || null;
          const phone =
            String(req.phone || "").trim() ||
            String((parsed && parsed.submitterPhone) || "").trim() ||
            null;
          const email =
            String(req.email || "").trim() ||
            String((parsed && parsed.submitterEmail) || "").trim() ||
            null;
          const base = {
            request_id: req.request_id || null,
            kind: req.kind || "",
            branch_key: req.branch_key || state.branch || "",
            status: decisionStatus,
            email: email,
            phone: phone,
            name: req.name || (parsed && parsed.person) || null,
            person: (parsed && parsed.person) || req.name || null,
          };
          const rec =
            Safe && typeof Safe.scrubRecordForNotify === "function"
              ? Safe.scrubRecordForNotify(base)
              : base;
          if (Safe && typeof Safe.safeRenderOutbound === "function") {
            const preview = Safe.safeRenderOutbound({
              mode: "status_changed",
              kind: rec.kind,
              status: rec.status,
              branch_key: rec.branch_key,
              person: rec.person || rec.name,
              audience: "submitter",
            });
            if (!preview) {
              console.warn("[delegate] status notify blocked by safe renderer", rec.kind);
              return;
            }
          }
          if (!rec.phone && !rec.email) {
            console.warn("[delegate] status notify skipped — no submitter phone/email");
            return;
          }
          // Never notify the logged-in reviewing delegate as if they were submitter.
          if (rec.email) {
            await sbClient.functions.invoke("alzidan-email-notify", {
              body: { mode: "status_changed", record: rec },
            });
          }
          if (rec.phone) {
            await sbClient.functions.invoke("alzidan-push-notify", {
              body: { mode: "status_changed", record: rec },
            });
          }
        } catch (e) {
          try {
            console.warn("[delegate] submitter notify soft-fail", e);
          } catch (_) {}
        }
      }
      if (pubBtn) {
        pubBtn.addEventListener("click", async () => {
          lock(true);
          const sb = getالخدمةClient();
          if (!sb) {
            showAlert(inlineAlert, "error", "الربط غير مُعد.");
            lock(false);
            return;
          }

          const isEventIntent =
            classified.intent === "event" ||
            classified.intent === "health" ||
            classified.intent === "death";

          let scheduledOnly = false;
          if (isEventIntent) {
            const Vis = window.AlzidanEventVisibility || null;
            let row =
              typeof Events.buildFamilyEventRow === "function"
                ? Events.buildFamilyEventRow({ source: "approval_request", row: req })
                : null;
            if (!row) {
              showAlert(inlineAlert, "error", "وحدة المناسبات غير محمّلة.");
              lock(false);
              return;
            }
            // Past/invalid dated happy events cannot be approved as upcoming.
            if (classified.intent === "event" && Vis) {
              const dateCheck =
                typeof Vis.validateEventDateForSubmit === "function"
                  ? Vis.validateEventDateForSubmit(row.event_date || row.date_label || parsed.dateLabel)
                  : null;
              if (dateCheck && dateCheck.ok === false) {
                showAlert(
                  inlineAlert,
                  "error",
                  dateCheck.message ||
                    "تاريخ المناسبة منتهٍ أو غير صالح — لا يمكن قبوله كمحتوى قادم."
                );
                lock(false);
                return;
              }
            }
            // Approve ≠ immediate public show: default 3 days before event_date.
            if (Vis && typeof Vis.buildScheduleFields === "function") {
              const sch = Vis.buildScheduleFields({
                event_date: row.event_date || parsed.eventDate || "",
                show_before_days:
                  row.show_before_days != null
                    ? row.show_before_days
                    : row.showBeforeDays != null
                      ? row.showBeforeDays
                      : 3,
                show_at: row.show_at || row.showAt || "",
                end_at: row.end_at || row.endAt || "",
                manual_hidden: row.manual_hidden || row.manualHidden || false,
              });
              if (sch.show_before_days != null) row.show_before_days = sch.show_before_days;
              if (sch.show_at) row.show_at = sch.show_at;
              if (sch.end_at) row.end_at = sch.end_at;
              row.manual_hidden = !!sch.manual_hidden;
              if (typeof Vis.mergeScheduleIntoDetails === "function") {
                const merged = Vis.mergeScheduleIntoDetails(row.details, sch);
                row.details =
                  typeof merged === "string" ? merged : JSON.stringify(merged);
              }
            } else if (row.show_before_days == null && row.show_at == null) {
              row.show_before_days = 3;
            }
            if (classified.intent === "event") {
              const life =
                Vis && typeof Vis.deriveEventLifecycleState === "function"
                  ? Vis.deriveEventLifecycleState(row)
                  : null;
              scheduledOnly = life === "scheduled";
            }
            const insertResult = await rpcInsertFamilyEventRow(sb, row);
            if (!insertResult || !insertResult.ok) {
              const err = insertResult && insertResult.error ? insertResult.error : null;
              const raw = (err && (err.arabic || err.message)) || "";
              const Safe = window.AlzidanSafeRequestNotify;
              const U = window.AlzidanUserFacingRequestMessages;
              const errMsg =
                (U && typeof U.mapTechnicalErrorToArabic === "function"
                  ? U.mapTechnicalErrorToArabic(raw, "تعذر حفظ المناسبة حالياً.")
                  : null) ||
                (Safe && Safe.looksBanned && Safe.looksBanned(raw)
                  ? "تعذر حفظ المناسبة حالياً."
                  : raw) ||
                "تعذر حفظ المناسبة حالياً.";
              showAlert(inlineAlert, "error", errMsg);
              lock(false);
              return;
            }
            // Family broadcast deferred until AFTER submitter status push
            // (broadcast to all tokens can disable a stale token before acceptance notify).
          } else if (classified.intent === "tree") {
            const applyRes = await applyDelegateTreeCardRequest(sb, req);
            if (!applyRes || !applyRes.ok) {
              showAlert(
                inlineAlert,
                "error",
                (applyRes && applyRes.message) || "تعذر تطبيق إضافة الفرد على الشجرة."
              );
              lock(false);
              return;
            }
          }

          const statusResult = await rpcSetDelegateApprovalRequestStatus(
            sb,
            req.branch_key,
            req.id,
            "approved"
          );
          if (!statusResult.ok || statusResult.error) {
            const raw =
              (statusResult.error && statusResult.error.message) || "";
            const U = window.AlzidanUserFacingRequestMessages;
            const safe =
              (U && typeof U.mapTechnicalErrorToArabic === "function"
                ? U.mapTechnicalErrorToArabic(raw, "تعذر قبول الطلب.")
                : null) || "تعذر قبول الطلب. تحقق من الصلاحية أو طبّق SQL توسيع طلبات المندوب.";
            showAlert(inlineAlert, "error", safe);
            lock(false);
            return;
          }
          bumpDelegateSessionTodayStat("approved");
          // Submitter OS push first (reject path only does this — must match on accept).
          await notifySubmitterOnly(sb, "approved");

          if (isEventIntent && !scheduledOnly) {
            try {
              let eventRow =
                typeof Events.buildFamilyEventRow === "function"
                  ? Events.buildFamilyEventRow({ source: "approval_request", row: req })
                  : null;
              if (eventRow) {
                await sb.functions.invoke("alzidan-push-notify", {
                  body: {
                    type: eventRow.type || "",
                    person: eventRow.person || "",
                    branch_key: eventRow.branch_key || state.branch || "",
                    details: eventRow.details || "",
                  },
                });
              }
            } catch (familyPushErr) {
              try {
                console.warn("[delegate] family push soft-fail", familyPushErr);
              } catch (_) {}
            }
          }

          const successMsg =
            isEventIntent
              ? scheduledOnly
                ? "تمت الموافقة. المناسبة مجدولة للظهور وفق تاريخها (لا تظهر للعامة فوراً)."
                : classified.intent === "event"
                  ? "تمت الموافقة. ستظهر للعامة وفق نافذة الجدولة المعتمدة."
                  : "تمت الموافقة وحُفظت الحالة لفرعك."
              : classified.intent === "tree"
                ? "تم قبول الطلب وإضافة الفرد لشجرة فرعك."
                : classified.intent === "correction"
                  ? "تم قبول طلب التصحيح — طبّق التعديل من أدوات الشجرة إن لزم."
                  : "تم قبول الطلب لفرعك.";
          showAlert(inlineAlert, "success", successMsg);
          // Keep history: reload full list (pending+approved+rejected) — do not remove the card.
          setTimeout(() => loadDelegateIncomingEventRequests(state.branch).catch(() => {}), 400);
          if (
            window.DelegateEventsMgmtBridge &&
            typeof window.DelegateEventsMgmtBridge.refresh === "function"
          ) {
            window.DelegateEventsMgmtBridge.refresh().catch(function () {});
          }
          refreshDelegateLastActivity(state.branch).catch(function () {});
        });
      }
      if (rejBtn) {
        rejBtn.addEventListener("click", async () => {
          lock(true);
          const sb = getالخدمةClient();
          if (!sb) {
            showAlert(inlineAlert, "error", "الربط غير مُعد.");
            lock(false);
            return;
          }
          const statusResult = await rpcSetDelegateApprovalRequestStatus(
            sb,
            req.branch_key,
            req.id,
            "rejected"
          );
          if (!statusResult.ok || statusResult.error) {
            const U = window.AlzidanUserFacingRequestMessages;
            const raw =
              (statusResult.error && statusResult.error.message) || "";
            showAlert(
              inlineAlert,
              "error",
              (U && typeof U.mapTechnicalErrorToArabic === "function"
                ? U.mapTechnicalErrorToArabic(raw, "تعذر رفض الطلب.")
                : null) || "تعذر رفض الطلب."
            );
            lock(false);
            return;
          }
          bumpDelegateSessionTodayStat("rejected");
          await notifySubmitterOnly(sb, "rejected");
          showAlert(inlineAlert, "success", "تم رفض الطلب.");
          setTimeout(() => loadDelegateIncomingEventRequests(state.branch).catch(() => {}), 400);
        });
      }
    }
    list.appendChild(item);
  });
  focusDelegateRequestFromUrl(list);
}

function focusDelegateRequestFromUrl(listEl) {
  const rid = String(desiredRequestIdFromUrl || "").trim();
  if (!rid || !listEl) return;
  const safe = rid.replace(/"/g, "");
  const target =
    listEl.querySelector('[data-request-id="' + safe + '"]') ||
    listEl.querySelector('[data-request-row-id="' + safe + '"]');
  if (!target) return;
  try {
    target.open = true;
    target.classList.add("is-focus-request");
    if (typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  } catch (_) {}
  // One-shot: keep URL shareable but do not re-hijack later filter paints.
  desiredRequestIdFromUrl = "";
}

function renderDelegateIncomingEventRequests(data) {
  const card = ensureDelegateIncomingEventRequestsCard();
  if (!card) return;
  const alertEl = card.querySelector("#delegate-event-requests-alert");
  if (alertEl) alertEl.style.display = "none";
  delegateBranchRequestsCache = normalizeDelegateListPayload(data).filter(
    isDelegateIncomingEventRequest
  );
  paintDelegateBranchRequestsList();
}

async function loadDelegateIncomingEventRequests(branchKey) {
  const card = ensureDelegateIncomingEventRequestsCard();
  if (!card) return;

  const alertEl = card.querySelector("#delegate-event-requests-alert");
  const list = card.querySelector("#delegate-event-requests-list");
  const branch = normalizePersonName(branchKey || state.branch || "");

  if (!branch) return;

  if (list) list.innerHTML = '<div class="dw-empty">جاري تحميل طلبات فرعك...</div>';

  const sb = getالخدمةClient();
  if (!sb) {
    if (list) list.innerHTML = "";
    showAlert(alertEl, "error", "تعذر تحميل الطلبات لأن الربط غير مُعد.");
    return;
  }

  const auth = await getDelegateRpcAuth();
  if (!auth.ok) {
    if (list) list.innerHTML = "";
    (function(){ var reason = String(auth.reason || "بيانات المندوب غير متاحة."); var U = window.AlzidanUserFacingRequestMessages; var safe = (U && typeof U.mapTechnicalErrorToArabic === "function") ? U.mapTechnicalErrorToArabic(reason, "تعذر تحميل الطلبات. بيانات المندوب غير متاحة.") : (/[A-Za-z]{4,}/.test(reason) ? "تعذر تحميل الطلبات. بيانات المندوب غير متاحة." : ("تعذر تحميل الطلبات: " + reason)); showAlert(alertEl, "error", safe); })();
    return;
  }

  const { data, error } = await sb.rpc("delegate_list_event_requests_v1", {
    p_branch_key: branch,
    p_phone: auth.phone,
    p_email: auth.email,
    p_secret_hash: auth.secretHash
  });

  if (error) {
    if (list) list.innerHTML = "";
    (function(){ var U = window.AlzidanUserFacingRequestMessages; var safe = (U && typeof U.mapTechnicalErrorToArabic === "function") ? U.mapTechnicalErrorToArabic(error, "تعذر تحميل طلبات الفرع حالياً.") : "تعذر تحميل طلبات الفرع حالياً."; showAlert(alertEl, "error", safe); })();
    return;
  }

  renderDelegateIncomingEventRequests(data || []);
}

function reloadDelegateIncomingEventRequests() {
  return loadDelegateIncomingEventRequests(state.branch);
}

function paintDelegateEmailStatus(email) {
  const statusEl = document.getElementById("delegate-email-status");
  const inputEl = document.getElementById("delegate-workspace-email");
  const em = normalizeEmail(email);
  if (inputEl && !inputEl.matches(":focus") && isLikelyEmail(em)) {
    inputEl.value = em;
  }
  if (!statusEl) return;
  if (isLikelyEmail(em)) {
    statusEl.className = "delegate-email-status is-set";
    statusEl.textContent = "بريد الإشعارات: " + em;
  } else {
    statusEl.className = "delegate-email-status is-missing";
    statusEl.textContent = "لم يُسجّل بريد — لن يصلك إشعار طلبات الفرع";
  }
}

function showDelegateEmailAlert(type, text) {
  const el = document.getElementById("delegate-email-alert");
  if (!el) return;
  el.className = "alert " + (type === "success" ? "alert-success" : "alert-error");
  el.textContent = text || "";
  el.style.display = text ? "block" : "none";
}

async function rpcUpdateDelegateEmail(sb, email) {
  const auth = await getDelegateRpcAuth();
  if (!auth.ok) return { ok: false, reason: auth.reason || "no_session" };
  const em = normalizeEmail(email);
  if (!isLikelyEmail(em)) return { ok: false, reason: "bad_email" };
  const { data, error } = await sb.rpc("delegates_v2_update_email_v1", {
    p_branch_key: auth.branch,
    p_phone: auth.phone,
    p_secret_hash: auth.secretHash,
    p_email: em,
  });
  if (error) {
    const msg = String(error.message || "");
    if (/delegates_v2_update_email_v1|could not find|function/i.test(msg)) {
      return { ok: false, reason: "rpc_missing", error };
    }
    return { ok: false, reason: "error", error };
  }
  const row = data && typeof data === "object" ? data : null;
  if (row && row.ok === true) {
    return { ok: true, email: normalizeEmail(row.email || em), data: row };
  }
  return { ok: false, reason: (row && row.reason) || "denied", data: row };
}

function bindDelegateProfileEmailCard() {
  const card = document.getElementById("delegate-profile-card");
  const saveBtn = document.getElementById("delegate-save-email-btn");
  const inputEl = document.getElementById("delegate-workspace-email");
  if (!card || !saveBtn || saveBtn.dataset.bound === "1") return;
  saveBtn.dataset.bound = "1";
  saveBtn.addEventListener("click", async () => {
    const sb = getالخدمةClient();
    if (!sb) {
      showDelegateEmailAlert("error", "تعذر الحفظ لأن الربط غير مُعد.");
      return;
    }
    const email = normalizeEmail(inputEl ? inputEl.value : "");
    if (inputEl) inputEl.value = email;
    if (!isLikelyEmail(email)) {
      showDelegateEmailAlert("error", "أدخل بريدًا إلكترونيًا صالحًا للإشعارات.");
      return;
    }
    saveBtn.disabled = true;
    showDelegateEmailAlert("success", "جاري الحفظ...");
    try {
      const res = await rpcUpdateDelegateEmail(sb, email);
      if (res.ok) {
        const auth = loadDelegateSession();
        if (auth) saveDelegateSession(auth.branch, auth.phone, res.email || email, auth.secretHash);
        paintDelegateEmailStatus(res.email || email);
        showDelegateEmailAlert("success", "تم حفظ بريد الإشعارات. ستصلك إشعارات طلبات فرعك على هذا العنوان.");
        return;
      }
      if (res.reason === "rpc_missing") {
        showDelegateEmailAlert(
          "error",
          "حفظ البريد غير مفعّل في قاعدة البيانات بعد. أبلغ الإدارة بتشغيل أمر «تحديث بريد المندوب من مساحة العمل»."
        );
        return;
      }
      if (res.reason === "bad_email") {
        showDelegateEmailAlert("error", "أدخل بريدًا إلكترونيًا صالحًا للإشعارات.");
        return;
      }
      if (res.reason === "disabled") {
        showDelegateEmailAlert("error", "حساب المندوب معطّل. تواصل مع الإدارة.");
        return;
      }
      if (res.reason === "not_found" || res.reason === "no_session") {
        showDelegateEmailAlert("error", "تعذر التحقق من جلسة المندوب. سجّل الدخول مرة أخرى ثم أعد المحاولة.");
        return;
      }
      const detail = res.error && res.error.message ? String(res.error.message) : "";
      showDelegateEmailAlert("error", "تعذر حفظ البريد حاليًا." + (detail ? " (" + detail + ")" : ""));
    } finally {
      saveBtn.disabled = false;
    }
  });
}

function mountDelegateTreeTool(branchKey) {
  const root = document.getElementById("delegate-tree-view-root");
  if (!root) return;
  const key = normalizePersonName(branchKey || state.branch || "");
  root.innerHTML = "";
  const hint = document.createElement("div");
  hint.className = "hint";
  hint.style.marginBottom = "8px";
  hint.textContent = "عرض مختصر لآباء الفرع — للتعديل افتح «إدارة الشجرة».";
  root.appendChild(hint);
  const list = document.createElement("div");
  list.className = "children-list";
  const parents = key && Object.prototype.hasOwnProperty.call(parentsByBranch, key) ? parentsByBranch[key] || [] : [];
  if (!key) {
    list.innerHTML = '<div class="dw-empty">لا يوجد فرع محدد.</div>';
  } else if (!parents.length) {
    list.innerHTML = '<div class="dw-empty">لا توجد قائمة آباء ثابتة لهذا الفرع.</div>';
  } else {
    parents.forEach((parentName) => {
      const row = document.createElement("div");
      row.className = "parent-row";
      const name = document.createElement("span");
      name.className = "parent-name";
      name.textContent = String(parentName || "");
      row.appendChild(name);
      list.appendChild(row);
    });
  }
  root.appendChild(list);
}

function mountDelegateProfileEmailCard() {
  bindDelegateProfileEmailCard();
  const session = loadDelegateSession();
  paintDelegateEmailStatus(session && session.email ? session.email : "");
  showDelegateEmailAlert("", "");
}

function startBranch(branchKey) { if (!branchKey || !Object.prototype.hasOwnProperty.call(parentsByBranch, branchKey)) { setLoginAlert("error", "يرجى اختيار الفرع بشكل صحيح."); return false; } applyView("delegate"); hideLoginAlert(); state.branch = branchKey; ensureDelegateSessionTodayStats(); setDelegateBranchBadge(branchKey); paintDelegateWelcomeAndSummary(branchKey, delegateBranchRequestsCache); refreshDelegateProfileName(branchKey).catch(function () {}); mountDelegateProfileEmailCard(); ensureDelegateIncomingEventRequestsCard(); mountDelegateTreeTool(branchKey); loadDelegateIncomingEventRequests(branchKey).catch(() =>{}); refreshDelegateLastActivity(branchKey).catch(() =>{}); loginCard.style.display = "none"; dashboardCard.style.display = "block"; if (eventsCard) eventsCard.style.display = ""; if (memoryCard) memoryCard.style.display = ""; loadChildrenForBranchDelegate(branchKey, { applyToState: true }) .then(() => {
      mountDelegateFamilyManagement(desiredParentFromUrl || "");
    }) .catch(() =>{}); mountDelegateEventsManagement(); mountDelegateMemorySubmit(); return true; } async function pushDelegateRequestToالخدمة(payload, msg, secretHash) { const sb = getالخدمةClient(); if (!sb) return { ok: false, reason: "not_configured" }; const statusesToBlock = ["pending", "approved"]; const branchKey = payload.branch; const phone = String(payload.phone || "").trim(); const email = String(payload.email || "").trim(); const pickNewer = (a, b) =>{ if (!a) return b || null; if (!b) return a || null; const at = String(a.created_at || ""); const bt = String(b.created_at || ""); return bt >at ? b : a; }; const matches = { phone: null, email: null }; try { const { data, error } = await sb.rpc("tree_delegate_find_conflict_v1", { p_phone: phone || null, p_email: email || null }); if (error) return { ok: false, reason: "conflict_check_unavailable", error }; const row = Array.isArray(data) ? data[0] : data; if (row) { const status = String(row.status || "").trim(); const conflict = { status, branch_key: String(row.branch_key || "").trim(), request_id: String(row.request_id || "").trim(), created_at: row.created_at || "", secret_hash: String(row.secret_hash || "").trim() }; if (statusesToBlock.includes(status)) { matches.phone = conflict; matches.email = conflict; } } } catch (error) { return { ok: false, reason: "conflict_check_unavailable", error }; } const pendingFields = []; const approvedFields = []; let pendingMatch = null; let approvedMatch = null; if (matches.phone?.status === "pending") { pendingFields.push("phone"); pendingMatch = pickNewer(pendingMatch, matches.phone); } if (matches.email?.status === "pending") { pendingFields.push("email"); pendingMatch = pickNewer(pendingMatch, matches.email); } if (matches.phone?.status === "approved") { approvedFields.push("phone"); approvedMatch = pickNewer(approvedMatch, matches.phone); } if (matches.email?.status === "approved") { approvedFields.push("email"); approvedMatch = pickNewer(approvedMatch, matches.email); } if (pendingMatch) return { ok: false, reason: "duplicate_pending", fields: pendingFields, existing: pendingMatch, matches }; if (approvedMatch) return { ok: false, reason: "duplicate_approved", fields: approvedFields, existing: approvedMatch, matches }; const row = { request_id: payload.requestId, kind: "tree_delegate", branch_key: payload.branch, phone: payload.phone, email: payload.email, secret_hash: secretHash || null, message: msg, status: "pending", created_at: payload.createdAt }; const { error } = await sb.from("approval_requests").insert(row); if (error) return { ok: false, reason: "error", error }; return { ok: true }; }
function buildSecretResetRequestMessage(payload) {
  const lines = [];
  lines.push("طلب إعادة تعيين الرقم السري للمندوب");
  lines.push("رقم الطلب: " + payload.requestId);
  lines.push("الفرع: " + (payload.branch || ""));
  lines.push("الجوال: " + (payload.phone || ""));
  if (payload.email) lines.push("البريد: " + payload.email);
  lines.push("الرقم السري المقترح: " + (payload.secret || ""));
  lines.push("بانتظار الإدارة");
  lines.push("التاريخ: " + new Date(payload.createdAt).toLocaleString("ar-SA"));
  lines.push("__JSON__:" + JSON.stringify({
    v: 1,
    kind: "delegate_secret_reset",
    intent: "secret_reset",
    at: payload.createdAt
  }));
  return lines.join("\n");
}

async function requestDelegateSecretReset(branchKey, phone, email, secret) {
  phone = normalizePhone(phone);
  email = normalizeEmail(email);
  secret = normalizeDelegateSecret(secret);
  const sb = getالخدمةClient();
  if (!sb) {
    setLoginAlert("error", "تعذر إرسال الطلب لأن الربط غير مُعد.");
    return false;
  }
  const secretHash = await sha256Hex(secret);
  if (!secretHash) {
    setLoginAlert("error", "تعذر تجهيز الرقم السري. استخدم متصفحًا حديثًا.");
    return false;
  }
  const requestId = "SRS-" + Math.random().toString(36).slice(2, 6).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
  const createdAt = new Date().toISOString();
  const payload = { requestId, branch: branchKey, phone, email, secret, createdAt };
  const message = buildSecretResetRequestMessage(payload);

  const { data, error } = await sb.rpc("delegate_secret_reset_submit_v1", {
    p_branch_key: branchKey,
    p_phone: phone,
    p_email: email || null,
    p_secret_hash: secretHash,
    p_request_id: requestId,
    p_message: message,
    p_name: null
  });

  if (error) {
    const msg = String(error.message || "");
    if (/could not find|schema cache|PGRST202|does not exist/i.test(msg)) {
      setLoginAlert(
        "error",
        "ميزة إعادة التعيين غير مفعّلة بعد. من لوحة الإدارة → أدوات الصيانة → أوامر الصيانة الجاهزة → «طلب إعادة تعيين الرقم السري»."
      );
      return false;
    }
    setLoginAlert("error", "تعذر إرسال طلب إعادة تعيين الرقم السري حاليًا.");
    return false;
  }

  const row = data && typeof data === "object" ? data : null;
  if (!row || row.ok === false) {
    if (row && row.reason === "duplicate_pending") {
      setLoginAlert(
        "success",
        "طلب إعادة التعيين قيد المراجعة بالفعل" + (row.request_id ? " (رقم الطلب: " + row.request_id + ")" : "") + "."
      );
      return false;
    }
    if (row && row.reason === "not_a_delegate") {
      setLoginAlert(
        "error",
        "لا يوجد اعتماد مندوب لهذه البيانات. اطلب صلاحية مندوب أولًا، أو تأكد من الفرع والجوال."
      );
      return false;
    }
    setLoginAlert("error", "تعذر إرسال طلب إعادة التعيين.");
    return false;
  }

  try {
    await sb.functions.invoke("alzidan-email-notify", {
      body: {
        mode: "new_request",
        record: {
          request_id: row.request_id || requestId,
          kind: "delegate_secret_reset",
          branch_key: branchKey,
          phone,
          email: email || null,
          message,
          status: "pending"
        }
      }
    });
  } catch (notifyError) {}

  setLoginAlert(
    "success",
    "تم إرسال طلب إعادة تعيين الرقم السري للإدارة (رقم الطلب: " +
      (row.request_id || requestId) +
      "). بعد الاعتماد استخدم الرقم السري الذي كتبته هنا."
  );
  return true;
}

async function requestDelegateAccess(branchKey, phone, email, secret, opts) { const options = opts || {}; phone = normalizePhone(phone); email = normalizeEmail(email); secret = normalizeDelegateSecret(secret); const payload = { requestId: makeRequestId(), status: "pending", branch: branchKey, phone, email, secret, createdAt: new Date().toISOString() }; const msg = buildDelegateRequestMessage(payload); const secretHash = await sha256Hex(secret); const pushed = await pushDelegateRequestToالخدمة(payload, msg, secretHash); if (pushed.ok) { setLoginAlert("success", "تم إرسال طلبك بنجاح، وهو الآن قيد المراجعة."); return true; } if (pushed.reason === "conflict_check_unavailable") { setLoginAlert( "error", "التحقق من الطلبات السابقة غير متاح مؤقتًا. لم يتم إنشاء طلب جديد، حاول مرة أخرى لاحقًا." ); return false; } if (pushed.reason === "duplicate_pending") { const id = pushed.existing?.request_id || ""; const existingBranch = String(pushed.existing?.branch_key || "").trim(); const prefix = duplicateFieldsText(pushed.fields); setLoginAlert( "success", existingBranch && existingBranch !== branchKey ? id ? `${prefix}. يوجد طلب قيد المراجعة بالفعل لفرع (${existingBranch}) (رقم الطلب: ${id}).` : `${prefix}. يوجد طلب قيد المراجعة بالفعل لفرع (${existingBranch}).` : id ? `${prefix}. طلبك قيد المراجعة بالفعل (رقم الطلب: ${id}).` : `${prefix}. طلبك قيد المراجعة بالفعل.` ); return false; } if (pushed.reason === "duplicate_approved") { const existingBranch = String(pushed.existing?.branch_key || "").trim(); if (options.forceNew === true) { if ( secretHash && (!pushed.existing?.secret_hash || pushed.existing.secret_hash !== secretHash) && existingBranch && existingBranch === branchKey ) { const sb = getالخدمةClient(); if (!sb) { setLoginAlert("error", "تعذر إرسال طلب الدخول لأن الربط غير مُعد."); return false; } const existingId = pushed.existing?.request_id; if (!existingId) { setLoginAlert("error", "تعذر تحديث الطلب لأن رقم الطلب السابق غير متوفر."); return false; } const row = { secret_hash: secretHash || null, message: msg, status: "pending", created_at: payload.createdAt }; const { error } = await sb.from("approval_requests").update(row).eq("request_id", existingId); if (!error) { setLoginAlert("success", `تم إرسال طلب تغيير الرقم السري للمراجعة (رقم الطلب: ${existingId}). سيظهر الطلب لدى الإدارة.`); return true; } } } const id = pushed.existing?.request_id || ""; const prefix = duplicateFieldsText(pushed.fields); setLoginAlert( "error", existingBranch && existingBranch !== branchKey ? id ? `${prefix}. أنت مسجل/معتمد مسبقًا كمندوب لفرع (${existingBranch}) (رقم الطلب: ${id}). لا يمكن التسجيل بهذه البيانات لفرع آخر.` : `${prefix}. أنت مسجل/معتمد مسبقًا كمندوب لفرع (${existingBranch}). لا يمكن التسجيل بهذه البيانات لفرع آخر.` : id ? `${prefix}. تم اعتمادك مسبقًا (رقم الطلب: ${id}). جرّب الدخول بنفس البيانات، أو استخدم (نسيت الرقم السري) لإرسال طلب جديد برقم سري مختلف.` : `${prefix}. تم اعتمادك مسبقًا. جرّب الدخول بنفس البيانات، أو استخدم (نسيت الرقم السري) لإرسال طلب جديد برقم سري مختلف.` ); return false; } if (pushed.reason === "not_configured") { setLoginAlert("error", "تعذر إرسال طلب الدخول لأن الربط غير مُعد."); return false; } const raw = pushed.error || {}; const errMsg = String(raw.message || ""); if (String(raw.code || "") === "23505" || errMsg.toLowerCase().includes("duplicate")) { setLoginAlert("error", "البيانات مسجلة مسبقًا. تأكد من المعلومات وأعد التسجيل."); return false; } setLoginAlert("error", "تعذر إرسال طلب الدخول حاليًا."); return false; } async function tryالخدمةDelegateLogin(branchKey, phone, email, secret) { phone = normalizePhone(phone); email = normalizeEmail(email); secret = normalizeDelegateSecret(secret); const sb = getالخدمةClient(); if (!sb) return { ok: false, reason: "not_configured" }; const secretHash = await sha256Hex(secret); if (!secretHash) return { ok: false, reason: "hash_failed" }; const candidates = phoneCandidates(phone); const phonesToTry = candidates.length ? candidates : [phone]; let data = null; let error = null; let matchedPhone = phone; for (let i = 0; i < phonesToTry.length; i++) { const tryPhone = phonesToTry[i]; const res = await sb.rpc("check_tree_delegate_access", { p_branch_key: branchKey, p_phone: tryPhone, p_email: email, p_secret_hash: secretHash }); if (res.error) { error = res.error; continue; } if (res.data && (res.data.allowed === true || res.data.status || res.data.reason)) { data = res.data; matchedPhone = tryPhone; error = null; if (res.data.allowed === true) break; if (res.data.status === "pending" || res.data.status === "rejected" || res.data.status === "disabled" || res.data.reason === "disabled") break; } } if (!data && error) { const msg = String(error.message || ""); if (msg.toLowerCase().includes("check_tree_delegate_access")) { return { ok: false, reason: "rpc_missing", error }; } return { ok: false, reason: "error", error }; } phone = matchedPhone; if (error) { const msg = String(error.message || ""); if (msg.toLowerCase().includes("check_tree_delegate_access")) { return { ok: false, reason: "rpc_missing", error }; } return { ok: false, reason: "error", error }; } if (!data) return { ok: false, reason: "not_found" }; if (data.allowed === true) { const requestId = String(data.request_id || data.delegate_id || "").trim() || ("v2-" + String(branchKey || "").trim()); const storedEmail = normalizeEmail(data.email || email || ""); const storedPhone = normalizePhone(data.phone || phone || ""); return { ok: true, status: "approved", requestId, secretHash, email: storedEmail, phone: storedPhone, source: data.source || "", roleKey: data.role_key || "" }; } if (data.status === "pending") return { ok: false, reason: "pending", requestId: data.request_id || "" }; if (data.status === "rejected") return { ok: false, reason: "rejected", requestId: data.request_id || "" }; if (data.status === "disabled" || data.reason === "disabled") return { ok: false, reason: "disabled", requestId: data.request_id || "" }; if (data.status === "no_permission" || data.reason === "no_permission") return { ok: false, reason: "no_permission", roleKey: data.role_key || "", requestId: data.request_id || "" }; if (data.status === "approved") return { ok: false, reason: "wrong_secret", requestId: data.request_id || "" }; return { ok: false, reason: "not_found" }; }

if (emailInput) {
  emailInput.value = "";
  const emailWrap = emailInput.closest(".field") || emailInput.parentElement;
  if (emailWrap) emailWrap.style.display = "none";
}

function ensureDelegateAccessRequestUi() {
  if (document.querySelector("[data-delegate-access-request]")) return;
  // Prefer the static HTML apply card (required email visible) — avoid a second duplicate form.
  if (delegateRequestCard || requestDelegateBtn) return;

  const host = loginCard || document.body;
  const box = document.createElement("div");
  box.setAttribute("data-delegate-access-request", "");
  box.style.marginTop = "14px";
  box.innerHTML = `
    <button type="button" class="btn btn-secondary" data-open-delegate-access-request style="width:100%;margin-top:8px">
      طلب صلاحية مندوب
    </button>
    <form data-delegate-access-request-form style="display:none;margin-top:14px;text-align:right">
      <div class="grid">
        <div class="field">
          <label>الاسم الرباعي</label>
          <input name="fullName" type="text" placeholder="الاسم الرباعي" required>
        </div>
        <div class="field">
          <label>رقم الجوال</label>
          <div class="phone-intl" data-phone-intl="fallback-request">
            <select name="phoneCountry" data-phone-country aria-label="الدولة"></select>
            <input name="phone" data-phone-national type="text" inputmode="numeric" autocomplete="tel" placeholder="5XXXXXXXX" required>
          </div>
        </div>
        <div class="field">
          <label>البريد الإلكتروني (إلزامي للإشعارات)</label>
          <input name="email" type="email" inputmode="email" autocomplete="email" placeholder="name@example.com" required>
          <div class="hint" style="margin-top:4px">يُستخدم لإرسال إشعار عند ورود طلب لفرعك — الرابط يفتح صفحة المناديب في المتصفح.</div>
        </div>
        <div class="field">
          <label>فرع العائلة</label>
          <select name="branch" required>
            <option value="">اختر الفرع</option>
            <option value="زيدان">زيدان</option>
            <option value="زايد">زايد</option>
            <option value="لاحم">لاحم</option>
            <option value="مزيد">مزيد</option>
            <option value="ملحم">ملحم</option>
          </select>
        </div>
        <div class="field">
          <label>الصلاحية المطلوبة</label>
          <label style="display:flex;gap:8px;align-items:center"><input name="treeRole" type="checkbox"> مندوب الشجرة</label>
          <label style="display:flex;gap:8px;align-items:center;margin-top:6px"><input name="eventsRole" type="checkbox"> مندوب المناسبات</label>
        </div>
        <div class="field">
          <label>الرقم السري</label>
          <input name="secret" type="password" minlength="4" placeholder="اختر رقمًا سريًا" required>
        </div>
        <div class="field">
          <label>تأكيد الرقم السري</label>
          <input name="secret2" type="password" minlength="4" placeholder="أعد كتابة الرقم السري" required>
        </div>
      </div>
      <button type="submit" class="btn btn-primary" style="margin-top:10px;width:100%">إرسال الطلب للإدارة</button>
    </form>
  `;

  host.appendChild(box);

  const openBtn = box.querySelector("[data-open-delegate-access-request]");
  const form = box.querySelector("[data-delegate-access-request-form]");

  openBtn.addEventListener("click", () => {
    const fbWrap = form.querySelector('[data-phone-intl="fallback-request"]');
    if (fbWrap && window.AlzidanPhoneIntl) {
      window.AlzidanPhoneIntl.bindPhoneIntl(fbWrap);
      const loginPhone = readLoginPhone();
      if (loginPhone.e164) window.AlzidanPhoneIntl.setPhoneIntl(fbWrap, loginPhone.e164);
    } else if (phoneInput && form.phone && !form.phone.value) form.phone.value = normalizePhone(phoneInput.value || "");
    if (branchSelectLogin && form.branch && !form.branch.value) form.branch.value = branchSelectLogin.value || "";
    if (codeInput && form.secret && !form.secret.value) form.secret.value = normalizeDelegateSecret(codeInput.value || "");
    form.style.display = form.style.display === "none" ? "block" : "none";
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const sb = getالخدمةClient();
    if (!sb) {
      setLoginAlert("error", "تعذر إرسال الطلب لأن الربط غير مُعد.");
      return;
    }

    const fullName = String(form.fullName.value || "").trim();
    const fbPhoneWrap = form.querySelector('[data-phone-intl="fallback-request"]');
    const fbPhone = fbPhoneWrap && window.AlzidanPhoneIntl ? window.AlzidanPhoneIntl.readPhoneIntl(fbPhoneWrap) : null;
    const phone = (fbPhone && fbPhone.e164) || normalizePhone(form.phone.value || "");
    const email = normalizeEmail(form.email ? form.email.value : "");
    const branch = String(form.branch.value || "").trim();
    const wantsTree = !!form.treeRole.checked;
    const wantsEvents = !!form.eventsRole.checked;
    const secret = normalizeDelegateSecret(form.secret.value || "");
    const secret2 = normalizeDelegateSecret(form.secret2.value || "");
    if (form.secret) form.secret.value = secret;
    if (form.secret2) form.secret2.value = secret2;
    if (form.phone) form.phone.value = phone;
    if (form.email) form.email.value = email;

    if (!fullName || fullName.split(/\s+/).length < 4) {
      setLoginAlert("error", "يرجى إدخال الاسم الرباعي.");
      return;
    }
    // PHONE_GATE request path — E.164 from country picker
    if (!(fbPhone && fbPhone.ok) && !isValidSaudiMobile(phone)) {
      setLoginAlert("error", "يرجى إدخال رقم جوال صحيح مع اختيار الدولة.");
      return;
    }
    if (!isLikelyEmail(email)) {
      setLoginAlert("error", "البريد الإلكتروني إلزامي لإشعارات طلبات الفرع.");
      return;
    }
    if (!branch || !Object.prototype.hasOwnProperty.call(parentsByBranch, branch)) {
      setLoginAlert("error", "يرجى اختيار الفرع.");
      return;
    }
    if (!wantsTree && !wantsEvents) {
      setLoginAlert("error", "اختر مندوب الشجرة أو مندوب المناسبات أو كلاهما.");
      return;
    }
    if (!isValidDelegateSecret(secret)) {
      setLoginAlert("error", "الرقم السري يجب ألا يقل عن 4 خانات.");
      return;
    }
    if (secret !== secret2) {
      setLoginAlert("error", "تأكيد الرقم السري غير مطابق.");
      return;
    }

    const secretHash = await sha256Hex(secret);
    if (!secretHash) {
      setLoginAlert("error", "تعذر إنشاء بصمة الرقم السري.");
      return;
    }

    const roles = [];
    if (wantsTree) roles.push("tree_delegate");
    if (wantsEvents) roles.push("events_delegate");

    const createdAt = new Date().toISOString();
    const baseRequestId = makeRequestId();

    const rows = roles.map((kind) => {
      const requestId = roles.length > 1
        ? baseRequestId + (kind === "tree_delegate" ? "-TREE" : "-EVENTS")
        : baseRequestId;

      const message = [
        "طلب صلاحية مندوب",
        "",
        "رقم الطلب: " + requestId,
        "الاسم الرباعي: " + fullName,
        "رقم الجوال: " + phone,
        "البريد: " + email,
        "الفرع: " + branch,
        "نوع الصلاحية: " + (kind === "tree_delegate" ? "مندوب الشجرة" : "مندوب المناسبات"),
        "التاريخ: " + new Date(createdAt).toLocaleString("ar-SA"),
        "",
        "__JSON__:",
        JSON.stringify({
          v: 2,
          kind,
          request_id: requestId,
          name: fullName,
          phone,
          email,
          branch_key: branch,
          delegate_roles: roles,
          secret_hash: secretHash,
          created_at: createdAt
        }, null, 2)
      ].join("\n");

      return {
        request_id: requestId,
        kind,
        branch_key: branch,
        name: fullName,
        phone,
        email,
        secret_hash: secretHash,
        message,
        status: "pending",
        created_at: createdAt
      };
    });

    const { error } = await sb.from("approval_requests").insert(rows);
    if (error) {
      setLoginAlert("error", "تعذر إرسال الطلب حاليًا.");
      return;
    }

    try {
      await sb.functions.invoke("alzidan-email-notify", {
        body: { mode: "new_request", record: rows[0] }
      });
    } catch (e) {}

    form.reset();
    form.style.display = "none";
    setLoginAlert("success", "تم إرسال طلبك بنجاح، وهو الآن قيد المراجعة. بعد الموافقة يمكنك استخدام الصلاحية التي تم قبولها.");
  });
}

ensureDelegateAccessRequestUi();

bindSilentDigitNormalize(phoneInput, "phone");
bindSilentDigitNormalize(codeInput, "secret");
bindSilentDigitNormalize(delegateRequestPhone, "phone");
bindSilentDigitNormalize(delegateRequestSecret, "secret");
bindSilentDigitNormalize(delegateRequestSecret2, "secret");
(function bindAccessRequestDigitNormalize() {
  const form = document.querySelector("[data-delegate-access-request-form]");
  if (!form) return;
  bindSilentDigitNormalize(form.querySelector('[name="phone"]'), "phone");
  bindSilentDigitNormalize(form.querySelector('[name="secret"]'), "secret");
  bindSilentDigitNormalize(form.querySelector('[name="secret2"]'), "secret");
})();


function buildDelegateAccessRequestMessage(payload) {
  const labels = {
    tree_delegate: "مندوب الشجرة",
    events_delegate: "مندوب المناسبات"
  };
  const lines = [];
  lines.push("طلب صلاحية مندوب");
  lines.push("");
  lines.push("رقم الطلب: " + payload.requestId);
  lines.push("الاسم الرباعي: " + payload.name);
  lines.push("رقم الجوال: " + payload.phone);
  lines.push("البريد: " + (payload.email || ""));
  lines.push("الفرع: " + payload.branch);
  lines.push("الصلاحيات المطلوبة: " + payload.roles.map((role) => labels[role] || role).join("، "));
  lines.push("التاريخ: " + new Date(payload.createdAt).toLocaleString("ar-SA"));
  lines.push("");
  lines.push("__JSON__:");
  lines.push(JSON.stringify({
    v: 2,
    kind: "delegate_access_request",
    request_id: payload.requestId,
    name: payload.name,
    phone: payload.phone,
    email: payload.email || "",
    branch_key: payload.branch,
    delegate_roles: payload.roles,
    secret_hash: payload.secretHash,
    created_at: payload.createdAt
  }, null, 2));
  return lines.join("\n");
}

if (requestDelegateBtn && delegateRequestCard) {
  requestDelegateBtn.addEventListener("click", () => {
    const loginPhone = readLoginPhone();
    const requestWrap = document.querySelector('[data-phone-intl="request"]');
    if (requestWrap && window.AlzidanPhoneIntl && loginPhone.e164) {
      window.AlzidanPhoneIntl.setPhoneIntl(requestWrap, loginPhone.e164);
    } else if (delegateRequestPhone && phoneInput) {
      delegateRequestPhone.value = normalizePhone(phoneInput.value || "");
    }
    if (delegateRequestBranch && branchSelectLogin) delegateRequestBranch.value = branchSelectLogin.value || "";
    if (delegateRequestSecret && codeInput) delegateRequestSecret.value = normalizeDelegateSecret(codeInput.value || "");
    const open = delegateRequestCard.style.display === "none";
    delegateRequestCard.style.display = open ? "block" : "none";
    if (open) {
      try {
        if (typeof delegateRequestCard.scrollIntoView === "function") {
          delegateRequestCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      } catch (e) {}
    }
  });
}

if (sendDelegateRequestBtn) {
  sendDelegateRequestBtn.addEventListener("click", async () => {
    const sb = getالخدمةClient();
    if (!sb) {
      setLoginAlert("error", "تعذر إرسال الطلب لأن الربط غير مُعد.");
      return;
    }

    const name = normalizePersonName(delegateRequestName ? delegateRequestName.value : "");
    const phoneGate = readRequestPhone();
    const phone = phoneGate.e164 || "";
    const email = normalizeEmail(delegateRequestEmail ? delegateRequestEmail.value : "");
    const branch = String(delegateRequestBranch ? delegateRequestBranch.value : "").trim();
    const wantsTree = !!(delegateRequestTree && delegateRequestTree.checked);
    const wantsEvents = !!(delegateRequestEvents && delegateRequestEvents.checked);
    const secret = normalizeDelegateSecret(delegateRequestSecret ? delegateRequestSecret.value : "");
    const secret2 = normalizeDelegateSecret(delegateRequestSecret2 ? delegateRequestSecret2.value : "");
    if (delegateRequestEmail) delegateRequestEmail.value = email;
    if (delegateRequestSecret) delegateRequestSecret.value = secret;
    if (delegateRequestSecret2) delegateRequestSecret2.value = secret2;

    if (!name || name.split(/\s+/).length < 4) {
      setLoginAlert("error", "يرجى إدخال الاسم الرباعي.");
      return;
    }
    // PHONE_GATE request path — country + national → E.164
    if (!phoneGate.ok || !phone) {
      setLoginAlert("error", "يرجى إدخال رقم جوال صحيح مع اختيار الدولة.");
      return;
    }
    if (!isLikelyEmail(email)) {
      setLoginAlert("error", "البريد الإلكتروني إلزامي لإشعارات طلبات الفرع.");
      return;
    }
    if (!branch || !Object.prototype.hasOwnProperty.call(parentsByBranch, branch)) {
      setLoginAlert("error", "يرجى اختيار الفرع.");
      return;
    }
    if (!wantsTree && !wantsEvents) {
      setLoginAlert("error", "اختر مندوب الشجرة أو مندوب المناسبات أو كلاهما.");
      return;
    }
    if (!isValidDelegateSecret(secret)) {
      setLoginAlert("error", "الرقم السري يجب ألا يقل عن 4 خانات.");
      return;
    }
    if (secret !== secret2) {
      setLoginAlert("error", "تأكيد الرقم السري غير مطابق.");
      return;
    }

    const roles = [];
    if (wantsTree) roles.push("tree_delegate");
    if (wantsEvents) roles.push("events_delegate");

    const secretHash = await sha256Hex(secret);
    if (!secretHash) {
      setLoginAlert("error", "تعذر إنشاء بصمة الرقم السري.");
      return;
    }
    const baseRequestId = makeRequestId();
    const createdAt = new Date().toISOString();

    // Always insert one row per selected kind so activate can link tree_request_id +
    // events_request_id and infer full_delegate. (Previously a dual selection wrote
    // a single tree_delegate row → events_request_id stayed null → branch_editor.)
    const rows = roles.map((kind) => {
      const requestId =
        roles.length > 1
          ? baseRequestId + (kind === "tree_delegate" ? "-TREE" : "-EVENTS")
          : baseRequestId;
      const payload = {
        requestId,
        name,
        phone,
        email,
        branch,
        roles,
        secretHash,
        createdAt
      };
      const message = [
        "طلب صلاحية مندوب",
        "",
        "رقم الطلب: " + requestId,
        "الاسم الرباعي: " + name,
        "رقم الجوال: " + phone,
        "البريد: " + email,
        "الفرع: " + branch,
        "نوع الصلاحية: " + (kind === "tree_delegate" ? "مندوب الشجرة" : "مندوب المناسبات"),
        "الصلاحيات المطلوبة: " +
          roles
            .map((role) =>
              role === "tree_delegate" ? "مندوب الشجرة" : role === "events_delegate" ? "مندوب المناسبات" : role
            )
            .join("، "),
        "التاريخ: " + new Date(createdAt).toLocaleString("ar-SA"),
        "",
        "__JSON__:",
        JSON.stringify(
          {
            v: 2,
            kind,
            request_id: requestId,
            name,
            phone,
            email,
            branch_key: branch,
            delegate_roles: roles,
            secret_hash: secretHash,
            created_at: createdAt
          },
          null,
          2
        )
      ].join("\n");
      return {
        request_id: requestId,
        kind,
        branch_key: branch,
        name,
        phone,
        email,
        secret_hash: secretHash,
        message,
        status: "pending",
        created_at: createdAt
      };
    });

    const { error } = await sb.from("approval_requests").insert(rows);
    if (error) {
      setLoginAlert("error", "تعذر إرسال الطلب حاليًا.");
      return;
    }

    try {
      await sb.functions.invoke("alzidan-email-notify", {
        body: { mode: "new_request", record: rows[0] }
      });
    } catch (notifyError) {}

    if (delegateRequestCard) delegateRequestCard.style.display = "none";
    setLoginAlert(
      "success",
      "تم إرسال طلبك بنجاح، وهو الآن قيد المراجعة" +
        (rows.length > 1 ? " (شجرة + مناسبات)" : "") +
        ". بعد الموافقة يمكنك استخدام الصلاحية التي تم قبولها."
    );
  });
}

loginBtn.addEventListener("click", async () =>{
  const branchKey = branchSelectLogin.value;
  // PHONE_GATE login: country + national → E.164 (candidates cover legacy 05…)
  const phoneGate = readLoginPhone();
  const phone = phoneGate.e164 || "";
  const email = "";
  const secret = normalizeDelegateSecret(codeInput ? codeInput.value : "");
  if (codeInput) codeInput.value = secret;

  if (!branchKey || !Object.prototype.hasOwnProperty.call(parentsByBranch, branchKey)) {
    setLoginAlert("error", "يرجى اختيار الفرع قبل المتابعة.");
    return;
  }
  if (!phoneGate.ok || !phone) {
    setLoginAlert("error", "يرجى إدخال رقم جوال صحيح مع اختيار الدولة.");
    return;
  }
  if (!isValidDelegateSecret(secret)) {
    setLoginAlert("error", "يرجى إدخال رقم سري (4 أحرف على الأقل).");
    return;
  }

  const sbResult = await tryالخدمةDelegateLogin(branchKey, phone, email, secret);

  if (sbResult.ok && sbResult.status === "approved") {
    let loginName = "";
    try {
      const sb = getالخدمةClient();
      if (sb && sbResult.secretHash) {
        const found = await sb.rpc("delegates_v2_find_v1", {
          p_branch_key: branchKey,
          p_phone: sbResult.phone || phone,
          p_email: sbResult.email || email || "",
          p_secret_hash: sbResult.secretHash,
        });
        if (!found.error && found.data && found.data.name) {
          loginName = String(found.data.name || "").replace(/\s+/g, " ").trim();
        }
      }
    } catch (_) {}
    saveDelegateSession(
      branchKey,
      sbResult.phone || phone,
      sbResult.email || email,
      sbResult.secretHash,
      loginName
    );
    startBranch(branchKey);
    return;
  }
  if (sbResult.reason === "pending") {
    setLoginAlert("success", "طلبك قيد المراجعة حاليًا. سنخبرك عند صدور القرار.");
    return;
  }
  if (sbResult.reason === "rejected") {
    setLoginAlert("error", "تم رفض طلبك.");
    return;
  }
  if (sbResult.reason === "disabled") {
    setLoginAlert("error", "حساب المندوب معطّل. تواصل مع الإدارة لإعادة التفعيل.");
    return;
  }
  if (sbResult.reason === "no_permission") {
    setLoginAlert("error", "تم تسجيل بياناتك لكن دورك الحالي لا يسمح بدخول بوابة المندوب. اطلب من الإدارة تعديل الصلاحية.");
    return;
  }
  if (sbResult.reason === "wrong_secret") {
    setLoginAlert("error", "الرقم السري غير صحيح. إذا نسيت الرقم السري اكتب رقمًا جديدًا ثم اضغط (نسيت الرقم السري).");
    return;
  }
  if (sbResult.reason === "not_found") {
    setLoginAlert("error", "لا يوجد طلب مندوب معتمد بهذه البيانات. استخدم زر (طلب صلاحية مندوب).");
    return;
  }

  if (sbResult.reason === "hash_failed") {
    setLoginAlert("error", "تعذر التحقق من الرقم السري على هذا الجهاز. جرّب متصفحاً آخر أو حدّث الصفحة.");
    return;
  }
  if (sbResult.reason === "not_configured") {
    setLoginAlert("error", "تعذر التحقق من بيانات الدخول لأن الربط غير مُعد.");
    return;
  }
  if (sbResult.reason === "rpc_missing") {
    setLoginAlert("error", "خدمة التحقق من دخول المندوب غير متاحة حالياً. أبلغ الإدارة لتحديث قاعدة البيانات.");
    return;
  }
  const errDetail = sbResult.error && sbResult.error.message ? String(sbResult.error.message) : "";
  if (errDetail && /JWT|Invalid API key|API key/i.test(errDetail)) {
    setLoginAlert("error", "تعذر التحقق من بيانات الدخول بسبب مفتاح الربط. أبلغ الإدارة.");
    return;
  }
  setLoginAlert("error", "تعذر التحقق من بيانات الدخول حاليًا.");
}); if (forgotBtn) { forgotBtn.addEventListener("click", async () =>{
  const branchKey = branchSelectLogin.value;
  // PHONE_GATE forgot: same country+national path as login.
  const phoneGate = readLoginPhone();
  const phone = phoneGate.e164 || "";
  const email = "";
  const secret = normalizeDelegateSecret(codeInput ? codeInput.value : "");
  if (codeInput) codeInput.value = secret;

  if (!branchKey || !Object.prototype.hasOwnProperty.call(parentsByBranch, branchKey)) {
    setLoginAlert("error", "يرجى اختيار الفرع قبل المتابعة.");
    return;
  }
  if (!phoneGate.ok || !phone) {
    setLoginAlert("error", "يرجى إدخال رقم جوال صحيح مع اختيار الدولة.");
    return;
  }
  if (!isValidDelegateSecret(secret)) {
    setLoginAlert("error", "اكتب رقمًا سريًا جديدًا (4 أحرف على الأقل) ثم اضغط نسيت الرقم السري.");
    return;
  }

  await requestDelegateSecretReset(branchKey, phone, email, secret);
}); } (async function () { const params = new URLSearchParams(window.location.search); const branchKey = params.get("branch"); if (!branchKey) return; if (!Object.prototype.hasOwnProperty.call(parentsByBranch, branchKey)) return; branchSelectLogin.value = branchKey; const phone = normalizePhone(params.get("phone") || ""); const email = normalizeEmail(params.get("email") || ""); const secret = normalizeDelegateSecret(params.get("code") || ""); if (phone) {
  const loginWrap = document.querySelector('[data-phone-intl="login"]');
  if (loginWrap && window.AlzidanPhoneIntl) window.AlzidanPhoneIntl.setPhoneIntl(loginWrap, phone);
  else if (phoneInput) phoneInput.value = phone;
} if (emailInput && email) emailInput.value = email; if (codeInput && secret) codeInput.value = secret; })(); clearDelegateSession(); logoutBtn.addEventListener("click", () =>{ state.branch = null; clearDelegateSession(); if (familyMgmtPanel && typeof familyMgmtPanel.destroy === "function") familyMgmtPanel.destroy(); familyMgmtPanel = null; if (window.AlzidanFamilyMgmt && typeof window.AlzidanFamilyMgmt.destroy === "function") window.AlzidanFamilyMgmt.destroy(); hideLoginAlert(); if (eventsCard) eventsCard.style.display = "none"; if (memoryCard) memoryCard.style.display = "none"; memorySubmitMounted = false; if (eventsMgmtPanel && typeof eventsMgmtPanel.destroy === "function") eventsMgmtPanel.destroy(); eventsMgmtPanel = null; if (window.DelegateEventsMgmtBridge && typeof window.DelegateEventsMgmtBridge.destroy === "function") window.DelegateEventsMgmtBridge.destroy(); state.happyEvents = []; state.sickEvents = []; state.deaths = []; branchSelectLogin.value = ""; if (phoneInput) phoneInput.value = ""; if (emailInput) emailInput.value = ""; if (codeInput) codeInput.value = ""; loginCard.style.display = "block"; dashboardCard.style.display = "none"; });
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

async function resolveTreeRowIdForWrite(sb, nodePath, opts) {
  const options = opts || {};
  const CP = window.AlzidanCanonicalPerson;
  if (!CP || typeof CP.resolveTreeRowIdForWrite !== "function") {
    const meta = state.pathToRow && state.pathToRow[normalizePersonName(nodePath || "")];
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

function getDelegatePersonRowMeta(path) {
  const childPath = normalizePersonName(path || "");
  const meta = state.pathToRow && state.pathToRow[childPath] ? state.pathToRow[childPath] : null;
  if (meta && meta.person_id) {
    return {
      id: meta.id ? Number(meta.id) : 0,
      person_id: String(meta.person_id),
      parent_person_id: meta.parent_person_id ? String(meta.parent_person_id) : "",
    };
  }
  const FM = window.AlzidanFamilyPersonCore || {};
  let personId = "";
  if (typeof FM.resolvePersonIdForNodePath === "function") {
    personId = FM.resolvePersonIdForNodePath(
      childPath,
      state.pathToRow,
      state.children,
      normalizePersonName,
    );
  }
  const byPid =
    personId && state.pathToRow && state.pathToRow["pid:" + personId]
      ? state.pathToRow["pid:" + personId]
      : null;
  if (byPid) {
    return {
      id: byPid.id ? Number(byPid.id) : 0,
      person_id: byPid.person_id ? String(byPid.person_id) : personId,
      parent_person_id: byPid.parent_person_id ? String(byPid.parent_person_id) : "",
    };
  }
  return {
    id: meta && meta.id ? Number(meta.id) : 0,
    person_id: personId || (meta && meta.person_id ? String(meta.person_id) : ""),
    parent_person_id: meta && meta.parent_person_id ? String(meta.parent_person_id) : "",
  };
}

/** Patch 3 — husband for wife/mother writes: selection person_id / row id first. */
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
  const meta = getDelegatePersonRowMeta(parentName);
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

/** @deprecated — prefer resolveHusbandForSpouseWrite. */
async function getTreePersonIdByName(sb, fullName) {
  const resolved = await resolveHusbandForSpouseWrite(sb, fullName);
  if (!resolved.ok || !resolved.rowId) return null;
  return resolved.rowId;
}

async function insertOrUpdateSpouseRow(sb, row, editingId) {
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

function delegateBirthYearFromAge(ageValue) {
  const raw = normalizeArabicDigitsToLatin(String(ageValue || "").trim());
  if (!raw) return null;
  const age = parseInt(raw, 10);
  if (!Number.isFinite(age) || age < 0 || age > 130) return null;
  const todayH = gregorianToHijriISO(todayGregorianISO());
  const currentHijriYear = todayH ? parseInt(todayH.slice(0, 4), 10) : null;
  if (!Number.isFinite(currentHijriYear)) return null;
  return currentHijriYear - age;
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

async function searchPersonsInBranch(term) {
  const q = normalizePersonName(term || "");
  if (!q) return [];
  const FM = window.AlzidanFamilyPersonCore || {};
  const limit =
    typeof FM.PERSON_SEARCH_LIMIT === "number" ? FM.PERSON_SEARCH_LIMIT : 40;
  const branch = normalizePersonName(state.branch || "");
  const sb = typeof getالخدمةClient === "function" ? getالخدمةClient() : null;
  if (!sb || !branch) return [];

  let rows = [];
  try {
    const orFilter =
      typeof FM.buildPersonNameIlikeOrFilter === "function"
        ? FM.buildPersonNameIlikeOrFilter(q)
        : "child_name.ilike.%" + q + "%,name.ilike.%" + q + "%";
    if (!orFilter) return [];
    let fb = sb
      .from("tree_children")
      .select("person_id,branch_key,child_name,name,parent_name,parent")
      .or(orFilter)
      .limit(limit);
    fb = fb.eq("branch_key", branch);
    const res = await fb;
    if (!res.error && Array.isArray(res.data)) rows = res.data;
  } catch (_) {
    rows = [];
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

async function findDuplicateWifeForDelegate(sb, husbandId, row, editingSpouseId) {
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
  const sb = getالخدمةClient();
  const SpousesCore = window.AlzidanSpousesCore || {};
  if (!sb || !state.branch) return { data: [], error: { message: "no branch" } };
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

async function familyApiGetParentChildrenForWifeManager(personName) {
  const sb = getالخدمةClient();
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
  const sb = getالخدمةClient();
  if (!sb || !spouseId) return new Set();
  const { data, error } = await sb.from("tree_mother_links").select("child_id").eq("spouse_id", spouseId).limit(1000);
  if (error) return new Set();
  return new Set((Array.isArray(data) ? data : []).map((r) => String(r.child_id)));
}

async function familyApiSaveWifeChildrenLinks(payload) {
  const sb = getالخدمةClient();
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
  if (!state.branch) return { ok: false, message: "يلزم تسجيل دخول المندوب أولاً." };
  const sb = getالخدمةClient();
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

async function familyApiSaveWife(payload) {
  if (!state.branch) return { ok: false, message: "يلزم تسجيل دخول المندوب أولاً." };
  const sb = getالخدمةClient();
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
    status: "active",
    confidence: "confirmed",
    data_source: "delegate",
    updated_at: new Date().toISOString(),
  };
  const editingId = Number(payload.editingSpouseId || 0);
  if (editingId) {
    const { error } = await insertOrUpdateSpouseRow(sb, row, editingId);
    if (error) return { ok: false, message: "تعذر تعديل الزوجة: " + (error.message || "خطأ غير معروف") };
    return { ok: true, message: "تم تعديل بيانات الزوجة." };
  }
  try {
    const dup = await findDuplicateWifeForDelegate(sb, husbandId, row, 0);
    if (dup) {
      return { ok: false, message: "هذه الزوجة مسجلة مسبقًا مع زوج آخر. راجع الاسم الثلاثي أو سلسلة النسب قبل الحفظ." };
    }
  } catch (err) {
    return { ok: false, message: "تعذر التحقق من تكرار اسم الزوجة، حاول لاحقًا." };
  }
  const r = await insertOrUpdateSpouseRow(sb, row, 0);
  if (r.error) return { ok: false, message: "تعذر حفظ الزوجة: " + (r.error.message || "خطأ غير معروف") };
  return { ok: true, message: "تم حفظ الزوجة." };
}

async function familyApiLinkChildToSpouse(childId, spouseId) {
  if (!spouseId) return { ok: true, skipped: true };
  const sb = getالخدمةClient();
  if (!sb) return { ok: false, error: { message: "تعذر الاتصال بقاعدة البيانات." } };
  const childPath = normalizePersonName(childId || "");
  const childMeta = getDelegatePersonRowMeta(childPath);
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

async function familyApiSaveChild(payload) {
  if (!state.branch) return { ok: false, message: "يلزم تسجيل دخول المندوب أولاً." };
  const selectedParentName = resolveSelectedParentId(normalizePersonName(payload.personId || payload.boundParentPath), state.branch);
  const FM = window.AlzidanFamilyPersonCore || {};
  const bound =
    typeof FM.bindParentWriteContext === "function"
      ? FM.bindParentWriteContext(selectedParentName, state.pathToRow || {}, { normalizePersonName })
      : { parentPath: selectedParentName, parentPersonId: "" };
  if (selectedParentName && !bound.parentPersonId) {
    const meta = typeof getDelegatePersonRowMeta === "function" ? getDelegatePersonRowMeta(selectedParentName) : null;
    if (meta && meta.person_id) bound.parentPersonId = String(meta.person_id);
    else {
      const pid = findStablePersonId(selectedParentName);
      if (pid) bound.parentPersonId = pid;
    }
  }
  const branchRoot = getBranchRootName(state.branch);
  const isBranchRoot = !!(branchRoot && (selectedParentName === branchRoot || selectedParentName === state.branch));
  if (!isBranchRoot && !bound.parentPersonId) {
    return {
      ok: false,
      message: "يلزم parent_person_id للأب المحدد قبل إضافة أبناء. أعد اختيار الأب من القائمة (TREE-003).",
      code: "TREE-003",
    };
  }
  const bindChildWriteRow = (row) => {
    let payload = Object.assign({}, row || {});
    if (typeof FM.attachBoundParentToRow === "function") {
      payload = FM.attachBoundParentToRow(payload, bound);
    } else {
      if (bound.parentPath) {
        payload.parent_name = bound.parentPath;
        payload.parent = bound.parentPath;
      }
      if (bound.parentPersonId) payload.parent_person_id = bound.parentPersonId;
    }
    const TE = window.AlzidanTreeEngine;
    if (TE && typeof TE.prepareChildWriteRow === "function") {
      const prepared = TE.prepareChildWriteRow(payload);
      if (!prepared.ok) {
        throw Object.assign(new Error(prepared.message_ar || prepared.message || "parent_required"), {
          code: prepared.code || "TREE-PARENT-NULL",
          message_ar: prepared.message_ar,
        });
      }
      return prepared.row;
    }
    const p = normalizePersonName(payload.parent_name || payload.parent || "");
    if (!p) {
      throw Object.assign(new Error("لا يُسمح بكتابة صف في الشجرة دون مسار أب (parent)."), {
        code: "TREE-PARENT-NULL",
      });
    }
    payload.parent_name = p;
    payload.parent = p;
    const c = normalizePersonName(payload.child_name || payload.name || "");
    if (c) {
      payload.child_name = c;
      payload.name = c;
    }
    return payload;
  };
  const safeBindChildWriteRow = (row) => {
    try {
      if (typeof bindChildWriteRow === "function") return { ok: true, row: bindChildWriteRow(row) };
      return { ok: true, row: row };
    } catch (err) {
      return {
        ok: false,
        message: (err && (err.message_ar || err.message)) || "رفض كتابة صف بلا مسار أب.",
        code: (err && err.code) || "TREE-PARENT-NULL",
      };
    }
  };

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
  const sb = getالخدمةClient();
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
      const boundWrite = safeBindChildWriteRow(row);
      if (!boundWrite.ok) return { ok: false, message: boundWrite.message, code: boundWrite.code };
      const insertRes = await rpcInsertTreeChildRow(sb, boundWrite.row);
      if (!insertRes.ok) {
        if (isRpcMissingError(insertRes.error)) return { ok: false, message: "تعذر الحفظ حالياً، حاول لاحقاً أو تواصل مع الإدارة." };
        return { ok: false, message: formatTreeChildrenDbError(insertRes.error, "save") };
      }
      if (!state.children[parentName]) state.children[parentName] = [];
      state.children[parentName].push({ name: childId, year: birthYear ? String(birthYear) : "", order: birthOrder == null ? "" : String(birthOrder + i), gdate: finalGreg || "", hdate: finalHijri || "", city, area, deceased });
      baseNames.add(base);
      inserted += 1;
    }
    const reloadRes = await loadChildrenForBranchDelegate(state.branch, { applyToState: true });
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
      const boundWrite = safeBindChildWriteRow(row);
      if (!boundWrite.ok) return { ok: false, message: boundWrite.message, code: boundWrite.code };
      const insertRes = await rpcInsertTreeChildRow(sb, boundWrite.row);
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
    const reloadRes = await loadChildrenForBranchDelegate(state.branch, { applyToState: true });
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
  const boundWrite = safeBindChildWriteRow(row);
      if (!boundWrite.ok) return { ok: false, message: boundWrite.message, code: boundWrite.code };
      const insertRes = await rpcInsertTreeChildRow(sb, boundWrite.row);
  if (!insertRes.ok) {
    if (isRpcMissingError(insertRes.error)) return { ok: false, message: "تعذر الحفظ حالياً، حاول لاحقاً أو تواصل مع الإدارة." };
    return { ok: false, message: formatTreeChildrenDbError(insertRes.error, "save") };
  }
  const reloadRes = await loadChildrenForBranchDelegate(state.branch, { applyToState: true });
  const rawPhone = String(payload.phone || "").trim();
  const memberPhoneForChild = normalizeMemberPhoneForDelegate(rawPhone);
  if (rawPhone && !memberPhoneForChild) {
    return { ok: false, message: "تم حفظ الابن لكن رقم الجوال غير صحيح. اختر الدولة واكتب الرقم المحلي فقط." };
  }
  if (memberPhoneForChild) {
    const memberProfileRes = await saveDelegateMemberProfile(sb, memberPhoneForChild, state.branch, childId, findStablePersonId(childId));
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

async function loadChildrenForBranchDelegate(branchKey, opts) {
  const res = await loadChildrenForBranch(branchKey, opts);
  if (!res.ok || !opts || opts.applyToState !== true) return res;
  state.pathToRow = {};
  const FM = window.AlzidanFamilyPersonCore || {};
  const rows = Array.isArray(res.rows) ? res.rows : [];
  state.pathToRow =
    typeof FM.buildPathToRowIndex === "function"
      ? FM.buildPathToRowIndex(rows, normalizePersonName)
      : {};
  if (typeof FM.attachTreeRowIdsToChildren === "function") {
    FM.attachTreeRowIdsToChildren(state.children, state.pathToRow, {
      normalizePersonName,
      normalizePersonBaseName,
    });
  }
  return res;
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
  if (!state.branch) return { ok: false, message: "يلزم تسجيل دخول المندوب أولاً." };
  const parentId = normalizePersonName(payload.parentId || "");
  const child = payload.child || {};
  const childId = normalizePersonName(payload.childId || child.name || "");
  if (!parentId || !childId) return { ok: false, message: "تعذر تحديد السجل." };
  if (isOriginNode(childId, parentId, child.personId || payload.personId || "")) {
    return { ok: false, message: originLockMessage() };
  }
  const newNameRaw = String(payload.newName || "").trim();
  if (newNameRaw) {
    const currentDisplay = getDisplayNameForNodeId(childId, state.branch ? getBranchRootName(state.branch) : "");
    const newBase = normalizePersonBaseName(newNameRaw);
    const currentBase = normalizePersonBaseName(currentDisplay || childId);
    if (newBase && newBase !== currentBase) {
      return { ok: false, message: "تعديل الاسم متاح من صفحة الإدارة فقط." };
    }
  }
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
  const sb = getالخدمةClient();
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
  const personId = normalizePersonName(child.personId || "");
  const res = await rpcUpdateTreeChildRow(sb, state.branch, parentId, childId, patch, personId);
  if (!res.ok) {
    if (isRpcMissingError(res.error)) return { ok: false, message: "تعذر تنفيذ التعديل حالياً، حاول لاحقاً أو تواصل مع الإدارة." };
    return { ok: false, message: formatTreeChildrenDbError(res.error, "update") };
  }
  const reloadRes = await loadChildrenForBranchDelegate(state.branch, { applyToState: true });
  const rawEditPhone = String(payload.phone || "").trim();
  const editPhoneValue = normalizeMemberPhoneForDelegate(rawEditPhone);
  if (rawEditPhone && !editPhoneValue) {
    return { ok: false, message: "تم حفظ التعديل لكن رقم الجوال غير صحيح. اختر الدولة واكتب الرقم المحلي فقط." };
  }
  if (editPhoneValue) {
    const memberProfileEditRes = await saveDelegateMemberProfile(
      sb,
      editPhoneValue,
      state.branch,
      childId,
      personId || findStablePersonId(childId),
    );
    if (!memberProfileEditRes.ok) {
      return { ok: false, message: "تم حفظ التعديل لكن تعذر حفظ رقم الجوال. أعد إدخاله." };
    }
  }
  if (!reloadRes.ok) return { ok: true, message: "تم حفظ التعديل. تعذر تحديث البيانات من قاعدة البيانات الآن." };
  return { ok: true, message: res.degraded ? "تم حفظ التعديل، لكن تعذر حفظ حالة متوفى في الخدمة لأن عمود الوفاة غير متاح." : "تم حفظ التعديل." };
}

async function familyApiDeleteChild(payload) {
  if (!state.branch) return { ok: false, message: "يلزم تسجيل دخول المندوب أولاً." };
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
  const sb = getالخدمةClient();
  if (!sb) return { ok: false, message: "تعذر الحذف لأن الربط غير مُعد." };
  let resolvedPersonId = normalizePersonName(child.personId || payload.personId || "");
  const FM = window.AlzidanFamilyPersonCore || {};
  const rowMeta =
    typeof FM.findTreeRowMeta === "function"
      ? FM.findTreeRowMeta(state.pathToRow || {}, childIdForDelete, child, {
          normalizePersonName,
          normalizePersonBaseName,
        }, parentId)
      : null;
  if (!resolvedPersonId && rowMeta && rowMeta.person_id) {
    resolvedPersonId = normalizePersonName(rowMeta.person_id);
  }
  if (!resolvedPersonId) {
    const meta = state.pathToRow && state.pathToRow[childIdForDelete] ? state.pathToRow[childIdForDelete] : null;
    if (meta && meta.person_id) resolvedPersonId = normalizePersonName(meta.person_id);
  }
  if (!resolvedPersonId) resolvedPersonId = findStablePersonId(childIdForDelete);
  const res = await rpcDeleteTreeChildRow(sb, state.branch, parentId, childIdForDelete, resolvedPersonId, child);
  if (!res.ok) {
    if (isRpcMissingError(res.error)) return { ok: false, message: "تعذر الحذف حالياً، حاول لاحقاً أو تواصل مع الإدارة." };
    return { ok: false, message: formatTreeChildrenDbError(res.error, "delete") };
  }
  await loadChildrenForBranchDelegate(state.branch, { applyToState: true });
  return { ok: true, message: "تم حذف الاسم." };
}

function buildDelegateFamilyApi() {
  return {
    getState: () => state,
    getBranchKey: () => state.branch,
    getClient: getالخدمةClient,
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
    normalizeDelegateSecret,
    parseISODate,
    formatDateISO,
    calculateAge,
    buildPersonOptions: buildPersonOptionsForFamilyMgmt,
    searchPersons: searchPersonsInBranch,
    getDefaultPersonId: (branchKey) => {
      const root = getBranchRootName(branchKey);
      return root || "";
    },
    isOriginPerson: (nodeId, opts) => {
      const o = opts || {};
      return isOriginNode(nodeId, o.parentId || o.parentName || "", o.personId || "");
    },
    ensurePersonOption: ensurePersonOptionForFamilyMgmt,
    loadWivesForPerson: familyApiLoadWivesForPerson,
    getParentChildrenForWifeManager: familyApiGetParentChildrenForWifeManager,
    loadLinkedChildrenForSpouse: familyApiLoadLinkedChildrenForSpouse,
    saveWifeChildrenLinks: familyApiSaveWifeChildrenLinks,
    confirmLinkAllChildrenToOnlyWife: familyApiConfirmLinkAllChildrenToOnlyWife,
    saveWife: familyApiSaveWife,
    saveChild: familyApiSaveChild,
    updateChild: familyApiUpdateChild,
    deleteChild: familyApiDeleteChild,
    getPersonRowMeta: (path) => getDelegatePersonRowMeta(path),
    loadMemberPhone: async (parentId, child) => {
      const sb = getالخدمةClient();
      if (!sb || !state.branch) return "";
      return loadDelegateMemberPhone(sb, state.branch, normalizePersonName(child && child.name ? child.name : ""), normalizePersonName(child && child.personId ? child.personId : ""));
    },
  };
}

function mountDelegateFamilyManagement(initialPersonId) {
  if (!familyManagementRoot || !window.AlzidanFamilyMgmt || typeof window.AlzidanFamilyMgmt.mount !== "function") return;
  familyMgmtPanel = window.AlzidanFamilyMgmt.mount({
    mode: "delegate",
    root: familyManagementRoot,
    api: buildDelegateFamilyApi(),
  });
  if (familyMgmtPanel && typeof familyMgmtPanel.refresh === "function") {
    familyMgmtPanel.refresh().then(() => {
      const pick = normalizePersonName(initialPersonId || "");
      if (pick && familyMgmtPanel.selectPerson) familyMgmtPanel.selectPerson(pick);
    }).catch(() => {});
  }
}


const EVENTS_REFRESH_KEY = "alzidan_events_refresh_v1"; function touchEventsRefresh() { try { localStorage.setItem(EVENTS_REFRESH_KEY, String(Date.now())); } catch (e) {} try { window.dispatchEvent(new CustomEvent("alzidan-events-refresh")); } catch (e) {} try { if (typeof BroadcastChannel !== "undefined") { if (!window.__alzidanEventsRefreshBc) window.__alzidanEventsRefreshBc = new BroadcastChannel("alzidan_events_refresh_v1"); window.__alzidanEventsRefreshBc.postMessage({ t: Date.now() }); } } catch (e) {} } function delegateFileExtFromName(name, fallback) {
  const s = String(name || "").split("?")[0].trim();
  const m = /\.([a-z0-9]+)$/i.exec(s);
  return (m ? m[1].toLowerCase() : fallback || "bin").replace(/[^a-z0-9]/g, "") || fallback || "bin";
}
function delegatePublicStorageUrl(path) {
  return String(SUPABASE_URL || "").replace(/\/+$/, "") + "/storage/v1/object/public/event-media/" + String(path || "").split("/").map(encodeURIComponent).join("/");
}
async function uploadDelegateEventMedia(sb, file, kind) {
  if (!file) return "";
  const isImage = kind === "image";
  const fallback = isImage ? "jpg" : "mp4";
  const path = "delegate_" + Date.now() + "_" + Math.random().toString(36).slice(2) + "." + delegateFileExtFromName(file.name, fallback);
  const { error } = await sb.storage.from("event-media").upload(path, file, { contentType: file.type || (isImage ? "image/jpeg" : "video/mp4"), upsert: false });
  if (error) throw new Error("تعذر رفع " + (isImage ? "الصورة" : "الفيديو") + ": " + (error.message || error.error || JSON.stringify(error)));
  return delegatePublicStorageUrl(path);
}

function safeParseJson(v) { try { if (v == null) return null; const s = String(v || "").trim(); if (!s) return null; return JSON.parse(s); } catch (e) { return null; } }

function parseEventEnvelope(eventRow) { const parsed = safeParseJson(eventRow && eventRow.details != null ? eventRow.details : null); if (parsed && typeof parsed === "object") return parsed; return null; }

function clampVisibilityDays(v) { const n = parseInt(String(v || "").trim(), 10); if (!Number.isFinite(n)) return 7; if (n< 1) return 1; if (n >7) return 7; return n; }

function getEventVisibilityDays(eventRow) { const env = parseEventEnvelope(eventRow || {}); if (env && env.v === 1 && (env.kind === "happy_notice" || env.kind === "health_notice" || env.kind === "death_notice")) { return clampVisibilityDays(env.showDays); } return 7; }

function getHappyDetailsText(eventRow) { const env = parseEventEnvelope(eventRow || {}); if (env && env.kind === "happy_notice" && env.v === 1) { const extra = String(env.extra || "").trim(); if (extra) return extra; return String(env.text || "").trim(); } return String(eventRow && eventRow.details != null ? eventRow.details : "").trim(); }

function normalizePhonesForDisplay(list) { const out = []; const seen = new Set(); (Array.isArray(list) ? list : []).forEach((p) =>{ const s = normalizePhone(String(p || "")); if (!s) return; if (seen.has(s)) return; seen.add(s); out.push(s); }); return out; }

function parseDeathDetails(eventRow) { const parsed = safeParseJson(eventRow && eventRow.details != null ? eventRow.details : null); if (parsed && typeof parsed === "object" && parsed.kind === "death_notice" && parsed.v === 1) { return { prayerPlace: normalizePersonName(parsed.prayerPlace || ""), prayerTime: normalizePersonName(parsed.prayerTime || ""), burialPlace: normalizePersonName(parsed.burialPlace || ""), burialTime: normalizePersonName(parsed.burialTime || ""), condolencePlace: normalizePersonName(parsed.condolencePlace || ""), condolenceTime: normalizePersonName(parsed.condolenceTime || ""), phones: normalizePhonesForDisplay(parsed.phones || []), notes: String(parsed.notes || "").trim() }; } const raw = String(eventRow && eventRow.details != null ? eventRow.details : "").trim(); return { prayerPlace: "", prayerTime: "", burialPlace: "", burialTime: "", condolencePlace: "", condolenceTime: "", phones: [], notes: raw }; }

function resolveEventDateInputValue(row) { const raw = row && row.event_date != null ? String(row.event_date).trim() : ""; const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(raw); if (iso) { const y = iso[1].padStart(4, "0"); const m = iso[2].padStart(2, "0"); const d = iso[3].padStart(2, "0"); const year = parseInt(y, 10); if (year >= 1200 && year<= 1700) { const gregorian = hijriToGregorianISO(y + "-" + m + "-" + d); if (gregorian) return gregorian; } return y + "-" + m + "-" + d; } const labelRaw = row && row.date_label != null ? String(row.date_label).trim() : ""; let s = labelRaw; for (let i = 0; i< 3; i++) { const m = /^\s*[\(（]\s*(.*?)\s*[\)）]\s*$/.exec(s); if (!m) break; s = String(m[1] || "").trim(); if (!s) break; } const labelIso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s); if (labelIso) { const y = labelIso[1].padStart(4, "0"); const m = labelIso[2].padStart(2, "0"); const d = labelIso[3].padStart(2, "0"); const year = parseInt(y, 10); if (year >= 1200 && year<= 1700) { const g = hijriToGregorianISO(y + "-" + m + "-" + d); if (g) return g; } if (year >= 1900 && year<= 2100) return y + "-" + m + "-" + d; } const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s); if (slash) { const d = slash[1].padStart(2, "0"); const m = slash[2].padStart(2, "0"); const y = slash[3]; const year = parseInt(y, 10); if (year >= 1200 && year<= 1700) { const g = hijriToGregorianISO(y + "-" + m + "-" + d); if (g) return g; } if (year >= 1900 && year<= 2100) return y + "-" + m + "-" + d; } return todayGregorianISO(); }

function parseDelegateHappyDetails(row) {
  const env = parseEventEnvelope(row || {});
  if (env && typeof env === "object") return env;
  return {};
}

window.DelegateEventsHost = {
  getBranchKey: () => state.branch,
  getClient: getالخدمةClient,
  getDelegateRpcAuth,
  formatDelegateDeniedError,
  rpcInsertFamilyEventRow,
  rpcUpdateFamilyEventRow,
  rpcDeleteFamilyEventRow,
  uploadDelegateEventMedia,
  normalizePersonName,
  formatDateISO,
  todayGregorianISO,
  confirmTypedText,
  touchEventsRefresh,
  maybeOpenEmailDraft,
  getEventPk,
  getEventVisibilityDays,
  resolveEventDateInputValue,
  parseDeathDetails,
  parseHealthDetails,
  parseDelegateHappyDetails,
  getHappyDetailsText,
  formatEventText,
  clampVisibilityDays,
  isRpcMissingError,
  isCaseTypesTextAndDateMismatchError,
  normalizePhonesForDisplay,
  parseEventEnvelope,
  getEventPkKeys,
  addEnvelopePkRefsToSet,
  safeParseJson,
};

function mountDelegateEventsManagement() {
  if (!eventsManagementRoot || !window.DelegateEventsMgmtBridge) return;
  ensureDelegateIncomingEventRequestsCard();
  eventsMgmtPanel = window.DelegateEventsMgmtBridge.mount({ root: eventsManagementRoot });
  loadDelegateIncomingEventRequests(state.branch).catch(() => {});
}

function mountDelegateMemorySubmit() {
  if (!memoryCard || !window.AlzidanMemorySubmit) return;
  var root = document.getElementById("memory-submit-root");
  if (!root) return;
  var session = loadDelegateSession();
  if (!memorySubmitMounted) {
    window.AlzidanMemorySubmit.mount({
      root: root,
      mode: "delegate",
      branch: state.branch,
      submitterPhone: session && session.phone ? session.phone : "",
      submitterName: ""
    });
    memorySubmitMounted = true;
  }
}
