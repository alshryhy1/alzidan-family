(function () {
  const SUPABASE_URL = "https://wbskjfdqpugnwvrykqcn.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_JhgwBIXhs6z4yBZOoE2EqA_UlzjzW9c";
  let sbClient = null;

  function normalizeEmail(v) {
    return String(v || "").trim().toLowerCase();
  }

  function isLikelyEmail(v) {
    const s = normalizeEmail(v);
    return !!(s && s.includes("@") && s.includes(".") && s.length >= 6);
  }

  function fallbackCopyText(text) {
    const el = document.createElement("textarea");
    el.value = String(text || "");
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.opacity = "0";
    el.style.left = "-9999px";
    document.body.appendChild(el);
    el.select();
    try {
      document.execCommand("copy");
    } catch (e) {}
    document.body.removeChild(el);
  }

  async function copyText(text) {
    const t = String(text || "");
    if (!t) return false;
    try {
      if (
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === "function"
      ) {
        await navigator.clipboard.writeText(t);
        return true;
      }
    } catch (e) {}
    fallbackCopyText(t);
    return true;
  }

  function downloadTextFile(filename, text, mimeType) {
    const name = String(filename || "").trim() || "file.txt";
    const content = String(text || "");
    const type = String(mimeType || "").trim() || "text/plain;charset=utf-8";
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function truncateText(t, max) {
    const s = String(t || "");
    const n = Number(max || 0);
    if (!n || s.length <= n) return s;
    return s.slice(0, Math.max(0, n - 20)) + "\n...\n(تم الاختصار)";
  }

  function takeLines(text, maxLines, maxChars) {
    const src = String(text || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
    const lines = src.split("\n");
    const out = [];
    for (let i = 0; i < lines.length && out.length < maxLines; i += 1) {
      const v = String(lines[i] || "");
      if (!v.trim()) continue;
      out.push(v);
      if (maxChars && out.join("\n").length >= maxChars) break;
    }
    return out.join("\n");
  }

  function detectCsvDelimiter(line) {
    const s = String(line || "");
    const commas = (s.match(/,/g) || []).length;
    const semis = (s.match(/;/g) || []).length;
    return semis > commas ? ";" : ",";
  }

  function parseCsv(text) {
    const raw = String(text || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
    const lines = raw
      .split("\n")
      .map((l) => l.replace(/^\ufeff/, ""))
      .filter((l) => l.trim().length);
    if (!lines.length) return [];
    const delimiter = detectCsvDelimiter(lines[0]);
    const parseLine = (line) => {
      const out = [];
      let cur = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (inQuotes) {
          if (ch === '"') {
            if (line[i + 1] === '"') {
              cur += '"';
              i += 1;
            } else {
              inQuotes = false;
            }
          } else {
            cur += ch;
          }
          continue;
        }
        if (ch === '"') {
          inQuotes = true;
          continue;
        }
        if (ch === delimiter) {
          out.push(cur.trim());
          cur = "";
          continue;
        }
        cur += ch;
      }
      out.push(cur.trim());
      return out;
    };
    const header = parseLine(lines[0]).map((h) =>
      String(h || "")
        .trim()
        .replace(/^\ufeff/, ""),
    );
    const rows = [];
    for (let i = 1; i < lines.length; i += 1) {
      const parts = parseLine(lines[i]);
      if (!parts.some((p) => String(p || "").trim())) continue;
      const obj = {};
      header.forEach((k, idx) => {
        if (!k) return;
        obj[k] = parts[idx] != null ? String(parts[idx]) : "";
      });
      rows.push(obj);
    }
    return rows;
  }

  function coerceBool(v) {
    if (v == null) return null;
    const s = String(v || "")
      .trim()
      .toLowerCase();
    if (!s) return null;
    if (
      s === "1" ||
      s === "true" ||
      s === "yes" ||
      s === "y" ||
      s === "نعم" ||
      s === "صح"
    )
      return true;
    if (
      s === "0" ||
      s === "false" ||
      s === "no" ||
      s === "n" ||
      s === "لا" ||
      s === "خطأ"
    )
      return false;
    return null;
  }

  function normalizeArabicDigitsToLatin(v) {
    const s = String(v || "");
    const map = {
      "٠": "0",
      "١": "1",
      "٢": "2",
      "٣": "3",
      "٤": "4",
      "٥": "5",
      "٦": "6",
      "٧": "7",
      "٨": "8",
      "٩": "9",
      "۰": "0",
      "۱": "1",
      "۲": "2",
      "۳": "3",
      "۴": "4",
      "۵": "5",
      "۶": "6",
      "۷": "7",
      "۸": "8",
      "۹": "9",
    };
    return s.replace(/[٠-٩۰-۹]/g, (ch) => map[ch] || ch);
  }

  function pickRowValue(row, keys) {
    const r = row || {};
    for (let i = 0; i < keys.length; i += 1) {
      const k = keys[i];
      if (!k) continue;
      const v = r[k];
      const s = v != null ? String(v).trim() : "";
      if (s) return s;
    }
    return "";
  }

  function toIntOrNull(v) {
    const s = normalizeArabicDigitsToLatin(String(v || "").trim());
    if (!s) return null;
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : null;
  }

  function toIsoDateOrEmpty(v) {
    const raw = normalizeArabicDigitsToLatin(String(v || "").trim());
    if (!raw) return "";
    const cleaned = raw.replace(/[.\s]+/g, "/");
    let y = null;
    let m = null;
    let d = null;
    let mm = cleaned.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (mm) {
      y = toIntOrNull(mm[1]);
      m = toIntOrNull(mm[2]);
      d = toIntOrNull(mm[3]);
    } else {
      mm = cleaned.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
      if (mm) {
        d = toIntOrNull(mm[1]);
        m = toIntOrNull(mm[2]);
        y = toIntOrNull(mm[3]);
      }
    }
    if (!y || !m || !d) return "";
    if (y < 1800 || y > 2100) return "";
    if (m < 1 || m > 12) return "";
    if (d < 1 || d > 31) return "";
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (
      dt.getUTCFullYear() !== y ||
      dt.getUTCMonth() !== m - 1 ||
      dt.getUTCDate() !== d
    )
      return "";
    const yy = String(y).padStart(4, "0");
    const mm2 = String(m).padStart(2, "0");
    const dd2 = String(d).padStart(2, "0");
    return `${yy}-${mm2}-${dd2}`;
  }

  function chunkArray(arr, size) {
    const n = Math.max(1, Number(size || 1));
    const out = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  }

  function formatDateTimeArSaVerbose(v) {
    if (!v) return "";
    let date;
    if (v instanceof Date) date = v;
    else date = new Date(v);
    if (!date || !Number.isFinite(date.getTime())) return String(v || "");
    let s = "";
    try {
      s = date.toLocaleString("ar-SA");
    } catch (e) {
      s = String(v || "");
    }
    s = String(s || "").trim();
    if (!s) return "";
    s = s.replace(/\s*(AM|am)\s*$/, " صباحاً");
    s = s.replace(/\s*(PM|pm)\s*$/, " مساءً");
    s = s.replace(/\s*ص\s*$/, " صباحاً");
    s = s.replace(/\s*م\s*$/, " مساءً");
    return s;
  }

  function getClient() {
    if (sbClient) return sbClient;

    if (
      window.__alzidanConfig &&
      typeof window.__alzidanConfig.getClient === "function"
    ) {
      const shared = window.__alzidanConfig.getClient();
      if (shared) {
        sbClient = shared;
        window.__alzidanSupabaseClient = shared;
        window.__alzidanالخدمةClient = shared;
        return sbClient;
      }
    }

    if (window.__alzidanSupabaseClient) {
      sbClient = window.__alzidanSupabaseClient;
      window.__alzidanالخدمةClient = sbClient;
      return sbClient;
    }

    if (window.__alzidanالخدمةClient) {
      sbClient = window.__alzidanالخدمةClient;
      window.__alzidanSupabaseClient = sbClient;
      return sbClient;
    }

    const url = String(SUPABASE_URL || "").trim();
    const anonKey = String(SUPABASE_ANON_KEY || "").trim();
    if (!url || !anonKey) return null;
    if (!window.supabase || typeof window.supabase.createClient !== "function")
      return null;

    sbClient = window.supabase.createClient(url, anonKey);
    window.__alzidanSupabaseClient = sbClient;
    window.__alzidanالخدمةClient = sbClient;
    return sbClient;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function kindLabel(kind) {
    const map = {
      org_role: "صندوق / جمعية",
      tree_delegate: "مندوب الشجرة",
      events_delegate: "مندوب المناسبات",
      member_registration: "تسجيل عضو",
      tree_card: "بطاقة الشجرة",
      tree_audit: "تعديل بيانات الشجرة",
      events_audit: "تعديل الأخبار والمناسبات",
      event_card: "بطاقة مناسبة",
      test_request: "طلب اختبار",
      unknown: "غير معروف",
    };
    const key = String(kind || "").trim();
    return map[key] || key || "غير معروف";
  }

  function statusLabel(status) {
    if (status === "pending") return "انتظار";
    if (status === "approved") return "قبول";
    if (status === "rejected") return "رفض";
    return status || "";
  }

  function coerceRpcId(v) {
    if (v == null) return "";
    if (typeof v === "number" && Number.isFinite(v)) return v;
    const s = String(v || "").trim();
    if (!s) return "";
    if (/^-?\d+$/.test(s)) return s;
    return s;
  }

  function tokenFromRpcResult(data) {
    if (!data) return "";
    if (typeof data === "string") return String(data || "").trim();
    if (typeof data === "object") {
      if (data.token) return String(data.token || "").trim();
      if (data.request_id) return String(data.request_id || "").trim();
      if (data.id) return String(data.id || "").trim();
    }
    return "";
  }

  window.AlzidanAdminCore = Object.assign(window.AlzidanAdminCore || {}, {
    normalizeEmail,
    isLikelyEmail,
    copyText,
    downloadTextFile,
    truncateText,
    takeLines,
    parseCsv,
    coerceBool,
    normalizeArabicDigitsToLatin,
    pickRowValue,
    toIntOrNull,
    toIsoDateOrEmpty,
    chunkArray,
    formatDateTimeArSaVerbose,
    getClient,
    escapeHtml,
    kindLabel,
    statusLabel,
    coerceRpcId,
    tokenFromRpcResult,
  });
})();
