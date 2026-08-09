/**
 * Single create entry for home-page request types.
 * All home forms should call create() — UI alone cannot bypass the guard.
 *
 * Flow: fingerprint lock → catalog → DupIdentityGuard.evaluate → insert
 * Does not modify tree data. No auto-merge.
 *
 * Global: window.AlzidanHomeRequestCreate
 */
(function (root) {
  "use strict";

  var Guard = root.AlzidanDupIdentityGuard;
  if (!Guard && typeof require === "function") {
    try {
      Guard = require("./dup-identity-guard.js");
    } catch (e) {}
  }

  var inflight = Object.create(null);
  var recentOk = Object.create(null);
  var RECENT_MS = 60 * 1000;

  function text(v) {
    return String(v == null ? "" : v)
      .replace(/\s+/g, " ")
      .trim();
  }

  function getGuard() {
    return root.AlzidanDupIdentityGuard || Guard;
  }

  function getClient(explicit) {
    if (explicit) return explicit;
    if (root.__alzidanConfig && typeof root.__alzidanConfig.getClient === "function") {
      return root.__alzidanConfig.getClient();
    }
    return root.__alzidanSupabaseClient || root.__alzidanالخدمةClient || null;
  }

  function makeRequestId(prefix) {
    var a = Math.random().toString(36).slice(2, 6).toUpperCase();
    var b = Math.random().toString(36).slice(2, 6).toUpperCase();
    return String(prefix || "REQ") + "-" + a + "-" + b;
  }

  function clearRecent(fp) {
    var ts = recentOk[fp];
    if (ts && Date.now() - ts > RECENT_MS) delete recentOk[fp];
  }

  function isDoubleSubmit(fp) {
    clearRecent(fp);
    if (inflight[fp]) return true;
    if (recentOk[fp] && Date.now() - recentOk[fp] < RECENT_MS) return true;
    return false;
  }

  function markInflight(fp) {
    inflight[fp] = true;
  }

  function clearInflight(fp, succeeded) {
    delete inflight[fp];
    if (succeeded) recentOk[fp] = Date.now();
  }

  /**
   * Reset locks — for unit tests only.
   */
  function resetLocksForTests() {
    Object.keys(inflight).forEach(function (k) {
      delete inflight[k];
    });
    Object.keys(recentOk).forEach(function (k) {
      delete recentOk[k];
    });
  }

  function parseEventEnvelope(message) {
    var raw = String(message || "");
    var marker = "__JSON__:";
    var idx = raw.indexOf(marker);
    if (idx < 0) return null;
    try {
      var obj = JSON.parse(raw.slice(idx + marker.length));
      if (!obj || typeof obj !== "object") return null;
      var ev = obj.event && typeof obj.event === "object" ? obj.event : obj;
      return {
        type: text(ev.type || obj.type || ""),
        person: text(ev.person || ""),
        person_id: text(ev.person_id || obj.person_id || ""),
        date_label: text(ev.date_label || ev.dateLabel || ""),
        event_date: text(ev.event_date || ""),
        title: text(ev.title || ev.person || ""),
        hospital_name: text(ev.hospital_name || ""),
        home_city: text((ev.details && ev.details.homeCity) || ""),
        home_area: text((ev.details && ev.details.homeArea) || ""),
        branch_key: text(obj.branch_key || ev.branch_key || ""),
      };
    } catch (e) {
      return null;
    }
  }

  async function fetchCatalog(type, payload, client) {
    var G = getGuard();
    var cat = {
      siblings: [],
      people: [],
      events: [],
      pending_requests: [],
      memories: [],
    };
    if (!client || !G) return cat;
    var t = text(type);
    var branch = text(payload.branch_key || payload.branch || "");

    try {
      if (t === G.TYPE.ADD_PERSON) {
        var parentPid = text(payload.parent_person_id || "");
        var parentPath = text(payload.parent_path || payload.father_path || "");
        var q = client.from("tree_children").select(
          "id,person_id,parent_person_id,branch_key,parent_name,parent,child_name,name,is_deceased,deceased"
        );
        if (branch) q = q.eq("branch_key", branch);
        var sibRes = await q.limit(2000);
        var rows = Array.isArray(sibRes.data) ? sibRes.data : [];
        rows.forEach(function (r) {
          var leaf = text(r.child_name || r.name || "");
          if (leaf.indexOf("/") >= 0) leaf = leaf.split("/").filter(Boolean).slice(-1)[0] || leaf;
          var item = {
            id: r.id,
            person_id: r.person_id,
            parent_person_id: r.parent_person_id,
            parent_path: r.parent_name || r.parent || "",
            parent_name: r.parent_name || r.parent || "",
            child_name: r.child_name || r.name || "",
            leaf: leaf,
            branch_key: r.branch_key,
            is_deceased: r.is_deceased,
            deceased: r.deceased,
          };
          cat.people.push(item);
          var sameParent =
            (parentPid && text(r.parent_person_id) === parentPid) ||
            (parentPath &&
              text(r.parent_name || r.parent || "") === parentPath);
          if (sameParent) cat.siblings.push(item);
        });
      }

      if (
        t === G.TYPE.EVENT ||
        t === G.TYPE.HEALTH ||
        t === G.TYPE.DEATH
      ) {
        var eq = client
          .from("family_events")
          .select(
            "id,branch_key,type,person,date_label,event_date,details,hospital_name,hospital_dept"
          )
          .limit(500);
        if (branch) eq = eq.eq("branch_key", branch);
        var evRes = await eq;
        (Array.isArray(evRes.data) ? evRes.data : []).forEach(function (r) {
          var details = {};
          try {
            details =
              typeof r.details === "string"
                ? JSON.parse(r.details || "{}")
                : r.details || {};
          } catch (e) {
            details = {};
          }
          cat.events.push({
            id: r.id,
            branch_key: r.branch_key,
            type: r.type,
            person: r.person,
            person_id: details.person_id || details.personId || "",
            date_label: r.date_label,
            event_date: r.event_date,
            title: r.person,
            hospital_name: r.hospital_name || details.hospitalName || "",
            home_city: details.homeCity || "",
            home_area: details.homeArea || "",
          });
        });

        var pq = client
          .from("approval_requests")
          .select("id,request_id,kind,branch_key,message,status")
          .in("kind", ["event_card", "family_event", "event_request"])
          .in("status", ["pending", "submitted", "assigned", "in_review"])
          .limit(200);
        if (branch) pq = pq.eq("branch_key", branch);
        var pr = await pq;
        (Array.isArray(pr.data) ? pr.data : []).forEach(function (row) {
          var env = parseEventEnvelope(row.message);
          if (!env) return;
          cat.pending_requests.push(env);
        });
      }

      if (t === G.TYPE.DEATH) {
        var deathPid = text(payload.person_id || "");
        if (deathPid) {
          var tr = await client
            .from("tree_children")
            .select("id,person_id,child_name,name,is_deceased,deceased,branch_key")
            .eq("person_id", deathPid)
            .limit(5);
          (Array.isArray(tr.data) ? tr.data : []).forEach(function (r) {
            cat.people.push({
              person_id: r.person_id,
              leaf: text(r.child_name || r.name || ""),
              is_deceased: r.is_deceased,
              deceased: r.deceased,
              branch_key: r.branch_key,
            });
          });
        }
      }

      if (t === G.TYPE.MEMORY) {
        var mq = client
          .from("family_memory_items")
          .select(
            "id,branch_key,person_id,person_name,title,memory_kind,memory_date,memory_year,status"
          )
          .limit(300);
        if (branch) mq = mq.eq("branch_key", branch);
        var personId = text(payload.person_id || "");
        if (personId) mq = mq.eq("person_id", personId);
        var mr = await mq;
        cat.memories = Array.isArray(mr.data) ? mr.data : [];
      }
    } catch (e) {
      // Catalog fetch is best-effort; evaluate still runs on whatever we have.
    }
    return cat;
  }

  function mapTypeFromEventPayload(payload) {
    var G = getGuard();
    var type = text(payload.type || payload.case_type || "").toLowerCase();
    if (type === "death") return G.TYPE.DEATH;
    if (G.isHealthType(type)) return G.TYPE.HEALTH;
    return G.TYPE.EVENT;
  }

  /**
   * Evaluate only (no insert). Used by UI gates and tests.
   */
  function evaluateOnly(opts) {
    var G = getGuard();
    if (!G) {
      return {
        verdict: "allow",
        code: "NO_GUARD",
        message_ar: "حارس الهوية غير محمّل.",
        matches: [],
        similar: [],
        fingerprint: "",
      };
    }
    var options = opts || {};
    var type = text(options.type);
    var payload = options.payload || {};
    var catalog = options.catalog || {};
    var fp = G.fingerprint(type, payload);
    if (isDoubleSubmit(fp) && options.checkDoubleSubmit !== false) {
      return G.evaluate(type, payload, catalog, { doubleSubmit: true });
    }
    return G.evaluate(type, payload, catalog);
  }

  async function insertApprovalRequest(client, row) {
    var res = await client.from("approval_requests").insert(row);
    if (res.error) throw res.error;
    return row;
  }

  async function insertMemory(client, item, media) {
    var res = await client.rpc("memory_submit_item_v1", {
      p_item: item,
      p_media: media || [],
    });
    if (res.error) throw res.error;
    return { id: res.data };
  }

  async function insertFamilyEventRpc(client, args) {
    var res = await client.rpc("family_events_insert_v1", args);
    if (res.error) throw res.error;
    return { data: res.data };
  }

  /**
   * Create a home request after identity/duplicate guard.
   *
   * @param {object} opts
   * @param {string} opts.type add_person|event|health|death|memory
   * @param {object} opts.payload
   * @param {object} [opts.catalog] inject catalog (skips fetch)
   * @param {object} [opts.client]
   * @param {boolean} [opts.acknowledgeReview] user confirmed similarity is a different entity
   * @param {string} [opts.mode] approval|direct_event|memory
   * @param {object} [opts.row] prebuilt approval_requests row
   * @param {object} [opts.eventRow] family_events row
   * @param {object} [opts.memoryItem]
   * @param {object[]} [opts.memoryMedia]
   * @param {object} [opts.directEventArgs] rpc args for family_events_insert_v1
   * @param {function} [opts.performInsert] custom insert; receives {client,payload,guardResult}
   */
  async function create(opts) {
    var G = getGuard();
    var options = opts || {};
    var type = text(options.type);
    var payload = Object.assign({}, options.payload || {});
    if (options.acknowledgeReview) {
      payload.different_person_same_name = true;
      payload.acknowledge_review = true;
    }

    if (!G) {
      return {
        ok: false,
        blocked: true,
        guard: {
          verdict: "block",
          code: "NO_GUARD",
          message_ar: "حارس الهوية غير محمّل — أوقف الإنشاء.",
        },
      };
    }

    var fp = G.fingerprint(type, payload);
    if (isDoubleSubmit(fp)) {
      var ds = G.evaluate(type, payload, {}, { doubleSubmit: true });
      return { ok: false, blocked: true, doubleSubmit: true, guard: ds };
    }

    markInflight(fp);
    try {
      var client = getClient(options.client);
      var catalog =
        options.catalog ||
        (options.skipFetch ? {} : await fetchCatalog(type, payload, client));

      var guardResult = G.evaluate(type, payload, catalog);
      guardResult.fingerprint = fp;

      if (guardResult.verdict === G.VERDICT.BLOCK) {
        clearInflight(fp, false);
        return { ok: false, blocked: true, guard: guardResult, catalog: catalog };
      }
      if (
        guardResult.verdict === G.VERDICT.REVIEW &&
        !options.acknowledgeReview &&
        !payload.different_person_same_name
      ) {
        clearInflight(fp, false);
        return {
          ok: false,
          blocked: false,
          needsReview: true,
          guard: guardResult,
          catalog: catalog,
        };
      }

      if (typeof options.performInsert === "function") {
        var custom = await options.performInsert({
          client: client,
          payload: payload,
          guardResult: guardResult,
          catalog: catalog,
        });
        clearInflight(fp, true);
        return {
          ok: true,
          guard: guardResult,
          result: custom,
          fingerprint: fp,
        };
      }

      if (!client && options.mode !== "evaluate_only") {
        clearInflight(fp, false);
        return {
          ok: false,
          blocked: true,
          guard: {
            verdict: "block",
            code: "NO_CLIENT",
            message_ar: "تعذر الاتصال بقاعدة البيانات.",
            fingerprint: fp,
          },
        };
      }

      var mode = text(options.mode || "approval");
      var inserted = null;

      if (mode === "memory" || type === G.TYPE.MEMORY) {
        inserted = await insertMemory(
          client,
          options.memoryItem || payload.memoryItem || payload,
          options.memoryMedia || payload.media || []
        );
      } else if (mode === "direct_event") {
        inserted = await insertFamilyEventRpc(client, options.directEventArgs || {});
      } else {
        var row = options.row;
        if (!row) {
          clearInflight(fp, false);
          return {
            ok: false,
            blocked: true,
            guard: {
              verdict: "block",
              code: "NO_ROW",
              message_ar: "بيانات الطلب غير مكتملة.",
              fingerprint: fp,
            },
          };
        }
        inserted = await insertApprovalRequest(client, row);
      }

      clearInflight(fp, true);
      return {
        ok: true,
        guard: guardResult,
        result: inserted,
        fingerprint: fp,
      };
    } catch (err) {
      clearInflight(fp, false);
      return {
        ok: false,
        blocked: true,
        error: err,
        guard: {
          verdict: "block",
          code: "INSERT_ERROR",
          message_ar: "تعذر إنشاء الطلب حاليًا.",
          fingerprint: fp,
        },
      };
    }
  }

  root.AlzidanHomeRequestCreate = {
    create: create,
    evaluateOnly: evaluateOnly,
    fetchCatalog: fetchCatalog,
    mapTypeFromEventPayload: mapTypeFromEventPayload,
    makeRequestId: makeRequestId,
    resetLocksForTests: resetLocksForTests,
    fingerprint: function (type, payload) {
      var G = getGuard();
      return G ? G.fingerprint(type, payload) : "";
    },
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = root.AlzidanHomeRequestCreate;
  }
})(typeof window !== "undefined" ? window : globalThis);
