(() => {
  const Core = window.AlzidanAdminCore || {};
  const kindLabel = Core.kindLabel || ((kind) => String(kind || ""));
  const formatDateTimeArSaVerbose = Core.formatDateTimeArSaVerbose || ((value) => String(value || ""));
  const tokenFromRpcResult = Core.tokenFromRpcResult || ((data) => {
    if (!data) return "";
    if (typeof data === "string") return data.trim();
    if (typeof data === "object" && data !== null) {
      return String(data.token || data.access_token || "").trim();
    }
    return String(data).trim();
  });
  const getClient = Core.getClient || (() => null);

  const sbStatus = document.getElementById("sb-status");
  const adminLockedHint = document.getElementById("admin-locked-hint");
  const adminProtectedInline = null;
  const adminProtectedSections = document.getElementById(
    "admin-protected-sections",
  );
  const alertEl = document.getElementById("alert");
  const adminUsername = document.getElementById("admin-username");
  const adminPassword = document.getElementById("admin-password");
  const adminLoginControls = document.getElementById("admin-login-controls");
  const adminLoginFields = document.getElementById("admin-login-fields");
  const adminCurrentUser = document.getElementById("admin-current-user");
  const adminLoginBtn = document.getElementById("admin-login");
  const adminLogoutBtn = document.getElementById("admin-logout");
  const adminRefreshBtn = document.getElementById("admin-refresh");
  const adminEnableNotifsBtn = document.getElementById("admin-enable-notifs");
  const adminForgotBtn = document.getElementById("admin-forgot");
  const delegateAuditDetails = document.getElementById("delegate-audit-details");

  const ADMIN_TOKEN_KEY = "alzidan_admin_token_v1";
  const ADMIN_TOKEN_SESSION_KEY = "alzidan_admin_token_session_v1";
  const ADMIN_NOTIF_LAST_KEY = "alzidan_admin_notif_last_pending_v1";
  const ADMIN_EMAIL_LAST_AUDIT_KEY = "alzidan_admin_email_last_audit_v1";

  let adminToken = "";
  let lastNotifiedPendingKey = "";
  let lastEmailedAuditKey = "";
  let didInitialPendingSync = false;
  let didInitialAuditSync = false;
  let pendingPollTimer = null;

  function showAlert(type, text) {
    if (!alertEl) return;
    alertEl.className =
      "alert " + (type === "success" ? "alert-success" : "alert-error");
    alertEl.textContent = text || "";
    alertEl.style.display = "block";
  }

  function hideAlert() {
    if (!alertEl) return;
    alertEl.className = "alert";
    alertEl.textContent = "";
    alertEl.style.display = "none";
  }

  function setStatus(text) {
    if (!sbStatus) return;
    sbStatus.textContent = text || "";
  }

  function setAdminOnlySectionsVisibility(isAuthed) {
    const ok = !!isAuthed;
    document.querySelectorAll("section.admin-only-section").forEach((section) => {
      section.style.display = ok ? "" : "none";
    });
  }

  function resetProtectedUiState() {
    if (!adminProtectedSections) return;

    adminProtectedSections.querySelectorAll("details[open]").forEach((detailsEl) => {
      detailsEl.open = false;
    });

    adminProtectedSections
      .querySelectorAll(".maintenance-section, .extra-tools-section[data-maintenance='1']")
      .forEach((section) => {
        if (section.id === "bulk-name-audit-section") {
          section.classList.remove("is-collapsed");
        } else {
          section.classList.add("is-collapsed");
        }
      });
  }

  function setProtectedVisibility(isAuthed) {
    const ok = !!isAuthed;
    document.body.classList.toggle("admin-authenticated", ok);
    if (adminCurrentUser) {
      const currentName = String(
        adminUsername && adminUsername.value ? adminUsername.value : "",
      ).trim();
      adminCurrentUser.textContent = ok
        ? "مسجل الدخول: " + (currentName || "الإدارة")
        : "";
    }
    if (adminProtectedInline)
      adminProtectedInline.style.display = ok ? "block" : "none";
    if (adminProtectedSections)
      adminProtectedSections.style.display = ok ? "block" : "none";
    if (adminLockedHint) adminLockedHint.style.display = ok ? "none" : "block";
    if (adminLogoutBtn) adminLogoutBtn.disabled = !ok;
    if (adminRefreshBtn) adminRefreshBtn.disabled = !ok;
    if (adminEnableNotifsBtn) adminEnableNotifsBtn.disabled = !ok;
    setAdminOnlySectionsVisibility(ok);

    if (!ok) {
      resetProtectedUiState();
    }
  }

  function getAdminToken() {
    return String(adminToken || "").trim();
  }

  function canShowBrowserNotifications() {
    if (!adminEnableNotifsBtn) return false;
    if (!("Notification" in window)) return false;
    return true;
  }

  async function ensureBrowserNotificationsEnabled() {
    if (!canShowBrowserNotifications()) return false;
    if (Notification.permission === "granted") return true;
    try {
      const permission = await Notification.requestPermission();
      return permission === "granted";
    } catch (e) {
      return false;
    }
  }

  function updateNotifsButtonText() {
    if (!adminEnableNotifsBtn) return;
    if (!canShowBrowserNotifications()) {
      adminEnableNotifsBtn.textContent = "الإشعارات غير مدعومة";
      adminEnableNotifsBtn.disabled = true;
      return;
    }
    if (Notification.permission === "granted") {
      adminEnableNotifsBtn.textContent = "الإشعارات مفعلة";
      adminEnableNotifsBtn.disabled = true;
      return;
    }
    if (Notification.permission === "denied") {
      adminEnableNotifsBtn.textContent = "الإشعارات مرفوضة";
      adminEnableNotifsBtn.disabled = true;
      return;
    }
    adminEnableNotifsBtn.textContent = "تفعيل إشعارات الطلبات";
    adminEnableNotifsBtn.disabled = false;
  }

  function saveLastNotifiedPendingKey(key) {
    const k = String(key || "").trim();
    if (!k) return;
    lastNotifiedPendingKey = k;
    try {
      localStorage.setItem(ADMIN_NOTIF_LAST_KEY, k);
    } catch (e) {}
  }

  function showPendingRequestNotification(row) {
    if (!canShowBrowserNotifications()) return;
    if (Notification.permission !== "granted") return;
    if (!row) return;
    const title = "طلب جديد: " + kindLabel(row.kind);
    const parts = [];
    if (row.branch_key) parts.push("الفرع: " + row.branch_key);
    if (row.name) parts.push("الاسم: " + row.name);
    if (row.phone) parts.push("الجوال: " + row.phone);
    if (row.email) parts.push("البريد: " + row.email);
    const body = parts.join("\n");
    try {
      const n = new Notification(title, {
        body,
        tag: "alzidan-admin-req",
        renotify: true,
      });
      n.onclick = () => {
        try {
          window.focus();
        } catch (e) {}
      };
    } catch (e) {}
  }

  const loadTickerSpeedSetting = async () => {
    const fn = window.loadTickerSpeedSetting;
    return typeof fn === "function" ? fn() : Promise.resolve();
  };

  const loadSourceTreeRows = async () => {
    const fn = window.loadSourceTreeRows;
    return typeof fn === "function" ? fn() : Promise.resolve();
  };

  const hasDelegateAuditToLoad = () =>
    delegateAuditDetails &&
    delegateAuditDetails.open &&
    window.AlzidanDelegateAudit &&
    typeof window.AlzidanDelegateAudit.loadDelegateAudit === "function";

  async function refreshAuthStatus() {
    const sb = getClient();
    if (!sb) {
      setStatus("الخدمة غير جاهزة حالياً.");
      setProtectedVisibility(false);
      return null;
    }
    const token = getAdminToken();
    setStatus(token ? "" : "غير مسجل الدخول.");
    setProtectedVisibility(!!token);
    return token ? { token } : null;
  }

  async function pollPendingRequestsForNotifications() {
    const sb = getClient();
    if (!sb) return;
    const token = getAdminToken();
    if (!token) return;
    const { data, error } = await sb.rpc("admin_list_requests", {
      p_token: token,
      p_status: "pending",
      p_kind: null,
      p_limit: 20,
    });
    if (error) return;
    const list = Array.isArray(data) ? data : [];
    const newest = list && list[0] ? list[0] : null;
    if (!newest) {
      if (!didInitialPendingSync) didInitialPendingSync = true;
      return;
    }
    const key = String(
      newest.request_id || newest.id || newest.created_at || "",
    ).trim();
    if (!key) return;
    if (!didInitialPendingSync) {
      didInitialPendingSync = true;
      saveLastNotifiedPendingKey(key);
      return;
    }
    if (key === lastNotifiedPendingKey) return;
    saveLastNotifiedPendingKey(key);
    showPendingRequestNotification(newest);
  }

  async function pollAuditForEmailNotifications() {
    const sb = getClient();
    if (!sb) return;
    const token = getAdminToken();
    if (!token) return;
    const fetchOne = async (kind) => {
      const { data, error } = await sb.rpc("admin_list_requests", {
        p_token: token,
        p_status: "approved",
        p_kind: kind,
        p_limit: 1,
      });
      if (error) return null;
      const list = Array.isArray(data) ? data : [];
      return list && list[0] ? list[0] : null;
    };
    const a = await fetchOne("tree_audit");
    const b = await fetchOne("events_audit");
    const pickLatest = (x, y) => {
      if (!x) return y || null;
      if (!y) return x || null;
      const ax = String(x.created_at || "");
      const ay = String(y.created_at || "");
      if (ay > ax) return y;
      if (ay < ax) return x;
      const ix = Number(x.id || 0);
      const iy = Number(y.id || 0);
      return iy > ix ? y : x;
    };
    const latest = pickLatest(a, b);
    if (!latest) return;
    const key =
      String(latest.kind || "") +
      "|" +
      String(latest.request_id || latest.id || latest.created_at || "");
    if (!key) return;
    if (!didInitialAuditSync) {
      didInitialAuditSync = true;
      if (!lastEmailedAuditKey) {
        lastEmailedAuditKey = key;
        try {
          localStorage.setItem(ADMIN_EMAIL_LAST_AUDIT_KEY, key);
        } catch (e) {}
        return;
      }
    }
    if (key === lastEmailedAuditKey) return;
    lastEmailedAuditKey = key;
    try {
      localStorage.setItem(ADMIN_EMAIL_LAST_AUDIT_KEY, key);
    } catch (e) {}
  }

  function startPendingPolling() {
    if (pendingPollTimer) return;
    pendingPollTimer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      pollPendingRequestsForNotifications().catch(() => {});
      pollAuditForEmailNotifications().catch(() => {});
    }, 20000);
  }

  function stopPendingPolling() {
    if (!pendingPollTimer) return;
    clearInterval(pendingPollTimer);
    pendingPollTimer = null;
  }

  function attachAuthEventHandlers() {
    if (adminLoginBtn) {
      adminLoginBtn.addEventListener("click", async () => {
        hideAlert();
        const sb = getClient();
        if (!sb) {
          showAlert("error", "تعذر الاتصال.");
          return;
        }
        const username = String(adminUsername?.value || "").trim();
        const password = String(adminPassword?.value || "").trim();
        if (!username || !password) {
          showAlert("error", "يرجى إدخال اسم المستخدم وكلمة المرور.");
          return;
        }
        const { data, error } = await sb.rpc("admin_login", {
          p_username: username,
          p_password: password,
        });
        if (error) {
          showAlert(
            "error",
            "تعذر تسجيل الدخول حالياً، حاول لاحقاً أو تواصل مع الإدارة.",
          );
          return;
        }
        const token = tokenFromRpcResult(data);
        if (!token) {
          showAlert("error", "اسم المستخدم أو كلمة المرور غير صحيحة.");
          return;
        }
        adminToken = token;
        try {
          sessionStorage.setItem(ADMIN_TOKEN_SESSION_KEY, token);
        } catch (e) {}
        try {
          localStorage.setItem(ADMIN_TOKEN_KEY, token);
        } catch (e) {}
        showAlert("success", "");
        await refreshAuthStatus();
        if (
          window.AlzidanAdminRequests &&
          typeof window.AlzidanAdminRequests.loadRequests === "function"
        ) {
          await window.AlzidanAdminRequests.loadRequests();
        }
        loadTickerSpeedSetting().catch(() => {});
        loadSourceTreeRows().catch(() => {});
        if (
          window.AlzidanRequestsStats &&
          typeof window.AlzidanRequestsStats.loadRequestsStats === "function"
        ) {
          window.AlzidanRequestsStats.loadRequestsStats().catch(() => {});
        }
        if (
          window.AlzidanAdminViews &&
          typeof window.AlzidanAdminViews.loadViewsStats === "function"
        ) {
          window.AlzidanAdminViews.loadViewsStats().catch(() => {});
        }
        pollPendingRequestsForNotifications().catch(() => {});
        startPendingPolling();
      });
    }

    if (adminLogoutBtn) {
      adminLogoutBtn.addEventListener("click", async () => {
        hideAlert();
        adminToken = "";
        try {
          sessionStorage.removeItem(ADMIN_TOKEN_SESSION_KEY);
        } catch (e) {}
        try {
          localStorage.removeItem(ADMIN_TOKEN_KEY);
        } catch (e) {}
        await refreshAuthStatus();
        if (
          window.AlzidanAdminRequests &&
          typeof window.AlzidanAdminRequests.loadRequests === "function"
        ) {
          await window.AlzidanAdminRequests.loadRequests();
        }
        stopPendingPolling();
      });
    }

    if (adminRefreshBtn) {
      adminRefreshBtn.addEventListener("click", async () => {
        hideAlert();
        await refreshAuthStatus();
        if (
          window.AlzidanAdminRequests &&
          typeof window.AlzidanAdminRequests.loadRequests === "function"
        ) {
          await window.AlzidanAdminRequests.loadRequests();
        }
        loadSourceTreeRows().catch(() => {});
        pollPendingRequestsForNotifications().catch(() => {});
      });
    }

    if (adminEnableNotifsBtn) {
      updateNotifsButtonText();
      adminEnableNotifsBtn.addEventListener("click", async () => {
        const ok = await ensureBrowserNotificationsEnabled();
        updateNotifsButtonText();
        if (!ok) return;
        pollPendingRequestsForNotifications().catch(() => {});
      });
    }

    if (adminForgotBtn) {
      adminForgotBtn.addEventListener("click", () => {
        showAlert(
          "error",
          "إذا نسيت كلمة المرور: تواصل مع مدير النظام لإعادة تعيينها.",
        );
      });
    }

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        if (getAdminToken()) {
          pollPendingRequestsForNotifications().catch(() => {});
          startPendingPolling();
        }
      } else {
        stopPendingPolling();
      }
    });
  }

  async function init() {
    try {
      adminToken = String(
        sessionStorage.getItem(ADMIN_TOKEN_SESSION_KEY) ||
          localStorage.getItem(ADMIN_TOKEN_KEY) ||
          "",
      ).trim();
    } catch (e) {
      adminToken = "";
    }
    try {
      localStorage.removeItem(ADMIN_TOKEN_KEY);
    } catch (e) {}
    if (adminUsername && !String(adminUsername.value || "").trim()) {
      adminUsername.value = "alshryhy";
    }

    attachAuthEventHandlers();
    await refreshAuthStatus();

    if (
      window.AlzidanAdminRequests &&
      typeof window.AlzidanAdminRequests.loadRequests === "function"
    ) {
      await window.AlzidanAdminRequests.loadRequests();
    }
    updateNotifsButtonText();
    if (getAdminToken()) {
      if (
        window.AlzidanRequestsStats &&
        typeof window.AlzidanRequestsStats.loadRequestsStats === "function"
      ) {
        window.AlzidanRequestsStats.loadRequestsStats().catch(() => {});
      }
      if (
        window.AlzidanAdminViews &&
        typeof window.AlzidanAdminViews.loadViewsStats === "function"
      ) {
        window.AlzidanAdminViews.loadViewsStats().catch(() => {});
      }
      loadSourceTreeRows().catch(() => {});
      if (hasDelegateAuditToLoad()) {
        window.AlzidanDelegateAudit.loadDelegateAudit().catch(() => {});
      }
      pollPendingRequestsForNotifications().catch(() => {});
      startPendingPolling();
    }
  }

  window.AlzidanAdminCore = Object.assign(window.AlzidanAdminCore || {}, {
    showAlert,
    hideAlert,
    getClient,
    getAdminToken,
    refreshAuthStatus,
  });

  window.AlzidanAuth = {
    init,
    getAdminToken,
    refreshAuthStatus,
  };

  function autoInitAuth() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init, { once: true });
      return;
    }
    init();
  }

  autoInitAuth();
})();
