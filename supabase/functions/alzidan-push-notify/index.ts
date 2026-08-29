const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://wbskjfdqpugnwvrykqcn.supabase.co";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
/** Optional. Required when Expo "Enhanced push security" is on; recommended always. */
const EXPO_ACCESS_TOKEN = String(Deno.env.get("EXPO_ACCESS_TOKEN") || "").trim();
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const DELEGATE_PORTAL_URL =
  Deno.env.get("DELEGATE_PORTAL_URL") ||
  "https://alzidan.org/pages/alzidan-tree.html?view=delegate";
const ADMIN_PORTAL_URL =
  Deno.env.get("ADMIN_PORTAL_URL") || "https://alzidan.org/pages/admin.html";
const FALLBACK_ADMIN_NOTIFY_PHONE = String(Deno.env.get("ADMIN_NOTIFY_PHONE") || "").trim();

// Browser admin (localhost:8080 / alzidan.org) calls via supabase.functions.invoke.
// Preflight OPTIONS must return ACAO; gateway JWT reject paths often omit CORS — deploy with --no-verify-jwt.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, prefer, x-supabase-client-platform, x-supabase-client-platform-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function normalizeType(value: unknown) {
  return normalizeText(value).toLowerCase();
}

function normalizeBranchKey(v: unknown) {
  return String(v || "").trim().replace(/\s+/g, " ");
}

function requestLabel(kind: string) {
  const k = normalizeText(kind).toLowerCase();
  const map: Record<string, string> = {
    event_card: "إضافة مناسبة",
    family_event: "إضافة مناسبة",
    event_request: "إضافة مناسبة",
    occasion: "إضافة مناسبة",
    patient: "حالة صحية",
    health: "حالة صحية",
    event_death: "إشعار وفاة",
    tree_card: "إضافة فرد",
    add_person: "إضافة فرد",
    tree_edit: "تصحيح بيانات",
    memory_card: "ذكرى",
    memory: "ذكرى",
    special_card: "طلب بطاقة",
    tree_founder: "مؤسس في الشجرة",
    org_role: "عضوية",
    member_phone_register: "تسجيل جوال",
    member_registration: "تسجيل عضوية",
    tree_delegate: "مندوب شجرة",
    events_delegate: "مندوب مناسبات",
    test_request: "طلب اختبار",
    delegate_secret_reset: "إعادة تعيين رقم سري",
  };
  // Empty string = unknown → callers must block send (no soft fallback).
  return map[k] || "";
}

function isInternalAuditKind(kind: unknown) {
  const k = normalizeText(kind).toLowerCase();
  // Empty kind is NOT audit — family broadcast payloads use type/person, not kind.
  if (!k) return false;
  return (
    k === "events_audit" ||
    k === "tree_audit" ||
    k === "audit" ||
    k.endsWith("_audit") ||
    k.startsWith("eva-") ||
    k.startsWith("aud-")
  );
}

function isKnownPushKind(kind: unknown) {
  return !!requestLabel(String(kind || "")) && !isInternalAuditKind(kind);
}

function safePushDisplay(raw: unknown) {
  const s = normalizeText(raw).slice(0, 80);
  if (!s) return "";
  if (/__JSON__|events_audit|[{}\[\]]|"v"\s*:|Failed to|not allowed|Supabase/i.test(s)) return "";
  if (!/[\u0600-\u06FF]/.test(s) && !/^[0-9\s\-_/]+$/.test(s)) return "";
  return s;
}

/** Mandatory push renderer — null means DO NOT SEND. Never uses message. */
function safeRenderPush(input: {
  mode: string;
  kind: string;
  status?: string;
  branch_key?: string;
  person?: string;
  name?: string;
  reject_reason?: string;
}): { title: string; body: string; kindLabel: string } | null {
  const mode = normalizeText(input.mode).toLowerCase();
  const kind = normalizeText(input.kind).toLowerCase();
  const kindLabel = requestLabel(kind);
  if (!kindLabel || isInternalAuditKind(kind)) {
    console.warn("[alzidan-push-notify] blocked unknown/internal kind", kind, mode);
    return null;
  }
  const branch = safePushDisplay(input.branch_key);
  const person = safePushDisplay(input.person || input.name);
  let status = normalizeText(input.status).toLowerCase();
  if (status === "accepted" || status === "applied" || status === "done") status = "approved";
  if (status === "denied") status = "rejected";
  if (status === "postponed") status = "deferred";
  if (status === "needs-changes" || status === "changes_requested") status = "needs_changes";

  if (mode === "status_changed") {
    if (status !== "approved" && status !== "rejected" && status !== "deferred" && status !== "needs_changes") return null;
    const isDelegateKind = kind === "tree_delegate" || kind === "events_delegate";
    const statusLabel =
      status === "approved" ? "تمت الموافقة" : status === "rejected" ? "تم الرفض" : status === "needs_changes" ? "يحتاج تعديل" : "مؤجل";
    const title = isDelegateKind
      ? status === "approved"
        ? `تم قبولك كمندوب — ${kindLabel}`
        : status === "rejected"
          ? `تم رفض طلب المندوبية — ${kindLabel}`
          : `تحديث طلب المندوبية — ${kindLabel}`
      : `تحديث طلبك: ${statusLabel} — ${kindLabel}`;
    const bodyParts = isDelegateKind
      ? [
          status === "approved"
            ? "تم قبول طلبك كمندوب في عائلة الزيدان."
            : status === "rejected"
              ? "تم رفض طلبك كمندوب في عائلة الزيدان."
              : "تم تحديث حالة طلب المندوبية.",
          `النوع: ${kindLabel}`,
        ]
      : [
          "تحديث طلبك في عائلة الزيدان",
          `نوع الطلب: ${kindLabel}`,
        ];
    if (branch) bodyParts.push(`الفرع: ${branch}`);
    if (person) bodyParts.push(isDelegateKind ? `الاسم: ${person}` : `الموضوع: ${person}`);
    if (!isDelegateKind) bodyParts.push(`الحالة: ${statusLabel}`);
    const reason = safePushDisplay(input.reject_reason);
    if ((status === "rejected" || status === "needs_changes") && reason) bodyParts.push(`السبب: ${reason}`);
    return { title, body: bodyParts.join(" · "), kindLabel };
  }

  if (mode === "branch_delegate_new_request") {
    if (!branch) return null;
    return {
      title: "طلب جديد يحتاج مراجعتك",
      body: `وصل طلب «${kindLabel}» لفرع ${branch} ويحتاج مراجعتك.`,
      kindLabel,
    };
  }

  if (mode === "admin_new_request") {
    return {
      title: "طلب جديد بانتظار اعتمادك",
      body: `وصل طلب «${kindLabel}»${branch ? ` لفرع ${branch}` : ""}.`,
      kindLabel,
    };
  }

  if (mode === "women_manager_new_request") {
    return {
      title: "طلب يحتاج مراجعتك",
      body: branch
        ? `وصل طلب «${kindLabel}» لفرع ${branch}.`
        : `وصل طلب «${kindLabel}».`,
      kindLabel,
    };
  }

  return null;
}

