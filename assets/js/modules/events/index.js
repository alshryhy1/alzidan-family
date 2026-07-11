/**
 * Facade for event parse / normalize / build modules + unified form panel.
 * RPC publish stays in caller shims (delegate-events-mgmt, admin-events-mgmt).
 */
(function (root) {
  "use strict";
  root.AlzidanEvents = root.AlzidanEvents || {};
  root.AlzidanEventsMgmt = root.AlzidanEventsMgmt || {};
})(typeof window !== "undefined" ? window : globalThis);
