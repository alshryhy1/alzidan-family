(() => {
  "use strict";

  function runBootstrap() {
    if (
      window.AlzidanAdminRequestsModule &&
      typeof window.AlzidanAdminRequestsModule.bootstrap === "function"
    ) {
      window.AlzidanAdminRequestsModule.bootstrap();
    }
  }

  function ensureModuleLoaded() {
    if (
      window.AlzidanAdminRequestsModule &&
      typeof window.AlzidanAdminRequestsModule.bootstrap === "function"
    ) {
      runBootstrap();
      return;
    }

    const existing = document.querySelector(
      'script[data-alzidan-admin-requests-module="1"]',
    );
    if (existing) {
      existing.addEventListener("load", runBootstrap, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "../assets/js/modules/requests.js";
    script.async = false;
    script.dataset.alzidanAdminRequestsModule = "1";
    script.addEventListener("load", runBootstrap, { once: true });
    document.head.appendChild(script);
  }

  ensureModuleLoaded();
})();
