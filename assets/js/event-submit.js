(function () {
  const EVENT_MEDIA_MAX_BYTES = 50 * 1024 * 1024;
  const EVENT_IMAGE_MIME_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/heic",
    "image/heif",
  ]);
  const EVENT_VIDEO_MIME_TYPES = new Set([
    "video/mp4",
    "video/quicktime",
    "video/webm",
  ]);
  const EVENT_IMAGE_EXTENSIONS = new Set([
    "jpg",
    "jpeg",
    "png",
    "webp",
    "gif",
    "heic",
    "heif",
  ]);
  const EVENT_VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm"]);
  const BRANCHES = ["زيدان", "مزيد", "زايد", "لاحم", "ملحم"];
  const HEALTH_TYPES = new Set(["sick", "operation", "discharge"]);
  const PERSON_SEARCH_LIMIT = 8;
  const FormCore =
    typeof window !== "undefined" ? window.AlzidanEventFormCore || {} : {};

  function isAllowedOccasionType(type) {
    if (typeof FormCore.isAllowedHappyType === "function") {
      return FormCore.isAllowedHappyType(type);
    }
    if (typeof FormCore.isBlockedNewEventType === "function") {
      if (FormCore.isBlockedNewEventType(type)) return false;
    }
    const key = String(type || "").trim();
    if (!key || key === "engagement" || key === "خطوبة") return false;
    const fallback = new Set([
      "birth",
      "contract",
      "marriage",
      "graduation",
      "success",
      "promotion",
      "new_house",
      "travel",
      "gathering",
    ]);
    return fallback.has(key);
  }

  function syncOccasionTypeSelect(form) {
    const select =
      form &&
      (form.querySelector("#event-submit-type") ||
        form.querySelector('[name="type"]'));
    if (!select) return;
    if (typeof FormCore.fillHappyTypeSelect === "function") {
      FormCore.fillHappyTypeSelect(select, {
        selected: select.value || "",
        placeholder: "اختر النوع",
      });
    } else {
      Array.from(select.options || []).forEach(function (opt) {
        const v = String(opt.value || "").trim();
        if (v === "engagement" || opt.textContent.trim() === "خطوبة") {
          opt.remove();
        }
      });
    }
  }

  function normalizeBranchKey(v) {
    const s = normalizeEventText(v);
    if (!s) return "";
    if (BRANCHES.indexOf(s) >= 0) return s;
    // Allow الـ prefix: المزيد → مزيد
    if (s.charAt(0) === "ا" && s.charAt(1) === "ل") {
      const stripped = s.slice(2);
      if (BRANCHES.indexOf(stripped) >= 0) return stripped;
    }
    return "";
  }

  function isValidBranchKey(v) {
    return !!normalizeBranchKey(v);
  }

  /**
   * From tree search hits, pick a branch only when unambiguous.
   * Returns { branch, personId, ambiguous, matches }.
   */
  function resolveBranchFromMatches(matches) {
    const list = Array.isArray(matches) ? matches : [];
    const cleaned = list
      .map(function (row) {
        const branch = normalizeBranchKey(row && (row.branch_key || row.branch));
        if (!branch) return null;
        return {
          branch: branch,
          personId: normalizeEventText(
            row && (row.person_id || row.personId || "")
          ),
          displayName: normalizeEventText(
            row &&
              (row.display_name ||
                row.person_name ||
                row.child_name ||
                row.name ||
                "")
          ),
          lineage: normalizeEventText(
            row &&
              (row.person_lineage ||
                row.full_name ||
                row.child_name ||
                row.name ||
                "")
          ),
        };
      })
      .filter(Boolean);
    if (!cleaned.length) {
      return { branch: "", personId: "", ambiguous: false, matches: [] };
    }
    const branches = [];
    cleaned.forEach(function (m) {
      if (branches.indexOf(m.branch) < 0) branches.push(m.branch);
    });
    if (branches.length !== 1) {
      return {
        branch: "",
        personId: "",
        ambiguous: true,
        matches: cleaned,
      };
    }
    const branch = branches[0];
    const same = cleaned.filter(function (m) {
      return m.branch === branch;
    });
    let personId = "";
    if (same.length === 1) personId = same[0].personId || "";
    return {
      branch: branch,
      personId: personId,
      ambiguous: false,
      matches: cleaned,
    };
  }

  /** Leaf / last token of a spaced or slash path. */
  function leafToken(name) {
    const s = normalizeEventText(name);
    if (!s) return "";
    if (s.indexOf("/") >= 0) {
      const parts = s.split("/").map(normalizeEventText).filter(Boolean);
      return parts.length ? parts[parts.length - 1] : "";
    }
    const parts = s.split(" ").map(normalizeEventText).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : s;
  }

  /**
   * Soft hint only — never auto-assigns without tree confirmation.
   * Detects trailing branch token in a full Arabic name.
   */
  function hintBranchFromFullName(name) {
    return normalizeBranchKey(leafToken(name));
  }

  let sbClient = null;

  function getClient() {
    if (sbClient) return sbClient;
    if (
      window.__alzidanConfig &&
      typeof window.__alzidanConfig.getClient === "function"
    ) {
      sbClient = window.__alzidanConfig.getClient();
      return sbClient;
    }
    if (window.__alzidanSupabaseClient) {
      sbClient = window.__alzidanSupabaseClient;
      return sbClient;
    }
    if (window.__alzidanالخدمةClient) {
      sbClient = window.__alzidanالخدمةClient;
      return sbClient;
    }
    return null;
  }

  function normalizeEventText(v) {
    return String(v || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeEventDigits(v) {
    return String(v || "")
      .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632))
      .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 1776));
  }

  function normalizeEventPhone(v) {
    return normalizeEventDigits(v)
      .replace(/[^\d+]/g, "")
      .trim();
  }

  function makeEventRequestId(prefix) {
    const a = Math.random().toString(36).slice(2, 6).toUpperCase();
    const b = Math.random().toString(36).slice(2, 6).toUpperCase();
    return String(prefix || "EVN") + "-" + a + "-" + b;
  }

  function fileExtFromName(name, fallback) {
    const s = String(name || "");
    const idx = s.lastIndexOf(".");
    return idx >= 0 ? s.slice(idx + 1).toLowerCase() : fallback;
  }

  function formatFileSize(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return "";
    const mb = n / (1024 * 1024);
    if (mb >= 1) return mb.toFixed(mb >= 10 ? 0 : 1) + "MB";
    return Math.ceil(n / 1024) + "KB";
  }

  function isAllowedEventMediaFile(file, isImage) {
    if (!file) return true;
    const type = String(file.type || "")
      .trim()
      .toLowerCase();
    const ext = fileExtFromName(file.name, "").toLowerCase();
    const allowedTypes = isImage ? EVENT_IMAGE_MIME_TYPES : EVENT_VIDEO_MIME_TYPES;
    const allowedExts = isImage ? EVENT_IMAGE_EXTENSIONS : EVENT_VIDEO_EXTENSIONS;
    return (type && allowedTypes.has(type)) || (ext && allowedExts.has(ext));
  }

  function publicStorageUrl(path) {
    const config = window.__alzidanConfig || {};
    return (
      String(config.SUPABASE_URL || "").replace(/\/+$/, "") +
      "/storage/v1/object/public/event-media/" +
      String(path || "")
        .split("/")
        .map(encodeURIComponent)
        .join("/")
    );
  }

  async function uploadEventMedia(sb, requestId, file, kind) {
    if (!file) return "";
    const isImage = kind === "image";
    if (file.size > EVENT_MEDIA_MAX_BYTES) {
      throw new Error(
        "حجم " +
          (isImage ? "الصورة" : "الفيديو") +
          " أكبر من الحد المسموح (" +
          formatFileSize(EVENT_MEDIA_MAX_BYTES) +
          ")."
      );
    }
    if (!isAllowedEventMediaFile(file, isImage)) {
      throw new Error(
        "نوع " + (isImage ? "الصورة" : "الفيديو") + " غير مدعوم."
      );
    }
    const fallback = isImage ? "jpg" : "mp4";
    const path =
      String(requestId || makeEventRequestId("EVN")) +
      "/" +
      kind +
      "-" +
      Date.now() +
      "." +
      fileExtFromName(file.name, fallback);
    const { error } = await sb.storage.from("event-media").upload(path, file, {
      contentType: file.type || (isImage ? "image/jpeg" : "video/mp4"),
      upsert: false,
    });
    if (error) {
      throw new Error(
        "تعذر رفع " + (isImage ? "الصورة" : "الفيديو") + " حالياً، حاول لاحقاً."
      );
    }
    return publicStorageUrl(path);
  }

  function validatePlayableVideoFile(file) {
    return new Promise((resolve) => {
      if (!file) {
        resolve(true);
        return;
      }
      const url = URL.createObjectURL(file);
      const video = document.createElement("video");
      let settled = false;
      const done = (ok) => {
        if (settled) return;
        settled = true;
        try {
          URL.revokeObjectURL(url);
        } catch (e) {}
        resolve(Boolean(ok));
      };
      video.preload = "metadata";
      video.muted = true;
      video.playsInline = true;
      video.onloadedmetadata = () => {
        done(Number.isFinite(video.duration) && video.duration > 0);
      };
      video.onerror = () => done(false);
      setTimeout(() => done(false), 6000);
      video.src = url;
      try {
        video.load();
      } catch (e) {
        done(false);
      }
    });
  }

  function fallbackCopyText(text) {
    const el = document.createElement("textarea");
    el.value = String(text || "");
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.opacity = "0";
    el.style.left = "-9999px";
    document.body.appendChild(el);
    el.select();
    try {
      document.execCommand("copy");
    } catch (e) {}
    document.body.removeChild(el);
  }

  async function copyText(text) {
    try {
      if (
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === "function"
      ) {
        await navigator.clipboard.writeText(String(text || ""));
        return true;
      }
    } catch (e) {}
    fallbackCopyText(text);
    return true;
  }

  function buildEventRequestMessage(payload, mode) {
    const isPatient = mode === "patient";
    const isDeath = mode === "death";
    const lines = [];
    if (isDeath) {
      lines.push("طلب نشر إعلان وفاة في تطبيق عائلة الزيدان");
    } else if (isPatient) {
      lines.push("طلب نشر حالة مرضية في تطبيق عائلة الزيدان");
    } else {
      lines.push("طلب نشر مناسبة في تطبيق عائلة الزيدان");
    }
    lines.push("");
    lines.push("رقم الطلب: " + payload.requestId);
    lines.push("الفرع: " + (payload.branch || ""));
    if (isDeath) {
      lines.push("النوع: وفاة");
      lines.push("اسم المتوفى: " + payload.person);
    } else {
      lines.push(
        (isPatient ? "نوع الحالة: " : "نوع المناسبة: ") + payload.typeLabel
      );
      lines.push(
        (isPatient ? "اسم المريض: " : "اسم صاحب المناسبة: ") + payload.person
      );
    }
    lines.push("التاريخ: " + (payload.dateLabel || ""));
    lines.push(
      (isPatient ? "المستشفى / المكان: " : "المكان: ") + (payload.place || "")
    );
    if (!isPatient && !isDeath) {
      // Only emit media lines when a real URL exists — empty "رابط الفيديو:" was
      // previously mis-parsed as videoUrl="النص:" and rendered a black <video>.
      if (payload.imageUrl) lines.push("رابط الصورة: " + payload.imageUrl);
      if (payload.videoUrl) lines.push("رابط الفيديو: " + payload.videoUrl);
    }
    lines.push("");
    lines.push(isPatient || isDeath ? "الملاحظات:" : "النص:");
    lines.push(payload.text || "");
    lines.push("");
    lines.push("بيانات المرسل:");
    lines.push("الجوال: " + payload.phone);
    lines.push("التاريخ: " + new Date(payload.createdAt).toLocaleString("ar-SA"));
    lines.push("");
    lines.push("__JSON__:");
    const Events = window.AlzidanEvents || {};
    const eventRow =
      typeof Events.buildFamilyEventRow === "function"
        ? Events.buildFamilyEventRow({
            source: "public_form",
            requestId: payload.requestId,
            branch: payload.branch,
            type: payload.type,
            person: payload.person,
            person_id: payload.personId || "",
            dateLabel: payload.dateLabel,
            text: payload.text,
            place: payload.place,
            hospitalName: isPatient ? payload.place : "",
            phone: payload.phone,
            imageUrl: payload.imageUrl,
            videoUrl: payload.videoUrl,
            createdAt: payload.createdAt,
          })
        : null;
    lines.push(
      JSON.stringify(
        { v: 1, kind: "event_card", event: eventRow, submitter: payload },
        null,
        2
      )
    );
    return lines.join("\n");
  }

  function openPanelFromHash() {
    const hash = String(location.hash || "");
    const Rx = window.AlzidanRequestExperience;
    if (hash === "#send-event" || hash === "#rx-occasion") {
      if (Rx && typeof Rx.openOccasion === "function") {
        Rx.openOccasion();
        return;
      }
    }
    if (hash === "#send-patient" || hash === "#rx-patient") {
      if (Rx && typeof Rx.openPatient === "function") {
        Rx.openPatient();
        return;
      }
    }
    if (hash === "#send-death" || hash === "#rx-death") {
      if (Rx && typeof Rx.openDeath === "function") {
        Rx.openDeath();
        return;
      }
    }
  }

  function alertSelector(mode) {
    if (mode === "patient") return "[data-patient-submit-alert]";
    if (mode === "death") return "[data-death-submit-alert]";
    return "[data-event-submit-alert]";
  }

  function requestIdPrefix(mode) {
    if (mode === "patient") return "HLT";
    if (mode === "death") return "DTH";
    return "EVN";
  }

  function bindSubmitForm(form, mode) {
    if (!form) return;
    bindPersonSuggest(form);
    const isPatient = mode === "patient";
    const isDeath = mode === "death";
    if (!isPatient && !isDeath) syncOccasionTypeSelect(form);
    const alertEl = form.querySelector(alertSelector(mode));
    const submitBtn = form.querySelector('button[type="submit"]');

    function setAlert(type, text) {
      if (!alertEl) return;
      alertEl.className =
        "founder-alert " +
        (type === "success" ? "founder-alert-success" : "founder-alert-error");
      alertEl.textContent = String(text || "");
      alertEl.style.display = "block";
    }

    function clearAlert() {
      if (!alertEl) return;
      alertEl.className = "founder-alert";
      alertEl.textContent = "";
      alertEl.style.display = "none";
    }

    function setBusy(busy) {
      const isBusy = !!busy;
      form.dataset.submitting = isBusy ? "1" : "";
      if (!submitBtn) return;
      submitBtn.disabled = isBusy;
      submitBtn.textContent = isBusy ? "جاري الإرسال..." : "إرسال";
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (form.dataset.submitting === "1") return;
      setBusy(true);
      try {
        clearAlert();

        let type = normalizeEventText(
          form.querySelector('[name="type"]')?.value
        );
        let typeLabel = normalizeEventText(
          form.querySelector('[name="type"] option:checked')?.textContent
        );
        if (isDeath) {
          type = "death";
          typeLabel = "وفاة";
        }
        const person = normalizeEventText(
          form.querySelector('[name="person"]')?.value
        );
        const dateLabel = normalizeEventText(
          form.querySelector('[name="dateLabel"]')?.value
        );
        const place = normalizeEventText(
          form.querySelector('[name="place"]')?.value
        );
        const imageFile =
          form.querySelector('[name="imageFile"]')?.files?.[0] || null;
        const videoFile =
          form.querySelector('[name="videoFile"]')?.files?.[0] || null;
        const text = normalizeEventText(
          form.querySelector('[name="text"]')?.value
        );
        const phone = normalizeEventPhone(
          form.querySelector('[name="phone"]')?.value
        );
        const branchRaw = normalizeEventText(
          form.querySelector('[name="branch"]')?.value
        );
        const branch = normalizeBranchKey(branchRaw);
        const personId = normalizeEventText(
          form.querySelector('[name="personId"]')?.value ||
            form.querySelector("[data-event-person-id]")?.value
        );

        if (!branch) {
          setAlert(
            "error",
            "اختر الفرع حتى يصل الطلب لمندوب الفرع الصحيح."
          );
          return;
        }
        if (isDeath) {
          if (!person || !phone || !dateLabel) {
            setAlert(
              "error",
              "أكمل اسم المتوفى ورقم الجوال والتاريخ."
            );
            return;
          }
          var VisDeath =
            typeof window !== "undefined" ? window.AlzidanEventVisibility : null;
          if (VisDeath && typeof VisDeath.validateEventDateForSubmit === "function") {
            var deathDateCheck = VisDeath.validateEventDateForSubmit(dateLabel, {
              category: "death",
              type: "death",
              required: true,
            });
            if (!deathDateCheck || !deathDateCheck.ok) {
              setAlert(
                "error",
                (deathDateCheck && deathDateCheck.reason) ||
                  "أدخل تاريخ الوفاة. بدونه لا يُحدد وقت الظهور."
              );
              return;
            }
          }
        } else if (isPatient) {
          if (!person || !phone || !type || !dateLabel) {
            setAlert(
              "error",
              "أكمل اسم المريض ورقم الجوال ونوع الحالة والتاريخ."
            );
            return;
          }
          if (!HEALTH_TYPES.has(type)) {
            setAlert("error", "اختر نوع حالة صحيحًا (مريض / عملية / خروج).");
            return;
          }
          var VisHealth =
            typeof window !== "undefined" ? window.AlzidanEventVisibility : null;
          if (VisHealth && typeof VisHealth.validateEventDateForSubmit === "function") {
            var healthDateCheck = VisHealth.validateEventDateForSubmit(dateLabel, {
              category: "health",
              type: type,
              required: true,
            });
            if (!healthDateCheck || !healthDateCheck.ok) {
              setAlert(
                "error",
                (healthDateCheck && healthDateCheck.reason) ||
                  "أدخل التاريخ. بدونه لا يُحدد وقت ظهور الحالة."
              );
              return;
            }
          }
        } else {
          if (!person || !phone || !type || !dateLabel) {
            setAlert(
              "error",
              "أكمل اسم صاحب المناسبة ورقم الجوال ونوع المناسبة والتاريخ."
            );
            return;
          }
          if (!isAllowedOccasionType(type)) {
            setAlert(
              "error",
              "نوع المناسبة غير مسموح. اختر نوعًا من القائمة."
            );
            return;
          }
          var VisDate =
            typeof window !== "undefined" ? window.AlzidanEventVisibility : null;
          if (VisDate && typeof VisDate.validateEventDateForSubmit === "function") {
            var dateCheck = VisDate.validateEventDateForSubmit(dateLabel, {
              category: "happy",
              type: type,
              required: true,
            });
            if (!dateCheck || !dateCheck.ok) {
              setAlert(
                "error",
                (dateCheck && dateCheck.reason) ||
                  "تاريخ المناسبة منتهٍ ولا يمكن إرسالها. اختر تاريخًا اليوم أو لاحقًا."
              );
              return;
            }
          }
        }
        if (phone.length < 9) {
          setAlert("error", "رقم الجوال غير صحيح.");
          return;
        }
        if (!isPatient && !isDeath && videoFile) {
          const canPlayVideo = await validatePlayableVideoFile(videoFile);
          if (!canPlayVideo) {
            setAlert(
              "error",
              "هذا الفيديو لا يعمل داخل المتصفح. اختر ملف MP4 بترميز H.264."
            );
            return;
          }
        }

        const sb = getClient();
        if (!sb) {
          setAlert("error", "تعذر الإرسال لأن الربط غير مُعد.");
          return;
        }

        const requestId = makeEventRequestId(requestIdPrefix(mode));
        let uploadedImageUrl = "";
        let uploadedVideoUrl = "";
        if (!isPatient && !isDeath) {
          try {
            uploadedImageUrl = await uploadEventMedia(
              sb,
              requestId,
              imageFile,
              "image"
            );
            uploadedVideoUrl = await uploadEventMedia(
              sb,
              requestId,
              videoFile,
              "video"
            );
          } catch (uploadError) {
            var UUp = window.AlzidanUserFacingRequestMessages;
            setAlert(
              "error",
              (UUp && typeof UUp.mapTechnicalErrorToArabic === "function"
                ? UUp.mapTechnicalErrorToArabic(uploadError, "تعذر رفع الوسائط.")
                : null) ||
                "تعذر رفع الوسائط."
            );
            return;
          }
        }

        const payload = {
          requestId,
          createdAt: new Date().toISOString(),
          branch,
          type,
          typeLabel,
          person,
          personId: personId || "",
          dateLabel,
          place,
          imageUrl: uploadedImageUrl,
          videoUrl: uploadedVideoUrl,
          text,
          submitterName: person,
          phone,
          email: "",
          hospitalName: isPatient ? place : "",
        };

        const message = buildEventRequestMessage(payload, mode);
        const Create = window.AlzidanHomeRequestCreate;
        if (!Create || typeof Create.create !== "function") {
          setAlert(
            "error",
            "حارس الهوية غير محمّل. حدّث الصفحة ثم أعد المحاولة."
          );
          return;
        }

        const guardType =
          typeof Create.mapTypeFromEventPayload === "function"
            ? Create.mapTypeFromEventPayload({ type: type })
            : isDeath
              ? "death"
              : isPatient
                ? "health"
                : "event";

        const row = {
          request_id: payload.requestId,
          kind: "event_card",
          branch_key: branch,
          name: person,
          phone,
          email: null,
          message,
          status: "pending",
          created_at: payload.createdAt,
        };

        const created = await Create.create({
          type: guardType,
          payload: {
            type: type,
            person: person,
            person_id: personId || "",
            date_label: dateLabel,
            event_date: dateLabel,
            title: person,
            branch_key: branch,
            text: text,
            place: place,
            hospital_name: isPatient ? place : "",
            hospitalName: isPatient ? place : "",
            phone: phone,
          },
          client: sb,
          mode: "approval",
          row: row,
        });

        if (!created.ok) {
          var UErr = window.AlzidanUserFacingRequestMessages;
          var mapErr = function (raw, fb) {
            return UErr && typeof UErr.mapTechnicalErrorToArabic === "function"
              ? UErr.mapTechnicalErrorToArabic(raw, fb)
              : fb;
          };
          if (created.doubleSubmit) {
            setAlert(
              "error",
              mapErr(
                created.guard && created.guard.message_ar,
                "طلب مكرر — لن يُنشأ طلب ثانٍ."
              )
            );
            return;
          }
          if (created.blocked) {
            setAlert(
              "error",
              mapErr(
                created.guard && created.guard.message_ar,
                isDeath
                  ? "هذه الوفاة مسجلة مسبقًا."
                  : isPatient
                    ? "هذه الحالة مسجلة مسبقًا."
                    : "هذه المناسبة مسجلة مسبقًا."
              )
            );
            return;
          }
          if (created.needsReview) {
            setAlert(
              "error",
              mapErr(
                created.guard && created.guard.message_ar,
                isDeath
                  ? "وفاة مشابهة — راجع اسم المتوفى."
                  : isPatient
                    ? "حالة مشابهة — راجع النوع والشخص والمكان/التاريخ."
                    : "مناسبة مشابهة — راجع النوع والشخص والتاريخ."
              )
            );
            return;
          }
          setAlert(
            "error",
            mapErr(
              created.error || (created.guard && created.guard.message_ar),
              isDeath
                ? "تعذر إرسال إعلان الوفاة للمراجعة حالياً، حاول لاحقاً."
                : isPatient
                  ? "تعذر إرسال الحالة للمراجعة حالياً، حاول لاحقاً."
                  : "تعذر إرسال المناسبة للمراجعة حالياً، حاول لاحقاً."
            )
          );
          return;
        }

        let notifyWarn = "";
        // Branch requests: notify delegates once via branch_delegate mode only
        // (do NOT also call mode=new_request — that would double-email delegates).
        try {
          var CreateNotify = window.AlzidanHomeRequestCreate;
          var UMsg = window.AlzidanUserFacingRequestMessages;
          var branchNotify = null;
          if (CreateNotify && typeof CreateNotify.notifyBranchDelegatesOfRequest === "function") {
            branchNotify = await CreateNotify.notifyBranchDelegatesOfRequest(sb, row);
          } else {
            const inv = await sb.functions.invoke("alzidan-email-notify", {
              body: { mode: "branch_delegate_new_request", record: row },
            });
            branchNotify = {
              ok: !(inv && inv.error),
              emailError: inv && inv.error ? String(inv.error.message || inv.error) : "",
              emailData: inv && inv.data,
            };
            try {
              await sb.functions.invoke("alzidan-push-notify", {
                body: { mode: "branch_delegate_new_request", record: row },
              });
            } catch (_) {}
          }
          var notifyFailed =
            (UMsg &&
              typeof UMsg.didNotifyFail === "function" &&
              UMsg.didNotifyFail(branchNotify)) ||
            (branchNotify && branchNotify.ok === false);
          if (notifyFailed) {
            notifyWarn =
              (UMsg &&
                UMsg.MESSAGES &&
                UMsg.MESSAGES.NOTIFY_FAILURE_AFTER_SAVE) ||
              "تم حفظ طلبك بنجاح، لكن تعذر إرسال إشعار البريد الإلكتروني حاليًا. لا حاجة لإعادة إرسال الطلب.";
            try {
              console.warn("[branch-delegate-notify]", branchNotify);
            } catch (_) {}
          }
        } catch (branchNotifyError) {
          var UMsg2 = window.AlzidanUserFacingRequestMessages;
          notifyWarn =
            (UMsg2 &&
              UMsg2.MESSAGES &&
              UMsg2.MESSAGES.NOTIFY_FAILURE_AFTER_SAVE) ||
            "تم حفظ طلبك بنجاح، لكن تعذر إرسال إشعار البريد الإلكتروني حاليًا. لا حاجة لإعادة إرسال الطلب.";
          try {
            console.warn("[branch-delegate-notify]", branchNotifyError);
          } catch (_) {}
        }

        try {
          const Track = window.AlzidanRxMyRequests;
          if (Track && typeof Track.append === "function") {
            let entry;
            if (isDeath) {
              entry =
                typeof Track.buildDeathEntry === "function"
                  ? Track.buildDeathEntry({
                      requestId: payload.requestId,
                      person: payload.person,
                      dateLabel: payload.dateLabel,
                      place: payload.place,
                      status: "submitted",
                      createdAt: payload.createdAt,
                    })
                  : {
                      requestId: payload.requestId,
                      kind: "event_card",
                      intentLabel: "إعلان وفاة",
                      status: "submitted",
                      summary:
                        "المتوفى: " +
                        payload.person +
                        " · التاريخ: " +
                        payload.dateLabel,
                      person: payload.person,
                      eventType: "وفاة",
                      eventTypeRaw: "death",
                      eventCategory: "death",
                      dateLabel: payload.dateLabel,
                      createdAt: payload.createdAt,
                    };
            } else if (isPatient) {
              entry =
                typeof Track.buildPatientEntry === "function"
                  ? Track.buildPatientEntry({
                      requestId: payload.requestId,
                      person: payload.person,
                      typeLabel: payload.typeLabel || payload.type,
                      type: payload.type,
                      dateLabel: payload.dateLabel,
                      hospital: payload.place,
                      status: "submitted",
                      createdAt: payload.createdAt,
                    })
                  : {
                      requestId: payload.requestId,
                      kind: "event_card",
                      intentLabel: "حالة صحية",
                      status: "submitted",
                      summary:
                        "المريض: " +
                        payload.person +
                        " · النوع: " +
                        (payload.typeLabel || payload.type),
                      person: payload.person,
                      eventType: payload.typeLabel || payload.type,
                      eventCategory: "health",
                      createdAt: payload.createdAt,
                    };
            } else {
              entry =
                typeof Track.buildOccasionEntry === "function"
                  ? Track.buildOccasionEntry({
                      requestId: payload.requestId,
                      person: payload.person,
                      typeLabel: payload.typeLabel || payload.type,
                      type: payload.type,
                      dateLabel: payload.dateLabel,
                      status: "submitted",
                      createdAt: payload.createdAt,
                    })
                  : {
                      requestId: payload.requestId,
                      kind: "event_card",
                      intentLabel: "إضافة مناسبة",
                      status: "submitted",
                      summary:
                        "صاحب المناسبة: " +
                        payload.person +
                        " · النوع: " +
                        (payload.typeLabel || payload.type) +
                        " · التاريخ: " +
                        payload.dateLabel,
                      person: payload.person,
                      eventType: payload.typeLabel || payload.type,
                      dateLabel: payload.dateLabel,
                      createdAt: payload.createdAt,
                    };
            }
            Track.append(entry);
          }
        } catch (trackError) {}

        form.reset();
        var UDone = window.AlzidanUserFacingRequestMessages;
        var okMsg =
          (UDone &&
            typeof UDone.userFacingRequestMessage === "function" &&
            UDone.userFacingRequestMessage(
              isDeath ? "event_death" : isPatient ? "patient" : "event_card",
              "submit_success"
            )) ||
          "تم إرسال طلبك بنجاح، وهو الآن قيد المراجعة.";
        if (notifyWarn) {
          setAlert("success", okMsg + " " + notifyWarn);
        } else {
          setAlert("success", okMsg);
        }
      } finally {
        setBusy(false);
      }
    });
  }

  openPanelFromHash();
  window.addEventListener("hashchange", openPanelFromHash);

  const copyLinkBtn = document.querySelector("[data-event-submit-copy-link]");
  if (copyLinkBtn) {
    copyLinkBtn.addEventListener("click", async () => {
      const origin = location && location.origin ? String(location.origin) : "";
      const path = location && location.pathname ? String(location.pathname) : "";
      const base =
        origin && origin !== "null"
          ? origin + path
          : location.href.split("#")[0];
      await copyText(base + "#send-event");
      const alertEl = document.querySelector("[data-event-submit-alert]");
      if (alertEl) {
        alertEl.className = "founder-alert founder-alert-success";
        alertEl.textContent = "تم نسخ رابط إضافة المناسبة.";
        alertEl.style.display = "block";
      }
    });
  }


  function clearPersonSuggest(box) {
    if (!box) return;
    box.innerHTML = "";
    box.hidden = true;
  }

  function setBranchHint(form, text, show) {
    const hint = form.querySelector("[data-event-branch-hint]");
    if (!hint) return;
    if (text) hint.textContent = text;
    hint.hidden = !show;
  }

  async function searchTreePeople(query, branchKey) {
    const q = normalizeEventText(query);
    if (q.length < 2) return [];
    const sb = getClient();
    if (!sb) return [];
    try {
      const rpc = await sb.rpc("memory_tree_search_v1", {
        p_query: q,
        p_branch_key: branchKey || null,
        p_limit: PERSON_SEARCH_LIMIT,
      });
      if (!rpc.error && rpc.data) {
        let rows = typeof rpc.data === "string" ? JSON.parse(rpc.data) : rpc.data;
        return Array.isArray(rows) ? rows : [];
      }
    } catch (e) {}
    try {
      let fb = sb
        .from("tree_children")
        .select("person_id,branch_key,child_name,name")
        .or("child_name.ilike.%" + q + "%,name.ilike.%" + q + "%")
        .limit(PERSON_SEARCH_LIMIT);
      if (branchKey) fb = fb.eq("branch_key", branchKey);
      const fbRes = await fb;
      if (fbRes.error || !Array.isArray(fbRes.data)) return [];
      return fbRes.data.map(function (r) {
        const lineage = normalizeEventText(r.child_name) || normalizeEventText(r.name);
        return {
          person_id: r.person_id,
          full_name: lineage,
          display_name: leafToken(lineage) || lineage,
          person_lineage: lineage,
          branch_key: r.branch_key,
        };
      });
    } catch (e2) {
      return [];
    }
  }

  function bindPersonSuggest(form) {
    if (!form || form.dataset.personSuggestBound === "1") return;
    const input = form.querySelector("[data-event-person]");
    const box = form.querySelector("[data-event-person-suggest]");
    const idInput = form.querySelector("[data-event-person-id]");
    const branchSelect = form.querySelector("[data-event-branch]");
    if (!input || !box) return;
    form.dataset.personSuggestBound = "1";
    let timer = null;

    function pick(row) {
      const resolved = resolveBranchFromMatches([row]);
      const display =
        normalizeEventText(row.display_name) ||
        leafToken(row.person_lineage || row.full_name || row.child_name || "") ||
        normalizeEventText(row.person_name || "");
      input.value = display;
      if (idInput) idInput.value = normalizeEventText(row.person_id || resolved.personId || "");
      if (branchSelect && resolved.branch) {
        branchSelect.value = resolved.branch;
        setBranchHint(
          form,
          "تم تحديد الفرع من اختيار الشخص في الشجرة — يمكنك تغييره إن لزم.",
          true
        );
      } else if (resolved.ambiguous) {
        setBranchHint(form, "وُجد الاسم في أكثر من فرع — اختر الفرع يدويًا.", true);
      }
      clearPersonSuggest(box);
    }

    input.addEventListener("input", function () {
      if (idInput) idInput.value = "";
      const q = normalizeEventText(input.value);
      clearTimeout(timer);
      if (q.length < 2) {
        clearPersonSuggest(box);
        return;
      }
      timer = setTimeout(async function () {
        const branchKey = normalizeBranchKey(branchSelect && branchSelect.value);
        const rows = await searchTreePeople(q, branchKey || "");
        box.innerHTML = "";
        const useBtn = document.createElement("button");
        useBtn.type = "button";
        useBtn.className = "rx-person-suggest-btn";
        useBtn.innerHTML = "<strong>استخدام: " + q + "</strong>";
        useBtn.addEventListener("click", function () {
          if (idInput) idInput.value = "";
          const hinted = hintBranchFromFullName(q);
          if (branchSelect && hinted && !normalizeBranchKey(branchSelect.value)) {
            branchSelect.value = hinted;
            setBranchHint(form, "اقتراح فرع من الاسم — راجع الاختيار.", true);
          }
          clearPersonSuggest(box);
        });
        box.appendChild(useBtn);
        (rows || []).forEach(function (row) {
          const display =
            normalizeEventText(row.display_name) ||
            leafToken(row.person_lineage || row.full_name || "") ||
            "—";
          const lineage = normalizeEventText(
            row.person_lineage || row.full_name || row.child_name || ""
          );
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "rx-person-suggest-btn";
          btn.innerHTML =
            "<strong>" +
            display +
            "</strong><br><small>" +
            (lineage || row.branch_key || "") +
            "</small>";
          btn.addEventListener("click", function () {
            pick(row);
          });
          box.appendChild(btn);
        });
        box.hidden = false;
      }, 220);
    });

    document.addEventListener("click", function (ev) {
      if (!box.contains(ev.target) && ev.target !== input) clearPersonSuggest(box);
    });
  }

  document
    .querySelectorAll("[data-event-submit-form]")
    .forEach((form) => bindSubmitForm(form, "occasion"));
  document
    .querySelectorAll("[data-patient-submit-form]")
    .forEach((form) => bindSubmitForm(form, "patient"));
  document
    .querySelectorAll("[data-death-submit-form]")
    .forEach((form) => bindSubmitForm(form, "death"));

  window.AlzidanEventSubmitBranch = {
    BRANCHES: BRANCHES,
    normalizeBranchKey: normalizeBranchKey,
    isValidBranchKey: isValidBranchKey,
    resolveBranchFromMatches: resolveBranchFromMatches,
    hintBranchFromFullName: hintBranchFromFullName,
    buildEventRequestMessage: buildEventRequestMessage,
  };
})();
