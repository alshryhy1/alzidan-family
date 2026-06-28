(function () {
  const core = window.AlzidanAdminCore || {};
  const hideAlert =
    typeof core.hideAlert === "function"
      ? core.hideAlert.bind(core)
      : function () {};
  const copyText =
    typeof core.copyText === "function"
      ? core.copyText.bind(core)
      : async function (text) {
          const t = String(text || "");
          if (!t) return false;
          try {
            if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
              await navigator.clipboard.writeText(t);
              return true;
            }
          } catch (e) {}
          const el = document.createElement("textarea");
          el.value = t;
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
          return true;
        };
  const downloadTextFile =
    typeof core.downloadTextFile === "function"
      ? core.downloadTextFile.bind(core)
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
  const escapeHtml =
    typeof core.escapeHtml === "function"
      ? core.escapeHtml.bind(core)
      : function (value) {
          return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
        };
  const normalizeArabicDigitsToLatin =
    typeof core.normalizeArabicDigitsToLatin === "function"
      ? core.normalizeArabicDigitsToLatin.bind(core)
      : function (v) {
          return String(v || "")
            .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632))
            .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 1776));
        };

  const batchTreeBranch = document.getElementById("batch-tree-branch");
  const batchTreeInput = document.getElementById("batch-tree-input");
  const batchTreeSql = document.getElementById("batch-tree-sql");
  const batchTreeBuild = document.getElementById("batch-tree-build");
  const batchTreeCopy = document.getElementById("batch-tree-copy");
  const batchTreeDownload = document.getElementById("batch-tree-download");
  const batchTreeSummary = document.getElementById("batch-tree-summary");
  const batchTreeStatus = document.getElementById("batch-tree-status");
  const batchTreeNotes = document.getElementById("batch-tree-notes");

  function setBatchTreeStatus(text) {
    if (!batchTreeStatus) return;
    batchTreeStatus.textContent = String(text || "");
  }
  function normalizeBatchText(v) {
    return normalizeArabicDigitsToLatin(String(v || ""))
      .replace(/[\u064B-\u065F\u0670]/g, "")
      .replace(/[إأآ]/g, "أ")
      .replace(/\s+/g, " ")
      .trim();
  }
  function cleanBatchLine(v) {
    let s = normalizeBatchText(v);
    s = s.replace(/^(?:أرسلت من الـ iPhone|الاسم)\s*/i, "").trim();
    s = s.replace(/^[\d\s/\\.\-:،,؛\])(\[]+/, "").trim();
    s = s.replace(/\b(?:الزيدان|الشريهي|الشريهى|الشريه)\b/g, "").trim();
    s = s.replace(/\s+/g, " ").trim();
    return s;
  }
  function batchJoinAbd(words, start) {
    const list = Array.isArray(words) ? words : [];
    const first = normalizeBatchText(list[start] || "");
    if (!first) return { value: "", next: start };
    if (first === "عبد" && list[start + 1]) {
      return {
        value: normalizeBatchText("عبد" + String(list[start + 1] || "")),
        next: start + 2,
      };
    }
    return { value: first, next: start + 1 };
  }
  function batchLeaf(path) {
    const s = normalizeBatchText(path);
    if (!s) return "";
    if (s.includes("/")) return s.split("/").filter(Boolean).slice(-1)[0] || s;
    const rootMatch = s.match(/^(.+?)\s+بن\s+مطلق\s+بن\s+زيدان$/);
    return rootMatch ? normalizeBatchText(rootMatch[1]) : s;
  }
  function batchParentPath(path) {
    const s = normalizeBatchText(path);
    if (!s || !s.includes("/")) return "";
    const parts = s.split("/").filter(Boolean);
    parts.pop();
    return parts.join("/");
  }
  function batchSqlLiteral(v) {
    return "'" + String(v || "").replace(/'/g, "''") + "'";
  }
  function parseBatchFullLineage(line, branch) {
    const raw = cleanBatchLine(line);
    if (!raw || !/\s+بن\s+/.test(raw) || !raw.includes("مطلق بن زيدان"))
      return null;
    const parts = raw
      .split(/\s+بن\s+/g)
      .map((p) =>
        cleanBatchLine(p)
          .replace(/\b(?:ناصر|مفلح|مطلق|زيدان)\b\s*$/g, "")
          .trim(),
      )
      .map((p) => normalizeBatchText(p))
      .filter(Boolean);
    const branchKey = normalizeBatchText(branch);
    const branchIndex = parts.findIndex((p) => p === branchKey);
    if (branchIndex < 0) return null;
    const lineage = parts.slice(0, branchIndex + 1).reverse();
    if (lineage[0] !== branchKey || lineage.length < 2) return null;
    let parent = branchKey + " بن مطلق بن زيدان";
    const relations = [];
    for (let i = 1; i < lineage.length; i += 1) {
      const child = parent + "/" + lineage[i];
      relations.push({ parent, child, source: raw });
      parent = child;
    }
    return { path: parent, relations, lineage, source: raw };
  }
  function parseBatchShortLine(line) {
    const raw = cleanBatchLine(line);
    if (!raw) return null;
    if (raw === "الاسم") return null;
    const words = raw
      .split(/\s+/g)
      .map((w) => normalizeBatchText(w))
      .filter(Boolean);
    if (words.length < 2) return null;
    let pos = 0;
    const namePart = batchJoinAbd(words, pos);
    const name = namePart.value;
    pos = namePart.next;
    const fatherPart = batchJoinAbd(words, pos);
    const father = fatherPart.value;
    pos = fatherPart.next;
    const grandfatherPart = batchJoinAbd(words, pos);
    const grandfather = grandfatherPart.value;
    if (!name || !father) return null;
    return { raw, name, father, grandfather };
  }
  function renderBatchSummary(result) {
    if (!batchTreeSummary) return;
    const r = result || {};
    const items = [
      ["الأسطر", r.lineCount || 0],
      ["العلاقات", (r.rows || []).length],
      ["مكرر داخل النص", (r.duplicates || []).length],
    ];
    batchTreeSummary.innerHTML = items
      .map(
        ([label, value]) =>
          '<div class="batch-stat"><strong>' +
          escapeHtml(value) +
          "</strong><span>" +
          escapeHtml(label) +
          "</span></div>",
      )
      .join("");
  }
  function renderBatchNotes(result) {
    if (!batchTreeNotes) return;
    const r = result || {};
    const notes = [];
    (r.unresolved || []).forEach((x) => notes.push("لم أتعرف على الأب: " + x));
    (r.duplicates || [])
      .slice(0, 25)
      .forEach((x) => notes.push("تكرار داخل النص: " + x));
    (r.suspicious || [])
      .slice(0, 25)
      .forEach((x) => notes.push("اسم مشتبه: " + x));
    batchTreeNotes.innerHTML = notes.length
      ? notes
          .map(
            (n) => '<div class="batch-list-item">' + escapeHtml(n) + "</div>",
          )
          .join("")
      : '<div class="batch-list-item">لا توجد ملاحظات واضحة داخل النص.</div>';
  }
  function buildBatchTreeSql() {
    const branch = normalizeBatchText(
      batchTreeBranch ? batchTreeBranch.value : "",
    );
    const raw = String(batchTreeInput ? batchTreeInput.value : "");
    const lines = raw
      .split(/\r?\n/g)
      .map(cleanBatchLine)
      .filter(Boolean)
      .filter((l) => l !== "الاسم");
    const root = branch + " بن مطلق بن زيدان";
    const rows = [];
    const duplicates = [];
    const unresolved = [];
    const suspicious = [];
    const seenRelations = new Set();
    const knownByLeaf = new Map();
    let seq = 0;
    function remember(path) {
      const p = normalizeBatchText(path);
      const leaf = batchLeaf(p);
      if (!leaf) return;
      if (!knownByLeaf.has(leaf)) knownByLeaf.set(leaf, []);
      knownByLeaf.get(leaf).push({ path: p, seq: (seq += 1) });
    }
    function addRelation(parent, child, source) {
      const p = normalizeBatchText(parent);
      const c = normalizeBatchText(child);
      if (!p || !c || p === c) return;
      const key = p + "||" + c;
      if (seenRelations.has(key)) {
        duplicates.push(source || c);
        return;
      }
      seenRelations.add(key);
      rows.push({ branch, parent: p, child: c });
      remember(p);
      remember(c);
    }
    function resolveParent(father, grandfather) {
      let candidates = (
        knownByLeaf.get(normalizeBatchText(father)) || []
      ).slice();
      const gf = normalizeBatchText(grandfather);
      if (gf) {
        const filtered = candidates.filter(
          (c) => batchLeaf(batchParentPath(c.path)) === gf,
        );
        if (filtered.length) candidates = filtered;
      }
      candidates.sort((a, b) => b.seq - a.seq);
      return candidates.length ? candidates[0].path : "";
    }
    function addFullLineageRelations(full) {
      const lineage = full && Array.isArray(full.lineage) ? full.lineage : [];
      if (lineage.length < 2) return false;
      let parent = root;
      for (let i = 1; i < lineage.length; i += 1) {
        const leaf = normalizeBatchText(lineage[i]);
        if (!leaf) continue;
        const child = parent + "/" + leaf;
        addRelation(parent, child, full.source || child);
        parent = child;
      }
      return true;
    }
    remember(root);
    lines.forEach((line) => {
      if (/[^-\s\d/\\.\-:،,؛\])(\[]/.test(line))
        suspicious.push(line);
      const full = parseBatchFullLineage(line, branch);
      if (full && full.relations && full.relations.length) {
        addFullLineageRelations(full);
        return;
      }
      const short = parseBatchShortLine(line);
      if (!short) {
        suspicious.push(line);
        return;
      }
      const parent = resolveParent(short.father, short.grandfather);
      if (!parent) {
        unresolved.push(short.raw);
        return;
      }
      addRelation(parent, parent + "/" + short.name, short.raw);
    });
    const values = rows
      .map(
        (r) =>
          " (" +
          [r.branch, r.parent, r.child].map(batchSqlLiteral).join(", ") +
          ")",
      )
      .join(",\n");
    const sql = rows.length
      ? `-- Generated by admin batch tree tool
-- يضيف العلاقات الناقصة فقط ولا يكرر الموجود.
do $$
declare r record; v_parent_person_id uuid;
begin create temporary table tmp_batch_tree_rows ( branch_key text, parent_name text, child_name text ) on commit drop; insert into tmp_batch_tree_rows (branch_key, parent_name, child_name) values
${values}; for r in select * from tmp_batch_tree_rows loop select min(c.person_id::text)::uuid into v_parent_person_id from public.tree_children c where c.branch_key = r.branch_key and coalesce(c.child_name, c.name) = r.parent_name and c.person_id is not null; insert into public.tree_children ( branch_key, parent_name, parent, child_name, name, person_id, parent_person_id, is_deceased, deceased, created_at ) select r.branch_key, r.parent_name, r.parent_name, r.child_name, r.child_name, gen_random_uuid(), v_parent_person_id, false, false, now() where not exists ( select 1 from public.tree_children c where c.branch_key = r.branch_key and coalesce(c.parent_name, c.parent) = r.parent_name and coalesce(c.child_name, c.name) = r.child_name ); end loop;
end $$; تحديث الخدمة, 'تحديث البيانات';
`
      : "";
    return {
      branch,
      lineCount: lines.length,
      rows,
      duplicates,
      unresolved,
      suspicious,
      sql,
    };
  }
  function runBatchTreeBuild() {
    const result = buildBatchTreeSql();
    if (batchTreeSql) batchTreeSql.value = result.sql || "";
    renderBatchSummary(result);
    renderBatchNotes(result);
    if (!result.lineCount) {
      setBatchTreeStatus("الصق الأسماء أولاً.");
    } else if (!result.rows.length) {
      setBatchTreeStatus(
        "لم يتم تجهيز علاقات. تأكد من وجود سطر كامل يحتوي: بن مطلق بن زيدان.",
      );
    } else {
      setBatchTreeStatus(
        "تم تجهيز أمر الصيانة بعدد " +
          result.rows.length +
          " علاقة. راجع الملاحظات قبل التنفيذ.",
      );
    }
    return result;
  }

  if (batchTreeBuild) {
    batchTreeBuild.addEventListener("click", () => {
      hideAlert();
      runBatchTreeBuild();
    });
  }
  if (batchTreeCopy) {
    batchTreeCopy.addEventListener("click", async () => {
      hideAlert();
      let sql = batchTreeSql ? String(batchTreeSql.value || "") : "";
      if (!sql) sql = runBatchTreeBuild().sql || "";
      if (!sql) {
        setBatchTreeStatus("لا يوجد أمر صيانة للنسخ.");
        return;
      }
      const ok = await copyText(sql);
      setBatchTreeStatus(ok ? "تم نسخ أمر الصيانة." : "تعذر نسخ أمر الصيانة.");
    });
  }
  if (batchTreeDownload) {
    batchTreeDownload.addEventListener("click", () => {
      hideAlert();
      let sql = batchTreeSql ? String(batchTreeSql.value || "") : "";
      if (!sql) sql = runBatchTreeBuild().sql || "";
      if (!sql) {
        setBatchTreeStatus("لا يوجد أمر صيانة للتحميل.");
        return;
      }
      downloadTextFile(
        "alzidan-batch-tree-import.txt",
        sql,
        "text/sql;charset=utf-8",
      );
      setBatchTreeStatus("تم تحميل ملف الصيانة.");
    });
  }
})();
