/**
 * Admin/Delegate editor for name_correction + phone_correction.
 * Preview → save (tree upsert / member_profiles) → approve status.
 */
(function () {
  "use strict";

  var dialogEl = null;
  var activeRow = null;
  var activeMode = "admin";
  var working = { payload: null, preview: null, treeRow: null };

  function C() {
    return window.AlzidanTreeCorrectionContract || null;
  }

  function text(v) {
    return String(v == null ? "" : v)
      .replace(/\s+/g, " ")
      .trim();
  }

  function getAdminToken() {
    try {
      if (
        window.AlzidanAuth &&
        typeof window.AlzidanAuth.getAdminToken === "function"
      ) {
        var fromAuth = String(window.AlzidanAuth.getAdminToken() || "").trim();
        if (fromAuth) return fromAuth;
      }
    } catch (_) {}
    try {
      if (
        window.AlzidanAdminCore &&
        typeof window.AlzidanAdminCore.getAdminToken === "function"
      ) {
        var fromCore = String(
          window.AlzidanAdminCore.getAdminToken() || ""
        ).trim();
        if (fromCore) return fromCore;
      }
    } catch (_) {}
    try {
      if (typeof window.getAdminToken === "function") {
        var fromWin = String(window.getAdminToken() || "").trim();
        if (fromWin) return fromWin;
      }
    } catch (_) {}
    try {
      var session = String(
        sessionStorage.getItem("alzidan_admin_token_session_v1") || ""
      ).trim();
      if (session) return session;
    } catch (_) {}
    try {
      return String(localStorage.getItem("alzidan_admin_token_v1") || "").trim();
    } catch (_) {
      return "";
    }
  }

  function getClient() {
    try {
      if (
        window.AlzidanDelegateTreeWrite &&
        typeof window.AlzidanDelegateTreeWrite.getClient === "function"
      ) {
        var d = window.AlzidanDelegateTreeWrite.getClient();
        if (d) return d;
      }
    } catch (_) {}
    try {
      if (
        window.AlzidanAdminCore &&
        typeof window.AlzidanAdminCore.getClient === "function"
      ) {
        return window.AlzidanAdminCore.getClient();
      }
    } catch (_) {}
    try {
      if (typeof window.getSupabaseClient === "function") {
        return window.getSupabaseClient();
      }
    } catch (_) {}
    return null;
  }

  function coerceRpcId(v) {
    if (
      window.AlzidanAdminCore &&
      typeof window.AlzidanAdminCore.coerceRpcId === "function"
    ) {
      return window.AlzidanAdminCore.coerceRpcId(v);
    }
    if (v == null) return "";
    if (typeof v === "number" && Number.isFinite(v)) return v;
    var s = String(v || "").trim();
    return s || "";
  }

  function ensureDialog() {
    if (dialogEl && document.body.contains(dialogEl)) return dialogEl;
    dialogEl = document.createElement("dialog");
    dialogEl.id = "tcp-person-dialog";
    dialogEl.style.cssText =
      "max-width:560px;width:calc(100% - 24px);border:none;border-radius:14px;padding:0;direction:rtl;";
    dialogEl.innerHTML =
      '<form method="dialog" style="margin:0">' +
      '<div style="padding:16px 18px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;gap:8px;align-items:center">' +
      '<strong data-tcp-title>تصحيح بيانات شخص</strong>' +
      '<button type="submit" class="btn btn-outline btn-sm" value="cancel">إغلاق</button>' +
      "</div>" +
      '<div style="padding:16px 18px" data-tcp-body></div>' +
      '<div style="padding:12px 18px;border-top:1px solid #e5e7eb;display:flex;gap:8px;justify-content:flex-end">' +
      '<button type="button" class="btn btn-primary" id="tcp-save">حفظ وتطبيق</button>' +
      "</div>" +
      '<div style="padding:0 18px 14px;font-size:13px" data-tcp-status></div>' +
      "</form>";
    document.body.appendChild(dialogEl);
    var saveBtn = dialogEl.querySelector("#tcp-save");
    if (saveBtn) {
      saveBtn.addEventListener("click", function (ev) {
        ev.preventDefault();
        savePersonCorrection();
      });
    }
    return dialogEl;
  }

  function setStatus(msg, isError) {
    var el = dialogEl && dialogEl.querySelector("[data-tcp-status]");
    if (!el) return;
    el.textContent = msg || "";
    el.style.color = isError ? "#b91c1c" : "#065f46";
  }

  function leafOf(path) {
    var parts = text(path)
      .split("/")
      .map(text)
      .filter(Boolean);
    return parts.length ? parts[parts.length - 1] : "";
  }

  function parentOf(path) {
    var parts = text(path)
      .split("/")
      .map(text)
      .filter(Boolean);
    if (parts.length < 2) return "";
    return parts.slice(0, -1).join("/");
  }

  function treePath(row) {
    return text((row && (row.child_name || row.name)) || "");
  }

  async function loadTreeRow(sb, personId, branch) {
    if (!sb || !personId) return null;
    var q = sb
      .from("tree_children")
      .select(
        "id,branch_key,person_id,parent_person_id,child_name,name,parent_name,birth_order,birth_date_g,birth_date_h,birth_year,city,area,is_deceased"
      )
      .eq("person_id", personId)
      .limit(1);
    if (branch) q = q.eq("branch_key", branch);
    var res = await q.maybeSingle();
    if (res.error || !res.data) return null;
    return res.data;
  }

  async function loadPhone(sb, personId, branch, treeChildId) {
    if (!sb) return "";
    if (treeChildId) {
      var byChild = await sb
        .from("member_profiles")
        .select("phone,person_id")
        .eq("tree_child_id", treeChildId)
        .limit(1)
        .maybeSingle();
      if (!byChild.error && byChild.data && byChild.data.phone) {
        return String(byChild.data.phone || "").trim();
      }
    }
    if (personId) {
      var byPid = await sb
        .from("member_profiles")
        .select("phone")
        .eq("person_id", personId)
        .limit(1)
        .maybeSingle();
      if (!byPid.error && byPid.data && byPid.data.phone) {
        return String(byPid.data.phone || "").trim();
      }
    }
    return "";
  }

  async function openPersonCorrectionEditor(row, opts) {
    opts = opts || {};
    var api = C();
    if (!api) {
      window.alert("وحدة عقد التصحيح غير محمّلة.");
      return;
    }
    activeRow = row;
    activeMode = opts.mode === "delegate" ? "delegate" : "admin";
    var parsed = api.parseCorrectionMessage(row && row.message, row);
    if (
      !parsed ||
      [
        api.OPERATION_NAME,
        api.OPERATION_PHONE,
        api.OPERATION_BIRTH,
        api.OPERATION_PARENT,
        api.OPERATION_CITY,
      ].indexOf(parsed.operation) < 0
    ) {
      window.alert("هذا الطلب ليس تصحيح شخص/أب منظم.");
      return;
    }
    working.payload = parsed.payload || {};
    working.preview = api.buildPersonCorrectionPreview(working.payload);
    working.treeRow = null;

    var dlg = ensureDialog();
    var title = dlg.querySelector("[data-tcp-title]");
    var body = dialogEl.querySelector("[data-tcp-body]");
    if (title) {
      title.textContent =
        parsed.operation === api.OPERATION_NAME
          ? "تصحيح اسم"
          : parsed.operation === api.OPERATION_PHONE
            ? "تصحيح جوال"
            : parsed.operation === api.OPERATION_BIRTH
              ? "تصحيح ميلاد"
              : parsed.operation === api.OPERATION_CITY
                ? "تصحيح مدينة"
                : "تصحيح أب";
    }
    setStatus("جاري تحميل سجل الشخص…");
    if (typeof dlg.showModal === "function") dlg.showModal();
    else dlg.setAttribute("open", "open");

    var sb = getClient();
    if (!sb) {
      setStatus("تعذر الاتصال.", true);
      return;
    }
    var treeRow = await loadTreeRow(
      sb,
      working.payload.person_id,
      working.payload.branch_key
    );
    working.treeRow = treeRow;
    if (!treeRow) {
      setStatus(
        "تعذر إيجاد الشخص في الشجرة بالـ person_id — لا حفظ.",
        true
      );
    } else {
      var currentPhone = await loadPhone(
        sb,
        working.payload.person_id,
        working.payload.branch_key,
        treeRow.id
      );
      if (parsed.operation === api.OPERATION_PHONE && !working.payload.phone_old) {
        working.payload.phone_old = currentPhone;
        working.preview = api.buildPersonCorrectionPreview(working.payload);
      }
      if (parsed.operation === api.OPERATION_NAME && !working.payload.name_old) {
        working.payload.name_old = leafOf(treeRow.child_name || treeRow.name);
        working.preview = api.buildPersonCorrectionPreview(working.payload);
      }
      if (parsed.operation === api.OPERATION_BIRTH && !working.payload.birth_date_old) {
        working.payload.birth_date_old = text(treeRow.birth_date_g || "");
        working.preview = api.buildPersonCorrectionPreview(working.payload);
      }
      if (parsed.operation === api.OPERATION_CITY) {
        if (!working.payload.city_old) {
          working.payload.city_old = text(treeRow.city || "");
        }
        if (!working.payload.area_old) {
          working.payload.area_old = text(treeRow.area || "");
        }
        working.preview = api.buildPersonCorrectionPreview(working.payload);
      }
      if (parsed.operation === api.OPERATION_PARENT) {
        if (!working.payload.old_parent_person_id) {
          working.payload.old_parent_person_id = text(treeRow.parent_person_id || "");
        }
        if (!working.payload.old_parent_name) {
          working.payload.old_parent_name = text(treeRow.parent_name || parentOf(treeRow.child_name || treeRow.name));
        }
        working.preview = api.buildPersonCorrectionPreview(working.payload);
      }
      setStatus("");
    }
    renderBody();
  }

  function renderBody() {
    var api = C();
    var p = working.payload || {};
    var body = dialogEl.querySelector("[data-tcp-body]");
    if (!body || !api) return;
    var prev = working.preview || api.buildPersonCorrectionPreview(p);
    var tree = working.treeRow;
    var path = tree
      ? text(tree.child_name || tree.name)
      : text(p.path || "");
    body.innerHTML =
      '<p style="margin:0 0 10px;font-size:14px"><strong>الشخص:</strong> ' +
      escapeHtml(p.person_name || leafOf(path) || p.person_id) +
      "<br><span style=\"color:#6b7280;font-size:12px\">" +
      escapeHtml(path || "—") +
      " · " +
      escapeHtml(p.branch_key || "") +
      "</span></p>" +
      (p.operation === api.OPERATION_NAME
        ? '<p style="margin:0 0 8px"><strong>الاسم الجديد:</strong> ' +
          escapeHtml(p.name_new) +
          "</p>"
        : p.operation === api.OPERATION_PHONE
          ? '<p style="margin:0 0 8px"><strong>الجوال الجديد:</strong> <span dir="ltr">' +
            escapeHtml(p.phone_new) +
            "</span></p>"
          : p.operation === api.OPERATION_BIRTH
            ? '<p style="margin:0 0 8px"><strong>الميلاد الجديد:</strong> ' +
              escapeHtml(p.birth_date_new) +
              "</p>"
            : p.operation === api.OPERATION_CITY
              ? '<p style="margin:0 0 8px">' +
                (p.city_new
                  ? "<strong>المدينة الجديدة:</strong> " +
                    escapeHtml(p.city_new) +
                    "<br>"
                  : "") +
                (p.area_new
                  ? "<strong>الحي/القرية الجديد:</strong> " +
                    escapeHtml(p.area_new)
                  : "") +
                "</p>"
              : '<p style="margin:0 0 8px"><strong>الأب الجديد:</strong> ' +
                escapeHtml(p.new_parent_name || p.new_parent_person_id) +
                "</p>") +
      '<div style="background:#f8fafc;border-radius:10px;padding:10px 12px;margin:10px 0">' +
      "<div><strong>يتغير</strong><ul style=\"margin:6px 0 0;padding-inline-start:18px\">" +
      (prev.changes || [])
        .map(function (c) {
          return "<li>" + escapeHtml(c) + "</li>";
        })
        .join("") +
      "</ul></div>" +
      "<div style=\"margin-top:8px\"><strong>لن يتغير</strong><ul style=\"margin:6px 0 0;padding-inline-start:18px\">" +
      (prev.unchanged || [])
        .map(function (c) {
          return "<li>" + escapeHtml(c) + "</li>";
        })
        .join("") +
      "</ul></div></div>" +
      "";
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function adminRename(sb, token, treeRow, nameNew) {
    var path = text(treeRow.child_name || treeRow.name);
    var parent = text(treeRow.parent_name) || parentOf(path);
    var newPath = parent ? parent + "/" + nameNew : nameNew;
    var row = {
      branch_key: treeRow.branch_key,
      parent_name: parent,
      parent: parent,
      child_name: newPath,
      name: newPath,
      person_id: treeRow.person_id,
      parent_person_id: treeRow.parent_person_id,
      birth_order: treeRow.birth_order,
      id: treeRow.id,
      birth_date_g: treeRow.birth_date_g || null,
      birth_date_h: treeRow.birth_date_h || null,
      birth_year: treeRow.birth_year != null ? treeRow.birth_year : null,
      city: treeRow.city || null,
      area: treeRow.area || null,
      is_deceased: !!treeRow.is_deceased,
    };
    var upsert = await sb.rpc("admin_tree_child_upsert_v1", {
      p_token: token,
      p_row: row,
    });
    if (upsert.error) return { ok: false, error: upsert.error };
    return { ok: true, newPath: newPath };
  }

  async function checkPhoneConflict(sb, phone, personId) {
    var res = await sb
      .from("member_profiles")
      .select("id,person_id,phone,display_name,tree_child_id,branch_key,status")
      .eq("phone", phone)
      .limit(5);
    if (res.error) return { ok: false, error: res.error };
    var rows = Array.isArray(res.data) ? res.data : [];
    if (!rows.length) return { ok: true };
    var selfId = text(personId);
    var foreign = rows.filter(function (r) {
      var other = text(r.person_id);
      if (!other) return true;
      return !selfId || other !== selfId;
    });
    if (!foreign.length) {
      return { ok: true, existingId: Number(rows[0].id) };
    }
    var hit = foreign[0];
    var label = text(hit.display_name) || text(hit.person_id) || "#" + hit.id;
    return {
      ok: false,
      conflict: true,
      otherProfileId: Number(hit.id),
      otherPersonId: text(hit.person_id),
      otherDisplayName: label,
      message:
        "الجوال مرتبط بشخص آخر («" +
        label +
        "»). لا يُحفظ صامتًا — يلزم قرار صريح بفك الربط أو الإلغاء.",
    };
  }

  async function reassignPhoneFromConflict(sb, phone, treeRow, conflict) {
    var otherId = Number(conflict && conflict.otherProfileId);
    if (!otherId) {
      return { ok: false, message: "تعذر تحديد ملف الطرف الآخر في التعارض." };
    }
    var clear = await sb
      .from("member_profiles")
      .update({
        phone: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", otherId);
    if (clear.error) {
      return {
        ok: false,
        message:
          (clear.error && clear.error.message) ||
          "تعذر فك الجوال من الطرف الآخر.",
        error: clear.error,
      };
    }
    return savePhoneProfile(sb, phone, treeRow);
  }

  function confirmPhoneConflictDecision(conflict, personLabel) {
    var other =
      (conflict && (conflict.otherDisplayName || conflict.otherPersonId)) ||
      "شخص آخر";
    return window.confirm(
      "تعارض جوال (قرار صريح مطلوب)\n\n" +
        "الجوال مطلوب لـ: " +
        (personLabel || "هذا الشخص") +
        "\n" +
        "ومرتبط حاليًا بـ: " +
        other +
        "\n\n" +
        "موافق = فك الربط من الطرف الآخر وربطه بهذا الشخص.\n" +
        "إلغاء = إيقاف الحفظ بلا تغيير."
    );
  }

  async function savePhoneProfile(sb, phone, treeRow) {
    var branch = text(treeRow.branch_key);
    var path = text(treeRow.child_name || treeRow.name);
    var personId = text(treeRow.person_id);
    var rowId = Number(treeRow.id);
    var displayName = leafOf(path);
    var row = {
      phone: phone,
      branch_key: branch,
      tree_child_id: rowId,
      person_id: personId || null,
      display_name: displayName || null,
      status: "active",
      updated_at: new Date().toISOString(),
    };
    var existingId = 0;
    var byChild = await sb
      .from("member_profiles")
      .select("id")
      .eq("tree_child_id", rowId)
      .limit(1)
      .maybeSingle();
    if (!byChild.error && byChild.data && byChild.data.id) {
      existingId = Number(byChild.data.id);
    }
    if (!existingId && personId) {
      var byPid = await sb
        .from("member_profiles")
        .select("id")
        .eq("person_id", personId)
        .limit(1)
        .maybeSingle();
      if (!byPid.error && byPid.data && byPid.data.id) {
        existingId = Number(byPid.data.id);
      }
    }
    if (existingId) {
      var upd = await sb.from("member_profiles").update(row).eq("id", existingId);
      if (upd.error) return { ok: false, error: upd.error };
      return { ok: true };
    }
    row.created_at = new Date().toISOString();
    var ins = await sb.from("member_profiles").insert(row);
    if (ins.error) return { ok: false, error: ins.error };
    return { ok: true };
  }

  async function approveRequestStatus(sb) {
    var id = coerceRpcId(
      activeRow.id != null && String(activeRow.id).trim() !== ""
        ? activeRow.id
        : activeRow.request_id
    );
    if (!id) return { ok: false, message: "بيانات الطلب ناقصة." };
    if (activeMode === "admin") {
      var token = getAdminToken();
      if (!token) return { ok: false, message: "يلزم تسجيل دخول الإدارة." };
      var statusRes = await sb.rpc("admin_set_request_status_v2", {
        p_token: token,
        p_id: id,
        p_status: "approved",
      });
      if (statusRes.error) {
        return {
          ok: false,
          message: String(
            (statusRes.error && statusRes.error.message) || statusRes.error
          ),
        };
      }
      if (statusRes.data === false) {
        return { ok: false, message: "تعذر اعتماد الطلب (جلسة/صلاحية)." };
      }
      return { ok: true };
    }
    if (
      window.AlzidanDelegateTreeWrite &&
      typeof window.AlzidanDelegateTreeWrite.setRequestApproved === "function"
    ) {
      var del = await window.AlzidanDelegateTreeWrite.setRequestApproved(
        activeRow
      );
      if (del && del.ok === false) {
        return { ok: false, message: "تعذر اعتماد الطلب من المندوب." };
      }
      return { ok: true };
    }
    return { ok: false, message: "وحدة اعتماد المندوب غير محمّلة." };
  }


  async function adminUpsertPersonRow(sb, token, treeRow, patch) {
    var path = text(treeRow.child_name || treeRow.name);
    var parent = text(treeRow.parent_name) || parentOf(path);
    var row = {
      branch_key: treeRow.branch_key,
      parent_name: parent,
      parent: parent,
      child_name: path,
      name: path,
      person_id: treeRow.person_id,
      parent_person_id: treeRow.parent_person_id,
      birth_order: treeRow.birth_order,
      id: treeRow.id,
      birth_date_g: treeRow.birth_date_g || null,
      birth_date_h: treeRow.birth_date_h || null,
      birth_year: treeRow.birth_year != null ? treeRow.birth_year : null,
      city: treeRow.city || null,
      area: treeRow.area || null,
      is_deceased: !!treeRow.is_deceased,
    };
    Object.keys(patch || {}).forEach(function (k) {
      row[k] = patch[k];
    });
    var upsert = await sb.rpc("admin_tree_child_upsert_v1", {
      p_token: token,
      p_row: row,
    });
    if (upsert.error) return { ok: false, error: upsert.error };
    return { ok: true };
  }

  async function adminChangeParent(sb, token, treeRow, newParent) {
    var leaf = leafOf(treeRow.child_name || treeRow.name);
    var newParentPath = text(newParent.path || newParent.child_name || newParent.name);
    var newPath = newParentPath ? newParentPath + "/" + leaf : leaf;
    var row = {
      branch_key: treeRow.branch_key,
      parent_name: newParentPath,
      parent: newParentPath,
      child_name: newPath,
      name: newPath,
      person_id: treeRow.person_id,
      parent_person_id: text(newParent.person_id),
      birth_order: treeRow.birth_order,
      id: treeRow.id,
      birth_date_g: treeRow.birth_date_g || null,
      birth_date_h: treeRow.birth_date_h || null,
      birth_year: treeRow.birth_year != null ? treeRow.birth_year : null,
      city: treeRow.city || null,
      area: treeRow.area || null,
      is_deceased: !!treeRow.is_deceased,
    };
    var upsert = await sb.rpc("admin_tree_child_upsert_v1", {
      p_token: token,
      p_row: row,
    });
    if (upsert.error) return { ok: false, error: upsert.error };
    return { ok: true, newPath: newPath };
  }

  async function savePersonCorrection() {
    var api = C();
    if (!api || !activeRow) return;
    var p = working.payload || {};
    var tree = working.treeRow;
    if (!tree) {
      setStatus("لا يمكن الحفظ بلا سجل شجرة موثوق.", true);
      return;
    }
    var confirmed = window.confirm(
      "تأكيد الحفظ؟\n\n" +
        (working.preview.changes || []).join("\n") +
        "\n\nلن يتغير:\n- " +
        (working.preview.unchanged || []).join("\n- ")
    );
    if (!confirmed) return;

    var sb = getClient();
    if (!sb) {
      setStatus("تعذر الاتصال.", true);
      return;
    }
    var saveBtn = dialogEl && dialogEl.querySelector("#tcp-save");
    if (saveBtn) saveBtn.disabled = true;
    setStatus("جاري الحفظ…");

    try {
      if (p.operation === api.OPERATION_NAME) {
        // Sibling duplicate check under same parent
        var parent = text(tree.parent_name) || parentOf(tree.child_name || tree.name);
        var sibs = await sb
          .from("tree_children")
          .select("person_id,child_name,name")
          .eq("branch_key", tree.branch_key)
          .eq("parent_name", parent)
          .limit(200);
        if (!sibs.error && Array.isArray(sibs.data)) {
          var clash = sibs.data.some(function (r) {
            if (text(r.person_id) === text(tree.person_id)) return false;
            return leafOf(r.child_name || r.name) === p.name_new;
          });
          if (clash) {
            throw new Error("اسم الابن مسجل مسبقًا لهذا الأب.");
          }
        }
        if (activeMode === "admin") {
          var token = getAdminToken();
          if (!token) throw new Error("يلزم تسجيل دخول الإدارة.");
          var ren = await adminRename(sb, token, tree, p.name_new);
          if (!ren.ok) {
            throw new Error(
              (ren.error && ren.error.message) || "فشل تحديث الاسم"
            );
          }
        } else if (
          window.AlzidanDelegateTreeWrite &&
          typeof window.AlzidanDelegateTreeWrite.renamePerson === "function"
        ) {
          var dRename = await window.AlzidanDelegateTreeWrite.renamePerson(
            tree,
            p.name_new
          );
          if (!dRename || !dRename.ok) {
            throw new Error(
              (dRename && dRename.message) || "فشل تحديث الاسم من المندوب"
            );
          }
        } else {
          throw new Error(
            "حفظ تصحيح الاسم من المندوب غير متاح — حدّث الصفحة أو نفّذ أمر الصيانة من الإدارة."
          );
        }
        // verify
        var again = await loadTreeRow(sb, p.person_id, p.branch_key);
        if (!again || leafOf(again.child_name || again.name) !== p.name_new) {
          throw new Error("الحفظ لم يُثبَّت — الاسم في الشجرة لا يطابق المطلوب.");
        }
        working.treeRow = again;
      } else if (p.operation === api.OPERATION_PHONE) {
        var conflict = await checkPhoneConflict(sb, p.phone_new, p.person_id);
        var phoneSaveOk = false;
        if (conflict.ok) {
          phoneSaveOk = true;
        } else if (conflict.conflict) {
          var personLabel =
            p.person_name || leafOf(tree.child_name || tree.name) || p.person_id;
          if (!confirmPhoneConflictDecision(conflict, personLabel)) {
            throw new Error("أُوقف الحفظ — لم يُحسم تعارض الجوال.");
          }
          var reassigned = await reassignPhoneFromConflict(
            sb,
            p.phone_new,
            tree,
            conflict
          );
          if (!reassigned.ok) {
            throw new Error(
              (reassigned && reassigned.message) ||
                "فشل فك/إعادة ربط الجوال بعد التعارض"
            );
          }
          phoneSaveOk = true;
        } else {
          throw new Error(
            (conflict && conflict.message) ||
              (conflict.error && conflict.error.message) ||
              "تعارض جوال"
          );
        }
        if (phoneSaveOk && !(conflict && conflict.conflict)) {
          if (activeMode === "delegate") {
            if (
              window.AlzidanDelegateTreeWrite &&
              typeof window.AlzidanDelegateTreeWrite.saveMemberPhone === "function"
            ) {
              var dPhone = await window.AlzidanDelegateTreeWrite.saveMemberPhone(
                tree,
                p.phone_new
              );
              if (!dPhone || !dPhone.ok) {
                throw new Error(
                  (dPhone && dPhone.message) || "فشل حفظ الجوال من المندوب"
                );
              }
            } else {
              var phoneResD = await savePhoneProfile(sb, p.phone_new, tree);
              if (!phoneResD.ok) {
                throw new Error(
                  (phoneResD.error && phoneResD.error.message) || "فشل حفظ الجوال"
                );
              }
            }
          } else {
            var phoneRes = await savePhoneProfile(sb, p.phone_new, tree);
            if (!phoneRes.ok) {
              throw new Error(
                (phoneRes.error && phoneRes.error.message) || "فشل حفظ الجوال"
              );
            }
          }
        } else if (phoneSaveOk && conflict && conflict.conflict) {
          // already saved via reassignPhoneFromConflict
        }
        var phoneNow = await loadPhone(
          sb,
          p.person_id,
          p.branch_key,
          tree.id
        );
        if (phoneNow !== p.phone_new) {
          throw new Error("الحفظ لم يُثبَّت — الجوال في الملف لا يطابق المطلوب.");
        }
      } else if (p.operation === api.OPERATION_BIRTH) {
        var tokenB = getAdminToken();
        if (activeMode === "admin") {
          if (!tokenB) throw new Error("يلزم تسجيل دخول الإدارة.");
          var year = null;
          if (/^\d{4}/.test(p.birth_date_new)) {
            year = parseInt(p.birth_date_new.slice(0, 4), 10);
          }
          var birthRes = await adminUpsertPersonRow(sb, tokenB, tree, {
            birth_date_g: p.birth_date_new,
            birth_year: year,
          });
          if (!birthRes.ok) {
            throw new Error(
              (birthRes.error && birthRes.error.message) || "فشل تحديث الميلاد"
            );
          }
        } else if (
          window.AlzidanDelegateTreeWrite &&
          typeof window.AlzidanDelegateTreeWrite.updateBirthDate === "function"
        ) {
          var dBirth = await window.AlzidanDelegateTreeWrite.updateBirthDate(
            tree,
            p.birth_date_new
          );
          if (!dBirth || !dBirth.ok) {
            throw new Error((dBirth && dBirth.message) || "فشل تحديث الميلاد");
          }
        } else {
          throw new Error("حفظ الميلاد من المندوب غير متاح — استخدم الإدارة.");
        }
        var againB = await loadTreeRow(sb, p.person_id, p.branch_key);
        if (!againB || text(againB.birth_date_g || "") !== p.birth_date_new) {
          throw new Error("الحفظ لم يُثبَّت — الميلاد في الشجرة لا يطابق المطلوب.");
        }
        working.treeRow = againB;
      } else if (p.operation === api.OPERATION_CITY) {
        var cityPatch = {};
        if (p.city_new) cityPatch.city = p.city_new;
        if (p.area_new) cityPatch.area = p.area_new;
        if (activeMode === "admin") {
          var tokenC = getAdminToken();
          if (!tokenC) throw new Error("يلزم تسجيل دخول الإدارة.");
          var cityRes = await adminUpsertPersonRow(sb, tokenC, tree, cityPatch);
          if (!cityRes.ok) {
            throw new Error(
              (cityRes.error && cityRes.error.message) || "فشل تحديث المدينة"
            );
          }
        } else if (
          window.AlzidanDelegateTreeWrite &&
          typeof window.AlzidanDelegateTreeWrite.updateCity === "function"
        ) {
          var dCity = await window.AlzidanDelegateTreeWrite.updateCity(
            tree,
            cityPatch
          );
          if (!dCity || !dCity.ok) {
            throw new Error(
              (dCity && dCity.message) || "فشل تحديث المدينة من المندوب"
            );
          }
        } else {
          throw new Error(
            "حفظ المدينة من المندوب غير متاح — حدّث الصفحة أو استخدم الإدارة."
          );
        }
        var againC = await loadTreeRow(sb, p.person_id, p.branch_key);
        if (!againC) {
          throw new Error("الحفظ لم يُثبَّت — تعذر إعادة قراءة السجل.");
        }
        if (p.city_new && text(againC.city || "") !== p.city_new) {
          throw new Error("الحفظ لم يُثبَّت — المدينة في الشجرة لا تطابق المطلوب.");
        }
        if (p.area_new && text(againC.area || "") !== p.area_new) {
          throw new Error(
            "الحفظ لم يُثبَّت — الحي/القرية في الشجرة لا يطابق المطلوب."
          );
        }
        working.treeRow = againC;
      } else if (p.operation === api.OPERATION_PARENT) {
        var parentRow = await loadTreeRow(
          sb,
          p.new_parent_person_id,
          p.branch_key
        );
        if (!parentRow) {
          throw new Error("تعذر إيجاد الأب الجديد في الشجرة.");
        }
        if (activeMode === "admin") {
          var tokenP = getAdminToken();
          if (!tokenP) throw new Error("يلزم تسجيل دخول الإدارة.");
          var moved = await adminChangeParent(sb, tokenP, tree, {
            person_id: parentRow.person_id,
            path: treePath(parentRow),
            child_name: parentRow.child_name,
            name: parentRow.name,
          });
          if (!moved.ok) {
            throw new Error(
              (moved.error && moved.error.message) || "فشل تحديث الأب"
            );
          }
        } else if (
          window.AlzidanDelegateTreeWrite &&
          typeof window.AlzidanDelegateTreeWrite.changeParent === "function"
        ) {
          var dParent = await window.AlzidanDelegateTreeWrite.changeParent(
            tree,
            {
              person_id: parentRow.person_id,
              path: treePath(parentRow),
              child_name: parentRow.child_name,
              name: parentRow.name,
            }
          );
          if (!dParent || !dParent.ok) {
            throw new Error(
              (dParent && dParent.message) || "فشل تحديث الأب من المندوب"
            );
          }
        } else {
          throw new Error(
            "حفظ تصحيح الأب من المندوب غير متاح — حدّث الصفحة أو نفّذ أمر الصيانة من الإدارة."
          );
        }
        var againP = await loadTreeRow(sb, p.person_id, p.branch_key);
        if (
          !againP ||
          text(againP.parent_person_id) !== text(p.new_parent_person_id)
        ) {
          throw new Error("الحفظ لم يُثبَّت — الأب في الشجرة لا يطابق المطلوب.");
        }
        working.treeRow = againP;
      } else {
        throw new Error("عملية غير معروفة.");
      }

      var stamped = api.normalizePersonCorrectionPayload(
        Object.assign({}, p, {
          review_state: "ready",
          applied_at: new Date().toISOString(),
          path: text(
            (working.treeRow &&
              (working.treeRow.child_name || working.treeRow.name)) ||
              p.path
          ),
          person_name:
            p.operation === api.OPERATION_NAME
              ? p.name_new
              : p.person_name || leafOf(
                  (working.treeRow &&
                    (working.treeRow.child_name || working.treeRow.name)) ||
                    ""
                ),
        })
      );
      var newMessage = api.serializePersonCorrectionMessage(stamped);
      try {
        var adminToken = getAdminToken();
        if (activeMode === "admin" && adminToken) {
          await sb.rpc("admin_update_request_branch_v1", {
            p_token: adminToken,
            p_id: String(
              coerceRpcId(
                activeRow.id != null ? activeRow.id : activeRow.request_id
              )
            ),
            p_old_branch_key: text(activeRow.branch_key || "") || null,
            p_branch_key: text(activeRow.branch_key || p.branch_key || "") || null,
            p_name: text(activeRow.name || "") || null,
            p_phone: text(activeRow.phone || "") || null,
            p_email: text(activeRow.email || "") || null,
            p_message: newMessage,
            p_old_tree_rows: [],
            p_new_tree_rows: [],
          });
        }
      } catch (_) {}

      var status = await approveRequestStatus(sb);
      if (!status.ok) {
        setStatus(
          "تم حفظ التصحيح في الشجرة/الملف لكن تعذر اعتماد الطلب: " +
            (status.message || ""),
          true
        );
        try {
          window.alert(
            "التصحيح حُفظ، لكن الطلب ما زال تحت الإجراء.\n" +
              (status.message || "")
          );
        } catch (_) {}
      } else {
        setStatus("تم الحفظ والتحقق واعتماد الطلب.");
        setTimeout(function () {
          try {
            if (dialogEl && dialogEl.open) dialogEl.close();
          } catch (_) {}
        }, 800);
      }
      if (typeof window.reloadAdminRequests === "function") {
        try {
          window.reloadAdminRequests();
        } catch (_) {}
      }
      if (
        window.AlzidanRequestActions &&
        typeof window.AlzidanRequestActions._reloadRequests === "function"
      ) {
        try {
          window.AlzidanRequestActions._reloadRequests();
        } catch (_) {}
      }
    } catch (err) {
      setStatus(
        "فشل الحفظ دون انهيار: " + String((err && err.message) || err || ""),
        true
      );
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  window.AlzidanTreeCorrectionPerson = {
    openPersonCorrectionEditor: openPersonCorrectionEditor,
    openNameEditor: function (row, opts) {
      return openPersonCorrectionEditor(row, opts);
    },
    openPhoneEditor: function (row, opts) {
      return openPersonCorrectionEditor(row, opts);
    },
  };
})();
