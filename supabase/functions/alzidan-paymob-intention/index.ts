/**
 * Create Paymob Intention for Al-Zaidan site support.
 * Secrets (Supabase Edge Function secrets — never in frontend):
 *   PAYMOB_SECRET_KEY (preferred — Authorization: Token …)
 *   PAYMOB_API_KEY (fallback — Authorization: Bearer …, Layali-style)
 *   PAYMOB_INTEGRATION_ID
 * Optional: PAYMOB_CHECKOUT_BASE (default https://ksa.paymob.com/unifiedcheckout)
 *
 * Deploy: supabase functions deploy alzidan-paymob-intention --no-verify-jwt
 */
const SUPABASE_URL =
  Deno.env.get("SUPABASE_URL") || "https://wbskjfdqpugnwvrykqcn.supabase.co";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const PAYMOB_CHECKOUT_BASE = String(
  Deno.env.get("PAYMOB_CHECKOUT_BASE") ||
    "https://ksa.paymob.com/unifiedcheckout",
).replace(/\/$/, "");

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, prefer, x-supabase-client-platform, x-supabase-client-platform-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function parsePaymobIntegrationId(raw: unknown): number {
  let s = String(raw ?? "").trim();
  if (!s) return 0;
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  if (!/^\d+$/.test(s)) return 0;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Strip quotes/whitespace/newlines/Bearer/Token — common when pasting secrets. */
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

function paymobAuthHeader(): { header: string; mode: "token_secret" | "bearer_api" } | null {
  const secretKey = sanitizeSecret(Deno.env.get("PAYMOB_SECRET_KEY"));
  if (secretKey) {
    return { header: `Token ${secretKey}`, mode: "token_secret" };
  }
  const apiKey = sanitizeSecret(Deno.env.get("PAYMOB_API_KEY"));
  if (apiKey) {
    return { header: `Bearer ${apiKey}`, mode: "bearer_api" };
  }
  return null;
}

function authDiag(mode: string, key: string) {
  return {
    auth_mode: mode,
    key_len: key.length,
    starts_eyJ: key.startsWith("eyJ"),
    starts_ZXl: key.startsWith("ZXl"),
    starts_sau_sk: key.startsWith("sau_sk_"),
    starts_sau_pk: key.startsWith("sau_pk_"),
    prefix3: key.slice(0, 3),
    prefix7: key.slice(0, 7),
  };
}

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

function isEnabledFlag(v: unknown) {
  const s = String(v == null ? "" : v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function parseAmounts(raw: unknown) {
  const parts = String(raw ?? "")
    .split(/[,|\s]+/)
    .map((p) => Math.round(Number(String(p).trim())))
    .filter((n) => Number.isFinite(n) && n > 0);
  const seen: Record<number, boolean> = {};
  const out: number[] = [];
  for (const n of parts) {
    if (seen[n]) continue;
    seen[n] = true;
    out.push(n);
  }
  out.sort((a, b) => a - b);
  return out.length ? out : [10, 25, 50, 100];
}

async function loadSupportSettings() {
  if (!SERVICE_ROLE_KEY) return null;
  const keys = [
    "site_support_enabled",
    "site_support_amounts",
    "site_support_allow_custom",
  ];
  const q = keys.map((k) => `key.eq.${encodeURIComponent(k)}`).join(",");
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/site_settings?select=key,value&or=(${q})`,
    { headers: restHeaders() },
  );
  if (!res.ok) return null;
  const rows = await res.json().catch(() => []);
  const map: Record<string, string> = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || row.key == null) continue;
    map[String(row.key)] = row.value == null ? "" : String(row.value);
  }
  const allowCustom =
    map.site_support_allow_custom == null || map.site_support_allow_custom === ""
      ? true
      : isEnabledFlag(map.site_support_allow_custom);
  return {
    enabled: isEnabledFlag(map.site_support_enabled),
    amounts: parseAmounts(map.site_support_amounts),
    allowCustom,
  };
}

function amountAllowed(
  amountSar: number,
  amounts: number[],
  allowCustom: boolean,
) {
  if (!Number.isFinite(amountSar) || amountSar < 1) return false;
  if (amounts.includes(amountSar)) return true;
  return allowCustom;
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
    const auth = paymobAuthHeader();
    if (!auth) {
      return json({ ok: false, error: "missing_api_key" }, 200);
    }
    const authKey = auth.header.replace(/^(Token|Bearer)\s+/i, "");
    const rawIntegrationId = String(
      Deno.env.get("PAYMOB_INTEGRATION_ID") || "",
    ).trim();
    const paymobIntegrationId = parsePaymobIntegrationId(rawIntegrationId);
    if (!Number.isFinite(paymobIntegrationId) || paymobIntegrationId <= 0) {
      return json({
        ok: false,
        error: "missing_integration_id",
        hint: rawIntegrationId ? "integration_id_not_numeric" : "integration_id_empty",
      }, 200);
    }

    const body = await req.json().catch(() => null);
    const amountSar = Math.round(Number(body?.amount ?? NaN));
    const currency = String(body?.currency || "SAR").trim().toUpperCase() || "SAR";
    const redirectionUrl = String(body?.redirection_url || "").trim();
    const customerName = String(body?.customer_name || "داعم الموقع").trim() ||
      "داعم الموقع";
    const customerEmail = String(body?.customer_email || "support@alzidan.org")
      .trim() || "support@alzidan.org";
    const customerPhone = String(body?.customer_phone || "966500000000").trim() ||
      "966500000000";

    const settings = await loadSupportSettings();
    if (!settings || !settings.enabled) {
      return json({ ok: false, error: "support_disabled" }, 200);
    }
    if (!amountAllowed(amountSar, settings.amounts, settings.allowCustom)) {
      return json({ ok: false, error: "invalid_amount" }, 200);
    }

    const amountHalalas = Math.round(amountSar * 100);
    const specialReference = crypto.randomUUID();
    const idempotencyKey = `site_support:${amountHalalas}:${specialReference}`;

    const insertRes = await fetch(
      `${SUPABASE_URL}/rest/v1/site_support_payments`,
      {
        method: "POST",
        headers: restHeaders(),
        body: JSON.stringify({
          amount_halalas: amountHalalas,
          currency,
          status: "pending",
          special_reference: specialReference,
          idempotency_key: idempotencyKey,
          meta: {
            source: "web",
            amount_sar: amountSar,
          },
        }),
      },
    );
    const inserted = await insertRes.json().catch(() => null);
    const payment = Array.isArray(inserted) ? inserted[0] : inserted;
    if (!insertRes.ok || !payment?.id) {
      return json(
        { ok: false, error: "db_insert_failed", details: inserted },
        500,
      );
    }

    const notificationUrl =
      `${SUPABASE_URL}/functions/v1/alzidan-paymob-webhook`;

    const intentionPayload: Record<string, unknown> = {
      amount: amountHalalas,
      currency,
      payment_methods: [paymobIntegrationId],
      billing_data: {
        first_name: customerName.split(/\s+/)[0] || customerName,
        last_name: customerName.split(/\s+/).slice(1).join(" ") || "-",
        email: customerEmail,
        phone_number: customerPhone,
        street: "NA",
        building: "1",
        floor: "1",
        apartment: "1",
        city: "Riyadh",
        country: "SA",
        postal_code: "11564",
        state: "Riyadh",
        shipping_method: "PICKUP",
      },
      items: [
        {
          name: "دعم موقع عائلة الزيدان",
          amount: amountHalalas,
          description: "Site support — hosting & development",
          quantity: 1,
        },
      ],
      special_reference: specialReference,
      notification_url: notificationUrl,
      description: `Site support #${payment.id}`,
    };
    if (redirectionUrl && /^https?:\/\//i.test(redirectionUrl)) {
      intentionPayload.redirection_url = redirectionUrl;
    }

    const payRes = await fetch("https://ksa.paymob.com/v1/intention/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: auth.header,
      },
      body: JSON.stringify(intentionPayload),
    });
    const payData = await payRes.json().catch(() => ({}));
    if (!payRes.ok) {
      await fetch(
        `${SUPABASE_URL}/rest/v1/site_support_payments?id=eq.${encodeURIComponent(payment.id)}`,
        {
          method: "PATCH",
          headers: restHeaders(),
          body: JSON.stringify({
            status: "failed",
            paymob_status: "provider_error",
            updated_at: new Date().toISOString(),
            meta: {
              ...(payment.meta || {}),
              provider_error: payData,
            },
          }),
        },
      );
      const detail = String(
        (payData as { detail?: unknown })?.detail ||
          (payData as { message?: unknown })?.message ||
          "",
      ).toLowerCase();
      const authFail =
        detail.includes("authentication") ||
        detail.includes("credentials") ||
        detail.includes("unauthorized") ||
        payRes.status === 401 ||
        payRes.status === 403;
      return json({
        ok: false,
        error: authFail ? "paymob_auth_failed" : "provider_error",
        details: payData,
        key_diag: authDiag(auth.mode, authKey),
      }, 200);
    }

    const clientSecret = payData?.client_secret || payData?.clientSecret || null;
    const intentionId = payData?.id != null ? String(payData.id) : null;
    if (!clientSecret || !intentionId) {
      return json({ ok: false, error: "no_client_secret", details: payData }, 200);
    }

    await fetch(
      `${SUPABASE_URL}/rest/v1/site_support_payments?id=eq.${encodeURIComponent(payment.id)}`,
      {
        method: "PATCH",
        headers: restHeaders(),
        body: JSON.stringify({
          paymob_intention_id: intentionId,
          paymob_client_secret: clientSecret,
          paymob_status: String(payData?.status || ""),
          updated_at: new Date().toISOString(),
        }),
      },
    );

    const publicKey = sanitizeSecret(Deno.env.get("PAYMOB_PUBLIC_KEY"));
    const secretKey = sanitizeSecret(Deno.env.get("PAYMOB_SECRET_KEY"));
    let checkoutWarning: string | null = null;
    if (!publicKey) {
      checkoutWarning = "missing_public_key";
    } else if (
      publicKey.startsWith("sau_sk_") ||
      publicKey.startsWith("sk_") ||
      (secretKey && publicKey === secretKey)
    ) {
      checkoutWarning = "public_key_is_secret_key";
    } else if (
      !(
        publicKey.startsWith("pk_") ||
        publicKey.startsWith("sau_pk_")
      )
    ) {
      checkoutWarning = "public_key_unexpected_format";
    }

    const checkoutParams = new URLSearchParams();
    if (!checkoutWarning) checkoutParams.set("publicKey", publicKey);
    checkoutParams.set("clientSecret", String(clientSecret));
    const checkoutUrl =
      `${PAYMOB_CHECKOUT_BASE}/?${checkoutParams.toString()}`;

    return json({
      ok: !checkoutWarning,
      error: checkoutWarning || undefined,
      payment_id: payment.id,
      intention_id: intentionId,
      client_secret: clientSecret,
      public_key: checkoutWarning ? null : publicKey,
      checkout_url: checkoutWarning ? null : checkoutUrl,
      amount: amountSar,
      currency,
      checkout_warning: checkoutWarning,
      key_diag: publicKey
        ? {
          pk_len: publicKey.length,
          pk_prefix3: publicKey.slice(0, 3),
          starts_pk: publicKey.startsWith("pk_") || publicKey.startsWith("sau_pk_"),
          starts_sau_sk: publicKey.startsWith("sau_sk_"),
          starts_sau_pk: publicKey.startsWith("sau_pk_"),
          prefix7: publicKey.slice(0, 7),
        }
        : null,
    });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
