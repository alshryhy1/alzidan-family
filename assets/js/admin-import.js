(() => {
  "use strict";

  const Core = window.AlzidanAdminCore || {};
  const {
    showAlert,
    hideAlert,
    copyText,
    downloadTextFile,
    getClient,
    getAdminToken,
    normalizeArabicDigitsToLatin,
    toIntOrNull,
    toIsoDateOrEmpty,
    coerceBool,
    parseCsv,
    pickRowValue,
    truncateText,
    takeLines,
    chunkArray,
  } = Core;

  const treeImportDownloadBtn = document.getElementById("tree-import-download");
  const treeImportTemplateEl = document.getElementById("tree-import-template");
  const treeImportCopyBtn = document.getElementById("tree-import-copy");
  const treeImportWhatsappBtn = document.getElementById("tree-import-whatsapp");
  const treeImportFileEl = document.getElementById("tree-import-file");
  const treeImportRunBtn = document.getElementById("tree-import-run");
  const treeImportStatusEl = document.getElementById("tree-import-status");

  const waFileEl = document.getElementById("wa-file");
  const waFileTextEl = document.getElementById("wa-file-text");
  const waFileStatusEl = document.getElementById("wa-file-status");
  const waFileBuildBtn = document.getElementById("wa-file-build");
  const waFileCopyBtn = document.getElementById("wa-file-copy");
  const waFileOpenBtn = document.getElementById("wa-file-open");

  function treeCsvTemplateText() {
      const bom = "\ufeff";
      const header = [
        "الفرع",
        "اسم_الأب",
        "الاسم_كامل",
        "تاريخ_الميلاد_ميلادي",
        "تاريخ_الميلاد_هجري",
        "سنة_الميلاد",
        "المدينة",
        "الحي",
        "متوفى",
      ].join(",");
      const example = [
        "زيدان",
        "خميس",
        "عبدالله خميس الزيدان",
        "١٩٩٠/٠١/٠١",
        "١٤١٠/٠١/٠١",
        "١٩٩٠",
        "حائل",
        "المدينة/الحي",
        "لا",
      ].join(",");
      return bom + header + "\n" + example + "\n";
    }

  function treeCardTemplateText() {
      const lines = [];
      lines.push("بطاقة إضافة بيانات للشجرة");
      lines.push("");
      lines.push("العائلة (إجباري): زيدان / مزيد / زايد / لاحم / ملحم");
      lines.push("الجد (إجباري): ");
      lines.push("الأب (إجباري): ");
      lines.push("الاسم (إجباري): ");
      lines.push("تاريخ الميلاد (اختياري): ");
      lines.push("المدينة (اختياري): ");
      lines.push("الحي/القرية (اختياري): ");
      lines.push("");
      lines.push("الأبناء (اختياري):");
      lines.push("1- الاسم: — تاريخ الميلاد: ");
      lines.push("2- الاسم: — تاريخ الميلاد: ");
      lines.push("3- الاسم: — تاريخ الميلاد: ");
      lines.push("4- الاسم: — تاريخ الميلاد: ");
      lines.push("5- الاسم: — تاريخ الميلاد: ");
      lines.push("أضف سطوراً أخرى إذا كان عدد الأبناء أكثر.");
      return lines.join("\n");
    }

  function openWhatsAppWithText(text) {
      const t = String(text || "").trim();
      if (!t) return false;
      const url = "https://wa.me/?text=" + encodeURIComponent(t);
      try {
        window.open(url, "_blank", "noopener,noreferrer");
        return true;
      } catch (e) {
        return false;
      }
    }

  function setWaFileStatus(text) {
      if (!waFileStatusEl) return;
      waFileStatusEl.textContent = String(text || "");
    }

  async function readFileAsText(file) {
      if (!file) return "";
      try {
        if (typeof file.text === "function") return await file.text();
      } catch (e) {}
      return await new Promise((resolve) => {
        try {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = () => resolve("");
          reader.readAsText(file);
        } catch (e) {
          resolve("");
        }
      });
    }

  function buildWhatsAppTextFromFile(file, text) {
      const f = file || null;
      const name = f && f.name ? String(f.name || "") : "file";
      const size = f && f.size != null ? Number(f.size) : 0;
      const sizeKb = isFinite(size) ? Math.max(0, Math.round(size / 1024)) : 0;
      const ext = name.toLowerCase().split(".").pop();
      const raw = String(text || "");
      let snippet = "";
      if (ext === "json") {
        try {
          const parsed = JSON.parse(raw);
          snippet = JSON.stringify(parsed, null, 2);
        } catch (e) {
          snippet = raw;
        }
        snippet = takeLines(snippet, 120, 2400);
      } else if (ext === "csv") {
        snippet = takeLines(raw, 35, 2400);
      } else {
        snippet = takeLines(raw, 60, 2400);
      }
      const lines = [];
      lines.push("ملف: " + name);
      if (sizeKb) lines.push("الحجم: " + String(sizeKb) + "KB");
      lines.push("");
      lines.push("محتوى مختصر:");
      lines.push(snippet || "(فارغ)");
      return truncateText(lines.join("\n"), 3600);
    }

  function setTreeImportStatus(text) {
      if (!treeImportStatusEl) return;
      treeImportStatusEl.textContent = String(text || "");
    }

  async function runTreeImportFromFile(file) {
      const sb = getClient();
      if (!sb) {
        showAlert("error", "تعذر الاتصال.");
        return;
      }
      const token = getAdminToken();
      if (!token) {
        showAlert("error", "يلزم تسجيل الدخول أولاً.");
        return;
      }
      if (!file) {
        showAlert("error", "اختر ملف CSV أولاً.");
        return;
      }
      setTreeImportStatus("جاري قراءة الملف...");
      const text = await readFileAsText(file);
      const rawRows = parseCsv(text);
      const rows = rawRows
        .map((r) => {
          const row = r || {};
          const branch_key = pickRowValue(row, [
            "branch_key",
            "branch",
            "الفرع",
            "فرع",
            "العائلة",
            "العائله",
            "اسم_العائلة",
            "اسم_العائله",
          ]);
          const parent_name = pickRowValue(row, [
            "parent_name",
            "parent",
            "father",
            "الأب",
            "الاب",
            "اسم_الأب",
            "اسم_الاب",
            "والد",
            "الوالد",
          ]);
          const child_name = pickRowValue(row, [
            "child_name",
            "child",
            "name",
            "الاسم",
            "الاسم_كامل",
            "الاسم_الكامل",
            "الاسم كامل",
            "اسم",
          ]);
          const birth_date_g = toIsoDateOrEmpty(
            pickRowValue(row, [
              "birth_date_g",
              "birth_date",
              "dob",
              "تاريخ_الميلاد",
              "تاريخ الميلاد",
              "تاريخ_الميلاد_ميلادي",
              "الميلاد",
            ]),
          );
          const birth_date_h = pickRowValue(row, [
            "birth_date_h",
            "hijri",
            "تاريخ_الميلاد_هجري",
            "تاريخ_الميلاد_الهجري",
            "هجري",
          ]);
          const city = pickRowValue(row, ["city", "المدينة", "المدينه"]);
          const area = pickRowValue(row, ["area", "الحي", "المنطقة", "المنطقه"]);
          const birthYearRaw = pickRowValue(row, [
            "birth_year",
            "year",
            "سنة_الميلاد",
            "سنه_الميلاد",
            "سنة الميلاد",
            "سنه الميلاد",
          ]);
          const ageRaw = pickRowValue(row, ["age", "العمر", "عمر"]);
          let birth_year = normalizeArabicDigitsToLatin(
            String(birthYearRaw || "").trim(),
          );
          if (!birth_year) {
            const age = toIntOrNull(ageRaw);
            if (age != null && age >= 1 && age <= 120) {
              const y = new Date().getFullYear() - age;
              birth_year = String(y);
            }
          }
          const deceasedRaw = pickRowValue(row, [
            "is_deceased",
            "deceased",
            "متوفى",
            "متوفي",
            "وفاة",
            "وفاه",
          ]);
          const deceasedBool = coerceBool(deceasedRaw);
          const out = {
            branch_key: String(branch_key || "").trim(),
            parent_name: String(parent_name || "").trim(),
            child_name: String(child_name || "").trim(),
            birth_date_g: String(birth_date_g || "").trim(),
            birth_date_h: String(birth_date_h || "").trim(),
            birth_year: String(birth_year || "").trim(),
            city: String(city || "").trim(),
            area: String(area || "").trim(),
          };
          if (deceasedBool != null) out.is_deceased = deceasedBool;
          return out;
        })
        .filter((r) => r.branch_key && r.parent_name && r.child_name);
      if (!rows.length) {
        showAlert("error", "لم يتم العثور على صفوف صالحة داخل الملف.");
        setTreeImportStatus("");
        return;
      }
      const chunks = chunkArray(rows, 200);
      let inserted = 0;
      let updated = 0;
      let skipped = 0;
      for (let i = 0; i < chunks.length; i++) {
        setTreeImportStatus(`جاري الاستيراد... (${i + 1}/${chunks.length})`);
        const { data, error } = await sb.rpc("admin_tree_children_import_v1", {
          p_token: token,
          p_rows: chunks[i],
        });
        if (error) {
          showAlert(
            "error",
            "تعذر الاستيراد حالياً، حاول لاحقاً أو تواصل مع الإدارة.",
          );
          setTreeImportStatus("");
          return;
        }
        inserted +=
          Number(data && data.inserted != null ? data.inserted : 0) || 0;
        updated += Number(data && data.updated != null ? data.updated : 0) || 0;
        skipped += Number(data && data.skipped != null ? data.skipped : 0) || 0;
      }
      showAlert("success", "تم الاستيراد بنجاح.");
      setTreeImportStatus(
        `إضافة: ${inserted} — تحديث: ${updated} — تجاهل: ${skipped}`,
      );
    }

  async function buildWaFileText() {
      if (!waFileTextEl) return "";
      const file =
        waFileEl && waFileEl.files && waFileEl.files[0]
          ? waFileEl.files[0]
          : null;
      if (!file) {
        setWaFileStatus("اختر ملفاً أولاً.");
        return "";
      }
      setWaFileStatus("جاري تجهيز النص...");
      const raw = await readFileAsText(file);
      if (!raw) {
        waFileTextEl.value = "";
        setWaFileStatus("تعذر قراءة الملف أو الملف فارغ.");
        return "";
      }
      const msg = buildWhatsAppTextFromFile(file, raw);
      waFileTextEl.value = msg;
      setWaFileStatus("تم تجهيز النص.");
      return msg;
    }

  function init() {
  if (treeImportDownloadBtn) {
      treeImportDownloadBtn.addEventListener("click", () => {
        hideAlert();
        downloadTextFile(
          "alzidan-tree-template.csv",
          treeCsvTemplateText(),
          "text/csv;charset=utf-8",
        );
      });
    }
    if (treeImportTemplateEl) {
      try {
        treeImportTemplateEl.value = String(treeCardTemplateText() || "");
      } catch (e) {}
    }
    if (treeImportCopyBtn) {
      treeImportCopyBtn.addEventListener("click", async () => {
        hideAlert();
        const text = String(treeCardTemplateText() || "");
        const ok = await copyText(text);
        setTreeImportStatus(ok ? "تم نسخ نموذج البطاقة." : "تعذر نسخ النموذج.");
      });
    }
    if (treeImportWhatsappBtn) {
      treeImportWhatsappBtn.addEventListener("click", () => {
        hideAlert();
        const text = String(treeCardTemplateText() || "");
        const opened = openWhatsAppWithText(text);
        setTreeImportStatus(opened ? "تم فتح واتساب." : "تعذر فتح واتساب.");
      });
    }
    if (treeImportFileEl) {
      treeImportFileEl.addEventListener("change", () => {
        setTreeImportStatus("");
      });
    }
    if (treeImportRunBtn) {
      treeImportRunBtn.addEventListener("click", () => {
        hideAlert();
        const file =
          treeImportFileEl && treeImportFileEl.files && treeImportFileEl.files[0]
            ? treeImportFileEl.files[0]
            : null;
        runTreeImportFromFile(file).catch(() => {
          showAlert("error", "تعذر الاستيراد.");
          setTreeImportStatus("");
        });
      });
    }
    if (waFileEl) {
      waFileEl.addEventListener("change", () => {
        setWaFileStatus("");
        if (waFileTextEl) waFileTextEl.value = "";
      });
    }
    if (waFileBuildBtn) {
      waFileBuildBtn.addEventListener("click", () => {
        hideAlert();
        buildWaFileText().catch(() => setWaFileStatus("تعذر تجهيز النص."));
      });
    }
    if (waFileCopyBtn) {
      waFileCopyBtn.addEventListener("click", async () => {
        hideAlert();
        let text = waFileTextEl ? String(waFileTextEl.value || "") : "";
        if (!text) text = await buildWaFileText();
        if (!text) return;
        const ok = await copyText(text);
        setWaFileStatus(ok ? "تم نسخ النص." : "تعذر نسخ النص.");
      });
    }
    if (waFileOpenBtn) {
      waFileOpenBtn.addEventListener("click", async () => {
        hideAlert();
        let text = waFileTextEl ? String(waFileTextEl.value || "") : "";
        if (!text) text = await buildWaFileText();
        if (!text) return;
        const opened = openWhatsAppWithText(text);
        setWaFileStatus(opened ? "تم فتح واتساب." : "تعذر فتح واتساب.");
      });
    }
    }

  window.AlzidanAdminImport = {
    init,
    treeCsvTemplateText,
    treeCardTemplateText,
    openWhatsAppWithText,
    readFileAsText,
    buildWhatsAppTextFromFile,
    runTreeImportFromFile,
  };

  init();
})();
