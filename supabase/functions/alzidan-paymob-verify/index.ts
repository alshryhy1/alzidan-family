/**
 * Verify Paymob intention status after checkout return (not source of truth alone).
 * Secrets: PAYMOB_SECRET_KEY (preferred) or PAYMOB_API_KEY, SUPABASE_SERVICE_ROLE_KEY
 *
 * Deploy: supabase functions deploy alzidan-paymob-verify --no-verify-jwt
 */
const SUPABASE_URL =
  Deno.env.get("SUPABASE_URL") || "https://wbskjfdqpugnwvrykqcn.supabase.co";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

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
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...CORS_HEADERS,
    },
  });
}

function restHeaders() {
  return {
    apikey: SERVICE_ROLE_KEY || "",
    Authorization: `Bearer ${SERVICE_ROLE_KEY || ""}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
}

function sanitizeSecret(raw: unknown): string {
  let s = String(raw ?? "").replace(/^\uFEFF/, "").trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/\s+/g, "");
  s = s.replace(/^(bearer|token)/i, "").trim();
  return s;
}

function paymobAuthHeader(): string | null {
  const secretKey = sanitizeSecret(Deno.env.get("PAYMOB_SECRET_KEY"));
  if (secretKey) return `Token ${secretKey}`;
  const apiKey = sanitizeSecret(Deno.env.get("PAYMOB_API_KEY"));
  if (apiKey) return `Bearer ${apiKey}`;
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }
  try {
    if (!SERVICE_ROLE_KEY) {
      return json({ ok: false, error: "missing_service_role" }, 500);
    }
    const authHeader = paymobAuthHeader();
    if (!authHeader) {
      return json({ ok: false, error: "missing_api_key" }, 200);
    }

    const body = await req.json().catch(() => null);
    const intentionId = String(body?.intention_id || "").trim();
    if (!intentionId) {
      return json({ ok: false, error: "missing_intention_id" }, 400);
    }

    const res = await fetch(
      `https://ksa.paymob.com/v1/intention/${encodeURIComponent(intentionId)}/`,
      { headers: { Authorization: authHeader } },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return json({ ok: false, error: "provider_error", details: data }, 200);
    }

    const status = String(data?.status || "").toLowerCase();
    const isPaid = ["succeeded", "success", "completed", "paid"].includes(
      status,
    );
    const isFailed = ["failed", "voided", "canceled", "cancelled"].includes(
      status,
    );

    const q = await fetch(
      `${SUPABASE_URL}/rest/v1/site_support_payments?paymob_intention_id=eq.${encodeURIComponent(intentionId)}&select=id,status&limit=1`,
      { headers: restHeaders() },
    );
    const rows = await q.json().catch(() => []);
    const order = Array.isArray(rows) ? rows[0] : null;
    if (order?.id) {
      const current = String(order.status || "pending").toLowerCase();
      let next = current;
      if (isPaid) next = "paid";
      else if (isFailed) next = "failed";
      if (next !== current) {
        const patch: Record<string, unknown> = {
          status: next,
          paymob_status: status,
          updated_at: new Date().toISOString(),
        };
        if (isPaid) patch.paid_at = new Date().toISOString();
        await fetch(
          `${SUPABASE_URL}/rest/v1/site_support_payments?id=eq.${encodeURIComponent(order.id)}`,
          {
            method: "PATCH",
            headers: restHeaders(),
            body: JSON.stringify(patch),
          },
        );
      }
    }

    return json({ ok: true, paid: isPaid, status, intention_id: intentionId });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
