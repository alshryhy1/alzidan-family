(() => {
  "use strict";

  const Core = window.AlzidanAdminCore || {};
  const showAlert =
    typeof Core.showAlert === "function"
      ? Core.showAlert.bind(Core)
      : function () {};
  const hideAlert =
    typeof Core.hideAlert === "function"
      ? Core.hideAlert.bind(Core)
      : function () {};
  const copyText =
    typeof Core.copyText === "function"
      ? Core.copyText.bind(Core)
      : async function (text) {
          const t = String(text || "");
          if (!t) return false;
          try {
            if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
              await navigator.clipboard.writeText(t);
              return true;
            }
          } catch (e) {}
          const area = document.createElement("textarea");
          area.value = t;
          area.setAttribute("readonly", "");
          area.style.position = "fixed";
          area.style.left = "-9999px";
          document.body.appendChild(area);
          area.select();
          try {
            document.execCommand("copy");
          } catch (e) {}
          document.body.removeChild(area);
          return true;
        };
  const downloadTextFile =
    typeof Core.downloadTextFile === "function"
      ? Core.downloadTextFile.bind(Core)
      : function (filename, text, mimeType) {
          const blob = new Blob([String(text || "")], {
            type: mimeType || "text/plain;charset=utf-8",
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = filename || "download.txt";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 0);
        };
  const getClient =
    typeof Core.getClient === "function"
      ? Core.getClient.bind(Core)
      : function () {
          return null;
        };
  const getAdminToken =
    typeof Core.getAdminToken === "function"
      ? Core.getAdminToken.bind(Core)
      : function () {
          return "";
        };

  const auditSection = document.getElementById("bulk-name-audit-section");
  const auditInput = document.getElementById("bulk-name-audit-input");
  const auditBranchFilter = document.getElementById("bulk-name-audit-branch-filter");
  const auditRunBtn = document.getElementById("bulk-name-audit-run");
  const auditSaveBtn = document.getElementById("bulk-name-audit-save");
  const auditExportBtn = document.getElementById("bulk-name-audit-export");
  const auditCopyBtn = document.getElementById("bulk-name-audit-copy");
  const auditStatus = document.getElementById("bulk-name-audit-status");
  const auditSummary = document.getElementById("bulk-name-audit-summary");
  const auditBody = document.getElementById("bulk-name-audit-body");

  let treeIndex = [];
  let auditRows = [];
  let auditInProgress = false;
  let auditBranchOptions = [];

  function setStatus(text) {
    if (auditStatus) auditStatus.textContent = String(text || "");
  }

  function normalizeArabicDigits(text) {
    return String(text || "")
      .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632))
      .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 1776));
  }

  function normalizeForCompare(value) {
    let s = normalizeArabicDigits(String(value || ""));
    s = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    s = s.replace(/[إأآ]/g, "ا");
    s = s.replace(/[ى]/g, "ي");
    s = s.replace(/ة/g, "ه");
    s = s.replace(/\bابن\b/g, "بن");
    s = s.replace(/\bبن\b/g, "بن");
    s = s.replace(/[\u0610-\u061A\u064B-\u065F\u0670]/g, "");
    s = s.replace(/[^\p{L}\p{N}\s/\-]/gu, " ");
    s = s.replace(/\s+/g, " ").trim();
    return s;
  }

  function stripGenericFamilyTerms(value) {
    let s = normalizeForCompare(value);
    s = s.replace(/\b(?:الشريهي|الزيدان|العائلة|العائله|الاب|الابن|بن)\b/gi, " ");
    s = s.replace(/\s+/g, " ").trim();
    return s;
  }

  function toDisplayText(value) {
    return String(value == null ? "" : value).trim();
  }

  function buildLeafName(value) {
    const s = toDisplayText(value);
    if (!s) return "";
    const parts = s.split(/[\/]/g).map((part) => part.trim()).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : s;
  }

  function tokenize(value) {
    return stripGenericFamilyTerms(value)
      .split(/\s+/g)
      .map((word) => word.trim())
      .filter(Boolean);
  }

  function levenshtein(a, b) {
    const left = String(a || "");
    const right = String(b || "");
    if (!left) return right.length;
    if (!right) return left.length;
    const dp = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
    for (let i = 0; i <= left.length; i += 1) dp[i][0] = i;
    for (let j = 0; j <= right.length; j += 1) dp[0][j] = j;
    for (let i = 1; i <= left.length; i += 1) {
      for (let j = 1; j <= right.length; j += 1) {
        const cost = left[i - 1] === right[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost,
        );
      }
    }
    return dp[left.length][right.length];
  }

  function similarityPercent(a, b) {
    const left = stripGenericFamilyTerms(a);
    const right = stripGenericFamilyTerms(b);
    if (!left || !right) return 0;
    if (left === right) return 100;
    const leftTokens = tokenize(left);
    const rightTokens = tokenize(right);
    const leftSet = new Set(leftTokens);
    const rightSet = new Set(rightTokens);
    const intersection = [...leftSet].filter((token) => rightSet.has(token));
    const tokenScore = leftTokens.length + rightTokens.length
      ? (intersection.length / Math.max(1, Math.max(leftTokens.length, rightTokens.length))) * 100
      : 0;
    const editDistance = levenshtein(left, right);
    const editScore = Math.max(left.length, right.length)
      ? ((Math.max(left.length, right.length) - editDistance) / Math.max(left.length, right.length)) * 100
      : 0;
    return Math.round(Math.max(tokenScore, editScore));
  }

  function pickBranchValue(row) {
    return toDisplayText(row && row.branch_key ? row.branch_key : "");
  }

  function pickParentValue(row) {
    return toDisplayText(row && (row.parent_name || row.parent || "") ? (row.parent_name || row.parent || "") : "");
  }

  function pickChildValue(row) {
    return toDisplayText(row && (row.child_name || row.name || "") ? (row.child_name || row.name || "") : "");
  }

  function inferBranchFromLine(parsed) {
    const branchNames = Array.from(new Set(treeIndex.map((row) => pickBranchValue(row)).filter(Boolean)));
    const lineText = normalizeForCompare(parsed.raw || "");
    const matches = branchNames.filter((branch) => normalizeForCompare(branch) && lineText.includes(normalizeForCompare(branch)));
    return matches.length ? matches[0] : "";
  }

  function parseLine(raw) {
    const text = String(raw || "").trim();
    if (!text) {
      return {
        raw: text,
        parsedName: "",
        expectedParent: "",
        pathText: "",
        notes: ["السطر فارغ."],
        hasParent: false,
        isShort: true,
        isPathLike: false,
      };
    }
    const cleaned = text.replace(/^\d+[\s\-\.\):،]+/, "").trim();
    const tokens = cleaned
      .split(/\s+/g)
      .map((tok) => normalizeForCompare(tok).trim())
      .filter(Boolean);
    const words = tokens.filter((tok) => tok !== "بن" && tok !== "ابن");
    const parsedName = words[0] || "";
    const expectedParent = words[1] || "";
    const pathTokens = words.slice(2);
    const pathText = pathTokens.join(" ");
    const notes = [];
    let isPathLike = false;
    if (pathText) {
      isPathLike = true;
      notes.push("السطر يشبه مساراً أو جدّاً.");
    }
    if (!parsedName) {
      notes.push("لا يمكن استخراج اسم واضح.");
    }
    if (!expectedParent) {
      notes.push("لا يوجد أب واضح في السطر.");
    }
    if (words.length <= 2) {
      notes.push("السطر يبدو اسماً قصيراً أو مكوّناً من اسم وأب فقط.");
    }
    return {
      raw: text,
      parsedName,
      expectedParent,
      pathText,
      notes,
      hasParent: Boolean(expectedParent),
      isShort: words.length <= 2,
      isPathLike,
    };
  }

  function buildTreeIndex(rows) {
    const normalized = Array.isArray(rows) ? rows : [];
    return normalized.map((row) => {
      const branch = pickBranchValue(row);
      const parentName = pickParentValue(row);
      const childName = pickChildValue(row);
      const fullPath = childName || parentName || "";
      const leafName = buildLeafName(fullPath);
      const parentLeaf = buildLeafName(parentName);
      const normalizedName = normalizeForCompare(fullPath);
      const normalizedParent = normalizeForCompare(parentName);
      const normalizedPath = normalizeForCompare(fullPath);
      return {
        ...row,
        branch_key: branch,
        parent_name: parentName,
        child_name: childName,
        fullPath,
        leafName,
        parentLeaf,
        normalizedName,
        normalizedParent,
        normalizedPath,
      };
    });
  }

  function buildBranchOptions(rows) {
    const options = Array.from(new Set(rows.map((row) => pickBranchValue(row)).filter(Boolean))).sort();
    return options;
  }

  function selectBranchFilter() {
    if (!auditBranchFilter) return "";
    const selected = String(auditBranchFilter.value || "").trim();
    return selected === "كل الفروع" || !selected ? "" : selected;
  }

  async function loadTreeIndex() {
    const sb = getClient();
    if (!sb) {
      setStatus("تعذر الاتصال بقاعدة البيانات.");
      return [];
    }
    const token = getAdminToken();
    if (!token) {
      setStatus("يلزم تسجيل الدخول أولاً.");
      return [];
    }
    setStatus("جاري تحميل الشجرة..." );
    const candidates = [
      "id,person_id,parent_person_id,branch_key,parent_name,parent,child_name,name,birth_date_g,birth_date_h,birth_year,birth_order,death_date_g,death_date_h,city,area,is_deceased,deceased,created_at",
      "id,person_id,parent_person_id,branch_key,parent_name,parent,child_name,name,birth_date_g,birth_date_h,birth_year,birth_order,city,area,is_deceased,deceased,created_at",
      "id,branch_key,parent_name,parent,child_name,name,birth_date_g,birth_date_h,birth_year,birth_order,city,area,is_deceased,deceased,created_at"
    ];
    let lastError = null;
    for (const fields of candidates) {
      const { data, error } = await sb.from("tree_children").select(fields).limit(10000);
      if (!error) {
        treeIndex = buildTreeIndex(Array.isArray(data) ? data : []);
        auditBranchOptions = buildBranchOptions(treeIndex);
        populateBranchOptions();
        return treeIndex;
      }
      lastError = error;
      const message = String(error.message || "").toLowerCase();
      if (!(message.includes("column") && message.includes("does not exist"))) break;
    }
    setStatus(lastError ? "تعذر تحميل الشجرة حالياً." : "تعذر تحميل الشجرة حالياً.");
    return [];
  }

  function populateBranchOptions() {
    if (!auditBranchFilter) return;
    const current = String(auditBranchFilter.value || "").trim();
    const selected = current || "كل الفروع";
    const options = ["كل الفروع", ...auditBranchOptions];
    auditBranchFilter.innerHTML = options
      .map((branch) => `<option value="${branch}" ${branch === selected ? "selected" : ""}>${branch}</option>`)
      .join("");
  }

  function candidateMatchesBranch(candidateBranch, selectedBranch) {
    if (!selectedBranch) return true;
    return String(candidateBranch || "") === String(selectedBranch || "");
  }

  function analyzeRow(parsed, indexRows) {
    const selectedBranch = selectBranchFilter();
    const inferredBranch = inferBranchFromLine(parsed);
    const candidates = indexRows
      .filter((row) => candidateMatchesBranch(row.branch_key, selectedBranch))
      .map((row) => {
        const nameScore = similarityPercent(parsed.parsedName, row.leafName || row.fullPath);
        const parentScore = similarityPercent(parsed.expectedParent, row.parentLeaf || row.parent_name);
        const pathScore = similarityPercent(parsed.pathText, row.fullPath || row.child_name);
        const branchScore = inferredBranch && row.branch_key === inferredBranch ? 100 : 0;
        const duplicateScore = parsed.parsedName && row.normalizedName && normalizeForCompare(parsed.parsedName) === row.normalizedName ? 100 : 0;
        const finalConfidence = Math.round((nameScore * 0.4) + (parentScore * 0.25) + (pathScore * 0.2) + (branchScore * 0.1) + (duplicateScore * 0.05));
        return {
          ...row,
          nameScore,
          parentScore,
          pathScore,
          branchScore,
          duplicateScore,
          finalConfidence,
        };
      })
      .filter((row) => row.finalConfidence >= 35 || (parsed.expectedParent && row.parentScore >= 40))
      .sort((a, b) => b.finalConfidence - a.finalConfidence);

    const best = candidates[0] || null;
    const probableBranches = Array.from(new Set(candidates.slice(0, 6).map((item) => item.branch_key).filter(Boolean)));
    const usesAmbiguity = candidates.length > 1 && candidates[0] && candidates[1] && Math.abs(candidates[0].finalConfidence - candidates[1].finalConfidence) < 12;
    const exactMatch = Boolean(best && parsed.parsedName && best.normalizedName && normalizeForCompare(parsed.parsedName) === best.normalizedName && best.parentScore >= 80 && (best.branchScore >= 100 || !selectedBranch));
    const hasParent = Boolean(parsed.expectedParent && parsed.expectedParent.length >= 2);

    let status = "❌ غير قابل للحفظ";
    let confidence = 0;
    let notes = [];
    let matchedPath = "";
    let matchedName = "";
    let selectedCandidate = null;
    let approved = false;
    let requireConfirmNew = false;
    let requireSelection = false;

    if (!hasParent || !parsed.parsedName) {
      status = "⚠️ يحتاج أب";
      confidence = 20;
      notes = parsed.notes.slice(0);
      matchedPath = "";
      matchedName = "";
    } else if (exactMatch) {
      status = "✅ موجود";
      confidence = 98;
      notes = ["تطابق قوي مع سجل موجود تحت نفس الأب أو المسار."];
      matchedPath = best.fullPath || best.child_name || "";
      matchedName = best.leafName || best.fullPath || "";
      selectedCandidate = best;
    } else if (best && best.finalConfidence >= 85) {
      status = "⚠️ مشابه قوي";
      confidence = best.finalConfidence;
      notes = ["تشابه قوي مع سجل موجود، ويتطلب تأكيداً قبل الحفظ."];
      matchedPath = best.fullPath || best.child_name || "";
      matchedName = best.leafName || best.fullPath || "";
      selectedCandidate = best;
      requireConfirmNew = true;
    } else if (best && best.finalConfidence >= 70) {
      status = "⚠️ مشابه متوسط";
      confidence = best.finalConfidence;
      notes = ["تشابه متوسط مع سجل موجود، ومراجعة يوصى بها."];
      matchedPath = best.fullPath || best.child_name || "";
      matchedName = best.leafName || best.fullPath || "";
      selectedCandidate = best;
    } else if (usesAmbiguity && probableBranches.length > 1) {
      status = "⚠️ متعدد الاحتمالات";
      confidence = Math.max(50, candidates[0].finalConfidence - 5);
      notes = ["وجد أكثر من أب أو فرع محتمل بنفس الدرجة؛ يلزم اختيار صحيح." ];
      matchedPath = candidates[0].fullPath || candidates[0].child_name || "";
      matchedName = candidates[0].leafName || candidates[0].fullPath || "";
      requireSelection = true;
      selectedCandidate = candidates[0];
    } else if (best && best.finalConfidence >= 55) {
      status = "🆕 جديد جاهز";
      confidence = best.finalConfidence;
      notes = ["تم تحديد الأب والفرع بدرجة مقبولة، ولا يبدو هناك تشابه خطير."];
      matchedPath = best.fullPath || best.child_name || "";
      matchedName = best.leafName || best.fullPath || "";
      selectedCandidate = best;
      approved = false;
    } else {
      status = "❌ غير قابل للحفظ";
      confidence = Math.max(10, best ? best.finalConfidence : 20);
      notes = ["لم يتضح الأب أو المسار بما يكفي للحفظ الآمن."];
      matchedPath = best ? (best.fullPath || best.child_name || "") : "";
      matchedName = best ? (best.leafName || best.fullPath || "") : "";
    }

    return {
      original: parsed.raw,
      parsedName: parsed.parsedName,
      expectedParent: parsed.expectedParent,
      expectedBranch: inferredBranch || (selectedBranch || "") || "",
      pathText: parsed.pathText,
      matchedPath,
      matchedName,
      status,
      confidence,
      notes,
      approved,
      requireConfirmNew,
      requireSelection,
      selectedCandidate,
      candidateOptions: candidates.slice(0, 6),
      selectedOptionKey: "",
      branch: inferredBranch || (selectedBranch || "") || "",
      rawLine: parsed.raw,
      lineNumber: 0,
    };
  }

  function renderSummary(rows) {
    if (!auditSummary) return;
    const counts = {
      total: rows.length,
      empty: rows.filter((row) => !String(row.original || "").trim()).length,
      existing: rows.filter((row) => row.status === "✅ موجود").length,
      ready: rows.filter((row) => row.status === "🆕 جديد جاهز").length,
      strong: rows.filter((row) => row.status === "⚠️ مشابه قوي").length,
      medium: rows.filter((row) => row.status === "⚠️ مشابه متوسط").length,
      ambiguous: rows.filter((row) => row.status === "⚠️ متعدد الاحتمالات").length,
      needsParent: rows.filter((row) => row.status === "⚠️ يحتاج أب").length,
      blocked: rows.filter((row) => row.status === "❌ غير قابل للحفظ").length,
      approved: rows.filter((row) => row.approved).length,
    };
    const html = [
      `<div class="batch-stat"><strong>${counts.total}</strong><span>إجمالي الأسطر</span></div>`,
      `<div class="batch-stat"><strong>${counts.empty}</strong><span>أسماء فارغة</span></div>`,
      `<div class="batch-stat"><strong>${counts.existing}</strong><span>موجود</span></div>`,
      `<div class="batch-stat"><strong>${counts.ready}</strong><span>جديد جاهز</span></div>`,
      `<div class="batch-stat"><strong>${counts.strong}</strong><span>مشابه قوي</span></div>`,
      `<div class="batch-stat"><strong>${counts.medium}</strong><span>مشابه متوسط</span></div>`,
      `<div class="batch-stat"><strong>${counts.ambiguous}</strong><span>متعدد الاحتمالات</span></div>`,
      `<div class="batch-stat"><strong>${counts.needsParent}</strong><span>يحتاج أب</span></div>`,
      `<div class="batch-stat"><strong>${counts.blocked}</strong><span>غير قابل للحفظ</span></div>`,
      `<div class="batch-stat"><strong>${counts.approved}</strong><span>معتمد للحفظ</span></div>`,
    ].join("");
    auditSummary.innerHTML = html;
  }

  function renderResults(rows) {
    if (!auditBody) return;
    if (!rows.length) {
      auditBody.innerHTML = '<tr><td colspan="12" class="hint">لم يتم تحليل أي سطر بعد.</td></tr>';
      return;
    }
    auditBody.innerHTML = rows.map((row, index) => {
      const optionItems = (row.candidateOptions || []).map((candidate) => {
        const label = `${candidate.branch_key || ""} · ${candidate.parentLeaf || candidate.parent_name || ""} · ${candidate.leafName || candidate.fullPath || ""}`;
        const selected = row.selectedOptionKey === `${candidate.id || ""}-${candidate.branch_key || ""}-${candidate.parent_name || ""}-${candidate.child_name || ""}`;
        return `<option value="${candidate.id || ""}-${candidate.branch_key || ""}-${candidate.parent_name || ""}-${candidate.child_name || ""}" ${selected ? "selected" : ""}>${label}</option>`;
      }).join("");
      const actionCell = row.requireSelection
        ? `<select data-audit-select="${index}" class="btn btn-outline btn-sm" style="min-width: 220px;">${optionItems || '<option value="">لا توجد خيارات</option>'}</select>`
        : `<span class="hint">${row.selectedCandidate ? (row.selectedCandidate.branch_key || "") : "—"}</span>`;
      const confirmCell = row.requireConfirmNew
        ? `<label style="display:flex; align-items:center; gap:6px;"><input type="checkbox" data-audit-confirm="${index}" ${row.confirmedNew ? "checked" : ""} /> تأكيد</label>`
        : "—";
      const approvedCell = `<label style="display:flex; align-items:center; gap:6px;"><input type="checkbox" data-audit-approve="${index}" ${row.approved ? "checked" : ""} ${row.status === "✅ موجود" ? "disabled" : ""} /> اعتماد</label>`;
      return `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(row.original || "")}</td>
          <td>${escapeHtml(row.parsedName || "")}</td>
          <td>${escapeHtml(row.expectedParent || "")}</td>
          <td>${escapeHtml(row.expectedBranch || "")}</td>
          <td>${escapeHtml(row.matchedPath || "")}</td>
          <td>${escapeHtml(row.status || "")}</td>
          <td>${row.confidence}</td>
          <td>${escapeHtml(row.matchedName || "")}</td>
          <td>${escapeHtml(row.notes.join(" · ") || "")}</td>
          <td>${actionCell}</td>
          <td>${approvedCell}</td>
          <td>${confirmCell}</td>
        </tr>`;
    }).join("");

    auditBody.querySelectorAll("[data-audit-select]").forEach((select) => {
      select.addEventListener("change", (event) => {
        const index = Number(event.target.getAttribute("data-audit-select"));
        const chosenKey = String(event.target.value || "");
        const row = auditRows[index];
        if (!row) return;
        row.selectedOptionKey = chosenKey;
        const match = (row.candidateOptions || []).find((candidate) => `${candidate.id || ""}-${candidate.branch_key || ""}-${candidate.parent_name || ""}-${candidate.child_name || ""}` === chosenKey);
        if (match) {
          row.selectedCandidate = match;
          row.expectedBranch = match.branch_key || row.expectedBranch;
          row.matchedPath = match.fullPath || match.child_name || "";
          row.matchedName = match.leafName || match.fullPath || "";
          row.notes = ["تم اختيار احتمال محدد من المستخدم."];
        }
        renderResults(auditRows);
      });
    });

    auditBody.querySelectorAll("[data-audit-approve]").forEach((checkbox) => {
      checkbox.addEventListener("change", (event) => {
        const index = Number(event.target.getAttribute("data-audit-approve"));
        const row = auditRows[index];
        if (!row) return;
        row.approved = Boolean(event.target.checked);
        renderSummary(auditRows);
        renderResults(auditRows);
      });
    });

    auditBody.querySelectorAll("[data-audit-confirm]").forEach((checkbox) => {
      checkbox.addEventListener("change", (event) => {
        const index = Number(event.target.getAttribute("data-audit-confirm"));
        const row = auditRows[index];
        if (!row) return;
        row.confirmedNew = Boolean(event.target.checked);
      });
    });
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function toReportRows(rows) {
    return rows.map((row) => ({
      original: row.original || "",
      parsedName: row.parsedName || "",
      expectedParent: row.expectedParent || "",
      expectedBranch: row.expectedBranch || "",
      matchedPath: row.matchedPath || "",
      status: row.status || "",
      confidence: row.confidence || 0,
      notes: Array.isArray(row.notes) ? row.notes.join(" | ") : row.notes || "",
      approved: Boolean(row.approved),
      selectedParent: row.selectedCandidate ? `${row.selectedCandidate.branch_key || ""} / ${row.selectedCandidate.parent_name || row.selectedCandidate.parentLeaf || ""} / ${row.selectedCandidate.child_name || row.selectedCandidate.fullPath || ""}` : "",
    }));
  }

  function exportReport(rows) {
    const report = {
      generatedAt: new Date().toISOString(),
      rows: toReportRows(rows),
    };
    const text = JSON.stringify(report, null, 2);
    downloadTextFile("bulk-name-audit-report.json", text, "application/json;charset=utf-8");
    return text;
  }

  function buildSavePayload(rows) {
    return rows
      .filter((row) => row.approved && row.status !== "✅ موجود" && row.status !== "⚠️ يحتاج أب" && row.status !== "❌ غير قابل للحفظ")
      .filter((row) => row.status !== "⚠️ مشابه قوي" || row.confirmedNew)
      .filter((row) => row.status !== "⚠️ متعدد الاحتمالات" || Boolean(row.selectedCandidate))
      .map((row) => {
        const selected = row.selectedCandidate || null;
        const branch = selected ? (selected.branch_key || row.expectedBranch || "") : (row.expectedBranch || "");
        const parent = selected ? (selected.parent_name || selected.parentLeaf || row.expectedParent || "") : (row.expectedParent || "");
        const child = row.parsedName || "";
        return {
          branch_key: branch,
          parent_name: parent,
          child_name: child,
          name: child,
          birth_date_g: "",
          birth_date_h: "",
          birth_year: "",
          city: "",
          area: "",
          is_deceased: false,
          deceased: false,
        };
      });
  }

  async function performSave(rows) {
    const sb = getClient();
    const token = getAdminToken();
    if (!sb || !token) {
      showAlert("error", "يلزم تسجيل الدخول أولاً.");
      return false;
    }
    const payload = buildSavePayload(rows);
    if (!payload.length) {
      showAlert("warning", "لا توجد صفوف معتمدة للحفظ.");
      return false;
    }
    const confirmed = window.confirm(`سيتم حفظ ${payload.length} صفوف معتمدة. هل تريد المتابعة؟`);
    if (!confirmed) return false;
    try {
      setStatus(`جاري حفظ ${payload.length} صفوف...`);
      const { data, error } = await sb.rpc("admin_tree_children_import_v1", {
        p_token: token,
        p_rows: payload,
      });
      if (error) {
        const msg = String(error.message || "");
        if (msg.toLowerCase().includes("could not find the function") || msg.toLowerCase().includes("does not exist") || String(error.code || "").toLowerCase() === "pgrst202") {
          const review = JSON.stringify({ generatedAt: new Date().toISOString(), rows: toReportRows(rows.filter((row) => row.approved)) }, null, 2);
          downloadTextFile("bulk-name-audit-review.json", review, "application/json;charset=utf-8");
          showAlert("warning", "لم تتوفر RPC الحفظ مباشرة، تم توليد ملف مراجعة بدلاً من الحفظ.");
          return false;
        }
        showAlert("error", "تعذر حفظ الصفوف المعتمدة حالياً.");
        return false;
      }
      const inserted = data && data.inserted != null ? Number(data.inserted) : null;
      const updated = data && data.updated != null ? Number(data.updated) : null;
      const skipped = data && data.skipped != null ? Number(data.skipped) : null;
      const summary = [
        inserted != null ? `مضاف: ${inserted}` : null,
        updated != null ? `محدّث: ${updated}` : null,
        skipped != null ? `تخطّي: ${skipped}` : null,
      ].filter(Boolean).join(" · ");
      showAlert("success", summary || "تم حفظ الصفوف المعتمدة.");
      setStatus("تم حفظ الصفوف المعتمدة." );
      return true;
    } catch (error) {
      showAlert("error", "تعذر حفظ الصفوف المعتمدة.");
      return false;
    }
  }

  function analyzeLines(lines) {
    if (!lines.length) {
      auditRows = [];
      renderResults(auditRows);
      renderSummary(auditRows);
      setStatus("أدخل أسماء أولاً.");
      return;
    }
    auditInProgress = true;
    auditRows = [];
    renderResults(auditRows);
    renderSummary(auditRows);
    setStatus("جاري التحليل...");
    const batchSize = 25;
    const total = lines.length;
    let index = 0;
    function step() {
      const chunk = lines.slice(index, index + batchSize);
      if (!chunk.length) {
        auditInProgress = false;
        renderResults(auditRows);
        renderSummary(auditRows);
        setStatus(`تم تحليل ${auditRows.length} سطرًا من ${total}.`);
        return;
      }
      chunk.forEach((line, offset) => {
        const parsed = parseLine(line);
        const analysis = analyzeRow(parsed, treeIndex);
        analysis.lineNumber = index + offset + 1;
        auditRows.push(analysis);
      });
      renderResults(auditRows);
      renderSummary(auditRows);
      setStatus(`تم تحليل ${Math.min(index + chunk.length, total)} من ${total}`);
      index += chunk.length;
      if (typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(step);
      } else {
        window.setTimeout(step, 0);
      }
    }
    step();
  }

  function attachEvents() {
    if (auditRunBtn) {
      auditRunBtn.addEventListener("click", async () => {
        if (auditInProgress) return;
        if (!treeIndex.length) {
          const loaded = await loadTreeIndex();
          if (!loaded.length) return;
        }
        const lines = String(auditInput ? auditInput.value : "")
          .split(/\r?\n/g)
          .map((line) => line.trim())
          .filter(Boolean);
        analyzeLines(lines);
      });
    }
    if (auditSaveBtn) {
      auditSaveBtn.addEventListener("click", async () => {
        if (!auditRows.length) {
          showAlert("warning", "لا توجد نتائج جاهزة للحفظ.");
          return;
        }
        await performSave(auditRows);
      });
    }
    if (auditExportBtn) {
      auditExportBtn.addEventListener("click", () => {
        if (!auditRows.length) {
          showAlert("warning", "لا توجد نتائج جاهزة للتصدير.");
          return;
        }
        exportReport(auditRows);
        showAlert("success", "تم تصدير تقرير المراجعة.");
      });
    }
    if (auditCopyBtn) {
      auditCopyBtn.addEventListener("click", async () => {
        if (!auditRows.length) {
          showAlert("warning", "لا توجد نتائج جاهزة للنسخ.");
          return;
        }
        const text = JSON.stringify({ rows: toReportRows(auditRows) }, null, 2);
        const ok = await copyText(text);
        showAlert(ok ? "success" : "error", ok ? "تم نسخ التقرير." : "تعذر نسخ التقرير.");
      });
    }
    if (auditBranchFilter) {
      auditBranchFilter.addEventListener("change", () => {
        if (auditRows.length) {
          setStatus("غيّرت تقييد الفرع، أعد التحليل لتحديث النتائج.");
        }
      });
    }
  }

  async function init() {
    if (!auditSection) return;
    attachEvents();
    populateBranchOptions();
    await loadTreeIndex();
    if (auditInput && !auditInput.value.trim()) {
      auditInput.value = [
        "سعد محمد زيدان",
        "خالد ساير جاسر الزيدان",
        "عبدالله حسن",
      ].join("\n");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
