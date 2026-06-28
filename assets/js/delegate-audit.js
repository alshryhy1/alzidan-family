(() => {
  "use strict";

  const Core = window.AlzidanAdminCore || {};
  const {
    showAlert,
    hideAlert,
    getClient,
    getAdminToken,
    formatDateTimeArSaVerbose,
    coerceRpcId,
  } = Core;

  const delegateAuditSelect = document.getElementById("delegate-audit-select");
  const delegateAuditStatus = document.getElementById("delegate-audit-status");
  const delegateAuditBody = document.getElementById("delegate-audit-body");
  const delegatesListEl = document.getElementById("delegates-list");
  const delegatePermsStatus = document.getElementById("delegate-perms-status");
  const delegatePermsTreeBtn = document.getElementById("delegate-perms-tree");
  const delegatePermsEventsBtn = document.getElementById("delegate-perms-events");
  const delegatePermsBothBtn = document.getElementById("delegate-perms-both");
  const delegatePermsDisableBtn = document.getElementById("delegate-perms-disable");

  function safeParseJsonText(v) {
    try {
      if (v == null) return null;
      const s = String(v || "").trim();
      if (!s) return null;
      if (!(s.startsWith("{") || s.startsWith("["))) return null;
      return JSON.parse(s);
    } catch (e) {
      return null;
    }
  }
  function setDelegateAuditStatus(text) {
    if (!delegateAuditStatus) return;
    delegateAuditStatus.textContent = text || "";
  }
  function clearDelegateAuditTable(text) {
    if (!delegateAuditBody) return;
    delegateAuditBody.innerHTML = "";
    if (!text) return;
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5;
    td.className = "hint";
    td.textContent = text;
    tr.appendChild(td);
    delegateAuditBody.appendChild(tr);
  }
  function formatAuditOp(op) {
    const o = String(op || "").trim();
    if (o === "insert") return "إضافة";
    if (o === "update") return "تعديل";
    if (o === "delete") return "حذف";
    if (o === "upsert_update") return "تعديل (موجود)";
    return o || "عملية";
  }
  function formatAuditTarget(env, row) {
    if (env && (env.kind === "events_audit" || env.kind === "event_audit")) {
      const parts = [];
      const type = env.type != null ? String(env.type || "").trim() : "";
      const person = env.person != null ? String(env.person || "").trim() : "";
      const date =
        env.event_date != null ? String(env.event_date || "").trim() : "";
      if (type) parts.push("النوع: " + type);
      if (person) parts.push("الاسم: " + person);
      if (date) parts.push("التاريخ: " + date);
      return parts.join(" — ");
    }
    const parent =
      env && env.parent_name != null
        ? String(env.parent_name)
        : String(row.parent_name || row.parent || "");
    const child =
      env && env.child_name != null
        ? String(env.child_name)
        : String(row.child_name || row.name || "");
    const parts = [];
    if (parent) parts.push("الأب: " + parent);
    if (child) parts.push("الابن: " + child);
    return parts.join(" — ");
  }
  function renderDelegatesList(entries, selectedKey, onPick) {
    if (!delegatesListEl) return;
    delegatesListEl.innerHTML = "";
    if (!entries.length) {
      const empty = document.createElement("div");
      empty.className = "hint";
      empty.textContent = "لا توجد بيانات مناديب حالياً.";
      delegatesListEl.appendChild(empty);
      return;
    }
    entries.forEach((e) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-outline btn-sm";
      btn.textContent = e.label;
      if (e.key === selectedKey) {
        btn.style.borderColor = "rgba(4,120,87,0.55)";
        btn.style.color = "#065f46";
      }
      btn.addEventListener("click", () => onPick(e.key));
      delegatesListEl.appendChild(btn);
    });
  }
  function renderDelegateAuditSelect(entries, selectedKey, onPick) {
    if (!delegateAuditSelect) return;
    delegateAuditSelect.innerHTML = "";
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "اختر مندوباً";
    delegateAuditSelect.appendChild(opt0);
    entries.forEach((e) => {
      const opt = document.createElement("option");
      opt.value = e.key;
      opt.textContent = e.label;
      delegateAuditSelect.appendChild(opt);
    });
    delegateAuditSelect.value = selectedKey || "";
    delegateAuditSelect.onchange = () =>
      onPick(String(delegateAuditSelect.value || ""));
  }
  function renderDelegateAuditRows(rows) {
    if (!delegateAuditBody) return;
    delegateAuditBody.innerHTML = "";
    if (!rows.length) {
      clearDelegateAuditTable("لا توجد تعديلات لهذا المندوب بعد.");
      return;
    }
    rows.forEach((row) => {
      const env = safeParseJsonText(row.message);
      const tr = document.createElement("tr");
      const tdTime = document.createElement("td");
      try {
        tdTime.textContent = row.created_at
          ? formatDateTimeArSaVerbose(row.created_at)
          : "";
      } catch (e) {
        tdTime.textContent = String(row.created_at || "");
      }
      tr.appendChild(tdTime);
      const tdOp = document.createElement("td");
      tdOp.textContent = formatAuditOp(env && env.op ? env.op : "");
      tr.appendChild(tdOp);
      const tdBranch = document.createElement("td");
      tdBranch.textContent = String(
        row.branch_key || (env && env.branch_key ? env.branch_key : "") || "",
      );
      tr.appendChild(tdBranch);
      const tdTarget = document.createElement("td");
      tdTarget.textContent = formatAuditTarget(env, row);
      tr.appendChild(tdTarget);
      const tdDetails = document.createElement("td");
      if (env) {
        const det = document.createElement("details");
        det.className = "msg";
        const sum = document.createElement("summary");
        sum.textContent = "عرض";
        const body = document.createElement("div");
        try {
          body.textContent = JSON.stringify(env, null, 2);
        } catch (e) {
          body.textContent = String(row.message || "");
        }
        det.appendChild(sum);
        det.appendChild(body);
        tdDetails.appendChild(det);
      } else if (row.message) {
        const det = document.createElement("details");
        det.className = "msg";
        const sum = document.createElement("summary");
        sum.textContent = "عرض";
        const body = document.createElement("div");
        body.textContent = String(row.message || "");
        det.appendChild(sum);
        det.appendChild(body);
        tdDetails.appendChild(det);
      } else {
        tdDetails.textContent = "";
      }
      tr.appendChild(tdDetails);
      delegateAuditBody.appendChild(tr);
    });
  }
  let delegateAuditState = {
    selectedKey: "",
    delegates: [],
    auditRows: [],
    accessByKey: new Map(),
  };
  function buildDelegateKey(branchKey, phone, email) {
    const b = String(branchKey || "").trim();
    const p = String(phone || "").trim();
    const e = String(email || "").trim();
    return [b, p, e].join("|");
  }
  function labelForDelegate(row, countsByKey) {
    const b = String(row.branch_key || "").trim();
    const p = String(row.phone || "").trim();
    const e = String(row.email || "").trim();
    const n = String(row.name || "").trim();
    const key = buildDelegateKey(b, p, e);
    const c = countsByKey.get(key) || 0;
    const who = n ? n : p || e || "مندوب";
    const parts = [];
    parts.push(who);
    if (b) parts.push("— " + b);
    parts.push("— " + String(c));
    return parts.join(" ");
  }
  function applyDelegateAuditSelection(key) {
    const k = String(key || "").trim();
    delegateAuditState.selectedKey = k;
    if (!k) {
      clearDelegateAuditTable("اختر مندوباً لعرض السجل.");
      setDelegateAuditStatus("");
      if (delegatePermsStatus) delegatePermsStatus.textContent = "";
      return;
    }
    const filtered = delegateAuditState.auditRows
      .filter((r) => buildDelegateKey(r.branch_key, r.phone, r.email) === k)
      .sort((a, b) =>
        String(b.created_at || "").localeCompare(String(a.created_at || "")),
      );
    renderDelegateAuditRows(filtered.slice(0, 300));
    const total = filtered.length;
    setDelegateAuditStatus(
      total ? "عدد السجلات: " + String(total) : "لا توجد سجلات.",
    );
    const caps = delegateAuditState.accessByKey.get(k) || null;
    const treeStatus = caps && caps.tree ? String(caps.tree.status || "") : "";
    const eventsStatus =
      caps && caps.events ? String(caps.events.status || "") : "";
    const parts = [];
    parts.push("الشجرة: " + (treeStatus || "غير موجود"));
    parts.push("المناسبات: " + (eventsStatus || "غير موجود"));
    if (delegatePermsStatus)
      delegatePermsStatus.textContent = parts.join(" — ");
  }
  async function loadDelegateAudit() {
    const sb = getClient();
    if (!sb) {
      clearDelegateAuditTable("الخدمة غير جاهزة حالياً.");
      return;
    }
    const token = getAdminToken();
    if (!token) {
      clearDelegateAuditTable("سجل الدخول للإدارة لعرض سجل التعديلات.");
      return;
    }
    clearDelegateAuditTable("جاري تحميل سجل التعديلات...");
    setDelegateAuditStatus("");
    if (delegatePermsStatus) delegatePermsStatus.textContent = "";
    const treeDelegatesRes = await sb.rpc("admin_list_requests", {
      p_token: token,
      p_status: null,
      p_kind: "tree_delegate",
      p_limit: 2000,
    });
    if (treeDelegatesRes.error) {
      clearDelegateAuditTable(
        "تعذر تحميل بيانات المناديب، حاول لاحقاً أو تواصل مع الإدارة.",
      );
      return;
    }
    const treeDelegates = Array.isArray(treeDelegatesRes.data)
      ? treeDelegatesRes.data
      : [];
    const eventsDelegatesRes = await sb.rpc("admin_list_requests", {
      p_token: token,
      p_status: null,
      p_kind: "events_delegate",
      p_limit: 2000,
    });
    if (eventsDelegatesRes.error) {
      clearDelegateAuditTable(
        "تعذر تحميل بيانات المناديب، حاول لاحقاً أو تواصل مع الإدارة.",
      );
      return;
    }
    const eventsDelegates = Array.isArray(eventsDelegatesRes.data)
      ? eventsDelegatesRes.data
      : [];
    const auditRes = await sb.rpc("admin_list_requests", {
      p_token: token,
      p_status: "approved",
      p_kind: "tree_audit",
      p_limit: 2000,
    });
    if (auditRes.error) {
      clearDelegateAuditTable(
        "تعذر تحميل سجل التعديلات، حاول لاحقاً أو تواصل مع الإدارة.",
      );
      return;
    }
    const treeAudits = Array.isArray(auditRes.data) ? auditRes.data : [];
    const eventsAuditRes = await sb.rpc("admin_list_requests", {
      p_token: token,
      p_status: "approved",
      p_kind: "events_audit",
      p_limit: 2000,
    });
    if (eventsAuditRes.error) {
      clearDelegateAuditTable(
        "تعذر تحميل سجل المناسبات، حاول لاحقاً أو تواصل مع الإدارة.",
      );
      return;
    }
    const eventsAudits = Array.isArray(eventsAuditRes.data)
      ? eventsAuditRes.data
      : [];
    const audits = treeAudits.concat(eventsAudits);
    const countsByKey = new Map();
    audits.forEach((r) => {
      const key = buildDelegateKey(r.branch_key, r.phone, r.email);
      countsByKey.set(key, (countsByKey.get(key) || 0) + 1);
    });
    const accessByKey = new Map();
    const pickLatest = (a, b) => {
      if (!a) return b || null;
      if (!b) return a || null;
      return String(b.created_at || "").localeCompare(
        String(a.created_at || ""),
      ) > 0
        ? b
        : a;
    };
    treeDelegates.forEach((r) => {
      const key = buildDelegateKey(r.branch_key, r.phone, r.email);
      if (!key || key === "||") return;
      const cur = accessByKey.get(key) || { tree: null, events: null };
      cur.tree = pickLatest(cur.tree, r);
      accessByKey.set(key, cur);
    });
    eventsDelegates.forEach((r) => {
      const key = buildDelegateKey(r.branch_key, r.phone, r.email);
      if (!key || key === "||") return;
      const cur = accessByKey.get(key) || { tree: null, events: null };
      cur.events = pickLatest(cur.events, r);
      accessByKey.set(key, cur);
    });
    const delegateRows = Array.from(accessByKey.entries())
      .map(([key, caps]) => {
        const row = caps.tree || caps.events;
        const count = countsByKey.get(key) || 0;
        const approvedCount =
          (caps.tree && caps.tree.status === "approved" ? 1 : 0) +
          (caps.events && caps.events.status === "approved" ? 1 : 0);
        return { key, row, count, approvedCount };
      })
      .sort(
        (a, b) =>
          (b.approvedCount || 0) - (a.approvedCount || 0) ||
          (b.count || 0) - (a.count || 0),
      );
    const listEntries = delegateRows.map((d) => ({
      key: d.key,
      label: labelForDelegate(d.row, countsByKey),
    }));
    delegateAuditState.delegates = listEntries;
    delegateAuditState.auditRows = audits;
    delegateAuditState.accessByKey = new Map(
      Array.from(accessByKey.entries())
        .map(([k, v]) => ({ key: k, tree: v.tree, events: v.events }))
        .map((x) => [x.key, { tree: x.tree, events: x.events }]),
    );
    const selected =
      delegateAuditState.selectedKey &&
      listEntries.some((e) => e.key === delegateAuditState.selectedKey)
        ? delegateAuditState.selectedKey
        : listEntries[0]
          ? listEntries[0].key
          : "";
    const pickDelegateAuditKey = (k) => {
      const next = String(k || "").trim();
      delegateAuditState.selectedKey = next;
      if (delegateAuditSelect) delegateAuditSelect.value = next;
      renderDelegatesList(listEntries, next, pickDelegateAuditKey);
      renderDelegateAuditSelect(listEntries, next, pickDelegateAuditKey);
      applyDelegateAuditSelection(next);
    };
    pickDelegateAuditKey(selected);
  }
  function setDelegatePermsUiBusy(busy) {
    const isBusy = !!busy;
    if (delegatePermsTreeBtn) delegatePermsTreeBtn.disabled = isBusy;
    if (delegatePermsEventsBtn) delegatePermsEventsBtn.disabled = isBusy;
    if (delegatePermsBothBtn) delegatePermsBothBtn.disabled = isBusy;
    if (delegatePermsDisableBtn) delegatePermsDisableBtn.disabled = isBusy;
  }
  function makeAdminDelegateRequestId(prefix) {
    const p =
      String(prefix || "ADM")
        .trim()
        .toUpperCase() || "ADM";
    const chunk = () =>
      Math.random()
        .toString(16)
        .slice(2, 6)
        .toUpperCase()
        .padEnd(4, "0")
        .slice(0, 4);
    return p + "-" + chunk() + "-" + chunk();
  }
  async function createDelegatePermissionRow(sb, kind, sourceRow) {
    const src = sourceRow || {};
    const token = getAdminToken();
    if (!token) return { ok: false, error: { message: "not_authed" } };
    const { data, error } = await sb.rpc("admin_create_delegate_request_v1", {
      p_token: token,
      p_kind: kind,
      p_branch_key: src.branch_key || null,
      p_name: src.name || null,
      p_phone: src.phone || null,
      p_email: src.email || null,
      p_secret_hash: src.secret_hash || null,
    });
    if (error) return { ok: false, error };
    const requestId =
      typeof data === "string"
        ? data
        : data && typeof data === "object"
          ? String(data.request_id || "")
          : "";
    return { ok: true, requestId };
  }
  async function applyDelegatePermissions(mode) {
    const sb = getClient();
    if (!sb) return;
    const token = getAdminToken();
    if (!token) return;
    const key = String(delegateAuditState.selectedKey || "").trim();
    if (!key) {
      showAlert("error", "اختر مندوباً أولاً.");
      return;
    }
    const caps = delegateAuditState.accessByKey.get(key) || {
      tree: null,
      events: null,
    };
    const sourceRow = caps.tree || caps.events;
    const treeWant = mode === "tree" || mode === "both";
    const eventsWant = mode === "events" || mode === "both";
    const treeStatus = treeWant ? "approved" : "rejected";
    const eventsStatus = eventsWant ? "approved" : "rejected";
    hideAlert();
    setDelegatePermsUiBusy(true);
    if (delegatePermsStatus)
      delegatePermsStatus.textContent = "جاري تطبيق الصلاحيات...";
    try {
      if (caps.tree && caps.tree.id != null) {
        const id = coerceRpcId(caps.tree.id);
        if (!id) {
          showAlert("error", "تعذر تحديث صلاحية الشجرة: بيانات غير مكتملة.");
          return;
        }
        const { error } = await sb.rpc("admin_set_request_status_v2", {
          p_token: token,
          p_id: id,
          p_status: treeStatus,
        });
        if (error) {
          showAlert(
            "error",
            "تعذر تحديث صلاحية الشجرة حالياً، حاول لاحقاً أو تواصل مع الإدارة.",
          );
          return;
        }
      } else if (treeWant) {
        if (!sourceRow) {
          showAlert(
            "error",
            "لا يمكن إنشاء صلاحية الشجرة لأن بيانات المندوب غير مكتملة.",
          );
          return;
        }
        const created = await createDelegatePermissionRow(
          sb,
          "tree_delegate",
          sourceRow,
        );
        if (!created.ok) {
          showAlert(
            "error",
            "تعذر إنشاء صلاحية الشجرة حالياً، حاول لاحقاً أو تواصل مع الإدارة.",
          );
          return;
        }
      }
      if (caps.events && caps.events.id != null) {
        const id = coerceRpcId(caps.events.id);
        if (!id) {
          showAlert("error", "تعذر تحديث صلاحية المناسبات: بيانات غير مكتملة.");
          return;
        }
        const { error } = await sb.rpc("admin_set_request_status_v2", {
          p_token: token,
          p_id: id,
          p_status: eventsStatus,
        });
        if (error) {
          showAlert(
            "error",
            "تعذر تحديث صلاحية المناسبات حالياً، حاول لاحقاً أو تواصل مع الإدارة.",
          );
          return;
        }
      } else if (eventsWant) {
        if (!sourceRow) {
          showAlert(
            "error",
            "لا يمكن إنشاء صلاحية المناسبات لأن بيانات المندوب غير مكتملة.",
          );
          return;
        }
        const created = await createDelegatePermissionRow(
          sb,
          "events_delegate",
          sourceRow,
        );
        if (!created.ok) {
          showAlert(
            "error",
            "تعذر إنشاء صلاحية المناسبات حالياً، حاول لاحقاً أو تواصل مع الإدارة.",
          );
          return;
        }
      }
      showAlert("success", "تم تحديث صلاحيات المندوب.");
      await loadDelegateAudit();
    } finally {
      setDelegatePermsUiBusy(false);
    }
  }
  async function deleteDelegatePermanently() {
    const sb = getClient();
    if (!sb) return;
    const token = getAdminToken();
    if (!token) return;
    const key = String(delegateAuditState.selectedKey || "").trim();
    if (!key) {
      showAlert("error", "اختر مندوباً أولاً.");
      return;
    }
    const parts = key.split("|");
    const branchKey = String(parts[0] || "").trim();
    const phone = String(parts[1] || "").trim();
    const email = String(parts[2] || "").trim();
    const confirmed = window.confirm(
      "تأكيد حذف المندوب نهائياً؟ سيتم حذف صلاحياته وسجل التعديلات.",
    );
    if (!confirmed) return;
    hideAlert();
    setDelegatePermsUiBusy(true);
    if (delegatePermsStatus)
      delegatePermsStatus.textContent = "جاري حذف المندوب...";
    try {
      const { data, error } = await sb.rpc("admin_delete_delegate_v1", {
        p_token: token,
        p_branch_key: branchKey || null,
        p_phone: phone || null,
        p_email: email || null,
      });
      if (error) {
        showAlert(
          "error",
          "تعذر حذف المندوب حالياً، حاول لاحقاً أو تواصل مع الإدارة.",
        );
        return;
      }
      showAlert(
        "success",
        "تم حذف المندوب. عدد السجلات: " + String(Number(data || 0)),
      );
      await loadDelegateAudit();
    } finally {
      setDelegatePermsUiBusy(false);
    }
  }


  window.AlzidanDelegateAudit = {
    loadDelegateAudit,
    applyDelegatePermissions,
    deleteDelegatePermanently,
  };
})();
