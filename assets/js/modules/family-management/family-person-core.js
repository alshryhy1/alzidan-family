(function (root) {
  "use strict";

  var Core = root.AlzidanAdminCore || {};

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function escapeHtml(value) {
    if (typeof Core.escapeHtml === "function") return Core.escapeHtml(value);
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function setAlert(el, type, text) {
    if (!el) return;
    el.textContent = String(text || "");
    el.className = "alert fm-section-alert " + (type === "success" ? "alert-success" : "alert-error");
    el.style.display = text ? "block" : "none";
  }

  function hideAlert(el) {
    if (!el) return;
    el.style.display = "none";
    el.textContent = "";
    el.className = "alert fm-section-alert";
  }

  function setDeceasedFieldsUiMode(deceased, fieldEls) {
    var list = Array.isArray(fieldEls) ? fieldEls : [];
    list.forEach(function (el) {
      if (!el) return;
      var wrap = el.closest(".field") || el.parentElement;
      if (wrap && wrap.style) wrap.style.display = deceased ? "none" : "";
      try {
        el.disabled = !!deceased;
        if (deceased) el.value = "";
      } catch (e) {}
    });
  }

  function bindDeceasedToggle(checkbox, fieldEls) {
    if (!checkbox) return function () {};
    var apply = function () {
      setDeceasedFieldsUiMode(!!checkbox.checked, fieldEls);
    };
    checkbox.addEventListener("change", apply);
    apply();
    return apply;
  }

  function bindBirthDateSync(hijriEl, gregEl, api) {
    if (!hijriEl || !gregEl || !api) return;
    var syncing = false;

    function fromHijri() {
      if (syncing) return;
      var raw = String(hijriEl.value || "").trim();
      if (!raw) return;
      var hijriISO = typeof api.normalizeHijriDateISO === "function" ? api.normalizeHijriDateISO(raw) : "";
      if (!hijriISO) return;
      var gregISO = typeof api.hijriToGregorianISO === "function" ? api.hijriToGregorianISO(hijriISO) : "";
      if (!gregISO) return;
      syncing = true;
      hijriEl.value = hijriISO;
      gregEl.value = gregISO;
      syncing = false;
    }

    function fromGreg() {
      if (syncing) return;
      var raw = String(gregEl.value || "").trim();
      if (!raw) return;
      var gregISO = typeof api.normalizeGregorianDateISO === "function" ? api.normalizeGregorianDateISO(raw) : "";
      if (!gregISO) return;
      var hijriISO = typeof api.gregorianToHijriISO === "function" ? api.gregorianToHijriISO(gregISO) : "";
      if (!hijriISO) return;
      syncing = true;
      gregEl.value = gregISO;
      hijriEl.value = hijriISO;
      syncing = false;
    }

    hijriEl.addEventListener("input", fromHijri);
    hijriEl.addEventListener("blur", fromHijri);
    gregEl.addEventListener("change", fromGreg);
  }

  root.AlzidanFamilyPersonCore = {
    normalizeText: normalizeText,
    escapeHtml: escapeHtml,
    setAlert: setAlert,
    hideAlert: hideAlert,
    setDeceasedFieldsUiMode: setDeceasedFieldsUiMode,
    bindDeceasedToggle: bindDeceasedToggle,
    bindBirthDateSync: bindBirthDateSync,
  };
})(typeof window !== "undefined" ? window : globalThis);
