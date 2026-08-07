/* ===== public family poll (homepage) ===== */

(function () {
  "use strict";

  console.log("[poll] module load");

  /** Policy: one vote per voter_key; no edit after cast (DB unique). */
  var ALLOW_VOTE_EDIT = false;

  let sbClient = null;

  function getClient() {
    if (sbClient) return sbClient;
    if (window.__alzidanConfig && typeof window.__alzidanConfig.getClient === "function") {
      return (sbClient = window.__alzidanConfig.getClient());
    }
    if (window.__alzidanSupabaseClient) return (sbClient = window.__alzidanSupabaseClient);
    if (window.__alzidanالخدمةClient) return (sbClient = window.__alzidanالخدمةClient);
    return null;
  }

  function getVoterKey() {
    const k = "alzidan_public_poll_voter_v1";
    try {
      let v = localStorage.getItem(k);
      if (!v) {
        v = "v_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2);
        localStorage.setItem(k, v);
      }
      return v;
    } catch (e) {
      return "session_" + Math.random().toString(36).slice(2);
    }
  }

  function voteLabel(value) {
    if (value === "support") return "مؤيد";
    if (value === "oppose") return "معارض";
    return "";
  }

  function formatVoteDate(iso) {
    if (!iso) return "";
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return "";
    try {
      return new Date(ms).toLocaleString("ar-SA", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (e) {
      return String(iso).slice(0, 16);
    }
  }

  function votedStatusMessage(value, createdAt) {
    const label = voteLabel(value);
    const when = formatVoteDate(createdAt);
    if (label && when) return "تم تسجيل تصويتك («" + label + "») · " + when;
    if (label) return "تم تسجيل تصويتك («" + label + "»)";
    return "تم تسجيل تصويتك.";
  }

  /**
   * ends_at must be a Gregorian-comparable timestamp.
   * Hijri years (≈1200–1700) stored in timestamptz look like year 1448 CE and
   * falsely trip `new Date(ends_at) < now` → "انتهى التصويت".
   * Prefer DateEngine when loaded; keep local heuristic as fallback.
   */
  function parseGregorianEndsAtMs(value) {
    const engine = window.AlzidanDateEngine;
    if (engine && typeof engine.assertGregorianTimestamp === "function") {
      const guard = engine.assertGregorianTimestamp(value, { optional: true });
      if (guard.empty) return { ok: false, ms: null, reason: "missing" };
      if (!guard.ok) {
        return {
          ok: false,
          ms: null,
          reason:
            guard.code === "DATE-002"
              ? "hijri_or_non_gregorian_year"
              : "rejected:" + (guard.code || "date"),
          year: guard.year,
          raw: String(value),
        };
      }
      const ms = Date.parse(guard.iso);
      return {
        ok: Number.isFinite(ms),
        ms: Number.isFinite(ms) ? ms : null,
        year: guard.year,
        raw: String(value),
      };
    }

    if (value == null || value === "") {
      return { ok: false, ms: null, reason: "missing" };
    }
    const raw = String(value);
    const yearMatch = /^(\d{4})/.exec(raw.trim());
    const rawYear = yearMatch ? Number(yearMatch[1]) : NaN;
    if (Number.isFinite(rawYear) && rawYear >= 1200 && rawYear <= 1700) {
      return {
        ok: false,
        ms: null,
        reason: "hijri_or_non_gregorian_year",
        year: rawYear,
        raw: raw,
      };
    }

    const ms = Date.parse(raw);
    if (!Number.isFinite(ms)) {
      return { ok: false, ms: null, reason: "unparseable", raw: raw };
    }
    const year = new Date(ms).getUTCFullYear();
    if (year < 1900 || year > 2100) {
      return {
        ok: false,
        ms: null,
        reason: "out_of_gregorian_range",
        year: year,
        raw: raw,
      };
    }
    return { ok: true, ms: ms, year: year, raw: raw };
  }

  /** Vote gate: is_active + valid Gregorian ends_at only. Never gate on Hijri/junk dates. */
  function getPollVoteGate(poll) {
    const isActive = !!(poll && poll.is_active === true);
    const ends = parseGregorianEndsAtMs(poll && poll.ends_at);
    let pollEnded = false;
    let endedReason = "not_ended";

    if (ends.ok) {
      if (ends.ms < Date.now()) {
        pollEnded = true;
        endedReason = "ends_at_before_now";
      } else {
        endedReason = "ends_at_in_future";
      }
    } else if (ends.reason === "missing") {
      endedReason = "no_ends_at";
    } else {
      endedReason = "ends_at_ignored:" + ends.reason;
    }

    const canVote = isActive && !pollEnded;
    let disabledReason = "";
    if (!isActive) disabledReason = "is_active_false";
    else if (pollEnded) disabledReason = endedReason;
    else disabledReason = "none";

    return {
      isActive: isActive,
      endsAt: poll && poll.ends_at,
      endsParse: ends,
      pollEnded: pollEnded,
      endedReason: endedReason,
      canVote: canVote,
      disabledReason: disabledReason,
    };
  }

  function buildCard() {
    const card = document.createElement("aside");
    card.className = "family-poll-card";
    card.innerHTML = `
      <div class="family-poll-ring" data-poll-ring style="--p:0%">
        <div class="family-poll-percent" data-poll-percent>
          <span class="family-poll-pct-support" data-poll-pct-support>0%</span>
          <span class="family-poll-pct-oppose" data-poll-pct-oppose>0%</span>
        </div>
      </div>
      <div class="family-poll-body">
        <div class="family-poll-title">تصويت عام</div>
        <div class="family-poll-question" data-poll-question>جاري تحميل التصويت...</div>
        <div class="family-poll-actions">
          <button class="family-poll-support" type="button" data-poll-vote="support">مؤيد</button>
          <button class="family-poll-oppose" type="button" data-poll-vote="oppose">معارض</button>
        </div>
        <div class="family-poll-stats">
          <span data-poll-support>مؤيد: 0 (0%)</span>
          <span data-poll-oppose>معارض: 0 (0%)</span>
          <span data-poll-total>الإجمالي: 0</span>
        </div>
        <div class="family-poll-status" data-poll-status></div>
      </div>
    `;
    return card;
  }

  function setVoteButtonsState(card, options) {
    const opts = options || {};
    const myVote = opts.myVote || "";
    const enabled = !!opts.enabled;
    card.querySelectorAll("[data-poll-vote]").forEach((btn) => {
      const value = btn.getAttribute("data-poll-vote");
      const base = voteLabel(value) || btn.textContent.replace(/\s*✓\s*$/, "").trim();
      const chosen = myVote && value === myVote;
      btn.textContent = chosen ? base + " ✓" : base;
      btn.classList.toggle("is-chosen", !!chosen);
      btn.disabled = !enabled;
      btn.setAttribute("aria-pressed", chosen ? "true" : "false");
    });
  }

  function renderResults(card, support, oppose, statusText) {
    const total = support + oppose;
    const supportPct = total ? Math.round((support / total) * 100) : 0;
    const opposePct = total ? Math.max(0, 100 - supportPct) : 0;

    card.querySelector("[data-poll-ring]").style.setProperty("--p", supportPct + "%");
    const pctSupport = card.querySelector("[data-poll-pct-support]");
    const pctOppose = card.querySelector("[data-poll-pct-oppose]");
    if (pctSupport) pctSupport.textContent = supportPct + "%";
    if (pctOppose) pctOppose.textContent = opposePct + "%";

    card.querySelector("[data-poll-support]").textContent =
      "مؤيد: " + support + " (" + supportPct + "%)";
    card.querySelector("[data-poll-oppose]").textContent =
      "معارض: " + oppose + " (" + opposePct + "%)";
    card.querySelector("[data-poll-total]").textContent = "الإجمالي: " + total;

    const status = card.querySelector("[data-poll-status]");
    if (status && statusText != null) status.textContent = statusText;
  }

  async function fetchMyVote(sb, pollId) {
    const { data, error } = await sb
      .from("family_poll_votes")
      .select("vote_value,created_at")
      .eq("poll_id", pollId)
      .eq("voter_key", getVoterKey())
      .limit(1);

    if (error || !data || !data[0]) return null;
    return data[0];
  }

  async function loadPoll(card) {
    const sb = getClient();
    const status = card.querySelector("[data-poll-status]");
    if (!sb) {
      status.textContent = "تعذر تحميل التصويت.";
      console.warn("[poll] loadPoll: no supabase client");
      return;
    }

    const { data: polls, error } = await sb
      .from("family_polls")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error || !polls || !polls[0]) {
      status.textContent = "لا يوجد تصويت نشط حالياً.";
      console.warn("[poll] loadPoll: no active poll", error);
      return;
    }

    const poll = polls[0];
    const gate = getPollVoteGate(poll);
    card.dataset.pollId = String(poll.id);
    card.dataset.canVote = gate.canVote ? "1" : "0";

    console.log("[poll] status gate", {
      pollId: poll.id,
      is_active: gate.isActive,
      ends_at: gate.endsAt,
      endsParse: gate.endsParse,
      pollEnded: gate.pollEnded,
      endedReason: gate.endedReason,
      canVote: gate.canVote,
      buttonsDisabledReason: gate.disabledReason,
    });

    const questionEl = card.querySelector("[data-poll-question]");
    const questionText = poll.question || "تصويت عام";
    questionEl.textContent = poll.description
      ? questionText + " — " + poll.description
      : questionText;

    const { data: votes } = await sb
      .from("family_poll_votes")
      .select("vote_value")
      .eq("poll_id", poll.id);

    const list = Array.isArray(votes) ? votes : [];
    const support = list.filter((v) => v.vote_value === "support").length;
    const oppose = list.filter((v) => v.vote_value === "oppose").length;
    const total = support + oppose;

    const myVoteRow = await fetchMyVote(sb, poll.id);
    const myVote = myVoteRow && myVoteRow.vote_value ? myVoteRow.vote_value : "";
    card.dataset.myVote = myVote || "";

    let statusText = "";
    if (!gate.canVote) {
      statusText = gate.pollEnded
        ? "انتهى التصويت."
        : "التصويت غير متاح حالياً.";
      if (myVote) {
        statusText =
          votedStatusMessage(myVote, myVoteRow && myVoteRow.created_at) +
          (gate.pollEnded ? " · انتهى التصويت." : "");
      }
      setVoteButtonsState(card, { enabled: false, myVote: myVote });
      renderResults(card, support, oppose, statusText);
      console.log("[poll] buttons disabled", {
        why: gate.disabledReason,
        pollEnded: gate.pollEnded,
        is_active: gate.isActive,
        ends_at: gate.endsAt,
      });
      return;
    }

    if (myVote && !ALLOW_VOTE_EDIT) {
      statusText = votedStatusMessage(myVote, myVoteRow && myVoteRow.created_at);
      setVoteButtonsState(card, { enabled: false, myVote: myVote });
    } else {
      statusText = total
        ? "نسبة التأييد والمعارضة الحالية"
        : "كن أول المصوتين";
      setVoteButtonsState(card, { enabled: true, myVote: myVote });
    }

    renderResults(card, support, oppose, statusText);
    console.log("[poll] loadPoll: ready", {
      pollId: poll.id,
      support,
      oppose,
      total,
      myVote: myVote || null,
    });
  }

  async function vote(card, value) {
    console.log("[poll] click vote", value);
    const sb = getClient();
    const pollId = Number(card.dataset.pollId || 0);
    const status = card.querySelector("[data-poll-status]");

    if (!status) {
      console.warn("[poll] vote: missing status element");
      return;
    }
    if (!sb) {
      status.textContent = "تعذر الاتصال — حاول لاحقاً.";
      console.warn("[poll] vote: no supabase client");
      return;
    }
    if (!pollId) {
      status.textContent = "لا يوجد تصويت جاهز بعد.";
      console.warn("[poll] vote: missing pollId");
      return;
    }
    if (card.dataset.canVote !== "1") {
      status.textContent = "التصويت غير متاح حالياً.";
      console.warn("[poll] vote blocked: canVote=false", {
        pollId: pollId,
        canVote: card.dataset.canVote,
      });
      return;
    }
    if (card.dataset.myVote && !ALLOW_VOTE_EDIT) {
      status.textContent = votedStatusMessage(card.dataset.myVote);
      return;
    }

    status.textContent = "جاري حفظ التصويت...";
    setVoteButtonsState(card, { enabled: false, myVote: value });
    console.log("[poll] before insert", { pollId, value, canVote: true });
    const { data, error } = await sb
      .from("family_poll_votes")
      .insert({
        poll_id: pollId,
        voter_key: getVoterKey(),
        vote_value: value,
      })
      .select("id,vote_value,created_at");

    console.log("[poll] after insert", { data, error });

    if (error) {
      const code = String(error.code || "");
      const msg = String(error.message || "");
      if (code === "23505" || /duplicate|unique/i.test(msg)) {
        const existing = await fetchMyVote(sb, pollId);
        if (existing && existing.vote_value) {
          card.dataset.myVote = existing.vote_value;
          status.textContent = votedStatusMessage(
            existing.vote_value,
            existing.created_at,
          );
          setVoteButtonsState(card, {
            enabled: ALLOW_VOTE_EDIT,
            myVote: existing.vote_value,
          });
        } else {
          status.textContent = "تم تسجيل تصويتك سابقاً.";
          setVoteButtonsState(card, { enabled: false, myVote: value });
        }
      } else if (/row-level security|RLS|permission|42501/i.test(msg + " " + code)) {
        status.textContent = "تعذر حفظ التصويت (صلاحيات).";
        console.error("[poll] insert blocked by RLS", error);
        setVoteButtonsState(card, { enabled: true, myVote: "" });
      } else {
        status.textContent = "تعذر حفظ التصويت. حاول مرة أخرى.";
        console.error("[poll] insert failed", error);
        setVoteButtonsState(card, { enabled: true, myVote: "" });
      }
      await loadPoll(card);
      return;
    }

    const saved = data && data[0] ? data[0] : null;
    const savedValue = (saved && saved.vote_value) || value;
    card.dataset.myVote = savedValue;
    status.textContent = votedStatusMessage(
      savedValue,
      saved && saved.created_at,
    );
    setVoteButtonsState(card, {
      enabled: ALLOW_VOTE_EDIT,
      myVote: savedValue,
    });
    await loadPoll(card);
  }

  function bindVoteButtons(card) {
    const buttons = card.querySelectorAll("[data-poll-vote]");
    console.log("[poll] button bind", buttons.length);
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        vote(card, btn.getAttribute("data-poll-vote"));
      });
    });
  }

  function mount() {
    console.log("[poll] initPoll/mount start");
    const search = document.getElementById("search");
    if (!search) {
      console.warn("[poll] mount aborted: #search not found");
      return;
    }
    if (document.querySelector(".search-poll-row")) {
      console.log("[poll] mount skipped: already mounted");
      return;
    }

    const row = document.createElement("div");
    row.className = "search-poll-row";

    const card = buildCard();
    const parent = search.parentNode;
    parent.insertBefore(row, search);

    const statsCard = document.createElement("aside");
    statsCard.className = "family-mini-stats-card";
    statsCard.innerHTML =
      '<div class="family-mini-stats-title">إحصائيات شجرة عائلة الزيدان</div><div class="family-mini-stats-circles"><div class="family-mini-stat-circle"><div class="family-mini-stat-value" id="mini-tree-total-card">—</div><div class="family-mini-stat-label">إجمالي الشجرة</div></div><div class="family-mini-stat-circle"><div class="family-mini-stat-value">٥</div><div class="family-mini-stat-label">الفروع</div></div><div class="family-mini-stat-circle"><div class="family-mini-stat-value" id="mini-visits-total-card">—</div><div class="family-mini-stat-label">إجمالي الزيارات</div></div></div>';

    row.appendChild(card);
    row.appendChild(statsCard);

    bindVoteButtons(card);
    loadPoll(card).catch((err) => {
      console.error("[poll] loadPoll failed", err);
    });
    console.log("[poll] initPoll/mount done");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();

/* ===== mini stats sync ===== */

(function () {
  function syncMiniStatsCard() {
    var tree = document.getElementById("mini-tree-total");
    var visits = document.getElementById("mini-visits-total");
    var treeCard = document.getElementById("mini-tree-total-card");
    var visitsCard = document.getElementById("mini-visits-total-card");
    if (tree && treeCard) treeCard.textContent = tree.textContent || "—";
    if (visits && visitsCard) visitsCard.textContent = visits.textContent || "—";
  }
  syncMiniStatsCard();
  const miniStatsTargets = ["mini-tree-total", "mini-visits-total"]
    .map((id) => document.getElementById(id))
    .filter(Boolean);
  if (miniStatsTargets.length && typeof MutationObserver === "function") {
    const miniStatsObserver = new MutationObserver(() => syncMiniStatsCard());
    miniStatsTargets.forEach((target) =>
      miniStatsObserver.observe(target, { childList: true, characterData: true, subtree: true })
    );
  }
})();
