/**
 * Register a member phone onto a tree person by name + id.
 * Marker: MEMBER_PHONE_REGISTER_V1
 */
(function (root) {
  "use strict";

  var MARKER = "MEMBER_PHONE_REGISTER_V1";

  function text(v) {
    return String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  }

  function parseTripleName(value) {
    var tokens = text(value)
      .split(" ")
      .filter(function (part) {
        return part && part !== "بن" && part !== "ابن";
      });
    if (tokens.length < 3) return null;
    return tokens.slice(0, 3);
  }

  function isMemberPhoneRegisterRequest(row) {
    var kind = text(row && row.kind);
    if (kind === "member_registration" || kind === "member_phone_register") {
      return true;
    }
    return text(row && row.message).indexOf(MARKER) >= 0;
  }

  function tripleFromRequest(row) {
    var msg = String((row && row.message) || "");
    var fromName = parseTripleName(row && row.name);
    var marker = msg.indexOf("__JSON__:");
    if (marker >= 0) {
      try {
        var obj = JSON.parse(msg.slice(marker + "__JSON__:".length).trim());
        var parsed = parseTripleName(obj && (obj.triple_name || obj.name));
        if (parsed) return parsed;
      } catch (_) {}
    }
    return fromName;
  }

  function foldAr(s) {
    return text(s)
      .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
      .replace(/[أإآٱ]/g, "ا")
      .replace(/ى/g, "ي")
      .replace(/ؤ/g, "و")
      .replace(/ئ/g, "ي")
      .replace(/ة/g, "ه");
  }

  function pathHasTriple(path, triple) {
    var hay = foldAr(text(path).replace(/\//g, " "));
    if (!triple || !triple.length) return false;
    return triple.every(function (token) {
      return hay.indexOf(foldAr(token)) >= 0;
    });
  }

  function leafOf(path) {
    var parts = text(path)
      .split("/")
      .map(text)
      .filter(Boolean);
    return parts.length ? parts[parts.length - 1] : "";
  }

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ||
        c
      );
    });
  }

  function scoreMatch(row, triple) {
    var path = row.child_name || row.name || "";
    var leaf = foldAr(leafOf(path));
    var first = foldAr(triple[0] || "");
    if (leaf === first) return 100;
    if (first && leaf.indexOf(first) === 0) return 80;
    if (first && leaf.indexOf(first) >= 0) return 60;
    return 20;
  }

  async function findPeopleByTriple(sb, triple, branchKey) {
    if (!sb || !triple || !triple.length) return { rows: [] };
    var cols = "id,person_id,child_name,name,branch_key,parent_name";
    async function query(branch) {
      var q = sb.from("tree_children").select(cols);
      if (branch) q = q.eq("branch_key", branch);
      triple.slice(0, 2).forEach(function (token) {
        var parts = [];
        var seen = Object.create(null);
        [text(token), foldAr(token)].forEach(function (v) {
          var safe = String(v || "").replace(/[,()%*_]/g, "");
          if (!safe || seen[safe]) return;
          seen[safe] = true;
          parts.push("child_name.ilike.%" + safe + "%");
          parts.push("name.ilike.%" + safe + "%");
        });
        if (parts.length) q = q.or(parts.join(","));
      });
      return q.limit(80);
    }
    var branch = text(branchKey);
    var res = await query(branch || null);
    if (res.error) return { rows: [], error: res.error, fallback: false };
    function take(data, tokens) {
      return (Array.isArray(data) ? data : []).filter(function (r) {
        return pathHasTriple(r.child_name || r.name || "", tokens);
      });
    }
    var data = res.data || [];
    var rows = take(data, triple);
    var fallback = false;
    if (!rows.length && triple.length >= 2) {
      rows = take(data, triple.slice(0, 2));
      fallback = rows.length > 0;
    }
    if (!rows.length && branch) {
      res = await query(null);
      if (!res.error) {
        data = res.data || [];
        rows = take(data, triple);
        fallback = false;
        if (!rows.length && triple.length >= 2) {
          rows = take(data, triple.slice(0, 2));
          fallback = rows.length > 0;
        }
      }
    }
    rows.sort(function (a, b) {
      return scoreMatch(b, triple) - scoreMatch(a, triple);
    });
    var seen = Object.create(null);
    rows = rows.filter(function (r) {
      var id = String(r && r.id ? r.id : "");
      if (!id || seen[id]) return false;
      seen[id] = true;
      return true;
    });
    return { rows: rows.slice(0, 8), fallback: fallback };
  }

  function normalizePhone(raw) {
    if (
      root.AlzidanPhoneIntl &&
      typeof root.AlzidanPhoneIntl.normalizeMemberPhoneE164 === "function"
    ) {
      return root.AlzidanPhoneIntl.normalizeMemberPhoneE164(raw) || "";
    }
    var digits = text(raw).replace(/[^\d]/g, "");
    if (!digits) return "";
    if (digits.indexOf("966") === 0 && digits.length >= 12) return "+" + digits;
    if (digits.length === 9 && digits.charAt(0) === "5") return "+966" + digits;
    if (digits.length === 10 && digits.indexOf("05") === 0) {
      return "+966" + digits.slice(1);
    }
    return "";
  }

  function phoneCandidates(raw) {
    var n = normalizePhone(raw);
    var digits = text(raw).replace(/[^\d]/g, "");
    var out = [];
    function add(v) {
      if (v && out.indexOf(v) < 0) out.push(v);
    }
    add(n);
    add(text(raw));
    if (digits) {
      add("+" + digits);
      add(digits);
      if (digits.indexOf("966") === 0) add("+" + digits);
    }
    return out;
  }

  async function resolvePerson(sb, personKey, branchKey) {
    var key = text(personKey);
    if (!sb || !key) return { row: null };
    var cols = "id,person_id,child_name,name,branch_key";
    async function lookup(withBranch) {
      var q = sb.from("tree_children").select(cols).limit(1);
      if (/^\d+$/.test(key)) q = q.eq("id", Number(key));
      else q = q.eq("person_id", key);
      if (withBranch) q = q.eq("branch_key", withBranch);
      return q.maybeSingle();
    }
    var branch = text(branchKey);
    var found = await lookup(branch || null);
    if (found.error) return { error: found.error };
    if ((!found.data || !found.data.id) && branch) {
      found = await lookup(null);
      if (found.error) return { error: found.error };
    }
    return { row: found.data || null };
  }

  async function isPhoneBound(sb, phone) {
    if (!sb) return false;
    var list = phoneCandidates(phone);
    for (var i = 0; i < list.length; i++) {
      var found = await sb
        .from("member_profiles")
        .select("id,tree_child_id")
        .eq("phone", list[i])
        .limit(1)
        .maybeSingle();
      if (found.data && Number(found.data.tree_child_id) > 0) return true;
    }
    return false;
  }

  function getClient() {
    try {
      if (
        root.AlzidanAdminCore &&
        typeof root.AlzidanAdminCore.getClient === "function"
      ) {
        var admin = root.AlzidanAdminCore.getClient();
        if (admin) return admin;
      }
    } catch (_) {}
    try {
      if (typeof root.getالخدمةClient === "function") {
        return root.getالخدمةClient();
      }
    } catch (_) {}
    return null;
  }

  function mountRegisterPanel(host, row, opts) {
    if (!host) return;
    opts = opts || {};
    host.innerHTML = "";
    var wrap = document.createElement("div");
    wrap.style.cssText =
      "display:flex;flex-direction:column;gap:8px;min-width:220px;margin:0 0 10px;padding:10px 12px;border:1px solid rgba(4,120,87,0.22);border-radius:12px;background:#f4faf7;text-align:right;";
    var triple = tripleFromRequest(row) || [];
    var tripleText = triple.join(" ");
    var phone = normalizePhone(row && row.phone) || text(row && row.phone);
    wrap.innerHTML =
      "<strong>تسجيل الجوال على شخص</strong>" +
      '<div style="font-size:13px;line-height:1.6;color:#065f46">' +
      (tripleText ? "الاسم الثلاثي: <b>" + esc(tripleText) + "</b><br>" : "") +
      (phone ? "الجوال: <b dir=\"ltr\">" + esc(phone) + "</b><br>" : "") +
      (text(row && row.branch_key) ? "الفرع: " + esc(text(row.branch_key)) : "") +
      "</div>" +
      '<div data-mpr-matches style="font-size:13px;color:#6b7280">جاري البحث في الشجرة...</div>' +
      '<label style="font-size:12px;font-weight:700;color:#065f46">معرّف الشخص (إن لم يظهر أعلاه)</label>' +
      '<input type="text" data-mpr-person-key dir="ltr" lang="en" autocomplete="off" placeholder="الرقم أو الأيدي" style="width:100%;padding:7px 9px;border-radius:8px;border:1px solid #d1d5db;box-sizing:border-box;font-size:13px;" />' +
      '<button type="button" class="btn btn-primary btn-sm" data-mpr-bind>سجّل الرقم على هذا الشخص</button>' +
      '<div data-mpr-status style="font-size:12px;min-height:16px;"></div>';
    host.appendChild(wrap);
    var statusEl = wrap.querySelector("[data-mpr-status]");
    var input = wrap.querySelector("[data-mpr-person-key]");
    var matchesEl = wrap.querySelector("[data-mpr-matches]");
    var btn = wrap.querySelector("[data-mpr-bind]");
    function setStatus(msg, isError) {
      if (!statusEl) return;
      statusEl.textContent = msg || "";
      statusEl.style.color = isError ? "#b91c1c" : "#065f46";
    }
    function paintMatches(people, fallback) {
      if (!matchesEl) return;
      matchesEl.innerHTML = "";
      if (!people.length) {
        matchesEl.textContent =
          "لم يظهر بهذا الاسم الثلاثي في الشجرة. راجع الفرع أو اكتب المعرّف.";
        return;
      }
      var title = document.createElement("div");
      title.style.cssText = "font-weight:800;color:#065f46;margin-bottom:4px";
      title.textContent = fallback
        ? "أسماء قريبة في الشجرة — راجع المسار ثم اختر:"
        : people.length === 1
          ? "وُجد في الشجرة:"
          : "المطابقون في الشجرة — اختر الشخص:";
      matchesEl.appendChild(title);
      people.forEach(function (person) {
        var path = person.child_name || person.name || "";
        var card = document.createElement("button");
        card.type = "button";
        card.setAttribute("data-mpr-pick", String(person.id));
        card.style.cssText =
          "display:block;width:100%;text-align:right;padding:8px 10px;margin:0 0 6px;border:1px solid #a7f3d0;border-radius:10px;background:#fff;cursor:pointer;line-height:1.55";
        card.innerHTML =
          "<b>" +
          esc(leafOf(path) || triple[0] || "شخص") +
          "</b>" +
          '<div style="font-size:12px;color:#374151">' +
          esc(path) +
          "</div>" +
          '<div style="font-size:12px;color:#065f46">الرقم: ' +
          esc(String(person.id)) +
          (person.person_id
            ? " · الأيدي: " + esc(String(person.person_id))
            : "") +
          "</div>";
        card.addEventListener("click", function () {
          if (input) input.value = String(person.id);
          wrap.querySelectorAll("[data-mpr-pick]").forEach(function (el) {
            el.style.borderColor = "#a7f3d0";
            el.style.background = "#fff";
          });
          card.style.borderColor = "#047857";
          card.style.background = "#ecfdf5";
          setStatus("محدد: " + leafOf(path) + " — الرقم " + person.id);
        });
        matchesEl.appendChild(card);
        if (!fallback && people.length === 1) card.click();
      });
    }
    (async function loadMatches() {
      var sb = opts.sb || getClient();
      if (!sb || !triple.length) {
        paintMatches([]);
        return;
      }
      var found = await findPeopleByTriple(sb, triple, row && row.branch_key);
      if (found.error) {
        if (matchesEl) {
          matchesEl.textContent =
            found.error.message || "تعذر البحث في الشجرة.";
        }
        return;
      }
      paintMatches(found.rows || [], !!found.fallback);
    })();
    if (btn) {
      btn.addEventListener("click", async function () {
        var sb = opts.sb || getClient();
        if (!sb) {
          setStatus("تعذر الاتصال.", true);
          return;
        }
        btn.disabled = true;
        setStatus("جاري التسجيل...");
        var res = await registerMemberPhoneByPersonKey(sb, {
          phone: phone,
          personKey: input && input.value,
          tripleName: tripleText,
          branchKey: row && row.branch_key,
        });
        btn.disabled = false;
        if (!res || !res.ok) {
          setStatus((res && res.message) || "تعذر التسجيل.", true);
          return;
        }
        setStatus("تم ربط الجوال بهذا الشخص. يمكنك قبول الطلب.");
      });
    }
  }

  async function registerMemberPhoneByPersonKey(sb, opts) {
    opts = opts || {};
    var phone = normalizePhone(opts.phone);
    var personKey = text(opts.personKey);
    var triple = parseTripleName(
      Array.isArray(opts.triple) ? opts.triple.join(" ") : opts.tripleName || "",
    );
    var branchKey = text(opts.branchKey);
    if (!sb) return { ok: false, message: "تعذر الاتصال." };
    if (!phone) return { ok: false, message: "رقم الجوال غير صحيح." };
    if (!personKey) return { ok: false, message: "اكتب معرّف الشخص (الرقم أو الأيدي)." };
    if (!triple) return { ok: false, message: "الاسم الثلاثي مطلوب." };

    var found = await resolvePerson(sb, personKey, branchKey);
    if (found && found.error) {
      return { ok: false, message: found.error.message || "تعذر إيجاد الشخص." };
    }
    var child = found && found.row;
    if (!child || !child.id) {
      return { ok: false, message: "لا يوجد شخص بهذا المعرّف." };
    }
    var path = child.child_name || child.name || "";
    if (!pathHasTriple(path, triple)) {
      return {
        ok: false,
        message: "الاسم الثلاثي لا يطابق هذا المعرّف. راجع الاسم والأيدي.",
      };
    }

    if (typeof sb.rpc === "function") {
      try {
        var rpc = await sb.rpc("bind_sender_phone_to_person_v1", {
          p_phone: phone,
          p_person_id: child.person_id ? String(child.person_id) : null,
          p_tree_child_id: child.id,
        });
        if (!rpc.error && rpc.data && rpc.data.ok !== false) {
          return { ok: true, tree_child_id: child.id, person_id: child.person_id };
        }
      } catch (_) {}
    }

    var displayName = String(path)
      .split("/")
      .map(function (part) {
        return text(part);
      })
      .filter(Boolean)
      .slice(-1)[0] || triple[0];
    var row = {
      phone: phone,
      branch_key: child.branch_key || branchKey || null,
      tree_child_id: child.id,
      person_id: child.person_id || null,
      display_name: displayName,
      status: "active",
      updated_at: new Date().toISOString(),
    };
    var existingId = 0;
    var byChild = await sb
      .from("member_profiles")
      .select("id")
      .eq("tree_child_id", child.id)
      .limit(1)
      .maybeSingle();
    if (byChild.data && byChild.data.id) existingId = Number(byChild.data.id);
    if (!existingId && row.person_id) {
      var byPid = await sb
        .from("member_profiles")
        .select("id")
        .eq("person_id", row.person_id)
        .limit(1)
        .maybeSingle();
      if (byPid.data && byPid.data.id) existingId = Number(byPid.data.id);
    }
    if (!existingId) {
      var byPhone = await sb
        .from("member_profiles")
        .select("id")
        .eq("phone", phone)
        .limit(1)
        .maybeSingle();
      if (byPhone.error) return { ok: false, message: byPhone.error.message };
      if (byPhone.data && byPhone.data.id) existingId = Number(byPhone.data.id);
    }
    if (existingId) {
      var upd = await sb.from("member_profiles").update(row).eq("id", existingId);
      if (upd.error) return { ok: false, message: upd.error.message };
      return { ok: true, tree_child_id: child.id, person_id: child.person_id };
    }
    row.created_at = new Date().toISOString();
    var ins = await sb.from("member_profiles").insert(row);
    if (ins.error) return { ok: false, message: ins.error.message };
    return { ok: true, tree_child_id: child.id, person_id: child.person_id };
  }

  root.AlzidanMemberPhoneRegister = {
    MARKER: MARKER,
    parseTripleName: parseTripleName,
    isMemberPhoneRegisterRequest: isMemberPhoneRegisterRequest,
    tripleFromRequest: tripleFromRequest,
    registerMemberPhoneByPersonKey: registerMemberPhoneByPersonKey,
    isPhoneBound: isPhoneBound,
    mountRegisterPanel: mountRegisterPanel,
  };
})(typeof window !== "undefined" ? window : globalThis);
