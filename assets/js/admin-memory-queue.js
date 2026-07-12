(function () {
  "use strict";

  if (
    window.AlzidanAdminMemoryQueueModule &&
    typeof window.AlzidanAdminMemoryQueueModule.initAdminMemoryQueue === "function"
  ) {
    window.AlzidanAdminMemoryQueueModule.initAdminMemoryQueue();
  }
})();