function buildDelegatePortalUrl(branchKey: string, requestId: string) {
  const url = new URL(DELEGATE_PORTAL_URL);
  if (branchKey) url.searchParams.set("branch", branchKey);
  if (requestId) url.searchParams.set("request_id", requestId);
  if (!url.searchParams.get("view")) url.searchParams.set("view", "delegate");
  return url.toString();
}

function buildAdminPortalUrl(requestId: string) {
  const url = new URL(ADMIN_PORTAL_URL);
  if (requestId) url.searchParams.set("request_id", requestId);
  return url.toString();
}

/** Match web/mobile Saudi phone normalize (Arabic digits → 05XXXXXXXX). */
function normalizeSaudiPhone(value: unknown) {
  let s = String(value ?? "");
  const map: Record<string, string> = {
    "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
    "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
    "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
    "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
    "０": "0", "１": "1", "２": "2", "３": "3", "４": "4",
    "５": "5", "６": "6", "７": "7", "８": "8", "９": "9",
  };
  s = s.replace(/[٠-٩۰-۹０-９]/g, (ch) => map[ch] || ch);
  let digits = s.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "").replace(/[^0-9]/g, "");
  if (!digits) return "";
  if (digits.startsWith("00966") && digits.length === 14 && digits.charAt(5) === "5") {
    return "0" + digits.slice(5);
  }
  if (digits.startsWith("966") && digits.length === 12 && digits.charAt(3) === "5") {
    return "0" + digits.slice(3);
  }
  if (digits.charAt(0) === "5" && digits.length === 9) {
    return "0" + digits;
  }
  if (digits.startsWith("05") && digits.length === 10) {
    return digits;
  }
  return digits;
}

function formatFormalNotificationText(input: {
  type?: unknown;
  person?: unknown;
  fallbackTitle?: unknown;
  fallbackBody?: unknown;
}) {
  const type = normalizeType(input.type);
  const person = normalizeText(input.person);
  const fallbackBody = normalizeText(input.fallbackBody);

  if (type === "birth" || type === "aqiqa") {
    return {
      typeLabel: "مولود جديد",
      subject: person || "مولود جديد",
      title: "مولود جديد",
      body: person ? `وُلد ${person}.` : "خبر مولود جديد في العائلة.",
    };
  }

  if (type === "death" || type === "condolence") {
    return {
      typeLabel: "وفاة",
      subject: person || "وفاة",
      title: "إنا لله وإنا إليه راجعون",
      body: person ? person : "خبر وفاة في العائلة.",
    };
  }

  if (type === "sick" || type === "operation" || type === "discharge" || type === "healing" || type === "health") {
    return {
      typeLabel: "حالة صحية",
      subject: person || "حالة صحية",
      title: "حالة صحية",
      body: person ? person : "خبر حالة صحية في العائلة.",
    };
  }

  if (type === "marriage" || type === "wedding" || type === "contract") {
    return {
      typeLabel: "زواج",
      subject: person || "زواج",
      title: "زواج",
      body: person ? person : "مناسبة زواج في العائلة.",
    };
  }

  if (
    type === "graduation" ||
    type === "graduation_notice" ||
    type === "promotion" ||
    type === "promotion_notice" ||
    type === "family_news" ||
    type === "news" ||
    type === "general" ||
    type === "success" ||
    type === "achievement"
  ) {
    return {
      typeLabel: "خبر عائلي",
      subject: person || "خبر عائلي",
      title: "خبر عائلي",
      body: person || fallbackBody || "خبر جديد في العائلة.",
    };
  }

  return {
    typeLabel: "مناسبة",
    subject: person || "مناسبة",
    title: "مناسبة",
    body: person || fallbackBody || "مناسبة جديدة في العائلة.",
  };
}

async function fetchEnabledTokens() {
  if (!SERVICE_ROLE_KEY) {
    throw new Error("missing_service_role_key");
  }

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/push_tokens?select=token,platform&enabled=eq.true`,
    {
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        Accept: "application/json",
      },
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`push_tokens fetch failed: ${body}`);
  }

  return await res.json();
}

async function fetchEnabledTokensWithPhone() {
  if (!SERVICE_ROLE_KEY) {
    throw new Error("missing_service_role_key");
  }

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/push_tokens?select=token,platform,phone&enabled=eq.true&phone=not.is.null`,
    {
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        Accept: "application/json",
      },
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`push_tokens phone fetch failed: ${body}`);
  }

  return await res.json();
}

