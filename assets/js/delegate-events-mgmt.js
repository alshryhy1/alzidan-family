(() => {
  "use strict";

  const FormCore = window.AlzidanEventFormCore || {};
  const Events = window.AlzidanEvents || {};

  let eventsMgmtPanel = null;
  const rowsByCategory = { happy: [], sick: [], death: [] };

  function host() {
    return window.DelegateEventsHost || {};
  }

  function h(name) {
    const fn = host()[name];
    return typeof fn === "function" ? fn : null;
  }

  function rowId(row) {
    if (row && row.id != null) return "id:" + String(row.id);
    if (row && row.created_at != null) return "created_at:" + String(row.created_at);
    return "";
  }

  function findRowById(category, id) {
    const list = rowsByCategory[category] || [];
    return list.find((row) => rowId(row) === String(id || "")) || null;
  }

  function filterActiveRows(rowsRaw) {
    const parseEventEnvelope = h("parseEventEnvelope");
    const getEventPkKeys = h("getEventPkKeys");
    const addEnvelopePkRefsToSet = h("addEnvelopePkRefsToSet");
    if (!parseEventEnvelope || !getEventPkKeys || !addEnvelopePkRefsToSet) {
      return Array.isArray(rowsRaw) ? rowsRaw : [];
    }
    const tombstonedKeys = new Set();
    const replacedKeys = new Set();
    (Array.isArray(rowsRaw) ? rowsRaw : []).forEach((r) => {
      const env = parseEventEnvelope(r);
      if (env && env.kind === "event_tombstone") {
        addEnvelopePkRefsToSet(env.target, tombstonedKeys);
        addEnvelopePkRefsToSet(env.targetKeys, tombstonedKeys);
        return;
      }
      if (env && env.replaces) {
        addEnvelopePkRefsToSet(env.replaces, replacedKeys);
        addEnvelopePkRefsToSet(env.replacesKeys, replacedKeys);
      }
    });
    return (Array.isArray(rowsRaw) ? rowsRaw : []).filter((r) => {
      const env = parseEventEnvelope(r);
      if (env && env.kind === "event_tombstone") return false;
      const keys = getEventPkKeys(r);
      if (!keys.length) return true;
      if (keys.some((k) => tombstonedKeys.has(k))) return false;
      if (keys.some((k) => replacedKeys.has(k))) return false;
      return true;
    });
  }

  async function fetchCategoryRows(category, branchKey) {
    const getClient = h("getClient");
    const normalizePersonName = h("normalizePersonName");
    const sb = getClient ? getClient() : null;
    const branch = normalizePersonName ? normalizePersonName(branchKey || "") : String(branchKey || "").trim();
    if (!sb || !branch) return [];

    if (category === "death") {
      const { data, error } = await sb
        .from("family_events")
        .select("*")
        .eq("branch_key", branch)
        .eq("type", "death")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) return [];
      return filterActiveRows(data);
    }

    const { data, error } = await sb
      .from("family_events")
      .select("*")
      .eq("branch_key", branch)
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) return [];
    const rows = filterActiveRows(data).filter((e) => String(e && e.type ? e.type : "") !== "death");
    if (category === "sick") {
      return rows.filter((r) => {
        const t = String(r && r.type ? r.type : "").trim();
        return t === "sick" || t === "operation" || t === "discharge";
      });
    }
    return rows.filter((r) => {
      const t = String(r && r.type ? r.type : "").trim();
      return t && t !== "sick" && t !== "operation" && t !== "discharge" && t !== "death";
    });
  }

  async function resolveHappyMedia(sb, values, oldRow) {
    const uploadDelegateEventMedia = h("uploadDelegateEventMedia");
    const parseDelegateHappyDetails = h("parseDelegateHappyDetails");
    const old = parseDelegateHappyDetails ? parseDelegateHappyDetails(oldRow || {}) : {};
    let imageUrl = String(values.imageUrl || old.imageUrl || old.image_url || old.photoUrl || old.photo_url || "").trim();
    let videoUrl = String(values.videoUrl || old.videoUrl || old.video_url || "").trim();
    if (values.imageFile && uploadDelegateEventMedia) {
      imageUrl = await uploadDelegateEventMedia(sb, values.imageFile, "image");
    }
    if (values.videoFile && uploadDelegateEventMedia) {
      videoUrl = await uploadDelegateEventMedia(sb, values.videoFile, "video");
    }
    return { imageUrl, videoUrl };
  }

  function mapRpcInsertError(err) {
    if (!err) return "تعذر الحفظ حالياً، حاول لاحقاً أو تواصل مع الإدارة.";
    const isRpcMissingError = h("isRpcMissingError");
    const isCaseTypesTextAndDateMismatchError = h("isCaseTypesTextAndDateMismatchError");
    if (isRpcMissingError && isRpcMissingError(err)) {
      return "تعذر الحفظ حالياً، حاول لاحقاً أو تواصل مع الإدارة.";
    }
    if (isCaseTypesTextAndDateMismatchError && isCaseTypesTextAndDateMismatchError(err)) {
      return "تعذر الحفظ حالياً، حاول لاحقاً أو تواصل مع الإدارة.";
    }
    const msg = String(err && err.message ? err.message : "");
    if (msg.toLowerCase().includes("not allowed")) {
      if (err && err.arabic) return String(err.arabic);
      const fmt = h("formatDelegateDeniedError");
      if (fmt) {
        return fmt({
          reason: err && (err.reason || err.status),
          status: err && err.status,
          requestId: err && err.requestId,
          role_key: err && err.role_key,
          operation_key: err && err.operation_key
        }, "events");
      }
      if (err && err.detail === "events_access") {
        const st = String(err.status || err.reason || "");
        const rid = String(err.requestId || "");
        if (st === "disabled") return "حساب المندوب معطّل. تواصل مع الإدارة لإعادة التفعيل.";
        if (st === "no_permission") return "دورك الحالي لا يسمح بالكتابة على المناسبات. اطلب من الإدارة تعديل الصلاحية.";
        if (st === "pending") return rid ? "صلاحية المناسبات قيد المراجعة (رقم الطلب: " + rid + ")." : "صلاحية المناسبات قيد المراجعة.";
        if (st === "rejected") return rid ? "تم رفض صلاحية المناسبات (رقم الطلب: " + rid + ")." : "تم رفض صلاحية المناسبات.";
        if (st === "approved" || st === "bad_secret") return "الصلاحية معتمدة لكن بيانات الدخول لا تطابق بيانات الاعتماد. جرّب تسجيل خروج/دخول وتأكد من البريد والجوال.";
      }
      return "لا توجد صلاحية لإضافة المناسبات لهذا المندوب.";
    }
    return "تعذر الحفظ حالياً، حاول لاحقاً أو تواصل مع الإدارة.";
  }

  function fillFormFromRow(formWrap, category, row) {
    if (!formWrap || !row) return;
    const resolveEventDateInputValue = h("resolveEventDateInputValue");
    const getEventVisibilityDays = h("getEventVisibilityDays");
    const parseHealthDetails = h("parseHealthDetails");
    const parseDeathDetails = h("parseDeathDetails");
    const parseDelegateHappyDetails = h("parseDelegateHappyDetails");
    const getHappyDetailsText = h("getHappyDetailsText");
    const q = (sel) => formWrap.querySelector(sel);
    const set = (sel, val) => {
      const el = q(sel);
      if (el) el.value = val == null ? "" : String(val);
    };

    set("[data-em-person]", row.person || "");
    set("[data-em-date]", resolveEventDateInputValue ? resolveEventDateInputValue(row) : "");
    set("[data-em-show-days]", String(getEventVisibilityDays ? getEventVisibilityDays(row) : 7));
    const Vis = typeof window !== "undefined" ? window.AlzidanEventVisibility : null;
    const before =
      Vis && typeof Vis.getShowBeforeDays === "function"
        ? Vis.getShowBeforeDays(row)
        : 3;
    set("[data-em-show-before]", String(before));
    const showAtRaw =
      (row && (row.show_at || row.showAt)) ||
      (Vis && Vis.resolveScheduleWindow
        ? null
        : null);
    if (showAtRaw) {
      try {
        const d = new Date(String(showAtRaw));
        if (Number.isFinite(d.getTime())) {
          const local =
            d.getFullYear() +
            "-" +
            String(d.getMonth() + 1).padStart(2, "0") +
            "-" +
            String(d.getDate()).padStart(2, "0") +
            "T" +
            String(d.getHours()).padStart(2, "0") +
            ":" +
            String(d.getMinutes()).padStart(2, "0");
          set("[data-em-show-at]", local);
        }
      } catch (_) {}
    }
    set("[data-em-type]", row.type || "");

    if (category === "happy") {
      const d = parseDelegateHappyDetails ? parseDelegateHappyDetails(row) : {};
      set("[data-em-text]", getHappyDetailsText ? getHappyDetailsText(row) : "");
      set("[data-em-image-url]", d.imageUrl || d.image_url || d.photoUrl || d.photo_url || "");
      set("[data-em-video-url]", d.videoUrl || d.video_url || "");
      return;
    }
    if (category === "sick") {
      const health = parseHealthDetails ? parseHealthDetails(row) : {};
      const place = health.place === "home" ? "home" : "hospital";
      set("[data-em-place]", place);
      set("[data-em-hospital-name]", row.hospital_name || row.hospitalName || health.hospitalName || "");
      set("[data-em-hospital-dept]", row.hospital_dept || row.hospitalDept || health.hospitalDept || "");
      set("[data-em-home-city]", health.homeCity || "");
      set("[data-em-home-area]", health.homeArea || "");
      set("[data-em-notes]", health.notes || "");
      const placeEl = q("[data-em-place]");
      const hospitalFields = q("[data-em-hospital-fields]");
      const homeFields = q("[data-em-home-fields]");
      const isHome = place === "home";
      if (hospitalFields) hospitalFields.style.display = isHome ? "none" : "";
      if (homeFields) homeFields.style.display = isHome ? "" : "none";
      if (placeEl) placeEl.value = place;
      return;
    }
    const death = parseDeathDetails ? parseDeathDetails(row) : {};
    set("[data-em-prayer-place]", death.prayerPlace || "");
    set("[data-em-prayer-time]", death.prayerTime || "");
    set("[data-em-burial-place]", death.burialPlace || "");
    set("[data-em-burial-time]", death.burialTime || "");
    set("[data-em-condolence-place]", death.condolencePlace || "");
    set("[data-em-condolence-time]", death.condolenceTime || "");
    set(
      "[data-em-phones]",
      Array.isArray(death.phones) ? death.phones.filter(Boolean).join("\n") : ""
    );
    set("[data-em-notes]", death.notes || "");
  }

  function buildDelegateEventsApi() {
    return {
      getBranchKey: () => {
        const getBranchKey = h("getBranchKey");
        return getBranchKey ? getBranchKey() : "";
      },
      loadRecentEvents: async (category) => {
        const getBranchKey = h("getBranchKey");
        const branch = getBranchKey ? getBranchKey() : "";
        const rows = await fetchCategoryRows(category, branch);
        rowsByCategory[category] = rows;
        const normalizePersonName = h("normalizePersonName");
        return rows.map((row) => ({
          id: rowId(row),
          type: row.type || "",
          person: normalizePersonName ? normalizePersonName(row.person || "") : row.person || "",
        }));
      },
      loadEventForEdit: async (id) => {
        const panel = eventsMgmtPanel;
        const category = panel && typeof panel.getCategory === "function" ? panel.getCategory() : "happy";
        return findRowById(category, id);
      },
      fillFormFromRow: fillFormFromRow,
      saveEvent: async ({ category, editingId, values }) => {
        const getBranchKey = h("getBranchKey");
        const getClient = h("getClient");
        const normalizePersonName = h("normalizePersonName");
        const formatDateISO = h("formatDateISO");
        const todayGregorianISO = h("todayGregorianISO");
        const formatEventText = h("formatEventText");
        const clampVisibilityDays = h("clampVisibilityDays");
        const touchEventsRefresh = h("touchEventsRefresh");
        const maybeOpenEmailDraft = h("maybeOpenEmailDraft");
        const rpcInsertFamilyEventRow = h("rpcInsertFamilyEventRow");
        const rpcUpdateFamilyEventRow = h("rpcUpdateFamilyEventRow");
        const getEventPk = h("getEventPk");

        const branch = getBranchKey ? getBranchKey() : "";
        if (!branch) return { ok: false, message: "يلزم تسجيل دخول المندوب أولاً." };

        const v = values || {};
        const type = String(v.type || "").trim();
        const person = normalizePersonName ? normalizePersonName(v.person || "") : String(v.person || "").trim();
        if (category !== "death" && (!type || !person)) {
          return { ok: false, message: category === "sick" ? "يرجى اختيار نوع الحالة وكتابة اسم الشخص." : "يرجى اختيار نوع المناسبة وكتابة اسم الشخص." };
        }
        if (category === "happy") {
          const FormCore = window.AlzidanEventFormCore || {};
          const allowed =
            typeof FormCore.isAllowedHappyType === "function"
              ? FormCore.isAllowedHappyType(type)
              : type !== "engagement" && type !== "خطوبة";
          if (!allowed) {
            return { ok: false, message: "نوع المناسبة غير مسموح. اختر نوعًا من القائمة." };
          }
        }
        if (category === "sick") {
          const FormCore = window.AlzidanEventFormCore || {};
          if (typeof FormCore.isAllowedSickType === "function" && !FormCore.isAllowedSickType(type)) {
            return { ok: false, message: "نوع الحالة غير مسموح. اختر نوعًا من القائمة." };
          }
        }
        if (category === "death" && !person) {
          return { ok: false, message: "يرجى كتابة اسم المتوفى." };
        }

        let dateValue = String(v.dateLabel || "").trim();
        if (!dateValue && todayGregorianISO) dateValue = todayGregorianISO();
        const dateLabel = formatDateISO ? formatDateISO(dateValue) : dateValue;
        const showDays = clampVisibilityDays ? clampVisibilityDays(v.showDays) : 7;
        const Vis =
          typeof window !== "undefined" ? window.AlzidanEventVisibility : null;
        if (category === "happy" && Vis && typeof Vis.validateEventDateForSubmit === "function") {
          const dateCheck = Vis.validateEventDateForSubmit(dateValue || dateLabel, {
            category: "happy",
            type: type,
            required: true,
          });
          if (!dateCheck || !dateCheck.ok) {
            return {
              ok: false,
              message:
                (dateCheck && dateCheck.reason) ||
                "تاريخ المناسبة منتهٍ ولا يمكن إرسالها. اختر تاريخًا اليوم أو لاحقًا.",
            };
          }
        }
        const showBeforeDays =
          Vis && typeof Vis.clampShowBeforeDays === "function"
            ? Vis.clampShowBeforeDays(
                v.showBeforeDays != null ? v.showBeforeDays : v.show_before_days,
                Vis.DEFAULT_SHOW_BEFORE_DAYS || 3
              )
            : 3;
        const showAt = String(v.showAt || v.show_at || "").trim();
        const endAt = String(v.endAt || v.end_at || "").trim();

        const sb = getClient ? getClient() : null;
        if (!sb) return { ok: false, message: "تعذر الحفظ حالياً، حاول لاحقاً أو تواصل مع الإدارة." };

        let payloadValues = Object.assign({}, v, {
          branch,
          type: category === "death" ? "death" : type,
          person,
          dateLabel,
          eventDate: dateValue,
          showDays,
          showBeforeDays,
          show_before_days: showBeforeDays,
          showAt: showAt || undefined,
          show_at: showAt || undefined,
          endAt: endAt || undefined,
          end_at: endAt || undefined,
        });

        if (category === "happy") {
          const detailsText = String(v.text || "").trim();
          const looksLikeMessage =
            detailsText &&
            (detailsText.split(/\s+/).filter(Boolean).length >= 4 ||
              detailsText.includes("مبروك") ||
              detailsText.includes("نبارك") ||
              detailsText.includes("تهانينا"));
          const baseHappyText = formatEventText ? formatEventText({ type, person }) : "";
          const storedText = looksLikeMessage ? detailsText : baseHappyText;
          try {
            const oldRow = editingId ? findRowById(category, editingId) : null;
            const media = await resolveHappyMedia(sb, v, oldRow);
            payloadValues.text = storedText || "";
            payloadValues.extra = looksLikeMessage ? "" : detailsText;
            payloadValues.imageUrl = media.imageUrl || "";
            payloadValues.videoUrl = media.videoUrl || "";
          } catch (e) {
            return { ok: false, message: (e && e.message) || "تعذر رفع المرفقات." };
          }
        }

        if (category === "death") {
          const normalizePhonesForDisplay = h("normalizePhonesForDisplay");
          payloadValues.phones = normalizePhonesForDisplay
            ? normalizePhonesForDisplay(Array.isArray(v.phones) ? v.phones : [])
            : Array.isArray(v.phones)
              ? v.phones
              : [];
        }

        let patch = null;
        try {
          patch =
            typeof FormCore.buildRowFromForm === "function"
              ? FormCore.buildRowFromForm(category, payloadValues)
              : typeof Events.buildFamilyEventRow === "function"
                ? Events.buildFamilyEventRow(
                    FormCore.buildDelegateFormPayload
                      ? FormCore.buildDelegateFormPayload(category, payloadValues)
                      : payloadValues
                  )
                : null;
        } catch (buildErr) {
          return {
            ok: false,
            message:
              (buildErr && buildErr.message) ||
              "نوع المناسبة غير مسموح. اختر نوعًا من القائمة.",
          };
        }
        if (!patch) {
          return {
            ok: false,
            message:
              category === "happy" || category === "sick"
                ? "نوع المناسبة غير مسموح أو وحدة المناسبات غير محمّلة."
                : "وحدة المناسبات غير محمّلة.",
          };
        }

        if (editingId) {
          const oldRow = findRowById(category, editingId);
          const pk = oldRow && getEventPk ? getEventPk(oldRow) : null;
          if (!pk) return { ok: false, message: "تعذر حفظ التعديل لأن معرف السجل غير متوفر." };
          const res = rpcUpdateFamilyEventRow ? await rpcUpdateFamilyEventRow(sb, pk, patch) : { ok: false };
          if (!res || !res.ok) {
            const err = (res && res.error) || {};
            const msg = String(err && err.message ? err.message : "");
            if (msg.toLowerCase().includes("not allowed")) {
              return { ok: false, message: (res.error && res.error.arabic) ? String(res.error.arabic) : "دورك الحالي لا يسمح بتعديل المناسبات. اطلب من الإدارة تعديل الصلاحية." };
            }
            return { ok: false, message: mapRpcInsertError(err) };
          }
          if (touchEventsRefresh) touchEventsRefresh();
          return { ok: true, message: "تم حفظ التعديل." };
        }

        const row = Object.assign({}, patch, { created_at: new Date().toISOString() });

        const Create = window.AlzidanHomeRequestCreate;
        if (Create && typeof Create.create === "function") {
          const guardType =
            category === "death"
              ? "death"
              : category === "sick"
                ? "health"
                : "event";
          const details =
            typeof Events.parseDetailsValue === "function"
              ? Events.parseDetailsValue(row.details)
              : {};
          const guardPayload = {
            type: row.type || (category === "death" ? "death" : type),
            person: person,
            person_id: String(v.person_id || details.person_id || details.personId || "").trim(),
            date_label: dateLabel,
            event_date: dateValue,
            title: person,
            branch_key: branch,
            hospital_name: row.hospital_name || details.hospitalName || "",
            home_city: details.homeCity || v.homeCity || "",
            home_area: details.homeArea || v.homeArea || "",
          };
          const guarded = await Create.create({
            type: guardType,
            payload: guardPayload,
            client: sb,
            acknowledgeReview: !!v.acknowledge_review,
            performInsert: async function () {
              return rpcInsertFamilyEventRow
                ? await rpcInsertFamilyEventRow(sb, row)
                : { ok: false };
            },
          });
          if (!guarded.ok) {
            return {
              ok: false,
              message:
                (guarded.guard && guarded.guard.message_ar) ||
                (guarded.needsReview
                  ? "سجل مشابه — راجع قبل الحفظ (لا دمج تلقائي)."
                  : "موجود مسبقًا — تعذر الحفظ."),
            };
          }
          const res = guarded.result || {};
          if (!res || !res.ok) {
            return { ok: false, message: mapRpcInsertError((res && res.error) || {}) };
          }
        } else {
          const res = rpcInsertFamilyEventRow ? await rpcInsertFamilyEventRow(sb, row) : { ok: false };
          if (!res || !res.ok) {
            return { ok: false, message: mapRpcInsertError((res && res.error) || {}) };
          }
        }

        if (maybeOpenEmailDraft) {
          if (category === "happy") {
            maybeOpenEmailDraft(
              "مناسبة جديدة (" + type + ")",
              ["مناسبة جديدة", "الفرع: " + branch, "النوع: " + type, "الاسم: " + person, dateLabel ? "التاريخ: " + dateLabel : "", payloadValues.text ? "النص: " + payloadValues.text : ""]
                .filter(Boolean)
                .join("\n")
            );
          } else if (category === "sick") {
            maybeOpenEmailDraft(
              "مناسبة جديدة (" + type + ")",
              ["مناسبة جديدة", "الفرع: " + branch, "النوع: " + type, "الاسم: " + person, dateLabel ? "التاريخ: " + dateLabel : "", payloadValues.notes ? "ملاحظات: " + payloadValues.notes : ""]
                .filter(Boolean)
                .join("\n")
            );
          } else {
            maybeOpenEmailDraft("خبر وفاة جديد", ["خبر وفاة جديد", "الفرع: " + branch, "الاسم: " + person, dateLabel ? "التاريخ: " + dateLabel : ""].filter(Boolean).join("\n"));
          }
        }
        if (touchEventsRefresh) touchEventsRefresh();
        return {
          ok: true,
          message: category === "death" ? "تم نشر خبر الوفاة." : "تمت الإضافة.",
        };
      },
      deleteEvent: async (id) => {
        const getClient = h("getClient");
        const normalizePersonName = h("normalizePersonName");
        const confirmTypedText = h("confirmTypedText");
        const getEventPk = h("getEventPk");
        const rpcDeleteFamilyEventRow = h("rpcDeleteFamilyEventRow");
        const touchEventsRefresh = h("touchEventsRefresh");
        const panel = eventsMgmtPanel;
        const category = panel && typeof panel.getCategory === "function" ? panel.getCategory() : "happy";
        const row = findRowById(category, id);
        if (!row) return { ok: false, message: "تعذر العثور على السجل." };
        const pk = getEventPk ? getEventPk(row) : null;
        if (!pk) return { ok: false, message: "تعذر الحذف." };
        const personName = normalizePersonName ? normalizePersonName(row.person || "") : String(row.person || "");
        const confirmName = personName || "حذف";
        const ok = confirmTypedText
          ? await confirmTypedText(confirmName, {
              title: "تأكيد حذف الخبر",
              body: "لتأكيد الحذف اكتب الاسم التالي بالضبط:",
              confirmLabel: "تأكيد الحذف",
              cancelLabel: "إلغاء",
            })
          : window.confirm("تأكيد حذف الخبر؟");
        if (!ok) return { ok: false, message: "" };
        const sb = getClient ? getClient() : null;
        if (!sb) return { ok: false, message: "تعذر الحذف لأن الربط غير مُعد." };
        const res = rpcDeleteFamilyEventRow ? await rpcDeleteFamilyEventRow(sb, pk) : { ok: false };
        if (!res || !res.ok) {
          const err = (res && res.error) || {};
          const msg = String(err && err.message ? err.message : "");
          if (msg.toLowerCase().includes("not allowed")) {
            return { ok: false, message: (res.error && res.error.arabic) ? String(res.error.arabic) : "دورك الحالي لا يسمح بحذف المناسبات. اطلب من الإدارة تعديل الصلاحية." };
          }
          return { ok: false, message: "تعذر الحذف حالياً، حاول لاحقاً أو تواصل مع الإدارة." };
        }
        if (touchEventsRefresh) touchEventsRefresh();
        return { ok: true, message: "تم الحذف." };
      },
    };
  }

  function mountDelegateEventsManagement(opts) {
    const root = (opts && opts.root) || document.getElementById("events-management-root");
    if (!root) return null;
    if (!window.AlzidanEventsMgmt || typeof window.AlzidanEventsMgmt.mount !== "function") {
      root.innerHTML = '<div class="hint">تعذر تحميل لوحة المناسبات.</div>';
      return null;
    }
    if (eventsMgmtPanel && typeof eventsMgmtPanel.destroy === "function") {
      eventsMgmtPanel.destroy();
    }
    eventsMgmtPanel = window.AlzidanEventsMgmt.mount({
      mode: "delegate",
      root: root,
      api: buildDelegateEventsApi(),
    });
    return eventsMgmtPanel;
  }

  function refreshDelegateEventsLists() {
    if (eventsMgmtPanel && typeof eventsMgmtPanel.refreshList === "function") {
      return eventsMgmtPanel.refreshList();
    }
    return Promise.resolve();
  }

  window.DelegateEventsMgmtBridge = {
    mount: mountDelegateEventsManagement,
    destroy: function () {
      if (eventsMgmtPanel && typeof eventsMgmtPanel.destroy === "function") {
        eventsMgmtPanel.destroy();
      }
      eventsMgmtPanel = null;
      rowsByCategory.happy = [];
      rowsByCategory.sick = [];
      rowsByCategory.death = [];
    },
    refresh: refreshDelegateEventsLists,
  };
})();
