(function () {
  "use strict";

  function core() {
    return window.AlzidanAdminCore || {};
  }

  function el(id) {
    return document.getElementById(id);
  }

  function token() {
    const c = core();
    if (typeof c.getAdminToken === "function") return String(c.getAdminToken() || "").trim();
    return "";
  }

  function setStatus(text, isError) {
    const node = el("admin-device-trust-status");
    if (!node) return;
    node.textContent = text || "";
    node.style.color = isError ? "#991b1b" : "";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatWhen(value) {
    if (!value) return "";
    try {
      return new Date(value).toLocaleString("ar-SA");
    } catch {
      return String(value);
    }
  }

  async function rpc(name, params) {
    const c = core();
    if (typeof c.invokeAdminRpc !== "function") throw new Error("لوحة الإدارة غير جاهزة.");
    const args = Object.assign({ p_token: token() }, params || {});
    const result = await c.invokeAdminRpc(name, args);
    if (result && result.error) throw new Error(result.error.message || name);
    return result && result.data != null ? result.data : result;
  }

  async function loadLists() {
    const bindingsRoot = el("admin-device-bindings");
    const transfersRoot = el("admin-device-transfers");
    if (!bindingsRoot && !transfersRoot) return;
    if (!token()) {
      setStatus("سجّل دخول الإدارة أولاً.", true);
      return;
    }
    setStatus("جاري التحميل...");
    try {
      const devices = await rpc("admin_device_list_v1");
      const deviceItems = (devices && devices.items) || [];
      if (bindingsRoot) {
        bindingsRoot.innerHTML = deviceItems.length
          ? deviceItems
              .map(function (row) {
                return (
                  '<div class="card" style="box-shadow:none;border:1px solid #e5e7eb;margin-bottom:8px;">' +
                  "<div><strong>" +
                  escapeHtml(row.phone_key || "") +
                  "</strong>" +
                  (row.label ? " · " + escapeHtml(row.label) : "") +
                  "</div>" +
                  (row.last_seen_at || row.bound_at
                    ? '<div class="hint">' +
                      escapeHtml(formatWhen(row.last_seen_at || row.bound_at)) +
                      "</div>"
                    : "") +
                  '<div style="margin-top:8px;">' +
                  '<button type="button" class="btn btn-outline btn-sm" data-device-unbind="' +
                  escapeHtml(row.phone_key || "") +
                  '">حذف الربط</button></div></div>'
                );
              })
              .join("")
          : '<div class="hint">لا أجهزة مربوطة حالياً.</div>';
      }

      const transfers = await rpc("admin_device_transfers_list_v1");
      const transferItems = (transfers && transfers.items) || [];
      if (transfersRoot) {
        transfersRoot.innerHTML = transferItems.length
          ? transferItems
              .map(function (row) {
                const ready = row.status === "pending_admin";
                return (
                  '<div class="card" style="box-shadow:none;border:1px solid #e5e7eb;margin-bottom:8px;">' +
                  "<div><strong>" +
                  escapeHtml(row.phone_key || "") +
                  "</strong> · " +
                  escapeHtml(ready ? "طلب جهاز جديد" : String(row.status || "")) +
                  "</div>" +
                  (row.to_label ? '<div class="hint">الجهاز الجديد: ' + escapeHtml(row.to_label) + "</div>" : "") +
                  (ready
                    ? '<div style="display:flex;gap:8px;margin-top:8px;">' +
                      '<button type="button" class="btn btn-primary btn-sm" data-device-approve="' +
                      escapeHtml(row.id) +
                      '">موافقة</button>' +
                      '<button type="button" class="btn btn-outline btn-sm" data-device-reject="' +
                      escapeHtml(row.id) +
                      '">رفض</button></div>'
                    : "") +
                  "</div>"
                );
              })
              .join("")
          : '<div class="hint">لا طلبات جهاز جديد. لتغيير الجهاز احذف الربط بالرقم ثم يدخل من الجهاز الجديد.</div>';
      }

      setStatus("آخر تحديث: " + new Date().toLocaleString("ar-SA"));
    } catch (err) {
      setStatus(
        err && err.message
          ? String(err.message).indexOf("admin_device_list") >= 0 ||
            String(err.message).toLowerCase().indexOf("could not find") >= 0
            ? "شغّل بطاقة «حذف ربط الجهاز من الإدارة» من مساحة SQL ثم أعد التحميل."
            : err.message
          : "تعذر التحميل.",
        true
      );
    }
  }

  async function unbindPhone(phone) {
    const cleaned = String(phone || "").trim();
    if (!cleaned) {
      setStatus("اكتب رقم الجوال لحذف الربط.", true);
      return;
    }
    if (!window.confirm("حذف ربط هذا الرقم بالجهاز؟ بعدها يمكن الدخول بالرقم الصحيح أو من جهاز جديد.")) {
      return;
    }
    try {
      const data = await rpc("admin_device_revoke_phone_v1", { p_phone: cleaned });
      if (data && data.ok === false) throw new Error(data.error || "تعذر الحذف.");
      setStatus("تم حذف الربط. يدخل العضو الآن بالرقم الصحيح من جهازه.");
      const input = el("admin-device-revoke-phone");
      if (input) input.value = "";
      await loadLists();
    } catch (err) {
      setStatus(err && err.message ? err.message : "تعذر الحذف.", true);
    }
  }

  function bind() {
    const loadBtn = el("admin-device-trust-load");
    const revokeBtn = el("admin-device-revoke-btn");
    const bindingsRoot = el("admin-device-bindings");
    const transfersRoot = el("admin-device-transfers");
    if (loadBtn) loadBtn.addEventListener("click", function () { loadLists().catch(function () {}); });
    if (revokeBtn) {
      revokeBtn.addEventListener("click", function () {
        const input = el("admin-device-revoke-phone");
        unbindPhone(input && input.value).catch(function () {});
      });
    }
    if (bindingsRoot) {
      bindingsRoot.addEventListener("click", function (event) {
        const btn = event.target && event.target.closest ? event.target.closest("[data-device-unbind]") : null;
        if (!btn) return;
        unbindPhone(btn.getAttribute("data-device-unbind")).catch(function () {});
      });
    }
    if (transfersRoot) {
      transfersRoot.addEventListener("click", function (event) {
        const approve = event.target && event.target.closest ? event.target.closest("[data-device-approve]") : null;
        const reject = event.target && event.target.closest ? event.target.closest("[data-device-reject]") : null;
        const id = approve ? approve.getAttribute("data-device-approve") : reject ? reject.getAttribute("data-device-reject") : "";
        if (!id) return;
        const fn = approve ? "admin_device_transfer_approve_v1" : "admin_device_transfer_reject_v1";
        rpc(fn, { p_id: Number(id) })
          .then(function (data) {
            if (data && data.ok === false) throw new Error(data.error || "تعذر التنفيذ.");
            return loadLists();
          })
          .catch(function (err) {
            setStatus(err && err.message ? err.message : "تعذر التنفيذ.", true);
          });
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }

  window.AlzidanDeviceTrust = { load: loadLists };
})();
