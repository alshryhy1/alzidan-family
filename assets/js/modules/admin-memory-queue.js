(function (global) {
  "use strict";

  var KIND_LABELS = {
    general: "عام",
    photo_album: "ألبوم",
    video: "فيديو",
    audio: "صوت",
    story: "قصة",
    place: "مكان",
    document: "وثيقة",
    legacy: "تراث"
  };

  var STATUS_LABELS = {
    pending: "انتظار",
    approved: "معتمد",
    rejected: "مرفوض",
    archived: "مؤرشف"
  };

  var initialized = false;

  function getClient() {
    if (global.AlzidanAdminCore && typeof global.AlzidanAdminCore.getClient === "function") {
      return global.AlzidanAdminCore.getClient();
    }
    if (global.__alzidanConfig && typeof global.__alzidanConfig.getClient === "function") {
      return global.__alzidanConfig.getClient();
    }
    return global.__alzidanSupabaseClient || null;
  }

  function getAdminToken() {
    if (global.AlzidanAuth && typeof global.AlzidanAuth.getAdminToken === "function") {
      return String(global.AlzidanAuth.getAdminToken() || "").trim();
    }
    if (global.AlzidanAdminCore && typeof global.AlzidanAdminCore.getAdminToken === "function") {
      return String(global.AlzidanAdminCore.getAdminToken() || "").trim();
    }
    try {
      return String(localStorage.getItem("alzidan_admin_token_v1") || "").trim();
    } catch (e) {
      return "";
    }
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function text(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function formatDate(value) {
    if (!value) return "—";
    try {
      return new Date(value).toLocaleString("ar-SA", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch (e) {
      return String(value);
    }
  }

  function formatSource(row) {
    if (global.AlzidanMemorySource && typeof global.AlzidanMemorySource.format === "function") {
      return global.AlzidanMemorySource.format(row);
    }
    var relation = text(row.submitted_by_relation).toLowerCase();
    if (relation === "admin" || (!row.submitted_by_name && !row.submitted_by_phone)) {
      return "تم الإرسال من الإدارة";
    }
    if (relation === "delegate") {
      return "تم الإرسال من المندوب: " + [text(row.submitted_by_name), text(row.submitted_by_phone)].filter(Boolean).join(" — ");
    }
    return [text(row.submitted_by_name), text(row.submitted_by_phone)].filter(Boolean).join(" — ") || "—";
  }

  function kindLabel(kind) {
    return KIND_LABELS[kind] || kind || "—";
  }

  function statusLabel(status) {
    return STATUS_LABELS[status] || status || "—";
  }

  function setStatus(message) {
    var box = document.getElementById("admin-memory-status");
    if (box) box.textContent = message || "";
  }

  function setSummary(counts) {
    var box = document.getElementById("admin-memory-summary");
    if (!box) return;
    if (!counts || typeof counts !== "object") {
      box.textContent = "";
      return;
    }
    box.textContent =
      "المعلّقة: " +
      (counts.pending || 0) +
      " — المعتمدة: " +
      (counts.approved || 0) +
      " — المرفوضة: " +
      (counts.rejected || 0) +
      " — الإجمالي: " +
      (counts.total || 0);
  }

  function renderMediaLinks(media) {
    var list = Array.isArray(media) ? media : [];
    if (!list.length) {
      return '<span class="hint">—</span>';
    }
    return list
      .map(function (m, idx) {
        var url = text(m.media_url);
        if (!url) return "";
        var label = m.media_type === "image" ? "صورة" : m.media_type === "video" ? "فيديو" : m.media_type === "audio" ? "صوت" : "ملف";
        return (
          '<a href="' +
          esc(url) +
          '" target="_blank" rel="noopener noreferrer">' +
          esc(label + " " + (idx + 1)) +
          "</a>"
        );
      })
      .filter(Boolean)
      .join("<br>");
  }

  function renderRows(rows) {
    var body = document.getElementById("admin-memory-body");
    if (!body) return;

    var list = Array.isArray(rows) ? rows : [];
    if (!list.length) {
      body.innerHTML =
        '<tr><td colspan="11" class="hint">لا توجد ذكريات في هذا التصفية.</td></tr>';
      return;
    }

    body.innerHTML = list
      .map(function (row) {
        var id = Number(row.id) || 0;
        var status = text(row.status) || "pending";
        var actions = "";
        if (status === "pending") {
          actions =
            '<button class="btn btn-primary btn-sm" type="button" data-memory-action="approve" data-memory-id="' +
            id +
            '">اعتماد</button> ' +
            '<button class="btn btn-outline btn-sm" type="button" data-memory-action="reject" data-memory-id="' +
            id +
            '">رفض</button>';
        } else if (status === "approved") {
          actions =
            '<button class="btn btn-outline btn-sm" type="button" data-memory-action="archive" data-memory-id="' +
            id +
            '">أرشفة</button>';
        } else {
          actions = '<span class="hint">—</span>';
        }

        var title = text(row.title) || "—";
        var person = text(row.person_name) || "—";
        var storyHint = text(row.story_text) ? ' title="' + esc(text(row.story_text).slice(0, 240)) + '"' : "";

        return (
          "<tr>" +
          "<td>" +
          esc(id) +
          "</td>" +
          "<td>" +
          esc(text(row.branch_key) || "—") +
          "</td>" +
          "<td>" +
          esc(person) +
          "</td>" +
          '<td><span' +
          storyHint +
          ">" +
          esc(title) +
          "</span></td>" +
          "<td>" +
          esc(kindLabel(row.memory_kind)) +
          "</td>" +
          "<td colspan=\"2\">" +
          esc(formatSource(row)) +
          "</td>" +
          "<td>" +
          esc(formatDate(row.created_at)) +
          "</td>" +
          "<td>" +
          renderMediaLinks(row.media) +
          "</td>" +
          "<td>" +
          esc(statusLabel(status)) +
          "</td>" +
          "<td>" +
          actions +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function filterStatus() {
    var sel = document.getElementById("admin-memory-filter-status");
    return sel && sel.value ? String(sel.value) : "pending";
  }

  async function loadMemoryQueue() {
    var sb = getClient();
    var token = getAdminToken();
    if (!sb || !token) {
      setSummary(null);
      renderRows([]);
      setStatus("سجّل الدخول لعرض طلبات الذكريات.");
      return;
    }

    setStatus("جاري تحميل الذكريات...");
    var status = filterStatus();

    var countsRes = await sb.rpc("memory_admin_counts_v1", { p_token: token });
    if (!countsRes.error && countsRes.data) {
      setSummary(countsRes.data);
    }

    var listRes = await sb.rpc("memory_admin_list_v1", {
      p_token: token,
      p_status: status,
      p_limit: 100
    });

    if (listRes.error) {
      var msg = listRes.error.message || "";
      if (/memory_admin_list_v1|function.*does not exist/i.test(msg)) {
        setStatus(
          "دوال إدارة الذاكرة غير منشورة. نفّذ supabase/sql/family_memory_DEPLOY_ALL.sql على Supabase."
        );
      } else {
        setStatus("تعذر تحميل الذكريات: " + msg);
      }
      renderRows([]);
      return;
    }

    var rows = Array.isArray(listRes.data) ? listRes.data : [];
    renderRows(rows);
    setStatus("تم التحديث — " + rows.length + " ذكرى.");
  }

  async function setMemoryStatus(id, nextStatus) {
    var sb = getClient();
    var token = getAdminToken();
    if (!sb || !token) {
      setStatus("سجّل الدخول أولاً.");
      return;
    }

    var notes = "";
    if (nextStatus === "rejected") {
      notes = window.prompt("سبب الرفض (اختياري):", "") || "";
    }

    setStatus("جاري تحديث الذكرى #" + id + "...");
    var res = await sb.rpc("memory_admin_set_status_v1", {
      p_token: token,
      p_id: id,
      p_status: nextStatus,
      p_review_notes: notes || null
    });

    if (res.error) {
      setStatus("تعذر تحديث الحالة: " + (res.error.message || ""));
      return;
    }

    await loadMemoryQueue();
  }

  function memoryAlreadyBridged(existingRows, memoryId) {
    var idText = String(memoryId);
    var needleA = '"memory_id":' + idText;
    var needleB = '"memory_id": ' + idText;
    var requestId = "MEM-ITEM-" + idText;
    for (var i = 0; i < existingRows.length; i++) {
      var row = existingRows[i] || {};
      if (String(row.request_id || "") === requestId) return true;
      var msg = String(row.message || "");
      if (msg.indexOf(needleA) >= 0 || msg.indexOf(needleB) >= 0) return true;
    }
    return false;
  }

  async function bridgePendingMemoriesToDelegates() {
    var sb = getClient();
    var token = getAdminToken();
    if (!sb || !token) {
      setStatus("سجّل الدخول أولاً.");
      return;
    }

    setStatus("جاري إرسال الذكريات المعلّقة لطلبات المناديب...");
    var listRes = await sb.rpc("memory_admin_list_v1", {
      p_token: token,
      p_status: "pending",
      p_limit: 100
    });
    if (listRes.error) {
      setStatus("تعذر تحميل الذكريات المعلّقة: " + (listRes.error.message || ""));
      return;
    }

    var pending = Array.isArray(listRes.data) ? listRes.data : [];
    if (!pending.length) {
      setStatus("لا توجد ذكريات معلّقة لإرسالها للمناديب.");
      return;
    }

    var existingRes = await sb
      .from("approval_requests")
      .select("request_id,message,kind,status")
      .eq("kind", "memory_card")
      .in("status", ["pending", "submitted"])
      .limit(300);
    var existing = !existingRes.error && Array.isArray(existingRes.data) ? existingRes.data : [];

    var Create = global.AlzidanHomeRequestCreate;
    var inserted = 0;
    var skipped = 0;
    var notified = 0;
    var failed = 0;

    for (var i = 0; i < pending.length; i++) {
      var mem = pending[i] || {};
      var memoryId = mem.id;
      if (!memoryId) continue;
      if (memoryAlreadyBridged(existing, memoryId)) {
        skipped += 1;
        continue;
      }

      var requestId = "MEM-ITEM-" + String(memoryId);
      var branchKey = text(mem.branch_key);
      var personName = text(mem.person_name) || text(mem.title) || "ذكرى";
      var phone = text(mem.submitted_by_phone);
      var title = text(mem.title) || "ذكرى";
      var approvalRow = {
        request_id: requestId,
        kind: "memory_card",
        branch_key: branchKey,
        name: personName,
        phone: phone || null,
        email: null,
        status: "pending",
        message:
          "طلب: ذكرى\n" +
          "العنوان: " +
          title +
          "\n" +
          "الشخص: " +
          personName +
          "\n" +
          "الفرع: " +
          branchKey +
          "\n" +
          "المرسل: " +
          text(mem.submitted_by_name) +
          "\n" +
          "الجوال: " +
          phone +
          "\n__JSON__:" +
          JSON.stringify({
            memory_id: memoryId,
            title: title,
            person_name: personName,
            memory_kind: mem.memory_kind || null,
            branch_key: branchKey
          })
      };

      var ins = await sb.from("approval_requests").insert(approvalRow);
      if (ins.error) {
        failed += 1;
        try {
          console.warn("[memory-bridge] insert failed", memoryId, ins.error);
        } catch (_) {}
        continue;
      }
      inserted += 1;

      try {
        if (branchKey) {
          var notifyRecord = {
            request_id: requestId,
            kind: "memory_card",
            branch_key: branchKey,
            status: "pending",
            name: personName,
            person: personName,
            phone: phone || null,
            email: null
          };
          var nres = null;
          if (Create && typeof Create.notifyBranchDelegatesOfRequest === "function") {
            nres = await Create.notifyBranchDelegatesOfRequest(sb, notifyRecord);
          } else {
            try {
              await sb.functions.invoke("alzidan-email-notify", {
                body: { mode: "branch_delegate_new_request", record: notifyRecord }
              });
            } catch (_) {}
            try {
              await sb.functions.invoke("alzidan-push-notify", {
                body: { mode: "branch_delegate_new_request", record: notifyRecord }
              });
              nres = { ok: true };
            } catch (_) {
              nres = { ok: false };
            }
          }
          if (nres && nres.ok) notified += 1;
        }
      } catch (notifyErr) {
        try {
          console.warn("[memory-bridge] notify failed", memoryId, notifyErr);
        } catch (_) {}
      }
    }

    setStatus(
      "تم: أُرسل " +
        inserted +
        " للمندوبين، تخطي " +
        skipped +
        " (موجودة)، إشعارات " +
        notified +
        (failed ? "، فشل " + failed : "") +
        "."
    );
  }

  function bindEvents() {
    if (initialized) return;
    initialized = true;

    var refreshBtn = document.getElementById("admin-memory-refresh");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", function () {
        loadMemoryQueue().catch(function () {
          setStatus("تعذر تحديث الذكريات.");
        });
      });
    }

    var bridgeBtn = document.getElementById("admin-memory-bridge-delegates");
    if (bridgeBtn) {
      bridgeBtn.addEventListener("click", function () {
        if (
          !window.confirm(
            "إرسال كل الذكريات المعلّقة إلى «طلبات فرعي» للمناديب مع محاولة إرسال إشعار؟"
          )
        ) {
          return;
        }
        bridgePendingMemoriesToDelegates().catch(function () {
          setStatus("تعذر إرسال الذكريات للمناديب.");
        });
      });
    }

    var filterSel = document.getElementById("admin-memory-filter-status");
    if (filterSel) {
      filterSel.addEventListener("change", function () {
        loadMemoryQueue().catch(function () {});
      });
    }

    var body = document.getElementById("admin-memory-body");
    if (body) {
      body.addEventListener("click", function (event) {
        var btn = event.target && event.target.closest ? event.target.closest("[data-memory-action]") : null;
        if (!btn) return;
        var action = btn.getAttribute("data-memory-action");
        var id = Number(btn.getAttribute("data-memory-id"));
        if (!id || !action) return;

        if (action === "approve") {
          if (!window.confirm("اعتماد هذه الذكرى ونشرها؟")) return;
          setMemoryStatus(id, "approved").catch(function () {
            setStatus("تعذر اعتماد الذكرى.");
          });
          return;
        }
        if (action === "reject") {
          setMemoryStatus(id, "rejected").catch(function () {
            setStatus("تعذر رفض الذكرى.");
          });
          return;
        }
        if (action === "archive") {
          if (!window.confirm("أرشفة هذه الذكرى؟")) return;
          setMemoryStatus(id, "archived").catch(function () {
            setStatus("تعذر أرشفة الذكرى.");
          });
        }
      });
    }
  }

  function initAdminMemoryQueue() {
    bindEvents();
  }

  global.AlzidanAdminMemoryQueueModule = {
    initAdminMemoryQueue: initAdminMemoryQueue,
    loadMemoryQueue: loadMemoryQueue
  };
})(window);
