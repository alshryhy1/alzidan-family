(() => {
	"use strict";

	let isInitialized = false;

	function getClient() {
		if (window.AlzidanAdminCore && typeof window.AlzidanAdminCore.getClient === "function") {
			return window.AlzidanAdminCore.getClient();
		}
		if (window.__alzidanConfig && typeof window.__alzidanConfig.getClient === "function") {
			return window.__alzidanConfig.getClient();
		}
		return window.__alzidanSupabaseClient || window.__alzidanالخدمةClient || null;
	}

	const el = () => document.getElementById("marriage-stats");
	const btn = () => document.getElementById("refresh-marriage-stats");

	function esc(value) {
		return String(value == null ? "" : value)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/\"/g, "&quot;");
	}

	function renderText(text) {
		const box = el();
		if (!box) return;
		box.textContent = text;
	}

	function countBy(rows, picker) {
		const map = new Map();
		rows.forEach((row) => {
			const key = String(picker(row) || "").trim() || "غير محدد";
			map.set(key, (map.get(key) || 0) + 1);
		});
		return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
	}

	function render(rows) {
		const box = el();
		if (!box) return;

		const list = Array.isArray(rows) ? rows : [];
		const active = list.filter((r) => String(r.status || "active") === "active");

		const inside = active.filter((r) => r.wife_is_family_member === true).length;
		const outside = active.filter((r) => r.wife_is_family_member === false).length;
		const unknown = active.filter((r) => r.wife_is_family_member !== true && r.wife_is_family_member !== false).length;
		const linkedChildren = active.reduce((sum, r) => sum + (Number(r.linked_children_count) || 0), 0);

		const internalBranches = countBy(
			active.filter((r) => r.wife_is_family_member === true),
			(r) => r.wife_branch_key
		).slice(0, 5);

		const externalFamilies = countBy(
			active.filter((r) => r.wife_is_family_member === false),
			(r) => r.wife_family_name
		).slice(0, 5);

		const branchPairs = new Map();
		active
			.filter((r) => r.wife_is_family_member === true && r.husband_branch_key && r.wife_branch_key)
			.forEach((r) => {
				const a = String(r.husband_branch_key || "").trim();
				const b = String(r.wife_branch_key || "").trim();
				if (!a || !b) return;
				const pair = [a, b].sort().join(" ↔ ");
				branchPairs.set(pair, (branchPairs.get(pair) || 0) + 1);
			});

		const topBranchPairs = Array.from(branchPairs.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, 8);

		function card(label, value) {
			return '<div class="requests-stat-card"><strong>' + esc(value) + '</strong><span>' + esc(label) + '</span></div>';
		}

		let html = '<div class="requests-stats-cards">';
		html += card("إجمالي الزوجات", active.length);
		html += card("داخل العائلة", inside);
		html += card("خارج العائلة", outside);
		html += card("غير محدد", unknown);
		html += card("أبناء مرتبطون بالأمهات", linkedChildren);
		html += "</div>";

		html += '<div class="grid" style="margin-top:12px;">';

		html += '<div class="card" style="box-shadow:none;border:1px solid #e5e7eb;">';
		html += '<div class="section-title" style="font-size:15px;margin-bottom:8px;">أكثر فروع الزوجات من داخل العائلة</div>';
		html += internalBranches.length
			? internalBranches.map(([name, total]) => '<div class="hint">' + esc(name) + ': ' + esc(total) + '</div>').join("")
			: '<div class="hint">لا توجد بيانات كافية.</div>';
		html += '</div>';

		html += '<div class="card" style="box-shadow:none;border:1px solid #e5e7eb;">';
		html += '<div class="section-title" style="font-size:15px;margin-bottom:8px;">أكثر العوائل الخارجية مصاهرة</div>';
		html += externalFamilies.length
			? externalFamilies.map(([name, total]) => '<div class="hint">' + esc(name) + ': ' + esc(total) + '</div>').join("")
			: '<div class="hint">لا توجد بيانات كافية.</div>';
		html += '</div>';

		html += '<div class="card" style="box-shadow:none;border:1px solid #e5e7eb;grid-column:1/-1;">';
		html += '<div class="section-title" style="font-size:15px;margin-bottom:8px;">أكثر المصاهرات بين الفروع</div>';
		html += topBranchPairs.length
			? topBranchPairs.map(([name, total]) => '<div class="hint">' + esc(name) + ': ' + esc(total) + '</div>').join("")
			: '<div class="hint">لا توجد بيانات كافية.</div>';
		html += '</div>';

		html += '</div>';

		box.innerHTML = html;
	}

	function getAdminToken() {
		if (window.AlzidanAuth && typeof window.AlzidanAuth.getAdminToken === "function") {
			return String(window.AlzidanAuth.getAdminToken() || "").trim();
		}
		if (window.AlzidanAdminCore && typeof window.AlzidanAdminCore.getAdminToken === "function") {
			return String(window.AlzidanAdminCore.getAdminToken() || "").trim();
		}
		try {
			return String(
				sessionStorage.getItem("alzidan_admin_token_session_v1") ||
					localStorage.getItem("alzidan_admin_token_v1") ||
					""
			).trim();
		} catch (e) {
			return "";
		}
	}

	let marriageStatsInFlight = null;

	async function loadMarriageStats() {
		if (marriageStatsInFlight) return marriageStatsInFlight;
		marriageStatsInFlight = (async () => {
			if (!getAdminToken()) {
				renderText("سجل الدخول للإدارة لعرض إحصائيات المصاهرة.");
				return;
			}
			const sb = getClient();
			if (!sb) return renderText("الخدمة غير جاهزة حالياً.");

			renderText("جاري تحميل إحصائيات المصاهرة...");

			const { data, error } = await sb
				.from("tree_spouse_summary")
				.select("id,husband_id,wife_is_family_member,wife_branch_key,wife_family_name,status,linked_children_count")
				.limit(5000);

			if (error) {
				renderText("تعذر تحميل إحصائيات المصاهرة: " + (error.message || "خطأ"));
				return;
			}

			render(data || []);
		})().finally(() => {
			marriageStatsInFlight = null;
		});
		return marriageStatsInFlight;
	}

	function isMarriageStatsSectionActive() {
		const section = document.getElementById("marriage-stats-section");
		if (!section) return false;
		if (section.classList.contains("admin-module-off")) return false;
		if (section.hasAttribute("hidden")) return false;
		const style = window.getComputedStyle ? window.getComputedStyle(section) : null;
		if (style && (style.display === "none" || style.visibility === "hidden")) {
			return false;
		}
		return true;
	}

	function loadMarriageStatsIfSectionOpen() {
		if (!getAdminToken()) return;
		if (!isMarriageStatsSectionActive()) return;
		loadMarriageStats().catch(() => {});
	}

	function bindMarriageStatsTriggers() {
		if (bindMarriageStatsTriggers.didBind) return;
		bindMarriageStatsTriggers.didBind = true;

		const refreshBtn = btn();
		if (refreshBtn) {
			refreshBtn.addEventListener("click", () => loadMarriageStats().catch(() => {}));
		}

		// Marriage stats lives under the "stats" admin shell module.
		document.addEventListener("alzidan:admin-module", (ev) => {
			const id = ev && ev.detail ? String(ev.detail.id || "") : "";
			if (id !== "stats") return;
			loadMarriageStatsIfSectionOpen();
		});
	}

	function initAdminMarriageStats() {
		if (isInitialized) return;

		window.AlzidanMarriageStats = { loadMarriageStats };
		bindMarriageStatsTriggers();
		// On-demand only — no auto-load on script parse / before login.
		isInitialized = true;
	}

	window.AlzidanAdminMarriageStatsModule = {
		initAdminMarriageStats,
		loadMarriageStats
	};
})();
