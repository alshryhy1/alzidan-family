(() => {
  "use strict";

  const Core = window.AlzidanAdminCore || {};
  const showAlert = typeof Core.showAlert === "function" ? Core.showAlert.bind(Core) : function () {};
  const getClient = typeof Core.getClient === "function" ? Core.getClient.bind(Core) : function () { return null; };
  const getAdminToken = typeof Core.getAdminToken === "function" ? Core.getAdminToken.bind(Core) : function () { return ""; };
  const normalizeArabicDigitsToLatin = typeof Core.normalizeArabicDigitsToLatin === "function"
    ? Core.normalizeArabicDigitsToLatin.bind(Core)
    : function (value) {
        return String(value || "")
          .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632))
          .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 1776));
      };

  const auditSection = document.getElementById("bulk-name-audit-section");
  const auditInput = document.getElementById("bulk-name-audit-input");
  const auditRunBtn = document.getElementById("bulk-name-audit-run");
  const auditSaveBtn = document.getElementById("bulk-name-audit-save");
  const auditBody = document.getElementById("bulk-name-audit-body");
  const auditStatus = document.getElementById("bulk-name-audit-status");

  const state = {
    treeRows: [],
    auditRows: [],
  };

  const TreeLineage = window.TreeLineage || {};

  function setStatus(text) {
    if (auditStatus) auditStatus.textContent = String(text || "");
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function normalizeForCompare(value) {
    let s = normalizeArabicDigitsToLatin(String(value || ""));
    s = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    s = s.replace(/[إأآ]/g, "ا");
    s = s.replace(/[ى]/g, "ي");
    s = s.replace(/ة/g, "ه");
    s = s.replace(/\s+/g, " ").trim();
    return s;
  }

  function normalizeText(value) {
    return String(value == null ? "" : value).trim();
  }

  function buildLeafName(value) {
    return TreeLineage.batchLeaf ? TreeLineage.batchLeaf(value) : normalizeText(value);
  }

  function buildParentPath(value) {
    return TreeLineage.batchParentPath ? TreeLineage.batchParentPath(value) : "";
  }

  function pickBranchValue(row) {
    return normalizeText(row && row.branch_key ? row.branch_key : "");
  }

  function pickParentValue(row) {
    return normalizeText(row && (row.parent_name || row.parent || "") ? (row.parent_name || row.parent || "") : "");
  }

  function pickChildValue(row) {
    return normalizeText(row && (row.child_name || row.name || "") ? (row.child_name || row.name || "") : "");
  }

  function buildTreeRows(rows) {
    return (Array.isArray(rows) ? rows : []).map((row) => {
      const branchKey = pickBranchValue(row);
      const parentName = pickParentValue(row);
      const childName = pickChildValue(row);

      const fullPath = childName.includes("/")
        ? childName
        : (parentName && childName ? parentName + "/" + childName : childName || parentName || "");

      const parentPath = buildParentPath(fullPath) || parentName;
      const grandParentPath = buildParentPath(parentPath);

      const leafName = buildLeafName(fullPath);
      const parentLeaf = buildLeafName(parentPath);
      const grandParentLeaf = buildLeafName(grandParentPath);

      const compactLineage = [leafName, parentLeaf, grandParentLeaf].filter(Boolean).join(" ");

      return {
        ...row,
        branch_key: branchKey,
        parent_name: parentName,
        child_name: childName,
        fullPath,
        parentPath,
        grandParentPath,
        leafName,
        parentLeaf,
        grandParentLeaf,
        compactLineage,
        normalizedFullPath: normalizeForCompare(fullPath),
        normalizedCompactLineage: normalizeForCompare(compactLineage),
        normalizedChildName: normalizeForCompare(childName),
        normalizedName: normalizeForCompare(row && row.name ? row.name : ""),
        normalizedLeafName: normalizeForCompare(leafName),
        normalizedParentLeaf: normalizeForCompare(parentLeaf),
        normalizedGrandParentLeaf: normalizeForCompare(grandParentLeaf),
      };
    });
  }

  async function loadTreeRows() {
    const sb = getClient();
    if (!sb) {
      setStatus("تعذر الاتصال بقاعدة البيانات.");
      return [];
    }

    setStatus("جاري تحميل الشجرة...");
    const { data, error } = await sb.from("tree_children").select("id,branch_key,parent_name,parent,child_name,name").limit(20000);
    if (error) {
      setStatus("تعذر تحميل الشجرة حالياً.");
      return [];
    }
    state.treeRows = buildTreeRows(Array.isArray(data) ? data : []);
    return state.treeRows;
  }

  function parseLine(raw) {
    const text = String(raw || "").trim();
    if (!text) {
      return { raw: text, fullName: "", normalizedName: "" };
    }
    const cleaned = text.replace(/^\d+[\s\-\.\):،]+/, "").trim();
    return { raw: text, fullName: cleaned, normalizedName: normalizeForCompare(cleaned) };
  }

  function getSimilarityRatio(a, b) {
    const s = normalizeForCompare(a || "");
    const t = normalizeForCompare(b || "");
    if (!s || !t) return 0;
    if (s === t) return 1;

    const m = s.length;
    const n = t.length;
    const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i += 1) dp[i][0] = i;
    for (let j = 0; j <= n; j += 1) dp[0][j] = j;
    for (let i = 1; i <= m; i += 1) {
      for (let j = 1; j <= n; j += 1) {
        const cost = s[i - 1] === t[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      }
    }
    const distance = dp[m][n];
    return 1 - distance / Math.max(m, n);
  }

  function findBestMatch(normalizedName) {
    let best = null;
    let bestRatio = 0;
    state.treeRows.forEach((row) => {
      const candidate = row.normalizedFullPath || row.normalizedChildName || row.normalizedName || "";
      const ratio = getSimilarityRatio(normalizedName, candidate);
      if (ratio > bestRatio) {
        bestRatio = ratio;
        best = row;
      }
    });
    return { best, bestRatio };
  }

  function analyzeRow(parsed) {
    const fullName = parsed.fullName;
    const normalizedName = parsed.normalizedName;

    if (!normalizedName) {
      return {
        inputName: fullName,
        status: "✎ تحتاج مراجعة",
        existingName: "",
        branch: "",
        parent: "",
        reason: "السطر فارغ أو غير صالح.",
        approved: false,
      };
    }

    const fullMatches = [];
    ["زيدان", "زايد", "مزيد", "لاحم", "ملحم"].forEach((branch) => {
      if (!TreeLineage.parseBatchFullLineage) return;
      const full = TreeLineage.parseBatchFullLineage(fullName, branch);
      if (full && full.path) {
        const normalizedPath = normalizeForCompare(full.path);
        const match = state.treeRows.find((row) => row.normalizedFullPath === normalizedPath);
        if (match) fullMatches.push(match);
      }
    });

    if (fullMatches.length === 1) {
      const m = fullMatches[0];
      return {
        inputName: fullName,
        status: "✓ موجود",
        existingName: m.fullPath || m.child_name || m.name || "",
        branch: m.branch_key || "",
        parent: m.parent_name || "",
        reason: "مطابقة كاملة بتسلسل النسب.",
        approved: false,
      };
    }

    if (fullMatches.length > 1) {
      return {
        inputName: fullName,
        status: "✎ تحتاج مراجعة",
        existingName: fullMatches.slice(0, 3).map((row) => row.fullPath || row.child_name || row.name || "").join(" | "),
        branch: "",
        parent: "",
        reason: "أكثر من مطابقة محتملة لتسلسل النسب.",
        approved: false,
      };
    }

    const short = TreeLineage.parseBatchShortLine ? TreeLineage.parseBatchShortLine(fullName) : null;
    if (short && short.name && short.father) {
      const nName = normalizeForCompare(short.name);
      const nFather = normalizeForCompare(short.father);
      const nGrand = normalizeForCompare(short.grandfather || "");

      const matches = state.treeRows.filter((row) => {
        const childOk = row.normalizedLeafName === nName;
        const fatherOk = !nFather || row.normalizedParentLeaf === nFather;
        const grandOk = !nGrand || row.normalizedGrandParentLeaf === nGrand;
        return childOk && fatherOk && grandOk;
      });

      if (matches.length === 1) {
        const m = matches[0];
        return {
          inputName: fullName,
          status: "✓ موجود",
          existingName: m.fullPath || m.child_name || m.name || "",
          branch: m.branch_key || "",
          parent: m.parent_name || "",
          reason: "مطابقة بتسلسل الاسم/الأب/الجد.",
          approved: false,
        };
      }

      if (matches.length > 1) {
        return {
          inputName: fullName,
          status: "✎ تحتاج مراجعة",
          existingName: matches.slice(0, 3).map((row) => row.fullPath || row.child_name || row.name || "").join(" | "),
          branch: "",
          parent: "",
          reason: "وجد أكثر من مطابق بنفس الاسم/الأب/الجد.",
          approved: false,
        };
      }
    }

    const directMatch = state.treeRows.find((row) =>
      row.normalizedFullPath === normalizedName ||
      row.normalizedCompactLineage === normalizedName ||
      row.normalizedChildName === normalizedName ||
      row.normalizedName === normalizedName
    );

    if (directMatch) {
      return {
        inputName: fullName,
        status: "✓ موجود",
        existingName: directMatch.fullPath || directMatch.child_name || directMatch.name || "",
        branch: directMatch.branch_key || "",
        parent: directMatch.parent_name || "",
        reason: "مطابقة مباشرة في الشجرة.",
        approved: false,
      };
    }

    const { best, bestRatio } = findBestMatch(normalizedName);
    if (best && bestRatio >= 0.7) {
      return {
        inputName: fullName,
        status: "⚠️ مشابه",
        existingName: best.fullPath || best.child_name || best.name || "",
        branch: best.branch_key || "",
        parent: best.parent_name || "",
        reason: `تشابه ${Math.round(bestRatio * 100)}% مع اسم موجود.`,
        approved: false,
      };
    }

    return {
      inputName: fullName,
      status: "✎ تحتاج مراجعة",
      existingName: "",
      branch: "",
      parent: "",
      reason: "لم تثبت المطابقة. لا يتم اعتباره غير موجود تلقائياً منعاً للتكرار.",
      approved: false,
    };
  }

  function renderResults() {
    if (!auditBody) return;
    if (!state.auditRows.length) {
      auditBody.innerHTML = '<tr><td colspan="8" class="hint">أدخل أسماء ثم اضغط تحليل الأسماء.</td></tr>';
      return;
    }

    auditBody.innerHTML = state.auditRows.map((row, index) => {
      const checkbox = `<input type="checkbox" ${row.approved ? "checked" : ""} disabled />`;
      return `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(row.inputName || "")}</td>
          <td>${escapeHtml(row.status || "")}</td>
          <td>${escapeHtml(row.existingName || "")}</td>
          <td>${escapeHtml(row.branch || "")}</td>
          <td>${escapeHtml(row.parent || "")}</td>
          <td>${escapeHtml(row.reason || "")}</td>
          <td>${checkbox}</td>
        </tr>`;
    }).join("");

    setStatus("النتائج جاهزة. راجع الجدول للتصنيفات والإجراء.");
  }

  function getPayloadRows() {
    return [];
  }

  async function performSave() {
    const sb = getClient();
    const token = getAdminToken();
    if (!sb || !token) {
      showAlert("warning", "يلزم تسجيل الدخول أولاً.");
      setStatus("يلزم تسجيل الدخول أولاً.");
      return false;
    }

    const payload = getPayloadRows();
    if (!payload.length) {
      showAlert("warning", "لا توجد أسماء غير موجودة جاهزة للإضافة.");
      setStatus("لا توجد أسماء غير موجودة جاهزة للإضافة.");
      return false;
    }

    try {
      setStatus("جاري إضافة الأسماء غير الموجودة...");
      const { data, error } = await sb.rpc("admin_tree_children_import_v1", { p_token: token, p_rows: payload });
      if (error) {
        setStatus("الحفظ المباشر غير متاح، يلزم ربط RPC مناسبة.");
        showAlert("error", "الحفظ المباشر غير متاح، يلزم ربط RPC مناسبة.");
        return false;
      }

      const inserted = data && typeof data.inserted === "number" ? data.inserted : payload.length;
      setStatus(`تمت إضافة ${inserted} اسمًا جديدًا.`);
      showAlert("success", `تمت إضافة ${inserted} اسمًا جديدًا.`);
      return true;
    } catch (error) {
      setStatus("الحفظ المباشر غير متاح، يلزم ربط RPC مناسبة.");
      showAlert("error", "الحفظ المباشر غير متاح، يلزم ربط RPC مناسبة.");
      return false;
    }
  }

  function analyzeLines(lines) {
    if (!lines.length) {
      state.auditRows = [];
      renderResults();
      setStatus("أدخل أسماء أولاً.");
      return;
    }

    state.auditRows = lines.map((line) => analyzeRow(parseLine(line)));
    renderResults();
    setStatus(`تم تحليل ${state.auditRows.length} اسمًا.`);
  }

  function attachEvents() {
    if (auditRunBtn) {
      auditRunBtn.addEventListener("click", async () => {
        if (!state.treeRows.length) {
          const loaded = await loadTreeRows();
          if (!loaded.length) return;
        }
        const lines = String(auditInput ? auditInput.value : "")
          .split(/\r?\n/g)
          .map((line) => String(line || "").trim())
          .filter(Boolean);
        analyzeLines(lines);
      });
    }

    if (auditSaveBtn) {
      auditSaveBtn.addEventListener("click", async () => {
        await performSave();
      });
    }
  }

  async function init() {
    if (!auditSection) return;
    attachEvents();
    await loadTreeRows();
    renderResults();
    setStatus("استعد لتحليل الأسماء.");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
