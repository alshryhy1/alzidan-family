/**
 * International phone helpers for Alzidan web (delegate login / registration).
 * Storage: E.164 with + (e.g. +9665XXXXXXXX, +9647XXXXXXXXX).
 * UI: country dial is chosen separately; user types national digits only.
 */
(function (global) {
  var COUNTRIES = [
    { id: "SA", nameAr: "السعودية", flag: "🇸🇦", dial: "966", nationalLength: 9, nationalPrefix: /^5/, placeholder: "5XXXXXXXX" },
    { id: "IQ", nameAr: "العراق", flag: "🇮🇶", dial: "964", nationalLength: 10, nationalPrefix: /^7/, placeholder: "7XXXXXXXXX" },
    { id: "AE", nameAr: "الإمارات", flag: "🇦🇪", dial: "971", nationalLength: 9, nationalPrefix: /^5/, placeholder: "5XXXXXXXX" },
    { id: "KW", nameAr: "الكويت", flag: "🇰🇼", dial: "965", nationalLength: 8, nationalPrefix: /^[569]/, placeholder: "XXXXXXXX" },
    { id: "BH", nameAr: "البحرين", flag: "🇧🇭", dial: "973", nationalLength: 8, nationalPrefix: /^[36]/, placeholder: "XXXXXXXX" },
    { id: "OM", nameAr: "عُمان", flag: "🇴🇲", dial: "968", nationalLength: 8, nationalPrefix: /^[79]/, placeholder: "XXXXXXXX" },
    { id: "JO", nameAr: "الأردن", flag: "🇯🇴", dial: "962", nationalLength: 9, nationalPrefix: /^7/, placeholder: "7XXXXXXXX" },
    { id: "EG", nameAr: "مصر", flag: "🇪🇬", dial: "20", nationalLength: 10, nationalPrefix: /^1/, placeholder: "1XXXXXXXXX" },
  ];

  var DEFAULT_COUNTRY_ID = "SA";

  function normalizeArabicDigitsToLatin(value) {
    var map = {
      "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
      "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
      "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
      "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
      "０": "0", "１": "1", "２": "2", "３": "3", "４": "4",
      "５": "5", "６": "6", "７": "7", "８": "8", "９": "9",
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

  function digitsOnly(v) {
    return normalizeArabicDigitsToLatin(String(v || ""))
      .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
      .replace(/[^0-9]/g, "");
  }

  function getCountry(id) {
    for (var i = 0; i < COUNTRIES.length; i++) {
      if (COUNTRIES[i].id === id) return COUNTRIES[i];
    }
    return COUNTRIES[0];
  }

  function normalizeNational(raw, countryId) {
    var country = getCountry(countryId);
    var national = digitsOnly(raw);
    if (national.indexOf(country.dial) === 0 && national.length > country.nationalLength) {
      national = national.slice(country.dial.length);
    }
    if (national.indexOf("00" + country.dial) === 0) {
      national = national.slice(2 + country.dial.length);
    }
    if (national.charAt(0) === "0") national = national.replace(/^0+/, "");
    if (national.length > country.nationalLength) {
      national = national.slice(0, country.nationalLength);
    }
    return national;
  }

  function isValidNational(countryId, nationalRaw) {
    var country = getCountry(countryId);
    var national = normalizeNational(nationalRaw, countryId);
    if (national.length !== country.nationalLength) return false;
    return country.nationalPrefix.test(national);
  }

  function toE164(countryId, nationalRaw) {
    var country = getCountry(countryId);
    var national = normalizeNational(nationalRaw, countryId);
    if (!national) return "";
    return "+" + country.dial + national;
  }

  function parsePhoneToParts(raw) {
    var digits = digitsOnly(raw);
    if (!digits) return { countryId: DEFAULT_COUNTRY_ID, national: "" };

    var sorted = COUNTRIES.slice().sort(function (a, b) {
      return b.dial.length - a.dial.length;
    });
    for (var i = 0; i < sorted.length; i++) {
      var country = sorted[i];
      if (digits.indexOf(country.dial) === 0) {
        var national = digits.slice(country.dial.length).replace(/^0+/, "");
        return { countryId: country.id, national: national.slice(0, country.nationalLength) };
      }
      if (digits.indexOf("00" + country.dial) === 0) {
        var national2 = digits.slice(2 + country.dial.length).replace(/^0+/, "");
        return { countryId: country.id, national: national2.slice(0, country.nationalLength) };
      }
    }

    if (digits.length === 10 && digits.indexOf("05") === 0) {
      return { countryId: "SA", national: digits.slice(1) };
    }
    if (digits.length === 9 && digits.charAt(0) === "5") {
      return { countryId: "SA", national: digits };
    }
    if (digits.length === 11 && digits.indexOf("07") === 0) {
      return { countryId: "IQ", national: digits.slice(1) };
    }
    if (digits.length === 10 && digits.charAt(0) === "7") {
      return { countryId: "IQ", national: digits };
    }

    return { countryId: DEFAULT_COUNTRY_ID, national: digits.slice(0, 9) };
  }

  function canonicalizePhone(raw) {
    var parts = parsePhoneToParts(raw);
    if (!parts.national) return "";
    return toE164(parts.countryId, parts.national);
  }

  function isValidPhone(raw) {
    var parts = parsePhoneToParts(raw);
    return isValidNational(parts.countryId, parts.national);
  }

  function phoneCandidates(raw) {
    var out = {};
    function add(v) {
      var s = String(v || "").trim();
      if (s) out[s] = true;
    }
    var e164 = canonicalizePhone(raw);
    var parts = parsePhoneToParts(raw || e164);
    if (e164) add(e164);
    if (e164) add(digitsOnly(e164));

    if (parts.countryId === "SA" && parts.national.length === 9) {
      add("0" + parts.national);
      add(parts.national);
      add("966" + parts.national);
      add("+966" + parts.national);
    }
    if (parts.countryId === "IQ" && parts.national.length === 10) {
      add("0" + parts.national);
      add(parts.national);
      add("964" + parts.national);
      add("+964" + parts.national);
    }

    var rawDigits = digitsOnly(raw);
    if (rawDigits) add(rawDigits);

    return Object.keys(out);
  }

  function fillCountrySelect(selectEl, selectedId) {
    if (!selectEl) return;
    var current = selectedId || selectEl.value || DEFAULT_COUNTRY_ID;
    selectEl.innerHTML = "";
    for (var i = 0; i < COUNTRIES.length; i++) {
      var c = COUNTRIES[i];
      var opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.flag + " +" + c.dial;
      opt.title = c.nameAr + " (+" + c.dial + ")";
      if (c.id === current) opt.selected = true;
      selectEl.appendChild(opt);
    }
    if (!selectEl.value) selectEl.value = DEFAULT_COUNTRY_ID;
  }

  function bindPhoneIntl(wrap) {
    if (!wrap) return;
    var selectEl = wrap.querySelector("[data-phone-country]");
    var inputEl = wrap.querySelector("[data-phone-national]");
    if (!selectEl || !inputEl) return;

    function syncPlaceholder() {
      var country = getCountry(selectEl.value);
      inputEl.setAttribute("placeholder", country.placeholder);
    }

    // Always ensure options exist (fixes empty select if init raced).
    fillCountrySelect(selectEl, selectEl.value || DEFAULT_COUNTRY_ID);
    syncPlaceholder();

    if (wrap.dataset.phoneIntlBound === "1") return;
    wrap.dataset.phoneIntlBound = "1";

    function scrubNational() {
      var next = normalizeNational(inputEl.value || "", selectEl.value);
      if (String(inputEl.value || "") !== next) inputEl.value = next;
    }

    selectEl.addEventListener("change", function () {
      scrubNational();
      syncPlaceholder();
    });
    inputEl.addEventListener("input", scrubNational);
    inputEl.addEventListener("paste", function () {
      setTimeout(scrubNational, 0);
    });
    inputEl.addEventListener("blur", scrubNational);
  }

  function readPhoneIntl(wrap) {
    if (!wrap) return { ok: false, countryId: DEFAULT_COUNTRY_ID, national: "", e164: "" };
    var selectEl = wrap.querySelector("[data-phone-country]");
    var inputEl = wrap.querySelector("[data-phone-national]");
    var countryId = selectEl ? selectEl.value || DEFAULT_COUNTRY_ID : DEFAULT_COUNTRY_ID;
    var national = normalizeNational(inputEl ? inputEl.value : "", countryId);
    if (inputEl && String(inputEl.value || "") !== national) inputEl.value = national;
    var e164 = toE164(countryId, national);
    return {
      ok: isValidNational(countryId, national),
      countryId: countryId,
      national: national,
      e164: e164,
    };
  }

  function setPhoneIntl(wrap, rawOrE164) {
    if (!wrap) return;
    var parts = parsePhoneToParts(rawOrE164 || "");
    var selectEl = wrap.querySelector("[data-phone-country]");
    var inputEl = wrap.querySelector("[data-phone-national]");
    if (selectEl) {
      selectEl.value = parts.countryId;
      if (selectEl.value !== parts.countryId) fillCountrySelect(selectEl, parts.countryId);
    }
    if (inputEl) inputEl.value = parts.national;
    bindPhoneIntl(wrap);
  }

  function countryOptionsHtml(selectedId) {
    var current = selectedId || DEFAULT_COUNTRY_ID;
    var html = "";
    for (var i = 0; i < COUNTRIES.length; i++) {
      var c = COUNTRIES[i];
      html +=
        '<option value="' +
        c.id +
        '"' +
        (c.id === current ? " selected" : "") +
        ">" +
        c.flag +
        " +" +
        c.dial +
        "</option>";
    }
    return html;
  }

  /**
   * Markup for a country+national phone field.
   * opts: { key, nationalAttr, nationalName, nationalId, required, value, hint, selectedCountryId }
   */
  function fieldHtml(opts) {
    opts = opts || {};
    var key = opts.key || "phone";
    var nationalAttr = opts.nationalAttr || "";
    var nationalName = opts.nationalName ? ' name="' + opts.nationalName + '"' : "";
    var nationalId = opts.nationalId ? ' id="' + opts.nationalId + '"' : "";
    var required = opts.required ? " required" : "";
    var parts = parsePhoneToParts(opts.value || "");
    var countryId = opts.selectedCountryId || parts.countryId || DEFAULT_COUNTRY_ID;
    var national = parts.national || "";
    var country = getCountry(countryId);
    var hint =
      opts.hint === false
        ? ""
        : '<div class="phone-intl-hint hint">' +
          (opts.hint || "اختر الدولة ثم اكتب الرقم المحلي فقط (بدون رمز الدولة).") +
          "</div>";
    return (
      '<div class="phone-intl" data-phone-intl="' +
      key +
      '">' +
      '<select data-phone-country aria-label="الدولة">' +
      countryOptionsHtml(countryId) +
      "</select>" +
      "<input type=\"text\" data-phone-national " +
      nationalAttr +
      nationalName +
      nationalId +
      ' inputmode="numeric" autocomplete="tel" dir="ltr" placeholder="' +
      country.placeholder +
      '" value="' +
      String(national).replace(/"/g, "&quot;") +
      '"' +
      required +
      " />" +
      "</div>" +
      hint
    );
  }

  function bindAllIn(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var nodes = scope.querySelectorAll("[data-phone-intl]");
    for (var i = 0; i < nodes.length; i++) bindPhoneIntl(nodes[i]);
  }

  /** Read E.164 from a wrap or from nearest [data-phone-intl] under root. Optional empty OK. */
  function readE164(rootOrWrap, required) {
    var wrap = rootOrWrap;
    if (wrap && !wrap.getAttribute("data-phone-intl") && wrap.querySelector) {
      wrap = wrap.querySelector("[data-phone-intl]") || wrap.closest("[data-phone-intl]");
    }
    var r = readPhoneIntl(wrap);
    if (!r.national) return { ok: !required, e164: "", empty: true };
    return { ok: r.ok, e164: r.ok ? r.e164 : "", empty: false, countryId: r.countryId, national: r.national };
  }

  /** Canonical member/profile phone for storage. Empty string if invalid/blank. */
  function normalizeMemberPhoneE164(value) {
    var e164 = canonicalizePhone(value);
    if (!e164) return "";
    return isValidPhone(e164) ? e164 : "";
  }

  /**
   * Replace a plain tel/text input with country+national UI (keeps id/name/attrs on national).
   */
  function upgradeInput(inputEl, key) {
    if (!inputEl || inputEl.getAttribute("data-phone-national") != null) return null;
    if (inputEl.closest && inputEl.closest("[data-phone-intl]")) return inputEl.closest("[data-phone-intl]");
    var parent = inputEl.parentNode;
    if (!parent) return null;
    var wrap = document.createElement("div");
    wrap.className = "phone-intl";
    wrap.setAttribute("data-phone-intl", key || inputEl.id || "phone");
    var select = document.createElement("select");
    select.setAttribute("data-phone-country", "");
    select.setAttribute("aria-label", "الدولة");
    wrap.appendChild(select);
    inputEl.setAttribute("data-phone-national", "");
    inputEl.setAttribute("inputmode", "numeric");
    inputEl.setAttribute("dir", "ltr");
    inputEl.type = "text";
    inputEl.removeAttribute("maxlength");
    parent.insertBefore(wrap, inputEl);
    wrap.appendChild(inputEl);
    var raw = inputEl.value || "";
    setPhoneIntl(wrap, raw);
    var hint = parent.querySelector(".hint, .phone-intl-hint, .rx-field-hint, .memory-submit-field-hint");
    if (hint && /05|عربي أو إنجليزي|تبدأ ب/.test(String(hint.textContent || ""))) {
      hint.textContent = "اختر الدولة ثم اكتب الرقم المحلي فقط (بدون رمز الدولة).";
      hint.classList.add("phone-intl-hint");
    }
    return wrap;
  }

  function upgradeAllNamed(root, selectors) {
    var scope = root || document;
    var list = selectors || [];
    for (var i = 0; i < list.length; i++) {
      var el = typeof list[i] === "string" ? scope.querySelector(list[i]) : list[i];
      if (el) upgradeInput(el, el.id || "phone");
    }
    bindAllIn(scope);
  }

  global.AlzidanPhoneIntl = {
    COUNTRIES: COUNTRIES,
    DEFAULT_COUNTRY_ID: DEFAULT_COUNTRY_ID,
    normalizeArabicDigitsToLatin: normalizeArabicDigitsToLatin,
    digitsOnly: digitsOnly,
    getCountry: getCountry,
    normalizeNational: normalizeNational,
    isValidNational: isValidNational,
    toE164: toE164,
    parsePhoneToParts: parsePhoneToParts,
    canonicalizePhone: canonicalizePhone,
    isValidPhone: isValidPhone,
    phoneCandidates: phoneCandidates,
    bindPhoneIntl: bindPhoneIntl,
    readPhoneIntl: readPhoneIntl,
    setPhoneIntl: setPhoneIntl,
    fillCountrySelect: fillCountrySelect,
    countryOptionsHtml: countryOptionsHtml,
    fieldHtml: fieldHtml,
    bindAllIn: bindAllIn,
    readE164: readE164,
    normalizeMemberPhoneE164: normalizeMemberPhoneE164,
    upgradeInput: upgradeInput,
    upgradeAllNamed: upgradeAllNamed,
  };

  if (typeof document !== "undefined") {
    function boot() {
      try {
        bindAllIn(document);
      } catch (e) {}
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();
  }
})(typeof window !== "undefined" ? window : globalThis);
