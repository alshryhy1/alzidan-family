/**
 * Admin/Delegate reorder_children editor: match → Preview → Save birth_order.
 * Depends on window.AlzidanTreeCorrectionContract
 * Exposes window.AlzidanTreeCorrectionReorder
 */
(function () {
  "use strict";

  var Contract = null;
  function C() {
    Contract =
      Contract ||
      (typeof window !== "undefined" && window.AlzidanTreeCorrectionContract) ||
      null;
    return Contract;
  }

  function text(v) {
    return String(v == null ? "" : v)
      .replace(/\s+/g, " ")
      .trim();
  }

  function leafName(path) {
    var parts = text(path)
      .split("/")
      .map(text)
      .filter(Boolean);
    return parts.length ? parts[parts.length - 1] : "";
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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
    if (window.__alzidanConfig && typeof window.__alzidanConfig.getClient === "function") {
      return window.__alzidanConfig.getClient();
    }
    if (typeof window.getSupabaseClient === "function") {
      return window.getSupabaseClient();
    }
    return window.__alzidanSupabaseClient || null;
  }

  var dialogEl = null;
  var activeRow = null;
  var activeMode = "admin";
  var working = {
    payload: null,
    children: [],
    orderedIds: [],
    match: null,
    preview: null,
    matchLevel: null,
    recovery: null,
    safeReview: false,
    parentSearchTimer: null,
  };

  function ensureDialog() {
    if (dialogEl && document.body.contains(dialogEl)) return dialogEl;
    var d = document.createElement("dialog");
    d.id = "tree-correction-reorder-dialog";
    d.className = "alzidan-dialog";
    d.style.cssText =
      "max-width:720px;width:94vw;padding:0;border:1px solid #d1d5db;border-radius:14px;direction:rtl;";
    d.innerHTML =
      '<form method="dialog" id="tree-correction-reorder-form" style="margin:0">' +
      '<div style="padding:14px 16px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;gap:8px">' +
      '<strong id="tcr-title">ترتيب الأبناء</strong>' +
      '<button type="submit" value="cancel" class="btn btn-outline btn-sm">إغلاق</button>' +
      "</div>" +
      '<div id="tcr-body" style="padding:14px 16px;max-height:72vh;overflow:auto"></div>' +
      '<div style="padding:12px 16px;border-top:1px solid #e5e7eb;display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-start">' +
      '<button type="button" class="btn btn-primary btn-sm" id="tcr-save" hidden>حفظ الترتيب</button>' +
      '<span id="tcr-status" style="font-size:12px;color:#6b7280;align-self:center"></span>' +
      "</div>" +
      "</form>";
    document.body.appendChild(d);
    dialogEl = d;
    var saveBtn = d.querySelector("#tcr-save");
    if (saveBtn) {
      saveBtn.addEventListener("click", function (ev) {
        ev.preventDefault();
        saveReorder().catch(function (err) {
          setStatus(
            "تعذر الحفظ: " + String((err && err.message) || err || ""),
            true
          );
        });
      });
    }
    return d;
  }

  function setStatus(msg, isError) {
    var el = dialogEl && dialogEl.querySelector("#tcr-status");
    if (!el) return;
    el.textContent = msg || "";
    el.style.color = isError ? "#991b1b" : "#065f46";
  }

  async function fetchChildrenUnderParent(sb, parentPersonId, branchKey, parentPath) {
    var out = [];
    var PAGE = 1000;
    async function page(build) {
      var from = 0;
      var rows = [];
      for (;;) {
        var q = build(
          sb
            .from("tree_children")
            .select(
              "id,person_id,parent_person_id,parent_name,parent,child_name,name,birth_order,branch_key,birth_date_g,birth_date_h,birth_year,city,area,is_deceased,deceased"
            )
        );
        var res = await q.range(from, from + PAGE - 1);
        if (res.error) break;
        var chunk = Array.isArray(res.data) ? res.data : [];
        rows = rows.concat(chunk);
        if (chunk.length < PAGE) break;
        from += PAGE;
      }
      return rows;
    }

    if (parentPersonId) {
      out = await page(function (q) {
        return q.eq("parent_person_id", parentPersonId);
      });
    }
    if ((!out || !out.length) && branchKey && parentPath) {
      var byBranch = await page(function (q) {
        return q.eq("branch_key", branchKey);
      });
      var parentNorm = text(parentPath);
      out = byBranch.filter(function (r) {
        return text(r.parent_name || r.parent || "") === parentNorm;
      });
    }
    return (out || []).map(function (r) {
      var path = text(r.child_name || r.name || "");
      return {
        id: r.id,
        person_id: text(r.person_id),
        parent_person_id: text(r.parent_person_id),
        parent_name: text(r.parent_name || r.parent || ""),
        path: path,
        name: leafName(path),
        birth_order:
          r.birth_order != null && r.birth_order !== ""
            ? Number(r.birth_order)
            : null,
        branch_key: text(r.branch_key || branchKey),
        child_name: path,
        birth_date_g: r.birth_date_g || null,
        birth_date_h: r.birth_date_h || null,
        birth_year: r.birth_year != null ? r.birth_year : null,
        city: r.city || null,
        area: r.area || null,
        is_deceased: !!(r.is_deceased || r.deceased),
        deceased: !!(r.is_deceased || r.deceased),
      };
    });
  }

  function moveItem(arr, from, to) {
    if (from < 0 || to < 0 || from >= arr.length || to >= arr.length) return arr;
    var next = arr.slice();
    var item = next.splice(from, 1)[0];
    next.splice(to, 0, item);
    return next;
  }

  function childLabel(id) {
    var hit = (working.children || []).find(function (c) {
      return c.person_id === id;
    });
    return hit ? hit.name || leafName(hit.path) : id;
  }

  function requestedChildren() {
    return (working.payload && working.payload.ordered_children) || [];
  }

  function recomputeMatchAndPreview() {
    var api = C();
    if (!api) return;
    var p = working.payload || {};
    working.match = api.matchChildrenToTree(
      requestedChildren(),
      working.children || []
    );
    working.matchLevel = api.assessMatchLevel({
      parent_person_id: p.parent_person_id,
      match: working.match,
      requested: requestedChildren(),
    });
    if (working.match && working.match.complete) {
      working.orderedIds = working.match.ordered_person_ids.slice();
      working.preview = api.buildReorderPreview(
        working.children,
        working.orderedIds,
        { ready: true }
      );
    } else {
      working.orderedIds = [];
      working.preview = api.buildReorderPreview([], [], { ready: false });
    }
  }

  async function searchParentsInBranch(sb, branchKey, term) {
    var q = text(term);
    if (!sb || !branchKey || q.length < 2) return [];
    var res = await sb
      .from("tree_children")
      .select("person_id,child_name,name,parent_name,branch_key")
      .eq("branch_key", branchKey)
      .limit(800);
    if (res.error) return [];
    var rows = Array.isArray(res.data) ? res.data : [];
    var api = C();
    var qKey = api ? api.normalizeMatchKey(q) : q;
    var scored = [];
    var seen = {};
    rows.forEach(function (r) {
      var path = text(r.child_name || r.name || "");
      var pid = text(r.person_id);
      if (!path || !pid || seen[pid]) return;
      var leaf = leafName(path);
      var leafKey = api ? api.normalizeMatchKey(leaf) : leaf;
      var pathKey = api ? api.normalizeMatchKey(path) : path;
      var score = 0;
      if (leafKey === qKey) score = 100;
      else if (leafKey.indexOf(qKey) === 0) score = 80;
      else if (leafKey.indexOf(qKey) >= 0) score = 60;
      else if (pathKey.indexOf(qKey) >= 0) score = 40;
      if (!score) return;
      seen[pid] = true;
      scored.push({
        person_id: pid,
        path: path,
        name: leaf,
        score: score,
      });
    });
    scored.sort(function (a, b) {
      return b.score - a.score || a.name.localeCompare(b.name, "ar");
    });
    return scored.slice(0, 12);
  }

  async function bindParentAndRematch(parent) {
    var p = working.payload || {};
    p.parent_person_id = text(parent.person_id);
    p.parent_path = text(parent.path);
    p.parent_name = text(parent.name || leafName(parent.path));
    working.payload = p;
    var sb = getClient();
    if (!sb) {
      setStatus("تعذر الاتصال.", true);
      return;
    }
    setStatus("جاري مطابقة المجموعة تحت الأب…");
    working.children = await fetchChildrenUnderParent(
      sb,
      p.parent_person_id,
      p.branch_key || "",
      p.parent_path
    );
    recomputeMatchAndPreview();
    renderBody(dialogEl.querySelector("#tcr-body"));
    var level = working.matchLevel;
    if (level && level.level === 1) {
      setStatus("تم العثور على المجموعة — راجع المعاينة ثم احفظ.");
    } else if (level && level.level === 3) {
      setStatus(level.message_ar, true);
    } else {
      setStatus((level && level.message_ar) || "المطابقة غير مكتملة.", true);
    }
  }

  function refreshPreviewUi() {
    recomputeMatchAndPreview();
    var body = dialogEl && dialogEl.querySelector("#tcr-body");
    if (!body) return;
    renderBody(body);
  }

  function renderBody(body) {
    var api = C();
    var p = working.payload || {};
    var match = working.match;
    var preview = working.preview;
    var level = working.matchLevel;
    var reqList = requestedChildren();
    var html = "";

    html +=
      '<div style="font-size:15px;font-weight:800;margin-bottom:10px">' +
      (working.safeReview
        ? "ترتيب أبناء — مراجعة طلب قديم"
        : "ترتيب الأبناء") +
      "</div>";

    if (working.safeReview) {
      html +=
        '<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:10px 12px;margin-bottom:12px;font-size:13px;color:#9a3412">' +
        "لن يُطبَّق كإضافة فرد. الهدف: استعادة عملية الترتيب من بيانات الطلب ثم مطابقة المجموعة تحت أب تختاره من الشجرة." +
        "</div>";
    }

    html +=
      '<div style="font-size:13px;margin-bottom:12px;color:#374151">' +
      "<div>الفرع: <strong>" +
      escapeHtml(p.branch_key || "—") +
      "</strong></div></div>";

    // Parent picker
    html +=
      '<div style="border:1px solid #e5e7eb;border-radius:12px;padding:12px;margin-bottom:12px">' +
      '<div style="font-weight:700;font-size:13px;margin-bottom:6px">الأب المرجعي</div>';
    if (p.parent_person_id) {
      html +=
        "<div style=\"margin-bottom:8px\"><strong>" +
        escapeHtml(p.parent_name || leafName(p.parent_path) || "—") +
        "</strong>" +
        (p.parent_path
          ? '<div style="font-size:12px;color:#6b7280;margin-top:2px">' +
            escapeHtml(p.parent_path) +
            "</div>"
          : "") +
        "</div>" +
        '<button type="button" class="btn btn-outline btn-sm" id="tcr-change-parent">تغيير الأب</button>';
    } else {
      html +=
        '<div style="color:#b45309;font-size:13px;margin-bottom:8px">' +
        ((level && level.message_ar) ||
          "الأب غير مثبت في الطلب القديم — اختره من الشجرة لتأكيد المجموعة.") +
        "</div>";
    }
    html +=
      '<div id="tcr-parent-search-wrap" style="margin-top:10px;' +
      (p.parent_person_id ? "display:none" : "") +
      '">' +
      '<input id="tcr-parent-search" type="search" placeholder="ابحث عن الأب في فرع ' +
      escapeHtml(p.branch_key || "") +
      '…" style="width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box" />' +
      '<div id="tcr-parent-suggest" style="margin-top:6px"></div></div></div>';

    // Request names + match status
    html +=
      '<div style="margin-bottom:12px"><div style="font-weight:700;font-size:13px;margin-bottom:6px">أسماء الطلب (' +
      reqList.length +
      ")</div>";
    if (level && level.level === 1) {
      html +=
        '<div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;padding:10px;font-size:13px;margin-bottom:8px">' +
        escapeHtml(level.message_ar) +
        "</div>";
    } else if (level && level.level === 2) {
      html +=
        '<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:10px;font-size:13px;margin-bottom:8px">' +
        escapeHtml(level.message_ar) +
        "</div>";
    } else if (level && (level.level === 3 || level.level === 4)) {
      html +=
        '<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:10px;font-size:13px;margin-bottom:8px">' +
        escapeHtml(level.message_ar) +
        "</div>";
    }

    html +=
      '<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>' +
      '<th style="text-align:right;padding:6px;border-bottom:1px solid #e5e7eb">المطلوب</th>' +
      '<th style="text-align:right;padding:6px;border-bottom:1px solid #e5e7eb">المطابق في الشجرة</th>' +
      '<th style="text-align:right;padding:6px;border-bottom:1px solid #e5e7eb">الحالة</th>' +
      "</tr></thead><tbody>";

    var matchedByIndex = {};
    (match && match.matched ? match.matched : []).forEach(function (m) {
      matchedByIndex[m.index] = m;
    });
    var ambByIndex = {};
    (match && match.ambiguous ? match.ambiguous : []).forEach(function (a) {
      ambByIndex[a.index] = a;
    });
    var unByIndex = {};
    (match && match.unmatched ? match.unmatched : []).forEach(function (u) {
      unByIndex[u.index] = u;
    });

    reqList.forEach(function (item, i) {
      var reqName = item.name || item.match_name || "—";
      var status = "بانتظار الأب";
      var treeName = "—";
      var color = "#6b7280";
      if (!p.parent_person_id) {
        status = "بانتظار اختيار الأب";
      } else if (matchedByIndex[i]) {
        status = "✓";
        treeName = matchedByIndex[i].name;
        color = "#065f46";
      } else if (ambByIndex[i]) {
        status = "غامض";
        treeName = (ambByIndex[i].candidates || [])
          .map(function (c) {
            return c.name;
          })
          .slice(0, 3)
          .join(" / ");
        color = "#b45309";
      } else if (unByIndex[i]) {
        status = "غير مطابق";
        color = "#991b1b";
      }
      html +=
        "<tr><td style=\"padding:6px;border-bottom:1px solid #f3f4f6\">" +
        escapeHtml(reqName) +
        "</td><td style=\"padding:6px;border-bottom:1px solid #f3f4f6\">" +
        escapeHtml(treeName) +
        '</td><td style="padding:6px;border-bottom:1px solid #f3f4f6;color:' +
        color +
        ';font-weight:700">' +
        escapeHtml(status) +
        "</td></tr>";
    });
    if (!reqList.length) {
      html +=
        '<tr><td colspan="3" style="padding:8px;color:#991b1b">لم تُستخرج أسماء من الطلب.</td></tr>';
      if (working.recovery) {
        html +=
          '<tr><td colspan="3" style="padding:8px;font-size:12px;color:#9a3412;background:#fff7ed">' +
          "<strong>سبب الاستخراج:</strong> " +
          escapeHtml(
            (working.recovery.message_ar || "") +
              (working.recovery.reasons && working.recovery.reasons.length
                ? " — " + working.recovery.reasons.join(" ")
                : "")
          ) +
          (working.recovery.extract_debug && working.recovery.extract_debug.length
            ? '<div style="margin-top:6px;direction:ltr;text-align:left;font-family:ui-monospace,monospace;font-size:11px">' +
              escapeHtml(working.recovery.extract_debug.join(" | ")) +
              "</div>"
            : "") +
          "</td></tr>";
      }
    }
    html += "</tbody></table></div>";

    // Orders + preview only when complete
    if (match && match.complete && preview && preview.ready) {
      html +=
        '<div style="display:grid;gap:12px;grid-template-columns:1fr 1fr;margin-bottom:12px">' +
        '<div><div style="font-weight:700;font-size:13px;margin-bottom:6px">الترتيب المخزّن حالياً (من birth_order)</div><ol style="margin:0;padding-inline-start:20px;font-size:13px">';
      (preview.current_order || []).forEach(function (c) {
        html +=
          "<li>" +
          escapeHtml(c.name) +
          (c.birth_order != null
            ? ' <span style="color:#065f46">← birth_order ' +
              c.birth_order +
              "</span>"
            : ' <span style="color:#b45309">← بلا birth_order مخزّن</span>') +
          "</li>";
      });
      html +=
        "</ol></div><div><div style=\"font-weight:700;font-size:13px;margin-bottom:6px\">الترتيب canonical بعد الحفظ (1…N)</div><ol style=\"margin:0;padding-inline-start:20px;font-size:13px\">";
      (working.orderedIds || []).forEach(function (id, i) {
        html +=
          '<li style="margin:4px 0;display:flex;gap:6px;align-items:center;flex-wrap:wrap">' +
          "<span style=\"flex:1\">" +
          escapeHtml(childLabel(id)) +
          " = <strong>" +
          (i + 1) +
          "</strong></span>" +
          '<button type="button" class="btn btn-outline btn-sm" data-tcr-up="' +
          i +
          '" ' +
          (i === 0 ? "disabled" : "") +
          ">↑</button>" +
          '<button type="button" class="btn btn-outline btn-sm" data-tcr-down="' +
          i +
          '" ' +
          (i === working.orderedIds.length - 1 ? "disabled" : "") +
          ">↓</button></li>";
      });
      html += "</ol></div></div>";

      html +=
        '<div style="display:grid;gap:8px">' +
        '<div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;padding:10px;font-size:13px">' +
        "<strong>معاينة الحفظ</strong><div style=\"margin-top:6px\">" +
        escapeHtml(preview.changes_summary) +
        "</div>";
      if (preview.canonical_summary) {
        html +=
          '<div style="margin-top:8px;font-size:12px"><strong>الإسناد الصريح:</strong> ' +
          escapeHtml(preview.canonical_summary) +
          "</div>";
      }
      if (preview.assignments && preview.assignments.length) {
        html +=
          "<ul style=\"margin:6px 0 0;padding-inline-start:18px\">";
        preview.assignments.forEach(function (ch) {
          html +=
            "<li>" +
            escapeHtml(ch.name) +
            ": " +
            (ch.from == null ? "—" : ch.from) +
            " → <strong>" +
            ch.to +
            "</strong></li>";
        });
        html += "</ul>";
      }
      html +=
        "</div><div style=\"background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px;font-size:13px\">" +
        "<strong>لن يتغير</strong><div style=\"margin-top:6px\">" +
        escapeHtml(preview.unchanged_summary) +
        "</div></div></div>";
    } else {
      html +=
        '<div style="background:#f8fafc;border:1px dashed #cbd5e1;border-radius:10px;padding:12px;font-size:13px;color:#475569">' +
        "<strong>معاينة الأثر</strong>" +
        "<div style=\"margin-top:6px\">الأثر غير محسوب بعد — أكمل مطابقة الأب والمجموعة.</div>" +
        "</div>";
    }

    body.innerHTML = html;

    var changeBtn = body.querySelector("#tcr-change-parent");
    if (changeBtn) {
      changeBtn.addEventListener("click", function () {
        var wrap = body.querySelector("#tcr-parent-search-wrap");
        if (wrap) wrap.style.display = "";
        var inp = body.querySelector("#tcr-parent-search");
        if (inp) inp.focus();
      });
    }

    var searchInput = body.querySelector("#tcr-parent-search");
    var suggestBox = body.querySelector("#tcr-parent-suggest");
    if (searchInput && suggestBox) {
      searchInput.addEventListener("input", function () {
        clearTimeout(working.parentSearchTimer);
        working.parentSearchTimer = setTimeout(async function () {
          var sb = getClient();
          var hits = await searchParentsInBranch(
            sb,
            p.branch_key || "",
            searchInput.value
          );
          if (!hits.length) {
            suggestBox.innerHTML =
              '<div style="font-size:12px;color:#6b7280">لا نتائج</div>';
            return;
          }
          suggestBox.innerHTML = hits
            .map(function (h) {
              return (
                '<button type="button" class="btn btn-outline btn-sm" style="display:block;width:100%;margin:4px 0;text-align:right" data-tcr-pick-parent="' +
                escapeHtml(h.person_id) +
                '" data-path="' +
                escapeHtml(h.path) +
                '" data-name="' +
                escapeHtml(h.name) +
                '">' +
                escapeHtml(h.name) +
                '<div style="font-size:11px;color:#6b7280;font-weight:400">' +
                escapeHtml(h.path) +
                "</div></button>"
              );
            })
            .join("");
          suggestBox.querySelectorAll("[data-tcr-pick-parent]").forEach(function (btn) {
            btn.addEventListener("click", function () {
              bindParentAndRematch({
                person_id: btn.getAttribute("data-tcr-pick-parent"),
                path: btn.getAttribute("data-path"),
                name: btn.getAttribute("data-name"),
              });
            });
          });
        }, 260);
      });
    }

    body.querySelectorAll("[data-tcr-up]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var i = Number(btn.getAttribute("data-tcr-up"));
        working.orderedIds = moveItem(working.orderedIds, i, i - 1);
        var api2 = C();
        working.preview = api2.buildReorderPreview(
          working.children,
          working.orderedIds,
          { ready: true }
        );
        renderBody(body);
      });
    });
    body.querySelectorAll("[data-tcr-down]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var i = Number(btn.getAttribute("data-tcr-down"));
        working.orderedIds = moveItem(working.orderedIds, i, i + 1);
        var api2 = C();
        working.preview = api2.buildReorderPreview(
          working.children,
          working.orderedIds,
          { ready: true }
        );
        renderBody(body);
      });
    });

    var saveBtn = dialogEl && dialogEl.querySelector("#tcr-save");
    if (saveBtn) {
      var ready =
        !!(match && match.complete) &&
        !!(p.parent_person_id) &&
        working.orderedIds.length >= 2 &&
        preview &&
        preview.ready;
      saveBtn.hidden = !ready;
      saveBtn.textContent = working.safeReview
        ? "حفظ الترتيب بعد المراجعة"
        : "حفظ الترتيب";
    }
  }

  async function openReorderChildrenEditor(row, opts) {
    var api = C();
    if (!api) {
      window.alert("وحدة عقد التصحيح غير محمّلة. حدّث الصفحة.");
      return { ok: false, message: "contract_missing" };
    }
    opts = opts || {};
    activeRow = row;
    activeMode = opts.mode || "admin";
    working.safeReview = !!opts.safeReview || activeMode === "safe_review";

    var routed = api.routeRequest(row);
    var payload =
      (routed && routed.payload) ||
      (api.parseCorrectionMessage(row && row.message, row).payload) ||
      api.normalizeReorderPayload({}, row);

    // Always enrich from raw message via Legacy Recovery Parser.
    var recovery =
      typeof api.parseLegacyCorrectionRecovery === "function"
        ? api.parseLegacyCorrectionRecovery(String((row && row.message) || ""))
        : null;
    working.recovery = recovery;
    var extracted =
      recovery && Array.isArray(recovery.targets)
        ? recovery.targets
        : api.extractReorderCandidateNames(String((row && row.message) || ""));
    if (extracted.length >= 2) {
      payload.ordered_children = (recovery && recovery.ordered_children) ||
        extracted.map(function (n, i) {
          return { person_id: "", name: n, match_name: n, position: i + 1 };
        });
      if (!payload.operation) payload.operation = "reorder_children";
      if (recovery && recovery.branch_key && !payload.branch_key) {
        payload.branch_key = recovery.branch_key;
      }
    } else if (
      !payload.ordered_children ||
      !payload.ordered_children.length
    ) {
      payload.ordered_children = [];
    }

    if (!payload.branch_key) {
      payload.branch_key = text(row && row.branch_key);
    }

    working.payload = payload;
    working.children = [];
    working.orderedIds = [];
    working.match = null;
    working.preview = null;
    working.matchLevel = null;
    // working.recovery already set above when parsed

    var dialog = ensureDialog();
    var title = dialog.querySelector("#tcr-title");
    if (title) {
      title.textContent = working.safeReview
        ? "ترتيب أبناء — مراجعة طلب قديم"
        : "ترتيب الأبناء";
    }

    var sb = getClient();
    if (!sb) {
      setStatus("تعذر الاتصال.", true);
      recomputeMatchAndPreview();
      if (typeof dialog.showModal === "function") dialog.showModal();
      renderBody(dialog.querySelector("#tcr-body"));
      return { ok: false, message: "no_client" };
    }

    if (typeof dialog.showModal === "function") dialog.showModal();

    try {
      if (payload.parent_person_id) {
        setStatus("جاري مطابقة المجموعة…");
        working.children = await fetchChildrenUnderParent(
          sb,
          payload.parent_person_id,
          payload.branch_key || "",
          payload.parent_path || payload.parent_name || ""
        );
      }
      recomputeMatchAndPreview();
      renderBody(dialog.querySelector("#tcr-body"));
      var level = working.matchLevel;
      if (level && level.level === 1) {
        setStatus("مطابقة مكتملة — راجع المعاينة ثم احفظ.");
      } else if (level && level.level === 2) {
        setStatus(level.message_ar);
      } else {
        setStatus((level && level.message_ar) || "بانتظار إكمال المطابقة.");
      }
      return { ok: true };
    } catch (err) {
      setStatus(
        "تعذر فتح المحرر: " + String((err && err.message) || err || ""),
        true
      );
      recomputeMatchAndPreview();
      renderBody(dialog.querySelector("#tcr-body"));
      return { ok: false, message: String((err && err.message) || err || "") };
    }
  }

  async function adminUpsertBirthOrder(sb, token, child, birthOrder) {
    // birth_order only change — preserve identity and existing biodata fields.
    var row = {
      branch_key: child.branch_key,
      parent_name: child.parent_name,
      parent: child.parent_name,
      child_name: child.path || child.child_name,
      name: child.path || child.child_name,
      person_id: child.person_id,
      parent_person_id: child.parent_person_id,
      birth_order: birthOrder,
      id: child.id,
      birth_date_g: child.birth_date_g || null,
      birth_date_h: child.birth_date_h || null,
      birth_year: child.birth_year != null ? child.birth_year : null,
      city: child.city || null,
      area: child.area || null,
      is_deceased: !!child.is_deceased,
      deceased: !!child.deceased,
    };
    var upsert = await sb.rpc("admin_tree_child_upsert_v1", {
      p_token: token,
      p_row: row,
    });
    if (upsert.error) {
      return { ok: false, error: upsert.error };
    }
    return { ok: true };
  }

  async function delegatePatchBirthOrder(sb, child, birthOrder) {
    if (
      window.AlzidanDelegateTreeWrite &&
      typeof window.AlzidanDelegateTreeWrite.updateBirthOrder === "function"
    ) {
      return window.AlzidanDelegateTreeWrite.updateBirthOrder(child, birthOrder);
    }
    var auth =
      typeof window.getDelegateRpcAuth === "function"
        ? await window.getDelegateRpcAuth()
        : null;
    if (!auth || !auth.ok) {
      return { ok: false, error: { message: "صلاحية المندوب غير متاحة للحفظ." } };
    }
    var res = await sb.rpc("tree_children_update_v1", {
      p_branch_key: child.branch_key,
      p_parent_name: child.parent_name,
      p_child_name: child.path || child.child_name,
      p_phone: auth.phone || null,
      p_email: auth.email || null,
      p_secret_hash: auth.secretHash || null,
      p_patch: {
        birth_order: birthOrder,
        person_id: child.person_id,
      },
    });
    if (res.error) return { ok: false, error: res.error };
    if (res.data === false) {
      return { ok: false, error: { message: "رفض التحديث (صلاحية أو صف غير موجود)." } };
    }
    return { ok: true };
  }

  async function saveReorder() {
    var api = C();
    if (!api || !activeRow) return;
    var p = working.payload || {};
    if (!p.parent_person_id) {
      setStatus("لا يمكن الحفظ بلا parent_person_id موثوق.", true);
      return;
    }
    if (!working.orderedIds || working.orderedIds.length < 2) {
      setStatus("الترتيب يحتاج ابنين على الأقل بالهوية.", true);
      return;
    }
    var allKnown = working.orderedIds.every(function (id) {
      return (working.children || []).some(function (c) {
        return c.person_id === id;
      });
    });
    if (!allKnown) {
      setStatus("كل الأبناء في الترتيب يجب أن يكونوا تحت الأب بهوية معروفة.", true);
      return;
    }

    if (!working.match || !working.match.complete) {
      setStatus("المطابقة غير مكتملة — لا حفظ جزئي.", true);
      return;
    }

    working.preview = api.buildReorderPreview(
      working.children,
      working.orderedIds,
      { ready: true }
    );
    if (!working.preview.ready) {
      setStatus("الأثر غير محسوب بعد — أكمل مطابقة الأب والمجموعة.", true);
      return;
    }

    var assignLines = (working.preview.assignments || [])
      .map(function (a) {
        return (
          a.name +
          " = " +
          a.to +
          " (كان: " +
          (a.from == null ? "—" : a.from) +
          ")"
        );
      })
      .join("\n");

    var confirmed = window.confirm(
      "حفظ reorder_children — إسناد birth_order صريح لكل المجموعة 1…" +
        working.orderedIds.length +
        ":\n\n" +
        assignLines +
        "\n\n" +
        working.preview.unchanged_summary +
        "\n\nبعد الحفظ ستُعاد قراءة الشجرة للتحقق أن ترتيب العرض يطابق هذه القيم.\nمتابعة؟"
    );
    if (!confirmed) return;

    var sb = getClient();
    if (!sb) {
      setStatus("تعذر الاتصال.", true);
      return;
    }

    setStatus("جاري الحفظ…");
    var saveBtn = dialogEl && dialogEl.querySelector("#tcr-save");
    if (saveBtn) saveBtn.disabled = true;

    try {
      var byId = {};
      working.children.forEach(function (c) {
        byId[c.person_id] = c;
      });

      // Clear-then-assign ALL members 1..N (never only the "changed" subset).
      var clearList = working.orderedIds
        .map(function (id) {
          return byId[id];
        })
        .filter(Boolean);

      if (activeMode === "delegate") {
        for (var i = 0; i < clearList.length; i++) {
          var clr = await delegatePatchBirthOrder(sb, clearList[i], null);
          if (!clr.ok) {
            throw new Error(
              (clr.error && clr.error.message) || "فشل تفريغ الترتيب"
            );
          }
        }
        for (var j = 0; j < working.orderedIds.length; j++) {
          var child = byId[working.orderedIds[j]];
          var setRes = await delegatePatchBirthOrder(sb, child, j + 1);
          if (!setRes.ok) {
            throw new Error(
              (setRes.error && setRes.error.message) ||
                "فشل تعيين الترتيب لـ " + (child.name || "")
            );
          }
        }
      } else {
        var token = getAdminToken();
        if (!token) throw new Error("يلزم تسجيل دخول الإدارة.");
        for (var k = 0; k < clearList.length; k++) {
          var c1 = await adminUpsertBirthOrder(sb, token, clearList[k], null);
          if (!c1.ok) {
            throw new Error(
              (c1.error && c1.error.message) || "فشل تفريغ الترتيب"
            );
          }
        }
        for (var n = 0; n < working.orderedIds.length; n++) {
          var c2 = byId[working.orderedIds[n]];
          var s2 = await adminUpsertBirthOrder(sb, token, c2, n + 1);
          if (!s2.ok) {
            throw new Error(
              (s2.error && s2.error.message) ||
                "فشل تعيين الترتيب لـ " + (c2.name || "")
            );
          }
        }
      }

      // Re-read tree and verify display order follows stored birth_order 1..N
      setStatus("جاري التحقق من الشجرة بعد الحفظ…");
      var refreshed = await fetchChildrenUnderParent(
        sb,
        p.parent_person_id,
        p.branch_key || "",
        p.parent_path || p.parent_name || ""
      );
      var verify = api.verifyCanonicalBirthOrder(
        refreshed,
        working.orderedIds
      );
      if (!verify.ok) {
        throw new Error(
          "الحفظ لم يُثبَّت كما يجب — ترتيب العرض لا يطابق birth_order:\n" +
            (verify.errors || []).join("\n")
        );
      }
      working.children = refreshed;
      recomputeMatchAndPreview();

      // Stamp request message with resolved IDs + applied_at (no kind change).
      var stamped = api.normalizeReorderPayload(
        Object.assign({}, p, {
          ordered_children: working.orderedIds.map(function (id, idx) {
            var ch = byId[id] || {};
            var fresh = refreshed.find(function (r) {
              return r.person_id === id;
            });
            return {
              person_id: id,
              name: (fresh && fresh.name) || ch.name || "",
              match_name: (fresh && fresh.name) || ch.name || "",
              path: (fresh && fresh.path) || ch.path || "",
              position: idx + 1,
            };
          }),
          review_state: "ready",
          applied_at: new Date().toISOString(),
        }),
        activeRow
      );
      var newMessage = api.serializeReorderMessage(
        Object.assign({}, stamped, {
          requestId: text(activeRow.request_id || ""),
        })
      );

      // Prefer numeric row.id (same as requests.js approve). Never swallow status errors.
      var coerceRpcId =
        (window.AlzidanAdminCore &&
          typeof window.AlzidanAdminCore.coerceRpcId === "function" &&
          window.AlzidanAdminCore.coerceRpcId) ||
        function (v) {
          if (v == null) return "";
          if (typeof v === "number" && Number.isFinite(v)) return v;
          var s = String(v || "").trim();
          if (!s) return "";
          if (/^-?\d+$/.test(s)) return s;
          return s;
        };
      var id = coerceRpcId(
        activeRow.id != null && String(activeRow.id).trim() !== ""
          ? activeRow.id
          : activeRow.request_id
      );
      var statusOk = false;
      var statusErr = "";
      if (!id) {
        statusErr =
          "بيانات الطلب ناقصة (لا يوجد id) — الشجرة حُفظت لكن الحالة لم تُحدَّث.";
      } else if (activeMode === "admin") {
        var adminToken = getAdminToken();
        if (!adminToken) {
          statusErr =
            "يلزم تسجيل دخول الإدارة لاعتماد الطلب — الشجرة حُفظت لكن الحالة بقيت تحت الإجراء.";
        } else {
          try {
            var statusRes = await sb.rpc("admin_set_request_status_v2", {
              p_token: adminToken,
              p_id: id,
              p_status: "approved",
            });
            if (statusRes && statusRes.error) {
              statusErr =
                "تعذر ضبط الحالة على «مقبول»: " +
                String(
                  (statusRes.error && statusRes.error.message) ||
                    statusRes.error ||
                    ""
                );
            } else if (statusRes && statusRes.data === false) {
              statusErr =
                "تعذر اعتماد الطلب (انتهت الجلسة أو لا صلاحية). الشجرة حُفظت — أعد القبول يدوياً إن لزم.";
            } else {
              statusOk = true;
            }
          } catch (e) {
            statusErr =
              "تعذر ضبط الحالة على «مقبول»: " +
              String((e && e.message) || e || "");
          }
          // Stamp message after status (best-effort; do not hide status failure).
          try {
            if (typeof window.adminUpdateRequestMessage === "function") {
              await window.adminUpdateRequestMessage(activeRow, newMessage);
            } else {
              var branchKey = text(activeRow.branch_key || "");
              var msgRes = await sb.rpc("admin_update_request_branch_v1", {
                p_token: adminToken,
                p_id: String(id),
                p_old_branch_key: branchKey || null,
                p_branch_key: branchKey || null,
                p_name: text(activeRow.name || "") || null,
                p_phone: text(activeRow.phone || "") || null,
                p_email: text(activeRow.email || "") || null,
                p_message: newMessage,
                p_old_tree_rows: [],
                p_new_tree_rows: [],
              });
              if (msgRes && msgRes.error) {
                console.warn("[reorder] message stamp failed", msgRes.error);
              }
            }
          } catch (e) {
            try {
              console.warn("[reorder] message stamp failed", e);
            } catch (_) {}
          }
        }
      } else if (activeMode === "delegate") {
        try {
          if (
            window.AlzidanDelegateTreeWrite &&
            typeof window.AlzidanDelegateTreeWrite.setRequestApproved === "function"
          ) {
            var delRes = await window.AlzidanDelegateTreeWrite.setRequestApproved(
              activeRow
            );
            if (delRes && delRes.ok === false) {
              statusErr =
                "الشجرة حُفظت لكن تعذر اعتماد الطلب من واجهة المندوب.";
            } else {
              statusOk = true;
            }
          } else {
            statusErr =
              "وحدة اعتماد طلب المندوب غير محمّلة — الشجرة حُفظت والحالة لم تُحدَّث.";
          }
        } catch (e) {
          statusErr =
            "تعذر اعتماد الطلب: " + String((e && e.message) || e || "");
        }
      } else {
        statusErr = "وضع غير معروف لاعتماد الطلب بعد الحفظ.";
      }

      if (statusOk) {
        setStatus(
          "تم التحقق والحفظ: birth_order = 1…" +
            working.orderedIds.length +
            " — وتم اعتماد الطلب (مقبول)."
        );
      } else {
        setStatus(
          "تم التحقق من الشجرة (الترتيب صحيح) لكن الطلب ما زال تحت الإجراء.\n" +
            (statusErr || "فشل غير معروف عند ضبط الحالة.") +
            "\nصحّح الاعتماد يدوياً من الطلبات أو أعد الحفظ بعد تحديث الصفحة.",
          true
        );
        try {
          window.alert(
            "الشجرة حُفظت بالترتيب الصحيح، لكن تعذر تحويل الطلب إلى «مقبول».\n\n" +
              (statusErr || "")
          );
        } catch (_) {}
      }
      if (saveBtn) saveBtn.disabled = false;
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
      if (statusOk) {
        setTimeout(function () {
          try {
            if (dialogEl && dialogEl.open) dialogEl.close();
          } catch (_) {}
        }, 900);
      }
    } catch (err) {
      setStatus(
        "فشل الحفظ/التحقق دون انهيار: " +
          String((err && err.message) || err || ""),
        true
      );
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  function openSafeReview(row, opts) {
    return openReorderChildrenEditor(
      row,
      Object.assign({}, opts || {}, { safeReview: true, mode: (opts && opts.mode) || "safe_review" })
    );
  }

  window.AlzidanTreeCorrectionReorder = {
    openReorderChildrenEditor: openReorderChildrenEditor,
    openSafeReview: openSafeReview,
    fetchChildrenUnderParent: fetchChildrenUnderParent,
    saveReorder: saveReorder,
  };
})();
