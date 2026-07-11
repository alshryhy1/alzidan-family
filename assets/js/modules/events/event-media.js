(function (root) {
  "use strict";

  function extractEventMediaLinks(message) {
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
  });
})(typeof window !== "undefined" ? window : globalThis);