/** Approved/active delegate phones for a branch (delegates_v2 + legacy approval_requests). */
async function fetchBranchDelegatePhones(branchKey: string): Promise<string[]> {
  if (!SERVICE_ROLE_KEY || !branchKey) return [];
  const phones = new Set<string>();
  const headers = {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    Accept: "application/json",
  };

  try {
    const q1 =
      `${SUPABASE_URL}/rest/v1/delegates_v2` +
      `?select=phone,branch_key,is_enabled` +
      `&is_enabled=eq.true` +
      `&branch_key=eq.${encodeURIComponent(branchKey)}` +
      `&phone=not.is.null`;
    const r1 = await fetch(q1, { headers });
    if (r1.ok) {
      const rows = await r1.json();
      for (const row of rows || []) {
        const phone = normalizeSaudiPhone(row?.phone);
        if (phone) phones.add(phone);
      }
    }
  } catch (_) {}

  try {
    const q2 =
      `${SUPABASE_URL}/rest/v1/approval_requests` +
      `?select=phone,branch_key,kind,status` +
      `&status=eq.approved` +
      `&kind=in.(tree_delegate,events_delegate)` +
      `&branch_key=eq.${encodeURIComponent(branchKey)}` +
      `&phone=not.is.null` +
      `&limit=50`;
    const r2 = await fetch(q2, { headers });
    if (r2.ok) {
      const rows = await r2.json();
      for (const row of rows || []) {
        const phone = normalizeSaudiPhone(row?.phone);
        if (phone) phones.add(phone);
      }
    }
  } catch (_) {}

  return Array.from(phones);
}

/** Admin/central phones from email_settings (+ optional env fallback). */
async function fetchAdminNotifyPhones(): Promise<string[]> {
  const phones = new Set<string>();
  const envPhone = normalizeSaudiPhone(FALLBACK_ADMIN_NOTIFY_PHONE);
  if (envPhone) phones.add(envPhone);

  if (!SERVICE_ROLE_KEY) return Array.from(phones);

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/email_settings?select=key,value`, {
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        Accept: "application/json",
      },
    });
    if (res.ok) {
      const rows = await res.json();
      for (const row of rows || []) {
        const key = String(row?.key || "").trim().toLowerCase();
        if (
          key === "admin_notify_phone" ||
          key === "admin_notify_phones" ||
          key === "admin_phone"
        ) {
          String(row?.value || "")
            .split(/[,;\s]+/)
            .map((p) => normalizeSaudiPhone(p))
            .filter(Boolean)
            .forEach((p) => phones.add(p));
        }
      }
    }
  } catch (_) {}

  for (const phone of await fetchFamilyAdminGrantPhones()) {
    phones.add(phone);
  }

  return Array.from(phones);
}

async function fetchWomenManagerPhones(): Promise<string[]> {
  if (!SERVICE_ROLE_KEY) return [];
  const phones = new Set<string>();
  const headers = {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    Accept: "application/json",
  };
  try {
    const grantsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/member_role_grants?select=tree_child_id,person_id&role_key=eq.women_manager&status=eq.active`,
      { headers },
    );
    if (!grantsRes.ok) return [];
    const grants = await grantsRes.json();
    const childIds = [
      ...new Set(
        (grants || [])
          .map((row: { tree_child_id?: number }) => Number(row?.tree_child_id || 0))
          .filter((id: number) => id > 0),
      ),
    ];
    if (!childIds.length) return [];
    const profilesRes = await fetch(
      `${SUPABASE_URL}/rest/v1/member_profiles?select=phone,tree_child_id&tree_child_id=in.(${childIds.join(",")})&phone=not.is.null`,
      { headers },
    );
    if (!profilesRes.ok) return [];
    const rows = await profilesRes.json();
    for (const row of rows || []) {
      const phone = normalizeSaudiPhone(row?.phone);
      if (phone) phones.add(phone);
    }
  } catch (_) {}
  return Array.from(phones);
}

