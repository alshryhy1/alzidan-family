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
      var details = parseDetailsObj(ev.details);
      var submitter =
        obj.submitter && typeof obj.submitter === "object" ? obj.submitter : {};
      return {
        type: text(ev.type || obj.type || ""),
        person: text(ev.person || submitter.person || ""),
        person_id: text(
          ev.person_id ||
            details.person_id ||
            details.personId ||
            obj.person_id ||
            submitter.personId ||
            submitter.person_id ||
            ""
        ),
        date_label: text(ev.date_label || ev.dateLabel || submitter.dateLabel || ""),
        event_date: text(ev.event_date || ""),
        title: text(ev.title || ev.person || ""),
        hospital_name: text(
          ev.hospital_name || details.hospitalName || submitter.place || ""
        ),
        home_city: text(details.homeCity || details.home_city || ""),
        home_area: text(details.homeArea || details.home_area || ""),
        place: text(
          submitter.place || details.condolencePlace || details.extra || ""
        ),
        branch_key: text(obj.branch_key || ev.branch_key || ""),
      };
    } catch (e) {
      return null;
    }
  }

  function pathKey(v) {
    return text(v)
      .replace(/\s*\/\s*/g, "/")
      .replace(/\s+/g, " ")
      .trim();
  }

  function leafOfName(v) {
    var s = text(v);
    if (!s) return "";
    if (s.indexOf("/") >= 0) {
      var parts = s.split("/").map(text).filter(Boolean);
      return parts.length ? parts[parts.length - 1] : s;
    }
    return s;
  }

  /**
   * Direct pre-INSERT existence check under the selected father.
   * Uses parent_person_id (not sibling-catalog success/failure).
   * Match: person_id when known; else normalized leaf name.
   * Throws on query failure so callers fail closed (no INSERT).
   */
  function parseDetailsObj(details) {
    try {
      if (details && typeof details === "object") return details;
      return JSON.parse(String(details || "{}") || "{}");
    } catch (e) {
      return {};
    }
  }

  function liveError(code, message) {
    var e = new Error(message || code);
    e.code = code;
    return e;
  }

  function eventRowPersonId(row) {
    if (!row) return "";
    var details = parseDetailsObj(row.details);
    return text(
      row.person_id ||
        details.person_id ||
        details.personId ||
        ""
    );
  }

  function datesMatch(G, a, b) {
    var na =
      G && typeof G.normalizeDateKey === "function"
        ? G.normalizeDateKey(a)
        : text(a);
    var nb =
      G && typeof G.normalizeDateKey === "function"
        ? G.normalizeDateKey(b)
        : text(b);
    return !!(na && nb && na === nb);
  }

  function namesMatch(G, a, b) {
    var na =
      G && typeof G.normalizeArabic === "function"
        ? G.normalizeArabic(a)
        : pathKey(a);
    var nb =
      G && typeof G.normalizeArabic === "function"
        ? G.normalizeArabic(b)
        : pathKey(b);
    return !!(na && nb && na === nb);
  }

  /**
   * Direct pre-INSERT existence check for occasions (family_events + pending).
   * Same record: type + (person_id | person name) + date.
   * Phone is secondary verification when both sides expose it.
   * Throws on query failure when identifying keys are present (fail closed).
   */
  async function findExistingEventLive(client, payload) {
    if (!client || !payload) throw liveError("LIVE_EVENT_CHECK_NO_CLIENT");
    var G = getGuard();
    var type = text(payload.type || "");
    var wantPid = text(payload.person_id || "");
    var wantPerson = text(payload.person || payload.person_name || payload.title || "");
    var wantDate = text(
      payload.event_date || payload.date_label || payload.dateLabel || ""
    );
    var wantPhone = text(payload.phone || payload.submitter_phone || "");
    if (!type || (!wantPid && !wantPerson) || !wantDate) return null;

    var q = client
      .from("family_events")
      .select(
        "id,branch_key,type,person,date_label,event_date,details,hospital_name,contact_phone"
      )
      .eq("type", type)
      .limit(500);
    var res = await q;
    if (res && res.error) {
      throw liveError(
        "LIVE_EVENT_CHECK_FAILED",
        (res.error && res.error.message) || "LIVE_EVENT_CHECK_FAILED"
      );
    }
    var rows = Array.isArray(res.data) ? res.data : [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r || text(r.type) !== type) continue;
      var rowPid = eventRowPersonId(r);
      var samePerson = wantPid
        ? (rowPid && rowPid === wantPid) ||
          (!rowPid && namesMatch(G, wantPerson, r.person))
        : !rowPid && namesMatch(G, wantPerson, r.person);
      if (!samePerson && wantPid && !rowPid) {
        samePerson = namesMatch(G, wantPerson, r.person);
      }
      if (!samePerson) continue;
      if (
        !datesMatch(
          G,
          wantDate,
          r.event_date || r.date_label || ""
        )
      ) {
        continue;
      }
      return {
        id: r.id,
        type: r.type,
        person: r.person,
        person_id: rowPid || wantPid,
        date_label: r.date_label,
        event_date: r.event_date,
        branch_key: r.branch_key,
        phone: wantPhone || text(r.contact_phone || ""),
        reason: "live_db_same_event_core",
      };
    }

    // Pending approval requests with same core fields
    try {
      var pq = client
        .from("approval_requests")
        .select("id,request_id,kind,branch_key,message,status,phone")
        .limit(200);
      var pr = await pq;
      if (pr && pr.error) {
        throw liveError(
          "LIVE_EVENT_CHECK_FAILED",
          (pr.error && pr.error.message) || "LIVE_EVENT_PENDING_FAILED"
        );
      }
      var pending = Array.isArray(pr.data) ? pr.data : [];
      for (var j = 0; j < pending.length; j++) {
        var row = pending[j];
        var kind = text(row.kind || "");
        if (
          kind &&
          kind !== "event_card" &&
          kind !== "family_event" &&
          kind !== "event_request"
        ) {
          continue;
        }
        var st = text(row.status || "").toLowerCase();
        if (
          st &&
          st !== "pending" &&
          st !== "submitted" &&
          st !== "assigned" &&
          st !== "in_review"
        ) {
          continue;
        }
        var env = parseEventEnvelope(row.message);
        if (!env || text(env.type) !== type) continue;
        var envPid = text(env.person_id || "");
        var sameP = wantPid
          ? (envPid && envPid === wantPid) ||
            (!envPid && namesMatch(G, wantPerson, env.person || env.title))
          : !envPid && namesMatch(G, wantPerson, env.person || env.title);
        if (!sameP && wantPid && !envPid) {
          sameP = namesMatch(G, wantPerson, env.person || env.title);
        }
        if (!sameP) continue;
        if (
          !datesMatch(
            G,
            wantDate,
            env.event_date || env.date_label || ""
          )
        ) {
          continue;
        }
        return {
          id: row.id,
          request_id: row.request_id,
          type: env.type,
          person: env.person,
          person_id: envPid || wantPid,
          phone: wantPhone || text(row.phone || ""),
          reason: "live_db_same_event_pending",
        };
      }
    } catch (pendErr) {
      if (pendErr && pendErr.code === "LIVE_EVENT_CHECK_FAILED") throw pendErr;
      // Pending table optional — family_events already checked.
    }
    return null;
  }

  /**
   * Health/patients: same person + case type + (place or date).
   * Mirrors occasion live probe: family_events then pending approval_requests.
   */
  async function findExistingHealthLive(client, payload) {
    if (!client || !payload) throw liveError("LIVE_HEALTH_CHECK_NO_CLIENT");
    var G = getGuard();
    var type = text(payload.type || payload.case_type || "sick").toLowerCase();
    if (type === "health") type = "sick";
    var wantPid = text(payload.person_id || "");
    var wantPerson = text(payload.person || payload.person_name || "");
    var wantHospital = text(
      payload.hospital_name ||
        payload.hospitalName ||
        payload.place ||
        payload.hospital ||
        ""
    );
    var wantCity = text(payload.home_city || payload.homeCity || "");
    var wantArea = text(payload.home_area || payload.homeArea || "");
    var wantDate = text(
      payload.event_date || payload.date_label || payload.dateLabel || ""
    );
    var branch = text(payload.branch_key || payload.branch || "");
    if (!wantPid && !wantPerson) return null;
    if (!wantHospital && !(wantCity && wantArea) && !wantDate) return null;

    function sameHealthPerson(rowPid, rowPerson) {
      var samePerson = wantPid
        ? (rowPid && rowPid === wantPid) ||
          (!rowPid && namesMatch(G, wantPerson, rowPerson))
        : !rowPid && namesMatch(G, wantPerson, rowPerson);
      if (!samePerson && wantPid && !rowPid) {
        samePerson = namesMatch(G, wantPerson, rowPerson);
      }
      if (!samePerson && !wantPid && rowPid) {
        samePerson = namesMatch(G, wantPerson, rowPerson);
      }
      return samePerson;
    }

    function sameHealthCore(rowHospital, rowCity, rowArea, rowDate) {
      var samePlace =
        (wantHospital &&
          rowHospital &&
          namesMatch(G, wantHospital, rowHospital)) ||
        (wantCity &&
          rowCity &&
          namesMatch(G, wantCity, rowCity) &&
          namesMatch(G, wantArea, rowArea));
      var sameDate = datesMatch(G, wantDate, rowDate);
      return samePlace || sameDate;
    }

    var q = client
      .from("family_events")
      .select(
        "id,branch_key,type,person,date_label,event_date,details,hospital_name"
      )
      .eq("type", type)
      .limit(500);
    if (branch) q = q.eq("branch_key", branch);
    var res = await q;
    if (res && res.error) {
      throw liveError(
        "LIVE_HEALTH_CHECK_FAILED",
        (res.error && res.error.message) || "LIVE_HEALTH_CHECK_FAILED"
      );
    }
    var rows = Array.isArray(res.data) ? res.data : [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r) continue;
      var rowType = text(r.type || "").toLowerCase();
      if (rowType === "health") rowType = "sick";
      if (rowType !== type) continue;
      var details = parseDetailsObj(r.details);
      var rowPid = eventRowPersonId(r);
      if (!sameHealthPerson(rowPid, r.person)) continue;
      var rowHospital = text(
        r.hospital_name || details.hospitalName || details.hospital_name || ""
      );
      var rowCity = text(details.homeCity || details.home_city || "");
      var rowArea = text(details.homeArea || details.home_area || "");
      if (
        sameHealthCore(
          rowHospital,
          rowCity,
          rowArea,
          r.event_date || r.date_label || ""
        )
      ) {
        return {
          id: r.id,
          type: r.type,
          person: r.person,
          person_id: rowPid || wantPid,
          hospital_name: rowHospital,
          reason: "live_db_same_health_case",
        };
      }
    }

    // Pending approval requests with same health core
    try {
      var pq = client
        .from("approval_requests")
        .select("id,request_id,kind,branch_key,message,status,phone")
        .limit(200);
      var pr = await pq;
      if (pr && pr.error) {
        throw liveError(
          "LIVE_HEALTH_CHECK_FAILED",
          (pr.error && pr.error.message) || "LIVE_HEALTH_PENDING_FAILED"
        );
      }
      var pending = Array.isArray(pr.data) ? pr.data : [];
      for (var j = 0; j < pending.length; j++) {
        var row = pending[j];
        var kind = text(row.kind || "");
        if (
          kind &&
          kind !== "event_card" &&
          kind !== "family_event" &&
          kind !== "event_request"
        ) {
          continue;
        }
        var st = text(row.status || "").toLowerCase();
        if (
          st &&
          st !== "pending" &&
          st !== "submitted" &&
          st !== "assigned" &&
          st !== "in_review"
        ) {
          continue;
        }
        var env = parseEventEnvelope(row.message);
        if (!env) continue;
        var envType = text(env.type || env.case_type || "").toLowerCase();
        if (envType === "health") envType = "sick";
        if (envType !== type) continue;
        if (branch && text(row.branch_key || env.branch_key || "") !== branch) {
          continue;
        }
        var envPid = text(env.person_id || "");
        if (!sameHealthPerson(envPid, env.person || env.title || env.person_name)) {
          continue;
        }
        var envDetails = parseDetailsObj(env.details);
        var envHospital = text(
          env.hospital_name ||
            env.hospitalName ||
            env.place ||
            envDetails.hospitalName ||
            envDetails.hospital_name ||
            ""
        );
        var envCity = text(
          env.home_city || env.homeCity || envDetails.homeCity || ""
        );
        var envArea = text(
          env.home_area || env.homeArea || envDetails.homeArea || ""
        );
        if (
          sameHealthCore(
            envHospital,
            envCity,
            envArea,
            env.event_date || env.date_label || ""
          )
        ) {
          return {
            id: row.id,
            request_id: row.request_id,
            type: envType,
            person: env.person || env.title,
            person_id: envPid || wantPid,
            hospital_name: envHospital,
            reason: "live_db_same_health_pending",
          };
        }
      }
    } catch (pendErr) {
      if (pendErr && pendErr.code === "LIVE_HEALTH_CHECK_FAILED") throw pendErr;
    }
    return null;
  }

  /**
   * Death: person_id already deceased, or death event for same person
   * (family_events + pending approval_requests). Prefer person_id.
   */
  async function findExistingDeathLive(client, payload) {
    if (!client || !payload) throw liveError("LIVE_DEATH_CHECK_NO_CLIENT");
    var G = getGuard();
    var wantPid = text(payload.person_id || "");
    var wantPerson = text(payload.person || payload.person_name || "");
    var branch = text(payload.branch_key || payload.branch || "");
    if (!wantPid && !wantPerson) return null;

    function sameDeathPerson(rowPid, rowPerson) {
      var samePerson = wantPid
        ? (rowPid && rowPid === wantPid) ||
          (!rowPid && namesMatch(G, wantPerson, rowPerson))
        : !rowPid && namesMatch(G, wantPerson, rowPerson);
      if (!samePerson && wantPid && !rowPid) {
        samePerson = namesMatch(G, wantPerson, rowPerson);
      }
      if (!samePerson && !wantPid && rowPid) {
        samePerson = namesMatch(G, wantPerson, rowPerson);
      }
      return samePerson;
    }

    if (wantPid) {
      var tr = await client
        .from("tree_children")
        .select("id,person_id,child_name,name,is_deceased,deceased,branch_key")
        .eq("person_id", wantPid)
        .limit(5);
      if (tr && tr.error) {
        throw liveError(
          "LIVE_DEATH_CHECK_FAILED",
          (tr.error && tr.error.message) || "LIVE_DEATH_TREE_FAILED"
        );
      }
      var people = Array.isArray(tr.data) ? tr.data : [];
      for (var i = 0; i < people.length; i++) {
        var p = people[i];
        var dead =
          p.is_deceased === true ||
          p.deceased === true ||
          text(p.is_deceased) === "true" ||
          text(p.deceased) === "true";
        if (dead) {
          return {
            id: p.id,
            person_id: p.person_id,
            person: p.child_name || p.name || "",
            branch_key: p.branch_key,
            reason: "live_db_person_already_deceased",
          };
        }
      }
    }

    var eq = client
      .from("family_events")
      .select("id,branch_key,type,person,date_label,event_date,details")
      .eq("type", "death")
      .limit(500);
    if (branch) eq = eq.eq("branch_key", branch);
    var ev = await eq;
    if (ev && ev.error) {
      throw liveError(
        "LIVE_DEATH_CHECK_FAILED",
        (ev.error && ev.error.message) || "LIVE_DEATH_EVENT_FAILED"
      );
    }
    var rows = Array.isArray(ev.data) ? ev.data : [];
    for (var j = 0; j < rows.length; j++) {
      var r = rows[j];
      if (!r) continue;
      var rowPid = eventRowPersonId(r);
      if (!sameDeathPerson(rowPid, r.person)) continue;
      return {
        id: r.id,
        person_id: rowPid || wantPid,
        person: r.person,
        branch_key: r.branch_key,
        reason: rowPid
          ? "live_db_death_event_person_id"
          : "live_db_death_event_same_person_name",
      };
    }

    // Pending approval requests with same death person
    try {
      var pq = client
        .from("approval_requests")
        .select("id,request_id,kind,branch_key,message,status,phone")
        .limit(200);
      var pr = await pq;
      if (pr && pr.error) {
        throw liveError(
          "LIVE_DEATH_CHECK_FAILED",
          (pr.error && pr.error.message) || "LIVE_DEATH_PENDING_FAILED"
        );
      }
      var pending = Array.isArray(pr.data) ? pr.data : [];
      for (var k = 0; k < pending.length; k++) {
        var row = pending[k];
        var kind = text(row.kind || "");
        if (
          kind &&
          kind !== "event_card" &&
          kind !== "family_event" &&
          kind !== "event_request"
        ) {
          continue;
        }
        var st = text(row.status || "").toLowerCase();
        if (
          st &&
          st !== "pending" &&
          st !== "submitted" &&
          st !== "assigned" &&
          st !== "in_review"
        ) {
          continue;
        }
        var env = parseEventEnvelope(row.message);
        if (!env || text(env.type || "").toLowerCase() !== "death") continue;
        if (branch && text(row.branch_key || env.branch_key || "") !== branch) {
          continue;
        }
        var envPid = text(env.person_id || "");
        if (
          !sameDeathPerson(
            envPid,
            env.person || env.title || env.person_name || ""
          )
        ) {
          continue;
        }
        return {
          id: row.id,
          request_id: row.request_id,
          person_id: envPid || wantPid,
          person: env.person || env.title || "",
          branch_key: row.branch_key || env.branch_key || "",
          reason: "live_db_same_death_pending",
        };
      }
    } catch (pendErr) {
      if (pendErr && pendErr.code === "LIVE_DEATH_CHECK_FAILED") throw pendErr;
    }
    return null;
  }

  /**
   * Memory: same owner (person_id | person_name) + title + kind + date when present.
   */
  async function findExistingMemoryLive(client, payload) {
    if (!client || !payload) throw liveError("LIVE_MEMORY_CHECK_NO_CLIENT");
    var G = getGuard();
    var wantPid = text(payload.person_id || "");
    var wantName = text(payload.person_name || "");
    var wantTitle = text(payload.title || "");
    var wantKind = text(payload.memory_kind || "");
    var wantDate = text(payload.memory_date || payload.memory_year || "");
    var branch = text(payload.branch_key || payload.branch || "");
    if (!wantTitle || (!wantPid && !wantName)) return null;

    var mq = client
      .from("family_memory_items")
      .select(
        "id,branch_key,person_id,person_name,title,memory_kind,memory_date,memory_year,status"
      )
      .limit(300);
    if (branch) mq = mq.eq("branch_key", branch);
    if (wantPid) mq = mq.eq("person_id", wantPid);
    var mr = await mq;
    if (mr && mr.error) {
      throw liveError(
        "LIVE_MEMORY_CHECK_FAILED",
        (mr.error && mr.error.message) || "LIVE_MEMORY_CHECK_FAILED"
      );
    }
    var items = Array.isArray(mr.data) ? mr.data : [];
    for (var i = 0; i < items.length; i++) {
      var row = items[i];
      if (!row) continue;
      var samePerson = wantPid
        ? text(row.person_id) === wantPid
        : !text(row.person_id) && namesMatch(G, wantName, row.person_name);
      if (!samePerson) continue;
      if (!namesMatch(G, wantTitle, row.title)) continue;
      var rowKind = text(row.memory_kind || "");
      if (wantKind && rowKind && !namesMatch(G, wantKind, rowKind)) continue;
      if (wantDate) {
        var rowDate = text(row.memory_date || row.memory_year || "");
        if (rowDate && !datesMatch(G, wantDate, rowDate)) continue;
      }
      return {
        id: row.id,
        person_id: row.person_id,
        person_name: row.person_name,
        title: row.title,
        memory_kind: row.memory_kind,
        memory_date: row.memory_date,
        reason: "live_db_same_memory",
      };
    }
    return null;
  }

  async function findExistingChildLive(client, payload) {
    if (!client || !payload) {
      var e0 = new Error("LIVE_CHILD_CHECK_NO_CLIENT");
      e0.code = "LIVE_CHILD_CHECK_FAILED";
      throw e0;
    }
    var wantLeaf = leafOfName(payload.person_name || payload.name || "");
    var wantPid = text(
      payload.person_id ||
        payload.existing_person_id ||
        payload.existingPersonId ||
        ""
    );
    var parentPid = text(payload.parent_person_id || payload.parentPersonId || "");
    if (!parentPid) {
      var e1 = new Error("LIVE_CHILD_CHECK_NO_PARENT_PID");
      e1.code = "NO_PARENT_PERSON_ID";
      throw e1;
    }
    if (!wantLeaf && !wantPid) return null;

    var byPid = await client
      .from("tree_children")
      .select(
        "id,person_id,parent_person_id,parent_name,parent,child_name,name,branch_key"
      )
      .eq("parent_person_id", parentPid)
      .limit(1000);
    if (byPid && byPid.error) {
      var e2 = new Error(
        (byPid.error && byPid.error.message) || "LIVE_CHILD_CHECK_QUERY_FAILED"
      );
      e2.code = "LIVE_CHILD_CHECK_FAILED";
      throw e2;
    }
    var rows = Array.isArray(byPid.data) ? byPid.data : [];

    var G = getGuard();
    var norm =
      G && typeof G.normalizeArabic === "function" ? G.normalizeArabic : pathKey;
    var wantName = wantLeaf ? norm(wantLeaf) : "";

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r || text(r.parent_person_id) !== parentPid) continue;
      var hitByPid = wantPid && text(r.person_id) === wantPid;
      var leaf = norm(leafOfName(r.child_name || r.name || ""));
      var hitByName = !wantPid && wantName && leaf && leaf === wantName;
      // When person_id is known, require it; name is only a secondary layer otherwise.
      if (!hitByPid && wantPid) continue;
      if (!hitByPid && !hitByName) continue;
      return {
        id: r.id,
        person_id: r.person_id,
        parent_person_id: r.parent_person_id,
        parent_path: r.parent_name || r.parent || "",
        child_name: r.child_name || r.name || "",
        leaf: leafOfName(r.child_name || r.name || ""),
        branch_key: r.branch_key,
        reason: hitByPid
          ? "live_db_same_parent_person_id"
          : "live_db_same_parent_normalized_name",
      };
    }
    return null;
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
        var parentPid = text(payload.parent_person_id || payload.parentPersonId || "");
        var parentPath = text(
          payload.parent_path ||
            payload.parentPath ||
            payload.father_path ||
            payload.father ||
            ""
        );
        var parentPathKey = parentPath
          .replace(/\s*\/\s*/g, "/")
          .replace(/\s+/g, " ")
          .trim();
        var rows = [];
        var seenRow = Object.create(null);

        function pushRow(r) {
          if (!r) return;
          var key =
            text(r.person_id) ||
            text(r.id) ||
            text(r.child_name || r.name || "") +
              "|" +
              text(r.parent_person_id || "") +
              "|" +
              text(r.parent_name || r.parent || "");
          if (!key || seenRow[key]) return;
          seenRow[key] = true;
          rows.push(r);
        }

        // Prefer canonical parent_person_id siblings (no branch-wide LIMIT miss).
        if (parentPid) {
          var byPid = await client
            .from("tree_children")
            .select(
              "id,person_id,parent_person_id,branch_key,parent_name,parent,child_name,name,is_deceased,deceased"
            )
            .eq("parent_person_id", parentPid)
            .limit(1000);
          (Array.isArray(byPid.data) ? byPid.data : []).forEach(pushRow);
        }

        // Branch scan for people + path fallback (RX parent_path may include spaces around /).
        var q = client.from("tree_children").select(
          "id,person_id,parent_person_id,branch_key,parent_name,parent,child_name,name,is_deceased,deceased"
        );
        if (branch) q = q.eq("branch_key", branch);
        var sibRes = await q.limit(2000);
        (Array.isArray(sibRes.data) ? sibRes.data : []).forEach(pushRow);

        rows.forEach(function (r) {
          var leaf = text(r.child_name || r.name || "");
          if (leaf.indexOf("/") >= 0) leaf = leaf.split("/").filter(Boolean).slice(-1)[0] || leaf;
          var pName = text(r.parent_name || r.parent || "");
          var pNameKey = pName.replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ").trim();
          var item = {
            id: r.id,
            person_id: r.person_id,
            parent_person_id: r.parent_person_id,
            parent_path: pName,
            parent_name: pName,
            child_name: r.child_name || r.name || "",
            leaf: leaf,
            branch_key: r.branch_key,
            is_deceased: r.is_deceased,
            deceased: r.deceased,
          };
          cat.people.push(item);
          var sameParent =
            (parentPid && text(r.parent_person_id) === parentPid) ||
            (parentPathKey &&
              (pNameKey === parentPathKey ||
                pNameKey.endsWith("/" + parentPathKey) ||
                parentPathKey.endsWith("/" + pNameKey) ||
                pNameKey.endsWith("/" + parentPathKey.split("/").pop()) ||
                parentPathKey.endsWith("/" + pNameKey.split("/").pop())));
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
    var next = row || {};
    if (String(next.kind || "").trim() === "tree_card") {
      var Contract =
        (typeof window !== "undefined" && window.AlzidanTreeCardContract) || null;
      if (Contract && typeof Contract.assertCreatableEnvelope === "function") {
        var gate = Contract.assertCreatableEnvelope(next.message, next);
        if (!gate || !gate.ok) {
          var err = new Error(
            (gate && gate.message_ar) || "TREE_CARD_ENVELOPE_REQUIRED"
          );
          err.code = (gate && gate.code) || "TREE_CARD_ENVELOPE_REQUIRED";
          throw err;
        }
        if (gate.message) {
          next = Object.assign({}, next, { message: gate.message });
        }
      } else if (String(next.message || "").indexOf("__JSON__:") < 0) {
        var err2 = new Error("TREE_CARD_ENVELOPE_REQUIRED");
        err2.code = "TREE_CARD_ENVELOPE_REQUIRED";
        throw err2;
      }
    }
    var res = await client.from("approval_requests").insert(next);
    if (res.error) throw res.error;
    return next;
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
      var catalog = options.catalog || {};
      // Always prefer a live DB catalog unless the caller explicitly skips fetch.
      // UI-provided catalogs (e.g. RX camelCase) are merged as extras, not replacements.
      if (!options.skipFetch) {
        var fetched = await fetchCatalog(type, payload, client);
        catalog = {
          siblings: (fetched.siblings || []).concat(
            Array.isArray(catalog.siblings) ? catalog.siblings : []
          ),
          people: (fetched.people || []).concat(
            Array.isArray(catalog.people) ? catalog.people : []
          ),
          events: (fetched.events || []).concat(
            Array.isArray(catalog.events) ? catalog.events : []
          ),
          pending_requests: (fetched.pending_requests || []).concat(
            Array.isArray(catalog.pending_requests)
              ? catalog.pending_requests
              : []
          ),
          memories: (fetched.memories || []).concat(
            Array.isArray(catalog.memories) ? catalog.memories : []
          ),
        };
      }

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

      // Final add_person gate: direct tree lookup by parent_person_id before INSERT.
      // Sibling-catalog fetch success/failure must NOT decide allow/block.
      if (type === G.TYPE.ADD_PERSON) {
        if (!client) {
          clearInflight(fp, false);
          return {
            ok: false,
            blocked: true,
            guard: {
              verdict: G.VERDICT.BLOCK,
              code: "NO_CLIENT",
              message_ar: "تعذر الاتصال بقاعدة البيانات.",
              fingerprint: fp,
            },
            catalog: catalog,
          };
        }
        if (!text(payload.parent_person_id || payload.parentPersonId || "")) {
          clearInflight(fp, false);
          return {
            ok: false,
            blocked: true,
            guard: {
              verdict: G.VERDICT.BLOCK,
              code: "NO_PARENT_PERSON_ID",
              message_ar:
                "تعذر تحديد هوية الأب. أعد اختيار الأب من نتائج البحث ثم أكّد المسار.",
              fingerprint: fp,
            },
            catalog: catalog,
          };
        }
        var liveHit;
        try {
          liveHit = await findExistingChildLive(client, payload);
        } catch (liveErr) {
          clearInflight(fp, false);
          return {
            ok: false,
            blocked: true,
            guard: {
              verdict: G.VERDICT.BLOCK,
              code:
                (liveErr && liveErr.code) ||
                "LIVE_CHILD_CHECK_FAILED",
              message_ar:
                "تعذر التحقق من وجود الشخص تحت الأب قبل الإرسال. حاول مرة أخرى.",
              fingerprint: fp,
            },
            catalog: catalog,
          };
        }
        try {
          console.info("[HomeRequestCreate live-child-check]", {
            person_name: payload.person_name || payload.name || "",
            parent_person_id:
              payload.parent_person_id || payload.parentPersonId || "",
            different_person_same_name: !!payload.different_person_same_name,
            liveHit: liveHit
              ? {
                  id: liveHit.id,
                  person_id: liveHit.person_id,
                  leaf: liveHit.leaf,
                  reason: liveHit.reason,
                }
              : null,
          });
        } catch (logE) {}
        if (liveHit) {
          clearInflight(fp, false);
          return {
            ok: false,
            blocked: true,
            guard: {
              verdict: G.VERDICT.BLOCK,
              code: "ADD_PERSON_EXISTS",
              message_ar:
                (G.MSG && G.MSG.ADD_PERSON_EXISTS) ||
                "هذا الشخص موجود مسبقًا تحت هذا الأب.",
              matches: [liveHit],
              fingerprint: fp,
            },
            catalog: catalog,
          };
        }
      }

      // Direct live DB probes for event/health/death/memory (independent of catalog).
      if (
        !options.skipLiveCheck &&
        (type === G.TYPE.EVENT ||
          type === G.TYPE.HEALTH ||
          type === G.TYPE.DEATH ||
          type === G.TYPE.MEMORY)
      ) {
        var needsLiveClient =
          type === G.TYPE.DEATH
            ? !!(text(payload.person_id || "") || text(payload.person || payload.person_name || ""))
            : type === G.TYPE.MEMORY
              ? !!(
                  text(payload.title || "") &&
                  (text(payload.person_id || "") ||
                    text(payload.person_name || ""))
                )
              : type === G.TYPE.HEALTH
                ? !!(
                    (text(payload.person_id || "") ||
                      text(payload.person || payload.person_name || "")) &&
                    (text(payload.hospital_name || payload.hospitalName || "") ||
                      (text(payload.home_city || payload.homeCity || "") &&
                        text(payload.home_area || payload.homeArea || "")) ||
                      text(
                        payload.event_date ||
                          payload.date_label ||
                          payload.dateLabel ||
                          ""
                      ))
                  )
                : !!(
                    text(payload.type || "") &&
                    (text(payload.person_id || "") ||
                      text(payload.person || payload.person_name || payload.title || "")) &&
                    text(
                      payload.event_date ||
                        payload.date_label ||
                        payload.dateLabel ||
                        ""
                    )
                  );

        if (needsLiveClient && !client) {
          clearInflight(fp, false);
          return {
            ok: false,
            blocked: true,
            guard: {
              verdict: G.VERDICT.BLOCK,
              code: "NO_CLIENT",
              message_ar: "تعذر الاتصال بقاعدة البيانات.",
              fingerprint: fp,
            },
            catalog: catalog,
          };
        }

        if (needsLiveClient && client) {
          var liveRecord = null;
          var liveCode = "LIVE_CHECK_FAILED";
          var liveMsg = "تعذر التحقق من التكرار قبل الإرسال. حاول مرة أخرى.";
          var blockCode = "EXISTS";
          var blockMsg = "موجود مسبقًا.";
          try {
            if (type === G.TYPE.EVENT) {
              liveCode = "LIVE_EVENT_CHECK_FAILED";
              blockCode = "EVENT_SAME";
              blockMsg = (G.MSG && G.MSG.EVENT_SAME) || blockMsg;
              liveRecord = await findExistingEventLive(client, payload);
            } else if (type === G.TYPE.HEALTH) {
              liveCode = "LIVE_HEALTH_CHECK_FAILED";
              blockCode = "HEALTH_SAME";
              blockMsg = (G.MSG && G.MSG.HEALTH_SAME) || blockMsg;
              liveRecord = await findExistingHealthLive(client, payload);
            } else if (type === G.TYPE.DEATH) {
              liveCode = "LIVE_DEATH_CHECK_FAILED";
              blockCode = "DEATH_SAME";
              blockMsg = (G.MSG && G.MSG.DEATH_SAME) || blockMsg;
              liveRecord = await findExistingDeathLive(client, payload);
            } else if (type === G.TYPE.MEMORY) {
              liveCode = "LIVE_MEMORY_CHECK_FAILED";
              blockCode = "MEMORY_SAME";
              blockMsg = (G.MSG && G.MSG.MEMORY_SAME) || blockMsg;
              liveRecord = await findExistingMemoryLive(client, payload);
            }
          } catch (probeErr) {
            clearInflight(fp, false);
            return {
              ok: false,
              blocked: true,
              guard: {
                verdict: G.VERDICT.BLOCK,
                code: (probeErr && probeErr.code) || liveCode,
                message_ar: liveMsg,
                fingerprint: fp,
              },
              catalog: catalog,
            };
          }
          if (liveRecord) {
            clearInflight(fp, false);
            return {
              ok: false,
              blocked: true,
              guard: {
                verdict: G.VERDICT.BLOCK,
                code: blockCode,
                message_ar: blockMsg,
                matches: [liveRecord],
                fingerprint: fp,
              },
              catalog: catalog,
            };
          }
        }
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

  /**
   * Private branch-delegate notify: email + targeted Expo push (phone-matched tokens).
   * Does not replace public Expo family push (alzidan-push-notify) on publish/accept.
   */
  function parseNotifyPayload(result) {
    var data = result && result.data;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch (_) {
        data = { raw: data };
      }
    }
    return data && typeof data === "object" ? data : null;
  }

  function summarizeNotifyFailure(result, data) {
    if (result && result.error) {
      var err = result.error;
      var msg = String((err && (err.message || err.error_description)) || err || "invoke_error");
      var ctx = err && err.context;
      if (ctx && typeof ctx.json === "function") {
        /* async body not available here */
      }
      return msg;
    }
    if (data && data.ok === false) return String(data.error || "notify_failed");
    if (data && data.skipped) return "skipped:" + String(data.skipped);
    return "";
  }

  async function notifyBranchDelegatesOfRequest(client, row) {
    var sb = client;
    var Safe =
      (typeof window !== "undefined" && window.AlzidanSafeRequestNotify) || null;
    var src = row || {};
    var rec =
      Safe && typeof Safe.scrubRecordForNotify === "function"
        ? Safe.scrubRecordForNotify(src)
        : {
            request_id: src.request_id || null,
            kind: src.kind || "",
            branch_key: src.branch_key || "",
            status: src.status || "pending",
            email: null,
            phone: null,
            name: src.name || null,
            person: src.name || null,
          };
    // Absolute ban: never forward approval_requests.message on the wire.
    if (rec && Object.prototype.hasOwnProperty.call(rec, "message")) {
      try {
        delete rec.message;
      } catch (_) {}
    }
    var kind = String(rec.kind || "").trim();
    var branch = String(rec.branch_key || "").trim();
    if (!sb || !branch) return { ok: false, skipped: "missing" };
    if (Safe && typeof Safe.safeRenderOutbound === "function") {
      var preview = Safe.safeRenderOutbound({
        mode: "branch_delegate_new_request",
        kind: kind,
        branch_key: branch,
        person: rec.person || rec.name,
        audience: "delegate",
      });
      if (!preview) {
        try {
          console.warn("[branch_delegate_new_request] safe_render_blocked", kind);
        } catch (_) {}
        return { ok: false, skipped: "safe_render_blocked" };
      }
    }
    // Branch delegates handle branch requests except البطاقة (special_card → admin only).
    var allowed = {
      event_card: 1,
      family_event: 1,
      event_request: 1,
      tree_card: 1,
      tree_edit: 1,
      memory_card: 1,
      tree_founder: 1,
    };
    if (!allowed[kind]) return { ok: false, skipped: "kind" };
    var emailResult = null;
    var pushResult = null;
    try {
      emailResult = await sb.functions.invoke("alzidan-email-notify", {
        body: { mode: "branch_delegate_new_request", record: rec }
      });
    } catch (e) {
      emailResult = { error: e };
    }
    try {
      // Targeted mode only — must pass mode so broadcast path is not used.
      pushResult = await sb.functions.invoke("alzidan-push-notify", {
        body: { mode: "branch_delegate_new_request", record: rec }
      });
    } catch (e) {
      pushResult = { error: e };
    }
    var emailData = parseNotifyPayload(emailResult);
    var pushData = parseNotifyPayload(pushResult);
    var emailFail = summarizeNotifyFailure(emailResult, emailData);
    var pushFail = summarizeNotifyFailure(pushResult, pushData);
    var emailSent =
      !emailFail &&
      emailData &&
      Array.isArray(emailData.sent) &&
      emailData.sent.length > 0;
    var emailDry =
      !emailFail && emailData && emailData.dry_run === true && Array.isArray(emailData.recipients);
    var emailOk = !!(emailSent || emailDry || (!emailFail && emailData && emailData.ok !== false && !emailData.skipped));
    // Treat explicit skip/no recipients as not-ok so the submit UI can warn.
    if (emailData && emailData.skipped) emailOk = false;
    if (emailResult && emailResult.error) emailOk = false;
    var pushOk = !(pushResult && pushResult.error) && !(pushData && pushData.ok === false);
    if (emailFail) {
      try {
        console.warn("[alzidan-email-notify]", emailFail, emailData || emailResult);
      } catch (_) {}
    }
    if (pushFail) {
      try {
        console.warn("[alzidan-push-notify]", pushFail, pushData || pushResult);
      } catch (_) {}
    }
    return {
      ok: emailOk || pushOk,
      emailOk: emailOk,
      pushOk: pushOk,
      emailError: emailFail || "",
      pushError: pushFail || "",
      email: emailResult,
      push: pushResult,
      emailData: emailData,
      pushData: pushData
    };
  }

  /** Central admin notify for admin-only kinds (e.g. special_card). No branch delegates. */
  async function notifyAdminOfRequest(client, row) {
    var sb = client;
    var Safe =
      (typeof window !== "undefined" && window.AlzidanSafeRequestNotify) || null;
    var src = row || {};
    var rec =
      Safe && typeof Safe.scrubRecordForNotify === "function"
        ? Safe.scrubRecordForNotify(src)
        : {
            request_id: src.request_id || null,
            kind: src.kind || "",
            branch_key: src.branch_key || "",
            status: src.status || "pending",
            name: src.name || null,
            person: src.name || null,
          };
    if (rec && Object.prototype.hasOwnProperty.call(rec, "message")) {
      try {
        delete rec.message;
      } catch (_) {}
    }
    var kind = String(rec.kind || "").trim();
    if (!sb) return { ok: false, skipped: "missing" };
    if (Safe && typeof Safe.safeRenderOutbound === "function") {
      var preview = Safe.safeRenderOutbound({
        mode: "admin_new_request",
        kind: kind,
        branch_key: rec.branch_key,
        person: rec.person || rec.name,
        audience: "admin",
      });
      if (!preview) {
        try {
          console.warn("[admin_new_request] safe_render_blocked", kind);
        } catch (_) {}
        return { ok: false, skipped: "safe_render_blocked" };
      }
    }
    var adminKinds = {
      special_card: 1,
      tree_delegate: 1,
      events_delegate: 1,
      org_role: 1,
    };
    if (!adminKinds[kind]) return { ok: false, skipped: "kind" };
    var emailResult = null;
    var pushResult = null;
    try {
      emailResult = await sb.functions.invoke("alzidan-email-notify", {
        body: { mode: "admin_new_request", record: rec }
      });
    } catch (e) {
      emailResult = { error: e };
    }
    try {
      pushResult = await sb.functions.invoke("alzidan-push-notify", {
        body: { mode: "admin_new_request", record: rec }
      });
    } catch (e) {
      pushResult = { error: e };
    }
    var emailData = parseNotifyPayload(emailResult);
    var pushData = parseNotifyPayload(pushResult);
    var emailFail = summarizeNotifyFailure(emailResult, emailData);
    var pushFail = summarizeNotifyFailure(pushResult, pushData);
    var emailOk =
      !(emailResult && emailResult.error) &&
      !(emailData && emailData.ok === false) &&
      !(emailData && emailData.skipped);
    var pushOk =
      !(pushResult && pushResult.error) &&
      !(pushData && pushData.ok === false);
    if (emailFail) {
      try {
        console.warn("[alzidan-email-notify] admin", emailFail, emailData || emailResult);
      } catch (_) {}
    }
    if (pushFail) {
      try {
        console.warn("[alzidan-push-notify] admin", pushFail, pushData || pushResult);
      } catch (_) {}
    }
    return {
      ok: emailOk || pushOk,
      emailOk: emailOk,
      pushOk: pushOk,
      emailError: emailFail || "",
      pushError: pushFail || "",
      email: emailResult,
      push: pushResult,
      emailData: emailData,
      pushData: pushData
    };
  }

  root.AlzidanHomeRequestCreate = {
    notifyBranchDelegatesOfRequest: notifyBranchDelegatesOfRequest,
    notifyAdminOfRequest: notifyAdminOfRequest,
    create: create,
    evaluateOnly: evaluateOnly,
    fetchCatalog: fetchCatalog,
    findExistingChildLive: findExistingChildLive,
    findExistingEventLive: findExistingEventLive,
    findExistingHealthLive: findExistingHealthLive,
    findExistingDeathLive: findExistingDeathLive,
    findExistingMemoryLive: findExistingMemoryLive,
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
