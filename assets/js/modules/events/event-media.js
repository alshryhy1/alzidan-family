(function (root) {
  "use strict";

  function normalizeText(v) {
    return String(v || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * True only for a real http(s) media URL (not labels like "النص:" captured by buggy parsers).
   * Accepts common video/image extensions or Supabase/public storage paths.
   */
  function isValidHttpMediaUrl(url, kind) {
    const raw = normalizeText(url);
    if (!raw) return false;
    // Reject accidental label/placeholder captures from empty "رابط الفيديو:" lines.
    if (/^(النص|الملاحظات|المكان|التاريخ|الفرع|الجوال|البريد|الاسم|نوع|رابط)\b/i.test(raw)) {
      return false;
    }
    if (/^(null|undefined|none|n\/a|nil|#|\/|\.|0|false|true|about:blank)$/i.test(raw)) {
      return false;
    }
    if (!/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(raw)) return false;

    let path = "";
    let hostname = "";
    try {
      if (typeof URL === "function") {
        const u = new URL(raw);
        if (u.protocol !== "http:" && u.protocol !== "https:") return false;
        path = String(u.pathname || "").toLowerCase();
        hostname = String(u.hostname || "").toLowerCase();
      }
    } catch (_) {
      /* fall through to regex path */
    }
    if (!path) {
      const m = raw.match(/^https?:\/\/([^/?#]+)([^?#]*)/i);
      if (!m) return false;
      hostname = String(m[1] || "").toLowerCase();
      path = String(m[2] || "/").toLowerCase();
    }

    const want = String(kind || "any").toLowerCase();
    const videoExt = /\.(mp4|m4v|webm|mov|ogg|ogv)(?:$|[/?#])/i;
    const imageExt = /\.(jpe?g|png|gif|webp|avif|bmp|svg)(?:$|[/?#])/i;
    const storagePath =
      /\/storage\/v1\/object\/(?:public|sign)\//i.test(path) ||
      /\/event-media\//i.test(path) ||
      /supabase\.co$/i.test(hostname);

    if (want === "video") {
      return videoExt.test(path) || (storagePath && !imageExt.test(path));
    }
    if (want === "image") {
      return imageExt.test(path) || (storagePath && !videoExt.test(path));
    }
    return videoExt.test(path) || imageExt.test(path) || storagePath;
  }

  function isValidVideoUrl(url) {
    return isValidHttpMediaUrl(url, "video");
  }

  function isValidImageUrl(url) {
    return isValidHttpMediaUrl(url, "image");
  }

  /** Hard resolve: empty / labels / junk → "" (never truthy junk for <video src>). */
  function resolveValidVideoUrl(url) {
    const raw = normalizeText(url);
    return raw && isValidVideoUrl(raw) ? raw : "";
  }

  function resolveValidImageUrl(url) {
    const raw = normalizeText(url);
    return raw && isValidImageUrl(raw) ? raw : "";
  }

  /**
   * Delegate/admin request-detail media HTML.
   * Emits <video> only when resolveValidVideoUrl succeeds — never for empty/"النص:"/junk.
   */
  function buildRequestMediaPreviewHtml(input, escapeHtmlFn) {
    const esc =
      typeof escapeHtmlFn === "function"
        ? escapeHtmlFn
        : (v) =>
            String(v || "")
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/"/g, "&quot;");
    const imageUrl = resolveValidImageUrl(input && input.imageUrl);
    const videoUrl = resolveValidVideoUrl(input && input.videoUrl);
    let html = "";
    if (imageUrl) {
      html +=
        '<div style="margin-top:8px;"><img src="' +
        esc(imageUrl) +
        '" alt="" style="max-width:100%;border-radius:12px;" loading="lazy" /></div>';
    }
    if (videoUrl) {
      html +=
        '<div style="margin-top:8px;"><video src="' +
        esc(videoUrl) +
        '" controls preload="metadata" style="max-width:100%;border-radius:12px;"></video></div>';
    }
    return html;
  }

  function extractEventMediaLinks(message) {
    const media = { image: "", video: "" };
    String(message || "")
      .split(/\r?\n/)
      .forEach((rawLine) => {
        const line = rawLine.trim();
        const imageMatch = line.match(/^رابط الصورة\s*:\s*(https?:\/\/\S+)/i);
        const videoMatch = line.match(/^رابط الفيديو\s*:\s*(https?:\/\/\S+)/i);
        if (imageMatch && !media.image && isValidImageUrl(imageMatch[1])) {
          media.image = imageMatch[1];
        }
        if (videoMatch && !media.video && isValidVideoUrl(videoMatch[1])) {
          media.video = videoMatch[1];
        }
      });
    return media;
  }

  function messageWithoutMediaLinks(message) {
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

  root.AlzidanEvents = root.AlzidanEvents || {};
  Object.assign(root.AlzidanEvents, {
    extractEventMediaLinks,
    messageWithoutMediaLinks,
    isValidHttpMediaUrl,
    isValidVideoUrl,
    isValidImageUrl,
    resolveValidVideoUrl,
    resolveValidImageUrl,
    buildRequestMediaPreviewHtml,
  });
})(typeof window !== "undefined" ? window : globalThis);
