const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://wbskjfdqpugnwvrykqcn.supabase.co";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const FALLBACK_ADMIN_NOTIFY_EMAIL = Deno.env.get("ADMIN_NOTIFY_EMAIL") || "admin@alzidan.org";
const FALLBACK_FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "notifications@alzidan.org";
const DELEGATE_PORTAL_URL =
  Deno.env.get("DELEGATE_PORTAL_URL") ||
  "https://alzidan.org/pages/alzidan-tree.html?view=delegate";
const ADMIN_PORTAL_URL =
  Deno.env.get("ADMIN_PORTAL_URL") || "https://alzidan.org/pages/admin.html";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function normalizeKind(kind: unknown) {
  return String(kind || "").trim().toLowerCase();
}

const KNOWN_KINDS: Record<string, { label: string; family: "content" | "privilege" }> = {
  event_card: { label: "إضافة مناسبة", family: "content" },
  family_event: { label: "إضافة مناسبة", family: "content" },
  event_request: { label: "إضافة مناسبة", family: "content" },
  occasion: { label: "إضافة مناسبة", family: "content" },
  patient: { label: "حالة صحية", family: "content" },
  event_death: { label: "إشعار وفاة", family: "content" },
  tree_card: { label: "إضافة فرد", family: "content" },
  add_person: { label: "إضافة فرد", family: "content" },
  tree_edit: { label: "تصحيح بيانات", family: "content" },
  memory_card: { label: "ذكرى", family: "content" },
  special_card: { label: "طلب بطاقة", family: "content" },
  tree_founder: { label: "مؤسس في الشجرة", family: "content" },
  org_role: { label: "عضوية/دور", family: "privilege" },
  tree_delegate: { label: "مندوب شجرة", family: "privilege" },
  events_delegate: { label: "مندوب مناسبات", family: "privilege" },
  test_request: { label: "طلب اختبار", family: "content" },
};

const STATUS_AR: Record<string, string> = {
  pending: "بانتظار المراجعة",
  approved: "تمت الموافقة",
  rejected: "تم الرفض",
  deferred: "مؤجل",
};

/** Internal audit / unknown — NEVER notify. */
function isInternalAuditKind(kind: unknown) {
  const k = normalizeKind(kind);
  return (
    !k ||
    k === "events_audit" ||
    k === "tree_audit" ||
    k === "audit" ||
    k.endsWith("_audit") ||
    k.startsWith("eva-") ||
    k.startsWith("aud-")
  );
}

function isKnownKind(kind: unknown) {
  const k = normalizeKind(kind);
  return !!(KNOWN_KINDS[k] && !isInternalAuditKind(k));
}

function requestLabel(kind: string) {
  const k = normalizeKind(kind);
  const meta = KNOWN_KINDS[k];
  // No soft fallback to raw kind or generic catch-all for unknown — callers must gate with isKnownKind.
  return meta ? meta.label : "";
}

function isAdminOnlyNotifyKind(kind: string) {
  const k = normalizeKind(kind);
  return (
    k === "special_card" ||
    k === "tree_delegate" ||
    k === "events_delegate" ||
    k === "org_role"
  );
}

