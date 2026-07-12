(function () {
	"use strict";

	let viewsStatsEl = null;
	let refreshViewsStatsBtn = null;
	let isInitialized = false;

	function getClient() {
		if (window.__alzidanConfig && typeof window.__alzidanConfig.getClient === "function") {
			const shared = window.__alzidanConfig.getClient();
			if (shared) return shared;
		}
		if (window.__alzidanSupabaseClient) return window.__alzidanSupabaseClient;
		if (window.__alzidanالخدمةClient) return window.__alzidanالخدمةClient;
		return null;
	}

	const VISIT_PATH_LABELS = {
		"/": "الصفحة الرئيسية",
		pages: "الصفحات",
		"pages/index": "الصفحة الرئيسية",
		"pages/admin": "صفحة الإدارة",
		"pages/alzidan-tree": "شجرة العائلة",
		"pages/contact": "تواصل معنا",
		"pages/privacy": "سياسة الخصوصية",
		"pages/terms": "الشروط والأحكام",
		"pages/delete-account": "حذف الحساب",
		"pages/mobile": "تطبيق الجوال",
		"pages/memory": "ذاكرة العائلة",
		"pages/memory/index": "ذاكرة العائلة",
		"pages/memory/person": "صفحة شخص في الذاكرة",
		"pages/memory/admin": "إدارة الذاكرة",
		memory: "ذاكرة العائلة",
		"memory/index": "ذاكرة العائلة",
		"memory/person": "صفحة شخص في الذاكرة",
		"memory/admin": "إدارة الذاكرة",
		"app/mobile": "تطبيق الجوال",
		"app/mobile/memory": "ذاكرة التطبيق",
		mobile: "تطبيق الجوال",
		admin: "صفحة الإدارة",
		contact: "تواصل معنا",
		privacy: "سياسة الخصوصية",
		terms: "الشروط والأحكام",
		"delete-account": "حذف الحساب",
		"alzidan-tree": "شجرة العائلة",
		person: "صفحة شخص",
		delegate: "لوحة المندوب",
	};

	const VISIT_SLUG_LABELS = {
		pages: "الصفحات",
		memory: "ذاكرة العائلة",
		mobile: "تطبيق الجوال",
		admin: "صفحة الإدارة",
		index: "الصفحة الرئيسية",
		person: "صفحة شخص",
		contact: "تواصل معنا",
		privacy: "سياسة الخصوصية",
		terms: "الشروط والأحكام",
		"delete-account": "حذف الحساب",
		"alzidan-tree": "شجرة العائلة",
		delegate: "لوحة المندوب",
		app: "التطبيق",
	};

	function normalizeVisitPath(value) {
		let text = String(value == null ? "" : value).trim();
		if (!text) return "/";

		text = text.replace(/^file:\/\/\/?/i, "");
		text = text.split(String.fromCharCode(92)).join("/");
		text = text.replace(/\/+/g, "/");
		text = text.replace(/\.html$/i, "");
		text = text.replace(/^\/+/, "");
		text = text.replace(/\/+$/, "");
		text = text.toLowerCase();

		if (!text || text === "index") return "/";
		if (/^index[_-]/i.test(text)) return "/";

		return text;
	}

	function lookupVisitPathLabel(normalized) {
		if (!normalized || normalized === "/") return "الصفحة الرئيسية";

		if (VISIT_PATH_LABELS[normalized]) return VISIT_PATH_LABELS[normalized];

		if (normalized.endsWith("/index")) {
			const parent = normalized.slice(0, -"/index".length);
			if (VISIT_PATH_LABELS[parent]) return VISIT_PATH_LABELS[parent];
			if (VISIT_PATH_LABELS[parent + "/index"]) return VISIT_PATH_LABELS[parent + "/index"];
		}

		if (normalized.startsWith("pages/")) {
			const rest = normalized.slice("pages/".length);
			if (VISIT_PATH_LABELS[rest]) return VISIT_PATH_LABELS[rest];
			if (VISIT_PATH_LABELS["pages/" + rest]) return VISIT_PATH_LABELS["pages/" + rest];
		}

		const parts = normalized.split("/").filter(Boolean);
		const last = parts[parts.length - 1] || "";
		if (VISIT_SLUG_LABELS[last]) return VISIT_SLUG_LABELS[last];

		if (/[\u0600-\u06FF]/.test(normalized)) {
			return parts.length ? parts[parts.length - 1] : normalized;
		}

		const mapped = parts.map((part) => VISIT_SLUG_LABELS[part]).filter(Boolean);
		if (mapped.length) return mapped.join(" — ");

		return "صفحة أخرى";
	}

	function cleanVisitPathLabel(value) {
		const normalized = normalizeVisitPath(value);
		if (/^sandbox$/i.test(normalized)) return "بيئة اختبار";
		if (/patched|final|copy|backup|نسخة/i.test(normalized)) return "صفحة تجريبية";
		return lookupVisitPathLabel(normalized);
	}

	function isIgnoredVisitPathLabel(label) {
		const text = String(label || "").trim();
		if (!text) return true;
		if (text === "بيئة اختبار") return true;
		if (text === "صفحة تجريبية") return true;
		return false;
	}

	function renderViewsStatsLoading() {
		if (!viewsStatsEl) return;
		viewsStatsEl.textContent = "جاري تحميل الإحصاءات...";
	}

	function renderViewsStatsError(text) {
		if (!viewsStatsEl) return;
		viewsStatsEl.textContent = text || "تعذر تحميل الإحصاءات.";
	}

	function num(value) {
		const n = Number(value);
		return isFinite(n) ? n : 0;
	}

	function hasExtendedStats(data) {
		return !!(
			data &&
			("site_total" in data || "memory_total" in data || "app_total" in data)
		);
	}

	function fmtSection(total, today, last7) {
		return (
			"إجمالي: " +
			String(total) +
			" | اليوم: " +
			String(today) +
			" | آخر 7 أيام: " +
			String(last7)
		);
	}

	function renderViewsStats(data) {
		if (!viewsStatsEl) return;

		const total = num(data && data.total);
		const today = num(data && data.today);
		const last7 = num(data && data.last_7);
		const siteTotal = num(data && data.site_total);
		const siteToday = num(data && data.site_today);
		const siteLast7 = num(data && data.site_last_7);
		const memoryTotal = num(data && data.memory_total);
		const memoryToday = num(data && data.memory_today);
		const memoryLast7 = num(data && data.memory_last_7);
		const appTotal = num(data && data.app_total);
		const appToday = num(data && data.app_today);
		const appLast7 = num(data && data.app_last_7);
		const lines = [];

		lines.push("إجمالي الزيارات: " + String(total));
		lines.push("زيارات اليوم: " + String(today) + " | آخر 7 أيام: " + String(last7));
		lines.push("");

		if (!hasExtendedStats(data)) {
			lines.push("⚠️ التفصيل غير متاح — نفّذ ملف SQL:");
			lines.push("supabase/sql/admin_polls_and_view_stats.sql");
		} else {
			lines.push("── الموقع ──");
			lines.push(fmtSection(siteTotal, siteToday, siteLast7));
			lines.push("");
			lines.push("── الذاكرة (ويب) ──");
			lines.push(fmtSection(memoryTotal, memoryToday, memoryLast7));
			lines.push("");
			lines.push("── التطبيق ──");
			lines.push(fmtSection(appTotal, appToday, appLast7));

			if (memoryTotal === 0 && appTotal === 0) {
				lines.push("");
				lines.push(
					"ملاحظة: لا توجد مشاهدات مسجّلة للذاكرة أو التطبيق بعد. زُر صفحات الذاكرة أو افتح تطبيق الجوال.",
				);
			}
		}

		const paths = data && Array.isArray(data.paths) ? data.paths : [];
		const mergedPaths = new Map();

		paths.forEach((p) => {
			const rawPath = p && p.path != null ? String(p.path) : "";
			const count = p && p.total != null ? Number(p.total) : 0;
			if (!rawPath || !isFinite(count) || count <= 0) return;

			const label = cleanVisitPathLabel(rawPath);
			if (isIgnoredVisitPathLabel(label)) return;

			mergedPaths.set(label, (mergedPaths.get(label) || 0) + count);
		});

		const topPaths = Array.from(mergedPaths.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, 5);

		if (topPaths.length) {
			lines.push("");
			lines.push("أكثر الصفحات زيارة:");
			topPaths.forEach(([label, count]) => {
				lines.push("- " + label + " (" + String(count) + ")");
			});
		}

		viewsStatsEl.textContent = lines.join("\n");
	}

	async function loadViewsStats() {
		const sb = getClient();
		if (!sb) {
			renderViewsStatsError("الخدمة غير جاهزة حالياً.");
			return;
		}

		renderViewsStatsLoading();

		const { data, error } = await sb.rpc("site_view_summary_v1", { p_days: 30 });
		if (error) {
			const msg = String(error.message || "");
			const low = msg.toLowerCase();
			const isMissing =
				low.includes("could not find the function") ||
				low.includes("does not exist") ||
				String(error.code || "").toLowerCase() === "pgrst202";

			if (isMissing) {
				renderViewsStatsError("تعذر تحميل إحصاءات الزيارات حالياً.");
				return;
			}

			renderViewsStatsError("تعذر تحميل الإحصاءات، حاول لاحقاً أو تواصل مع الإدارة.");
			return;
		}

		renderViewsStats(data || {});
	}

	function initAdminViews() {
		if (isInitialized) return;

		viewsStatsEl = document.getElementById("views-stats");
		refreshViewsStatsBtn = document.getElementById("refresh-views-stats");

		if (refreshViewsStatsBtn) {
			refreshViewsStatsBtn.addEventListener("click", () => loadViewsStats().catch(() => {}));
		}

		window.AlzidanAdminViews = {
			loadViewsStats
		};

		isInitialized = true;
	}

	window.AlzidanAdminViewsModule = {
		initAdminViews,
		loadViewsStats
	};
})();
