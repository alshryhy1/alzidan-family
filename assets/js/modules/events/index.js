/**
 * Facade for event parse / normalize / build modules.
 * Does not perform RPC publish — callers keep their own insert paths.
 */
(function (root) {
  "use strict";
  root.AlzidanEvents = root.AlzidanEvents || {};
})(typeof window !== "undefined" ? window : globalThis);