async function fetchFamilyAdminGrantPhones(): Promise<string[]> {
  if (!SERVICE_ROLE_KEY) return [];
  const phones = new Set<string>();
  const headers = {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    Accept: "application/json",
  };
  try {
    const grantsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/member_role_grants?select=tree_child_id,person_id&role_key=eq.family_admin&status=eq.active`,
      { headers },
    );
    if (!grantsRes.ok) return [];
    const grants = await grantsRes.json();
    const childIds = [
      ...new Set(
        (grants || [])
          .map((row: { tree_child_id?: number }) => Number(row?.tree_child_id || 0))
          .filter((id: number) => id > 0),
      ),
    ];
    if (!childIds.length) return [];
    const profilesRes = await fetch(
      `${SUPABASE_URL}/rest/v1/member_profiles?select=phone,tree_child_id&tree_child_id=in.(${childIds.join(",")})&phone=not.is.null`,
      { headers },
    );
    if (!profilesRes.ok) return [];
    const rows = await profilesRes.json();
    for (const row of rows || []) {
      const phone = normalizeSaudiPhone(row?.phone);
      if (phone) phones.add(phone);
    }
  } catch (_) {}
  return Array.from(phones);
}

function phonesToMatchSet(list: string[]) {
  const wanted = new Set<string>();
  for (const raw of list) {
    const n = normalizeSaudiPhone(raw);
    if (!n) continue;
    wanted.add(n);
    if (n.length >= 9) wanted.add(n.slice(-9));
  }
  return wanted;
}

function tokenPhoneInSet(
  row: { phone?: string },
  wanted: Set<string>,
) {
  const phone = normalizeSaudiPhone(row?.phone);
  if (!phone) return false;
  if (wanted.has(phone)) return true;
  if (phone.length >= 9 && wanted.has(phone.slice(-9))) return true;
  return false;
}

async function fetchHouseholdPhones(): Promise<string[]> {
  if (!SERVICE_ROLE_KEY) return [];
  const phones = new Set<string>();
  const headers = {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    Accept: "application/json",
  };
  try {
    const membersRes = await fetch(
      `${SUPABASE_URL}/rest/v1/member_profiles?select=phone,status&phone=not.is.null`,
      { headers },
    );
    if (membersRes.ok) {
      const rows = await membersRes.json();
      for (const row of rows || []) {
        const status = String(row?.status || "active").trim().toLowerCase();
        if (status && status !== "active" && status !== "approved") continue;
        const phone = normalizeSaudiPhone(row?.phone);
        if (phone) phones.add(phone);
      }
    }
  } catch (_) {}
  try {
    const delRes = await fetch(
      `${SUPABASE_URL}/rest/v1/delegates_v2?select=phone&is_enabled=eq.true&phone=not.is.null`,
      { headers },
    );
    if (delRes.ok) {
      const rows = await delRes.json();
      for (const row of rows || []) {
        const phone = normalizeSaudiPhone(row?.phone);
        if (phone) phones.add(phone);
      }
    }
  } catch (_) {}
  return Array.from(phones);
}

async function disableToken(token: string) {
  if (!SERVICE_ROLE_KEY || !token) return;

  await fetch(`${SUPABASE_URL}/rest/v1/push_tokens?token=eq.${encodeURIComponent(token)}`, {
    method: "PATCH",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ enabled: false, updated_at: new Date().toISOString() }),
  });
}

/** Expo ticket errors that mean the device token is dead and should be disabled. */
const INVALID_TOKEN_ERRORS = new Set([
  "DeviceNotRegistered",
]);

/**
 * In-process + optional DB dedupe for same event_key+token
 * (clients sometimes invoke notify twice for one request).
 */
const recentSendClaims = new Map<string, number>();
const DEDUPE_TTL_MS = 15 * 60 * 1000;

function buildEventKey(mode: string, requestId: string, kind = "") {
  const id = normalizeText(requestId);
  if (!id) return "";
  return `${normalizeText(mode)}|${id}|${normalizeText(kind)}`;
}

function pruneRecentClaims(now = Date.now()) {
  for (const [key, ts] of recentSendClaims) {
    if (now - ts > DEDUPE_TTL_MS) recentSendClaims.delete(key);
  }
}

/**
 * Returns true if this event+token should be sent (first claim wins).
 * Uses optional public.push_send_dedupe when present; always uses in-memory fallback.
 */
async function claimEventTokenSend(eventKey: string, token: string): Promise<boolean> {
  const t = normalizeText(token);
  if (!eventKey || !t) return true;

  const memKey = `${eventKey}|${t}`;
  const now = Date.now();
  pruneRecentClaims(now);
  if (recentSendClaims.has(memKey)) return false;

  if (SERVICE_ROLE_KEY) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/push_send_dedupe`, {
        method: "POST",
        headers: {
          apikey: SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=representation,resolution=ignore-duplicates",
        },
        body: JSON.stringify({
          event_key: eventKey,
          token: t,
          created_at: new Date().toISOString(),
        }),
      });
      // Table missing / RLS — fall back to memory only.
      if (res.status !== 404 && res.status !== 401 && res.status !== 403) {
        const body = await res.json().catch(() => []);
        const inserted = Array.isArray(body) ? body.length > 0 : Boolean(body);
        if (res.ok && !inserted) {
          // ignore-duplicates → empty representation means already claimed
          recentSendClaims.set(memKey, now);
          return false;
        }
        if (!res.ok && res.status === 409) {
          recentSendClaims.set(memKey, now);
          return false;
        }
      }
    } catch (_) {
      // memory fallback below
    }
  }

  recentSendClaims.set(memKey, now);
  return true;
}

function matchTokensForPhones(
  tokenRows: Array<{ token?: string; phone?: string; platform?: string }>,
  phoneSet: Set<string>,
) {
  const wanted = new Set<string>();
  for (const p of phoneSet) {
    const n = normalizeSaudiPhone(p);
    if (!n) continue;
    wanted.add(n);
    if (n.length >= 9) wanted.add(n.slice(-9));
  }

  const matched = (Array.isArray(tokenRows) ? tokenRows : []).filter((row) => {
    const phone = normalizeSaudiPhone(row?.phone);
    if (!phone) return false;
    if (wanted.has(phone)) return true;
    if (phone.length >= 9 && wanted.has(phone.slice(-9))) return true;
    return false;
  });

  // Dedupe by token string within this send set
  const seen = new Set<string>();
  const unique = matched.filter((row) => {
    const t = String(row?.token || "").trim();
    if (!t || seen.has(t)) return false;
    seen.add(t);
    return true;
  });

  return {
    tokens_with_phone: (Array.isArray(tokenRows) ? tokenRows : []).length,
    matched,
    unique,
  };
}

