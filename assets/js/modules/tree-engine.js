/**
 * Tree Engine — sole writer target for tree_children (constitutional).
 *
 * Today this is a thin shared guard + row normalizer. Call sites that still
 * invoke RPC/import directly are documented debt (see PLATFORM-PRINCIPLES §
 * Tree Engine sole writer + PATCH-1-WRITE-PATHS). Future writes MUST go
 * through this module; Validation → Workflow → Tree Engine only.
 *
 * Global: window.AlzidanTreeEngine
 */
(function (global) {
  "use strict";

  var CODE_PARENT_NULL = "TREE-PARENT-NULL";
  var MSG_PARENT_NULL_AR =
    "لا يُسمح بكتابة صف في الشجرة دون مسار أب (parent) — ارفض الكتابة.";

  function norm(v) {
    return String(v == null ? "" : v)
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Resolve the parent path that must be stored on both parent + parent_name.
   * Prefers explicit parent_name / parent; never invents a value.
   */
  function resolveParentPath(row) {
    var r = row || {};
    return norm(r.parent_name || r.parent || r.parent_path || "");
  }

  function resolveChildPath(row) {
    var r = row || {};
    return norm(r.child_name || r.name || r.child_path || "");
  }

  /**
   * Hard guard: refuse any write payload that would persist parent=NULL/blank
   * (except explicit branch-root inserts when options.allowBranchRoot=true
   * and parent equals the branch root convention).
   *
   * @returns {{ ok:true, parent:string, child:string } | { ok:false, code:string, message:string, message_ar:string }}
   */
  function assertParentNotNull(row, options) {
    var opts = options || {};
    var parent = resolveParentPath(row);
    var child = resolveChildPath(row);
    if (!parent) {
      return {
        ok: false,
        code: CODE_PARENT_NULL,
        message: "parent_required",
        message_ar: MSG_PARENT_NULL_AR,
      };
    }
    if (!child && !opts.allowMissingChild) {
      return {
        ok: false,
        code: "TREE-CHILD-NULL",
        message: "child_required",
        message_ar: "لا يُسمح بكتابة صف بلا مسار ابن.",
      };
    }
    return { ok: true, parent: parent, child: child };
  }

  /**
   * Normalize a tree_children write row so parent and parent_name are always
   * both set to the same non-empty path (dual-column anti-drift).
   *
   * @returns {{ ok:true, row:object } | { ok:false, code:string, message:string, message_ar:string }}
   */
  function prepareChildWriteRow(row, options) {
    var gate = assertParentNotNull(row, options);
    if (!gate.ok) return gate;
    var src = row && typeof row === "object" ? row : {};
    var out = Object.assign({}, src);
    out.parent_name = gate.parent;
    out.parent = gate.parent;
    if (gate.child) {
      out.child_name = gate.child;
      out.name = gate.child;
    }
    return { ok: true, row: out };
  }

  /**
   * Stub entry for future sole-writer inserts. Currently only validates +
   * normalizes; callers still perform the RPC until Family Engine Alignment
   * routes all paths here.
   */
  function prepareInsert(row, options) {
    return prepareChildWriteRow(row, options);
  }

  var api = {
    CODE_PARENT_NULL: CODE_PARENT_NULL,
    MSG_PARENT_NULL_AR: MSG_PARENT_NULL_AR,
    resolveParentPath: resolveParentPath,
    resolveChildPath: resolveChildPath,
    assertParentNotNull: assertParentNotNull,
    prepareChildWriteRow: prepareChildWriteRow,
    prepareInsert: prepareInsert,
  };

  global.AlzidanTreeEngine = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
