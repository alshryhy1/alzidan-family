(function () { const form = document.querySelector("[data-event-submit-form]");
const alertEl = document.querySelector("[data-event-submit-alert]");
const copyLinkBtn = document.querySelector("[data-event-submit-copy-link]");
const submitBtn = form ? form.querySelector('button[type="submit"]') : null;
const panel = document.getElementById("send-event");
if (!form) return;
const EVENT_MEDIA_MAX_BYTES = 50 * 1024 * 1024;
const EVENT_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"]);
const EVENT_VIDEO_MIME_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const EVENT_IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif", "heic", "heif"]);
const EVENT_VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm"]);
let sbClient = null;
function getالخدمةClient() { if (sbClient) return sbClient;
if (window.__alzidanConfig && typeof window.__alzidanConfig.getClient === "function") { sbClient = window.__alzidanConfig.getClient();
return sbClient;
} if (window.__alzidanالخدمةClient) { sbClient = window.__alzidanالخدمةClient;
return sbClient;
} return null;
}
function normalizeEventText(v) { return String(v || "").replace(/\s+/g, " ").trim();
}
function normalizeEventPhone(v) { return String(v || "") .replace(/[٠-٩]/g, (digit) =>String(digit.charCodeAt(0) - 1632)) .replace(/[۰-۹]/g, (digit) =>String(digit.charCodeAt(0) - 1776)) .replace(/[^\d+]/g, "") .trim();
}
function normalizeEventEmail(v) { return String(v || "").trim().toLowerCase();
}
async function sha256Hex(text) { try { if (!window.crypto || !window.crypto.subtle) return null;
const enc = new TextEncoder();
const buf = await window.crypto.subtle.digest("SHA-256", enc.encode(String(text || "")));
return Array.from(new Uint8Array(buf)) .map((b) =>b.toString(16).padStart(2, "0")) .join("");
} catch (e) { return null;
} }
function makeEventRequestId() { const a = Math.random().toString(36).slice(2, 6).toUpperCase();
const b = Math.random().toString(36).slice(2, 6).toUpperCase();
return "EVN-" + a + "-" + b;
}
function setEventSubmitAlert(type, text) { if (!alertEl) return;
alertEl.className = "founder-alert " + (type === "success" ? "founder-alert-success" : "founder-alert-error");
alertEl.textContent = String(text || "");
alertEl.style.display = "block";
}
function clearEventSubmitAlert() { if (!alertEl) return;
alertEl.className = "founder-alert";
alertEl.textContent = "";
alertEl.style.display = "none";
}
function setEventSubmitBusy(busy) { const isBusy = !!busy;
form.dataset.submitting = isBusy ? "1" : "";
if (!submitBtn) return;
submitBtn.disabled = isBusy;
submitBtn.textContent = isBusy ? "جاري الإرسال..." : "إرسال المناسبة";
}
function eventSubmitUrl() { const origin = location && location.origin ? String(location.origin) : "";
const path = location && location.pathname ? String(location.pathname) : "";
const base = origin && origin !== "null" ? origin + path : location.href.split("#")[0];
return base + "#send-event";
}
function fallbackCopyText(text) { const el = document.createElement("textarea");
el.value = String(text || "");
el.setAttribute("readonly", "");
el.style.position = "fixed";
el.style.opacity = "0";
el.style.left = "-9999px";
document.body.appendChild(el);
el.select();
try { document.execCommand("copy");
} catch (e) {} document.body.removeChild(el);
}
async function copyText(text) { try { if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") { await navigator.clipboard.writeText(String(text || ""));
return true;
} } catch (e) {} fallbackCopyText(text);
return true;
}
function fileExtFromName(name, fallback) { const s = String(name || "");
const idx = s.lastIndexOf(".");
return idx >= 0 ? s.slice(idx + 1).toLowerCase() : fallback;
}
function formatFileSize(bytes) { const n = Number(bytes);
if (!Number.isFinite(n) || n<= 0) return "";
const mb = n / (1024 * 1024);
if (mb >= 1) return mb.toFixed(mb >= 10 ? 0 : 1) + "MB";
return Math.ceil(n / 1024) + "KB";
}
function isAllowedEventMediaFile(file, isImage) { if (!file) return true;
const type = String(file.type || "").trim().toLowerCase();
const ext = fileExtFromName(file.name, "").toLowerCase();
const allowedTypes = isImage ? EVENT_IMAGE_MIME_TYPES : EVENT_VIDEO_MIME_TYPES;
const allowedExts = isImage ? EVENT_IMAGE_EXTENSIONS : EVENT_VIDEO_EXTENSIONS;
return (type && allowedTypes.has(type)) || (ext && allowedExts.has(ext));
}
function publicStorageUrl(path) { const config = window.__alzidanConfig || {}; return String(config.SUPABASE_URL || "").replace(/\/+$/, "") + "/storage/v1/object/public/event-media/" + String(path || "").split("/").map(encodeURIComponent).join("/");
}
async function uploadEventMedia(sb, requestId, file, kind) { if (!file) return "";
const isImage = kind === "image";
if (file.size >EVENT_MEDIA_MAX_BYTES) { throw new Error("حجم " + (isImage ? "الصورة" : "الفيديو") + " أكبر من الحد المسموح (" + formatFileSize(EVENT_MEDIA_MAX_BYTES) + ").");
} if (!isAllowedEventMediaFile(file, isImage)) { throw new Error("نوع " + (isImage ? "الصورة" : "الفيديو") + " غير مدعوم.");
} const fallback = isImage ? "jpg" : "mp4";
const path = String(requestId || makeEventRequestId()) + "/" + kind + "-" + Date.now() + "." + fileExtFromName(file.name, fallback);
const { error } = await sb.storage.from("event-media").upload(path, file, { contentType: file.type || (isImage ? "image/jpeg" : "video/mp4"), upsert: false });
if (error) { throw new Error("تعذر رفع " + (isImage ? "الصورة" : "الفيديو") + " حالياً، حاول لاحقاً.");
} return publicStorageUrl(path);
}
function validatePlayableVideoFile(file) { return new Promise((resolve) =>{ if (!file) { resolve(true);
return;
} const url = URL.createObjectURL(file);
const video = document.createElement("video");
let settled = false;
const done = (ok) =>{ if (settled) return;
settled = true;
try { URL.revokeObjectURL(url);
} catch (e) {} resolve(Boolean(ok));
};
video.preload = "metadata";
video.muted = true;
video.playsInline = true;
video.onloadedmetadata = () =>{ done(Number.isFinite(video.duration) && video.duration >0);
};
video.onerror = () =>done(false);
setTimeout(() =>done(false), 6000);
video.src = url;
try { video.load();
} catch (e) { done(false);
} });
}
function updateSubmitLinks() { return eventSubmitUrl();
}
function openPanelFromHash() { const hash = String(location.hash || "");
if (hash !== "#send-event") return;
if (panel) panel.open = true;
setTimeout(() =>{ if (panel && typeof panel.scrollIntoView === "function") { panel.scrollIntoView({ behavior: "smooth", block: "start" });
} }, 60);
}
function buildEventRow(payload) { const details = { v: 1, kind: "happy_notice", text: payload.text, extra: payload.place, imageUrl: payload.imageUrl, videoUrl: payload.videoUrl, showDays: 7 };
return { type: payload.type, person: payload.person, date_label: payload.dateLabel, event_date: "", details: JSON.stringify(details), created_at: payload.createdAt };
}
function buildEventRequestMessage(payload) { const lines = [];
lines.push("طلب نشر مناسبة في تطبيق عائلة الزيدان");
lines.push("");
lines.push("رقم الطلب: " + payload.requestId);
lines.push("الفرع: " + payload.branch);
lines.push("نوع المناسبة: " + payload.typeLabel);
lines.push("اسم صاحب المناسبة: " + payload.person);
lines.push("التاريخ: " + (payload.dateLabel || ""));
lines.push("المكان: " + (payload.place || ""));
lines.push("رابط الصورة: " + (payload.imageUrl || ""));
lines.push("رابط الفيديو: " + (payload.videoUrl || ""));
lines.push("");
lines.push("النص:");
lines.push(payload.text || "");
lines.push("");
lines.push("بيانات المرسل:");
lines.push("الاسم: " + payload.submitterName);
lines.push("الجوال: " + payload.phone);
lines.push("البريد: " + (payload.email || ""));
lines.push("التاريخ: " + new Date(payload.createdAt).toLocaleString("ar-SA"));
lines.push("");
lines.push("__JSON__:");
lines.push(JSON.stringify({ v: 1, kind: "event_card", event: buildEventRow(payload), submitter: payload }, null, 2));
return lines.join("\n");
} updateSubmitLinks();
openPanelFromHash();
window.addEventListener("hashchange", openPanelFromHash);
if (copyLinkBtn) { copyLinkBtn.addEventListener("click", async () =>{ await copyText(eventSubmitUrl());
setEventSubmitAlert("success", "تم نسخ رابط إرسال المناسبة. انشره في قروب الواتساب.");
});
} form.addEventListener("submit", async (event) =>{ event.preventDefault();
if (form.dataset.submitting === "1") return;
setEventSubmitBusy(true);
try { clearEventSubmitAlert();
const branch = normalizeEventText(form.querySelector('[name="branch"]')?.value);
const type = normalizeEventText(form.querySelector('[name="type"]')?.value);
const typeLabel = normalizeEventText(form.querySelector('[name="type"] option:checked')?.textContent);
const person = normalizeEventText(form.querySelector('[name="person"]')?.value);
const dateLabel = normalizeEventText(form.querySelector('[name="dateLabel"]')?.value);
const place = normalizeEventText(form.querySelector('[name="place"]')?.value);
const imageUrl = normalizeEventText(form.querySelector('[name="imageUrl"]')?.value);
const videoUrl = normalizeEventText(form.querySelector('[name="videoUrl"]')?.value);
const imageFile = form.querySelector('[name="imageFile"]')?.files?.[0] || null;
const videoFile = form.querySelector('[name="videoFile"]')?.files?.[0] || null;
const text = normalizeEventText(form.querySelector('[name="text"]')?.value);
const submitterName = normalizeEventText(form.querySelector('[name="submitterName"]')?.value);
const phone = normalizeEventPhone(form.querySelector('[name="phone"]')?.value);
const email = normalizeEventEmail(form.querySelector('[name="email"]')?.value);
const secret = normalizeEventText(form.querySelector('[name="secret"]')?.value);
if (!branch || !type || !person || !text || !submitterName || !phone) { setEventSubmitAlert("error", "أكمل الفرع ونوع المناسبة والاسم والنص وبيانات المرسل.");
return;
} if (phone.length< 9) { setEventSubmitAlert("error", "رقم الجوال غير صحيح.");
return;
} if (email && (!email.includes("@") || !email.includes("."))) { setEventSubmitAlert("error", "البريد الإلكتروني غير صحيح أو اتركه فارغًا.");
return;
} if (imageUrl && !/^https?:\/\//i.test(imageUrl)) { setEventSubmitAlert("error", "رابط الصورة يجب أن يبدأ بـ http أو https.");
return;
} if (videoUrl && !/^https?:\/\//i.test(videoUrl)) { setEventSubmitAlert("error", "رابط الفيديو يجب أن يبدأ بـ http أو https.");
return;
} if (videoFile) { const canPlayVideo = await validatePlayableVideoFile(videoFile);
if (!canPlayVideo) { setEventSubmitAlert("error", "هذا الفيديو لا يعمل داخل Chrome. ارفعه من التطبيق بعد التحديث ليُرسل بصيغة مناسبة للويب، أو اختر ملف MP4 بترميز H.264.");
return;
} } const sb = getالخدمةClient();
if (!sb) { setEventSubmitAlert("error", "تعذر الإرسال لأن الربط غير مُعد.");
return;
} const requestId = makeEventRequestId();
let uploadedImageUrl = "";
let uploadedVideoUrl = "";
try { uploadedImageUrl = await uploadEventMedia(sb, requestId, imageFile, "image");
uploadedVideoUrl = await uploadEventMedia(sb, requestId, videoFile, "video");
} catch (uploadError) { setEventSubmitAlert("error", uploadError.message || "تعذر رفع الوسائط.");
return;
} const payload = { requestId, createdAt: new Date().toISOString(), branch, type, typeLabel, person, dateLabel, place, imageUrl: uploadedImageUrl || imageUrl, videoUrl: uploadedVideoUrl || videoUrl, text, submitterName, phone, email };
const eventRow = buildEventRow(payload);
if (secret) { const secretHash = await sha256Hex(secret);
if (!secretHash) { setEventSubmitAlert("error", "تعذر التحقق من رمز المندوب على هذا الجهاز. جرّب متصفحًا آخر أو حدّث الصفحة.");
return;
} const { data, error } = await sb.rpc("family_events_insert_v1", { p_branch_key: branch, p_phone: phone, p_email: email || "", p_secret_hash: secretHash, p_row: eventRow });
if (error) { setEventSubmitAlert("error", "تعذر النشر المباشر حالياً، حاول لاحقاً.");
return;
} if (data === true) { form.reset();
updateSubmitLinks();
try { localStorage.setItem("alzidan_events_refresh_v1", String(Date.now()));
} catch (e) {} setEventSubmitAlert("success", "تم نشر المناسبة مباشرة في التطبيق.");
return;
} setEventSubmitAlert("error", "رمز المندوب غير صحيح أو غير مخول لهذا الفرع.");
return;
} const message = buildEventRequestMessage(payload);
const { error } = await sb.from("approval_requests").insert({ request_id: payload.requestId, kind: "event_card", branch_key: branch, name: submitterName, phone, email: email || null, message, status: "pending", created_at: payload.createdAt });
await copyText(message);
if (error) { setEventSubmitAlert("error", "تعذر إرسال المناسبة للمراجعة حالياً، حاول لاحقاً.");
return;
} try { await sb.functions.invoke("alzidan-email-notify", { body: { mode: "new_request", record: { request_id: payload.requestId, kind: "event_card", branch_key: branch, name: submitterName, phone, email: email || null, message, status: "pending", created_at: payload.createdAt } } });
} catch (notifyError) {}
form.reset();
updateSubmitLinks();
setEventSubmitAlert("success", "تم إرسال المناسبة للإدارة للمراجعة. تم نسخ نص الطلب أيضًا.");
} finally { setEventSubmitBusy(false);
} });
})();

