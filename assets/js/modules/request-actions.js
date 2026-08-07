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
    const Events = window.AlzidanEvents || {};
    if (typeof Events.extractEventMediaLinks === "function") {
      return Events.extractEventMediaLinks(message);
    }
    const media = { image: "", video: "" };
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
  async function notifyFamilyEventPush(sb, eventRow) {
    if (!sb || !eventRow) return { ok: false, reason: "missing_client_or_row" };
    const { data, error } = await sb.functions.invoke("alzidan-push-notify", {
      body: {
        type: eventRow.type || "",
        person: eventRow.person || "",
        branch_key: eventRow.branch_key || "",
        details: eventRow.details || "",
      },
    });
    if (error) {
      try {
        console.error("PUSH_NOTIFY_INVOKE_ERROR", error);
      } catch (_) {}
      return { ok: false, reason: "invoke_error", error };
    }
    if (data && data.skipped) {
      try {
        console.warn("PUSH_NOTIFY_SKIPPED", data.skipped, data);
      } catch (_) {}
      return { ok: false, skipped: data.skipped, data };
    }
    if (data && data.ok === false) {
      try {
        console.error("PUSH_NOTIFY_FAILED", data);
      } catch (_) {}
      return { ok: false, data };
    }
    try {
      console.log("PUSH_NOTIFY_OK", data);
    } catch (_) {}
    return { ok: true, data };
  }

  async function publishEventCardRequest(sb, token, row) {
    const requestId = String(
      row && row.request_id ? row.request_id : "",
    ).trim();
    if (!requestId) return { ok: false, message: "رقم الطلب ناقص." };
    const Events = window.AlzidanEvents || {};
    const eventRow =
      typeof Events.buildFamilyEventRow === "function"
        ? Events.buildFamilyEventRow({ source: "approval_request", row })
        : null;
    if (!eventRow || !eventRow.branch_key || !eventRow.type || !eventRow.person) {
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
    await notifyFamilyEventPush(sb, eventRow);
    return { ok: true, eventRow };
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
    const fatherPersonId = normalizeTreeCardText(
      payload.father_person_id ||
        payload.parent_person_id ||
        payload.selected_parent_person_id ||
        "",
    );
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
      const fatherPath = normalizeTreeCardText(payload.father_path || father);
      if (
        fatherPersonId &&
        fatherPath &&
        p === fatherPath &&
        !normalizeTreeCardText(row.parent_person_id || "")
      ) {
        row.parent_person_id = fatherPersonId;
      }
      rows.push(row);
    }
    const customRows = Array.isArray(payload.tree_rows)
      ? payload.tree_rows
      : [];
    if (customRows.length) {
      if (!fatherPersonId && !customRows.every((item) => {
        const parent = normalizeTreeCardText(item && item.parent_name ? item.parent_name : "");
        const branchRoot = branchKey + " بن مطلق بن زيدان";
        const isRoot = parent === branchKey || parent === branchRoot;
        return isRoot || normalizeTreeCardText(item && item.parent_person_id ? item.parent_person_id : "");
      })) {
        return {
          ok: false,
          message:
            "بطاقة الشجرة بلا parent_person_id للأب المحدد — أوقف الاعتماد (TREE-003).",
          code: "TREE-003",
          rows: [],
        };
      }
      customRows.forEach((item) => {
        const parent = normalizeTreeCardText(
          item && item.parent_name ? item.parent_name : "",
        );
        const child = normalizeTreeCardText(
          item && item.child_name ? item.child_name : "",
        );
        if (!parent || !child) return;
        // Never stamp father_person_id onto every ancestor edge — only this
        // row's own parent_person_id (pushEdge still binds the final father).
        const rowPid = normalizeTreeCardText(
          (item && item.parent_person_id) || "",
        );
        pushEdge(parent, child, {
          birth_date_g: normalizeTreeCardText(item.birth_date_g || ""),
          city: normalizeTreeCardText(item.city || ""),
          area: normalizeTreeCardText(item.area || ""),
          person_id: normalizeTreeCardText((item && item.person_id) || "") || undefined,
          parent_person_id: rowPid || undefined,
        });
      });
      return { ok: true, rows, father_person_id: fatherPersonId };
    }
    if (!father || !personName) {
      return {
        ok: false,
        message: "بيانات البطاقة ناقصة (الأب/الاسم).",
        rows: [],
      };
    }
    if (!fatherPersonId) {
      return {
        ok: false,
        message:
          "يلزم parent_person_id / father_person_id من اختيار الأب في الواجهة قبل الاعتماد (TREE-003).",
        code: "TREE-003",
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
                parent_person_id:
                  parentId === normalizeTreeCardText(payload.father_path || father)
                    ? fatherPersonId
                    : undefined,
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
          parent_person_id: fatherPersonId,
        });
      });
      return { ok: true, rows, father_person_id: fatherPersonId };
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
    const fatherPath = normalizeTreeCardText(payload.father_path || father);
    pushEdge(father, personName, {
      birth_date_g: personDob || "",
      city: city || "",
      area: area || "",
      parent_person_id: fatherPersonId,
    });
    const kids = Array.isArray(payload.children) ? payload.children : [];
    kids.forEach((c) => {
      const childName = normalizeTreeCardText(c && c.name ? c.name : "");
      const childDob = normalizeTreeCardText(c && c.dob ? c.dob : "");
      if (!childName) return;
      // Children of the added person — parent is the new child path, not the selected father.
      pushEdge(personName, childName, { birth_date_g: childDob || "" });
    });
    return { ok: true, rows, father_person_id: fatherPersonId, father_path: fatherPath };
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
      const father = lastRelation.parent_name;
      const sb = getClient();
      const token = getAdminToken();
      const id = coerceRpcId(row.id != null ? row.id : row.request_id);
      if (!sb || !token || !id) {
        showTreeCardEditError("يلزم تسجيل الدخول والاتصال بقاعدة البيانات.");
        return;
      }
      // Stamp parent_person_id from exact path index only (TREE-004) before saving request.
      const pathToRow = await loadPathToRowForBranch(sb, branch);
      const stampedRows = [];
      for (let i = 0; i < relations.rows.length; i += 1) {
        const edge = Object.assign({}, relations.rows[i]);
        const parent = normalizeTreeCardText(edge.parent_name || "");
        const branchRoot = branch + " بن مطلق بن زيدان";
        const isRoot = parent === branch || parent === branchRoot;
        if (!isRoot) {
          const meta = pathToRow[parent];
          const pid = meta && meta.person_id ? String(meta.person_id) : "";
          if (!pid) {
            showTreeCardEditError(
              "تعذر تحديد parent_person_id للأب «" +
                relationPathLabel(parent) +
                "». اختر مسار أب فريد من الشجرة (TREE-003).",
            );
            return;
          }
          const matches = countExactParentPersonMatches(pathToRow, pid);
          if (matches.count !== 1) {
            showTreeCardEditError(
              "الأب «" +
                relationPathLabel(parent) +
                "» غير فريد بالهوية — أوقف الحفظ (TREE-001).",
            );
            return;
          }
          edge.parent_person_id = pid;
        }
        stampedRows.push(edge);
      }
      const fatherPersonId = normalizeTreeCardText(
        (stampedRows.find((r) => r.parent_name === father) || {}).parent_person_id ||
          (pathToRow[father] && pathToRow[father].person_id) ||
          "",
      );
      const payload = {
        ...oldPayload,
        v: 1,
        kind: "tree_card",
        branch_key: branch,
        grandfather: "",
        ancestors: [],
        lineage_path: [],
        tree_rows: stampedRows,
        father: relationLeafName(father),
        father_path: father,
        father_person_id: fatherPersonId,
        parent_person_id: fatherPersonId,
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
        p_new_tree_rows: stampedRows,
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
  function canonicalHelpers() {
    return {
      normalizePersonName: normalizeTreeCardText,
      getLeafStoredNameFromNodeId: function (v) {
        const n = normalizeTreeCardText(v || "");
        if (!n) return "";
        if (n.indexOf("/") < 0) return n;
        const parts = n.split("/").map((p) => normalizeTreeCardText(p)).filter(Boolean);
        return parts.length ? parts[parts.length - 1] : n;
      },
    };
  }

  function requestFail(code, message, extra) {
    const out = {
      ok: false,
      code: code || "",
      message: message || "",
      inserted: 0,
      updated: 0,
      skipped: 0,
      verified: 0,
      rows: [],
    };
    if (extra && typeof extra === "object") Object.assign(out, extra);
    return out;
  }

  function countExactParentPersonMatches(pathToRow, parentPersonId) {
    const pid = normalizeTreeCardText(parentPersonId || "");
    if (!pid || !pathToRow) return { count: 0, meta: null };
    const meta = pathToRow["pid:" + pid] || null;
    if (meta && meta.person_id) return { count: 1, meta: meta };
    // Fallback scan: exactly one row with this person_id
    const hits = [];
    Object.keys(pathToRow).forEach((key) => {
      if (key.indexOf("pid:") === 0) return;
      const row = pathToRow[key];
      if (row && normalizeTreeCardText(row.person_id || "") === pid) hits.push(row);
    });
    if (hits.length === 1) return { count: 1, meta: hits[0] };
    return { count: hits.length, meta: null };
  }

  function parentPathsCompatible(parentPath, dbParent) {
    const CP = window.AlzidanCanonicalPerson;
    if (CP && typeof CP.parentNamesCompatible === "function") {
      return CP.parentNamesCompatible(
        parentPath,
        dbParent,
        normalizeTreeCardText,
        relationLeafName,
      );
    }
    const a = normalizeTreeCardText(parentPath || "");
    const b = normalizeTreeCardText(dbParent || "");
    if (!a || !b) return true;
    if (a === b) return true;
    const aLeaf = relationLeafName(a);
    const bLeaf = relationLeafName(b);
    if (a === bLeaf || b === aLeaf) return true;
    if (a.endsWith("/" + b) || b.endsWith("/" + aLeaf)) return true;
    return false;
  }

  /**
   * Resolve an existing tree node for reuse (not insert).
   * Order: person_id → exact path → unique leaf under parent → unique leaf in branch.
   * Ambiguity → TREE-001 (never silent pick).
   */
  function resolveExistingTreeNode(pathToRow, opts) {
    const CP = window.AlzidanCanonicalPerson;
    const options = opts || {};
    const personId = normalizeTreeCardText(options.personId || "");
    const path = normalizeTreeCardText(options.path || "");
    const parentPersonId = normalizeTreeCardText(options.parentPersonId || "");
    const parentPath = normalizeTreeCardText(options.parentPath || "");
    const leaf = relationLeafName(path) || normalizeTreeCardText(options.leaf || "");
    const label = relationPathLabel(path || leaf || personId);

    function metaMatchesWantedPath(meta) {
      if (!meta) return false;
      if (!path && !leaf) return true;
      const metaPath = normalizeTreeCardText(meta.db_child_name || "");
      const metaLeaf = relationLeafName(metaPath);
      const wantLeaf = leaf || relationLeafName(path);
      if (path && metaPath === path) return true;
      if (wantLeaf && metaLeaf === wantLeaf) return true;
      if (
        path &&
        metaPath &&
        (metaPath.endsWith("/" + path) ||
          path.endsWith("/" + metaPath) ||
          metaPath.endsWith("/" + wantLeaf))
      ) {
        return true;
      }
      return false;
    }

    if (personId) {
      const byPid = countExactParentPersonMatches(pathToRow, personId);
      if (byPid.count === 1 && byPid.meta) {
        // Ignore a stamped person_id that conflicts with the edge's parent/child path
        // (legacy tree_rows often copied father_person_id onto every ancestor edge).
        if (metaMatchesWantedPath(byPid.meta)) {
          return { ok: true, found: true, meta: byPid.meta };
        }
      } else if (byPid.count > 1) {
        return requestFail(
          (CP && CP.ERROR && CP.ERROR.TREE_001) || "TREE-001",
          "تعذر تحديد «" +
            label +
            "» لأن المعرّف يطابق أكثر من صف (TREE-001).",
          { matchCount: byPid.count, person_id: personId },
        );
      }
    }

    if (path && pathToRow && pathToRow[path] && pathToRow[path].id) {
      return { ok: true, found: true, meta: pathToRow[path] };
    }

    if (CP && typeof CP.resolveFromPathIndex === "function" && (path || personId)) {
      const fromIndex = CP.resolveFromPathIndex(
        pathToRow,
        path,
        personId,
        canonicalHelpers(),
      );
      if (fromIndex && fromIndex.ok && fromIndex.meta) {
        return { ok: true, found: true, meta: fromIndex.meta };
      }
      if (fromIndex && fromIndex.code === "TREE-001") {
        return requestFail(
          (CP && CP.ERROR && CP.ERROR.TREE_001) || "TREE-001",
          "تعذر تحديد «" +
            label +
            "» لأن الاسم يطابق أكثر من شخص في الشجرة. اختر المسار الكامل أو معرّف الشخص (TREE-001).",
          { matchCount: fromIndex.matchCount || 0 },
        );
      }
    }

    if (!leaf || !pathToRow) {
      return { ok: true, found: false, meta: null };
    }

    const hits = [];
    const seen = {};
    Object.keys(pathToRow).forEach((key) => {
      if (key.indexOf("pid:") === 0) return;
      const row = pathToRow[key];
      if (!row || row.id == null) return;
      const childPath = normalizeTreeCardText(row.db_child_name || key);
      const childLeaf = relationLeafName(childPath);
      if (childLeaf !== leaf && childPath !== path) return;
      if (parentPersonId) {
        if (normalizeTreeCardText(row.parent_person_id || "") !== parentPersonId) {
          return;
        }
      } else if (parentPath) {
        if (
          !parentPathsCompatible(
            parentPath,
            row.db_parent_name || "",
          )
        ) {
          return;
        }
      }
      const id = Number(row.id);
      if (seen[id]) return;
      seen[id] = true;
      hits.push(row);
    });

    if (hits.length === 1) {
      return { ok: true, found: true, meta: hits[0] };
    }
    if (hits.length > 1) {
      const distinct = {};
      hits.forEach((h) => {
        const p = normalizeTreeCardText(h.person_id || "");
        if (p) distinct[p] = h;
      });
      const pids = Object.keys(distinct);
      if (
        pids.length === 1 &&
        hits.every((h) => normalizeTreeCardText(h.person_id || "") === pids[0])
      ) {
        return { ok: true, found: true, meta: distinct[pids[0]] };
      }
      return requestFail(
        (CP && CP.ERROR && CP.ERROR.TREE_001) || "TREE-001",
        "تعذر تحديد «" +
          label +
          "» لأن الاسم يطابق أكثر من شخص في الشجرة. اختر المسار الكامل أو معرّف الشخص (TREE-001).",
        { matchCount: hits.length },
      );
    }
    return { ok: true, found: false, meta: null };
  }

  /**
   * Bind a write edge to a resolved existing parent (canonical path + person_id).
   * Branch-root parents have no person row.
   */
  function enrichOneTreeCardRow(row, pathToRow) {
    const CP = window.AlzidanCanonicalPerson;
    const payload = Object.assign({}, row || {});
    const parent = normalizeTreeCardText(payload.parent_name || "");
    const branch = normalizeTreeCardText(payload.branch_key || "");
    const branchRoot = branch ? branch + " بن مطلق بن زيدان" : "";
    const isBranchRoot =
      !!branch && (parent === branch || parent === branchRoot);

    if (!parent) {
      return requestFail(
        (CP && CP.ERROR && CP.ERROR.REQ_002) || "REQ-002",
        (CP && CP.MSG && CP.MSG.REQ_002) ||
          "فشل إنشاء أو ربط الابن بعد الاعتماد (REQ-002).",
      );
    }

    if (isBranchRoot) {
      // Root edges have no parent person row — allow missing parent_person_id.
      return { ok: true, row: payload };
    }

    const parentPidHint = normalizeTreeCardText(
      payload.parent_person_id || payload.father_person_id || "",
    );
    const resolved = resolveExistingTreeNode(pathToRow, {
      personId: parentPidHint,
      path: parent,
      leaf: relationLeafName(parent),
    });
    if (!resolved.ok) {
      // Prefer Arabic father-specific TREE-001 wording.
      if (resolved.code === "TREE-001") {
        return requestFail(
          "TREE-001",
          "الأب «" +
            relationPathLabel(parent) +
            "» يطابق أكثر من شخص في الشجرة — لن يُنشأ ابن تحت أب غامض. اختر المسار الكامل أو معرّف الأب (TREE-001).",
          { matchCount: resolved.matchCount || 0 },
        );
      }
      return resolved;
    }
    if (!resolved.found || !resolved.meta) {
      if (parentPidHint) {
        return requestFail(
          (CP && CP.ERROR && CP.ERROR.TREE_003) || "TREE-003",
          (CP && CP.MSG && CP.MSG.TREE_004) ||
            "عزل حالة الأبناء: parent_person_id لا يطابق شخصًا واحدًا (TREE-004).",
          { reason: "parent_person_id_not_in_tree", parent_person_id: parentPidHint },
        );
      }
      return requestFail(
        (CP && CP.ERROR && CP.ERROR.TREE_003) || "TREE-003",
        "تعذر تحديد الأب «" +
          relationPathLabel(parent) +
          "» في الشجرة — الأب غير موجود أو بلا هوية فريدة (TREE-003).",
        { reason: "parent_not_found" },
      );
    }

    const meta = resolved.meta;
    const parentPid = normalizeTreeCardText(meta.person_id || parentPidHint || "");
    if (!parentPid) {
      return requestFail(
        (CP && CP.ERROR && CP.ERROR.TREE_003) || "TREE-003",
        (CP && CP.MSG && CP.MSG.TREE_003) ||
          "تعذر تحديد معرّف الأب (parent_person_id) لهذا المسار (TREE-003).",
        { reason: "missing_parent_person_id" },
      );
    }

    payload.parent_person_id = parentPid;
    if (meta.db_child_name) {
      payload.parent_name = meta.db_child_name;
      payload.parent = meta.db_child_name;
    }
    return { ok: true, row: payload, parentMeta: meta };
  }

  async function loadPathToRowForBranch(sb, branchKey) {
    const key = normalizeTreeCardText(branchKey || "");
    if (!sb || !key) return {};
    const fields = [
      "id,person_id,parent_person_id,branch_key,parent_name,parent,child_name,name",
      "id,branch_key,parent_name,parent,child_name,name,person_id",
    ];
    const FM = window.AlzidanFamilyPersonCore || {};
    for (let i = 0; i < fields.length; i += 1) {
      const q = await sb
        .from("tree_children")
        .select(fields[i])
        .eq("branch_key", key)
        .limit(5000);
      if (!q.error && Array.isArray(q.data)) {
        if (typeof FM.buildPathToRowIndex === "function") {
          return FM.buildPathToRowIndex(q.data, normalizeTreeCardText);
        }
        const index = {};
        q.data.forEach((row) => {
          if (!row || row.id == null) return;
          const childPath = normalizeTreeCardText(row.child_name || row.name || "");
          const meta = {
            id: Number(row.id),
            person_id: row.person_id ? String(row.person_id) : "",
            parent_person_id: row.parent_person_id
              ? String(row.parent_person_id)
              : "",
            db_parent_name: normalizeTreeCardText(
              row.parent_name || row.parent || "",
            ),
            db_child_name: childPath,
          };
          if (childPath) index[childPath] = meta;
          if (meta.person_id) index["pid:" + meta.person_id] = meta;
        });
        return index;
      }
    }
    return {};
  }

  function indexImportedChild(pathToRow, dbRow) {
    if (!pathToRow || !dbRow || dbRow.id == null) return pathToRow;
    const childPath = normalizeTreeCardText(dbRow.child_name || dbRow.name || "");
    const meta = {
      id: Number(dbRow.id),
      person_id: dbRow.person_id ? String(dbRow.person_id) : "",
      parent_person_id: dbRow.parent_person_id
        ? String(dbRow.parent_person_id)
        : "",
      db_parent_name: normalizeTreeCardText(
        dbRow.parent_name || dbRow.parent || "",
      ),
      db_child_name: childPath,
    };
    if (childPath) pathToRow[childPath] = meta;
    if (meta.person_id) pathToRow["pid:" + meta.person_id] = meta;
    return pathToRow;
  }

  async function fetchTreeCardChildRow(sb, row) {
    const branch = normalizeTreeCardText(row.branch_key || "");
    const parent = normalizeTreeCardText(row.parent_name || "");
    const child = normalizeTreeCardText(row.child_name || "");
    if (!sb || !branch || !parent || !child) return null;
    let res = await sb
      .from("tree_children")
      .select("id,person_id,parent_person_id,parent_name,parent,child_name,name")
      .eq("branch_key", branch)
      .eq("parent_name", parent)
      .eq("child_name", child)
      .limit(3);
    if (res.error || !Array.isArray(res.data) || !res.data.length) {
      res = await sb
        .from("tree_children")
        .select("id,person_id,parent_person_id,parent_name,parent,child_name,name")
        .eq("branch_key", branch)
        .eq("parent_name", parent)
        .eq("name", child)
        .limit(3);
    }
    if (res.error || !Array.isArray(res.data) || !res.data.length) return null;
    const parentPid = normalizeTreeCardText(row.parent_person_id || "");
    if (parentPid) {
      const linked = res.data.find(
        (r) => String(r.parent_person_id || "") === parentPid,
      );
      return linked || null;
    }
    return res.data[0];
  }

  async function verifyTreeCardRowsInTree(sb, rows) {
    const list = Array.isArray(rows) ? rows : [];
    if (!sb || !list.length) {
      return { ok: false, verified: 0, missing: list.length };
    }
    let verified = 0;
    const missing = [];
    for (let i = 0; i < list.length; i += 1) {
      const row = list[i] || {};
      const hit = await fetchTreeCardChildRow(sb, row);
      if (!hit) {
        missing.push(row);
        continue;
      }
      const parentPid = normalizeTreeCardText(row.parent_person_id || "");
      const branch = normalizeTreeCardText(row.branch_key || "");
      const parent = normalizeTreeCardText(row.parent_name || "");
      const branchRoot = branch ? branch + " بن مطلق بن زيدان" : "";
      const isBranchRoot =
        !!branch && (parent === branch || parent === branchRoot);
      if (parentPid) {
        if (String(hit.parent_person_id || "") !== parentPid) {
          missing.push(row);
          continue;
        }
      } else if (!isBranchRoot) {
        // Non-root edges must be linked via parent_person_id after apply
        if (!hit.parent_person_id) {
          missing.push(row);
          continue;
        }
      }
      verified += 1;
    }
    return {
      ok: missing.length === 0 && verified === list.length,
      verified,
      missing: missing.length,
      missingRows: missing,
    };
  }

  /**
   * Align child_name to canonical parent path + leaf (avoid short-path duplicates).
   */
  function alignChildPathUnderParent(parentPath, childPath) {
    const parent = normalizeTreeCardText(parentPath || "");
    const child = normalizeTreeCardText(childPath || "");
    const leaf = relationLeafName(child) || child;
    if (!parent || !leaf) return child;
    if (child.indexOf("/") >= 0 && child.indexOf(parent + "/") === 0) return child;
    if (parent.indexOf("/") >= 0 || parent.indexOf(" بن مطلق بن زيدان") >= 0) {
      return parent + "/" + leaf;
    }
    return child.indexOf("/") >= 0 ? child : leaf;
  }

  /**
   * Patch 2+ — Verified apply for tree_card / add-son.
   * If father/ancestors already exist → reuse them; insert only missing children.
   * Never blind-insert the full tree_rows chain (no duplicate fathers).
   * Event order: build → resolve parent → skip-or-import child → verify → then approved.
   */
  async function importTreeCardToTree(sb, token, reqRow) {
    const CP = window.AlzidanCanonicalPerson;
    const built = buildTreeCardRows(reqRow);
    if (!built.ok) {
      return requestFail(
        built.code || (CP && CP.ERROR && CP.ERROR.REQ_002) || "REQ-002",
        built.message ||
          ((CP && CP.MSG && CP.MSG.REQ_002) ||
            "فشل إنشاء أو ربط الابن بعد الاعتماد (REQ-002)."),
      );
    }
    if (!built.rows || !built.rows.length) {
      return requestFail(
        (CP && CP.ERROR && CP.ERROR.REQ_001) || "REQ-001",
        (CP && CP.MSG && CP.MSG.REQ_001) ||
          "لا يمكن قبول الطلب: لم يُثبت أي أثر في الشجرة (REQ-001).",
      );
    }
    const branchKey = normalizeTreeCardText(
      (built.rows[0] && built.rows[0].branch_key) || reqRow.branch_key || "",
    );
    let pathToRow = await loadPathToRowForBranch(sb, branchKey);

    const appliedRows = [];
    let insertedTotal = 0;
    let updatedTotal = 0;
    let skippedTotal = 0;

    for (let i = 0; i < built.rows.length; i += 1) {
      // Resolve parent against existing tree (person_id / path / unique match).
      const enriched = enrichOneTreeCardRow(built.rows[i], pathToRow);
      if (!enriched.ok) return enriched;
      const row = enriched.row;
      row.child_name = alignChildPathUnderParent(
        row.parent_name,
        row.child_name,
      );

      // If child already exists under that parent → reuse; do not re-insert father/chain.
      const existingChild = resolveExistingTreeNode(pathToRow, {
        personId: row.person_id || "",
        path: row.child_name,
        parentPersonId: row.parent_person_id || "",
        parentPath: row.parent_name || "",
        leaf: relationLeafName(row.child_name),
      });
      if (!existingChild.ok) return existingChild;
      if (existingChild.found && existingChild.meta) {
        const meta = existingChild.meta;
        const reuse = Object.assign({}, row, {
          child_name: meta.db_child_name || row.child_name,
          parent_name:
            meta.db_parent_name || row.parent_name || row.parent || "",
          parent: meta.db_parent_name || row.parent_name || row.parent || "",
          person_id: meta.person_id || row.person_id || "",
          parent_person_id:
            meta.parent_person_id || row.parent_person_id || "",
        });
        pathToRow = indexImportedChild(pathToRow, {
          id: meta.id,
          person_id: reuse.person_id,
          parent_person_id: reuse.parent_person_id,
          parent_name: reuse.parent_name,
          parent: reuse.parent_name,
          child_name: reuse.child_name,
          name: reuse.child_name,
        });
        appliedRows.push(reuse);
        skippedTotal += 1;
        continue;
      }

      const before = await fetchTreeCardChildRow(sb, row);
      const { data, error } = await sb.rpc("admin_tree_children_import_v1", {
        p_token: token,
        p_rows: [row],
      });
      if (error) {
        const msg = String(error.message || "");
        const low = msg.toLowerCase();
        if (low.includes("tree-001") || msg.includes("TREE-001")) {
          return requestFail(
            (CP && CP.ERROR && CP.ERROR.TREE_001) || "TREE-001",
            "الأب «" +
              relationPathLabel(row.parent_name || "") +
              "» غامض أو غير فريد — أوقف الاعتماد (TREE-001).",
            { detail: msg },
          );
        }
        return requestFail(
          (CP && CP.ERROR && CP.ERROR.REQ_002) || "REQ-002",
          "تعذر إضافة البيانات للشجرة حالياً، حاول لاحقاً أو تواصل مع الإدارة. (REQ-002)",
          { detail: msg, rows: appliedRows },
        );
      }
      const inserted =
        data && data.inserted != null ? Number(data.inserted) : 0;
      const updated = data && data.updated != null ? Number(data.updated) : 0;
      const skipped = data && data.skipped != null ? Number(data.skipped) : 0;
      insertedTotal += Number.isFinite(inserted) ? inserted : 0;
      updatedTotal += Number.isFinite(updated) ? updated : 0;
      skippedTotal += Number.isFinite(skipped) ? skipped : 0;

      const after = await fetchTreeCardChildRow(sb, row);
      const parent = normalizeTreeCardText(row.parent_name || "");
      const branch = normalizeTreeCardText(row.branch_key || "");
      const branchRoot = branch ? branch + " بن مطلق بن زيدان" : "";
      const isBranchRoot =
        !!branch && (parent === branch || parent === branchRoot);
      const linkedOk = row.parent_person_id
        ? after &&
          String(after.parent_person_id || "") === String(row.parent_person_id)
        : !!after && (isBranchRoot || !!after.parent_person_id);
      if (!linkedOk) {
        return requestFail(
          (CP && CP.ERROR && CP.ERROR.REQ_002) || "REQ-002",
          (CP && CP.MSG && CP.MSG.REQ_002) ||
            "فشل إنشاء أو ربط الابن بعد الاعتماد (REQ-002).",
          {
            inserted: insertedTotal,
            updated: updatedTotal,
            skipped: skippedTotal,
            rows: appliedRows,
          },
        );
      }
      pathToRow = indexImportedChild(pathToRow, after);
      appliedRows.push(row);
      // If RPC reported 0/0 but row existed and is linked, count as verified update path
      if (!inserted && !updated && before && after) {
        updatedTotal += 1;
      }
    }

    // Verify only newly written / reused edges that should exist after apply.
    const verify = await verifyTreeCardRowsInTree(sb, appliedRows);
    if (!verify.ok) {
      if (!(insertedTotal + updatedTotal + skippedTotal)) {
        return requestFail(
          (CP && CP.ERROR && CP.ERROR.REQ_001) || "REQ-001",
          (CP && CP.MSG && CP.MSG.REQ_001) ||
            "لا يمكن قبول الطلب: لم يُثبت أي أثر في الشجرة (REQ-001).",
          {
            inserted: insertedTotal,
            updated: updatedTotal,
            skipped: skippedTotal,
            verified: verify.verified,
          },
        );
      }
      // Reused-only apply (all ancestors existed, son linked) still needs verify ok.
      if (!(insertedTotal + updatedTotal) && skippedTotal) {
        // Skipped rows must still be readable; if verify failed, treat as REQ-002.
        return requestFail(
          (CP && CP.ERROR && CP.ERROR.REQ_002) || "REQ-002",
          (CP && CP.MSG && CP.MSG.REQ_002) ||
            "فشل إنشاء أو ربط الابن بعد الاعتماد (REQ-002).",
          {
            inserted: insertedTotal,
            updated: updatedTotal,
            skipped: skippedTotal,
            verified: verify.verified,
          },
        );
      }
      return requestFail(
        (CP && CP.ERROR && CP.ERROR.REQ_002) || "REQ-002",
        (CP && CP.MSG && CP.MSG.REQ_002) ||
          "فشل إنشاء أو ربط الابن بعد الاعتماد (REQ-002).",
        {
          inserted: insertedTotal,
          updated: updatedTotal,
          skipped: skippedTotal,
          verified: verify.verified,
        },
      );
    }

    const parts = [];
    parts.push("جديد: " + String(insertedTotal));
    parts.push("تحديث: " + String(updatedTotal));
    if (skippedTotal) parts.push("موجود مسبقاً: " + String(skippedTotal));
    parts.push("متحقق: " + String(verify.verified));
    return {
      ok: true,
      code: "",
      message: parts.join("، "),
      inserted: insertedTotal,
      updated: updatedTotal,
      skipped: skippedTotal,
      verified: verify.verified,
      rows: appliedRows,
    };
  }

  /** Re-apply for already-approved orphan tree_card requests (no status change). */
  async function reapplyApprovedTreeCard(sb, token, reqRow) {
    return importTreeCardToTree(sb, token, reqRow);
  }

  window.AlzidanRequestActions = {
    setReloadRequests,
    publishEventCardRequest,
    openTreeCardEditor,
    importTreeCardToTree,
    reapplyApprovedTreeCard,
    buildTreeCardRows,
    enrichOneTreeCardRow,
    resolveExistingTreeNode,
    alignChildPathUnderParent,
    verifyTreeCardRowsInTree,
    countExactParentPersonMatches,
    updateBranchInRequestMessage,
    extractRequestMediaLinks,
    appendRequestMediaPreview,
    requestMessageWithoutMediaLinks,
  };
})();
