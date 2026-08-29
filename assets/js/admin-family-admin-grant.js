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
    const node = el("admin-family-admin-grant-status");
    if (!node) return;
    node.textContent = text || "";
    node.style.color = isError ? "#991b1b" : "";
  }

  function rpcMissingMessage() {
    return "شغّل بطاقة «إدارة العائلة في التطبيق» من أدوات الصيانة → مساحة عمل SQL، ثم حدّث هذه الصفحة.";
  }

  function isRpcMissing(err) {
    const msg = String((err && err.message) || err || "").toLowerCase();
    const code = String((err && err.code) || "").toLowerCase();
    if (code === "pgrst202") return true;
    if (msg.includes("could not find the function")) return true;
    if (msg.includes("function") && msg.includes("does not exist")) return true;
    return false;
  }

  async function rpc(name, params) {
    const c = core();
    if (typeof c.invokeAdminRpc !== "function") throw new Error("لوحة الإدارة غير جاهزة.");
    const args = Object.assign({ p_token: token() }, params || {});
    const result = await c.invokeAdminRpc(name, args);
    if (result && result.error) {
      const err = result.error;
      if (isRpcMissing(err)) throw new Error(rpcMissingMessage());
      throw new Error(err.message || name);
    }
    return result && result.data != null ? result.data : result;
  }

  async function runAction(action) {
    const input = el("admin-family-admin-grant-phone");
    const phone = String((input && input.value) || "").trim();
    if (!token()) {
      setStatus("سجّل دخول الإدارة أولاً.", true);
      return;
    }
    if (!phone) {
      setStatus("اكتب رقم الجوال المرتبط بشخصك في العضوية.", true);
      return;
    }
    setStatus(action === "assign" ? "جاري المنح..." : "جاري الإيقاف...");
    try {
      const data = await rpc("admin_family_admin_set_by_phone_v1", {
        p_phone: phone,
        p_action: action,
      });
      if (!data || data.ok === false) {
        const code = String((data && data.error) || "");
        if (code === "no_tree_person") {
          throw new Error("لا يوجد شخص في الشجرة مربوط بهذا الرقم. اربطه في العضوية أولًا.");
        }
        if (code === "bad_phone") throw new Error("رقم الجوال غير مكتمل.");
        if (code === "person_not_found") throw new Error("الشخص غير موجود في الشجرة.");
        throw new Error((data && data.error) || "تعذر حفظ الصلاحية.");
      }
      const status = String(data.status || "");
      if (action === "assign") {
        setStatus(
          status === "active"
            ? "تم المنح. ادخل التطبيق برقمك من الجهاز الموثوق: ملفي → إدارة العائلة."
            : "تم الحفظ.",
          false
        );
      } else {
        setStatus(status === "active" ? "ما زالت مفعّلة." : "تم إيقاف إدارة العائلة لهذا الرقم.", false);
      }
    } catch (err) {
      setStatus(err && err.message ? err.message : "تعذر التنفيذ.", true);
    }
  }

  function bind() {
    const assignBtn = el("admin-family-admin-grant-assign");
    const suspendBtn = el("admin-family-admin-grant-suspend");
    if (!assignBtn && !suspendBtn) return;
    if (assignBtn) {
      assignBtn.addEventListener("click", function () {
        runAction("assign").catch(function () {});
      });
    }
    if (suspendBtn) {
      suspendBtn.addEventListener("click", function () {
        if (!window.confirm("إيقاف إدارة العائلة لهذا الرقم؟ سيختفي المدخل من تطبيقه.")) return;
        runAction("suspend").catch(function () {});
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
