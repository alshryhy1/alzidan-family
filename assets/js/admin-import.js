(() => {
  "use strict";

  if (
    window.AlzidanAdminImportModule &&
    typeof window.AlzidanAdminImportModule.initAdminImport === "function"
  ) {
    window.AlzidanAdminImportModule.initAdminImport();
  }
})();
