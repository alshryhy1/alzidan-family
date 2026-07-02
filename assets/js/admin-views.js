(function () {
  "use strict";

  if (
    window.AlzidanAdminViewsModule &&
    typeof window.AlzidanAdminViewsModule.initAdminViews === "function"
  ) {
    window.AlzidanAdminViewsModule.initAdminViews();
  }
})();
