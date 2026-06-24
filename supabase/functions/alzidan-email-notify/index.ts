const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://wbskjfdqpugnwvrykqcn.supabase.co";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const FALLBACK_ADMIN_NOTIFY_EMAIL = Deno.env.get("ADMIN_NOTIFY_EMAIL") || "admin@alzidan.org";
const FALLBACK_FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "notifications@alzidan.org";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function requestLabel(kind: string) {
  const map: Record<string, string> = {
    event_card: "طلب مناسبة",
    tree_card: "طلب بطاقة شجرة",
    tree_founder: "طلب مؤسس في الشجرة",
    org_role: "طلب عضوية/دور",
    tree_delegate: "طلب مندوب شجرة",
    events_delegate: "طلب مندوب مناسبات",
    test_request: "طلب اختبار",
  };
  return map[kind] || kind || "طلب جديد";
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

async function sendEmail(to: string, subject: string, text: string, fromEmail = FALLBACK_FROM_EMAIL) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `إدارة عائلة الزيدان <${fromEmail}>`,
      to: [to],
      subject,
      text,
    }),
  });

  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Resend failed for ${to}: ${body}`);
  }

  return body;
}

async function getDelegateEmails(branchKey: string, requestKind: string) {
  if (!SERVICE_ROLE_KEY) return [];

  const delegateKind = delegateKindForRequest(requestKind);
  if (!delegateKind || !branchKey) return [];

  const url =
    `${SUPABASE_URL}/rest/v1/approval_requests` +
    `?select=email,phone,request_id` +
    `&kind=eq.${encodeURIComponent(delegateKind)}` +
    `&branch_key=eq.${encodeURIComponent(branchKey)}` +
    `&status=eq.approved` +
    `&email=not.is.null`;

  const res = await fetch(url, {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) return [];

  const rows = await res.json();
  return [...new Set((rows || []).map((r: any) => String(r.email || "").trim()).filter(Boolean))];
}

Deno.serve(async (req) => {
  try {
    if (!RESEND_API_KEY) return json({ ok: false, error: "Missing RESEND_API_KEY" }, 500);

    const payload = await req.json().catch(() => ({}));
    const record = payload.record || payload;
    const mode = String(payload.mode || "new_request");
    const dryRun = payload.dry_run === true;

    const settings = await getEmailSettings();

    const kind = String(record.kind || "");
    const branchKey = String(record.branch_key || "");
    const title = requestLabel(kind);

    if (mode === "status_changed") {
      const toEmail = String(record.email || "").trim();
      if (!toEmail) return json({ ok: true, skipped: "missing_request_email" });

      const approved = String(record.status || "") === "approved";
      const subject = approved
        ? `تم قبول طلبك في عائلة الزيدان - ${title}`
        : `تم رفض طلبك في عائلة الزيدان - ${title}`;

      const text = [
        approved ? "تم قبول طلبك في نظام عائلة الزيدان." : "تم رفض طلبك في نظام عائلة الزيدان.",
        "",
        `نوع الطلب: ${title}`,
        `رقم الطلب: ${record.request_id || ""}`,
        `الفرع: ${branchKey || "غير محدد"}`,
        `الاسم: ${record.name || "غير متوفر"}`,
        `الجوال: ${record.phone || "غير متوفر"}`,
        `الحالة: ${record.status || ""}`,
        "",
        "نص الطلب:",
        record.message || "",
      ].join("\n");

      await sendEmail(toEmail, subject, text, settings.fromEmail);
      return json({ ok: true, sent: [toEmail], mode });
    }

    const subject = `طلب جديد في عائلة الزيدان - ${title}`;

    const text = [
      "وصل طلب جديد في نظام عائلة الزيدان.",
      "",
      `نوع الطلب: ${title}`,
      `رقم الطلب: ${record.request_id || ""}`,
      `الفرع: ${branchKey || "غير محدد"}`,
      `الاسم: ${record.name || "غير متوفر"}`,
      `الجوال: ${record.phone || "غير متوفر"}`,
      `البريد: ${record.email || "غير متوفر"}`,
      `الحالة: ${record.status || ""}`,
      "",
      "نص الطلب:",
      record.message || "",
    ].join("\n");

    const delegateEmails = await getDelegateEmails(branchKey, kind);

    const recipients = [
      settings.adminNotifyEmail,
      ...delegateEmails.filter((email) => email.toLowerCase() !== settings.adminNotifyEmail.toLowerCase()),
    ];

    const uniqueRecipients = [...new Set(recipients.map((email) => String(email || "").trim()).filter(Boolean))];

    if (dryRun) {
      return json({
        ok: true,
        dry_run: true,
        kind,
        branch_key: branchKey,
        admin: settings.adminNotifyEmail,
        delegates: delegateEmails,
        recipients: uniqueRecipients,
      });
    }

    const sent: string[] = [];
    for (const email of uniqueRecipients) {
      await sendEmail(email, subject, text, settings.fromEmail);
      sent.push(email);
    }

    return json({ ok: true, sent });
  } catch (error) {
    return json({ ok: false, error: String(error?.message || error) }, 500);
  }
});
