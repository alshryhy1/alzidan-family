const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://wbskjfdqpugnwvrykqcn.supabase.co";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function normalizeType(value: unknown) {
  return normalizeText(value).toLowerCase();
}

function formatFormalNotificationText(input: {
  type?: unknown;
  person?: unknown;
  fallbackTitle?: unknown;
  fallbackBody?: unknown;
}) {
  const type = normalizeType(input.type);
  const person = normalizeText(input.person);
  const fallbackTitle = normalizeText(input.fallbackTitle) || "إشعار جديد";
  const fallbackBody = normalizeText(input.fallbackBody) || "ورد إشعار جديد في تطبيق عائلة الزيدان.";

  if (type === "birth") {
    const subject = person ? `صدور إشعار مولود جديد يخص: ${person}` : "صدور إشعار مولود جديد";
    const body = person
      ? `تم اعتماد خبر مولود جديد في تطبيق عائلة الزيدان لصاحب الاسم: ${person}.`
      : "تم اعتماد خبر مولود جديد في تطبيق عائلة الزيدان.";
    return { typeLabel: "إشعار مولود جديد", subject, body, title: `إشعار مولود جديد — ${subject}` };
  }

  if (type === "death") {
    const subject = person ? `صدور إشعار وفاة يخص: ${person}` : "صدور إشعار وفاة";
    const body = person
      ? `تم تسجيل خبر وفاة في تطبيق عائلة الزيدان للاسم: ${person}.`
      : "تم تسجيل خبر وفاة في تطبيق عائلة الزيدان.";
    return { typeLabel: "إشعار وفاة", subject, body, title: `إشعار وفاة — ${subject}` };
  }

  if (type === "sick" || type === "operation" || type === "discharge") {
    const subject = person ? `صدور إشعار حالة صحية يخص: ${person}` : "صدور إشعار حالة صحية";
    const body = person
      ? `تم تسجيل حالة صحية في تطبيق عائلة الزيدان للاسم: ${person}.`
      : "تم تسجيل حالة صحية جديدة في تطبيق عائلة الزيدان.";
    return { typeLabel: "إشعار حالة صحية", subject, body, title: `إشعار حالة صحية — ${subject}` };
  }

  const defaultSubject = person ? `صدور إشعار مناسبة يخص: ${person}` : "صدور إشعار مناسبة";
  const defaultBody = fallbackBody || "تم نشر مناسبة جديدة في تطبيق عائلة الزيدان.";
  const defaultTitle = fallbackTitle === "إشعار جديد" ? `إشعار مناسبة — ${defaultSubject}` : fallbackTitle;

  return {
    typeLabel: "إشعار مناسبة",
    subject: defaultSubject,
    body: defaultBody,
    title: defaultTitle,
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

async function sendExpoPush(messages: Record<string, unknown>[]) {
  if (!messages.length) return { data: [] };

  const res = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(messages),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Expo push failed: ${JSON.stringify(body)}`);
  }

  return body;
}

Deno.serve(async (req) => {
  try {
    const payload = await req.json().catch(() => ({}));
    const dryRun = payload.dry_run === true;

    const type = normalizeText(payload.type);
    const person = normalizeText(payload.person);
    const branchKey = normalizeText(payload.branch_key);
    const details = normalizeText(payload.details);

    if (!type && !person) {
      return json({ ok: true, skipped: "missing_event_fields" });
    }

    const formatted = formatFormalNotificationText({
      type,
      person,
      fallbackBody: details ? details.slice(0, 180) : undefined,
    });

    const tokens = await fetchEnabledTokens();
    if (!tokens.length) {
      return json({ ok: true, skipped: "no_push_tokens", recipients: 0, formatted });
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

    if (dryRun) {
      return json({
        ok: true,
        dry_run: true,
        recipients: messages.length,
        formatted,
      });
    }

    const chunks: Record<string, unknown>[][] = [];
    for (let i = 0; i < messages.length; i += 100) {
      chunks.push(messages.slice(i, i + 100));
    }

    let sent = 0;
    let disabled = 0;
    const errors: string[] = [];

    for (const chunk of chunks) {
      const result = await sendExpoPush(chunk);
      const tickets = Array.isArray(result?.data) ? result.data : [];
      sent += chunk.length;

      for (let i = 0; i < tickets.length; i++) {
        const ticket = tickets[i] || {};
        const status = String(ticket.status || "");
        if (status === "error") {
          const detail = String(ticket.details?.error || ticket.message || "unknown");
          errors.push(detail);
          if (detail === "DeviceNotRegistered") {
            const token = String(chunk[i]?.to || "");
            if (token) {
              await disableToken(token);
              disabled += 1;
            }
          }
        }
      }
    }

    return json({
      ok: true,
      sent,
      disabled,
      formatted,
      errors: errors.length ? errors.slice(0, 10) : undefined,
    });
  } catch (error) {
    return json({ ok: false, error: String(error?.message || error) }, 500);
  }
});
