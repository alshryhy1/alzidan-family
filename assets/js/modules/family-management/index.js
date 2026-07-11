/**
 * Facade for Family Management panel (delegate + admin).
 * UI lives in modules; callers provide rpc + state via mount({ api }).
 */
(function (root) {
  "use strict";
  root.AlzidanFamilyMgmt = root.AlzidanFamilyMgmt || {};
})(typeof window !== "undefined" ? window : globalThis);
