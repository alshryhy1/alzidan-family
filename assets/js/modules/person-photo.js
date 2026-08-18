/**
 * Member personal photo — upload to event-media, save via tree_member_set_photo_v1.
 * No admin approval. Empty URL clears the photo.
 */
(function (root) {
  "use strict";

  var MAX_BYTES = 8 * 1024 * 1024;

  function isSafePersonPhotoUrl(url) {
    var u = String(url || "").trim();
    return /^https?:\/\//i.test(u) && u.indexOf(" ") === -1 && u.indexOf("<") === -1;
  }

  function fileExt(name, fallback) {
    var m = String(name || "")
      .toLowerCase()
      .match(/\.([a-z0-9]+)$/);
    var e = m ? m[1] : "";
    if (["jpg", "jpeg", "png", "webp", "heic", "heif", "gif"].indexOf(e) >= 0) {
      return e === "jpeg" ? "jpg" : e;
    }
    return fallback || "jpg";
  }

  function supabaseUrl() {
    var cfg = root.__alzidanConfig || {};
    return String(cfg.SUPABASE_URL || "").replace(/\/+$/, "");
  }

  function publicStorageUrl(path) {
    return (
      supabaseUrl() +
      "/storage/v1/object/public/event-media/" +
      String(path || "")
        .split("/")
        .map(encodeURIComponent)
        .join("/")
    );
  }

  async function uploadMemberPhoto(sb, file, personId) {
    if (!sb) throw new Error("تعذر الاتصال.");
    if (!file) throw new Error("اختر صورة.");
    if (file.size > MAX_BYTES) throw new Error("حجم الصورة أكبر من 8MB.");
    var type = String(file.type || "");
    if (type && type.indexOf("image/") !== 0) throw new Error("الملف ليس صورة.");
    var id = Number(personId || 0);
    if (!id) throw new Error("تعذر تحديد الشخص.");
    var path =
      "person-photos/" +
      id +
      "/" +
      Date.now() +
      "_" +
      Math.random().toString(36).slice(2) +
      "." +
      fileExt(file.name, "jpg");
    var res = await sb.storage.from("event-media").upload(path, file, {
      contentType: type || "image/jpeg",
      upsert: false,
    });
    if (res.error) throw new Error(res.error.message || "تعذر رفع الصورة.");
    return publicStorageUrl(path);
  }

  async function saveMemberPhoto(sb, phone, photoUrl) {
    if (!sb) throw new Error("تعذر الاتصال.");
    var rpc = await sb.rpc("tree_member_set_photo_v1", {
      p_phone: phone,
      p_photo_url: photoUrl || "",
    });
    if (rpc.error) throw new Error(rpc.error.message || "تعذر حفظ الصورة.");
    if (rpc.data === false) throw new Error("تعذر حفظ الصورة.");
    return true;
  }

  root.AlzidanPersonPhoto = {
    isSafePersonPhotoUrl: isSafePersonPhotoUrl,
    uploadMemberPhoto: uploadMemberPhoto,
    saveMemberPhoto: saveMemberPhoto,
  };
})(typeof window !== "undefined" ? window : globalThis);
