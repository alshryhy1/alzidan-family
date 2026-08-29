(function (root) {
  "use strict";

  const E = root.AlzidanEvents || {};

  function normalizeText(v) {
    return String(v || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function readMessageLine(message, labels) {
    const wanted = (Array.isArray(labels) ? labels : [labels]).map((label) =>
      normalizeText(label),
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

  function looksLikeClockTimestamp(value) {
    const s = normalizeText(value);
    if (!s) return false;
    if (/مساء|صباح|م\.?\s*$/.test(s)) return true;
    if (/\d{1,2}:\d{2}/.test(s)) return true;
    return false;
  }

  function readSubmitterBlockLine(message, labels) {
    const raw = String(message || "");
    const idx = raw.search(/بيانات المرسل\s*:/);
    if (idx < 0) return "";
    return readMessageLine(raw.slice(idx), labels);
  }

  function firstNonClockDateLabel(message) {
    const labels = ["تاريخ الولادة", "تاريخ الخبر", "تاريخ الحالة", "تاريخ الوفاة", "تاريخ المناسبة", "التاريخ"];
    const lines = String(message || "").split(/\r?\n/);
    for (const rawLine of lines) {
      const line = String(rawLine || "").trim();
      for (const label of labels) {
        const prefix = label + ":";
        if (!line.startsWith(prefix)) continue;
        const val = line.slice(prefix.length).trim();
        if (!val || looksLikeClockTimestamp(val)) continue;
        return val;
      }
    }
    return "";
  }

  function parseJsonEnvelopeFromMessage(message) {
    const marker = "__JSON__:";
    const text = String(message || "");
    const idx = text.indexOf(marker);
    if (idx < 0) return null;
    const raw = text.slice(idx + marker.length).trim();
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      const first = raw.indexOf("{");
      const last = raw.lastIndexOf("}");
      if (first < 0 || last <= first) return null;
      try {
        return JSON.parse(raw.slice(first, last + 1));
      } catch (e2) {
        return null;
      }
    }
  }

  function parseDetailsValue(value) {
    if (!value) return {};
    if (typeof value === "object") return value;
    try {
      const parsed = JSON.parse(String(value));
      return parsed && typeof parsed === "object" ? parsed : { text: String(value || "") };
    } catch (e) {
      return { text: String(value || "") };
    }
  }

  function extractDisplayDetailsFromMessage(raw, event, j) {
    let details = String((event && (event.text || event.extra)) || (j && j.text) || "").trim();
    if (details) return details;

    return raw
      .split("|")
      .map((x) => normalizeText(x))
      .filter(Boolean)
      .filter((x) => !x.includes("__JSON__"))
      .filter((x) => !/^https?:\/\//i.test(x))
      .filter(
        (x) =>
          !/الصورة\s*:|رابط الصورة\s*:|الفيديو\s*:|رابط الفيديو\s*:|بيانات المرسل\s*:|البريد\s*:|الجوال\s*:|رقم الطلب\s*:|الفرع\s*:|التاريخ\s*:|نوع المناسبة\s*:|اسم صاحب المناسبة\s*:/i.test(
            x,
          ),
      )
      .join(" · ")
      .replace(/__JSON__[\s\S]*$/g, "")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/الصورة\s*:\s*/g, "")
      .replace(/رابط الفيديو\s*:\s*/g, "")
      .trim();
  }

  function parseEventCardMessage(input) {
    const msg =
      input && typeof input === "object" && input.message != null
        ? String(input.message)
        : String(input || "");
    const raw = msg;
    if (!raw.trim()) {
      return {
        type: "",
        person: "",
        dateLabel: "",
        eventDate: "",
        text: "",
        detailsText: "",
        imageUrl: "",
        videoUrl: "",
        submitterName: "",
        submitterPhone: "",
        submitterEmail: "",
        envelope: null,
        event: null,
      };
    }

    // Line-based only — never use /\s*/ across newlines (that captured "النص:" as videoUrl).
    const getLabel = (label) => readMessageLine(raw, label);

    const envelope = parseJsonEnvelopeFromMessage(raw);
    const j = envelope && typeof envelope === "object" ? envelope : {};
    const event = j.event && typeof j.event === "object" ? j.event : {};
    const submitter = j.submitter && typeof j.submitter === "object" ? j.submitter : {};
    const media = j.media && typeof j.media === "object" ? j.media : {};
    const mediaLinks = E.extractEventMediaLinks ? E.extractEventMediaLinks(raw) : { image: "", video: "" };
    const detailsObj = parseDetailsValue(event.details);

    const type = normalizeText(
      event.type ||
        j.type ||
        event.typeLabel ||
        j.typeLabel ||
        getLabel("نوع المناسبة") ||
        getLabel("النوع") ||
        "",
    );
    const person = normalizeText(
      event.person ||
        j.person ||
        getLabel("اسم صاحب المناسبة") ||
        getLabel("صاحب المناسبة") ||
        getLabel("اسم المريض") ||
        getLabel("اسم المتوفى") ||
        getLabel("اسم المولود أو الأب") ||
        getLabel("اسم المولود") ||
        getLabel("اسم العريس") ||
        getLabel("اسم الخريج") ||
        "",
    );
    const dateLabel = normalizeText(
      event.dateLabel ||
        event.date_label ||
        j.date_label ||
        j.dateLabel ||
        firstNonClockDateLabel(raw) ||
        "",
    );
    const eventDate = normalizeText(
      event.eventDate || event.event_date || j.event_date || j.eventDate || "",
    );

    const pickImage = (...cands) => {
      for (let i = 0; i < cands.length; i++) {
        const v = normalizeText(cands[i]);
        if (!v) continue;
        // Hard gate — never accept labels/junk; no https fail-open without validator.
        if (typeof E.resolveValidImageUrl === "function") {
          const ok = E.resolveValidImageUrl(v);
          if (ok) return ok;
          continue;
        }
        if (typeof E.isValidImageUrl === "function") {
          if (E.isValidImageUrl(v)) return v;
          continue;
        }
      }
      return "";
    };
    const pickVideo = (...cands) => {
      for (let i = 0; i < cands.length; i++) {
        const v = normalizeText(cands[i]);
        if (!v) continue;
        // Hard gate — empty "رابط الفيديو:" / "النص:" must never become videoUrl.
        if (typeof E.resolveValidVideoUrl === "function") {
          const ok = E.resolveValidVideoUrl(v);
          if (ok) return ok;
          continue;
        }
        if (typeof E.isValidVideoUrl === "function") {
          if (E.isValidVideoUrl(v)) return v;
          continue;
        }
      }
      return "";
    };

    const imageUrl = pickImage(
      media.imageUrl,
      media.image_url,
      event.imageUrl,
      detailsObj.imageUrl,
      detailsObj.image_url,
      getLabel("رابط الصورة"),
      mediaLinks.image,
    );
    const videoUrl = pickVideo(
      media.videoUrl,
      media.video_url,
      event.videoUrl,
      detailsObj.videoUrl,
      detailsObj.video_url,
      getLabel("رابط الفيديو"),
      mediaLinks.video,
    );

    const text = normalizeText(
      detailsObj.text ||
        detailsObj.extra ||
        detailsObj.notes ||
        j.text ||
        getLabel("النص") ||
        getLabel("نص التهنئة / الخبر") ||
        "",
    );
    const detailsText = extractDisplayDetailsFromMessage(raw, event, j) || text;

    return {
      type,
      person,
      dateLabel,
      eventDate,
      text,
      detailsText,
      imageUrl,
      videoUrl,
      submitterName: normalizeText(
        submitter.name ||
          j.submitter_name ||
          j.submitterName ||
          readSubmitterBlockLine(raw, "الاسم") ||
          "",
      ),
      submitterPhone: normalizeText(
        submitter.phone ||
          j.submitter_phone ||
          j.submitterPhone ||
          readSubmitterBlockLine(raw, "الجوال") ||
          getLabel("الجوال") ||
          "",
      ),
      submitterEmail: normalizeText(
        submitter.email ||
          j.submitter_email ||
          j.submitterEmail ||
          readSubmitterBlockLine(raw, "البريد") ||
          getLabel("البريد") ||
          "",
      ),
      envelope: j,
      event,
    };
  }

  root.AlzidanEvents = root.AlzidanEvents || {};
  Object.assign(root.AlzidanEvents, {
    readMessageLine,
    parseJsonEnvelopeFromMessage,
    parseDetailsValue,
    parseEventCardMessage,
  });
})(typeof window !== "undefined" ? window : globalThis);
