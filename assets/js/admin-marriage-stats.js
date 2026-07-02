(() => {
  "use strict";

  if (
    window.AlzidanAdminMarriageStatsModule &&
    typeof window.AlzidanAdminMarriageStatsModule.initAdminMarriageStats === "function"
  ) {
    window.AlzidanAdminMarriageStatsModule.initAdminMarriageStats();
  }
})();
