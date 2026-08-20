/**
 * Paymob webhook for site support — signature check + amount match + mark paid.
 * Secrets: PAYMOB_WEBHOOK_SECRET, SUPABASE_SERVICE_ROLE_KEY
 *
 * Deploy WITHOUT JWT verification (Paymob cannot send Supabase JWT):
 *   supabase functions deploy alzidan-paymob-webhook --no-verify-jwt
 */
const SUPABASE_URL =
  Deno.env.get("SUPABASE_URL") || "https://wbskjfdqpugnwvrykqcn.supabase.co";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const PAYMOB_WEBHOOK_SECRET = String(
  Deno.env.get("PAYMOB_WEBHOOK_SECRET") || "",
).trim();

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function restHeaders(extra: Record<string, string> = {}) {
  return {
    apikey: SERVICE_ROLE_KEY || "",
    Authorization: `Bearer ${SERVICE_ROLE_KEY || ""}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...extra,
  };
}

async function hmacHex(secret: string, raw: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(raw),
  );
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }
  try {
    if (!SERVICE_ROLE_KEY) {
      return json({ ok: false, error: "missing_service_role" }, 500);
    }
    if (!PAYMOB_WEBHOOK_SECRET) {
      return json({ ok: false, error: "missing_webhook_secret" }, 500);
    }

    const sig =
      req.headers.get("x-paymob-signature") ||
      req.headers.get("x-signature") ||
      "";
    const raw = await req.text();
    const expected = await hmacHex(PAYMOB_WEBHOOK_SECRET, raw);
    const got = String(sig).trim().toLowerCase();
    if (!got || !timingSafeEqual(expected, got)) {
      return json({ ok: false, error: "invalid_signature" }, 401);
    }

    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = {};
    }

    // Paymob KSA may send a flat Intention payload or wrap it (obj / data / intention).
    const inner = (payload.obj ||
      payload.data ||
      payload.intention ||
      payload) as Record<string, unknown>;

    const eventId =
      String(
        payload.event_id ||
          inner.event_id ||
          payload.transaction_id ||
          inner.transaction_id ||
          inner.id ||
          "",
      ).trim() || (await hmacHex("event", raw));

    const intentionId = String(
      inner.intention_id ||
        payload.intention_id ||
        inner.id ||
        payload.id ||
        "",
    ).trim();
    const specialReference = String(
      inner.special_reference || payload.special_reference || "",
    ).trim();
    const statusRaw = String(inner.status || payload.status || "").toLowerCase();
    const amountHalalas = Number(
      inner.amount_cents ??
        payload.amount_cents ??
        inner.amount ??
        payload.amount ??
        NaN,
    );
    const currency = String(inner.currency || payload.currency || "").toUpperCase();

    const eventIns = await fetch(
      `${SUPABASE_URL}/rest/v1/site_support_paymob_events`,
      {
        method: "POST",
        headers: restHeaders({ Prefer: "return=representation,resolution=ignore-duplicates" }),
        body: JSON.stringify({
          event_id: eventId,
          intention_id: intentionId || null,
          status: statusRaw || null,
          amount_halalas: Number.isFinite(amountHalalas) ? amountHalalas : null,
          currency: currency || null,
          raw: payload,
        }),
      },
    );
    // If duplicate event_id, PostgREST may return empty with ignore-duplicates
    if (eventIns.status === 409) {
      return json({ ok: true, received: true, deduped: true });
    }

    if (!intentionId && !specialReference) {
      return json({ ok: false, error: "missing_intention_id" }, 400);
    }

    const paid = ["succeeded", "success", "completed", "paid"].includes(
      statusRaw,
    );
    const failed = ["failed", "voided", "canceled", "cancelled"].includes(
      statusRaw,
    );

    let order: Record<string, unknown> | null = null;
    if (intentionId) {
      const q = await fetch(
        `${SUPABASE_URL}/rest/v1/site_support_payments?paymob_intention_id=eq.${encodeURIComponent(intentionId)}&select=id,amount_halalas,currency,status&limit=1`,
        { headers: restHeaders() },
      );
      const rows = await q.json().catch(() => []);
      order = Array.isArray(rows) ? rows[0] : null;
    }
    if (!order && specialReference) {
      const q2 = await fetch(
        `${SUPABASE_URL}/rest/v1/site_support_payments?special_reference=eq.${encodeURIComponent(specialReference)}&select=id,amount_halalas,currency,status&limit=1`,
        { headers: restHeaders() },
      );
      const rows2 = await q2.json().catch(() => []);
      order = Array.isArray(rows2) ? rows2[0] : null;
    }
    if (!order) {
      return json({ ok: false, error: "order_not_found" }, 404);
    }

    if (Number.isFinite(amountHalalas) && amountHalalas > 0) {
      if (Number(order.amount_halalas) !== amountHalalas) {
        return json({ ok: false, error: "amount_mismatch" }, 400);
      }
    }
    if (
      currency &&
      order.currency &&
      String(order.currency).toUpperCase() !== currency
    ) {
      return json({ ok: false, error: "currency_mismatch" }, 400);
    }

    if (String(order.status || "").toLowerCase() === "paid") {
      return json({ ok: true, received: true, already_paid: true });
    }

    let nextStatus = String(order.status || "pending").toLowerCase();
    if (paid) nextStatus = "paid";
    else if (failed) nextStatus = "failed";

    const patch: Record<string, unknown> = {
      status: nextStatus,
      paymob_status: statusRaw,
      updated_at: new Date().toISOString(),
    };
    if (paid) patch.paid_at = new Date().toISOString();

    await fetch(
      `${SUPABASE_URL}/rest/v1/site_support_payments?id=eq.${encodeURIComponent(order.id)}`,
      {
        method: "PATCH",
        headers: restHeaders(),
        body: JSON.stringify(patch),
      },
    );

    return json({ ok: true, received: true, status: statusRaw, paid });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