async function sendExpoPush(messages: Record<string, unknown>[]) {
  if (!messages.length) return { data: [] };

  const headers: Record<string, string> = {
    Accept: "application/json",
    "Accept-Encoding": "gzip, deflate",
    "Content-Type": "application/json",
  };
  // Expo recommends Authorization when an access token exists (required if push security is enabled).
  if (EXPO_ACCESS_TOKEN) {
    headers.Authorization = `Bearer ${EXPO_ACCESS_TOKEN}`;
  }

  const res = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(messages),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Expo push failed: ${JSON.stringify(body)}`);
  }

  return body;
}

async function deliverMessages(
  messages: Record<string, unknown>[],
  dryRun: boolean,
  extra: Record<string, unknown> = {},
) {
  if (!messages.length) {
    return json({ ok: true, skipped: "no_recipients", recipients: 0, ...extra });
  }

  if (dryRun) {
    return json({
      ok: true,
      dry_run: true,
      recipients: messages.length,
      ...extra,
    });
  }

  const chunks: Record<string, unknown>[][] = [];
  for (let i = 0; i < messages.length; i += 100) {
    chunks.push(messages.slice(i, i + 100));
  }

  let sent = 0;
  let ticketOk = 0;
  let ticketError = 0;
  let disabled = 0;
  const errors: string[] = [];

  for (const chunk of chunks) {
    const result = await sendExpoPush(chunk);
    const tickets = Array.isArray(result?.data) ? result.data : [];
    sent += chunk.length;

    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i] || {};
      const status = String(ticket.status || "");
      if (status === "ok") {
        ticketOk += 1;
        continue;
      }
      if (status === "error") {
        ticketError += 1;
        const detail = String(ticket.details?.error || ticket.message || "unknown");
        errors.push(detail);
        if (INVALID_TOKEN_ERRORS.has(detail)) {
          const token = String(chunk[i]?.to || "");
          if (token) {
            await disableToken(token);
            disabled += 1;
          }
        }
      }
    }
  }

  const ok = ticketError === 0 || ticketOk > 0;
  return json({
    ok,
    sent: ticketOk > 0 ? ticketOk : sent,
    attempted: sent,
    ticket_ok: ticketOk,
    ticket_error: ticketError,
    disabled,
    expo_access_token_configured: Boolean(EXPO_ACCESS_TOKEN),
    errors: errors.length ? errors.slice(0, 10) : undefined,
    ...extra,
  });
}

/**
 * Targeted: only Expo tokens whose phone matches approved/active branch delegates.
 * Does NOT broadcast to all family tokens.
 */
async function notifyBranchDelegateNewRequest(payload: Record<string, unknown>, dryRun: boolean) {
  const record = (payload.record && typeof payload.record === "object"
    ? payload.record
    : payload) as Record<string, unknown>;
  const branchKey = normalizeBranchKey(record.branch_key || payload.branch_key);
  if (!branchKey) {
    return json({ ok: true, skipped: "missing_branch_key", mode: "branch_delegate_new_request" });
  }

  // البطاقة / special_card → central admin only (do not push branch delegates).
  const kind = normalizeText(record.kind || payload.kind);
  const branchNotifyKinds = new Set([
    "event_card",
    "family_event",
    "event_request",
    "occasion",
    "patient",
    "health",
    "event_death",
    "tree_card",
    "add_person",
    "tree_edit",
    "memory_card",
    "memory",
    "tree_founder",
    "member_phone_register",
    "member_registration",
  ]);
  if (kind && !branchNotifyKinds.has(kind)) {
    return json({
      ok: true,
      skipped: "kind_admin_only",
      mode: "branch_delegate_new_request",
      kind,
      branch_key: branchKey,
    });
  }

  const delegatePhones = await fetchBranchDelegatePhones(branchKey);
  if (!delegatePhones.length) {
    return json({
      ok: true,
      skipped: "no_branch_delegate_phones",
      mode: "branch_delegate_new_request",
      branch_key: branchKey,
    });
  }

  const phoneSet = new Set(delegatePhones);
  const tokenRows = await fetchEnabledTokensWithPhone();
  const matched = matchTokensForPhones(tokenRows, phoneSet);
  const adminSkip = phonesToMatchSet(await fetchAdminNotifyPhones());
  const unique = matched.unique.filter((row) => !tokenPhoneInSet(row, adminSkip));
  const tokens_with_phone = matched.tokens_with_phone;

  const kindLabel = requestLabel(kind);
  if (!kindLabel || !isKnownPushKind(kind)) {
    return json({
      ok: true,
      skipped: "unknown_kind_blocked",
      mode: "branch_delegate_new_request",
      kind,
      branch_key: branchKey,
    });
  }
  const rendered = safeRenderPush({
    mode: "branch_delegate_new_request",
    kind,
    branch_key: branchKey,
    person: String(record.name || record.person || ""),
  });
  if (!rendered) {
    return json({ ok: true, skipped: "safe_render_blocked", mode: "branch_delegate_new_request", kind });
  }
  const requestId = normalizeText(record.request_id);
  const eventKey = buildEventKey("branch_delegate_new_request", requestId, kind);
  const title = rendered.title;
  const body = rendered.body;
  const portalUrl = buildDelegatePortalUrl(branchKey, requestId);
  const data = {
    mode: "branch_delegate_new_request",
    type: "branch_delegate_new_request",
    notification_type: "branch_delegate_new_request",
    branch_key: branchKey,
    screen: "delegate",
    url: portalUrl,
    request_id: requestId,
    // Keep kind for routing; clients must not display it raw.
    kind,
    kind_label: kindLabel,
  };

  let deduped = 0;
  const messages: Record<string, unknown>[] = [];
  for (const row of unique) {
    const token = String(row?.token || "").trim();
    if (!token) continue;
    if (!dryRun) {
      const claim = await claimEventTokenSend(eventKey, token);
      if (!claim) {
        deduped += 1;
        continue;
      }
    }
    const message: Record<string, unknown> = {
      to: token,
      sound: "default",
      title,
      body,
      data,
      priority: "high",
    };
    if (row.platform === "android") {
      message.channelId = "family-events";
    }
    messages.push(message);
  }

  return await deliverMessages(messages, dryRun, {
    mode: "branch_delegate_new_request",
    branch_key: branchKey,
    delegate_phones: delegatePhones.length,
    tokens_with_phone,
    matched_tokens: unique.length,
    recipients_after_dedupe: messages.length,
    deduped,
    portal_url: portalUrl,
    title,
    body,
  });
}

/**
 * Targeted: Expo tokens whose phone matches configured admin notify phones.
 * Used for central-only kinds such as special_card.
 */
async function notifyAdminNewRequest(payload: Record<string, unknown>, dryRun: boolean) {
  const record = (payload.record && typeof payload.record === "object"
    ? payload.record
    : payload) as Record<string, unknown>;
  const kind = normalizeText(record.kind || payload.kind);
  const kindLabel = requestLabel(kind);
  const requestId = normalizeText(record.request_id);
  const branchKey = normalizeBranchKey(record.branch_key || payload.branch_key);
  const eventKey = buildEventKey("admin_new_request", requestId, kind);

  if (!kindLabel || !isKnownPushKind(kind)) {
    return json({ ok: true, skipped: "unknown_kind_blocked", mode: "admin_new_request", kind });
  }

  const adminPhones = await fetchAdminNotifyPhones();
  if (!adminPhones.length) {
    return json({
      ok: true,
      skipped: "no_admin_notify_phones",
      mode: "admin_new_request",
      kind,
    });
  }

  const phoneSet = new Set(adminPhones);
  const tokenRows = await fetchEnabledTokensWithPhone();
  const { tokens_with_phone, unique } = matchTokensForPhones(tokenRows, phoneSet);

  const rendered = safeRenderPush({
    mode: "admin_new_request",
    kind,
    branch_key: branchKey,
    person: String(record.name || record.person || ""),
  });
  if (!rendered) {
    return json({ ok: true, skipped: "safe_render_blocked", mode: "admin_new_request", kind });
  }

  const title = rendered.title;
  const body = rendered.body;
  const portalUrl = buildAdminPortalUrl(requestId);
  const data = {
    mode: "admin_new_request",
    type: "admin_new_request",
    notification_type: "admin_new_request",
    branch_key: branchKey,
    screen: "admin",
    url: portalUrl,
    request_id: requestId,
    kind,
    kind_label: kindLabel,
  };

  let deduped = 0;
  const messages: Record<string, unknown>[] = [];
  for (const row of unique) {
    const token = String(row?.token || "").trim();
    if (!token) continue;
    if (!dryRun) {
      const claim = await claimEventTokenSend(eventKey, token);
      if (!claim) {
        deduped += 1;
        continue;
      }
    }
    const message: Record<string, unknown> = {
      to: token,
      sound: "default",
      title,
      body,
      data,
      priority: "high",
    };
    if (row.platform === "android") {
      message.channelId = "family-events";
    }
    messages.push(message);
  }

  return await deliverMessages(messages, dryRun, {
    mode: "admin_new_request",
    kind,
    admin_phones: adminPhones.length,
    tokens_with_phone,
    matched_tokens: unique.length,
    recipients_after_dedupe: messages.length,
    deduped,
    portal_url: portalUrl,
    title,
    body,
  });
}

async function notifyWomenManagerNewRequest(payload: Record<string, unknown>, dryRun: boolean) {
  const record = (payload.record && typeof payload.record === "object"
    ? payload.record
    : payload) as Record<string, unknown>;
  const kind = normalizeText(record.kind || payload.kind);
  const womenKinds = new Set(["member_phone_register", "member_registration"]);
  if (!womenKinds.has(kind)) {
    return json({ ok: true, skipped: "kind_not_for_women_manager", mode: "women_manager_new_request", kind });
  }
  const kindLabel = requestLabel(kind);
  if (!kindLabel) {
    return json({ ok: true, skipped: "unknown_kind_blocked", mode: "women_manager_new_request", kind });
  }
  const requestId = normalizeText(record.request_id);
  const branchKey = normalizeBranchKey(record.branch_key || payload.branch_key);
  const eventKey = buildEventKey("women_manager_new_request", requestId, kind);

  const managerPhones = await fetchWomenManagerPhones();
  if (!managerPhones.length) {
    return json({
      ok: true,
      skipped: "no_women_manager_phones",
      mode: "women_manager_new_request",
      kind,
    });
  }

  const phoneSet = new Set(managerPhones);
  const tokenRows = await fetchEnabledTokensWithPhone();
  const matched = matchTokensForPhones(tokenRows, phoneSet);
  const adminSkip = phonesToMatchSet(await fetchAdminNotifyPhones());
  const delegateSkip = phonesToMatchSet(
    branchKey ? await fetchBranchDelegatePhones(branchKey) : [],
  );
  const skip = new Set([...adminSkip, ...delegateSkip]);
  const unique = matched.unique.filter((row) => !tokenPhoneInSet(row, skip));
  const tokens_with_phone = matched.tokens_with_phone;

  const rendered = safeRenderPush({
    mode: "women_manager_new_request",
    kind,
    branch_key: branchKey,
    person: String(record.name || record.person || ""),
  });
  if (!rendered) {
    return json({ ok: true, skipped: "safe_render_blocked", mode: "women_manager_new_request", kind });
  }

  const title = rendered.title;
  const body = rendered.body;
  const data = {
    mode: "women_manager_new_request",
    type: "women_manager_new_request",
    notification_type: "women_manager_new_request",
    branch_key: branchKey,
    screen: "womenAdmin",
    request_id: requestId,
    kind,
    kind_label: kindLabel,
  };

  let deduped = 0;
  const messages: Record<string, unknown>[] = [];
  for (const row of unique) {
    const token = String(row?.token || "").trim();
    if (!token) continue;
    if (!dryRun) {
      const claim = await claimEventTokenSend(eventKey, token);
      if (!claim) {
        deduped += 1;
        continue;
      }
    }
    const message: Record<string, unknown> = {
      to: token,
      sound: "default",
      title,
      body,
      data,
      priority: "high",
    };
    if (row.platform === "android") {
      message.channelId = "family-events";
    }
    messages.push(message);
  }

  return await deliverMessages(messages, dryRun, {
    mode: "women_manager_new_request",
    kind,
    manager_phones: managerPhones.length,
    tokens_with_phone,
    matched_tokens: unique.length,
    recipients_after_dedupe: messages.length,
    deduped,
    title,
    body,
  });
}

/** End-user (requester / SUBMITTER) status push — mandatory safe renderer; never raw message. */
async function notifyRequesterStatusChanged(payload: Record<string, unknown>, dryRun: boolean) {
  const record = (payload.record && typeof payload.record === "object"
    ? payload.record
    : payload) as Record<string, unknown>;

  const kind = normalizeText(record.kind || payload.kind);
  if (!isKnownPushKind(kind)) {
    return json({ ok: true, skipped: "unknown_or_internal_kind_blocked", mode: "status_changed", kind });
  }

  const status = normalizeText(record.status || payload.status).toLowerCase();
  const rendered = safeRenderPush({
    mode: "status_changed",
    kind,
    status,
    branch_key: String(record.branch_key || ""),
    person: String(record.person || record.name || ""),
    reject_reason: String(record.reject_reason || record.rejection_reason || ""),
  });
  if (!rendered) {
    return json({ ok: true, skipped: "safe_render_blocked", mode: "status_changed", kind, status });
  }

  const requestId = normalizeText(record.request_id);
  const phone = normalizeSaudiPhone(
    record.phone || payload.submitter_phone || payload.phone,
  );
  if (!phone) {
    return json({ ok: true, skipped: "missing_request_phone", mode: "status_changed" });
  }

  const title = rendered.title;
  const body = rendered.body;
  const kindLabel = rendered.kindLabel;

  const tokenRows = await fetchEnabledTokensWithPhone();
  const phoneSet = new Set([phone]);
  const matchedInfo = matchTokensForPhones(tokenRows, phoneSet);
  const { unique } = matchedInfo;
  if (!unique.length) {
    return json({
      ok: true,
      skipped: "no_requester_push_tokens",
      mode: "status_changed",
      title,
      body,
      normalized_phone: phone,
      tokens_with_phone: matchedInfo.tokens_with_phone,
    });
  }

  const eventKey = buildEventKey("status_changed", requestId, kind + ":" + status);
  const data = {
    mode: "status_changed",
    type: "status_changed",
    notification_type: "status_changed",
    status: status === "approved" ? "approved" : status === "rejected" ? "rejected" : status === "needs_changes" ? "needs_changes" : "deferred",
    screen: "home",
    request_id: requestId,
    kind,
    kind_label: kindLabel,
  };

  let deduped = 0;
  const messages: Record<string, unknown>[] = [];
  for (const row of unique) {
    const token = String(row?.token || "").trim();
    if (!token) continue;
    if (!dryRun) {
      const claim = await claimEventTokenSend(eventKey, token);
      if (!claim) {
        deduped += 1;
        continue;
      }
    }
    const message: Record<string, unknown> = {
      to: token,
      sound: "default",
      title,
      body,
      data,
      priority: "high",
    };
    if (row.platform === "android") {
      message.channelId = "family-events";
    }
    messages.push(message);
  }

  return await deliverMessages(messages, dryRun, {
    mode: "status_changed",
    status: data.status,
    matched_tokens: unique.length,
    recipients_after_dedupe: messages.length,
    deduped,
    title,
    body,
  });
}

async function fetchOccasionRecipientPhones(occasionId: number): Promise<string[]> {
  if (!SERVICE_ROLE_KEY || occasionId < 1) return [];
  const phones = new Set<string>();
  const headers = {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    Accept: "application/json",
  };
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/occasion_recipients?select=recipient_phone,recipient_role,is_active&occasion_id=eq.${occasionId}&is_active=eq.true&recipient_phone=not.is.null`,
      { headers },
    );
    if (!res.ok) return [];
    const rows = await res.json();
    for (const row of rows || []) {
      const role = String(row?.recipient_role || "").trim().toLowerCase();
      if (role === "deceased") continue;
      const phone = normalizeSaudiPhone(row?.recipient_phone);
      if (phone) phones.add(phone);
    }
  } catch (_) {}
  return Array.from(phones);
}

