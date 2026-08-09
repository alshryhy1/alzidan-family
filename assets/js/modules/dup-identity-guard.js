/**
 * Unified Duplicate / Identity Guard (home requests).
 *
 * Principle: تشابه النص لا يعني أن السجل مكرر، ووجود نفس الاسم لا يعني أنه نفس الشخص.
 *
 * Verdicts:
 *   block  — same entity proven (ids / identifying field set)
 *   review — possible similarity; never auto-merge
 *   allow  — truly new
 *
 * Global: window.AlzidanDupIdentityGuard (also CommonJS-friendly for node tests)
 */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.AlzidanDupIdentityGuard = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  var TYPE = {
    ADD_PERSON: "add_person",
    EVENT: "event",
    HEALTH: "health",
    DEATH: "death",
    MEMORY: "memory",
  };

  var VERDICT = {
    ALLOW: "allow",
    BLOCK: "block",
    REVIEW: "review",
  };

  var MSG = {
    ADD_PERSON_EXISTS:
      "هذا الشخص موجود مسبقًا في الشجرة تحت نفس السياق. لا يُنشأ معرّف جديد — استخدم تصحيح البيانات إن لزم.",
    ADD_PERSON_SIMILAR:
      "يوجد أشخاص بنفس الاسم أو مشابهون. أكّد إن كان شخصًا موجودًا أو شخصًا آخر بنفس الاسم — التشابه وحده لا يكفي للحظر.",
    EVENT_SAME: "مناسبة مطابقة مسجّلة مسبقًا (النوع + الشخص/المعرّف + التاريخ).",
    EVENT_SIMILAR:
      "مناسبة مشابهة بالعنوان/الاسم دون إثبات كامل للهوية. راجع قبل الإرسال — لا دمج تلقائي.",
    HEALTH_SAME: "حالة صحية مطابقة لنفس الشخص ونوع الحالة والحقول المعرّفة مسجّلة مسبقًا.",
    HEALTH_SIMILAR:
      "حالة صحية مشابهة لنفس الشخص دون اكتمال الحقول المعرّفة. راجع يدويًا.",
    DEATH_SAME: "وفاة مسجّلة مسبقًا لنفس person_id — لا يُقبل إعلان ثانٍ.",
    DEATH_SIMILAR:
      "يوجد سجل وفاة باسم مشابه بلا person_id مؤكد. التشابه بالاسم غير كافٍ للحظر النهائي — راجع.",
    MEMORY_SAME: "ذكرى مطابقة مسجّلة مسبقًا (الشخص + العنوان + التاريخ/النوع).",
    MEMORY_SIMILAR:
      "ذكرى مشابهة لنفس الشخص دون تطابق كامل للحقول. راجع قبل الإرسال.",
    DOUBLE_SUBMIT: "طلب مكرر: جارٍ إرسال بنفس البصمة أو أُرسل للتو — لن يُنشأ طلب ثانٍ.",
    NEW: "لا يوجد تطابق كيان مثبت — يمكن المتابعة.",
  };

  function text(v) {
    return String(v == null ? "" : v)
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeArabic(v) {
    return text(v)
      .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
      .replace(/[أإآ]/g, "ا")
      .replace(/ى/g, "ي")
      .replace(/ؤ/g, "و")
      .replace(/ئ/g, "ي")
      .replace(/ة/g, "ه")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function normalizeDateKey(v) {
    var s = text(v)
      .replace(/[٠-٩]/g, function (d) {
        return String(d.charCodeAt(0) - 1632);
      })
      .replace(/[۰-۹]/g, function (d) {
        return String(d.charCodeAt(0) - 1776);
      });
    if (!s) return "";
    var iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (iso) {
      return (
        iso[1] +
        "-" +
        String(iso[2]).padStart(2, "0") +
        "-" +
        String(iso[3]).padStart(2, "0")
      );
    }
    return normalizeArabic(s);
  }

  function isUuidLike(v) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      text(v)
    );
  }

  function pid(v) {
    var s = text(v);
    return isUuidLike(s) ? s.toLowerCase() : "";
  }

  function leafOf(pathOrName) {
    var n = text(pathOrName);
    if (!n) return "";
    if (n.indexOf("/") < 0) return n;
    var parts = n.split("/").map(text).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : n;
  }

  function result(verdict, code, messageAr, extra) {
    var out = {
      verdict: verdict,
      code: code || "",
      message_ar: messageAr || "",
      matches: [],
      similar: [],
      fingerprint: "",
    };
    if (extra) {
      Object.keys(extra).forEach(function (k) {
        out[k] = extra[k];
      });
    }
    if (!Array.isArray(out.matches)) out.matches = [];
    if (!Array.isArray(out.similar)) out.similar = [];
    return out;
  }

  function healthCaseType(v) {
    var t = text(v).toLowerCase();
    if (t === "sick" || t === "operation" || t === "discharge" || t === "health") {
      return t === "health" ? "sick" : t;
    }
    return t;
  }

  function isHealthType(v) {
    var t = healthCaseType(v);
    return t === "sick" || t === "operation" || t === "discharge";
  }

  function fingerprint(type, payload) {
    var p = payload || {};
    var t = text(type);
    var parts = [t];
    if (t === TYPE.ADD_PERSON) {
      parts.push(
        pid(p.parent_person_id) || normalizeArabic(p.parent_path || p.father || "")
      );
      parts.push(normalizeArabic(p.person_name || p.name || ""));
      parts.push(normalizeArabic(p.branch_key || p.branch || ""));
    } else if (t === TYPE.EVENT) {
      parts.push(normalizeArabic(p.type || ""));
      parts.push(pid(p.person_id) || normalizeArabic(p.person || p.person_name || ""));
      parts.push(normalizeDateKey(p.event_date || p.date_label || p.dateLabel || ""));
      parts.push(normalizeArabic(p.title || p.person || ""));
      parts.push(normalizeArabic(p.branch_key || p.branch || ""));
    } else if (t === TYPE.HEALTH) {
      parts.push(healthCaseType(p.type || p.case_type || "sick"));
      parts.push(pid(p.person_id) || normalizeArabic(p.person || p.person_name || ""));
      parts.push(
        normalizeArabic(p.hospital_name || p.hospitalName || "") +
          "|" +
          normalizeArabic(p.home_city || p.homeCity || "") +
          "|" +
          normalizeArabic(p.home_area || p.homeArea || "")
      );
      parts.push(normalizeDateKey(p.event_date || p.date_label || p.dateLabel || ""));
    } else if (t === TYPE.DEATH) {
      parts.push(pid(p.person_id) || "");
      parts.push(normalizeArabic(p.person || p.person_name || ""));
      parts.push(normalizeDateKey(p.event_date || p.date_label || p.dateLabel || ""));
    } else if (t === TYPE.MEMORY) {
      parts.push(pid(p.person_id) || normalizeArabic(p.person_name || ""));
      parts.push(normalizeArabic(p.title || ""));
      parts.push(normalizeArabic(p.memory_kind || ""));
      parts.push(normalizeDateKey(p.memory_date || p.memory_year || ""));
    } else {
      parts.push(JSON.stringify(p));
    }
    return parts.join("::");
  }

  function evaluateAddPerson(payload, catalog) {
    var p = payload || {};
    var cat = catalog || {};
    var siblings = Array.isArray(cat.siblings) ? cat.siblings : [];
    var people = Array.isArray(cat.people) ? cat.people : [];
    var nameQ = normalizeArabic(p.person_name || p.name || "");
    var parentPid = pid(p.parent_person_id);
    var parentPath = normalizeArabic(p.parent_path || p.father_path || p.father || "");
    var affirmedExisting = !!p.identity_affirmed_existing;
    var differentSameName = !!p.different_person_same_name;

    if (affirmedExisting) {
      return result(VERDICT.BLOCK, "ADD_PERSON_EXISTS", MSG.ADD_PERSON_EXISTS, {
        matches: [{ reason: "user_affirmed_existing" }],
      });
    }

    var sameParent = [];
    siblings.forEach(function (row) {
      if (!row) return;
      var leaf = normalizeArabic(row.leaf || leafOf(row.child_name || row.name || row.person_name));
      if (!leaf || leaf !== nameQ) return;
      var rowParentPid = pid(row.parent_person_id);
      var rowParentPath = normalizeArabic(
        row.parent_path || row.parent_name || row.parent || ""
      );
      var samePid = parentPid && rowParentPid && parentPid === rowParentPid;
      var samePath =
        !parentPid &&
        parentPath &&
        rowParentPath &&
        (parentPath === rowParentPath ||
          parentPath.endsWith("/" + rowParentPath) ||
          rowParentPath.endsWith("/" + parentPath));
      if (samePid || samePath || (parentPid && !rowParentPid && samePath)) {
        sameParent.push(row);
      } else if (parentPid && rowParentPid && parentPid === rowParentPid) {
        sameParent.push(row);
      }
    });

    if (sameParent.length) {
      return result(VERDICT.BLOCK, "ADD_PERSON_EXISTS", MSG.ADD_PERSON_EXISTS, {
        matches: sameParent,
      });
    }

    // Explicit person_id pointing at an existing tree row → block (do not mint new id)
    var wantPid = pid(p.person_id);
    if (wantPid) {
      var byId = people.filter(function (row) {
        return pid(row.person_id) === wantPid;
      });
      if (byId.length) {
        return result(VERDICT.BLOCK, "ADD_PERSON_EXISTS", MSG.ADD_PERSON_EXISTS, {
          matches: byId,
        });
      }
    }

    var similar = [];
    people.forEach(function (row) {
      if (!row) return;
      var leaf = normalizeArabic(row.leaf || leafOf(row.child_name || row.name || row.person_name));
      if (leaf && leaf === nameQ) similar.push(row);
    });
    // Also scan siblings list as people for cross-branch name hits when people empty
    if (!people.length) {
      siblings.forEach(function (row) {
        var leaf = normalizeArabic(row.leaf || leafOf(row.child_name || row.name || ""));
        if (leaf && leaf === nameQ) similar.push(row);
      });
    }

    if (similar.length && !differentSameName) {
      return result(VERDICT.REVIEW, "ADD_PERSON_SIMILAR", MSG.ADD_PERSON_SIMILAR, {
        similar: similar,
      });
    }

    return result(VERDICT.ALLOW, "NEW", MSG.NEW);
  }

  function eventIdentityKey(row) {
    var type = normalizeArabic(row.type || "");
    var personKey = pid(row.person_id) || "";
    var dateKey = normalizeDateKey(row.event_date || row.date_label || row.dateLabel || "");
    var title = normalizeArabic(row.title || "");
    var personName = normalizeArabic(row.person || row.person_name || "");
    return {
      type: type,
      personKey: personKey,
      dateKey: dateKey,
      title: title,
      personName: personName,
      branch: normalizeArabic(row.branch_key || row.branch || ""),
    };
  }

  function evaluateEvent(payload, catalog) {
    var p = payload || {};
    var events = Array.isArray((catalog || {}).events) ? catalog.events : [];
    var pending = Array.isArray((catalog || {}).pending_requests)
      ? catalog.pending_requests
      : [];
    var want = eventIdentityKey(p);
    var matches = [];
    var similar = [];

    function consider(row, source) {
      if (!row) return;
      var got = eventIdentityKey(row);
      if (want.type && got.type && want.type !== got.type) return;
      var samePersonId = want.personKey && got.personKey && want.personKey === got.personKey;
      var sameDate = want.dateKey && got.dateKey && want.dateKey === got.dateKey;
      var sameTitle =
        (want.title && got.title && want.title === got.title) ||
        (want.personName && got.personName && want.personName === got.personName);
      var sameBranch = !want.branch || !got.branch || want.branch === got.branch;

      if (samePersonId && sameDate && sameBranch && (sameTitle || !want.title)) {
        matches.push(Object.assign({ _source: source }, row));
        return;
      }
      // Title + related person id + date (no reliance on name alone)
      if (samePersonId && sameDate && sameTitle && sameBranch) {
        matches.push(Object.assign({ _source: source }, row));
        return;
      }
      // Without person_id: require type + title + date + branch (still not name alone)
      if (
        !want.personKey &&
        !got.personKey &&
        sameDate &&
        want.title &&
        got.title &&
        want.title === got.title &&
        sameBranch &&
        want.type === got.type
      ) {
        matches.push(Object.assign({ _source: source }, row));
        return;
      }
      if (
        sameTitle &&
        want.type === got.type &&
        sameBranch &&
        (!want.personKey || !got.personKey || want.personKey === got.personKey)
      ) {
        similar.push(Object.assign({ _source: source }, row));
      }
    }

    events.forEach(function (r) {
      consider(r, "family_events");
    });
    pending.forEach(function (r) {
      consider(r, "pending_request");
    });

    if (matches.length) {
      return result(VERDICT.BLOCK, "EVENT_SAME", MSG.EVENT_SAME, { matches: matches });
    }
    if (similar.length) {
      return result(VERDICT.REVIEW, "EVENT_SIMILAR", MSG.EVENT_SIMILAR, {
        similar: similar,
      });
    }
    return result(VERDICT.ALLOW, "NEW", MSG.NEW);
  }

  function healthIdentFields(row) {
    return {
      type: healthCaseType(row.type || row.case_type || "sick"),
      personKey: pid(row.person_id),
      personName: normalizeArabic(row.person || row.person_name || ""),
      hospital: normalizeArabic(row.hospital_name || row.hospitalName || ""),
      homeCity: normalizeArabic(row.home_city || row.homeCity || ""),
      homeArea: normalizeArabic(row.home_area || row.homeArea || ""),
      dateKey: normalizeDateKey(row.event_date || row.date_label || row.dateLabel || ""),
      branch: normalizeArabic(row.branch_key || row.branch || ""),
    };
  }

  function evaluateHealth(payload, catalog) {
    var p = payload || {};
    var events = Array.isArray((catalog || {}).events) ? catalog.events : [];
    var pending = Array.isArray((catalog || {}).pending_requests)
      ? catalog.pending_requests
      : [];
    var want = healthIdentFields(p);
    var matches = [];
    var similar = [];

    function consider(row, source) {
      if (!row) return;
      var t = healthCaseType(row.type || row.case_type || "");
      if (!isHealthType(t) && source === "family_events") return;
      var got = healthIdentFields(row);
      if (want.type !== got.type) return;

      var samePerson =
        (want.personKey && got.personKey && want.personKey === got.personKey) ||
        false;
      // Name alone never proves same person for BLOCK
      var samePlace =
        (want.hospital && got.hospital && want.hospital === got.hospital) ||
        (want.homeCity &&
          got.homeCity &&
          want.homeCity === got.homeCity &&
          want.homeArea === got.homeArea);
      var sameDate = want.dateKey && got.dateKey && want.dateKey === got.dateKey;
      var sameBranch = !want.branch || !got.branch || want.branch === got.branch;

      if (samePerson && sameBranch && (samePlace || sameDate)) {
        matches.push(Object.assign({ _source: source }, row));
        return;
      }
      if (samePerson && sameBranch) {
        similar.push(Object.assign({ _source: source }, row));
        return;
      }
      if (
        !want.personKey &&
        !got.personKey &&
        want.personName &&
        got.personName &&
        want.personName === got.personName &&
        samePlace &&
        sameDate &&
        sameBranch
      ) {
        // Both sides lack id but place+date+name+type align → still REVIEW (not proven id)
        similar.push(Object.assign({ _source: source }, row));
      }
    }

    events.forEach(function (r) {
      consider(r, "family_events");
    });
    pending.forEach(function (r) {
      consider(r, "pending_request");
    });

    if (matches.length) {
      return result(VERDICT.BLOCK, "HEALTH_SAME", MSG.HEALTH_SAME, { matches: matches });
    }
    if (similar.length) {
      return result(VERDICT.REVIEW, "HEALTH_SIMILAR", MSG.HEALTH_SIMILAR, {
        similar: similar,
      });
    }
    return result(VERDICT.ALLOW, "NEW", MSG.NEW);
  }

  function evaluateDeath(payload, catalog) {
    var p = payload || {};
    var cat = catalog || {};
    var people = Array.isArray(cat.people) ? cat.people : [];
    var events = Array.isArray(cat.events) ? cat.events : [];
    var pending = Array.isArray(cat.pending_requests) ? cat.pending_requests : [];
    var wantPid = pid(p.person_id);
    var wantName = normalizeArabic(p.person || p.person_name || "");
    var matches = [];
    var similar = [];

    if (wantPid) {
      people.forEach(function (row) {
        if (pid(row.person_id) !== wantPid) return;
        var dead =
          row.is_deceased === true ||
          row.deceased === true ||
          text(row.is_deceased) === "true" ||
          text(row.deceased) === "true";
        if (dead) matches.push(Object.assign({ _source: "tree_children" }, row));
      });
      events.forEach(function (row) {
        if (normalizeArabic(row.type) !== "death") return;
        if (pid(row.person_id) === wantPid) {
          matches.push(Object.assign({ _source: "family_events" }, row));
        }
      });
      pending.forEach(function (row) {
        if (normalizeArabic(row.type || "") !== "death") return;
        if (pid(row.person_id) === wantPid) {
          matches.push(Object.assign({ _source: "pending_request" }, row));
        }
      });
    }

    if (matches.length) {
      return result(VERDICT.BLOCK, "DEATH_SAME", MSG.DEATH_SAME, { matches: matches });
    }

    // Name-only hits → review, never block
    if (wantName) {
      events.forEach(function (row) {
        if (normalizeArabic(row.type) !== "death") return;
        if (pid(row.person_id)) return;
        if (normalizeArabic(row.person || row.person_name || "") === wantName) {
          similar.push(Object.assign({ _source: "family_events" }, row));
        }
      });
      people.forEach(function (row) {
        var leaf = normalizeArabic(row.leaf || leafOf(row.child_name || row.name || ""));
        var dead =
          row.is_deceased === true ||
          row.deceased === true ||
          text(row.is_deceased) === "true";
        if (dead && leaf === wantName && !wantPid) {
          similar.push(Object.assign({ _source: "tree_children" }, row));
        }
      });
    }

    if (similar.length) {
      return result(VERDICT.REVIEW, "DEATH_SIMILAR", MSG.DEATH_SIMILAR, {
        similar: similar,
      });
    }
    return result(VERDICT.ALLOW, "NEW", MSG.NEW);
  }

  function evaluateMemory(payload, catalog) {
    var p = payload || {};
    var items = Array.isArray((catalog || {}).memories) ? catalog.memories : [];
    var wantPid = pid(p.person_id);
    var wantTitle = normalizeArabic(p.title || "");
    var wantKind = normalizeArabic(p.memory_kind || "");
    var wantDate = normalizeDateKey(p.memory_date || p.memory_year || "");
    var wantName = normalizeArabic(p.person_name || "");
    var matches = [];
    var similar = [];

    items.forEach(function (row) {
      if (!row) return;
      var samePerson =
        (wantPid && pid(row.person_id) === wantPid) ||
        (!wantPid &&
          !pid(row.person_id) &&
          wantName &&
          normalizeArabic(row.person_name || "") === wantName);
      if (!samePerson && wantPid && pid(row.person_id) !== wantPid) return;
      if (!samePerson && wantPid) return;

      var sameTitle = wantTitle && normalizeArabic(row.title || "") === wantTitle;
      var sameKind =
        !wantKind ||
        !normalizeArabic(row.memory_kind || "") ||
        wantKind === normalizeArabic(row.memory_kind || "");
      var sameDate =
        !wantDate ||
        !normalizeDateKey(row.memory_date || row.memory_year || "") ||
        wantDate === normalizeDateKey(row.memory_date || row.memory_year || "");

      if (samePerson && sameTitle && sameKind && (wantDate ? sameDate : true)) {
        // Require date match when both have dates; if payload has date and row matches title+person+kind+date → same
        if (wantDate) {
          if (wantDate === normalizeDateKey(row.memory_date || row.memory_year || "")) {
            matches.push(row);
            return;
          }
          similar.push(row);
          return;
        }
        // No date on payload: same person+title+kind is enough to treat as same memory
        matches.push(row);
        return;
      }
      if (samePerson && sameTitle) {
        similar.push(row);
      }
    });

    if (matches.length) {
      return result(VERDICT.BLOCK, "MEMORY_SAME", MSG.MEMORY_SAME, { matches: matches });
    }
    if (similar.length) {
      return result(VERDICT.REVIEW, "MEMORY_SIMILAR", MSG.MEMORY_SIMILAR, {
        similar: similar,
      });
    }
    return result(VERDICT.ALLOW, "NEW", MSG.NEW);
  }

  /**
   * @param {string} type
   * @param {object} payload
   * @param {object} [catalog]
   * @param {object} [opts] { doubleSubmit?: boolean }
   */
  function evaluate(type, payload, catalog, opts) {
    var t = text(type);
    var options = opts || {};
    var fp = fingerprint(t, payload);
    if (options.doubleSubmit) {
      var blocked = result(VERDICT.BLOCK, "DOUBLE_SUBMIT", MSG.DOUBLE_SUBMIT, {
        fingerprint: fp,
      });
      blocked.fingerprint = fp;
      return blocked;
    }

    var out;
    if (t === TYPE.ADD_PERSON) out = evaluateAddPerson(payload, catalog);
    else if (t === TYPE.EVENT) out = evaluateEvent(payload, catalog);
    else if (t === TYPE.HEALTH) out = evaluateHealth(payload, catalog);
    else if (t === TYPE.DEATH) out = evaluateDeath(payload, catalog);
    else if (t === TYPE.MEMORY) out = evaluateMemory(payload, catalog);
    else {
      out = result(VERDICT.ALLOW, "UNKNOWN_TYPE", "نوع غير معروف — يُسمح مع الحذر.");
    }
    out.fingerprint = fp;
    return out;
  }

  return {
    TYPE: TYPE,
    VERDICT: VERDICT,
    MSG: MSG,
    text: text,
    normalizeArabic: normalizeArabic,
    normalizeDateKey: normalizeDateKey,
    fingerprint: fingerprint,
    evaluate: evaluate,
    isHealthType: isHealthType,
  };
});
