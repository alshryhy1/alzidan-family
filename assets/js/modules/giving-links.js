/**
 * Public giving — sadaqah (Ehsan link) + site support (Paymob UI prep).
 * Site support shows when enabled; payment Intention/Webhook comes later.
 */
(function () {
  "use strict";

  var KEYS = {
    sadaqahUrl: "sadaqah_jariyah_url",
    sadaqahEnabled: "sadaqah_jariyah_enabled",
    supportEnabled: "site_support_enabled",
    supportAmounts: "site_support_amounts",
    supportAllowCustom: "site_support_allow_custom",
  };

  var DEFAULT_AMOUNTS = [10, 25, 50, 100];
  var TTL_MS = 10 * 60 * 1000;
  var fetchedAt = 0;
  var cache = null;
  var selectedAmount = null;
  var selectedIsCustom = false;

  function getClient() {
    try {
      if (window.__alzidanConfig && typeof window.__alzidanConfig.getClient === "function") {
        return window.__alzidanConfig.getClient();
      }
    } catch (_) {}
    return null;
  }

  function isHttpsUrl(v) {
    var s = String(v || "").trim();
    if (!s) return false;
    try {
      var u = new URL(s);
      return u.protocol === "https:";
    } catch (_) {
      return false;
    }
  }

  function isEnabledFlag(v) {
    var s = String(v == null ? "" : v)
      .trim()
      .toLowerCase();
    return s === "1" || s === "true" || s === "yes" || s === "on";
  }

  function parseAmounts(raw) {
    var parts = String(raw == null ? "" : raw)
      .split(/[,|\s]+/)
      .map(function (p) {
        return Math.round(Number(String(p).trim()));
      })
      .filter(function (n) {
        return Number.isFinite(n) && n > 0;
      });
    var seen = {};
    var out = [];
    parts.forEach(function (n) {
      if (seen[n]) return;
      seen[n] = true;
      out.push(n);
    });
    out.sort(function (a, b) {
      return a - b;
    });
    return out.length ? out : DEFAULT_AMOUNTS.slice();
  }

  function mapFromRows(rows) {
    var map = {};
    (Array.isArray(rows) ? rows : []).forEach(function (row) {
      if (!row || row.key == null) return;
      map[String(row.key)] = row.value == null ? "" : String(row.value);
    });
    var amountsRaw = map[KEYS.supportAmounts];
    var allowCustom =
      map[KEYS.supportAllowCustom] == null || map[KEYS.supportAllowCustom] === ""
        ? true
        : isEnabledFlag(map[KEYS.supportAllowCustom]);
    return {
      sadaqahUrl: String(map[KEYS.sadaqahUrl] || "").trim(),
      sadaqahEnabled: isEnabledFlag(map[KEYS.sadaqahEnabled]),
      supportEnabled: isEnabledFlag(map[KEYS.supportEnabled]),
      supportAmounts: parseAmounts(amountsRaw),
      supportAllowCustom: allowCustom,
    };
  }

  async function fetchSettings(force) {
    var now = Date.now();
    if (!force && cache && fetchedAt && now - fetchedAt < TTL_MS) return cache;
    var sb = getClient();
    if (!sb) return cache || null;
    var { data, error } = await sb
      .from("site_settings")
      .select("key,value")
      .in("key", [
        KEYS.sadaqahUrl,
        KEYS.sadaqahEnabled,
        KEYS.supportEnabled,
        KEYS.supportAmounts,
        KEYS.supportAllowCustom,
      ]);
    if (error) return cache || null;
    cache = mapFromRows(data);
    fetchedAt = Date.now();
    return cache;
  }

  function setSupportStatus(text) {
    var el = document.querySelector("[data-giving-support-status]");
    if (el) el.textContent = text || "";
  }

  function getEffectiveAmount() {
    if (selectedIsCustom) {
      var input = document.querySelector("[data-giving-custom-input]");
      var n = Math.round(Number(input && input.value));
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    return selectedAmount;
  }

  function clearChipActive(row) {
    if (!row) return;
    row.querySelectorAll(".giving-amount-chip").forEach(function (el) {
      el.classList.remove("is-active");
    });
  }

  function syncPayButton() {
    var btn = document.querySelector("[data-giving-support-pay]");
    if (!btn) return;
    var amount = getEffectiveAmount();
    btn.disabled = !(amount && amount > 0);
  }

  function renderAmountChips(settings) {
    var row = document.querySelector("[data-giving-amount-chips]");
    var customWrap = document.querySelector("[data-giving-custom-wrap]");
    var customInput = document.querySelector("[data-giving-custom-input]");
    if (!row) return;

    var amounts = (settings && settings.supportAmounts) || DEFAULT_AMOUNTS;
    var allowCustom = !!(settings && settings.supportAllowCustom);
    row.innerHTML = "";
    selectedIsCustom = false;

    amounts.forEach(function (n, idx) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "giving-amount-chip";
      btn.setAttribute("data-amount", String(n));
      btn.textContent = String(n);
      if (idx === 0) {
        selectedAmount = n;
        btn.classList.add("is-active");
      }
      btn.addEventListener("click", function () {
        selectedAmount = n;
        selectedIsCustom = false;
        clearChipActive(row);
        btn.classList.add("is-active");
        if (customInput) customInput.value = "";
        setSupportStatus("الدفع عبر Paymob — يُؤكَّد النجاح من الخادم.");
        syncPayButton();
      });
      row.appendChild(btn);
    });

    if (customWrap) {
      customWrap.hidden = !allowCustom;
      if (!allowCustom && customInput) customInput.value = "";
    }
    if (!selectedAmount && amounts.length) selectedAmount = amounts[0];
    syncPayButton();
  }

  function bindSupportPayOnce() {
    var btn = document.querySelector("[data-giving-support-pay]");
    var input = document.querySelector("[data-giving-custom-input]");
    var row = document.querySelector("[data-giving-amount-chips]");
    if (btn && !btn.__givingBound) {
      btn.__givingBound = true;
      btn.addEventListener("click", function () {
        startSiteSupportPayment().catch(function () {
          setSupportStatus("تعذر بدء الدفع، حاول مرة أخرى.");
          btn.disabled = false;
        });
      });
    }
    if (input && !input.__givingBound) {
      input.__givingBound = true;
      input.addEventListener("input", function () {
        // Digits only — no spinner / non-numeric chars.
        var digits = String(input.value || "").replace(/[^\d]/g, "");
        if (digits !== input.value) input.value = digits;
        var raw = String(input.value || "").trim();
        var n = Math.round(Number(raw));
        if (raw !== "" && Number.isFinite(n) && n > 0) {
          selectedIsCustom = true;
          selectedAmount = null;
          clearChipActive(row);
        } else if (raw === "") {
          selectedIsCustom = false;
          if (row) {
            var first = row.querySelector(".giving-amount-chip");
            if (first) {
              selectedAmount = Math.round(Number(first.getAttribute("data-amount")));
              first.classList.add("is-active");
            }
          }
        }
        syncPayButton();
      });
    }
  }

  async function startSiteSupportPayment() {
    var btn = document.querySelector("[data-giving-support-pay]");
    var amount = getEffectiveAmount();
    if (!amount) {
      setSupportStatus("اختر مبلغًا أو اكتب رقمًا صالحًا.");
      return;
    }
    var sb = getClient();
    if (!sb || !sb.functions || typeof sb.functions.invoke !== "function") {
      setSupportStatus("تعذر الاتصال ببوابة الدفع.");
      return;
    }
    if (btn) btn.disabled = true;
    setSupportStatus("جاري إنشاء عملية الدفع…");

    var returnUrl =
      window.location.origin +
      window.location.pathname +
      "?support_return=1#giving";

    var inv = await sb.functions.invoke("alzidan-paymob-intention", {
      body: {
        amount: amount,
        currency: "SAR",
        redirection_url: returnUrl,
      },
    });
    var data = inv && inv.data ? inv.data : null;
    if ((!data || data.ok == null) && inv && inv.error) {
      try {
        var ctx = inv.error.context;
        if (ctx && typeof ctx.json === "function") {
          data = await ctx.json();
        } else if (ctx && typeof ctx === "object" && ctx.ok != null) {
          data = ctx;
        } else if (typeof ctx === "string" && ctx.trim()) {
          data = JSON.parse(ctx);
        }
      } catch (_) {}
    }
    if (inv && inv.error && (!data || data.ok == null)) {
      var errMsg = "";
      try {
        errMsg = String(inv.error.message || inv.error.name || "").trim();
      } catch (_) {}
      setSupportStatus(
        errMsg
          ? "تعذر إنشاء الدفع: " + errMsg
          : "تعذر إنشاء الدفع. تأكد من تفعيل Paymob في الخادم."
      );
      if (btn) syncPayButton();
      return;
    }
    if (!data || !data.ok) {
      var err = data && data.error ? String(data.error) : "unknown";
      if (err === "missing_api_key" || err === "paymob_auth_failed") {
        var kd = data && data.key_diag ? data.key_diag : null;
        if (kd && kd.starts_sau_pk) {
          setSupportStatus(
            "وضعت Public Key (sau_pk_) داخل PAYMOB_SECRET_KEY بالخطأ. انسخ Secret Key (sau_sk_) إلى PAYMOB_SECRET_KEY."
          );
        } else if (kd && kd.auth_mode === "token_secret" && !kd.starts_sau_sk && kd.key_len > 0) {
          setSupportStatus(
            "PAYMOB_SECRET_KEY مرفوض أو ناقص — انسخ Secret Key كاملًا من لوحة Paymob (يبدأ بـ sau_sk_)."
          );
        } else if (kd && kd.starts_sau_sk === false && kd.auth_mode === "bearer_api") {
          setSupportStatus(
            "فشل Bearer API Key. تأكد أن PAYMOB_SECRET_KEY موجود في أسرار Supabase (من لوحة Paymob → Secret Key)."
          );
        } else {
          setSupportStatus(
            "أضف PAYMOB_SECRET_KEY في أسرار Supabase (من لوحة Paymob → Secret Key، غالبًا sau_sk_…)."
          );
        }
      } else if (err === "missing_integration_id") {
        var hint = data && data.hint ? String(data.hint) : "";
        if (hint === "integration_id_not_numeric") {
          setSupportStatus(
            "رقم Integration ID غير صالح — انسخ الرقم فقط من Layali (PAYMOB_INTEGRATION_ID)، وليس Public Key أو Secret Key."
          );
        } else {
          setSupportStatus("أضف PAYMOB_INTEGRATION_ID في أسرار Supabase (رقم Integration من Paymob).");
        }
      } else if (err === "support_disabled") {
        setSupportStatus("دعم الموقع غير مفعّل حاليًا.");
      } else if (err === "invalid_amount") {
        setSupportStatus("المبلغ غير مسموح. اختر مبلغًا من القائمة أو اكتب مبلغًا آخر.");
      } else if (err === "provider_error") {
        setSupportStatus("Paymob رفض الطلب. راجع API Key و Integration ID في أسرار الخادم.");
      } else if (err === "missing_public_key") {
        setSupportStatus(
          "أضف PAYMOB_PUBLIC_KEY في أسرار Supabase (من لوحة Paymob → Public Key، غالبًا يبدأ بـ pk_live_ أو pk_test_)."
        );
      } else if (err === "public_key_is_secret_key") {
        setSupportStatus(
          "PAYMOB_PUBLIC_KEY الحالي هو Secret Key بالخطأ. انسخ Public Key من لوحة Paymob (غالبًا sau_pk_ أو pk_live_) وضعه في PAYMOB_PUBLIC_KEY."
        );
      } else if (err === "public_key_unexpected_format") {
        setSupportStatus(
          "شكل PAYMOB_PUBLIC_KEY غير متوقع. المطلوب Public Key من Paymob (sau_pk_… أو pk_live_…)، وليس Secret Key."
        );
      } else {
        setSupportStatus("تعذر إنشاء الدفع (" + err + ").");
      }
      if (btn) syncPayButton();
      return;
    }

    try {
      if (data.intention_id) {
        localStorage.setItem("alzidan_support_intention", String(data.intention_id));
      }
      if (data.payment_id) {
        localStorage.setItem("alzidan_support_payment", String(data.payment_id));
      }
    } catch (_) {}

    var checkout = String(data.checkout_url || "").trim();
    if (!checkout && data.client_secret) {
      var pk = String(data.public_key || "").trim();
      var qs = "clientSecret=" + encodeURIComponent(String(data.client_secret));
      if (pk && !pk.startsWith("sau_sk_")) {
        qs = "publicKey=" + encodeURIComponent(pk) + "&" + qs;
      }
      checkout = "https://ksa.paymob.com/unifiedcheckout/?" + qs;
    }
    if (!checkout) {
      setSupportStatus("تعذر فتح صفحة الدفع.");
      if (btn) syncPayButton();
      return;
    }
    setSupportStatus("جارٍ التحويل إلى صفحة الدفع…");
    window.location.href = checkout;
  }

  async function handleSupportReturn() {
    var params;
    try {
      params = new URLSearchParams(window.location.search || "");
    } catch (_) {
      return;
    }
    if (params.get("support_return") !== "1") return;

    var intentionId = "";
    try {
      intentionId = String(localStorage.getItem("alzidan_support_intention") || "").trim();
    } catch (_) {}
    if (!intentionId) {
      setSupportStatus("عادت من الدفع — بانتظار تأكيد البوابة.");
      return;
    }

    setSupportStatus("جاري التحقق من نتيجة الدفع…");
    var sb = getClient();
    if (!sb || !sb.functions || typeof sb.functions.invoke !== "function") return;

    var paid = false;
    for (var i = 0; i < 6; i += 1) {
      var inv = await sb.functions.invoke("alzidan-paymob-verify", {
        body: { intention_id: intentionId },
      });
      var data = inv && inv.data ? inv.data : null;
      if (data && data.ok && data.paid) {
        paid = true;
        break;
      }
      await new Promise(function (r) {
        setTimeout(r, 1200);
      });
    }

    if (paid) {
      setSupportStatus("شكرًا لدعمك — تم تأكيد المساهمة بنجاح.");
      try {
        localStorage.removeItem("alzidan_support_intention");
        localStorage.removeItem("alzidan_support_payment");
      } catch (_) {}
    } else {
      setSupportStatus(
        "استلمنا عودتك من الدفع. التأكيد النهائي يتم عبر Paymob؛ إن نجح الدفع سيُسجَّل تلقائيًا."
      );
    }

    try {
      var clean = window.location.pathname + "#giving";
      window.history.replaceState({}, "", clean);
    } catch (_) {}
  }

  function applySectionCopy(showSadaqah, showSupport) {
    var titleEl = document.querySelector("[data-giving-section-title]");
    var leadEl = document.querySelector("[data-giving-section-lead]");
    var section = document.getElementById("giving");
    var title = "مساهمة العائلة";
    var lead =
      "خير عن الموتى عبر إحسان، ومساهمة لتغطية تشغيل الموقع — مساران منفصلان.";
    var label = "مساهمة العائلة";

    if (showSadaqah && !showSupport) {
      title = "عن موتى العائلة";
      lead = "صدقة عبر منصة إحسان المرخّصة — المال للجهة الخيرية.";
      label = "عن موتى العائلة";
    } else if (showSupport && !showSadaqah) {
      title = "استمرار الموقع";
      lead = "مساهمة لتغطية الاستضافة والتطوير والخدمات التقنية.";
      label = "استمرار الموقع";
    }

    if (titleEl) titleEl.textContent = title;
    if (leadEl) leadEl.textContent = lead;
    if (section) section.setAttribute("aria-label", label);
  }

  function applyToDom(settings) {
    var section = document.getElementById("giving");
    if (!section) return;
    var sadaqahCard = section.querySelector("[data-giving-sadaqah]");
    var supportCard = section.querySelector("[data-giving-support]");
    var sadaqahLink = section.querySelector("[data-giving-sadaqah-link]");

    var showSadaqah =
      !!(settings && settings.sadaqahEnabled && isHttpsUrl(settings.sadaqahUrl));
    var showSupport = !!(settings && settings.supportEnabled);

    if (sadaqahCard) {
      sadaqahCard.hidden = !showSadaqah;
      sadaqahCard.setAttribute("aria-hidden", showSadaqah ? "false" : "true");
      if (sadaqahLink && showSadaqah) {
        sadaqahLink.href = settings.sadaqahUrl;
        sadaqahLink.setAttribute("href", settings.sadaqahUrl);
      }
    }
    if (supportCard) {
      supportCard.hidden = !showSupport;
      supportCard.setAttribute("aria-hidden", showSupport ? "false" : "true");
      if (showSupport) {
        renderAmountChips(settings);
        bindSupportPayOnce();
      }
    }
    applySectionCopy(showSadaqah, showSupport);
    section.hidden = !(showSadaqah || showSupport);
    section.classList.toggle(
      "giving-only-one",
      !!(showSadaqah !== showSupport && (showSadaqah || showSupport))
    );
  }

  async function refresh(opts) {
    var force = !!(opts && opts.force);
    var settings = await fetchSettings(force);
    applyToDom(settings);
    return settings;
  }

  function boot() {
    if (!document.getElementById("giving")) return;
    refresh()
      .then(function () {
        return handleSupportReturn();
      })
      .catch(function () {});
    // Config/client may appear slightly after first paint.
    var tries = 0;
    var timer = setInterval(function () {
      tries += 1;
      if (getClient() || tries >= 8) {
        clearInterval(timer);
        if (getClient()) {
          refresh({ force: true })
            .then(function () {
              return handleSupportReturn();
            })
            .catch(function () {});
        }
      }
    }, 400);
  }

  window.AlzidanGivingLinks = {
    KEYS: KEYS,
    DEFAULT_AMOUNTS: DEFAULT_AMOUNTS.slice(),
    isHttpsUrl: isHttpsUrl,
    isEnabledFlag: isEnabledFlag,
    parseAmounts: parseAmounts,
    refresh: refresh,
    invalidate: function () {
      fetchedAt = 0;
      cache = null;
    },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
