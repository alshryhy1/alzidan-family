(function (global) {
  "use strict";

  function text(v) {
    return String(v || "").replace(/\s+/g, " ").trim();
  }

  /**
   * @param {object} item - row with submitted_by_name, submitted_by_phone, submitted_by_relation
   */
  function formatMemorySource(item) {
    if (!item || typeof item !== "object") return "تم الإرسال من الإدارة";

    var relation = text(item.submitted_by_relation).toLowerCase();
    var name = text(item.submitted_by_name);
    var phone = text(item.submitted_by_phone);

    if (relation === "admin") {
      return "تم الإرسال من الإدارة";
    }

    if (relation === "delegate" || relation.indexOf("مندوب") >= 0) {
      if (!name && !phone) return "تم الإرسال من المندوب";
      return "تم الإرسال من المندوب: " + [name, phone].filter(Boolean).join(" — ");
    }

    if (!name && !phone) {
      return "تم الإرسال من الإدارة";
    }

    var parts = [];
    if (name) parts.push(name);
    if (phone) parts.push(phone);
    return "تم الإرسال من العائلة: " + parts.join(" — ");
  }

  global.AlzidanMemorySource = {
    format: formatMemorySource
  };
})(window);
