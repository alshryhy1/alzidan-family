/**
 * Occasion Interaction engine (client)
 * Private interactions → recipient inbox only. Not comments.
 */
(function (root) {
  "use strict";

  var MEMBER_PHONE_KEY = "alzidan_member_phone_v1";

  function getSb() {
    try {
      if (root.__alzidanConfig && typeof root.__alzidanConfig.getClient === "function") {
        return root.__alzidanConfig.getClient();
      }
    } catch (e) {}
    if (root.AlzidanCore && typeof root.AlzidanCore.getClient === "function") {
      return root.AlzidanCore.getClient();
    }
    if (typeof root.getSupabaseClient === "function") return root.getSupabaseClient();
    if (root.__alzidanالخدمةClient) return root.__alzidanالخدمةClient;
    return null;
  }

  function normalizeText(v) {
    return String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  }

  function readMemberPhone() {
    try {
      return normalizeText(localStorage.getItem(MEMBER_PHONE_KEY) || "");
    } catch (e) {
      return "";
    }
  }

  function eventFamilyFromType(type) {
    var Events = root.AlzidanEvents || {};
    if (typeof Events.eventFamilyFromType === "function") {
      return Events.eventFamilyFromType(type);
    }
    var t = normalizeText(type).toLowerCase();
    if (["sick", "operation", "healing", "discharge", "safety"].indexOf(t) >= 0) return "health";
    if (["death", "condolence"].indexOf(t) >= 0) return "death";
    if (
      [
        "wedding",
        "contract",
        "graduation",
        "aqiqa",
        "feast",
        "gathering",
        "family_meetup",
        "promotion",
        "retirement",
        "dinner",
        "lunch",
        "general",
      ].indexOf(t) >= 0
    ) {
      return "occasion";
    }
    return "news";
  }

  function occasionTypeArabic(type) {
    var Events = root.AlzidanEvents || {};
    if (typeof Events.eventTypeArabicLabel === "function") {
      var lab = Events.eventTypeArabicLabel(type);
      if (lab) return lab;
    }
    var t = normalizeText(type).toLowerCase();
    var map = {
      promotion_notice: "ترقية",
      promotion: "حفل ترقية",
      graduation_notice: "تخرج",
      graduation: "حفل تخرج",
      marriage: "زواج",
      wedding: "حفل زواج",
      birth: "مولود",
      sick: "حالة صحية",
      death: "وفاة",
      condolence: "تعزية",
    };
    return map[t] || "";
  }

  /** اسم + أب فقط للتمييز (بدون مسار الشجرة الطويل). */
  function personNameWithFather(person) {
    var raw = normalizeText(person);
    if (!raw) return "";
    if (raw.indexOf("/") >= 0) {
      var parts = raw.split("/").map(normalizeText).filter(Boolean);
      if (parts.length >= 2) {
        var leaf = parts[parts.length - 1];
        var parent = parts[parts.length - 2];
        var leafTok = leaf
          .split(/\s+/)
          .filter(Boolean)
          .filter(function (w) {
            return ["بن", "ابن", "بنت"].indexOf(w) < 0;
          });
        var parentTok = parent
          .split(/\s+/)
          .filter(Boolean)
          .filter(function (w) {
            return ["بن", "ابن", "بنت"].indexOf(w) < 0;
          });
        var a = leafTok[0] || leaf;
        var b = parentTok[0] || parent;
        return normalizeText(a + " " + b);
      }
      raw = parts[parts.length - 1] || raw;
    }
    var tokens = raw
      .split(/\s+/)
      .filter(Boolean)
      .filter(function (w) {
        return ["بن", "ابن", "بنت"].indexOf(w) < 0;
      });
    if (tokens.length >= 2) return tokens[0] + " " + tokens[1];
    return tokens[0] || raw;
  }

  async function resolveSenderDisplayName(phone, fallback) {
    var fb = personNameWithFather(fallback) || normalizeText(fallback) || "";
    var sb = getSb();
    var p = normalizeText(phone);
    if (!sb || !p) return fb;
    try {
      var res = await sb
        .from("member_profiles")
        .select("display_name,person_id,tree_child_id")
        .eq("status", "active")
        .eq("phone", p)
        .limit(1);
      var row = res && Array.isArray(res.data) ? res.data[0] : null;
      if (!row) {
        // try loose match via or filter not available — return fallback
        return fb;
      }
      var fromDisplay = personNameWithFather(row.display_name) || normalizeText(row.display_name);
      if (fromDisplay && fromDisplay.split(/\s+/).length >= 2) return fromDisplay;
      // Try tree_children path for اسم + أب
      if (row.tree_child_id) {
        var tr = await sb
          .from("tree_children")
          .select("child_name,name,parent_name,parent")
          .eq("id", row.tree_child_id)
          .limit(1);
        var trow = tr && Array.isArray(tr.data) ? tr.data[0] : null;
        if (trow) {
          var child = normalizeText(trow.child_name || trow.name || "");
          var parent = normalizeText(trow.parent_name || trow.parent || "");
          var childFirst = personNameWithFather(child).split(/\s+/)[0] || child.split(/\s+/)[0];
          var parentFirst = personNameWithFather(parent).split(/\s+/)[0] || parent.split(/\s+/).filter(function (w) {
            return ["بن", "ابن", "بنت"].indexOf(w) < 0;
          })[0];
          // If child path includes parent: use personNameWithFather on full path
          if (child.indexOf("/") >= 0) {
            var viaPath = personNameWithFather(child);
            if (viaPath) return viaPath;
          }
          if (childFirst && parentFirst) return normalizeText(childFirst + " " + parentFirst);
        }
      }
      return fromDisplay || fb;
    } catch (e) {
      return fb;
    }
  }

  /** صياغة للمستلم: ترقيتك / تخرجك / حالتك الصحية … (كل الأنواع مثل ترقية مزيد) */
  function yourOccasionPhrase(type) {
    var t = normalizeText(type).toLowerCase();
    if (t === "promotion_notice" || t === "promotion") return "ترقيتك";
    if (t === "graduation_notice" || t === "graduation") return "تخرجك";
    if (t === "retirement_notice" || t === "retirement") return "تقاعدك";
    if (t === "marriage" || t === "wedding" || t === "contract") return "زواجك";
    if (t === "birth" || t === "aqiqa") return "مولودكم";
    if (t === "new_house") return "منزلك الجديد";
    if (t === "success") return "نجاحك";
    if (t === "achievement") return "إنجازك";
    if (t === "appointment") return "تعيينك";
    if (t === "certification") return "شهادتك";
    if (t === "family_news") return "خبرك";
    if (["sick", "operation", "healing", "discharge", "safety"].indexOf(t) >= 0) {
      return "حالتك الصحية";
    }
    if (t === "death" || t === "condolence") return "مناسبة العزاء";
    if (["feast", "gathering", "family_meetup", "dinner", "lunch", "general"].indexOf(t) >= 0) {
      return "دعوتك";
    }
    var ar = occasionTypeArabic(type);
    return ar ? ar + "ك" : "مناسبتك";
  }

  function trackTitle(track) {
    var t = normalizeText(track).toLowerCase();
    if (t === "deceased") return "دعاء للمتوفى";
    if (t === "bereaved") return "مواساة أهل الفقيد";
    return "";
  }

  function ctaTitleForType(type, person) {
    var family = eventFamilyFromType(type);
    var name = personNameWithFather(person) || "صاحب المناسبة";
    if (family === "health") return "شارك في الدعاء لـ " + name;
    if (family === "death") return "شارك الدعاء والمواساة";
    if (family === "occasion") {
      var t = normalizeText(type).toLowerCase();
      if (["feast", "gathering", "family_meetup", "dinner", "lunch", "general"].indexOf(t) >= 0) {
        return "رد على دعوة " + name;
      }
    }
    return "شارك " + name + " فرحته";
  }

  async function fetchCatalog(eventType) {
    var sb = getSb();
    if (!sb) return [];
    var family = eventFamilyFromType(eventType);
    var typeKey = normalizeText(eventType).toLowerCase();
    try {
      var res = await sb.rpc("occasion_interaction_catalog_v1", {
        p_event_type: eventType || "",
        p_family: family,
      });
      if (!res.error) {
        var data = res.data;
        if (typeof data === "string") {
          try {
            data = JSON.parse(data);
          } catch (e) {
            data = [];
          }
        }
        if (Array.isArray(data) && data.length) return data;
      } else {
        console.warn("[occasion-interactions] catalog rpc", res.error);
      }
    } catch (e) {
      console.warn("[occasion-interactions] catalog rpc throw", e);
    }
    // Fallback: public SELECT on catalog table
    try {
      var q = await sb
        .from("occasion_interaction_types")
        .select("key,family,applies_to_types,track,label,full_text,allows_message,sort_order")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      if (q.error || !Array.isArray(q.data)) return [];
      return q.data.filter(function (row) {
        var types = row.applies_to_types || [];
        if (Array.isArray(types) && types.length) {
          return types.indexOf(typeKey) >= 0;
        }
        return normalizeText(row.family).toLowerCase() === family;
      });
    } catch (e2) {
      console.warn("[occasion-interactions] catalog fallback", e2);
      return [];
    }
  }

  async function fetchMyInteraction(occasionId, phone) {
    var sb = getSb();
    if (!sb || !occasionId || !phone) return null;
    var res = await sb.rpc("occasion_my_interaction_v1", {
      p_occasion_id: occasionId,
      p_sender_phone: phone,
    });
    if (res.error) return null;
    var data = res.data || {};
    return data.interaction || null;
  }

  async function submitInteraction(opts) {
    var sb = getSb();
    if (!sb) return { ok: false, error: "no_client" };
    var phone = normalizeText(opts && opts.senderPhone) || readMemberPhone();
    if (!phone) return { ok: false, error: "need_phone" };
    var senderName = await resolveSenderDisplayName(phone, opts && opts.senderName);
    var res = await sb.rpc("occasion_interaction_submit_v1", {
      p_occasion_id: Number(opts.occasionId),
      p_interaction_type_key: normalizeText(opts.interactionTypeKey),
      p_sender_phone: phone,
      p_sender_name: senderName || null,
      p_message: normalizeText(opts.message) || null,
      p_recipient_id: opts.recipientId != null ? Number(opts.recipientId) : null,
    });
    if (res.error) {
      return { ok: false, error: res.error.message || "submit_failed" };
    }
    var data = res.data || {};
    return data.ok === false ? { ok: false, error: data.error || "submit_failed" } : { ok: true, data: data };
  }

  async function fetchInbox(phone) {
    var sb = getSb();
    var p = normalizeText(phone) || readMemberPhone();
    if (!sb || !p) return { ok: false, items: [] };
    var res = await sb.rpc("occasion_inbox_for_phone_v1", { p_phone: p });
    if (res.error) {
      console.warn("[occasion-interactions] inbox", res.error);
      return { ok: false, items: [] };
    }
    var data = res.data || {};
    var items = data.items;
    if (typeof items === "string") {
      try {
        items = JSON.parse(items);
      } catch (e) {
        items = [];
      }
    }
    return { ok: !!data.ok, items: Array.isArray(items) ? items : [] };
  }

  function escapeHtml(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function mountOnEventCard(hostEl, row) {
    if (!hostEl || !row || !row.id) return null;
    var existing = hostEl.querySelector("[data-oi-root]");
    if (existing) {
      // Remount if previous attempt hid itself (no client / empty catalog).
      if (existing.getAttribute("data-oi-ready") === "1") return existing;
      try {
        existing.remove();
      } catch (e) {}
    }

    var root = document.createElement("div");
    root.className = "oi-panel";
    root.setAttribute("data-oi-root", "1");
    root.setAttribute("data-occasion-id", String(row.id));
    root.style.display = "none";

    var title = document.createElement("div");
    title.className = "oi-title";
    title.textContent = ctaTitleForType(row.type, row.person);
    root.appendChild(title);

    var hint = document.createElement("div");
    hint.className = "oi-hint";
    hint.textContent = "تفاعل خاص — لا يظهر للعامة";
    root.appendChild(hint);

    var actions = document.createElement("div");
    actions.className = "oi-actions";
    root.appendChild(actions);

    var status = document.createElement("div");
    status.className = "oi-status";
    root.appendChild(status);

    var msgWrap = document.createElement("div");
    msgWrap.className = "oi-message-wrap";
    msgWrap.style.display = "none";
    msgWrap.innerHTML =
      '<textarea class="oi-message" rows="2" maxlength="500" placeholder="اكتب رسالتك الخاصة…"></textarea>' +
      '<button type="button" class="btn btn-primary btn-small oi-send-msg">إرسال</button>';
    root.appendChild(msgWrap);

    hostEl.appendChild(root);

    var selectedKey = null;
    var catalog = [];

    function setStatus(text, ok) {
      status.textContent = text || "";
      status.className = "oi-status" + (ok === true ? " oi-ok" : ok === false ? " oi-err" : "");
    }

    async function doSubmit(key, message) {
      var phone = readMemberPhone();
      if (!phone) {
        setStatus("سجّل جوالك من ملف العضو أولًا لإرسال التفاعل.", false);
        return;
      }
      setStatus("جاري الإرسال…");
      var res = await submitInteraction({
        occasionId: row.id,
        interactionTypeKey: key,
        senderPhone: phone,
        message: message || "",
      });
      if (!res.ok) {
        setStatus(
          res.error === "need_phone"
            ? "سجّل جوالك من ملف العضو أولًا."
            : "تعذر الإرسال، حاول لاحقًا.",
          false,
        );
        return;
      }
      selectedKey = key;
      msgWrap.style.display = "none";
      setStatus("وصل تفاعلك لصاحب المناسبة بخصوصية تامة 💚", true);
      renderButtons();
    }

    function renderButtons() {
      actions.innerHTML = "";
      var groups = {};
      var order = [];
      catalog.forEach(function (item) {
        var tr = normalizeText(item.track).toLowerCase() || "_";
        if (!groups[tr]) {
          groups[tr] = [];
          order.push(tr);
        }
        groups[tr].push(item);
      });
      // Death: deceased then bereaved first
      order.sort(function (a, b) {
        var rank = function (x) {
          if (x === "deceased") return 1;
          if (x === "bereaved") return 2;
          if (x === "_") return 9;
          return 5;
        };
        return rank(a) - rank(b);
      });
      var showTrackHeaders = order.filter(function (t) {
        return t !== "_";
      }).length >= 1 && order.length > 1;

      order.forEach(function (tr) {
        if (showTrackHeaders) {
          var title = trackTitle(tr);
          if (title) {
            var lab = document.createElement("div");
            lab.className = "oi-track-label";
            lab.textContent = title;
            actions.appendChild(lab);
          }
        }
        var wrap = document.createElement("div");
        wrap.className = "oi-track-chips";
        groups[tr].forEach(function (item) {
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className =
            "oi-chip" + (selectedKey && selectedKey === item.key ? " oi-chip-active" : "");
          btn.textContent = item.label || item.full_text || item.key;
          btn.addEventListener("click", function () {
            if (item.allows_message) {
              selectedKey = item.key;
              msgWrap.style.display = "";
              setStatus("اكتب رسالتك ثم اضغط إرسال.");
              renderButtons();
              return;
            }
            doSubmit(item.key, "");
          });
          wrap.appendChild(btn);
        });
        actions.appendChild(wrap);
      });
    }

    msgWrap.querySelector(".oi-send-msg").addEventListener("click", function () {
      var ta = msgWrap.querySelector(".oi-message");
      var msg = ta ? ta.value : "";
      if (!selectedKey) return;
      doSubmit(selectedKey, msg);
    });

    (async function init() {
      catalog = await fetchCatalog(row.type);
      if (!catalog.length) {
        try {
          root.remove();
        } catch (e) {}
        return;
      }
      root.style.display = "";
      root.setAttribute("data-oi-ready", "1");
      var mine = await fetchMyInteraction(row.id, readMemberPhone());
      if (mine && mine.interaction_type_key) {
        selectedKey = mine.interaction_type_key;
        setStatus("سبق أن شاركت في هذه المناسبة.", true);
      }
      renderButtons();
    })();

    return root;
  }

  function enhanceEventLists() {
    var lists = document.querySelectorAll("#events .events-list, .events-list");
    lists.forEach(function (list) {
      list.querySelectorAll(".event-item").forEach(function (item) {
        var ready = item.querySelector("[data-oi-root][data-oi-ready='1']");
        if (ready) return;
        var id =
          item.getAttribute("data-event-id") ||
          (item.dataset && (item.dataset.eventId || item.dataset.id)) ||
          "";
        if (!id) return;
        var type =
          item.getAttribute("data-event-type") ||
          (item.dataset && item.dataset.eventType) ||
          "";
        var person =
          item.getAttribute("data-event-person") ||
          (item.dataset && item.dataset.eventPerson) ||
          "";
        var body = item.querySelector(".event-body") || item;
        mountOnEventCard(body, {
          id: Number(id),
          type: type,
          person: person,
        });
      });
    });
  }

  /** Call after events render with raw rows */
  function attachToRenderedEvents(rows) {
    var byId = {};
    (rows || []).forEach(function (r) {
      if (r && r.id != null) byId[String(r.id)] = r;
    });
    document.querySelectorAll(".event-item").forEach(function (item) {
      var id =
        item.getAttribute("data-event-id") ||
        (item.dataset && item.dataset.eventId) ||
        "";
      if (!id || !byId[String(id)]) return;
      if (item.querySelector("[data-oi-root]")) return;
      var body = item.querySelector(".event-body") || item;
      mountOnEventCard(body, byId[String(id)]);
    });
  }


  function messageCountLabel(n) {
    var c = Number(n) || 0;
    if (c <= 0) return "لا رسائل";
    if (c === 1) return "رسالة واحدة";
    if (c === 2) return "رسالتان";
    if (c >= 3 && c <= 10) return String(c) + " رسائل";
    return String(c) + " رسالة";
  }

  function setInboxSectionCount(total) {
    var el = document.getElementById("oi-inbox-count");
    if (!el) return;
    var c = Number(total) || 0;
    if (c <= 0) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = messageCountLabel(c);
  }

  function wireInboxCollapse(container) {
    if (!container || container.getAttribute("data-oi-collapse-wired") === "1") return;
    container.setAttribute("data-oi-collapse-wired", "1");
    container.addEventListener("click", function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest("[data-oi-toggle]") : null;
      if (!btn || !container.contains(btn)) return;
      var card = btn.closest(".oi-inbox-card");
      if (!card) return;
      var open = !card.classList.contains("is-open");
      card.classList.toggle("is-open", open);
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
    var touchY = null;
    container.addEventListener(
      "touchstart",
      function (ev) {
        var btn = ev.target && ev.target.closest ? ev.target.closest("[data-oi-toggle]") : null;
        if (!btn || !container.contains(btn)) {
          touchY = null;
          return;
        }
        touchY = ev.changedTouches && ev.changedTouches[0] ? ev.changedTouches[0].clientY : null;
      },
      { passive: true }
    );
    container.addEventListener(
      "touchend",
      function (ev) {
        if (touchY == null) return;
        var btn = ev.target && ev.target.closest ? ev.target.closest("[data-oi-toggle]") : null;
        if (!btn || !container.contains(btn)) {
          touchY = null;
          return;
        }
        var y = ev.changedTouches && ev.changedTouches[0] ? ev.changedTouches[0].clientY : touchY;
        var dy = y - touchY;
        touchY = null;
        if (Math.abs(dy) < 28) return;
        var card = btn.closest(".oi-inbox-card");
        if (!card) return;
        var open = dy > 0;
        card.classList.toggle("is-open", open);
        btn.setAttribute("aria-expanded", open ? "true" : "false");
      },
      { passive: true }
    );
  }

  function renderInboxInto(container, phone) {
    if (!container) return;
    container.innerHTML = '<div class="hint">جاري تحميل رسائلك…</div>';
    setInboxSectionCount(0);
    fetchInbox(phone).then(function (res) {
      var items = res.items || [];
      if (!items.length) {
        container.innerHTML =
          '<div class="hint">لا رسائل خاصة بعد. عندما يشاركك أحد مناسبة تخصك، ستظهر هنا فقط لك.</div>';
        setInboxSectionCount(0);
        return;
      }

      var grandTotal = 0;
      var html = items
        .map(function (it) {
          var total = Number(it.total || 0);
          var msgs = Array.isArray(it.messages) ? it.messages : [];
          var visibleMsgs = msgs
            .slice(0, 12)
            .map(function (m) {
              var sender =
                personNameWithFather(m.sender_name) ||
                normalizeText(m.sender_name) ||
                "فرد من العائلة";
              var text =
                normalizeText(m.message || "") ||
                normalizeText(m.full_text || m.label || "");
              if (!text) return null;
              return { sender: sender, text: text };
            })
            .filter(Boolean);
          var msgCount = visibleMsgs.length || total || 0;
          grandTotal += msgCount;

          var yours = escapeHtml(yourOccasionPhrase(it.occasion_type));
          var whoLabel =
            total <= 1
              ? "فرد من العائلة"
              : escapeHtml(String(total)) + " من أفراد العائلة";
          var verb = total <= 1 ? "شاركك" : "شاركوك";

          var labelCounts = {};
          msgs.forEach(function (m) {
            var lab = normalizeText(m.label || m.full_text || "");
            if (!lab) return;
            labelCounts[lab] = (labelCounts[lab] || 0) + 1;
          });
          var distinct = Object.keys(labelCounts);
          var showSummary = total >= 3 && distinct.length >= 2;
          var counts = showSummary
            ? distinct
                .map(function (lab) {
                  return (
                    escapeHtml(String(labelCounts[lab])) +
                    " «" +
                    escapeHtml(lab) +
                    "»"
                  );
                })
                .join(" · ")
            : "";

          var preview =
            visibleMsgs.length > 0
              ? escapeHtml(visibleMsgs[0].sender)
              : "اضغط لعرض الرسائل";

          var msgHtml = visibleMsgs
            .map(function (m) {
              return (
                '<div class="oi-inbox-msg">' +
                '<span class="oi-inbox-sender">' +
                escapeHtml(m.sender) +
                "</span>" +
                '<span class="oi-inbox-sep" aria-hidden="true">·</span>' +
                '<span class="oi-inbox-text">' +
                escapeHtml(m.text) +
                "</span>" +
                "</div>"
              );
            })
            .join("");

          return (
            '<article class="oi-inbox-card">' +
            '<button type="button" class="oi-inbox-toggle" data-oi-toggle aria-expanded="false">' +
            '<div class="oi-inbox-top">' +
            '<span class="oi-inbox-badge">' +
            whoLabel +
            "</span>" +
            '<p class="oi-inbox-line">' +
            '<span class="oi-inbox-verb">' +
            verb +
            "</span> " +
            '<strong class="oi-inbox-occasion">' +
            yours +
            "</strong>" +
            "</p>" +
            "</div>" +
            '<div class="oi-inbox-meta">' +
            '<span class="oi-inbox-preview">' +
            preview +
            "</span>" +
            '<span class="oi-inbox-chip">' +
            escapeHtml(messageCountLabel(msgCount)) +
            "</span>" +
            '<span class="oi-inbox-chevron" aria-hidden="true"></span>' +
            "</div>" +
            "</button>" +
            '<div class="oi-inbox-body">' +
            (counts ? '<div class="oi-inbox-summary">' + counts + "</div>" : "") +
            '<div class="oi-inbox-msgs">' +
            msgHtml +
            "</div>" +
            "</div>" +
            "</article>"
          );
        })
        .join("");

      setInboxSectionCount(grandTotal);
      container.innerHTML = html;
      container.removeAttribute("data-oi-collapse-wired");
      wireInboxCollapse(container);
    });
  }

  root.AlzidanOccasionInteractions = {
    fetchCatalog: fetchCatalog,
    fetchMyInteraction: fetchMyInteraction,
    submitInteraction: submitInteraction,
    fetchInbox: fetchInbox,
    mountOnEventCard: mountOnEventCard,
    attachToRenderedEvents: attachToRenderedEvents,
    enhanceEventLists: enhanceEventLists,
    renderInboxInto: renderInboxInto,
    ctaTitleForType: ctaTitleForType,
    yourOccasionPhrase: yourOccasionPhrase,
    eventFamilyFromType: eventFamilyFromType,
    readMemberPhone: readMemberPhone,
  };
})(typeof window !== "undefined" ? window : globalThis);
