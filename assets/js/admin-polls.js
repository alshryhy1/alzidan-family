(function () {
  "use strict";

  if (
    window.AlzidanAdminPollsModule &&
    typeof window.AlzidanAdminPollsModule.initAdminPolls === "function"
  ) {
    window.AlzidanAdminPollsModule.initAdminPolls();
  }
})();
