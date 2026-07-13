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
  const auditBranch = document.getElementById("bulk-name-audit-branch");
  const auditRunBtn = document.getElementById("bulk-name-audit-run");
  const auditSaveBtn = document.getElementById("bulk-name-audit-save");
  const auditBody = document.getElementById("bulk-name-audit-body");
  const auditStatus = document.getElementById("bulk-name-audit-status");

  const TreeLineage = window.TreeLineage || {};
  const normalizeBatchText = TreeLineage.normalizeBatchText || function (v) { return String(v || "").trim(); };
  const cleanBatchLine = TreeLineage.cleanBatchLine || function (v) { return String(v || "").trim(); };
  const batchLeaf = TreeLineage.batchLeaf || function (v) { return String(v || "").trim(); };
  const batchParentPath = TreeLineage.batchParentPath || function () { return ""; };
  const parseBatchFullLineage = TreeLineage.parseBatchFullLineage || function () { return null; };
  const parseBatchShortLine = TreeLineage.parseBatchShortLine || function () { return null; };

  const STATUS = {
    existing: "↪ موجود في الشجرة",
    ready: "➕ جاهز للإضافة (لم يُحفظ بعد)",
    review: "✎ تحتاج مراجعة",
  };

  const state = {
    treeRows: [],
    auditRows: [],
    pendingRelations: [],
  };

  function setStatus(text) {
    if (auditStatus) auditStatus.textContent = String(text || "");
  }

  const escapeHtml = Core.escapeHtml;

  function normalizeForCompare(value) {
    let s = normalizeArabicDigitsToLatin(String(value || ""));
    s = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    s = s.replace(/[إأآ]/g, "ا");
    s = s.replace(/[ى]/g, "ي");
    s = s.replace(/ة/g, "ه");
    s = s.replace(/\s+/g, " ").trim();
    return s;
  }

  function relationKey(branchKey, parentName, childName) {
    return [
      normalizeForCompare(branchKey),
      normalizeForCompare(normalizeBatchText(parentName)),
      normalizeForCompare(normalizeBatchText(childName)),
    ].join("||");
  }

  function buildTreeRows(rows) {
    return (Array.isArray(rows) ? rows : []).map((row) => {
      const branchKey = normalizeBatchText(row && row.branch_key ? row.branch_key : "");
      const parentName = normalizeBatchText(row && (row.parent_name || row.parent || "") ? (row.parent_name || row.parent || "") : "");
      const childName = normalizeBatchText(row && (row.child_name || row.name || "") ? (row.child_name || row.name || "") : "");
      return {
        ...row,
        branch_key: branchKey,
        parent_name: parentName,
        child_name: childName,
        relationKey: relationKey(branchKey, parentName, childName),
      };
    });
  }

  function parentNamesMatch(expectedParent, dbParent) {
    const expected = normalizeForCompare(normalizeBatchText(expectedParent));
    const stored = normalizeForCompare(normalizeBatchText(dbParent));
    if (!expected || !stored) return true;
    const expectedLeaf = normalizeForCompare(batchLeaf(expectedParent));
    const storedLeaf = normalizeForCompare(batchLeaf(dbParent));
    if (stored === expected || stored === expectedLeaf || expected === storedLeaf) return true;
    if (expected.endsWith("/" + stored) || expected.endsWith("/" + storedLeaf)) return true;
    if (stored.endsWith("/" + expectedLeaf)) return true;
    return false;
  }

  function childNamesMatch(expectedChild, dbChild) {
    const expected = normalizeForCompare(normalizeBatchText(expectedChild));
    const stored = normalizeForCompare(normalizeBatchText(dbChild));
    if (!expected || !stored) return false;
    if (stored === expected) return true;
    const expectedLeaf = normalizeForCompare(batchLeaf(expectedChild));
    const storedLeaf = normalizeForCompare(batchLeaf(dbChild));
    if (stored === expectedLeaf || storedLeaf === expected) return true;
    if (stored.endsWith("/" + expectedLeaf) || expected.endsWith("/" + storedLeaf)) return true;
    if (expected.endsWith("/" + stored) || expected.endsWith(stored)) return true;
    return false;
  }

  function treeHasRelation(branchKey, parentName, childName) {
    const branchNorm = normalizeForCompare(branchKey);
    return state.treeRows.some((row) => {
      if (normalizeForCompare(row.branch_key) !== branchNorm) return false;
      return parentNamesMatch(parentName, row.parent_name) && childNamesMatch(childName, row.child_name);
    });
  }

  function treeRowChildPath(row) {
    const child = normalizeBatchText(row && row.child_name ? row.child_name : "");
    if (!child) return "";
    if (child.includes("/")) return child;
    const parent = normalizeBatchText(row && row.parent_name ? row.parent_name : "");
    return parent ? parent + "/" + child : child;
  }

  function getSelectedBranch() {
    return normalizeBatchText(auditBranch ? auditBranch.value : "") || "زيدان";
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

  function seedKnownByLeaf(knownByLeaf, branch) {
    const root = branch + " بن مطلق بن زيدان";
    let seq = 0;
    function remember(path) {
      const p = normalizeBatchText(path);
      const leaf = batchLeaf(p);
      if (!leaf) return;
      if (!knownByLeaf.has(leaf)) knownByLeaf.set(leaf, []);
      knownByLeaf.get(leaf).push({ path: p, seq: (seq += 1) });
    }
    function rememberPathSegments(path) {
      const p = normalizeBatchText(path);
      if (!p) return;
      if (!p.includes("/")) {
        remember(p);
        return;
      }
      const parts = p.split("/").filter(Boolean);
      let built = parts[0];
      remember(built);
      for (let i = 1; i < parts.length; i += 1) {
        built = built + "/" + parts[i];
        remember(built);
      }
    }
    remember(root);
    state.treeRows.forEach((row) => {
      if (normalizeForCompare(row.branch_key) !== normalizeForCompare(branch)) return;
      if (row.parent_name) rememberPathSegments(row.parent_name);
      rememberPathSegments(treeRowChildPath(row));
    });
    return { remember: rememberPathSegments, seqRef: () => seq, bumpSeq: () => { seq += 1; return seq; } };
  }

  function resolveParentPath(knownByLeaf, father, grandfather) {
    let candidates = (knownByLeaf.get(normalizeBatchText(father)) || []).slice();
    const gf = normalizeBatchText(grandfather);
    if (gf) {
      const filtered = candidates.filter((c) => batchLeaf(batchParentPath(c.path)) === gf);
      if (filtered.length) candidates = filtered;
    }
    candidates.sort((a, b) => b.seq - a.seq);
    return candidates.length ? candidates[0].path : "";
  }

  function analyzeLines(lines) {
    const branch = getSelectedBranch();
    const root = branch + " بن مطلق بن زيدان";
    const knownByLeaf = new Map();
    const { remember, bumpSeq } = seedKnownByLeaf(knownByLeaf, branch);
    const pendingByKey = new Map();
    const auditRows = [];

    function trackRelation(parent, child, sourceLine) {
      const p = normalizeBatchText(parent);
      const c = normalizeBatchText(child);
      if (!p || !c || p === c) return null;
      const key = relationKey(branch, p, c);
      const exists = treeHasRelation(branch, p, c) || pendingByKey.has(key);
      const row = { branch_key: branch, parent_name: p, child_name: c, sourceLine, relationKey: key };
      if (!treeHasRelation(branch, p, c) && !pendingByKey.has(key)) {
        pendingByKey.set(key, row);
      }
      remember(c);
      bumpSeq();
      return { ...row, exists };
    }

    function addFullLineageRelations(full, sourceLine) {
      const lineage = full && Array.isArray(full.lineage) ? full.lineage : [];
      if (lineage.length < 2) return { targetChild: "", targetExists: false, relations: [] };
      let parent = root;
      const relations = [];
      for (let i = 1; i < lineage.length; i += 1) {
        const leaf = normalizeBatchText(lineage[i]);
        if (!leaf) continue;
        const child = parent + "/" + leaf;
        const tracked = trackRelation(parent, child, sourceLine);
        if (tracked) relations.push(tracked);
        parent = child;
      }
      const last = relations.length ? relations[relations.length - 1] : null;
      return {
        targetChild: parent,
        targetExists: last ? last.exists : treeHasRelation(branch, batchParentPath(parent), parent),
        relations,
      };
    }

    const cleanLines = lines
      .map((line) => cleanBatchLine(line))
      .filter(Boolean)
      .filter((line) => line !== "الاسم");

    cleanLines.forEach((line) => {
      const full = parseBatchFullLineage(line, branch);
      if (full && full.relations && full.relations.length) {
        const result = addFullLineageRelations(full, line);
        if (result.targetExists) {
          auditRows.push({
            inputName: line,
            status: STATUS.existing,
            existingName: result.targetChild,
            branch,
            parent: batchParentPath(result.targetChild),
            reason: "الاسم موجود في الشجرة بتسلسل النسب الكامل.",
            approved: false,
          });
        } else if (result.targetChild) {
          auditRows.push({
            inputName: line,
            status: STATUS.ready,
            existingName: "",
            branch,
            parent: batchParentPath(result.targetChild),
            childName: result.targetChild,
            reason: "جاهز للإضافة — اضغط «إضافة غير الموجود فقط» لحفظه في الشجرة.",
            approved: true,
          });
        } else {
          auditRows.push({
            inputName: line,
            status: STATUS.review,
            existingName: "",
            branch,
            parent: "",
            reason: "تعذر بناء تسلسل النسب من السطر الكامل.",
            approved: false,
          });
        }
        return;
      }

      const short = parseBatchShortLine(line);
      if (!short || !short.name || !short.father) {
        auditRows.push({
          inputName: line,
          status: STATUS.review,
          existingName: "",
          branch,
          parent: "",
          reason: "صيغة غير مفهومة. استخدم: الاسم الأب الجد أو سطراً كاملاً يحتوي «بن مطلق بن زيدان».",
          approved: false,
        });
        return;
      }

      const parentPath = resolveParentPath(knownByLeaf, short.father, short.grandfather);
      if (!parentPath) {
        auditRows.push({
          inputName: line,
          status: STATUS.review,
          existingName: "",
          branch,
          parent: short.father + (short.grandfather ? " " + short.grandfather : ""),
          reason: "لم يُعثر على الأب «" + short.father + "» في الشجرة أو في الأسطر السابقة.",
          approved: false,
        });
        return;
      }

      const childPath = parentPath + "/" + normalizeBatchText(short.name);
      const exists = treeHasRelation(branch, parentPath, childPath) || pendingByKey.has(relationKey(branch, parentPath, childPath));
      trackRelation(parentPath, childPath, line);

      if (exists) {
        auditRows.push({
          inputName: line,
          status: STATUS.existing,
          existingName: childPath,
          branch,
          parent: parentPath,
          reason: "الاسم موجود في الشجرة تحت الأب المحدد.",
          approved: false,
        });
      } else {
        auditRows.push({
          inputName: line,
          status: STATUS.ready,
          existingName: "",
          branch,
          parent: parentPath,
          childName: childPath,
          reason: "جاهز للإضافة — اضغط «إضافة غير الموجود فقط» لحفظه في الشجرة.",
          approved: true,
        });
      }
    });

    state.auditRows = auditRows;
    state.pendingRelations = Array.from(pendingByKey.values()).filter(
      (row) => !treeHasRelation(row.branch_key, row.parent_name, row.child_name),
    );
    renderResults();
    renderSummary();
  }

  function updateSaveButton() {
    if (!auditSaveBtn) return;
    const count = state.pendingRelations.length;
    auditSaveBtn.textContent = count
      ? `إضافة غير الموجود فقط (${count} علاقة)`
      : "إضافة غير الموجود فقط";
    auditSaveBtn.disabled = count === 0;
    auditSaveBtn.title = count
      ? "اضغط لحفظ الأسماء الجاهزة في الشجرة"
      : "لا توجد أسماء جاهزة — نفّذ التحليل أولاً أو كل الأسماء موجودة";
  }

  function renderSummary() {
    const counts = {
      total: state.auditRows.length,
      existing: state.auditRows.filter((row) => row.status === STATUS.existing).length,
      ready: state.auditRows.filter((row) => row.status === STATUS.ready).length,
      review: state.auditRows.filter((row) => row.status === STATUS.review).length,
      relations: state.pendingRelations.length,
    };

    let summary = `تم تحليل ${counts.total} سطرًا — موجود في الشجرة: ${counts.existing} — جاهز للإضافة: ${counts.ready} — يحتاج مراجعة: ${counts.review}`;
    if (counts.relations) {
      summary += ` — ${counts.relations} علاقة بانتظار الحفظ. الخطوة التالية: اضغط «إضافة غير الموجود فقط».`;
    } else if (counts.total) {
      summary += " — لا توجد أسماء جديدة للحفظ.";
    }
    setStatus(summary);
    updateSaveButton();
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
          <td>${escapeHtml(row.existingName || row.childName || "")}</td>
          <td>${escapeHtml(row.branch || "")}</td>
          <td>${escapeHtml(row.parent || "")}</td>
          <td>${escapeHtml(row.reason || "")}</td>
          <td>${checkbox}</td>
        </tr>`;
    }).join("");
  }

  function getPayloadRows() {
    return state.pendingRelations.map((row) => ({
      branch_key: row.branch_key,
      parent_name: row.parent_name,
      child_name: row.child_name,
    }));
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

    const duplicateCount = state.auditRows.filter((row) => row.status === STATUS.existing).length;
    const reviewCount = state.auditRows.filter((row) => row.status === STATUS.review).length;

    try {
      setStatus(`جاري إضافة ${payload.length} علاقة...`);
      const { data, error } = await sb.rpc("admin_tree_children_import_v1", { p_token: token, p_rows: payload });
      if (error) {
        setStatus("فشل الحفظ: " + String(error.message || "خطأ غير معروف"));
        showAlert("error", "تعذر الإضافة حالياً: " + String(error.message || ""));
        return false;
      }

      const inserted = Number(data && data.inserted != null ? data.inserted : 0) || 0;
      const skipped = Number(data && data.skipped != null ? data.skipped : 0) || 0;
      const updated = Number(data && data.updated != null ? data.updated : 0) || 0;
      const failed = Math.max(0, payload.length - inserted - skipped - updated);

      const summary = [
        `تمت الإضافة: ${inserted}`,
        `تخطّي (مكرر): ${skipped + duplicateCount}`,
        failed ? `فشل: ${failed}` : null,
        reviewCount ? `يحتاج مراجعة: ${reviewCount}` : null,
      ].filter(Boolean).join(" — ");

      setStatus(summary);
      showAlert("success", summary);

      await loadTreeRows();
      const lines = String(auditInput ? auditInput.value : "")
        .split(/\r?\n/g)
        .map((line) => String(line || "").trim())
        .filter(Boolean);
      if (lines.length) analyzeLines(lines);

      return true;
    } catch (error) {
      setStatus("فشل الحفظ: " + String(error && error.message ? error.message : error));
      showAlert("error", "تعذر الإضافة حالياً.");
      return false;
    }
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
        if (!lines.length) {
          state.auditRows = [];
          state.pendingRelations = [];
          renderResults();
          updateSaveButton();
          setStatus("أدخل أسماء أولاً.");
          return;
        }
        analyzeLines(lines);
      });
    }

    if (auditSaveBtn) {
      auditSaveBtn.addEventListener("click", async () => {
        await performSave();
      });
    }

    if (auditBranch) {
      auditBranch.addEventListener("change", () => {
        if (state.auditRows.length) {
          setStatus("غيّرت الفرع — أعد التحليل لتحديث النتائج.");
        }
      });
    }
  }

  async function init() {
    if (!auditSection) return;
    attachEvents();
    await loadTreeRows();
    renderResults();
    updateSaveButton();
    setStatus("خطوتان: ① الصق الأسماء واضغط «تحليل الأسماء» ② ثم «إضافة غير الموجود فقط» للحفظ.");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
