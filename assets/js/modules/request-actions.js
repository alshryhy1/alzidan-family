(() => {
  "use strict";

  const Core = window.AlzidanAdminCore || {};
  const {
    showAlert,
    getClient,
    getAdminToken,
    formatDateTimeArSaVerbose,
    coerceRpcId,
    isLikelyEmail,
    normalizeEmail,
  } = Core;

  let reloadRequests = async function () {};
  const treeCardEditDialog = document.getElementById("tree-card-edit-dialog");
  const treeCardEditForm = document.getElementById("tree-card-edit-form");
  const treeCardEditError = document.getElementById("tree-card-edit-error");
  const treeCardRelations = document.getElementById("tree-card-relations");
  const treeCardAddRelation = document.getElementById("tree-card-add-relation");
  const treeCardEditCancel = document.getElementById("tree-card-edit-cancel");

  let treeCardEditRow = null;


  function setReloadRequests(fn) {
    if (typeof fn === "function") reloadRequests = fn;
  }

  function normalizeTreeCardText(v) {
    return String(v || "")
      .replace(/\s+/g, " ")
      .trim();
  }
  function safeParseJsonTextLoose(v) {
    try {
      if (v == null) return null;
      const s = String(v || "").trim();
      if (!s) return null;
      return JSON.parse(s);
    } catch (e) {
      return null;
    }
  }
  function extractTreeCardPayloadFromMessage(msg) {
    const text = String(msg || "");
    const marker = "__JSON__:";
    const idx = text.indexOf(marker);
    if (idx < 0) return null;
    const jsonText = text.slice(idx + marker.length).trim();
    if (!jsonText) return null;
    const parsed = safeParseJsonTextLoose(jsonText);
    return parsed && typeof parsed === "object" ? parsed : null;
  }
  function updateBranchInRequestMessage(message, branchKey, kind) {
    const text = String(message || "");
    const branch = normalizeTreeCardText(branchKey);
    if (!text || !branch) return text;
    if (kind === "tree_card") {
      const marker = "__JSON__:";
      const idx = text.indexOf(marker);
      const visiblePart = idx >= 0 ? text.slice(0, idx).trimEnd() : text;
      const payload = extractTreeCardPayloadFromMessage(text);
      if (payload) {
        payload.branch_key = branch;
        const updatedVisible = /^العائلة \(إجباري\):.*$/m.test(visiblePart)
          ? visiblePart.replace(
              /^العائلة \(إجباري\):.*$/m,
              "العائلة (إجباري): " + branch,
            )
          : visiblePart;
        return (
          updatedVisible +
          "\n\n" +
          marker +
          "\n" +
          JSON.stringify(payload, null, 2)
        );
      }
    }
    if (/^الفرع:.*$/m.test(text)) {
      return text.replace(/^الفرع:.*$/m, "الفرع: " + branch);
    }
    return text;
  }
  function normalizeAdminPhone(v) {
    return String(v || "")
      .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632))
      .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 1776))
      .replace(/[^\d+]/g, "")
      .trim();
  }
  function extractRequestMediaLinks(message) {
    const media = { image: "", video: "" };
    String(message || "")
      .split(/\r?\n/)
      .forEach((rawLine) => {
        const line = rawLine.trim();
        const imageMatch = line.match(/^رابط الصورة\s*:\s*(https?:\/\/\S+)/i);
        const videoMatch = line.match(/^رابط الفيديو\s*:\s*(https?:\/\/\S+)/i);
        if (imageMatch && !media.image) media.image = imageMatch[1];
        if (videoMatch && !media.video) media.video = videoMatch[1];
      });
    return media;
  }
  function requestMessageWithoutMediaLinks(message) {
    const marker = "__JSON__:";
    const rawText = String(message || "");
    const markerIndex = rawText.indexOf(marker);
    const visibleText = markerIndex >= 0 ? rawText.slice(0, markerIndex) : rawText;

    return visibleText
      .split(/\r?\n/)
      .filter((rawLine) => {
        const line = String(rawLine || "").trim();
        if (/^رابط الصورة\s*:/i.test(line)) return false;
        if (/^رابط الفيديو\s*:/i.test(line)) return false;
        return true;
      })
      .join("\n")
      .trim();
  }
  function appendRequestMediaPreview(parent, message) {
    const media = extractRequestMediaLinks(message);
    if (!media.image && !media.video) return;
    const wrap = document.createElement("div");
    wrap.className = "request-media-preview";
    if (media.image) {
      const item = document.createElement("div");
      item.className = "request-media-item";
      const title = document.createElement("div");
      title.className = "request-media-title";
      title.textContent = "الصورة المرفقة";
      const img = document.createElement("img");
      img.alt = "الصورة المرفقة مع الطلب";
      img.loading = "lazy";
      img.src = media.image;
      const note = document.createElement("div");
      note.className = "request-media-note";
      note.textContent = "الصورة المرفقة مع الطلب.";
      item.appendChild(title);
      item.appendChild(img);
      item.appendChild(note);
      wrap.appendChild(item);
    }
    if (media.video) {
      const item = document.createElement("div");
      item.className = "request-media-item";
      const title = document.createElement("div");
      title.className = "request-media-title";
      title.textContent = "الفيديو المرفق";
      const video = document.createElement("video");
      video.controls = true;
      video.preload = "metadata";
      video.src = media.video;
      item.appendChild(title);
      item.appendChild(video);
      wrap.appendChild(item);
    }
    parent.appendChild(wrap);
  }
  function requestLineValue(message, labels) {
    const wanted = (Array.isArray(labels) ? labels : [labels]).map((label) =>
      String(label || "").trim(),
    );
    const lines = String(message || "").split(/\r?\n/);
    for (const rawLine of lines) {
      const line = String(rawLine || "").trim();
      for (const label of wanted) {
        const prefix = label + ":";
        if (line.startsWith(prefix)) return line.slice(prefix.length).trim();
      }
    }
    return "";
  }
  function parseJsonEnvelopeFromRequestMessage(message) {
    const marker = "__JSON__:";
    const text = String(message || "");
    const idx = text.indexOf(marker);
    if (idx < 0) return null;
    const raw = text.slice(idx + marker.length).trim();
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }
  function eventTypeFromLabel(label) {
    const s = normalizeTreeCardText(label || "");
    if (s === "مولود") return "birth";
    if (s === "زواج") return "marriage";
    if (s === "تخرج") return "graduation";
    if (s === "ترقية") return "promotion";
    if (s === "اجتماع") return "gathering";
    if (s === "مريض") return "sick";
    if (s === "وفاة") return "death";
    return "gathering";
  }
  function buildEventCardRow(row) {
    const requestId = String(
      row && row.request_id ? row.request_id : "",
    ).trim();
    const msg = String(row && row.message ? row.message : "");
    const envelope = parseJsonEnvelopeFromRequestMessage(msg);
    if (envelope && envelope.event && typeof envelope.event === "object") {
      const event = envelope.event;
      let details = {};
      if (typeof event.details === "string") {
        try {
          details = JSON.parse(event.details);
        } catch (e) {
          details = { text: event.details };
        }
      } else if (event.details && typeof event.details === "object") {
        details = event.details;
      }
      details.requestId = requestId;
      return {
        branch_key: normalizeTreeCardText(
          row.branch_key || event.branch_key || "",
        ),
        type: String(event.type || "gathering"),
        person: String(event.person || row.name || ""),
        date_label: String(event.date_label || ""),
        event_date: String(event.event_date || ""),
        details: JSON.stringify(details),
        hospital_name: String(event.hospital_name || ""),
        hospital_dept: String(event.hospital_dept || ""),
        contact_method: String(event.contact_method || ""),
        contact_phone: String(event.contact_phone || ""),
        visit_date_from: String(event.visit_date_from || ""),
        visit_date_to: String(event.visit_date_to || ""),
        visit_time_from: String(event.visit_time_from || ""),
        visit_time_to: String(event.visit_time_to || ""),
        created_at: String(
          event.created_at || row.created_at || new Date().toISOString(),
        ),
      };
    }
    const media = extractRequestMediaLinks(msg);
    const typeLabel = requestLineValue(msg, ["نوع المناسبة", "النوع"]);
    const text = requestLineValue(msg, ["النص"]);
    const details = {
      v: 1,
      kind: "happy_notice",
      requestId,
      text,
      imageUrl: media.image,
      videoUrl: media.video,
      showDays: 7,
    };
    return {
      branch_key: normalizeTreeCardText(
        row.branch_key || requestLineValue(msg, "الفرع"),
      ),
      type: eventTypeFromLabel(typeLabel),
      person:
        requestLineValue(msg, ["اسم صاحب المناسبة", "صاحب المناسبة"]) ||
        String(row.name || ""),
      date_label: requestLineValue(msg, "التاريخ"),
      event_date: "",
      details: JSON.stringify(details),
      hospital_name: "",
      hospital_dept: "",
      contact_method: "",
      contact_phone: String(row.phone || ""),
      visit_date_from: "",
      visit_date_to: "",
      visit_time_from: "",
      visit_time_to: "",
      created_at: String(row.created_at || new Date().toISOString()),
    };
  }
  async function publishEventCardRequest(sb, token, row) {
    const requestId = String(
      row && row.request_id ? row.request_id : "",
    ).trim();
    if (!requestId) return { ok: false, message: "رقم الطلب ناقص." };
    const eventRow = buildEventCardRow(row);
    if (!eventRow.branch_key || !eventRow.type || !eventRow.person) {
      return {
        ok: false,
        message:
          "بيانات المناسبة ناقصة، افتح عرض الطلب وتأكد من الفرع والنوع والاسم.",
      };
    }
    const { data, error } = await sb.rpc("admin_publish_event_card_v1", {
      p_token: token,
      p_request_id: requestId,
      p_row: eventRow,
    });
    if (error) {
      const msg = String(error.message || "");
      if (msg.includes("تعذر تنفيذ العملية") || msg.includes("تحديث الخدمة")) {
        return {
          ok: false,
          needsSql: true,
          message: "تعذر نشر المناسبة حالياً، حاول لاحقاً أو تواصل مع الإدارة.",
        };
      }
      return {
        ok: false,
        message: "تعذر نشر المناسبة حالياً، حاول لاحقاً أو تواصل مع الإدارة.",
      };
    }
    if (data !== true)
      return {
        ok: false,
        message: "تعذر نشر المناسبة. تحقق من صلاحية الإدارة.",
      };
    return { ok: true };
  }
  function buildTreeCardMessageFromPayload(payload, reqRow) {
    const ancestors = Array.isArray(payload.ancestors) ? payload.ancestors : [];
    const children = Array.isArray(payload.children) ? payload.children : [];
    const submitter = payload.submitter || {};
    const lines = [
      "بطاقة إضافة بيانات للشجرة",
      "",
      "رقم الطلب: " + String(reqRow.request_id || ""),
      "العائلة (إجباري): " + String(payload.branch_key || ""),
    ];
    const lineagePath = Array.isArray(payload.lineage_path)
      ? payload.lineage_path
      : [];
    const treeRows = Array.isArray(payload.tree_rows) ? payload.tree_rows : [];
    if (treeRows.length) {
      lines.push("العلاقات العائلية:");
      treeRows.forEach((relation, idx) => {
        lines.push(
          String(idx + 1) +
            "- " +
            relationPathLabel(relation.parent_name) +
            " ← " +
            relationLeafName(relation.child_name) +
            (relation.birth_date_g ? " — " + relation.birth_date_g : ""),
        );
      });
    } else if (lineagePath.length) {
      lines.push("مسار النسب من الأكبر إلى الأصغر:");
      lineagePath.forEach((name, idx) =>
        lines.push(String(idx + 1) + "- " + name),
      );
    } else {
      lines.push("سلسلة الأجداد:");
      ancestors.forEach((name, idx) =>
        lines.push("الجد " + String(idx + 1) + ": " + name),
      );
    }
    lines.push("الأب (إجباري): " + String(payload.father || ""));
    lines.push("الاسم (إجباري): " + String(payload.name || ""));
    lines.push(
      "تاريخ الميلاد (اختياري): " + String(payload.birth_date_g || ""),
    );
    lines.push("المدينة (اختياري): " + String(payload.city || ""));
    lines.push("الحي/القرية (اختياري): " + String(payload.area || ""));
    lines.push("", "الأبناء (اختياري):");
    if (children.length) {
      children.forEach((child, idx) => {
        lines.push(
          String(idx + 1) +
            "- الاسم: " +
            child.name +
            " — تاريخ الميلاد: " +
            String(child.dob || ""),
        );
      });
    } else {
      lines.push("(لا يوجد)");
    }
    lines.push("", "بيانات المرسل (إجباري):");
    lines.push("الاسم: " + String(submitter.name || ""));
    lines.push("الجوال: " + String(submitter.phone || ""));
    lines.push("البريد (اختياري): " + String(submitter.email || ""));
    lines.push(
      "التاريخ: " +
        formatDateTimeArSaVerbose(
          payload.created_at || reqRow.created_at || new Date().toISOString(),
        ),
    );
    lines.push("", "__JSON__:", JSON.stringify(payload, null, 2));
    return lines.join("\n");
  }
  function parseEditedChildren(text) {
    const children = [];
    const lines = String(text || "").split(/\r?\n/);
    for (const raw of lines) {
      const line = normalizeTreeCardText(raw);
      if (!line) continue;
      const parts = line.split("|");
      const name = normalizeTreeCardText(parts[0] || "");
      const dob = normalizeTreeCardText(parts.slice(1).join("|") || "");
      if (!name) continue;
      children.push({ name, dob });
    }
    return children;
  }
  function showTreeCardEditError(text) {
    if (!treeCardEditError) return;
    treeCardEditError.textContent = String(text || "");
    treeCardEditError.style.display = text ? "block" : "none";
  }
  function relationLeafName(path) {
    const parts = String(path || "")
      .split("/")
      .map(normalizeTreeCardText)
      .filter(Boolean);
    return parts.length ? parts[parts.length - 1] : "";
  }
  function relationPathLabel(path) {
    return String(path || "")
      .split("/")
      .map(normalizeTreeCardText)
      .filter(Boolean)
      .join(" ← ");
  }
  function getRelationCards() {
    return treeCardRelations
      ? Array.from(treeCardRelations.querySelectorAll(".relation-card"))
      : [];
  }
  function getRelationParentPaths() {
    const branch = normalizeTreeCardText(
      treeCardEditForm && treeCardEditForm.elements.branch
        ? treeCardEditForm.elements.branch.value
        : "",
    );
    const root = branch ? branch + " بن مطلق بن زيدان" : "";
    const paths = new Set(root ? [root] : []);
    getRelationCards().forEach((card) => {
      const parent = normalizeTreeCardText(
        card.querySelector('[name="relationParent"]')?.value || "",
      );
      const childName = normalizeTreeCardText(
        card.querySelector('[name="relationChild"]')?.value || "",
      );
      if (parent) paths.add(parent);
      if (parent && childName) paths.add(parent + "/" + childName);
    });
    return Array.from(paths);
  }
  function refreshRelationParentOptions() {
    const paths = getRelationParentPaths();
    getRelationCards().forEach((card) => {
      const select = card.querySelector('[name="relationParent"]');
      if (!select) return;
      const current = normalizeTreeCardText(
        select.dataset.value || select.value || "",
      );
      select.innerHTML = "";
      paths.forEach((path) => {
        const option = document.createElement("option");
        option.value = path;
        option.textContent = relationPathLabel(path);
        select.appendChild(option);
      });
      if (current && !paths.includes(current)) {
        const option = document.createElement("option");
        option.value = current;
        option.textContent = relationPathLabel(current);
        select.appendChild(option);
      }
      select.value = current || paths[0] || "";
      delete select.dataset.value;
    });
  }
  function addRelationCard(relation) {
    if (!treeCardRelations) return;
    const card = document.createElement("div");
    card.className = "relation-card";
    card.innerHTML = `<div class="relation-fields"><div class="field"><label>الأب</label><select name="relationParent"></select></div><div class="field"><label>اسم الابن/الابنة</label><input name="relationChild" type="text" readonly /></div><div class="field"><label>تاريخ الميلاد</label><input name="relationDob" type="date" /></div></div><div class="relation-actions"><button class="btn btn-primary btn-sm" type="button" data-add-child-relation>إضافة أبناء</button><button class="btn btn-outline btn-sm" type="button" data-edit-relation>تعديل الاسم</button><button class="btn btn-outline btn-sm" type="button" data-remove-relation>حذف الشخص</button></div>`;
    const select = card.querySelector('[name="relationParent"]');
    const child = card.querySelector('[name="relationChild"]');
    const dob = card.querySelector('[name="relationDob"]');
    const initialChildName = normalizeTreeCardText(
      relation && relation.child_name
        ? relationLeafName(relation.child_name)
        : "",
    );
    if (select)
      select.dataset.value = normalizeTreeCardText(
        relation && relation.parent_name ? relation.parent_name : "",
      );
    if (child) {
      child.value = initialChildName;
      child.readOnly = !!initialChildName;
      if (!initialChildName) {
        child.placeholder = "اكتب اسم الابن/الابنة";
        child.addEventListener("input", refreshRelationParentOptions);
      }
    }
    if (dob)
      dob.value = normalizeTreeCardText(
        relation && relation.birth_date_g ? relation.birth_date_g : "",
      );
    const addChild = card.querySelector("[data-add-child-relation]");
    if (addChild) {
      addChild.addEventListener("click", () => {
        const parent = normalizeTreeCardText(select ? select.value : "");
        const childName = normalizeTreeCardText(child ? child.value : "");
        if (!parent || !childName) {
          showTreeCardEditError("اكتب اسم الشخص أولًا ثم أضف أبناءه.");
          return;
        }
        const newChildName = normalizeTreeCardText(
          window.prompt("اكتب اسم الابن/الابنة:", "") || "",
        );
        if (!newChildName) return;
        showTreeCardEditError("");
        addRelationCard({
          parent_name: parent + "/" + childName,
          child_name: parent + "/" + childName + "/" + newChildName,
        });
      });
    }
    const edit = card.querySelector("[data-edit-relation]");
    if (edit) {
      edit.addEventListener("click", () => {
        const oldName = normalizeTreeCardText(child ? child.value : "");
        const newName = normalizeTreeCardText(
          window.prompt("اكتب الاسم الصحيح:", oldName) || "",
        );
        if (!newName || newName === oldName) return;
        const parent = normalizeTreeCardText(select ? select.value : "");
        const oldPath = parent && oldName ? parent + "/" + oldName : "";
        const newPath = parent + "/" + newName;
        if (child) child.value = newName;
        getRelationCards().forEach((otherCard) => {
          const otherSelect = otherCard.querySelector(
            '[name="relationParent"]',
          );
          if (!otherSelect || !oldPath) return;
          const current = normalizeTreeCardText(
            otherSelect.value || otherSelect.dataset.value || "",
          );
          if (current === oldPath || current.startsWith(oldPath + "/")) {
            otherSelect.dataset.value = newPath + current.slice(oldPath.length);
          }
        });
        refreshRelationParentOptions();
      });
    }
    const remove = card.querySelector("[data-remove-relation]");
    if (remove) {
      remove.addEventListener("click", () => {
        const parent = normalizeTreeCardText(select ? select.value : "");
        const childName = normalizeTreeCardText(child ? child.value : "");
        const removedPath = parent && childName ? parent + "/" + childName : "";
        if (removedPath) {
          getRelationCards().forEach((otherCard) => {
            if (otherCard === card) return;
            const otherParent = normalizeTreeCardText(
              otherCard.querySelector('[name="relationParent"]')?.value || "",
            );
            if (
              otherParent === removedPath ||
              otherParent.startsWith(removedPath + "/")
            )
              otherCard.remove();
          });
        }
        card.remove();
        refreshRelationParentOptions();
      });
    }
    treeCardRelations.appendChild(card);
    refreshRelationParentOptions();
  }
  function collectRelationRows(branch) {
    const rows = [];
    const seen = new Set();
    for (const card of getRelationCards()) {
      const parent = normalizeTreeCardText(
        card.querySelector('[name="relationParent"]')?.value || "",
      );
      const childName = normalizeTreeCardText(
        card.querySelector('[name="relationChild"]')?.value || "",
      );
      const dob = normalizeTreeCardText(
        card.querySelector('[name="relationDob"]')?.value || "",
      );
      if (!parent && !childName) continue;
      if (!parent || !childName)
        return {
          ok: false,
          message: "كل علاقة تحتاج اختيار الأب وكتابة اسم الابن/الابنة.",
          rows: [],
        };
      const child = parent + "/" + childName;
      const key = parent + "|" + child;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        branch_key: branch,
        parent_name: parent,
        child_name: child,
        birth_date_g: dob || "",
      });
    }
    if (!rows.length)
      return {
        ok: false,
        message: "أضف علاقة عائلية واحدة على الأقل.",
        rows: [],
      };
    return { ok: true, rows };
  }
  function normalizeKnownLahmSalehRows(rows, branch) {
    const source = Array.isArray(rows) ? rows : [];
    if (normalizeTreeCardText(branch) !== "لاحم") return source;
    const root = "لاحم بن مطلق بن زيدان";
    const badPrefixes = [
      root + "/صالح سليمان عواد",
      root + "/عواد سليمان صالح",
      root + "/صالح/عواد",
    ];
    const hasBadPath = source.some((item) => {
      const parent = normalizeTreeCardText(
        item && item.parent_name ? item.parent_name : "",
      );
      const child = normalizeTreeCardText(
        item && item.child_name ? item.child_name : "",
      );
      const leaf = relationLeafName(child);
      const isDirectBadAwwad = parent === root + "/صالح" && leaf === "عواد";
      const isBadAwwadSon =
        (parent === "عواد" || parent === root + "/صالح/عواد") &&
        leaf === "سليمان";
      const isBadNaif =
        (parent === "سليمان" || parent === root + "/صالح/سليمان") &&
        leaf === "نايف";
      return (
        isDirectBadAwwad ||
        isBadAwwadSon ||
        isBadNaif ||
        badPrefixes.some(
          (prefix) =>
            parent === prefix ||
            parent.startsWith(prefix + "/") ||
            child === prefix ||
            child.startsWith(prefix + "/"),
        )
      );
    });
    if (!hasBadPath) return source;
    const canonicalAwwad = root + "/صالح/سليمان/عواد";
    const fixed = source
      .filter((item) => {
        const child = normalizeTreeCardText(
          item && item.child_name ? item.child_name : "",
        );
        return !badPrefixes.includes(child);
      })
      .map((item) => {
        let parent = normalizeTreeCardText(
          item && item.parent_name ? item.parent_name : "",
        );
        let child = normalizeTreeCardText(
          item && item.child_name ? item.child_name : "",
        );
        const leaf = relationLeafName(child);
        if (parent === root + "/صالح" && leaf === "عواد") {
          parent = root + "/صالح/سليمان";
          child = canonicalAwwad;
        } else if (
          (parent === "عواد" || parent === root + "/صالح/عواد") &&
          leaf === "سليمان"
        ) {
          parent = canonicalAwwad;
          child = canonicalAwwad + "/سليمان";
        } else if (
          (parent === "سليمان" || parent === root + "/صالح/سليمان") &&
          leaf === "نايف"
        ) {
          parent = canonicalAwwad + "/سليمان";
          child = canonicalAwwad + "/سليمان/نايف";
        }
        badPrefixes.forEach((prefix) => {
          if (parent === prefix || parent.startsWith(prefix + "/"))
            parent = canonicalAwwad + parent.slice(prefix.length);
          if (child === prefix || child.startsWith(prefix + "/"))
            child = canonicalAwwad + child.slice(prefix.length);
        });
        return {
          ...(item || {}),
          branch_key: "لاحم",
          parent_name: parent,
          child_name: child,
        };
      });
    const required = [
      { branch_key: "لاحم", parent_name: root, child_name: root + "/صالح" },
      {
        branch_key: "لاحم",
        parent_name: root + "/صالح",
        child_name: root + "/صالح/سليمان",
      },
      {
        branch_key: "لاحم",
        parent_name: root + "/صالح/سليمان",
        child_name: canonicalAwwad,
      },
      {
        branch_key: "لاحم",
        parent_name: canonicalAwwad,
        child_name: canonicalAwwad + "/سليمان",
      },
      {
        branch_key: "لاحم",
        parent_name: canonicalAwwad + "/سليمان",
        child_name: canonicalAwwad + "/سليمان/نايف",
      },
    ];
    const seen = new Set();
    return required.concat(fixed).filter((item) => {
      const parent = normalizeTreeCardText(
        item && item.parent_name ? item.parent_name : "",
      );
      const child = normalizeTreeCardText(
        item && item.child_name ? item.child_name : "",
      );
      const key = parent + "|" + child;
      if (!parent || !child || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  function openTreeCardEditor(row) {
    const payload = extractTreeCardPayloadFromMessage(
      row && row.message ? row.message : "",
    );
    if (!payload || !treeCardEditForm || !treeCardEditDialog) {
      showAlert("error", "تعذر قراءة تفاصيل بطاقة الشجرة.");
      return;
    }
    treeCardEditRow = row;
    const submitter = payload.submitter || {};
    treeCardEditForm.elements.branch.value = normalizeTreeCardText(
      payload.branch_key || row.branch_key || "",
    );
    if (treeCardRelations) treeCardRelations.innerHTML = "";
    const built = buildTreeCardRows(
      row,
      treeCardEditForm.elements.branch.value,
    );
    const rawInitialRows =
      Array.isArray(payload.tree_rows) && payload.tree_rows.length
        ? payload.tree_rows
        : built.ok
          ? built.rows
          : [];
    const initialRows = normalizeKnownLahmSalehRows(
      rawInitialRows,
      treeCardEditForm.elements.branch.value,
    );
    initialRows.forEach((relation) => addRelationCard(relation));
    if (!initialRows.length) addRelationCard(null);
    treeCardEditForm.elements.submitterName.value = normalizeTreeCardText(
      submitter.name || row.name || "",
    );
    treeCardEditForm.elements.submitterPhone.value = normalizeAdminPhone(
      submitter.phone || row.phone || "",
    );
    treeCardEditForm.elements.submitterEmail.value = normalizeEmail(
      submitter.email || row.email || "",
    );
    showTreeCardEditError("");
    treeCardEditDialog.showModal();
  }
  function buildTreeCardRows(reqRow, branchOverride) {
    const payload = extractTreeCardPayloadFromMessage(
      reqRow && reqRow.message ? reqRow.message : "",
    );
    if (!payload)
      return {
        ok: false,
        message: "تعذر قراءة بيانات البطاقة (JSON غير موجود).",
        rows: [],
      };
    const branchKey = normalizeTreeCardText(
      branchOverride || payload.branch_key || reqRow.branch_key || "",
    );
    const father = normalizeTreeCardText(payload.father || "");
    const personName = normalizeTreeCardText(payload.name || "");
    const personDob = normalizeTreeCardText(payload.birth_date_g || "");
    const city = normalizeTreeCardText(payload.city || "");
    const area = normalizeTreeCardText(payload.area || "");
    if (!branchKey) {
      return {
        ok: false,
        message: "بيانات البطاقة ناقصة (العائلة).",
        rows: [],
      };
    }
    const createdAt = normalizeTreeCardText(
      payload.created_at || reqRow.created_at || new Date().toISOString(),
    );
    const rows = [];
    const seen = new Set();
    function pushEdge(parent, child, extra) {
      const p = normalizeTreeCardText(parent || "");
      const c = normalizeTreeCardText(child || "");
      if (!p || !c) return;
      const key = branchKey + "|" + p + "|" + c;
      if (seen.has(key)) return;
      seen.add(key);
      const row = {
        branch_key: branchKey,
        parent_name: p,
        child_name: c,
        created_at: createdAt,
      };
      if (extra && typeof extra === "object") Object.assign(row, extra);
      rows.push(row);
    }
    const customRows = Array.isArray(payload.tree_rows)
      ? payload.tree_rows
      : [];
    if (customRows.length) {
      customRows.forEach((item) => {
        const parent = normalizeTreeCardText(
          item && item.parent_name ? item.parent_name : "",
        );
        const child = normalizeTreeCardText(
          item && item.child_name ? item.child_name : "",
        );
        if (!parent || !child) return;
        pushEdge(parent, child, {
          birth_date_g: normalizeTreeCardText(item.birth_date_g || ""),
          city: normalizeTreeCardText(item.city || ""),
          area: normalizeTreeCardText(item.area || ""),
        });
      });
      return { ok: true, rows };
    }
    if (!father || !personName) {
      return {
        ok: false,
        message: "بيانات البطاقة ناقصة (الأب/الاسم).",
        rows: [],
      };
    }
    const lineagePath = Array.isArray(payload.lineage_path)
      ? payload.lineage_path
          .map((v) => normalizeTreeCardText(v))
          .filter(Boolean)
      : [];
    if (lineagePath.length) {
      const branchRoot = branchKey + " بن مطلق بن زيدان";
      let parentId = branchRoot;
      lineagePath.forEach((baseName, idx) => {
        const childId = parentId + "/" + baseName;
        const isLeaf = idx === lineagePath.length - 1;
        pushEdge(
          parentId,
          childId,
          isLeaf
            ? {
                birth_date_g: personDob || "",
                city: city || "",
                area: area || "",
              }
            : null,
        );
        parentId = childId;
      });
      const kids = Array.isArray(payload.children) ? payload.children : [];
      kids.forEach((c) => {
        const childName = normalizeTreeCardText(c && c.name ? c.name : "");
        const childDob = normalizeTreeCardText(c && c.dob ? c.dob : "");
        if (!childName) return;
        pushEdge(parentId, parentId + "/" + childName, {
          birth_date_g: childDob || "",
        });
      });
      return { ok: true, rows };
    }
    const ancestorsFromArray = Array.isArray(payload.ancestors)
      ? payload.ancestors
      : [];
    const ancestorsFromFields = [
      payload.grandfather,
      payload.grandfather2,
      payload.grandfather3,
      payload.grandfather4,
    ].filter(Boolean);
    const ancestorsClosestFirst = (
      ancestorsFromArray.length ? ancestorsFromArray : ancestorsFromFields
    )
      .map((v) => normalizeTreeCardText(v))
      .filter(Boolean);
    const farthestFirst = ancestorsClosestFirst.slice().reverse();
    for (let i = 0; i + 1 < farthestFirst.length; i += 1) {
      pushEdge(farthestFirst[i], farthestFirst[i + 1]);
    }
    if (ancestorsClosestFirst.length) {
      pushEdge(ancestorsClosestFirst[0], father);
    }
    pushEdge(father, personName, {
      birth_date_g: personDob || "",
      city: city || "",
      area: area || "",
    });
    const kids = Array.isArray(payload.children) ? payload.children : [];
    kids.forEach((c) => {
      const childName = normalizeTreeCardText(c && c.name ? c.name : "");
      const childDob = normalizeTreeCardText(c && c.dob ? c.dob : "");
      if (!childName) return;
      pushEdge(personName, childName, { birth_date_g: childDob || "" });
    });
    return { ok: true, rows };
  }
  if (treeCardAddRelation) {
    treeCardAddRelation.addEventListener("click", () => addRelationCard(null));
  }
  if (treeCardEditForm && treeCardEditForm.elements.branch) {
    treeCardEditForm.elements.branch.addEventListener("change", () => {
      const branch = normalizeTreeCardText(
        treeCardEditForm.elements.branch.value,
      );
      const root = branch ? branch + " بن مطلق بن زيدان" : "";
      getRelationCards().forEach((card) => {
        const select = card.querySelector('[name="relationParent"]');
        if (
          select &&
          select.value.includes(" بن مطلق بن زيدان") &&
          !select.value.includes("/")
        ) {
          select.dataset.value = root;
        }
      });
      refreshRelationParentOptions();
    });
  }
  if (treeCardEditCancel) {
    treeCardEditCancel.addEventListener("click", () => {
      treeCardEditRow = null;
      showTreeCardEditError("");
      if (treeCardEditDialog && treeCardEditDialog.open)
        treeCardEditDialog.close();
    });
  }
  if (treeCardEditForm) {
    treeCardEditForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      showTreeCardEditError("");
      const row = treeCardEditRow;
      if (!row) {
        showTreeCardEditError("تعذر تحديد الطلب.");
        return;
      }
      const branch = normalizeTreeCardText(
        treeCardEditForm.elements.branch.value,
      );
      const relations = collectRelationRows(branch);
      const submitterName = normalizeTreeCardText(
        treeCardEditForm.elements.submitterName.value,
      );
      const submitterPhone = normalizeAdminPhone(
        treeCardEditForm.elements.submitterPhone.value,
      );
      const submitterEmail = normalizeEmail(
        treeCardEditForm.elements.submitterEmail.value,
      );
      if (
        !branch ||
        !relations.ok ||
        !submitterName ||
        submitterPhone.length < 9
      ) {
        showTreeCardEditError(
          relations.ok ? "أكمل الفرع وبيانات المرسل." : relations.message,
        );
        return;
      }
      if (submitterEmail && !isLikelyEmail(submitterEmail)) {
        showTreeCardEditError("البريد الإلكتروني غير صحيح.");
        return;
      }
      const oldPayload = extractTreeCardPayloadFromMessage(row.message) || {};
      const lastRelation = relations.rows[relations.rows.length - 1];
      const personName = relationLeafName(lastRelation.child_name);
      const father = relationLeafName(lastRelation.parent_name);
      const payload = {
        ...oldPayload,
        v: 1,
        kind: "tree_card",
        branch_key: branch,
        grandfather: "",
        ancestors: [],
        lineage_path: [],
        tree_rows: relations.rows,
        father,
        name: personName,
        birth_date_g: lastRelation.birth_date_g || "",
        city: "",
        area: "",
        children: [],
        submitter: {
          name: submitterName,
          phone: submitterPhone,
          email: submitterEmail,
        },
        created_at:
          oldPayload.created_at || row.created_at || new Date().toISOString(),
      };
      const message = buildTreeCardMessageFromPayload(payload, row);
      const oldBuilt = buildTreeCardRows(
        row,
        row.branch_key || oldPayload.branch_key || "",
      );
      if (!oldBuilt.ok) {
        showTreeCardEditError(oldBuilt.message || "تعذر تجهيز بيانات الشجرة.");
        return;
      }
      const sb = getClient();
      const token = getAdminToken();
      const id = coerceRpcId(row.id != null ? row.id : row.request_id);
      if (!sb || !token || !id) {
        showTreeCardEditError("يلزم تسجيل الدخول والاتصال بقاعدة البيانات.");
        return;
      }
      const submitBtn = treeCardEditForm.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;
      const { data, error } = await sb.rpc("admin_update_request_branch_v1", {
        p_token: token,
        p_id: String(id),
        p_old_branch_key:
          normalizeTreeCardText(
            row.branch_key || oldPayload.branch_key || "",
          ) || null,
        p_branch_key: branch,
        p_name: submitterName,
        p_phone: submitterPhone,
        p_email: submitterEmail || null,
        p_message: message,
        p_old_tree_rows: oldBuilt.rows,
        p_new_tree_rows: relations.rows,
      });
      if (submitBtn) submitBtn.disabled = false;
      if (error) {
        const errorText = String(error.message || "");
        const missingRpc =
          errorText.toLowerCase().includes("could not find the function") ||
          errorText.toLowerCase().includes("does not exist") ||
          String(error.code || "").toLowerCase() === "pgrst202";
        showTreeCardEditError(
          missingRpc
            ? "تعذر حفظ التعديلات حالياً، حاول لاحقاً أو تواصل مع الإدارة."
            : "تعذر حفظ التعديلات حالياً، حاول لاحقاً أو تواصل مع الإدارة.",
        );
        return;
      }
      if (data !== true) {
        showTreeCardEditError("لا يمكن تعديل هذا الطلب في حالته الحالية.");
        return;
      }
      treeCardEditRow = null;
      treeCardEditDialog.close();
      showAlert(
        "success",
        row.status === "approved"
          ? "تم تعديل الطلب وتصحيح بيانات الشجرة."
          : "تم تعديل الطلب كاملًا.",
      );
      await reloadRequests();
    });
  }
  async function importTreeCardToTree(sb, token, reqRow) {
    const built = buildTreeCardRows(reqRow);
    if (!built.ok) return built;
    const rows = built.rows;
    const { data, error } = await sb.rpc("admin_tree_children_import_v1", {
      p_token: token,
      p_rows: rows,
    });
    if (error) {
      const msg = String(error.message || "");
      const low = msg.toLowerCase();
      const isMissing =
        low.includes("could not find the function") ||
        low.includes("does not exist") ||
        String(error.code || "").toLowerCase() === "pgrst202";
      if (isMissing) {
        return {
          ok: false,
          message:
            "تعذر إضافة البيانات للشجرة حالياً، حاول لاحقاً أو تواصل مع الإدارة.",
        };
      }
      return {
        ok: false,
        message:
          "تعذر إضافة البيانات للشجرة حالياً، حاول لاحقاً أو تواصل مع الإدارة.",
      };
    }
    const inserted =
      data && data.inserted != null ? Number(data.inserted) : null;
    const updated = data && data.updated != null ? Number(data.updated) : null;
    const skipped = data && data.skipped != null ? Number(data.skipped) : null;
    const parts = [];
    if (Number.isFinite(inserted)) parts.push("جديد: " + String(inserted));
    if (Number.isFinite(updated)) parts.push("تحديث: " + String(updated));
    if (Number.isFinite(skipped)) parts.push("تخطي: " + String(skipped));
    return { ok: true, message: parts.length ? parts.join("، ") : "" };
  }


  window.AlzidanRequestActions = {
    setReloadRequests,
    publishEventCardRequest,
    openTreeCardEditor,
    importTreeCardToTree,
    updateBranchInRequestMessage,
    extractRequestMediaLinks,
    appendRequestMediaPreview,
    requestMessageWithoutMediaLinks,
  };
})();
