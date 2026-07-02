(() => {
  "use strict";

  function ensureModuleLoaded() {
    if (window.AlzidanRequestActions) return;

    const existing = document.querySelector(
      'script[data-alzidan-request-actions-module="1"]',
    );
    if (existing) return;

    const script = document.createElement("script");
    script.src = "../assets/js/modules/request-actions.js";
    script.async = false;
    script.dataset.alzidanRequestActionsModule = "1";
    document.head.appendChild(script);
  }

  ensureModuleLoaded();
})();