function looksTechnicalText(raw: string) {
  const s = String(raw || "").trim();
  if (!s) return true;
  if (/[{}\[\]<>]|https?:\/\//i.test(s)) return true;
  if (/__JSON__|events_audit|tree_audit|secret_hash|request_pk|"op"\s*:|"kind"\s*:|"v"\s*:/i.test(s)) {
    return true;
  }
  if (/Failed to|Edge Function|Supabase|PGRST|JWT|RPC|SQL|JSON|not allowed/i.test(s)) return true;
  const latin = (s.match(/[A-Za-z]/g) || []).length;
  const arabic = (s.match(/[\u0600-\u06FF]/g) || []).length;
  if (latin > 0 && arabic === 0) return true;
  if (latin >= 8 && latin > arabic) return true;
  return false;
}

function safeArabicReason(raw: unknown) {
  const s = String(raw || "").trim().slice(0, 200);
  if (!s || looksTechnicalText(s)) return "";
  if (!/[\u0600-\u06FF]/.test(s)) return "";
  return s;
}

function safeDisplayName(raw: unknown) {
  const s = String(raw || "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!s || looksTechnicalText(s)) return "";
  if (/[A-Za-z0-9_]{12,}/.test(s) && !/[\u0600-\u06FF]/.test(s)) return "";
  if (!/[\u0600-\u06FF]/.test(s) && !/^[0-9\s\-_/]+$/.test(s)) return "";
  return s;
}

/**
 * MANDATORY safe renderer. Returns null → DO NOT SEND.
 * Never reads record.message.
 */
function safeRenderOutbound(input: {
  mode: string;
  kind: string;
  status?: string;
  branch_key?: string;
  person?: string;
  name?: string;
  reject_reason?: string;
  audience?: string;
}): { subject: string; title: string; body: string; text: string; kindLabel: string; statusLabel: string } | null {
  const mode = String(input.mode || "").trim().toLowerCase() || "status_changed";
  const kind = normalizeKind(input.kind);
  const audience = String(input.audience || "submitter").trim().toLowerCase() || "submitter";
  const meta = KNOWN_KINDS[kind];
  if (isInternalAuditKind(kind) || !meta) {
    console.warn("[alzidan-email-notify] blocked unknown/internal kind", kind, mode);
    return null;
  }
  const kindLabel = meta.label;
  const branch = safeDisplayName(input.branch_key || "");
  const person = safeDisplayName(input.person || input.name || "");
  const reason = safeArabicReason(input.reject_reason || "");
  let status = String(input.status || "").trim().toLowerCase();
  if (status === "accepted" || status === "applied" || status === "done") status = "approved";
  if (status === "denied") status = "rejected";
  if (status === "postponed") status = "deferred";

  if (mode === "status_changed") {
    if (audience !== "submitter") return null;
    if (status !== "approved" && status !== "rejected" && status !== "deferred") return null;
    const statusLabel = STATUS_AR[status] || "";
    if (!statusLabel) return null;
    const lines = [
      "تحديث طلبك في عائلة الزيدان",
      `نوع الطلب: ${kindLabel}`,
    ];
    if (branch) lines.push(`الفرع: ${branch}`);
    if (person) lines.push(`الموضوع: ${person}`);
    lines.push(`الحالة: ${statusLabel}`);
    if (status === "rejected" && reason) lines.push(`السبب: ${reason}`);
    lines.push("يمكنك المتابعة من قسم طلباتي.");
    const subject = `تحديث طلبك: ${statusLabel} — ${kindLabel}`;
    const body = lines.join("\n");
    return { subject, title: subject, body, text: body, kindLabel, statusLabel };
  }

  if (mode === "branch_delegate_new_request") {
    if (meta.family === "privilege") return null;
    if (!branch) return null;
    const subject = "طلب جديد يحتاج مراجعتك";
    const body = [
      "السلام عليكم،",
      "",
      `وصل طلب «${kindLabel}» لفرع ${branch}، ويحتاج إلى مراجعتك.`,
      person ? `الاسم/الموضوع: ${person}` : "",
      "",
      "هذا إشعار لمندوب الفرع فقط — ليس رسالة لصاحب الطلب.",
    ].filter(Boolean).join("\n");
    return { subject, title: subject, body, text: body, kindLabel, statusLabel: STATUS_AR.pending };
  }

  if (mode === "admin_new_request") {
    const subject = "طلب جديد بانتظار اعتمادك";
    const body = [
      "السلام عليكم،",
      "",
      `وصل طلب «${kindLabel}»${branch ? ` لفرع ${branch}` : ""} بانتظار الاعتماد.`,
      person ? `الاسم/الموضوع: ${person}` : "",
    ].filter(Boolean).join("\n");
    return { subject, title: subject, body, text: body, kindLabel, statusLabel: STATUS_AR.pending };
  }

  if (mode === "new_request" || mode === "submitter_ack") {
    const subject = `تم إرسال طلبك بنجاح — ${kindLabel}`;
    const body = [
      "تم إرسال طلبك بنجاح، وهو الآن قيد المراجعة.",
      `نوع الطلب: ${kindLabel}`,
      branch ? `الفرع: ${branch}` : "",
      "يمكنك متابعة الحالة من قسم طلباتي.",
    ].filter(Boolean).join("\n");
    return { subject, title: subject, body, text: body, kindLabel, statusLabel: STATUS_AR.pending };
  }

  console.warn("[alzidan-email-notify] blocked unknown mode", mode, kind);
  return null;
}

/** Strip message / technical fields before any send path. */
function scrubRecord(record: any) {
  const src = record && typeof record === "object" ? record : {};
  return {
    request_id: String(src.request_id || "").trim() || null,
    kind: normalizeKind(src.kind),
    branch_key: String(src.branch_key || src.branch || "").trim() || null,
    status: String(src.status || "").trim().toLowerCase() || null,
    email: String(src.email || "").trim() || null,
    phone: String(src.phone || "").trim() || null,
    name: safeDisplayName(src.name || src.person || "") || null,
    person: safeDisplayName(src.person || src.name || "") || null,
    reject_reason: safeArabicReason(src.reject_reason || src.rejection_reason || src.reason || "") || null,
  };
}

/** @deprecated use safeRenderOutbound — kept only for privilege subject naming */
function buildSubmitterStatusCopy(kind: string, approved: boolean, rejectReasonSafe: string) {
  return safeRenderOutbound({
    mode: "status_changed",
    kind,
    status: approved ? "approved" : "rejected",
    reject_reason: rejectReasonSafe,
    audience: "submitter",
  });
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

function delegateKindForRequest(kind: string) {
  if (kind === "event_card") return "events_delegate";
  if (kind === "tree_card" || kind === "tree_founder") return "tree_delegate";
  return null;
}

async function getEmailSettings() {
  const fallback = {
    adminNotifyEmail: FALLBACK_ADMIN_NOTIFY_EMAIL,
    fromEmail: FALLBACK_FROM_EMAIL,
    noreplyEmail: "noreply@alzidan.org",
  };

  if (!SERVICE_ROLE_KEY) return fallback;

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/email_settings?select=key,value`, {
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) return fallback;

    const rows = await res.json();
    const map = Object.fromEntries((rows || []).map((r: any) => [String(r.key), String(r.value || "").trim()]));

    return {
      adminNotifyEmail: map.admin_notify_email || fallback.adminNotifyEmail,
      fromEmail: map.from_email || fallback.fromEmail,
      noreplyEmail: map.noreply_email || fallback.noreplyEmail,
    };
  } catch (_) {
    return fallback;
  }
}

type SendEmailOptions = {
  fromName?: string;
  replyTo?: string;
  headers?: Record<string, string>;
};

/**
 * Resend payload helper.
 * Inbox placement (esp. Outlook/Hotmail «غير هام») needs a verified custom domain
 * with SPF/DKIM/DMARC on the From address — shared/unverified domains rarely reach Focused.
 */
async function sendEmail(
  to: string,
  subject: string,
  text: string,
  fromEmail = FALLBACK_FROM_EMAIL,
  html?: string,
  options: SendEmailOptions = {},
) {
  const fromName =
    String(options.fromName || "إدارة عائلة الزيدان").trim() || "إدارة عائلة الزيدان";
  const payload: Record<string, unknown> = {
    from: `${fromName} <${fromEmail}>`,
    to: [to],
    subject,
    // Always include text so Resend sends multipart/alternative when html is set.
    text: String(text || "").trim() || subject,
  };
  if (html) payload.html = html;
  if (options.replyTo) payload.reply_to = options.replyTo;
  if (options.headers && Object.keys(options.headers).length) {
    payload.headers = options.headers;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Resend failed for ${to}: ${body}`);
  }

  return body;
}

function normalizeBranchKey(v: unknown) {
  return String(v || "").trim().replace(/\s+/g, " ");
}

function isLikelyEmail(v: unknown) {
  const s = String(v || "").trim().toLowerCase();
  return !!(s && s.includes("@") && s.includes(".") && s.length >= 6);
}

type BranchEmailLookup = {
  emails: string[];
  diagnostics: {
    service_role: boolean;
    delegates_v2_status: number | null;
    approval_requests_status: number | null;
    errors: string[];
  };
};

/** Active branch delegates with email — private notify only (not admins, not broadcast). */
async function fetchBranchDelegateEmails(branchKey: string): Promise<BranchEmailLookup> {
  const diagnostics = {
    service_role: !!SERVICE_ROLE_KEY,
    delegates_v2_status: null as number | null,
    approval_requests_status: null as number | null,
    errors: [] as string[],
  };
  if (!SERVICE_ROLE_KEY || !branchKey) {
    if (!SERVICE_ROLE_KEY) diagnostics.errors.push("missing_service_role");
    return { emails: [], diagnostics };
  }
  const emails = new Set<string>();
  const headers = {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    Accept: "application/json",
  };

  try {
    const q1 =
      `${SUPABASE_URL}/rest/v1/delegates_v2` +
      `?select=email,phone,branch_key,is_enabled` +
      `&is_enabled=eq.true` +
      `&branch_key=eq.${encodeURIComponent(branchKey)}` +
      `&email=not.is.null`;
    const r1 = await fetch(q1, { headers });
    diagnostics.delegates_v2_status = r1.status;
    if (r1.ok) {
      const rows = await r1.json();
      for (const row of rows || []) {
        const em = String(row?.email || "").trim().toLowerCase();
        if (isLikelyEmail(em)) emails.add(em);
      }
    } else {
      diagnostics.errors.push(`delegates_v2_http_${r1.status}`);
    }
  } catch (e) {
    diagnostics.errors.push(`delegates_v2_fetch:${String((e as Error)?.message || e)}`);
  }

  // Fallback: approved legacy delegate rows for same branch (phone is identity key)
  try {
    const q2 =
      `${SUPABASE_URL}/rest/v1/approval_requests` +
      `?select=email,phone,branch_key,kind,status` +
      `&status=eq.approved` +
      `&kind=in.(tree_delegate,events_delegate)` +
      `&branch_key=eq.${encodeURIComponent(branchKey)}` +
      `&email=not.is.null` +
      `&limit=50`;
    const r2 = await fetch(q2, { headers });
    diagnostics.approval_requests_status = r2.status;
    if (r2.ok) {
      const rows = await r2.json();
      for (const row of rows || []) {
        const em = String(row?.email || "").trim().toLowerCase();
        if (isLikelyEmail(em)) emails.add(em);
      }
    } else {
      diagnostics.errors.push(`approval_requests_http_${r2.status}`);
    }
  } catch (e) {
    diagnostics.errors.push(`approval_requests_fetch:${String((e as Error)?.message || e)}`);
  }

  return { emails: Array.from(emails), diagnostics };
}

function isBranchNotifyKind(kind: string) {
  const k = normalizeKind(kind);
  // special_card (البطاقة) stays central-admin only — never route to branch delegates.
  return (
    k === "event_card" ||
    k === "family_event" ||
    k === "event_request" ||
    k === "tree_card" ||
    k === "tree_edit" ||
    k === "memory_card" ||
    k === "tree_founder"
  );
}

async function notifyBranchDelegates(record: any, settings: any, dryRun: boolean) {
  const clean = scrubRecord(record);
  const branchKey = normalizeBranchKey(clean.branch_key);
  if (!branchKey) return json({ ok: true, skipped: "missing_branch_key", mode: "branch_delegate_new_request" });

  const kind = String(clean.kind || "");
  if (!isKnownKind(kind) || !isBranchNotifyKind(kind)) {
    return json({
      ok: true,
      skipped: isKnownKind(kind) ? "kind_admin_only" : "unknown_kind_blocked",
      mode: "branch_delegate_new_request",
      kind,
      branch_key: branchKey,
    });
  }

  const rendered = safeRenderOutbound({
    mode: "branch_delegate_new_request",
    kind,
    branch_key: branchKey,
    person: clean.person || clean.name || "",
    audience: "delegate",
  });
  if (!rendered) {
    return json({ ok: true, skipped: "safe_render_blocked", mode: "branch_delegate_new_request", kind });
  }

  const requestId = String(clean.request_id || "").trim();
  const portalUrl = buildDelegatePortalUrl(branchKey, requestId);
  const lookup = await fetchBranchDelegateEmails(branchKey);
  const recipients = lookup.emails;

  if (!recipients.length) {
    return json({
      ok: true,
      skipped: "no_branch_delegate_emails",
      mode: "branch_delegate_new_request",
      branch_key: branchKey,
      diagnostics: lookup.diagnostics,
    });
  }

  const subject = rendered.subject;
  const replyTo = String(settings.noreplyEmail || settings.adminNotifyEmail || "").trim() ||
    undefined;

  const text = [
    rendered.text,
    "",
    "افتح صفحة المناديب لمراجعة الطلب:",
    portalUrl,
    "",
    "عائلة الزيدان",
  ].join("\n");

  const html = `
<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;font-size:16px;line-height:1.7;color:#111">
  <pre style="font-family:Tahoma,Arial,sans-serif;white-space:pre-wrap;margin:0">${rendered.text.replace(/</g, "&lt;")}</pre>
  <p>
    افتح صفحة المناديب لمراجعة الطلب:<br>
    <a href="${portalUrl}">${portalUrl}</a>
  </p>
  <p>عائلة الزيدان</p>
</div>`.trim();

  const emailOptions: SendEmailOptions = {
    fromName: "مناديب الفروع | عائلة الزيدان",
    replyTo,
    headers: {
      "List-Unsubscribe": `<mailto:${settings.noreplyEmail || "noreply@alzidan.org"}?subject=unsubscribe>`,
    },
  };

  if (dryRun) {
    return json({
      ok: true,
      dry_run: true,
      mode: "branch_delegate_new_request",
      branch_key: branchKey,
      recipients,
      portal_url: portalUrl,
      from_email: settings.fromEmail,
      from_name: emailOptions.fromName,
      subject,
      reply_to: replyTo || null,
      diagnostics: lookup.diagnostics,
    });
  }

  const sent: string[] = [];
  const failed: { to: string; error: string }[] = [];
  for (const to of recipients) {
    try {
      await sendEmail(to, subject, text, settings.fromEmail, html, emailOptions);
      sent.push(to);
    } catch (e) {
      failed.push({ to, error: String((e as Error)?.message || e) });
    }
  }
  if (!sent.length) {
    return json(
      {
        ok: false,
        error: "resend_all_failed",
        mode: "branch_delegate_new_request",
        branch_key: branchKey,
        failed,
        diagnostics: lookup.diagnostics,
      },
      500,
    );
  }
  return json({
    ok: true,
    mode: "branch_delegate_new_request",
    sent,
    failed: failed.length ? failed : undefined,
    branch_key: branchKey,
  });
}

async function notifyAdminNewRequest(record: any, settings: any, dryRun: boolean) {
  const clean = scrubRecord(record);
  const kind = String(clean.kind || "");
  if (!isKnownKind(kind)) {
    return json({ ok: true, skipped: "unknown_kind_blocked", mode: "admin_new_request", kind });
  }
  const rendered = safeRenderOutbound({
    mode: "admin_new_request",
    kind,
    branch_key: clean.branch_key || "",
    person: clean.person || clean.name || "",
    audience: "admin",
  });
  if (!rendered) {
    return json({ ok: true, skipped: "safe_render_blocked", mode: "admin_new_request", kind });
  }
  const requestId = String(clean.request_id || "").trim();
  const toEmail = String(settings.adminNotifyEmail || "").trim();
  if (!isLikelyEmail(toEmail)) {
    return json({
      ok: true,
      skipped: "missing_admin_notify_email",
      mode: "admin_new_request",
      kind,
    });
  }

  const portalUrl = buildAdminPortalUrl(requestId);
  const subject = rendered.subject;
  const text = [rendered.text, "", "افتح لوحة الإدارة لمراجعة الطلب:", portalUrl, "", "عائلة الزيدان"].join("\n");
  const html = `
<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;font-size:16px;line-height:1.7;color:#111">
  <pre style="font-family:Tahoma,Arial,sans-serif;white-space:pre-wrap;margin:0">${rendered.text.replace(/</g, "&lt;")}</pre>
  <p>
    افتح لوحة الإدارة لمراجعة الطلب:<br>
    <a href="${portalUrl}">${portalUrl}</a>
  </p>
  <p>عائلة الزيدان</p>
</div>`.trim();

  if (dryRun) {
    return json({
      ok: true,
      dry_run: true,
      mode: "admin_new_request",
      kind,
      recipient: toEmail,
      portal_url: portalUrl,
      subject,
    });
  }

  await sendEmail(toEmail, subject, text, settings.fromEmail, html, {
    fromName: "إدارة عائلة الزيدان",
    replyTo: String(settings.noreplyEmail || "").trim() || undefined,
  });
  return json({ ok: true, mode: "admin_new_request", sent: [toEmail], kind });
}

Deno.serve(async (req) => {
  try {
    if (!RESEND_API_KEY) return json({ ok: false, error: "Missing RESEND_API_KEY" }, 500);

    const payload = await req.json().catch(() => ({}));
    const record = payload.record || payload;
    let mode = String(payload.mode || "new_request");
    const dryRun = payload.dry_run === true;

    // Supabase Database Webhook payloads: never treat audit inserts as user mail.
    const hookType = String(payload.type || "").toUpperCase();
    if (hookType === "INSERT" || hookType === "UPDATE" || hookType === "DELETE") {
      if (isInternalAuditKind(record?.kind)) {
        return json({ ok: true, skipped: "internal_audit_kind", kind: record?.kind });
      }
      // Status decisions from UPDATE → submitter status mail only.
      if (
        hookType === "UPDATE" &&
        (String(record?.status || "") === "approved" ||
          String(record?.status || "") === "rejected")
      ) {
        mode = "status_changed";
      } else if (hookType === "INSERT" && isInternalAuditKind(record?.kind)) {
        return json({ ok: true, skipped: "webhook_audit_insert" });
      } else if (hookType === "INSERT" || hookType === "DELETE") {
        // Content inserts are notified by the client with an explicit mode.
        return json({ ok: true, skipped: "webhook_no_auto_email", type: hookType });
      }
    }

    const settings = await getEmailSettings();
    const clean = scrubRecord(record);
    const kind = normalizeKind(clean.kind || "");
    const branchKey = String(clean.branch_key || "");

    if (isInternalAuditKind(kind) || !isKnownKind(kind)) {
      return json({ ok: true, skipped: "unknown_or_internal_kind_blocked", kind, mode });
    }

    // Private: email only that branch's registered delegates.
    if (mode === "branch_delegate_new_request") {
      return await notifyBranchDelegates(clean, settings, dryRun);
    }

    if (mode === "admin_new_request") {
      return await notifyAdminNewRequest(clean, settings, dryRun);
    }

    if (mode === "status_changed") {
      // SUBMITTER only — clean.email must be creator contact, never reviewer session.
      const toEmail = String(clean.email || payload.submitter_email || "").trim();
      if (!toEmail || !isLikelyEmail(toEmail)) {
        return json({ ok: true, skipped: "missing_request_email", mode });
      }

      const status = String(clean.status || "").trim().toLowerCase();
      const rendered = safeRenderOutbound({
        mode: "status_changed",
        kind,
        status,
        branch_key: branchKey,
        person: clean.person || clean.name || "",
        reject_reason: clean.reject_reason || "",
        audience: "submitter",
      });
      if (!rendered) {
        return json({ ok: true, skipped: "safe_render_blocked", mode, kind, status });
      }

      if (dryRun) {
        return json({
          ok: true,
          dry_run: true,
          mode,
          recipient: toEmail,
          subject: rendered.subject,
          kind,
        });
      }

      await sendEmail(toEmail, rendered.subject, rendered.text, settings.fromEmail);
      return json({ ok: true, sent: [toEmail], mode, kind });
    }

    // Admin-only kinds (e.g. special_card) → central admin email, never branch delegates.
    if (isAdminOnlyNotifyKind(kind)) {
      return await notifyAdminNewRequest(clean, settings, dryRun);
    }

    // Compat: mode=new_request for branch kinds still notify delegates.
    if (isBranchNotifyKind(kind) && normalizeBranchKey(branchKey)) {
      return await notifyBranchDelegates(clean, settings, dryRun);
    }

    const toEmail = String(clean.email || "").trim();
    if (!toEmail) return json({ ok: true, skipped: "missing_request_email" });

    const rendered = safeRenderOutbound({
      mode: "submitter_ack",
      kind,
      branch_key: branchKey,
      person: clean.person || clean.name || "",
      audience: "submitter",
    });
    if (!rendered) {
      return json({ ok: true, skipped: "safe_render_blocked", mode: "submitter_ack", kind });
    }

    if (dryRun) {
      return json({
        ok: true,
        dry_run: true,
        kind,
        branch_key: branchKey,
        recipient: toEmail,
      });
    }

    await sendEmail(toEmail, rendered.subject, rendered.text, settings.fromEmail);
    return json({ ok: true, sent: [toEmail] });
  } catch (error) {
    return json({ ok: false, error: String(error?.message || error) }, 500);
  }
});