/** Quiet inbox ping — no names (female names stay off lock screen). One per occasion+token. */
async function notifyInboxShare(payload: Record<string, unknown>, dryRun: boolean) {
  const occasionId = Number(payload.occasion_id || payload.occasionId || 0);
  if (!Number.isFinite(occasionId) || occasionId < 1) {
    return json({ ok: true, skipped: "missing_occasion_id", mode: "inbox_share" });
  }

  const explicit = normalizeSaudiPhone(payload.recipient_phone || payload.phone);
  const sender = normalizeSaudiPhone(payload.sender_phone || payload.senderPhone);
  let phones = explicit
    ? [explicit]
    : await fetchOccasionRecipientPhones(occasionId);
  if (sender) {
    phones = phones.filter((p) => {
      if (p === sender) return false;
      if (p.length >= 9 && sender.length >= 9 && p.slice(-9) === sender.slice(-9)) {
        return false;
      }
      return true;
    });
  }
  if (!phones.length) {
    return json({
      ok: true,
      skipped: "no_recipient_phones",
      mode: "inbox_share",
      occasion_id: occasionId,
    });
  }

  const tokenRows = await fetchEnabledTokensWithPhone();
  const { unique } = matchTokensForPhones(tokenRows, new Set(phones));
  if (!unique.length) {
    return json({
      ok: true,
      skipped: "no_recipient_push_tokens",
      mode: "inbox_share",
      occasion_id: occasionId,
    });
  }

  const title = "وصلك من العائلة";
  const body = "شاركك أحد مناسبة تخصك.";
  const eventKey = buildEventKey("inbox_share", String(occasionId), "inbox");
  const data = {
    mode: "inbox_share",
    type: "inbox_share",
    notification_type: "inbox_share",
    screen: "profile",
    occasion_id: occasionId,
  };

  let deduped = 0;
  const messages: Record<string, unknown>[] = [];
  for (const row of unique) {
    const token = String(row?.token || "").trim();
    if (!token) continue;
    if (!dryRun) {
      const claim = await claimEventTokenSend(eventKey, token);
      if (!claim) {
        deduped += 1;
        continue;
      }
    }
    const message: Record<string, unknown> = {
      to: token,
      sound: "default",
      title,
      body,
      data,
      priority: "high",
    };
    if (row.platform === "android") {
      message.channelId = "family-events";
    }
    messages.push(message);
  }

  return await deliverMessages(messages, dryRun, {
    mode: "inbox_share",
    occasion_id: occasionId,
    recipient_phones: phones.length,
    matched_tokens: unique.length,
    recipients_after_dedupe: messages.length,
    deduped,
    title,
    body,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: CORS_HEADERS });
  }

  try {
    if (req.method !== "POST") {
      return json({ ok: false, error: "method_not_allowed" }, 405);
    }

    const payload = await req.json().catch(() => ({}));
    const dryRun = payload.dry_run === true;
    let mode = normalizeText(payload.mode);
    const hookType = normalizeText(payload.type).toUpperCase();
    const recordObj =
      payload.record && typeof payload.record === "object" ? payload.record : payload;
    if (isInternalAuditKind(recordObj?.kind || payload.kind)) {
      return json({ ok: true, skipped: "internal_audit_kind", kind: recordObj?.kind });
    }
    if (hookType === "INSERT" || hookType === "UPDATE" || hookType === "DELETE") {
      if (
        hookType === "UPDATE" &&
        (normalizeText(recordObj?.status) === "approved" ||
          normalizeText(recordObj?.status) === "rejected")
      ) {
        mode = "status_changed";
      } else if (hookType === "INSERT" || hookType === "DELETE") {
        return json({ ok: true, skipped: "webhook_no_auto_push", type: hookType });
      }
    }

    // Private targeted path — MUST NOT fall through to family broadcast.
    if (mode === "branch_delegate_new_request") {
      return await notifyBranchDelegateNewRequest(payload, dryRun);
    }

    if (mode === "admin_new_request") {
      return await notifyAdminNewRequest(payload, dryRun);
    }

    if (mode === "women_manager_new_request") {
      return await notifyWomenManagerNewRequest(payload, dryRun);
    }

    if (mode === "status_changed") {
      return await notifyRequesterStatusChanged(payload, dryRun);
    }

    if (mode === "inbox_share") {
      return await notifyInboxShare(payload, dryRun);
    }

    // ---- Family-event broadcast: bound household phones only (not visitors). ----
    const type = normalizeText(payload.type);
    const person = normalizeText(payload.person);
    const branchKey = normalizeText(payload.branch_key);
    const detailsRaw = normalizeText(payload.details);
    // Never allow approval JSON / audit / technical blobs into broadcast body.
    const details =
      !detailsRaw ||
      /__JSON__|events_audit|secret_hash|[{}\[\]]|Failed to|Supabase|Edge Function/i.test(detailsRaw)
        ? ""
        : detailsRaw;

    if (!type && !person) {
      return json({ ok: true, skipped: "missing_event_fields" });
    }

    const formatted = formatFormalNotificationText({
      type,
      person,
      fallbackBody: details ? details.slice(0, 180) : undefined,
    });

    const householdPhones = await fetchHouseholdPhones();
    if (!householdPhones.length) {
      return json({ ok: true, skipped: "no_household_phones", recipients: 0, formatted });
    }
    const tokenRows = await fetchEnabledTokensWithPhone();
    const { unique: tokens } = matchTokensForPhones(
      tokenRows,
      new Set(householdPhones),
    );
    if (!tokens.length) {
      return json({
        ok: true,
        skipped: "no_member_push_tokens",
        recipients: 0,
        formatted,
        household_phones: householdPhones.length,
      });
    }

    const data = {
      type,
      person,
      branch_key: branchKey,
      screen: "events",
      notification_type: type,
      event_type: type,
    };

    const messages = tokens.map((row: { token?: string; platform?: string }) => {
      const message: Record<string, unknown> = {
        to: row.token,
        sound: "default",
        title: formatted.title,
        body: formatted.body,
        data,
        priority: "high",
      };
      if (row.platform === "android") {
        message.channelId = "family-events";
      }
      return message;
    });

    return await deliverMessages(messages, dryRun, { formatted });
  } catch (error) {
    return json({ ok: false, error: String(error?.message || error) }, 500);
  }
});
